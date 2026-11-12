// Fußgänger: laufen auf den Gehwegen des Straßengraphs (Versatz der Mittelkurve um
// halbe Fahrbahn + halben Gehweg), wechseln an Kreuzungen auf einen anderen Gehweg
// und laufen vor schnellen Fahrzeugen weg.
import { NPC_DENSITY, OUTFIT_COLORS } from '../../../shared/src/constants';
import { dist2 } from '../../../shared/src/math';
import { archetypeOf, ARCH_INDEX } from '../../../shared/src/npc/archetypes';
import { Act, type ScenarioId } from '../../../shared/src/npc/scenarios';
import { hasPopTable } from '../../../shared/src/npc/population';
import { knockPawn, stepPawn } from '../../../shared/src/sim/movement';
import { offsetPolyline, type Vec2 } from '../../../shared/src/world/geometry';
import { drivablePath } from '../../../shared/src/world/roads';
import { Zone, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { Mind } from './NpcBrain';

const STROLL_SPEED = 1.5;
export const FLEE_SPEED = 4.5;
const PED_HP = 30;
const PED_COUNT = Math.round(56 * NPC_DENSITY);

/** Ein Gehweg = eine Straßenseite einer Kante. */
export interface Walkway { edge: RoadEdge; side: 1 | -1; pts: Vec2[]; /** Viertelname ('' = keines) */ district: string }

/** Laufendes Szenario eines Passanten (Smart Object oder frei). obj = -1: freies Szenario. */
export interface PedScenario { id: ScenarioId; obj: number; slot: number; t: number; dur: number }

export interface Ped {
  id: number;
  x: number; z: number; a: number;
  color: number;
  /** Aktueller Gehweg und Laufrichtung (null = temporärer Fußgänger, z. B. aus dem Auto geworfener Fahrer). */
  walk: Walkway | null;
  dir: 1 | -1;
  idx: number; // nächster Wegpunkt auf walk.pts
  wait: number;
  flee: number; // verbleibende Fluchtzeit
  fdx: number; fdz: number; // Fluchtrichtung
  ttl: number; // Lebensdauer temporärer Fußgänger
  /** Comic-Ragdoll (siehe PawnState) */
  h: number; vx: number; vy: number; vz: number; rt: number;
  /** Schimpft gerade (Sekunden) */
  angry: number;
  /** Lebenspunkte; bei 0 fällt der Passant um und verschwindet (Comic-Gewalt ohne Blut). */
  hp: number;
  /** > 0: Polizist, der diesen Spieler (ID) verfolgt – wird von Police gesteuert, nicht von hier. */
  cop: number;
  /** Von außen gesteuert (Gang-NPCs, Quest-NPCs): Pedestrians bewegt sie nicht. */
  ext: boolean;
  /** Gang-Zugehörigkeit ('' = keine), Quest-Zuordnung, Verhalten. */
  gang: string;
  tag: string;
  run: number;
  hostile: boolean;
  /** Angriffsziel: 'players' | 'ped:<id>' | 'veh:<id>' */
  tgt: string;
  /** Sekunden, in denen die Gang wegen eines Angriffs feindlich ist, und gegen wen. */
  provoked: number;
  provokedBy: number;
  home: { x: number; z: number };
  shotCd: number;
  think: number;
  wx: number; wz: number;
  /** Sekunden, die der Passant beim Gehen festhängt (vor dem Umdrehen) */
  blk: number;
  /** Archetyp (Index in ARCHETYPES, -1 = klassischer Passant ohne Archetyp) und Animations-ID (Act). */
  arch: number;
  act: number;
  /** Gehtempo in m/s */
  spd: number;
  /** Von der Population-Steuerung verwaltet (spawnt/despawnt nach Spieler-Umkreis). */
  pop: boolean;
  /** Sekunden seit dem Spawn (Population tauscht alte NPCs außerhalb der Sicht aus). */
  age: number;
  scn: PedScenario | null;
  /** Mini-Lebenszyklus, Wahrnehmung, Gedächtnis (nur von der Population verwaltete NPCs, siehe NpcBrain). */
  mind: Mind | null;
}

/** Steuerung für verwaltete NPCs (NpcBrain): übernimmt Bewegung und Entscheidungen. */
export interface PedBrain {
  tick(p: Ped, dt: number, threats: Threat[]): void;
  /** Am Ende eines Gehwegs: gibt die Route einen Gehweg vor? */
  routeNext(p: Ped, node: number, options: Walkway[]): Walkway | null;
}

export interface Threat { x: number; z: number; speed: number; vx: number; vz: number }

export class Pedestrians {
  readonly peds = new Map<number, Ped>();
  walkways: Walkway[] = [];
  /** Gehwege je Knoten (Anfang oder Ende der Kante liegt am Knoten). */
  readonly byNode = new Map<number, Walkway[]>();
  /** Gehirn der verwalteten NPCs (wird von WorldRoom gesetzt). */
  brain: PedBrain | null = null;
  /**
   * Ausweichen vor stehenden Hindernissen (geparkte/verlassene Autos auf dem Gehweg), von WorldRoom gesetzt.
   * Bekommt die gewünschte Laufrichtung (Welt, normiert) und liefert eine Ersatzrichtung oder null.
   */
  avoid: ((p: Ped, dx: number, dz: number) => [number, number] | null) | null = null;

  constructor(private map: WorldMap, private allocId: () => number) {
    for (const e of map.edges) {
      if (e.sidewalk <= 0 || e.len - e.trimA - e.trimB < 8) continue;
      const center = drivablePath(e, true);
      for (const side of [1, -1] as const) {
        const mid = e.pts[Math.floor(e.pts.length / 2)];
        const district = map.districtAt(mid[0], mid[1])?.name ?? '';
        const w: Walkway = { edge: e, side, pts: offsetPolyline(center, side * (e.width / 2 + e.sidewalk / 2)), district };
        this.walkways.push(w);
        for (const n of [e.a, e.b]) {
          let l = this.byNode.get(n);
          if (!l) this.byNode.set(n, (l = []));
          l.push(w);
        }
      }
    }
    if (!this.walkways.length) return;
    // Verteilung nach Gehweglänge, Port Coralia bevorzugt
    for (let i = 0; i < PED_COUNT; i++) {
      for (let tries = 0; tries < 20; tries++) {
        const w = this.walkways[Math.floor(Math.random() * this.walkways.length)];
        if (hasPopTable(w.district)) continue; // Population Tables übernehmen dieses Viertel
        const p = w.pts[Math.floor(Math.random() * w.pts.length)];
        if (map.zoneAt(p[0], p[1]) !== Zone.PortCoralia && Math.random() < 0.6) continue;
        const ped = this.add(p[0], p[1], w);
        ped.idx = Math.min(w.pts.length - 1, w.pts.indexOf(p) + 1);
        break;
      }
    }
  }

  private add(x: number, z: number, walk: Walkway | null): Ped {
    const ped: Ped = {
      id: this.allocId(), x, z, a: Math.random() * Math.PI * 2,
      color: Math.floor(Math.random() * OUTFIT_COLORS.length),
      walk, dir: 1, idx: 0, wait: Math.random() * 3, flee: 0, fdx: 0, fdz: 0, ttl: Infinity,
      h: 0, vx: 0, vy: 0, vz: 0, rt: 0, angry: 0, hp: PED_HP, cop: 0,
      ext: false, gang: '', tag: '', run: 0, hostile: false, tgt: 'players', provoked: 0, provokedBy: 0, home: { x, z }, shotCd: 0, think: 0, wx: x, wz: z, blk: 0,
      arch: -1, act: 0, spd: STROLL_SPEED, pop: false, age: 0, scn: null, mind: null,
    };
    this.peds.set(ped.id, ped);
    return ped;
  }

  /** Passant mit Archetyp, von der Population gesteuert. walk = null: Szenario-Figur (steht, bis das Szenario endet). */
  spawnManaged(x: number, z: number, walk: Walkway | null, arch: number, a = Math.random() * Math.PI * 2): Ped {
    const ped = this.add(x, z, walk);
    const def = archetypeOf(arch);
    ped.arch = arch; ped.pop = true; ped.a = a;
    ped.spd = def.speed * (0.9 + Math.random() * 0.2);
    ped.color = def.shirts ? def.shirts[Math.floor(Math.random() * def.shirts.length)] : ped.color;
    ped.wait = walk ? Math.random() * 2 : 0;
    ped.act = this.walkAct(arch);
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    if (walk) ped.idx = nearestIdx(walk, x, z);
    return ped;
  }

  /** Animation beim normalen Gehen (Jogger, Hundebesitzer) */
  walkAct(arch: number): number {
    const id = archetypeOf(arch).id;
    return id === 'jogger' ? Act.Jog : id === 'dogwalker' ? Act.Dog : Act.None;
  }

  /** Szenario beginnen: Figur steht auf (x, z) mit Blick a und führt `act` aus. */
  startScenario(p: Ped, sc: PedScenario, act: number, x: number, z: number, a: number) {
    p.scn = sc; p.act = act; p.walk = null; p.x = x; p.z = z; p.a = a;
    p.wx = x; p.wz = z; p.wait = 0; p.flee = 0;
  }

  /** Szenario beenden: Figur läuft auf dem nächsten Gehweg weiter. */
  endScenario(p: Ped) {
    p.scn = null;
    p.age = Math.max(p.age, 50); // wer fertig ist, geht bald
    p.act = this.walkAct(p.arch);
    const w = this.nearestWalkway(p.x, p.z);
    if (w) { p.walk = w; p.idx = nearestIdx(w, p.x, p.z); p.dir = Math.random() < 0.5 ? 1 : -1; }
    else p.ttl = 4;
  }

  nearestWalkway(x: number, z: number): Walkway | null {
    let best: Walkway | null = null, bd = 400;
    for (const w of this.walkways) {
      const m = w.pts[Math.floor(w.pts.length / 2)];
      if (Math.abs(m[0] - x) > w.edge.len || Math.abs(m[1] - z) > w.edge.len) continue;
      for (const q of w.pts) { const d = dist2(q[0], q[1], x, z); if (d < bd) { bd = d; best = w; } }
    }
    return best;
  }

  /** Spaziergänger auf einem festen Weg ohne Straßengraph (z. B. Flughafen-Terminal): pendelt hin und her. */
  spawnStroller(x: number, z: number, walk: Walkway, arch: number): Ped {
    const ped = this.add(x, z, walk);
    ped.arch = arch;
    const def = archetypeOf(arch);
    ped.spd = def.speed * (0.85 + Math.random() * 0.3);
    if (def.shirts) ped.color = def.shirts[Math.floor(Math.random() * def.shirts.length)];
    ped.idx = nearestIdx(walk, x, z);
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    return ped;
  }

  /** Ein NPC-Fahrer wurde aus seinem Auto "überredet" und rennt davon. */
  spawnFleeing(x: number, z: number) {
    const ped = this.add(x, z, null);
    const ang = Math.random() * Math.PI * 2;
    ped.flee = 4; ped.fdx = Math.cos(ang); ped.fdz = Math.sin(ang); ped.ttl = 15;
    return ped;
  }

  /** Wütender NPC-Fahrer: steht kurz schimpfend neben dem Auto (Blick zu (lx, lz)), läuft dann weg. */
  spawnAngry(x: number, z: number, lx: number, lz: number) {
    const ped = this.add(x, z, null);
    ped.a = Math.atan2(lx - x, lz - z);
    ped.angry = 3;
    ped.wait = 3;
    const ang = Math.random() * Math.PI * 2;
    ped.fdx = Math.cos(ang); ped.fdz = Math.sin(ang); ped.ttl = 20;
    return ped;
  }

  /** Von außen gesteuerter NPC (Gang-Mitglied, Quest-Figur). */
  spawnExt(x: number, z: number, o: Partial<Pick<Ped, 'gang' | 'tag' | 'run' | 'hostile' | 'tgt' | 'hp' | 'color'>>) {
    const ped = this.add(x, z, null);
    ped.ext = true; ped.hp = o.hp ?? 50; ped.ttl = Infinity;
    if (o.gang !== undefined) ped.gang = o.gang;
    if (o.tag !== undefined) ped.tag = o.tag;
    if (o.run !== undefined) ped.run = o.run;
    if (o.hostile !== undefined) ped.hostile = o.hostile;
    if (o.tgt !== undefined) ped.tgt = o.tgt;
    if (o.color !== undefined) ped.color = o.color;
    return ped;
  }

  /** Polizist erzeugen (wird von Police bewegt). */
  spawnCop(x: number, z: number, target: number) {
    const ped = this.add(x, z, null);
    ped.cop = target; ped.hp = 60; ped.wait = 0;
    return ped;
  }

  /** Von einem Fahrzeug erfasst: Comic-Flug, danach flüchten. */
  knock(p: Ped, vx: number, vz: number, up: number) {
    knockPawn(p, vx, vz, up, 1.6);
    if (p.scn) { p.scn = null; p.act = 0; }
    if (p.mind) { p.mind.react = null; p.act = 0; }
    const l = Math.hypot(vx, vz) || 1;
    p.fdx = vx / l; p.fdz = vz / l;
    p.angry = 0;
  }

  /** Waffentreffer: Schaden + Rückstoß. Gibt true zurück, wenn der Passant besiegt wurde. */
  hit(p: Ped, dmg: number, dx: number, dz: number): boolean {
    p.hp -= dmg;
    const dead = p.hp <= 0;
    if (p.scn) { p.scn = null; p.act = 0; }
    if (p.mind) { p.mind.react = null; p.act = 0; }
    knockPawn(p, dx * (dead ? 5 : 2), dz * (dead ? 5 : 2), dead ? 5 : 2, dead ? 2.2 : 0.7);
    p.fdx = dx; p.fdz = dz; p.angry = 0;
    return dead;
  }

  /** Schüsse/Explosionen: Passanten im Umkreis rennen vom Ursprung weg. */
  scare(x: number, z: number, radius: number) {
    for (const p of this.peds.values()) {
      if (p.rt > 0 || p.hp <= 0 || p.cop || p.ext || p.mind) continue; // verwaltete NPCs: Perception entscheidet
      const d2 = dist2(p.x, p.z, x, z);
      if (d2 > radius * radius) continue;
      const d = Math.sqrt(d2) || 1;
      p.fdx = (p.x - x) / d; p.fdz = (p.z - z) / d;
      p.flee = Math.max(p.flee, 4);
      p.wait = 0; p.angry = 0;
    }
  }

  /** Am Ende eines Gehwegs: an der Kreuzung auf einen anderen Gehweg wechseln. */
  private nextWalkway(p: Ped) {
    const w = p.walk!;
    const node = p.dir === 1 ? w.edge.b : w.edge.a; // Gehweg-Punkte laufen immer von a nach b
    const options = (this.byNode.get(node) ?? []).filter((o) => o !== w);
    const routed = p.mind && this.brain ? this.brain.routeNext(p, node, options) : null;
    if (routed) {
      p.walk = routed;
      p.dir = routed.edge.a === node ? 1 : -1;
      p.idx = p.dir === 1 ? 0 : routed.pts.length - 1;
      return;
    }
    if (!options.length) { p.dir = (p.dir * -1) as 1 | -1; p.idx = p.dir === 1 ? 0 : w.pts.length - 1; return; }
    // Bevorzugt Gehwege, deren Ende nah liegt (gleiche Straßenecke), manchmal die Straße queren
    options.sort((a, b) => endDist(a, node, p) - endDist(b, node, p));
    const pick = Math.random() < 0.7 ? options[0] : options[Math.floor(Math.random() * options.length)];
    p.walk = pick;
    p.dir = pick.edge.a === node ? 1 : -1;
    p.idx = p.dir === 1 ? 0 : pick.pts.length - 1;
  }

  update(dt: number, threats: Threat[]) {
    this.buildGrid();
    for (const p of this.peds.values()) {
      if (p.cop || p.ext) {
        if (p.rt > 0) { stepPawn(this.map, p, 0, 0, 0, dt); if (p.rt <= 0 && p.hp <= 0) this.peds.delete(p.id); }
        continue;
      }
      if (p.rt > 0) {
        stepPawn(this.map, p, 0, 0, 0, dt);
        if (p.rt <= 0) { if (p.hp <= 0) this.peds.delete(p.id); else p.flee = 4; }
        continue;
      }
      if (p.mind && this.brain) {
        this.brain.tick(p, dt, threats);
        continue;
      }
      if (p.angry > 0) p.angry -= dt;
      // Gefahr: schnelles Fahrzeug in der Nähe?
      for (const t of threats) {
        if (Math.abs(t.speed) < 5) continue;
        const d2 = dist2(p.x, p.z, t.x, t.z);
        if (d2 < 9 * 9) {
          const d = Math.sqrt(d2) || 1;
          p.fdx = (p.x - t.x) / d; p.fdz = (p.z - t.z) / d;
          p.flee = 1.6;
          break;
        }
      }

      if (p.scn) {
        if (p.flee > 0) this.endScenario(p); // Gefahr: Szenario abbrechen, flüchten
        else {
          p.scn.t -= dt;
          if (p.scn.t <= 0) this.endScenario(p);
          continue;
        }
      }

      if (p.flee > 0) {
        p.flee -= dt;
        stepPawn(this.map, p, p.fdx, -p.fdz, 0, dt, FLEE_SPEED);
      } else if (p.wait > 0) {
        p.wait -= dt;
      } else if (!p.walk) {
        p.flee = 5; // temporäre Fußgänger (ausgestiegene Fahrer) laufen davon
      } else if (p.walk) {
        this.walkStep(p, dt);
      }

      p.ttl -= dt;
      if (p.ttl <= 0) this.peds.delete(p.id);
    }
  }

  /** Einen Tick auf dem Gehweg weiterlaufen (Wegpunkte, Kreuzungen). speed = Tempo-Faktor. */
  walkStep(p: Ped, dt: number, speed = 1) {
    const w = p.walk!;
    const target = w.pts[p.idx];
    const dx = target[0] - p.x, dz = target[1] - p.z;
    if (dx * dx + dz * dz < 1.2) {
      p.idx += p.dir;
      if (p.idx < 0 || p.idx >= w.pts.length) {
        this.nextWalkway(p);
        if (!p.mind && Math.random() < 0.3) p.wait = 1 + Math.random() * 3; // an der Ecke kurz warten
      }
    } else {
      const d = Math.hypot(dx, dz);
      let mx = dx / d, mz = dz / d;
      const av = this.avoid?.(p, mx, mz);
      if (av) [mx, mz] = av;
      const ap = this.avoidPeds(p, mx, mz);
      if (ap) [mx, mz] = ap;
      const stuck = stepPawn(this.map, p, mx, -mz, 0, dt, p.spd * speed);
      if (stuck && !av) {
        // Festgelaufen: erst seitlich versuchen, erst nach längerer Blockade umdrehen
        p.blk += dt;
        if (p.blk > 1.5) { p.blk = 0; p.dir = (p.dir * -1) as 1 | -1; p.idx = Math.max(0, Math.min(w.pts.length - 1, p.idx + p.dir)); }
        else stepPawn(this.map, p, -mz * (p.id % 2 ? 1 : -1), -mx * (p.id % 2 ? -1 : 1), 0, dt, p.spd * speed * 0.7);
      } else p.blk = Math.max(0, p.blk - dt);
    }
  }

  /** Anderen Fußgängern/Spielern auf dem Weg seitlich ausweichen (Rechtsverkehr bei Gegenverkehr). */
  // Raster (2 m) der Fußgänger zu Tickbeginn: avoidPeds sucht nur in den 3x3 Nachbarzellen statt
  // über alle NPCs (vorher O(n²)). Suchradius 1,7 m + Bewegung im Tick < 2 m -> gleiches Ergebnis.
  private grid = new Map<number, Ped[]>();
  private gridPool: Ped[][] = [];
  private buildGrid() {
    for (const l of this.grid.values()) { l.length = 0; this.gridPool.push(l); }
    this.grid.clear();
    for (const q of this.peds.values()) {
      const k = cellKey(Math.floor(q.x / PED_CELL), Math.floor(q.z / PED_CELL));
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = this.gridPool.pop() ?? []));
      l.push(q);
    }
  }

  private avoidPeds(p: Ped, mx: number, mz: number): [number, number] | null {
    let best: Ped | null = null, bd = 1.7;
    const cx = Math.floor(p.x / PED_CELL), cz = Math.floor(p.z / PED_CELL);
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) for (const q of this.grid.get(cellKey(cx + ox, cz + oz)) ?? NONE) {
      if (q === p || q.rt > 0 || !this.peds.has(q.id)) continue;
      const rx = q.x - p.x, rz = q.z - p.z;
      const along = rx * mx + rz * mz;
      if (along < 0.1 || along > bd) continue;
      if (Math.abs(rx * -mz + rz * mx) > 0.85) continue;
      best = q; bd = along;
    }
    if (!best) return null;
    const lat = (best.x - p.x) * -mz + (best.z - p.z) * mx; // > 0: links von uns
    const side = Math.abs(lat) < 0.15 ? (p.id % 2 ? 1 : -1) : lat > 0 ? -1 : 1; // -1 = links, 1 = rechts
    const k = 1.1 * (1 - bd / 1.8) + 0.5;
    const ox = mx + mz * side * k, oz = mz - mx * side * k, l = Math.hypot(ox, oz) || 1;
    return [ox / l, oz / l];
  }

  /** "Läuft gerade" für die Animation auf dem Client. */
  isRunning(p: Ped) { return p.flee > 0; }
}

const PED_CELL = 2;
const NONE: Ped[] = [];
const cellKey = (cx: number, cz: number) => cz * 8192 + cx;

/** Abstand vom Fußgänger zum Ende des Gehwegs, das am Knoten liegt. */
function endDist(w: Walkway, node: number, p: Ped) {
  const q = w.edge.a === node ? w.pts[0] : w.pts[w.pts.length - 1];
  return Math.hypot(q[0] - p.x, q[1] - p.z);
}

export function nearestIdx(w: Walkway, x: number, z: number): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < w.pts.length; i++) { const d = dist2(w.pts[i][0], w.pts[i][1], x, z); if (d < bd) { bd = d; best = i; } }
  return best;
}
export { ARCH_INDEX };
