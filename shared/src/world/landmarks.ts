// Wahrzeichen mit Spielfunktion (#38, #39, #40): Krankenhaus (Respawn nach dem K.O.), Polizeirevier
// (Respawn nach der Festnahme) und die Story-Garage an Lous Waschanlage „Bubble Bath“.
// Sie werden nach dem Rastern an die nächste passende Straße gesetzt: Front zur Fahrbahn, hinter dem
// Gehweg. Bestehende Gebäude und Grundstücke auf dem Bauplatz werden abgerissen.
// Läuft auf Client und Server identisch (deterministisch, ohne Zufall).
import { CELL, GRID_SIZE } from '../constants';
import { distToSegment, orientedRect, pointAt, pointInPolygon, rasterizePolygon, type Poly } from './geometry';
import { Tile } from './tiles';
import { BuildingStyle, RoadType, type WorldMap } from './WorldMap';

export type LandmarkId = 'hospital' | 'police' | 'garage';

export interface Landmark {
  id: LandmarkId;
  name: string;
  /** Mitte, Drehung (Front = (sin rot, cos rot), zeigt zur Straße), Maße */
  x: number; z: number; rot: number; w: number; d: number; h: number;
  /** Ausgang/Eingang vor der Front (Respawn-Punkt), Blick zur Straße */
  door: { x: number; z: number; a: number };
}

interface LandmarkDef { id: LandmarkId; name: string; anchor: [number, number]; w: number; d: number; h: number; color: number }

const DEFS: LandmarkDef[] = [
  { id: 'hospital', name: 'Palmara General Hospital', anchor: [1336, 948], w: 34, d: 20, h: 14, color: 0xf4f6f8 },
  { id: 'police', name: 'Polizeirevier Downtown', anchor: [1392, 1052], w: 28, d: 18, h: 10, color: 0xe8edf4 },
  // Story-Hauptpunkt: Lous Waschanlage mit Garage (Zuhause „Lous Sofa“, Garagenfahrzeuge)
  { id: 'garage', name: 'Bubble Bath – Waschanlage & Garage', anchor: [1290, 812], w: 22, d: 14, h: 6.5, color: 0xfde7f1 },
];

/** Bodenarten, auf denen ein Wahrzeichen stehen darf (Gebäude werden abgerissen). */
const SITE_OK = new Set<number>([Tile.BUILDING, Tile.GRASS, Tile.PLAZA, Tile.SAND, Tile.DIRT, Tile.GRAVEL, Tile.DESERT, Tile.BADLANDS]);
const FRONT_GAP = 3; // Vorplatz zwischen Gehweg und Front (m)
const SPAWN_CLEAR = 10;

function rectPoints(poly: Poly): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const a = poly[i], b = poly[(i + 1) % 4];
    for (let t = 0; t < 1; t += 0.125) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  const cx = (poly[0][0] + poly[2][0]) / 2, cz = (poly[0][1] + poly[2][1]) / 2;
  out.push([cx, cz]);
  return out;
}
const overlaps = (a: Poly, b: Poly) => rectPoints(a).some(([x, z]) => pointInPolygon(x, z, b)) || rectPoints(b).some(([x, z]) => pointInPolygon(x, z, a));

function siteFree(map: WorldMap, poly: Poly, front: Poly): boolean {
  let ok = true;
  rasterizePolygon(poly, CELL, GRID_SIZE, (tx, tz) => {
    const i = tz * GRID_SIZE + tx;
    if (!SITE_OK.has(map.tiles[i]) || map.storeTiles.has(i)) ok = false;
  });
  rasterizePolygon(front, CELL, GRID_SIZE, (tx, tz) => {
    const t = map.tiles[tz * GRID_SIZE + tx];
    if (t === Tile.WATER || t === Tile.BRIDGE || t === Tile.ROCK) ok = false;
  });
  return ok;
}

/** Bauplätze an Straßen nahe (ax, az), Front zur Fahrbahn; nach Entfernung sortiert. */
function roadSites(map: WorldMap, ax: number, az: number, hw: number, hd: number) {
  const out: { cx: number; cz: number; rot: number; dist: number; back: number }[] = [];
  for (const e of map.edges) {
    if (e.type === RoadType.Pier || e.type === RoadType.Highway || e.type === RoadType.Dirt) continue;
    let bd = 90, bs = -1;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i], b = e.pts[i + 1];
      const r = distToSegment(ax, az, a[0], a[1], b[0], b[1]);
      if (r.d < bd) { bd = r.d; bs = e.cum[i] + (e.cum[i + 1] - e.cum[i]) * r.t; }
    }
    if (bs < 0) continue;
    for (let k = 0; k < 61; k++) {
      const s = bs + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
      if (s < e.trimA + hw + 2 || s > e.len - e.trimB - hw - 2) continue;
      const q = pointAt(e.pts, e.cum, s);
      for (const sideSign of [1, -1]) {
        const nx = -q.dz * sideSign, nz = q.dx * sideSign;
        const back = e.width / 2 + e.sidewalk + FRONT_GAP + hd;
        const cx = q.x + nx * back, cz = q.z + nz * back;
        out.push({ cx, cz, rot: Math.atan2(-nx, -nz), dist: Math.hypot(cx - ax, cz - az), back });
      }
    }
  }
  // Front möglichst nach Süden (zur Kamera, die nach Norden blickt) – sonst sieht man Eingang und Schilder nicht
  const score = (p: { dist: number; rot: number }) => p.dist + (Math.cos(p.rot) < 0.8 ? 80 : 0);
  return out.sort((p, q) => score(p) - score(q));
}

/** Wahrzeichen setzen (nach rasterize, vor placeShops). Ergebnis in map.landmarks. */
export function placeLandmarks(map: WorldMap) {
  map.landmarks = [];
  for (const def of DEFS) {
    const hw = def.w / 2, hd = def.d / 2;
    for (const site of roadSites(map, def.anchor[0], def.anchor[1], hw, hd)) {
      const { cx, cz, rot } = site;
      if (Math.hypot(cx - map.spawn.x, cz - map.spawn.z) < Math.max(hw, hd) + SPAWN_CLEAR) continue;
      const poly = orientedRect(cx, cz, hw + 0.5, hd + 0.5, rot);
      const fx = Math.sin(rot), fz = Math.cos(rot);
      const front = orientedRect(cx + fx * (hd + FRONT_GAP / 2), cz + fz * (hd + FRONT_GAP / 2), hw, FRONT_GAP / 2 - 0.3, rot);
      if (map.landmarks.some((l) => overlaps(orientedRect(l.x, l.z, l.w / 2 + 3, l.d / 2 + 3, l.rot), poly))) continue;
      if (!siteFree(map, poly, front)) continue;
      build(map, def, cx, cz, rot, poly, front);
      break;
    }
  }
}

function build(map: WorldMap, def: LandmarkDef, cx: number, cz: number, rot: number, poly: Poly, front: Poly) {
  const hw = def.w / 2, hd = def.d / 2;
  const clear = orientedRect(cx, cz, hw + 2, hd + 2, rot);
  // Abriss: Gebäude auf dem Bauplatz (Kacheln werden zum Platz), Grundstücke entfernen
  const remap = new Map<number, number>();
  const kept: typeof map.buildings = [];
  map.buildings.forEach((b, i) => {
    const r = orientedRect(b.x, b.z, b.w / 2, b.d / 2, b.rot);
    if (b.style !== BuildingStyle.Store && overlaps(r, clear)) {
      rasterizePolygon(r, CELL, GRID_SIZE, (tx, tz) => {
        const k = tz * GRID_SIZE + tx;
        if (map.tiles[k] === Tile.BUILDING) { map.tiles[k] = Tile.PLAZA; map.ground[k] = Tile.PLAZA; }
      });
      return;
    }
    remap.set(i, kept.length); kept.push(b);
  });
  map.buildings = kept;
  map.lots = map.lots.filter((l) => !(l.poly.some(([x, z]) => pointInPolygon(x, z, clear)) || rectPoints(clear).some(([x, z]) => pointInPolygon(x, z, l.poly))));
  map.lots.forEach((l, i) => { l.id = i; if (l.building >= 0) l.building = remap.get(l.building) ?? -1; });
  // Vorplatz und Umgebung als Platz, das Gebäude massiv
  rasterizePolygon(orientedRect(cx, cz, hw + 2, hd + 2, rot), CELL, GRID_SIZE, (tx, tz) => {
    const k = tz * GRID_SIZE + tx;
    if (map.tiles[k] !== Tile.ROAD && map.tiles[k] !== Tile.SIDEWALK) { map.tiles[k] = Tile.PLAZA; map.ground[k] = Tile.PLAZA; }
  });
  rasterizePolygon(front, CELL, GRID_SIZE, (tx, tz) => {
    const k = tz * GRID_SIZE + tx;
    if (map.tiles[k] !== Tile.ROAD && map.tiles[k] !== Tile.SIDEWALK) { map.tiles[k] = Tile.PLAZA; map.ground[k] = Tile.PLAZA; }
  });
  rasterizePolygon(orientedRect(cx, cz, hw, hd, rot), CELL, GRID_SIZE, (tx, tz) => { map.tiles[tz * GRID_SIZE + tx] = Tile.BUILDING; });
  void poly;
  map.buildings.push({ x: cx, z: cz, w: def.w, d: def.d, h: def.h, rot, color: def.color, style: BuildingStyle.Landmark, tag: def.id });
  map.clearAreas.push([cx - hw - 6, cz - hd - 6, cx + hw + 6, cz + hd + 6]);
  map.vehicleSpawns = map.vehicleSpawns.filter((v) => Math.hypot(v.x - cx, v.z - cz) > Math.max(hw, hd) + 4);
  map.ramps = map.ramps.filter((r) => Math.hypot(r.x - cx, r.z - cz) > Math.max(hw, hd) + 6);
  const fx = Math.sin(rot), fz = Math.cos(rot);
  const door = { x: cx + fx * (hd + 1.6), z: cz + fz * (hd + 1.6), a: rot };
  map.landmarks.push({ id: def.id, name: def.name, x: cx, z: cz, rot, w: def.w, d: def.d, h: def.h, door });
}

export function landmark(map: WorldMap, id: LandmarkId): Landmark | undefined {
  return map.landmarks.find((l) => l.id === id);
}
