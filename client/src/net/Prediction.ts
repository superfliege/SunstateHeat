// Client-Side-Prediction für den eigenen Spieler und das eigene Fahrzeug.
// Jede Eingabe wird sofort lokal simuliert (gleicher Code wie auf dem Server) und gemerkt.
// Kommt ein Snapshot, setzen wir auf den Server-Zustand zurück und spielen alle noch nicht
// bestätigten Eingaben erneut ab ("Reconciliation"). Abweichungen werden NICHT hart
// korrigiert, sondern über einen abklingenden Versatz (Position + Orientierung, ~150 ms)
// unsichtbar ausgeglichen.
//
// Kollisionen mit fremden Fahrzeugen sagt der Client ebenfalls voraus (nur das eigene Auto
// bekommt den Impuls – die anderen bewegt der Server). Effekte werden sofort ausgelöst.
import * as THREE from 'three';
import { r2 } from '../../../shared/src/math';
import { Btn, type InputCmd, type SnapshotMsg } from '../../../shared/src/protocol';
import { clearStepOut, collideCars, newStepOut, unpackCar, type CarCollision, type CarState, type Impact, type StepOut } from '../../../shared/src/sim/car';
import type { CarDamage } from '../../../shared/src/sim/damage';
import type { HandlingProfile } from '../../../shared/src/sim/handling';
import { carBody, newPawn, stepPawn, type PawnState } from '../../../shared/src/sim/movement';
import type { Box } from '../../../shared/src/world/collision';
import { carVsProps, type PropHit } from '../../../shared/src/sim/props';
import { checkNearMiss, newStuntTracker, updateStunts, type BonusEvent, type StuntTracker } from '../../../shared/src/sim/stunts';
import { createSimVehicle, stepSimVehicle, type SimVehicle } from '../../../shared/src/sim/vehicle';
import { isAircraft, isWaterVehicle } from '../../../shared/src/sim/vehicleDefs';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

const MAX_PENDING = 240;
/** Zeitkonstante des Fehlerausgleichs (s). */
const SMOOTH_TIME = 0.15;
/** Ab dieser Abweichung wird nicht mehr geglättet (Teleport, Aufrichten …). */
const SNAP_DIST = 6;

/** Ein fremdes Fahrzeug als Hindernis für die Vorhersage. */
export interface Obstacle { id: number; car: CarState; prof: HandlingProfile; water: boolean }

export interface PredictorHooks {
  /** Fahrzeug-Stammdaten (Art, Variante) */
  info(id: number): { kind: number; variant: number } | undefined;
  /** Schaden des Fahrzeugs (gemeinsames Objekt, vom Snapshot aktualisiert) */
  damage(id: number): CarDamage | undefined;
  /** Fremde Fahrzeuge in der Nähe (aktuelle, extrapolierte Positionen) */
  obstacles(): Obstacle[];
  /** Prop ist laut Server schon verschoben */
  propGone(id: number): boolean;
  /** Effekte (nur für frische Schritte, nicht beim Wiederholen) */
  onImpact(imp: Impact, scrape: Impact): void;
  onCarHit(col: CarCollision, other: Obstacle): void;
  onProp(hit: PropHit): void;
  onTree(tree: number, strength: number): void;
  onBonus(b: BonusEvent): void;
}

export class Predictor {
  ready = false;
  vehicleId = -1;
  pawn: PawnState = newPawn();
  sim: SimVehicle | null = null;
  stunts: StuntTracker = newStuntTracker();
  /** Visueller Glättungs-Versatz */
  readonly errPos = new THREE.Vector3();
  readonly errQuat = new THREE.Quaternion();
  /** Lokal getroffene Props (bis der Server sie bestätigt) */
  private localGone = new Map<number, number>();
  private seq = 0;
  private pending: InputCmd[] = [];
  private outbox: InputCmd[] = [];
  private out: StepOut = newStepOut();
  private col: CarCollision = { j: 0, dvA: 0, dvB: 0, x: 0, y: 0, z: 0, nx: 0, nz: 0, vn: 0 };
  private hits: PropHit[] = [];
  private bonus: BonusEvent[] = [];
  private obstacles: Obstacle[] = [];
  private bodies: Box[] = [];
  private clock = 0;

  /** Fahrzeuge in der Nähe als feste Körper für die Figur zu Fuß (wie auf dem Server). */
  private footBodies(): Box[] {
    let n = 0;
    for (const o of this.obstacles) {
      if (o.water) continue;
      this.bodies[n] = carBody(o.car.x, o.car.z, o.car.a, o.prof.width, o.prof.length, this.bodies[n]);
      n++;
    }
    this.bodies.length = n;
    return this.bodies;
  }

  constructor(private map: WorldMap, private hooks: PredictorHooks) {}

  get inVehicle() { return this.vehicleId >= 0 && this.sim !== null; }
  get vehicleKind() { return this.sim?.kind ?? 0; }

  /** Einen festen Simulationsschritt mit der aktuellen Eingabe ausführen. */
  step(ax: number, ay: number, buttons: number, dt: number) {
    if (!this.ready) return;
    this.clock += dt;
    const cmd: InputCmd = [++this.seq, r2(ax), r2(ay), buttons];
    this.obstacles = this.hooks.obstacles();
    this.apply(cmd, dt, false);
    this.pending.push(cmd);
    this.outbox.push(cmd);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
  }

  /** Gesammelte Eingaben zum Versenden abholen. */
  takeOutbox(): InputCmd[] {
    const out = this.outbox;
    this.outbox = [];
    return out;
  }

  private apply(cmd: InputCmd, dt: number, replay: boolean) {
    const [, ax, ay, buttons] = cmd;
    const sim = this.sim;
    if (!this.inVehicle || !sim) { stepPawn(this.map, this.pawn, ax, ay, buttons, dt, undefined, this.footBodies(), true); return; }
    const out = this.out;
    clearStepOut(out);
    if (isAircraft(sim.kind)) {
      // Luftfahrzeug: Pilot sitzt drin (wie auf dem Server), keine Props/Stunts
      stepSimVehicle(this.map, sim, ax, ay, (buttons & ~Btn.PILOT) | Btn.PILOT, dt, out);
      if (!replay && out.impact.dv > 0) this.hooks.onImpact(out.impact, out.scrape);
      return;
    }
    stepSimVehicle(this.map, sim, ax, ay, buttons, dt, out);
    const water = isWaterVehicle(sim.kind);
    if (!water) {
      carVsProps(this.map, sim.car, sim.prof, (id) => this.hooks.propGone(id) || this.localGone.has(id), this.hits, out);
      if (!replay) for (const h of this.hits) { this.localGone.set(h.prop.id, this.clock); this.hooks.onProp(h); }
    }
    for (const o of this.obstacles) {
      if (o.water !== water) continue;
      if (collideCars(sim.car, sim.prof, o.car, o.prof, false, this.col) && !replay) this.hooks.onCarHit(this.col, o);
    }
    if (replay) return;
    if (out.impact.dv > 0 || out.scrape.scrape > 0) this.hooks.onImpact(out.impact, out.scrape);
    for (const [tree, s] of out.trees) this.hooks.onTree(tree, s);
    if (!water) {
      this.bonus.length = 0;
      updateStunts(this.stunts, sim.car, dt, out.impact.dv, this.bonus);
      checkNearMiss(this.stunts, sim.car, sim.prof.width / 2, this.obstacles.map((o) => [o.id, o.car.x, o.car.z, o.car.vx, o.car.vz, o.prof.width / 2, o.prof.length / 2, o.car.a] as [number, number, number, number, number, number, number, number]), dt, this.bonus);
      for (const b of this.bonus) this.hooks.onBonus(b);
    }
  }

  reconcile(snap: SnapshotMsg, myId: number, dt: number) {
    const me = snap.players.find((p) => p[0] === myId);
    if (!me || !snap.me) return;
    const vehId = me[5];
    const wasVehicle = this.vehicleId;
    // Darstellung vor dem Zurücksetzen merken (für den Glättungs-Versatz)
    const before = this.inVehicle && this.sim ? { x: this.sim.car.x, y: this.sim.car.y, z: this.sim.car.z, q: new THREE.Quaternion(this.sim.car.qx, this.sim.car.qy, this.sim.car.qz, this.sim.car.qw) } : { x: this.pawn.x, y: 0, z: this.pawn.z, q: null };

    if (vehId >= 0 && snap.me.veh) {
      const info = this.hooks.info(vehId);
      if (!info) return; // Stammdaten kommen im selben Snapshot – sonst beim nächsten
      if (!this.sim || this.vehicleId !== vehId || this.sim.variant !== info.variant) {
        this.sim = createSimVehicle(this.map, info.kind, info.variant, 0, 0, 0);
        this.stunts = newStuntTracker();
      }
      this.vehicleId = vehId;
      unpackCar(snap.me.veh, this.sim.car);
      const dmg = this.hooks.damage(vehId);
      if (dmg) this.sim.dmg = dmg;
    } else {
      this.vehicleId = -1;
      this.sim = null;
      const p = snap.me.pawn;
      this.pawn = { x: p[0], z: p[1], a: p[2], h: p[3], vx: p[4], vy: p[5], vz: p[6], rt: p[7], pc: p[8] ?? 0 };
    }

    this.pending = this.pending.filter((c) => c[0] > snap.ack);
    this.obstacles = this.hooks.obstacles();
    for (const c of this.pending) this.apply(c, dt, true);
    // bestätigte Prop-Treffer vergessen
    for (const [id, t] of this.localGone) if (this.clock - t > 2) this.localGone.delete(id);

    if (this.ready && wasVehicle === this.vehicleId) {
      if (this.inVehicle && this.sim) {
        const c = this.sim.car;
        this.errPos.x += before.x - c.x; this.errPos.y += before.y - c.y; this.errPos.z += before.z - c.z;
        if (before.q) {
          // Versatz so, dass die angezeigte Orientierung gleich bleibt: off' = off * q_vorher * q_nachher^-1
          const after = new THREE.Quaternion(c.qx, c.qy, c.qz, c.qw);
          this.errQuat.multiply(before.q).multiply(after.invert()).normalize();
        }
      } else {
        this.errPos.x += before.x - this.pawn.x; this.errPos.z += before.z - this.pawn.z;
      }
      if (this.errPos.length() > SNAP_DIST) { this.errPos.set(0, 0, 0); this.errQuat.identity(); }
    } else {
      this.errPos.set(0, 0, 0); this.errQuat.identity();
    }
    this.ready = true;
  }

  /** Glättungs-Versatz abklingen lassen. */
  decay(frameDt: number) {
    const k = Math.exp(-frameDt / SMOOTH_TIME);
    this.errPos.multiplyScalar(k);
    this.errQuat.slerp(IDENTITY, 1 - k);
  }

  /** Position/Richtung für die Darstellung. */
  view() {
    if (this.inVehicle && this.sim) {
      const c = this.sim.car;
      return { x: c.x + this.errPos.x, y: c.y + this.errPos.y, z: c.z + this.errPos.z, a: c.a, s: c.s };
    }
    const p = this.pawn;
    return { x: p.x + this.errPos.x, y: 0, z: p.z + this.errPos.z, a: p.a, s: 0 };
  }

  /** Orientierung des eigenen Fahrzeugs inkl. Glättung. */
  viewQuat(out: THREE.Quaternion) {
    const c = this.sim!.car;
    return out.set(c.qx, c.qy, c.qz, c.qw).premultiply(this.errQuat);
  }
}

const IDENTITY = new THREE.Quaternion();
