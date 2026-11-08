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
interface Source { dir: string; glass: UVRect[] }
const KAYKIT: Source = { dir: 'kaykit/city-builder-bits/', glass: [] };
const KAYKIT_BUILDINGS: Source = { dir: KAYKIT.dir, glass: [[0, 0.75, 0.25, 1]] };
const KENNEY_CITY: Source = { dir: 'kenney/starter-kit-city-builder/models/', glass: [[0, 0.75, 0.125, 1]] };
const KENNEY_RACING: Source = { dir: 'kenney/starter-kit-racing/models/', glass: [] };

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
  const parts: { pos: number[]; nor: number[]; hex: number[] } = { pos: [], nor: [], hex: [] };
  const glass: typeof parts = { pos: [], nor: [], hex: [] };
  const p = new THREE.Vector3(), n = new THREE.Vector3(), normalMat = new THREE.Matrix3();

  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
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

  // Mitte unten auf den Ursprung legen
  const box = new THREE.Box3();
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
