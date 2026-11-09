// Ankunftsszenen (beim Login, siehe Scenes.ts) – laufen auch gelegentlich als Straßenereignis:
//   1. Polizeijagd: Ein Flüchtiger rennt vorbei, drei Streifenwagen mähen ihn um – er steht auf und haut ab.
//   2. Bazooka: Ein Typ jagt ein geparktes Auto mit dem Raketenwerfer hoch – war leider das falsche.
//   3. Straßenrennen: Zwei Raser donnern heran, einer kracht ins geparkte Auto, das kurz danach explodiert.
//   4. Schießerei: Zwei Gangster ballern sich gegenseitig daneben, bis beiden die Munition ausgeht.
//   5. Brennendes Geisterauto: Ein Auto rollt brennend die Straße runter, der Besitzer rennt schreiend hinterher.
import { OUTFIT_COLORS } from '../../../../shared/src/constants';
import { dist2 } from '../../../../shared/src/math';
import { laneOffset } from '../../../../shared/src/world/roads';
import { WEAPONS } from '../../../../shared/src/weapons';
import { BURN_TIME } from '../../../../shared/src/sim/damage';
import { Btn } from '../../../../shared/src/protocol';
import { DRIVER_COP, DRIVER_NONE, DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../../entities/types';
import { GANG_OUTFIT } from '../Gangs';
import type { Ped } from '../Pedestrians';
import { Scene, type Lane, type SceneHost } from './Scene';

export const PISTOL = Object.keys(WEAPONS).indexOf('pistol');
export const ROCKET = Object.keys(WEAPONS).indexOf('rocket');
/** Fahrzeug-Varianten (siehe CAR_VARIANTS): Limousine (Streife), Sportwagen, Muscle Car, Kompakt. */
export const V_SEDAN = 1, V_SPORT = 4, V_MUSCLE = 5, V_COMPACT = 0;

export const ARRIVAL_NAMES = ['Polizeijagd', 'Bazooka', 'Straßenrennen', 'Schießerei', 'Geisterauto'] as const;
/** Platzbedarf auf der Spur: [Meter vor s0 (Anlauf), Meter nach s0]. */
export const ARRIVAL_NEED: [number, number][] = [[95, 40], [14, 14], [86, 30], [12, 12], [45, 25]];

export function createArrival(kind: number, h: SceneHost, lane: Lane, p: ServerPlayer): Scene {
  switch (kind) {
    case 0: return new ChaseScene(h, lane, p);
    case 1: return new BazookaScene(h, lane, p);
    case 2: return new RaceScene(h, lane, p);
    case 3: return new ShootoutScene(h, lane, p);
    default: return new GhostCarScene(h, lane, p);
  }
}


/** 1. Polizeijagd: Flüchtiger rennt vorbei, drei Streifenwagen überfahren ihn, er steht auf und haut ab. */
export class ChaseScene extends Scene {
  readonly name = ARRIVAL_NAMES[0];
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
export class BazookaScene extends Scene {
  readonly name = ARRIVAL_NAMES[1];
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
export class RaceScene extends Scene {
  readonly name = ARRIVAL_NAMES[2];
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
export class ShootoutScene extends Scene {
  readonly name = ARRIVAL_NAMES[3];
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
export class GhostCarScene extends Scene {
  readonly name = ARRIVAL_NAMES[4];
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

