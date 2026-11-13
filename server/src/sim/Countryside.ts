// Leben und Regeln auf dem Land (Norden): Höfe sind neutrales Gebiet, aber Farmer reagieren
// empfindlich auf Schäden – durchbrochene Zäune und angefahrene Tiere senken die Stimmung des Hofs,
// wiederholt rufen die Farmer den County Sheriff. Der Sheriff ersetzt im Norden die Stadtpolizei
// (Police.ts: weniger Streifen, hartnäckiger) und baut ab Fahndungsstufe 2 Straßensperren aus
// Traktoren. Außerdem: Dustline-Truckstop (zweites Hauptquartier) und Steinbruch-Sprengung.
import { dist2 } from '../../../shared/src/math';
import { SMALLTOWN_DISTRICTS } from '../../../shared/src/npc/countryside';
import { variantByName } from '../../../shared/src/sim/handling';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { FARMS, farmAt, farmFences, type FarmDef } from '../../../shared/src/world/farms';
import { pointAt } from '../../../shared/src/world/geometry';
import { ruralArea } from '../../../shared/src/world/north';
import { OKEE_PLACES } from '../../../shared/src/world/okeePeak';
import { RoadType, type WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, type ServerPlayer, type ServerVehicle } from '../entities/types';

export const SHERIFF_VARIANT = variantByName('County Sheriff');
const TRACTOR_VARIANT = variantByName('Field King 400');
/** Zaun gilt als durchbrochen ab diesem Tempo (m/s). */
const FENCE_SPEED = 3.5;
/** Repariert nach (s). */
const FENCE_REPAIR = 480;
/** Ärger je Spieler: ab diesem Wert ruft der Hof den Sheriff. */
const CALL_SHERIFF = 2;

export interface CountrysideHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  allocId(): number;
  emit(x: number, z: number, ev: (string | number)[]): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  /** Verbrechen melden (Police.crime) – heat-Punkte. */
  crime(p: ServerPlayer, heat: number, x: number, z: number): void;
}

interface Seg { ax: number; az: number; bx: number; bz: number; farm: string }

export class Countryside {
  /** Stimmung je Hof 0–100 (Start 75; erholt sich langsam). */
  readonly mood = new Map<string, number>(FARMS.map((f) => [f.id, 75]));
  private broken = new Map<number, number>();
  private segs: Seg[] = farmFences();
  private grid = new Map<number, number[]>();
  private last = new Map<number, { x: number; z: number }>();
  private anger = new Map<number, { n: number; t: number }>();
  private blocks: { id: number; t: number }[] = [];
  private blockCd = new Map<number, number>();
  private clock = 0;
  private ruralCache = new Map<number, boolean>();

  constructor(private h: CountrysideHost) {
    this.segs.forEach((s, i) => {
      const n = Math.ceil(Math.hypot(s.bx - s.ax, s.bz - s.az) / 8);
      for (let k = 0; k <= n; k++) {
        const x = s.ax + ((s.bx - s.ax) * k) / n, z = s.az + ((s.bz - s.az) * k) / n;
        const key = Math.floor(z / 16) * 4096 + Math.floor(x / 16);
        const l = this.grid.get(key) ?? [];
        if (!l.includes(i)) l.push(i);
        this.grid.set(key, l);
      }
    });
  }

  /** Norden/Land (Sheriff-Gebiet)? Gecacht auf 32-m-Raster. */
  isRural(x: number, z: number): boolean {
    const key = Math.floor(z / 32) * 4096 + Math.floor(x / 32);
    let r = this.ruralCache.get(key);
    if (r === undefined) {
      const d = this.h.map.districtAt(x, z)?.name;
      r = d ? SMALLTOWN_DISTRICTS.has(d) : (() => { const a = ruralArea(x, z, (px, pz) => this.h.map.zoneAt(px, pz)); return !!a && a !== 'Stadtrand'; })();
      this.ruralCache.set(key, r);
    }
    return r;
  }

  /** Durchbrochene Zäune (für neu verbundene Clients). */
  get brokenFences(): number[] { return [...this.broken.keys()]; }

  update(dt: number) {
    this.clock += dt;
    for (const [id, m] of this.mood) this.mood.set(id, Math.min(75, m + dt * 0.02));
    for (const [i, t] of this.broken) if (this.clock > t) { this.broken.delete(i); const s = this.segs[i]; this.h.emit((s.ax + s.bx) / 2, (s.az + s.bz) / 2, ['fenceFix', i]); }
    for (const p of this.h.players.values()) {
      const v = p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId) : undefined;
      if (!v) { this.last.delete(p.id); continue; }
      const c = v.sim.car;
      const prev = this.last.get(p.id);
      this.last.set(p.id, { x: c.x, z: c.z });
      if (!prev || Math.hypot(c.vx, c.vz) < FENCE_SPEED) continue;
      this.checkFences(p, prev.x, prev.z, c.x, c.z);
    }
    this.roadblocks(dt);
  }

  private checkFences(p: ServerPlayer, x0: number, z0: number, x1: number, z1: number) {
    const key = Math.floor(z1 / 16) * 4096 + Math.floor(x1 / 16);
    for (const i of this.grid.get(key) ?? []) {
      if (this.broken.has(i)) continue;
      const s = this.segs[i];
      if (!cross(x0, z0, x1, z1, s.ax, s.az, s.bx, s.bz)) continue;
      this.broken.set(i, this.clock + FENCE_REPAIR);
      this.h.emit(x1, z1, ['fence', i, Math.round(x1 * 10) / 10, Math.round(z1 * 10) / 10]);
      const f = FARMS.find((q) => q.id === s.farm);
      if (f) this.damage(p, f, 'Zaun', x1, z1);
    }
  }

  /** Tier angefahren/getroffen (Comic, ohne Verletzung) – der Hof ist trotzdem sauer. */
  animalHit(p: ServerPlayer, x: number, z: number) {
    const f = farmAt(x, z) ?? nearestFarm(x, z);
    if (f) this.damage(p, f, 'Tier', x, z);
  }

  private damage(p: ServerPlayer, f: FarmDef, what: 'Zaun' | 'Tier', x: number, z: number) {
    this.mood.set(f.id, Math.max(0, (this.mood.get(f.id) ?? 75) - (what === 'Tier' ? 8 : 5)));
    const a = this.anger.get(p.id);
    const n = a && this.clock - a.t < 90 ? a.n + 1 : 1;
    this.anger.set(p.id, { n, t: this.clock });
    if (n >= CALL_SHERIFF) {
      this.h.notice(p, `${f.regular.name} (${f.name}) ruft den County Sheriff!`, 'bad');
      this.h.crime(p, 1.2, x, z);
      this.anger.set(p.id, { n: 0, t: this.clock });
    } else {
      this.h.notice(p, what === 'Zaun' ? `${f.regular.name}: „Mein Zaun! Den hat mein Großvater gebaut!“` : `${f.regular.name}: „Lass meine Tiere in Ruhe!“`, 'bad');
    }
  }

  // ------------------------------------------------------------------ Sheriff-Straßensperren (Traktoren)
  private roadblocks(dt: number) {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      b.t -= dt;
      const v = this.h.vehicles.get(b.id);
      if (!v) { this.blocks.splice(i, 1); continue; }
      if (v.driver !== DRIVER_NONE) { this.blocks.splice(i, 1); continue; } // gestohlen: gehört jetzt dem Spieler
      const far = [...this.h.players.values()].every((p) => dist2(p.pawn.x, p.pawn.z, v.sim.car.x, v.sim.car.z) > 120 * 120);
      if (b.t <= 0 && far) { this.h.vehicles.delete(b.id); this.blocks.splice(i, 1); }
    }
    for (const p of this.h.players.values()) {
      if (p.wanted < 2 || p.vehicleId < 0) continue;
      const v = this.h.vehicles.get(p.vehicleId);
      if (!v) continue;
      const c = v.sim.car;
      if (!this.isRural(c.x, c.z)) continue;
      const cd = (this.blockCd.get(p.id) ?? 0) - dt;
      this.blockCd.set(p.id, cd);
      const speed = Math.hypot(c.vx, c.vz);
      if (cd > 0 || speed < 8 || this.blocks.length >= 3) continue;
      // Punkt ~80 m voraus auf der nächsten Straße, Traktor quer drüber
      const ax = c.x + (c.vx / speed) * 80, az = c.z + (c.vz / speed) * 80;
      let best: { x: number; z: number; rot: number } | null = null, bd = 18 * 18;
      for (const e of this.h.map.edges) {
        if (e.type === RoadType.Pier) continue;
        const m = e.pts[Math.floor(e.pts.length / 2)];
        if (Math.abs(m[0] - ax) > e.len / 2 + 30 || Math.abs(m[1] - az) > e.len / 2 + 30) continue;
        for (let s = 0; s < e.len; s += 4) {
          const q = pointAt(e.pts, e.cum, s);
          const d = dist2(q.x, q.z, ax, az);
          if (d < bd) { bd = d; best = { x: q.x, z: q.z, rot: Math.atan2(q.dx, q.dz) + Math.PI / 2 }; }
        }
      }
      if (!best || TRACTOR_VARIANT < 0) continue;
      const id = this.h.allocId();
      const sim = createSimVehicle(this.h.map, VehicleKind.Car, TRACTOR_VARIANT, best.x, best.z, best.rot);
      this.h.vehicles.set(id, { id, kind: VehicleKind.Car, color: 0, sim, driver: DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false });
      this.blocks.push({ id, t: 90 });
      this.blockCd.set(p.id, 35);
      this.h.notice(p, 'Straßensperre des Sheriffs voraus – ein Traktor quer über der Fahrbahn!', 'bad');
    }
  }

  // ------------------------------------------------------------------ Steinbruch
  /** Sprengung (Ereignis E54 / Dev): Sirene, Staubwolke, Kamera-Wackeln bei Spielern in der Nähe. */
  quarryBlast() {
    const Q = OKEE_PLACES.quarry;
    this.h.emit(Q.x, Q.z, ['blast', Q.x, Q.z]);
  }
}

function nearestFarm(x: number, z: number): FarmDef | null {
  let best: FarmDef | null = null, bd = 140 * 140;
  for (const f of FARMS) { const d = dist2(f.x, f.z, x, z); if (d < bd) { bd = d; best = f; } }
  return best;
}

/** Schneiden sich die Strecken a–b und c–d? */
function cross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): boolean {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
