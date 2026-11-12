// Baut die statische Welt aus den Vektordaten der Karte, aufgeteilt in Render-Chunks
// (RCHUNK x RCHUNK m), damit Frustum- und Distanz-Culling greifen. Pro Chunk wenige Draw-Calls:
//   Gelände (8 Untergrund-Schichten, weich überblendet), flache Flächen (Straßen, Gehwege,
//   Markierungen, Grundstücke), feste Geometrie (Gebäude, Props, Brücken – mit Umrisslinie),
//   Decals (Risse, Ölflecken, Gullys, Graffiti, Wandbilder, Sand, Muscheln), Neon, Laternen
//   und Pflanzen (instanziert je Variante, mit Wind).
// Alle Flächen nutzen den Material-Atlas (materials/library.ts).
import * as THREE from 'three';
import { CELL, GRID_SIZE, HEIGHT_STEP, WORLD_SIZE } from '../../../shared/src/constants';
import { makeValueNoise, mulberry32 } from '../../../shared/src/math';
import { centroid, orientedRect, pointAt, type Vec2 } from '../../../shared/src/world/geometry';
import { arms, type Arm } from '../../../shared/src/world/roads';
import { Tile, WATER_LEVEL } from '../../../shared/src/world/tiles';
import {
  BRIDGE_DECK, BuildingStyle, CURB_TOP, LotUse, RoadType, TreeType, Zone, type BuildingDef, type RoadEdge, type RoadNode, type TreeDef, type WorldMap,
} from '../../../shared/src/world/WorldMap';
import { buildAirportBuilding, buildAirportGround, type AirportCtx } from './AirportBuilder';
import { getModel, triangleColors, type BakedModel, type ModelName } from './assets';
import { GeoBuilder } from './GeoBuilder';
import { standaloneTexture } from './materials/atlas';
import { MATERIALS, matIndex } from './materials/library';
import { neonMaterial, surfaceMaterial } from './materials/surface';
import { STORE_CUT_H, storeWalls } from './StoresView';
import { LAYER, terrainMaterial, type TerrainLayer } from './materials/terrain';
import { addOutline, LINE } from './materials/toon';
import { buildWaterInfo, waterMaterial } from './materials/water';
import { MINIMAP_GROUND, palmaraize } from './palette';
import type { CoverKind } from './plants';
import { coverVariants, treeVariants, type PlantVariant } from './Vegetation';
import { PlantField, type PlantKind } from './PlantField';

/** Bodenfarben je Untergrund (Minimap). */
export const GROUND_COLORS: Record<number, number> = {
  [Tile.WATER]: MINIMAP_GROUND.water,
  [Tile.SAND]: MINIMAP_GROUND.sand,
  [Tile.GRASS]: MINIMAP_GROUND.grass,
  [Tile.ROAD]: MINIMAP_GROUND.road,
  [Tile.SIDEWALK]: MINIMAP_GROUND.sidewalk,
  [Tile.BUILDING]: MINIMAP_GROUND.building,
  [Tile.SWAMP]: MINIMAP_GROUND.swamp,
  [Tile.DOCK]: MINIMAP_GROUND.dock,
  [Tile.BRIDGE]: MINIMAP_GROUND.bridge,
  [Tile.FARM]: MINIMAP_GROUND.farm,
  [Tile.DIRT]: MINIMAP_GROUND.dirt,
  [Tile.PLAZA]: MINIMAP_GROUND.plaza,
  [Tile.ROCK]: MINIMAP_GROUND.rock,
  [Tile.FIELD]: MINIMAP_GROUND.field,
  [Tile.DESERT]: MINIMAP_GROUND.desert,
  [Tile.BADLANDS]: MINIMAP_GROUND.badlands,
};

/** Grasfarbe variiert je Zone (Wald dunkel, Hinterland trocken, Sumpf satt) – für die Minimap. */
export function groundColor(map: WorldMap, t: number, x: number, z: number): number {
  if (t === Tile.GRASS) {
    switch (map.zoneAt(x, z)) {
      case Zone.DryPine: case Zone.CaneRidge: return MINIMAP_GROUND.grassDry;
      case Zone.Highlands: case Zone.GatorFlats: return MINIMAP_GROUND.grassDark;
    }
  }
  return GROUND_COLORS[t] ?? 0xff00ff;
}

// 128 m: feiner als früher (256 m), damit Frustum-Culling – auch im Schattenpass – wirklich greift
// (gemessen: 2–5x weniger Dreiecke pro Bild bei weniger Draw-Calls; 64 m bringt wieder mehr Calls).
const RCHUNK = 128;
const RC = WORLD_SIZE / RCHUNK;
const HGRID = WORLD_SIZE / HEIGHT_STEP + 1;
/** Chunks weiter weg als das werden ausgeblendet (Dunst endet bei ~420 m). */
const VIEW_DISTANCE = 450;

const CURB_H = 0.14;
const WHITE = 0xffffff;

/**
 * Gebäude aus den Kits (Stelzenhütten, Art-déco, Little Havana bleiben prozedural):
 *   Mittelbauten -> Kenney City Kit Commercial + KayKit-Stadthäuser
 *   Hochhäuser   -> Kenney Skyscraper (wenn die Proportion passt, sonst Spiegelglas-Turm)
 *   Wohnhäuser   -> Kenney City Kit Suburban + Starter-Kit-Häuschen
 *   Lagerhallen  -> Kenney City Kit Industrial
 * Kenney-Wände werden in der Gebäudefarbe, Dächer/Akzente in einer Zonenfarbe umgefärbt.
 */
const MIDRISE_MODELS: ModelName[] = [
  'building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H',
  'building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g',
  'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n',
];
const TOWER_MODELS: ModelName[] = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e'];
const HOUSE_MODELS: ModelName[] = [
  'house_a', 'house_b', 'house_c', 'house_d',
  'building-type-a', 'building-type-b', 'building-type-c', 'building-type-d', 'building-type-e', 'building-type-f', 'building-type-g',
  'building-type-h', 'building-type-i', 'building-type-j', 'building-type-k', 'building-type-l', 'building-type-m', 'building-type-n',
  'building-type-o', 'building-type-p', 'building-type-q', 'building-type-r', 'building-type-s', 'building-type-t', 'building-type-u',
];
const WAREHOUSE_MODELS: ModelName[] = [
  'industrial-a', 'industrial-b', 'industrial-c', 'industrial-d', 'industrial-e', 'industrial-f', 'industrial-g', 'industrial-h',
  'industrial-i', 'industrial-j', 'industrial-k', 'industrial-l', 'industrial-m', 'industrial-n', 'industrial-o', 'industrial-p',
  'industrial-q', 'industrial-r', 'industrial-s', 'industrial-t',
];
/** Dachfarben: Terrakotta, Schiefer, Florida-Türkis, Sand – und Akzente in Neon-Pastell für Geschäftshäuser. */
const ROOF_HEX = [0xd4583f, 0xc0703f, 0xb8553a, 0x5e5a6e, 0x3fb8b0, 0xe8d6b0];
const ACCENT_HEX = [0xff7eb0, 0x3fd8cc, 0xffb36b, 0x9a6bd8, 0x74d2f2, 0xff8577];
const NEON = [0xff4fae, 0x4ff2ff, 0xb06bff, 0xffe468, 0x6dff9c];
const PASTEL = ['pink', 'mint', 'sky', 'lemon', 'salmon'] as const;
const PASTEL_HEX = [0xffc2d6, 0xb4f0d8, 0xa8dcf5, 0xfff0a0, 0xffb4a0];

interface Chunk {
  flat: GeoBuilder; // keine Umrisslinie, empfängt Schatten
  solid: GeoBuilder; // Umrisslinie, wirft Schatten
  decals: GeoBuilder;
  neon: GeoBuilder;
  lamps: THREE.Matrix4[];
  pools: THREE.Matrix4[];
}
/** Pflanzen einer Variante (weltweit gesammelt, dann in PlantField instanziert). */
interface PlantEntry { variant: PlantVariant; mats: THREE.Matrix4[]; cover: boolean; kind?: PlantKind }
/** Baum wackelt nach einem Treffer (gedämpfte Schwingung um den Fuß). */
interface Wobble { entry: PlantEntry; idx: number; base: THREE.Matrix4; t: number; s: number; ax: THREE.Vector3 }

/**
 * Kenney-Kit-Modell umfärben: Wand-Dreiecke -> wall, Akzente -> accent (Helligkeitsverlauf des
 * Atlas bleibt erhalten), Rest palmaraisiert. Teilt Position/Normalen mit dem Original.
 */
function recolorKit(model: BakedModel, wall: number, accent: number): THREE.BufferGeometry {
  const tri = model.triColors, cls = model.triClass;
  const lum = (h: number) => (((h >> 16) & 255) + ((h >> 8) & 255) + (h & 255)) / 3;
  let accLum = 0, accN = 0;
  for (let t = 0; t < tri.length; t++) if (cls[t] === 2) { accLum += lum(tri[t]); accN++; }
  accLum = accN ? accLum / accN : 128;
  const scale = (hex: number, k: number) => {
    const c = (v: number) => Math.min(255, Math.round(v * k));
    return (c((hex >> 16) & 255) << 16) | (c((hex >> 8) & 255) << 8) | c(hex & 255);
  };
  const out = new Uint32Array(tri.length);
  for (let t = 0; t < tri.length; t++) {
    const c = cls[t];
    out[t] = c === 1 ? scale(wall, Math.min(1.08, lum(tri[t]) / 232))
      : c === 2 ? scale(accent, Math.min(1.25, lum(tri[t]) / accLum))
        : palmaraize(tri[t]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', model.body.getAttribute('position'));
  g.setAttribute('normal', model.body.getAttribute('normal'));
  g.setAttribute('color', new THREE.Float32BufferAttribute(triangleColors(out, (h) => h), 3));
  return g;
}

const m4 = (x: number, y: number, z: number, rot: number, sx: number, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(sx, sy, sz));

/** Drehung, die die lokale -x-Achse eines Modells in Richtung (dx, dz) zeigen lässt. */
const rotMinusX = (dx: number, dz: number) => Math.atan2(dz, -dx);


/** Gebäudefarbe der Karte -> Palette, je nach Stil in Richtung Pastell aufgehellt. */
function pastel(hex: number, amount: number): THREE.Color {
  return new THREE.Color(palmaraize(hex)).lerp(new THREE.Color(0xffffff), amount);
}

export class WorldView {
  readonly group = new THREE.Group();
  readonly waterMaterial: THREE.ShaderMaterial;
  private surface = (() => { const m = surfaceMaterial(); m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; return m; })(); // Straßen/Gehwege gewinnen sicher gegen das Gelände darunter (kein Z-Fighting)
  private solidMat = surfaceMaterial({ fade: true });
  private decalMat = surfaceMaterial({ decal: true });
  private neonMat = neonMaterial();
  private terrainMat = terrainMaterial();
  private lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
  private lampPoolMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc070, map: standaloneTexture('lamp_pool'), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  private chunks: Chunk[] = [];
  private chunkGroups: THREE.Group[] = [];
  /** Alle Pflanzen (Bäume + Bodendecker), Culling pro Instanz – siehe PlantField. */
  readonly plants = new PlantField();
  private plantLists = new Map<string, PlantEntry>();
  private rnd = mulberry32(29);
  private noise = makeValueNoise(4711);
  /** Baum-Index (Vegetation) -> Instanz, fürs Wackeln */
  private treeRefs: ({ entry: PlantEntry; idx: number } | null)[] = [];
  private wobbles: Wobble[] = [];

  constructor(private map: WorldMap, private trees: TreeDef[]) {
    for (let i = 0; i < RC * RC; i++) {
      this.chunks.push({
        flat: new GeoBuilder(), solid: new GeoBuilder(), decals: new GeoBuilder(), neon: new GeoBuilder(),
        lamps: [], pools: [],
      });
    }
    this.waterMaterial = waterMaterial(buildWaterInfo(map));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE * 4, WORLD_SIZE * 4), this.waterMaterial);
    water.name = 'water';
    water.rotation.x = -Math.PI / 2;
    water.position.set(WORLD_SIZE / 2, WATER_LEVEL, WORLD_SIZE / 2);
    water.renderOrder = 1;
    this.group.add(water);

    this.buildBlocksAndLots();
    for (const e of map.edges) this.buildEdge(e);
    for (const n of map.nodes) this.buildJunction(n);
    this.buildRunways();
    map.buildings.forEach((b) => this.buildBuilding(b));
    this.buildStreetProps();
    this.buildCoast();
    this.buildHarbor();
    this.buildHighwaySigns();
    trees.forEach((t, i) => { this.treeRefs[i] = this.addTree(t); });
    this.buildGroundCover();
    this.assemble();
    // Die Welt ist statisch (Baum-Wackeln ändert nur Instanz-Matrizen): Weltmatrizen einmal berechnen und
    // vom Matrix-Update jedes Bildes ausnehmen – spart das Durchlaufen von ~2000 Objekten pro Bild
    this.group.updateMatrixWorld(true);
    this.group.traverse((o) => { o.matrixAutoUpdate = false; });
    this.group.matrixWorldAutoUpdate = false;
  }

  // ------------------------------------------------------------------ Hilfen
  private chunkAt(x: number, z: number): Chunk {
    const cx = Math.min(RC - 1, Math.max(0, Math.floor(x / RCHUNK))), cz = Math.min(RC - 1, Math.max(0, Math.floor(z / RCHUNK)));
    return this.chunks[cz * RC + cx];
  }

  /** Höhe der Fahrbahn (Brücken über Wasser auf Deckhöhe). */
  private roadY(x: number, z: number) {
    return this.map.groundAt(x, z) === Tile.WATER ? BRIDGE_DECK : Math.max(0.05, this.map.terrainHeight(x, z)) + 0.04;
  }

  /** Gleichmäßige Abtastung einer Kante zwischen s0 und s1. */
  private samples(e: RoadEdge, s0: number, s1: number, step = 2) {
    const out: { x: number; z: number; dx: number; dz: number }[] = [];
    const n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (let i = 0; i <= n; i++) out.push(pointAt(e.pts, e.cum, s0 + ((s1 - s0) * i) / n));
    return out;
  }

  private styleAt(x: number, z: number): string {
    return this.map.districtAt(x, z)?.style ?? '';
  }

  /** Flaches Decal (eine Kachel des Materials) mit Drehung. */
  private decal(name: string, x: number, y: number, z: number, rot: number, scale = 1, color = WHITE) {
    const def = MATERIALS[matIndex(name)];
    const g = this.chunkAt(x, z).decals.use(name);
    const hw = (def.tile[0] * scale) / 2, hd = (def.tile[1] * scale) / 2;
    const s = Math.sin(rot), c = Math.cos(rot);
    const P = (lx: number, lz: number) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    g.quad(P(-hw, hd), P(hw, hd), P(hw, -hd), P(-hw, -hd), color, true, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }

  /** Senkrechtes Decal an einer Wand (Graffiti, Wandbild). (x,z) = Mitte am Boden, (nx,nz) = Wandnormale. */
  private wallDecal(name: string, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number) {
    const g = this.chunkAt(x, z).decals.use(name);
    const tx = -nz, tz = nx;
    const ox = x + nx * 0.04, oz = z + nz * 0.04;
    g.quad([ox - tx * w / 2, y, oz - tz * w / 2], [ox + tx * w / 2, y, oz + tz * w / 2], [ox + tx * w / 2, y + h, oz + tz * w / 2], [ox - tx * w / 2, y + h, oz - tz * w / 2], WHITE, false,
      [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }

  // ------------------------------------------------------------------ Gelände
  /** Untergrund-Schicht für eine natürliche Kachel. */
  private layerOf(t: number, zone: number): TerrainLayer {
    switch (t) {
      case Tile.SAND: case Tile.DESERT: case Tile.WATER: return 'sand';
      case Tile.SWAMP: return 'swamp_mud';
      case Tile.DIRT: case Tile.BADLANDS: return 'red_earth';
      case Tile.ROCK: return 'rock';
      case Tile.FIELD: return 'cane_field';
      case Tile.FARM: return 'grove_soil';
      default:
        return zone === Zone.DryPine || zone === Zone.CaneRidge ? 'grass_dry' : 'grass_tropical';
    }
  }

  /** Tönung je Untergrund/Zone (darf > 1 sein -> aufhellen). */
  private groundTint(t: number, zone: number, c: THREE.Color) {
    c.setRGB(1, 1, 1);
    if (t === Tile.DESERT) c.setRGB(1.05, 1.0, 0.92);
    else if (t === Tile.DIRT) c.setRGB(1.12, 1.08, 1.0);
    else if (t === Tile.GRASS) {
      switch (zone) {
        case Zone.GatorFlats: c.setRGB(0.82, 0.92, 0.78); break;
        case Zone.Highlands: c.setRGB(0.86, 0.96, 0.88); break;
        case Zone.CoralKeys: case Zone.PortCoralia: c.setRGB(1.04, 1.06, 0.98); break;
      }
    }
  }

  private buildGround(cx: number, cz: number): THREE.Mesh {
    const map = this.map;
    const n = RCHUNK / HEIGHT_STEP;
    const gx0 = cx * n, gz0 = cz * n;
    const count = (n + 1) * (n + 1);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const lw0 = new Float32Array(count * 4), lw1 = new Float32Array(count * 4);
    const c = new THREE.Color(), acc = new THREE.Color();
    const w = new Float32Array(8);
    let v = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++, v++) {
        const gx = gx0 + i, gz = gz0 + j;
        const x = gx * HEIGHT_STEP, z = gz * HEIGHT_STEP;
        pos[v * 3] = x; pos[v * 3 + 1] = map.heights[Math.min(HGRID - 1, gz) * HGRID + Math.min(HGRID - 1, gx)]; pos[v * 3 + 2] = z;
        // Schichtgewichte aus 3x3 Nachbarzellen -> weiche Übergänge
        w.fill(0);
        acc.setRGB(0, 0, 0);
        let sum = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = x + dx * CELL * 1.5, sz = z + dz * CELL * 1.5;
            const t = map.groundAt(sx, sz), zone = map.zoneAt(sx, sz);
            const k = dx === 0 && dz === 0 ? 2 : 1;
            // unter Straßen/Gehwegen/Plätzen: heller Staub statt Gras (sonst grüne Fugen an Blockkanten)
            const top = map.tileAt(sx, sz);
            const urban = top === Tile.ROAD || top === Tile.SIDEWALK || top === Tile.PLAZA || top === Tile.BUILDING;
            w[LAYER[urban ? 'sand' : this.layerOf(t, zone)]] += k;
            if (urban) c.setRGB(0.92, 0.86, 0.84); else this.groundTint(t, zone, c);
            acc.r += c.r * k; acc.g += c.g * k; acc.b += c.b * k;
            sum += k;
          }
        }
        for (let k = 0; k < 4; k++) { lw0[v * 4 + k] = w[k] / sum; lw1[v * 4 + k] = w[k + 4] / sum; }
        // Helligkeits- und Farbtonvariation (großräumiges Rauschen + Zufall je Gitterpunkt)
        const nz = this.noise(x * 0.01, z * 0.01) - 0.5;
        const jit = ((((gx * 73856093) ^ (gz * 19349663)) & 255) / 255 - 0.5) * 0.06;
        const k = 1 + nz * 0.16 + jit;
        col[v * 3] = (acc.r / sum) * k * (1 + nz * 0.04); col[v * 3 + 1] = (acc.g / sum) * k; col[v * 3 + 2] = (acc.b / sum) * k * (1 - nz * 0.04);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + 1, d = a + n + 1, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('lw0', new THREE.BufferAttribute(lw0, 4));
    g.setAttribute('lw1', new THREE.BufferAttribute(lw1, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // ------------------------------------------------------------------ Blöcke & Grundstücke
  private buildBlocksAndLots() {
    for (const b of this.map.blocks) {
      if (b.open) continue;
      const c = centroid(b.poly);
      const style = this.styleAt(c[0], c[1]);
      const mat = ({
        deco: 'plaza', downtown: 'concrete', havana: 'brick_path', port: 'concrete_oil', industrial: 'concrete_oil',
        stilt: 'boardwalk', trailer: 'gravel', keys: 'plaza',
      } as Record<string, string>)[style] ?? 'sidewalk';
      this.chunkAt(c[0], c[1]).flat.use(mat).polygon(b.poly, Math.max(0.05, this.map.terrainHeight(c[0], c[1])) + CURB_TOP, WHITE);
    }
    for (const l of this.map.lots) {
      if (l.use === LotUse.Building) continue;
      const c = centroid(l.poly);
      const g = this.chunkAt(c[0], c[1]).flat;
      const y = Math.max(0.05, this.map.terrainHeight(c[0], c[1])) + CURB_TOP + 0.02;
      if (l.use === LotUse.Park) g.use('grass_tropical').polygon(l.poly, y, 0xf0fff0);
      else if (l.use === LotUse.Vacant) {
        const coastal = this.map.zoneAt(c[0], c[1]) === Zone.CoralKeys || this.styleAt(c[0], c[1]) === 'deco';
        g.use(coastal ? 'sand' : 'gravel').polygon(l.poly, y, WHITE);
      }
      else {
        g.use(l.use === LotUse.Gas ? 'concrete_oil' : 'asphalt_worn').polygon(l.poly, y, WHITE);
        if (l.use === LotUse.Parking) this.parkingStripes(g, l.poly, y + 0.02);
        if (l.use === LotUse.Gas) this.gasCanopy(l.poly, y);
        // Ölflecken
        for (let k = 0; k < 3; k++) {
          const a = l.poly[k % l.poly.length];
          const t = 0.2 + this.rnd() * 0.5;
          this.decal('decal_oil', c[0] + (a[0] - c[0]) * t, y + 0.03, c[1] + (a[1] - c[1]) * t, this.rnd() * 6, 0.6 + this.rnd() * 0.6);
        }
      }
    }
  }

  /** Parkbuchten entlang der längsten Kante. */
  private parkingStripes(g: GeoBuilder, poly: Vec2[], y: number) {
    let a = poly[0], b = poly[1], best = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > best) { best = l; a = p; b = q; }
    }
    const ux = (b[0] - a[0]) / best, uz = (b[1] - a[1]) / best;
    const c = centroid(poly);
    let vx = -uz, vz = ux;
    if ((c[0] - a[0]) * vx + (c[1] - a[1]) * vz < 0) { vx = -vx; vz = -vz; }
    g.use('paint_white');
    for (let s = 2; s < best - 2; s += 2.8) {
      const x = a[0] + ux * s + vx * 1.5, z = a[1] + uz * s + vz * 1.5;
      g.box(x + vx * 2.5, y, z + vz * 2.5, 0.15, 0.01, 5, Math.atan2(vx, vz), WHITE);
    }
  }

  /** Tankstellendach mit Säulen und Neonkante zwischen Shop und Straße. */
  private gasCanopy(poly: Vec2[], y: number) {
    const c = centroid(poly);
    // Steht der begehbare Tankstellen-Shop (shops.ts) zu nah, rückt das Dach von ihm weg
    for (const b of this.map.buildings) {
      if (b.style !== BuildingStyle.Store) continue;
      const d = Math.hypot(b.x - c[0], b.z - c[1]);
      if (d > 0.1 && d < 12) { const k = (12 - d) / d; c[0] -= (b.x - c[0]) * k; c[1] -= (b.z - c[1]) * k; }
    }
    const a = poly[0], b = poly[1];
    const rot = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2;
    const ch = this.chunkAt(c[0], c[1]);
    const s = Math.sin(rot), co = Math.cos(rot);
    ch.solid.use('container_steel').box(c[0], y + 4.2, c[1], 16, 0.6, 10, rot, 0xfbf6ee);
    for (const [lx, lz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) {
      ch.solid.box(c[0] + lx * co + lz * s, y, c[1] - lx * s + lz * co, 0.5, 4.2, 0.5, rot, 0xe8e0dc);
    }
    for (const lz of [-1.5, 1.5]) ch.solid.box(c[0] + lz * s, y, c[1] + lz * co, 0.8, 1.6, 2.2, rot, 0xff7eb0); // Zapfsäulen
    ch.neon.box(c[0], y + 4.1, c[1], 16.3, 0.25, 10.3, rot, 0xff4fae);
  }

  // ------------------------------------------------------------------ Straßen
  private asphaltFor(e: RoadEdge, x: number, z: number): string {
    switch (e.type) {
      case RoadType.Highway: return 'highway';
      case RoadType.Dirt: return 'gravel';
      case RoadType.Pier: return 'boardwalk';
      case RoadType.Main: {
        const st = this.styleAt(x, z);
        return st === 'industrial' || st === 'port' || st === 'town' || st === 'trailer' ? 'asphalt_worn' : 'asphalt_new';
      }
      default: return 'asphalt_worn';
    }
  }

  private sidewalkFor(x: number, z: number): string {
    const st = this.styleAt(x, z);
    return st === 'deco' ? 'terrazzo' : st === 'havana' ? 'brick_path' : 'sidewalk';
  }

  private buildEdge(e: RoadEdge) {
    const s0 = e.trimA, s1 = Math.max(e.trimA + 0.2, e.len - e.trimB);
    if (s1 - s0 < 0.5) return;
    const S = this.samples(e, s0, s1);
    const mid = S[Math.floor(S.length / 2)];
    const ch = this.chunkAt(mid.x, mid.z);
    const g = ch.flat;
    const hw = e.width / 2;
    const ys = S.map((p) => this.roadY(p.x, p.z));
    const water = S.map((p) => this.map.groundAt(p.x, p.z) === Tile.WATER);
    // Rampen zur Brücke weich überblenden
    for (let pass = 0; pass < 3; pass++) for (let i = 1; i < ys.length - 1; i++) if (!water[i]) ys[i] = Math.max(ys[i], (ys[i - 1] + ys[i + 1]) / 2 - 0.02);
    const line = (off: number) => S.map((p): Vec2 => [p.x - p.dz * off, p.z + p.dx * off]);
    const yAt = (i: number) => ys[i];

    if (e.type === RoadType.Pier) {
      // Holzsteg: ausgeblichene Planken quer, Pfosten
      g.use('boardwalk').ribbon(line(-hw), line(hw), (i) => Math.max(ys[i], 0.4), WHITE);
      ch.solid.use('mangrove_roots');
      for (let i = 0; i < S.length; i += 3) {
        for (const side of [-1, 1]) {
          const p = S[i];
          ch.solid.box(p.x - p.dz * hw * side, -1.6, p.z + p.dx * hw * side, 0.35, 2.4, 0.35, 0, 0x9a8070);
        }
      }
      return;
    }

    g.use(this.asphaltFor(e, mid.x, mid.z)).ribbon(line(-hw), line(hw), yAt, WHITE);

    // Gehwege mit Bordstein
    if (e.sidewalk > 0) {
      const swMat = this.sidewalkFor(mid.x, mid.z);
      for (const side of [-1, 1]) {
        const inner = line(hw * side), outer = line((hw + e.sidewalk) * side);
        const [l, r] = side < 0 ? [outer, inner] : [inner, outer];
        g.use(swMat).ribbon(l, r, (i) => ys[i] + CURB_H, WHITE);
        g.use('curb_white').wall(inner, yAt, CURB_H, WHITE, false);
      }
    } else if (e.type !== RoadType.Dirt) {
      // Bankett: schmale Kante, damit die Fahrbahn nicht "schwebt"
      g.use('concrete');
      for (const side of [-1, 1]) g.wall(line(hw * side), (i) => ys[i] - 0.3, 0.32, 0xb0a8a8);
    }

    // Markierungen (abgenutzte Farbe)
    const my = (i: number) => ys[i] + 0.02;
    const dashed = (off: number, w: number, mat: string, dash = 3, gap = 3) => {
      g.use(mat);
      const L = line(off - w / 2), R = line(off + w / 2);
      const period = Math.round((dash + gap) / 2);
      for (let i = 0; i < S.length - 1; i++) {
        if (i % period >= Math.round(dash / 2)) continue;
        g.ribbon([L[i], L[i + 1]], [R[i], R[i + 1]], (k) => my(i + k), WHITE);
      }
    };
    const solid = (off: number, w: number, mat: string) => g.use(mat).ribbon(line(off - w / 2), line(off + w / 2), my, WHITE);
    if (e.type === RoadType.Highway) {
      solid(-0.18, 0.14, 'paint_yellow'); solid(0.18, 0.14, 'paint_yellow');
      dashed(-e.laneWidth, 0.14, 'paint_white'); dashed(e.laneWidth, 0.14, 'paint_white');
      solid(-hw + 0.5, 0.16, 'paint_white'); solid(hw - 0.5, 0.16, 'paint_white');
    } else if (e.type === RoadType.Main) {
      dashed(0, 0.16, 'paint_yellow', 4, 2);
    } else if (e.type === RoadType.Side && e.sidewalk === 0) {
      dashed(0, 0.12, 'paint_white');
    }

    // Brücke: Deck-Unterseite, Geländer, Pfeiler (feste Geometrie mit Umrisslinie)
    if (water.some(Boolean)) {
      const rails = [line(-(hw + 0.3)), line(hw + 0.3)];
      const fascia = [line(-(hw + 0.4)), line(hw + 0.4)];
      ch.solid.use('concrete');
      for (let i = 0; i < S.length - 1; i++) {
        if (!water[i] && !water[i + 1]) continue;
        for (let k = 0; k < 2; k++) {
          ch.solid.wall([rails[k][i], rails[k][i + 1]], (j) => ys[i + j], 0.9, 0xf7f0e4);
          ch.solid.wall([fascia[k][i], fascia[k][i + 1]], (j) => ys[i + j] - 0.5, 0.5, 0xc8c0c0);
        }
        if (i % 7 === 0) ch.solid.box(S[i].x, -4, S[i].z, 1.4, 4 + ys[i] - 0.5, Math.min(e.width, 6), Math.atan2(S[i].dx, S[i].dz) + Math.PI / 2, 0xd8d0d0);
      }
    }

    this.roadDecals(e, S, ys, water, hw);
  }

  /** Risse, Gullys, Ölflecken, Reifenspuren, Pfützen und Sand in Strandnähe. */
  private roadDecals(e: RoadEdge, S: { x: number; z: number; dx: number; dz: number }[], ys: number[], water: boolean[], hw: number) {
    if (e.type === RoadType.Dirt) return;
    const rnd = this.rnd;
    const worn = e.type === RoadType.Side || this.asphaltFor(e, S[0].x, S[0].z) === 'asphalt_worn';
    for (let i = 2; i < S.length - 2; i += 5) {
      if (water[i]) continue;
      const p = S[i];
      const rot = Math.atan2(p.dx, p.dz);
      const y = ys[i] + 0.03;
      const lat = (rnd() * 2 - 1) * (hw - 1);
      const x = p.x - p.dz * lat, z = p.z + p.dx * lat;
      // Sand auf Straßen in Strandnähe
      const nearSand = [6, -6, 10, -10].some((o) => this.map.groundAt(p.x - p.dz * (hw + Math.abs(o)) * Math.sign(o), p.z + p.dx * (hw + Math.abs(o)) * Math.sign(o)) === Tile.SAND);
      if (nearSand && rnd() < 0.55) { this.decal('decal_sand', p.x - p.dz * (hw - 1.5) * (rnd() < 0.5 ? -1 : 1), y, p.z + p.dx * (hw - 1.5), rot, 0.8 + rnd() * 0.5); continue; }
      const r = rnd();
      if (e.type === RoadType.Main && r < 0.12) this.decal('decal_manhole', p.x - p.dz * hw * 0.45, y, p.z + p.dx * hw * 0.45, rot);
      else if (worn && r < 0.32) this.decal('decal_crack', x, y, z, rnd() * 6, 0.7 + rnd() * 0.6);
      else if (r < 0.38) this.decal('decal_oil', x, y, z, rnd() * 6, 0.6 + rnd() * 0.4);
      else if ((e.type === RoadType.Highway && r < 0.46) || r < 0.41) this.decal('decal_tire', x, y, z, rot + (rnd() - 0.5) * 0.3, 1);
      else if (r < 0.5) this.decal('decal_puddle', x, y, z, rnd() * 6, 0.8 + rnd() * 0.8);
    }
  }

  /** Kreuzungsfläche, abgerundete Gehwegecken, Zebrastreifen; Kreisverkehre mit Mittelinsel. */
  private buildJunction(n: RoadNode) {
    const list = arms(this.map, n);
    if (list.length < 2 && !n.roundabout) return;
    const ch = this.chunkAt(n.x, n.z);
    const g = ch.flat;
    const y = this.roadY(n.x, n.z) + 0.005;
    const top = list.reduce((a, b) => (b.edge.type < a.edge.type ? b : a), list[0]);
    const asphalt = top ? this.asphaltFor(top.edge, n.x, n.z) : 'asphalt_worn';

    if (n.roundabout) {
      const R = n.roundabout;
      const ring = (r: number, k = 36): Vec2[] => Array.from({ length: k }, (_, i) => [n.x + Math.cos((i / k) * Math.PI * 2) * r, n.z + Math.sin((i / k) * Math.PI * 2) * r] as Vec2);
      g.use(asphalt).fan([n.x, n.z], ring(R + 0.5), y + 0.02, WHITE);
      const island = ring(R * 0.5);
      g.use('grass_tropical').fan([n.x, n.z], island, y + 0.2, WHITE);
      g.use('curb_yellow').wall([...island, island[0]], y, 0.2, WHITE, false);
      // gestrichelte Ringmarkierung
      const outer = ring(R * 0.76, 48), inner = ring(R * 0.74, 48);
      g.use('paint_white');
      for (let i = 0; i < 48; i += 2) g.ribbon([inner[i], inner[(i + 1) % 48]], [outer[i], outer[(i + 1) % 48]], y + 0.04, WHITE);
      this.addTree({ x: n.x, z: n.z, type: TreeType.Palm, s: 1.2, rot: 0 }, y + 0.2);
      return;
    }

    // Fahrbahnfläche: Fächer über den Umriss mit abgerundeten Ecken
    const outline = this.corners(list, () => 0);
    g.use(asphalt).fan([n.x, n.z], outline.flat(), y, WHITE);

    // Gehwegecken zwischen benachbarten Armen (Bordstein an Ecken gelb = Halteverbot)
    const sw = this.corners(list, (a) => a.sw);
    const swMat = this.sidewalkFor(n.x, n.z);
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[(i + 1) % list.length];
      const w = Math.min(a.sw, b.sw);
      if (w <= 0) continue;
      const inner = outline[i].slice(1), outer = sw[i].slice(1);
      if (inner.length !== outer.length || inner.length < 2) continue;
      g.use(swMat).ribbon(inner, outer, y + CURB_H, WHITE);
      g.use('curb_yellow').wall(inner, y, CURB_H, WHITE, false);
    }

    // Zebrastreifen an städtischen Kreuzungen (ab 3 Armen)
    if (list.length >= 3) {
      g.use('paint_white');
      for (const a of list) {
        if (a.sw <= 0) continue;
        const rx = -a.dir[1], rz = a.dir[0];
        const cx = a.base[0] - a.dir[0] * 1.8, cz = a.base[1] - a.dir[1] * 1.8;
        const rot = Math.atan2(a.dir[0], a.dir[1]);
        for (let k = -a.hw + 0.6; k <= a.hw - 0.6; k += 1.1) g.box(cx + rx * k, y + 0.01, cz + rz * k, 0.55, 0.01, 2.6, rot, WHITE);
        // Reifenspuren vor dem Zebrastreifen
        if (this.rnd() < 0.35) this.decal('decal_tire', a.base[0] + a.dir[0] * 4, y + 0.03, a.base[1] + a.dir[1] * 4, rot, 0.8);
      }
      // Ampeln an zwei gegenüberliegenden Ecken
      if (list.every((a) => a.sw > 0) && list.length >= 3) {
        for (const i of [0, Math.floor(list.length / 2)]) {
          const corner = sw[i][Math.floor(sw[i].length / 2)];
          if (!corner) continue;
          const dx = n.x - corner[0], dz = n.z - corner[1], l = Math.hypot(dx, dz) || 1;
          this.prop('trafficlight', corner[0] + (dx / l) * 0.6, y + CURB_H, corner[1] + (dz / l) * 0.6, rotMinusX(dx / l, dz / l));
        }
      }
    }
  }

  /**
   * Je Arm: [linker Armpunkt, rechter Armpunkt, Eckbogen zum nächsten Arm ...].
   * extra = zusätzliche Breite (Gehweg) je Arm. Gleiche Logik wie roads.junctionOutline.
   */
  private corners(list: Arm[], extra: (a: Arm) => number): Vec2[][] {
    const out: Vec2[][] = [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i], b = list[(i + 1) % list.length];
      const ra: Vec2 = [-a.dir[1], a.dir[0]], rb: Vec2 = [-b.dir[1], b.dir[0]];
      const wa = a.hw + extra(a), wb = b.hw + extra(b);
      const left: Vec2 = [a.base[0] - ra[0] * wa, a.base[1] - ra[1] * wa];
      const right: Vec2 = [a.base[0] + ra[0] * wa, a.base[1] + ra[1] * wa];
      const nextLeft: Vec2 = [b.base[0] - rb[0] * wb, b.base[1] - rb[1] * wb];
      const seg: Vec2[] = [left, right];
      let sector = b.angle - a.angle;
      if (i === list.length - 1) sector += Math.PI * 2;
      const den = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
      let corner: Vec2 | null = null;
      if (sector > 0.15 && sector < Math.PI - 0.15 && Math.abs(den) > 1e-6) {
        const t = ((nextLeft[0] - right[0]) * b.dir[1] - (nextLeft[1] - right[1]) * b.dir[0]) / den;
        corner = [right[0] + a.dir[0] * t, right[1] + a.dir[1] * t];
      }
      for (let k = 1; k < 6; k++) {
        const t = k / 6, u = 1 - t;
        if (corner) seg.push([u * u * right[0] + 2 * u * t * corner[0] + t * t * nextLeft[0], u * u * right[1] + 2 * u * t * corner[1] + t * t * nextLeft[1]]);
        else seg.push([right[0] + (nextLeft[0] - right[0]) * t, right[1] + (nextLeft[1] - right[1]) * t]);
      }
      out.push(seg);
    }
    return out;
  }

  /** Flughafen und Flugfelder (AirportBuilder.ts). */
  private get airportCtx(): AirportCtx { return { map: this.map, chunk: (x, z) => this.chunkAt(x, z) }; }
  private buildRunways() {
    buildAirportGround(this.airportCtx);
  }

  // ------------------------------------------------------------------ Gebäude
  private buildBuilding(b: BuildingDef) {
    const ch = this.chunkAt(b.x, b.z);
    const ground = this.map.terrainHeight(b.x, b.z);
    const base = Math.max(0, ground);
    if (b.style === BuildingStyle.Store) { this.buildStore(b, ch, base); return; }
    if (b.style === BuildingStyle.Airport) { buildAirportBuilding(this.airportCtx, b, base); return; }
    if (b.style === BuildingStyle.Container && this.containerYard(b, ch, base)) return;
    if (this.kitBuilding(b, ch, base)) return;
    const rnd = this.rnd;
    const style = this.styleAt(b.x, b.z);
    const zone = this.map.zoneAt(b.x, b.z);
    const sv = Math.sin(b.rot), cv = Math.cos(b.rot);
    const local = (lx: number, lz: number): [number, number] => [b.x + lx * cv + lz * sv, b.z - lx * sv + lz * cv];

    if (b.style === BuildingStyle.Stilt) {
      // Stelzenhütte: Pfähle, Plattform, Hütte aus Brettern, Wellblechdach
      ch.solid.use('mangrove_roots');
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [px, pz] = local((lx * b.w) / 2, (lz * b.d) / 2);
        ch.solid.box(px, ground - 1, pz, 0.4, 3.2 - ground, 0.4, b.rot, 0x9a8070);
      }
      ch.solid.use('boardwalk').box(b.x, 1.9, b.z, b.w + 1.5, 0.3, b.d + 1.5, b.rot, WHITE);
      this.facadeBox(ch, b.x, b.z, b.w * 0.8, b.d * 0.8, b.rot, 2.2, b.h - 0.6, 'planks', pastel(b.color, 0.2), 'corrugated_rust');
      return;
    }

    // Material und Farbe je Stil (und Viertel)
    let mat = 'facade_house', roof = 'roof_gravel', amount = 0.3;
    switch (b.style) {
      case BuildingStyle.Tower: mat = rnd() < 0.55 ? 'facade_mirror_teal' : rnd() < 0.5 ? 'facade_mirror_gold' : 'facade_office'; break;
      case BuildingStyle.Deco: mat = rnd() < 0.5 ? 'facade_deco' : 'facade_deco_round'; amount = 0.45; break;
      case BuildingStyle.Midrise: mat = style === 'havana' ? 'facade_havana' : 'facade_office'; amount = style === 'havana' ? 0.05 : 0.3; break;
      case BuildingStyle.Warehouse: mat = 'corrugated_rust'; amount = 0.4; break;
      case BuildingStyle.Container: mat = 'container_steel'; amount = 0; break;
      case BuildingStyle.Barn: mat = 'facade_barn'; amount = 0; roof = 'corrugated_rust'; break;
      case BuildingStyle.Trailer: mat = 'facade_trailer'; amount = 0.5; roof = 'alu_siding'; break;
      case BuildingStyle.Shop: mat = 'facade_shop'; amount = 0.4; break;
      case BuildingStyle.House:
        mat = style === 'havana' ? 'facade_havana' : 'facade_house';
        amount = style === 'havana' ? 0.05 : zone === Zone.CoralKeys ? 0.45 : 0.3;
        roof = 'roof_terracotta';
        break;
    }
    const color = pastel(b.color, amount);
    const y0 = base - 1.2; // etwas eingegraben, damit nichts schwebt
    const top = base + b.h;
    if (b.style === BuildingStyle.Tower && b.h > 50) {
      const lower = b.h * 0.6;
      // Marmorsockel, Turm mit Rücksprung
      this.facadeBox(ch, b.x, b.z, b.w + 0.4, b.d + 0.4, b.rot, y0, 5.2, 'marble', new THREE.Color(0xffffff), 'roof_gravel');
      this.facadeBox(ch, b.x, b.z, b.w, b.d, b.rot, base + 4, lower - 4, mat, color, 'roof_gravel');
      this.facadeBox(ch, b.x, b.z, b.w * 0.7, b.d * 0.7, b.rot, base + lower, b.h - lower, mat, color, 'roof_gravel');
    } else if (b.style === BuildingStyle.House || (b.style === BuildingStyle.Midrise && style === 'havana' && b.h < 14)) {
      this.facadeBox(ch, b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, mat, color, null);
      ch.solid.use('roof_terracotta').hipRoof(b.x, top, b.z, b.w, b.d, Math.min(b.w, b.d) * 0.32, b.rot, WHITE);
    } else if (b.style === BuildingStyle.Barn) {
      this.facadeBox(ch, b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, mat, new THREE.Color(palmaraize(b.color)), null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, b.d * 0.35, b.rot, 0xd4583f);
    } else {
      this.facadeBox(ch, b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, mat, color, roof);
    }

    // Dachaufbauten: Klimaanlagen auf Flachdächern
    if (roof === 'roof_gravel' && b.style !== BuildingStyle.House) {
      const k = b.style === BuildingStyle.Tower && b.h > 50 ? 0.7 : 1;
      const roofY = b.style === BuildingStyle.Tower && b.h > 50 ? top : top;
      ch.solid.use('alu_siding');
      const n = 1 + Math.floor(rnd() * 3);
      for (let i = 0; i < n; i++) {
        const [ax, az] = local((rnd() - 0.5) * b.w * 0.5 * k, (rnd() - 0.5) * b.d * 0.5 * k);
        ch.solid.box(ax, roofY, az, 1.6, 1.1, 1.2, b.rot, 0xe0e0e8);
      }
    }

    // Art-déco: Rundung an einer Frontecke, Zierstreifen, Dachterrasse, Neon
    const neon = NEON[Math.floor(rnd() * NEON.length)];
    if (b.style === BuildingStyle.Deco) {
      const pi = Math.floor(rnd() * PASTEL.length);
      const r = Math.min(b.w, b.d) * 0.2;
      const side = rnd() < 0.5 ? -1 : 1;
      const [cx, cz] = local(side * (b.w / 2 - r * 0.6), b.d / 2 - r * 0.6);
      ch.solid.use(`plaster_${PASTEL[pi]}`).cylinder(cx, y0, cz, r, b.h + 1.2 + 1.5, 10, WHITE);
      // Zierbänder (helle Gesimse) und vertikale Finne mit Neon
      ch.solid.use('flat');
      for (const yy of [base + 3.4, top - 0.4]) ch.solid.box(b.x, yy, b.z, b.w + 0.25, 0.35, b.d + 0.25, b.rot, PASTEL_HEX[(pi + 2) % 5]);
      const [fx, fz] = local(-side * b.w * 0.2, b.d / 2 + 0.3);
      ch.solid.box(fx, base + b.h * 0.45, fz, 0.5, b.h * 0.65, 0.6, b.rot, 0xfbf6ee);
      ch.neon.box(fx, base + b.h * 0.45, fz + 0, 0.18, b.h * 0.65, 0.68, b.rot, NEON[(NEON.indexOf(neon) + 1) % NEON.length]);
      for (const y of [base + b.h * 0.35, top - 1.2]) ch.neon.box(b.x, y, b.z, b.w + 0.3, 0.3, b.d + 0.3, b.rot, neon);
      if (rnd() < 0.35) this.roofTerrace(ch, b, top);
      // Glasbaustein-Treppenhaus an der Front
      const [gx, gz] = local(side * b.w * 0.05, b.d / 2 + 0.05);
      ch.solid.use('glassblock').box(gx, base + 1, gz, 1.4, b.h - 2, 0.2, b.rot, WHITE);
    } else if (b.style === BuildingStyle.Tower && rnd() < 0.35) {
      const k = b.h > 50 ? 0.7 : 1;
      ch.neon.box(b.x, top - 0.5, b.z, b.w * k + 0.3, 0.5, b.d * k + 0.3, b.rot, neon);
      this.sign(ch, b, top - 4, 0.6);
    } else if (b.style === BuildingStyle.Shop) {
      ch.neon.box(b.x, top - 0.6, b.z, b.w + 0.3, 0.4, b.d + 0.3, b.rot, 0x4ff2ff);
      this.awning(ch, b, base);
      this.sign(ch, b, top + 0.1, 0.9);
    }

    // Wandbilder (Little Havana) und Graffiti (Hafen/Industrie) an einer Seitenwand
    const sideWall = (name: string, w: number, h: number, y: number) => {
      const s = rnd() < 0.5 ? -1 : 1;
      const [wx, wz] = local((s * b.w) / 2, 0);
      this.wallDecal(name, wx, y, wz, s * cv, -s * sv, Math.min(w, b.d * 0.8), h);
    };
    if ((style === 'havana' || zone === Zone.PortCoralia && b.style === BuildingStyle.Midrise && style === 'havana') && rnd() < 0.5 && b.d > 6) {
      sideWall(rnd() < 0.5 ? 'decal_mural_sun' : 'decal_mural_flamingo', 8, Math.min(6, b.h - 1), base + 0.4);
    } else if ((style === 'port' || style === 'industrial' || b.style === BuildingStyle.Warehouse) && rnd() < 0.4 && b.d > 4) {
      sideWall('decal_graffiti', 5, 2.4, base + 0.3);
    }
  }

  /**
   * Begehbarer Laden (shops.ts), fester Teil: nur die Wandsockel bis STORE_CUT_H. Boden, obere
   * Wände, Dach, Schild, Markise und Einrichtung baut StoresView – dort lässt sich die „Haube“
   * ausblenden, sobald der Spieler den Laden betritt.
   */
  private buildStore(b: BuildingDef, ch: Chunk, base: number) {
    const y0 = base - 1.2, cap = 0.08;
    storeWalls(ch.solid.use('facade_shop'), b, y0, base + STORE_CUT_H - cap - y0);
    storeWalls(ch.solid.use('concrete'), b, base + STORE_CUT_H - cap, cap); // Abdeckkante (sichtbar im Laden)
  }

  /** Gedrehter Quader mit Fassadentextur (Fensterraster) und Dachmaterial (null = kein Deckel). */
  private facadeBox(ch: Chunk, cx: number, cz: number, w: number, d: number, rot: number, y0: number, h: number, mat: string, color: THREE.Color, roof: string | null) {
    const g = ch.solid.use(mat);
    const def = MATERIALS[matIndex(mat)];
    const tw = def.tile[0], th = def.tile[1];
    const s = Math.sin(rot), c = Math.cos(rot);
    const P = (lx: number, ly: number, lz: number) => [cx + lx * c + lz * s, ly, cz - lx * s + lz * c];
    const hw = w / 2, hd = d / 2, y1 = y0 + h;
    // v = 0 an der Geländeoberkante (Fundament ist 1,2 m eingegraben)
    const v0 = -1.2 / th, v1 = v0 + h / th;
    const uv = (len: number) => [[0, v0], [len / tw, v0], [len / tw, v1], [0, v1]];
    g.quad(P(-hw, y0, hd), P(hw, y0, hd), P(hw, y1, hd), P(-hw, y1, hd), color, false, uv(w)); // Front
    g.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y1, -hd), P(hw, y1, -hd), color, false, uv(w));
    g.quad(P(hw, y0, hd), P(hw, y0, -hd), P(hw, y1, -hd), P(hw, y1, hd), color, false, uv(d));
    g.quad(P(-hw, y0, -hd), P(-hw, y0, hd), P(-hw, y1, hd), P(-hw, y1, -hd), color, false, uv(d));
    if (roof) {
      ch.solid.use(roof);
      g.quad(P(-hw, y1, hd), P(hw, y1, hd), P(hw, y1, -hd), P(-hw, y1, -hd), roof === 'roof_gravel' ? 0xffffff : color);
      // Attika (niedrige Brüstung) – bricht die harte Dachkante
      if (roof === 'roof_gravel' && w > 5 && d > 5) {
        ch.solid.use(mat === 'marble' ? 'marble' : 'concrete');
        g.wall([[P(-hw, 0, hd)[0], P(-hw, 0, hd)[2]], [P(hw, 0, hd)[0], P(hw, 0, hd)[2]], [P(hw, 0, -hd)[0], P(hw, 0, -hd)[2]], [P(-hw, 0, -hd)[0], P(-hw, 0, -hd)[2]], [P(-hw, 0, hd)[0], P(-hw, 0, hd)[2]]], y1, 0.5, 0xf2ece8);
      }
    }
  }

  /** Dachterrasse mit Holzdeck und Geländer. */
  private roofTerrace(ch: Chunk, b: BuildingDef, top: number) {
    const w = b.w * 0.6, d = b.d * 0.5;
    ch.solid.use('roof_deck').box(b.x, top, b.z, w, 0.12, d, b.rot, WHITE);
    ch.solid.use('flat');
    const s = Math.sin(b.rot), c = Math.cos(b.rot);
    for (const [lx, lz, rw, rd] of [[0, d / 2, w, 0.08], [0, -d / 2, w, 0.08], [w / 2, 0, 0.08, d], [-w / 2, 0, 0.08, d]]) {
      ch.solid.box(b.x + lx * c + lz * s, top + 0.12, b.z - lx * s + lz * c, rw, 0.9, rd, b.rot, 0xfbf6ee);
    }
    // Sonnenschirm
    ch.solid.use('awning_pink').box(b.x + w * 0.2 * c, top + 2.1, b.z - w * 0.2 * s, 2.4, 0.15, 2.4, b.rot + 0.4, WHITE);
    ch.solid.use('flat').box(b.x + w * 0.2 * c, top + 0.12, b.z - w * 0.2 * s, 0.08, 2, 0.08, 0, 0xfbf6ee);
  }

  /** Gestreifte, schräge Markise über der Ladenfront. */
  private awning(ch: Chunk, b: BuildingDef, base: number) {
    const s = Math.sin(b.rot), c = Math.cos(b.rot);
    const P = (lx: number, ly: number, lz: number) => [b.x + lx * c + lz * s, base + ly, b.z - lx * s + lz * c];
    const hw = b.w / 2 - 0.3, z0 = b.d / 2, z1 = b.d / 2 + 1.8;
    const g = ch.solid.use(['awning_pink', 'awning_teal', 'awning_orange'][Math.floor(this.rnd() * 3)]);
    g.quad(P(-hw, 3.3, z1), P(hw, 3.3, z1), P(hw, 4.1, z0), P(-hw, 4.1, z0), WHITE, false, [[0, 1], [b.w / 2, 1], [b.w / 2, 0], [0, 0]]);
    g.quad(P(hw, 3.3, z1), P(-hw, 3.3, z1), P(-hw, 4.1, z0), P(hw, 4.1, z0), WHITE, false, [[0, 1], [b.w / 2, 1], [b.w / 2, 0], [0, 0]]);
    g.quad(P(-hw, 3.0, z1), P(hw, 3.0, z1), P(hw, 3.3, z1), P(-hw, 3.3, z1), WHITE, false, [[0, 1], [b.w / 2, 1], [b.w / 2, 0.85], [0, 0.85]]);
  }

  /** Leuchtreklame-Tafel an der Front (nachts leuchtende Buchstaben). */
  private sign(ch: Chunk, b: BuildingDef, y: number, scale: number) {
    const s = Math.sin(b.rot), c = Math.cos(b.rot);
    const w = Math.min(b.w * 0.8, 8) * scale, h = 2 * scale;
    const lz = b.d / 2 + 0.15;
    const g = ch.solid.use('sign_backing');
    const P = (lx: number, ly: number) => [b.x + lx * c + lz * s, y + ly, b.z - lx * s + lz * c];
    g.quad(P(-w / 2, 0), P(w / 2, 0), P(w / 2, h), P(-w / 2, h), WHITE, false, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }

  /** Kit-Modell statt Quader (Mittelbauten, Hochhäuser, Wohnhäuser, Lagerhallen). */
  private kitBuilding(b: BuildingDef, ch: Chunk, base: number): boolean {
    const rnd = this.rnd;
    const style = this.styleAt(b.x, b.z);
    const zone = this.map.zoneAt(b.x, b.z);
    let pool: ModelName[] = [];
    let fit: 'height' | 'random' = 'height';
    let syRange: [number, number] = [0.8, 1.25];
    if (b.style === BuildingStyle.Midrise && style !== 'havana') pool = MIDRISE_MODELS;
    else if (b.style === BuildingStyle.Tower && rnd() < 0.55) { pool = TOWER_MODELS; syRange = [0.75, 1.6]; }
    else if (b.style === BuildingStyle.House && zone !== Zone.GatorFlats && style !== 'havana' && rnd() < 0.85) { pool = HOUSE_MODELS; fit = 'random'; }
    else if (b.style === BuildingStyle.Warehouse && rnd() < 0.8) { pool = WAREHOUSE_MODELS; fit = 'random'; syRange = [0.7, 1.4]; }
    const avail = pool.filter((n) => getModel(n));
    if (!avail.length || b.w / b.d > 2.6 || b.d / b.w > 2.6) return false;

    // Bewertung: Grundriss-Proportion (Front/Tiefe) und – bei Mittelbauten/Türmen – die Höhe
    let best: ModelName | null = null, bestScore = Infinity;
    for (const name of avail) {
      const size = getModel(name)!.size;
      const s = Math.min(b.w / size.x, b.d / size.z);
      const aspect = Math.abs(Math.log((size.x / size.z) / (b.w / b.d)));
      const sy = b.h / (size.y * s);
      if (fit === 'height' && (sy < syRange[0] * 0.8 || sy > syRange[1] * 1.25)) continue;
      const score = aspect * 4 + (fit === 'height' ? Math.abs(Math.log(sy)) * 3 : 0) + rnd() * 1.5;
      if (score < bestScore) { bestScore = score; best = name; }
    }
    if (!best) return false;
    const model = getModel(best)!;
    const s = Math.min(b.w / model.size.x, b.d / model.size.z) * 0.96;
    const sy = fit === 'height'
      ? Math.min(syRange[1], Math.max(syRange[0], b.h / (model.size.y * s)))
      : b.style === BuildingStyle.House ? Math.min(1.1, Math.max(0.75, (b.h * 1.5) / (model.size.y * s))) : Math.min(syRange[1], Math.max(syRange[0], b.h / (model.size.y * s)));
    const m = m4(b.x, base - 0.05, b.z, b.rot, s, s * sy, s);

    if (model.triClass.some((c) => c > 0)) {
      // Kenney-Kit: Wände in der Gebäudefarbe (Pastell), Dächer/Akzente je nach Gebäudeart
      const wall = pastel(b.color, b.style === BuildingStyle.Warehouse ? 0.35 : b.style === BuildingStyle.House ? 0.25 : 0.12);
      const accent = b.style === BuildingStyle.House ? ROOF_HEX[Math.floor(rnd() * (zone === Zone.CoralKeys ? ROOF_HEX.length : 4))]
        : b.style === BuildingStyle.Warehouse ? 0xff9f5a : ACCENT_HEX[Math.floor(rnd() * ACCENT_HEX.length)];
      ch.solid.use('flat').addGeometry(recolorKit(model, wall.getHex(THREE.SRGBColorSpace), accent), m);
    } else {
      // KayKit/Starter-Kit: leichte Tönung in der Gebäudefarbe der Karte – Kit-Farben bleiben erkennbar
      const t = new THREE.Color(0xffffff).lerp(pastel(b.color, 0.2), 0.3);
      ch.solid.use('flat').addGeometry(model.body, m, t);
    }
    if (model.glass) ch.solid.use('kit_glass').addGeometry(model.glass, m);

    // Industrie: Tank bzw. Schornstein hinter der Halle (Raffinerie häufiger)
    if (pool === WAREHOUSE_MODELS && rnd() < (zone === Zone.CaneRidge ? 0.7 : 0.3)) {
      const sv = Math.sin(b.rot), cv = Math.cos(b.rot);
      const lx = (rnd() - 0.5) * b.w * 0.6, lz = -b.d / 2 - 4;
      const x = b.x + lx * cv + lz * sv, z = b.z - lx * sv + lz * cv;
      const t = this.map.tileAt(x, z);
      if (t !== Tile.BUILDING && t !== Tile.ROAD && t !== Tile.SIDEWALK && t !== Tile.WATER) {
        if (rnd() < 0.5) this.kitProp('detail-tank', x, base, z, b.rot + Math.PI / 2, 6, 'x');
        else this.kitProp(rnd() < 0.5 ? 'chimney-large' : 'chimney-medium', x, base, z, b.rot, 14 + rnd() * 8);
      }
    }

    // Neon-Kante auf Geschäftshäusern und Türmen (nachts) – Miami-Nacht-Look
    if ((b.style === BuildingStyle.Tower || (b.style === BuildingStyle.Midrise && style === 'downtown')) && rnd() < 0.3) {
      const top = base - 0.05 + model.size.y * s * sy;
      ch.neon.box(b.x, top - 0.35, b.z, model.size.x * s + 0.2, 0.25, model.size.z * s + 0.2, b.rot, NEON[Math.floor(rnd() * NEON.length)]);
    }
    return true;
  }

  /** Kit-Modell auf Zielhöhe (bzw. -länge mit by = 'z') skaliert in den Chunk legen; liefert die Skalierung. */
  private kitProp(name: ModelName, x: number, y: number, z: number, rot: number, target: number, by: 'y' | 'z' | 'x' = 'y', mat = 'flat'): number {
    const model = getModel(name);
    if (!model) return 0;
    const s = target / model.size[by];
    this.chunkAt(x, z).solid.use(mat).addGeometry(model.body, m4(x, y, z, rot, s));
    if (model.glass) this.chunkAt(x, z).solid.use('kit_glass').addGeometry(model.glass, m4(x, y, z, rot, s));
    return s;
  }

  /**
   * Containerlager statt eines riesigen Quaders: Reihen aus 20-Fuß-Containern (Kenney Watercraft),
   * 1–3 hoch gestapelt, mit Fahrgassen. Die Kollision bleibt die Grundfläche des "Gebäudes".
   */
  private containerYard(b: BuildingDef, ch: Chunk, base: number): boolean {
    const names: ModelName[] = ['wc-cargo-container-a', 'wc-cargo-container-b', 'wc-cargo-container-c'];
    const models = names.map((n) => getModel(n)).filter((m) => m) as BakedModel[];
    if (!models.length) return false;
    const rnd = this.rnd;
    const along = b.w >= b.d; // Container längs der längeren Seite
    const L = along ? b.w : b.d, W = along ? b.d : b.w;
    const s = 6.1 / models[0].size.z; // 20 Fuß
    const cl = models[0].size.z * s, cw = models[0].size.x * s, chh = models[0].size.y * s;
    const nL = Math.max(1, Math.floor(L / (cl + 0.4))), nW = Math.max(1, Math.floor(W / (cw + 0.3)));
    const sv = Math.sin(b.rot), cv = Math.cos(b.rot);
    const maxStack = Math.max(1, Math.round(b.h / 2.6)) + 1;
    for (let i = 0; i < nL; i++) {
      for (let j = 0; j < nW; j++) {
        if (nW > 4 && j % 4 === 3) continue; // Fahrgasse
        const u = (i + 0.5) * (L / nL) - L / 2, v = (j + 0.5) * (W / nW) - W / 2;
        const lx = along ? u : v, lz = along ? v : u;
        const x = b.x + lx * cv + lz * sv, z = b.z - lx * sv + lz * cv;
        const rot = b.rot + (along ? Math.PI / 2 : 0) + (rnd() < 0.5 ? Math.PI : 0);
        const stack = 1 + Math.floor(rnd() * maxStack);
        // ab und zu ein Stückgut-Stapel statt Containern
        const pile = getModel(rnd() < 0.5 ? 'wc-cargo-pile-a' : 'wc-cargo-pile-b');
        if (pile && rnd() < 0.08) {
          ch.solid.use('flat').addGeometry(pile.body, m4(x, base, z, rot, cl / Math.max(pile.size.x, pile.size.z)));
          continue;
        }
        for (let k = 0; k < stack; k++) {
          const m = models[Math.floor(rnd() * models.length)];
          ch.solid.use('flat').addGeometry(m.body, m4(x + (rnd() - 0.5) * 0.2, base + k * chh, z + (rnd() - 0.5) * 0.2, rot + (rnd() - 0.5) * 0.03, s));
        }
      }
    }
    return true;
  }

  // ------------------------------------------------------------------ Hafen
  /**
   * Hafen und Marinas aus dem Watercraft Kit: Boote an den Stegen, Frachter und Schlepper vor dem
   * Port District, Bojen vor den Stränden. Reine Deko (keine Kollision), liegt im Wasser.
   */
  private buildHarbor() {
    const map = this.map, rnd = mulberry32(2024);
    const water = (x: number, z: number) => map.tileAt(x, z) === Tile.WATER;
    const boatY = WATER_LEVEL - 0.35;
    const SMALL: ModelName[] = ['wc-boat-speed-a', 'wc-boat-speed-c', 'wc-boat-speed-f', 'wc-boat-speed-h', 'wc-boat-speed-j',
      'wc-boat-fishing-small', 'wc-boat-row-small', 'wc-boat-sail-a', 'wc-boat-sail-b', 'wc-boat-tow-a'];
    // Boote längs der Stege
    for (const e of map.edges) {
      if (e.type !== RoadType.Pier) continue;
      for (let s = 6; s < e.len - 4; s += 8 + rnd() * 6) {
        const p = pointAt(e.pts, e.cum, s);
        for (const side of [-1, 1]) {
          if (rnd() < 0.45) continue;
          const off = e.width / 2 + 2.4;
          const x = p.x - p.dz * side * off, z = p.z + p.dx * side * off;
          if (!water(x, z) || !water(x - p.dz * side * 3, z + p.dx * side * 3)) continue;
          const name = SMALL[Math.floor(rnd() * SMALL.length)];
          this.kitProp(name, x, boatY, z, Math.atan2(p.dx, p.dz) + (rnd() < 0.5 ? Math.PI : 0), 6 + rnd() * 2.5, 'z');
        }
      }
    }
    // Frachter, Schlepper und Bojen: freie Wasserflächen nahe der Küste
    const ships: [number, number][] = [];
    const STEP = 24;
    for (let z = STEP; z < WORLD_SIZE - STEP; z += STEP) {
      for (let x = STEP; x < WORLD_SIZE - STEP; x += STEP) {
        if (!water(x, z)) continue;
        const zone = map.zoneAt(x, z);
        // Abstand zum Land (grob, in 4 Richtungen)
        let near = Infinity;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let k = 8; k <= 96; k += 8) if (!water(x + dx * k, z + dz * k)) { near = Math.min(near, k); break; }
        }
        const r = rnd();
        if (zone === Zone.PortCoralia && near >= 32 && near <= 72 && r < 0.25 && ships.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > 150)) {
          // Frachter parallel zur nächsten Küste: Richtung mit freiem Wasser in Längsrichtung suchen
          for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
            const fx = Math.sin(a), fz = Math.cos(a);
            let ok = true;
            for (let k = -36; k <= 36 && ok; k += 6) ok = water(x + fx * k, z + fz * k) && water(x + fx * k + fz * 10, z + fz * k - fx * 10) && water(x + fx * k - fz * 10, z + fz * k + fx * 10);
            if (!ok) continue;
            // Frachter, Stückgutschiff oder ein Kreuzfahrtschiff vor Port Coralia
            const r2 = rnd();
            const ship: ModelName = r2 < 0.45 ? (rnd() < 0.5 ? 'wc-ship-cargo-a' : 'wc-ship-cargo-b') : r2 < 0.75 ? 'wc-ship-ocean-liner-small' : 'wc-ship-large';
            this.kitProp(ship, x, WATER_LEVEL - 1.6, z, a, ship === 'wc-ship-ocean-liner-small' ? 70 : r2 < 0.45 ? 64 : 48, 'z');
            ships.push([x, z]);
            // Schlepper daneben
            if (rnd() < 0.7) this.kitProp('wc-boat-tug-a', x + fz * 16, boatY, z - fx * 16, a + 0.3, 11, 'z');
            break;
          }
        } else if ((zone === Zone.PortCoralia || zone === Zone.CoralKeys) && near >= 16 && near <= 40 && r > 0.93) {
          this.kitProp(rnd() < 0.5 ? 'wc-buoy' : 'wc-buoy-flag', x + (rnd() - 0.5) * 10, WATER_LEVEL - 0.4, z + (rnd() - 0.5) * 10, rnd() * 6, 2.4);
        } else if ((zone === Zone.CoralKeys || zone === Zone.PortCoralia) && near >= 12 && near <= 48 && r > 0.975) {
          // vor Anker liegende Segel- und Motorboote
          this.kitProp(SMALL[Math.floor(rnd() * SMALL.length)], x, boatY, z, rnd() * 6.28, 7 + rnd() * 3, 'z');
        }
      }
    }
  }

  /** Autobahnschilder (Kenney Roads) am rechten Fahrbahnrand, etwa alle 300 m. */
  private buildHighwaySigns() {
    const rnd = mulberry32(77);
    for (const e of this.map.edges) {
      if (e.type !== RoadType.Highway) continue;
      for (let s = e.trimA + 60 + rnd() * 80; s < e.len - e.trimB - 40; s += 280 + rnd() * 120) {
        const p = pointAt(e.pts, e.cum, s);
        const off = e.width / 2 + e.sidewalk + 1.6;
        const x = p.x - p.dz * off, z = p.z + p.dx * off;
        const t = this.map.tileAt(x, z);
        if (t === Tile.WATER || t === Tile.BUILDING || t === Tile.BRIDGE) continue;
        const y = Math.max(0.05, this.map.terrainHeight(x, z));
        this.kitProp(rnd() < 0.5 ? 'sign-highway' : 'sign-highway-wide', x, y, z, Math.atan2(-p.dx, -p.dz), 7);
      }
    }
  }

  // ------------------------------------------------------------------ Straßendeko
  private prop(name: ModelName, x: number, y: number, z: number, rot: number, scale = 5) {
    const model = getModel(name);
    if (!model) return null;
    this.chunkAt(x, z).solid.use('white').addGeometry(model.body, m4(x, y, z, rot, scale));
    return model;
  }

  private buildStreetProps() {
    const rnd = this.rnd;
    // Laternen, Hydranten, Bänke, Mülltonnen … sind zerstörbar und kommen aus PropsView
    // (features.ts/generateProps – gleiche IDs auf Client und Server).
    // Parks: Büsche; Hinterhöfe: Container
    for (const l of this.map.lots) {
      const c = centroid(l.poly);
      const y = Math.max(0.05, this.map.terrainHeight(c[0], c[1])) + CURB_TOP + 0.02;
      if (l.use === LotUse.Vacant && rnd() < 0.6 && this.constructionSite(l.poly, y)) continue;
      if (l.use === LotUse.Park || l.use === LotUse.Vacant) {
        for (let k = 0; k < 3; k++) {
          const t = rnd();
          const a = l.poly[k % l.poly.length];
          const x = c[0] + (a[0] - c[0]) * 0.6 * t, z = c[1] + (a[1] - c[1]) * 0.6 * t;
          if (!(l.use === LotUse.Park && k === 0)) this.addCover('bush', x, y, z, 0.8 + rnd() * 0.5);
        }
        if (l.use === LotUse.Park) for (let k = 0; k < 6; k++) {
          const a = l.poly[k % l.poly.length], t = rnd() * 0.7;
          this.addCover('flower', c[0] + (a[0] - c[0]) * t, y, c[1] + (a[1] - c[1]) * t, 1 + rnd() * 0.5);
        }
      } else if (l.building >= 0 && this.frontYard(this.map.buildings[l.building], y)) {
        continue;
      } else if (l.building >= 0 && rnd() < 0.15) {
        const b = this.map.buildings[l.building];
        if (b.style !== BuildingStyle.Warehouse && b.style !== BuildingStyle.Midrise && b.style !== BuildingStyle.Shop) continue;
        const s = Math.sin(b.rot), co = Math.cos(b.rot);
        const lz = -b.d / 2 - 2.2, lx = b.w / 2 - 2;
        const x = b.x + lx * co + lz * s, z = b.z - lx * s + lz * co;
        if (this.map.tileAt(x, z) === Tile.BUILDING) continue;
        this.prop('dumpster', x, y, z, b.rot);
        this.prop('trash', x + 2 * co, y, z - 2 * s, rnd() * 6);
      }
    }
  }


  /** Baustelle auf einer Brache: Bauzaun-Barrieren an der Straßenseite, Kegel, Baulampen, Kisten. */
  private constructionSite(poly: Vec2[], y: number): boolean {
    if (!getModel('construction-barrier')) return false;
    const rnd = this.rnd;
    const c = centroid(poly);
    // Barrieren entlang der ersten (meist straßenseitigen) Kante, leicht eingerückt
    const a = poly[0], b = poly[1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 6) return false;
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    const rot = Math.atan2(ux, uz) + Math.PI / 2;
    for (let s = 2; s < len - 2; s += 2.6) {
      const t = s / len;
      const px = a[0] + (b[0] - a[0]) * t + (c[0] - a[0]) * 0.12, pz = a[1] + (b[1] - a[1]) * t + (c[1] - a[1]) * 0.12;
      if (this.map.tileAt(px, pz) === Tile.ROAD) continue;
      this.kitProp(s % 13 < 2.6 ? 'construction-light' : 'construction-barrier', px, y, pz, rot, s % 13 < 2.6 ? 1.6 : 1.1);
    }
    for (let k = 0; k < 4; k++) {
      const q = poly[k % poly.length], t = 0.3 + rnd() * 0.4;
      const px = c[0] + (q[0] - c[0]) * t, pz = c[1] + (q[1] - c[1]) * t;
      if (k < 2) this.kitProp('construction-cone', px, y, pz, rnd() * 6, 0.75);
      else this.kitProp(rnd() < 0.5 ? 'crate-wide' : 'crate-medium', px, y, pz, rnd() * 6, 1.1);
    }
    this.decal('decal_sand', c[0], y + 0.01, c[1], rnd() * 6, 3);
    return true;
  }

  /**
   * Vorplatz je Gebäudeart: Café-Schirme vor Läden (Ocean Strip, Havana, Kleinstadt),
   * Zaun und Pflanzkübel vor Wohnhäusern. false = nichts gebaut (dann normale Deko).
   */
  private frontYard(b: BuildingDef, y: number): boolean {
    const rnd = this.rnd;
    const s = Math.sin(b.rot), c = Math.cos(b.rot);
    const L = (lx: number, lz: number): [number, number] => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
    const free = (x: number, z: number) => { const t = this.map.tileAt(x, z); return t !== Tile.ROAD && t !== Tile.BUILDING && t !== Tile.WATER; };
    if (b.style === BuildingStyle.Shop && rnd() < 0.6 && getModel('detail-parasol-a')) {
      // 2–3 Sonnenschirme mit Tischen vor der Front
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const [x, z] = L((i - (n - 1) / 2) * 3.2, b.d / 2 + 2.6);
        if (!free(x, z)) continue;
        this.kitProp(rnd() < 0.5 ? 'detail-parasol-a' : 'detail-parasol-b', x, y, z, b.rot, 2.6);
      }
      return true;
    }
    if (b.style === BuildingStyle.House && b.d < 30 && rnd() < 0.7 && getModel('fence')) {
      // Niedriger Gartenzaun an der Front (mit Lücke für den Weg) und Pflanzkübel neben der Tür
      const fenceModel = getModel('fence')!;
      const seg = 2.2, zf = b.d / 2 + 3.2;
      const k = seg / fenceModel.size.x;
      for (let u = -b.w / 2 - 1; u < b.w / 2 + 1 - seg / 2; u += seg) {
        if (Math.abs(u + seg / 2) < 1.4) continue; // Gartentor
        const [x, z] = L(u + seg / 2, zf);
        if (!free(x, z) || this.map.tileAt(x, z) === Tile.SIDEWALK) continue;
        this.chunkAt(x, z).solid.use('flat').addGeometry(fenceModel.body, m4(x, y, z, b.rot, k, 1.2 / fenceModel.size.y, k));
      }
      for (const side of [-1, 1]) {
        const [x, z] = L(side * 1.8, b.d / 2 + 1);
        if (free(x, z)) this.kitProp('planter', x, y, z, b.rot, 0.9);
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ Küste
  /** Rettungstürme in Pastell an Stränden, Muscheln und Algen an der Wasserlinie. */
  private buildCoast() {
    const map = this.map, rnd = mulberry32(911);
    const towers: [number, number][] = [];
    const step = 3; // Zellen
    for (let cz = 2; cz < GRID_SIZE - 2; cz += step) {
      for (let cx = 2; cx < GRID_SIZE - 2; cx += step) {
        if (map.ground[cz * GRID_SIZE + cx] !== Tile.SAND || map.tile(cx, cz) !== Tile.SAND) continue;
        // Richtung zum Wasser suchen (bis 8 m)
        let wx = 0, wz = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (let k = 1; k <= 4; k++) if (map.tile(cx + dx * k, cz + dz * k) === Tile.WATER) { wx += dx / k; wz += dz / k; break; }
        }
        if (!wx && !wz) continue;
        const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
        const y = Math.max(-0.1, map.terrainHeight(x, z)) + 0.03;
        const r = rnd();
        if (r < 0.06) this.decal(rnd() < 0.6 ? 'decal_shells' : 'decal_seaweed', x, y, z, rnd() * 6, 0.8 + rnd() * 0.6);
        const zone = map.zoneAt(x, z);
        if ((zone === Zone.PortCoralia || zone === Zone.CoralKeys) && r > 0.985 && towers.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > 110)) {
          // 10 m landeinwärts, Blick aufs Wasser
          const l = Math.hypot(wx, wz);
          const ix = x - (wx / l) * 10, iz = z - (wz / l) * 10;
          if (map.tileAt(ix, iz) !== Tile.SAND) continue;
          towers.push([ix, iz]);
          this.lifeguardTower(ix, Math.max(0, map.terrainHeight(ix, iz)), iz, Math.atan2(wx, wz), Math.floor(rnd() * 5));
        }
      }
    }
  }

  private lifeguardTower(x: number, y: number, z: number, rot: number, color: number) {
    const ch = this.chunkAt(x, z);
    const s = Math.sin(rot), c = Math.cos(rot);
    const L = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
    ch.solid.use('lifeguard_wood');
    for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) {
      const [px, pz] = L(lx, lz);
      ch.solid.box(px, y - 0.5, pz, 0.25, 3.3, 0.25, rot, 0xf7f0e4);
    }
    ch.solid.box(x, y + 2.8, z, 3.4, 0.25, 3.4, rot, 0xf7f0e4);
    ch.solid.box(x, y + 3.05, z, 2.6, 2.0, 2.4, rot, PASTEL_HEX[color]);
    ch.solid.use('flat').box(x, y + 5.05, z, 3.2, 0.25, 3.0, rot, PASTEL_HEX[(color + 2) % 5]);
    // Rampe zum Strand
    const [rx, rz] = L(0, -3);
    ch.solid.use('boardwalk').box(rx, y, rz, 1.2, 0.2, 4, rot, WHITE);
    ch.neon.box(x, y + 4.4, z, 2.62, 0.12, 2.42, rot, NEON[color % NEON.length]);
  }

  // ------------------------------------------------------------------ Pflanzen
  private addPlant(variants: PlantVariant[], x: number, y: number, z: number, rot: number, s: number, cover: boolean): { entry: PlantEntry; idx: number } | null {
    if (!variants.length) return null;
    const h = Math.abs(Math.floor(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453)) % variants.length;
    const v = variants[h];
    const key = v.key + (cover ? ':c' : '');
    let entry = this.plantLists.get(key);
    if (!entry) this.plantLists.set(key, (entry = { variant: v, mats: [], cover }));
    entry.mats.push(m4(x, y, z, rot, s));
    return { entry, idx: entry.mats.length - 1 };
  }

  private addTree(t: TreeDef, y?: number) {
    let base = y;
    if (base === undefined) {
      const tile = this.map.tileAt(t.x, t.z);
      const h = this.map.terrainHeight(t.x, t.z);
      // in Parks/auf Gehwegen auf Bordsteinhöhe, im Sumpf mit den Wurzeln im Wasser
      base = tile === Tile.SWAMP ? -0.6 : tile === Tile.PLAZA || tile === Tile.SIDEWALK ? Math.max(0.05, h) + CURB_TOP + 0.02 : h;
    }
    return this.addPlant(treeVariants(t.type), t.x, base, t.z, t.rot, t.s, false);
  }

  private addCover(kind: CoverKind, x: number, y: number, z: number, s = 1) {
    this.addPlant(coverVariants(kind), x, y, z, (x * 7.13 + z * 3.7) % 6.28, s, kind !== 'bush' && kind !== 'rock' && kind !== 'cactus');
  }

  /** Gras, Farne, Blumen, Büsche, Felsen, Schilf, Seerosen, Kakteen – je nach Untergrund und Zone. */
  private buildGroundCover() {
    const map = this.map, rnd = mulberry32(1337);
    const STEP = 3.2;
    for (let z = STEP / 2; z < WORLD_SIZE; z += STEP) {
      for (let x = STEP / 2; x < WORLD_SIZE; x += STEP) {
        const px = x + (rnd() - 0.5) * STEP, pz = z + (rnd() - 0.5) * STEP;
        const t = map.tileAt(px, pz);
        if (t !== Tile.GRASS && t !== Tile.SWAMP && t !== Tile.SAND && t !== Tile.DESERT && t !== Tile.BADLANDS && t !== Tile.ROCK && t !== Tile.FARM && t !== Tile.DIRT) continue;
        const zone = map.zoneAt(px, pz);
        const dense = this.noise(px * 0.02, pz * 0.02);
        const r = rnd();
        const y = t === Tile.SWAMP ? WATER_LEVEL : map.terrainHeight(px, pz);
        const s = 0.8 + rnd() * 0.5;
        switch (t) {
          case Tile.GRASS: {
            const dry = zone === Zone.DryPine || zone === Zone.CaneRidge;
            if (r < 0.28 * dense + 0.04) this.addCover(dry ? 'grassDry' : 'grass', px, y, pz, s);
            else if (r < 0.3 * dense + 0.07 && !dry) this.addCover(zone === Zone.GatorFlats || zone === Zone.Highlands ? 'fern' : 'flower', px, y, pz, s);
            else if (r < 0.3 * dense + 0.085) this.addCover('bush', px, y, pz, s);
            else if (r < 0.3 * dense + 0.09 && (zone === Zone.Highlands || zone === Zone.DryPine)) this.addCover('rock', px, y, pz, s * 1.4);
            // Schilf an Ufern in Gator Flats
            if (zone === Zone.GatorFlats && r > 0.93 && map.tileAt(px + 4, pz) === Tile.SWAMP) this.addCover('reed', px, y, pz, s);
            break;
          }
          case Tile.SWAMP:
            if (r < 0.05) this.addCover('lily', px, WATER_LEVEL + 0.02, pz, s);
            else if (r < 0.09) this.addCover('reed', px, -0.65, pz, s * 1.2);
            break;
          case Tile.SAND:
            if (r < 0.015 && map.terrainHeight(px, pz) > 0.2) this.addCover('grass', px, y, pz, s * 0.8);
            break;
          case Tile.DESERT:
            if (r < 0.008) this.addCover('cactus', px, y, pz, s);
            else if (r < 0.02) this.addCover('grassDry', px, y, pz, s);
            break;
          case Tile.BADLANDS: case Tile.ROCK:
            if (r < 0.025) this.addCover('rock', px, y, pz, s * (t === Tile.ROCK ? 2.2 : 1.3));
            else if (r < 0.04) this.addCover('grassDry', px, y, pz, s);
            break;
          case Tile.FARM: case Tile.DIRT:
            if (r < 0.06) this.addCover('grassDry', px, y, pz, s);
            break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ Zusammenbau
  private assemble() {
    const pool = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
    const bulb = new THREE.BoxGeometry(0.7, 0.25, 0.7);
    for (let cz = 0; cz < RC; cz++) {
      for (let cx = 0; cx < RC; cx++) {
        const ch = this.chunks[cz * RC + cx];
        const grp = new THREE.Group();
        grp.userData.center = new THREE.Vector2((cx + 0.5) * RCHUNK, (cz + 0.5) * RCHUNK);
        const ground = this.buildGround(cx, cz);
        ground.name = 'ground';
        grp.add(ground);
        if (!ch.flat.empty) {
          const m = new THREE.Mesh(ch.flat.build(), this.surface);
          m.name = 'flat';
          m.receiveShadow = true;
          grp.add(m);
        }
        if (!ch.solid.empty) {
          const m = new THREE.Mesh(ch.solid.build(), this.solidMat);
          m.name = 'solid';
          m.castShadow = m.receiveShadow = true;
          addOutline(m, LINE.building, { fade: true });
          grp.add(m);
        }
        if (!ch.decals.empty) {
          const m = new THREE.Mesh(ch.decals.build(), this.decalMat);
          m.name = 'decals';
          m.receiveShadow = true;
          m.renderOrder = 1;
          grp.add(m);
        }
        if (!ch.neon.empty) { const m = new THREE.Mesh(ch.neon.build(), this.neonMat); m.name = 'neon'; grp.add(m); }
        if (ch.lamps.length) {
          const b = instanced(bulb, this.lampMaterial, ch.lamps);
          b.name = 'lamps';
          grp.add(b);
          const p = instanced(pool, this.lampPoolMaterial, ch.pools);
          p.name = 'lampPools';
          p.renderOrder = 2;
          grp.add(p);
        }
        this.chunkGroups.push(grp);
        this.group.add(grp);
      }
    }
    for (const entry of this.plantLists.values()) entry.kind = this.plants.add(entry.variant, entry.cover, entry.mats) ?? undefined;
    this.group.add(this.plants.group);
    this.chunks = [];
    void this.trees;
  }

  /** Entfernte Chunks ausblenden (zusätzlich zum Frustum-Culling der einzelnen Meshes). */
  /**
   * Entfernte Chunks ausblenden. Grenze: Sichtweite oder Dunst-Ende (Nebel in Gator Flats, Dunst bei
   * Tag), je nachdem was näher ist – dahinter ist alles vollständig in Dunstfarbe, also unsichtbar.
   * Reserve: Chunk-Halbdiagonale + Abstand Kamera–Fokus (Dunst zählt ab Kamera, Mittelpunkt ab Fokus).
   */
  update(camX: number, camZ: number, fogFar = Infinity) {
    const limit = Math.min(VIEW_DISTANCE, fogFar + 60) + RCHUNK * 0.71;
    for (const g of this.chunkGroups) {
      const c = g.userData.center as THREE.Vector2;
      g.visible = Math.hypot(c.x - camX, c.y - camZ) < limit;
    }
  }

  /** Pflanzen-Culling pro Instanz (Kamera, Schattenrichtung je m Höhe oder null, Dunstende). */
  updatePlants(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, shadowDir: THREE.Vector3 | null, fogFar: number) {
    this.plants.update(camera, focus, shadowDir, fogFar);
  }


  /** Baum (Index der Vegetation) nach einem Treffer wackeln lassen; strength 0..1. */
  wobbleTree(index: number, strength: number, dirX = 1, dirZ = 0) {
    const ref = this.treeRefs[index];
    if (!ref?.entry.kind) return;
    if (this.wobbles.some((w) => w.entry === ref.entry && w.idx === ref.idx)) return;
    const l = Math.hypot(dirX, dirZ) || 1;
    // Kippachse quer zur Stoßrichtung (lokal: Baum-Matrix enthält Drehung + Skalierung)
    const base = this.plants.matrix(ref.entry.kind, ref.idx, new THREE.Matrix4());
    const inv = new THREE.Matrix4().extractRotation(base).invert();
    const ax = new THREE.Vector3(dirZ / l, 0, -dirX / l).applyMatrix4(inv).normalize();
    this.wobbles.push({ entry: ref.entry, idx: ref.idx, base, t: 0, s: Math.min(1, 0.3 + strength), ax });
  }

  /** Wackelnde Bäume animieren (gedämpfte Schwingung). */
  updateWobble(dt: number) {
    for (let i = this.wobbles.length - 1; i >= 0; i--) {
      const w = this.wobbles[i];
      w.t += dt;
      const done = w.t > 2.6;
      const ang = done ? 0 : w.s * 0.32 * Math.exp(-w.t * 2.2) * Math.sin(w.t * 13);
      const m = done ? w.base : new THREE.Matrix4().makeRotationAxis(w.ax, ang).premultiply(w.base);
      this.plants.setMatrix(w.entry.kind!, w.idx, m);
      if (done) this.wobbles.splice(i, 1);
    }
  }
  /** Tag/Nacht: Laternen (0 = Tag, 1 = tiefe Nacht). Fenster und Neon steuern die Shader selbst. */
  setNight(night: number) {
    this.lampMaterial.color.setHex(0x9a9488).lerp(new THREE.Color(0xfff0b0), night).multiplyScalar(1 + night * 0.6);
    this.lampPoolMaterial.opacity = night * 0.45;
  }

  /** Lichtfarbe für das (unbeleuchtete) Wasser-Material. */
  setLight(c: THREE.Color) {
    (this.waterMaterial.uniforms.uLight.value as THREE.Color).copy(c);
  }
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
  mats.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = mats.length;
  mesh.computeBoundingSphere();
  return mesh;
}


