// Temporäres Analyse-Skript: prüft, wie viele geparkte Fahrzeuge die Kartengenerierung hergibt.
import { MAP_SEED } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { LotUse, RoadType } from '../shared/src/world/WorldMap';

const map = generateWorld(MAP_SEED);

// Straßenrand: Kandidaten ohne Kappung zählen
let candidates = 0, roadLen = 0;
for (const e of map.edges) {
  if (e.sidewalk <= 0 || e.type === RoadType.Highway) continue;
  roadLen += e.len;
  for (let s = e.trimA + 10; s < e.len - e.trimB - 10; s += 24 + 0.5 * 30) candidates += 0.28;
}
console.log('Straßenrand-Kandidaten (ohne Cap):', Math.round(candidates), 'Straßenlänge(m):', Math.round(roadLen));

// Parkplätze
const lots = map.lots.filter((l) => l.use === LotUse.Parking || l.use === LotUse.Gas);
let spaces = 0;
for (const l of lots) {
  const count = l.use === LotUse.Gas ? 1 : Math.min(3, Math.floor(Math.abs(area(l.poly)) / 500));
  spaces += count;
}
console.log('Park-/Tank-Plätze:', lots.length, '=> Stellplätze:', spaces);
console.log('Parkplätze mit area/500 > 3:', lots.filter((l) => l.use !== LotUse.Gas && Math.abs(area(l.poly)) / 500 > 3).length);
console.log('max area/500:', Math.max(...lots.filter((l) => l.use !== LotUse.Gas).map((l) => Math.round(Math.abs(area(l.poly)) / 500))));

// Höfe außerhalb der Viertel
const rural = map.lots.filter((l) => l.block < 0 && l.building >= 0).length;
console.log('Hof-Kandidaten (ländlich):', rural, '=> erwartete Autos:', Math.round(rural * 0.25));

function area(poly: [number, number][]) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return a / 2;
}
