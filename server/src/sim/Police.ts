// Fahndungssystem und Polizei-KI (Spec 11).
//  - Zeuge-Prinzip: Verbrechen zählen nur, wenn ein Polizist (sofort) oder ein Passant mit Sichtlinie
//    in 30 m (nach 3 s Meldeverzögerung) es sieht.
//  - Stufen 1–3: Streifen zu Fuß, ab Stufe 2 mit Schüssen, Streifenwagen die rammen.
//  - Abschütteln: außer Reichweite bleiben (20/35/60 s), Festnahme: zu Fuß still stehen, Polizist nah.
import { dist2, clamp, wrapAngle } from '../../../shared/src/math';
import { stepPawn, findFootSpot } from '../../../shared/src/sim/movement';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { WEAPONS } from '../../../shared/src/weapons';
import { DRIVER_COP, type ServerPlayer, type ServerVehicle } from '../entities/types';
import { wallDistance } from './Combat';
import type { Ped, Pedestrians } from './Pedestrians';

export const MAX_WANTED = 3;
/** Sekunden ohne Polizeikontakt, bis die Fahndung der jeweiligen Stufe endet (Spec 11.2). */
export const SHAKE_TIME = [20, 35, 60];
const TARGET_FOOT = [0, 2, 4, 5];
const TARGET_CARS = [0, 0, 1, 3];
const COP_SPEED = 8.6;
const COP_SIGHT = 55;
const WITNESS_RANGE = 30;
const COP_WITNESS_RANGE = 40;
const ARREST_TIME = 3;
const ARREST_RANGE = 2.6;
const GRACE = 5;
const PISTOL_IDX = Object.keys(WEAPONS).indexOf('pistol');

export interface PoliceHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  peds: Pedestrians;
  allocId(): number;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  hurtPlayer(p: ServerPlayer, dmg: number): void;
  /** Ein Tick Fahrzeugphysik für ein KI-Fahrzeug. */
  stepCar(v: ServerVehicle, ax: number, ay: number): void;
  createCopCar(x: number, z: number, a: number, target: number): ServerVehicle | null;
  emit(x: number, z: number, ev: (string | number)[]): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  arrest(p: ServerPlayer): void;
  /** Ein Passant hat das Verbrechen gesehen und ruft jetzt die Polizei (Animation + Bark). */
  witness?(ped: Ped, p: ServerPlayer, x: number, z: number): void;
}

interface CarBrain { stuck: number; reverse: number }

export class Police {
  private cd = new Map<number, number>(); // Schuss-Abklingzeit je Polizist
  private cars = new Map<number, CarBrain>();
  private gone = new Map<number, number>(); // Spieler-ID -> Sekunden seit Fahndungsende
  private lastPos = new Map<number, { x: number; z: number }>();
  private spawnT = 0;

  constructor(private h: PoliceHost) {}

  // ------------------------------------------------------------------ Verbrechen
  /** Verbrechen melden: wirkt nur mit Zeugen (Spec 11.2). */
  crime(p: ServerPlayer, level: number, x: number, z: number) {
    if (this.copNear(x, z, COP_WITNESS_RANGE)) { this.raise(p, level); return; }
    const w = this.pedWitness(x, z);
    if (!w) return;
    // Meldung hängt am Zeugen: wird er vorher umgehauen oder verschwindet er, kommt sie nie an
    if (p.reports.some((r) => r.by === w.id && r.level >= level)) return;
    p.reports.push({ t: 3, level, by: w.id });
    this.h.witness?.(w, p, x, z);
  }

  /** Fahndungsstufe sofort erhöhen (Polizist hat es gesehen oder Passant hat gemeldet). */
  raise(p: ServerPlayer, level: number) {
    p.searchT = 0;
    const lvl = Math.min(MAX_WANTED, Math.max(0, Math.floor(level)));
    if (lvl > p.wanted) {
      p.wanted = lvl;
      this.h.notice(p, `Fahndungsstufe ${lvl}!`, 'bad');
    }
  }

  private copNear(x: number, z: number, r: number): boolean {
    for (const c of this.h.peds.peds.values()) if (c.cop && c.hp > 0 && dist2(c.x, c.z, x, z) < r * r) return true;
    for (const v of this.h.vehicles.values()) if (v.cop !== undefined && dist2(v.sim.car.x, v.sim.car.z, x, z) < r * r) return true;
    return false;
  }

  /** Nächster Passant mit Sichtlinie in 30 m (Gang-/Quest-Figuren melden nichts). */
  private pedWitness(x: number, z: number): Ped | null {
    let best: Ped | null = null, bd = Infinity;
    for (const c of this.h.peds.peds.values()) {
      if (c.cop || c.ext || c.hp <= 0 || c.rt > 0) continue;
      const d = Math.sqrt(dist2(c.x, c.z, x, z));
      if (d > WITNESS_RANGE || d >= bd) continue;
      if (d < 2 || wallDistance(this.h.map, x, z, Math.atan2(c.x - x, c.z - z), d) >= d - 1) { best = c; bd = d; }
    }
    return best;
  }

  /** Nächste Entfernung zu einem Polizisten/Streifenwagen des Spielers (Infinity = keiner). */
  nearestCop(p: ServerPlayer): number {
    const pos = this.h.positionOf(p);
    let best = Infinity;
    for (const c of this.h.peds.peds.values()) if (c.cop === p.id && c.hp > 0) best = Math.min(best, dist2(c.x, c.z, pos.x, pos.z));
    for (const v of this.h.vehicles.values()) if (v.cop === p.id) best = Math.min(best, dist2(v.sim.car.x, v.sim.car.z, pos.x, pos.z));
    return Math.sqrt(best);
  }

  /** Polizei in Sichtweite (für Lackierwerkstatt, nicht bei Sichtkontakt). */
  copInSight(p: ServerPlayer, r = 45): boolean {
    const pos = this.h.positionOf(p);
    return this.copNear(pos.x, pos.z, r);
  }

  // ------------------------------------------------------------------ Tick
  update(dt: number) {
    this.spawnT -= dt;
    for (const p of this.h.players.values()) {
      for (let i = p.reports.length - 1; i >= 0; i--) {
        const r = p.reports[i];
        r.t -= dt;
        if (r.by !== undefined) {
          const w = this.h.peds.peds.get(r.by);
          if (!w || w.hp <= 0 || w.rt > 0) { p.reports.splice(i, 1); continue; } // Zeuge ausgeschaltet
        }
        if (r.t <= 0) { p.reports.splice(i, 1); if (p.downT <= 0) this.raise(p, r.level); }
      }
      if (p.wanted > 0) { this.gone.delete(p.id); this.chase(p, dt); } else this.dismiss(p, dt);
    }
    // Polizisten ohne Spieler (ausgeloggt) entfernen
    for (const c of [...this.h.peds.peds.values()]) if (c.cop && !this.h.players.has(c.cop)) this.h.peds.peds.delete(c.id);
    for (const v of [...this.h.vehicles.values()]) if (v.cop !== undefined && !this.h.players.has(v.cop)) this.removeCar(v.id);
    for (const id of this.cars.keys()) if (!this.h.vehicles.has(id)) this.cars.delete(id);
  }

  /** Fahndung beendet: Polizei zieht nach kurzer Zeit ab. */
  private dismiss(p: ServerPlayer, dt: number) {
    p.arrestT = 0;
    const own = [...this.h.peds.peds.values()].filter((c) => c.cop === p.id);
    const ownCars = [...this.h.vehicles.values()].filter((v) => v.cop === p.id);
    if (!own.length && !ownCars.length) return;
    const t = (this.gone.get(p.id) ?? 0) + dt;
    this.gone.set(p.id, t);
    if (t < GRACE) return;
    for (const c of own) this.h.peds.peds.delete(c.id);
    for (const v of ownCars) this.removeCar(v.id);
    this.gone.delete(p.id);
  }

  private removeCar(id: number) {
    const v = this.h.vehicles.get(id);
    if (v) v.driver = -1; // sonst bliebe das Fahrzeug als "besetzt" markiert
    this.h.vehicles.delete(id);
    this.cars.delete(id);
  }

  private chase(p: ServerPlayer, dt: number) {
    if (p.downT > 0) return;
    const pos = this.h.positionOf(p);
    const foot = [...this.h.peds.peds.values()].filter((c) => c.cop === p.id && c.hp > 0);
    const cars = [...this.h.vehicles.values()].filter((v) => v.cop === p.id);

    // Nachschub
    if (this.spawnT <= 0) {
      if (foot.length < TARGET_FOOT[p.wanted]) { this.spawnFoot(p, pos); this.spawnT = 1.2; }
      else if (cars.length < TARGET_CARS[p.wanted]) { this.spawnCar(p, pos); this.spawnT = 2.5; }
    }

    // Zu Fuß: hinterherlaufen, ab Stufe 2 schießen
    let arresting = false;
    const speed = this.speedOf(p, pos, dt);
    for (const c of foot) {
      if (c.rt > 0) continue;
      const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz) || 1;
      if (d > 1.8) stepPawn(this.h.map, c, dx / d, -dz / d, 0, dt, COP_SPEED);
      else c.a = Math.atan2(dx, dz);
      if (!pos.inVehicle && d < ARREST_RANGE) arresting = true;
      if (p.wanted >= 2 && d > 4 && d < 26) this.shoot(c, p, pos, d, dt);
    }
    // Festnahme: zu Fuß, nahezu still, Polizist in Reichweite
    if (arresting && !pos.inVehicle && speed < 1.5) {
      p.arrestT += dt;
      if (p.arrestT >= ARREST_TIME) { p.arrestT = 0; this.h.arrest(p); this.clearOwned(p); return; }
    } else p.arrestT = Math.max(0, p.arrestT - dt * 2);

    for (const v of cars) this.driveCar(v, pos, dt);

    // Abschütteln: ohne Polizeikontakt in Sichtweite
    if (this.nearestCop(p) > COP_SIGHT) {
      p.searchT += dt;
      if (p.searchT >= SHAKE_TIME[p.wanted - 1]) {
        p.wanted = 0; p.searchT = 0;
        this.h.notice(p, 'Du hast die Polizei abgeschüttelt.', 'good');
      }
    } else p.searchT = 0;
  }

  private clearOwned(p: ServerPlayer) {
    for (const c of [...this.h.peds.peds.values()]) if (c.cop === p.id) this.h.peds.peds.delete(c.id);
    for (const v of [...this.h.vehicles.values()]) if (v.cop === p.id) this.removeCar(v.id);
  }

  private speedOf(p: ServerPlayer, pos: { x: number; z: number }, dt: number): number {
    const last = this.lastPos.get(p.id);
    this.lastPos.set(p.id, { x: pos.x, z: pos.z });
    return last && dt > 0 ? Math.hypot(pos.x - last.x, pos.z - last.z) / dt : 0;
  }

  private shoot(c: { id: number; x: number; z: number }, p: ServerPlayer, pos: { x: number; z: number }, d: number, dt: number) {
    const cd = (this.cd.get(c.id) ?? Math.random()) - dt;
    if (cd > 0) { this.cd.set(c.id, cd); return; }
    this.cd.set(c.id, 1.1 + Math.random() * 0.6);
    const a = Math.atan2(pos.x - c.x, pos.z - c.z);
    if (wallDistance(this.h.map, c.x, c.z, a, d) < d - 1) return; // keine Sichtlinie
    const hit = Math.random() < 0.4;
    const miss = hit ? 0 : (Math.random() - 0.5) * 3;
    this.h.emit(c.x, c.z, ['shot', c.id, c.x, c.z, pos.x + miss, pos.z + miss, PISTOL_IDX]);
    if (hit) this.h.hurtPlayer(p, 6);
  }

  private spawnFoot(p: ServerPlayer, pos: { x: number; z: number }) {
    for (let t = 0; t < 12; t++) {
      const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 30;
      const spot = findFootSpot(this.h.map, pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 4);
      if (!spot || dist2(spot.x, spot.z, pos.x, pos.z) < 45 * 45) continue;
      this.h.peds.spawnCop(spot.x, spot.z, p.id);
      return;
    }
  }

  private spawnCar(p: ServerPlayer, pos: { x: number; z: number }) {
    const nodes = this.h.map.nodes;
    for (let t = 0; t < 60; t++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      const d2 = dist2(n.x, n.z, pos.x, pos.z);
      if (d2 < 90 * 90 || d2 > 170 * 170 || n.roundabout || this.h.map.tileAt(n.x, n.z) !== Tile.ROAD) continue;
      const v = this.h.createCopCar(n.x, n.z, Math.atan2(pos.x - n.x, pos.z - n.z), p.id);
      if (v) this.cars.set(v.id, { stuck: 0, reverse: 0 });
      return;
    }
  }

  /** Einfache Verfolgung: auf den Spieler zulenken, Gas geben, bei Festklemmen zurücksetzen. */
  private driveCar(v: ServerVehicle, pos: { x: number; z: number }, dt: number) {
    const c = v.sim.car;
    if (v.sim.dmg.wreck) return;
    const brain = this.cars.get(v.id) ?? { stuck: 0, reverse: 0 };
    this.cars.set(v.id, brain);
    const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz);
    const diff = wrapAngle(Math.atan2(dx, dz) - c.a);
    const speed = Math.hypot(c.vx, c.vz);
    if (speed < 1.5 && d > 8) brain.stuck += dt; else brain.stuck = Math.max(0, brain.stuck - dt);
    if (brain.stuck > 2) { brain.reverse = 1.4; brain.stuck = 0; }
    let ax = clamp(-diff * 1.8, -1, 1);
    let ay = d > 14 ? 1 : d > 5 ? 0.6 : 0.2;
    if (Math.abs(diff) > 1.2 && speed > 12) ay = 0.2;
    if (brain.reverse > 0) { brain.reverse -= dt; ay = -1; ax = -ax; }
    this.h.stepCar(v, ax, ay);
  }
}

