// Verwaltet die 3D-Objekte aller dynamischen Entitäten. Pro Frame bekommt sie die
// interpolierten Zustände und legt Meshes an, bewegt sie oder entfernt sie.
//
// Fahrzeuge: prozedurale Modelle (CarModel) mit voller Orientierung (Wanken, Nicken),
// Rädern als ein gemeinsames InstancedMesh (Einfedern, Lenkeinschlag, Drehung), Licht-
// und Schadenszustand. Fremde Fahrzeuge bekommen die Einfederung per Strahl gegen den Boden.
import * as THREE from 'three';
import { OUTFIT_COLORS } from '../../../shared/src/constants';
import { groundHeight } from '../../../shared/src/sim/car';
import { derive, type HandlingProfile } from '../../../shared/src/sim/handling';
import { profileOf } from '../../../shared/src/sim/vehicle';
import { VehicleKind, isWaterVehicle } from '../../../shared/src/sim/vehicleDefs';
import { Tile, WATER_LEVEL } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { createQuaterniusCharacter, styleForMood } from '../render/characters';
import { CarModel, type DebrisSpawn } from '../render/CarModel';
import { box, merge, cyl } from '../render/geom';
import { standaloneTexture } from '../render/materials/atlas';
import { addOutline, LINE } from '../render/materials/toon';
import { CharacterModel, fanGeometry, lightsMat, toonVC, vehicleGeometry, vehicleMat } from '../render/models';
import { moodFor } from '../render/palette';
import { createWeaponMesh } from '../render/weaponModels';
import { createKenneyCharacter, type KenneyCharacter } from '../render/kenneyCharacters';
import type { RagdollFrame } from '../render/ragdoll';
import { archetypeOf } from '../../../shared/src/npc/archetypes';
import { Act } from '../../../shared/src/npc/scenarios';
import { BARK_DURATION, barkText } from '../../../shared/src/npc/barks';
import { wrapAngle } from '../../../shared/src/math';

export interface PlayerState { id: number; name: string; x: number; z: number; a: number; veh: number; color: number; carrying: boolean; h: number; ragdoll: boolean; weapon: number }
export interface VehicleViewState {
  id: number; kind: number; variant: number; color: number; driver: number;
  x: number; y: number; z: number; q: THREE.Quaternion;
  vx: number; vz: number; steer: number; flags: number;
  /** Eigenes Fahrzeug: Einfederung und Raddrehung aus der Physik */
  comp?: number[]; spin?: number[];
  /** Bits geplatzter Reifen (Rad läuft auf der Felge) */
  tires?: number;
}
export interface PedState { id: number; x: number; z: number; a: number; color: number; running: boolean; h: number; ragdoll: boolean; angry: boolean; cop: boolean; gang: boolean;
  /** Archetyp-Index (-1 = klassischer Passant) und Animations-ID (Act) vom Server */
  arch?: number; act?: number;
  /** Spieler, den der NPC nach einem Vorfall ängstlich beobachtet (-1 = keiner) */
  fear?: number }

/** Gemeinsame Schnittstelle: Quaternius-Figur (animiert) oder prozeduraler Ersatz. */
interface Figure {
  root: THREE.Group; animate(speed: number, dt: number, seated?: boolean, dist?: number): void; dispose(): void;
  /** Ragdoll-Glieder (nur Kenney-Figuren); vor animate() */
  ragdoll?(f: RagdollFrame | null): void;
}
/**
 * Ragdoll-Darstellung einer Figur (lokal): Ausrichtung des ganzen Körpers (Überschlag in Flugrichtung,
 * auf Rücken/Bauch einpendeln, wieder aufrichten) + Zustand für die Glieder.
 */
interface RagState {
  q: THREE.Quaternion;
  /** Drehachse (waagerecht) und -rate des Überschlags */
  axis: THREE.Vector3; rate: number; twist: number;
  /** geglättete waagerechte Geschwindigkeit (aus den Positionen) */
  vx: number; vz: number;
  lastH: number; vy: number; air: boolean;
  /** Kopfrichtung am Boden (waagerecht) und Lage (1 Rücken, -1 Bauch) */
  head: THREE.Vector3; side: number;
  /** Aufstehen: Fortschritt 0..1 (-1 = noch nicht) und Startlage */
  getup: number; from: THREE.Quaternion; fromY: number;
  frame: RagdollFrame;
}
interface CharView {
  model: Figure; lastX: number; lastZ: number; label?: THREE.Sprite; bubble?: THREE.Sprite; seen: boolean;
  /** Ragdoll-Zustand (null = steht normal) */
  rag: RagState | null;
  /** Bezugspunkt für Namen, Sprechblasen, Leine: Fußpunkt bzw. Sitzposition (unabhängig vom Überschlag) */
  anchor: THREE.Vector3;
  /** Gehaltene Waffe (Index in WEAPONS, -1 = keine), Schwung-/Rückstoß-Zeit in Sekunden */
  held: THREE.Mesh | null; heldIdx: number; swing: number; kick: number;
  /** Hund an der Leine (Hundebesitzer): Mesh + Leine */
  dog?: THREE.Mesh; leash?: THREE.Line; dogX?: number; dogZ?: number; dogA?: number;
  arch: number;
}
/** Abstand, der für Figuren außerhalb des Bildes an die Animation gemeldet wird (seltene Updates, keine Details). */
const OFFSCREEN_DIST = 1000;
const smoothstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerpAngleRad = (from: number, to: number, t: number) => from + wrapAngle(to - from) * t;
/** Comic-Sprechblase (Bark) über einem NPC. */
interface Bubble { sprite: THREE.Sprite; t: number; w: number; h: number }
/** Höchstens so viele Sprechblasen gleichzeitig sichtbar (die nächsten zur Kamera). */
const MAX_BUBBLES = 4;
const SWING_TIME = 0.28, KICK_TIME = 0.12;
/** Ragdoll: Höhe des Körperschwerpunkts über den Füßen (aufrecht) bzw. liegend, Dauer des Aufstehens */
const RAG_CENTER = 1.12, RAG_LIE = 0.24, GETUP_TIME = 0.95;
interface VehView {
  root: THREE.Group; car: CarModel | null; legacy: THREE.Mesh | null; lights?: THREE.Mesh; fan?: THREE.Mesh;
  kind: number; variant: number; color: number; seen: boolean;
  comp: number[]; spin: number[]; lastVx: number; lastVz: number; lat: number; lean: number; yawRate: number; lastA: number;
  prof: HandlingProfile; mountY: number; rest: number;
}

const MAX_SHADOWS = 160, MAX_WHEELS = 480;
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, 1), XAX = new THREE.Vector3(1, 0, 0);
const tmpPos = new THREE.Vector3(), tmpScale = new THREE.Vector3(), tmpV = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpMat = new THREE.Matrix4();
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpSphere = new THREE.Sphere();
const SWEAR = ['#@!%&!', '$%#@!!', '&*!#?!', '@#$%!!', '!!#*&%'];

/** Sprechblase im DS-Stil: weiße Blase, dicke dunkle Kontur, harter Schatten, Zipfel nach unten. */
function makeBarkBubble(text: string): { sprite: THREE.Sprite; w: number; h: number } {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = 'bold 30px Trebuchet MS, sans-serif';
  ctx.font = font;
  // Umbrechen auf max. 3 Zeilen à ~300 px
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width > 300 && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const W = Math.ceil(tw + 52), lh = 34, H = lines.length * lh + 30 + 24;
  c.width = W + 8; c.height = H + 8;
  const g = c.getContext('2d')!;
  const bubble = (ox: number, oy: number) => {
    g.beginPath();
    g.roundRect(4 + ox, 4 + oy, W - 6, H - 30, 16);
    g.moveTo(W * 0.32 + ox, H - 28 + oy); g.lineTo(W * 0.26 + ox, H - 2 + oy); g.lineTo(W * 0.46 + ox, H - 28 + oy);
  };
  g.fillStyle = 'rgba(26,16,48,0.85)'; bubble(5, 5); g.fill(); // harter Schatten
  g.fillStyle = '#fffdf4'; g.strokeStyle = '#1a1030'; g.lineWidth = 5; g.lineJoin = 'round';
  bubble(0, 0); g.fill(); g.stroke();
  // Naht am Zipfel überdecken
  g.fillStyle = '#fffdf4'; g.fillRect(W * 0.32 - 2, H - 31, W * 0.14 + 2, 6);
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1a1030';
  lines.forEach((l, i) => g.fillText(l, (W + 2) / 2, 4 + 16 + lh / 2 + i * lh - 2));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  // Farbe < Bloom-Schwelle (PostFX 0.92), sonst überstrahlt die weiße Blase nachts den Text
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, transparent: true, color: 0xd8d8d8, toneMapped: false }));
  sprite.renderOrder = 11;
  sprite.center.set(0.3, 0); // Zipfel sitzt über dem Kopf
  const k = 1 / 100; // 100 px = 1 m
  return { sprite, w: c.width * k, h: c.height * k };
}

function makeLabel(text: string, color: number, bubble = false): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  if (bubble) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#1a1030';
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.roundRect(20, 6, 216, 44, 14); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(110, 48); ctx.lineTo(128, 62); ctx.lineTo(140, 48); ctx.fill();
  }
  ctx.font = 'bold 30px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(20,10,46,0.9)';
  if (!bubble) ctx.strokeText(text, 128, 32);
  ctx.fillStyle = bubble ? '#e0203a' : '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(text, 128, bubble ? 28 : 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  sprite.scale.set(7, 1.75, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** Rad: Reifen + Felge, Achse entlang x, Radius 1, Breite 1 */
function wheelGeometry() {
  const tire = cyl(1, 1, 1, 12, 0, -0.5, 0, 0x1e1e24);
  const rim = cyl(0.62, 0.62, 1.04, 8, 0, -0.52, 0, 0xc9ccd6);
  const hub = cyl(0.25, 0.25, 1.08, 6, 0, -0.54, 0, 0x55555f);
  const g = merge([tire, rim, hub]);
  g.rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export interface VehicleHooks {
  /** Teil abgefallen -> Trümmer */
  debris(d: DebrisSpawn, vx: number, vz: number): void;
}

export class EntityViews {
  readonly group = new THREE.Group();
  private players = new Map<number, CharView>();
  private peds = new Map<number, CharView>();
  private bubbles = new Map<number, Bubble>();
  /** Eigener Spieler (für Blickkontakt): Position, Tempo, zu Fuß? */
  local = { id: -1, x: 0, z: 0, speed: 0, onFoot: true };
  private vehicles = new Map<number, VehView>();
  private packages = new Map<number, THREE.Mesh>();
  private sirens = new Map<number, THREE.Group>();
  private shadows: THREE.InstancedMesh;
  private shadowCount = 0;
  private wheels: THREE.InstancedMesh;
  private wheelCount = 0;
  private wheelHull: THREE.InstancedMesh;
  private startMarker: THREE.Group;
  private destMarker: THREE.Group;
  private packageGeo = new THREE.BoxGeometry(1, 1, 1);
  private packageMat = new THREE.MeshLambertMaterial({ color: 0xc98a4a, emissive: 0x3a1a00 });
  private clock = 0;
  private lastDt = 0.016;
  private foam: THREE.InstancedMesh;
  private foamCount = 0;
  /** Kamera-Fokus für Animations-LOD. */
  private focus = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private frustumValid = false;
  /** Nachtwert für Scheinwerfer */
  night = 0;
  hooks: VehicleHooks = { debris: () => {} };

  constructor(private map: WorldMap) {
    // Weiche "Blob"-Schatten wie in alten Handheld-Spielen (gerasterter Rand) – alle in einem Draw-Call
    const shadowGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x1e1230, map: standaloneTexture('blob_shadow'), alphaTest: 0.5, // opak + gerastert (DS-Look)
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, MAX_SHADOWS);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 2;
    this.group.add(this.shadows);
    // Räder aller Fahrzeuge: ein Draw-Call (+ Umrisslinie)
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), toonVC, MAX_WHEELS);
    this.wheels.frustumCulled = false;
    this.wheels.castShadow = true;
    this.wheelHull = addOutline(this.wheels, LINE.vehicle) as THREE.InstancedMesh;
    this.group.add(this.wheels);
    // Schaum um fahrende Boote
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xf7f7f0, map: standaloneTexture('lamp_pool'), transparent: true, opacity: 0.8, depthWrite: false });
    this.foam = new THREE.InstancedMesh(shadowGeo, foamMat, 32);
    this.foam.frustumCulled = false;
    this.foam.renderOrder = 2;
    this.group.add(this.foam);

    this.startMarker = this.makeMarker(0xffe14d);
    this.destMarker = this.makeMarker(0x4dff9a);
    this.group.add(this.startMarker, this.destMarker);
  }

  private makeMarker(color: number): THREE.Group {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(4.5, 4.5, 2.5, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }),
    );
    ring.position.y = 1.25;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 4), new THREE.MeshBasicMaterial({ color, fog: false }));
    arrow.rotation.x = Math.PI;
    arrow.position.y = 7;
    arrow.name = 'arrow';
    g.add(ring, arrow);
    g.visible = false;
    return g;
  }

  private groundY(x: number, z: number) { return this.map.surfaceY(x, z); }

  private addShadow(x: number, y: number, z: number, r: number, a = 0, sz = 1) {
    if (this.shadowCount >= MAX_SHADOWS) return;
    tmpPos.set(x, y + 0.3, z); // über Rasen-/Parkflächen (liegen bis 0,25 m über dem Gelände)
    tmpQuat.setFromAxisAngle(UP, a);
    tmpScale.set(r, 1, r * sz);
    this.shadows.setMatrixAt(this.shadowCount++, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
  }

  setFocus(p: THREE.Vector3) { this.focus.copy(p); }

  beginFrame(dt: number) {
    this.clock += dt;
    this.lastDt = dt;
    this.shadowCount = 0;
    this.foamCount = 0;
    this.wheelCount = 0;
    for (const v of this.players.values()) v.seen = false;
    for (const v of this.peds.values()) v.seen = false;
    for (const v of this.vehicles.values()) v.seen = false;
  }

  // ------------------------------------------------------------------ Fahrzeuge
  vehicleView(id: number) { return this.vehicles.get(id); }

  private createVehicle(s: VehicleViewState): VehView {
    const root = new THREE.Group();
    const prof = profileOf(s.variant);
    const d = derive(prof);
    const v: VehView = {
      root, car: null, legacy: null, kind: s.kind, variant: s.variant, color: s.color, seen: true,
      comp: [d.rest * 0.5, d.rest * 0.5, d.rest * 0.5, d.rest * 0.5], spin: [0, 0, 0, 0], lastVx: s.vx, lastVz: s.vz, lat: 0, lean: 0, yawRate: 0, lastA: 0,
      prof, mountY: d.mountY, rest: d.rest,
    };
    if (isWaterVehicle(s.kind)) {
      const geo = vehicleGeometry(s.kind, s.color, s.id);
      const body = new THREE.Mesh(geo.body, vehicleMat);
      body.position.y = -prof.cgHeight + 0.15;
      root.add(body);
      addOutline(body, LINE.vehicle);
      const lights = new THREE.Mesh(geo.lights, lightsMat);
      lights.position.copy(body.position);
      root.add(lights);
      v.legacy = body; v.lights = lights;
      if (geo.fanZ !== undefined) {
        v.fan = new THREE.Mesh(fanGeometry(), toonVC);
        v.fan.position.set(0, 1.72 + body.position.y, geo.fanZ);
        root.add(v.fan);
      }
    } else {
      v.car = new CarModel(s.variant, s.color, vehicleMat, lightsMat);
      v.car.body.castShadow = true;
      addOutline(v.car.body, LINE.vehicle);
      root.add(v.car.root);
    }
    this.vehicles.set(s.id, v);
    this.group.add(root);
    return v;
  }

  setVehicle(s: VehicleViewState, dt: number) {
    let v = this.vehicles.get(s.id);
    if (v && (v.kind !== s.kind || v.color !== s.color || v.variant !== s.variant)) { this.removeVehicle(s.id); v = undefined; }
    v ??= this.createVehicle(s);
    v.seen = true;
    const root = v.root;
    const water = isWaterVehicle(s.kind);
    if (water) {
      const tile = this.map.tileAt(s.x, s.z);
      const onWater = tile === Tile.WATER || tile === Tile.SWAMP || tile === Tile.BRIDGE;
      const y = onWater ? WATER_LEVEL + 0.15 + Math.sin(this.clock * 2 + s.id) * 0.08 : Math.max(0, this.map.terrainHeight(s.x, s.z));
      root.position.set(s.x, y + v.prof.cgHeight - 0.15, s.z);
      root.quaternion.copy(s.q);
      const speed = Math.hypot(s.vx, s.vz);
      if (s.kind === VehicleKind.Boat) root.rotateX(-Math.min(speed / 60, 0.12));
      if (v.fan) v.fan.rotation.z += dt * (6 + speed * 2);
      v.lights!.visible = this.night > 0.3;
      if (onWater && this.foamCount < 32) {
        const a = Math.atan2(2 * (s.q.w * s.q.y + s.q.x * s.q.z), 1 - 2 * (s.q.y * s.q.y + s.q.x * s.q.x));
        const k = 1.6 + Math.min(speed, 20) * 0.08;
        tmpPos.set(s.x - Math.sin(a) * 0.8, WATER_LEVEL + 0.04, s.z - Math.cos(a) * 0.8);
        tmpQuat.setFromAxisAngle(UP, a);
        tmpScale.set(k, 1, k * (1.6 + Math.min(speed, 20) * 0.05));
        this.foam.setMatrixAt(this.foamCount++, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
      } else if (!onWater) this.addShadow(s.x, y, s.z, 1.75, 0, 1.6);
      return;
    }

    this.updateSiren(s, v);
    // ---- Landfahrzeug
    const car = v.car!;
    const tpl = car.tpl;
    root.position.set(s.x, s.y, s.z);
    root.quaternion.copy(s.q);
    // Querbeschleunigung (für wackelnde Teile und die Motorrad-Schräglage)
    const fwd = tmpV.set(0, 0, 1).applyQuaternion(s.q);
    const a = Math.atan2(fwd.x, fwd.z);
    if (dt > 0) {
      let da = a - v.lastA; if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
      v.yawRate += (da / dt - v.yawRate) * Math.min(1, dt * 8);
      const ax = (s.vx - v.lastVx) / dt, az = (s.vz - v.lastVz) / dt;
      v.lat += ((ax * fwd.z - az * fwd.x) - v.lat) * Math.min(1, dt * 6);
    }
    v.lastA = a; v.lastVx = s.vx; v.lastVz = s.vz;
    const speed = Math.hypot(s.vx, s.vz);
    if (tpl.bike) {
      // in die Kurve legen (rein optisch, die Physik hält das Motorrad aufrecht)
      const want = Math.max(-0.75, Math.min(0.75, Math.atan((speed * v.yawRate) / 13.7)));
      v.lean += (want - v.lean) * Math.min(1, dt * 6);
      root.quaternion.multiply(tmpQ2.setFromAxisAngle(FWD, -v.lean));
    }
    root.updateMatrixWorld();
    car.update(dt, speed, v.lat, this.night > 0.3, (s.flags & 1) !== 0, (s.flags & 2) !== 0);

    // Räder
    const r = v.prof.wheelRadius, rayLen = v.rest + r;
    for (let i = 0; i < 4; i++) {
      const w = tpl.wheels[i];
      if (w.w <= 0) continue; // Motorrad: nur 2 sichtbare Räder
      let comp: number;
      if (s.comp) comp = s.comp[i];
      else {
        // Strahl: Aufhängungspunkt (Welt) senkrecht zum Boden
        tmpPos.set(v.prof.upright ? 0 : w.x, v.mountY, w.z).applyMatrix4(root.matrixWorld);
        const t = tmpPos.y - groundHeight(this.map, tmpPos.x, tmpPos.z);
        const target = Math.max(0, Math.min(v.rest + 0.1, rayLen - t));
        v.comp[i] += (target - v.comp[i]) * Math.min(1, dt * 18);
        comp = v.comp[i];
      }
      if (s.spin) v.spin[i] = s.spin[i];
      else v.spin[i] = (v.spin[i] + (speed * (s.flags & 2 ? -1 : 1)) / r * dt) % (Math.PI * 2);
      if (this.wheelCount >= MAX_WHEELS) continue;
      const steer = i < 2 ? s.steer : 0;
      const flat = s.tires && s.tires & (1 << i) ? 0.72 : 1;
      tmpPos.set(w.x, tpl.wheelBaseY + comp - r * (1 - flat), w.z).applyMatrix4(root.matrixWorld);
      tmpQuat.copy(root.quaternion).multiply(tmpQ2.setFromAxisAngle(UP, steer)).multiply(tmpQ2.setFromAxisAngle(XAX, v.spin[i]));
      tmpScale.set(w.w, r * flat, r * flat);
      this.wheels.setMatrixAt(this.wheelCount++, tmpMat.compose(tmpPos, tmpQuat, tmpScale));
    }
    const len = v.prof.length;
    this.addShadow(s.x, groundHeight(this.map, s.x, s.z) - 0.25, s.z, v.prof.width * 0.62, a, len / v.prof.width * 0.9);
  }

  /** Polizeiwagen (Fahrer-ID -3): Lichtbalken mit rot/blauem Wechselblinken. */
  private updateSiren(s: VehicleViewState, v: VehView) {
    let g = this.sirens.get(s.id);
    if (s.driver !== -3) { if (g) { v.root.remove(g); this.sirens.delete(s.id); } return; }
    if (!g) {
      g = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2030, fog: false }));
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2a6bff, fog: false }));
      red.position.x = -0.32; blue.position.x = 0.32;
      red.name = 'red'; blue.name = 'blue';
      g.add(red, blue);
      g.position.set(0, 1.5 - v.prof.cgHeight, 0);
      v.root.add(g);
      this.sirens.set(s.id, g);
    }
    const phase = Math.floor(this.clock * 6) % 2 === 0;
    g.getObjectByName('red')!.visible = phase;
    g.getObjectByName('blue')!.visible = !phase;
  }

  /** Schadenszustand eines Fahrzeugs übernehmen (Teile, Scheiben, Lichter, Wrack). */
  setDamage(id: number, parts: number, glass: number, lights: number, wreck: number, live: boolean, vx: number, vz: number) {
    const v = this.vehicles.get(id);
    if (!v?.car) return;
    v.root.updateMatrixWorld();
    for (const d of v.car.setDamage(parts, glass, lights, wreck, live)) this.hooks.debris(d, vx, vz);
  }

  dent(id: number, d: number[]) { this.vehicles.get(id)?.car?.applyDent(d); }
  repair(id: number) { this.vehicles.get(id)?.car?.resetDamage(); }
  hasVehicle(id: number) { return this.vehicles.has(id); }

  /** Weltpunkt eines lokalen Fahrzeugpunkts (für Rauch, Auspuff …) */
  worldPoint(id: number, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 | null {
    const v = this.vehicles.get(id);
    if (!v) return null;
    return out.copy(local).applyMatrix4(v.root.matrixWorld);
  }

  private removeVehicle(id: number) {
    const v = this.vehicles.get(id);
    if (!v) return;
    this.group.remove(v.root);
    v.car?.dispose();
    this.sirens.delete(id);
    this.vehicles.delete(id);
  }

  /** Figur im Stil der Gegend (Quaternius) oder prozeduraler Ersatz. */
  private createFigure(id: number, outfit: number, x: number, z: number, player: boolean, role = 0, arch = -1): Figure {
    const cop = role === 1, gang = role === 2;
    const district = this.map.districtAt(x, z);
    const mood = moodFor(this.map.zoneAt(x, z), district?.style ?? null);
    const style = cop ? 'business' : player ? 'casual' : styleForMood(mood, ((id * 2654435761) >>> 0) / 4294967296);
    const shirt = cop ? 0x2850c8 : player || gang ? OUTFIT_COLORS[outfit % OUTFIT_COLORS.length] : undefined;
    // Kenney Animated Characters (bevorzugt), sonst Quaternius-Packs, sonst prozedural
    if (arch >= 0 && !cop && !gang && !player) {
      // Archetyp-Outfit: Skin-Set und Oberteilfarbe aus der Archetyp-Tabelle
      const def = archetypeOf(arch);
      const ak = createKenneyCharacter(style, id, def.shirts ? OUTFIT_COLORS[outfit % OUTFIT_COLORS.length] : undefined, def.skins);
      if (ak) return ak;
    }
    const k = createKenneyCharacter(cop ? 'cop' : gang ? 'gang' : player ? 'player' : style, id, cop ? undefined : shirt);
    if (k) return k;
    const q = createQuaterniusCharacter(style, id, shirt);
    return q ?? new CharacterModel(cop ? 6 : outfit);
  }

  // ------------------------------------------------------------------ Figuren
  private updateChar(map: Map<number, CharView>, id: number, outfit: number, x: number, z: number, a: number, dt: number, seatedOn: VehicleViewState | null, h = 0, ragdoll = false, weapon = -1, role = 0, arch = -1, act = 0) {
    let c = map.get(id);
    if (!c) {
      c = { model: this.createFigure(id, outfit, x, z, map === this.players, role, arch), lastX: x, lastZ: z, seen: true, rag: null, anchor: new THREE.Vector3(x, 0, z), held: null, heldIdx: -1, swing: 0, kick: 0, arch };
      map.set(id, c);
      this.group.add(c.model.root);
    }
    c.seen = true;
    (c.model as Partial<KenneyCharacter>).setAct?.(ragdoll ? 0 : act, (id % 97) / 97);
    const mvx = dt > 0 ? (x - c.lastX) / dt : 0, mvz = dt > 0 ? (z - c.lastZ) / dt : 0;
    const speed = Math.hypot(mvx, mvz);
    c.lastX = x; c.lastZ = z;
    const root = c.model.root;
    let dist = Math.hypot(x - this.focus.x, z - this.focus.z);
    if (seatedOn) {
      const veh = this.vehicles.get(seatedOn.id);
      const tpl = veh?.car?.tpl;
      const seatY = tpl ? tpl.seatY : vehicleGeometry(seatedOn.kind, seatedOn.color, seatedOn.id).seatY;
      root.visible = seatY > 0; // Im Auto sieht man den Fahrer nicht
      if (veh && root.visible) {
        const back = seatedOn.kind === VehicleKind.Airboat ? -0.6 : seatedOn.kind === VehicleKind.Boat ? -0.8 : -0.3;
        tmpPos.set(0, tpl ? -veh.prof.cgHeight + seatY - 0.35 : seatY - veh.prof.cgHeight + 0.15, back).applyMatrix4(veh.root.matrixWorld);
        root.position.copy(tmpPos);
        root.quaternion.copy(veh.root.quaternion);
      }
      c.anchor.copy(root.visible ? root.position : tmpPos.set(x, this.groundY(x, z), z));
      c.rag = null;
      c.model.ragdoll?.(null);
      if (!this.showIfOnScreen(c)) dist = OFFSCREEN_DIST;
      c.model.animate(0, dt, true, dist);
    } else {
      root.visible = true;
      const gy = this.groundY(x, z);
      c.anchor.set(x, gy + h, z);
      // Außerhalb des Bildes: Animation nur selten weiterrechnen (wie weit entfernte Figuren)
      if (!this.showIfOnScreen(c)) dist = OFFSCREEN_DIST;
      if (ragdoll || c.rag) {
        const f = this.updateRagdoll(c, ragdoll, x, gy, z, h, a, mvx, mvz, dt);
        c.model.ragdoll?.(f);
        c.model.animate(0, dt, false, dist);
      } else {
        root.position.set(x, gy + h, z);
        root.quaternion.setFromAxisAngle(UP, a);
        c.model.ragdoll?.(null);
        c.model.animate(Math.min(speed, 12), dt, false, dist);
      }
      this.addShadow(x, gy, z, 1.05);
    }
    this.updateHeld(c, weapon, dt, !seatedOn && !ragdoll && !c.rag);
    return c;
  }

  /**
   * Figur außerhalb des Sichtfelds (letztes Bild, großzügiger Rand) ausblenden und aus dem Matrix-Update
   * jedes Bildes nehmen (~70 Knochen je Figur). Figuren werfen keine Schatten (Blob-Schatten separat),
   * daher ändert sich am Bild nichts. Rückgabe: sichtbar?
   */
  private showIfOnScreen(c: CharView) {
    const p = c.anchor, root = c.model.root;
    let on = true;
    if (this.frustumValid) {
      // Mittelpunkt 1 m über dem Fußpunkt; Radius deckt auch liegende/fliegende Figuren ab (bis ~2,3 m)
      tmpSphere.center.set(p.x, p.y + 1, p.z);
      tmpSphere.radius = 3.2;
      on = this.frustum.intersectsSphere(tmpSphere);
    }
    if (!on) root.visible = false;
    root.matrixWorldAutoUpdate = on;
    return on;
  }

  /** Sichtfeld der Kamera (nach dem Kamera-Update aufrufen; gilt für das nächste Bild). */
  setCamera(cam: THREE.Camera) {
    cam.updateMatrixWorld();
    tmpMat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(tmpMat);
    this.frustumValid = true;
  }

  /**
   * Ragdoll-Körper: im Flug Überschlag um die Achse quer zur Flugrichtung (Tempo aus den Positionen),
   * am Boden auf Rücken- oder Bauchlage einpendeln, danach aufrichten (Drehpunkt = Körpermitte, damit die
   * Figur nicht um die Füße kreiselt). Liefert den Zustand für die Glieder.
   */
  private updateRagdoll(c: CharView, ragdoll: boolean, x: number, gy: number, z: number, h: number, a: number, mvx: number, mvz: number, dt: number): RagdollFrame | null {
    const root = c.model.root;
    let r = c.rag;
    if (!r) {
      r = c.rag = {
        q: new THREE.Quaternion().setFromAxisAngle(UP, a), axis: new THREE.Vector3(1, 0, 0), rate: 0,
        twist: ((c.lastX * 7.31 + c.lastZ * 3.17) % 1 + 1) % 1 - 0.5,
        vx: mvx, vz: mvz, lastH: h, vy: 0, air: h > 0.05,
        head: new THREE.Vector3(), side: 1, getup: -1, from: new THREE.Quaternion(), fromY: 0,
        frame: { air: 1, side: 1, getup: 0, impact: 0, spin: 0 },
      };
    }
    const f = r.frame;
    f.impact = 0;
    if (dt <= 0) return f;
    // Geschwindigkeit glätten (Interpolation liefert leicht ruckelige Positionen)
    const k = Math.min(1, dt * 10);
    r.vx += (Math.max(-40, Math.min(40, mvx)) - r.vx) * k;
    r.vz += (Math.max(-40, Math.min(40, mvz)) - r.vz) * k;
    const vy = (h - r.lastH) / dt;
    r.lastH = h;
    const hs = Math.hypot(r.vx, r.vz);

    if (ragdoll) {
      r.getup = -1;
      const air = h > 0.05;
      if (air) {
        // Überschlag: Achse = oben × Flugrichtung (Kopf voran in Flugrichtung), Tempo ~ Geschwindigkeit
        if (hs > 0.8) r.axis.set(r.vz / hs, 0, -r.vx / hs);
        const want = Math.min(13, Math.max(4.5, hs * 0.85));
        r.rate += (want - r.rate) * Math.min(1, dt * 6);
        tmpQ2.setFromAxisAngle(r.axis, r.rate * dt);
        r.q.premultiply(tmpQ2);
        // etwas Schraube um die Körperachse, je Figur verschieden
        r.q.multiply(tmpQ2.setFromAxisAngle(UP, r.twist * 5 * dt));
        r.vy = vy;
      } else {
        if (r.air) f.impact = Math.min(1, 0.35 + Math.abs(r.vy) / 14); // Landung
        r.rate *= Math.max(0, 1 - dt * 8);
        // Lage am Boden: Kopfrichtung = waagerechter Anteil der Körperachse, Rücken- oder Bauchlage
        const bodyUp = tmpA.set(0, 1, 0).applyQuaternion(r.q);
        const front = tmpB.set(0, 0, 1).applyQuaternion(r.q);
        const hd = tmpC.set(bodyUp.x, 0, bodyUp.z);
        if (hd.lengthSq() < 0.01) hd.set(-front.x, 0, -front.z); // stand senkrecht: nach hinten umkippen
        if (hd.lengthSq() < 0.01) hd.set(-Math.sin(a), 0, -Math.cos(a));
        hd.normalize();
        r.head.copy(hd);
        if (r.air || f.getup > 0) r.side = front.y >= -0.05 ? 1 : -1;
        // Zielbasis: y' = Kopfrichtung, z' = ±oben (Gesicht), x' = y' × z'
        const zA = tmpB.set(0, r.side, 0);
        const xA = tmpA.crossVectors(hd, zA);
        tmpMat.makeBasis(xA, hd, zA);
        tmpQuat.setFromRotationMatrix(tmpMat);
        r.q.slerp(tmpQuat, 1 - Math.exp(-dt * (hs > 3 ? 5 : 10)));
        // Rutscht der Körper noch schnell über den Boden: leicht mitrollen
        if (hs > 4) {
          r.q.premultiply(tmpQ2.setFromAxisAngle(tmpA.set(r.vz / hs, 0, -r.vx / hs), Math.min(4, hs * 0.3) * dt * 0.4));
        }
      }
      f.air = air ? 1 : 0;
      r.air = air;
      f.side = r.side;
      f.getup = 0;
      f.spin = r.rate;
    } else {
      // Aufstehen: von der Liegelage zur aufrechten Haltung (Blick wie der Server sie vorgibt)
      if (r.getup < 0) { r.getup = 0; r.from.copy(r.q); }
      // Läuft die Figur schon los (NPC flieht), schneller aufstehen
      r.getup = Math.min(1, r.getup + dt / GETUP_TIME * (1 + Math.min(1.2, hs / 3)));
      const p = r.getup;
      // Natürliche Richtung beim Aufrichten: aus Rückenlage Richtung Füße, aus Bauchlage Richtung Kopf
      const fx = r.side > 0 ? -r.head.x : r.head.x, fz = r.side > 0 ? -r.head.z : r.head.z;
      const natural = Math.atan2(fx, fz);
      const yaw = lerpAngleRad(natural, a, smoothstep(0.55, 1, p));
      tmpQuat.setFromAxisAngle(UP, yaw);
      r.q.copy(r.from).slerp(tmpQuat, easeInOut(smoothstep(0.12, 0.95, p)));
      f.air = 0; f.side = r.side; f.getup = Math.max(0.001, p); f.spin = 0;
      if (p >= 1) {
        c.rag = null;
        root.quaternion.setFromAxisAngle(UP, a);
        root.position.set(x, gy + h, z);
        return null;
      }
    }
    // Körpermitte: aufrecht auf Schwerpunkthöhe, liegend knapp über dem Boden; Figur um die Mitte drehen
    const up = Math.abs(tmpA.set(0, 1, 0).applyQuaternion(r.q).y);
    const cy = gy + h + RAG_LIE + (RAG_CENTER - RAG_LIE) * up;
    tmpPos.set(0, RAG_CENTER, 0).applyQuaternion(r.q);
    root.position.set(x - tmpPos.x, cy - tmpPos.y, z - tmpPos.z);
    root.quaternion.copy(r.q);
    return f;
  }

  /** Waffe in der Hand: Modell wechseln, Schlag-Schwung bzw. Rückstoß animieren. */
  private updateHeld(c: CharView, weapon: number, dt: number, show: boolean) {
    if (weapon !== c.heldIdx) {
      if (c.held) { c.model.root.remove(c.held); c.held = null; }
      c.heldIdx = weapon;
      if (weapon >= 0) {
        c.held = createWeaponMesh(weapon);
        if (c.held) c.model.root.add(c.held);
      }
    }
    const m = c.held;
    if (!m) return;
    c.swing = Math.max(0, c.swing - dt);
    c.kick = Math.max(0, c.kick - dt);
    const fists = c.heldIdx === 0;
    m.visible = show && (!fists || c.swing > 0);
    const sp = c.swing > 0 ? 1 - c.swing / SWING_TIME : 0; // 0..1 Fortschritt des Schlags
    const kick = c.kick / KICK_TIME;
    // Grundhaltung: Waffe seitlich vor dem Körper, leicht nach vorne geneigt
    let x = 0.55, y = 1.25, z = 0.45, rx = 0.15, ry = 0;
    if (c.swing > 0) {
      if (fists) { z += Math.sin(sp * Math.PI) * 0.9; x = 0.3; }
      else { rx = -1.5 + sp * 3.0; z += Math.sin(sp * Math.PI) * 0.3; ry = -0.5 + sp * 0.9; y += 0.25; } // Hieb von oben nach unten
    }
    if (kick > 0) { z -= 0.18 * kick; rx -= 0.35 * kick; }
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.scale.setScalar(1.5);
  }

  /** Angriffs-Animation (Schlag oder Schuss) einer Figur auslösen. */
  playAttack(id: number, kind: 'swing' | 'shot') {
    const c = this.players.get(id) ?? this.peds.get(id);
    if (!c) return;
    if (kind === 'swing') { c.swing = SWING_TIME; (c.model as Partial<KenneyCharacter>).attack?.(); } else c.kick = KICK_TIME;
  }

  setPlayer(s: PlayerState, dt: number, seatedOn: VehicleViewState | null, isMe: boolean) {
    const c = this.updateChar(this.players, s.id, s.color, s.x, s.z, s.a, dt, seatedOn, s.h, s.ragdoll, s.weapon);
    if (!isMe && !c.label) {
      c.label = makeLabel(s.name, OUTFIT_COLORS[s.color % OUTFIT_COLORS.length]);
      this.group.add(c.label);
    }
    if (c.label) {
      const p = c.anchor;
      c.label.position.set(p.x, p.y + (seatedOn && !c.model.root.visible ? 4 : 3.6), p.z);
    }
  }

  setPed(s: PedState, dt: number) {
    const c = this.updateChar(this.peds, s.id, s.color, s.x, s.z, s.a, dt, null, s.h, s.ragdoll, s.cop || s.gang ? 3 : -1, s.cop ? 1 : s.gang ? 2 : 0, s.arch ?? -1, s.act ?? 0);
    this.updateDog(c, s);
    this.updateLook(c, s);
    // Schimpfender Fahrer: Comic-Sprechblase (nicht gleichzeitig mit einem Bark)
    if (s.angry && !c.bubble && !this.bubbles.has(s.id)) {
      c.bubble = makeLabel(SWEAR[s.id % SWEAR.length], 0, true);
      c.bubble.scale.set(4.2, 1.05, 1);
      this.group.add(c.bubble);
    } else if (!s.angry && c.bubble) {
      this.group.remove(c.bubble); c.bubble.material.map?.dispose(); c.bubble.material.dispose(); c.bubble = undefined;
    }
    if (c.bubble) {
      const p = c.anchor;
      c.bubble.position.set(p.x, p.y + 3.2 + Math.abs(Math.sin(this.clock * 10)) * 0.25, p.z);
    }
  }

  /**
   * Kopfdrehung (lokal, spec Schritt 4): NPCs schauen den eigenen Spieler an, wenn er langsam nah
   * vorbeigeht; nach einem Vorfall behalten sie den Verursacher ängstlich im Blick (Kurzzeitgedächtnis).
   */
  private updateLook(c: CharView, s: PedState) {
    const m = c.model as Partial<KenneyCharacter>;
    if (!m.setLook) return;
    let tx = 0, tz = 0, w = 0, anx = false;
    const fear = s.fear ?? -1;
    const feared = fear >= 0 ? this.players.get(fear) : undefined;
    if (feared && !s.ragdoll) {
      tx = feared.anchor.x; tz = feared.anchor.z; w = 1; anx = true;
    } else if (!s.ragdoll && !s.cop && this.local.onFoot && this.local.speed < 2.8) {
      const d = Math.hypot(this.local.x - s.x, this.local.z - s.z);
      if (d < 6.5) { tx = this.local.x; tz = this.local.z; w = Math.min(1, (6.5 - d) / 2); }
    }
    if (w > 0) {
      const rel = wrapAngle(Math.atan2(tx - s.x, tz - s.z) - s.a);
      if (Math.abs(rel) > 1.9) w = 0; // hinter dem Rücken: nicht den Kopf verrenken
      m.setLook(rel, w, anx);
    } else m.setLook(0, 0);
  }

  /** Bark eines NPCs anzeigen (Text aus der Bark-Tabelle nach Archetyp). */
  bark(pedId: number, sit: number, variant: number) {
    const c = this.peds.get(pedId);
    if (!c) return;
    const text = barkText(sit, c.arch, variant);
    if (!text) return;
    this.removeBubble(pedId);
    if (c.bubble) { this.group.remove(c.bubble); c.bubble.material.map?.dispose(); c.bubble.material.dispose(); c.bubble = undefined; }
    const b = makeBarkBubble(text);
    b.sprite.scale.set(0.01, 0.01, 1);
    this.group.add(b.sprite);
    this.bubbles.set(pedId, { sprite: b.sprite, t: 0, w: b.w, h: b.h });
  }

  private removeBubble(id: number) {
    const b = this.bubbles.get(id);
    if (!b) return;
    this.group.remove(b.sprite); b.sprite.material.map?.dispose(); b.sprite.material.dispose();
    this.bubbles.delete(id);
  }

  /** Sprechblasen: Aufploppen, über dem Kopf mitführen, ausblenden; nur die nächsten MAX_BUBBLES zeigen. */
  private updateBubbles(dt: number) {
    if (!this.bubbles.size) return;
    const order: [number, number][] = [];
    for (const [id, b] of this.bubbles) {
      b.t += dt;
      const c = this.peds.get(id);
      if (!c || b.t > BARK_DURATION) { this.removeBubble(id); continue; }
      const p = c.anchor;
      order.push([id, Math.hypot(p.x - this.focus.x, p.z - this.focus.z)]);
    }
    order.sort((a, b) => a[1] - b[1]);
    order.forEach(([id, d], i) => {
      const b = this.bubbles.get(id)!, c = this.peds.get(id)!;
      const vis = i < MAX_BUBBLES && d < 70;
      b.sprite.visible = vis;
      if (!vis) return;
      const p = c.anchor;
      const pop = b.t < 0.18 ? 0.4 + (b.t / 0.18) * 0.8 : b.t < 0.3 ? 1.2 - ((b.t - 0.18) / 0.12) * 0.2 : 1; // Überschwinger
      const k = 1.25 * pop;
      b.sprite.scale.set(b.w * k, b.h * k, 1);
      b.sprite.position.set(p.x, p.y + 2.35, p.z);
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, (BARK_DURATION - b.t) / 0.35);
    });
  }

  /** Hund an der Leine für Hundebesitzer (reine Deko, läuft clientseitig hinterher). */
  private updateDog(c: CharView, s: PedState) {
    const want = (s.arch ?? -1) >= 0 && archetypeOf(s.arch!).companion === 'dog' && !s.ragdoll;
    if (!want) {
      if (c.dog) { this.group.remove(c.dog, c.leash!); c.leash!.geometry.dispose(); c.dog = undefined; c.leash = undefined; }
      return;
    }
    if (!c.dog) {
      const body = merge([
        box(0.3, 0.28, 0.7, 0, 0.3, 0, 0xc98a4a), box(0.24, 0.24, 0.26, 0, 0.45, 0.45, 0xb87838), box(0.1, 0.08, 0.12, 0, 0.47, 0.66, 0x3a2a20),
        box(0.06, 0.12, 0.05, 0.1, 0.68, 0.42, 0x8a5a30), box(0.06, 0.12, 0.05, -0.1, 0.68, 0.42, 0x8a5a30), box(0.06, 0.06, 0.3, 0, 0.5, -0.45, 0xb87838, 0, 0.7),
        ...[[-0.1, 0.25], [0.1, 0.25], [-0.1, -0.25], [0.1, -0.25]].map(([lx, lz]) => box(0.07, 0.3, 0.07, lx, 0, lz, 0x9a6a38)),
      ]);
      c.dog = new THREE.Mesh(body, toonVC);
      c.dog.scale.setScalar(1.25);
      addOutline(c.dog, LINE.prop);
      c.dogX = s.x + 0.9; c.dogZ = s.z + 0.9; c.dogA = s.a;
      c.leash = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xe0453a }));
      c.leash.frustumCulled = false;
      this.group.add(c.dog, c.leash);
    }
    // Zielplatz: vorn links neben dem Besitzer; der Hund folgt weich und schaut in Laufrichtung
    const fx = Math.sin(s.a), fz = Math.cos(s.a);
    const tx = s.x + fx * 1.0 + fz * 0.9, tz = s.z + fz * 1.0 - fx * 0.9;
    const k = Math.min(1, 5 * (this.lastDt || 0.016));
    const dx = tx - c.dogX!, dz = tz - c.dogZ!;
    c.dogX! += dx * k; c.dogZ! += dz * k;
    const moving = Math.hypot(dx, dz) > 0.05;
    if (moving) c.dogA = Math.atan2(dx, dz);
    const gy = this.groundY(c.dogX!, c.dogZ!);
    const bob = moving ? Math.abs(Math.sin(this.clock * 14)) * 0.06 : 0;
    c.dog.position.set(c.dogX!, gy + bob, c.dogZ!);
    c.dog.rotation.y = c.dogA!;
    const hand = c.anchor;
    const pos = c.leash!.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, hand.x + fz * 0.45, hand.y + 1.05, hand.z - fx * 0.45);
    pos.setXYZ(1, c.dogX!, gy + 0.7, c.dogZ!);
    pos.needsUpdate = true;
  }

  // ------------------------------------------------------------------ Quest-Objekte
  setQuestMarkers(start: [number, number] | null, dest: [number, number] | null) {
    const place = (m: THREE.Group, p: [number, number] | null) => {
      m.visible = !!p;
      if (!p) return;
      m.position.set(p[0], this.groundY(p[0], p[1]), p[1]);
      const arrow = m.getObjectByName('arrow')!;
      arrow.position.y = 7 + Math.sin(this.clock * 3) * 0.6;
      arrow.rotation.y += 0.03;
    };
    place(this.startMarker, start);
    place(this.destMarker, dest);
  }

  setPackages(list: [number, number, number, number][]) {
    const alive = new Set<number>();
    for (const [id, x, z, carrier] of list) {
      alive.add(id);
      let m = this.packages.get(id);
      if (!m) {
        m = new THREE.Mesh(this.packageGeo, this.packageMat);
        this.packages.set(id, m);
        this.group.add(m);
      }
      // Getragene Pakete schweben über dem (dargestellten) Träger
      const anchor = carrier >= 0 ? this.carrierAnchor(carrier) : null;
      if (anchor) m.position.copy(anchor);
      else m.position.set(x, this.groundY(x, z) + 0.8 + Math.sin(this.clock * 3 + id) * 0.25, z);
      m.scale.setScalar(anchor ? 1.0 : 1.3);
      m.rotation.y += 0.02;
    }
    for (const [id, m] of this.packages) {
      if (!alive.has(id)) { this.group.remove(m); this.packages.delete(id); }
    }
  }

  /** Punkt über dem Kopf eines Spielers (bzw. über seinem Auto). */
  private carrierAnchor(playerId: number): THREE.Vector3 | null {
    const c = this.players.get(playerId);
    if (!c) return null;
    const p = c.anchor;
    return new THREE.Vector3(p.x, p.y + (c.model.root.visible ? 3.0 : 2.6), p.z);
  }

  /** Entitäten, die in diesem Frame nicht mehr vorkamen, entfernen. */
  endFrame() {
    this.updateBubbles(this.lastDt);
    const sweepChars = (m: Map<number, CharView>) => {
      for (const [id, c] of m) {
        if (c.seen) continue;
        this.group.remove(c.model.root);
        c.model.dispose();
        if (c.dog) { this.group.remove(c.dog, c.leash!); c.leash!.geometry.dispose(); }
        for (const sp of [c.label, c.bubble]) if (sp) { this.group.remove(sp); sp.material.map?.dispose(); sp.material.dispose(); }
        m.delete(id);
      }
    };
    sweepChars(this.players);
    sweepChars(this.peds);
    for (const [id, v] of this.vehicles) if (!v.seen) this.removeVehicle(id);
    this.shadows.count = this.shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.wheels.count = this.wheelCount;
    this.wheelHull.count = this.wheelCount;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.foam.count = this.foamCount;
    this.foam.instanceMatrix.needsUpdate = true;
  }
}
