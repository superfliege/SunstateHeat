// NPC-Archetypen: datengetrieben. Der Server wählt per Population Table einen Archetyp,
// Client und Server kennen nur die Index-Nummer (ARCH_INDEX) – Outfit, Tempo und erlaubte
// Aktivitäten stehen hier. Barks (spec: NPC-Sprüche) kommen in einem späteren Schritt.
import type { ScenarioId } from './scenarios';

export type ArchetypeId =
  | 'tourist' | 'businessman' | 'jogger' | 'beachgoer' | 'partygoer' | 'worker' | 'fisher'
  | 'farmer' | 'retiree' | 'vendor' | 'homeless' | 'local' | 'dogwalker' | 'gang';

/** Skin-Gruppen der Kenney-Figuren (Dateinamen ohne .png). */
export type SkinSet = readonly string[];

export interface Archetype {
  id: ArchetypeId;
  name: string;
  /** Gehtempo in m/s (Jogger nutzen die Lauf-Animation, ab ~2,6 m/s). */
  speed: number;
  /** Mut 0–1 (Reaktionen kommen in Schritt 4). */
  courage: number;
  /** Outfit-Regel: Skins + (optional) Oberteilfarben aus OUTFIT_COLORS-Indizes. */
  skins: SkinSet;
  shirts?: readonly number[];
  /** Laufender Sekundär-Effekt auf dem Client: 'dog' = Hund an der Leine. */
  companion?: 'dog';
  /** Erlaubte Szenarien (Smart-Object-Aktionen und freie Szenarien). */
  scenarios: readonly ScenarioId[];
}

// OUTFIT_COLORS: 0 pink, 1 türkis, 2 orange, 3 violett, 4 grün, 5 gelb, 6 blau, 7 rot, 8 weiß, 9 schwarz, 10 lila, 11 teal
export const ARCHETYPES: readonly Archetype[] = [
  { id: 'tourist', name: 'Tourist', speed: 1.25, courage: 0.35,
    skins: ['casualFemaleA', 'casualFemaleB', 'casualMaleA', 'casualMaleB'], shirts: [0, 1, 2, 5, 6, 10],
    scenarios: ['photo', 'phone', 'talk', 'bench_sit', 'taco_eat', 'cafe_sit', 'atm_use', 'bus_wait', 'lean_wall', 'busk_watch'] },
  { id: 'businessman', name: 'Geschäftsmann', speed: 1.7, courage: 0.4,
    skins: ['businessMaleA', 'businessMaleB', 'casualFemaleB'], shirts: [8, 6, 9],
    scenarios: ['atm_use', 'phone', 'taco_eat', 'bench_sit', 'cafe_sit', 'bus_wait', 'smoke'] },
  { id: 'jogger', name: 'Jogger', speed: 3.0, courage: 0.6,
    skins: ['athleteFemaleBlue', 'athleteFemaleYellow', 'athleteMaleGreen', 'athleteMaleRed'],
    scenarios: [] },
  { id: 'beachgoer', name: 'Strandgast', speed: 1.3, courage: 0.5,
    skins: ['skaterFemaleA', 'skaterMaleA', 'athleteFemaleYellow', 'casualMaleB'], shirts: [1, 2, 5, 0, 4],
    scenarios: ['lounger_lie', 'hoop_play', 'talk', 'phone', 'taco_eat', 'fish_spot', 'photo'] },
  { id: 'partygoer', name: 'Partygänger', speed: 1.5, courage: 0.45,
    skins: ['skaterFemaleA', 'casualFemaleB', 'businessMaleB', 'casualMaleA'], shirts: [0, 10, 1, 3, 7],
    scenarios: ['club_queue', 'dance', 'talk', 'smoke', 'phone', 'lean_wall', 'taco_eat'] },
  { id: 'worker', name: 'Arbeiter', speed: 1.6, courage: 0.5,
    skins: ['survivorMaleA', 'survivorMaleB', 'farmerA'], shirts: [2, 5, 6],
    scenarios: ['smoke', 'taco_eat', 'bench_sit', 'lean_wall', 'phone'] },
  { id: 'fisher', name: 'Angler', speed: 1.3, courage: 0.5,
    skins: ['farmerA', 'farmerB', 'survivorMaleB'], shirts: [4, 6, 8],
    scenarios: ['fish_spot', 'bench_sit'] },
  { id: 'farmer', name: 'Farmer', speed: 1.5, courage: 0.6,
    skins: ['farmerA', 'farmerB'], shirts: [7, 6, 4],
    scenarios: ['bench_sit', 'smoke', 'lean_wall'] },
  { id: 'retiree', name: 'Rentner', speed: 0.95, courage: 0.3,
    skins: ['casualMaleA', 'farmerB', 'casualFemaleB', 'casualFemaleA'], shirts: [8, 11, 5],
    scenarios: ['bench_sit', 'news_read', 'cafe_sit', 'talk', 'bus_wait', 'busk_watch'] },
  { id: 'vendor', name: 'Straßenverkäufer', speed: 1.3, courage: 0.55,
    skins: ['casualMaleB', 'farmerA', 'casualFemaleB'], shirts: [2, 7, 5],
    scenarios: ['phone', 'smoke', 'talk', 'lean_wall', 'busk'] },
  { id: 'homeless', name: 'Obdachloser', speed: 1.0, courage: 0.3,
    skins: ['survivorMaleA', 'survivorFemaleB', 'militaryMaleA'], shirts: [9, 11],
    scenarios: ['trash_search', 'bench_sit', 'lean_wall', 'talk'] },
  { id: 'local', name: 'Anwohner', speed: 1.45, courage: 0.5,
    skins: ['casualFemaleA', 'casualMaleA', 'casualFemaleB', 'casualMaleB', 'survivorFemaleA'], shirts: [8, 6, 11, 4, 3],
    scenarios: ['talk', 'phone', 'smoke', 'bench_sit', 'cafe_sit', 'news_read', 'taco_eat', 'atm_use', 'bus_wait', 'payphone_call', 'busk'] },
  { id: 'dogwalker', name: 'Hundebesitzer', speed: 1.35, courage: 0.55,
    skins: ['casualFemaleA', 'casualMaleB', 'survivorFemaleA', 'athleteFemaleBlue'], shirts: [4, 1, 5, 3],
    companion: 'dog',
    scenarios: ['talk', 'phone', 'bench_sit'] },
  { id: 'gang', name: 'Gang-Mitglied', speed: 1.5, courage: 0.8,
    skins: ['criminalMaleA', 'survivorMaleA', 'skaterMaleA'], scenarios: ['smoke', 'lean_wall', 'talk'] },
];

export const ARCH_INDEX = Object.fromEntries(ARCHETYPES.map((a, i) => [a.id, i])) as Record<ArchetypeId, number>;
export function archetypeOf(index: number): Archetype { return ARCHETYPES[index] ?? ARCHETYPES[ARCH_INDEX.local]; }
