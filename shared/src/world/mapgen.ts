// Weltgenerierung von Palmara. Deterministisch: gleicher Seed => identische Welt auf
// Client und Server. Ablauf:
//   1. Gelände (terrain.ts): ausgefranste Küsten, Inseln, Kanäle, Sumpf, Biome, Höhenfeld
//   2. Straßengraph (roads.ts): Hauptachsen + Viertelraster als Splines, planarisiert
//   3. Stadt (city.ts): Blöcke aus den Flächen zwischen Straßen, Grundstücke, Gebäude
//   4. Rasterung aller Vektordaten ins Kollisionsraster, Chunk-Index, Spawns
import { prepareCollision } from './collision';
import { CELL, CHUNK, GRID_SIZE, HEIGHT_STEP, NPC_DENSITY, VEHICLE_COLORS, WORLD_SIZE } from '../constants';
import { mulberry32 } from '../math';
import { VehicleKind } from '../sim/vehicleDefs';
import { buildCity } from './city';
import { placeShops } from '../shops';
import {
  centroid, orientedRect, pointAt, polygonArea, rasterizePolygon, rasterizePolyline, type Vec2,
} from './geometry';
import { AIRPORT_APRON, POI, RUNWAYS } from './palmara';
import { arms, buildRoadGraph, junctionOutline } from './roads';
import { buildTerrain } from './terrain';
import { buildTestTrack, inTestTrack, placeRamps, TEST_TRACK, TRACK_WORKSHOP } from './features';
import { Tile } from './tiles';
import { LotUse, RoadType, WorldMap, type ChunkContent } from './WorldMap';

const N = GRID_SIZE;
const HGRID = WORLD_SIZE / HEIGHT_STEP + 1;

export function generateWorld(seed: number): WorldMap {
  const map = new WorldMap();
  const rnd = mulberry32(seed);
  buildTerrain(map, seed);
  buildRoadGraph(map, seed);
  buildCity(map, seed);
  rasterize(map);
  flattenAlongRoads(map);
  buildChunks(map);
  placeSpawns(map, rnd);
  placeRamps(map, seed);
  map.vehicleSpawns = map.vehicleSpawns.filter((s) => !inTestTrack(s.x, s.z, 8));
  buildTestTrack(map);
  map.clearAreas.push([TEST_TRACK.x0 - 6, TEST_TRACK.z0 - 6, TEST_TRACK.x0 + TEST_TRACK.w + 6, TEST_TRACK.z0 + TEST_TRACK.d + 6]);
  for (const r of map.ramps) {
    const ex = r.x + Math.sin(r.rot) * r.len, ez = r.z + Math.cos(r.rot) * r.len, m = r.w + 4;
    map.clearAreas.push([Math.min(r.x, ex) - m, Math.min(r.z, ez) - m, Math.max(r.x, ex) + m, Math.max(r.z, ez) + m]);
  }
  // Werkstätten: Tankstellen-Grundstücke + Box im Testgelände
  for (const l of map.lots) {
    if (l.use !== LotUse.Gas) continue;
    const c = centroid(l.poly);
    map.workshops.push({ x: c[0], z: c[1], r: 7 });
  }
  map.workshops.push({ ...TRACK_WORKSHOP, r: 7 });
  // Läden als echte Gebäude (nach Werkstätten, da sie daran hängen); danach Chunk-Index neu
  placeShops(map);
  prepareCollision(map); // exakte Gebäude-Kollision auf dem fertigen Raster aufbauen
  buildChunks(map);
  return map;
}

// ------------------------------------------------------------------ Rasterung
function rasterize(map: WorldMap) {
  const tiles = map.tiles, ground = map.ground;
  const setBoth = (t: number) => (x: number, z: number) => {
    const i = z * N + x;
    if (ground[i] === Tile.WATER) return;
    tiles[i] = t; ground[i] = t;
  };
  // Stadtgrund, Grundstücke, Flughafen
  for (const b of map.blocks) if (!b.open) rasterizePolygon(b.poly, CELL, N, setBoth(Tile.PLAZA));
  for (const l of map.lots) {
    const t = l.use === LotUse.Park ? Tile.GRASS : l.use === LotUse.Vacant ? Tile.DIRT : Tile.PLAZA;
    if (l.block >= 0 || l.use === LotUse.Gas) rasterizePolygon(l.poly, CELL, N, setBoth(t));
  }
  rasterizePolygon(AIRPORT_APRON, CELL, N, setBoth(Tile.PLAZA));
  for (const [x, z, len, wid, deg] of RUNWAYS) {
    const rot = (deg * Math.PI) / 180;
    map.runways.push({ x, z, len, wid, rot });
    rasterizePolygon(orientedRect(x, z, wid / 2, len / 2, rot), CELL, N, setBoth(Tile.ROAD));
  }

  // Straßen: erst Gehwege, dann Fahrbahn; über Wasser wird es Brücke
  const roadTile = (type: number, x: number, z: number) => {
    const i = z * N + x;
    if (type === RoadType.Pier) return Tile.DOCK;
    if (ground[i] === Tile.WATER) return Tile.BRIDGE;
    return type === RoadType.Dirt ? Tile.DIRT : Tile.ROAD;
  };
  for (const e of map.edges) {
    if (e.sidewalk > 0) {
      rasterizePolyline(e.pts, () => e.width / 2 + e.sidewalk, CELL, N, (x, z) => {
        const i = z * N + x;
        tiles[i] = ground[i] === Tile.WATER ? Tile.BRIDGE : Tile.SIDEWALK;
      });
    }
  }
  for (const n of map.nodes) {
    if (n.roundabout || n.edges.length < 2) continue;
    const walk = junctionOutline(map, n, (a) => a.sw);
    if (walk.length > 2 && arms(map, n).some((a) => a.sw > 0)) {
      rasterizePolygon(walk, CELL, N, (x, z) => { const i = z * N + x; if (ground[i] !== Tile.WATER) tiles[i] = Tile.SIDEWALK; });
    }
  }
  for (const e of map.edges) {
    rasterizePolyline(e.pts, () => e.width / 2, CELL, N, (x, z) => { tiles[z * N + x] = roadTile(e.type, x, z); });
  }
  for (const n of map.nodes) {
    const type = Math.min(...n.edges.map((id) => map.edges[id].type));
    if (n.roundabout) {
      const ring: Vec2[] = [];
      for (let k = 0; k < 32; k++) ring.push([n.x + Math.cos((k / 32) * Math.PI * 2) * n.roundabout, n.z + Math.sin((k / 32) * Math.PI * 2) * n.roundabout]);
      rasterizePolygon(ring, CELL, N, (x, z) => { tiles[z * N + x] = roadTile(type, x, z); });
      const island = ring.map(([x, z]): Vec2 => [n.x + (x - n.x) * 0.5, n.z + (z - n.z) * 0.5]);
      rasterizePolygon(island, CELL, N, (x, z) => { tiles[z * N + x] = Tile.GRASS; });
    } else if (n.edges.length >= 2) {
      const poly = junctionOutline(map, n);
      if (poly.length > 2) rasterizePolygon(poly, CELL, N, (x, z) => { tiles[z * N + x] = roadTile(type, x, z); });
    }
  }

  // Gebäude (gedrehte Rechtecke)
  for (const b of map.buildings) {
    rasterizePolygon(orientedRect(b.x, b.z, b.w / 2, b.d / 2, b.rot), CELL, N, (x, z) => { tiles[z * N + x] = Tile.BUILDING; });
  }
}

/** Fahrbahnen quer eben machen und Dämme über den Sumpf anheben. */
function flattenAlongRoads(map: WorldMap) {
  const h = map.heights;
  for (const e of map.edges) {
    const r = e.width / 2 + e.sidewalk + 3;
    for (let s = 0; s <= e.len; s += HEIGHT_STEP) {
      const p = pointAt(e.pts, e.cum, s);
      if (map.groundAt(p.x, p.z) === Tile.WATER) continue;
      const hc = Math.max(0.05, map.terrainHeight(p.x, p.z));
      const g0x = Math.max(0, Math.floor((p.x - r) / HEIGHT_STEP)), g1x = Math.min(HGRID - 1, Math.ceil((p.x + r) / HEIGHT_STEP));
      const g0z = Math.max(0, Math.floor((p.z - r) / HEIGHT_STEP)), g1z = Math.min(HGRID - 1, Math.ceil((p.z + r) / HEIGHT_STEP));
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const d = Math.hypot(gx * HEIGHT_STEP - p.x, gz * HEIGHT_STEP - p.z);
          if (d > r) continue;
          const i = gz * HGRID + gx;
          const cx = Math.min(N - 1, Math.floor((gx * HEIGHT_STEP) / CELL)), cz = Math.min(N - 1, Math.floor((gz * HEIGHT_STEP) / CELL));
          if (map.ground[cz * N + cx] === Tile.WATER) continue;
          h[i] = d < r - 3 ? hc : h[i] + (hc - h[i]) * 0.5;
        }
      }
    }
  }
}

// ------------------------------------------------------------------ Chunks
function buildChunks(map: WorldMap) {
  const C = WORLD_SIZE / CHUNK;
  map.chunks = Array.from({ length: C * C }, (): ChunkContent => ({ edges: [], nodes: [], buildings: [], lots: [] }));
  const idx = (x: number, z: number) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    return cx < 0 || cz < 0 || cx >= C || cz >= C ? -1 : cz * C + cx;
  };
  const add = (list: keyof ChunkContent, x: number, z: number, id: number) => {
    const i = idx(x, z);
    if (i >= 0 && !map.chunks[i][list].includes(id)) map.chunks[i][list].push(id);
  };
  for (const e of map.edges) for (const p of e.pts) add('edges', p[0], p[1], e.id);
  for (const n of map.nodes) add('nodes', n.x, n.z, n.id);
  map.buildings.forEach((b, i) => { for (const p of orientedRect(b.x, b.z, b.w / 2, b.d / 2, b.rot)) add('buildings', p[0], p[1], i); });
  for (const l of map.lots) { const c = centroid(l.poly); add('lots', c[0], c[1], l.id); }
}

// ------------------------------------------------------------------ Spawns
/** Nächste Zelle, auf der man stehen kann. */
function walkable(map: WorldMap, x: number, z: number, ok: number[]): Vec2 {
  for (let r = 0; r < 60; r += 2) {
    for (let k = 0; k < Math.max(1, r * 2); k++) {
      const a = (k / Math.max(1, r * 2)) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok.includes(map.tileAt(px, pz))) return [px, pz];
    }
  }
  return [x, z];
}

function placeSpawns(map: WorldMap, rnd: () => number) {
  const color = () => Math.floor(rnd() * VEHICLE_COLORS.length);
  const foot = [Tile.SIDEWALK, Tile.PLAZA, Tile.GRASS, Tile.SAND, Tile.DOCK];

  // Spawn: Park in Downtown, nahe dem Zentrum
  const downtown = map.districts.find((d) => d.name === POI.spawnDistrict);
  const parks = map.lots.filter((l) => l.use === LotUse.Park && l.district === downtown?.id);
  const core = downtown ? centroid(downtown.poly) : [1340, 1000];
  parks.sort((a, b) => {
    const ca = centroid(a.poly), cb = centroid(b.poly);
    return Math.hypot(ca[0] - core[0], ca[1] - core[1]) - Math.hypot(cb[0] - core[0], cb[1] - core[1]);
  });
  const sp = parks.length ? centroid(parks[0].poly) : core;
  const [sx, sz] = walkable(map, sp[0], sp[1], foot);
  map.spawn = { x: sx, z: sz };
  const [qx, qz] = walkable(map, POI.questStart[0], POI.questStart[1], [Tile.PLAZA, Tile.SIDEWALK, Tile.DOCK]);
  map.questStart = { x: qx, z: qz };
  const [dx, dz] = walkable(map, POI.questDest[0], POI.questDest[1], [Tile.DIRT, Tile.PLAZA, Tile.GRASS]);
  map.questDest = { x: dx, z: dz };

  // Parkende Autos am Straßenrand (innerorts). Die Dichte skaliert die Anzahl der
  // Parklücken (Abstand) und die Obergrenze – nicht die Belegungswahrscheinlichkeit.
  let parked = 0;
  const parkedMax = Math.round(55 * NPC_DENSITY);
  for (const e of map.edges) {
    if (e.sidewalk <= 0 || e.type === RoadType.Highway || parked > parkedMax) continue;
    for (let s = e.trimA + 10; s < e.len - e.trimB - 10; s += (24 + rnd() * 30) / NPC_DENSITY) {
      if (rnd() > 0.28) continue;
      const fwd = rnd() < 0.5;
      const p = pointAt(e.pts, e.cum, s);
      const dir = fwd ? 1 : -1;
      const off = e.width / 2 - 1.3;
      const x = p.x - p.dz * off * dir, z = p.z + p.dx * off * dir; // rechts in Fahrtrichtung
      if (map.tileAt(x, z) !== Tile.ROAD) continue;
      map.vehicleSpawns.push({ kind: rnd() < 0.18 ? VehicleKind.Bike : VehicleKind.Car, x, z, a: Math.atan2(p.dx * dir, p.dz * dir), color: color() });
      parked++;
    }
  }
  // Parkplätze: mehr Stellplätze, begrenzt durch die Länge der Stellplatzreihe (3,4 m Raster)
  for (const l of map.lots) {
    if (l.use !== LotUse.Parking && l.use !== LotUse.Gas) continue;
    const c = centroid(l.poly);
    const a = l.poly[0], b = l.poly[1];
    const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
    const capacity = Math.floor(rowLength(l.poly, c, ang) / PARK_PITCH);
    const base = l.use === LotUse.Gas ? 1 : Math.min(3, Math.floor(Math.abs(polygonArea(l.poly)) / 500));
    const count = Math.min(capacity, Math.round(base * NPC_DENSITY));
    for (let k = 0; k < count; k++) {
      const x = c[0] + (k - (count - 1) / 2) * PARK_PITCH * Math.cos(ang), z = c[1] - (k - (count - 1) / 2) * PARK_PITCH * Math.sin(ang);
      if (map.tileAt(x, z) === Tile.PLAZA) map.vehicleSpawns.push({ kind: VehicleKind.Car, x, z, a: ang, color: color() });
    }
  }
  // Boote an Stegen
  for (const e of map.edges) {
    if (e.type !== RoadType.Pier) continue;
    const p = pointAt(e.pts, e.cum, e.len - 3);
    for (const side of [-1, 1]) {
      const x = p.x - p.dz * 6 * side, z = p.z + p.dx * 6 * side;
      const t = map.tileAt(x, z);
      if ((t === Tile.WATER || t === Tile.SWAMP) && rnd() < 0.8) {
        map.vehicleSpawns.push({ kind: e.name === 'Airboat-Anleger' ? VehicleKind.Airboat : VehicleKind.Boat, x, z, a: Math.atan2(p.dx, p.dz), color: color() });
      }
    }
  }
  for (const [x, z] of POI.airboats) {
    const [ax, az] = walkable(map, x, z, [Tile.SWAMP, Tile.WATER]);
    map.vehicleSpawns.push({ kind: VehicleKind.Airboat, x: ax, z: az, a: rnd() * Math.PI * 2, color: color() });
  }
  // Autos auf den Höfen außerhalb der Viertel: die Dichte erhöht den Erwartungswert
  // je Hof (vorher 25 %), die Autos stehen nebeneinander im Stellplatzraster.
  for (const l of map.lots) {
    if (l.block >= 0 || l.building < 0) continue;
    const b = map.buildings[l.building];
    const expected = 0.25 * NPC_DENSITY;
    const tries = Math.floor(expected) + (rnd() < expected % 1 ? 1 : 0);
    for (let k = 0; k < tries; k++) {
      const off = (k - (tries - 1) / 2) * PARK_PITCH;
      const x = b.x + Math.sin(b.rot) * (b.d / 2 + 3.5) + Math.sin(b.rot + Math.PI / 2) * off;
      const z = b.z + Math.cos(b.rot) * (b.d / 2 + 3.5) + Math.cos(b.rot + Math.PI / 2) * off;
      const t = map.tileAt(x, z);
      if (t === Tile.GRASS || t === Tile.DIRT || t === Tile.DESERT || t === Tile.PLAZA) {
        map.vehicleSpawns.push({ kind: rnd() < 0.3 ? VehicleKind.Bike : VehicleKind.Car, x, z, a: b.rot + Math.PI / 2, color: color() });
      }
    }
  }
}

/** Stellplatzraster (Mittelpunktabstand quer geparkter Autos) in Metern. */
const PARK_PITCH = 3.4;

/** Länge des Parkplatzes entlang der Stellplatzreihe (die längste Ausdehnung). */
function rowLength(poly: Vec2[], c: Vec2, ang: number): number {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of poly) {
    const t = (x - c[0]) * Math.cos(ang) - (z - c[1]) * Math.sin(ang);
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  return hi - lo;
}
