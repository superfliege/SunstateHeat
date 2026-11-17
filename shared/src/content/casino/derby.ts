// Alligator-Rennen „Gator Derby“: 6 Comic-Alligatoren mit Namen, Eigenschaften und Form. Quoten folgen
// der Form (mit Hausvorteil). Der Server bestimmt den Sieger mit sicherem Zufall gemäß der Siegchancen
// und erzeugt daraus ein Rennskript (Zwischenstände), das alle Clients identisch abspielen.
// Läuft im Casino auf dem Großbildschirm sowie in Bars/Wettbüros in Gator Flats und Okeefield.

export interface Gator { id: number; name: string; trait: string; color: number; /** Grundstärke 1–10 */ base: number }
export const GATORS: Gator[] = [
  { id: 0, name: 'Mr. Chompers', trait: 'Schnappt beim Start zu – und manchmal nach dem Starter.', color: 0x5aa83a, base: 7.5 },
  { id: 1, name: 'Lady Swampsalot', trait: 'Elegant, launisch, liebt Schlammbäder kurz vor dem Ziel.', color: 0x8a5ad8, base: 6.8 },
  { id: 2, name: 'Old Grumpy', trait: '87 Jahre alt (behauptet er). Langsamer Start, zäher Endspurt.', color: 0x6b7a4a, base: 5.6 },
  { id: 3, name: 'Turbo Tina', trait: 'Raketenstart, Puste wie ein Strohhalm.', color: 0xff8a2a, base: 6.2 },
  { id: 4, name: 'Sir Snapsalot III', trait: 'Adelig, trägt Monokel, hasst Pfützen.', color: 0x2ad4c9, base: 5.0 },
  { id: 5, name: 'Baby Boots', trait: 'Der Kleinste im Feld. Unterschätzt. Meistens zu Recht.', color: 0xffd23a, base: 4.2 },
];
/** Hausvorteil: Quoten zahlen (1 − EDGE) / Wahrscheinlichkeit. */
export const DERBY_EDGE = 0.12;

/** Form-Werte (−2 … +2) je Alligator → Siegchancen (Summe 1). */
export function derbyChances(form: readonly number[]): number[] {
  const s = GATORS.map((g, i) => Math.pow(Math.max(0.5, g.base + (form[i] ?? 0)), 2.2));
  const sum = s.reduce((a, b) => a + b, 0);
  return s.map((v) => v / sum);
}
/** Dezimalquoten (Auszahlung inkl. Einsatz = Einsatz x Quote), auf 0,1 abgerundet, mindestens 1,2. */
export const derbyOdds = (form: readonly number[]) => derbyChances(form).map((p) => Math.max(1.2, Math.floor(((1 - DERBY_EDGE) / p) * 10) / 10));

/**
 * Rennskript aus Einlaufreihenfolge (order[0] = Sieger) und Seed: je Alligator 16 Zwischenstände 0 … 1.
 * Deterministisch, damit alle Clients dasselbe Rennen sehen. Der Sieger erreicht 1 als Erster.
 */
export function derbyScript(order: readonly number[], seed: number): number[][] {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const STEPS = 16;
  const out: number[][] = GATORS.map(() => []);
  order.forEach((g, place) => {
    const finish = 1 - place * 0.035 - rnd() * 0.01; // Rückstand im Ziel
    // Verlauf: Charakter (Turbo Tina schnell los, Old Grumpy spät) + Zufallswellen, am Ende auf finish gezogen
    const early = g === 3 ? 1.35 : g === 2 ? 0.7 : g === 0 ? 1.15 : 1;
    let v = 0;
    const raw: number[] = [];
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS;
      v += (early + (1 - early) * t * 2) * (0.75 + rnd() * 0.5);
      raw.push(v);
    }
    const last = raw[raw.length - 1];
    for (const r of raw) out[g].push(Math.min(1, (r / last) * finish));
  });
  return out;
}

export interface DerbyView {
  /** Rennen-Nr., Phase, Restzeit bis zum Start bzw. Rennende (s) */
  race: number;
  phase: 'bet' | 'run' | 'result';
  t: number;
  form: number[];
  odds: number[];
  /** Während/nach dem Rennen: Einlauf und Skript */
  order?: number[];
  script?: number[][];
  /** Eigene Wetten [Alligator, Betrag] */
  mine: [number, number][];
  /** Kommentator-Zeile */
  say?: string;
  history: number[];
}
