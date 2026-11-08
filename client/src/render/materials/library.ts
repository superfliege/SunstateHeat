// Materialbibliothek: jedes Material hat Name, Textur (prozedural gemalt ODER aus
// scripts/process-textures.ts), Palette-Variante, Kachelgröße in Metern und Toon-Einstellungen.
// Alle Texturen landen in EINEM Atlas (atlas.ts) -> ein Material, wenige Draw-Calls pro Chunk.
//
// Alpha-Kanal opaker Texturen = Tönungsmaske: 255 -> wird mit der Vertex-Farbe eingefärbt
// (Putz, Lack), 0 -> behält die Texturfarbe (Fensterglas, Zierleisten). Decals nutzen Alpha als Cutout.
import type { MoodId } from '../palette';
import { MOODS, PALMARA } from '../palette';
import { mixHex, Painter, shade, TEX } from './painter';

/** Toon-/Shader-Flags je Fläche (werden pro Vertex mitgegeben). */
export const SURF = {
  WINDOWS: 1, // Emissive-Map = Fenstermaske; nachts leuchtet ein zufälliger Teil
  GLASS: 2, // Spiegelglas: reflektiert die Himmelsfarbe (Env-Map-Fake)
  HEAT: 4, // Hitzeflimmern tagsüber
  SPEC: 8, // hartes Toon-Glanzlicht
  EMISSIVE: 16, // Emissive-Map leuchtet nachts in ihrer eigenen Farbe (Leuchtreklame)
  NOTINT: 32, // Vertex-Farbe ignorieren
} as const;

export interface MaterialDef {
  name: string;
  /** Kachelgröße in Metern (Breite, Höhe) – bei Fassaden = 2 Fensterachsen x 2 Geschosse. */
  tile: [number, number];
  /** Palette, auf die die Textur quantisiert wird. */
  palette: MoodId | 'master';
  /** Prozedural gemalte Textur. */
  paint: (p: Painter) => void;
  /** Optional: Datei aus scripts/process-textures.ts (assets/textures/<file>.png) ersetzt `paint`. */
  file?: string;
  /** Emissive-Map (Fenster, Neon). */
  emissive?: (p: Painter) => void;
  /** Toon-Einstellungen. */
  toon: { flags?: number; spec?: number; nightTint?: number };
  /** Decal mit Alpha-Cutout. */
  decal?: boolean;
  /** Ausbleichen in der Sonne (0..1). */
  bleach?: number;
}

const M = (d: Omit<MaterialDef, 'toon'> & { toon?: MaterialDef['toon'] }): MaterialDef => ({ toon: {}, ...d });

// ------------------------------------------------------------------ Farben
const ASPH = 0x5e5a6e, ASPH_D = 0x4a4658, ASPH_L = 0x76707e;
const PLASTER = 0xfbf6ee;
const GLASS = 0x74c8ea, GLASS_D = 0x3a7aa8, GLASS_HI = 0xd8f6ff;
const WOOD = 0x9a7652, WOOD_D = 0x6e4e32, WOOD_L = 0xb89068;

/** Opake Fläche ohne Tönung. */
const noTint = (p: Painter) => { for (let i = 3; i < p.data.length; i += 4) p.data[i] = 0; };
/** Tönungsmaske nur für Pixel nahe der Grundfarbe setzen (Rest behält Texturfarbe). */
function tintMaskNear(p: Painter, base: number, tol = 40) {
  const r = (base >> 16) & 255, g = (base >> 8) & 255, b = base & 255;
  for (let i = 0; i < p.data.length; i += 4) {
    const d = Math.abs(p.data[i] - r) + Math.abs(p.data[i + 1] - g) + Math.abs(p.data[i + 2] - b);
    p.data[i + 3] = d < tol ? 255 : 0;
  }
}

/** Gras "gemalt": weiche Grundflecken + viele kurze Halm-Striche statt Kleckse (kein sichtbares Muster). */
function grassStrokes(p: Painter, base: number, strokes: number[], dots: number[]) {
  p.fill(base).grain(0.03).blotches(strokes[0], 0.3, 32).blotches(strokes[1], 0.25, 16);
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(p.rnd() * 64), y = Math.floor(p.rnd() * 64), c = strokes[i % strokes.length];
    const lean = p.rnd() < 0.5 ? 0 : p.rnd() < 0.5 ? -1 : 1;
    p.set(x, y, c); p.set(x + lean, y - 1, c);
    if (p.rnd() < 0.4) p.set(x + lean, y - 2, shade(c, 1.08));
  }
  p.speckle(0.004, dots, 1);
}

// ------------------------------------------------------------------ Bausteine für Fassaden
type Bay = (p: Painter, x: number, y: number) => void;
function facade(p: Painter, wall: number, bay: Bay, slab?: number) {
  p.fill(wall).grain(0.03);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) bay(p, bx * 32, by * 32);
  if (slab !== undefined) for (let by = 0; by < 2; by++) p.rect(0, by * 32 + 30, TEX, 2, slab);
}
function windowRect(p: Painter, x: number, y: number, w: number, h: number) {
  p.rect(x, y, w, h, GLASS);
  p.rect(x, y + h - 3, w, 3, GLASS_D);
  p.line(x + 1, y + h - 4, x + 5, y + 1, GLASS_HI); // Lichtreflex diagonal
  p.line(x + 3, y + h - 4, x + 7, y + 1, GLASS_HI);
}
const windowMask: Bay = (p, x, y) => p.rect(x + 6, y + 7, 20, 16, 0xffffff);

// ------------------------------------------------------------------ Bibliothek
export const MATERIALS: MaterialDef[] = [
  // Index 0: reine Vertex-Farbe (Kit-Modelle, einfache Flächen)
  M({ name: 'white', tile: [4, 4], palette: 'master', paint: (p) => p.fill(0xffffff) }),
  M({ name: 'flat', tile: [4, 4], palette: 'master', paint: (p) => p.fill(0xffffff).grain(0.025, 2) }),
  // Fensterflächen der Kit-Gebäude: Farbe aus dem Modell, nachts zufällig beleuchtet
  M({ name: 'kit_glass', tile: [4, 4], palette: 'master', toon: { flags: SURF.WINDOWS | SURF.SPEC },
    paint: (p) => p.fill(0xffffff), emissive: (p) => p.fill(0xffffff) }),

  // ---------------------------------------------------------------- Straßen
  M({ name: 'asphalt_new', tile: [4, 4], palette: 'master', bleach: 0.1, toon: { flags: SURF.NOTINT },
    paint: (p) => p.fill(ASPH_D).grain(0.06).speckle(0.06, [ASPH, ASPH_L, 0x2c2a40]).blotches(ASPH, 0.4, 16) }),
  M({ name: 'asphalt_worn', tile: [4, 4], palette: 'master', bleach: 0.35, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.fill(ASPH).grain(0.07).speckle(0.08, [ASPH_L, 0x8a8494, ASPH_D]).blotches(0x8a8494, 0.5, 21);
      for (let i = 0; i < 3; i++) p.crack(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 26, 0x34323f);
    } }),
  M({ name: 'highway', tile: [6, 6], palette: 'master', bleach: 0.25, toon: { flags: SURF.NOTINT | SURF.HEAT },
    paint: (p) => p.fill(0x524e60).grain(0.06).speckle(0.07, [0x6a6474, 0x403c4c, 0x8a7a6a]).blotches(0x6a6070, 0.35, 32) }),
  M({ name: 'paint_white', tile: [1, 1], palette: 'master', toon: { flags: SURF.NOTINT },
    paint: (p) => p.fill(0xf7f0e4).grain(0.05).speckle(0.07, [0xc8c0b8, 0xb3aab0], 2) }),
  M({ name: 'paint_yellow', tile: [1, 1], palette: 'master', toon: { flags: SURF.NOTINT },
    paint: (p) => p.fill(0xffd85a).grain(0.05).speckle(0.07, [0xd8b04a, 0xc0a070], 2) }),
  M({ name: 'gravel', tile: [3, 3], palette: 'pine', bleach: 0.3, toon: { flags: SURF.NOTINT },
    paint: (p) => p.fill(0xd8bc94).grain(0.03).blotches(0xc8a878, 0.35, 32).speckle(0.12, [0xc4a47c, 0xe8d0a8, 0xb89a74], 1).speckle(0.015, [0x9a7652], 1) }),

  // ---------------------------------------------------------------- Gehwege & Plätze
  M({ name: 'sidewalk', tile: [2, 2], palette: 'master', bleach: 0.3,
    paint: (p) => { p.bricks(32, 32, 0xc8bcb4, [0xf2e8e0, 0xece0d8, 0xf7f0e4], 0, 0.04).grain(0.03).speckle(0.02, [0xb3aab0]); } }),
  M({ name: 'terrazzo', tile: [3, 3], palette: 'ocean', bleach: 0.15, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.fill(0xf7efe6).grain(0.02);
      p.speckle(0.14, [0xffc2d6, 0xb4f0d8, 0xa8dcf5, 0xfff0a0, 0xffb4a0], 1).speckle(0.03, [0xff7eb0, 0x3fd8cc], 2);
      // Art-déco-Band
      p.rect(0, 0, 64, 2, 0xff9fbe); p.rect(0, 0, 2, 64, 0x7ad8c8);
    } }),
  M({ name: 'brick_path', tile: [2, 2], palette: 'havana', bleach: 0.2, toon: { flags: SURF.NOTINT },
    paint: (p) => p.bricks(16, 8, 0x9a7a6a, [0xd4583f, 0xc0703f, 0xe06a50, 0xb85038], 0.5, 0.06).grain(0.04) }),
  M({ name: 'curb_white', tile: [1, 1], palette: 'master', toon: { flags: SURF.NOTINT },
    paint: (p) => { p.fill(0xf2ece4).grain(0.04); p.rect(0, 0, 64, 4, 0xfffaf2); p.rect(31, 0, 2, 64, 0xc8c0b8); } }),
  M({ name: 'curb_yellow', tile: [1, 1], palette: 'master', toon: { flags: SURF.NOTINT },
    paint: (p) => { p.fill(0xffd85a).grain(0.05); p.rect(0, 0, 64, 4, 0xffe88a); p.rect(31, 0, 2, 64, 0xc8a040); } }),
  M({ name: 'concrete', tile: [3, 3], palette: 'downtown', bleach: 0.2,
    paint: (p) => { p.fill(0xd8d2d0).grain(0.05).blotches(0xc0b8b8, 0.4, 16).speckle(0.03, [0xb3aab0]); p.rect(0, 63, 64, 1, 0xb0a8a8); p.rect(63, 0, 1, 64, 0xb0a8a8); } }),
  M({ name: 'marble', tile: [2, 2], palette: 'downtown', toon: { flags: SURF.NOTINT | SURF.SPEC },
    paint: (p) => {
      p.fill(0xf2ece8).grain(0.02);
      for (let i = 0; i < 5; i++) p.crack(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 40, 0xc8c0c8);
      p.rect(0, 0, 64, 1, 0xd8d0d0); p.rect(0, 0, 1, 64, 0xd8d0d0);
    } }),
  M({ name: 'plaza', tile: [3, 3], palette: 'ocean', bleach: 0.25,
    paint: (p) => p.bricks(21, 21, 0xd0bcb0, [0xf7e8da, 0xf2dcc8, 0xffe4d4], 0, 0.04).grain(0.03) }),

  // ---------------------------------------------------------------- Fassaden Ocean Strip
  ...([['pink', 0xffc2d6], ['mint', 0xb4f0d8], ['sky', 0xa8dcf5], ['lemon', 0xfff0a0], ['salmon', 0xffb4a0]] as const).map(([n, c]) =>
    M({ name: `plaster_${n}`, tile: [2, 2], palette: 'ocean', bleach: 0.2, toon: { flags: SURF.NOTINT },
      paint: (p) => p.fill(c).grain(0.035).blotches(shade(c, 1.06), 0.5, 16).speckle(0.01, [shade(c, 0.9)]) })),
  M({ name: 'facade_deco', tile: [6.4, 7.2], palette: 'ocean', bleach: 0.15, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      facade(p, PLASTER, (p, x, y) => {
        // Fenster mit "Augenbraue" (Art-déco-Sonnendach) und Zierstreifen
        windowRect(p, x + 6, y + 7, 20, 16);
        p.rect(x + 4, y + 4, 24, 2, 0xffffff); p.rect(x + 4, y + 6, 24, 1, 0xd8d0c8);
      }, 0xffffff);
      for (const yy of [27, 59]) { p.rect(0, yy, 64, 1, 0xff9fbe); p.rect(0, yy + 2, 64, 1, 0x7ad8c8); }
      tintMaskNear(p, PLASTER, 30);
    },
    emissive: (p) => { p.fill(0); for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) windowMask(p, bx * 32, by * 32); } }),
  M({ name: 'facade_deco_round', tile: [6.4, 7.2], palette: 'ocean', bleach: 0.15, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      facade(p, PLASTER, (p, x, y) => {
        // Bullaugenfenster + Glasbausteinband
        p.disc(x + 11, y + 14, 7, 0xffffff); p.disc(x + 11, y + 14, 6, GLASS); p.disc(x + 9, y + 12, 1.5, GLASS_HI);
        for (let j = 0; j < 4; j++) for (let i = 0; i < 2; i++) { p.rect(x + 21 + i * 4, y + 5 + j * 5, 3, 4, 0xc8f0f4); p.set(x + 21 + i * 4, y + 5 + j * 5, 0xffffff); }
      }, 0xffffff);
      for (const yy of [28, 60]) p.rect(0, yy, 64, 1, 0xff9fbe);
      tintMaskNear(p, PLASTER, 30);
    },
    emissive: (p) => {
      p.fill(0);
      for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) { p.disc(bx * 32 + 11, by * 32 + 14, 6, 0xffffff); p.rect(bx * 32 + 21, by * 32 + 5, 7, 19, 0x9fd8ff); }
    } }),
  M({ name: 'glassblock', tile: [1, 1], palette: 'ocean', toon: { flags: SURF.NOTINT | SURF.SPEC },
    paint: (p) => { p.fill(0xe0f6f8); for (let y = 0; y < 64; y += 16) for (let x = 0; x < 64; x += 16) { p.rect(x, y, 15, 15, 0xb8e8f0); p.rect(x + 2, y + 2, 4, 4, 0xffffff); } } }),

  // ---------------------------------------------------------------- Fassaden Downtown
  ...([['teal', 0x4fb8c8, 0x2a6a88], ['gold', 0xe8c070, 0x9a7040]] as const).map(([n, c, d]) =>
    M({ name: `facade_mirror_${n}`, tile: [6.4, 7.2], palette: 'downtown', toon: { flags: SURF.WINDOWS | SURF.GLASS | SURF.NOTINT | SURF.SPEC },
      paint: (p) => {
        p.fill(c);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x + 64 - y) % 64 < 6) p.set(x, y, mixHex(c, 0xffffff, 0.35)); // Spiegelstreifen
        for (let k = 0; k < 64; k += 16) p.rect(k, 0, 1, 64, d); // Pfosten
        for (let k = 0; k < 64; k += 32) p.rect(0, k + 30, 64, 2, d); // Geschossbänder
      },
      emissive: (p) => { p.fill(0); for (let by = 0; by < 2; by++) for (let bx = 0; bx < 4; bx++) p.rect(bx * 16 + 2, by * 32 + 3, 12, 25, 0xffffff); } })),
  M({ name: 'facade_office', tile: [6.4, 7.2], palette: 'downtown', bleach: 0.1, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      facade(p, 0xe8e4e4, (p, x, y) => { windowRect(p, x + 3, y + 5, 26, 21); p.rect(x + 15, y + 5, 2, 21, 0xd0d0d8); }, 0xc8c4c8);
      tintMaskNear(p, 0xe8e4e4, 30);
    },
    emissive: (p) => { p.fill(0); for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) p.rect(bx * 32 + 3, by * 32 + 5, 26, 21, 0xffffff); } }),

  // ---------------------------------------------------------------- Fassaden Little Havana
  M({ name: 'facade_havana', tile: [6.4, 7.2], palette: 'havana', bleach: 0.3, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      facade(p, PLASTER, (p, x, y) => {
        // Holzfensterläden links/rechts + Balkongitter
        windowRect(p, x + 10, y + 6, 12, 18);
        for (const sx of [x + 4, x + 22]) { p.rect(sx, y + 6, 6, 18, 0x3fae9a); for (let j = 0; j < 18; j += 3) p.rect(sx, y + 6 + j, 6, 1, 0x2a7a6a); }
        p.rect(x + 3, y + 25, 26, 1, 0x2c2a40); for (let i = 0; i < 26; i += 3) p.rect(x + 3 + i, y + 25, 1, 4, 0x2c2a40);
      });
      p.blotches(0xfff4e0, 0.5, 21);
      tintMaskNear(p, PLASTER, 40);
    },
    emissive: (p) => { p.fill(0); for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) p.rect(bx * 32 + 10, by * 32 + 6, 12, 18, 0xffffff); } }),
  M({ name: 'shutters_wood', tile: [1, 1.5], palette: 'havana', toon: { flags: SURF.NOTINT },
    paint: (p) => { p.fill(0x3fae9a); for (let j = 0; j < 64; j += 6) p.rect(0, j, 64, 2, 0x2a7a6a); } }),

  // ---------------------------------------------------------------- Wohnhäuser / Läden
  M({ name: 'facade_house', tile: [6.4, 7.2], palette: 'town', bleach: 0.25, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      facade(p, PLASTER, (p, x, y) => { p.rect(x + 7, y + 8, 18, 14, 0xffffff); windowRect(p, x + 8, y + 9, 16, 12); p.rect(x + 15, y + 9, 2, 12, 0xffffff); });
      tintMaskNear(p, PLASTER, 30);
    },
    emissive: (p) => { p.fill(0); for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) p.rect(bx * 32 + 8, by * 32 + 9, 16, 12, 0xffffff); } }),
  M({ name: 'facade_shop', tile: [6.4, 7.2], palette: 'ocean', bleach: 0.2, toon: { flags: SURF.WINDOWS },
    paint: (p) => {
      p.fill(PLASTER).grain(0.03);
      // Schaufenster unten, Markise gestreift, oben kleine Fenster
      for (let bx = 0; bx < 2; bx++) { windowRect(p, bx * 32 + 3, 38, 26, 22); windowRect(p, bx * 32 + 9, 8, 14, 12); }
      for (let x = 0; x < 64; x++) p.rect(x, 30, 1, 6, Math.floor(x / 4) % 2 ? 0xff7eb0 : 0xffffff);
      tintMaskNear(p, PLASTER, 30);
    },
    emissive: (p) => { p.fill(0); for (let bx = 0; bx < 2; bx++) { p.rect(bx * 32 + 3, 38, 26, 22, 0xffffff); p.rect(bx * 32 + 9, 8, 14, 12, 0xffffff); } } }),

  // ---------------------------------------------------------------- Hafen & Industrie
  M({ name: 'corrugated_rust', tile: [3, 3], palette: 'port', bleach: 0.2,
    paint: (p) => {
      p.fill(0xd8d0cc);
      for (let x = 0; x < 64; x++) { const k = [1.12, 1.0, 0.86, 0.94][x % 4]; for (let y = 0; y < 64; y++) p.mul(x, y, k); }
      p.blotches(0xc0703f, 0.5, 32).speckle(0.03, [0x9a5a3a, 0xc0703f], 2);
      tintMaskNear(p, 0xd8d0cc, 70);
    } }),
  M({ name: 'container_steel', tile: [2.6, 2.6], palette: 'port', bleach: 0.15,
    paint: (p) => {
      p.fill(0xffffff);
      for (let x = 0; x < 64; x++) { const k = [1.05, 1.0, 0.82, 0.92, 1.0, 1.0, 1.0, 1.0][x % 8]; for (let y = 0; y < 64; y++) p.mul(x, y, k); }
      p.rect(0, 0, 64, 3, 0xd8d8d8); p.rect(0, 61, 64, 3, 0xb0b0b0);
      p.speckle(0.02, [0x9a5a3a], 2);
    } }),
  M({ name: 'concrete_oil', tile: [4, 4], palette: 'port', bleach: 0.2, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      // Ölflecken kommen als Decals (unregelmäßig verteilt), hier nur fleckiger Beton mit Fugen
      p.fill(0xc8c2c0).grain(0.04).blotches(0xb0a8a8, 0.4, 32).blotches(0xbab2b0, 0.3, 16).speckle(0.02, [0x9a9496], 1);
      p.rect(0, 0, 64, 1, 0x9a9496); p.rect(0, 0, 1, 64, 0x9a9496);
    } }),
  M({ name: 'fence', tile: [2, 2], palette: 'port', decal: true, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.clear();
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if ((x + y) % 8 === 0 || (x - y + 64) % 8 === 0) p.set(x, y, 0xb3aab0);
      p.rect(0, 0, 64, 2, 0x8a8494); p.rect(0, 0, 2, 64, 0x8a8494);
    } }),

  // ---------------------------------------------------------------- Dächer
  M({ name: 'roof_terracotta', tile: [2, 2], palette: 'havana', bleach: 0.25, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const c = [0xd4583f, 0xc0703f, 0xe0784a, 0xb85038][Math.floor(p.rnd() * 4)];
          const x0 = col * 8 + (row % 2) * 4, y0 = row * 8;
          p.rect(x0, y0, 8, 8, c);
          p.rect(x0, y0 + 6, 8, 2, shade(c, 0.72)); p.rect(x0 + 1, y0 + 1, 2, 4, shade(c, 1.15)); // Wölbung
        }
      }
    } }),
  M({ name: 'roof_gravel', tile: [4, 4], palette: 'master', bleach: 0.3,
    paint: (p) => {
      // Kiesdach: graubeige, Teerfugen-Raster, Wasserflecken
      p.fill(0xa8a0a0).grain(0.05).blotches(0x8e8890, 0.45, 32).speckle(0.35, [0xb3aab0, 0x9a929e, 0xc0b8b4, 0x8a8494], 1);
      p.rect(0, 0, 64, 1, 0x6e6a7a); p.rect(0, 0, 1, 64, 0x6e6a7a); p.rect(0, 32, 64, 1, 0x7e7a88);
    } }),
  M({ name: 'roof_deck', tile: [2, 2], palette: 'keys', bleach: 0.35, toon: { flags: SURF.NOTINT },
    paint: (p) => p.planks(8, [WOOD_L, 0xc09a70, 0xa8845e], WOOD_D).grain(0.03) }),

  // ---------------------------------------------------------------- Strand & Küste
  M({ name: 'boardwalk', tile: [2, 2], palette: 'keys', bleach: 0.5, toon: { flags: SURF.NOTINT },
    paint: (p) => p.planks(8, [0xc8a880, 0xb89878, 0xd8b890, 0xa88a6a], 0x7a5e46, true).grain(0.04) }),
  M({ name: 'lifeguard_wood', tile: [1.5, 1.5], palette: 'ocean', bleach: 0.4,
    paint: (p) => { p.planks(8, [0xffffff, 0xf4f4f4], 0xc8c0c0, true); tintMaskNear(p, 0xf8f8f8, 30); } }),

  // ---------------------------------------------------------------- Natur
  M({ name: 'bark_palm', tile: [1, 1], palette: 'keys', toon: { flags: SURF.NOTINT },
    paint: (p) => { p.fill(0xa8865e); for (let y = 0; y < 64; y += 8) { p.rect(0, y, 64, 2, 0x7a5e40); p.rect(0, y + 2, 64, 1, 0xc8a478); } p.grain(0.05); } }),
  M({ name: 'bark_pine', tile: [1, 1.5], palette: 'pine', toon: { flags: SURF.NOTINT },
    paint: (p) => p.bricks(10, 18, 0x4a3424, [0x8a5a3a, 0x7a4e32, 0x9a6a46], 0.5, 0.1).grain(0.05) }),
  M({ name: 'grass_tropical', tile: [6, 6], palette: 'keys', bleach: 0.15,
    paint: (p) => grassStrokes(p, 0x86b462, [0x9cc272, 0x74a656, 0xa8c87a, 0x6a9a50], [0xfff0a0, 0xffc2d6]) }),
  M({ name: 'grass_dry', tile: [6, 6], palette: 'pine', bleach: 0.3,
    paint: (p) => grassStrokes(p, 0xbcb874, [0xd0c488, 0xa8a862, 0x9aa060, 0xd8c890], [0xe8d8a0]) }),
  M({ name: 'reeds', tile: [1, 2], palette: 'swamp', decal: true,
    paint: (p) => { p.clear(); for (let i = 0; i < 18; i++) { const x = Math.floor(p.rnd() * 64), h = 30 + Math.floor(p.rnd() * 34); p.line(x, 63, x + (p.rnd() < 0.5 ? -2 : 2), 63 - h, p.rnd() < 0.5 ? 0x8a9a52 : 0x6a8a48); if (p.rnd() < 0.4) p.rect(x - 1, 63 - h, 3, 6, 0x7a5a3a); } } }),
  M({ name: 'swamp_mud', tile: [4, 4], palette: 'swamp',
    paint: (p) => p.fill(0x6a6040).grain(0.06).blotches(0x4a5a34, 0.6, 16).speckle(0.05, [0x8a7a52, 0x3e4a2e], 2) }),
  M({ name: 'mangrove_roots', tile: [2, 2], palette: 'swamp', toon: { flags: SURF.NOTINT },
    paint: (p) => { p.fill(0x5a4a32); for (let i = 0; i < 10; i++) p.crack(Math.floor(p.rnd() * 64), 0, 70, 0x8a7452); p.grain(0.06); } }),
  M({ name: 'sand', tile: [4, 4], palette: 'keys', bleach: 0.2,
    paint: (p) => p.fill(0xf4dcaa).grain(0.04).blotches(0xfae8c0, 0.5, 16).speckle(0.05, [0xe0c490, 0xfff4d8], 1).speckle(0.006, [0xffc2d6, 0xf7f0e4], 1) }),
  M({ name: 'sand_wet', tile: [4, 4], palette: 'keys',
    paint: (p) => p.fill(0xd8b880).grain(0.04).blotches(0xc8a670, 0.5, 16).speckle(0.04, [0xe8cc98], 1) }),
  M({ name: 'rock', tile: [6, 6], palette: 'highlands',
    paint: (p) => { p.fill(0x9a928a).grain(0.05).blotches(0xb3aab0, 0.6, 16).blotches(0x7a726c, 0.5, 11); for (let i = 0; i < 4; i++) p.crack(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 20, 0x5e5a6e); } }),

  // ---------------------------------------------------------------- Ländlich
  M({ name: 'planks', tile: [2, 2], palette: 'pine', bleach: 0.3,
    paint: (p) => { p.planks(8, [0xf0e0d0, 0xe8d4c0, 0xf8ece0], 0x9a8070, true); tintMaskNear(p, 0xf0e0d0, 60); } }),
  M({ name: 'alu_siding', tile: [2, 2], palette: 'pine', bleach: 0.2, toon: { flags: SURF.SPEC },
    paint: (p) => { p.fill(0xf0f0f0); for (let y = 0; y < 64; y += 8) { p.rect(0, y, 64, 1, 0xffffff); p.rect(0, y + 6, 64, 2, 0xc0c0c8); } } }),
  M({ name: 'red_earth', tile: [4, 4], palette: 'pine', bleach: 0.25,
    paint: (p) => { p.fill(0xc4784a).grain(0.06).blotches(0xd89a6a, 0.5, 16).speckle(0.05, [0xa85a38, 0xe0b080], 1); for (let i = 0; i < 2; i++) p.crack(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 30, 0x8a4a2e); } }),
  M({ name: 'grove_soil', tile: [4, 4], palette: 'pine', bleach: 0.2,
    paint: (p) => {
      p.fill(0xa87a52).grain(0.06).speckle(0.05, [0x8a6040, 0xc09a70], 1);
      // Pflanzreihen mit Gras dazwischen
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (((y >> 3) & 1) === 0 && p.rnd() < 0.55) p.set(x, y, p.rnd() < 0.5 ? 0x8fb860 : 0x6a9a48);
    } }),
  M({ name: 'cane_field', tile: [3, 3], palette: 'pine',
    paint: (p) => { p.fill(0x8aa048).grain(0.05); for (let x = 0; x < 64; x += 4) { p.rect(x, 0, 2, 64, 0xa8b85a); p.rect(x + 2, 0, 1, 64, 0x5e7a38); } p.speckle(0.04, [0xc8c46a], 1); } }),

  // ---------------------------------------------------------------- Neon & Schilder
  M({ name: 'sign_backing', tile: [4, 2], palette: 'downtown', toon: { flags: SURF.EMISSIVE | SURF.NOTINT },
    paint: (p) => { p.fill(0x2c2a40); p.rect(2, 2, 60, 60, 0x3a3656); for (let i = 0; i < 5; i++) p.rect(8 + i * 10, 22, 7, 20, 0xf7f0e4); },
    emissive: (p) => { p.fill(0); for (let i = 0; i < 5; i++) p.rect(8 + i * 10, 22, 7, 20, [0xff4fae, 0x4ff2ff, 0xffe468, 0x6dff9c, 0xff4fae][i]); } }),
  M({ name: 'neon_tube', tile: [1, 1], palette: 'master', toon: { flags: SURF.EMISSIVE },
    paint: (p) => p.fill(0xffffff),
    emissive: (p) => p.fill(0xffffff) }),
  ...([['pink', 0xff7eb0], ['teal', 0x3fd8cc], ['orange', 0xff9f5a]] as const).map(([n, c]) =>
    M({ name: `awning_${n}`, tile: [2, 2], palette: 'ocean', toon: { flags: SURF.NOTINT },
      paint: (p) => { for (let x = 0; x < 64; x++) p.rect(x, 0, 1, 64, Math.floor(x / 8) % 2 ? c : 0xfbf6ee); p.rect(0, 58, 64, 6, shade(c, 0.85)); p.grain(0.03); } })),

  // ---------------------------------------------------------------- Ländliche Fassaden
  M({ name: 'facade_barn', tile: [4, 4], palette: 'pine', bleach: 0.3,
    paint: (p) => {
      p.planks(8, [0xf4ece4, 0xece0d4], 0x9a8070, true);
      p.line(8, 8, 56, 56, 0xffffff); p.line(56, 8, 8, 56, 0xffffff); p.rect(6, 6, 52, 2, 0xffffff); p.rect(6, 56, 52, 2, 0xffffff);
      tintMaskNear(p, 0xf0e8dc, 50);
    } }),
  M({ name: 'facade_trailer', tile: [3, 2.6], palette: 'pine', bleach: 0.25, toon: { flags: SURF.WINDOWS | SURF.SPEC },
    paint: (p) => {
      p.fill(0xf4f4f4); for (let y = 0; y < 64; y += 8) { p.rect(0, y, 64, 1, 0xffffff); p.rect(0, y + 6, 64, 2, 0xc8c8d0); }
      p.rect(0, 40, 64, 5, 0x52b85a); // Zierstreifen
      p.rect(10, 12, 18, 14, 0xffffff); windowRect(p, 11, 13, 16, 12);
      tintMaskNear(p, 0xf4f4f4, 50);
    },
    emissive: (p) => { p.fill(0); p.rect(11, 13, 16, 12, 0xffffff); } }),

  // ---------------------------------------------------------------- Decals (Alpha-Cutout)
  M({ name: 'decal_crack', tile: [3, 3], palette: 'master', decal: true,
    paint: (p) => { p.clear(); for (let i = 0; i < 3; i++) p.crack(20 + Math.floor(p.rnd() * 24), 8 + Math.floor(p.rnd() * 20), 50, 0x2c2a40, 220); } }),
  M({ name: 'decal_oil', tile: [2.5, 2.5], palette: 'master', decal: true,
    paint: (p) => { p.clear(); p.ditherDisc(32, 32, 22, 0x2c2a40, 0.9); p.ditherDisc(26, 28, 9, 0x4a3a6a, 1.2); p.ditherDisc(38, 36, 5, 0x3a5a6a, 1.2); } }),
  M({ name: 'decal_manhole', tile: [1.2, 1.2], palette: 'master', decal: true,
    paint: (p) => {
      p.clear(); p.disc(32, 32, 30, 0x3a3848); p.ring(32, 32, 26, 30, 0x5e5a6e);
      for (let k = -20; k <= 20; k += 6) p.rect(32 + k - 1, 12, 2, 40, 0x4a4658);
      p.ring(32, 32, 10, 12, 0x5e5a6e);
    } }),
  M({ name: 'decal_tire', tile: [4, 2], palette: 'master', decal: true,
    paint: (p) => { p.clear(); for (const y of [18, 44]) for (let x = 0; x < 64; x++) { const yy = y + Math.round(Math.sin(x * 0.12) * 3); if (p.rnd() < 0.8) p.rect(x, yy, 1, 5, 0x2c2a40, 200); } } }),
  M({ name: 'decal_puddle', tile: [3, 3], palette: 'master', decal: true, toon: { flags: SURF.GLASS | SURF.SPEC | SURF.NOTINT },
    paint: (p) => { p.clear(); p.ditherDisc(32, 32, 26, 0x4a5a7a, 0.5); p.ditherDisc(28, 30, 14, 0x6a8aaa, 0.8); } }),
  M({ name: 'decal_sand', tile: [4, 4], palette: 'keys', decal: true,
    paint: (p) => { p.clear(); for (let i = 0; i < 9; i++) p.ditherDisc(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 6 + p.rnd() * 10, p.rnd() < 0.5 ? 0xf4dcaa : 0xe8cc98, 0.7); } }),
  M({ name: 'decal_shells', tile: [2, 2], palette: 'keys', decal: true,
    paint: (p) => { p.clear(); for (let i = 0; i < 14; i++) { const x = Math.floor(p.rnd() * 60), y = Math.floor(p.rnd() * 60); p.rect(x, y, 3, 2, [0xffffff, 0xffc2d6, 0xffd8a8][i % 3]); p.set(x + 1, y + 2, 0xe0c0a0); } } }),
  M({ name: 'decal_seaweed', tile: [3, 3], palette: 'keys', decal: true,
    paint: (p) => { p.clear(); for (let i = 0; i < 6; i++) p.crack(Math.floor(p.rnd() * 64), Math.floor(p.rnd() * 64), 28, i % 2 ? 0x356f45 : 0x5a6a3a); } }),
  M({ name: 'decal_graffiti', tile: [4, 2], palette: 'havana', decal: true, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.clear();
      const cols = [0xff4fae, 0x4ff2ff, 0xffe468, 0x6dff9c, 0x9a6bd8];
      for (let i = 0; i < 4; i++) {
        const c = cols[Math.floor(p.rnd() * cols.length)], x = 6 + i * 14;
        p.rect(x, 18, 11, 30, 0x2c2a40); p.rect(x + 1, 19, 9, 28, c); p.rect(x + 3, 24 + Math.floor(p.rnd() * 10), 5, 6, 0x2c2a40);
      }
      p.line(2, 52, 62, 46, 0xffffff); p.line(2, 53, 62, 47, 0x2c2a40);
    } }),
  M({ name: 'decal_mural_sun', tile: [8, 6], palette: 'havana', decal: true, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.fill(0xff9f5a);
      for (let y = 0; y < 64; y++) p.rect(0, y, 64, 1, mixHex(0xff7eb0, 0xffe468, y / 64));
      p.disc(32, 30, 14, 0xfff0a0);
      for (let y = 40; y < 64; y++) p.rect(0, y, 64, 1, (y >> 2) % 2 ? 0x3fd8cc : 0x2a8fb0);
      // Palmen-Silhouetten
      for (const x of [10, 52]) { p.rect(x, 20, 2, 26, 0x2c2a40); for (let k = -8; k <= 8; k++) p.set(x + k, 20 + Math.abs(k) / 2, 0x2c2a40); }
      p.rect(0, 0, 64, 2, 0xfbf6ee); p.rect(0, 62, 64, 2, 0xfbf6ee);
    } }),
  M({ name: 'decal_mural_flamingo', tile: [6, 6], palette: 'havana', decal: true, toon: { flags: SURF.NOTINT },
    paint: (p) => {
      p.fill(0x3fd8cc);
      p.blotches(0x9fe8de, 0.6, 16);
      p.disc(30, 22, 9, 0xff7eb0); p.rect(30, 8, 3, 14, 0xff7eb0); p.disc(34, 8, 3, 0xff7eb0); p.rect(36, 8, 4, 2, 0x2c2a40);
      p.rect(28, 30, 2, 26, 0xff4fae); p.rect(33, 30, 2, 22, 0xff4fae);
      for (let i = 0; i < 64; i += 8) p.disc(i, 60, 4, 0x52b85a);
    } }),
  M({ name: 'lamp_pool', tile: [10, 10], palette: 'master', decal: true,
    paint: (p) => { p.clear(); p.ditherDisc(32, 32, 31, 0xffffff, 1.6); } }),
  M({ name: 'blob_shadow', tile: [2, 2], palette: 'master', decal: true,
    paint: (p) => {
      // gerasterter DS-Schatten: Kern ~50 % Schachbrett, Rand dünnt nach außen aus (opak + Alpha-Test)
      p.clear();
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const d = Math.hypot(x - 31.5, y - 31.5) / 31;
        const v = d < 0.7 ? 0.52 : d < 1 ? 0.52 * (1 - (d - 0.7) / 0.3) : 0;
        if (v > (bayer[(y % 4) * 4 + (x % 4)] + 0.5) / 16) p.set(x, y, 0xffffff);
      }
    } }),
  M({ name: 'lilypad', tile: [1, 1], palette: 'swamp', decal: true,
    paint: (p) => { p.clear(); p.disc(32, 32, 28, 0x52a850); p.disc(32, 32, 22, 0x6cc060); for (let k = 0; k < 28; k++) p.set(32 + k, 32 - Math.floor(k / 3), 0); p.disc(20, 24, 4, 0xffc2d6); p.disc(20, 24, 2, 0xffe468); } }),
];

export type MaterialName = string;

export const MATERIAL_INDEX = new Map<string, number>(MATERIALS.map((m, i) => [m.name, i]));

export function matIndex(name: string): number {
  const i = MATERIAL_INDEX.get(name);
  if (i === undefined) throw new Error(`Unbekanntes Material: ${name}`);
  return i;
}

/** Palette (Farbliste) für eine Variante. */
export function paletteOf(v: MaterialDef['palette']): number[] {
  return v === 'master' ? PALMARA : [...MOODS[v].palette, ...PALMARA.slice(0, 8)];
}

/** Tönungsmaske überall auf "färben" lassen, falls der Maler nichts anderes gesetzt hat. */
export function finalizeTint(def: MaterialDef, p: Painter) {
  if (def.decal) return;
  if ((def.toon.flags ?? 0) & SURF.NOTINT) noTint(p);
}
