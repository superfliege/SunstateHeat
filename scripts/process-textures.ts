// Verarbeitet (fotorealistische) CC0-Texturen zu kleinen Pixeltexturen im Palmara-Look –
// reproduzierbar, ohne Handarbeit:
//   1. auf 64 x 64 bzw. 128 x 128 px verkleinern (Flächenmittel)
//   2. leicht nachschärfen (Unsharp-Mask 3 x 3)
//   3. auf max. 16–24 Farben reduzieren (Median-Cut), diese Farben zur Zonen-Palette ziehen
//      und "in der Sonne ausbleichen"
//   4. als PNG nach client/public/assets/textures/ schreiben + index.json
// Das Spiel ersetzt damit beim Start die gleichnamige prozedurale Textur (materials/library.ts).
//
// Aufruf:  npm run textures
// Konfiguration: assets-src/textures/textures.json, z. B.
//   [{ "name": "asphalt_worn", "source": "polyhaven/asphalt_02_diff_1k.jpg", "palette": "port" }]
// Felder: name (Material aus library.ts), source (relativ zu assets-src/textures/),
//         size (64|128, Standard 64), palette (MoodId oder "master"), colors (Standard 16),
//         sharpen (0..1, Standard 0.5), bleach (0..1, Standard 0.25)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { MOODS, PALMARA, type MoodId } from '../client/src/render/palette';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src', 'textures');
const OUT = join(ROOT, 'client', 'public', 'assets', 'textures');

interface Job { name: string; source: string; size?: number; palette?: MoodId | 'master'; colors?: number; sharpen?: number; bleach?: number }
interface Img { w: number; h: number; d: Float32Array } // RGBA 0..255

function decode(file: string): Img {
  const buf = readFileSync(file);
  if (/\.png$/i.test(file)) {
    const p = PNG.sync.read(buf);
    return { w: p.width, h: p.height, d: Float32Array.from(p.data) };
  }
  const j = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { w: j.width, h: j.height, d: Float32Array.from(j.data) };
}

/** Flächenmittel: jedes Zielpixel = Mittel aller überdeckten Quellpixel (keine Aliasing-Artefakte). */
function downscale(src: Img, size: number): Img {
  const out = new Float32Array(size * size * 4);
  const sx = src.w / size, sy = src.h / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let j = Math.floor(y * sy); j < Math.floor((y + 1) * sy); j++) {
        for (let i = Math.floor(x * sx); i < Math.floor((x + 1) * sx); i++) {
          const o = (j * src.w + i) * 4;
          for (let k = 0; k < 4; k++) acc[k] += src.d[o + k];
          n++;
        }
      }
      for (let k = 0; k < 4; k++) out[(y * size + x) * 4 + k] = acc[k] / Math.max(1, n);
    }
  }
  return { w: size, h: size, d: out };
}

/** Unsharp-Mask mit 3x3-Box, kachelbar (Ränder laufen herum). */
function sharpen(img: Img, amount: number): Img {
  const { w, h, d } = img;
  const out = new Float32Array(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += d[(((y + dy + h) % h) * w + ((x + dx + w) % w)) * 4 + k];
        const o = (y * w + x) * 4 + k;
        out[o] = Math.max(0, Math.min(255, d[o] + (d[o] - s / 9) * amount * 2));
      }
      out[(y * w + x) * 4 + 3] = d[(y * w + x) * 4 + 3];
    }
  }
  return { w, h, d: out };
}

/** Median-Cut: teilt die Farbbox mit der größten Ausdehnung, bis n Boxen da sind. */
function medianCut(img: Img, n: number): number[][] {
  const px: number[][] = [];
  for (let i = 0; i < img.d.length; i += 4) px.push([img.d[i], img.d[i + 1], img.d[i + 2]]);
  let boxes = [px];
  while (boxes.length < n) {
    let bi = -1, best = -1, axis = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let k = 0; k < 3; k++) {
        let lo = 255, hi = 0;
        for (const p of b) { lo = Math.min(lo, p[k]); hi = Math.max(hi, p[k]); }
        if (hi - lo > best) { best = hi - lo; bi = i; axis = k; }
      }
    });
    if (bi < 0 || best < 2) break;
    const b = boxes[bi].sort((p, q) => p[axis] - q[axis]);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, bi), b.slice(0, mid), b.slice(mid), ...boxes.slice(bi + 1)];
  }
  return boxes.map((b) => [0, 1, 2].map((k) => b.reduce((s, p) => s + p[k], 0) / b.length));
}

const rgb = (h: number) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Farbe zur nächsten Palettenfarbe ziehen (40 %), leicht sättigen, ausbleichen. */
function toPalette(c: number[], pal: number[][], bleach: number): number[] {
  let best = pal[0], bd = Infinity;
  for (const p of pal) {
    const d = 2 * (p[0] - c[0]) ** 2 + 4 * (p[1] - c[1]) ** 2 + 3 * (p[2] - c[2]) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  let [r, g, b] = c.map((v, k) => v + (best[k] - v) * 0.4);
  const grey = (r + g + b) / 3;
  [r, g, b] = [r, g, b].map((v) => grey + (v - grey) * 1.08);
  // Sonne: Schwarz anheben, leicht entsättigen, warm verschieben
  [r, g, b] = [r, g, b].map((v) => v + (grey - v) * 0.25 * bleach + (255 - v) * 0.1 * bleach);
  return [r + 4 * bleach, g, b - 5 * bleach].map((v) => Math.max(0, Math.min(255, Math.round(v))));
}

function run() {
  let jobs: Job[];
  try {
    jobs = JSON.parse(readFileSync(join(SRC, 'textures.json'), 'utf8')) as Job[];
  } catch {
    console.log(`Keine Konfiguration gefunden (${join('assets-src', 'textures', 'textures.json')}). Nichts zu tun.`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const index: { name: string; file: string }[] = [];
  for (const job of jobs) {
    const size = job.size === 128 ? 128 : 64;
    const palHex = !job.palette || job.palette === 'master' ? PALMARA : [...MOODS[job.palette].palette, ...PALMARA.slice(0, 8)];
    const pal = palHex.map(rgb);
    let img = downscale(decode(join(SRC, job.source)), size);
    img = sharpen(img, job.sharpen ?? 0.5);
    const colors = Math.max(4, Math.min(24, job.colors ?? 16));
    const centers = medianCut(img, colors).map((c) => ({ src: c, out: toPalette(c, pal, job.bleach ?? 0.25) }));
    const png = new PNG({ width: size, height: size });
    for (let i = 0; i < size * size; i++) {
      const p = [img.d[i * 4], img.d[i * 4 + 1], img.d[i * 4 + 2]];
      let best = centers[0], bd = Infinity;
      for (const c of centers) {
        const d = (c.src[0] - p[0]) ** 2 + (c.src[1] - p[1]) ** 2 + (c.src[2] - p[2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      png.data[i * 4] = best.out[0]; png.data[i * 4 + 1] = best.out[1]; png.data[i * 4 + 2] = best.out[2];
      png.data[i * 4 + 3] = img.d[i * 4 + 3] < 128 ? 0 : 255;
    }
    const file = `${job.name}.png`;
    writeFileSync(join(OUT, file), PNG.sync.write(png));
    index.push({ name: job.name, file });
    console.log(`  ${job.source} -> textures/${file} (${size}px, ${centers.length} Farben, Palette ${job.palette ?? 'master'})`);
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`Texturen: ${index.length} verarbeitet.`);
}

run();
