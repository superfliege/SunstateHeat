// NPC-Archetypen: datengetrieben. Der Server wählt per Population Table einen Archetyp,
// Client und Server kennen nur die Index-Nummer (ARCH_INDEX) – Outfit, Tempo und erlaubte
// Aktivitäten stehen hier. Barks (spec: NPC-Sprüche) kommen in einem späteren Schritt.
import type { ScenarioId } from './scenarios';

export type ArchetypeId =
  | 'tourist' | 'businessman' | 'jogger' | 'beachgoer' | 'partygoer' | 'worker' | 'fisher'
  | 'farmer' | 'retiree' | 'vendor' | 'homeless' | 'local' | 'dogwalker' | 'gang'
  // Land & Berg (Dry Pine Country, Okeefield, Okee Peak)
  | 'rancher' | 'farmhand' | 'milker' | 'gas_attendant' | 'trucker' | 'hunter' | 'hiker' | 'climber' | 'camper'
  | 'ranger' | 'lumberjack' | 'quarry_worker' | 'townsfolk' | 'churchgoer'
  // Tiere als Teil der Bevölkerung (gleiches System: Sync, Reaktionen, Animations-LOD)
  | 'cow' | 'dairy_cow' | 'horse' | 'chicken' | 'goat' | 'farm_dog' | 'deer' | 'turkey';

/** Tierart (Client zeichnet ein Tiermodell statt einer Figur). */
export type AnimalSpecies = 'cow' | 'dairy_cow' | 'horse' | 'chicken' | 'goat' | 'dog' | 'deer' | 'turkey';

/** Kopfbedeckung/Ausrüstung (Client hängt einfache Modelle an Kopf/Rücken). */
export type Gear = 'cowboy' | 'cap' | 'trucker_cap' | 'straw' | 'hardhat' | 'helmet' | 'ranger_hat' | 'beanie' | 'backpack' | 'vest' | 'boots' | 'overalls' | 'plaid' | 'sunday_hat';

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
  /** Outfit-Ergänzungen (Hut, Cap, Helm, Warnweste, Rucksack, Latzhose, Karohemd …). */
  gear?: readonly Gear[];
  /** Tier statt Mensch: kein Outfit, Tiermodell, Tierlaute statt Sprüchen, ohne Verletzungen (Comic-Physik). */
  animal?: AnimalSpecies;
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
  // ---------------------------------------------------------------- Land & Berg (Indizes ab 14)
  { id: 'rancher', name: 'Rancher', speed: 1.4, courage: 0.75, skins: ['farmerB', 'farmerA'], shirts: [7, 6, 9], gear: ['cowboy', 'boots', 'plaid'],
    scenarios: ['feed_animals', 'fix_fence', 'porch_sit', 'fence_chat', 'load_hay', 'smoke', 'lean_wall'] },
  { id: 'farmhand', name: 'Erntehelfer', speed: 1.5, courage: 0.5, skins: ['farmerA', 'survivorMaleB', 'survivorFemaleA'], shirts: [5, 2, 8], gear: ['straw', 'overalls'],
    scenarios: ['harvest', 'load_hay', 'feed_animals', 'talk', 'fence_chat'] },
  { id: 'milker', name: 'Melker', speed: 1.35, courage: 0.5, skins: ['farmerA', 'farmerB'], shirts: [8, 6], gear: ['cap', 'boots', 'overalls'],
    scenarios: ['milk_cow', 'feed_animals', 'repair_tool', 'porch_sit'] },
  { id: 'gas_attendant', name: 'Tankwart', speed: 1.3, courage: 0.55, skins: ['survivorMaleA', 'farmerB'], shirts: [7, 8], gear: ['trucker_cap'],
    scenarios: ['smoke', 'lean_wall', 'talk', 'repair_tool', 'phone'] },
  { id: 'trucker', name: 'Trucker', speed: 1.45, courage: 0.7, skins: ['survivorMaleA', 'survivorMaleB', 'farmerB'], shirts: [7, 9, 6], gear: ['trucker_cap', 'plaid'],
    scenarios: ['smoke', 'lean_wall', 'talk', 'cafe_sit', 'phone'] },
  { id: 'hunter', name: 'Jäger', speed: 1.3, courage: 0.8, skins: ['militaryMaleA', 'survivorMaleB'], shirts: [2, 4], gear: ['cap', 'vest', 'boots'],
    scenarios: ['photo', 'smoke', 'talk', 'campfire_sit'] },
  { id: 'hiker', name: 'Wanderer', speed: 1.4, courage: 0.6, skins: ['athleteFemaleBlue', 'athleteMaleGreen', 'survivorFemaleA', 'casualMaleB'], shirts: [4, 1, 2], gear: ['backpack', 'cap', 'boots'],
    scenarios: ['photo', 'telescope_look', 'cafe_sit', 'bench_sit', 'talk'] },
  { id: 'climber', name: 'Kletterer', speed: 1.35, courage: 0.85, skins: ['athleteMaleRed', 'athleteFemaleYellow', 'skaterMaleA'], shirts: [7, 5, 1], gear: ['helmet', 'backpack'],
    scenarios: ['photo', 'telescope_look', 'talk', 'campfire_sit'] },
  { id: 'camper', name: 'Camper', speed: 1.2, courage: 0.5, skins: ['casualFemaleA', 'casualMaleA', 'casualMaleB', 'survivorFemaleB'], shirts: [4, 3, 11, 2], gear: ['beanie'],
    scenarios: ['campfire_sit', 'grill_eat', 'fish_spot', 'talk', 'guitar_play'] },
  { id: 'ranger', name: 'Ranger', speed: 1.45, courage: 0.8, skins: ['survivorFemaleA', 'farmerB', 'militaryMaleA'], shirts: [4], gear: ['ranger_hat', 'boots'],
    scenarios: ['telescope_look', 'photo', 'talk', 'repair_tool'] },
  { id: 'lumberjack', name: 'Holzfäller', speed: 1.4, courage: 0.75, skins: ['survivorMaleB', 'farmerA'], shirts: [7, 9], gear: ['beanie', 'plaid', 'boots'],
    scenarios: ['load_hay', 'repair_tool', 'smoke', 'campfire_sit'] },
  { id: 'quarry_worker', name: 'Steinbrucharbeiter', speed: 1.45, courage: 0.65, skins: ['survivorMaleA', 'survivorMaleB', 'farmerA'], shirts: [2, 5], gear: ['hardhat', 'vest', 'boots'],
    scenarios: ['repair_tool', 'smoke', 'lean_wall', 'talk'] },
  { id: 'townsfolk', name: 'Kleinstadtbewohner', speed: 1.35, courage: 0.5, skins: ['casualFemaleA', 'casualMaleA', 'casualFemaleB', 'farmerB'], shirts: [8, 6, 11, 4, 3], gear: ['trucker_cap'],
    scenarios: ['talk', 'bench_sit', 'cafe_sit', 'news_read', 'porch_sit', 'egg_buy', 'phone', 'payphone_call'] },
  { id: 'churchgoer', name: 'Kirchgänger', speed: 1.1, courage: 0.35, skins: ['businessMaleA', 'casualFemaleB', 'businessMaleB'], shirts: [8, 9], gear: ['sunday_hat'],
    scenarios: ['talk', 'bench_sit', 'porch_sit'] },
  // ---------------------------------------------------------------- Tiere (Indizes ab 28)
  { id: 'cow', name: 'Rind', speed: 0.8, courage: 0.15, skins: [], animal: 'cow', scenarios: ['graze'] },
  { id: 'dairy_cow', name: 'Milchkuh', speed: 0.7, courage: 0.2, skins: [], animal: 'dairy_cow', scenarios: ['graze'] },
  { id: 'horse', name: 'Pferd', speed: 1.4, courage: 0.25, skins: [], animal: 'horse', scenarios: ['graze'] },
  { id: 'chicken', name: 'Huhn', speed: 0.9, courage: 0.05, skins: [], animal: 'chicken', scenarios: ['peck'] },
  { id: 'goat', name: 'Ziege', speed: 1.0, courage: 0.6, skins: [], animal: 'goat', scenarios: ['graze'] },
  { id: 'farm_dog', name: 'Hofhund', speed: 2.2, courage: 0.9, skins: [], animal: 'dog', scenarios: ['guard'] },
  { id: 'deer', name: 'Hirsch', speed: 2.6, courage: 0.05, skins: [], animal: 'deer', scenarios: ['graze'] },
  { id: 'turkey', name: 'Wildtruthahn', speed: 1.1, courage: 0.1, skins: [], animal: 'turkey', scenarios: ['peck'] },
];

export const ARCH_INDEX = Object.fromEntries(ARCHETYPES.map((a, i) => [a.id, i])) as Record<ArchetypeId, number>;
export function archetypeOf(index: number): Archetype { return ARCHETYPES[index] ?? ARCHETYPES[ARCH_INDEX.local]; }
