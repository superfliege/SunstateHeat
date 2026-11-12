// Orte der Hauptgeschichte (Story-Bibel → bestehende Karte). Alles deterministisch aus palmara.ts
// abgeleitet, damit Client und Server dieselben Punkte kennen. Zuordnung der Platzhalter:
//   Ankunftsort = Busbahnhof Downtown · Lous Waschanlage = „Bubble Bath“ (Northgate)
//   Gus' Club = „Velvet Tide“ (Ocean Strip) · Überfall = Bank Downtown · Deal = Kai Hafeninsel
//   Stadtausgang = Route 41 westlich von Little Havana · Gradys Ranch = Pine Hollow Road (Dry Pine)
//   Landebahn = Flugfeld Port Sabal · Abnehmer = Cane Ridge über den Okee Trail
//   Umschlagplatz = Trailerpark Sunny Acres · Lou-Rettung = Highway 9 · Konvoi = Route 41
//   Gus' Anwesen = Villa in Brickell Hills
import type { Vec2 } from '../world/geometry';
import { RoadType, type WorldMap } from '../world/WorldMap';

export interface Point { x: number; z: number }
/** a = Fahrtrichtung, w = Fahrbahnbreite (m). */
export interface Pose extends Point { a: number; w: number }

/** Nächster Punkt auf der Mittellinie einer Straße (ohne Stege), mit Fahrtrichtung a (vorwärts = sin a, cos a). */
export function snapRoad(map: WorldMap, x: number, z: number, types?: number[]): Pose {
  let best: Pose = { x, z, a: 0, w: 8 }, bd = Infinity;
  for (const e of map.edges) {
    if (e.type === RoadType.Pier || (types && !types.includes(e.type))) continue;
    const m = e.pts[Math.floor(e.pts.length / 2)];
    if (Math.abs(m[0] - x) > e.len / 2 + 60 && Math.abs(m[1] - z) > e.len / 2 + 60 && bd < 1e4) continue;
    for (let i = 0; i < e.pts.length; i++) {
      const p = e.pts[i];
      const d = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (d >= bd) continue;
      const q = e.pts[Math.min(e.pts.length - 1, i + 1)], o = e.pts[Math.max(0, i - 1)];
      bd = d;
      best = { x: p[0], z: p[1], a: Math.atan2(q[0] - o[0], q[1] - o[1]), w: e.width };
    }
  }
  return best;
}

/** Kürzester Weg über das Straßennetz (Dijkstra mit Binärheap) als Polylinie. */
export function roadRoute(map: WorldMap, from: Point, to: Point): Vec2[] {
  const { nodes, edges } = map;
  const near = (p: Point) => {
    let b = -1, bd = Infinity;
    for (const n of nodes) { const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd && n.edges.length) { bd = d; b = n.id; } }
    return b;
  };
  const s = near(from), g = near(to);
  if (s < 0 || g < 0) return [[from.x, from.z], [to.x, to.z]];
  const dist = new Float64Array(nodes.length).fill(Infinity);
  const via = new Int32Array(nodes.length).fill(-1);
  const heap: [number, number][] = [[0, s]];
  dist[s] = 0;
  const push = (it: [number, number]) => {
    heap.push(it);
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (u === g) break;
    for (const eid of nodes[u].edges) {
      const e = edges[eid];
      if (e.type === RoadType.Pier) continue;
      const w = e.a === u ? e.b : e.a;
      const nd = d + e.len;
      if (nd < dist[w]) { dist[w] = nd; via[w] = eid; push([nd, w]); }
    }
  }
  const out: Vec2[] = [];
  for (let u = g; u !== s && via[u] >= 0;) {
    const e = edges[via[u]];
    const pts = e.b === u ? e.pts : [...e.pts].reverse(); // von u rückwärts sammeln
    for (let i = pts.length - 1; i > 0; i--) out.push(pts[i]);
    u = e.a === u ? e.b : e.a;
  }
  out.push([nodes[s].x, nodes[s].z]);
  return out.reverse();
}

/** n gleichmäßig verteilte Punkte entlang einer Polylinie (ohne Anfang und Ende). */
export function alongRoute(route: Vec2[], n: number): Point[] {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
  const out: Point[] = [];
  let acc = 0, k = 1;
  for (let i = 1; i < route.length && k <= n; i++) {
    const seg = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    while (k <= n && acc + seg >= (total * k) / (n + 1)) {
      const t = seg > 0 ? ((total * k) / (n + 1) - acc) / seg : 0;
      out.push({ x: route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, z: route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t });
      k++;
    }
    acc += seg;
  }
  return out;
}

/**
 * Story-Orte. foot = begehbarer Punkt in der Nähe (aus questLocations), base = bereits bekannte Orte.
 * Straßenpunkte (für Fahrzeuge) liegen auf der Mittellinie, Treffpunkte (für Figuren) am Rand.
 */
export function storyPlaces(map: WorldMap, foot: (x: number, z: number) => Point, base: Record<string, Point>, racePhone: (id: string) => Point | null): Record<string, Point> {
  const road = (x: number, z: number, types?: number[]) => { const p = snapRoad(map, x, z, types); return { x: p.x, z: p.z }; };
  // Treffpunkt neben der Fahrbahn (rechts in Fahrtrichtung), damit Figuren nicht auf der Straße stehen
  const side = (x: number, z: number) => {
    const r = snapRoad(map, x, z), off = r.w / 2 + 3;
    return foot(r.x + Math.cos(r.a) * off, r.z - Math.sin(r.a) * off);
  };
  const L: Record<string, Point> = {};
  // ---- Akt 1: Port Coralia
  // Lous Cabrio hält 8 m vor dem Ankunftsort (kommt von hinten über die Straße, fährt also nicht durch den Spieler)
  {
    const r0 = snapRoad(map, base.busStation.x, base.busStation.z);
    L.introCar = road(r0.x - Math.sin(r0.a) * 8, r0.z - Math.cos(r0.a) * 8);
  }
  {
    const r = snapRoad(map, L.introCar.x, L.introCar.z), off = r.w / 2 + 1.2;
    const door = { x: r.x + Math.cos(r.a) * off, z: r.z - Math.sin(r.a) * off };
    const t = 0.35; // ein Stück auf den Ankunftsort zu
    L.louBus = foot(door.x + (base.busStation.x - door.x) * t, door.z + (base.busStation.z - door.z) * t);
  }
  L.carWash = side(1290, 812);
  L.carWashRoad = road(1290, 812);
  alongRoute(roadRoute(map, L.introCar, L.carWashRoad), 3).forEach((p, i) => { L[`tut${i + 1}`] = p; });
  L.addr1 = road(1200, 806);
  L.addr2 = road(1160, 1000);
  L.addr3 = road(1350, 1050);
  L.addr4 = road(1566, 1000);
  L.debtor1 = side(1176, 962);
  L.debtor2 = side(1400, 905);
  L.debtor3 = side(1560, 1064);
  L.clubRoad = road(base.club.x, base.club.z);
  L.bank = road(1395, 1110);
  L.apartment = side(1560, 806);
  L.cityExit = road(1060, 1088, [RoadType.Highway]);
  // ---- Akt 2: Outback
  L.ranch = side(768, 905);
  L.ranchRoad = road(768, 905);
  L.louRanch = foot(L.ranch.x + 5, L.ranch.z + 4);
  L.carlaRanch = foot(L.ranch.x - 5, L.ranch.z + 5);
  L.okee1 = road(892, 790, [RoadType.Dirt]);
  L.okee2 = road(900, 705, [RoadType.Dirt]);
  L.okee3 = road(886, 630, [RoadType.Dirt]);
  L.caneDepot = road(base.dustlineCamp.x, base.dustlineCamp.z);
  L.airstrip = side(612, 872);
  L.airstripRoad = road(640, 830);
  L.hideout = foot(L.airstrip.x + 14, L.airstrip.z - 10);
  L.block1 = road(736, 910, [RoadType.Highway]);
  L.block2 = road(850, 852);
  L.racer = racePhone('race_cane') ?? side(1076, 690);
  L.pilot = side(600, 1830);
  L.louAmbush = road(846, 1250, [RoadType.Highway]);
  L.convoyStart = road(716, 830, [RoadType.Highway]);
  L.estateGate = road(1392, 1380);
  L.estate = foot(1352, 1404);
  return L;
}
