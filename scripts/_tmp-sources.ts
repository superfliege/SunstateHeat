// Temporär: zählt die Fahrzeug-Spawns der Kartengenerierung je Quelle (Straßenrand/Parkplatz/Hof/Boot).
import { CELL, MAP_SEED, VEHICLE_COLORS, WORLD_SIZE } from '../shared/src/constants';
import { centroid, pointAt, polygonArea } from '../shared/src/world/geometry';
import { generateWorld } from '../shared/src/world/mapgen';
import { LotUse, RoadType } from '../shared/src/world/WorldMap';
import { Tile } from '../shared/src/world/tiles';
import { VehicleKind } from '../shared/src/sim/vehicleDefs';

const map = generateWorld(MAP_SEED);

// --- Straßenrand (wie in placeSpawns, aber mit Erwartungswert statt Zufall) ---
let street = 0;
for (const e of map.edges) {
  if (e.sidewalk <= 0 || e.type === RoadType.Highway) continue;
  let n = 0;
  for (let s = e.trimA + 10; s < e.len - e.trimB - 10; s += 24 + 15) n++;
  street += 0.28 * n;
}
console.log('Straßenrand (Erwartung, ohne Cap 55):', street.toFixed(1));

// --- Parkplätze / Tankstellen ---
let lotCars = 0, capacity = 0;
for (const l of map.lots) {
  if (l.use !== LotUse.Parking && l.use !== LotUse.Gas) continue;
  const c = centroid(l.poly);
  const a = l.poly[0], b = l.poly[1];
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of l.poly) {
    const t = (x - c[0]) * Math.cos(ang) - (z - c[1]) * Math.sin(ang);
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  lotCars += l.use === LotUse.Gas ? 1 : Math.min(3, Math.floor(Math.abs(polygonArea(l.poly)) / 500));
  capacity += Math.max(1, Math.floor((hi - lo) / 3.4));
}
console.log('Parkplatz/Tank:', lotCars, '· Stellplatz-Reihen-Kapazität:', capacity);

// --- Höfe außerhalb der Viertel ---
const foot = [Tile.GRASS, Tile.DIRT, Tile.DESERT, Tile.PLAZA];
let ruralCandidates = 0;
for (const l of map.lots) {
  if (l.block >= 0 || l.building < 0) continue;
  const b = map.buildings[l.building];
  const x = b.x + Math.sin(b.rot) * (b.d / 2 + 3.5), z = b.z + Math.cos(b.rot) * (b.d / 2 + 3.5);
  if (foot.includes(map.tileAt(x, z))) ruralCandidates++;
}
console.log('Hof-Kandidaten:', ruralCandidates, '=> erwartete Autos (25 %):', (ruralCandidates * 0.25).toFixed(1));

// --- Boote/Airboats (aus den Spawns ablesbar) ---
const boats = map.vehicleSpawns.filter((s) => s.kind === VehicleKind.Boat).length;
const airboats = map.vehicleSpawns.filter((s) => s.kind === VehicleKind.Airboat).length;
console.log('Boote:', boats, 'Airboats:', airboats, '=> Landfahrzeuge:', map.vehicleSpawns.length - boats - airboats);
console.log('Spawn-Zellen im Raster:', map.tiles.length, WORLD_SIZE / CELL);
