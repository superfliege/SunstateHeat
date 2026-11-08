// Vegetation per Poisson-Disk-Verteilung (Bridson) statt Raster: gleichmäßig-zufällige
// Abstände, Dichte je Biom. Palmen säumen Küstenstraßen in unregelmäßigen Abständen.
// Nur für die Darstellung – der Server braucht keine Bäume.
import { WORLD_SIZE } from '../constants';
import { makeValueNoise, mulberry32 } from '../math';
import { pointAt } from './geometry';
import { Tile } from './tiles';
import { LotUse, TreeType, Zone, type TreeDef, type WorldMap } from './WorldMap';
import { pointInPolygon } from './geometry';

/** Bridson-Poisson-Disk auf einem Rechteck; liefert Punkte mit Mindestabstand r. */
export function poissonDisk(x0: number, z0: number, w: number, h: number, r: number, rnd: () => number, k = 20): [number, number][] {
  const cs = r / Math.SQRT2;
  const gw = Math.ceil(w / cs), gh = Math.ceil(h / cs);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: [number, number][] = [];
  const active: number[] = [];
  const put = (x: number, z: number) => {
    pts.push([x, z]);
    active.push(pts.length - 1);
    grid[Math.floor((z - z0) / cs) * gw + Math.floor((x - x0) / cs)] = pts.length - 1;
  };
  put(x0 + rnd() * w, z0 + rnd() * h);
  while (active.length) {
    const ai = Math.floor(rnd() * active.length);
    const [px, pz] = pts[active[ai]];
    let found = false;
    for (let t = 0; t < k; t++) {
      const ang = rnd() * Math.PI * 2, rad = r * (1 + rnd());
      const x = px + Math.cos(ang) * rad, z = pz + Math.sin(ang) * rad;
      if (x < x0 || z < z0 || x >= x0 + w || z >= z0 + h) continue;
      const gx = Math.floor((x - x0) / cs), gz = Math.floor((z - z0) / cs);
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nz < 0 || nx >= gw || nz >= gh) continue;
          const j = grid[nz * gw + nx];
          if (j >= 0 && (pts[j][0] - x) ** 2 + (pts[j][1] - z) ** 2 < r * r) { ok = false; break; }
        }
      }
      if (ok) { put(x, z); found = true; break; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

export function generateVegetation(map: WorldMap, seed: number): TreeDef[] {
  const rnd = mulberry32(seed + 404);
  const noise = makeValueNoise(seed + 405);
  const trees: TreeDef[] = [];
  const add = (x: number, z: number, type: number, s = 0.8 + rnd() * 0.5) => {
    const rot = rnd() * Math.PI * 2;
    // Freiflächen (Testgelände, Rampen) bleiben baumfrei
    for (const a of map.clearAreas) if (x >= a[0] && x <= a[2] && z >= a[1] && z <= a[3]) return;
    trees.push({ x, z, type, s, rot });
  };
  /** Nicht auf oder direkt neben Straßen, Gebäuden, Stegen. */
  const clear = (x: number, z: number, r: number) => {
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const t = map.tileAt(x + dx, z + dz);
      if (t === Tile.ROAD || t === Tile.SIDEWALK || t === Tile.BUILDING || t === Tile.BRIDGE || t === Tile.DOCK || t === Tile.VOID) return false;
    }
    return true;
  };
  const parks = map.lots.filter((l) => l.use === LotUse.Park || l.use === LotUse.Vacant);

  for (const [x, z] of poissonDisk(0, 0, WORLD_SIZE, WORLD_SIZE, 7.5, rnd)) {
    const t = map.tileAt(x, z);
    if (t === Tile.WATER || t === Tile.ROCK) continue;
    const zone = map.zoneAt(x, z);
    const forest = noise(x * 0.006, z * 0.006) * 0.75 + noise(x * 0.03 + 9, z * 0.03) * 0.25;
    const r = rnd();
    let type = -1;
    switch (t) {
      case Tile.FARM: if (r < 0.75) type = TreeType.Orange; break;
      case Tile.DESERT: if (r < 0.02) type = TreeType.Palm; break;
      case Tile.BADLANDS: if (r < 0.03) type = TreeType.Pine; break;
      case Tile.SWAMP: if (r < (zone === Zone.GatorFlats ? 0.16 : 0.3)) type = TreeType.Mangrove; break;
      case Tile.SAND: if (r < (zone === Zone.CoralKeys ? 0.22 : 0.07)) type = TreeType.Palm; break;
      case Tile.GRASS: {
        if (zone === Zone.PortCoralia) { if (r < 0.12) type = TreeType.Palm; break; }
        if (zone === Zone.CoralKeys) { if (r < 0.35) type = TreeType.Palm; break; }
        if (zone === Zone.GatorFlats) { if (r < 0.32) type = rnd() < 0.7 ? TreeType.Cypress : TreeType.Mangrove; break; }
        // Wälder: dicht in Waldflecken, sonst locker
        const p = forest > 0.52 ? 0.9 : forest > 0.42 ? 0.45 : zone === Zone.DryPine || zone === Zone.Highlands ? 0.14 : 0.05;
        if (r < p) type = zone === Zone.DryPine && rnd() < 0.3 ? TreeType.Cypress : TreeType.Pine;
        break;
      }
      case Tile.DIRT: if (r < 0.04) type = TreeType.Pine; break;
      case Tile.FIELD: break;
      case Tile.PLAZA: {
        // Parks und Brachen in den Städten
        if (r < 0.5 && parks.some((l) => pointInPolygon(x, z, l.poly))) type = zone === Zone.DryPine ? TreeType.Pine : TreeType.Palm;
        break;
      }
    }
    if (type < 0 || !clear(x, z, 2.5)) continue;
    add(x, z, type);
  }

  // Palmen entlang der Küstenstraßen in unregelmäßigen Abständen, beidseitig versetzt
  for (const e of map.edges) {
    if (!e.palms) continue;
    for (const side of [-1, 1]) {
      for (let s = 6 + rnd() * 10; s < e.len - 4; s += 9 + rnd() * 16) {
        if (rnd() < 0.18) s += 20; // gelegentliche Lücken
        const p = pointAt(e.pts, e.cum, s);
        const off = (e.width / 2 + e.sidewalk + 1.6 + rnd() * 1.5) * side;
        const x = p.x - p.dz * off, z = p.z + p.dx * off;
        const t = map.tileAt(x, z);
        if (t === Tile.WATER || t === Tile.BRIDGE || t === Tile.BUILDING || t === Tile.ROAD) continue;
        add(x, z, TreeType.Palm, 0.9 + rnd() * 0.4);
      }
    }
  }
  return trees;
}
