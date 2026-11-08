// Texture-Atlas: alle Materialtexturen (64 x 64 px) in EINER Textur, plus Emissive-Atlas
// mit identischem Layout. Jede Kachel hat einen 4-px-Rand, der mit der gekachelten Textur
// gefüllt ist -> Nearest-Neighbor und die (auf 2 Stufen begrenzten) Mipmaps bluten nicht.
import * as THREE from 'three';
import { finalizeTint, MATERIALS, paletteOf, type MaterialDef } from './library';
import { Painter, TEX } from './painter';

export const ATLAS_COLS = 16;
export const ATLAS_GUTTER = 4;
export const ATLAS_CELL = TEX + ATLAS_GUTTER * 2;

export interface Atlas {
  color: THREE.DataTexture;
  emissive: THREE.DataTexture;
  width: number;
  height: number;
  /** vec4(cols, cell, 1/width, 1/height) für die Shader. */
  info: THREE.Vector4;
}

let atlas: Atlas | null = null;
/** Von scripts/process-textures.ts erzeugte Texturen (Name -> Pixel), optional. */
const overrides = new Map<string, ImageData>();

/** Verarbeitete Texturen laden (assets/textures/index.json). Fehlt die Datei, bleibt alles prozedural. */
export async function loadTextureOverrides(): Promise<number> {
  try {
    const res = await fetch('assets/textures/index.json');
    if (!res.ok) return 0;
    const list = (await res.json()) as { name: string; file: string }[];
    await Promise.all(list.map(async ({ name, file }) => {
      const img = new Image();
      img.src = 'assets/textures/' + file;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = TEX;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, TEX, TEX);
      overrides.set(name, ctx.getImageData(0, 0, TEX, TEX));
    }));
    return overrides.size;
  } catch {
    return 0;
  }
}

/** Rendert eine Material-Kachel (Farbe + Emissive). */
export function paintMaterial(def: MaterialDef, seed: number): { color: Painter; emissive: Painter | null } {
  const color = new Painter(TEX, seed * 977 + 13);
  const ov = overrides.get(def.file ?? def.name);
  if (ov) {
    color.data.set(ov.data);
  } else {
    def.paint(color);
    // Opake Texturen: Alpha ist Tönungsmaske -> vorübergehend voll setzen, damit alle Pixel
    // quantisiert werden; Decals: transparente Pixel bleiben unangetastet.
    const mask = def.decal ? null : Uint8ClampedArray.from({ length: TEX * TEX }, (_, i) => color.data[i * 4 + 3]);
    if (mask) for (let i = 0; i < mask.length; i++) color.data[i * 4 + 3] = 255;
    if (def.bleach) color.sunBleach(def.bleach);
    color.quantize(paletteOf(def.palette));
    if (mask) for (let i = 0; i < mask.length; i++) color.data[i * 4 + 3] = mask[i];
  }
  finalizeTint(def, color);
  let emissive: Painter | null = null;
  if (def.emissive) {
    emissive = new Painter(TEX, seed * 31 + 7);
    def.emissive(emissive);
  }
  return { color, emissive };
}

export function getAtlas(): Atlas {
  if (atlas) return atlas;
  const rows = Math.ceil(MATERIALS.length / ATLAS_COLS);
  const width = ATLAS_COLS * ATLAS_CELL, height = rows * ATLAS_CELL;
  const color = new Uint8Array(width * height * 4);
  const emissive = new Uint8Array(width * height * 4);
  MATERIALS.forEach((def, i) => {
    const { color: c, emissive: e } = paintMaterial(def, i + 1);
    const ox = (i % ATLAS_COLS) * ATLAS_CELL, oy = Math.floor(i / ATLAS_COLS) * ATLAS_CELL;
    for (let y = 0; y < ATLAS_CELL; y++) {
      for (let x = 0; x < ATLAS_CELL; x++) {
        // Rand = gekachelte Fortsetzung der Textur
        const sx = (((x - ATLAS_GUTTER) % TEX) + TEX) % TEX, sy = (((y - ATLAS_GUTTER) % TEX) + TEX) % TEX;
        const si = (sy * TEX + sx) * 4, di = ((oy + y) * width + ox + x) * 4;
        for (let k = 0; k < 4; k++) color[di + k] = c.data[si + k];
        if (e) { for (let k = 0; k < 3; k++) emissive[di + k] = e.data[si + k]; emissive[di + 3] = 255; }
      }
    }
  });
  const mk = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapNearestFilter;
    t.generateMipmaps = true;
    t.flipY = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  atlas = {
    color: mk(color, true),
    emissive: mk(emissive, true),
    width, height,
    info: new THREE.Vector4(ATLAS_COLS, ATLAS_CELL, 1 / width, 1 / height),
  };
  return atlas;
}

/** Eigenständige Textur aus einem Bibliotheksmaterial (für Sprites, Blob-Schatten, Lichtkegel). */
export function standaloneTexture(name: string): THREE.DataTexture {
  const i = MATERIALS.findIndex((m) => m.name === name);
  const { color } = paintMaterial(MATERIALS[i], i + 1);
  const t = new THREE.DataTexture(new Uint8Array(color.data.buffer.slice(0)), TEX, TEX, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** GLSL: Atlas-Abtastung mit begrenzter Mip-Stufe (max. 2 -> Pixel-Look bleibt erhalten). */
export const ATLAS_GLSL = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform sampler2D uAtlasE;
  uniform vec4 uAtlasInfo; // cols, cell, 1/w, 1/h
  vec2 atlasBase(float idx) {
    float col = mod(idx, uAtlasInfo.x);
    float row = floor(idx / uAtlasInfo.x);
    return vec2(col, row) * uAtlasInfo.y + ${ATLAS_GUTTER.toFixed(1)};
  }
  // Ableitungen werden außerhalb von Verzweigungen berechnet und hier übergeben
  vec4 atlasSampleGrad(sampler2D t, float idx, vec2 uv, vec2 duvdx, vec2 duvdy) {
    vec2 px = atlasBase(idx) + fract(uv) * ${TEX.toFixed(1)};
    vec2 gx = duvdx * ${TEX.toFixed(1)}, gy = duvdy * ${TEX.toFixed(1)};
    float m = max(length(gx), length(gy));
    if (m > 4.0) { gx *= 4.0 / m; gy *= 4.0 / m; }
    return textureGrad(t, px * uAtlasInfo.zw, gx * uAtlasInfo.zw, gy * uAtlasInfo.zw);
  }
  vec4 atlasSample(sampler2D t, float idx, vec2 uv) {
    return atlasSampleGrad(t, idx, uv, dFdx(uv), dFdy(uv));
  }
`;
