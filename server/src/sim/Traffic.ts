// NPC-Verkehr auf dem Spline-Straßengraph: Autos folgen Fahrspuren (seitlicher Versatz
// der Mittelkurve, Rechtsverkehr), biegen an Kreuzungen auf Bézier-Bögen ab und fahren
// Kreisverkehre gegen den Uhrzeigersinn. Sie bremsen vor Hindernissen.
//
// Hybrid: Solange nichts passiert, werden Verkehrsautos KINEMATISCH auf der Spur geführt
// (billig, keine Unfälle untereinander). Werden sie getroffen, übernimmt die echte
// Fahrphysik (gleicher Code wie für Spieler) und der Fahrer reagiert: hupen, aussteigen und
// schimpfen oder flüchten. Vor heranrasenden Spielern weichen sie aus.
//
// Verklemmungen: Steht ein Hindernis (quer stehendes Wrack, geparktes Auto, Spieler) auf der
// Spur, fährt der NPC daran vorbei – bevorzugt über die Gegenspur, wenn dort gerade nichts
// entgegenkommt, sonst über Seitenstreifen/Gehweg. Ist er zu dicht aufgefahren, setzt er erst
// ein Stück zurück. Geht gar nichts, wendet er (bzw. verschwindet außer Sicht und wird
// anderswo neu eingesetzt).
import { dist2, wrapAngle } from '../../../shared/src/math';
import { Btn, type GameEvent } from '../../../shared/src/protocol';
import { groundHeight, placeCar, setYaw, syncDerived, upVector } from '../../../shared/src/sim/car';
import { HANDLING, variantInfo, type HandlingClass } from '../../../shared/src/sim/handling';
import { pickAreaVariant, SMALLTOWN_DISTRICTS, TRAFFIC_DENSITY } from '../../../shared/src/npc/countryside';
import { ruralArea } from '../../../shared/src/world/north';
import { footFree } from '../../../shared/src/sim/movement';
import { createSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { offsetPolyline, type Vec2 } from '../../../shared/src/world/geometry';
import { drivablePath, laneOffset } from '../../../shared/src/world/roads';
import { RoadType, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, DRIVER_NPC, type ServerVehicle } from '../entities/types';

const CRUISE: Record<number, number> = {
  [RoadType.Highway]: 19, [RoadType.Main]: 13, [RoadType.Side]: 10, [RoadType.Dirt]: 7, [RoadType.Pier]: 4,
};
const TURN_SPEED = 7;
const REACH = 3; // Meter: Wegpunkt erreicht
/** Kleinster Wenderadius der kinematischen Führung (m). Drehen nur in Bewegung – nie auf der Stelle. */
const MIN_RADIUS = 2.2;
/** Rückwärtsgeschwindigkeit beim Zurücksetzen (m/s) */
const REVERSE_SPEED = 3;
/** Ab dieser Entfernung zum nächsten Spieler darf ein festgefahrenes Auto einfach verschwinden. */
const UNSEEN_RANGE = 85;
const GRID = 16; // Zellgröße des Nachbarschaftsrasters (m)

type Mode = 'drive' | 'crash' | 'flee' | 'depart';
/** Verkehrspool: 0 = Stadt (Straßen mit Gehweg), 1 = außerhalb, -1 = ausgeparktes Auto */
type Pool = 0 | 1 | -1;

interface Brain {
  path: Vec2[]; // anstehende Wegpunkte
  turning: boolean[]; // je Wegpunkt: Teil eines Abbiege-/Kreisverkehrsbogens?
  edge: number; // aktuelle (bzw. zuletzt gewählte) Kante
  toNode: number; // Knoten am Ende der aktuellen Kante
  lane: number;
  cruise: number;
  speed: number; // kinematische Geschwindigkeit (negativ = rückwärts)
  stuck: number; // Sekunden im Stillstand vor einem Hindernis
  /** Stau-Zähler: wächst im Stillstand, sinkt beim Fahren. Sehr hoch → wenden bzw. verschwinden. */
  jam: number;
  /** Sekunden ohne erreichten Wegpunkt (gegen Kreisen um einen Punkt) */
  progT: number;
  ignore: number; // Sekunden, in denen Hindernisse ignoriert werden
  mode: Mode;
  timer: number;
  severity: number;
  /** Ausweichen: seitlicher Versatz zur Spur (m, + = rechts) und Restzeit */
  evade: number; evadeT: number;
  /** Umfahren eines stehenden Hindernisses (Sekunden Restzeit, Fahrzeug-ID des Hindernisses); evade hält den Seitenversatz */
  detourT: number; detourId: number;
  /** Zurücksetzen: Restzeit und Seite, zu der die Schnauze danach zeigen soll (-1 links/Gegenspur, +1 rechts) */
  rev: number; revSide: number;
  /** Fehlgeschlagene Umfahrversuche in Folge */
  fails: number;
  /** Wartezeit bis zum nächsten Umfahrversuch */
  tryCd: number;
  /** Hindernis, das uns gerade aufhält (Fahrzeug-ID, -1 = keins) */
  blockId: number;
  /** Nach dem Zurücksetzen: an diesem Hindernis sofort einen neuen Umfahrversuch starten (-1 = keins) */
  retryId: number;
  /** Nach dem Wenden: dieses Hindernis eine Weile nicht beachten */
  avoidId: number; avoidT: number;
  /** Wendemanöver läuft (Sekunden): Wegpunkte hinter dem Auto nicht überspringen */
  uturnT: number;
  honkCd: number;
  blockedByPlayer: number;
  pool: Pool;
  /** Höchsttempo des Fahrzeugs (Traktor, Mähdrescher …): die Reisegeschwindigkeit bleibt darunter -> Kolonnen dahinter */
  vmax?: number;
  /** Ausgeparktes Auto: Parkplatz, auf den es später (außer Sicht) zurückkehrt */
  home?: ServerVehicle['home'];
  age?: number;
  /** Beschossen: flüchtet schnell (Physik) bzw. hält an und der Fahrer rennt davon (bail). */
  panic?: boolean;
  bail?: boolean;
}

function newBrain(init: Pick<Brain, 'path' | 'edge' | 'toNode' | 'lane' | 'cruise' | 'mode' | 'pool'> & Partial<Brain>): Brain {
  return {
    turning: init.path.map(() => false), speed: 0, stuck: 0, jam: 0, progT: 0, ignore: 0, timer: 0, severity: 0,
    evade: 0, evadeT: 0, detourT: 0, detourId: -1, rev: 0, revSide: -1, fails: 0, tryCd: 0, blockId: -1, retryId: -1,
    avoidId: -1, avoidT: 0, uturnT: 0, honkCd: 0, blockedByPlayer: 0,
    ...init,
  };
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

/** Fahrspur-Treffer: Kante, Richtung, Spurpunkte und Index des nächstgelegenen Punkts */
interface LaneHit { e: RoadEdge; fwd: boolean; path: Vec2[]; i: number }

export class Traffic {
  private brains = new Map<number, Brain>();
  private respawnTimer = [0, 0];
  private drivable: RoadEdge[];
  private drivableIds: Set<number>;
  /** Spawn-Kanten je Pool (Stadt / außerhalb) mit kumulierten Längen (Auswahl längengewichtet) */
  private pools: { edges: RoadEdge[]; cum: number[] }[];
  private targets: [number, number];
  // Nachbarschaftsraster (pro Update neu aufgebaut)
  private vGrid = new Map<number, ServerVehicle[]>();
  private pGrid = new Map<number, { x: number; z: number }[]>();
  private players: { x: number; z: number }[] = [];

  /** urban = Ziel-Anzahl in der Stadt, rural = außerhalb */
  constructor(private host: TrafficHost, urban: number, rural: number) {
    this.drivable = host.map.edges.filter((e) => e.type !== RoadType.Pier && e.len - e.trimA - e.trimB > 12);
    this.drivableIds = new Set(this.drivable.map((e) => e.id));
    this.targets = [urban, rural];
    this.pools = [0, 1].map((pool) => {
      const edges = this.drivable.filter((e) => (e.sidewalk > 0) === (pool === 0));
      let acc = 0;
      return { edges, cum: edges.map((e) => (acc += e.len - e.trimA - e.trimB)) };
    });
    for (const pool of [0, 1] as const) for (let i = 0; i < this.targets[pool]; i++) this.spawn(pool, false);
  }

  get count() { return this.brains.size; }
  isKinematic(id: number) { return this.brains.get(id)?.mode === 'drive'; }

  /** Ein Spieler hat das Auto übernommen: aus der KI entfernen. */
  release(vehicleId: number) {
    this.brains.delete(vehicleId);
    const v = this.host.vehicles.get(vehicleId);
    if (v) v.kinematic = false;
  }

  /** Nächste Fahrspur zu (x, z); dir = Fahrtrichtung, die bevorzugt (+1) bzw. gemieden (-1) wird. */
  private findLane(x: number, z: number, a: number, dir: 1 | -1, maxD: number): LaneHit | null {
    let best: LaneHit | null = null, bd = maxD * maxD;
    const sa = Math.sin(a), ca = Math.cos(a);
    for (const e of this.drivable) {
      const m = e.pts[Math.floor(e.pts.length / 2)];
      if (Math.abs(m[0] - x) > e.len / 2 + maxD + 10 || Math.abs(m[1] - z) > e.len / 2 + maxD + 10) continue;
      for (const fwd of [true, false]) {
        const path = this.lanePath(e, fwd, 0);
        for (let i = 0; i < path.length - 1; i++) {
          const d = dist2(path[i][0], path[i][1], x, z);
          if (d > bd) continue;
          // Spurpunkt etwas voraus bevorzugen; Spurrichtung passend zur gewünschten Richtung
          const ahead = ((path[i][0] - x) * sa + (path[i][1] - z) * ca) * dir;
          const dirDot = ((path[i + 1][0] - path[i][0]) * sa + (path[i + 1][1] - path[i][1]) * ca) * dir;
          const score = d + (ahead < 3 ? 400 : 0) + (dirDot < 0 ? 600 : 0);
          if (score < bd) { bd = score; best = { e, fwd, path, i }; }
        }
      }
    }
    return best;
  }

  /**
   * Ein NPC ist in ein geparktes Auto gestiegen: mit Physik aus der Lücke auf die nächste Fahrspur,
   * dann normaler Verkehr. Später (außer Sicht) kehrt das Auto auf seinen Parkplatz zurück.
   */
  adopt(v: ServerVehicle): boolean {
    const s = v.sim.car;
    const best = this.findLane(s.x, s.z, s.a, 1, 30);
    if (!best) return false;
    v.driver = DRIVER_NPC; v.kinematic = false; v.buttons = 0; v.idleTime = 0;
    this.brains.set(v.id, newBrain({
      path: best.path.slice(best.i + 1), edge: best.e.id, toNode: best.fwd ? best.e.b : best.e.a, lane: 0,
      cruise: CRUISE[best.e.type], mode: 'depart', pool: -1, honkCd: 2, home: v.home, age: 0,
    }));
    v.home = null;
    return true;
  }

  /** Getroffen: ab jetzt echte Physik, Fahrer reagiert. */
  onHit(vehicleId: number, dv: number) {
    const b = this.brains.get(vehicleId);
    const v = this.host.vehicles.get(vehicleId);
    if (!b || !v) return;
    v.kinematic = false;
    if (b.panic || b.bail) return; // schon in Panik: Reaktion nicht überschreiben
    if (b.mode === 'drive') {
      // kinematische Geschwindigkeit in den Physik-Zustand übernehmen
      const s = v.sim.car;
      s.vx = Math.sin(s.a) * b.speed; s.vz = Math.cos(s.a) * b.speed;
    }
    b.mode = 'crash';
    b.timer = 0; b.rev = 0;
    b.severity = Math.max(b.severity, dv);
  }

  /**
   * Auf das Auto wurde geschossen: der Fahrer gerät in Panik – entweder Vollgas weg (Physik, schneller
   * als sonst) oder anhalten, aussteigen und zu Fuß davonrennen.
   */
  onShot(vehicleId: number) {
    const b = this.brains.get(vehicleId);
    const v = this.host.vehicles.get(vehicleId);
    if (!b || !v || b.panic || b.bail) return;
    v.kinematic = false;
    if (b.mode === 'drive') {
      const s = v.sim.car;
      s.vx = Math.sin(s.a) * b.speed; s.vz = Math.cos(s.a) * b.speed;
    }
    b.timer = 0; b.stuck = 0; b.rev = 0; b.jam = 0; b.progT = 0;
    if (Math.random() < 0.5) { b.mode = 'crash'; b.bail = true; } else { b.mode = 'flee'; b.panic = true; }
    this.honk(v, b);
  }

  /** Fahrspur einer Kante in Fahrtrichtung. */
  private lanePath(e: RoadEdge, forward: boolean, lane: number): Vec2[] {
    return offsetPolyline(drivablePath(e, forward), laneOffset(e, lane));
  }

  private spawn(pool: 0 | 1, avoidPlayers: boolean): boolean {
    const map = this.host.map;
    const { edges, cum } = this.pools[pool];
    if (!edges.length) return false;
    const total = cum[cum.length - 1];
    for (let tries = 0; tries < 30; tries++) {
      // längengewichtete Kantenwahl: gleichmäßige Dichte pro Straßenmeter
      const r = Math.random() * total;
      let k = 0;
      while (k < cum.length - 1 && cum[k] < r) k++;
      const e = edges[k];
      const forward = Math.random() < 0.5;
      const lane = Math.floor(Math.random() * Math.max(1, e.lanes / 2));
      const path = this.lanePath(e, forward, lane);
      const start = Math.floor(Math.random() * Math.max(1, path.length - 2));
      const p = path[start], q = path[Math.min(path.length - 1, start + 1)];
      if (avoidPlayers && this.players.some((o) => dist2(o.x, o.z, p[0], p[1]) < 70 * 70)) continue;
      let free = true;
      for (const v of this.host.vehicles.values()) {
        if (dist2(v.sim.car.x, v.sim.car.z, p[0], p[1]) < 11 * 11) { free = false; break; }
      }
      if (!free) continue;
      const id = this.host.allocId();
      // Stadt vs. Land: Fahrzeugmischung nach Gebiet (Landstraße, Feldweg, Kleinstadt, Berg, Stadtrand)
      const district = map.districtAt(p[0], p[1])?.name;
      const area = district ? (SMALLTOWN_DISTRICTS.has(district) ? 'Kleinstadt' : null) : ruralArea(p[0], p[1], (x, z) => map.zoneAt(x, z), e.type === RoadType.Dirt);
      // auf dem Land deutlich weniger Verkehr
      if (area && Math.random() > TRAFFIC_DENSITY[area]) continue;
      let variant = pickAreaVariant(area, Math.random);
      // Verkehr: keine Lkw auf Nebenstraßen (in der Stadt); Mähdrescher nur auf Feldwegen/Landstraßen
      if (!area && variantInfo(variant).cls === 'truck' && e.type !== RoadType.Highway && e.type !== RoadType.Main) variant = 1;
      if (e.type === RoadType.Highway && variantInfo(variant).cls.startsWith('tractor')) variant = pickAreaVariant('Stadtrand', Math.random);
      const vmax = HANDLING[variantInfo(variant).cls as HandlingClass].topSpeed * 0.9;
      const a = Math.atan2(q[0] - p[0], q[1] - p[1]);
      const sim = createSimVehicle(map, VehicleKind.Car, variant, p[0], p[1], a);
      const v: ServerVehicle = {
        id, kind: VehicleKind.Car, color: Math.floor(Math.random() * 10), sim,
        driver: DRIVER_NPC, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: true,
      };
      this.host.vehicles.set(id, v);
      this.gridAdd(v);
      this.brains.set(id, newBrain({
        path: path.slice(start + 1), edge: e.id, toNode: forward ? e.b : e.a, lane, cruise: Math.min(CRUISE[e.type], vmax), mode: 'drive', pool,
        speed: avoidPlayers ? Math.min(CRUISE[e.type], vmax) * 0.6 : 0, vmax,
      }));
      return true;
    }
    return false;
  }

  /**
   * Mähdrescher-Kolonne (Ereignis E49 / Dev /kolonne): langsames Fahrzeug auf der nächsten Landstraße,
   * dahinter n Autos derselben Spur – sie fahren auf und stauen sich (keine Überholmanöver der KI).
   */
  spawnConvoy(x: number, z: number, leadVariant: number, n: number): number {
    const map = this.host.map;
    let best: { e: RoadEdge; fwd: boolean; path: Vec2[]; i: number } | null = null, bd = 150 * 150;
    for (const e of this.pools[1].edges) {
      if (e.type === RoadType.Highway || e.len < 80) continue;
      const path = this.lanePath(e, true, 0);
      for (let i = Math.min(path.length - 2, 12); i < path.length - 2; i += 2) {
        const d = dist2(path[i][0], path[i][1], x, z);
        if (d < bd) { bd = d; best = { e, fwd: true, path, i }; }
      }
    }
    if (!best) return 0;
    let made = 0;
    for (let k = 0; k <= n; k++) {
      // Abstand ~9–11 m entlang der Spur nach hinten (2-m-Punkte)
      const idx = best.i - k * 5;
      if (idx < 0) break;
      const p = best.path[idx], q = best.path[idx + 1];
      const variant = k === 0 ? leadVariant : pickAreaVariant('Dry Pine Land', Math.random);
      const vmax = HANDLING[variantInfo(variant).cls as HandlingClass].topSpeed * 0.9;
      const id = this.host.allocId();
      const sim = createSimVehicle(map, VehicleKind.Car, variant, p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1]));
      const v: ServerVehicle = { id, kind: VehicleKind.Car, color: Math.floor(Math.random() * 10), sim, driver: DRIVER_NPC, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: true };
      this.host.vehicles.set(id, v);
      this.gridAdd(v);
      this.brains.set(id, newBrain({ path: best.path.slice(idx + 1), edge: best.e.id, toNode: best.e.b, lane: 0, cruise: Math.min(CRUISE[best.e.type], vmax), mode: 'drive', pool: 1, vmax }));
      made++;
    }
    return made;
  }

  /** Auto spurlos entfernen (nur außer Sicht!) – der Pool setzt anderswo ein neues ein. */
  private despawn(v: ServerVehicle) {
    this.brains.delete(v.id);
    this.host.vehicles.delete(v.id);
  }

  private unseen(x: number, z: number, r = UNSEEN_RANGE) {
    return this.players.every((p) => dist2(p.x, p.z, x, z) > r * r);
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
    brain.cruise = Math.min(CRUISE[next.type], brain.vmax ?? 99);
  }

  /** Erreichte bzw. schon passierte Wegpunkte abhaken; true, wenn es vorangeht. */
  private advancePath(brain: Brain, x: number, z: number): boolean {
    let moved = false;
    while (brain.path.length) {
      const p = brain.path[0], q = brain.path[1];
      const d = dist2(x, z, p[0], p[1]);
      // erreicht – oder schon daran vorbei (der übernächste Punkt liegt näher)
      if (d < REACH * REACH || (q && brain.uturnT <= 0 && dist2(x, z, q[0], q[1]) < d && d < 15 * 15)) {
        brain.path.shift(); brain.turning.shift(); moved = true;
      } else break;
    }
    if (brain.path.length < 3) this.extend(brain);
    return moved;
  }

  // ------------------------------------------------------------------ Nachbarschaftsraster
  private key(x: number, z: number) { return (Math.floor(x / GRID) + 512) * 4096 + Math.floor(z / GRID) + 512; }
  private gridAdd(v: ServerVehicle) {
    const k = this.key(v.sim.car.x, v.sim.car.z);
    const list = this.vGrid.get(k);
    if (list) list.push(v); else this.vGrid.set(k, [v]);
  }
  private buildGrids() {
    this.vGrid.clear(); this.pGrid.clear();
    for (const v of this.host.vehicles.values()) if (!v.sim.car.fly || v.sim.car.fly.ground) this.gridAdd(v); // fliegende Luftfahrzeuge stören den Verkehr nicht
    for (const p of this.host.pawnPositions()) {
      const k = this.key(p.x, p.z);
      const list = this.pGrid.get(k);
      if (list) list.push(p); else this.pGrid.set(k, [p]);
    }
  }
  private *nearCells<T>(grid: Map<number, T[]>, x: number, z: number, r: number): Generator<T> {
    const x0 = Math.floor((x - r) / GRID), x1 = Math.floor((x + r) / GRID);
    const z0 = Math.floor((z - r) / GRID), z1 = Math.floor((z + r) / GRID);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const list = grid.get((cx + 512) * 4096 + cz + 512);
        if (list) yield* list;
      }
    }
  }

  /** fast = schnelle Spielerfahrzeuge [x, z, vx, vz] (für das Ausweichen). */
  update(dt: number, fast: [number, number, number, number][]) {
    const vehicles = this.host.vehicles;
    this.players = this.host.playerPositions();
    this.buildGrids();
    const counts = [0, 0];

    for (const [id, brain] of this.brains) {
      const v = vehicles.get(id);
      if (!v || v.driver !== DRIVER_NPC) { this.brains.delete(id); if (v) v.kinematic = false; continue; }
      brain.honkCd -= dt;
      if (brain.home && (brain.age = (brain.age ?? 0) + dt) > 45 && this.returnHome(v, brain)) continue;
      if (brain.mode === 'drive') this.driveKinematic(v, brain, dt, fast);
      else this.driveDynamic(v, brain, dt);
      const b = this.brains.get(id);
      if (b && b.pool >= 0) counts[b.pool]++;
    }

    // Übernommene/verschwundene Autos nach und nach ersetzen (außer Sicht der Spieler)
    for (const pool of [0, 1] as const) {
      if (counts[pool] >= this.targets[pool]) continue;
      this.respawnTimer[pool] -= dt;
      if (this.respawnTimer[pool] <= 0) {
        this.spawn(pool, true);
        // je größer die Lücke, desto schneller
        this.respawnTimer[pool] = counts[pool] < this.targets[pool] * 0.8 ? 0.25 : 1;
      }
    }
  }

  /** Ausgeparktes Auto außer Sicht wieder auf seinen Parkplatz stellen (die Lücke bleibt nicht ewig leer). */
  private returnHome(v: ServerVehicle, brain: Brain): boolean {
    const s = v.sim.car, h = brain.home!;
    if (!this.unseen(s.x, s.z, 90) || !this.unseen(h.x, h.z, 90)) return false;
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

  /** Steht dieses Fahrzeug dauerhaft (lohnt sich Umfahren)? Wartende NPCs zählen erst nach einer Weile. */
  private isStill(o: ServerVehicle): boolean {
    if (Math.hypot(o.sim.car.vx, o.sim.car.vz) > 1) return false;
    const ob = this.brains.get(o.id);
    if (!ob) return true; // geparkt, Wrack, Spieler, Polizei …
    if (ob.mode !== 'drive') return true;
    return ob.jam > 6; // NPC steckt selbst schon länger fest
  }

  /**
   * Stehendes Hindernis (Wrack, quer stehendes Auto, Spieler): seitlich daran vorbeifahren – bevorzugt über
   * die Gegenspur (nur wenn nichts entgegenkommt), sonst über Seitenstreifen/Gehweg. Der nötige Seitenversatz
   * ergibt sich aus dem tatsächlichen Umriss des Hindernisses (ein quer stehendes Auto ist viel breiter).
   * 'near' = zu dicht aufgefahren (erst zurücksetzen), 'wait' = Gegenverkehr abwarten, 'fail' = kein Platz.
   */
  private startDetour(v: ServerVehicle, brain: Brain, o: ServerVehicle, impatient: boolean): 'ok' | 'near' | 'wait' | 'fail' {
    const s = v.sim.car, map = this.host.map;
    const f = this.laneFrame(brain, s);
    const { lfx, lfz, lrx, lrz, latNow } = f;
    const p0 = brain.path[0];
    // Umriss des Hindernisses im Spurrahmen (lateral relativ zur Spurmitte, längs relativ zum Auto)
    const oc = o.sim.car, hl = o.sim.prof.length / 2, hw = o.sim.prof.width / 2;
    const ofx = Math.sin(oc.a), ofz = Math.cos(oc.a);
    let latMin = Infinity, latMax = -Infinity, alMin = Infinity, alMax = -Infinity;
    for (const i of [1, -1]) {
      for (const j of [1, -1]) {
        const x = oc.x + ofx * hl * i - ofz * hw * j, z = oc.z + ofz * hl * i + ofx * hw * j;
        const lat = (x - p0[0]) * lrx + (z - p0[1]) * lrz, al = (x - s.x) * lfx + (z - s.z) * lfz;
        latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
        alMin = Math.min(alMin, al); alMax = Math.max(alMax, al);
      }
    }
    const myHw = v.sim.prof.width / 2, myHl = v.sim.prof.length / 2;
    const margin = 0.7;
    const left = Math.min(-1, latMin - myHw - margin), right = Math.max(1, latMax + myHw + margin);
    const candidates: number[] = [left, right, left - 1.6, right + 1.6].filter((off) => Math.abs(off) < 8);
    // Platz zum Einlenken: bei großem Versatz braucht es mehr Anlauf
    const runIn = myHl + 1 + Math.min(Math.abs(left), Math.abs(right)) * 0.9;
    let geometryOk = false, mustWait = false;
    for (const off of candidates) {
      // Streifen bis hinter das Hindernis frei? (Wände/Wasser, andere Fahrzeuge)
      let free = true;
      for (let al = 1; al <= alMax + myHl + 4 && free; al += 2) {
        for (const side of [-myHw, 0, myHw]) {
          const lat = off - latNow + side;
          const x = s.x + lfx * al + lrx * lat, z = s.z + lfz * al + lrz * lat;
          if (!footFree(map, x, z)) { free = false; break; }
        }
        if (!free) break;
        const cx = s.x + lfx * al + lrx * (off - latNow), cz = s.z + lfz * al + lrz * (off - latNow);
        for (const w of this.nearCells(this.vGrid, cx, cz, 4)) {
          if (w === v || w === o) continue;
          if (dist2(w.sim.car.x, w.sim.car.z, cx, cz) < 2.6 * 2.6) { free = false; break; }
        }
      }
      if (!free) continue;
      geometryOk = true;
      // Gegenspur: kommt jemand entgegen?
      if (off < 0) {
        let oncoming = false;
        for (const w of this.nearCells(this.vGrid, s.x + lfx * 25, s.z + lfz * 25, 32)) {
          if (w === v || w === o) continue;
          const rx = w.sim.car.x - s.x, rz = w.sim.car.z - s.z;
          const al = rx * lfx + rz * lfz, lat = (w.sim.car.x - p0[0]) * lrx + (w.sim.car.z - p0[1]) * lrz;
          if (al < -2 || al > alMax + 40 || Math.abs(lat - off) > 2.8) continue;
          const vel = w.sim.car.vx * lfx + w.sim.car.vz * lfz;
          if (vel < -0.8 || (al < alMax + 10 && Math.abs(vel) < 0.8)) { oncoming = true; break; }
        }
        if (oncoming) { mustWait = true; continue; }
      } else if (mustWait && !impatient) {
        continue; // lieber kurz auf eine Lücke im Gegenverkehr warten als über den Gehweg
      }
      if (alMin < runIn) { brain.revSide = off < 0 ? -1 : 1; return 'near'; }
      const dist = alMax + myHl + 3;
      brain.evade = off; brain.evadeT = 0.2; brain.detourT = 4 + dist / 3; brain.detourId = o.id; brain.ignore = 0;
      return 'ok';
    }
    if (mustWait) return 'wait';
    // Kein Streifen frei: ist das Hindernis sehr nah, hilft Zurücksetzen evtl. trotzdem (mehr Anlauf)
    if (!geometryOk && alMin < myHl + 2.5) return 'near';
    return 'fail';
  }

  /** Spurrahmen am nächsten Wegpunkt: Richtung (lf), rechts (lr) und der aktuelle Seitenversatz des Autos. */
  private laneFrame(brain: Brain, s: ServerVehicle['sim']['car']) {
    const p0 = brain.path[0], p1 = brain.path[1] ?? brain.path[0];
    let lfx = p1[0] - p0[0], lfz = p1[1] - p0[1];
    let l = Math.hypot(lfx, lfz);
    if (l < 0.5) { lfx = p0[0] - s.x; lfz = p0[1] - s.z; l = Math.hypot(lfx, lfz); }
    if (l < 0.01) { lfx = Math.sin(s.a); lfz = Math.cos(s.a); l = 1; }
    lfx /= l; lfz /= l;
    const lrx = -lfz, lrz = lfx;
    return { lfx, lfz, lrx, lrz, latNow: (s.x - p0[0]) * lrx + (s.z - p0[1]) * lrz };
  }

  /** Steckt gar nichts mehr: außer Sicht verschwinden, sonst wenden (zur Not durchfahren). */
  private giveUp(v: ServerVehicle, brain: Brain) {
    const s = v.sim.car;
    if (brain.pool >= 0 && this.unseen(s.x, s.z)) { this.despawn(v); return; }
    if (!this.uturn(v, brain)) { brain.ignore = 2.5; brain.stuck = 0; brain.jam = 0; brain.detourT = 0; brain.retryId = -1; }
  }

  /** Wenden: auf die Gegenrichtung der Straße wechseln (Hindernis bleibt hinter uns). */
  private uturn(v: ServerVehicle, brain: Brain): boolean {
    const s = v.sim.car;
    const hit = this.findLane(s.x, s.z, s.a, -1, 14);
    if (!hit) return false;
    const rest = hit.path.slice(hit.i + 1);
    if (!rest.length) return false;
    brain.path = rest;
    brain.turning = rest.map((_, k) => k < 3);
    brain.edge = hit.e.id; brain.toNode = hit.fwd ? hit.e.b : hit.e.a; brain.lane = 0; brain.cruise = Math.min(CRUISE[hit.e.type], brain.vmax ?? 99);
    brain.avoidId = brain.blockId; brain.avoidT = 6; brain.uturnT = 5; brain.retryId = -1;
    brain.detourT = 0; brain.evade = 0; brain.evadeT = 0; brain.stuck = 0; brain.jam = 0; brain.fails = 0; brain.rev = 0;
    this.honk(v, brain);
    return true;
  }

  // ------------------------------------------------------------------ kinematisch
  private driveKinematic(v: ServerVehicle, brain: Brain, dt: number, fast: [number, number, number, number][]) {
    const s = v.sim.car;
    const vehicles = this.host.vehicles;
    if (this.advancePath(brain, s.x, s.z)) brain.progT = 0; else brain.progT += dt;
    const fx = Math.sin(s.a), fz = Math.cos(s.a);
    const rx = -fz, rz = fx; // rechts
    const { lfx, lfz, lrx, lrz, latNow } = this.laneFrame(brain, s);
    if (brain.avoidT > 0) brain.avoidT -= dt;
    if (brain.uturnT > 0) brain.uturnT -= dt;
    if (brain.tryCd > 0) brain.tryCd -= dt;

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
      if (tc > 0.05 && cx * cx + cz * cz < 3.2 * 3.2 && brain.detourT <= 0) {
        // zur Seite, auf der der Spieler NICHT vorbeikommt
        const side = cx * lrx + cz * lrz > 0 ? -1 : 1;
        brain.evade = side * 1.8;
        brain.evadeT = 1.6;
        if (Math.random() < 0.5) this.honk(v, brain);
      }
    }
    if (brain.evadeT <= 0) brain.evade *= Math.max(0, 1 - dt * 2);

    // Ziel: nächster Wegpunkt, seitlich versetzt im Spurrahmen (nicht im Fahrzeugrahmen – sonst dreht
    // sich der Versatz mit dem Auto mit und es fährt im Kreis)
    const target = brain.path[0];
    const tx = target[0] + lrx * brain.evade, tz = target[1] + lrz * brain.evade;
    let desired = Math.atan2(tx - s.x, tz - s.z);
    const angleDiff = Math.abs(wrapAngle(desired - s.a));
    const tDist = Math.hypot(tx - s.x, tz - s.z);
    // Wegpunkt hinter uns und nah dran (oder lange kein Fortschritt): überspringen statt darum zu kreisen
    if (brain.uturnT <= 0 && brain.rev <= 0 && ((angleDiff > 2 && tDist < 7) || (brain.progT > 9 && brain.stuck <= 0))) {
      brain.path.shift(); brain.turning.shift(); brain.progT = 0;
      if (brain.path.length < 3) this.extend(brain);
    }
    let want = brain.turning[0] ? TURN_SPEED : brain.cruise;
    if (angleDiff > 0.6) want = 4; // enge Kurve: langsam
    if (angleDiff > 1.4) want = 2.5;
    if (brain.evadeT > 0) want *= 0.5;

    // Umfahren läuft: Seitenversatz halten, bis das Hindernis hinter uns liegt
    let detourObst: ServerVehicle | undefined;
    if (brain.detourT > 0) {
      brain.detourT -= dt;
      brain.evadeT = Math.max(brain.evadeT, 0.2);
      detourObst = vehicles.get(brain.detourId);
      if (!detourObst) brain.detourT = Math.min(brain.detourT, 0.3);
      else {
        const oc = detourObst.sim.car;
        const back = (oc.x - s.x) * lfx + (oc.z - s.z) * lfz;
        if (back < -(detourObst.sim.prof.length / 2 + v.sim.prof.length / 2 + 1.5)) brain.detourT = Math.min(brain.detourT, 0.3);
      }
    }
    const detouring = brain.detourT > 0;

    let blocked = false, byPlayer = false, still: ServerVehicle | null = null, blocker: ServerVehicle | null = null;
    if (brain.rev > 0) {
      // ------------------------------------------------ Zurücksetzen
      brain.rev -= dt;
      want = -REVERSE_SPEED;
      const laneA = Math.atan2(lfx, lfz);
      // Schnauze leicht zur Ausweichseite drehen (Winkel abnehmend = nach rechts)
      desired = wrapAngle(laneA - brain.revSide * 0.35);
      const hl = v.sim.prof.length / 2;
      let clear = footFree(this.host.map, s.x - fx * (hl + 1.2), s.z - fz * (hl + 1.2));
      const behind = (x: number, z: number, r: number) => {
        const dx = x - s.x, dz = z - s.z, al = dx * fx + dz * fz;
        return al < 0 && al > -(hl + r + 1.5) && Math.abs(dx * rx + dz * rz) < 2;
      };
      if (clear) for (const o of this.nearCells(this.vGrid, s.x, s.z, 10)) {
        if (o !== v && behind(o.sim.car.x, o.sim.car.z, o.sim.prof.length / 2)) { clear = false; break; }
      }
      if (clear) for (const p of this.nearCells(this.pGrid, s.x, s.z, 8)) {
        if (behind(p.x, p.z, 0.5)) { clear = false; break; }
      }
      // genug Abstand gewonnen?
      const o = vehicles.get(brain.blockId);
      const gap = o ? Math.hypot(o.sim.car.x - s.x, o.sim.car.z - s.z) - o.sim.prof.length / 2 - hl : 99;
      if (!clear || gap > 6.5 || brain.rev <= 0) {
        brain.rev = 0; want = 0; brain.tryCd = 0.3; brain.stuck = 1.5;
        if (o) brain.retryId = o.id;
        if (!clear && brain.speed > -0.5) brain.fails++;
      }
    } else {
      // ------------------------------------------------ Hindernis voraus?
      // Kegel vor dem Auto; beim Umfahren im Spurrahmen auf die Ausweichspur gelegt und schmaler
      const look = 8 + Math.abs(brain.speed) * 0.6;
      const ahead = (x: number, z: number) => {
        const dx = x - s.x, dz = z - s.z;
        if (detouring) {
          const al = dx * lfx + dz * lfz;
          if (al <= 0 || al > look) return false;
          return Math.abs(dx * lrx + dz * lrz - (brain.evade - latNow)) < 1.7;
        }
        const along = dx * fx + dz * fz;
        if (along <= 0 || along > look) return false;
        return Math.abs(dx * rx + dz * rz) < 2.4;
      };
      // nach dem Zurücksetzen: vor dem Hindernis stehen bleiben, bis der Umfahrversuch klappt
      const retry = brain.retryId >= 0 ? vehicles.get(brain.retryId) : undefined;
      if (brain.retryId >= 0 && (!retry || brain.stuck > 12)) brain.retryId = -1;
      if (retry && brain.retryId >= 0 && !detouring) {
        blocked = true; blocker = retry; still = retry; byPlayer = retry.driver >= 0 || retry.driver === DRIVER_NONE;
      } else if (brain.ignore <= 0) {
        for (const o of this.nearCells(this.vGrid, s.x + fx * look * 0.5, s.z + fz * look * 0.5, look * 0.5 + 3)) {
          if (o === v || o === detourObst || (brain.avoidT > 0 && o.id === brain.avoidId)) continue;
          if (!ahead(o.sim.car.x, o.sim.car.z)) continue;
          blocked = true; blocker = o; byPlayer = o.driver >= 0 || o.driver === DRIVER_NONE;
          if (this.isStill(o)) still = o;
          break;
        }
        if (!blocked) {
          for (const p of this.nearCells(this.pGrid, s.x + fx * look * 0.5, s.z + fz * look * 0.5, look * 0.5 + 3)) {
            if (ahead(p.x, p.z)) { blocked = true; break; }
          }
        }
      } else {
        brain.ignore -= dt;
      }
    }
    if (blocked) want = 0;
    brain.blockId = blocker ? blocker.id : (brain.rev > 0 ? brain.blockId : -1);
    // Hupen, wenn ein Spieler(-auto) im Weg steht
    if (blocked && byPlayer) { brain.blockedByPlayer += dt; if (brain.blockedByPlayer > 1.2) this.honk(v, brain); } else brain.blockedByPlayer = 0;
    if (detouring && !blocked) want = Math.min(want, 5.5);

    // Stau-Zähler
    const standing = Math.abs(brain.speed) < 0.5;
    if (standing && (blocked || brain.rev > 0)) brain.jam += dt;
    else if (Math.abs(brain.speed) > 2) brain.jam = Math.max(0, brain.jam - dt * 2);

    // Verklemmung auflösen
    if (blocked && standing) {
      brain.stuck += dt;
      if (still && !detouring && brain.stuck > 1 && brain.tryCd <= 0) {
        const r = this.startDetour(v, brain, still, brain.stuck > 7);
        if (r === 'ok') { brain.stuck = 0; brain.fails = 0; brain.retryId = -1; }
        else if (r === 'near') {
          if (brain.fails < 2) { brain.rev = 2.5; brain.fails++; brain.blockId = still.id; brain.retryId = -1; this.honk(v, brain); }
          else this.giveUp(v, brain);
        } else if (r === 'wait') brain.tryCd = 0.4;
        else { brain.tryCd = 1; if (brain.stuck > 9) this.giveUp(v, brain); }
      } else if (!still && blocker) {
        // fahrender bzw. selbst wartender Verkehr: normalerweise einfach anstellen. Nur gegenseitiges
        // Blockieren (Kreuzung) wird nach kurzer Zeit aufgelöst, indem einer durchfährt.
        const ob = this.brains.get(blocker.id);
        const mutual = ob && ob.blockId === v.id;
        if ((mutual && brain.stuck > 2 + (v.id % 3)) || (!ob && brain.stuck > 4) || (ob?.mode === 'drive' && brain.stuck > 14)) {
          brain.ignore = 1.5; brain.stuck = 0;
        }
      } else if (!blocker && brain.stuck > 3.5) {
        brain.ignore = 1.5; brain.stuck = 0; // Fußgänger bleibt stehen
      }
    } else if (!blocked && brain.rev <= 0) {
      brain.stuck = 0;
    }
    // Ewig festgesteckt (z. B. Stau hinter einem unpassierbaren Hindernis): wenden bzw. verschwinden
    if (brain.jam > (this.unseen(s.x, s.z) ? 15 : 28) && this.brains.has(v.id)) this.giveUp(v, brain);
    if (!this.brains.has(v.id)) return;

    const prev = brain.speed;
    brain.speed += Math.max(-18 * dt, Math.min(6 * dt, want - brain.speed));
    let a = s.a;
    // Lenken nur in Bewegung (begrenzter Wenderadius) – kein Drehen auf der Stelle
    const maxTurn = Math.min(2.6, Math.abs(brain.speed) / MIN_RADIUS) * dt;
    const turn = Math.max(-maxTurn, Math.min(maxTurn, wrapAngle(desired - a)));
    a = wrapAngle(a + turn);
    const nx = s.x + Math.sin(a) * brain.speed * dt, nz = s.z + Math.cos(a) * brain.speed * dt;
    // Zustand für Physik/Anzeige konsistent halten
    s.x = nx; s.z = nz;
    s.y = groundHeight(this.host.map, nx, nz) + v.sim.prof.cgHeight;
    setYaw(s, a);
    s.vx = Math.sin(a) * brain.speed; s.vz = Math.cos(a) * brain.speed; s.vy = 0;
    s.wx = 0; s.wz = 0; s.wy = turn / dt;
    const sgn = brain.speed < 0 ? -1 : 1;
    s.steer = Math.max(-0.5, Math.min(0.5, sgn * (turn / dt) * v.sim.prof.wheelbase / Math.max(2, Math.abs(brain.speed))));
    s.brk = Math.abs(brain.speed) < Math.abs(prev) - 0.01 ? 1 : 0;
    s.thr = Math.abs(brain.speed) > Math.abs(prev) ? 0.5 : 0;
    s.rpm = 900 + Math.abs(brain.speed) * 120;
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

    if (brain.mode === 'crash') {
      // anhalten, kurz sammeln
      buttons = Math.abs(s.s) > 1 ? Btn.BRAKE : 0;
      if (brain.bail && ((Math.abs(s.s) < 1.5 && brain.timer > 0.3) || brain.timer > 5)) {
        // beschossen: aussteigen und weglaufen
        this.host.driverOut(v, false); this.brains.delete(v.id); return;
      }
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
        brain.timer = 0; brain.progT = 0; brain.jam = 0; brain.stuck = 0;
      }
    } else {
      // Ausparken bzw. flüchten: der Spur mit Physik folgen
      if (this.advancePath(brain, s.x, s.z)) brain.progT = 0; else brain.progT += dt;
      const target = brain.path[0];
      const desired = Math.atan2(target[0] - s.x, target[1] - s.z);
      const diff = wrapAngle(desired - s.a);
      const tDist = Math.hypot(target[0] - s.x, target[1] - s.z);
      ax = Math.max(-1, Math.min(1, -diff * 2.2));
      if (brain.mode === 'depart') {
        ay = s.s < 4.5 ? 0.6 : 0;
      } else {
        const want = Math.abs(diff) > 0.9 ? 6 : brain.cruise * (brain.panic ? 2.4 : 1.5);
        ay = s.s < want ? 1 : 0;
      }
      // Ziel liegt hinter/neben uns im Wendekreis oder wir hängen fest: zurücksetzen statt im Kreis zu fahren
      if (brain.rev > 0) {
        brain.rev -= dt; ay = -1; ax = -ax;
      } else if (brain.timer > 0.8 && Math.abs(s.s) < 3 && ((Math.abs(diff) > 1.8 && tDist < 9) || brain.stuck > 1.2)) {
        brain.rev = 1.3; brain.stuck = 0;
      }
      if (Math.abs(s.s) < 0.5 && brain.timer > 1 && brain.rev <= 0) brain.stuck += dt; else if (Math.abs(s.s) > 1) brain.stuck = 0;
      brain.jam = Math.abs(s.s) < 0.6 ? brain.jam + dt : 0;

      if (brain.mode === 'depart') {
        if (brain.jam > 6 || brain.timer > 25 || brain.progT > 10) { this.resume(v, brain); return; }
        if (brain.timer > 1.5 && this.nearPath(s.x, s.z, brain, 2) && Math.abs(diff) < 0.3) { this.resume(v, brain); return; }
      } else {
        if (brain.jam > 5 || up[1] < 0.5 || brain.progT > 15) {
          // außer Sicht einfach weg, sonst steigt der Fahrer aus
          if (brain.pool >= 0 && up[1] >= 0.5 && this.unseen(s.x, s.z)) { this.despawn(v); return; }
          this.host.driverOut(v, false); this.brains.delete(v.id); return;
        }
        if (brain.timer > (brain.panic ? 20 : 8) && this.nearPath(s.x, s.z, brain, 3) && Math.abs(diff) < 0.4) { this.resume(v, brain); return; }
      }
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
    brain.panic = false; brain.bail = false;
    brain.severity = 0;
    brain.timer = 0; brain.stuck = 0; brain.jam = 0; brain.progT = 0; brain.rev = 0; brain.detourT = 0; brain.retryId = -1;
    v.kinematic = true;
  }
}

function norm(v: [number, number] | number[]): Vec2 {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
