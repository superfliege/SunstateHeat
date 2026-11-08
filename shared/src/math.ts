// Kleine Mathe-Helfer, die auf beiden Seiten gebraucht werden.

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Bewegt `cur` um höchstens `maxDelta` in Richtung `target`. */
export function approach(cur: number, target: number, maxDelta: number): number {
  if (cur < target) return Math.min(cur + maxDelta, target);
  return Math.max(cur - maxDelta, target);
}

/** Normalisiert einen Winkel auf (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Interpoliert Winkel über den kürzesten Weg. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Dreht Winkel `a` mit maximal `maxDelta` in Richtung `b`. */
export function approachAngle(a: number, b: number, maxDelta: number): number {
  const d = wrapAngle(b - a);
  if (Math.abs(d) <= maxDelta) return b;
  return wrapAngle(a + Math.sign(d) * maxDelta);
}

export function dist2(ax: number, az: number, bx: number, bz: number) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** Deterministischer Zufallsgenerator (gleicher Seed -> gleiche Folge). */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Einfaches 2D-Value-Noise (0..1), deterministisch. */
export function makeValueNoise(seed: number): (x: number, z: number) => number {
  const hash = (ix: number, iz: number) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 982451653)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
  };
}

/** Rundet für kompaktere Netzwerk-Nachrichten. */
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const r3 = (v: number) => Math.round(v * 1000) / 1000;
