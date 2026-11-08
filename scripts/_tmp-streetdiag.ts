// Temporär: diagnostiziert die Straßenrand-Parkspawns (Versuche, RNG-Treffer, Tile-Ablehnungen).
import { MAP_SEED } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { RoadType } from '../shared/src/world/WorldMap';
import { Tile } from '../shared/src/world/tiles';

const map = generateWorld(MAP_SEED);

// Deterministischer RNG wie in mapgen (nur zur Nachbildung der Trefferquote)
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const DENSITY of [1, 5]) {
  const rnd = mulberry32(MAP_SEED);
  let iterations = 0, accepted = 0, rejectedTile = 0, parked = 0;
  const parkedMax = Math.round(55 * DENSITY);
  for (const e of map.edges) {
    if (e.sidewalk <= 0 || e.type === RoadType.Highway || parked > parkedMax) continue;
    for (let s = e.trimA + 10; s < e.len - e.trimB - 10; s += (24 + rnd() * 30) / DENSITY) {
      iterations++;
      if (rnd() > 0.28) continue;
      accepted++;
      const fwd = rnd() < 0.5;
      const p = { x: 0, z: 0, dx: 0, dz: 0 };
      // Position nachbilden
      const pts = e.pts, cum = e.cum;
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      p.x = ax + (bx - ax) * t; p.z = az + (bz - az) * t;
      const len = Math.hypot(bx - ax, bz - az) || 1;
      p.dx = (bx - ax) / len; p.dz = (bz - az) / len;
      const dir = fwd ? 1 : -1;
      const off = e.width / 2 - 1.3;
      const x = p.x - p.dz * off * dir, z = p.z + p.dx * off * dir;
      if (map.tileAt(x, z) !== Tile.ROAD) { rejectedTile++; continue; }
      parked++;
    }
  }
  console.log(`DENSITY=${DENSITY}: Versuche=${iterations} RNG-Treffer=${accepted} Tile-Ablehnung=${rejectedTile} gesetzt=${parked} (Cap ${parkedMax})`);
}
