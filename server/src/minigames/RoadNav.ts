// Wegfindung über das Straßennetz für Minispiel-NPCs (verallgemeinert aus Catch the Taxi).
// flowTo(node): Dijkstra vom Zielknoten aus → für jeden Knoten der nächste Schritt Richtung Ziel
// (zwischengespeichert, mehrere NPCs teilen sich ein Ziel). path(): Wegpunkte vom Fahrzeug aus.
import { dist2, wrapAngle } from '../../../shared/src/math';
import type { CarState } from '../../../shared/src/sim/car';
import type { Vec2 } from '../../../shared/src/world/geometry';
import { RoadType, type RoadEdge, type WorldMap } from '../../../shared/src/world/WorldMap';

interface Flow { next: Int32Array; via: Int32Array; t: number }

export class RoadNav {
  private flows = new Map<number, Flow>();

  constructor(private map: WorldMap) {}

  nearestNode(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (const n of this.map.nodes) { const d = dist2(n.x, n.z, x, z); if (d < bd) { bd = d; best = n.id; } }
    return best;
  }

  /** Alte Wegweiser verfallen lassen (einmal pro Tick aufrufen). */
  age(dt: number) {
    for (const [k, f] of this.flows) { f.t -= dt; if (f.t < -5) this.flows.delete(k); }
  }

  private flowTo(goal: number): Flow {
    let f = this.flows.get(goal);
    if (f && f.t > 0) return f;
    const { nodes, edges } = this.map;
    const n = nodes.length;
    f = { next: new Int32Array(n).fill(-1), via: new Int32Array(n).fill(-1), t: 2 };
    const dist = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    dist[goal] = 0;
    for (;;) {
      let u = -1, bu = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bu) { bu = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const eid of nodes[u].edges) {
        const e = edges[eid];
        if (e.type === RoadType.Pier) continue;
        const w = e.a === u ? e.b : e.a;
        const nd = bu + e.len;
        if (nd < dist[w]) { dist[w] = nd; f.next[w] = u; f.via[w] = eid; }
      }
    }
    this.flows.set(goal, f);
    return f;
  }

  /** Wegpunkte vom Fahrzeug zum Zielknoten: erst zum nächsten Knoten (bevorzugt voraus), dann den Wegweisern nach. */
  path(c: CarState, goal: number, maxLen = 320): Vec2[] {
    const { nodes, edges } = this.map;
    if (goal < 0) return [];
    const f = this.flowTo(goal);
    const fx = Math.sin(c.a), fz = Math.cos(c.a);
    let start = -1, bs = Infinity;
    for (const nd of nodes) {
      const dx = nd.x - c.x, dz = nd.z - c.z, d = Math.hypot(dx, dz);
      if (d > 220) continue;
      const behind = (dx * fx + dz * fz) < 0 && d > 12 ? 40 : 0;
      if (d + behind < bs) { bs = d + behind; start = nd.id; }
    }
    const out: Vec2[] = [];
    if (start < 0) return out;
    out.push([nodes[start].x, nodes[start].z]);
    let u = start, len = 0;
    for (let k = 0; k < 40 && len < maxLen && f.next[u] >= 0; k++) {
      const e = edges[f.via[u]];
      const pts = e.a === u ? e.pts : [...e.pts].reverse();
      for (let i = 1; i < pts.length; i++) if (i % 2 === 0 || i === pts.length - 1) out.push(pts[i]);
      len += e.len;
      u = f.next[u];
    }
    return out;
  }

  /** Wegpunkte abhaken, die erreicht oder schon überholt sind. */
  static advance(path: Vec2[], c: CarState) {
    const speed = Math.hypot(c.vx, c.vz);
    while (path.length) {
      const [wx, wz] = path[0];
      const dd = Math.hypot(wx - c.x, wz - c.z);
      const behind = (wx - c.x) * Math.sin(c.a) + (wz - c.z) * Math.cos(c.a) < 0;
      if (dd < 7 + speed * 0.25 || (behind && dd < 16 && path.length > 1)) path.shift(); else break;
    }
  }
}

/**
 * Straßenfolger für einen Fahrer, der möglichst gerade, breite und leere Straßen nimmt
 * (Bomb-Bus-NPC). Wählt an jeder Kreuzung die Kante mit der kleinsten Abbiegung, wenig Verkehr
 * und – falls ein Ziel gesetzt ist – in Zielrichtung.
 */
export class RoadFollower {
  edge = -1;
  /** Fahrtrichtung auf der Kante: zum Knoten `to`. */
  to = -1;
  /** Knoten nach `to` (vorausberechnete Route, z. B. für Straßensperren). */
  after = -1;
  /** Abbiegewinkel an der nächsten Kreuzung (Radiant) und Entfernung dorthin. */
  turnAhead = 0;
  nodeDist = Infinity;
  private afterEdge = -1;

  constructor(private map: WorldMap) {}

  /** Auf die nächstgelegene Kante setzen, Richtung passend zum Fahrzeug. */
  attach(c: CarState) {
    let best = Infinity;
    for (const e of this.map.edges) {
      if (e.type === RoadType.Pier) continue;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const d = dist2(e.pts[i][0], e.pts[i][1], c.x, c.z);
        if (d >= best) continue;
        best = d;
        this.edge = e.id;
        const a = Math.atan2(e.pts[i + 1][0] - e.pts[i][0], e.pts[i + 1][1] - e.pts[i][1]);
        this.to = Math.cos(wrapAngle(a - c.a)) >= 0 ? e.b : e.a;
      }
    }
    this.after = -1;
  }

  private pts(e: RoadEdge): Vec2[] { return e.b === this.to ? e.pts : [...e.pts].reverse(); }

  /**
   * Zielpunkt `look` Meter voraus auf der Route. score(edge, turn) liefert Zusatzkosten
   * (Verkehr, Ziel), turn = Abbiegewinkel in Radiant.
   */
  target(c: CarState, look: number, cost: (e: RoadEdge, from: number, turn: number) => number): Vec2 {
    const { edges, nodes } = this.map;
    if (this.edge < 0) this.attach(c);
    let e = edges[this.edge];
    const node = nodes[this.to];
    // Kreuzung erreicht → nächste Kante wählen
    // (spät umschwenken, sonst wird die Kurve über Gehweg/Gras abgekürzt)
    if (Math.hypot(node.x - c.x, node.z - c.z) < 5 + Math.hypot(c.vx, c.vz) * 0.2) {
      // die schon vorausgewählte Kante nehmen (Route bleibt stabil)
      const next = this.afterEdge >= 0 && this.afterEdge !== e.id ? edges[this.afterEdge] : this.choose(this.to, e, cost);
      if (next) { this.edge = next.id; this.to = next.a === this.to ? next.b : next.a; e = next; this.after = -1; }
    }
    if (this.after < 0) {
      const n2 = this.choose(this.to, e, cost);
      this.after = n2 ? (n2.a === this.to ? n2.b : n2.a) : -1;
      this.afterEdge = n2 ? n2.id : -1;
      this.turnAhead = n2 ? this.turnAngle(e, n2, this.to) : Math.PI;
    }
    const nn = nodes[this.to];
    this.nodeDist = Math.hypot(nn.x - c.x, nn.z - c.z);
    // Punkt `look` Meter voraus auf der Kante (vom nächstgelegenen Polylinienpunkt aus)
    const P = this.pts(e);
    let k = 0, bd = Infinity;
    for (let i = 0; i < P.length; i++) { const d = dist2(P[i][0], P[i][1], c.x, c.z); if (d < bd) { bd = d; k = i; } }
    let rest = look;
    for (let i = k; i + 1 < P.length; i++) {
      const seg = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
      if (seg >= rest) { const t = rest / seg; return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]; }
      rest -= seg;
    }
    return P[P.length - 1];
  }

  private turnAngle(from: RoadEdge, to: RoadEdge, nodeId: number) {
    const P = this.pts(from);
    const inA = Math.atan2(P[P.length - 1][0] - P[P.length - 2][0], P[P.length - 1][1] - P[P.length - 2][1]);
    const Q = to.a === nodeId ? to.pts : [...to.pts].reverse();
    return Math.abs(wrapAngle(Math.atan2(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]) - inA));
  }

  /** Beste Anschlusskante am Knoten (keine Wende, außer Sackgasse). */
  choose(nodeId: number, from: RoadEdge, cost: (e: RoadEdge, from: number, turn: number) => number): RoadEdge | null {
    const { edges, nodes } = this.map;
    const P = this.pts(from);
    const inA = Math.atan2(P[P.length - 1][0] - P[P.length - 2][0], P[P.length - 1][1] - P[P.length - 2][1]);
    let best: RoadEdge | null = null, bs = Infinity;
    for (const eid of nodes[nodeId].edges) {
      const e = edges[eid];
      if (e.id === from.id || e.type === RoadType.Pier) continue;
      const Q = e.a === nodeId ? e.pts : [...e.pts].reverse();
      const outA = Math.atan2(Q[1][0] - Q[0][0], Q[1][1] - Q[0][1]);
      const turn = Math.abs(wrapAngle(outA - inA));
      const s = turn * 40 + cost(e, nodeId, turn) + Math.random() * 5;
      if (s < bs) { bs = s; best = e; }
    }
    return best ?? (from.type === RoadType.Pier ? null : from); // Sackgasse: umdrehen
  }
}
