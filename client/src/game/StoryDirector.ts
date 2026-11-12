// Story im Client: Story-Figuren (pro Spieler sichtbar, je nach Fortschritt), Wohnorte, Intro beim
// ersten Spawn (Schwarzblende, Lous Cabrio fährt vor, Dialog), Zwischensequenzen, Entscheidungen und
// Kartenpunkte. Das Intro läuft komplett lokal – andere Spieler sehen weder Lou noch das Vorfahr-Auto.
import * as THREE from 'three';
import type { ClientMsg, ServerMsg } from '../../../shared/src/protocol';
import { questLocations, type Point } from '../../../shared/src/questLocations';
import { CAR_VARIANTS } from '../../../shared/src/sim/handling';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { snapRoad } from '../../../shared/src/story/places';
import {
  charOf, CREW_IDS, CREW_MISSION, homeUsable, MISSION_META, nextMain, RANKS, rankIndex, rankOf, STORY, visibleNpcs,
  type Look, type StoryNpcDef, type StoryView,
} from '../../../shared/src/story';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { CarModel } from '../render/CarModel';
import { createKenneyCharacter, type KenneyRole } from '../render/kenneyCharacters';
import { CharacterModel, lightsMat, vehicleMat } from '../render/models';
import { sign } from '../render/ShopsView';
import type { MapDot } from '../ui/Minimap';
import type { StoryUi } from '../ui/StoryUi';

/** Gesprächsreichweite (zu Fuß) und Reichweite am Wohnort (Client; der Server prüft großzügiger). */
const TALK_RANGE = 3.6;
const HOME_RANGE = 6;
const BOSS = RANKS.length - 1;

export type StoryTarget = { kind: 'npc'; npc: StoryNpcDef } | { kind: 'home'; id: string; locked: boolean } | { kind: 'club' };

interface Figure { root: THREE.Object3D; animate(speed: number, dt: number, seated?: boolean, dist?: number): void; dispose(): void }
interface NpcView { def: StoryNpcDef; fig: Figure; marker: THREE.Group; a: number; x: number; z: number }

const hexNum = (c: string | undefined) => (c ? parseInt(c.replace('#', ''), 16) : undefined);
const seedOf = (s: string) => Array.from(s).reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;

/** Figur im Look einer Story-Figur bzw. eines Rangs. */
export function lookFigure(look: Look, seed: number): Figure {
  return createKenneyCharacter(look.style as KenneyRole, seed, hexNum(look.shirt)) ?? new CharacterModel(seed % 6);
}

function marker(text: string, color: number, y = 3.4): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.8, 20, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  ring.position.y = 0.4;
  const s = sign(text, color);
  s.position.y = y;
  s.scale.multiplyScalar(0.8);
  g.add(ring, s);
  return g;
}
function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material & { map?: THREE.Texture };
    if (mat) { mat.map?.dispose(); mat.dispose(); }
  });
}

export class StoryDirector {
  readonly group = new THREE.Group();
  state: StoryView | null = null;
  /** Tageszeit für die Darstellung erzwingen (Intro, Balkon); null = Serverzeit. */
  dayOverride: number | null = null;
  private loc: Record<string, Point>;
  private npcs = new Map<string, NpcView>();
  private places: THREE.Group[] = [];
  private introRunning = false;
  private t = 0;
  // Intro-Requisiten (nur lokal)
  private car: { model: CarModel; from: Point; to: Point; a: number; y: number; t0: number; dur: number } | null = null;
  private lou: { fig: Figure; fx: number; fz: number; x: number; z: number; tx: number; tz: number; t0: number; dur: number } | null = null;

  constructor(
    private map: WorldMap,
    private ui: StoryUi,
    private send: (m: ClientMsg) => void,
    private me: () => { x: number; z: number; inVehicle: boolean },
  ) {
    this.loc = questLocations(map);
  }

  // ------------------------------------------------------------------ Zustand vom Server
  setState(s: StoryView) {
    this.state = s;
    this.rebuild();
    this.ui.setHud(s.rank, this.goalText());
    if (!s.intro && !this.introRunning) void this.playIntro();
  }

  onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'dialog': {
        if (msg.scene) void this.playScene(msg.scene, msg.lines);
        else void this.ui.say(msg.lines, msg.kind, false);
        break;
      }
      case 'rankUp': this.ui.rankUp(msg.rank); break;
      case 'choice': {
        void this.ui.choose(msg.who, msg.prompt, msg.options.map((o) => o.label)).then((i) => {
          if (i >= 0) this.send({ t: 'choice', id: msg.id, option: msg.options[i].id });
        });
        break;
      }
    }
  }

  /** Text für „Nächstes Ziel“ (HUD). */
  goalText(): string | null {
    const s = this.state;
    if (!s || !s.intro) return null;
    const m = nextMain(s, s.done);
    if (!m) return null;
    if (m.id === CREW_MISSION) {
      const missing = CREW_IDS.filter((c) => !s.crew.includes(c)).map((c) => charOf(c)?.short ?? c);
      return `Crew anwerben: ${missing.join(', ')} (${3 - missing.length}/3)`;
    }
    return m.hint;
  }

  // ------------------------------------------------------------------ Figuren und Orte
  private rebuild() {
    const s = this.state!;
    // Figuren: nur sichtbare behalten bzw. neu anlegen
    const want = new Map(visibleNpcs(s, s.done).map((n) => [n.id, n]));
    for (const [id, v] of this.npcs) {
      if (want.has(id)) continue;
      this.group.remove(v.fig.root, v.marker);
      v.fig.dispose(); disposeGroup(v.marker);
      this.npcs.delete(id);
    }
    const next = nextMain(s, s.done);
    const nextGiver = next ? MISSION_META.get(next.id)?.giver : undefined;
    for (const [id, def] of want) {
      const at = this.loc[def.at];
      if (!at) continue;
      const ch = charOf(def.character)!;
      const offers = def.character === nextGiver || s.unlocked.some((m) => MISSION_META.get(m)?.giver === def.character && MISSION_META.get(m)?.kind === 'main');
      const label = `${offers ? '❗' : '💬'} ${ch.short}`;
      let v = this.npcs.get(id);
      if (v && v.marker.userData.label !== label) { this.group.remove(v.marker); disposeGroup(v.marker); v.marker = this.npcMarker(label, at, ch.color); }
      if (!v) {
        const fig = lookFigure(ch.look, seedOf(id));
        const y = this.map.surfaceY(at.x, at.z);
        fig.root.position.set(at.x, y, at.z);
        this.group.add(fig.root);
        v = { def, fig, marker: this.npcMarker(label, at, ch.color), a: 0, x: at.x, z: at.z };
        this.npcs.set(id, v);
      }
    }
    // Wohnorte und Club-Sperre
    for (const g of this.places) { this.group.remove(g); disposeGroup(g); }
    this.places = [];
    for (const id of this.homeList()) {
      const h = STORY.homes[id], at = this.loc[h.at];
      const locked = !homeUsable(id, s);
      const g = marker(locked ? '🔒 Gesperrt' : s.home === id ? '🏠 Zuhause' : '🏡 Wohnort', locked ? 0x9a9aa4 : 0x4fd16b, 2.6);
      const p = this.homeSpot(id)!;
      g.position.set(p.x, this.map.surfaceY(p.x, p.z), p.z);
      this.group.add(g);
      this.places.push(g);
    }
    if (this.clubBanned()) {
      const at = this.loc.club;
      const g = marker('🔒 Velvet Tide', 0xff4f6a, 4.8);
      g.position.set(at.x, this.map.surfaceY(at.x, at.z), at.z);
      this.group.add(g);
      this.places.push(g);
    }
  }

  private npcMarker(label: string, at: Point, color: string): THREE.Group {
    const g = marker(label, hexNum(color) ?? 0xffd23a);
    g.userData.label = label;
    g.position.set(at.x, this.map.surfaceY(at.x, at.z), at.z);
    this.group.add(g);
    return g;
  }

  private clubBanned() {
    const s = this.state;
    return !!s && s.rank >= rankIndex('ausgestossener') && s.rank < BOSS;
  }

  /** Ein Wohnort je Ort (mehrere können denselben Ort teilen): aktuelles Zuhause > nutzbar > gesperrt. */
  private homeList(): string[] {
    const s = this.state!;
    const best = new Map<string, string>();
    const score = (id: string) => (s.home === id ? 3 : homeUsable(id, s) ? 2 : 1) * 100 + s.homes.indexOf(id);
    for (const id of s.homes) {
      const h = STORY.homes[id];
      if (!h || !this.loc[h.at]) continue;
      const cur = best.get(h.at);
      if (!cur || score(id) > score(cur)) best.set(h.at, id);
    }
    return [...best.values()];
  }

  /** Markierung des Wohnorts: etwas neben dem Treffpunkt (dort stehen oft Story-Figuren). */
  private homeSpot(id: string): Point | null {
    const h = STORY.homes[id], at = h && this.loc[h.at];
    return at ? { x: at.x - 6, z: at.z + 4 } : null;
  }

  /** Nächstes Story-Ziel für F (Figur, Wohnort, gesperrter Club). */
  nearest(): StoryTarget | null {
    const s = this.state;
    if (!s || this.introRunning || this.ui.blocking) return null;
    const me = this.me();
    if (me.inVehicle) return null;
    let best: StoryTarget | null = null, bd = TALK_RANGE * TALK_RANGE;
    for (const v of this.npcs.values()) {
      const d = (v.x - me.x) ** 2 + (v.z - me.z) ** 2;
      if (d < bd) { bd = d; best = { kind: 'npc', npc: v.def }; }
    }
    if (best) return best;
    bd = HOME_RANGE * HOME_RANGE;
    for (const id of this.homeList()) {
      const p = this.homeSpot(id);
      if (!p) continue;
      const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2;
      if (d < bd) { bd = d; best = { kind: 'home', id, locked: !homeUsable(id, s) }; }
    }
    if (!best && this.clubBanned()) {
      const c = this.loc.club;
      if ((c.x - me.x) ** 2 + (c.z - me.z) ** 2 < HOME_RANGE * HOME_RANGE) best = { kind: 'club' };
    }
    return best;
  }

  hint(t: StoryTarget): string {
    if (t.kind === 'npc') return `<b>F</b> Mit ${charOf(t.npc.character)?.short ?? t.npc.character} sprechen`;
    if (t.kind === 'club') return `<b>F</b> Velvet Tide (Hausverbot)`;
    const h = STORY.homes[t.id];
    return t.locked ? `🔒 ${h.name}` : `<b>F</b> ${h.name} (Garage / Zuhause)`;
  }

  interact(t: StoryTarget) {
    const s = this.state!;
    if (t.kind === 'npc') { this.send({ t: 'talk', npc: t.npc.id }); return; }
    if (t.kind === 'club') { void this.ui.say([{ who: 'Türsteher', text: STORY.texts.clubLocked }], 'talk', false); return; }
    const h = STORY.homes[t.id];
    if (t.locked) { void this.ui.say([{ who: h.name, text: h.locked ?? STORY.texts.homeLocked.replace('{home}', h.name) }], 'talk', false); return; }
    let r = s.rank;
    while (r > 0 && !RANKS[r].vehicle) r--;
    const veh = RANKS[r].vehicle;
    const opts: { label: string; run: () => void }[] = [];
    if (veh) opts.push({ label: `Garage: ${veh.name} holen`, run: () => this.send({ t: 'home', do: 'garage', id: t.id }) });
    if (s.home !== t.id) opts.push({ label: 'Hier wohnen (neuer Spawnpunkt)', run: () => this.send({ t: 'home', do: 'set', id: t.id }) });
    opts.push({ label: 'Nichts, nur kurz die Aussicht genießen.', run: () => {} });
    void this.ui.choose(h.name, [{ who: h.name, text: h.desc }], opts.map((o) => o.label)).then((i) => opts[i]?.run());
  }

  /** Kartenpunkte: Story-Figuren (❗ = hat eine Hauptmission) und Wohnorte. */
  dots(): MapDot[] {
    const out: MapDot[] = [];
    const s = this.state;
    if (!s) return out;
    for (const v of this.npcs.values()) {
      const ch = charOf(v.def.character)!;
      const main = (v.marker.userData.label as string).startsWith('❗');
      out.push({ x: v.x, z: v.z, color: ch.color, size: main ? 5 : 3, ring: true, icon: main ? '❗' : '💬', label: [`${ch.name}`, ch.title, ...(main ? [this.goalText() ?? ''] : [])] });
    }
    for (const id of this.homeList()) {
      const p = this.homeSpot(id);
      if (!p) continue;
      const locked = !homeUsable(id, s);
      out.push({ x: p.x, z: p.z, color: locked ? '#9a9aa4' : '#4fd16b', size: 3, ring: true, icon: locked ? '🔒' : '🏠', label: [STORY.homes[id].name, locked ? 'gesperrt' : s.home === id ? 'Dein Zuhause (Spawnpunkt)' : 'Wohnort'] });
    }
    return out;
  }

  // ------------------------------------------------------------------ Intro & Szenen
  private wait(sec: number) { return new Promise<void>((r) => window.setTimeout(r, sec * 1000)); }

  private async playIntro() {
    this.introRunning = true;
    const I = STORY.intro;
    this.dayOverride = I.day;
    const fade = this.ui.fade(I.title, 3.2);
    this.ui.onBlockChange(true);
    // Lous Cabrio: kommt 70 m die Straße herunter und hält am Busbahnhof
    const pose = snapRoad(this.map, this.loc.introCar.x, this.loc.introCar.z);
    const variant = Math.max(0, CAR_VARIANTS.findIndex((v) => v.model === I.car.model));
    const from = { x: pose.x - Math.sin(pose.a) * 70, z: pose.z - Math.cos(pose.a) * 70 };
    const sim = createSimVehicle(this.map, VehicleKind.Car, variant, pose.x, pose.z, pose.a);
    const model = new CarModel(variant, I.car.color, vehicleMat, lightsMat);
    model.root.visible = false;
    this.group.add(model.root);
    await fade;
    this.car = { model, from, to: pose, a: pose.a, y: sim.car.y, t0: performance.now(), dur: 3.2 };
    model.root.visible = true;
    await this.wait(3.5);
    // Lou steigt aus und kommt auf den Spieler zu (bis zu seinem Platz am Gehweg, wo er danach stehen bleibt)
    const side = { x: pose.x + Math.cos(pose.a) * 1.4, z: pose.z - Math.sin(pose.a) * 1.4 };
    const goal = this.loc.louBus;
    const dur = Math.min(3.5, Math.hypot(goal.x - side.x, goal.z - side.z) / 2.2 + 0.2);
    const fig = lookFigure(charOf('lou')!.look, 4242);
    fig.root.position.set(side.x, this.map.surfaceY(side.x, side.z), side.z);
    this.group.add(fig.root);
    this.lou = { fig, fx: side.x, fz: side.z, x: side.x, z: side.z, tx: goal.x, tz: goal.z, t0: performance.now(), dur };
    await this.wait(dur + 0.3);
    await this.ui.say(I.lines, 'talk', true);
    // Steuerung frei, Mission 1 startet (der Server stellt das echte Cabrio an dieselbe Stelle)
    this.send({ t: 'introDone' });
    this.ui.onBlockChange(false);
    await this.wait(1.2);
    if (this.car) { this.group.remove(this.car.model.root); this.car.model.dispose(); this.car = null; }
    if (this.lou) { this.group.remove(this.lou.fig.root); this.lou.fig.dispose(); this.lou = null; }
    this.introRunning = false;
    await this.wait(8);
    if (!this.introRunning) this.dayOverride = null;
  }

  private async playScene(scene: string, lines: Parameters<StoryUi['say']>[0]) {
    const sc = STORY.scenes[scene];
    await this.ui.blink();
    this.dayOverride = sc?.day ?? null;
    await this.ui.say(lines, 'talk', true);
    await this.ui.blink();
    this.dayOverride = null;
  }

  // ------------------------------------------------------------------ Frame
  update(dt: number) {
    this.t += dt;
    const me = this.me();
    for (const v of this.npcs.values()) {
      const dx = me.x - v.x, dz = me.z - v.z, d = Math.hypot(dx, dz);
      v.fig.root.visible = d < 140;
      v.marker.visible = d < 260;
      if (!v.fig.root.visible) continue;
      const want = d < 8 ? Math.atan2(dx, dz) : v.a;
      let diff = want - v.fig.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      v.fig.root.rotation.y += diff * Math.min(1, dt * 5);
      v.fig.animate(0, dt, false, d);
    }
    const now = performance.now();
    if (this.car) {
      // Echtzeit statt Bildzeit: das Auto kommt auch bei niedriger Bildrate pünktlich an
      const c = this.car;
      const u = Math.min(1, (now - c.t0) / 1000 / c.dur);
      const k = 1 - (1 - u) ** 3; // bremst zum Ende hin (Quietschen gedacht)
      const x = c.from.x + (c.to.x - c.from.x) * k, z = c.from.z + (c.to.z - c.from.z) * k;
      c.model.root.position.set(x, c.y, z);
      c.model.root.rotation.set(0, c.a, 0);
      c.model.update(dt, (1 - k) * 20, 0, false, u > 0.6 && u < 1, false);
    }
    if (this.lou) {
      const l = this.lou;
      const u = Math.min(1, (now - l.t0) / 1000 / l.dur);
      const walking = u < 1;
      l.x = l.fx + (l.tx - l.fx) * u; l.z = l.fz + (l.tz - l.fz) * u;
      const look = walking ? Math.atan2(l.tx - l.fx, l.tz - l.fz) : Math.atan2(me.x - l.x, me.z - l.z);
      l.fig.root.position.set(l.x, this.map.surfaceY(l.x, l.z), l.z);
      l.fig.root.rotation.y = look;
      l.fig.animate(walking ? 2.2 : 0, dt, false, 5);
    }
  }

  /** Rang eines Spielers als Symbol für das Namensschild. */
  static rankIcon(rank: number) { return rankOf(rank).icon; }
}
