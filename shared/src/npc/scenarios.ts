// Szenarien & Smart Objects (spec 10.1): Smart Objects stehen in der Welt (shared/world/smartObjects.ts
// platziert sie, Overrides in den Kartendaten sind möglich) und bieten Plätze (Slots) an, auf denen
// ein NPC eine Aktion ausführt. Freie Szenarien (Gespräch, Rauchen, Straßenmusik …) brauchen kein Objekt.
// Über das Netz geht nur die kleine Animations-ID `Act`; Gestik und Kopfdrehung rechnet der Client selbst.
import type { DayPart } from './population';

/** Zustands-ID der Animation (im Snapshot als kleine Zahl). 0 = normal laufen/stehen. */
export const Act = {
  None: 0, Sit: 1, Lie: 2, Lean: 3, Phone: 4, Smoke: 5, Talk: 6, Photo: 7, Eat: 8, Fish: 9, Dance: 10,
  Busk: 11, Watch: 12, Search: 13, Read: 14, Atm: 15, Wait: 16, Hoop: 17, Jog: 18, Dog: 19, Drink: 20,
  // Reaktionen (Schritt 4): kurz hinschauen, erschrecken, schimpfen, filmen, ducken, zeigen, Polizei rufen,
  // Panik (rennt mit erhobenen Armen), winken, durch eine Tür / ins Auto gehen
  Look: 21, Flinch: 22, Scold: 23, Film: 24, Cower: 25, Point: 26, Call: 27, Panic: 28, Wave: 29, Enter: 30,
} as const;
export type ActId = (typeof Act)[keyof typeof Act];
export const ACT_NAMES = Object.fromEntries(Object.entries(Act).map(([k, v]) => [v, k])) as Record<number, string>;

export const SmartKind = {
  Bench: 0, BusStop: 1, TacoStand: 2, Atm: 3, Lounger: 4, FishSpot: 5, Payphone: 6, Wall: 7,
  Trash: 8, Newsbox: 9, ClubDoor: 10, CafeTable: 11, Hoop: 12, Grill: 13,
  /** Haus-/Bürotür: NPCs verlassen hier die Welt (unsichtbar, die Fassade zeigt die Tür). */
  Door: 14,
  // Höfe & Berg (Smart-Object-Sammlungen der Höfe, farms.ts / okeePeak.ts)
  FeedTrough: 15, MilkStall: 16, HayStack: 17, FenceSpot: 18, FieldRow: 19, Porch: 20, ToolBench: 21, Campfire: 22,
  Telescope: 23, EggStand: 24, GuitarChair: 25,
  /** Weidefläche / Auslauf / Lichtung: Plätze für Tiere (Grasen, Picken, Wache halten). */
  Graze: 26,
} as const;
export type SmartKindId = (typeof SmartKind)[keyof typeof SmartKind];

/** Platz an einem Objekt: Offset im Objekt-Koordinatensystem (+z = Vorderseite) und Blickrichtung relativ zum Objekt. */
export interface Slot { x: number; z: number; a: number }
const S = (x: number, z: number, a = 0): Slot => ({ x, z, a });

export interface SmartKindDef { name: string; slots: Slot[] }
export const SMART_KINDS: Record<SmartKindId, SmartKindDef> = {
  [SmartKind.Bench]: { name: 'Bank', slots: [S(-0.45, 0), S(0.45, 0)] },
  [SmartKind.BusStop]: { name: 'Bushaltestelle', slots: [S(-0.55, -0.35), S(0.55, -0.35), S(-0.7, 1.5), S(0.7, 1.5)] },
  [SmartKind.TacoStand]: { name: 'Taco-Stand', slots: [S(-0.9, 1.7, Math.PI), S(0.9, 1.7, Math.PI), S(0, 2.5, Math.PI)] },
  [SmartKind.Atm]: { name: 'Geldautomat', slots: [S(0, 0.9, Math.PI)] },
  [SmartKind.Lounger]: { name: 'Liegestuhl', slots: [S(0, 0)] },
  [SmartKind.FishSpot]: { name: 'Angelplatz', slots: [S(0, 0), S(1.8, 0.3)] },
  [SmartKind.Payphone]: { name: 'Telefonzelle', slots: [S(0, 0.9, Math.PI)] },
  [SmartKind.Wall]: { name: 'Hauswand', slots: [S(-1.2, 0.55), S(1.2, 0.55)] },
  [SmartKind.Trash]: { name: 'Mülltonne', slots: [S(0, 0.85, Math.PI)] },
  [SmartKind.Newsbox]: { name: 'Zeitungsautomat', slots: [S(0, 0.85, Math.PI)] },
  // 0–5 Warteschlange (von vorn nach hinten), 6–7 Tanzfläche vor dem Eingang
  [SmartKind.ClubDoor]: {
    name: 'Club-Eingang',
    slots: [0, 1, 2, 3, 4, 5].map((i) => S(0, 1.7 + i * 0.95, Math.PI)).concat([S(-2.2, 3.6, 0.5), S(2.2, 3.6, -0.5)]),
  },
  [SmartKind.CafeTable]: { name: 'Café-Tisch', slots: [S(-0.9, 0, Math.PI / 2), S(0.9, 0, -Math.PI / 2)] },
  [SmartKind.Hoop]: { name: 'Basketballkorb', slots: [S(0, 3.2, Math.PI), S(-2.2, 4.4, Math.PI), S(2.0, 5.2, Math.PI)] },
  [SmartKind.Grill]: { name: 'Grill', slots: [S(-1, 1.3, Math.PI), S(1, 1.3, Math.PI)] },
  [SmartKind.Door]: { name: 'Tür', slots: [S(0, 0.5, Math.PI)] },
  [SmartKind.FeedTrough]: { name: 'Futtertrog', slots: [S(-1, 0.9, Math.PI), S(1, 0.9, Math.PI)] },
  [SmartKind.MilkStall]: { name: 'Melkstand', slots: [S(-1.5, 1.2, Math.PI), S(1.5, 1.2, Math.PI)] },
  [SmartKind.HayStack]: { name: 'Heuballen', slots: [S(0, 1.3, Math.PI), S(1.2, 1.0, Math.PI * 0.8)] },
  [SmartKind.FenceSpot]: { name: 'Zaun', slots: [S(0, 0.7, Math.PI), S(0, -0.7, 0)] },
  [SmartKind.FieldRow]: { name: 'Feldreihe', slots: [S(-1.5, 0), S(1.5, 0), S(0, 2.5)] },
  [SmartKind.Porch]: { name: 'Veranda', slots: [S(-0.6, 0), S(0.6, 0)] },
  [SmartKind.ToolBench]: { name: 'Werkbank', slots: [S(0, 0.8, Math.PI)] },
  [SmartKind.Campfire]: { name: 'Lagerfeuer', slots: [S(0, 1.6, Math.PI), S(1.4, -0.8, -Math.PI * 0.66), S(-1.4, -0.8, Math.PI * 0.66)] },
  [SmartKind.Telescope]: { name: 'Fernrohr', slots: [S(0, -0.8, 0)] },
  [SmartKind.EggStand]: { name: 'Eier-/Hofstand', slots: [S(0, -0.9, Math.PI), S(0, 1.4, 0), S(1, 1.6, 0)] },
  [SmartKind.GuitarChair]: { name: 'Stuhl mit Gitarre', slots: [S(0, 0)] },
  [SmartKind.Graze]: { name: 'Weideplatz', slots: [S(-4, -3, 0.4), S(3, -4, 2.1), S(-2, 4, -1.2), S(5, 2, 3.0), S(0, 0, 1.6), S(-6, 1, -2.4)] },
};

export type ScenarioId =
  | 'bench_sit' | 'bus_wait' | 'taco_eat' | 'atm_use' | 'lounger_lie' | 'fish_spot' | 'payphone_call' | 'lean_wall'
  | 'trash_search' | 'news_read' | 'club_queue' | 'dance' | 'cafe_sit' | 'hoop_play' | 'grill_eat'
  | 'talk' | 'smoke' | 'phone' | 'photo' | 'busk' | 'busk_watch'
  // Höfe & Berg
  | 'feed_animals' | 'milk_cow' | 'load_hay' | 'fix_fence' | 'harvest' | 'porch_sit' | 'guitar_play' | 'repair_tool'
  | 'campfire_sit' | 'telescope_look' | 'egg_buy' | 'fence_chat'
  // Tiere
  | 'graze' | 'peck' | 'guard';

export interface ScenarioDef {
  id: ScenarioId;
  name: string;
  act: ActId;
  /** Dauer in Sekunden [min, max]. */
  dur: [number, number];
  /** Nur zu diesen Tageszeiten (leer = immer). */
  parts?: DayPart[];
  /** Smart-Object-Szenario: an welchen Objekten und auf welchen Slots. Ohne `where` = freies Szenario. */
  where?: { kind: SmartKindId; slots: number[] }[];
  /** Freie Szenarien: Gruppengröße (Gespräch 2–4, Straßenmusik mit Zuschauern). */
  group?: [number, number];
  /** Wie stark das Szenario die Bedürfnisse senkt (0–1, siehe npc/intents.ts NEEDS). */
  relief?: Partial<Record<'hunger' | 'boredom' | 'fatigue', number>>;
}

const DAY: DayPart[] = ['morning', 'noon', 'afternoon'];
const NOT_NIGHT: DayPart[] = ['morning', 'noon', 'afternoon', 'evening'];
const LATE: DayPart[] = ['evening', 'night'];

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  bench_sit: { id: 'bench_sit', name: 'Auf der Bank sitzen', act: Act.Sit, dur: [25, 80], where: [{ kind: SmartKind.Bench, slots: [0, 1] }, { kind: SmartKind.BusStop, slots: [0, 1] }], relief: { fatigue: 1, boredom: 0.2 } },
  bus_wait: { id: 'bus_wait', name: 'Auf den Bus warten', act: Act.Wait, dur: [20, 60], where: [{ kind: SmartKind.BusStop, slots: [2, 3] }], relief: { fatigue: 0.2 } },
  taco_eat: { id: 'taco_eat', name: 'Taco essen', act: Act.Eat, dur: [20, 45], where: [{ kind: SmartKind.TacoStand, slots: [0, 1, 2] }], relief: { hunger: 1, boredom: 0.2 } },
  atm_use: { id: 'atm_use', name: 'Geld abheben', act: Act.Atm, dur: [8, 16], where: [{ kind: SmartKind.Atm, slots: [0] }], relief: { boredom: 0.1 } },
  lounger_lie: { id: 'lounger_lie', name: 'Sonnen', act: Act.Lie, dur: [60, 200], parts: ['morning', 'noon', 'afternoon', 'evening'], where: [{ kind: SmartKind.Lounger, slots: [0] }], relief: { fatigue: 1, boredom: 0.5 } },
  fish_spot: { id: 'fish_spot', name: 'Angeln', act: Act.Fish, dur: [60, 180], where: [{ kind: SmartKind.FishSpot, slots: [0, 1] }], relief: { boredom: 1, fatigue: 0.4 } },
  payphone_call: { id: 'payphone_call', name: 'Telefonieren (Zelle)', act: Act.Phone, dur: [20, 50], where: [{ kind: SmartKind.Payphone, slots: [0] }], relief: { boredom: 0.4 } },
  lean_wall: { id: 'lean_wall', name: 'An die Wand lehnen', act: Act.Lean, dur: [20, 60], where: [{ kind: SmartKind.Wall, slots: [0, 1] }], relief: { fatigue: 0.4, boredom: 0.2 } },
  trash_search: { id: 'trash_search', name: 'Mülltonne durchsuchen', act: Act.Search, dur: [10, 24], where: [{ kind: SmartKind.Trash, slots: [0] }], relief: { hunger: 0.5 } },
  news_read: { id: 'news_read', name: 'Zeitung lesen', act: Act.Read, dur: [20, 45], parts: DAY, where: [{ kind: SmartKind.Newsbox, slots: [0] }], relief: { boredom: 0.7 } },
  club_queue: { id: 'club_queue', name: 'Vor dem Club anstehen', act: Act.Wait, dur: [60, 200], parts: LATE, where: [{ kind: SmartKind.ClubDoor, slots: [0, 1, 2, 3, 4, 5] }], relief: { boredom: 0.4 } },
  dance: { id: 'dance', name: 'Vor dem Club tanzen', act: Act.Dance, dur: [40, 120], parts: LATE, where: [{ kind: SmartKind.ClubDoor, slots: [6, 7] }], relief: { boredom: 1 } },
  cafe_sit: { id: 'cafe_sit', name: 'Im Café sitzen', act: Act.Drink, dur: [30, 90], parts: NOT_NIGHT, where: [{ kind: SmartKind.CafeTable, slots: [0, 1] }], relief: { hunger: 0.5, fatigue: 0.6, boredom: 0.4 } },
  hoop_play: { id: 'hoop_play', name: 'Basketball spielen', act: Act.Hoop, dur: [30, 90], parts: NOT_NIGHT, where: [{ kind: SmartKind.Hoop, slots: [0, 1, 2] }], relief: { boredom: 1 } },
  grill_eat: { id: 'grill_eat', name: 'Grillen', act: Act.Eat, dur: [40, 100], where: [{ kind: SmartKind.Grill, slots: [0, 1] }], relief: { hunger: 1, boredom: 0.4 } },
  // Freie Szenarien (ohne Objekt)
  talk: { id: 'talk', name: 'Gespräch', act: Act.Talk, dur: [20, 60], group: [2, 4], relief: { boredom: 0.8 } },
  smoke: { id: 'smoke', name: 'Rauchen', act: Act.Smoke, dur: [15, 35], relief: { boredom: 0.4 } },
  phone: { id: 'phone', name: 'Telefonieren', act: Act.Phone, dur: [15, 40], relief: { boredom: 0.5 } },
  photo: { id: 'photo', name: 'Fotos machen', act: Act.Photo, dur: [10, 25], parts: NOT_NIGHT, relief: { boredom: 0.6 } },
  busk: { id: 'busk', name: 'Straßenmusik', act: Act.Busk, dur: [60, 180], parts: ['noon', 'afternoon', 'evening'], group: [2, 4], relief: { boredom: 0.6 } },
  busk_watch: { id: 'busk_watch', name: 'Straßenmusik zuhören', act: Act.Watch, dur: [20, 60], parts: ['noon', 'afternoon', 'evening'], relief: { boredom: 0.9 } },
  // Höfe: morgens Füttern/Melken, mittags Feldarbeit, abends Verandasitzen und Gitarre
  feed_animals: { id: 'feed_animals', name: 'Tiere füttern', act: Act.Search, dur: [25, 60], parts: ['morning', 'evening'], where: [{ kind: SmartKind.FeedTrough, slots: [0, 1] }], relief: { boredom: 0.6 } },
  milk_cow: { id: 'milk_cow', name: 'Melken', act: Act.Search, dur: [40, 90], parts: ['morning', 'evening'], where: [{ kind: SmartKind.MilkStall, slots: [0, 1] }], relief: { boredom: 0.5 } },
  load_hay: { id: 'load_hay', name: 'Heu laden', act: Act.Search, dur: [30, 70], parts: ['morning', 'noon', 'afternoon'], where: [{ kind: SmartKind.HayStack, slots: [0, 1] }], relief: { boredom: 0.5 } },
  fix_fence: { id: 'fix_fence', name: 'Zaun reparieren', act: Act.Search, dur: [30, 80], parts: ['morning', 'noon', 'afternoon'], where: [{ kind: SmartKind.FenceSpot, slots: [0] }], relief: { boredom: 0.6 } },
  harvest: { id: 'harvest', name: 'Ernten', act: Act.Search, dur: [40, 120], parts: ['noon', 'afternoon'], where: [{ kind: SmartKind.FieldRow, slots: [0, 1, 2] }], relief: { boredom: 0.5 } },
  porch_sit: { id: 'porch_sit', name: 'Auf der Veranda sitzen', act: Act.Sit, dur: [60, 180], parts: ['evening', 'afternoon'], where: [{ kind: SmartKind.Porch, slots: [0, 1] }], relief: { fatigue: 1, boredom: 0.4 } },
  guitar_play: { id: 'guitar_play', name: 'Gitarre spielen', act: Act.Busk, dur: [60, 160], parts: ['evening', 'night'], where: [{ kind: SmartKind.GuitarChair, slots: [0] }], relief: { boredom: 1 } },
  repair_tool: { id: 'repair_tool', name: 'Werkzeug reparieren', act: Act.Search, dur: [30, 90], parts: ['morning', 'noon', 'afternoon'], where: [{ kind: SmartKind.ToolBench, slots: [0] }], relief: { boredom: 0.6 } },
  campfire_sit: { id: 'campfire_sit', name: 'Am Lagerfeuer sitzen', act: Act.Sit, dur: [60, 200], parts: ['evening', 'night'], where: [{ kind: SmartKind.Campfire, slots: [0, 1, 2] }], relief: { fatigue: 0.8, boredom: 0.9 } },
  telescope_look: { id: 'telescope_look', name: 'Durchs Fernrohr schauen', act: Act.Photo, dur: [15, 40], parts: ['morning', 'noon', 'afternoon', 'evening'], where: [{ kind: SmartKind.Telescope, slots: [0] }], relief: { boredom: 0.8 } },
  egg_buy: { id: 'egg_buy', name: 'Eier kaufen', act: Act.Wait, dur: [12, 30], parts: DAY, where: [{ kind: SmartKind.EggStand, slots: [1, 2] }], relief: { hunger: 0.4 } },
  graze: { id: 'graze', name: 'Grasen', act: Act.Eat, dur: [400, 1200], where: [{ kind: SmartKind.Graze, slots: [0, 1, 2, 3, 4, 5] }], relief: { hunger: 1, boredom: 1, fatigue: 1 } },
  peck: { id: 'peck', name: 'Picken', act: Act.Search, dur: [300, 900], where: [{ kind: SmartKind.Graze, slots: [0, 1, 2, 3, 4, 5] }], relief: { hunger: 1, boredom: 1, fatigue: 1 } },
  guard: { id: 'guard', name: 'Hof bewachen', act: Act.Lie, dur: [300, 900], where: [{ kind: SmartKind.Graze, slots: [4] }, { kind: SmartKind.Porch, slots: [0, 1] }], relief: { fatigue: 1, boredom: 1 } },
  fence_chat: { id: 'fence_chat', name: 'Über den Zaun reden', act: Act.Talk, dur: [30, 90], where: [{ kind: SmartKind.FenceSpot, slots: [0, 1] }], relief: { boredom: 0.9 } },
};

/** Weltposition und Blickrichtung eines Slots an einem Objekt (Objekt dreht sich um `rot`, +z = (sin rot, cos rot)). */
export function slotWorld(ox: number, oz: number, rot: number, s: Slot): { x: number; z: number; a: number } {
  const c = Math.cos(rot), sn = Math.sin(rot);
  return { x: ox + s.x * c + s.z * sn, z: oz - s.x * sn + s.z * c, a: rot + s.a };
}

export function scenarioAllowed(sc: ScenarioDef, part: DayPart): boolean { return !sc.parts || sc.parts.includes(part); }
