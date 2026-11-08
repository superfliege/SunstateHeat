// Fahrspaß-Features der Welt – deterministisch aus der Karte erzeugt (Client und Server gleich):
//   - Rampen/Sprungschanzen (Testgelände, Baustellen = Brachen in der Stadt, Strandpromenade)
//   - Testgelände: abgetrennter Bereich mit Drift-Pad, Rundkurs, Slalom, Untergründen, Rampen, Crash-Wänden
//   - Zerstörbare Props (Laternen, Hydranten, Bänke, Mülltonnen, Zeitungsautomaten, Kegel, Strandliegen)
//   - Hindernisse für die Fahrphysik: Baumstämme (aus der Vegetation)
//   - Nasse Flächen (Grip x 0,85)
import { CELL, GRID_SIZE, HEIGHT_STEP, MAP_SEED, WORLD_SIZE } from '../constants';
import { mulberry32 } from '../math';
import { VehicleKind } from '../sim/vehicleDefs';
import { centroid, pointAt, polygonArea, rasterizePolyline, type Vec2 } from './geometry';
import { Tile } from './tiles';
import { generateVegetation } from './vegetation';
import { LotUse, TreeType, type WorldMap } from './WorldMap';

// ------------------------------------------------------------------ Rampen
export interface Ramp {
  x: number; z: number; // Mitte der Auffahrt (Fußpunkt)
  rot: number; // Fahrtrichtung die Rampe hinauf: (sin rot, cos rot)
  len: number; w: number; h: number; // Länge, Breite, Kantenhöhe
}

/** Höhe der Rampenoberfläche an (x, z) relativ zum Boden, oder -1 außerhalb. */
export function rampHeightAt(r: Ramp, x: number, z: number): number {
  const dx = x - r.x, dz = z - r.z;
  const fx = Math.sin(r.rot), fz = Math.cos(r.rot);
  const u = dx * fx + dz * fz, v = dx * fz - dz * fx;
  if (u < 0 || u > r.len || Math.abs(v) > r.w / 2) return -1;
  return (u / r.len) * r.h;
}

// ------------------------------------------------------------------ Testgelände
export const TEST_TRACK = {
  x0: 1064, z0: 184, w: 180, d: 130,
  name: 'Testgelände',
};
const T = TEST_TRACK;
const L = (x: number, z: number): Vec2 => [T.x0 + x, T.z0 + z];
/** Rechtecke in lokalen Koordinaten (x0, z0, x1, z1). */
export const TRACK_PAD = [10, 12, 120, 70] as const; // Drift-/Slalom-Platte (Asphalt)
export const TRACK_LOOP: Vec2[] = [[14, 80], [40, 112], [90, 120], [140, 116], [168, 96], [170, 52], [160, 16], [128, 8], [116, 20]];
export const TRACK_LOOP_WIDTH = 11;
export const TRACK_PATCHES: { tile: number; rect: [number, number, number, number]; label: string }[] = [
  { tile: Tile.SAND, rect: [126, 26, 160, 56], label: 'Sand' },
  { tile: Tile.DIRT, rect: [126, 60, 160, 84], label: 'Schotter' },
  { tile: Tile.SWAMP, rect: [22, 84, 52, 104], label: 'Schlamm' },
];
/** Nasse Fläche auf dem Asphalt. */
export const TRACK_WET = [60, 14, 100, 32] as const;
/** Crash-Wände (Mauerkacheln): Rand mit Einfahrt im Süden + zwei Prallblöcke. */
/** Nagelband quer über den Rundkurs (Reifen platzen). */
export const TRACK_SPIKES = [60, 110, 61.2, 121] as const;
export const TRACK_WALLS: [number, number, number, number][] = [
  [0, 0, 180, 3], [0, 0, 3, 130], [177, 0, 180, 130], [0, 127, 70, 130], [100, 127, 180, 130],
  [84, 76, 92, 90], [64, 46, 66, 66],
];
export const TRACK_RAMPS: Ramp[] = [
  { x: T.x0 + 66, z: T.z0 + 104, rot: Math.PI / 2, len: 8, w: 6, h: 1.1 },
  { x: T.x0 + 104, z: T.z0 + 108, rot: Math.PI / 2, len: 12, w: 7, h: 2.4 },
  { x: T.x0 + 30, z: T.z0 + 24, rot: Math.PI / 2, len: 10, w: 6, h: 1.6 },
];
/** Slalom-Kegel auf der Platte. */
export const TRACK_CONES: Vec2[] = Array.from({ length: 8 }, (_, i) => L(24 + i * 11, 48));
export const TRACK_SPAWN = { x: T.x0 + 20, z: T.z0 + 60, a: Math.PI / 2 };
/** Werkstatt-Box im Testgelände (Ecke der Asphaltplatte). */
export const TRACK_WORKSHOP = { x: T.x0 + 112, z: T.z0 + 62 };

export function inTestTrack(x: number, z: number, margin = 0) {
  return x >= T.x0 - margin && x <= T.x0 + T.w + margin && z >= T.z0 - margin && z <= T.z0 + T.d + margin;
}

/** Testgelände in Kacheln und Höhenfeld eintragen (mapgen, nach der Rasterung). */
export function buildTestTrack(map: WorldMap) {
  const N = GRID_SIZE, HG = WORLD_SIZE / HEIGHT_STEP + 1;
  // flach machen (Mittelwert), Rand weich angleichen
  let sum = 0, n = 0;
  for (let gz = Math.floor(T.z0 / HEIGHT_STEP); gz <= Math.ceil((T.z0 + T.d) / HEIGHT_STEP); gz++) {
    for (let gx = Math.floor(T.x0 / HEIGHT_STEP); gx <= Math.ceil((T.x0 + T.w) / HEIGHT_STEP); gx++) { sum += map.heights[gz * HG + gx]; n++; }
  }
  const h0 = Math.max(0.5, sum / n);
  const pad = 24;
  for (let gz = Math.floor((T.z0 - pad) / HEIGHT_STEP); gz <= Math.ceil((T.z0 + T.d + pad) / HEIGHT_STEP); gz++) {
    for (let gx = Math.floor((T.x0 - pad) / HEIGHT_STEP); gx <= Math.ceil((T.x0 + T.w + pad) / HEIGHT_STEP); gx++) {
      const x = gx * HEIGHT_STEP, z = gz * HEIGHT_STEP;
      const dx = Math.max(T.x0 - x, 0, x - T.x0 - T.w), dz = Math.max(T.z0 - z, 0, z - T.z0 - T.d);
      const k = Math.min(1, Math.hypot(dx, dz) / pad);
      const i = gz * HG + gx;
      map.heights[i] = h0 + (map.heights[i] - h0) * k * k;
    }
  }
  const set = (t: number, x0: number, z0: number, x1: number, z1: number) => {
    for (let cz = Math.floor((T.z0 + z0) / CELL); cz < Math.ceil((T.z0 + z1) / CELL); cz++) {
      for (let cx = Math.floor((T.x0 + x0) / CELL); cx < Math.ceil((T.x0 + x1) / CELL); cx++) {
        const i = cz * N + cx;
        map.tiles[i] = t; map.ground[i] = t === Tile.ROAD || t === Tile.BUILDING ? Tile.GRASS : t;
      }
    }
  };
  set(Tile.GRASS, 0, 0, T.w, T.d);
  set(Tile.ROAD, ...TRACK_PAD);
  rasterizePolyline(TRACK_LOOP.map(([x, z]) => L(x, z)), () => TRACK_LOOP_WIDTH / 2, CELL, N, (cx, cz) => {
    map.tiles[cz * N + cx] = Tile.ROAD; map.ground[cz * N + cx] = Tile.GRASS;
  });
  for (const p of TRACK_PATCHES) set(p.tile, ...p.rect);
  for (const w of TRACK_WALLS) set(Tile.BUILDING, ...w);
  // Schlamm liegt auf Bodenhöhe (nicht im Wasser)
  map.ramps.push(...TRACK_RAMPS);
  map.wet.push([T.x0 + TRACK_WET[0], T.z0 + TRACK_WET[1], T.x0 + TRACK_WET[2], T.z0 + TRACK_WET[3]]);
  map.spikes.push([T.x0 + TRACK_SPIKES[0], T.z0 + TRACK_SPIKES[1], T.x0 + TRACK_SPIKES[2], T.z0 + TRACK_SPIKES[3]]);
  // Je ein Fahrzeug jeder Klasse zum Ausprobieren (Varianten aus handling.ts)
  const variants = [0, 1, 4, 5, 6, 8];
  variants.forEach((variant, k) => {
    map.vehicleSpawns.push({ kind: VehicleKind.Car, x: T.x0 + 22 + k * 14, z: T.z0 + 20, a: 0, color: k * 2 % 10, variant });
  });
  map.vehicleSpawns.push({ kind: VehicleKind.Bike, x: T.x0 + 22 + 6 * 14, z: T.z0 + 20, a: 0, color: 3 });
}

// ------------------------------------------------------------------ Rampen in der Stadt und am Strand
export function placeRamps(map: WorldMap, seed: number) {
  const rnd = mulberry32(seed + 77);
  // Baustellen: größere Brachen in Stadtvierteln bekommen eine Schanze (mit Kegeln)
  for (const l of map.lots) {
    if (l.use !== LotUse.Vacant || l.block < 0 || Math.abs(polygonArea(l.poly)) < 380 || rnd() > 0.55) continue;
    const c = centroid(l.poly);
    // Auffahrt entlang der längsten Kante
    let best = 0, rot = 0;
    for (let i = 0; i < l.poly.length; i++) {
      const p = l.poly[i], q = l.poly[(i + 1) % l.poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len > best) { best = len; rot = Math.atan2(q[0] - p[0], q[1] - p[1]); }
    }
    const len = 7 + rnd() * 3;
    map.ramps.push({ x: c[0] - Math.sin(rot) * len / 2, z: c[1] - Math.cos(rot) * len / 2, rot, len, w: 5, h: 1.1 + rnd() * 0.8 });
  }
  // Strandpromenade: Sandrampen neben den Palmen-Küstenstraßen
  let beach = 0;
  for (const e of map.edges) {
    if (!e.palms || beach >= 5) continue;
    for (let s = 40; s < e.len - 40 && beach < 5; s += 140) {
      const p = pointAt(e.pts, e.cum, s);
      for (const side of [-1, 1]) {
        const off = e.width / 2 + e.sidewalk + 14;
        const x = p.x - p.dz * off * side, z = p.z + p.dx * off * side;
        let sandy = true;
        for (const [dx, dz] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) if (map.tileAt(x + dx, z + dz) !== Tile.SAND) sandy = false;
        if (!sandy || rnd() > 0.5) continue;
        const rot = Math.atan2(p.dx, p.dz);
        map.ramps.push({ x: x - Math.sin(rot) * 4.5, z: z - Math.cos(rot) * 4.5, rot, len: 9, w: 5, h: 1.4 });
        beach++;
        break;
      }
    }
  }
}

/** Rampen-Index (Zellen à 32 m) für schnelle Abfragen. */
const rampIndex = new WeakMap<WorldMap, Map<number, Ramp[]>>();
const RCELL = 32;
export function rampsNear(map: WorldMap, x: number, z: number): Ramp[] | undefined {
  let idx = rampIndex.get(map);
  if (!idx) {
    idx = new Map();
    for (const r of map.ramps) {
      const ex = r.x + Math.sin(r.rot) * r.len, ez = r.z + Math.cos(r.rot) * r.len;
      const pad = r.w;
      for (let cz = Math.floor((Math.min(r.z, ez) - pad) / RCELL); cz <= Math.floor((Math.max(r.z, ez) + pad) / RCELL); cz++) {
        for (let cx = Math.floor((Math.min(r.x, ex) - pad) / RCELL); cx <= Math.floor((Math.max(r.x, ex) + pad) / RCELL); cx++) {
          const k = cz * 1024 + cx;
          let l = idx.get(k);
          if (!l) idx.set(k, (l = []));
          l.push(r);
        }
      }
    }
    rampIndex.set(map, idx);
  }
  return idx.get(Math.floor(z / RCELL) * 1024 + Math.floor(x / RCELL));
}

/** Zusätzliche Höhe durch Rampen an (x, z). */
export function rampAt(map: WorldMap, x: number, z: number): number {
  const list = rampsNear(map, x, z);
  if (!list) return 0;
  let h = 0;
  for (const r of list) h = Math.max(h, rampHeightAt(r, x, z));
  return h;
}

export function isWet(map: WorldMap, x: number, z: number): boolean {
  for (const w of map.wet) if (x >= w[0] && x <= w[2] && z >= w[1] && z <= w[3]) return true;
  return false;
}

// ------------------------------------------------------------------ Hindernisse (Baumstämme)
export interface Obstacle { x: number; z: number; r: number; palm: boolean; tree: number }
const OCELL = 16;
const obstacleIndex = new WeakMap<WorldMap, { cells: Map<number, Obstacle[]>; list: Obstacle[] }>();

/** Baumstämme als Kreise; Index wird beim ersten Aufruf aus der (geteilten) Vegetation gebaut. */
export function obstacles(map: WorldMap) {
  let idx = obstacleIndex.get(map);
  if (!idx) {
    const cells = new Map<number, Obstacle[]>();
    const list: Obstacle[] = [];
    generateVegetation(map, MAP_SEED).forEach((t, i) => {
      if (map.tileAt(t.x, t.z) === Tile.SWAMP && t.type === TreeType.Mangrove) return; // im Wasser
      const o: Obstacle = { x: t.x, z: t.z, r: (t.type === TreeType.Palm ? 0.32 : 0.4) * t.s, palm: t.type === TreeType.Palm, tree: i };
      list.push(o);
      const k = Math.floor(t.z / OCELL) * 256 + Math.floor(t.x / OCELL);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(o);
    });
    idx = { cells, list };
    obstacleIndex.set(map, idx);
  }
  return idx;
}

/** Hindernisse in der Nähe (3x3 Zellen). */
export function obstaclesNear(map: WorldMap, x: number, z: number, out: Obstacle[]): Obstacle[] {
  out.length = 0;
  const { cells } = obstacles(map);
  const cx = Math.floor(x / OCELL), cz = Math.floor(z / OCELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const l = cells.get((cz + dz) * 256 + cx + dx);
    if (l) for (const o of l) out.push(o);
  }
  return out;
}

// ------------------------------------------------------------------ Zerstörbare Props
export const PropType = { Lamp: 0, Hydrant: 1, Bench: 2, Trash: 3, Newsbox: 4, Cone: 5, Lounger: 6 } as const;
export const PROP_INFO = [
  { name: 'Laterne', mass: 140, r: 0.25 },
  { name: 'Hydrant', mass: 90, r: 0.25 },
  { name: 'Bank', mass: 45, r: 0.8 },
  { name: 'Mülltonne', mass: 18, r: 0.4 },
  { name: 'Zeitungsautomat', mass: 30, r: 0.35 },
  { name: 'Kegel', mass: 3, r: 0.25 },
  { name: 'Strandliege', mass: 9, r: 0.7 },
];
export interface Prop { id: number; type: number; x: number; y: number; z: number; rot: number }

const propCache = new WeakMap<WorldMap, Prop[]>();
const CURB = 0.14;

/** Alle zerstörbaren Props (Reihenfolge = ID, auf Client und Server identisch). */
export function generateProps(map: WorldMap): Prop[] {
  const hit = propCache.get(map);
  if (hit) return hit;
  const rnd = mulberry32(MAP_SEED + 4242);
  const out: Prop[] = [];
  const add = (type: number, x: number, y: number, z: number, rot: number) => out.push({ id: out.length, type, x, y, z, rot });
  const roadY = (x: number, z: number) => Math.max(0.05, map.terrainHeight(x, z)) + 0.04;
  for (const e of map.edges) {
    if (e.sidewalk <= 0) continue;
    const hw = e.width / 2;
    const style = map.districtAt(e.pts[0][0], e.pts[0][1])?.style ?? '';
    for (const side of [-1, 1]) {
      const start = e.trimA + 4 + (side > 0 ? 0 : 12);
      for (let s = start; s < e.len - e.trimB - 3; s += 24) {
        const p = pointAt(e.pts, e.cum, s);
        if (map.groundAt(p.x, p.z) === Tile.WATER) continue;
        const rx = -p.dz * side, rz = p.dx * side;
        const y = roadY(p.x, p.z) + CURB;
        // Mast 0,5 m hinter der Bordsteinkante; rot = Richtung, in die der Arm zeigt (zur Fahrbahn)
        add(PropType.Lamp, p.x + rx * (hw + 0.5), y, p.z + rz * (hw + 0.5), Math.atan2(-rx, -rz));
        if (rnd() < 0.18) add(PropType.Hydrant, p.x + rx * (hw + 1.1) + p.dx * 6, y, p.z + rz * (hw + 1.1) + p.dz * 6, rnd() * 6);
        if (rnd() < 0.22) add(PropType.Trash, p.x + rx * (hw + e.sidewalk - 0.6) + p.dx * 11, y, p.z + rz * (hw + e.sidewalk - 0.6) + p.dz * 11, rnd() * 6);
        if ((style === 'downtown' || style === 'deco' || style === 'havana') && rnd() < 0.12) {
          add(PropType.Newsbox, p.x + rx * (hw + 1.0) - p.dx * 5, y, p.z + rz * (hw + 1.0) - p.dz * 5, Math.atan2(-rx, -rz));
        }
      }
    }
  }
  // Parks: Bänke; Baustellen: Kegel um die Rampe
  for (const l of map.lots) {
    const c = centroid(l.poly);
    const y = Math.max(0.05, map.terrainHeight(c[0], c[1])) + 0.2;
    if (l.use === LotUse.Park) {
      const a = l.poly[0];
      const x = c[0] + (a[0] - c[0]) * 0.6 * rnd(), z = c[1] + (a[1] - c[1]) * 0.6 * rnd();
      add(PropType.Bench, x, y, z, Math.atan2(c[0] - x, c[1] - z));
    }
  }
  for (const r of map.ramps) {
    if (inTestTrack(r.x, r.z)) continue;
    const y = Math.max(0.05, map.terrainHeight(r.x, r.z)) + 0.2;
    for (const side of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const u = -2 + k * 3, v = side * (r.w / 2 + 0.8);
        add(PropType.Cone, r.x + Math.sin(r.rot) * u + Math.cos(r.rot) * v, y, r.z + Math.cos(r.rot) * u - Math.sin(r.rot) * v, rnd() * 6);
      }
    }
  }
  // Testgelände: Slalom
  for (const [x, z] of TRACK_CONES) add(PropType.Cone, x, Math.max(0.05, map.terrainHeight(x, z)) + 0.04, z, 0);
  // Strand: Liegen in Reihen (Ocean Strip / Coral Keys), mit Abstand zum Wasser
  for (const e of map.edges) {
    if (!e.palms) continue;
    for (let s = 20; s < e.len - 20; s += 60) {
      if (rnd() > 0.6) continue;
      const p = pointAt(e.pts, e.cum, s);
      for (const side of [-1, 1]) {
        const off = e.width / 2 + e.sidewalk + 7;
        const x = p.x - p.dz * off * side, z = p.z + p.dx * off * side;
        if (map.tileAt(x, z) !== Tile.SAND || map.tileAt(x - p.dz * 4 * side, z + p.dx * 4 * side) !== Tile.SAND) continue;
        for (let k = 0; k < 4; k++) {
          const lx = x + p.dx * (k * 2.2), lz = z + p.dz * (k * 2.2);
          if (map.tileAt(lx, lz) === Tile.SAND) add(PropType.Lounger, lx, Math.max(0, map.terrainHeight(lx, lz)), lz, Math.atan2(-p.dz * side, p.dx * side));
        }
        break;
      }
    }
  }
  propCache.set(map, out);
  return out;
}

/** Räumlicher Index der Props (Zellen à 16 m). */
const propIndex = new WeakMap<WorldMap, Map<number, Prop[]>>();
export function propsNear(map: WorldMap, x: number, z: number, out: Prop[]): Prop[] {
  let idx = propIndex.get(map);
  if (!idx) {
    idx = new Map();
    for (const p of generateProps(map)) {
      const k = Math.floor(p.z / OCELL) * 256 + Math.floor(p.x / OCELL);
      let l = idx.get(k);
      if (!l) idx.set(k, (l = []));
      l.push(p);
    }
    propIndex.set(map, idx);
  }
  out.length = 0;
  const cx = Math.floor(x / OCELL), cz = Math.floor(z / OCELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const l = idx.get((cz + dz) * 256 + cx + dx);
    if (l) for (const p of l) out.push(p);
  }
  return out;
}
