// Population Tables: pro Viertel und Tageszeit-Abschnitt (und später Wetter) bestimmen sie, wie
// viele Passanten pro 100 m Gehweg unterwegs sind, welche Archetypen es sind und wie viele direkt
// in einem Szenario statt laufend spawnen (spec 10.1: Typen pro Zone, Dichte nach Tageszeit).
// Viertel ohne eigene Tabelle (noch nicht ausgerollt) nutzen weiter das alte Spawning.
import type { ArchetypeId } from './archetypes';

export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
export type Weather = 'clear' | 'rain' | 'heat';
export const DAY_PARTS: readonly DayPart[] = ['morning', 'noon', 'afternoon', 'evening', 'night'];
export const DAY_PART_NAMES: Record<DayPart, string> = { morning: 'Morgen', noon: 'Mittag', afternoon: 'Nachmittag', evening: 'Abend', night: 'Nacht' };

/** Tageszeit-Abschnitt zur Tagesphase 0–1 (0 = Mitternacht, 0.5 = Mittag). */
export function dayPartOf(day: number): DayPart {
  const h = (((day % 1) + 1) % 1) * 24;
  if (h >= 6 && h < 11) return 'morning';
  if (h >= 11 && h < 15) return 'noon';
  if (h >= 15 && h < 18.5) return 'afternoon';
  if (h >= 18.5 && h < 22) return 'evening';
  return 'night';
}

export interface PopTable {
  /** Passanten pro 100 m Gehweg. */
  density: number;
  /** Mischung: Archetyp → Gewicht (relativ). */
  mix: Partial<Record<ArchetypeId, number>>;
  /** Anteil der Neuspawns, die direkt in einem Szenario starten (Ziel 40–60 %). */
  scenarioShare: number;
}

/** Maximal aktive Passanten pro Spieler-Umkreis (spec 10.1). */
export const MAX_PEDS_PER_PLAYER = 40;
/** Radius des Spieler-Umkreises in m (Detailstufe Nah + Mittel; Fern existiert nicht). */
export const POP_RADIUS = 105;

type Tables = Record<DayPart, PopTable>;
const T = (density: number, scenarioShare: number, mix: PopTable['mix']): PopTable => ({ density, scenarioShare, mix });

const OCEAN_STRIP: Tables = {
  morning: T(4.5, 0.45, { jogger: 40, dogwalker: 20, beachgoer: 20, local: 20 }),
  noon: T(6.5, 0.5, { tourist: 35, beachgoer: 30, local: 10, vendor: 10, retiree: 10, businessman: 5 }),
  afternoon: T(7, 0.5, { tourist: 30, beachgoer: 30, jogger: 10, dogwalker: 10, local: 10, retiree: 5, vendor: 5 }),
  evening: T(6, 0.5, { tourist: 30, partygoer: 30, local: 15, dogwalker: 10, vendor: 5, retiree: 5, jogger: 5 }),
  night: T(4.5, 0.55, { partygoer: 60, tourist: 20, homeless: 20 }),
};

/** Tabellen je Viertelname (District.name). Wetter-Varianten: Schlüssel `Name|rain` überschreiben die Basis. */
export const POP_TABLES: Record<string, Tables> = {
  'Ocean Strip': OCEAN_STRIP,
};
/** Optionale Wetter-Abwandlungen (Struktur steht, Inhalte folgen mit dem Wettersystem, spec Schritt 8). */
export const POP_WEATHER: Record<string, Partial<Record<Weather, Partial<Tables>>>> = {};

export function hasPopTable(districtName: string | undefined): boolean { return !!districtName && districtName in POP_TABLES; }

export function popTable(districtName: string, part: DayPart, weather: Weather = 'clear'): PopTable | null {
  const base = POP_TABLES[districtName];
  if (!base) return null;
  return POP_WEATHER[districtName]?.[weather]?.[part] ?? base[part];
}

/** Gewichtete Auswahl eines Archetyps; r in [0,1). */
export function pickArchetype(t: PopTable, r: number): ArchetypeId {
  const e = Object.entries(t.mix) as [ArchetypeId, number][];
  let sum = 0;
  for (const [, w] of e) sum += w;
  let x = r * sum;
  for (const [id, w] of e) { x -= w; if (x < 0) return id; }
  return e[e.length - 1][0];
}
