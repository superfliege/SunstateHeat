// Ankunftsszenen: Sobald ein frisch eingeloggter Spieler zu Fuß auf die Straße läuft (oder nach ein paar
// Sekunden schon direkt daneben steht), passiert direkt vor ihm etwas Absurdes – eine von fünf kleinen, geskripteten Szenen:
//   1. Polizeijagd: Ein Flüchtiger rennt vorbei, drei Streifenwagen mähen ihn um – er steht auf und haut ab.
//   2. Bazooka: Ein Typ jagt ein geparktes Auto mit dem Raketenwerfer hoch – war leider das falsche.
//   3. Straßenrennen: Zwei Raser donnern heran, einer kracht ins geparkte Auto, das kurz danach explodiert.
//   4. Schießerei: Zwei Gangster ballern sich gegenseitig daneben, bis beiden die Munition ausgeht.
//   5. Brennendes Geisterauto: Ein Auto rollt brennend die Straße runter, der Besitzer rennt schreiend hinterher.
// Die Szenen laufen auf dem Server (alle Spieler in der Nähe sehen sie), nutzen nur vorhandene Bausteine
// (Fahrzeugphysik, Explosionen, Schuss-/Bark-Ereignisse) und lösen keine Fahndung gegen Spieler aus.
// Der begrüßte Spieler ist während der Szene unverwundbar (kein Schaden, wird nicht umgeworfen):
// Die Show soll ihn nicht gleich umhauen.
import { OUTFIT_COLORS } from '../../../shared/src/constants';
import { clamp, dist2, wrapAngle } from '../../../shared/src/math';
import { findFootSpot, stepPawn } from '../../../shared/src/sim/movement';
import { cumulative, distToSegment, offsetPolyline, pointAt, type Vec2 } from '../../../shared/src/world/geometry';
import { drivablePath, laneOffset } from '../../../shared/src/world/roads';
import { RoadType, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';
import { WEAPONS } from '../../../shared/src/weapons';
import { BURN_TIME } from '../../../shared/src/sim/damage';
import { Btn } from '../../../shared/src/protocol';
import { DRIVER_COP, DRIVER_NONE, DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../entities/types';
import { GANG_OUTFIT } from './Gangs';
import type { Ped, Pedestrians } from './Pedestrians';

const PISTOL = Object.keys(WEAPONS).indexOf('pistol');
const ROCKET = Object.keys(WEAPONS).indexOf('rocket');
/** Fahrzeug-Varianten (siehe CAR_VARIANTS): Limousine (Streife), Sportwagen, Muscle Car, Kompakt. */
const V_SEDAN = 1, V_SPORT = 4, V_MUSCLE = 5, V_COMPACT = 0;

export const SCENE_NAMES = ['Polizeijagd', 'Bazooka', 'Straßenrennen', 'Schießerei', 'Geisterauto'] as const;

export interface SceneHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  peds: Pedestrians;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  spawnCar(variant: number, x: number, z: number, a: number, driver: number, color: number): ServerVehicle;
  /** Einen Server-Tick Fahrzeugphysik mit diesen Eingaben. */
  stepCar(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
  explode(v: ServerVehicle): void;
  /** Fahrer steigt aus (wütend = schimpft neben dem Auto). */
  driverOut(v: ServerVehicle, angry: boolean): void;
  emit(x: number, z: number, ev: (string | number)[]): void;
  /** Schüsse/Explosion: Passanten in der Nähe erschrecken. */
  scare(x: number, z: number, r: number): void;
}

/** Eine Fahrspur als Polylinie mit Bogenlänge; s0 = Stelle direkt vor dem Spieler. */
interface Lane {
  edge: RoadEdge;
  forward: boolean;
  pts: Vec2[];
  cum: number[];
  len: number;
  s0: number;
}

interface Pending { pid: number; ready: number; check: number }

/**
 * Platzbedarf der Szenen auf der Spur: [Meter vor s0 (Anlauf), Meter nach s0].
 */
const NEED: [number, number][] = [[95, 40], [14, 14], [86, 30], [12, 12], [45, 25]];

export class Scenes {
  private pending: Pending[] = [];
  private running: Scene[] = [];

  constructor(private h: SceneHost) {}

  /** Neuer Spieler: Szene vormerken (startet, sobald er zu Fuß an die Straße kommt). */
  welcome(p: ServerPlayer) {
    this.pending.push({ pid: p.id, ready: 0, check: 0 });
  }

  /** Dev: Szene sofort starten (idx 0–4, sonst zufällig). Gibt den Namen oder eine Fehlermeldung zurück. */
  startFor(p: ServerPlayer, idx?: number): string {
    this.pending = this.pending.filter((w) => w.pid !== p.id); // ersetzt die Ankunftsszene
    const s = this.start(p, idx);
    return s ? `Szene: ${SCENE_NAMES[s.kind]}` : 'Keine passende Straße in der Nähe.';
  }

  update(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const w = this.pending[i];
      const p = this.h.players.get(w.pid);
      if (!p || w.ready > 180) { this.pending.splice(i, 1); continue; }
      if (p.lastSeq === 0 || p.downT > 0 || p.vehicleId >= 0) continue; // Client lädt noch / sitzt im Auto
      w.ready += dt;
      if (w.ready < 1.5 || (w.check -= dt) > 0) continue;
      w.check = 0.25;
      // Läuft er auf die Straße (bzw. steht nach 10 s schon direkt daneben)? Dann geht's los.
      if (!this.nearRoad(p, w.ready > 10 ? 9 : 2)) continue;
      if (this.start(p)) this.pending.splice(i, 1);
    }
    for (let i = this.running.length - 1; i >= 0; i--) {
      const s = this.running[i];
      if (!s.step(dt)) { s.end(); this.running.splice(i, 1); }
    }
  }

  /** Spieler höchstens `margin` m neben der Fahrbahn (Gehweg zählt mit)? */
  private nearRoad(p: ServerPlayer, margin: number): boolean {
    const pos = this.h.positionOf(p);
    for (const e of this.h.map.edges) {
      if (e.type === RoadType.Pier) continue;
      const r = e.width / 2 + e.sidewalk + margin;
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k];
        if (Math.abs(a[0] - pos.x) > 40 || Math.abs(a[1] - pos.z) > 40) continue;
        if (distToSegment(pos.x, pos.z, a[0], a[1], b[0], b[1]).d < r) return true;
      }
    }
    return false;
  }

  private start(p: ServerPlayer, idx?: number): Scene | null {
    const pos = this.h.positionOf(p);
    const kinds = idx !== undefined && idx >= 0 && idx < SCENE_NAMES.length ? [idx] : shuffle([0, 1, 2, 3, 4]);
    for (const kind of kinds) {
      const lane = this.findLane(pos.x, pos.z, NEED[kind]);
      if (!lane) continue;
      const s = this.create(kind, lane, p);
      this.running.push(s);
      p.invuln = Math.max(p.invuln, s.duration);
      return s;
    }
    return null;
  }

  private create(kind: number, lane: Lane, p: ServerPlayer): Scene {
    switch (kind) {
      case 0: return new ChaseScene(this.h, lane, p);
      case 1: return new BazookaScene(this.h, lane, p);
      case 2: return new RaceScene(this.h, lane, p);
      case 3: return new ShootoutScene(this.h, lane, p);
      default: return new GhostCarScene(this.h, lane, p);
    }
  }

  /**
   * Fahrspur in der Nähe suchen, auf der die Szene Platz hat. Kurze Straßenstücke werden über Kreuzungen
   * hinweg zu einer möglichst geraden Route verkettet. Bevorzugt die Spur, die weiter vom Spieler weg liegt
   * (Action auf der anderen Straßenseite, gut im Blick und nicht direkt auf ihm).
   */
  private findLane(x: number, z: number, [back, fwd]: [number, number]): Lane | null {
    let best: Lane | null = null, bestScore = -Infinity;
    for (const e of this.h.map.edges) {
      if (e.type === RoadType.Pier) continue;
      let near = Infinity;
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k];
        if (Math.abs(a[0] - x) > 80 || Math.abs(a[1] - z) > 80) continue;
        near = Math.min(near, distToSegment(x, z, a[0], a[1], b[0], b[1]).d);
      }
      if (near > 20) continue; // muss im Bild sein (Kamera zu Fuß zeigt nur ~±14 m)
      for (const forward of [true, false]) {
        const pts = this.route(e, forward, back + 30, fwd + 30);
        if (pts.length < 2) continue;
        const cum = cumulative(pts);
        const len = cum[cum.length - 1];
        const { s: proj, d } = project(pts, cum, x, z);
        if (len < back + fwd) continue;
        const s0 = clamp(proj, back, len - fwd);
        if (Math.abs(s0 - proj) > 18) continue;
        // Spieler steht zu nah an der Spur: Szene würde ihn überrollen
        if (d < 3.5) continue;
        // nah am Spieler (im Bild), Szene mittig vor ihm, Action eher auf der anderen Straßenseite
        const score = -near - Math.abs(s0 - proj) * 0.5 + Math.min(d, 12) * 0.5;
        if (score > bestScore) { bestScore = score; best = { edge: e, forward, pts, cum, len, s0 }; }
      }
    }
    return best;
  }

  /** Fahrspur über mehrere Kanten: rückwärts und vorwärts möglichst geradeaus weiter (je bis zu `back`/`fwd` m). */
  private route(e: RoadEdge, forward: boolean, back: number, fwd: number): Vec2[] {
    const map = this.h.map;
    const lanePts = (edge: RoadEdge, f: boolean) => offsetPolyline(drivablePath(edge, f), laneOffset(edge, 0));
    let pts = lanePts(e, forward);
    const used = new Set([e.id]);
    // vorwärts
    let node = forward ? e.b : e.a, len = 0;
    for (let n = 0; n < 6 && len < fwd; n++) {
      const end = pts[pts.length - 1], prev = pts[pts.length - 2];
      const dir = Math.atan2(end[0] - prev[0], end[1] - prev[1]);
      const next = this.straightest(map.nodes[node]?.edges ?? [], node, dir, used, true);
      if (!next) break;
      used.add(next.e.id);
      const add = lanePts(next.e, next.f);
      len += polyLen(add);
      pts = pts.concat(add);
      node = next.f ? next.e.b : next.e.a;
    }
    // rückwärts
    node = forward ? e.a : e.b; len = 0;
    for (let n = 0; n < 6 && len < back; n++) {
      const start = pts[0], second = pts[1];
      const dir = Math.atan2(second[0] - start[0], second[1] - start[1]);
      const prev = this.straightest(map.nodes[node]?.edges ?? [], node, dir, used, false);
      if (!prev) break;
      used.add(prev.e.id);
      const add = lanePts(prev.e, prev.f);
      len += polyLen(add);
      pts = add.concat(pts);
      node = prev.f ? prev.e.a : prev.e.b;
    }
    return pts;
  }

  /**
   * Kante am Knoten, die am geradesten anschließt (max. 40° Knick). out = true: führt vom Knoten weg,
   * sonst: führt zum Knoten hin. f = Fahrtrichtung a -> b.
   */
  private straightest(ids: number[], node: number, dir: number, used: Set<number>, out: boolean): { e: RoadEdge; f: boolean } | null {
    let best: { e: RoadEdge; f: boolean } | null = null, bd = 0.7;
    for (const id of ids) {
      const e = this.h.map.edges[id];
      if (!e || used.has(id) || e.type === RoadType.Pier || e.pts.length < 2) continue;
      const f = out ? e.a === node : e.b === node;
      const p = drivablePath(e, f);
      if (p.length < 2) continue;
      const [a, b] = out ? [p[0], p[Math.min(2, p.length - 1)]] : [p[Math.max(0, p.length - 3)], p[p.length - 1]];
      const diff = Math.abs(wrapAngle(Math.atan2(b[0] - a[0], b[1] - a[1]) - dir));
      if (diff < bd) { bd = diff; best = { e, f }; }
    }
    return best;
  }
}

// ------------------------------------------------------------------ Szenen

abstract class Scene {
  t = 0;
  abstract readonly kind: number;
  /** Ungefähre Dauer (Unverwundbarkeit des Spielers). */
  abstract readonly duration: number;
  protected peds: Ped[] = [];
  protected cars: ServerVehicle[] = [];
  private said = new Set<string>();
  /**
   * Spiegelung fester Positionen entlang der Straße (+1/-1): Die Kamera schaut fest nach Norden und unten
   * rechts liegt die Minimap. Liegt die Gegenseite unten und läuft die Spur nach rechts, kommen die
   * Höhepunkte deshalb lieber links vom Spieler.
   */
  protected readonly flip: 1 | -1;

  constructor(protected h: SceneHost, protected lane: Lane, protected viewer: ServerPlayer) {
    const a = this.at(0), b = this.at(1);
    this.flip = a.z > viewer.pawn.z && b.x > a.x ? -1 : 1;
  }

  /** Ein Tick; false = Szene fertig. */
  step(dt: number): boolean {
    this.t += dt;
    return this.update(dt) && this.t < 60;
  }

  protected abstract update(dt: number): boolean;

  /** Punkt auf der Spur (s relativ zu s0), seitlich versetzt (+ = rechts in Fahrtrichtung). */
  protected at(ds: number, side = 0): { x: number; z: number; a: number } {
    const { pts, cum, len } = this.lane;
    const s = this.lane.s0 + ds;
    const q = pointAt(pts, cum, s);
    // über die Enden der Route hinaus geradeaus weiter
    const over = s > len ? s - len : s < 0 ? s : 0;
    const x = q.x + q.dx * over, z = q.z + q.dz * over;
    return { x: x - q.dz * side, z: z + q.dx * side, a: Math.atan2(q.dx, q.dz) };
  }

  /** Bürgersteig rechts der Spur bzw. gegenüber (links der Straße). */
  protected walkSide(ds: number, right: boolean): { x: number; z: number; a: number } {
    const e = this.lane.edge;
    const edge = e.width / 2 + Math.max(1, e.sidewalk / 2); // Gehwegmitte ab Straßenmitte
    const q = this.at(ds, (right ? edge : -edge) - laneOffset(e, 0));
    const spot = findFootSpot(this.h.map, q.x, q.z, 5) ?? q;
    return { x: spot.x, z: spot.z, a: q.a };
  }

  protected ped(x: number, z: number, color: number, wpn = -1): Ped {
    const p = this.h.peds.spawnExt(x, z, { color, hp: 80 });
    p.wpn = wpn;
    this.peds.push(p);
    return p;
  }

  protected car(variant: number, ds: number, side: number, driver: number, color: number, speed = 0): ServerVehicle {
    const q = this.at(ds, side);
    const v = this.h.spawnCar(variant, q.x, q.z, q.a, driver, color);
    v.sim.car.vx = Math.sin(q.a) * speed; v.sim.car.vz = Math.cos(q.a) * speed;
    v.sim.car.sleep = speed > 0 ? 0 : 1;
    this.cars.push(v);
    return v;
  }

  /**
   * Normalen Verkehr auf der Szenen-Strecke (ds von..bis) entfernen, damit die Szene nicht vorher
   * in einen Linienbus kracht. Autos, die ein Spieler gerade sieht (< 45 m), bleiben stehen.
   */
  protected clearRoute(from: number, to: number) {
    const e = this.lane.edge;
    for (const v of [...this.h.vehicles.values()]) {
      if (v.driver !== DRIVER_NPC || v.qrun || v.race !== undefined || v.cop !== undefined || this.cars.includes(v)) continue;
      const c = v.sim.car;
      const { s, d } = project(this.lane.pts, this.lane.cum, c.x, c.z);
      if (d > e.width + 2 || s < this.lane.s0 + from || s > this.lane.s0 + to) continue;
      if (!this.unseen(c.x, c.z, 45)) continue;
      v.driver = DRIVER_NONE;
      this.h.vehicles.delete(v.id);
    }
  }

  /** Erste freie Stelle am Bordstein (kein Fahrzeug im Umkreis von 5,5 m) aus den Kandidaten ds. */
  protected freeSpot(cands: number[], side: number): number {
    for (const ds of cands) {
      const q = this.at(ds, side);
      let free = true;
      for (const v of this.h.vehicles.values()) if (dist2(v.sim.car.x, v.sim.car.z, q.x, q.z) < 5.5 * 5.5) { free = false; break; }
      if (free) return ds;
    }
    return cands[0];
  }

  /** Ped existiert noch und ist handlungsfähig? */
  protected alive(p: Ped): boolean { return this.h.peds.peds.get(p.id) === p && p.hp > 0; }
  protected standing(p: Ped): boolean { return this.alive(p) && p.rt <= 0; }
  protected exists(v: ServerVehicle): boolean { return this.h.vehicles.get(v.id) === v; }

  /** Sprechblase (einmalig pro Schlüssel). */
  protected say(p: Ped, text: string, key = text) {
    if (this.said.has(key) || !this.alive(p)) return;
    this.said.add(key);
    this.h.emit(p.x, p.z, ['say', p.id, text]);
  }

  /** Einmal-Aktion zum Zeitpunkt t. */
  protected once(key: string, at: number): boolean {
    if (this.t < at || this.said.has('@' + key)) return false;
    this.said.add('@' + key);
    return true;
  }

  protected run(p: Ped, tx: number, tz: number, dt: number, speed: number): number {
    if (!this.standing(p)) return Infinity;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d < 0.6) { p.flee = 0; return d; }
    stepPawn(this.h.map, p, dx / d, -dz / d, 0, dt, speed);
    p.flee = 1; // Lauf-Animation
    return d;
  }

  protected face(p: Ped, x: number, z: number) { if (this.standing(p)) { p.a = Math.atan2(x - p.x, z - p.z); p.flee = 0; } }

  protected shoot(p: Ped, tx: number, tz: number, wid: number, miss: number) {
    if (!this.standing(p)) return;
    this.face(p, tx, tz);
    const ang = Math.random() * Math.PI * 2;
    const ex = tx + Math.cos(ang) * miss, ez = tz + Math.sin(ang) * miss;
    this.h.emit(p.x, p.z, ['shot', p.id, round2(p.x), round2(p.z), round2(ex), round2(ez), wid]);
    this.h.scare(p.x, p.z, 30);
  }

  /** Ped an die normale Fußgänger-Logik übergeben: rennt weg und verschwindet nach ein paar Sekunden. */
  protected release(p: Ped, awayX: number, awayZ: number) {
    if (!this.alive(p)) return;
    const dx = p.x - awayX, dz = p.z - awayZ, d = Math.hypot(dx, dz) || 1;
    p.ext = false; p.walk = null; p.flee = 6; p.fdx = dx / d; p.fdz = dz / d; p.ttl = 14; p.wait = 0;
  }

  /**
   * Fahrzeug auf der Spur fahren lassen (Ziel = Spurpunkt voraus oder ein fester Punkt), Tempo regeln.
   * side = seitlicher Versatz zur Spur.
   */
  protected drive(v: ServerVehicle, speed: number, target?: { x: number; z: number }, side = 0, buttons = 0) {
    if (!this.exists(v) || v.sim.dmg.wreck) return;
    const c = v.sim.car;
    let tx: number, tz: number;
    if (target) { tx = target.x; tz = target.z; }
    else {
      const { s } = project(this.lane.pts, this.lane.cum, c.x, c.z);
      const q = this.at(s - this.lane.s0 + 6 + Math.abs(c.s) * 0.45, this.dodge(v, s, side));
      tx = q.x; tz = q.z;
    }
    const diff = wrapAngle(Math.atan2(tx - c.x, tz - c.z) - c.a);
    const cur = Math.hypot(c.vx, c.vz);
    const ax = clamp(-diff * 1.8, -1, 1);
    const ay = speed <= 0.5 ? (cur > 0.5 ? -1 : 0) : clamp((speed - cur) * 0.4, -1, 1);
    v.buttons = buttons;
    this.h.stepCar(v, ax, ay, buttons);
  }

  /**
   * Ausweichen: Steht vorne ein fremdes Fahrzeug (z. B. am Rand geparkt, halb in der Spur) auf der Fahrlinie,
   * wird der seitliche Versatz daran vorbei verschoben – bevorzugt Richtung Straßenmitte.
   */
  private dodge(v: ServerVehicle, s: number, side: number): number {
    const reach = 12 + Math.hypot(v.sim.car.vx, v.sim.car.vz) * 1.4;
    const clear = v.sim.prof.width / 2 + 1.25;
    let out = side;
    for (const o of this.h.vehicles.values()) {
      if (o === v || this.cars.includes(o)) continue;
      const oc = o.sim.car;
      if (Math.abs(oc.x - v.sim.car.x) > reach || Math.abs(oc.z - v.sim.car.z) > reach) continue;
      const pr = project(this.lane.pts, this.lane.cum, oc.x, oc.z);
      const ahead = pr.s - s;
      if (ahead < -2 || ahead > reach || Math.hypot(oc.vx, oc.vz) > 6) continue;
      const q = pointAt(this.lane.pts, this.lane.cum, pr.s);
      const lat = -(oc.x - q.x) * q.dz + (oc.z - q.z) * q.dx; // gleicher Sinn wie `side`
      const half = o.sim.prof.width / 2;
      if (Math.abs(lat - out) >= clear + half - 0.6) continue;
      out = lat >= out - 0.3 ? Math.min(out, lat - half - clear) : Math.max(out, lat + half + clear);
    }
    return out;
  }

  /** Abschluss: Figuren laufen weg, eigene Fahrzeuge werden freigegeben (verschwinden später von selbst). */
  end() {
    const c = this.at(0);
    for (const p of this.peds) if (this.alive(p) && p.ext) this.release(p, c.x, c.z);
    for (const v of this.cars) {
      if (!this.exists(v)) continue;
      if (v.driver === DRIVER_COP || v.driver === DRIVER_NPC) {
        // Fahrende Szenen-Autos: außer Sicht einfach entfernen, sonst stehen lassen
        if (this.unseen(v.sim.car.x, v.sim.car.z)) { v.driver = DRIVER_NONE; this.h.vehicles.delete(v.id); continue; }
        v.driver = DRIVER_NONE; v.buttons = 0;
      }
      v.home = null; v.idleTime = 0;
    }
  }

  protected unseen(x: number, z: number, r = 110): boolean {
    for (const p of this.h.players.values()) {
      const q = this.h.positionOf(p);
      if (dist2(q.x, q.z, x, z) < r * r) return false;
    }
    return true;
  }

  /** Fahrzeuge, die aus dem Bild gefahren sind, entfernen. Gibt true zurück, wenn keins mehr fährt. */
  protected sweepDriving(): boolean {
    let any = false;
    for (const v of this.cars) {
      if (!this.exists(v) || (v.driver !== DRIVER_COP && v.driver !== DRIVER_NPC)) continue;
      if (this.unseen(v.sim.car.x, v.sim.car.z)) { v.driver = DRIVER_NONE; this.h.vehicles.delete(v.id); continue; }
      any = true;
    }
    return any;
  }
}

/** 1. Polizeijagd: Flüchtiger rennt vorbei, drei Streifenwagen überfahren ihn, er steht auf und haut ab. */
class ChaseScene extends Scene {
  readonly kind = 0;
  readonly duration = 16;
  private runner: Ped;
  private cops: ServerVehicle[];
  private hitAt = -1;
  private rs: number; // Position des Flüchtigen auf der Spur (relativ zu s0)

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    this.rs = -30;
    const q = this.at(this.rs);
    this.runner = this.ped(q.x, q.z, Math.floor(Math.random() * OUTFIT_COLORS.length));
    this.clearRoute(-95, 40);
    this.cops = [-74, -83, -92].map((ds) => this.car(V_SEDAN, ds, 0, DRIVER_COP, 3, 14));
  }

  protected update(dt: number): boolean {
    const r = this.runner;
    if (this.once('shout', 0.4)) this.say(r, 'Ihr kriegt mich NIEMALS!');
    // Flüchtiger rennt auf der Fahrbahn (Comic-Logik), bis ihn das erste Auto erwischt
    if (this.hitAt < 0) {
      if (r.rt > 0 || !this.alive(r)) this.hitAt = this.t;
      else {
        this.rs += 6.6 * dt;
        const q = this.at(this.rs + 3);
        this.run(r, q.x, q.z, dt, 6.6);
        if (this.t > 2.5 && this.once('taunt', 2.5)) this.say(r, 'Bullen-Taxi! Hahaaa!');
      }
    }
    this.cops.forEach((v, i) => {
      if (this.hitAt < 0) {
        // vorderster Wagen hält direkt auf den Flüchtigen zu, die anderen folgen der Spur
        const tgt = i === 0 && this.alive(r) && dist2(r.x, r.z, v.sim.car.x, v.sim.car.z) < 35 * 35 ? { x: r.x, z: r.z } : undefined;
        this.drive(v, 16, tgt); // Sirene spielt der Client für Streifenwagen ab 13 m/s selbst
      } else if (this.t - this.hitAt < 3.5) {
        this.drive(v, i === 0 ? 4 : 9, undefined, 0); // bremsen, die anderen rollen noch drüber
      } else {
        this.drive(v, 15, undefined, 0); // „Weiter, hier gibt's nichts zu sehen“
      }
    });
    if (this.hitAt >= 0) {
      const since = this.t - this.hitAt;
      if (this.standing(r) && since > 1) {
        if (this.once('up', 0)) this.say(r, 'Haha! Nicht mal ein Kratzer!');
        if (this.once('away', this.hitAt + 2.2)) { const c = this.at(0, 30); this.release(r, c.x, c.z); }
      }
      if (since > 6) return this.sweepDriving() && since < 22;
    }
    return this.t < 22;
  }
}

/** 2. Bazooka: Wütender Typ schießt mit dem Raketenwerfer auf ein geparktes Auto – das falsche. */
class BazookaScene extends Scene {
  readonly kind = 1;
  readonly duration = 9;
  private shooter: Ped;
  private target: ServerVehicle;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    const e = lane.edge;
    const curb = e.width / 2 - laneOffset(e, 0) - 1.1;
    const f = this.flip;
    this.target = this.car(V_COMPACT, this.freeSpot([5 * f, 1 * f, 9 * f, -3 * f], curb), curb, DRIVER_NONE, Math.floor(Math.random() * 10));
    // Schütze auf der Straßenseite des Spielers, ein paar Meter neben ihm, schießt quer über die Straße
    let s = this.walkSide(-5 * f, false);
    if (dist2(s.x, s.z, viewer.pawn.x, viewer.pawn.z) < 3 * 3) s = this.walkSide(-8 * f, false);
    this.shooter = this.ped(s.x, s.z, 9, ROCKET);
    this.face(this.shooter, this.target.sim.car.x, this.target.sim.car.z);
  }

  protected update(): boolean {
    const p = this.shooter, c = this.target.sim.car;
    if (this.once('a', 0.6)) this.say(p, 'Das ist MEIN Parkplatz!!!');
    if (this.t < 2.6) this.face(p, c.x, c.z);
    if (this.once('fire', 2.6) && this.standing(p) && this.exists(this.target)) {
      this.shoot(p, c.x, c.z, ROCKET, 0);
      this.h.explode(this.target);
      this.h.scare(c.x, c.z, 40);
    }
    if (this.once('b', 4)) this.say(p, '…Moment. Meiner war blau.');
    if (this.once('c', 6)) { this.say(p, 'Ups.'); this.release(p, c.x, c.z); }
    return this.t < 8;
  }
}

/** 3. Straßenrennen: Zwei Raser, einer räumt ein geparktes Auto ab, das in Flammen aufgeht. */
class RaceScene extends Scene {
  readonly kind = 2;
  readonly duration = 15;
  private a: ServerVehicle;
  private b: ServerVehicle;
  private parked: ServerVehicle;
  private crashed = -1;
  private top = 0;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    const e = lane.edge;
    const curb = e.width / 2 - laneOffset(e, 0) - 1.1;
    this.clearRoute(-80, 35);
    // steht kurz vor dem Spieler (in Fahrtrichtung): wird beim Einschlag ein Stück mitgeschoben
    this.parked = this.car(V_SEDAN, this.freeSpot([-6, -10, -2, -14], curb), curb, DRIVER_NONE, Math.floor(Math.random() * 10));
    this.a = this.car(V_SPORT, -70, 0, DRIVER_NPC, 2, 22);
    // zweiter Raser klebt ihm an der Stoßstange und weicht dem Unfall gerade noch aus
    this.b = this.car(V_MUSCLE, -82, 0, DRIVER_NPC, 6, 22);
  }

  protected update(): boolean {
    const pc = this.parked.sim.car, ac = this.a.sim.car;
    const honk = this.t % 0.8 < 0.3 ? Btn.HORN : 0;
    const speedA = Math.hypot(ac.vx, ac.vz);
    this.top = Math.max(this.top, speedA);
    if (this.crashed < 0) {
      const toParked = Math.hypot(pc.x - ac.x, pc.z - ac.z);
      // A verliert kurz vor dem geparkten Auto die Kontrolle, hält drauf und bremst zu spät
      const tgt = toParked < 28 ? { x: pc.x, z: pc.z } : undefined;
      this.drive(this.a, toParked < 20 ? 14 : 24, tgt, 0, honk);
      const hit = toParked < (this.a.sim.prof.length + this.parked.sim.prof.length) / 2 + 0.8;
      if (hit || (this.top > 15 && speedA < this.top * 0.45) || this.t > 9) {
        this.crashed = this.t;
        // Was A gerammt hat (meist das geparkte Auto, manchmal ein Verkehrsauto), fängt Feuer –
        // außer es steht zu nah an einem Spieler oder ein Spieler sitzt drin.
        let victim: ServerVehicle | null = null, bd = 7 * 7;
        for (const o of this.h.vehicles.values()) {
          if (o === this.a || o === this.b || o.driver >= 0 || o.sim.dmg.wreck) continue;
          const d = dist2(o.sim.car.x, o.sim.car.z, ac.x, ac.z);
          if (d < bd) { bd = d; victim = o; }
        }
        if (victim && this.unseen(victim.sim.car.x, victim.sim.car.z, 7.5)) {
          victim.sim.dmg.burn = Math.max(victim.sim.dmg.burn, BURN_TIME - 1.3); // kurz brennen, dann BUMM
          victim.dmgVer++;
        }
      }
    } else if (this.t - this.crashed < 1.5) {
      this.drive(this.a, 0);
    } else if (this.once('out', this.crashed + 1.5) && this.exists(this.a)) {
      this.h.driverOut(this.a, true);
      this.cars = this.cars.filter((v) => v !== this.a); // Wrack bleibt als normales Fahrzeug liegen
    }
    this.drive(this.b, 25, undefined, 0, honk);
    if (this.crashed >= 0 && this.t - this.crashed > 2 && this.once('say', 0)) {
      // wütender Fahrer (von driverOut erzeugt) – Sprechblase an den nächsten Passanten neben dem Wrack
      let best: Ped | null = null, bd = 8 * 8;
      for (const p of this.h.peds.peds.values()) {
        const d = dist2(p.x, p.z, ac.x, ac.z);
        if (p.angry > 0 && d < bd) { bd = d; best = p; }
      }
      if (best) this.h.emit(best.x, best.z, ['say', best.id, 'MEIN LACK!! Der war frisch poliert!']);
    }
    const done = this.crashed >= 0 && this.t - this.crashed > 7;
    if (done) return this.sweepDriving() && this.t < 25;
    return this.t < 25;
  }
}

/** 4. Schießerei: Zwei Gangster ballern sich daneben, bis beiden die Munition ausgeht. */
class ShootoutScene extends Scene {
  readonly kind = 3;
  readonly duration = 14;
  private g1: Ped;
  private g2: Ped;
  private next = 2.6;
  private turn = 0;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    // quer über die Straße: einer auf der Seite des Spielers, einer gegenüber
    const a = this.walkSide(-5 * this.flip, false), b = this.walkSide(8 * this.flip, true);
    this.g1 = this.ped(a.x, a.z, GANG_OUTFIT.neon, PISTOL);
    this.g2 = this.ped(b.x, b.z, GANG_OUTFIT.marlin, PISTOL);
    this.face(this.g1, b.x, b.z); this.face(this.g2, a.x, a.z);
  }

  protected update(): boolean {
    const { g1, g2 } = this;
    if (this.once('a', 0.5)) this.say(g1, 'Das ist UNSER Block!');
    if (this.once('b', 1.7)) this.say(g2, 'Träum weiter, Kumpel!');
    if (this.t >= this.next && this.t < 7) {
      const [s, o] = this.turn++ % 2 === 0 ? [g1, g2] : [g2, g1];
      this.shoot(s, o.x, o.z, PISTOL, 1.8 + Math.random() * 2.5); // treffen nie
      this.next = this.t + 0.25 + Math.random() * 0.45;
    }
    if (this.t < 7) return true;
    if (this.once('c', 7.4)) this.say(g1, '*klick* … *klick*');
    if (this.once('d', 8.6)) this.say(g2, 'Hast du noch Munition?');
    if (this.once('e', 10)) this.say(g1, '…Nö. Du?');
    if (this.once('f', 11.4)) this.say(g2, 'Nö. Morgen gleiche Zeit?');
    if (this.once('g', 12.6)) this.say(g1, 'Abgemacht.');
    if (this.once('h', 13.2)) { this.release(g1, g2.x, g2.z); this.release(g2, g1.x, g1.z); }
    return this.t < 14;
  }
}

/** 5. Brennendes Geisterauto: rollt die Straße runter, Besitzer rennt schreiend hinterher – BUMM. */
class GhostCarScene extends Scene {
  readonly kind = 4;
  readonly duration = 11;
  private carV: ServerVehicle;
  private owner: Ped;
  private os: number;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    // 5 s Brenndauer (BURN_TIME): 4,4 s mit 7 m/s, dann rollt es führerlos aus und explodiert knapp
    // vor dem Spieler. Der Besitzer rennt hinterher und bleibt kurz vorher keuchend stehen.
    const start = 2 * this.flip - 35;
    this.os = start - 5;
    this.clearRoute(start - 10, 25);
    this.carV = this.car(V_MUSCLE, start, 0, DRIVER_NPC, 7, 7);
    this.carV.sim.dmg.burn = 0.0001;
    this.carV.dmgVer++;
    const q = this.at(this.os);
    this.owner = this.ped(q.x, q.z, 5);
  }

  protected update(dt: number): boolean {
    const o = this.owner, v = this.carV;
    if (this.exists(v) && !v.sim.dmg.wreck) {
      // vor der Explosion: niemand am Steuer (sonst würde ein Fahrer herausspringen)
      if (v.sim.dmg.burn > 4.4 && v.driver === DRIVER_NPC) v.driver = DRIVER_NONE;
      if (v.driver === DRIVER_NPC) this.drive(v, 7);
    }
    if (this.t < 4.4) {
      this.os += 7.4 * dt;
      const q = this.at(this.os + 3);
      this.run(o, q.x, q.z, dt, 7.4);
    } else this.face(o, v.sim.car.x, v.sim.car.z);
    if (this.once('a', 0.3)) this.say(o, 'MEIN AUTOOO!!');
    if (this.once('b', 2.6)) this.say(o, 'Halt! Ich hab gestern die letzte Rate bezahlt!');
    if (this.once('c', 6.4)) this.say(o, '…Versichert war er auch nicht.');
    if (this.once('d', 9.5)) { const c = this.at(0, 20); this.release(o, c.x, c.z); }
    return this.t < 10;
  }
}

// ------------------------------------------------------------------ Hilfen

/** Projektion eines Punkts auf eine Polylinie: Bogenlänge s und Abstand d. */
function project(pts: Vec2[], cum: number[], x: number, z: number): { s: number; d: number } {
  let bs = 0, bd = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (r.d < bd) { bd = r.d; bs = cum[k - 1] + r.t * (cum[k] - cum[k - 1]); }
  }
  return { s: bs, d: bd };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function polyLen(p: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

function round2(n: number) { return Math.round(n * 100) / 100; }
