// Temporär: diagnostiziert je Parkplatz/Tankstelle Basis, Kapazität und tatsächlich gesetzte Autos.
import { MAP_SEED } from '../shared/src/constants';
import { centroid, polygonArea } from '../shared/src/world/geometry';
import { generateWorld } from '../shared/src/world/mapgen';
import { LotUse } from '../shared/src/world/WorldMap';
import { Tile } from '../shared/src/world/tiles';

const map = generateWorld(MAP_SEED);
const PARK_PITCH = 3.4;

function rowLength(poly: number[][], c: number[], ang: number): number {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of poly) {
    const t = (x - c[0]) * Math.cos(ang) - (z - c[1]) * Math.sin(ang);
    lo = Math.min(lo, t); hi = Math.max(hi, t);
  }
  return hi - lo;
}

let baseSum = 0, capSum = 0, plannedSum = 0;
const rows: string[] = [];
for (const l of map.lots) {
  if (l.use !== LotUse.Parking && l.use !== LotUse.Gas) continue;
  const c = centroid(l.poly);
  const a = l.poly[0], b = l.poly[1];
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
  const capacity = Math.floor(rowLength(l.poly as unknown as number[][], c, ang) / PARK_PITCH);
  const base = l.use === LotUse.Gas ? 1 : Math.min(3, Math.floor(Math.abs(polygonArea(l.poly)) / 500));
  const count = Math.min(capacity, Math.round(base * 5));
  baseSum += base; capSum += capacity; plannedSum += count;
  rows.push(`${l.use === LotUse.Gas ? 'Gas ' : 'Park'} area=${Math.abs(polygonArea(l.poly)).toFixed(0)} base=${base} cap=${capacity} count=${count}`);
}
console.log(rows.join('\n'));
console.log(`Summen: base=${baseSum} (x5=${baseSum * 5}) cap=${capSum} geplant=${plannedSum}`);

let onPlaza = 0, planned = 0;
for (const l of map.lots) {
  if (l.use !== LotUse.Parking && l.use !== LotUse.Gas) continue;
  const c = centroid(l.poly);
  const a = l.poly[0], b = l.poly[1];
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
  const capacity = Math.floor(rowLength(l.poly as unknown as number[][], c, ang) / PARK_PITCH);
  const base = l.use === LotUse.Gas ? 1 : Math.min(3, Math.floor(Math.abs(polygonArea(l.poly)) / 500));
  const count = Math.min(capacity, Math.round(base * 5));
  for (let k = 0; k < count; k++) {
    const x = c[0] + (k - (count - 1) / 2) * PARK_PITCH * Math.cos(ang);
    const z = c[1] - (k - (count - 1) / 2) * PARK_PITCH * Math.sin(ang);
    planned++;
    if (map.tileAt(x, z) === Tile.PLAZA) onPlaza++;
  }
}
console.log(`Punkte geplant=${planned} auf PLAZA=${onPlaza} (${((onPlaza / planned) * 100).toFixed(0)} %)`);
