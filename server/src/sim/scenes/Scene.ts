// Grundlagen der geskripteten Szenen (Ankunftsszenen und Straßenereignisse): Host-Schnittstelle zum
// WorldRoom, Spursuche auf dem Straßennetz und die Szenen-Basisklasse mit Bausteinen (Figuren, Fahren
// mit Ausweichen, Schüsse, Sprechblasen, Aufräumen).
import { clamp, dist2, wrapAngle } from '../../../../shared/src/math';
import { findFootSpot, stepPawn } from '../../../../shared/src/sim/movement';
import { cumulative, distToSegment, offsetPolyline, pointAt, type Vec2 } from '../../../../shared/src/world/geometry';
import { drivablePath, laneOffset } from '../../../../shared/src/world/roads';
import { RoadType, type RoadEdge, type WorldMap } from '../../../../shared/src/world/WorldMap';
import { NpcEv, type NpcEvId } from '../../../../shared/src/npc/reactions';
import { WEAPONS } from '../../../../shared/src/weapons';
import { DRIVER_COP, DRIVER_NONE, DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../../entities/types';
import { nearestIdx, type Ped, type Pedestrians } from '../Pedestrians';

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
  /** NPC-Wahrnehmung (Schüsse, Sirene …): Passanten reagieren mit Panik, Filmen, Ducken. */
  perceive(ev: NpcEvId, x: number, z: number): void;
  hurtPlayer(p: ServerPlayer, dmg: number): void;
  /** Blutspritzer (kind 0 = Treffer, 1 = angefahren, 2 = überfahren). */
  blood(x: number, z: number, amount: number, dx: number, dz: number, kind: number): void;
  /** Fahrzeug an den normalen Verkehr übergeben (fährt dem Straßennetz nach). false = keine Straße in der Nähe. */
  toTraffic(v: ServerVehicle): boolean;
  /** Spieler ist gerade anderweitig beschäftigt (Rennen, Catch the Taxi): keine Ereignisse um ihn herum. */
  busy(p: ServerPlayer): boolean;
}

/** Eine Fahrspur als Polylinie mit Bogenlänge; s0 = Stelle direkt vor dem Spieler. */
export interface Lane {
  edge: RoadEdge;
  forward: boolean;
  pts: Vec2[];
  cum: number[];
  len: number;
  s0: number;
}

// ------------------------------------------------------------------ Spursuche

/**
 * Fahrspur in der Nähe suchen, auf der die Szene Platz hat. Kurze Straßenstücke werden über Kreuzungen
 * hinweg zu einer möglichst geraden Route verkettet. Bevorzugt die Spur, die weiter vom Spieler weg liegt
 * (Action auf der anderen Straßenseite, gut im Blick und nicht direkt auf ihm).
 */
export function findLane(map: WorldMap, x: number, z: number, back: number, fwd: number, maxNear = 20): Lane | null {
  let best: Lane | null = null, bestScore = -Infinity;
  for (const e of map.edges) {
    if (e.type === RoadType.Pier) continue;
    let near = Infinity;
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k];
      if (Math.abs(a[0] - x) > 80 || Math.abs(a[1] - z) > 80) continue;
      near = Math.min(near, distToSegment(x, z, a[0], a[1], b[0], b[1]).d);
    }
    if (near > maxNear) continue; // muss im Bild sein (Kamera zu Fuß zeigt nur ~±14 m)
    for (const forward of [true, false]) {
      const pts = route(map, e, forward, back + 30, fwd + 30);
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
function route(map: WorldMap, e: RoadEdge, forward: boolean, back: number, fwd: number): Vec2[] {
  const lanePts = (edge: RoadEdge, f: boolean) => offsetPolyline(drivablePath(edge, f), laneOffset(edge, 0));
  let pts = lanePts(e, forward);
  const used = new Set([e.id]);
  // vorwärts
  let node = forward ? e.b : e.a, len = 0;
  for (let n = 0; n < 6 && len < fwd; n++) {
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const dir = Math.atan2(end[0] - prev[0], end[1] - prev[1]);
    const next = straightest(map, map.nodes[node]?.edges ?? [], node, dir, used, true);
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
    const prev = straightest(map, map.nodes[node]?.edges ?? [], node, dir, used, false);
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
function straightest(map: WorldMap, ids: number[], node: number, dir: number, used: Set<number>, out: boolean): { e: RoadEdge; f: boolean } | null {
  let best: { e: RoadEdge; f: boolean } | null = null, bd = 0.7;
  for (const id of ids) {
    const e = map.edges[id];
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

// ------------------------------------------------------------------ Szenen-Basis

export abstract class Scene {
  t = 0;
  abstract readonly name: string;
  /** Wo die Szene spielt (ds relativ zu s0) – damit Ereignisse sich nicht stapeln. */
  protected focus = 0;
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

  /** Mittelpunkt der Szene in Weltkoordinaten. */
  get where(): { x: number; z: number } { return this.at(this.focus); }

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

  protected ped(x: number, z: number, color: number, wpn = -1, hp = 80): Ped {
    const p = this.h.peds.spawnExt(x, z, { color, hp });
    p.wpn = wpn;
    this.peds.push(p);
    return p;
  }

  /** Polizist in Uniform (von der Szene gesteuert, nicht von der Fahndung). */
  protected officer(x: number, z: number, hp = 70): Ped {
    const p = this.ped(x, z, 3, -1, hp);
    p.police = true;
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

  /** Ped an die normale Fußgänger-Logik übergeben: schlendert auf dem nächsten Gehweg weiter und verschwindet später. */
  protected stroll(p: Ped, ttl = 30) {
    if (!this.alive(p)) return;
    const w = this.h.peds.nearestWalkway(p.x, p.z);
    p.ext = false; p.flee = 0; p.wait = 0; p.ttl = ttl; p.act = 0;
    if (w) { p.walk = w; p.idx = nearestIdx(w, p.x, p.z); p.dir = Math.random() < 0.5 ? 1 : -1; }
    else { p.walk = null; p.flee = 4; }
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

  // ---------------------------------------------------------------- Gefecht
  protected fighters: Fighter[] = [];
  private scareT = 0;

  protected addFighter(ped: Ped, team: 0 | 1, wpn: number) {
    const f: Fighter = { ped, team, wpn, cd: 0.4 + Math.random() * 1.5, home: { x: ped.x, z: ped.z }, moveT: Math.random() * 2, tx: ped.x, tz: ped.z };
    this.fighters.push(f);
    return f;
  }

  /** Stehende Kämpfer eines Teams. */
  protected standingIn(team: 0 | 1): Fighter[] { return this.fighters.filter((f) => f.team === team && this.standing(f.ped)); }
  /** Kämpfer eines Teams, die noch nicht besiegt sind (auch gerade umgeworfene). */
  protected aliveIn(team: 0 | 1): Fighter[] { return this.fighters.filter((f) => f.team === team && this.alive(f.ped)); }

  /**
   * Ein Gefechts-Tick: Jeder stehende Kämpfer wechselt ab und zu die Deckung (kleine Wege um seinen Platz)
   * und schießt auf den nächsten Gegner. Treffer kosten echte Lebenspunkte (umfallen, besiegt = verschwinden),
   * Fehlschüsse fliegen daneben – und wer in der Schusslinie steht, kann einen Querschläger abbekommen.
   * onDown: Rückmeldung, wenn ein Gegner fällt (für Sprechblasen).
   */
  protected fight(dt: number, onDown?: (shooter: Fighter, victim: Fighter) => void) {
    this.scareT -= dt;
    for (const f of this.fighters) {
      const me = f.ped;
      if (!this.standing(me)) continue;
      let target: Fighter | null = null, td = 45 * 45;
      for (const o of this.fighters) {
        if (o.team === f.team || !this.standing(o.ped)) continue;
        const d = dist2(o.ped.x, o.ped.z, me.x, me.z);
        if (d < td) { td = d; target = o; }
      }
      if (!target) { me.flee = 0; continue; }
      // Deckung wechseln
      f.moveT -= dt;
      if (f.moveT <= 0) {
        f.moveT = 1.2 + Math.random() * 2.6;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.8;
        const spot = findFootSpot(this.h.map, f.home.x + Math.cos(a) * r, f.home.z + Math.sin(a) * r, 2) ?? f.home;
        f.tx = spot.x; f.tz = spot.z;
      }
      if (Math.hypot(f.tx - me.x, f.tz - me.z) > 0.5) this.run(me, f.tx, f.tz, dt, 3.2);
      else this.face(me, target.ped.x, target.ped.z);
      f.cd -= dt;
      if (f.cd > 0) continue;
      const def = FIGHT_WEAPONS[f.wpn] ?? FIGHT_WEAPONS.default;
      f.cd = def.cd[0] + Math.random() * (def.cd[1] - def.cd[0]);
      const t = target.ped, d = Math.sqrt(td);
      me.a = Math.atan2(t.x - me.x, t.z - me.z);
      const hit = Math.random() < def.acc * clamp(1.25 - d / 35, 0.3, 1);
      const ang = Math.random() * Math.PI * 2, miss = 1.4 + Math.random() * 2.4;
      const ex = hit ? t.x : t.x + Math.cos(ang) * miss, ez = hit ? t.z : t.z + Math.sin(ang) * miss;
      for (let k = 0; k < def.pellets; k++) {
        const j = k === 0 ? 0 : 0.8;
        this.h.emit(me.x, me.z, ['shot', me.id, round2(me.x), round2(me.z), round2(ex + (Math.random() - 0.5) * j), round2(ez + (Math.random() - 0.5) * j), f.wpn]);
      }
      if (this.scareT <= 0) { this.scareT = 0.6; this.h.scare(me.x, me.z, 30); this.h.perceive(NPC_SHOT, me.x, me.z); }
      if (hit) {
        const dx = (t.x - me.x) / (d || 1), dz = (t.z - me.z) / (d || 1);
        const down = this.h.peds.hit(t, def.dmg, dx, dz);
        this.h.emit(t.x, t.z, ['hit', round2(t.x), round2(t.z), 0]);
        this.h.blood(t.x, t.z, Math.min(1, def.dmg / 40) + (down ? 0.5 : 0), dx, dz, 0);
        if (down) onDown?.(f, target);
      } else this.stray(me.x, me.z, ex, ez);
    }
  }

  /** Querschläger: Spieler zu Fuß nahe der Schusslinie werden mit etwas Pech getroffen. */
  private stray(x0: number, z0: number, x1: number, z1: number) {
    // Linie etwas über das Ziel hinaus verlängern
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const x2 = x1 + (dx / l) * 3, z2 = z1 + (dz / l) * 3;
    for (const p of this.h.players.values()) {
      if (p.vehicleId >= 0 || p.downT > 0 || p.invuln > 0) continue;
      if (distToSegment(p.pawn.x, p.pawn.z, x0, z0, x2, z2).d > 0.7 || Math.random() > 0.25) continue;
      this.h.hurtPlayer(p, 6);
      this.h.emit(p.pawn.x, p.pawn.z, ['hit', round2(p.pawn.x), round2(p.pawn.z), 1]);
      this.h.blood(p.pawn.x, p.pawn.z, 0.3, dx / l, dz / l, 0);
    }
  }

  /** Abschluss: Figuren laufen weg, eigene Fahrzeuge werden freigegeben (verschwinden später von selbst). */
  end() {
    const c = this.at(0);
    for (const p of this.peds) if (this.alive(p) && p.ext) this.release(p, c.x, c.z);
    for (const v of this.cars) {
      if (!this.exists(v)) continue;
      if (v.driver === DRIVER_COP || v.driver === DRIVER_NPC) {
        // Fahrende Szenen-Autos: außer Sicht einfach entfernen, sonst fahren sie im normalen Verkehr weiter
        if (this.unseen(v.sim.car.x, v.sim.car.z)) { v.driver = DRIVER_NONE; this.h.vehicles.delete(v.id); continue; }
        v.buttons = 0;
        if (v.sim.dmg.wreck || !this.h.toTraffic(v)) v.driver = DRIVER_NONE;
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

// ------------------------------------------------------------------ Hilfen

export interface Fighter {
  ped: Ped;
  team: 0 | 1;
  /** Waffen-Index (WEAPONS) – bestimmt Feuerrate, Treffsicherheit und Schaden (FIGHT_WEAPONS). */
  wpn: number;
  cd: number;
  home: { x: number; z: number };
  moveT: number;
  tx: number; tz: number;
}

const W = Object.keys(WEAPONS);
/** NPC-Gefechtswerte je Waffe: Abklingzeit [min, max], Trefferchance, Schaden, Schrotkugeln (nur Optik). */
const FIGHT_WEAPONS: Record<number | 'default', { cd: [number, number]; acc: number; dmg: number; pellets: number }> = {
  default: { cd: [0.9, 1.6], acc: 0.3, dmg: 13, pellets: 1 },
  [W.indexOf('pistol')]: { cd: [0.9, 1.6], acc: 0.3, dmg: 13, pellets: 1 },
  [W.indexOf('smg')]: { cd: [0.3, 0.55], acc: 0.18, dmg: 7, pellets: 1 },
  [W.indexOf('shotgun')]: { cd: [1.5, 2.3], acc: 0.4, dmg: 22, pellets: 3 },
  [W.indexOf('rifle')]: { cd: [1.2, 1.9], acc: 0.45, dmg: 18, pellets: 1 },
};
const NPC_SHOT = NpcEv.Shot;

/** Projektion eines Punkts auf eine Polylinie: Bogenlänge s und Abstand d. */
export function project(pts: Vec2[], cum: number[], x: number, z: number): { s: number; d: number } {
  let bs = 0, bd = Infinity;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (r.d < bd) { bd = r.d; bs = cum[k - 1] + r.t * (cum[k] - cum[k - 1]); }
  }
  return { s: bs, d: bd };
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function polyLen(p: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

export function round2(n: number) { return Math.round(n * 100) / 100; }
