// Population Tables: pro Viertel und Tageszeit-Abschnitt (und später Wetter) bestimmen sie, wie
// viele Passanten pro 100 m Gehweg unterwegs sind, welche Archetypen es sind und wie viele direkt
// in einem Szenario statt laufend spawnen (spec 10.1: Typen pro Zone, Dichte nach Tageszeit).
// Viertel ohne eigene Tabelle (noch nicht ausgerollt) nutzen weiter das alte Spawning.
import type { ArchetypeId } from './archetypes';
import { DAY_LENGTH_MS } from '../constants';

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

// ---------------------------------------------------------------- Land (Norden): wenige Leute, viele Szenarien
// Dichte deutlich unter der Stadt; dafür starten 70–85 % direkt in einem Szenario (arbeiten, sitzen,
// über den Zaun reden). Gebiete außerhalb der Viertel: north.ts (ruralArea).
// Tiere zählen mit (Rinder, Milchkühe, Pferde, Hühner, Ziegen, Hofhunde) – sie erscheinen nur an Weideplätzen
const ANIMALS_DAY = { cow: 14, dairy_cow: 10, horse: 6, chicken: 12, goat: 3, farm_dog: 4 };
const ANIMALS_NIGHT = { cow: 20, dairy_cow: 12, horse: 8, farm_dog: 6 };
const FARMS_T: Tables = {
  morning: T(2.6, 0.85, { rancher: 15, milker: 15, farmhand: 18, townsfolk: 5, retiree: 5, ...ANIMALS_DAY }),
  noon: T(2.8, 0.8, { farmhand: 25, rancher: 15, milker: 5, townsfolk: 5, trucker: 5, ...ANIMALS_DAY }),
  afternoon: T(2.7, 0.8, { farmhand: 22, rancher: 15, retiree: 8, townsfolk: 5, milker: 5, ...ANIMALS_DAY }),
  evening: T(2.2, 0.85, { rancher: 18, retiree: 18, milker: 8, farmhand: 8, townsfolk: 5, ...ANIMALS_DAY }),
  night: T(1.0, 0.8, { rancher: 15, retiree: 10, ...ANIMALS_NIGHT }),
};
const PEAK_T: Tables = {
  morning: T(1.2, 0.7, { hiker: 30, climber: 12, ranger: 12, lumberjack: 12, quarry_worker: 8, hunter: 8, deer: 10, turkey: 8 }),
  noon: T(1.4, 0.7, { hiker: 32, climber: 14, camper: 14, quarry_worker: 14, lumberjack: 9, ranger: 9, deer: 4, turkey: 4 }),
  afternoon: T(1.4, 0.7, { hiker: 28, camper: 22, climber: 13, quarry_worker: 9, ranger: 9, hunter: 9, deer: 5, turkey: 5 }),
  evening: T(1.1, 0.8, { camper: 48, hiker: 16, ranger: 8, hunter: 12, deer: 10, turkey: 6 }),
  night: T(0.7, 0.85, { camper: 70, ranger: 8, hunter: 8, deer: 14 }),
};
const LAND_T: Tables = {
  morning: T(0.8, 0.75, { farmer: 25, rancher: 20, trucker: 20, farmhand: 20, hunter: 15 }),
  noon: T(0.9, 0.7, { farmhand: 30, trucker: 25, farmer: 20, rancher: 15, gas_attendant: 10 }),
  afternoon: T(0.9, 0.7, { farmhand: 25, trucker: 25, farmer: 20, rancher: 15, hunter: 15 }),
  evening: T(0.6, 0.8, { trucker: 35, rancher: 25, retiree: 20, hunter: 20 }),
  night: T(0.2, 0.7, { trucker: 70, hunter: 30 }),
};
const DIRT_T: Tables = {
  morning: T(0.5, 0.85, { farmhand: 50, rancher: 30, milker: 20 }),
  noon: T(0.6, 0.85, { farmhand: 60, rancher: 25, farmer: 15 }),
  afternoon: T(0.6, 0.85, { farmhand: 55, rancher: 30, farmer: 15 }),
  evening: T(0.4, 0.85, { rancher: 60, farmhand: 40 }),
  night: T(0.1, 0.5, { rancher: 100 }),
};
// Okeefield-Orte (Cane Ridge, Port Sabal, Sunny Acres): Kleinstadt, jeder kennt jeden
const TOWN_T: Tables = {
  morning: T(2.6, 0.6, { townsfolk: 35, retiree: 20, gas_attendant: 10, trucker: 15, farmer: 10, dogwalker: 10 }),
  noon: T(3.0, 0.6, { townsfolk: 40, trucker: 15, farmer: 15, retiree: 15, gas_attendant: 10, worker: 5 }),
  afternoon: T(3.0, 0.6, { townsfolk: 40, retiree: 20, trucker: 15, farmer: 10, dogwalker: 10, gas_attendant: 5 }),
  evening: T(2.4, 0.65, { townsfolk: 40, trucker: 25, retiree: 20, rancher: 15 }),
  night: T(0.8, 0.6, { trucker: 50, townsfolk: 30, gas_attendant: 20 }),
};
// Übergangszone (Vorstadt, Gewerbe, Trailerpark): Stadt- und Landtypen gemischt
const EDGE_T: Tables = {
  morning: T(2.0, 0.5, { local: 25, worker: 20, townsfolk: 20, jogger: 10, dogwalker: 10, trucker: 15 }),
  noon: T(2.2, 0.5, { local: 25, worker: 25, townsfolk: 20, trucker: 15, vendor: 15 }),
  afternoon: T(2.2, 0.5, { local: 25, townsfolk: 25, worker: 20, dogwalker: 15, trucker: 15 }),
  evening: T(1.8, 0.55, { local: 30, townsfolk: 25, trucker: 25, retiree: 20 }),
  night: T(0.8, 0.5, { local: 40, trucker: 40, homeless: 20 }),
};

/** Tabellen je Viertelname (District.name) bzw. Landgebiet (north.ts). Wetter-Varianten: `POP_WEATHER`. */
export const POP_TABLES: Record<string, Tables> = {
  'Ocean Strip': OCEAN_STRIP,
  'Okee Höfe': FARMS_T, 'Okee Peak': PEAK_T, 'Dry Pine Land': LAND_T, 'Feldwege': DIRT_T, 'Stadtrand': EDGE_T,
  'Cane Ridge': TOWN_T, 'Port Sabal': TOWN_T, 'Sunny Acres': TOWN_T,
};

/** Wochentag zur Spielzeit (Tage seit Start): 0 = Sonntag … 6 = Samstag (wie EventConditions.weekdays). */
export function weekdayOf(day: number): number { return ((Math.floor(day) % 7) + 7) % 7; }
/** Wochentag aus der Uhrzeit (ms): ein Spieltag = DAY_LENGTH_MS, auf Server und Client gleich. */
export function weekdayAt(nowMs: number): number { return weekdayOf(nowMs / DAY_LENGTH_MS); }
/** Sonntag: Kirchgänger in den Okeefield-Orten (Kirchenglocke im Audio). */
export const SUNDAY_EXTRA: Partial<Record<DayPart, Partial<Record<ArchetypeId, number>>>> = {
  morning: { churchgoer: 45 }, noon: { churchgoer: 20 },
};
/** Optionale Wetter-Abwandlungen (Struktur steht, Inhalte folgen mit dem Wettersystem, spec Schritt 8). */
export const POP_WEATHER: Record<string, Partial<Record<Weather, Partial<Tables>>>> = {};

export function hasPopTable(districtName: string | undefined): boolean { return !!districtName && districtName in POP_TABLES; }

export function popTable(districtName: string, part: DayPart, weather: Weather = 'clear', sunday = false): PopTable | null {
  const base = POP_TABLES[districtName];
  if (!base) return null;
  const t = POP_WEATHER[districtName]?.[weather]?.[part] ?? base[part];
  if (sunday && base === TOWN_T && SUNDAY_EXTRA[part]) return { ...t, mix: { ...t.mix, ...SUNDAY_EXTRA[part] } };
  return t;
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
