// Externe CC0-Modelle (siehe CREDITS.md) laden und für den einheitlichen Look "backen":
//   - alle Teile eines Modells werden zu EINER Geometrie verschmolzen
//   - die Texturfarbe wird pro Dreieck (am Schwerpunkt) als Vertex-Farbe übernommen
//     und an die Palmara-Palette angeglichen -> gleiche Materialien und gleiche
//     Beleuchtung wie bei den prozeduralen Modellen, flache Schattierung im DS-Stil
//   - Fensterflächen (per UV-Bereich des Atlas) landen in einer eigenen Geometrie,
//     damit sie nachts leuchten können
// Fehlt eine Datei, bleibt der Eintrag leer und der Code fällt auf das prozedurale Modell zurück.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { palmaraize } from './palette';

type UVRect = [number, number, number, number]; // u0, v0, u1, v1 (glTF: v=0 oben)

/**
 * glass = UV-Bereiche der Fensterscheiben im Atlas (nur bei Gebäuden). Ermittelt aus den Atlanten:
 * KayKit = Kachel mit Spiegelstreifen unten links, Kenney = dunkelgraue Kachel unten links (je 1–2 % der Fläche).
 */
interface Source {
  dir: string; glass: UVRect[];
  /** Wandflächen (werden in der Gebäudefarbe umgefärbt) und Akzente (Dächer, Markisen …). */
  wall?: UVRect[]; accent?: UVRect[];
  /** Knoten, die nicht in die Geometrie kommen (zählen aber für die Ausdehnung), z. B. Räder. */
  skip?: RegExp;
}
const KAYKIT: Source = { dir: 'kaykit/city-builder-bits/', glass: [] };
const KAYKIT_BUILDINGS: Source = { dir: KAYKIT.dir, glass: [[0, 0.75, 0.25, 1]] };
const KENNEY_CITY: Source = { dir: 'kenney/starter-kit-city-builder/models/', glass: [[0, 0.75, 0.125, 1]] };
const KENNEY_RACING: Source = { dir: 'kenney/starter-kit-racing/models/', glass: [] };
/**
 * Kenney City Kits (Commercial/Suburban/Industrial) teilen ein Atlas-Layout (8x8 Kacheln):
 * Zeilen 2–3 = Farbfelder (Spalte 5 hellblau = Fensterglas), Spalte 3 in Zeilen 4–5 = weiße Wand.
 */
const KENNEY_ATLAS = {
  glass: [[0.625, 0.25, 0.75, 0.5]] as UVRect[],
  wall: [[0.375, 0.5, 0.5, 0.75]] as UVRect[],
  accent: [[0, 0.25, 0.625, 0.5], [0.75, 0.25, 1, 0.5]] as UVRect[],
};
const K_COMMERCIAL: Source = { dir: 'kenney/city-kit-commercial/', ...KENNEY_ATLAS };
const K_SUBURBAN: Source = { dir: 'kenney/city-kit-suburban/', ...KENNEY_ATLAS };
const K_INDUSTRIAL: Source = { dir: 'kenney/city-kit-industrial/', ...KENNEY_ATLAS };
const K_ROADS: Source = { dir: 'kenney/city-kit-roads/', glass: [] };
const K_CARS: Source = { dir: 'kenney/car-kit/', glass: [], skip: /^wheel/ };
const K_WATER: Source = { dir: 'kenney/watercraft/', glass: [] };
const K_BLASTER: Source = { dir: 'kenney/blaster-kit/', glass: [] };

const A_N = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'] as const;
const A_U = [...A_N, 'o', 'p', 'q', 'r', 's', 't', 'u'] as const;
/** Mehrere Modelle eines Kits: Name = prefix + x, Datei = file + x + '.glb'. */
const kit = <P extends string, L extends string>(prefix: P, ls: readonly L[], src: Source, file: string = prefix) =>
  Object.fromEntries(ls.map((l) => [`${prefix}${l}`, [src, `${file}${l}.glb`]])) as Record<`${P}${L}`, [Source, string]>;

const MANIFEST = {
  car_sedan: [KAYKIT, 'car_sedan.gltf'],
  car_hatchback: [KAYKIT, 'car_hatchback.gltf'],
  car_stationwagon: [KAYKIT, 'car_stationwagon.gltf'],
  car_taxi: [KAYKIT, 'car_taxi.gltf'],
  truck_red: [KENNEY_RACING, 'vehicle-truck-red.glb'],
  truck_yellow: [KENNEY_RACING, 'vehicle-truck-yellow.glb'],
  motorcycle: [KENNEY_RACING, 'vehicle-motorcycle.glb'],
  building_A: [KAYKIT_BUILDINGS, 'building_A_withoutBase.gltf'],
  building_B: [KAYKIT_BUILDINGS, 'building_B_withoutBase.gltf'],
  building_C: [KAYKIT_BUILDINGS, 'building_C_withoutBase.gltf'],
  building_D: [KAYKIT_BUILDINGS, 'building_D_withoutBase.gltf'],
  building_E: [KAYKIT_BUILDINGS, 'building_E_withoutBase.gltf'],
  building_F: [KAYKIT_BUILDINGS, 'building_F_withoutBase.gltf'],
  building_G: [KAYKIT_BUILDINGS, 'building_G_withoutBase.gltf'],
  building_H: [KAYKIT_BUILDINGS, 'building_H_withoutBase.gltf'],
  house_a: [KENNEY_CITY, 'building-small-a.glb'],
  house_b: [KENNEY_CITY, 'building-small-b.glb'],
  house_c: [KENNEY_CITY, 'building-small-c.glb'],
  house_d: [KENNEY_CITY, 'building-small-d.glb'],
  streetlight: [KAYKIT, 'streetlight.gltf'],
  trafficlight: [KAYKIT, 'trafficlight_A.gltf'],
  hydrant: [KAYKIT, 'firehydrant.gltf'],
  bench: [KAYKIT, 'bench.gltf'],
  dumpster: [KAYKIT, 'dumpster.gltf'],
  trash: [KAYKIT, 'trash_A.gltf'],
  bush: [KAYKIT, 'bush.gltf'],
  // Kenney City Kit Commercial / Suburban / Industrial
  ...kit('building-', A_N, K_COMMERCIAL),
  ...kit('building-skyscraper-', A_N.slice(0, 5) as readonly ('a' | 'b' | 'c' | 'd' | 'e')[], K_COMMERCIAL),
  'detail-parasol-a': [K_COMMERCIAL, 'detail-parasol-a.glb'],
  'detail-parasol-b': [K_COMMERCIAL, 'detail-parasol-b.glb'],
  ...kit('building-type-', A_U, K_SUBURBAN),
  fence: [K_SUBURBAN, 'fence.glb'],
  planter: [K_SUBURBAN, 'planter.glb'],
  ...kit('industrial-', A_U.slice(0, 20) as readonly (typeof A_U)[number][], K_INDUSTRIAL, 'building-'),
  'chimney-large': [K_INDUSTRIAL, 'chimney-large.glb'],
  'chimney-medium': [K_INDUSTRIAL, 'chimney-medium.glb'],
  'detail-tank': [K_INDUSTRIAL, 'detail-tank.glb'],
  // Kenney City Kit Roads: Laternen, Baustelle, Schilder
  'light-curved': [K_ROADS, 'light-curved.glb'],
  'construction-barrier': [K_ROADS, 'construction-barrier.glb'],
  'construction-cone': [K_ROADS, 'construction-cone.glb'],
  'construction-light': [K_ROADS, 'construction-light.glb'],
  'sign-highway': [K_ROADS, 'sign-highway.glb'],
  'sign-highway-wide': [K_ROADS, 'sign-highway-wide.glb'],
  // Kenney Car Kit
  ...kit('ck-', ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'ambulance', 'firetruck',
    'garbage-truck', 'delivery', 'van', 'truck', 'race'] as const, K_CARS, ''),
  // Kenney Watercraft
  ...kit('wc-', ['boat-speed-a', 'boat-speed-b', 'boat-speed-c', 'boat-speed-d', 'boat-speed-e', 'boat-speed-f', 'boat-speed-g',
    'boat-speed-h', 'boat-speed-j', 'boat-fan', 'boat-fishing-small', 'boat-row-small', 'boat-sail-a', 'boat-sail-b', 'boat-tug-a',
    'boat-tow-a', 'ship-cargo-a', 'ship-cargo-b', 'ship-large', 'ship-ocean-liner-small', 'buoy', 'buoy-flag',
    'cargo-container-a', 'cargo-container-b', 'cargo-container-c', 'cargo-pile-a', 'cargo-pile-b'] as const, K_WATER, ''),
  // Kenney Blaster Kit
  ...kit('blaster-', ['b', 'd', 'e', 'f', 'h'] as const, K_BLASTER),
  'crate-medium': [K_BLASTER, 'crate-medium.glb'],
  'crate-wide': [K_BLASTER, 'crate-wide.glb'],
} satisfies Record<string, [Source, string]>;

export type ModelName = keyof typeof MANIFEST;

export interface BakedModel {
  /** Alles außer Fenstern; Ursprung = Mitte unten, vorwärts = +z. */
  body: THREE.BufferGeometry;
  /** Fensterflächen (leer, wenn das Modell keine hat). */
  glass: THREE.BufferGeometry | null;
  /** Ausdehnung (Breite x, Höhe y, Länge z) in Modell-Einheiten. */
  size: THREE.Vector3;
  /** Pro Dreieck von `body`: Original-Farbe (sRGB) – zum Umlackieren. */
  triColors: Uint32Array;
  /** Pro Dreieck von `body`: 0 = sonstiges, 1 = Wand, 2 = Akzent (nur Kits mit Atlas-Layout). */
  triClass: Uint8Array;
}

const baked = new Map<ModelName, BakedModel>();

export function getModel(name: ModelName): BakedModel | undefined {
  return baked.get(name);
}

// ------------------------------------------------------------------ Laden
const pixelCache = new Map<unknown, ImageData>();

function pixels(image: CanvasImageSource & { width: number; height: number }): ImageData {
  let data = pixelCache.get(image);
  if (!data) {
    const c = document.createElement('canvas');
    c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    data = ctx.getImageData(0, 0, c.width, c.height);
    pixelCache.set(image, data);
  }
  return data;
}

const tmpColor = new THREE.Color();
const tmpUV = new THREE.Vector2();

/** Farbe (sRGB-Hex) eines Materials an einer UV-Koordinate. */
function sampleColor(mat: THREE.MeshStandardMaterial, u: number, v: number): number {
  const base = mat.color.getHex(THREE.SRGBColorSpace);
  if (!mat.map?.image) return base;
  // KHR_texture_transform landet in offset/repeat/rotation der Textur
  mat.map.updateMatrix();
  tmpUV.set(u, v).applyMatrix3(mat.map.matrix);
  u = tmpUV.x; v = tmpUV.y;
  const img = pixels(mat.map.image);
  const x = Math.min(img.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * img.height)));
  const o = (y * img.width + x) * 4;
  const mul = (s: number, b: number) => Math.round((s * b) / 255);
  return (mul(img.data[o], (base >> 16) & 255) << 16) | (mul(img.data[o + 1], (base >> 8) & 255) << 8) | mul(img.data[o + 2], base & 255);
}

const inRect = (u: number, v: number, r: UVRect) => u >= r[0] && u < r[2] && v >= r[1] && v < r[3];

function bake(scene: THREE.Object3D, src: Source): BakedModel {
  scene.updateMatrixWorld(true);
  const parts: { pos: number[]; nor: number[]; hex: number[]; cls: number[] } = { pos: [], nor: [], hex: [], cls: [] };
  const glass: typeof parts = { pos: [], nor: [], hex: [], cls: [] };
  const p = new THREE.Vector3(), n = new THREE.Vector3(), normalMat = new THREE.Matrix3();
  const box = new THREE.Box3();
  const skipped = (o: THREE.Object3D | null): boolean => !!o && (!!src.skip?.test(o.name) || skipped(o.parent));

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (skipped(mesh)) { box.expandByObject(mesh); return; }
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv');
    normalMat.getNormalMatrix(mesh.matrixWorld);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      for (let i = grp.start; i < grp.start + grp.count; i += 3) {
        const u = uv ? (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3 : 0;
        const v = uv ? (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3 : 0;
        const hex = sampleColor(mat, u, v);
        const out = uv && src.glass.some((r) => inRect(u, v, r)) ? glass : parts;
        out.hex.push(hex);
        out.cls.push(!uv ? 0 : src.wall?.some((r) => inRect(u, v, r)) ? 1 : src.accent?.some((r) => inRect(u, v, r)) ? 2 : 0);
        for (let k = i; k < i + 3; k++) {
          p.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
          out.pos.push(p.x, p.y, p.z);
          if (nor) n.fromBufferAttribute(nor, k).applyMatrix3(normalMat).normalize();
          else n.set(0, 1, 0);
          out.nor.push(n.x, n.y, n.z);
        }
      }
    }
  });

  // Mitte unten auf den Ursprung legen (übersprungene Räder zählen für die Bodenhöhe mit)
  for (let i = 0; i < parts.pos.length; i += 3) box.expandByPoint(p.set(parts.pos[i], parts.pos[i + 1], parts.pos[i + 2]));
  for (let i = 0; i < glass.pos.length; i += 3) box.expandByPoint(p.set(glass.pos[i], glass.pos[i + 1], glass.pos[i + 2]));
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2, y0 = box.min.y;

  const build = (d: typeof parts) => {
    if (!d.hex.length) return null;
    for (let i = 0; i < d.pos.length; i += 3) { d.pos[i] -= cx; d.pos[i + 1] -= y0; d.pos[i + 2] -= cz; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(triangleColors(d.hex, palmaraize), 3));
    g.computeBoundingSphere();
    return g;
  };
  return {
    body: build(parts)!,
    glass: build(glass),
    size: box.getSize(new THREE.Vector3()),
    triColors: Uint32Array.from(parts.hex),
    triClass: Uint8Array.from(parts.cls),
  };
}

/** Vertex-Farben (linear) aus einer Farbe pro Dreieck. */
export function triangleColors(hex: ArrayLike<number>, map: (h: number) => number): Float32Array {
  const arr = new Float32Array(hex.length * 9);
  for (let t = 0; t < hex.length; t++) {
    tmpColor.setHex(map(hex[t]));
    for (let k = 0; k < 3; k++) arr.set([tmpColor.r, tmpColor.g, tmpColor.b], t * 9 + k * 3);
  }
  return arr;
}

/** Alle Modelle laden (parallel). Fehlende Dateien sind kein Fehler – dann eben prozedural. */
export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader();
  const base = 'assets/';
  const entries = Object.entries(MANIFEST) as [ModelName, [Source, string]][];
  let done = 0;
  await Promise.all(entries.map(async ([name, [src, file]]) => {
    try {
      const gltf = await loader.loadAsync(base + src.dir + file);
      baked.set(name, bake(gltf.scene, src));
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of [m.material].flat()) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
      });
    } catch (err) {
      console.warn(`[assets] ${file} nicht geladen – prozeduraler Ersatz.`, err);
    }
    onProgress?.(++done, entries.length);
  }));
  pixelCache.clear();
}
