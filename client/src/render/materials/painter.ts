// Kleiner Pixel-Maler für handgemalt wirkende, nahtlos kachelbare Texturen (64 x 64 px).
// Alle Koordinaten laufen "um den Rand herum" (wrap), damit nichts an Kachelgrenzen abreißt.
import { mulberry32 } from '../../../../shared/src/math';

export const TEX = 64;

const r8 = (h: number) => (h >> 16) & 255, g8 = (h: number) => (h >> 8) & 255, b8 = (h: number) => h & 255;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function shade(hex: number, k: number): number {
  return (clamp(r8(hex) * k) << 16) | (clamp(g8(hex) * k) << 8) | clamp(b8(hex) * k);
}
export function mixHex(a: number, b: number, t: number): number {
  return (clamp(r8(a) + (r8(b) - r8(a)) * t) << 16) | (clamp(g8(a) + (g8(b) - g8(a)) * t) << 8) | clamp(b8(a) + (b8(b) - b8(a)) * t);
}

export class Painter {
  readonly data: Uint8ClampedArray;
  readonly rnd: () => number;
  constructor(readonly size = TEX, seed = 1) {
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rnd = mulberry32(seed);
  }

  private idx(x: number, y: number) {
    const s = this.size;
    x = ((Math.floor(x) % s) + s) % s; y = ((Math.floor(y) % s) + s) % s;
    return (y * s + x) * 4;
  }
  set(x: number, y: number, hex: number, a = 255) {
    const i = this.idx(x, y);
    this.data[i] = r8(hex); this.data[i + 1] = g8(hex); this.data[i + 2] = b8(hex); this.data[i + 3] = a;
  }
  get(x: number, y: number): number {
    const i = this.idx(x, y);
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }
  alpha(x: number, y: number) { return this.data[this.idx(x, y) + 3]; }
  /** Farbe mit Deckkraft t auf vorhandenen Pixel mischen. */
  blend(x: number, y: number, hex: number, t: number) {
    const i = this.idx(x, y);
    if (this.data[i + 3] === 0) { this.set(x, y, hex, Math.round(255 * t)); return; }
    this.set(x, y, mixHex(this.get(x, y), hex, t), Math.max(this.data[i + 3], Math.round(255 * t)));
  }
  mul(x: number, y: number, k: number) {
    const i = this.idx(x, y);
    this.data[i] = clamp(this.data[i] * k); this.data[i + 1] = clamp(this.data[i + 1] * k); this.data[i + 2] = clamp(this.data[i + 2] * k);
  }

  fill(hex: number, a = 255) { for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, hex, a); return this; }
  clear() { this.data.fill(0); return this; }
  rect(x: number, y: number, w: number, h: number, hex: number, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, hex, a);
    return this;
  }
  /** Helligkeitsrauschen pro Pixel (±amount). */
  grain(amount: number, cell = 1) {
    for (let y = 0; y < this.size; y += cell) {
      for (let x = 0; x < this.size; x += cell) {
        const k = 1 + (this.rnd() * 2 - 1) * amount;
        for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) if (this.alpha(x + i, y + j)) this.mul(x + i, y + j, k);
      }
    }
    return this;
  }
  /** Weiche Flecken (wolkiges Value-Noise) zur Farbvariation. */
  blotches(hex: number, strength: number, scaleWanted = 16) {
    // Zellgröße so wählen, dass die Textur nahtlos kachelt
    const n = Math.max(1, Math.round(this.size / scaleWanted));
    const scale = this.size / n;
    const grid = Array.from({ length: n * n }, () => this.rnd());
    const at = (gx: number, gy: number) => grid[(((gy % n) + n) % n) * n + (((gx % n) + n) % n)];
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v = (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
        // gestuft -> gemalter Look statt weichem Verlauf
        const q = Math.floor(v * 4) / 4;
        if (q > 0.45) this.blend(x, y, hex, (q - 0.45) * strength * 1.8);
      }
    }
    return this;
  }
  /** Einzelne Pixel/Klumpen in Farben aus der Liste. */
  speckle(prob: number, colors: number[], size = 1) {
    for (let y = 0; y < this.size; y += size) {
      for (let x = 0; x < this.size; x += size) {
        if (this.rnd() < prob) this.rect(x, y, size, size, colors[Math.floor(this.rnd() * colors.length)]);
      }
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, hex: number, a = 255) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, hex, a);
    return this;
  }
  /** Zickzack-Riss (Random Walk). */
  crack(x: number, y: number, len: number, hex: number, a = 255) {
    let dx = this.rnd() < 0.5 ? 1 : -1, dy = this.rnd() < 0.5 ? 1 : 0;
    for (let i = 0; i < len; i++) {
      this.set(x, y, hex, a);
      if (this.rnd() < 0.35) { const t = dx; dx = dy || (this.rnd() < 0.5 ? 1 : -1); dy = t; }
      x += dx; y += dy || (this.rnd() < 0.3 ? 1 : 0);
      if (this.rnd() < 0.08) this.crack(x, y, Math.floor(len / 3), hex, a);
    }
    return this;
  }
  disc(cx: number, cy: number, r: number, hex: number, a = 255) {
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) if (x * x + y * y <= r * r) this.set(cx + x, cy + y, hex, a);
    return this;
  }
  ring(cx: number, cy: number, r0: number, r1: number, hex: number, a = 255) {
    for (let y = -Math.ceil(r1); y <= Math.ceil(r1); y++) {
      for (let x = -Math.ceil(r1); x <= Math.ceil(r1); x++) {
        const d = x * x + y * y;
        if (d <= r1 * r1 && d >= r0 * r0) this.set(cx + x, cy + y, hex, a);
      }
    }
    return this;
  }
  /** Weicher, gerasterter Kreis (Ordered Dithering) – für Lichtkegel, Pfützen, Ölflecken. */
  ditherDisc(cx: number, cy: number, r: number, hex: number, falloff = 1) {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
      for (let x = -Math.ceil(r); x <= Math.ceil(r); x++) {
        const d = Math.sqrt(x * x + y * y) / r;
        if (d > 1) continue;
        const v = Math.pow(1 - d, falloff);
        const th = (bayer[((y + 64) % 4) * 4 + ((x + 64) % 4)] + 0.5) / 16;
        if (v > th) this.set(cx + x, cy + y, hex);
      }
    }
    return this;
  }
  /** Ziegel-/Plattenverband. */
  bricks(w: number, h: number, mortar: number, colors: number[], offset = 0.5, jitter = 0.08) {
    for (let row = 0; row * h < this.size; row++) {
      const off = Math.floor((row % 2) * w * offset);
      for (let col = -1; col * w < this.size; col++) {
        const c = shade(colors[Math.floor(this.rnd() * colors.length)], 1 + (this.rnd() * 2 - 1) * jitter);
        this.rect(col * w + off, row * h, w - 1, h - 1, c);
        this.rect(col * w + off + w - 1, row * h, 1, h, mortar);
        this.rect(col * w + off, row * h + h - 1, w, 1, mortar);
        // Lichtkante oben links -> "gemalt"
        this.rect(col * w + off, row * h, w - 1, 1, shade(c, 1.12));
      }
    }
    return this;
  }
  /** Bretter (vertical = senkrechte Bretter). */
  planks(width: number, colors: number[], gap: number, vertical = false) {
    for (let k = 0; k * width < this.size; k++) {
      const c = colors[Math.floor(this.rnd() * colors.length)];
      for (let a = 0; a < width; a++) {
        for (let b = 0; b < this.size; b++) {
          const [x, y] = vertical ? [k * width + a, b] : [b, k * width + a];
          this.set(x, y, a === width - 1 ? gap : a === 0 ? shade(c, 1.1) : c);
        }
      }
      // Stoßfugen und Maserung
      const joint = Math.floor(this.rnd() * this.size);
      for (let a = 0; a < width - 1; a++) {
        const [x, y] = vertical ? [k * width + a, joint] : [joint, k * width + a];
        this.set(x, y, gap);
      }
      for (let g = 0; g < 3; g++) {
        const s = Math.floor(this.rnd() * this.size), l = 4 + Math.floor(this.rnd() * 10), a = 1 + Math.floor(this.rnd() * (width - 2));
        for (let b = 0; b < l; b++) {
          const [x, y] = vertical ? [k * width + a, s + b] : [s + b, k * width + a];
          this.set(x, y, shade(c, 0.88));
        }
      }
    }
    return this;
  }
  /** Begrenzt alle Farben auf die nächsten Palettenfarben (inkl. je einer helleren/dunkleren Stufe). */
  quantize(palette: number[]) {
    const pal: number[] = [];
    for (const c of palette) pal.push(c, shade(c, 0.84), shade(c, 1.1));
    const cache = new Map<number, number>();
    for (let i = 0; i < this.data.length; i += 4) {
      if (!this.data[i + 3]) continue;
      const hex = (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
      let out = cache.get(hex);
      if (out === undefined) {
        let best = pal[0], bd = Infinity;
        for (const p of pal) {
          const d = 2 * (r8(p) - this.data[i]) ** 2 + 4 * (g8(p) - this.data[i + 1]) ** 2 + 3 * (b8(p) - this.data[i + 2]) ** 2;
          if (d < bd) { bd = d; best = p; }
        }
        // nicht hart einrasten: 55 % Palette, 45 % Original -> bleibt "gemalt", nicht posterisiert
        out = mixHex(hex, best, 0.55);
        cache.set(hex, out);
      }
      this.data[i] = r8(out); this.data[i + 1] = g8(out); this.data[i + 2] = b8(out);
    }
    return this;
  }
  /** Ausbleichen in der Sonne: Schwarz anheben, leicht entsättigen, warm verschieben. */
  sunBleach(amount: number) {
    for (let i = 0; i < this.data.length; i += 4) {
      const r = this.data[i], g = this.data[i + 1], b = this.data[i + 2];
      const grey = (r + g + b) / 3;
      const f = (v: number) => v + (grey - v) * 0.25 * amount + (255 - v) * 0.1 * amount;
      this.data[i] = clamp(f(r) + 4 * amount); this.data[i + 1] = clamp(f(g)); this.data[i + 2] = clamp(f(b) - 5 * amount);
    }
    return this;
  }
}
