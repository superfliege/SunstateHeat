// Fußgänger: laufen auf den Gehwegen des Straßengraphs (Versatz der Mittelkurve um
// halbe Fahrbahn + halben Gehweg), wechseln an Kreuzungen auf einen anderen Gehweg
// und laufen vor schnellen Fahrzeugen weg.
import { NPC_DENSITY, OUTFIT_COLORS } from '../../../shared/src/constants';
import { dist2 } from '../../../shared/src/math';
import { knockPawn, stepPawn } from '../../../shared/src/sim/movement';
import { offsetPolyline, type Vec2 } from '../../../shared/src/world/geometry';
import { drivablePath } from '../../../shared/src/world/roads';
import { Zone, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';

const STROLL_SPEED = 1.5;
const FLEE_SPEED = 4.5;
const PED_HP = 30;
const PED_COUNT = Math.round(56 * NPC_DENSITY);

/** Ein Gehweg = eine Straßenseite einer Kante. */
interface Walkway { edge: RoadEdge; side: 1 | -1; pts: Vec2[] }

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
}

export interface Threat { x: number; z: number; speed: number }

export class Pedestrians {
  readonly peds = new Map<number, Ped>();
  private walkways: Walkway[] = [];
  /** Gehwege je Knoten (Anfang oder Ende der Kante liegt am Knoten). */
  private byNode = new Map<number, Walkway[]>();

  constructor(private map: WorldMap, private allocId: () => number) {
    for (const e of map.edges) {
      if (e.sidewalk <= 0 || e.len - e.trimA - e.trimB < 8) continue;
      const center = drivablePath(e, true);
      for (const side of [1, -1] as const) {
        const w: Walkway = { edge: e, side, pts: offsetPolyline(center, side * (e.width / 2 + e.sidewalk / 2)) };
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
      ext: false, gang: '', tag: '', run: 0, hostile: false, tgt: 'players', provoked: 0, provokedBy: 0, home: { x, z }, shotCd: 0, think: 0, wx: x, wz: z,
    };
    this.peds.set(ped.id, ped);
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
    const l = Math.hypot(vx, vz) || 1;
    p.fdx = vx / l; p.fdz = vz / l;
    p.angry = 0;
  }

  /** Waffentreffer: Schaden + Rückstoß. Gibt true zurück, wenn der Passant besiegt wurde. */
  hit(p: Ped, dmg: number, dx: number, dz: number): boolean {
    p.hp -= dmg;
    const dead = p.hp <= 0;
    knockPawn(p, dx * (dead ? 5 : 2), dz * (dead ? 5 : 2), dead ? 5 : 2, dead ? 2.2 : 0.7);
    p.fdx = dx; p.fdz = dz; p.angry = 0;
    return dead;
  }

  /** Schüsse/Explosionen: Passanten im Umkreis rennen vom Ursprung weg. */
  scare(x: number, z: number, radius: number) {
    for (const p of this.peds.values()) {
      if (p.rt > 0 || p.hp <= 0 || p.cop || p.ext) continue;
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
    if (!options.length) { p.dir = (p.dir * -1) as 1 | -1; p.idx = p.dir === 1 ? 0 : w.pts.length - 1; return; }
    // Bevorzugt Gehwege, deren Ende nah liegt (gleiche Straßenecke), manchmal die Straße queren
    options.sort((a, b) => endDist(a, node, p) - endDist(b, node, p));
    const pick = Math.random() < 0.7 ? options[0] : options[Math.floor(Math.random() * options.length)];
    p.walk = pick;
    p.dir = pick.edge.a === node ? 1 : -1;
    p.idx = p.dir === 1 ? 0 : pick.pts.length - 1;
  }

  update(dt: number, threats: Threat[]) {
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

      if (p.flee > 0) {
        p.flee -= dt;
        stepPawn(this.map, p, p.fdx, -p.fdz, 0, dt, FLEE_SPEED);
      } else if (p.wait > 0) {
        p.wait -= dt;
      } else if (!p.walk) {
        p.flee = 5; // temporäre Fußgänger (ausgestiegene Fahrer) laufen davon
      } else if (p.walk) {
        const target = p.walk.pts[p.idx];
        const dx = target[0] - p.x, dz = target[1] - p.z;
        if (dx * dx + dz * dz < 1.2) {
          p.idx += p.dir;
          if (p.idx < 0 || p.idx >= p.walk.pts.length) {
            this.nextWalkway(p);
            if (Math.random() < 0.3) p.wait = 1 + Math.random() * 3; // an der Ecke kurz warten
          }
        } else {
          const d = Math.hypot(dx, dz);
          const stuck = stepPawn(this.map, p, dx / d, -dz / d, 0, dt, STROLL_SPEED);
          if (stuck) { p.dir = (p.dir * -1) as 1 | -1; p.idx = Math.max(0, Math.min(p.walk.pts.length - 1, p.idx + p.dir)); }
        }
      }

      p.ttl -= dt;
      if (p.ttl <= 0) this.peds.delete(p.id);
    }
  }

  /** "Läuft gerade" für die Animation auf dem Client. */
  isRunning(p: Ped) { return p.flee > 0; }
}

/** Abstand vom Fußgänger zum Ende des Gehwegs, das am Knoten liegt. */
function endDist(w: Walkway, node: number, p: Ped) {
  const q = w.edge.a === node ? w.pts[0] : w.pts[w.pts.length - 1];
  return Math.hypot(q[0] - p.x, q[1] - p.z);
}
