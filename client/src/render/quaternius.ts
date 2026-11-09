// Quaternius-Packs (CC0, siehe CREDITS.md) entdecken, laden und vereinheitlichen.
//
// Die Packs werden einfach unter client/public/assets/quaternius/<pack>/ abgelegt (glTF/GLB,
// dazu das Kenney Nature Kit unter assets/kenney/nature-kit/ – Palmen, Laubbäume, Felsen;
// Ordnerstruktur egal). Der Vite-Plugin in vite.config.ts liefert die Dateiliste als
// assets/manifest.json; hier werden die Dateien anhand ihres Namens einsortiert:
//   Vegetation: Palmen, Laubbäume, Kiefern, knorrige Bäume, Büsche, Felsen, Gras, Farne, Blumen,
//               Schilf, Seerosen, Kakteen  -> instanzierbare Geometrie (+ Wind-Gewicht)
//   Figuren:    Ultimate Modular Men/Women -> Skelett, Animationen, Körperteile (characters.ts)
// Einheitlicher Look: jedes Material wird zum Toon-Material, Farben werden palmaraisiert,
// Texturen auf max. 64–128 px verkleinert und auf die Palette gezogen (Nearest-Neighbor).
// Fehlt etwas, bleibt die Liste leer und das Spiel nutzt die prozeduralen Modelle.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addHeightWind, computeOutlineNormals, toonMaterial } from './materials/toon';
import { palmaraize, sunlit } from './palette';

// ------------------------------------------------------------------ Manifest
export async function fetchManifest(): Promise<string[]> {
  try {
    const res = await fetch('assets/manifest.json');
    if (!res.ok) return [];
    const data = (await res.json()) as { files?: string[] };
    return data.files ?? [];
  } catch {
    return [];
  }
}

const baseName = (p: string) => p.split('/').pop()!.replace(/\.(gltf|glb)$/i, '').toLowerCase();

// ------------------------------------------------------------------ Texturen vereinheitlichen
const texCache = new Map<unknown, THREE.Texture>();

/** Textur verkleinern (max. `max` px), Farben palmaraisieren (Pflanzen: nur sanft), Nearest-Neighbor. */
export function pixelizeTexture(src: THREE.Texture, max = 64, natural = false): THREE.Texture {
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return src;
  const hit = texCache.get(img);
  if (hit) return hit;
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true; // Flächenmittel beim Verkleinern
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const p = (natural ? sunlit : palmaraize)((d.data[i] << 16) | (d.data[i + 1] << 8) | d.data[i + 2]);
    d.data[i] = (p >> 16) & 255; d.data[i + 1] = (p >> 8) & 255; d.data[i + 2] = p & 255;
    d.data[i + 3] = d.data[i + 3] < 128 ? 0 : 255; // harte Alpha-Kante
  }
  ctx.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.wrapS = src.wrapS; t.wrapT = src.wrapT;
  t.flipY = src.flipY;
  t.colorSpace = THREE.SRGBColorSpace;
  t.offset.copy(src.offset); t.repeat.copy(src.repeat); t.rotation = src.rotation; t.center.copy(src.center);
  texCache.set(img, t);
  return t;
}

/** Hat die Textur nennenswert transparente Pixel (Blattkarten)? */
function hasAlpha(tex: THREE.Texture | null): boolean {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return false;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) return true;
  return false;
}

// ------------------------------------------------------------------ Vegetation
export const VEG_CATEGORIES = ['palm', 'broadleaf', 'pine', 'twisted', 'bush', 'rock', 'grass', 'fern', 'flower', 'reed', 'lily', 'cactus'] as const;
export type VegCategory = (typeof VEG_CATEGORIES)[number];

/** Ziel-Höhe in Metern (Bäume werden zusätzlich pro Exemplar skaliert) und max. Varianten. */
const VEG_SPEC: Record<VegCategory, { height: number; max: number; wind: number; line: boolean }> = {
  palm: { height: 7.5, max: 6, wind: 1.2, line: true },
  broadleaf: { height: 6, max: 4, wind: 0.8, line: true },
  pine: { height: 8, max: 4, wind: 0.6, line: true },
  twisted: { height: 7, max: 3, wind: 0.6, line: true },
  bush: { height: 1.3, max: 4, wind: 0.6, line: true },
  rock: { height: 1.1, max: 4, wind: 0, line: true },
  grass: { height: 0.55, max: 4, wind: 1.5, line: false },
  fern: { height: 0.8, max: 3, wind: 1.2, line: false },
  flower: { height: 0.45, max: 3, wind: 1.5, line: false },
  reed: { height: 1.6, max: 2, wind: 1.6, line: false },
  lily: { height: 0.06, max: 2, wind: 0, line: false },
  cactus: { height: 2.6, max: 3, wind: 0, line: true },
};

function classifyVegetation(name: string): VegCategory | null {
  if (/snow|autumn|dead_?tree.*snow|stump|log|mushroom|path|rockpath|leaves?_?pile|wheat|corn|tile/.test(name)) return null;
  if (/palm/.test(name)) return 'palm';
  if (/cactus|cacti/.test(name)) return 'cactus';
  if (/lily|lilypad/.test(name)) return 'lily';
  if (/reed|cattail|bamboo/.test(name)) return 'reed';
  if (/pine|fir|spruce/.test(name)) return 'pine';
  if (/twisted|willow|dead|swamp|mangrove|cypress/.test(name)) return 'twisted';
  if (/bush|shrub|hedge/.test(name)) return 'bush';
  if (/rock|stone|boulder|pebble/.test(name)) return 'rock';
  if (/grass/.test(name)) return 'grass';
  if (/fern|clover|plant/.test(name)) return 'fern';
  if (/flower|tulip|daisy|rose/.test(name)) return 'flower';
  if (/tree|birch|maple|oak/.test(name)) return 'broadleaf';
  return null;
}

export interface VegPart { geometry: THREE.BufferGeometry; material: THREE.Material }
export interface VegModel { name: string; parts: VegPart[]; category: VegCategory; outline: boolean }

export const vegetation = new Map<VegCategory, VegModel[]>();

/** Alle Meshes eines glTF nach Material zusammenfassen, Ursprung unten mittig, auf Zielhöhe skaliert. */
function bakeVegetation(gltf: GLTF, cat: VegCategory, name: string): VegModel | null {
  const spec = VEG_SPEC[cat];
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const src = mesh.geometry;
    const groups = src.groups.length && mats.length > 1 ? src.groups : [{ start: 0, count: src.index ? src.index.count : src.getAttribute('position').count, materialIndex: 0 }];
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      let g = src.index ? src.toNonIndexed() : src.clone();
      if (groups.length > 1) {
        // nur die Dreiecke dieser Gruppe
        const sub = new THREE.BufferGeometry();
        for (const [k, attr] of Object.entries(g.attributes)) {
          const a = attr as THREE.BufferAttribute;
          sub.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
        }
        g = sub;
      }
      g.applyMatrix4(mesh.matrixWorld);
      // einheitliche Attribute für das Zusammenführen
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      const n = g.getAttribute('position').count;
      // uv/color immer als Float32 (glTF erlaubt normalisierte Ganzzahlen -> sonst kein Merge)
      const uvSrc = g.getAttribute('uv'), colSrc = g.getAttribute('color');
      const uv = new Float32Array(n * 2), col = new Float32Array(n * 3).fill(1);
      for (let i = 0; i < n; i++) {
        if (uvSrc) { uv[i * 2] = uvSrc.getX(i); uv[i * 2 + 1] = uvSrc.getY(i); }
        if (colSrc) { col[i * 3] = colSrc.getX(i); col[i * 3 + 1] = colSrc.getY(i); col[i * 3 + 2] = colSrc.getZ(i); }
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
    }
  });
  if (!byMat.size) return null;

  const box = new THREE.Box3();
  for (const list of byMat.values()) for (const g of list) { g.computeBoundingBox(); box.union(g.boundingBox!); }
  const size = box.getSize(new THREE.Vector3());
  const k = spec.height / Math.max(1e-3, size.y);
  const center = box.getCenter(new THREE.Vector3());
  const parts: VegPart[] = [];
  for (const [mat, list] of byMat) {
    const g = mergeGeometries(list, false);
    if (!g) continue;
    g.translate(-center.x, -box.min.y, -center.z);
    g.scale(k, k, k);
    addHeightWind(g, cat === 'palm' ? 0.55 : cat === 'grass' || cat === 'reed' || cat === 'flower' ? 0.0 : 0.3, spec.wind);
    if (spec.line) computeOutlineNormals(g);
    g.computeBoundingSphere();
    parts.push({ geometry: g, material: unifyMaterial(mat, true) });
  }
  return { name, parts, category: cat, outline: spec.line };
}

const matCache = new Map<THREE.Material, THREE.Material>();

/** Beliebiges glTF-Material -> Toon-Material mit Palmara-Farben und Pixeltextur. */
export function unifyMaterial(src: THREE.Material, wind = false): THREE.Material {
  const hit = matCache.get(src);
  if (hit) return hit;
  const s = src as THREE.MeshStandardMaterial;
  const map = s.map ? pixelizeTexture(s.map, 128, wind) : null;
  const cutout = !!map && (s.transparent || s.alphaTest > 0 || hasAlpha(s.map));
  const m = toonMaterial({
    color: (wind ? sunlit : palmaraize)(s.color?.getHex(THREE.SRGBColorSpace) ?? 0xffffff),
    map,
    vertexColors: !!s.vertexColors,
    alphaTest: cutout ? 0.5 : 0,
    side: cutout || s.side === THREE.DoubleSide ? THREE.DoubleSide : THREE.FrontSide,
    wind,
  });
  matCache.set(src, m);
  return m;
}

// ------------------------------------------------------------------ Figuren
export interface CharacterFile { name: string; path: string; gltf: GLTF }
export const characterFiles: CharacterFile[] = [];

function isCharacterPath(path: string): boolean {
  const p = path.toLowerCase();
  return /modular|character|men|women|male|female|people|person/.test(p) && !/nature|tree|plant|rock/.test(p);
}

// ------------------------------------------------------------------ Laden
export interface QuaterniusStats { vegetation: number; characters: number; files: number }

export async function loadQuaternius(onProgress?: (done: number, total: number) => void): Promise<QuaterniusStats> {
  const files = (await fetchManifest()).filter((f) => /^(quaternius|kenney\/nature-kit)\//i.test(f) && /\.(gltf|glb)$/i.test(f));
  if (!files.length) return { vegetation: 0, characters: 0, files: 0 };

  // Auswahl: je Kategorie bis zu N Modelle, reihum aus den Packs (damit sich Kenney und
  // Quaternius mischen); Figuren alle (begrenzt)
  const vegPick: [string, VegCategory][] = [];
  const charPick: string[] = [];
  const byCat = new Map<VegCategory, Map<string, string[]>>();
  for (const f of [...files].sort()) {
    if (isCharacterPath(f)) { if (charPick.length < 24) charPick.push(f); continue; }
    const cat = classifyVegetation(baseName(f));
    if (!cat) continue;
    const pack = f.split('/').slice(0, 2).join('/');
    let packs = byCat.get(cat);
    if (!packs) byCat.set(cat, (packs = new Map()));
    let list = packs.get(pack);
    if (!list) packs.set(pack, (list = []));
    list.push(f);
  }
  for (const [cat, packs] of byCat) {
    const lists = [...packs.values()];
    for (let i = 0, n = 0; n < VEG_SPEC[cat].max && lists.some((l) => i < l.length); i++) {
      for (const l of lists) if (i < l.length && n < VEG_SPEC[cat].max) { vegPick.push([l[i], cat]); n++; }
    }
  }

  const loader = new GLTFLoader();
  const total = vegPick.length + charPick.length;
  let done = 0;
  const url = (f: string) => 'assets/' + f.split('/').map(encodeURIComponent).join('/');
  await Promise.all([
    ...vegPick.map(async ([f, cat]) => {
      try {
        const gltf = await loader.loadAsync(url(f));
        const model = bakeVegetation(gltf, cat, baseName(f));
        if (model) {
          let list = vegetation.get(cat);
          if (!list) vegetation.set(cat, (list = []));
          list.push(model);
        }
      } catch (err) {
        console.warn(`[quaternius] ${f} nicht geladen`, err);
      }
      onProgress?.(++done, total);
    }),
    ...charPick.map(async (f) => {
      try {
        const gltf = await loader.loadAsync(url(f));
        characterFiles.push({ name: baseName(f), path: f.toLowerCase(), gltf });
      } catch (err) {
        console.warn(`[quaternius] ${f} nicht geladen`, err);
      }
      onProgress?.(++done, total);
    }),
  ]);
  // stabile Reihenfolge (Promise.all ist parallel)
  for (const list of vegetation.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  characterFiles.sort((a, b) => a.name.localeCompare(b.name));
  let vegCount = 0;
  for (const l of vegetation.values()) vegCount += l.length;
  console.info(`[quaternius] ${vegCount} Pflanzen/Felsen, ${characterFiles.length} Figurendateien geladen.`);
  return { vegetation: vegCount, characters: characterFiles.length, files: files.length };
}
