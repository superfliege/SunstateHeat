// Gelände: Land und Wasser als ausgefranste Polygone, Flüsse, Sumpf, Strände, Biome,
// Zonen und das Höhenfeld. Alles wird auf das CELL-Raster der WorldMap gerastert.
import { CELL, GRID_SIZE, HEIGHT_STEP, WORLD_SIZE, ZONE_RES } from '../constants';
import { makeValueNoise } from '../math';
import {
  bufferPolyline, catmullRom, fray, pointInPolygon, rasterizePolygon, rasterizePolyline, superellipse, type Poly,
} from './geometry';
import { CALM_COAST, COAST, DISTRICTS, HILLS, ISLANDS, LAKES, RIVERS, SPIT, ZONE_SEEDS } from './palmara';
import { Tile } from './tiles';
import { Zone, type WorldMap } from './WorldMap';

const N = GRID_SIZE;
const HGRID = WORLD_SIZE / HEIGHT_STEP + 1;

export interface TerrainInfo {
  /** Ausgefranste Landpolygone (für Debug-Overlay und Strände). */
  land: { name: string; poly: Poly }[];
  water: { name: string; poly: Poly }[];
  /** Entfernung jeder Zelle zum nächsten Wasser (Meter, Land) bzw. zum nächsten Land (Wasser). */
  distWater: Float32Array;
  distLand: Float32Array;
  /** Höhe der Berge je Höhen-Gitterpunkt (für Fels). */
  mountain: (x: number, z: number) => number;
}

/** Zwei-Pass-Chamfer-Distanz (Meter) zu allen Zellen, für die `isSource` gilt. */
function distanceField(src: (i: number) => boolean): Float32Array {
  const d = new Float32Array(N * N);
  const INF = 1e9;
  for (let i = 0; i < N * N; i++) d[i] = src(i) ? 0 : INF;
  const a = CELL, b = CELL * Math.SQRT2;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (z > 0) {
        v = Math.min(v, d[i - N] + a);
        if (x > 0) v = Math.min(v, d[i - N - 1] + b);
        if (x < N - 1) v = Math.min(v, d[i - N + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let z = N - 1; z >= 0; z--) {
    for (let x = N - 1; x >= 0; x--) {
      const i = z * N + x;
      let v = d[i];
      if (x < N - 1) v = Math.min(v, d[i + 1] + a);
      if (z < N - 1) {
        v = Math.min(v, d[i + N] + a);
        if (x < N - 1) v = Math.min(v, d[i + N + 1] + b);
        if (x > 0) v = Math.min(v, d[i + N - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

const ZN = WORLD_SIZE / ZONE_RES;

/** Box-Blur auf dem Zonenraster (gegen harte Kanten an Zonengrenzen). */
function blur(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let z = 0; z < ZN; z++) for (let x = 0; x < ZN; x++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < ZN) { s += src[z * ZN + xx]; c++; } }
    tmp[z * ZN + x] = s / c;
  }
  for (let z = 0; z < ZN; z++) for (let x = 0; x < ZN; x++) {
    let s = 0, c = 0;
    for (let k = -r; k <= r; k++) { const zz = z + k; if (zz >= 0 && zz < ZN) { s += tmp[zz * ZN + x]; c++; } }
    out[z * ZN + x] = s / c;
  }
  return out;
}

export function buildTerrain(map: WorldMap, seed: number): TerrainInfo {
  const noise = makeValueNoise(seed + 7);
  const noise2 = makeValueNoise(seed + 99);
  const tiles = map.tiles;
  const set = (cx: number, cz: number, t: number) => { tiles[cz * N + cx] = t; };
  const at = (cx: number, cz: number) => tiles[cz * N + cx];
  const land: TerrainInfo['land'] = [], water: TerrainInfo['water'] = [];

  // ---------------------------------------------------------------- Zonen (Voronoi + Viertel)
  for (let z = 0; z < ZN; z++) {
    for (let x = 0; x < ZN; x++) {
      const px = (x + 0.5) * ZONE_RES, pz = (z + 0.5) * ZONE_RES;
      // leicht verrauschte Grenzen
      const jx = px + (noise(px * 0.01, pz * 0.01) - 0.5) * 80, jz = pz + (noise(px * 0.01 + 50, pz * 0.01) - 0.5) * 80;
      let best = 0, bestD = Infinity;
      for (const [sx, sz, zone] of ZONE_SEEDS) {
        const d = (sx - jx) ** 2 + (sz - jz) ** 2;
        if (d < bestD) { bestD = d; best = zone; }
      }
      map.zones[z * ZN + x] = best;
    }
  }
  for (const d of DISTRICTS) {
    rasterizePolygon(d.poly, ZONE_RES, ZN, (x, z) => { map.zones[z * ZN + x] = d.zone; });
  }

  // ---------------------------------------------------------------- Land
  const calm = (x: number, z: number) => {
    const c = CALM_COAST;
    const inside = x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
    return inside ? 6 : 34;
  };
  // zwei Ausfransungen: große Buchten und Landzungen, darüber kleine Einschnitte
  const coast = fray(fray(COAST, calm, 150, noise), (x, z) => calm(x, z) * 0.22, 34, noise2);
  land.push({ name: 'Palmara', poly: coast });
  for (const [name, cx, cz, rx, rz, pow, rot] of ISLANDS) {
    const base = superellipse(cx, cz, rx, rz, pow, 40, (rot * Math.PI) / 180);
    const amp = name === 'Ocean Strip' || name === 'Hafeninsel' ? 3 : Math.min(rx, rz) * 0.18;
    land.push({ name, poly: fray(base, amp, Math.max(24, Math.min(rx, rz) * 0.8), noise2) });
  }
  const spitLine = catmullRom(SPIT.pts, 8);
  const spit = bufferPolyline(spitLine, (i) => SPIT.width * (0.7 + noise(i * 0.15, 3) * 0.6));
  land.push({ name: 'Nehrung', poly: fray(spit, 4, 40, noise2) });
  for (const l of land) rasterizePolygon(l.poly, CELL, N, (x, z) => set(x, z, Tile.GRASS));

  // ---------------------------------------------------------------- Seen, Buchten, Flüsse
  for (const l of LAKES) {
    const poly = fray(l.poly, l.amp, l.wave, noise2);
    water.push({ name: l.name, poly });
    rasterizePolygon(poly, CELL, N, (x, z) => set(x, z, Tile.WATER));
  }
  for (const r of RIVERS) {
    const line = catmullRom(r.pts, 6);
    // Breite schwankt leicht, Ufer bleiben unregelmäßig
    rasterizePolyline(line, (i) => (r.width / 2) * (0.8 + noise2(i * 0.2, 7) * 0.5), CELL, N, (x, z) => set(x, z, Tile.WATER));
    water.push({ name: r.name, poly: bufferPolyline(line, () => r.width) });
  }

  // Mangroven-Inselchen vor der Südküste und flache Sumpfzonen im Wasser
  for (let z = Math.floor(1560 / CELL); z < Math.floor(1790 / CELL); z++) {
    for (let x = Math.floor(700 / CELL); x < Math.floor(1290 / CELL); x++) {
      if (at(x, z) !== Tile.WATER) continue;
      const v = noise2(x * 0.06 + 70, z * 0.06) * 0.7 + noise2(x * 0.2, z * 0.2 + 5) * 0.3;
      if (v > 0.66) set(x, z, Tile.SWAMP);
    }
  }

  // ---------------------------------------------------------------- Berge
  const mountain = (x: number, z: number) => {
    let h = 0;
    for (const [hx, hz, r, peak] of HILLS) {
      // Domain-Warp, damit die Bergfüße nicht kreisrund sind
      const wx = x + (noise(x * 0.012 + 70, z * 0.012) - 0.5) * r * 0.9, wz = z + (noise(x * 0.012, z * 0.012 + 70) - 0.5) * r * 0.9;
      const d = Math.hypot(wx - hx, wz - hz) / (r * 1.6);
      if (d < 1) h = Math.max(h, peak * Math.pow(1 - d, 1.6));
    }
    return h * (0.8 + noise(x * 0.02 + 300, z * 0.02) * 0.4);
  };

  // ---------------------------------------------------------------- Sumpf in Gator Flats
  const gatorRaw = new Float32Array(ZN * ZN);
  for (let i = 0; i < ZN * ZN; i++) gatorRaw[i] = map.zones[i] === Zone.GatorFlats ? 1 : 0;
  const gator = blur(blur(gatorRaw, 5), 5);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (at(x, z) !== Tile.GRASS) continue;
      const px = (x + 0.5) * CELL, pz = (z + 0.5) * CELL;
      const g = gator[Math.min(ZN - 1, Math.floor(pz / ZONE_RES)) * ZN + Math.min(ZN - 1, Math.floor(px / ZONE_RES))];
      if (g < 0.05) continue;
      // flache Wasserflächen mit Grasinseln
      const v = noise(px * 0.012, pz * 0.012) * 0.6 + noise2(px * 0.04, pz * 0.04) * 0.4;
      // zum Zonenrand hin weniger Sumpf -> organische Grenze statt Zellkanten
      if (v < 0.56 - (1 - g) * 0.7) set(x, z, Tile.SWAMP);
    }
  }

  // ---------------------------------------------------------------- Distanzen, Strände
  const isWater = (i: number) => tiles[i] === Tile.WATER;
  const distWater = distanceField(isWater);
  const distLand = distanceField((i) => !isWater(i) && tiles[i] !== Tile.SWAMP);
  const oceanStrip = land.find((l) => l.name === 'Ocean Strip')!.poly;
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (tiles[i] !== Tile.GRASS) continue;
      const px = (x + 0.5) * CELL, pz = (z + 0.5) * CELL;
      if (map.zoneAt(px, pz) === Zone.GatorFlats) continue;
      let width = 5 + noise(px * 0.03, pz * 0.03) * 12;
      // Ocean Strip: breiter Badestrand auf der Meerseite
      if (px > 1606 + (noise(px * 0.05, pz * 0.05) - 0.5) * 8 && pointInPolygon(px, pz, oceanStrip)) width = 999;
      if (distWater[i] < width) tiles[i] = Tile.SAND;
    }
  }

  // ---------------------------------------------------------------- Biome
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (tiles[i] !== Tile.GRASS) continue;
      const px = (x + 0.5) * CELL, pz = (z + 0.5) * CELL;
      const n1 = noise(px * 0.008 + 500, pz * 0.008), n2 = noise2(px * 0.02, pz * 0.02);
      const zone = map.zoneAt(px, pz);
      if (mountain(px, pz) > 7.5) { tiles[i] = Tile.ROCK; continue; }
      // Ödland an der Nordküste (abseits des Gipfels) und im Westen
      if (pz < 330 + (n2 - 0.5) * 140 && Math.hypot(px - 880, pz - 224) > 150 && n1 > 0.42) { tiles[i] = Tile.BADLANDS; continue; }
      if (Math.hypot((px - 624) / 90, (pz - 1120) / 80) + (n2 - 0.5) * 0.6 < 1) { tiles[i] = Tile.BADLANDS; continue; }
      // Wüste: um Port Sabal, Küstenstreifen nördlich der Stadt, Ebene am Flughafen
      if (Math.hypot((px - 544) / 110, (pz - 560) / 84) + (n2 - 0.5) * 0.7 < 1) { tiles[i] = Tile.DESERT; continue; }
      if (Math.hypot((px - 1360) / 60, (pz - 600) / 150) + (n2 - 0.5) * 0.7 < 1) { tiles[i] = Tile.DESERT; continue; }
      if (pointInPolygon(px + (n2 - 0.5) * 40, pz, [[930, 1360], [1180, 1130], [1180, 1360]])) { tiles[i] = Tile.DESERT; continue; }
      // Zuckerrohrfelder um Cane Ridge, Orangenplantagen in Dry Pine (leicht gedrehte, unregelmäßige Felder)
      if (zone === Zone.CaneRidge || zone === Zone.PortSabal || zone === Zone.DryPine) {
        const fx = Math.floor((px * 0.94 + pz * 0.34) / 90), fz = Math.floor((pz * 0.94 - px * 0.34) / 70);
        const field = noise2(fx * 1.7 + 0.5, fz * 1.3 + 0.5);
        const farmland = noise(px * 0.004 + 40, pz * 0.004) > 0.5;
        if (farmland && field > 0.68) { tiles[i] = zone === Zone.DryPine ? Tile.FARM : Tile.FIELD; continue; }
      }
      if (zone === Zone.DryPine && noise(px * 0.02 + 100, pz * 0.02) > 0.78) tiles[i] = Tile.DIRT;
    }
  }
  map.ground.set(tiles);

  // ---------------------------------------------------------------- Höhenfeld
  // Hügel-Amplitude je Zone, weich überblendet; in Vierteln flach.
  const ampOf = (zone: number) =>
    zone === Zone.DryPine ? 3.2 : zone === Zone.Highlands ? 4 : zone === Zone.CaneRidge ? 1.4
      : zone === Zone.PortSabal ? 1 : zone === Zone.CoralKeys ? 0.4 : zone === Zone.GatorFlats ? 0.2 : 0.3;
  const ZA = new Float32Array(ZN * ZN);
  for (let i = 0; i < ZN * ZN; i++) ZA[i] = ampOf(map.zones[i]);
  for (const d of DISTRICTS) rasterizePolygon(d.poly, ZONE_RES, ZN, (x, z) => { ZA[z * ZN + x] = 0; });
  const amp = blur(blur(ZA, 4), 4);
  const ampAt = (x: number, z: number) => {
    const ix = Math.min(ZN - 1, Math.max(0, Math.floor(x / ZONE_RES))), iz = Math.min(ZN - 1, Math.max(0, Math.floor(z / ZONE_RES)));
    return amp[iz * ZN + ix];
  };

  for (let gz = 0; gz < HGRID; gz++) {
    for (let gx = 0; gx < HGRID; gx++) {
      const px = gx * HEIGHT_STEP, pz = gz * HEIGHT_STEP;
      const cx = Math.min(N - 1, Math.floor(px / CELL)), cz = Math.min(N - 1, Math.floor(pz / CELL));
      const i = cz * N + cx;
      const t = tiles[i];
      let h: number;
      if (t === Tile.WATER) {
        h = -1.6 - smooth(distLand[i] / 60) * 2.2;
      } else if (t === Tile.SWAMP) {
        h = -0.7;
      } else {
        const rolling = (noise(px * 0.006 + 11, pz * 0.006) - 0.5) * 2 + (noise2(px * 0.017, pz * 0.017) - 0.5) * 0.7;
        const shore = smooth(distWater[i] / 50);
        h = (rolling * ampAt(px, pz) + mountain(px, pz)) * shore;
        if (distWater[i] < 4) h = Math.min(h, -0.12); // flacher Übergang ins Wasser
        if (t === Tile.SAND) h = Math.min(h, 0.2 + distWater[i] * 0.01);
      }
      map.heights[gz * HGRID + gx] = h;
    }
  }

  return { land, water, distWater, distLand, mountain };
}
