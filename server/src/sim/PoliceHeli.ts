// Polizeihubschrauber: ab Fahndungsstufe settings.policeHeliWanted (aircraft.json) kreist ein
// Hubschrauber über dem gesuchten Spieler und schießt gelegentlich. Fliegt mit derselben Physik wie
// Spieler-Helikopter (stepSimVehicle), hält Abstand zu hohen Gebäuden und verschwindet, wenn die
// Fahndung endet.
import { clamp, dist2, wrapAngle } from '../../../shared/src/math';
import { Btn } from '../../../shared/src/protocol';
import { AIR_SETTINGS, aircraftById, aircraftColor } from '../../../shared/src/sim/aircraft';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { WEAPONS } from '../../../shared/src/weapons';
import { boxesNear, type Box } from '../../../shared/src/world/collision';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_COP, type ServerPlayer, type ServerVehicle } from '../entities/types';

export interface PoliceHeliHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  allocId(): number;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  hurtPlayer(p: ServerPlayer, dmg: number): void;
  emit(x: number, z: number, ev: (string | number)[]): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  /** Ein fester Physikschritt mit Eingaben. */
  step(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
}

const RIFLE_IDX = Math.max(0, Object.keys(WEAPONS).indexOf('rifle'));
const SPAWN_DIST = 260, ORBIT = 26, SHOOT_RANGE = 55;
const near: Box[] = [];

export class PoliceHeli {
  private cd = new Map<number, number>();

  constructor(private h: PoliceHeliHost) {}

  /** Je Server-Tick: Hubschrauber anfordern/abziehen, fliegen, schießen. steps = Physikschritte */
  update(dt: number, steps: number, simDt: number) {
    const lvl = AIR_SETTINGS.policeHeliWanted;
    const def = aircraftById('streife');
    for (const p of this.h.players.values()) {
      const has = [...this.h.vehicles.values()].some((v) => v.copHeli === p.id);
      if (lvl > 0 && def && p.wanted >= lvl && p.downT <= 0 && !has) this.spawn(p, def.variant, aircraftColor(def));
    }
    for (const v of [...this.h.vehicles.values()]) {
      if (v.copHeli === undefined) continue;
      const p = this.h.players.get(v.copHeli);
      const c = v.sim.car;
      // Fahndung vorbei (oder Spieler weg): abdrehen und verschwinden, sobald weit genug weg
      const chasing = !!p && p.wanted >= lvl && p.downT <= 0 && !v.sim.dmg.wreck;
      const pos = p ? this.h.positionOf(p) : { x: c.x + 1000, z: c.z, inVehicle: false };
      if (!chasing) {
        if (v.sim.dmg.wreck) {
          // Wrack: stürzt ab (Physik ohne Eingaben), verschwindet nach 30 s
          for (let k = 0; k < steps; k++) this.h.step(v, 0, 0, 0);
          const t = (this.cd.get(v.id) ?? 0) + dt;
          this.cd.set(v.id, t);
          if (t > 30) { this.h.vehicles.delete(v.id); this.cd.delete(v.id); }
          continue;
        }
        const away = [...this.h.players.values()].every((q) => { const r = this.h.positionOf(q); return dist2(r.x, r.z, c.x, c.z) > 320 * 320; });
        if (away) { this.h.vehicles.delete(v.id); this.cd.delete(v.id); continue; }
        for (let k = 0; k < steps; k++) this.fly(v, c.x + Math.sin(c.a) * 200, c.z + Math.cos(c.a) * 200, 110);
        continue;
      }
      // Ziel: Kreisbahn um den Spieler, Höhe über den Dächern der Umgebung
      const t = (Date.now() / 1000) * 0.25 + v.id;
      const tx = pos.x + Math.cos(t) * ORBIT, tz = pos.z + Math.sin(t) * ORBIT;
      let roof = 0;
      for (const b of boxesNear(this.h.map, tx, tz, 45, near)) roof = Math.max(roof, b.top ?? 0);
      const alt = clamp(roof + 14, 32, AIR_SETTINGS.ceiling - 10);
      for (let k = 0; k < steps; k++) this.fly(v, tx, tz, alt, pos.x, pos.z);
      // Schießen (Bordschütze), nur auf der höchsten Stufe
      if (p && p.wanted >= Math.max(lvl, 4) && dist2(c.x, c.z, pos.x, pos.z) < SHOOT_RANGE ** 2) this.shoot(v, p, pos, dt);
    }
    void simDt;
  }

  private spawn(p: ServerPlayer, variant: number, color: number) {
    const pos = this.h.positionOf(p);
    const ang = Math.random() * Math.PI * 2;
    const x = clamp(pos.x + Math.cos(ang) * SPAWN_DIST, 20, 2028), z = clamp(pos.z + Math.sin(ang) * SPAWN_DIST, 20, 2028);
    const sim = createSimVehicle(this.h.map, VehicleKind.Heli, variant, x, z, Math.atan2(pos.x - x, pos.z - z));
    const f = sim.car.fly!;
    f.ground = 0; f.rotor = 1; sim.car.y = 90;
    const id = this.h.allocId();
    this.h.vehicles.set(id, { id, kind: VehicleKind.Heli, color, sim, driver: DRIVER_COP, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false, copHeli: p.id });
    this.h.notice(p, '🚁 Polizeihubschrauber im Anflug!', 'bad');
  }

  /** Einfacher Autopilot: zum Ziel drehen, vorwärts, Höhe halten; Blick zum Spieler, wenn nah. */
  private fly(v: ServerVehicle, tx: number, tz: number, alt: number, lookX?: number, lookZ?: number) {
    const c = v.sim.car;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    const look = d < 30 && lookX !== undefined ? Math.atan2(lookX - c.x, lookZ! - c.z) : Math.atan2(dx, dz);
    const da = wrapAngle(look - c.a);
    const ax = clamp(-da * 2, -1, 1);
    // vorwärts in Blickrichtung, seitlich korrigieren
    const fx = Math.sin(c.a), fz = Math.cos(c.a);
    const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
    const ay = clamp(along / 25, -0.6, 1) * (Math.abs(da) < 1.2 || d < 30 ? 1 : 0.2);
    let buttons = Btn.PILOT;
    if (c.y < alt - 2) buttons |= Btn.SPRINT; else if (c.y > alt + 3) buttons |= Btn.BRAKE;
    if (side > 4) buttons |= Btn.STRAFE_R; else if (side < -4) buttons |= Btn.STRAFE_L;
    this.h.step(v, ax, ay, buttons);
  }

  private shoot(v: ServerVehicle, p: ServerPlayer, pos: { x: number; z: number }, dt: number) {
    const cd = (this.cd.get(v.id) ?? 1.5) - dt;
    if (cd > 0) { this.cd.set(v.id, cd); return; }
    this.cd.set(v.id, 1.6 + Math.random() * 0.8);
    const c = v.sim.car;
    const hit = Math.random() < 0.35;
    const miss = hit ? 0 : (Math.random() - 0.5) * 4;
    this.h.emit(c.x, c.z, ['shot', v.id, c.x, c.z, pos.x + miss, pos.z + miss, RIFLE_IDX]);
    if (hit) this.h.hurtPlayer(p, 7);
  }
}
