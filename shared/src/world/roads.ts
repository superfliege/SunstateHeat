// Straßengraph aus Catmull-Rom-Splines: Hauptachsen aus palmara.ts, Viertelraster mit
// eigenem Drehwinkel und geschwungene Landstraßen. Alle Linien werden planarisiert
// (jeder Schnittpunkt wird ein Knoten). Dazu die gemeinsame Kreuzungsgeometrie für
// Rendering, Rasterung und Verkehrs-KI.
import { makeValueNoise, mulberry32 } from '../math';
import {
  catmullRom, cumulative, distToSegment, lineIntersection, pointAt, pointInPolygon, polylineLength,
  segmentIntersection, subPolyline, centroid, type Vec2,
} from './geometry';
import { inAirport } from './airport';
import { TEST_TRACK } from './features';
import { DISTRICTS, PIERS, ROADS, ROUNDABOUTS, type DistrictDef } from './palmara';
import { mountainRoads } from './okeePeak';
import { farmLanes } from './farms';
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

interface Stroke {
  name: string; type: number; pts: Vec2[]; cum: number[]; palms: boolean; main: boolean;
  /** Endet bewusst an einem Ziel (Steg, Flugfeld, Parkplatz …): [Anfang, Ende]. */
  dest: [boolean, boolean];
}

const SAMPLE = 4; // Abtastabstand der Splines in Metern
const MERGE = 7; // Knoten näher als das werden zusammengelegt
const SNAP = 16; // Linienenden so nah an einer anderen Straße werden angeschlossen
const JOIN = 18; // Einmündungen so nah an einer bestehenden Kreuzung werden dort zusammengelegt

function makeStroke(name: string, type: number, pts: Vec2[], palms: boolean, main: boolean, dest: [boolean, boolean] = [false, false]): Stroke {
  return { name, type, pts, cum: cumulative(pts), palms, main, dest };
}

/** Kontrollpunkte einer Landstraße per Noise seitlich verformen (Enden bleiben fest). */
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

/** Rasterlinien eines Viertels, an Viertelgrenze und Küste beschnitten. */
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
      // In großen Vierteln innere Linien gelegentlich weglassen -> unterschiedlich große Blöcke
      if (Math.abs(k) >= 1 && intervals[0][1] - intervals[0][0] > 200 && rnd() < 0.06) continue;
      const lineType = d.mainEvery && ((k % d.mainEvery) + d.mainEvery) % d.mainEvery === 0 ? RoadType.Main : type;
      for (const [t0, t1] of intervals) {
        // Über die Viertelgrenze hinaus verlängern, damit das Raster an die Hauptstraßen anschließt
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
  // Rasterlinien, die (fast) parallel neben einer Hauptstraße laufen, entfallen; laufen sie nur
  // abschnittsweise dicht parallel daneben (spitzes Zusammenlaufen), fällt dieser Abschnitt weg
  const kept: Stroke[] = [];
  for (const s of out) {
    let near = 0;
    for (const p of s.pts) {
      for (const m of mains) {
        if (nearPolyline(m.pts, p, 22)) { near++; break; }
      }
    }
    if (near >= s.pts.length * 0.5) continue;
    const dir: Vec2 = [s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]];
    const dl = Math.hypot(dir[0], dir[1]) || 1;
    let run: Vec2[] = [];
    const flush = () => {
      if (run.length >= 2 && polylineLength(run) > 24) kept.push(makeStroke(s.name, s.type, run, false, false));
      run = [];
    };
    for (const p of s.pts) {
      // Abstand > SNAP, damit das verbleibende Ende nicht flach an die Hauptstraße andockt
      if (mains.some((m) => parallelNear(m.pts, p, [dir[0] / dl, dir[1] / dl], SNAP + 8))) flush(); else run.push(p);
    }
    flush();
  }
  return kept;
}

/** Läuft eine Polylinie näher als r an p vorbei, mit weniger als 25° Winkel zu dir? */
function parallelNear(pts: Vec2[], p: Vec2, dir: Vec2, r: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (Math.min(a[0], b[0]) - r > p[0] || Math.max(a[0], b[0]) + r < p[0]) continue;
    if (Math.min(a[1], b[1]) - r > p[1] || Math.max(a[1], b[1]) + r < p[1]) continue;
    if (distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]).d >= r) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    if (Math.abs((dx * dir[0] + dz * dir[1]) / l) > Math.cos((25 * Math.PI) / 180)) return true;
  }
  return false;
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

// ------------------------------------------------------------------ Lose Enden anschließen
/** Kein Wasser, kein Flughafen, kein Testgelände zwischen a und b? */
function landPath(map: WorldMap, a: Vec2, b: Vec2): boolean {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const T = TEST_TRACK;
  for (let k = 0, n = Math.max(1, Math.ceil(L / 3)); k <= n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, z = a[1] + ((b[1] - a[1]) * k) / n;
    const t = map.tileAt(x, z);
    if (t === Tile.WATER || t === Tile.VOID || t === Tile.ROCK) return false;
    if (inAirport(x, z)) return false;
    if (x > T.x0 - 6 && x < T.x0 + T.w + 6 && z > T.z0 - 6 && z < T.z0 + T.d + 6) return false;
  }
  return true;
}

/** Richtung am Linienende nach außen (über ~10 m gemittelt). */
function endDir(s: Stroke, atEnd: boolean): Vec2 {
  const L = s.cum[s.cum.length - 1];
  const p0 = pointAt(s.pts, s.cum, atEnd ? Math.max(0, L - 10) : Math.min(L, 10));
  const p1 = atEnd ? s.pts[s.pts.length - 1] : s.pts[0];
  const dx = p1[0] - p0.x, dz = p1[1] - p0.z, l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * Linienenden ohne Anschluss (weiter als SNAP von jeder anderen Straße) verlängern:
 *   1. geradeaus bis zur nächsten Straße (Strahl),
 *   2. sonst schräg zum nächsten Straßenpunkt vor dem Ende (höchstens 70° Abweichung),
 *   3. sonst zu einem anderen losen Ende in der Nähe, geradeaus oder rechtwinklig (z. B. zwei
 *      Rasterlinien an der Küste werden zu einer Uferstraße verbunden).
 * Die Verlängerung muss über Land führen und darf keine dritte Straße kreuzen.
 * Was übrig bleibt, schneidet buildRoadGraph bei Rasterstraßen bis zur Kreuzung zurück.
 */
function connectEnds(strokes: Stroke[], map: WorldMap) {
  type Box = [number, number, number, number];
  const box = (s: Stroke): Box => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of s.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
    return [x0, z0, x1, z1];
  };
  const boxes = strokes.map(box);
  const targets = (si: number, p: Vec2, r: number) => strokes
    .map((o, oi) => oi)
    .filter((oi) => oi !== si && strokes[oi].type !== RoadType.Pier)
    .filter((oi) => { const b = boxes[oi]; return p[0] > b[0] - r && p[0] < b[2] + r && p[1] > b[1] - r && p[1] < b[3] + r; });
  const minDist = (si: number, p: Vec2) => {
    let best = Infinity;
    for (const oi of targets(si, p, SNAP)) {
      const o = strokes[oi];
      for (let i = 0; i < o.pts.length - 1; i++) best = Math.min(best, distToSegment(p[0], p[1], o.pts[i][0], o.pts[i][1], o.pts[i + 1][0], o.pts[i + 1][1]).d);
    }
    return best;
  };
  /** Schneidet die Strecke a→b eine Straße (außer si) vor dem Anteil tMax? */
  const crosses = (si: number, a: Vec2, b: Vec2, tMax: number, skip = -1) => {
    const r = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const oi of targets(si, a, r)) {
      if (oi === skip) continue;
      const o = strokes[oi];
      for (let i = 0; i < o.pts.length - 1; i++) {
        const hit = segmentIntersection(a, b, o.pts[i], o.pts[i + 1]);
        if (hit && hit.t > 0.02 && hit.t < tMax) return true;
      }
    }
    return false;
  };
  const extend = (s: Stroke, atEnd: boolean, to: Vec2) => {
    const from = atEnd ? s.pts[s.pts.length - 1] : s.pts[0];
    const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const add: Vec2[] = [];
    for (let d = SAMPLE; d < L; d += SAMPLE) add.push([from[0] + ((to[0] - from[0]) * d) / L, from[1] + ((to[1] - from[1]) * d) / L]);
    add.push(to);
    s.pts = atEnd ? [...s.pts, ...add] : [...add.reverse(), ...s.pts];
    s.cum = cumulative(s.pts);
    boxes[strokes.indexOf(s)] = box(s);
  };
  const loose = (si: number, atEnd: boolean) => {
    const s = strokes[si];
    if (s.dest[atEnd ? 1 : 0]) return false; // Stege: nur der landseitige Anfang wird angeschlossen
    return minDist(si, atEnd ? s.pts[s.pts.length - 1] : s.pts[0]) >= SNAP;
  };

  strokes.forEach((s, si) => {
    for (const atEnd of [false, true]) {
      if (!loose(si, atEnd)) continue;
      const e = atEnd ? s.pts[s.pts.length - 1] : s.pts[0];
      const dir = endDir(s, atEnd);
      const reach = s.main ? 110 : 80;

      // 1) Strahl geradeaus
      const far: Vec2 = [e[0] + dir[0] * reach, e[1] + dir[1] * reach];
      let tBest = Infinity, steep = false;
      for (const oi of targets(si, e, reach)) {
        const o = strokes[oi];
        for (let i = 0; i < o.pts.length - 1; i++) {
          const hit = segmentIntersection(e, far, o.pts[i], o.pts[i + 1]);
          if (!hit || hit.t >= tBest) continue;
          tBest = hit.t;
          // flaches Einmünden (unter 30°) ergibt eine spitze Gabel – dann lieber nicht
          const sx = o.pts[i + 1][0] - o.pts[i][0], sz = o.pts[i + 1][1] - o.pts[i][1];
          steep = Math.abs(dir[0] * sz - dir[1] * sx) / (Math.hypot(sx, sz) || 1) > 0.5;
        }
      }
      if (tBest < Infinity && steep) {
        const hit: Vec2 = [e[0] + dir[0] * reach * tBest, e[1] + dir[1] * reach * tBest];
        if (landPath(map, e, hit)) { extend(s, atEnd, hit); continue; }
      }

      // 2) schräg zum nächsten Straßenpunkt
      let best: { q: Vec2; d: number; oi: number } | null = null;
      for (const oi of targets(si, e, reach * 0.75)) {
        const o = strokes[oi];
        for (let i = 0; i < o.pts.length - 1; i++) {
          const a = o.pts[i], b = o.pts[i + 1];
          const r = distToSegment(e[0], e[1], a[0], a[1], b[0], b[1]);
          if (r.d > reach * 0.75 || (best && r.d >= best.d)) continue;
          const q: Vec2 = [a[0] + (b[0] - a[0]) * r.t, a[1] + (b[1] - a[1]) * r.t];
          if (((q[0] - e[0]) * dir[0] + (q[1] - e[1]) * dir[1]) / r.d < Math.cos((70 * Math.PI) / 180)) continue;
          best = { q, d: r.d, oi };
        }
      }
      if (best && landPath(map, e, best.q) && !crosses(si, e, best.q, 0.97, best.oi)) { extend(s, atEnd, best.q); continue; }

      // 3) zu einem anderen losen Ende
      let pair: { q: Vec2; d: number } | null = null;
      strokes.forEach((o, oi) => {
        if (oi === si) return;
        for (const oEnd of [false, true]) {
          const q = oEnd ? o.pts[o.pts.length - 1] : o.pts[0];
          const d = Math.hypot(q[0] - e[0], q[1] - e[1]);
          if (d > 110 || d < 1 || (pair && d >= pair.d)) continue;
          // geradeaus (bis 70°) oder rechtwinklig (80–100°) – keine Schrägen quer durch Blöcke
          const cos = ((q[0] - e[0]) * dir[0] + (q[1] - e[1]) * dir[1]) / d;
          if (cos < Math.cos((70 * Math.PI) / 180) && Math.abs(cos) > Math.cos((80 * Math.PI) / 180)) continue;
          if (!loose(oi, oEnd)) continue;
          pair = { q, d };
        }
      });
      const p = pair as { q: Vec2; d: number } | null;
      if (p && landPath(map, e, p.q) && !crosses(si, e, p.q, 0.97)) extend(s, atEnd, p.q);
    }
  });
}

// ------------------------------------------------------------------ Planarisierung
interface Cut { s: number; node: number }

export function buildRoadGraph(map: WorldMap, seed: number) {
  const noise = makeValueNoise(seed + 31);
  const rnd = mulberry32(seed + 5);
  const strokes: Stroke[] = [];
  for (const r of ROADS) {
    const ctrl = r.rural ? ruralize(r.pts, r.rural, noise) : r.pts;
    const dest: [boolean, boolean] = [r.dest === 'start' || r.dest === 'both', r.dest === 'end' || r.dest === 'both'];
    strokes.push(makeStroke(r.name, r.type, catmullRom(ctrl, SAMPLE), !!r.palms, true, dest));
  }
  // Bergstraßen am Okee Peak (dichte Linien mit eigenem Höhenprofil, okeePeak.ts) und Hofzufahrten (farms.ts)
  for (const r of mountainRoads()) {
    const dest: [boolean, boolean] = [r.dest === 'start' || r.dest === 'both', r.dest === 'end' || r.dest === 'both'];
    strokes.push(makeStroke(r.name, r.type, r.pts, false, true, dest));
  }
  for (const r of farmLanes()) strokes.push(makeStroke(r.name, r.type, catmullRom(r.pts, SAMPLE), false, true, [false, true]));
  for (const p of PIERS) strokes.push(makeStroke(p.name, RoadType.Pier, catmullRom(p.pts, SAMPLE), false, true, [false, true]));
  const mains = strokes.slice();
  DISTRICTS.forEach((d, i) => strokes.push(...districtGrid(d, i, map, mains.filter((m) => m.type !== RoadType.Pier), seed)));
  connectEnds(strokes, map);

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

  // Räumlicher Hash der Segmente
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

  // 2) Linienenden: an nahe Straßen anschließen (T-Kreuzungen), sonst eigener Knoten
  strokes.forEach((s, si) => {
    const L = s.cum[s.cum.length - 1];
    for (const atEnd of [false, true]) {
      const e = atEnd ? s.pts[s.pts.length - 1] : s.pts[0];
      const sEnd = atEnd ? L : 0;
      // schon eine Kreuzung in der Nähe des Endes?
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
        // Liegt auf der Zielstraße schon eine Kreuzung in der Nähe, dort einmünden statt
        // eine zweite Einmündung wenige Meter daneben zu bauen
        const b = best;
        // (nur wenn die Straße dadurch nicht seitlich abknickt)
        const back = pointAt(s.pts, s.cum, atEnd ? Math.max(0, L - 24) : Math.min(L, 24));
        const straight = (c: Cut) => {
          const q = nodePos[c.node];
          const ax = e[0] - back.x, az = e[1] - back.z, bx = q[0] - back.x, bz = q[1] - back.z;
          return (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1) > Math.cos((20 * Math.PI) / 180);
        };
        const near = cuts[b.si].filter((c) => Math.abs(c.s - b.s) < JOIN && straight(c)).sort((x, y) => Math.abs(x.s - b.s) - Math.abs(y.s - b.s))[0];
        const node = near ? near.node : addNode(b.p);
        if (!near) cuts[b.si].push({ s: b.s, node });
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

  // 4) Knoten aufbauen; Sackgassen des Rasters, die connectEnds nicht anschließen konnte,
  //    bis zur letzten Kreuzung zurückschneiden (Hauptachsen und Stege bleiben)
  let nodes: RoadNode[] = nodePos.map((p, id) => ({ id, x: p[0], z: p[1], edges: [], roundabout: 0 }));
  const isMain = new Set(strokes.filter((s) => s.main).map((s) => s.name));
  let alive = edges;
  for (let pass = 0; pass < 20; pass++) {
    const deg = new Map<number, number>();
    for (const e of alive) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
    const before = alive.length;
    alive = alive.filter((e) => isMain.has(e.name) || !(deg.get(e.a) === 1 || deg.get(e.b) === 1));
    if (alive.length === before) break;
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
  base: Vec2; // Fahrbahnende (Mitte) auf Höhe von trim
}

/** Richtung einer Kante vom Knoten weg (über einige Meter gemittelt). */
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
  // Kurze Kanten: Trims dürfen sich nicht überlappen
  for (const e of map.edges) {
    const sum = e.trimA + e.trimB;
    if (sum > e.len - 1) {
      const k = Math.max(0, e.len - 1) / (sum || 1);
      e.trimA *= k; e.trimB *= k;
    }
  }
}

/**
 * Umriss der Kreuzungsfläche (Fahrbahn) bzw. mit `extra` > 0 inklusive Gehweg.
 * Ecken zwischen zwei Armen werden mit einer quadratischen Bézierkurve abgerundet.
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

