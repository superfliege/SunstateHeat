// StadtblÃ¶cke = FlÃ¤chen zwischen den StraÃŸen (Halbkanten-Traversierung des planaren
// StraÃŸengraphs), eingerÃ¼ckt um Fahrbahn + Gehweg und rekursiv entlang der lÃ¤ngsten
// Kante in GrundstÃ¼cke geteilt. GebÃ¤ude richten ihre Front zur nÃ¤chsten StraÃŸe aus.
import { makeValueNoise, mulberry32 } from '../math';
import {
  bbox, centroid, distToSegment, insetPolygon, orientedRect, pointAt, pointInPolygon, polygonArea, simplify, splitPolygon,
  type Poly, type Vec2,
} from './geometry';
import { AIRPORT_BUILDINGS, AIRPORT_FENCE, inAirport } from './airport';
import { DISTRICTS, POI } from './palmara';
import { Tile } from './tiles';
import { BuildingStyle, LotUse, RoadType, Zone, type BuildingDef, type Lot, type RoadEdge, type WorldMap } from './WorldMap';

const PAL_DECO = [0xffd1dc, 0xb5ead7, 0xc7ceea, 0xffdac1, 0xe2f0cb, 0xf6c6ea, 0xa0e7e5];
const PAL_TOWER = [0x9fb7c9, 0xc9d6df, 0x7d9bb3, 0xe8d5c4, 0xb8c4d6, 0xd4a5a5, 0x8fa8a0];
const PAL_MID = [0xe6c79c, 0xd9a982, 0xc2b8a3, 0xf0e0c0, 0xb9a38a, 0xe9b8a0];
const PAL_HAVANA = [0xffb86b, 0x6bd6c8, 0xff7f9e, 0xffe27a, 0x9ad97a, 0x8fb8ff, 0xf29e6b];
const PAL_CONTAINER = [0xd64545, 0x2f7fc1, 0xe0a030, 0x3a9a5b, 0x8a4fb0];
const PAL_TRAILER = [0xe8e2c8, 0xc9d8c5, 0xe0c9b0, 0xbcd4e6, 0xf0d8d8];
const PAL_WOOD = [0x8a6a48, 0x9b7a55, 0x7a5a3a, 0xa88a62];

/** Gestaltungsregeln je Viertel-Stil. */
interface StyleRule {
  lotArea: number; // ZielgrÃ¶ÃŸe eines GrundstÃ¼cks (mÂ²)
  front: number; side: number; back: number; // AbstÃ¤nde (m)
  maxDepth: number;
  free: { park: number; parking: number; gas: number; vacant: number };
}
const STYLES: Record<string, StyleRule> = {
  downtown: { lotArea: 750, front: 1, side: 0.8, back: 1, maxDepth: 30, free: { park: 0.05, parking: 0.04, gas: 0.01, vacant: 0.01 } },
  havana: { lotArea: 420, front: 1.5, side: 0.6, back: 2, maxDepth: 18, free: { park: 0.04, parking: 0.03, gas: 0.02, vacant: 0.02 } },
  deco: { lotArea: 650, front: 2, side: 1.2, back: 2, maxDepth: 22, free: { park: 0.05, parking: 0.04, gas: 0, vacant: 0.01 } },
  industrial: { lotArea: 1700, front: 4, side: 3, back: 4, maxDepth: 40, free: { park: 0.01, parking: 0.06, gas: 0.02, vacant: 0.04 } },
  port: { lotArea: 2000, front: 4, side: 3, back: 3, maxDepth: 44, free: { park: 0.01, parking: 0.06, gas: 0.01, vacant: 0.04 } },
  villa: { lotArea: 1400, front: 7, side: 5, back: 8, maxDepth: 16, free: { park: 0.06, parking: 0.01, gas: 0, vacant: 0.04 } },
  town: { lotArea: 600, front: 2.5, side: 1.5, back: 3, maxDepth: 20, free: { park: 0.04, parking: 0.04, gas: 0.02, vacant: 0.03 } },
  keys: { lotArea: 520, front: 4, side: 2.5, back: 4, maxDepth: 14, free: { park: 0.06, parking: 0.02, gas: 0.01, vacant: 0.03 } },
  stilt: { lotArea: 520, front: 5, side: 4, back: 5, maxDepth: 10, free: { park: 0.03, parking: 0.01, gas: 0, vacant: 0.08 } },
  trailer: { lotArea: 170, front: 2, side: 1.5, back: 1.5, maxDepth: 5, free: { park: 0.03, parking: 0.02, gas: 0, vacant: 0.06 } },
};

const DOWNTOWN_CORE: Vec2 = [1340, 1000];

// ------------------------------------------------------------------ FlÃ¤chen des Graphen
/** Alle inneren FlÃ¤chen des planaren StraÃŸengraphs mit der Quell-Kante je Polygonseite. */
function faces(map: WorldMap): { poly: Poly; src: number[] }[] {
  // Sackgassen entfernen (sie erzeugen Spitzen in den FlÃ¤chen)
  const deg = new Map<number, number>();
  let live = map.edges.filter((e) => e.type !== RoadType.Pier && e.a !== e.b);
  for (let pass = 0; pass < 20; pass++) {
    deg.clear();
    for (const e of live) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
    const next = live.filter((e) => deg.get(e.a)! > 1 && deg.get(e.b)! > 1);
    if (next.length === live.length) break;
    live = next;
  }
  // Ausgehende Halbkanten je Knoten, nach Winkel sortiert
  const out = new Map<number, { e: number; fwd: boolean; ang: number }[]>();
  const angleFrom = (e: RoadEdge, fromStart: boolean) => {
    const s = Math.min(6, e.len / 2);
    const p0 = pointAt(e.pts, e.cum, fromStart ? 0 : e.len), p1 = pointAt(e.pts, e.cum, fromStart ? s : e.len - s);
    return Math.atan2(p1.z - p0.z, p1.x - p0.x);
  };
  for (const e of live) {
    for (const fwd of [true, false]) {
      const n = fwd ? e.a : e.b;
      let l = out.get(n);
      if (!l) out.set(n, (l = []));
      l.push({ e: e.id, fwd, ang: angleFrom(e, fwd) });
    }
  }
  for (const l of out.values()) l.sort((a, b) => a.ang - b.ang);

  const visited = new Set<string>();
  const result: { poly: Poly; src: number[] }[] = [];
  for (const e of live) {
    for (const fwd of [true, false]) {
      const startKey = `${e.id}:${fwd}`;
      if (visited.has(startKey)) continue;
      const poly: Poly = [], src: number[] = [];
      let cur = { e: e.id, fwd };
      let guard = 0;
      while (guard++ < 400) {
        const key = `${cur.e}:${cur.fwd}`;
        if (visited.has(key)) break;
        visited.add(key);
        const edge = map.edges[cur.e];
        const pts = cur.fwd ? edge.pts : edge.pts.slice().reverse();
        for (let i = 0; i < pts.length - 1; i++) {
          const last = poly[poly.length - 1];
          if (last && Math.hypot(last[0] - pts[i][0], last[1] - pts[i][1]) < 0.5) continue;
          poly.push(pts[i]); src.push(cur.e);
        }
        // Am Zielknoten: die im Uhrzeigersinn (mathematisch) nÃ¤chste ausgehende Kante
        const v = cur.fwd ? edge.b : edge.a;
        const list = out.get(v)!;
        const idx = list.findIndex((h) => h.e === cur.e && h.fwd === !cur.fwd);
        const nxt = list[(idx - 1 + list.length) % list.length];
        cur = { e: nxt.e, fwd: nxt.fwd };
      }
      // Innere FlÃ¤chen haben (mit dieser Drehrichtung) negative polygonArea
      const a = polygonArea(poly);
      if (a < 0 && -a < 120000 && poly.length >= 3) result.push({ poly, src });
    }
  }
  return result;
}

// ------------------------------------------------------------------ GrundstÃ¼cke
function subdivide(poly: Poly, target: number, rnd: () => number, depth = 0): Poly[] {
  const area = Math.abs(polygonArea(poly));
  if (area < target * 1.7 || depth > 8) return [poly];
  // lÃ¤ngste Kante finden, senkrecht dazu (nahe der Mitte) teilen
  let li = 0, ll = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > ll) { ll = l; li = i; }
  }
  const a = poly[li], b = poly[(li + 1) % poly.length];
  const t = 0.4 + rnd() * 0.2;
  const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const dir: Vec2 = [-(b[1] - a[1]) / ll, (b[0] - a[0]) / ll]; // senkrecht zur Kante
  const [p1, p2] = splitPolygon(poly, p, dir);
  if (p1.length < 3 || p2.length < 3 || Math.abs(polygonArea(p1)) < target * 0.3 || Math.abs(polygonArea(p2)) < target * 0.3) return [poly];
  return [...subdivide(p1, target, rnd, depth + 1), ...subdivide(p2, target, rnd, depth + 1)];
}

/** LÃ¤ngste GrundstÃ¼ckskante, die am Blockrand (also an der StraÃŸe) liegt. */
function frontage(lot: Poly, block: Poly, segs?: SegmentIndex): { a: Vec2; b: Vec2 } | null {
  let best: { a: Vec2; b: Vec2 } | null = null, bl = 0;
  for (let i = 0; i < lot.length; i++) {
    const a = lot[i], b = lot[(i + 1) % lot.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 4 || l <= bl) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let onEdge = false;
    for (let k = 0; k < block.length && !onEdge; k++) {
      const p = block[k], q = block[(k + 1) % block.length];
      if (distToSegment(mx, mz, p[0], p[1], q[0], q[1]).d < 1) onEdge = true;
    }
    // auch Kanten direkt an einer StraÃŸe zÃ¤hlen (z. B. an StichstraÃŸen in offenen BlÃ¶cken)
    if (!onEdge && segs?.onRoad([mx, mz], 3)) onEdge = true;
    if (onEdge) { best = { a, b }; bl = l; }
  }
  return best;
}

/** GebÃ¤ude-Grundriss passend ins GrundstÃ¼ck, Front an der StraÃŸenkante. */
function placeBuilding(lot: Poly, f: { a: Vec2; b: Vec2 }, rule: StyleRule, maxW = Infinity) {
  const fl = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]);
  const u: Vec2 = [(f.b[0] - f.a[0]) / fl, (f.b[1] - f.a[1]) / fl];
  const c = centroid(lot);
  let v: Vec2 = [-u[1], u[0]];
  if ((c[0] - f.a[0]) * v[0] + (c[1] - f.a[1]) * v[1] < 0) v = [-v[0], -v[1]]; // v zeigt ins GrundstÃ¼ck
  let u0 = Infinity, u1 = -Infinity, vmax = 0;
  for (const p of lot) {
    const du = (p[0] - f.a[0]) * u[0] + (p[1] - f.a[1]) * u[1];
    const dv = (p[0] - f.a[0]) * v[0] + (p[1] - f.a[1]) * v[1];
    u0 = Math.min(u0, du); u1 = Math.max(u1, du); vmax = Math.max(vmax, dv);
  }
  let w = Math.min(maxW, u1 - u0 - rule.side * 2);
  let d = Math.min(rule.maxDepth, vmax - rule.front - rule.back);
  const um = (u0 + u1) / 2;
  // Front zeigt zur StraÃŸe (entgegen v)
  const rot = Math.atan2(-v[0], -v[1]);
  for (let tries = 0; tries < 8; tries++) {
    if (w < 4 || d < 3.5) return null;
    const cv = rule.front + d / 2;
    // mittig, sonst entlang der Front zur breiteren Seite rutschen (z. B. bei dreieckigen GrundstÃ¼cken)
    const slack = Math.max(0, (u1 - u0 - w) / 2 - rule.side);
    for (const shift of [0, -slack, slack, -slack / 2, slack / 2]) {
      const cx = f.a[0] + u[0] * (um + shift) + v[0] * cv, cz = f.a[1] + u[1] * (um + shift) + v[1] * cv;
      const corners = orientedRect(cx, cz, w / 2, d / 2, rot);
      if (corners.every((p) => pointInPolygon(p[0], p[1], lot))) return { x: cx, z: cz, w, d, rot };
    }
    w *= 0.86; d *= 0.9;
  }
  return null;
}

// ------------------------------------------------------------------ HÃ¶hen & Stile
function buildingFor(style: string, x: number, z: number, w: number, d: number, noise: (x: number, z: number) => number, rnd: () => number):
  { h: number; style: number; color: number } {
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const n = noise(x * 0.02, z * 0.02);
  switch (style) {
    case 'downtown': {
      // Hoch im Kern, flacher zur KÃ¼ste und zu den RÃ¤ndern
      const dCore = Math.hypot(x - DOWNTOWN_CORE[0], z - DOWNTOWN_CORE[1]);
      const core = Math.max(0, 1 - dCore / 200);
      const coast = Math.min(1, Math.max(0, (1430 - x) / 50));
      const h = 12 + (18 + 85 * core * core) * (0.55 + n * 0.8) * (0.4 + 0.6 * coast);
      return { h, style: h > 26 ? BuildingStyle.Tower : BuildingStyle.Midrise, color: h > 26 ? pick(PAL_TOWER) : pick(PAL_MID) };
    }
    case 'havana': return { h: 5 + n * 7, style: rnd() < 0.3 ? BuildingStyle.Shop : BuildingStyle.Midrise, color: pick(PAL_HAVANA) };
    case 'deco': return { h: 9 + n * 10, style: BuildingStyle.Deco, color: pick(PAL_DECO) };
    case 'industrial': return { h: 7 + n * 6, style: BuildingStyle.Warehouse, color: pick([...PAL_MID, ...PAL_TOWER]) };
    case 'port':
      return rnd() < 0.4
        ? { h: 2.6 * (1 + Math.floor(rnd() * 2)), style: BuildingStyle.Container, color: pick(PAL_CONTAINER) }
        : { h: 8 + n * 5, style: BuildingStyle.Warehouse, color: pick([...PAL_MID, ...PAL_TOWER]) };
    case 'villa': return { h: 5 + n * 3, style: BuildingStyle.House, color: pick(PAL_DECO) };
    case 'town': {
      const r = rnd();
      return r < 0.25 ? { h: 4.5, style: BuildingStyle.Shop, color: 0xf4e9d8 }
        : r < 0.55 ? { h: 7 + n * 8, style: BuildingStyle.Midrise, color: pick(PAL_MID) }
          : { h: 5 + n * 2, style: BuildingStyle.House, color: pick([...PAL_MID, ...PAL_TRAILER]) };
    }
    case 'keys': return rnd() < 0.3 ? { h: 7 + n * 5, style: BuildingStyle.Deco, color: pick(PAL_DECO) } : { h: 5 + n * 2, style: BuildingStyle.House, color: pick(PAL_DECO) };
    case 'stilt': return { h: 4, style: BuildingStyle.Stilt, color: pick(PAL_WOOD) };
    case 'trailer': return { h: 3.2, style: BuildingStyle.Trailer, color: pick(PAL_TRAILER) };
    default: return { h: 5, style: BuildingStyle.House, color: pick(PAL_MID) };
  }
}

// ------------------------------------------------------------------ Aufbau
export function buildCity(map: WorldMap, seed: number) {
  const rnd = mulberry32(seed + 77);
  const noise = makeValueNoise(seed + 13);
  map.districts = DISTRICTS.map((d, id) => ({
    id, name: d.name, zone: d.zone, poly: d.poly, angle: (d.angle * Math.PI) / 180, block: d.block, style: d.style,
  }));

  const onLand = (p: Vec2, style: string) => {
    const t = map.tileAt(p[0], p[1]);
    return t !== Tile.WATER && t !== Tile.VOID && (t !== Tile.SWAMP || style === 'stilt');
  };
  const ctx: Ctx = { map, rnd, noise, segs: new SegmentIndex(map) };

  for (const f of faces(map)) {
    const c = centroid(f.poly);
    const district = map.districts.find((d) => pointInPolygon(c[0], c[1], d.poly));
    if (!district) continue;
    const rule = STYLES[district.style] ?? STYLES.town;
    const dist = f.src.map((id) => { const e = map.edges[id]; return e.width / 2 + e.sidewalk + 0.4; });
    const inset = insetPolygon(f.poly, dist);
    if (!inset) continue;
    const blockPoly = simplify(inset, 0.8);
    if (Math.abs(polygonArea(blockPoly)) < 150) continue;
    const blockId = map.blocks.length;
    // FÃ¼hrt eine StraÃŸe in den Block hinein (StichstraÃŸe), bleibt er offen
    const [bx0, bz0, bx1, bz1] = bbox(blockPoly);
    const open = map.edges.some((e) => e.pts.some((p) => p[0] > bx0 && p[0] < bx1 && p[1] > bz0 && p[1] < bz1 && pointInPolygon(p[0], p[1], blockPoly)));
    map.blocks.push({ id: blockId, district: district.id, poly: blockPoly, open });

    for (const lotPoly of subdivide(blockPoly, rule.lotArea, rnd)) {
      if (!lotPoly.every((p) => onLand(p, district.style)) || !onLand(centroid(lotPoly), district.style)) continue;
      // In offenen BlÃ¶cken: GrundstÃ¼cke an der StichstraÃŸe feiner teilen, Teile auf der StraÃŸe entfallen
      const onRoad = (p: Poly) => samplePoints(p).some((q) => ctx.segs.onRoad(q, 0.5));
      const pieces = open && onRoad(lotPoly) ? subdivide(lotPoly, rule.lotArea / 4, rnd).filter((p) => !onRoad(p)) : [lotPoly];
      for (const p of pieces) fillLot(ctx, p, frontage(p, blockPoly, open ? ctx.segs : undefined), district.id, blockId);
    }
  }

  frontageLots(ctx);
  gasStations(map);
  airport(map);
  removeBuildingsOnRoads(ctx);
}

/** Ecken, Kantenmitten und Schwerpunkt eines Polygons. */
function samplePoints(poly: Poly): Vec2[] {
  const out: Vec2[] = [centroid(poly)];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** Sicherheitsnetz: GebÃ¤ude, die eine Fahrbahn oder einen Gehweg berÃ¼hren, entfallen. */
function removeBuildingsOnRoads(ctx: Ctx) {
  const { map, segs } = ctx;
  const remap = new Map<number, number>();
  const kept: BuildingDef[] = [];
  map.buildings.forEach((b, i) => {
    const rect = orientedRect(b.x, b.z, b.w / 2, b.d / 2, b.rot);
    if (samplePoints(rect).some((p) => segs.onRoad(p, 0.2))) return;
    remap.set(i, kept.length);
    kept.push(b);
  });
  map.buildings = kept;
  for (const l of map.lots) {
    if (l.building < 0) continue;
    const n = remap.get(l.building);
    if (n === undefined) { l.building = -1; if (l.use === LotUse.Building) l.use = LotUse.Vacant; } else l.building = n;
  }
}

interface Ctx {
  map: WorldMap;
  rnd: () => number;
  noise: (x: number, z: number) => number;
  segs: SegmentIndex;
}

/** Nutzung festlegen und ggf. ein GebÃ¤ude mit Front zur StraÃŸe setzen. */
function fillLot(ctx: Ctx, lotPoly: Poly, fr: { a: Vec2; b: Vec2 } | null, districtId: number, blockId: number) {
  const { map, rnd, noise } = ctx;
  const district = map.districts[districtId];
  const rule = STYLES[district.style] ?? STYLES.town;
  const lot: Lot = { id: map.lots.length, block: blockId, district: districtId, poly: lotPoly, use: LotUse.Building, building: -1 };
  map.lots.push(lot);
  const r = rnd(), fp = rule.free;
  if (!fr) { lot.use = district.style === 'downtown' || district.style === 'port' ? LotUse.Parking : LotUse.Park; return; }
  if (r < fp.park) { lot.use = LotUse.Park; return; }
  if (r < fp.park + fp.parking) { lot.use = LotUse.Parking; return; }
  if (r < fp.park + fp.parking + fp.gas && Math.abs(polygonArea(lotPoly)) > 500) {
    lot.use = LotUse.Gas;
    const shop = placeBuilding(lotPoly, fr, { ...rule, front: 14, maxDepth: 9 }, 14);
    if (shop) lot.building = addBuilding(map, { ...shop, h: 4.5, style: BuildingStyle.Shop, color: 0xf4e9d8 });
    return;
  }
  if (r < fp.park + fp.parking + fp.gas + fp.vacant) { lot.use = LotUse.Vacant; return; }
  const maxW = district.style === 'trailer' ? 12 : district.style === 'stilt' ? 10 : district.style === 'villa' ? 22 : Infinity;
  const place = placeBuilding(lotPoly, fr, rule, maxW);
  if (!place) { lot.use = LotUse.Vacant; return; }
  const kind = buildingFor(district.style, place.x, place.z, place.w, place.d, noise, rnd);
  lot.building = addBuilding(map, { ...place, ...kind });
}

function addBuilding(map: WorldMap, b: BuildingDef) {
  map.buildings.push(b);
  return map.buildings.length - 1;
}

/** RÃ¤umlicher Index der StraÃŸensegmente fÃ¼r schnelle Abstandsabfragen. */
class SegmentIndex {
  private cells = new Map<number, [number, number][]>();
  constructor(private map: WorldMap, private size = 32) {
    for (const e of map.edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        const x0 = Math.floor(Math.min(a[0], b[0]) / size), x1 = Math.floor(Math.max(a[0], b[0]) / size);
        const z0 = Math.floor(Math.min(a[1], b[1]) / size), z1 = Math.floor(Math.max(a[1], b[1]) / size);
        for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const k = z * 4096 + x;
          let l = this.cells.get(k);
          if (!l) this.cells.set(k, (l = []));
          l.push([e.id, i]);
        }
      }
    }
  }
  /** Liegt p innerhalb von Fahrbahn + Gehweg + margin einer StraÃŸe? */
  onRoad(p: Vec2, margin: number): boolean {
    const r = 12 + margin;
    const x0 = Math.floor((p[0] - r) / this.size), x1 = Math.floor((p[0] + r) / this.size);
    const z0 = Math.floor((p[1] - r) / this.size), z1 = Math.floor((p[1] + r) / this.size);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      for (const [id, i] of this.cells.get(z * 4096 + x) ?? []) {
        const e = this.map.edges[id];
        const a = e.pts[i], b = e.pts[i + 1];
        if (distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]).d < e.width / 2 + e.sidewalk + margin) return true;
      }
    }
    return false;
  }
}

/**
 * StraÃŸenrandbebauung: Wo an einer StraÃŸe im Viertel (oder an ausgewÃ¤hlten LandstraÃŸen)
 * kein Block liegt, entstehen GrundstÃ¼cke entlang der StraÃŸe mit Front zur Fahrbahn.
 */
function frontageLots(ctx: Ctx) {
  const { map, rnd, noise, segs } = ctx;
  const rural = new Map<string, number>([
    ['Pine Hollow Road', -1], ['Northwest Road', -1], ['Northeast Road', -1], ['Spit Road', -1], ['Sabalâ€“Cane Road', -1],
    ['Coastline Highway', -1], ['Okee Trail', -1],
  ]);
  const occupied = (p: Vec2) => {
    for (const b of map.blocks) if (pointInPolygon(p[0], p[1], b.poly)) return true;
    for (const l of map.lots) if (Math.abs(l.poly[0][0] - p[0]) < 80 && Math.abs(l.poly[0][1] - p[1]) < 80 && pointInPolygon(p[0], p[1], l.poly)) return true;
    return false;
  };
  const freeTile = (p: Vec2, style: string) => {
    const t = map.tileAt(p[0], p[1]);
    return t !== Tile.WATER && t !== Tile.VOID && t !== Tile.ROCK && (t !== Tile.SWAMP || style === 'stilt');
  };
  const ruralDistrict = { id: -1, style: 'rural' };

  for (const e of map.edges) {
    if (e.type === RoadType.Pier) continue;
    const isRural = rural.has(e.name);
    for (const side of [-1, 1]) {
      let s = e.trimA + 6 + rnd() * 6;
      while (s < e.len - e.trimB - 8) {
        const p = pointAt(e.pts, e.cum, s);
        const d = map.districts.find((dd) => pointInPolygon(p.x, p.z, dd.poly));
        if (!d && !isRural) { s += 20; continue; }
        const dist = d ?? (ruralDistrict as never);
        const rule = d ? STYLES[d.style] ?? STYLES.town : { ...STYLES.villa, maxDepth: 11, front: 6 };
        const width = Math.max(10, Math.sqrt(rule.lotArea) * (d ? 0.9 : 1.2)) * (0.85 + rnd() * 0.3);
        const depth = Math.min(rule.front + rule.maxDepth + rule.back, d ? 44 : 30);
        if (!d && noise(p.x * 0.01, p.z * 0.01) < 0.5) { s += width; continue; } // Weiler in Gruppen
        // GrundstÃ¼cks-Rechteck: Vorderkante an der Gehweg-/StraÃŸenkante
        const off = e.width / 2 + e.sidewalk + 0.6;
        const nx = -p.dz * side, nz = p.dx * side; // vom StraÃŸenrand weg
        const fa: Vec2 = [p.x + nx * off - p.dx * (width / 2), p.z + nz * off - p.dz * (width / 2)];
        const fb: Vec2 = [p.x + nx * off + p.dx * (width / 2), p.z + nz * off + p.dz * (width / 2)];
        const poly: Poly = [fa, fb, [fb[0] + nx * depth, fb[1] + nz * depth], [fa[0] + nx * depth, fa[1] + nz * depth]];
        const c = centroid(poly);
        const probes: Vec2[] = [...poly.slice(2), c, [(poly[2][0] + poly[3][0]) / 2, (poly[2][1] + poly[3][1]) / 2]];
        const inside = !d || poly.every((q) => pointInPolygon(q[0], q[1], d.poly));
        const ok = inside && poly.every((q) => freeTile(q, dist.style)) && freeTile(c, dist.style)
          && !probes.some((q) => segs.onRoad(q, 0.5)) && !poly.some(occupied) && !occupied(c);
        if (ok) {
          if (d) {
            // Frontkante fa-fb (Reihenfolge so, dass placeBuilding ins GrundstÃ¼ck zeigt)
            fillLot(ctx, poly, { a: fa, b: fb }, d.id, -1);
          } else if (rnd() < 0.8) {
            const place = placeBuilding(poly, { a: fa, b: fb }, rule, 14);
            if (place) {
              const zone = map.zoneAt(c[0], c[1]);
              const barn = zone === Zone.DryPine && rnd() < 0.15;
              const color = zone === Zone.Highlands || zone === Zone.DryPine ? PAL_WOOD[Math.floor(rnd() * 4)] : PAL_TRAILER[Math.floor(rnd() * 5)];
              const id = addBuilding(map, { ...place, h: barn ? 7 : 5 + rnd() * 1.5, color: barn ? 0xa83c2a : color, style: barn ? BuildingStyle.Barn : BuildingStyle.House });
              map.lots.push({ id: map.lots.length, block: -1, district: -1, poly, use: LotUse.Building, building: id });
            }
          }
        }
        s += width + (d ? 0.5 : 8 + rnd() * 20);
      }
    }
  }
}

/** Tankstellen an LandstraÃŸen: GrundstÃ¼ck an der nÃ¤chsten StraÃŸe, Shop + Dach. */
function gasStations(map: WorldMap) {
  for (const [x, z] of POI.gasStations) {
    let best: { p: Vec2; dir: Vec2; e: number } | null = null, bd = Infinity;
    for (const e of map.edges) {
      if (e.type === RoadType.Pier) continue;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
        if (r.d < bd) {
          bd = r.d;
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          best = { p: [a[0] + (b[0] - a[0]) * r.t, a[1] + (b[1] - a[1]) * r.t], dir: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], e: e.id };
        }
      }
    }
    if (!best) continue;
    const e = map.edges[best.e];
    let n: Vec2 = [-best.dir[1], best.dir[0]];
    if ((x - best.p[0]) * n[0] + (z - best.p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const depth = 30, off = e.width / 2 + e.sidewalk + 1 + depth / 2;
    const cx = best.p[0] + n[0] * off, cz = best.p[1] + n[1] * off;
    const rot = Math.atan2(-n[0], -n[1]);
    const poly = orientedRect(cx, cz, 20, depth / 2, rot);
    if (!poly.every((p) => { const t = map.tileAt(p[0], p[1]); return t !== Tile.WATER && t !== Tile.SWAMP; })) continue;
    const shop = { x: cx - n[0] * -9, z: cz - n[1] * -9, w: 14, d: 8, h: 4.5, rot, color: 0xf4e9d8, style: BuildingStyle.Shop };
    map.buildings.push(shop);
    map.lots.push({ id: map.lots.length, block: -1, district: -1, poly, use: LotUse.Gas, building: map.buildings.length - 1 });
  }
}

function airport(map: WorldMap) {
  // Fremdbebauung innerhalb des Zauns entfernen (Grundstücke an der Zufahrt o. Ä.)
  const remap = new Map<number, number>();
  const kept: BuildingDef[] = [];
  map.buildings.forEach((b, i) => { if (!inAirport(b.x, b.z)) { remap.set(i, kept.length); kept.push(b); } });
  map.buildings = kept;
  for (const l of map.lots) {
    if (l.building >= 0) l.building = remap.get(l.building) ?? -1;
    const c = centroid(l.poly);
    if (inAirport(c[0], c[1]) && l.use === LotUse.Building) l.use = LotUse.Vacant;
  }
  for (const b of AIRPORT_BUILDINGS) map.buildings.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, rot: b.rot, color: b.color, style: BuildingStyle.Airport, tag: b.tag });
  airportFence(map);
  // Flugfeld Port Sabal: alter Hangar (Story-Versteck)
  map.buildings.push({ x: 560, z: 860, w: 34, d: 20, h: 7, rot: 0, color: 0xa8a8b0, style: BuildingStyle.Warehouse });
}

/** Zaun in 8-m-Stücken; über Wasser und auf Straßen entfällt er. Die Lücke an der Airport Road wird der Haupteingang. */
function airportFence(map: WorldMap) {
  const { x0, z0, x1, z1, height } = AIRPORT_FENCE;
  const sides: [Vec2, Vec2][] = [[[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]]];
  const gate: Vec2[] = [];
  let gateRot = 0;
  const onRoad = (x: number, z: number): RoadEdge | null => {
    for (const e of map.edges) {
      const r = e.width / 2 + e.sidewalk + 1.5;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        if (Math.min(a[0], b[0]) - r > x || Math.max(a[0], b[0]) + r < x || Math.min(a[1], b[1]) - r > z || Math.max(a[1], b[1]) + r < z) continue;
        if (distToSegment(x, z, a[0], a[1], b[0], b[1]).d < r) return e;
      }
    }
    return null;
  };
  for (const [a, b] of sides) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / 8), ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const rot = Math.abs(uz) > 0.5 ? Math.PI / 2 : 0;
    for (let k = 0; k < n; k++) {
      const s0 = (k * len) / n, s1 = ((k + 1) * len) / n;
      const pts: Vec2[] = [0, 0.5, 1].map((t): Vec2 => [a[0] + ux * (s0 + (s1 - s0) * t), a[1] + uz * (s0 + (s1 - s0) * t)]);
      if (pts.some((p) => map.groundAt(p[0], p[1]) === Tile.WATER || map.groundAt(p[0], p[1]) === Tile.SWAMP)) continue;
      const road = pts.map((p) => onRoad(p[0], p[1])).find((e) => e);
      if (road) { if (road.name === 'Airport Road') { gate.push(pts[1]); gateRot = rot; } continue; }
      const m = pts[1];
      // rot 0: Breite entlang x; rot π/2: Breite entlang z (lokale x-Achse = (0, -1))
      map.buildings.push({ x: m[0], z: m[1], w: s1 - s0, d: 2, h: height, rot, color: 0x9aa3ab, style: BuildingStyle.Airport, tag: 'fence' });
    }
  }
  // Schranke dort, wo die Airport Road den Zaun schneidet (Breite = Fahrbahn + Gehwege)
  const road = map.edges.find((e) => e.name === 'Airport Road' && gate.length > 0 && e.pts.some((p, i) => i > 0 && (p[1] - z0) * (e.pts[i - 1][1] - z0) <= 0));
  if (road) {
    for (let i = 1; i < road.pts.length; i++) {
      const p = road.pts[i - 1], q = road.pts[i];
      if ((p[1] - z0) * (q[1] - z0) > 0) continue;
      const t = (z0 - p[1]) / (q[1] - p[1] || 1);
      map.airportGate = { x: p[0] + (q[0] - p[0]) * t, z: z0, rot: gateRot, w: road.width + road.sidewalk * 2 };
      break;
    }
  }
}
