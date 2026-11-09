// Spielschleife des Clients:
//   1. Eingaben in festen Schritten (SIM_DT) lokal simulieren (Prediction) und an den Server senden
//   2. Snapshots empfangen -> Deltas zusammenführen, eigenen Zustand abgleichen, andere interpolieren
//   3. Welt, Fahrzeuge (Schaden, Räder, Lichter), Effekte, Audio, Kamera, HUD rendern
import * as THREE from 'three';
import { ENTER_RADIUS, MAP_SEED, SIM_DT } from '../../../shared/src/constants';
import { lerp, lerpAngle } from '../../../shared/src/math';
import { Btn, DRIVER_COP_ID, VehFlag, type GameEvent, type ServerMsg, type SnapshotMsg, type VehicleInfoTuple, type VehicleTuple } from '../../../shared/src/protocol';
import { createCar, groundHeight, setOrientation, type CarCollision, type CarState, type Impact } from '../../../shared/src/sim/car';
import { enginePower, newDamage, partState, PART_COUNT, smokeStage, unpackDamage, Zone5, type CarDamage } from '../../../shared/src/sim/damage';
import { AIRBOAT_VARIANT, ASSISTS, BIKE_VARIANT, BOAT_VARIANT, CAR_VARIANTS, TANK_VARIANT, variantInfo, type HandlingProfile } from '../../../shared/src/sim/handling';
import { ARCHETYPES } from '../../../shared/src/npc/archetypes';
import { PROP_INFO, PropType } from '../../../shared/src/world/features';
import type { PropHit } from '../../../shared/src/sim/props';
import { driftMultiplier } from '../../../shared/src/sim/stunts';
import { profileOf } from '../../../shared/src/sim/vehicle';
import { VEHICLE_DEFS, VehicleKind, isWaterVehicle, type VehicleKindId } from '../../../shared/src/sim/vehicleDefs';
import { generateWorld } from '../../../shared/src/world/mapgen';
import { Tile } from '../../../shared/src/world/tiles';
import { generateVegetation } from '../../../shared/src/world/vegetation';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { Sfx } from '../audio/Sfx';
import { Input } from '../input/Input';
import { SnapshotBuffer, VEHICLE_EXTRAPOLATION, type Frame } from '../net/Interpolation';
import type { Network } from '../net/Network';
import { Predictor, type Obstacle } from '../net/Prediction';
import { CameraRig } from '../render/CameraRig';
import { FeaturesView } from '../render/FeaturesView';
import { U } from '../render/materials/toon';
import { vehicleMat } from '../render/models';
import { moodFor } from '../render/palette';
import { Particles } from '../render/Particles';
import { Tracers } from '../render/Tracers';
import { QuestMarkers, ShopsView } from '../render/ShopsView';
import { StoresView } from '../render/StoresView';
import { payphones, type PhoneDef } from '../../../shared/src/questLocations';
import type { QuestState } from '../../../shared/src/protocol';
import { generateShops, shopNear, type ShopDef } from '../../../shared/src/shops';
import { Panels } from '../ui/Panels';
import { WEAPONS, type WeaponId } from '../../../shared/src/weapons';
import { taxiProfile } from '../../../shared/src/taxiHunt';
import { PostFX, type GfxSettings } from '../render/PostFX';
import { PropsView } from '../render/PropsView';
import { SmartObjectsView } from '../render/SmartObjectsView';
import { Sky } from '../render/Sky';
import { VehicleFx } from '../render/VehicleFx';
import { WorldView } from '../render/WorldView';
import { Chat } from '../ui/Chat';
import { AudioDebug } from '../ui/AudioDebug';
import { DebugOverlay } from '../ui/DebugOverlay';
import { DriveHud } from '../ui/DriveHud';
import { Hud } from '../ui/Hud';
import { Minimap, playerDotColor, type MapDot } from '../ui/Minimap';
import { applyTune, TuningPanel } from '../ui/TuningPanel';
import { EntityViews, type PlayerState, type VehicleViewState } from './EntityViews';

const SEND_INTERVAL_MS = 33; // ~30 Eingabe-Pakete pro Sekunde
const MINIMAP_INTERVAL = 1 / 15;
const MAX_STEPS_PER_FRAME = 8;
/** Hit-Stop bei sehr harten Crashs (nur Darstellung) */
const HITSTOP_MIN = 0.04, HITSTOP_MAX = 0.08;
const ENGINE_VOICES = 4;

/** Clientseitiges Wissen über ein Fahrzeug (aus Deltas zusammengesetzt). */
interface VehRec {
  info: VehicleInfoTuple;
  dmg: CarDamage;
  dents: number[][];
  applied: number; // so viele Beulen sind am Modell
  dmgKey: string; // zuletzt am Modell angewendeter Schaden
  liveParts: boolean; // Teile-Änderung live (Trümmer erzeugen)
  hornUntil: number;
  burnSince: number; // Client-Zeit Brandbeginn
}

const tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
/** Quaternionen der Fahrzeugdarstellung je Fahrzeug-ID wiederverwenden (keine Neuanlage pro Bild) */
const vehQuats = new Map<number, THREE.Quaternion>();
const vehQuat = (id: number) => { let q = vehQuats.get(id); if (!q) vehQuats.set(id, (q = new THREE.Quaternion())); return q; };
const UP = new THREE.Vector3(0, 1, 0);
/** Untergrenze der dynamischen Auflösung (Anteil der Zielauflösung). */
const RES_MIN = 0.65;

export class Game {
  private map: WorldMap = generateWorld(MAP_SEED);
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private rig: CameraRig;
  private sky: Sky;
  private world: WorldView;
  private views: EntityViews;
  private props: PropsView;
  private features: FeaturesView;
  private smartObjects: SmartObjectsView;
  private fx: VehicleFx;
  private input = new Input();
  private predictor: Predictor;
  private buffer = new SnapshotBuffer();
  private hud = new Hud();
  private drive = new DriveHud();
  private chat = new Chat();
  private minimap: Minimap;
  private debug: DebugOverlay;
  private tuning: TuningPanel | null = null;
  private debugTimer = 0;
  private fpsAvg = 60;

  private acc = 0;
  private lastTime = performance.now();
  private lastSend = 0;
  private minimapTimer = 0;
  private day = 0.35;
  private buttons = 0;
  private post: PostFX;
  private particles: Particles;
  private gfx: GfxSettings = loadGfx();

  private recs = new Map<number, VehRec>();
  private obstacleCache = new Map<number, Obstacle>();
  private obstacles: Obstacle[] = [];
  private clock = 0;
  private hitStop = 0;
  private lastLocalImpact = -9;
  private scrapeLevel = 0;
  private unflipFrames = 0;
  private money = 0;
  private tracers = new Tracers();
  private shops: ShopDef[];
  private copDots = new Map<number, [number, number]>();
  private stores: StoresView;
  private phones: PhoneDef[];
  private phonesView: ShopsView;
  private questMarkers: QuestMarkers;
  private questState: QuestState | null = null;
  private wanted = 0;
  private audioDebug: AudioDebug;
  private panels: Panels;
  private weaponId: WeaponId = 'fists';
  private fireT = 0;
  private ray = new THREE.Raycaster();
  private aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private arrows: THREE.ArrowHelper[] = [];

  constructor(private net: Network, private myId: number, private sfx: Sfx, dev = false) {
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    this.sfx.setWorld(this.map);
    // Kein Antialiasing = DS-Look; Auflösung je nach Retro-Modus (siehe applyGfx)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Statistik über alle Passes eines Bildes sammeln (Schatten, Szene, Bloom …) – sonst zeigt die
    // Anzeige nur den letzten Post-Processing-Pass (1 Draw-Call)
    this.renderer.info.autoReset = false;

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.sky = new Sky(this.scene, this.gfx.shadows);
    this.world = new WorldView(this.map, generateVegetation(this.map, MAP_SEED));
    this.views = new EntityViews(this.map);
    this.props = new PropsView(this.map);
    this.features = new FeaturesView(this.map);
    this.smartObjects = new SmartObjectsView(this.map);
    this.fx = new VehicleFx(this.map, vehicleMat);
    this.shops = generateShops(this.map);
    this.stores = new StoresView(this.map, this.shops);
    this.phones = payphones(this.map);
    this.phonesView = new ShopsView(this.map, this.phones.map((p) => (p.taxi ? { x: p.x, z: p.z, name: '🚕 Catch the Taxi', color: 0x3ad1ff } : p.race ? { x: p.x, z: p.z, name: '🏁 Rennen', color: 0xffd23a } : { x: p.x, z: p.z, name: '☎ Auftrag', color: 0xffe14d })));
    this.questMarkers = new QuestMarkers(this.map);
    this.panels = new Panels((m) => this.net.send(m));
    this.panels.onTalkEnd = (shop, line) => this.hud.toast(`${shop.keeper.name}: „${line}“`, 'info');
    this.panels.onOpenChange = (open) => { this.input.blocked = open; if (open) { this.input.clear(); this.input.fire = false; } this.sfx.ui(open ? 'open' : 'close', 0.5); };
    this.particles = new Particles(this.map);
    this.scene.add(this.world.group, this.views.group, this.particles.group, this.props.group, this.features.group, this.smartObjects.group, this.fx.group, this.tracers.group, this.stores.group, this.phonesView.group, this.questMarkers.group);
    this.views.hooks.debris = (d, vx, vz) => this.fx.spawnDebris(d.geo, d.matrix, vx, 1, vz);
    this.post = new PostFX(this.renderer, this.scene, this.rig.camera);
    this.applyGfx();
    window.addEventListener('keydown', (e) => this.onGfxKey(e));
    this.minimap = new Minimap(
      this.map,
      document.getElementById('minimap') as HTMLCanvasElement,
      document.getElementById('bigmap-canvas') as HTMLCanvasElement,
    );
    this.debug = new DebugOverlay(this.map, this.minimap.base);
    this.debug.onNpcTab = (on) => this.net.send({ t: 'npcDebug', on });
    this.debug.onCommand = (text) => this.net.send({ t: 'chat', text });
    this.audioDebug = new AudioDebug(this.sfx);
    this.debug.audioEl = this.audioDebug.el;
    if (dev) this.tuning = new TuningPanel((cls, values, assists) => this.net.send({ t: 'tune', cls, values, assists }));
    for (let i = 0; i < 9; i++) {
      const a = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, i < 4 ? 0xff4f9a : i < 8 ? 0x2af0e6 : 0xffe14d, 0.4, 0.25);
      a.visible = false;
      (a.line.material as THREE.Material).depthTest = false;
      (a.cone.material as THREE.Material).depthTest = false;
      a.renderOrder = 20;
      this.arrows.push(a);
      this.scene.add(a);
    }

    this.predictor = new Predictor(this.map, {
      info: (id) => { const r = this.recs.get(id); return r ? { kind: r.info[1], variant: r.info[2] } : undefined; },
      damage: (id) => this.recs.get(id)?.dmg,
      obstacles: () => this.obstacles,
      propGone: (id) => this.props.isLoose(id),
      onImpact: (imp, scrape) => this.localImpact(imp, scrape),
      onCarHit: (col, other) => this.localCarHit(col, other),
      onProp: (hit) => this.localProp(hit),
      onTree: (tree, s) => { const c = this.predictor.sim?.car; this.world.wobbleTree(tree, s / 6, c?.vx ?? 1, c?.vz ?? 0); },
      onBonus: () => { /* Anzeige kommt bestätigt vom Server (mit Geld) */ },
    });

    window.addEventListener('resize', () => this.applyGfx());

    // UI-Verdrahtung
    this.input.onChatKey = () => this.chat.open();
    this.input.onMapKey = () => this.minimap.toggleBig();
    this.input.onInteract = () => {
      const s = this.shopNearMe();
      if (s) { this.panels.openTalk(s); return; }
      const ph = this.phoneNearMe();
      if (ph) this.net.send({ t: 'phone', id: ph.id });
      this.net.send({ t: 'hold', on: true });
    };
    this.input.onInteractUp = () => this.net.send({ t: 'hold', on: false });
    this.input.onQuestLog = () => this.panels.toggleLog();
    this.input.onInventory = () => this.panels.toggleInventory();
    this.input.onWeaponSlot = (slot) => this.net.send({ t: 'weapon', slot });
    this.input.onWeaponCycle = (dir) => this.net.send({ t: 'weapon', dir });
    this.chat.onOpenChange = (open) => { this.input.blocked = open; if (open) this.input.clear(); this.sfx.ui('toggle', 0.5); };
    this.chat.onSend = (text) => this.net.send({ t: 'chat', text });

    net.onMessage = (msg) => this.onMessage(msg);
    net.onClose = () => {
      this.hud.toast('Verbindung zum Server verloren. Seite neu laden, um wieder beizutreten.', 'bad');
    };
  }

  // ------------------------------------------------------------------ Grafik-Einstellungen
  /** Auflösung, Retro-Modus (Render-Scale 0,6 + Nearest-Neighbor), Schatten, Bloom. */
  private applyGfx() {
    this.applyResolution();
    this.sky.setShadows(this.gfx.shadows);
    this.post.setBloom(this.gfx.bloom);
    // Umrisslinien ein/aus: Hüllen-Meshes ausblenden (spart Draw-Calls)
    this.scene.traverse((o) => { if (o.userData.outline) o.visible = this.gfx.outlines; });
    saveGfx(this.gfx);
  }

  /** Render-Auflösung: Retro fest 0,6, sonst Bildschirm x dynamischer Faktor (siehe updateResolution). */
  private applyResolution() {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = this.gfx.retro ? 0.6 : Math.min(window.devicePixelRatio, 1.5) * 0.9 * this.resScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, ratio);
    this.rig.resize(w / h);
    U.uResolution.value.set(Math.round(w * ratio), Math.round(h * ratio));
    this.fx.setScale(Math.round(h * ratio));
  }

  // ------------------------------------------------------------------ Dynamische Auflösung
  /** Faktor auf die Render-Auflösung (1 = volle Zielauflösung). */
  private resScale = 1;
  private res = { t: 0, frames: 0, cpu: 0, good: 0, hold: 0, lock: 0, raisedAt: -99 };
  /**
   * Dynamic Resolution Scaling: Ist die Grafikkarte der Engpass (Bildrate unter ~48 FPS, die
   * JS-Arbeit pro Bild aber klein), wird die Render-Auflösung schrittweise gesenkt (bis 65 %), bei
   * dauerhaft flüssigen 57+ FPS langsam wieder angehoben. Inhalte bleiben gleich – nur die Pixelzahl
   * ändert sich. Ein Anheben, das sofort wieder Einbrüche bringt, wird für eine Weile gesperrt.
   */
  private updateResolution(rawDt: number, cpuMs: number) {
    const r = this.res;
    r.t += rawDt; r.frames++; r.cpu += cpuMs;
    r.hold = Math.max(0, r.hold - rawDt); r.lock = Math.max(0, r.lock - rawDt);
    if (r.t < 1) return;
    const fps = r.frames / r.t, cpu = r.cpu / r.frames;
    r.t = 0; r.frames = 0; r.cpu = 0;
    if (this.gfx.retro || document.hidden) return;
    let next = this.resScale;
    const gpuBound = cpu < 0.6 * (1000 / Math.max(1, fps));
    if (fps < 48 && gpuBound && this.resScale > RES_MIN) {
      next = Math.max(RES_MIN, this.resScale - (fps < 35 ? 0.15 : 0.08));
      r.hold = 6; r.good = 0;
      if (this.clock - r.raisedAt < 4) r.lock = 45; // Anheben hat nicht gereicht: länger dabei bleiben
    } else if (fps > 57) {
      if (++r.good >= 4 && r.hold <= 0 && r.lock <= 0 && this.resScale < 1) { next = Math.min(1, this.resScale + 0.05); r.good = 0; r.raisedAt = this.clock; }
    } else r.good = 0;
    if (next !== this.resScale) { this.resScale = next; this.applyResolution(); }
  }

  /** F9 = Retro-Modus, F8 = Qualität durchschalten (alles / ohne Schatten / ohne Schatten+Linien+Bloom). */
  private onGfxKey(e: KeyboardEvent) {
    if (e.code === 'F9') {
      e.preventDefault();
      this.gfx.retro = !this.gfx.retro;
      this.hud.toast(`Retro-Modus ${this.gfx.retro ? 'an' : 'aus'} (F9)`, 'info');
      this.applyGfx();
    } else if (e.code === 'F8') {
      e.preventDefault();
      const level = this.gfx.shadows ? 1 : this.gfx.outlines ? 2 : 0;
      this.gfx.shadows = level === 0;
      this.gfx.outlines = level !== 2;
      this.gfx.bloom = level !== 2;
      this.hud.toast(['Grafik: hoch', 'Grafik: mittel (ohne Schatten)', 'Grafik: niedrig'][level], 'info');
      this.applyGfx();
    } else if (e.code === 'F7') {
      e.preventDefault();
      this.rig.shakeEnabled = !this.rig.shakeEnabled;
      this.hud.toast(`Bildschirmwackeln ${this.rig.shakeEnabled ? 'an' : 'aus'} (F7)`, 'info');
    }
  }

  start() {
    const loop = (now: number) => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ Nachrichten
  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'snap': this.onSnapshot(msg); break;
      case 'chat':
        this.chat.add(msg.from, msg.text, msg.color, msg.system);
        break;
      case 'notice':
        this.hud.toast(msg.text, msg.kind);
        this.sfx.ui(msg.kind === 'good' ? 'good' : msg.kind === 'bad' ? 'bad' : 'info', 0.55);
        if (msg.kind !== 'info') this.sfx.duck(-6, 1.4); // Missionsansage: Radio/Ambience kurz absenken
        break;
      case 'bonus':
        this.drive.bonus(msg.kind, msg.points, msg.money, msg.info);
        this.drive.money(msg.total);
        if (msg.money > 0) this.sfx.ui('money', 0.45);
        break;
      case 'tune':
        applyTune(msg.cls, msg.values, msg.assists);
        break;
      case 'phone': this.panels.openPhone(msg.name, msg.quests); break;
      case 'questLog': this.panels.setQuestLog(msg.done, msg.cooldowns); break;
      case 'error':
        this.hud.toast(msg.text, 'bad');
        break;
      case 'npcDebug': this.debug.setNpcData(msg); break;
    }
  }

  /** Zielwinkel aus der Mausposition (Strahl auf eine Ebene in Brusthöhe), vorwärts = (sin a, cos a). */
  private aimAngle(): number | null {
    const me = this.predictor.view();
    const ndc = new THREE.Vector2((this.input.mouseX / window.innerWidth) * 2 - 1, -(this.input.mouseY / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.rig.camera);
    this.aimPlane.constant = -(this.map.surfaceY(me.x, me.z) + 1);
    const hit = this.ray.ray.intersectPlane(this.aimPlane, tmpV);
    if (!hit) return null;
    return Math.atan2(hit.x - me.x, hit.z - me.z);
  }

  /** Linke Maustaste gedrückt: im Takt der Waffe Angriffe senden (der Server prüft Feuerrate und Munition). */
  private updateFire(dt: number) {
    this.fireT -= dt;
    // Im Fahrzeug nur mit Pistole (Drive-by); der Server prüft die Schussrichtung
    // Catch the Taxi: das Taxi schießt immer mit der Pistole, Jäger gar nicht (Server prüft beides)
    const hunt = this.questState?.hunt;
    const weapon = hunt === 'taxi' ? 'pistol' : this.weaponId;
    const driveBy = this.predictor.inVehicle && WEAPONS[weapon]?.slot === 'pistol';
    if (!this.input.fire || this.input.blocked || hunt === 'hunter' || (this.predictor.inVehicle && !driveBy) || this.fireT > 0) return;
    const aim = this.aimAngle();
    if (aim === null) return;
    this.net.send({ t: 'attack', aim });
    this.fireT = (WEAPONS[weapon]?.cooldown ?? 0.4) * 0.95;
  }

  private phoneNearMe(): PhoneDef | null {
    const me = this.predictor.view();
    let best: PhoneDef | null = null, bd = 8 * 8;
    for (const p of this.phones) { const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }

  private shopNearMe(): ShopDef | null {
    const me = this.predictor.view();
    return shopNear(this.shops, me.x, me.z, this.predictor.inVehicle);
  }

  private rec(id: number): VehRec | undefined { return this.recs.get(id); }

  private onSnapshot(snap: SnapshotMsg) {
    for (const vi of snap.vi ?? []) {
      const r = this.recs.get(vi[0]);
      if (r) r.info = vi;
      else this.recs.set(vi[0], { info: vi, dmg: newDamage(), dents: [], applied: 0, dmgKey: '', liveParts: false, hornUntil: 0, burnSince: 0 });
    }
    this.buffer.push(snap);
    for (const id of snap.vg ?? []) this.recs.delete(id);
    for (const d of snap.dmg ?? []) {
      const r = this.recs.get(d[0]);
      if (!r) continue;
      const burning = r.dmg.burn > 0;
      unpackDamage(d.slice(1), r.dmg);
      if (r.dmg.burn > 0 && !burning) r.burnSince = this.clock - r.dmg.burn;
    }
    for (const [id, list] of snap.dents ?? []) {
      const r = this.recs.get(id);
      if (r) { r.dents = list.slice(); r.applied = 0; r.dmgKey = ''; this.views.repair(id); }
    }
    for (const ev of snap.ev ?? []) this.onEvent(ev);
    this.props.apply(snap.pr, snap.prg);
    for (const p of snap.p ?? []) { if (p[5] === 3) this.copDots.set(p[0], [p[1], p[2]]); else this.copDots.delete(p[0]); }
    for (const id of snap.pg ?? []) this.copDots.delete(id);
    this.predictor.reconcile(snap, this.myId, SIM_DT);
    this.day = snap.day;
    if (snap.me) { this.money = snap.me.money; this.drive.money(this.money); this.hud.setStats(snap.me.stats); this.questState = snap.me.quest ?? null; this.wanted = snap.me.stats.wanted; this.panels.update(snap.me.stats, snap.me.money, this.questState); this.questMarkers.set(this.questState); this.weaponId = snap.me.stats.weapon as WeaponId; }
  }

  /** Lautstärke + Stereo-Position eines Weltpunkts relativ zur Kamera */
  private spatial(x: number, z: number): [number, number] {
    const f = this.rig.target;
    const d = Math.hypot(x - f.x, z - f.z);
    return [1 / (1 + d / 18), Math.max(-1, Math.min(1, (x - f.x) / 40))];
  }

  private involvesMe(vid: number, other: number) {
    const mine = this.predictor.vehicleId;
    return mine >= 0 && (vid === mine || other === mine);
  }

  private onEvent(ev: GameEvent) {
    const kind = ev[0] as string;
    const car = this.sfx.car;
    switch (kind) {
      case 'crash': {
        const [, vid, x, y, z, nx, nz, dv, other] = ev as number[] & [string];
        if (this.involvesMe(vid, other) && this.clock - this.lastLocalImpact < 0.4) break; // lokal schon gezeigt
        const [vol] = this.spatial(x, z);
        car?.crash(dv, this.involvesMe(vid, other) ? null : { x, y, z });
        if (dv > 4) this.fx.sparks(x, y, z, nx * 3, nz * 3, Math.min(30, dv * 1.5));
        if (this.involvesMe(vid, other)) this.feelImpact(dv);
        else this.rig.kick(Math.min(0.5, dv / 30) * vol);
        break;
      }
      case 'dent': {
        const r = this.recs.get(ev[1] as number);
        if (r) r.dents.push((ev as number[]).slice(2));
        break;
      }
      case 'part': {
        const r = this.recs.get(ev[1] as number);
        if (r) r.liveParts = true;
        break;
      }
      case 'boom': {
        const [, , x, y, z] = ev as number[];
        this.fx.explosion(x, y, z);
        const [vol] = this.spatial(x, z);
        car?.explosion({ x, y, z });
        this.rig.kick(Math.min(1, vol * 1.4));
        this.input.rumble(vol, vol, 500);
        if (vol > 0.5) this.hitStop = HITSTOP_MAX;
        break;
      }
      case 'bark': this.views.bark(ev[1] as number, ev[2] as number, ev[3] as number); break;
      case 'honk': {
        const r = this.recs.get(ev[1] as number);
        if (r) r.hornUntil = this.clock + 0.35 + Math.random() * 0.3;
        break;
      }
      case 'eject':
        if (ev[1] === this.myId) { this.rig.kick(0.8); this.input.rumble(1, 1, 400); this.hitStop = HITSTOP_MAX; }
        break;
      case 'repair': {
        const id = ev[1] as number;
        const r = this.recs.get(id);
        if (r) { r.dents = []; r.applied = 0; r.dmgKey = ''; }
        this.views.repair(id);
        break;
      }
      case 'tire': {
        const [, vid, , x, y, z] = ev as number[];
        car?.tireBurst(this.involvesMe(vid, -9) ? null : { x, y, z });
        this.fx.sparks(x, y, z, 0, 0, 10);
        if (this.involvesMe(vid, -9)) { this.rig.kick(0.3); this.input.rumble(0.6, 0.8, 200); }
        break;
      }
      case 'shot': {
        const [, pid, x0, z0, x1, z1, wid] = ev as number[];
        const y0 = this.map.surfaceY(x0, z0) + 1.1, y1 = this.map.surfaceY(x1, z1) + 1.1;
        const kind = Object.keys(WEAPONS)[wid];
        const thrown = kind === 'molotov' || kind === 'rocket';
        this.tracers.add(x0, y0, z0, x1, y1, z1, thrown ? 0xff9a2e : 0xffe14d);
        this.fx.sparks(x0, y0, z0, 0, 0, 3);
        this.sfx.weapon(kind === 'shotgun' || kind === 'rifle' || kind === 'rocket' ? 'heavy' : 'shot', { x: x0, y: y0, z: z0 });
        this.views.playAttack(pid, 'shot');
        if (pid === this.myId) this.rig.kick(kind === 'shotgun' || kind === 'rocket' ? 0.25 : 0.08);
        break;
      }
      case 'swing': {
        const [, pid, , , x, z] = ev as number[];
        this.views.playAttack(pid, 'swing');
        this.sfx.weapon('swing', { x, y: this.map.surfaceY(x, z) + 1.2, z });
        break;
      }
      case 'hit': {
        const [, x, z] = ev as number[];
        this.fx.sparks(x, this.map.surfaceY(x, z) + 1, z, 0, 0, 8);
        this.sfx.weapon('hit', { x, y: this.map.surfaceY(x, z) + 1, z });
        break;
      }
      case 'blood': {
        // Treffer/angefahren: auf Brusthöhe, überfahren: aus Bodennähe
        const [, x, z, amount, dx, dz, k] = ev as number[];
        const gy = this.map.surfaceY(x, z);
        this.fx.bloodSplash(x, gy + (k === 2 ? 0.25 : k === 1 ? 0.8 : 1.15), z, dx, dz, amount, k);
        if (k === 2) this.sfx.weapon('hit', { x, y: gy, z });
        break;
      }
      case 'tree': this.world.wobbleTree(ev[1] as number, ev[2] as number, Math.random() - 0.5, Math.random() - 0.5); break;
      case 'prop': {
        const [, id, x, , z, speed] = ev as number[];
        const p = this.props.props[id];
        if (!p) break;
        const [vol] = this.spatial(x, z);
        if (this.clock - this.lastLocalImpact > 0.3 || vol < 0.9) car?.propHit(PROP_INFO[p.type].mass > 50, { x, y: p.y, z });
        if (p.type === PropType.Lamp) this.fx.sparks(x, p.y + 0.5, z, 0, 0, 12);
        void speed;
        break;
      }
    }
  }

  // ------------------------------------------------------------------ lokale Effekte (Prediction)
  private feelImpact(dv: number) {
    this.rig.kick(Math.min(1, dv / 20));
    this.input.rumble(Math.min(1, dv / 15), Math.min(1, dv / 10), 120 + dv * 12);
    if (dv > ASSISTS.hardCrash) this.hitStop = Math.min(HITSTOP_MAX, HITSTOP_MIN + (dv - ASSISTS.hardCrash) * 0.004);
  }

  private localImpact(imp: Impact, scrape: Impact) {
    if (imp.dv > 2.5) {
      this.lastLocalImpact = this.clock;
      this.sfx.car?.crash(imp.dv, null);
      this.feelImpact(imp.dv);
      if (imp.dv > 4 && imp.kind !== 3) this.fx.sparks(imp.x, imp.y, imp.z, imp.nx * 3, imp.nz * 3, Math.min(30, imp.dv * 1.5));
    }
    if (scrape.scrape > 2) {
      this.scrapeLevel = Math.max(this.scrapeLevel, scrape.scrape);
      this.fx.sparks(scrape.x, scrape.y, scrape.z, 0, 0, 1 + Math.floor(scrape.scrape / 5));
    }
  }

  private localCarHit(col: CarCollision, other: Obstacle) {
    if (col.vn < 2) return;
    this.lastLocalImpact = this.clock;
    this.sfx.car?.crash(col.vn, null);
    this.feelImpact(col.dvA * 1.2 + 1);
    if (col.vn > 4) this.fx.sparks(col.x, col.y, col.z, col.nx * 3, col.nz * 3, Math.min(30, col.vn * 1.5));
    void other;
  }

  private localProp(hit: PropHit) {
    this.props.knockLocal(hit.prop.id, hit.vx, hit.vz);
    this.sfx.car?.propHit(PROP_INFO[hit.prop.type].mass > 50, null);
    this.lastLocalImpact = this.clock;
    if (hit.prop.type === PropType.Lamp) this.fx.sparks(hit.prop.x, hit.prop.y + 0.5, hit.prop.z, hit.vx * 0.3, hit.vz * 0.3, 14);
    this.rig.kick(Math.min(0.4, PROP_INFO[hit.prop.type].mass / 300));
  }

  // ------------------------------------------------------------------ fremde Fahrzeuge
  /** Interpolierter + kurz extrapolierter Zustand eines fremden Fahrzeugs */
  private remoteState(va: VehicleTuple, vb: VehicleTuple, t: number, extra: number) {
    const ext = Math.min(0.25, extra);
    const r = this.remoteTmp;
    r.x = lerp(va[1], vb[1], t) + vb[5] * ext; r.z = lerp(va[2], vb[2], t) + vb[6] * ext;
    r.y = lerp(va[3], vb[3], t) + vb[11] * ext;
    r.yaw = lerpAngle(va[4], vb[4], t); r.pitch = lerp(va[9], vb[9], t); r.roll = lerp(va[10], vb[10], t);
    r.vx = vb[5]; r.vz = vb[6]; r.vy = vb[11]; r.steer = lerp(va[7], vb[7], t); r.flags = vb[8]; r.rpm = vb[12] * 100;
    return r;
  }
  /** Wiederverwendeter Zwischenstand (keine Allokation je Fahrzeug und Bild). */
  private remoteTmp = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vz: 0, vy: 0, steer: 0, flags: 0, rpm: 0 };

  private obstacleSeen = new Set<number>();
  /** Hindernisse für die Prediction: fremde Fahrzeuge in der Nähe (Gegenwart, extrapoliert) */
  private buildObstacles() {
    // im Fahrzeug: Fahrzeug-Kollision; zu Fuß: Autos als feste Körper für die Figur
    const me = this.predictor.inVehicle ? this.predictor.sim?.car : this.predictor.pawn;
    this.obstacles.length = 0;
    if (!me) return;
    const age = this.buffer.latestAge();
    const seen = this.obstacleSeen;
    seen.clear();
    for (const vb of this.buffer.vehicles.values()) {
      const id = vb[0];
      if (id === this.predictor.vehicleId) continue;
      const dx = vb[1] - me.x, dz = vb[2] - me.z;
      if (dx * dx + dz * dz > 40 * 40) continue;
      const r = this.recs.get(id);
      if (!r) continue;
      let o = this.obstacleCache.get(id);
      if (!o || o.prof !== profileOf(r.info[2])) {
        o = { id, car: createCar(), prof: profileOf(r.info[2]), water: isWaterVehicle(r.info[1]) };
        this.obstacleCache.set(id, o);
      }
      const c = o.car;
      const ext = Math.min(0.3, age + 0.03);
      c.x = vb[1] + vb[5] * ext; c.z = vb[2] + vb[6] * ext; c.y = vb[3];
      setOrientation(c, vb[4], vb[9], vb[10]);
      c.vx = vb[5]; c.vz = vb[6]; c.vy = vb[11]; c.wx = c.wy = c.wz = 0;
      this.obstacles.push(o);
      seen.add(id);
    }
    for (const id of this.obstacleCache.keys()) if (!seen.has(id)) this.obstacleCache.delete(id);
  }

  // ------------------------------------------------------------------ Frame
  private frame(now: number) {
    const rawDt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.predictor.ready) return; // auf den ersten Snapshot warten
    if (++this.frameNo === 1) this.warmup(); // vor dem ersten Bild: es gibt noch keine echten Entitäten
    this.clock += rawDt;
    // Hit-Stop: Darstellung kurz einfrieren (Simulation und Netz laufen weiter)
    let dt = rawDt;
    if (this.hitStop > 0) { this.hitStop -= rawDt; dt = rawDt * 0.05; }

    // 1) Eingaben in festen Schritten simulieren
    this.buildObstacles();
    this.acc += rawDt;
    let steps = 0;
    const useNow = this.input.consumeUse();
    if (useNow) {
      const car = this.predictor.sim?.car;
      if (car && car.flip >= ASSISTS.unflipDelay) this.unflipFrames = 6;
      else this.net.send({ t: 'use' });
    }
    while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_FRAME) {
      const s = this.input.sample(this.predictor.inVehicle);
      let buttons = s.buttons;
      // Rennstart: Fahrzeug steht bis zum Countdown-Ende (Server erzwingt dasselbe)
      if (this.questState?.freeze && this.predictor.inVehicle) { s.ax = 0; s.ay = 0; buttons = Btn.BRAKE; }
      if (this.unflipFrames > 0) { buttons |= Btn.UNFLIP; this.unflipFrames--; }
      // Catch the Taxi: unendlich Nitro (Server setzt dasselbe)
      if (this.questState?.hunt === 'taxi' && this.predictor.sim) { const sim = this.predictor.sim; sim.prof = taxiProfile(sim.prof); sim.car.nitro = 1; }
      this.predictor.step(s.ax, s.ay, buttons, SIM_DT);
      this.buttons = buttons;
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0; // nach Hängern nicht "aufholen"
    if (now - this.lastSend >= SEND_INTERVAL_MS) {
      const cmds = this.predictor.takeOutbox();
      if (cmds.length) this.net.send({ t: 'input', cmds });
      this.lastSend = now;
    }
    this.predictor.decay(rawDt);
    this.updateFire(rawDt);

    // 2) Entitäten darstellen
    const frame = this.buffer.frame();
    const latest = this.buffer.latest;
    this.views.night = this.sky.night;
    this.sfx.car?.begin();
    this.views.beginFrame(dt);
    const me = this.predictor.view();
    // Eigener Spieler für den Blickkontakt der NPCs (Tempo geglättet)
    const lv = this.views.local;
    const sp = dt > 0 ? Math.hypot(me.x - lv.x, me.z - lv.z) / dt : 0;
    lv.speed += (Math.min(sp, 20) - lv.speed) * Math.min(1, dt * 6);
    lv.x = me.x; lv.z = me.z; lv.id = this.myId; lv.onFoot = !this.predictor.inVehicle;
    const vehicleStates = frame ? this.drawEntities(frame, dt, me) : new Map<number, VehicleViewState>();
    this.views.endFrame();
    this.sfx.car?.end();

    // 3) Kamera, Licht, UI
    const ownCar = this.predictor.sim?.car ?? null;
    const myY = ownCar ? me.y - this.predictor.sim!.prof.cgHeight : this.map.surfaceY(me.x, me.z);
    this.rig.update(me.x, myY, me.z, me.a, ownCar?.vx ?? 0, ownCar?.vz ?? 0, this.predictor.inVehicle, dt, ownCar?.boost ? ASSISTS.nitroFov : 0);
    U.uTime.value += dt;
    U.uFocus.value.set(me.x, myY + 1, me.z);
    this.sky.setMood(moodFor(this.map.zoneAt(me.x, me.z), this.map.districtAt(me.x, me.z)?.style ?? null));
    this.sky.update(this.day, this.rig.target, dt);
    this.world.update(this.rig.target.x, this.rig.target.z);
    this.world.setNight(this.sky.night);
    this.world.setLight(this.sky.light);
    this.world.updateWobble(dt);
    this.props.setNight(this.sky.night);
    this.props.update(dt);
    for (const p of this.props.sprays) this.fx.splash(p.x, p.y + 0.8, p.z, 0, 7, 0, 2);
    this.features.update(dt);
    this.views.setFocus(this.rig.target);
    this.views.setCamera(this.rig.camera); // Sichtfeld fürs nächste Bild (Animationen außerhalb sparen)
    this.particles.update(dt, this.rig.target);
    this.fx.update(dt);
    this.tracers.update(dt);
    const talk = this.panels.talkingTo() ?? (this.chat.isOpen ? null : this.shopNearMe());
    this.stores.setTalkable(talk);
    this.stores.update(dt, me.x, me.z, this.predictor.inVehicle);
    this.phonesView.update(dt); this.questMarkers.update(dt);
    // Linienstärke: mit dem Zoom dünner, mit der Auflösung dicker (Referenz 720p)
    U.uOutlineScale.value = this.gfx.outlines ? Math.max(0.55, this.rig.zoom) * (U.uResolution.value.y / 720) : 0;
    this.post.update(this.sky.mood, this.sky.night);
    this.rig.camera.getWorldDirection(tmpV3);
    this.sfx.frame(rawDt, this.rig.target.x, myY, this.rig.target.z, tmpV3.x, tmpV3.z);
    this.ownCarAudio(rawDt);
    this.footsteps(me.x, me.z, rawDt);

    this.updateHud(latest, vehicleStates, me);
    this.minimapTimer -= rawDt;
    if (this.minimapTimer <= 0 && latest) {
      this.minimapTimer = MINIMAP_INTERVAL;
      this.drawMinimap(latest, vehicleStates, me);
    }

    this.renderer.info.reset();
    this.post.render();
    this.updateResolution(rawDt, performance.now() - now);
    this.hud.tickFps(rawDt, this.renderer.info.render.calls, this.gfx.retro ? 1 : this.resScale);

    // Debug-Overlay (F3): Werte jeden Frame, Neuzeichnen ~4x pro Sekunde
    this.fpsAvg += (1 / Math.max(rawDt, 1e-3) - this.fpsAvg) * 0.05;
    const info = this.renderer.info.render;
    this.debug.update(me.x, me.z, me.a, {
      fps: Math.round(this.fpsAvg), calls: info.calls, triangles: info.triangles,
      entities: frame ? frame.b.vehicles.size + frame.b.players.size + frame.b.peds.size : 0,
    });
    this.debugTimer -= rawDt;
    if (this.debugTimer <= 0) { this.debugTimer = 0.25; this.debug.redraw(); if (this.debug.audioTab) this.audioDebug.update(); }
    this.vehicleDebug();
  }

  private frameNo = 0;
  /**
   * Shader-Aufwärmen: Je eine Instanz aller Fahrzeugmodelle, Figurentypen, Waffen, Szenario-Gegenstände
   * und Sprechblasen kurz vor die Kamera stellen und ein Bild rendern. Sonst kompiliert WebGL jedes
   * neue Material-/Shader-Programm erst, wenn es zum ersten Mal im Bild auftaucht – das sind die
   * Ruckler beim Herumfahren. Danach wird alles wieder entfernt (Vorlagen bleiben im Cache).
   */
  private warmup() {
    const t0 = performance.now();
    const me = this.predictor.view();
    const f = { x: me.x, z: me.z };
    const gy = this.map.surfaceY(f.x, f.z);
    const q = new THREE.Quaternion();
    let id = -1_000_000;
    this.views.beginFrame(0);
    const vehicles: [number, number, number][] = [
      ...CAR_VARIANTS.map((_, v): [number, number, number] => [VehicleKind.Car, v, -1]),
      [VehicleKind.Car, 1, DRIVER_COP_ID], [VehicleKind.Car, TANK_VARIANT, DRIVER_COP_ID], [VehicleKind.Bike, BIKE_VARIANT, -1], [VehicleKind.Boat, BOAT_VARIANT, -1], [VehicleKind.Airboat, AIRBOAT_VARIANT, -1],
    ];
    vehicles.forEach(([kind, variant, driver], i) => {
      const x = f.x + (i % 6) * 5 - 12, z = f.z + Math.floor(i / 6) * 6 - 6;
      this.views.setVehicle({ id: id--, kind, variant, color: i % 10, driver, x, y: gy + profileOf(variant).cgHeight, z, q, vx: 0, vz: 0, steer: 0, flags: 0 }, 0);
    });
    const weapons = Object.keys(WEAPONS).length;
    for (let w = 0; w < weapons; w++) {
      this.views.setPlayer({ id: id--, name: 'warmup', x: f.x + w, z: f.z, a: 0, veh: -1, color: w, carrying: false, h: 0, ragdoll: w === 1, weapon: w }, 0.016, null, false);
    }
    const acts = 31; // alle Act-IDs (scenarios.ts), damit auch jeder Szenario-Gegenstand einmal gezeigt wird
    for (let k = -1; k < Math.max(ARCHETYPES.length, acts); k++) {
      this.views.setPed({
        id: id--, x: f.x + (k % 8), z: f.z + 2 + Math.floor(k / 8), a: 0, color: k & 7, running: false, h: 0, ragdoll: false,
        angry: k === 0, cop: k === 1, gang: k === 2, arch: k < ARCHETYPES.length ? k : -1, act: k > 2 ? k % acts : 0, fear: -1,
      }, 0.016);
    }
    this.views.endFrame();
    this.fx.flash(f.x, gy + 1, f.z, 0.01, 0.01);
    const extra = this.props.warmupMeshes(f.x, gy, f.z);
    this.scene.add(...extra);
    // Ein echtes Bild über die Nachbearbeitung (gleiche Render-Ziele/Farbräume, Schattenpass) –
    // ohne Frustum-Culling, damit auch alles außerhalb des Bildes einmal kompiliert wird
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    this.post.render();
    for (const o of culled) o.frustumCulled = true;
    this.scene.remove(...extra);
    // alles wieder weg (beim nächsten endFrame ungesehen -> entfernt)
    this.views.beginFrame(0);
    this.views.endFrame();
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) console.info(`[gfx] Shader aufgewärmt in ${Math.round(performance.now() - t0)} ms, ${this.renderer.info.programs?.length ?? 0} Programme`);
  }

  /** Interpoliert alle Entitäten und übergibt sie an die 3D-Darstellung. */
  private drawEntities(frame: Frame, dt: number, me: ReturnType<Predictor['view']>) {
    const { a, b, t } = frame;
    const vehicleStates = new Map<number, VehicleViewState>();
    const myVehicle = this.predictor.vehicleId;
    const extra = VEHICLE_EXTRAPOLATION + frame.over;
    const focus = this.rig.target;
    const engines: { id: number; d: number; s: VehicleViewState; rpm: number }[] = [];

    for (const vb of b.vehicles.values()) {
      const id = vb[0];
      const rec = this.recs.get(id);
      if (!rec) continue;
      const [, kind, variant, color, driver] = rec.info;
      let s: VehicleViewState;
      let rpm = 0;
      if (id === myVehicle && this.predictor.sim) {
        // Eigenes Fahrzeug: vorhergesagter Zustand statt Interpolation
        const c = this.predictor.sim.car;
        let flags = 0;
        if (c.brk > 0.1) flags |= VehFlag.BRAKE;
        if (c.rev) flags |= VehFlag.REVERSE;
        if (c.boost) flags |= VehFlag.BOOST;
        if (this.buttons & Btn.HORN) flags |= VehFlag.HORN;
        s = { id, kind, variant, color, driver, x: me.x, y: me.y, z: me.z, q: this.predictor.viewQuat(vehQuat(id)), vx: c.vx, vz: c.vz, steer: c.steer, flags, comp: c.comp, spin: c.spin, tires: rec.dmg.tires };
        rpm = c.rpm;
      } else {
        const va = a.vehicles.get(id) ?? vb;
        const r = this.remoteState(va, vb, t, extra);
        const prof = profileOf(variant);
        if (!isWaterVehicle(kind)) r.y = Math.max(r.y, groundHeight(this.map, r.x, r.z) + prof.cgHeight * 0.5);
        tmpE.set(r.pitch, r.yaw, r.roll, 'YXZ');
        s = { id, kind, variant, color, driver, x: r.x, y: r.y, z: r.z, q: vehQuat(id).setFromEuler(tmpE), vx: r.vx, vz: r.vz, steer: r.steer, flags: r.flags, tires: rec.dmg.tires };
        rpm = r.rpm;
      }
      const isNew = !this.views.hasVehicle(id);
      vehicleStates.set(id, s);
      this.views.setVehicle(s, dt);
      this.syncDamage(id, rec, isNew, s);
      this.vehicleFx(s, rec, dt, id === myVehicle);
      // Hupe (Spieler gedrückt oder NPC-Hupen)
      const car = this.sfx.car;
      if (car) {
        const own = id === myVehicle;
        const pos = { x: s.x, y: s.y, z: s.z };
        if (s.flags & VehFlag.HORN || rec.hornUntil > this.clock) car.horn(id, variantInfo(variant).cls, own ? null : pos);
        if (rec.dmg.burn > 0 && !own) car.fire(id, pos, 1, dt);
        // Sirene: Streifenwagen bei Einsatzfahrt oder solange nach mir gefahndet wird
        if (driver === DRIVER_COP_ID && variant !== TANK_VARIANT && !rec.dmg.wreck && (Math.hypot(s.vx, s.vz) > 13 || (this.wanted > 0 && Math.hypot(s.x - focus.x, s.z - focus.z) < 220))) car.siren(id, pos, s.vx, s.vz);
      }
      if (id !== myVehicle && driver !== -1 && !rec.dmg.wreck) engines.push({ id, d: Math.hypot(s.x - focus.x, s.z - focus.z), s, rpm });
    }
    // Motorgeräusche der nächsten fremden Fahrzeuge
    engines.sort((p, q) => p.d - q.d);
    for (const e of engines.slice(0, ENGINE_VOICES)) {
      if (e.d > 110 || !this.sfx.car) break;
      const prof = profileOf(e.s.variant);
      const fwd = tmpV.set(0, 0, 1).applyQuaternion(e.s.q);
      this.sfx.car.remote(e.id, {
        cls: variantInfo(e.s.variant).cls, pos: { x: e.s.x, y: e.s.y, z: e.s.z }, vx: e.s.vx, vz: e.s.vz, fwdX: fwd.x, fwdZ: fwd.z,
        rpm: Math.max(prof.idleRpm, e.rpm), idle: prof.idleRpm, redline: prof.redline, boost: (e.s.flags & VehFlag.BOOST) !== 0, water: isWaterVehicle(e.s.kind),
      }, dt);
    }

    for (const pb of b.players.values()) {
      const isMe = pb[0] === this.myId;
      const pa = a.players.get(pb[0]) ?? pb;
      const pw = this.predictor.pawn;
      const st: PlayerState = isMe
        ? { id: pb[0], name: pb[1], x: me.x, z: me.z, a: me.a, veh: myVehicle, color: pb[6], carrying: pb[7] === 1, h: pw.h, ragdoll: pw.rt > 0, weapon: pb[10] ?? 0 }
        : {
            id: pb[0], name: pb[1], x: lerp(pa[2], pb[2], t), z: lerp(pa[3], pb[3], t),
            a: lerpAngle(pa[4], pb[4], t), veh: pb[5], color: pb[6], carrying: pb[7] === 1, h: lerp(pa[8] ?? 0, pb[8] ?? 0, t), ragdoll: pb[9] === 1, weapon: pb[10] ?? 0,
          };
      const seat = st.veh >= 0 ? vehicleStates.get(st.veh) ?? null : null;
      if (seat) { st.x = seat.x; st.z = seat.z; }
      this.views.setPlayer(st, dt, seat, isMe);
    }

    for (const db of b.peds.values()) {
      const da = a.peds.get(db[0]) ?? db;
      this.views.setPed({
        id: db[0], x: lerp(da[1], db[1], t), z: lerp(da[2], db[2], t), a: lerpAngle(da[3], db[3], t),
        color: db[4], running: db[5] === 1 || db[5] >= 3, angry: db[5] === 2, cop: db[5] === 3, gang: db[5] === 4, h: lerp(da[6], db[6], t), ragdoll: db[7] === 1,
        arch: db[8] ?? -1, act: db[9] ?? 0, fear: db[10] ?? -1,
      }, dt);
    }

    // Quest-Objekte: Marker + Pakete (getragene Pakete schweben über dem Träger)
    const q = this.buffer.latest?.quest ?? null;
    if (q) {
      this.views.setQuestMarkers(q.phase === 'idle' ? q.start : null, q.phase === 'active' ? q.dest : null);
      this.views.setPackages(q.packages);
    } else {
      this.views.setQuestMarkers(null, null);
    }
    // Wiederverwendete Quaternionen verschwundener Fahrzeuge freigeben
    if (vehQuats.size > vehicleStates.size + 64) for (const id of vehQuats.keys()) if (!vehicleStates.has(id)) vehQuats.delete(id);
    return vehicleStates;
  }

  /** Beulen und Schadenszustand am Modell nachziehen. */
  private syncDamage(id: number, rec: VehRec, isNew: boolean, s: VehicleViewState) {
    if (isNew) { rec.applied = 0; rec.dmgKey = ''; }
    while (rec.applied < rec.dents.length) this.views.dent(id, rec.dents[rec.applied++]);
    const d = rec.dmg;
    const key = `${d.parts}:${d.glass}:${d.lights}:${d.wreck}`;
    if (key !== rec.dmgKey) {
      this.views.setDamage(id, d.parts, d.glass, d.lights, d.wreck, !isNew && rec.dmgKey !== '' && rec.liveParts, s.vx, s.vz);
      if (rec.dmgKey !== '' && d.glass && this.involvesMe(id, -9)) this.sfx.car?.crash(3, null, true, 0.6);
      rec.dmgKey = key;
      rec.liveParts = false;
    }
  }

  // ------------------------------------------------------------------ Effekte je Fahrzeug
  private vehicleFx(s: VehicleViewState, rec: VehRec, dt: number, own: boolean) {
    const view = this.views.vehicleView(s.id);
    if (!view) return;
    const water = isWaterVehicle(s.kind);
    const speed = Math.hypot(s.vx, s.vz);
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(s.q);
    if (water) {
      if (speed > 3 && Math.random() < speed / 25) {
        tmpV2.set((Math.random() - 0.5) * 2, 0, -2.2).applyQuaternion(s.q);
        this.fx.splash(s.x + tmpV2.x, -0.2, s.z + tmpV2.z, -fwd.x * 2, 1.5 + speed * 0.1, -fwd.z * 2, 1);
      }
      return;
    }
    const tpl = view.car?.tpl;
    if (!tpl) return;
    const ownCar = own ? this.predictor.sim?.car : null;
    const latV = Math.abs(s.vx * fwd.z - s.vz * fwd.x);
    const remoteSlip = !own && speed > 6 && (latV > 3.5 || (s.flags & VehFlag.HANDBRAKE) !== 0) ? latV : 0;
    for (let i = 0; i < 4; i++) {
      const w = tpl.wheels[i];
      if (w.w <= 0 && !tpl.bike) continue;
      const slip = ownCar ? ownCar.slip[i] : (i >= 2 ? remoteSlip : remoteSlip * 0.5);
      const surf = ownCar ? ownCar.surf[i] : this.map.tileAt(s.x, s.z);
      const key = s.id * 4 + i;
      if ((ownCar && surf === 255) || (tpl.bike && w.w <= 0)) { this.fx.skidEnd(key); continue; }
      const p = this.views.worldPoint(s.id, tmpV2.set(w.x, tpl.wheelBaseY - w.r * 0.9, w.z), tmpV3)!;
      const gy = groundHeight(this.map, p.x, p.z);
      const asphalt = surf === Tile.ROAD || surf === Tile.BRIDGE || surf === Tile.PLAZA || surf === Tile.SIDEWALK || surf === Tile.DOCK;
      const loose = surf === Tile.SAND || surf === Tile.DIRT || surf === Tile.DESERT || surf === Tile.BADLANDS;
      const burst = (rec.dmg.tires & (1 << i)) !== 0;
      if (slip > 2.5 || (burst && speed > 3)) {
        this.fx.skidmark(key, p.x, gy, p.z, w.w * 1.1, asphalt ? 0 : 1);
        if (asphalt) this.fx.tireSmoke(p.x, gy, p.z, Math.min(1, slip / 10) * (own ? 1 : 0.5), s.vx, s.vz);
      } else this.fx.skidEnd(key);
      if (burst && asphalt && speed > 3) this.fx.sparks(p.x, gy + 0.05, p.z, -s.vx * 0.3, -s.vz * 0.3, 1);
      if (loose && speed > 3) this.fx.dust(p.x, gy, p.z, Math.min(0.9, (speed / 20 + slip / 8) * (own ? 1 : 0.5)), surf === Tile.SAND || surf === Tile.DESERT ? 0xe9d6a3 : surf === Tile.BADLANDS ? 0xc77a52 : 0xa88b66, s.vx, s.vz);
      if ((surf === Tile.SWAMP || this.isWet(p.x, p.z)) && speed > 4 && Math.random() < speed / 30) this.fx.splash(p.x, gy + 0.1, p.z, s.vx * 0.2, 1.5, s.vz * 0.2, 1);
    }
    // Rauch/Feuer je Schadensstufe
    const stage = rec.dmg.wreck ? 2 : rec.dmg.burn > 0 ? 3 : smokeStage(rec.dmg.hp);
    if (stage > 0) {
      const ep = this.views.worldPoint(s.id, tpl.engine, tmpV2)!;
      this.fx.damageSmoke(ep.x, ep.y, ep.z, stage, s.vx, s.vz);
    }
    // Auspuff: Nitro (blau) und Fehlzündungen (eigenes Auto, Audio meldet das Knallen)
    const boost = (s.flags & VehFlag.BOOST) !== 0;
    if (boost || (own && this.backfired)) {
      for (const ex of tpl.exhaust) {
        const p = this.views.worldPoint(s.id, ex, tmpV3)!;
        this.fx.exhaustFlame(p.x, p.y, p.z, -fwd.x, -fwd.z, boost);
      }
    }
    void dt;
  }
  private backfired = false;

  private isWet(x: number, z: number) {
    for (const w of this.map.wet) if (x >= w[0] && x <= w[2] && z >= w[1] && z <= w[3]) return true;
    return false;
  }

  /** Motor, Reifen, Untergrund, Schaben, Nitro, Schaden, Gamepad-Vibration des eigenen Fahrzeugs */
  private ownCarAudio(dt: number) {
    const car = this.sfx.car;
    const sim = this.predictor.sim;
    this.backfired = false;
    if (!sim) { this.scrapeLevel = 0; car?.noOwnCar(); return; }
    const c = sim.car, p = sim.prof, d = sim.dmg;
    const water = isWaterVehicle(sim.kind);
    let slip = 0;
    for (let i = 0; i < 4; i++) slip = Math.max(slip, c.slip[i]);
    if (car) {
      let loose = 0;
      for (let i = 0; i < PART_COUNT; i++) if (partState(d, i) === 1) loose++;
      this.backfired = car.ownCar({
        cls: variantInfo(sim.variant).cls, rpm: c.rpm, idle: p.idleRpm, redline: p.redline,
        load: c.engLoad, thr: c.thr, brk: c.brk, shifts: c.shifts, boost: c.boost, speed: Math.hypot(c.vx, c.vz),
        slip: c.slip, surf: c.surf, comp: c.comp, air: c.air, water, wet: this.isWet(c.x, c.z), scrape: this.scrapeLevel,
        smoke: d.wreck ? 0 : smokeStage(d.hp), engineDmg: d.zones[Zone5.ENGINE], power: enginePower(d, c.t), loose,
        burning: d.burn > 0 && !d.wreck, wreck: d.wreck !== 0,
      }, dt);
    }
    // Gamepad: Rumpeln nach Schlupf
    if (slip > 3) this.input.rumble(Math.min(0.6, slip / 20), Math.min(0.8, slip / 12), 110);
    this.scrapeLevel = Math.max(0, this.scrapeLevel - dt * 30);
  }

  // ------------------------------------------------------------------ HUD
  private nearestEnterable(vehicles: Map<number, VehicleViewState>, x: number, z: number) {
    let best: VehicleViewState | null = null;
    let bestD = Infinity;
    for (const v of vehicles.values()) {
      if (v.driver >= 0 || this.recs.get(v.id)?.dmg.wreck) continue;
      const reach = ENTER_RADIUS + profileOf(v.variant).length / 2.4;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < reach && d < bestD) { best = v; bestD = d; }
    }
    return best;
  }

  /** Schritte des eigenen Spielers (Kenney Impact Sounds) – Takt aus der Laufgeschwindigkeit, Klang je Untergrund. */
  private stepX = 0; private stepZ = 0; private stepT = 0;
  private footsteps(x: number, z: number, dt: number) {
    const d = Math.hypot(x - this.stepX, z - this.stepZ);
    this.stepX = x; this.stepZ = z;
    if (this.predictor.inVehicle || dt <= 0 || d > 3) { this.stepT = 0; return; }
    const speed = d / dt;
    if (speed < 0.8) return;
    this.stepT += d;
    const stride = speed > 5 ? 1.5 : 1.1;
    if (this.stepT < stride) return;
    this.stepT = 0;
    const t = this.map.tileAt(x, z);
    const id = t === Tile.GRASS || t === Tile.SAND || t === Tile.SWAMP || t === Tile.FIELD || t === Tile.FARM || t === Tile.DIRT ? 'foot.grass'
      : t === Tile.DOCK || t === Tile.BRIDGE ? 'foot.wood' : 'foot.concrete';
    this.sfx.at(id, null, speed > 5 ? 0.55 : 0.4);
  }

  private updateHud(latest: SnapshotMsg | null, vehicles: Map<number, VehicleViewState>, me: ReturnType<Predictor['view']>) {
    this.hud.setZone(this.map.zoneAt(me.x, me.z), this.map.districtAt(me.x, me.z)?.name ?? null);
    this.hud.setClock(this.day);
    this.hud.setSpeed(null);
    const mine = latest?.players.find((p) => p[0] === this.myId);
    this.hud.setQuestState(this.questState);
    const sim = this.predictor.sim;
    this.tuning?.setClass(sim ? variantInfo(sim.variant).cls : null);
    if (sim) {
      const c = sim.car;
      this.drive.set({ speed: c.s, gear: c.gear, rpm: c.rpm, redline: sim.prof.redline, nitro: c.nitro, hasNitro: sim.prof.nitroForce > 0, hp: sim.dmg.hp, burning: sim.dmg.burn > 0 });
      const st = this.predictor.stunts;
      this.drive.drift(st.driftT > 0.3 ? st.driftPts : null, driftMultiplier(st));
    } else { this.drive.set(null); this.drive.drift(null, 1); }

    if (this.chat.isOpen) { this.hud.setHint(null); return; }
    if (this.predictor.inVehicle && sim) {
      const c = sim.car;
      const ws = this.map.workshops.find((w) => Math.hypot(w.x - c.x, w.z - c.z) < w.r);
      const mech = this.shopNearMe();
      if (c.flip >= ASSISTS.unflipDelay) this.hud.setHint('<b>E</b> Fahrzeug aufrichten');
      else if (c.flip > 0.5) this.hud.setHint(`Überschlagen … aufrichten in ${Math.ceil(ASSISTS.unflipDelay - c.flip)} s`);
      else if (ws && (sim.dmg.hp < 1000 || sim.dmg.parts)) this.hud.setHint('Werkstatt: kurz <b>anhalten</b> zum Reparieren');
      else if (sim.dmg.wreck) this.hud.setHint('Wrack! <b>E</b> Aussteigen');
      else if (mech) this.hud.setHint(`<b>F</b> Mit ${mech.keeper.name} sprechen (${mech.name}) · <b>E</b> Aussteigen`);
      else this.hud.setHint(`<b>E</b> Aussteigen · <b>Leertaste</b> Handbremse${sim.prof.nitroForce > 0 ? ' · <b>Shift</b> Nitro' : ''}`);
    } else {
      const v = this.nearestEnterable(vehicles, me.x, me.z);
      if (v) {
        const verb = v.driver === -2 ? 'Übernehmen' : 'Einsteigen';
        const name = v.kind === VehicleKind.Car || v.kind === VehicleKind.Bike ? variantInfo(v.variant).name : VEHICLE_DEFS[v.kind as VehicleKindId].name;
        const shop = this.shopNearMe();
        this.hud.setHint(`<b>E</b> ${verb} (${name})${shop ? ` · <b>F</b> Mit ${shop.keeper.name} sprechen` : ''}`);
      } else {
        const shop = this.shopNearMe();
        const ph = this.phoneNearMe();
        this.hud.setHint(shop ? `<b>F</b> Mit ${shop.keeper.name} sprechen (${shop.name})` : ph ? (ph.race ? '<b>F</b> Renntelefon (Straßenrennen)' : '<b>F</b> Missionstelefon') : null);
      }
    }
  }

  private drawMinimap(latest: SnapshotMsg, vehicles: Map<number, VehicleViewState>, me: ReturnType<Predictor['view']>) {
    const dots: MapDot[] = [];
    for (const w of this.map.workshops) dots.push({ x: w.x, z: w.z, color: '#2af0e6', size: 3, ring: true });
    for (const s of this.shops) dots.push({ x: s.x, z: s.z, color: s.type === 'ammo' ? '#ff6a6a' : s.type === 'paint' ? '#c98bff' : s.type === 'gas' ? '#ffb33a' : '#4fd16b', size: 2, ring: true });
    for (const ph of this.phones) dots.push({ x: ph.x, z: ph.z, color: ph.taxi ? '#3ad1ff' : ph.race ? '#ff8a3a' : '#ffe14d', size: ph.taxi ? 4 : 3, ring: true });
    for (const t of this.questState?.targets ?? []) dots.push({ x: t[0], z: t[1], color: t[3] === 5 ? '#ff3d5a' : t[3] === 2 ? '#ffd23a' : t[3] === 7 ? '#ffffff' : '#4dff9a', size: 4, ring: t[3] !== 5 });
    for (const c of this.copDots.values()) dots.push({ x: c[0], z: c[1], color: '#2a6bff', size: 3 });
    for (const v of vehicles.values()) {
      if (v.driver >= 0) continue;
      dots.push({ x: v.x, z: v.z, color: v.driver === -2 ? '#8a8aa0' : '#d0d0e0', size: 2 });
    }
    for (const p of latest.players) {
      if (p[0] === this.myId) continue;
      const pos = p[5] >= 0 ? vehicles.get(p[5]) ?? { x: p[2], z: p[3] } : { x: p[2], z: p[3] };
      dots.push({ x: pos.x, z: pos.z, color: playerDotColor(p[6]), size: 4 });
    }
    const q = latest.quest;
    if (q) {
      if (q.phase === 'idle') dots.push({ x: q.start[0], z: q.start[1], color: '#ffe14d', size: 5, ring: true });
      if (q.phase === 'active') {
        dots.push({ x: q.dest[0], z: q.dest[1], color: '#4dff9a', size: 5, ring: true });
        for (const pk of q.packages) {
          if (pk[3] < 0) dots.push({ x: pk[1], z: pk[2], color: '#ffa23a', size: 4, ring: true });
        }
      }
    }
    this.minimap.draw(me.x, me.z, me.a, this.predictor.inVehicle, dots);
  }

  // ------------------------------------------------------------------ Debug: Fahrzeug-Tab
  private vehicleDebug() {
    const on = this.debug.vehicleTab && !!this.predictor.sim;
    for (const a of this.arrows) a.visible = false;
    if (!on) return;
    const sim = this.predictor.sim!;
    const c: CarState = sim.car, p: HandlingProfile = sim.prof;
    const view = this.views.vehicleView(this.predictor.vehicleId);
    const tpl = view?.car?.tpl;
    const names = ['VL', 'VR', 'HL', 'HR'];
    const surfName = (t: number) => t === 255 ? 'Luft' : (Object.entries(Tile).find(([, v]) => v === t)?.[0] ?? '?');
    let text = `${p.name}  ${(c.s * 3.6).toFixed(0)} km/h  Gang ${c.gear < 0 ? 'R' : c.gear}  ${c.rpm.toFixed(0)} U/min${c.shift > 0 ? ' (schaltet)' : ''}\n`;
    text += `Gas ${c.thr.toFixed(2)}  Bremse ${c.brk.toFixed(2)}  HB ${c.hb ? 'an' : 'aus'}  Lenkung ${(c.steer * 57.3).toFixed(1)}°  Luft ${c.air.toFixed(2)} s\n`;
    text += `Nitro ${(c.nitro * 100).toFixed(0)} %  HP ${sim.dmg.hp.toFixed(0)}  Zonen ${sim.dmg.zones.map((z) => z.toFixed(2)).join('/')}\n\n`;
    text += 'Rad  Feder(m)  Last(kN)  Schlupf(m/s)  α(°)   Fx(kN)  Fy(kN)  Grund\n';
    for (let i = 0; i < 4; i++) {
      text += `${names[i]}   ${c.comp[i].toFixed(3).padStart(6)}   ${(c.load[i] / 1000).toFixed(1).padStart(6)}   ${c.slip[i].toFixed(1).padStart(8)}   ${c.dbg[i * 6 + 5].toFixed(1).padStart(6)}  ${(c.dbg[i * 6 + 3] / 1000).toFixed(2).padStart(6)}  ${(c.dbg[i * 6 + 4] / 1000).toFixed(2).padStart(6)}  ${surfName(c.surf[i])}\n`;
    }
    text += `\nPfeile: pink = Reifenkraft, cyan = Federkraft, gelb = Geschwindigkeit · Tab = Karte`;
    this.debug.setVehicleText(text);
    if (!tpl || !view) return;
    view.root.updateMatrixWorld();
    for (let i = 0; i < 4; i++) {
      const w = tpl.wheels[i];
      const base = tmpV.set(w.x, tpl.wheelBaseY + c.comp[i] - p.wheelRadius, w.z).applyMatrix4(view.root.matrixWorld);
      const fx = c.dbg[i * 6], fz = c.dbg[i * 6 + 2];
      const fl = Math.hypot(fx, fz);
      if (fl > 50) {
        const a = this.arrows[i];
        a.position.copy(base); a.setDirection(tmpV2.set(fx / fl, 0, fz / fl)); a.setLength(Math.min(6, fl / 1500), 0.4, 0.25); a.visible = true;
      }
      const fs = c.dbg[i * 6 + 1];
      if (fs > 50) {
        const a = this.arrows[4 + i];
        a.position.copy(base); a.setDirection(tmpV2.set(0, 1, 0).applyQuaternion(view.root.quaternion)); a.setLength(Math.min(5, fs / 3000), 0.3, 0.2); a.visible = true;
      }
    }
    const sp = Math.hypot(c.vx, c.vy, c.vz);
    if (sp > 0.5) {
      const a = this.arrows[8];
      a.position.copy(view.root.position).add(tmpV.set(0, 1.5, 0));
      a.setDirection(tmpV2.set(c.vx / sp, c.vy / sp, c.vz / sp)); a.setLength(Math.min(12, sp * 0.3), 0.6, 0.35); a.visible = true;
    }
    void tmpQ;
  }
}

// ------------------------------------------------------------------ Einstellungen speichern
const GFX_KEY = 'sunstate.gfx';
function loadGfx(): GfxSettings {
  const def: GfxSettings = { retro: false, shadows: true, outlines: true, bloom: true };
  try {
    Object.assign(def, JSON.parse(localStorage.getItem(GFX_KEY) ?? '{}'));
  } catch { /* egal */ }
  const q = new URLSearchParams(location.search);
  if (q.has('retro')) def.retro = q.get('retro') !== '0';
  return def;
}
function saveGfx(g: GfxSettings) {
  try { localStorage.setItem(GFX_KEY, JSON.stringify(g)); } catch { /* egal */ }
}
