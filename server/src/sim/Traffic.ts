// NPC-Verkehr auf dem Spline-Straßengraph: Autos folgen Fahrspuren (seitlicher Versatz
// der Mittelkurve, Rechtsverkehr), biegen an Kreuzungen auf Bézier-Bögen ab und fahren
// Kreisverkehre gegen den Uhrzeigersinn. Sie bremsen vor Hindernissen.
//
// Hybrid: Solange nichts passiert, werden Verkehrsautos KINEMATISCH auf der Spur geführt
// (billig, keine Unfälle untereinander). Werden sie getroffen, übernimmt die echte
// Fahrphysik (gleicher Code wie für Spieler) und der Fahrer reagiert: hupen, aussteigen und
// schimpfen oder flüchten. Vor heranrasenden Spielern weichen sie aus.
import { dist2, wrapAngle } from '../../../shared/src/math';
import { Btn, type GameEvent } from '../../../shared/src/protocol';
import { groundHeight, placeCar, setYaw, syncDerived, upVector } from '../../../shared/src/sim/car';
import { pickCarVariant, variantInfo } from '../../../shared/src/sim/handling';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { offsetPolyline, type Vec2 } from '../../../shared/src/world/geometry';
import { drivablePath, laneOffset } from '../../../shared/src/world/roads';
import { RoadType, Zone, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, DRIVER_NPC, type ServerVehicle } from '../entities/types';

const CRUISE: Record<number, number> = {
  [RoadType.Highway]: 19, [RoadType.Main]: 13, [RoadType.Side]: 10, [RoadType.Dirt]: 7, [RoadType.Pier]: 4,
};
const TURN_SPEED = 7;
const REACH = 3; // Meter: Wegpunkt erreicht

type Mode = 'drive' | 'crash' | 'flee' | 'depart';

interface Brain {
  path: Vec2[]; // anstehende Wegpunkte
  turning: boolean[]; // je Wegpunkt: Teil eines Abbiege-/Kreisverkehrsbogens?
  edge: number; // aktuelle (bzw. zuletzt gewählte) Kante
  toNode: number; // Knoten am Ende der aktuellen Kante
  lane: number;
  cruise: number;
  speed: number; // kinematische Geschwindigkeit
  stuck: number; // Sekunden im Stillstand (gegen Verklemmungen)
  ignore: number; // Sekunden, in denen Hindernisse ignoriert werden
  mode: Mode;
  timer: number;
  severity: number;
  /** Ausweichen: seitlicher Versatz (m, + = rechts) und Restzeit */
  evade: number; evadeT: number;
  honkCd: number;
  blockedByPlayer: number;
  /** Ausgeparktes Auto: Parkplatz, auf den es später (außer Sicht) zurückkehrt */
  home?: ServerVehicle['home'];
  age?: number;
}

export interface TrafficHost {
  map: WorldMap;
  vehicles: Map<number, ServerVehicle>;
  allocId(): number;
  /** Positionen, an denen Verkehr nicht direkt erscheinen soll (Spieler). */
  playerPositions(): { x: number; z: number }[];
  /** Hindernisse für das Bremsen: Fußgänger, Spieler zu Fuß. */
  pawnPositions(): { x: number; z: number }[];
  /** Ein Physik-Schritt (SIM_DT) mit KI-Eingaben – inkl. Kollisionen/Schaden wie bei Spielern. */
  stepPhysics(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
  /** Wütender Fahrer steigt aus. */
  driverOut(v: ServerVehicle, angry: boolean): void;
  event(ev: GameEvent): void;
}

export class Traffic {
  private brains = new Map<number, Brain>();
  private respawnTimer = 0;
  private drivable: RoadEdge[];
  private drivableIds: Set<number>;

  constructor(private host: TrafficHost, private targetCount: number) {
    this.drivable = host.map.edges.filter((e) => e.type !== RoadType.Pier && e.len - e.trimA - e.trimB > 12);
    this.drivableIds = new Set(this.drivable.map((e) => e.id));
    for (let i = 0; i < targetCount; i++) this.spawn(false);
  }

  get count() { return this.brains.size; }
  isKinematic(id: number) { return this.brains.get(id)?.mode === 'drive'; }

  /** Ein Spieler hat das Auto übernommen: aus der KI entfernen. */
  release(vehicleId: number) {
    this.brains.delete(vehicleId);
    const v = this.host.vehicles.get(vehicleId);
    if (v) v.kinematic = false;
  }

  /**
   * Ein NPC ist in ein geparktes Auto gestiegen: mit Physik aus der Lücke auf die nächste Fahrspur,
   * dann normaler Verkehr. Später (außer Sicht) kehrt das Auto auf seinen Parkplatz zurück.
   */
  adopt(v: ServerVehicle): boolean {
    const s = v.sim.car;
    let best: { e: RoadEdge; fwd: boolean; path: Vec2[]; i: number } | null = null, bd = 30 * 30;
    for (const e of this.drivable) {
      const m = e.pts[Math.floor(e.pts.length / 2)];
      if (Math.abs(m[0] - s.x) > e.len / 2 + 40 || Math.abs(m[1] - s.z) > e.len / 2 + 40) continue;
      for (const fwd of [true, false]) {
        const path = this.lanePath(e, fwd, 0);
        for (let i = 0; i < path.length - 1; i++) {
          const d = dist2(path[i][0], path[i][1], s.x, s.z);
          // Spurpunkt etwas voraus in Fahrzeugrichtung bevorzugen (kein Wenden in der Lücke)
          const ahead = (path[i][0] - s.x) * Math.sin(s.a) + (path[i][1] - s.z) * Math.cos(s.a);
          const dir = (path[i + 1][0] - path[i][0]) * Math.sin(s.a) + (path[i + 1][1] - path[i][1]) * Math.cos(s.a);
          const score = d + (ahead < 3 ? 400 : 0) + (dir < 0 ? 600 : 0);
          if (score < bd) { bd = score; best = { e, fwd, path, i }; }
        }
      }
    }
    if (!best) return false;
    v.driver = DRIVER_NPC; v.kinematic = false; v.buttons = 0; v.idleTime = 0;
    const rest = best.path.slice(best.i + 1);
    this.brains.set(v.id, {
      path: rest, turning: rest.map(() => false), edge: best.e.id, toNode: best.fwd ? best.e.b : best.e.a, lane: 0,
      cruise: CRUISE[best.e.type], speed: 0, stuck: 0, ignore: 0, mode: 'depart', timer: 0, severity: 0,
      evade: 0, evadeT: 0, honkCd: 2, blockedByPlayer: 0, home: v.home, age: 0,
    });
    v.home = null;
    return true;
  }

  /** Getroffen: ab jetzt echte Physik, Fahrer reagiert. */
  onHit(vehicleId: number, dv: number) {
    const b = this.brains.get(vehicleId);
    const v = this.host.vehicles.get(vehicleId);
    if (!b || !v) return;
    v.kinematic = false;
    if (b.mode === 'drive') {
      // kinematische Geschwindigkeit in den Physik-Zustand übernehmen
      const s = v.sim.car;
      s.vx = Math.sin(s.a) * b.speed; s.vz = Math.cos(s.a) * b.speed;
    }
    b.mode = 'crash';
    b.timer = 0;
    b.severity = Math.max(b.severity, dv);
  }

  /** Fahrspur einer Kante in Fahrtrichtung. */
  private lanePath(e: RoadEdge, forward: boolean, lane: number): Vec2[] {
    return offsetPolyline(drivablePath(e, forward), laneOffset(e, lane));
  }

  private spawn(avoidPlayers: boolean): boolean {
    const map = this.host.map;
    const players = this.host.playerPositions();
    for (let tries = 0; tries < 30; tries++) {
      const e = this.drivable[Math.floor(Math.random() * this.drivable.length)];
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      // 80 % des Verkehrs in Port Coralia
      if (map.zoneAt(mid[0], mid[1]) !== Zone.PortCoralia && Math.random() < 0.8) continue;
      const forward = Math.random() < 0.5;
      const lane = Math.floor(Math.random() * Math.max(1, e.lanes / 2));
      const path = this.lanePath(e, forward, lane);
      const start = Math.floor(Math.random() * Math.max(1, path.length - 2));
      const p = path[start], q = path[Math.min(path.length - 1, start + 1)];
      if (avoidPlayers && players.some((o) => dist2(o.x, o.z, p[0], p[1]) < 60 * 60)) continue;
      let free = true;
      for (const v of this.host.vehicles.values()) {
        if (dist2(v.sim.car.x, v.sim.car.z, p[0], p[1]) < 12 * 12) { free = false; break; }
      }
      if (!free) continue;
      const id = this.host.allocId();
      // Verkehr: keine Lkw auf Nebenstraßen
      let variant = pickCarVariant(Math.random());
      if (variantInfo(variant).cls === 'truck' && e.type !== RoadType.Highway && e.type !== RoadType.Main) variant = 1;
      const a = Math.atan2(q[0] - p[0], q[1] - p[1]);
      const sim = createSimVehicle(map, VehicleKind.Car, variant, p[0], p[1], a);
      this.host.vehicles.set(id, {
        id, kind: VehicleKind.Car, color: Math.floor(Math.random() * 10), sim,
        driver: DRIVER_NPC, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: true,
      });
      const rest = path.slice(start + 1);
      this.brains.set(id, {
        path: rest, turning: rest.map(() => false), edge: e.id, toNode: forward ? e.b : e.a, lane,
        cruise: CRUISE[e.type], speed: 0, stuck: 0, ignore: 0, mode: 'drive', timer: 0, severity: 0,
        evade: 0, evadeT: 0, honkCd: 0, blockedByPlayer: 0,
      });
      return true;
    }
    return false;
  }

  /** Am Ende der Kante: nächste Kante wählen und Abbiegebogen + neue Spur anhängen. */
  private extend(brain: Brain) {
    const map = this.host.map;
    const node = map.nodes[brain.toNode];
    const options = node.edges.filter((id) => id !== brain.edge && this.drivableIds.has(id));
    const nextId = options.length ? options[Math.floor(Math.random() * options.length)] : brain.edge; // Sackgasse: wenden
    const next = map.edges[nextId];
    const forward = next.a === node.id && (next.b !== node.id || Math.random() < 0.5);
    const lane = Math.min(brain.lane, Math.max(1, next.lanes / 2) - 1);
    const lanePts = this.lanePath(next, forward, lane);
    const from = brain.path.length ? brain.path[brain.path.length - 1] : lanePts[0];
    const to = lanePts[0];

    const bend: Vec2[] = [];
    if (node.roundabout) {
      // Gegen den Uhrzeigersinn (von oben gesehen) = abnehmender Winkel in x/z
      const r = node.roundabout * 0.72;
      const a0 = Math.atan2(from[1] - node.z, from[0] - node.x);
      let a1 = Math.atan2(to[1] - node.z, to[0] - node.x);
      while (a1 > a0 - 0.3) a1 -= Math.PI * 2;
      for (let a = a0 - 0.25; a > a1 + 0.15; a -= 0.35) bend.push([node.x + Math.cos(a) * r, node.z + Math.sin(a) * r]);
    } else {
      // Kubischer Bézier-Bogen tangential aus der alten in die neue Spur
      const prev = brain.path.length > 1 ? brain.path[brain.path.length - 2] : [node.x, node.z];
      const din = norm([from[0] - prev[0], from[1] - prev[1]]);
      const dout = norm([lanePts[Math.min(1, lanePts.length - 1)][0] - to[0], lanePts[Math.min(1, lanePts.length - 1)][1] - to[1]]);
      const k = Math.hypot(to[0] - from[0], to[1] - from[1]) / 3;
      const c1: Vec2 = [from[0] + din[0] * k, from[1] + din[1] * k], c2: Vec2 = [to[0] - dout[0] * k, to[1] - dout[1] * k];
      for (let t = 0.25; t < 1; t += 0.25) {
        const u = 1 - t;
        bend.push([
          u * u * u * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
          u * u * u * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
        ]);
      }
    }
    brain.path.push(...bend, ...lanePts);
    brain.turning.push(...bend.map(() => true), ...lanePts.map((_, i) => i < 2));
    brain.edge = nextId;
    brain.toNode = forward ? next.b : next.a;
    brain.lane = lane;
    brain.cruise = CRUISE[next.type];
  }

  private advancePath(brain: Brain, x: number, z: number) {
    while (brain.path.length && dist2(x, z, brain.path[0][0], brain.path[0][1]) < REACH * REACH) {
      brain.path.shift();
      brain.turning.shift();
    }
    if (brain.path.length < 3) this.extend(brain);
  }

  /** fast = schnelle Spielerfahrzeuge [x, z, vx, vz] (für das Ausweichen). */
  update(dt: number, fast: [number, number, number, number][]) {
    const vehicles = this.host.vehicles;
    const pawns = this.host.pawnPositions();

    for (const [id, brain] of this.brains) {
      const v = vehicles.get(id);
      if (!v || v.driver !== DRIVER_NPC) { this.brains.delete(id); if (v) v.kinematic = false; continue; }
      brain.honkCd -= dt;
      if (brain.home && (brain.age = (brain.age ?? 0) + dt) > 45 && this.returnHome(v, brain)) continue;
      if (brain.mode === 'drive') this.driveKinematic(v, brain, dt, vehicles, pawns, fast);
      else this.driveDynamic(v, brain, dt);
    }

    // Übernommene/verschwundene Autos nach und nach ersetzen
    if (this.brains.size < this.targetCount) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.spawn(true);
        this.respawnTimer = 4;
      }
    }
  }

  /** Ausgeparktes Auto außer Sicht wieder auf seinen Parkplatz stellen (die Lücke bleibt nicht ewig leer). */
  private returnHome(v: ServerVehicle, brain: Brain): boolean {
    const s = v.sim.car, h = brain.home!;
    for (const p of this.host.playerPositions()) {
      if (dist2(p.x, p.z, s.x, s.z) < 90 * 90 || dist2(p.x, p.z, h.x, h.z) < 90 * 90) return false;
    }
    this.brains.delete(v.id);
    v.driver = DRIVER_NONE; v.kinematic = false; v.home = h; v.buttons = 0;
    placeCar(this.host.map, s, v.sim.prof, h.x, h.z, h.a);
    s.sleep = 1;
    return true;
  }

  private honk(v: ServerVehicle, brain: Brain) {
    if (brain.honkCd > 0) return;
    brain.honkCd = 3 + Math.random() * 3;
    this.host.event(['honk', v.id]);
  }

  // ------------------------------------------------------------------ kinematisch
  private driveKinematic(v: ServerVehicle, brain: Brain, dt: number, vehicles: Map<number, ServerVehicle>, pawns: { x: number; z: number }[], fast: [number, number, number, number][]) {
    const s = v.sim.car;
    this.advancePath(brain, s.x, s.z);
    const fx = Math.sin(s.a), fz = Math.cos(s.a);
    const rx = -fz, rz = fx; // rechts

    // Ausweichen vor heranrasenden Spielern
    if (brain.evadeT > 0) brain.evadeT -= dt;
    for (const [px, pz, pvx, pvz] of fast) {
      const dx = px - s.x, dz = pz - s.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 35 * 35) continue;
      // nächste Annäherung in den nächsten 2 s
      const rvx = pvx - fx * brain.speed, rvz = pvz - fz * brain.speed;
      const rv2 = rvx * rvx + rvz * rvz;
      if (rv2 < 100) continue;
      const tc = Math.max(0, Math.min(2, -(dx * rvx + dz * rvz) / rv2));
      const cx = dx + rvx * tc, cz = dz + rvz * tc;
      if (tc > 0.05 && cx * cx + cz * cz < 3.2 * 3.2) {
        // zur Seite, auf der der Spieler NICHT vorbeikommt
        const side = cx * rx + cz * rz > 0 ? -1 : 1;
        brain.evade = side * 1.8;
        brain.evadeT = 1.6;
        if (Math.random() < 0.5) this.honk(v, brain);
      }
    }
    if (brain.evadeT <= 0) brain.evade *= Math.max(0, 1 - dt * 2);

    const target = brain.path[0];
    const tx = target[0] + rx * brain.evade, tz = target[1] + rz * brain.evade;
    const desired = Math.atan2(tx - s.x, tz - s.z);
    const angleDiff = Math.abs(wrapAngle(desired - s.a));
    let want = brain.turning[0] ? TURN_SPEED : brain.cruise;
    if (angleDiff > 0.6) want = 4; // enge Kurve: langsam, sonst kreist das Auto um den Punkt
    if (brain.evadeT > 0) want *= 0.5;

    // Hindernis voraus? (Kegel vor dem Auto)
    const look = 8 + Math.abs(brain.speed) * 0.6;
    const ahead = (x: number, z: number) => {
      const dx = x - s.x, dz = z - s.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > look) return false;
      return Math.abs(dx * fz - dz * fx) < 2.4;
    };
    let blocked = false, byPlayer = false;
    if (brain.ignore <= 0) {
      for (const o of vehicles.values()) {
        if (o !== v && ahead(o.sim.car.x, o.sim.car.z)) { blocked = true; byPlayer = o.driver >= 0 || o.driver === DRIVER_NONE; break; }
      }
      if (!blocked) blocked = pawns.some((p) => ahead(p.x, p.z));
    } else {
      brain.ignore -= dt;
    }
    if (blocked) want = 0;
    // Hupen, wenn ein Spieler(-auto) im Weg steht
    if (blocked && byPlayer) { brain.blockedByPlayer += dt; if (brain.blockedByPlayer > 1.2) this.honk(v, brain); } else brain.blockedByPlayer = 0;

    // Verklemmung an Kreuzungen auflösen
    if (Math.abs(brain.speed) < 0.5 && blocked) {
      brain.stuck += dt;
      if (brain.stuck > 3.5) { brain.ignore = 2; brain.stuck = 0; }
    } else {
      brain.stuck = 0;
    }

    const prev = brain.speed;
    brain.speed += Math.max(-18 * dt, Math.min(6 * dt, want - brain.speed));
    let a = s.a;
    const turn = Math.max(-2.6 * dt, Math.min(2.6 * dt, wrapAngle(desired - a)));
    a = wrapAngle(a + turn);
    const nx = s.x + Math.sin(a) * brain.speed * dt, nz = s.z + Math.cos(a) * brain.speed * dt;
    // Zustand für Physik/Anzeige konsistent halten
    s.x = nx; s.z = nz;
    s.y = groundHeight(this.host.map, nx, nz) + v.sim.prof.cgHeight;
    setYaw(s, a);
    s.vx = Math.sin(a) * brain.speed; s.vz = Math.cos(a) * brain.speed; s.vy = 0;
    s.wx = 0; s.wz = 0; s.wy = turn / dt;
    s.steer = Math.max(-0.5, Math.min(0.5, (turn / dt) * v.sim.prof.wheelbase / Math.max(2, brain.speed)));
    s.brk = brain.speed < prev - 0.01 ? 1 : 0;
    s.thr = brain.speed > prev ? 0.5 : 0;
    s.rpm = 900 + brain.speed * 120;
    s.ground = 15; s.air = 0; s.sleep = 0;
    s.spin.forEach((_, i) => { s.spin[i] = (s.spin[i] + brain.speed / v.sim.prof.wheelRadius * dt) % (Math.PI * 2); });
    syncDerived(s);
    v.kinematic = true;
  }

  // ------------------------------------------------------------------ Physik (nach Unfall)
  private driveDynamic(v: ServerVehicle, brain: Brain, dt: number) {
    const s = v.sim.car;
    brain.timer += dt;
    const up = upVector(s);
    const steps = Math.round(dt / (1 / 60));
    let ax = 0, ay = 0, buttons = 0;

    if (brain.mode === 'depart') {
      // Ausparken: langsam der Spur folgen (mit Physik), dann kinematisch weiter
      this.advancePath(brain, s.x, s.z);
      const target = brain.path[0];
      const desired = Math.atan2(target[0] - s.x, target[1] - s.z);
      const diff = wrapAngle(desired - s.a);
      ax = Math.max(-1, Math.min(1, -diff * 2.2));
      ay = s.s < 4.5 ? 0.6 : 0;
      if (Math.abs(s.s) < 0.4 && brain.timer > 2) brain.stuck += dt; else brain.stuck = 0;
      if (brain.stuck > 4 || brain.timer > 25) { this.resume(v, brain); return; }
      if (brain.timer > 1.5 && this.nearPath(s.x, s.z, brain, 2) && Math.abs(diff) < 0.3) { this.resume(v, brain); return; }
    } else if (brain.mode === 'crash') {
      // anhalten, kurz sammeln
      buttons = Math.abs(s.s) > 1 ? Btn.BRAKE : 0;
      if (Math.abs(s.s) < 1 && brain.timer > 1.2) {
        if (up[1] < 0.5 || v.sim.dmg.wreck || v.sim.dmg.hp < 250) {
          this.host.driverOut(v, true); this.brains.delete(v.id); return;
        }
        const r = Math.random();
        if (brain.severity > 9 && r < 0.45) {
          // aussteigen und schimpfen
          this.host.driverOut(v, true); this.brains.delete(v.id); return;
        }
        this.honk(v, brain);
        if (brain.severity < 5 && this.nearPath(s.x, s.z, brain, 4)) {
          this.resume(v, brain);
          return;
        }
        brain.mode = 'flee';
        brain.timer = 0;
      }
    } else {
      // flüchten: der Spur mit Physik folgen, schneller als sonst
      this.advancePath(brain, s.x, s.z);
      const target = brain.path[0];
      const desired = Math.atan2(target[0] - s.x, target[1] - s.z);
      const diff = wrapAngle(desired - s.a);
      ax = Math.max(-1, Math.min(1, -diff * 2.2));
      const want = Math.abs(diff) > 0.9 ? 6 : brain.cruise * 1.5;
      ay = s.s < want ? 1 : 0;
      if (Math.abs(s.s) < 0.6 && brain.timer > 1) brain.stuck += dt; else brain.stuck = 0;
      if (brain.stuck > 3 || up[1] < 0.5) { this.host.driverOut(v, false); this.brains.delete(v.id); return; }
      if (brain.timer > 8 && this.nearPath(s.x, s.z, brain, 3) && Math.abs(diff) < 0.4) { this.resume(v, brain); return; }
    }
    for (let k = 0; k < steps; k++) this.host.stepPhysics(v, ax, ay, buttons);
  }

  private nearPath(x: number, z: number, brain: Brain, r: number) {
    return brain.path.slice(0, 3).some((p) => dist2(x, z, p[0], p[1]) < r * r * 4);
  }

  /** Zurück in die kinematische Führung (aufrecht auf die Straße setzen). */
  private resume(v: ServerVehicle, brain: Brain) {
    const s = v.sim.car;
    brain.speed = Math.max(0, s.s);
    placeCar(this.host.map, s, v.sim.prof, s.x, s.z, s.a);
    brain.mode = 'drive';
    brain.severity = 0;
    brain.timer = 0;
    v.kinematic = true;
  }
}

function norm(v: [number, number] | number[]): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

