// Luftfahrzeug-Flotte am Flughafen: Spawn der vier Luftfahrzeuge (aircraft.json), Respawn nach
// Zerstörung oder wenn sie weit weg abgestellt wurden, Tankstelle, Rangsperre, Bahnwarnungen
// (Spieler zu Fuß/im Auto auf einer Bahn, während ein Flugzeug startet oder landet).
import { dist2 } from '../../../shared/src/math';
import { AIR_SETTINGS, AIRCRAFT, aircraftById, aircraftColor, aircraftDef, airGround, isAircraftVariant, placeAircraft, type AircraftDef } from '../../../shared/src/sim/aircraft';
import { resetDamage } from '../../../shared/src/sim/damage';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind, isAircraft } from '../../../shared/src/sim/vehicleDefs';
import { rankIndex, rankOf } from '../../../shared/src/story';
import { AIR_FUEL, airSpawnPoint, onRunway, runwayNames } from '../../../shared/src/world/airport';
import { decoFlight } from '../../../shared/src/world/airTraffic';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, type ServerPlayer, type ServerVehicle } from '../entities/types';

export interface AirHost {
  map: WorldMap;
  vehicles: Map<number, ServerVehicle>;
  players: Map<number, ServerPlayer>;
  allocId(): number;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  /** Alle Insassen (Pilot + Mitfahrer) aussteigen lassen, bevor das Luftfahrzeug versetzt wird. */
  clearOccupants(v: ServerVehicle): void;
  /** Fahrzeug-Zustand an alle Clients neu senden (nach Reset). */
  resend(v: ServerVehicle): void;
}

export const kindOf = (d: AircraftDef) => (d.type === 'heli' ? VehicleKind.Heli : VehicleKind.Plane);

export class AirFleet {
  private warnAcc = 0;

  constructor(private h: AirHost) {
    for (const d of AIRCRAFT) if (d.spawn) this.spawnFleet(d);
  }

  private spawnFleet(d: AircraftDef) {
    const sp = airSpawnPoint(d.spawn);
    if (!sp) { console.warn(`[Luftfahrt] Unbekannter Startplatz "${d.spawn}" für ${d.name}`); return; }
    const id = this.h.allocId();
    const sim = createSimVehicle(this.h.map, kindOf(d), d.variant, sp.x, sp.z, sp.a);
    this.h.vehicles.set(id, {
      id, kind: kindOf(d), color: aircraftColor(d), sim, driver: DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false,
      air: { id: d.id, home: { x: sp.x, z: sp.z, a: sp.a }, deadT: 0, awayT: 0, warnT: 0 }, riders: [],
    });
  }

  /** Luftfahrzeug neben einem Spieler bereitstellen (Dev-Befehl). */
  spawnNear(id: string, x: number, z: number, a: number): ServerVehicle | null {
    const d = aircraftById(id);
    if (!d) return null;
    const vid = this.h.allocId();
    const sim = createSimVehicle(this.h.map, kindOf(d), d.variant, x, z, a);
    const v: ServerVehicle = { id: vid, kind: kindOf(d), color: aircraftColor(d), sim, driver: DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false, riders: [] };
    this.h.vehicles.set(vid, v);
    return v;
  }

  /** Darf der Spieler dieses Luftfahrzeug fliegen? null = ja, sonst Begründung. */
  pilotDenied(p: ServerPlayer, v: ServerVehicle): string | null {
    if (!AIR_SETTINGS.rankGate) return null;
    const d = aircraftDef(v.sim.variant);
    if (!d.minRank) return null;
    const need = rankIndex(d.minRank);
    const have = p.profile.story?.rank ?? 0;
    if (need >= 0 && have < need) return `${d.name}: Fliegen erst ab Rang „${rankOf(need).name}“. Mitfliegen geht schon.`;
    return null;
  }

  /** Freie Sitzplätze für Mitfahrer. */
  freeSeats(v: ServerVehicle): number {
    if (!isAircraft(v.kind) || !isAircraftVariant(v.sim.variant)) return 0;
    return aircraftDef(v.sim.variant).seats - 1 - (v.riders?.length ?? 0);
  }

  update(dt: number) {
    const players = [...this.h.players.values()];
    for (const v of this.h.vehicles.values()) {
      if (!v.air) continue;
      this.maintain(v, dt, players);
    }
    this.refuel(dt, players);
    this.warnAcc += dt;
    if (this.warnAcc >= 0.5) { this.runwayWarnings(this.warnAcc, players); this.warnAcc = 0; }
  }

  /** Zerstört oder weit weg abgestellt: nach Ablauf des Timers zurück auf den Startplatz. */
  private maintain(v: ServerVehicle, dt: number, players: ServerPlayer[]) {
    const a = v.air!, c = v.sim.car;
    const occupied = v.driver !== DRIVER_NONE || (v.riders?.length ?? 0) > 0;
    const nobodyNear = (x: number, z: number, r: number) => players.every((p) => { const q = this.h.positionOf(p); return dist2(q.x, q.z, x, z) > r * r; });
    if (v.sim.dmg.wreck) {
      a.deadT += dt;
      if (a.deadT > AIR_SETTINGS.respawnDestroyed && !occupied && nobodyNear(a.home.x, a.home.z, 25)) this.reset(v);
      return;
    }
    a.deadT = 0;
    const away = dist2(c.x, c.z, a.home.x, a.home.z) > AIR_SETTINGS.abandonDistance ** 2;
    if (!occupied && away) {
      a.awayT += dt;
      if (a.awayT > AIR_SETTINGS.respawnAbandoned && nobodyNear(c.x, c.z, 80) && nobodyNear(a.home.x, a.home.z, 25)) this.reset(v);
    } else a.awayT = 0;
  }

  reset(v: ServerVehicle) {
    const a = v.air;
    if (!a) return;
    this.h.clearOccupants(v);
    placeAircraft(this.h.map, v.sim.car, v.sim.variant, a.home.x, a.home.z, a.home.a);
    resetDamage(v.sim.dmg);
    v.dents = []; v.dmgVer++; a.deadT = 0; a.awayT = 0;
    this.h.resend(v);
  }

  /** Tankstelle: am Boden, langsam, im Tankradius -> Tank füllt sich (kostet Geld). */
  private refuel(dt: number, players: ServerPlayer[]) {
    if (!AIR_SETTINGS.fuelEnabled) return;
    for (const p of players) {
      const v = p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId) : undefined;
      const f = v?.sim.car.fly;
      if (!v || !f || !f.ground || Math.hypot(v.sim.car.vx, v.sim.car.vz) > 1) continue;
      if (dist2(v.sim.car.x, v.sim.car.z, AIR_FUEL.x, AIR_FUEL.z) > AIR_FUEL.r * AIR_FUEL.r || f.fuel >= 0.999) continue;
      const add = Math.min(1 - f.fuel, AIR_SETTINGS.refuelPerSecond * dt);
      const cost = add * AIR_SETTINGS.refuelCostFull;
      if (p.profile.money < cost) { if (p.airWarnT <= 0) { this.h.notice(p, 'Tankstelle: Nicht genug Geld zum Tanken.', 'bad'); p.airWarnT = 5; } continue; }
      f.fuel = Math.min(1, f.fuel + add);
      p.fuelBill = (p.fuelBill ?? 0) + cost;
      if (f.fuel >= 0.999) {
        const bill = Math.round(p.fuelBill);
        p.fuelBill = 0;
        if (bill > 0) this.h.addMoney(p, -bill, 'fuel');
        this.h.notice(p, `Vollgetankt${bill > 0 ? ` (−$${bill})` : ''}.`, 'good');
      }
    }
  }

  /**
   * Warnung an Spieler auf einer Bahn (zu Fuß oder im Auto), wenn ein Flugzeug auf dieser Bahn
   * startet/landet: Spieler-Flugzeuge im Startlauf/Anflug und das Deko-Flugzeug.
   */
  private runwayWarnings(dt: number, players: ServerPlayer[]) {
    const map = this.h.map;
    // aktive Bahnen: Index -> Text
    const active = new Map<number, string>();
    const R = AIR_SETTINGS.runwayWarnRadius;
    for (const v of this.h.vehicles.values()) {
      const c = v.sim.car, f = c.fly;
      if (v.kind !== VehicleKind.Plane || !f || v.sim.dmg.wreck || v.driver === DRIVER_NONE) continue;
      map.runways.forEach((r, i) => {
        if (dist2(c.x, c.z, r.x, r.z) > (R + r.len / 2) ** 2) return;
        if (f.ground) { if (onRunway(r, c.x, c.z, 2) && f.spd > 8) active.set(i, 'startet'); return; }
        const agl = c.y - airGround(map, c.x, c.z, c.y, false).y;
        if (agl > 45) return;
        // fliegt in Bahnrichtung auf die Bahn zu (oder darüber) und sinkt
        const fx = Math.sin(c.a), fz = Math.cos(c.a), rf = [Math.sin(r.rot), Math.cos(r.rot)];
        const aligned = Math.abs(fx * rf[0] + fz * rf[1]) > 0.85;
        const across = Math.abs((c.x - r.x) * rf[1] - (c.z - r.z) * rf[0]);
        if (aligned && across < 40 && c.vy <= 0.5) active.set(i, 'landet');
      });
    }
    const deco = decoFlight(Date.now());
    if (deco && deco.runway >= 0 && (deco.phase === 'landing' || deco.phase === 'takeoff') && deco.speed > 8) active.set(deco.runway, deco.phase === 'landing' ? 'landet' : 'startet');
    if (!active.size) { for (const p of players) p.airWarnT = Math.max(0, p.airWarnT - dt); return; }
    for (const p of players) {
      p.airWarnT = Math.max(0, p.airWarnT - dt);
      if (p.airWarnT > 0 || p.ride >= 0) continue;
      const own = p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId) : undefined;
      if (own && isAircraft(own.kind)) continue;
      const pos = this.h.positionOf(p);
      for (const [i, what] of active) {
        if (!onRunway(map.runways[i], pos.x, pos.z, 3)) continue;
        const [a, b] = runwayNames(i);
        this.h.notice(p, `⚠ Achtung: Auf Bahn ${a}/${b} ${what} ein Flugzeug – runter von der Bahn!`, 'bad');
        p.airWarnT = 6;
        break;
      }
    }
  }
}
