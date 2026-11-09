// Mini-Lebenszyklus (Schritt 3): Jeder NPC bekommt beim Spawn eine kurze Absichtskette aus 2–4
// Schritten, gewählt aus Archetyp und Tageszeit (z. B. Geschäftsmann mittags: Geldautomat → Imbiss →
// essen auf der Bank → zur Bürotür und verschwinden). Schritte vom Typ 'need' wählt ein kleines
// Bedürfnis-System (Hunger, Langeweile, Müdigkeit, Ziel-Erreichen) per Utility-Bewertung.
// Alles datengetrieben – der Server führt die Ketten aus (server/src/sim/NpcBrain.ts).
import type { ArchetypeId } from './archetypes';
import type { DayPart } from './population';
import type { ScenarioDef, ScenarioId } from './scenarios';

export type NeedId = 'hunger' | 'boredom' | 'fatigue' | 'goal';
export const NEED_IDS: readonly NeedId[] = ['hunger', 'boredom', 'fatigue', 'goal'];
export const NEED_NAMES: Record<NeedId, string> = { hunger: 'Hunger', boredom: 'Langeweile', fatigue: 'Müdigkeit', goal: 'Ziel' };
export type Needs = Record<NeedId, number>;

/** Anstieg pro Sekunde (beim Laufen). „goal“ steigt pro erledigtem Schritt (GOAL_PER_STEP). */
export const NEED_RATE: Record<NeedId, number> = { hunger: 0.0035, boredom: 0.008, fatigue: 0.003, goal: 0.002 };
export const GOAL_PER_STEP = 0.28;

/**
 * Schritt einer Absichtskette:
 *  - ScenarioId: genau dieses Szenario (Smart Object in Reichweite oder frei); sonst Ersatz per Utility
 *  - 'need': Utility-Wahl nach Bedürfnissen
 *  - 'stroll': ein Stück den Gehweg entlang schlendern
 *  - 'meet': Bekannte treffen (zwei Laufende bleiben stehen und reden)
 *  - Ausgang: 'exit_door' (Tür), 'exit_bus' (Haltestelle, wartet auf den Bus), 'exit_car' (ins geparkte Auto, fährt weg),
 *    'exit' = passender Ausgang nach Archetyp
 */
export type ExitStep = 'exit' | 'exit_door' | 'exit_bus' | 'exit_car';
export type IntentStep = ScenarioId | 'need' | 'stroll' | 'meet' | ExitStep;
export const STEP_NAMES: Record<string, string> = {
  need: 'Bedürfnis', stroll: 'Schlendern', meet: 'Bekannte treffen', exit: 'Gehen',
  exit_door: 'Durch die Tür', exit_bus: 'Zum Bus', exit_car: 'Ins Auto',
};
export function isExit(s: IntentStep): s is ExitStep { return s === 'exit' || s.startsWith('exit_'); }

type Chains = IntentStep[][];
/** Ketten je Archetyp und Tageszeit ('*' = alle übrigen). Der Server wählt eine zufällig. */
export const INTENT_CHAINS: Partial<Record<ArchetypeId, Partial<Record<DayPart | '*', Chains>>>> = {
  businessman: {
    morning: [['atm_use', 'cafe_sit', 'exit_door'], ['news_read', 'phone', 'exit_door'], ['cafe_sit', 'exit_car']],
    noon: [['atm_use', 'taco_eat', 'bench_sit', 'exit_door'], ['taco_eat', 'phone', 'exit_door'], ['cafe_sit', 'smoke', 'exit_car']],
    '*': [['phone', 'atm_use', 'exit_car'], ['need', 'exit_door'], ['smoke', 'need', 'exit_bus']],
  },
  tourist: {
    morning: [['cafe_sit', 'photo', 'stroll', 'need'], ['photo', 'atm_use', 'exit_bus']],
    noon: [['photo', 'taco_eat', 'bench_sit', 'exit_bus'], ['atm_use', 'photo', 'need', 'exit_door']],
    evening: [['photo', 'taco_eat', 'busk_watch', 'exit_door'], ['photo', 'stroll', 'need']],
    night: [['atm_use', 'club_queue'], ['photo', 'stroll', 'exit_door']],
    '*': [['photo', 'need', 'stroll', 'exit'], ['stroll', 'photo', 'need']],
  },
  beachgoer: {
    '*': [['lounger_lie', 'taco_eat', 'exit_car'], ['hoop_play', 'need', 'exit_bus'], ['taco_eat', 'lounger_lie', 'stroll'], ['photo', 'lounger_lie', 'exit']],
  },
  partygoer: {
    evening: [['atm_use', 'taco_eat', 'club_queue'], ['smoke', 'dance', 'need'], ['meet', 'club_queue']],
    night: [['club_queue', 'dance', 'exit'], ['meet', 'dance', 'smoke', 'exit_car'], ['atm_use', 'club_queue'], ['taco_eat', 'smoke', 'dance']],
    '*': [['need', 'meet', 'exit']],
  },
  worker: {
    morning: [['taco_eat', 'smoke', 'exit_door'], ['news_read', 'exit_bus']],
    noon: [['taco_eat', 'bench_sit', 'smoke', 'exit_door']],
    '*': [['smoke', 'lean_wall', 'exit_bus'], ['need', 'exit_door']],
  },
  retiree: {
    morning: [['news_read', 'bench_sit', 'exit_door'], ['cafe_sit', 'news_read', 'stroll']],
    '*': [['bench_sit', 'busk_watch', 'exit_bus'], ['cafe_sit', 'meet', 'exit_door'], ['stroll', 'bench_sit', 'need']],
  },
  local: {
    '*': [['atm_use', 'need', 'exit_door'], ['news_read', 'meet', 'exit_door'], ['phone', 'need', 'exit_car'], ['stroll', 'need', 'exit_bus']],
  },
  dogwalker: { '*': [['stroll', 'meet', 'stroll', 'exit_door'], ['stroll', 'bench_sit', 'exit_door'], ['stroll', 'phone', 'stroll']] },
  jogger: { '*': [['stroll', 'stroll', 'exit_door'], ['stroll', 'stroll', 'stroll']] },
  homeless: { '*': [['trash_search', 'bench_sit', 'trash_search'], ['trash_search', 'lean_wall', 'need'], ['bench_sit', 'trash_search', 'stroll']] },
  vendor: { '*': [['smoke', 'phone', 'exit_door'], ['lean_wall', 'need', 'exit_car']] },
  fisher: { '*': [['fish_spot', 'exit_car'], ['bench_sit', 'fish_spot']] },
  farmer: { '*': [['bench_sit', 'smoke', 'exit_car']] },
  gang: { '*': [['lean_wall', 'smoke', 'meet']] },
};

/** Bevorzugter Ausgang je Archetyp ('exit' wird hierüber aufgelöst). */
export const EXIT_PREF: Partial<Record<ArchetypeId, ExitStep[]>> = {
  businessman: ['exit_car', 'exit_door'], tourist: ['exit_bus', 'exit_door'], beachgoer: ['exit_car', 'exit_bus'],
  partygoer: ['exit_car', 'exit_door'], worker: ['exit_bus', 'exit_door'], retiree: ['exit_bus', 'exit_door'],
  homeless: ['exit_door'], jogger: ['exit_door'], fisher: ['exit_car'], farmer: ['exit_car'],
};

/** Start-Bedürfnisse je Archetyp (Zufall kommt dazu). */
export const NEED_START: Partial<Record<ArchetypeId, Partial<Needs>>> = {
  businessman: { hunger: 0.4, boredom: 0.1, fatigue: 0.3 }, tourist: { boredom: 0.5, fatigue: 0.3 },
  homeless: { hunger: 0.7, fatigue: 0.5 }, retiree: { fatigue: 0.6 }, partygoer: { boredom: 0.7 }, jogger: { fatigue: 0.1 },
};

/** Utility einer Szenario-Wahl: Σ Bedürfnis × Wirkung, plus kleiner Grundwert, minus Weg. */
export function utility(needs: Needs, sc: ScenarioDef, dist: number): number {
  const r = sc.relief ?? {};
  let u = 0.08;
  for (const k of ['hunger', 'boredom', 'fatigue'] as const) u += needs[k] * (r[k] ?? 0);
  return u - dist / 220;
}

/** Kette wählen (r1 für die Kette). */
export function pickChain(arch: ArchetypeId, part: DayPart, r: number): IntentStep[] {
  const t = INTENT_CHAINS[arch];
  const list = t?.[part] ?? t?.['*'] ?? [['need', 'stroll', 'exit']];
  return [...list[Math.floor(r * list.length) % list.length]];
}
