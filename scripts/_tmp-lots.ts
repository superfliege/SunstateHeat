// Temporäres Analyse-Skript: Größe der Park-/Tank-Plätze und der Hof-Grundstücke.
import { MAP_SEED } from '../shared/src/constants';
import { centroid, pointAt } from '../shared/src/world/geometry';
import { generateWorld } from '../shared/src/world/mapgen';
import { LotUse } from '../shared/src/world/WorldMap';

const map = generateWorld(MAP_SEED);
const lots = map.lots.filter((l) => l.use === LotUse.Parking || l.use === LotUse.Gas);
for (const l of lots) {
  const c = centroid(l.poly);
  const a = l.poly[0], b = l.poly[1];
  const ang = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
  // Ausdehnung des Polygons entlang ang (die Reihe, in der die Autos stehen)
  let lo = Infinity, hi = -Infinity, loP = Infinity, hiP = -Infinity;
  for (const [x, z] of l.poly) {
    const t = (x - c[0]) * Math.cos(ang) - (z - c[1]) * Math.sin(ang);
    const u = (x - c[0]) * Math.sin(ang) + (z - c[1]) * Math.cos(ang);
    lo = Math.min(lo, t); hi = Math.max(hi, t);
    loP = Math.min(loP, u); hiP = Math.max(hiP, u);
  }
  console.log(
    `${l.use === LotUse.Gas ? 'Tank' : 'Park'}  Fläche ${Math.round(area(l.poly))} m²  ` +
    `Reihe ${(hi - lo).toFixed(1)} m  Tiefe ${(hiP - loP).toFixed(1)} m  count(3.4m)=${Math.min(3, Math.floor(area(l.poly) / 500))}`,
  );
}

const rural = map.lots.filter((l) => l.block < 0 && l.building >= 0 && check(map, l));
function check(m: typeof map, l: (typeof map.lots)[number]) {
  const b = m.buildings[l.building];
  const x = b.x + Math.sin(b.rot) * (b.d / 2 + 3.5), z = b.z + Math.cos(b.rot) * (b.d / 2 + 3.5);
  const t = m.tileAt(x, z);
  return t === 5 || t === 6 || t === 7 || t === 17; // GRASS/DIRT/DESERT/PLAZA – nur grobe Zählung
}
console.log('ländliche Hof-Kandidaten (grob):', rural.length);

function area(poly: [number, number][]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return Math.abs(a / 2);
}
