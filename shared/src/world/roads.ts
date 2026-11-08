// StraÃŸengraph aus Catmull-Rom-Splines: Hauptachsen aus palmara.ts, Viertelraster mit
// eigenem Drehwinkel und geschwungene LandstraÃŸen. Alle Linien werden planarisiert
// (jeder Schnittpunkt wird ein Knoten). Dazu die gemeinsame Kreuzungsgeometrie fÃ¼r
// Rendering, Rasterung und Verkehrs-KI.
import { makeValueNoise, mulberry32 } from '../math';
import {
  catmullRom, cumulative, distToSegment, lineIntersection, pointAt, pointInPolygon, polylineLength,
  segmentIntersection, subPolyline, centroid, type Vec2,
} from './geometry';
import { DISTRICTS, PIERS, ROADS, ROUNDABOUTS, type DistrictDef } from './palmara';
import { Tile } from './tiles';
import { RoadType, type RoadEdge, type RoadNode, type WorldMap } from './WorldMap';

/** Spuranzahl (gesamt), Spurbreite, Gehweg je Seite (nur innerorts), Grundfarbe. */
export const ROAD_SPECS: Record<number, { lanes: number; laneWidth: number; sidewalk: number; shoulder: number }> = {
  [RoadType.Highway]: { lanes: 4, laneWidth: 3.6, sidewalk: 3, shoulder: 1.2 },
  [RoadType.Main]: { lanes: 2, laneWidth: 3.6, sidewalk: 3, shoulder: 0.8 },
  [RoadType.Side]: { lanes: 2, laneWidth: 3, sidewalk: 2.6, shoulder: 0.4 },
  [RoadType.Dirt]: { lanes: 2, laneWidth: 2.4, sidewalk: 0, shoulder: 0 },
  [RoadType.Pier]: { lanes: 2, laneWidth: 1.6, sidewalk: 0, shoulder: 0 },
};

interface Stroke { name: string; type: number; pts: Vec2[]; cum: number[]; palms: boolean; main: boolean }

const SAMPLE = 4; // Abtastabstand der Splines in Metern
const MERGE = 7; // Knoten nÃ¤her als das werden zusammengelegt
const SNAP = 16; // Linienenden so nah an einer anderen StraÃŸe werden angeschlossen

function makeStroke(name: string, type: number, pts: Vec2[], palms: boolean, main: boolean): Stroke {
  return { name, type, pts, cum: cumulative(pts), palms, main };
}

/** Kontrollpunkte einer LandstraÃŸe per Noise seitlich verformen (Enden bleiben fest). */
function ruralize(ctrl: Vec2[], amp: number, noise: (x: number, z: number) => number): Vec2[] {
  const dense = catmullRom(ctrl, 60);
  const L = polylineLength(dense);
  const cum = cumulative(dense);
  const out: Vec2[] = [];
  const steps = Math.max(2, Math.round(L / 70));
  for (let k = 0; k <= steps; k++) {
    const s = (L * k) / steps;
    const p = pointAt(dense, cum, s);
    const fade = Math.min(1, s / 60, (L - s) / 60);
    const off = (noise(p.x * 0.006, p.z * 0.006) - 0.5) * 2 * amp * fade;
    out.push([p.x - p.dz * off, p.z + p.dx * off]);
  }
  return out;
}

/** Schnittintervalle einer Geraden (Punkt o, Richtung d) mit einem Polygon (Parameter t). */
function clipLine(o: Vec2, d: Vec2, poly: Vec2[]): [number, number][] {
  const ts: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - o[0]) * ez - (a[1] - o[1]) * ex) / den;
    const u = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
    if (u >= 0 && u < 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < ts.length; k += 2) out.push([ts[k], ts[k + 1]]);
  return out;
}

/** Rasterlinien eines Viertels, an Viertelgrenze und KÃ¼ste beschnitten. */
function districtGrid(d: DistrictDef, idx: number, map: WorldMap, mains: Stroke[], seed: number): Stroke[] {
  const rnd = mulberry32(seed * 31 + idx * 977);
  for (let i = 0; i < 8; i++) rnd(); // erste Werte kleiner Seeds sind schlecht verteilt
  const ang = (d.angle * Math.PI) / 180;
  const ux: Vec2 = [Math.cos(ang), Math.sin(ang)]; // lokale x-Achse
  const uz: Vec2 = [-Math.sin(ang), Math.cos(ang)]; // lokale z-Achse
  const c = centroid(d.poly);
  const [bw, bd] = d.block;
  const type = d.road ?? RoadType.Side;
  const okTile = (x: number, z: number) => {
    const t = map.tileAt(x, z);
    return t !== Tile.WATER && t !== Tile.VOID && (t !== Tile.SWAMP || d.style === 'stilt');
  };
  const out: Stroke[] = [];
  // Versatz je Viertel, damit nicht alle Raster am Schwerpunkt ausgerichtet sind
  const off = [(0.3 + rnd() * 0.4) * bw, (0.3 + rnd() * 0.4) * bd];
  for (const axis of [0, 1]) {
    const step = axis === 0 ? bd : bw;
    const dir = axis === 0 ? ux : uz; // Linienrichtung
    const across = axis === 0 ? uz : ux; // Versatzrichtung
    for (let k = -30; k <= 30; k++) {
      const o: Vec2 = [c[0] + across[0] * (k * step + off[axis]), c[1] + across[1] * (k * step + off[axis])];
      const intervals = clipLine(o, dir, d.poly);
      if (!intervals.length) continue;
      // In groÃŸen Vierteln innere Linien gelegentlich weglassen -> unterschiedlich groÃŸe BlÃ¶cke
      if (Math.abs(k) >= 1 && intervals[0][1] - intervals[0][0] > 200 && rnd() < 0.06) continue;
      const lineType = d.mainEvery && ((k % d.mainEvery) + d.mainEvery) % d.mainEvery === 0 ? RoadType.Main : type;
      for (const [t0, t1] of intervals) {
        // Ãœber die Viertelgrenze hinaus verlÃ¤ngern, damit das Raster an die HauptstraÃŸen anschlieÃŸt
        let run: Vec2[] = [];
        const flush = () => {
          if (run.length >= 2 && polylineLength(run) > 24) out.push(makeStroke(`${d.name} ${axis ? 'Avenue' : 'Street'} ${k}`, lineType, run, false, false));
          run = [];
        };
        for (let t = t0 - 14; t <= t1 + 14; t += SAMPLE) {
          const p: Vec2 = [o[0] + dir[0] * t, o[1] + dir[1] * t];
          if (okTile(p[0], p[1])) run.push(p); else flush();
        }
        flush();
      }
    }
  }
  // Rasterlinien, die (fast) parallel neben einer HauptstraÃŸe laufen, entfallen
  return out.filter((s) => {
    let near = 0;
    for (const p of s.pts) {
      for (const m of mains) {
        if (nearPolyline(m.pts, p, 22)) { near++; break; }
      }
    }
    return near < s.pts.length * 0.5;
  });
}

function nearPolyline(pts: Vec2[], p: Vec2, r: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.min(a[0], b[0]) - r > p[0] || Math.max(a[0], b[0]) + r < p[0]) continue;
    if (Math.min(a[1], b[1]) - r > p[1] || Math.max(a[1], b[1]) + r < p[1]) continue;
    if (distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]).d < r) return true;
  }
  return false;
}

// ------------------------------------------------------------------ Planarisierung
interface Cut { s: number; node: number }

export function buildRoadGraph(map: WorldMap, seed: number) {
  const noise = makeValueNoise(seed + 31);
  const rnd = mulberry32(seed + 5);
  const strokes: Stroke[] = [];
  for (const r of ROADS) {
    const ctrl = r.rural ? ruralize(r.pts, r.rural, noise) : r.pts;
    strokes.push(makeStroke(r.name, r.type, catmullRom(ctrl, SAMPLE), !!r.palms, true));
  }
  for (const p of PIERS) strokes.push(makeStroke(p.name, RoadType.Pier, catmullRom(p.pts, SAMPLE), false, true));
  const mains = strokes.slice();
  DISTRICTS.forEach((d, i) => strokes.push(...districtGrid(d, i, map, mains.filter((m) => m.type !== RoadType.Pier), seed)));

  // Knoten mit Zusammenlegen naher Punkte
  const nodePos: Vec2[] = [];
  const nodeCount: number[] = [];
  const addNode = (p: Vec2): number => {
    for (let i = 0; i < nodePos.length; i++) {
      if (Math.hypot(nodePos[i][0] - p[0], nodePos[i][1] - p[1]) < MERGE) {
        // gleitender Mittelwert
        const k = nodeCount[i]++;
        nodePos[i] = [(nodePos[i][0] * k + p[0]) / (k + 1), (nodePos[i][1] * k + p[1]) / (k + 1)];
        return i;
      }
    }
    nodePos.push([p[0], p[1]]);
    nodeCount.push(1);
    return nodePos.length - 1;
  };
  const cuts: Cut[][] = strokes.map(() => []);

  // RÃ¤umlicher Hash der Segmente
  const H = 48;
  const hash = new Map<number, [number, number][]>();
  strokes.forEach((s, si) => {
    for (let i = 0; i < s.pts.length - 1; i++) {
      const a = s.pts[i], b = s.pts[i + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / H), x1 = Math.floor(Math.max(a[0], b[0]) / H);
      const z0 = Math.floor(Math.min(a[1], b[1]) / H), z1 = Math.floor(Math.max(a[1], b[1]) / H);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const key = z * 1000 + x;
        let l = hash.get(key);
        if (!l) hash.set(key, (l = []));
        l.push([si, i]);
      }
    }
  });

  // 1) Schnittpunkte
  const seen = new Set<string>();
  for (const list of hash.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const [sa, ia] = list[p], [sb, ib] = list[q];
        if (sa === sb) continue;
        const key = sa < sb ? `${sa}:${ia}:${sb}:${ib}` : `${sb}:${ib}:${sa}:${ia}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = strokes[sa], B = strokes[sb];
        const hit = segmentIntersection(A.pts[ia], A.pts[ia + 1], B.pts[ib], B.pts[ib + 1]);
        if (!hit) continue;
        const pt: Vec2 = [A.pts[ia][0] + (A.pts[ia + 1][0] - A.pts[ia][0]) * hit.t, A.pts[ia][1] + (A.pts[ia + 1][1] - A.pts[ia][1]) * hit.t];
        const node = addNode(pt);
        cuts[sa].push({ s: A.cum[ia] + (A.cum[ia + 1] - A.cum[ia]) * hit.t, node });
        cuts[sb].push({ s: B.cum[ib] + (B.cum[ib + 1] - B.cum[ib]) * hit.u, node });
      }
    }
  }

  // 2) Linienenden: an nahe StraÃŸen anschlieÃŸen (T-Kreuzungen), sonst eigener Knoten
  strokes.forEach((s, si) => {
    const L = s.cum[s.cum.length - 1];
    for (const atEnd of [false, true]) {
      const e = atEnd ? s.pts[s.pts.length - 1] : s.pts[0];
      const sEnd = atEnd ? L : 0;
      // schon eine Kreuzung in der NÃ¤he des Endes?
      const existing = cuts[si].find((c) => Math.abs(c.s - sEnd) < SNAP);
      if (existing) { cuts[si].push({ s: sEnd, node: existing.node }); continue; }
      let best: { si: number; s: number; d: number; p: Vec2 } | null = null;
      const kx = Math.floor(e[0] / H), kz = Math.floor(e[1] / H);
      for (let z = kz - 1; z <= kz + 1; z++) for (let x = kx - 1; x <= kx + 1; x++) {
        for (const [oi, i] of hash.get(z * 1000 + x) ?? []) {
          if (oi === si) continue;
          const o = strokes[oi];
          const a = o.pts[i], b = o.pts[i + 1];
          const r = distToSegment(e[0], e[1], a[0], a[1], b[0], b[1]);
          if (r.d < SNAP && (!best || r.d < best.d)) {
            best = { si: oi, s: o.cum[i] + (o.cum[i + 1] - o.cum[i]) * r.t, d: r.d, p: [a[0] + (b[0] - a[0]) * r.t, a[1] + (b[1] - a[1]) * r.t] };
          }
        }
      }
      if (best) {
        const node = addNode(best.p);
        cuts[best.si].push({ s: best.s, node });
        cuts[si].push({ s: sEnd, node });
      } else {
        cuts[si].push({ s: sEnd, node: addNode(e) });
      }
    }
  });

  // 3) Kanten zwischen aufeinanderfolgenden Schnitten
  const edgeKey = new Set<string>();
  const edges: RoadEdge[] = [];
  strokes.forEach((s, si) => {
    const list = cuts[si].sort((a, b) => a.s - b.s);
    const spec = ROAD_SPECS[s.type];
    for (let k = 0; k + 1 < list.length; k++) {
      const c0 = list[k], c1 = list[k + 1];
      if (c0.node === c1.node || c1.s - c0.s < 2) continue;
      const key = c0.node < c1.node ? `${c0.node}-${c1.node}` : `${c1.node}-${c0.node}`;
      if (edgeKey.has(key)) continue;
      edgeKey.add(key);
      const raw = subPolyline(s.pts, s.cum, c0.s, c1.s);
      raw[0] = [...nodePos[c0.node]] as Vec2;
      raw[raw.length - 1] = [...nodePos[c1.node]] as Vec2;
      // Doppelte/fast gleiche Punkte entfernen (sonst entstehen Nullsegmente)
      const pts: Vec2[] = [raw[0]];
      for (let i = 1; i < raw.length; i++) {
        const last = pts[pts.length - 1];
        if (Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]) > 1.5 || i === raw.length - 1) pts.push(raw[i]);
      }
      if (pts.length > 2 && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 1.5) pts.splice(pts.length - 2, 1);
      const cum = cumulative(pts);
      const mid = pointAt(pts, cum, cum[cum.length - 1] / 2);
      const urban = DISTRICTS.some((d) => pointInPolygon(mid.x, mid.z, d.poly));
      const width = spec.lanes * spec.laneWidth + spec.shoulder * 2;
      edges.push({
        id: edges.length, a: c0.node, b: c1.node, type: s.type, lanes: spec.lanes, laneWidth: spec.laneWidth, width,
        sidewalk: urban ? spec.sidewalk : 0, pts, cum, len: cum[cum.length - 1], trimA: 0, trimB: 0,
        palms: s.palms, name: s.name,
      });
    }
  });

  // 4) Knoten aufbauen, kurze Sackgassen-Stummel des Rasters entfernen
  let nodes: RoadNode[] = nodePos.map((p, id) => ({ id, x: p[0], z: p[1], edges: [], roundabout: 0 }));
  const isMain = new Set(strokes.filter((s) => s.main).map((s) => s.name));
  let alive = edges;
  for (let pass = 0; pass < 4; pass++) {
    const deg = new Map<number, number>();
    for (const e of alive) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
    alive = alive.filter((e) => isMain.has(e.name) || !((deg.get(e.a) === 1 || deg.get(e.b) === 1) && e.len < 40));
  }
  // Neu nummerieren
  const used = new Set<number>();
  for (const e of alive) { used.add(e.a); used.add(e.b); }
  const remap = new Map<number, number>();
  nodes = nodes.filter((n) => used.has(n.id)).map((n, i) => { remap.set(n.id, i); return { ...n, id: i }; });
  alive.forEach((e, i) => { e.id = i; e.a = remap.get(e.a)!; e.b = remap.get(e.b)!; nodes[e.a].edges.push(i); nodes[e.b].edges.push(i); });

  // 5) Kreisverkehre
  for (const [x, z, r] of ROUNDABOUTS) {
    let best: RoadNode | null = null, bd = 40;
    for (const n of nodes) {
      const d = Math.hypot(n.x - x, n.z - z);
      if (n.edges.length >= 3 && d < bd) { bd = d; best = n; }
    }
    if (best) best.roundabout = r;
  }

  map.nodes = nodes;
  map.edges = alive;
  computeTrims(map);
}

// ------------------------------------------------------------------ Kreuzungsgeometrie
export interface Arm {
  edge: RoadEdge;
  /** Liegt der Knoten am Anfang (a) der Kante? */
  atA: boolean;
  dir: Vec2; // vom Knoten weg
  angle: number;
  hw: number; // halbe Fahrbahnbreite
  sw: number; // Gehwegbreite
  trim: number;
  base: Vec2; // Fahrbahnende (Mitte) auf HÃ¶he von trim
}

/** Richtung einer Kante vom Knoten weg (Ã¼ber einige Meter gemittelt). */
function armDir(e: RoadEdge, atA: boolean): Vec2 {
  const s = Math.min(8, e.len / 2);
  const p0 = pointAt(e.pts, e.cum, atA ? 0 : e.len), p1 = pointAt(e.pts, e.cum, atA ? s : e.len - s);
  const dx = p1.x - p0.x, dz = p1.z - p0.z, l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

export function arms(map: WorldMap, n: RoadNode): Arm[] {
  const out: Arm[] = [];
  for (const id of n.edges) {
    const e = map.edges[id];
    for (const atA of [true, false]) {
      if ((atA ? e.a : e.b) !== n.id) continue;
      if (e.a === e.b && !atA) continue;
      const dir = armDir(e, atA);
      const trim = atA ? e.trimA : e.trimB;
      const p = pointAt(e.pts, e.cum, atA ? trim : e.len - trim);
      out.push({ edge: e, atA, dir, angle: Math.atan2(dir[1], dir[0]), hw: e.width / 2, sw: e.sidewalk, trim, base: [p.x, p.z] });
    }
  }
  return out.sort((a, b) => a.angle - b.angle);
}

function computeTrims(map: WorldMap) {
  for (const n of map.nodes) {
    const list = arms(map, n);
    for (let i = 0; i < list.length; i++) {
      const arm = list[i];
      let trim = 0;
      if (n.roundabout) {
        trim = n.roundabout * 0.9;
      } else if (list.length >= 2) {
        for (const j of [i - 1, i + 1]) {
          const o = list[(j + list.length) % list.length];
          if (o === arm) continue;
          let da = Math.abs(o.angle - arm.angle);
          if (da > Math.PI) da = Math.PI * 2 - da;
          const need = (Math.max(arm.hw, o.hw) + Math.max(arm.sw, o.sw) * 0.6 + 1) / Math.tan(Math.max(0.2, da) / 2);
          trim = Math.max(trim, Math.min(30, need));
        }
        if (list.length >= 3) trim = Math.max(trim, arm.hw + 1);
      }
      if (arm.atA) arm.edge.trimA = trim; else arm.edge.trimB = trim;
    }
  }
  // Kurze Kanten: Trims dÃ¼rfen sich nicht Ã¼berlappen
  for (const e of map.edges) {
    const sum = e.trimA + e.trimB;
    if (sum > e.len - 1) {
      const k = Math.max(0, e.len - 1) / (sum || 1);
      e.trimA *= k; e.trimB *= k;
    }
  }
}

/**
 * Umriss der KreuzungsflÃ¤che (Fahrbahn) bzw. mit `extra` > 0 inklusive Gehweg.
 * Ecken zwischen zwei Armen werden mit einer quadratischen BÃ©zierkurve abgerundet.
 */
export function junctionOutline(map: WorldMap, n: RoadNode, extra: (a: Arm) => number = () => 0): Vec2[] {
  const list = arms(map, n);
  const out: Vec2[] = [];
  if (list.length < 2) return out;
  for (let i = 0; i < list.length; i++) {
    const a = list[i], b = list[(i + 1) % list.length];
    const ra: Vec2 = [-a.dir[1], a.dir[0]], rb: Vec2 = [-b.dir[1], b.dir[0]];
    const wa = a.hw + extra(a), wb = b.hw + extra(b);
    const left: Vec2 = [a.base[0] - ra[0] * wa, a.base[1] - ra[1] * wa];
    const right: Vec2 = [a.base[0] + ra[0] * wa, a.base[1] + ra[1] * wa];
    const nextLeft: Vec2 = [b.base[0] - rb[0] * wb, b.base[1] - rb[1] * wb];
    out.push(left, right);
    let sector = b.angle - a.angle;
    if (i === list.length - 1) sector += Math.PI * 2;
    if (sector > 0.15 && sector < Math.PI - 0.15) {
      const corner = lineIntersection(right, a.dir, nextLeft, b.dir);
      if (corner) {
        for (let k = 1; k < 6; k++) {
          const t = k / 6, u = 1 - t;
          out.push([u * u * right[0] + 2 * u * t * corner[0] + t * t * nextLeft[0], u * u * right[1] + 2 * u * t * corner[1] + t * t * nextLeft[1]]);
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ Spuren
/** Mittelkurve zwischen den Trims, in Fahrtrichtung (forward = a -> b). */
export function drivablePath(e: RoadEdge, forward: boolean): Vec2[] {
  const p = subPolyline(e.pts, e.cum, e.trimA, Math.max(e.trimA + 0.5, e.len - e.trimB));
  return forward ? p : p.reverse();
}

/** Seitlicher Versatz der Fahrspur k (0 = innen) rechts der Mittellinie. */
export function laneOffset(e: RoadEdge, k: number): number {
  const perDir = Math.max(1, e.lanes / 2);
  return (Math.min(k, perDir - 1) + 0.5) * e.laneWidth;
}

