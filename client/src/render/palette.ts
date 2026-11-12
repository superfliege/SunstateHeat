// Zentrale Farbdefinition von Palmara – EINE Datei für alle Farben der Darstellung:
//   1. PALMARA: Master-Palette (Sonnenuntergang, Meer, Neon, ausgeblichene Pastelltöne)
//      + palmaraize(): zieht Fremdfarben (Kits, Texturen) zur Palette -> alles passt zusammen
//   2. MOODS: Stimmung je Zone/Viertel (Dunst, Sättigung, Wärme, Neon-Anteil)
//   3. SKY_KEYS: Tageszeit-Verlauf (Himmel 3-stufig, Sonne, Umgebungslicht, Sonnenhöhe)
// Werte sind sRGB-Hex; Three.js rechnet sie beim Setzen in linear um.
import { Zone } from '../../../shared/src/world/WorldMap';

// ------------------------------------------------------------------ Master-Palette
/** Weiche, gesättigte Pastell- und Sonnenuntergangstöne statt reiner Grundfarben (sRGB). */
export const PALMARA = [
  // Sonnenuntergang
  0xff7eb0, 0xff9f5a, 0x9a6bd8, 0xffc9a8, 0xff8577, 0xffb36b,
  // Meer
  0x3fd8cc, 0x2a5f9e, 0x74d2f2, 0x9fe8de,
  // Neon
  0xff4fae, 0x4ff2ff, 0xffe468, 0x6dff9c,
  // Pastellputz (Ocean Strip)
  0xffc2d6, 0xb4f0d8, 0xa8dcf5, 0xfff0a0, 0xffb4a0,
  // Neutral, ausgeblichen
  0xf7f0e4, 0xf2dca8, 0xb3aab0, 0x5e5a6e, 0x2c2a40,
  // Grün
  0x52b85a, 0x356f45, 0x8fcc72, 0xb8c46a,
  // Holz, Erde, Ziegel
  0x9a7652, 0x6e4e32, 0xd4583f, 0xc0703f,
];

/** Wie stark Fremdfarben zur Palette gezogen werden (0 = gar nicht, 1 = exakt Palette). */
const PULL = 0.4;
const SATURATE = 1.1;
/** "Florida-Sonne": Schwarz wird leicht angehoben (ausgeblichen), Farben minimal warm. */
const LIFT = 14;

const rgb = (hex: number) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const PAL_RGB = PALMARA.map(rgb);
const cache = new Map<number, number>();

/** Nächste Palettenfarbe (gewichteter RGB-Abstand). */
export function nearestPalette(r: number, g: number, b: number, pal = PAL_RGB): number[] {
  let best = pal[0], bestD = Infinity;
  for (const p of pal) {
    const d = 2 * (p[0] - r) ** 2 + 4 * (p[1] - g) ** 2 + 3 * (p[2] - b) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Farbe (sRGB-Hex) an die Palmara-Palette angleichen. */
export function palmaraize(hex: number): number {
  const hit = cache.get(hex);
  if (hit !== undefined) return hit;
  let [r, g, b] = rgb(hex);
  const best = nearestPalette(r, g, b);
  r += (best[0] - r) * PULL; g += (best[1] - g) * PULL; b += (best[2] - b) * PULL;
  const grey = (r + g + b) / 3;
  const lift = (v: number) => LIFT + v * (1 - LIFT / 255);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const out = (clamp(lift(grey + (r - grey) * SATURATE) * 1.02) << 16)
    | (clamp(lift(grey + (g - grey) * SATURATE)) << 8)
    | clamp(lift(grey + (b - grey) * SATURATE) * 0.97);
  cache.set(hex, out);
  return out;
}

/**
 * Sanfte Variante für Pflanzen: kein Zug zur Palette (sonst kippen Grüntöne nach Türkis oder Braun),
 * nur dieselbe Sonnen-Anhebung, etwas mehr Sättigung und ein Hauch Wärme.
 */
export function sunlit(hex: number): number {
  let [r, g, b] = rgb(hex);
  // Mint/Türkis (Kenney-Grün, Farbton ~140–175°) Richtung sattes Blattgrün (~105°) drehen
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === g && max - min > 30) {
    const hue = 120 + 60 * (b - r) / (max - min);
    if (hue > 128 && hue < 185) {
      const t = (hue - 105) / 60; // 0 = Ziel
      const k = Math.min(1, Math.max(0, t));
      const newB = min + (b - min) * (1 - 0.75 * k);
      const newR = r + (max - min) * 0.08 * k;
      g *= 1 - 0.1 * k; // etwas dunkler, sattes Tropengrün statt Limette
      r = newR; b = newB;
    }
  }
  const grey = (r + g + b) / 3;
  const lift = (v: number) => LIFT * 0.6 + v * (1 - (LIFT * 0.6) / 255);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (clamp(lift(grey + (r - grey) * 1.08) * 1.03) << 16) | (clamp(lift(grey + (g - grey) * 1.08)) << 8) | clamp(lift(grey + (b - grey) * 1.08) * 0.95);
}

/** Ist die Farbe "Glas" (bläulich, eher dunkel)? Daraus werden nachts leuchtende Fenster. */
export function isGlass(hex: number): boolean {
  const [r, g, b] = rgb(hex);
  return b > r + 25 && b >= g && b < 235 && r + g + b < 560;
}

// ------------------------------------------------------------------ Zonen-Stimmung
export type MoodId = 'ocean' | 'keys' | 'downtown' | 'havana' | 'port' | 'swamp' | 'pine' | 'highlands' | 'town';

export interface Mood {
  /** Farbe des Dunstes (wird mit der Himmelsfarbe am Horizont gemischt). */
  fog: number;
  /** Anteil der Zonenfarbe am Dunst (0..1). */
  fogTint: number;
  /** Sichtweite-Faktor (1 = normal, < 1 = dichterer Dunst). */
  fogRange: number;
  /** Zusätzlicher Morgennebel (Gator Flats). */
  morningFog: number;
  /** Farbkorrektur im Post-Processing: Sättigung, Wärme (-1..1), Helligkeit. */
  saturation: number;
  warmth: number;
  exposure: number;
  /** Wie stark Neon nachts dominiert (Bloom-Stärke). */
  neon: number;
  /** Goldene Stunde: zusätzliche Wärme/Glühen bei Sonnenauf- und -untergang (0..1). */
  golden?: number;
  /** Sternendichte nachts (1 = Stadt mit Lichtverschmutzung, > 1 = klarer Landhimmel). */
  stars?: number;
  /** Basis-Palette für Texturen dieser Zone (Quantisierung, siehe scripts/process-textures.ts). */
  palette: number[];
}

export const MOODS: Record<MoodId, Mood> = {
  // hell, pastellig, viel Weiß und Türkis, starke Sonne
  ocean: {
    fog: 0xbff4ee, fogTint: 0.35, fogRange: 1.05, morningFog: 0, saturation: 1.04, warmth: 0.12, exposure: 1.04, neon: 1.1,
    palette: [0xffc2d6, 0xb4f0d8, 0xa8dcf5, 0xfff0a0, 0xffb4a0, 0xf7f0e4, 0xf2dca8, 0x3fd8cc, 0x74d2f2, 0xff7eb0, 0xffe468, 0x52b85a, 0x9a7652, 0xb3aab0, 0x5e5a6e, 0x2c2a40],
  },
  keys: {
    fog: 0xc8f6f0, fogTint: 0.4, fogRange: 1.1, morningFog: 0.05, saturation: 1.03, warmth: 0.1, exposure: 1.05, neon: 0.8,
    palette: [0xf7f0e4, 0xf2dca8, 0x9fe8de, 0x3fd8cc, 0x74d2f2, 0xffc2d6, 0xb4f0d8, 0xfff0a0, 0x8fcc72, 0x52b85a, 0x9a7652, 0x6e4e32, 0xb3aab0, 0x5e5a6e, 0x2a5f9e, 0x2c2a40],
  },
  // kühler, glänzender, nachts dominiert Neon
  downtown: {
    fog: 0x9fc6e0, fogTint: 0.3, fogRange: 0.95, morningFog: 0, saturation: 1.04, warmth: -0.08, exposure: 1.0, neon: 1.5,
    palette: [0x74d2f2, 0x3fd8cc, 0x2a5f9e, 0xa8dcf5, 0xf7f0e4, 0xb3aab0, 0x5e5a6e, 0x2c2a40, 0xf2dca8, 0xffc9a8, 0xff4fae, 0x4ff2ff, 0x9a6bd8, 0xffe468, 0x52b85a, 0x9a7652],
  },
  havana: {
    fog: 0xffd8b0, fogTint: 0.3, fogRange: 1.0, morningFog: 0, saturation: 1.06, warmth: 0.16, exposure: 1.02, neon: 1.1,
    palette: [0xff9f5a, 0x3fd8cc, 0xffb36b, 0xffe468, 0xd4583f, 0xff8577, 0x9fe8de, 0xf7f0e4, 0xf2dca8, 0x9a7652, 0x6e4e32, 0x52b85a, 0x356f45, 0xb3aab0, 0x5e5a6e, 0x2c2a40],
  },
  port: {
    fog: 0xb8c4c8, fogTint: 0.4, fogRange: 0.9, morningFog: 0.1, saturation: 0.96, warmth: 0.02, exposure: 0.98, neon: 0.9,
    palette: [0xb3aab0, 0x5e5a6e, 0x2c2a40, 0xc0703f, 0xd4583f, 0x2a5f9e, 0x3fd8cc, 0xffe468, 0xff9f5a, 0x52b85a, 0xf7f0e4, 0xf2dca8, 0x9a7652, 0x6e4e32, 0x74d2f2, 0x356f45],
  },
  // gedeckt, grün-braun, feucht, morgens Nebel
  swamp: {
    fog: 0xa8b894, fogTint: 0.55, fogRange: 0.8, morningFog: 0.55, saturation: 0.9, warmth: -0.02, exposure: 0.95, neon: 0.7,
    palette: [0x356f45, 0x52b85a, 0x8fcc72, 0xb8c46a, 0x6e4e32, 0x9a7652, 0x5e5a6e, 0x2c2a40, 0xb3aab0, 0x9fe8de, 0x3fd8cc, 0xf2dca8, 0xffc9a8, 0x9a6bd8, 0xff9f5a, 0xf7f0e4],
  },
  // warm, staubig, ausgeblichenes Gelb/Rot
  // Norden: wärmeres, staubigeres Licht, goldene Stunde betont, Dunst über den Feldern, viele Sterne, kaum Neon
  pine: {
    fog: 0xf0d098, fogTint: 0.55, fogRange: 0.95, morningFog: 0.18, saturation: 0.94, warmth: 0.32, exposure: 1.05, neon: 0.35, golden: 0.75, stars: 3.2,
    palette: [0xf2dca8, 0xb8c46a, 0xc0703f, 0xd4583f, 0xffb36b, 0x9a7652, 0x6e4e32, 0x356f45, 0x52b85a, 0x8fcc72, 0xf7f0e4, 0xb3aab0, 0x5e5a6e, 0x2c2a40, 0xffe468, 0x74d2f2],
  },
  // Okee Peak: klare Bergluft, morgens Nebel in den Tälern, sehr viele Sterne
  highlands: {
    fog: 0xd0dcc8, fogTint: 0.45, fogRange: 1.05, morningFog: 0.5, saturation: 0.97, warmth: 0.14, exposure: 1.02, neon: 0.3, golden: 0.6, stars: 3.6,
    palette: [0x356f45, 0x52b85a, 0x8fcc72, 0xb3aab0, 0x5e5a6e, 0x9a7652, 0x6e4e32, 0xf7f0e4, 0xf2dca8, 0x2c2a40, 0xb8c46a, 0x74d2f2, 0xc0703f, 0x9fe8de, 0xffc9a8, 0xffe468],
  },
  town: {
    fog: 0xe8dcb8, fogTint: 0.35, fogRange: 1.0, morningFog: 0.05, saturation: 1.0, warmth: 0.16, exposure: 1.02, neon: 0.6, golden: 0.4, stars: 2.2,
    palette: [0xf7f0e4, 0xf2dca8, 0xffc9a8, 0xa8dcf5, 0xd4583f, 0x9a7652, 0x6e4e32, 0x52b85a, 0x8fcc72, 0xb8c46a, 0xb3aab0, 0x5e5a6e, 0x2c2a40, 0xffe468, 0x3fd8cc, 0xff9f5a],
  },
};

/** Stimmung an einer Position: Zone + (in Port Coralia) Viertel-Stil. */
export function moodFor(zone: number, districtStyle: string | null): MoodId {
  if (zone === Zone.PortCoralia) {
    switch (districtStyle) {
      case 'downtown': return 'downtown';
      case 'havana': return 'havana';
      case 'port': case 'industrial': return 'port';
      default: return 'ocean';
    }
  }
  switch (zone) {
    case Zone.CoralKeys: return 'keys';
    case Zone.GatorFlats: return 'swamp';
    case Zone.DryPine: case Zone.CaneRidge: return 'pine';
    case Zone.Highlands: return 'highlands';
    default: return 'town';
  }
}

// ------------------------------------------------------------------ Tageszeit
export interface SkyKey {
  t: number;
  /** Himmel: Horizont -> Mitte -> Zenit. */
  horizon: number; mid: number; top: number;
  sun: number; sunI: number;
  ambSky: number; ambGround: number; ambI: number;
  /** Sonnenhöhe in Grad – bewusst tief (lange, weiche Schatten), auch mittags max. ~55°. */
  elev: number;
}

// 0 = Mitternacht, 0.25 = Sonnenaufgang, 0.5 = Mittag, 0.75 = Sonnenuntergang
export const SKY_KEYS: SkyKey[] = [
  { t: 0.0, horizon: 0x3a1f6a, mid: 0x1a1648, top: 0x0a0c2a, sun: 0x9aaaf0, sunI: 0.85, ambSky: 0x6e78c4, ambGround: 0x3e3264, ambI: 1.05, elev: 40 },
  { t: 0.2, horizon: 0x5a2a7a, mid: 0x2a1c5a, top: 0x101238, sun: 0xa29af0, sunI: 0.85, ambSky: 0x7670c4, ambGround: 0x423266, ambI: 1.05, elev: 30 },
  { t: 0.26, horizon: 0xffa070, mid: 0xff86a8, top: 0x7a6ad0, sun: 0xffb080, sunI: 1.3, ambSky: 0xd8a0c0, ambGround: 0x7a5a7a, ambI: 0.95, elev: 14 },
  { t: 0.34, horizon: 0x9ff0e4, mid: 0x8adcf0, top: 0x6ac4f0, sun: 0xffe6c0, sunI: 1.85, ambSky: 0xc8ecf4, ambGround: 0x9a8a7a, ambI: 1.05, elev: 32 },
  // Tag: Türkis -> Hellblau
  { t: 0.5, horizon: 0x8ff2e0, mid: 0x7ad8f4, top: 0x5cbcf2, sun: 0xfff2d8, sunI: 2.0, ambSky: 0xd0f0ff, ambGround: 0xa89a84, ambI: 1.1, elev: 55 },
  { t: 0.64, horizon: 0xa8f0dc, mid: 0x8ad8ee, top: 0x6ac0ee, sun: 0xffe2b0, sunI: 1.9, ambSky: 0xe8dcc8, ambGround: 0xa08870, ambI: 1.05, elev: 38 },
  // Abend: Orange -> Pink -> Violett
  { t: 0.71, horizon: 0xffa04a, mid: 0xff7aa0, top: 0x8a5ad0, sun: 0xffa860, sunI: 1.75, ambSky: 0xffb0a0, ambGround: 0x8a5a6a, ambI: 1.0, elev: 18 },
  { t: 0.765, horizon: 0xff7a3a, mid: 0xff4f8a, top: 0x6a3ab0, sun: 0xff7a6a, sunI: 1.3, ambSky: 0xc070b0, ambGround: 0x5a3a6a, ambI: 0.9, elev: 8 },
  // Nacht: Dunkelblau mit Neon-Schimmer am Horizont; heller Mond + bläuliches Umgebungslicht für gute Sicht
  { t: 0.83, horizon: 0x5a2a8a, mid: 0x2a1c6a, top: 0x10123a, sun: 0xa29af0, sunI: 0.85, ambSky: 0x7470c8, ambGround: 0x423266, ambI: 1.05, elev: 35 },
  { t: 1.0, horizon: 0x3a1f6a, mid: 0x1a1648, top: 0x0a0c2a, sun: 0x9aaaf0, sunI: 0.85, ambSky: 0x6e78c4, ambGround: 0x3e3264, ambI: 1.05, elev: 40 },
];

// ------------------------------------------------------------------ Bodenfarben (Minimap)
/** Für die Minimap: eine Farbe je Untergrund, abgeleitet aus derselben Palette wie die Texturen. */
export const MINIMAP_GROUND = {
  water: 0x2a8fb0, sand: 0xf2dca8, grass: 0x8fcc72, grassDry: 0xb8c46a, grassDark: 0x52b85a, swamp: 0x5a6a3a,
  road: 0x5e5a6e, sidewalk: 0xe6d6cc, building: 0x9a909e, dock: 0x9a7652, bridge: 0x7a7488, farm: 0x8aa04c,
  dirt: 0xc89a6a, plaza: 0xeedaca, rock: 0x948a80, field: 0xc8c46a, desert: 0xf0dcae, badlands: 0xc0703f,
  gravel: 0xd8bc94, scree: 0xa49a90, cliff: 0x7a726c, reservoir: 0x3aa0c8, crop: 0x9a6a42, pasture: 0x9cd06a,
};
