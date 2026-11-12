// Hauptgeschichte „Zwölf Dollar“ / „Ganz oben“: Ränge, Figuren, Wohnorte, Dialoge und Missions-Metadaten.
// Alle Texte und Freischaltungen stehen in den JSON-Dateien dieses Ordners; hier nur Typen und Regeln,
// die Client (Anzeige) und Server (Prüfung) gemeinsam verwenden.
import type { GangId } from '../gangs';
import type { DialogueLine, QuestDefinition } from '../quests';
import MISSIONS_JSON from './missions.json';
import RANKS_JSON from './ranks.json';
import STORY_JSON from './story.json';

export interface Look { style: string; shirt?: string }
export interface RankVehicle { kind: 'car' | 'bike'; model?: string; name: string }
export interface RankDef { id: string; name: string; icon: string; desc: string; home: string | null; vehicle: RankVehicle | null; look: Look; perks: string[] }
export interface CharacterDef { name: string; short: string; title: string; color: string; look: Look }
export interface HomeDef { name: string; at: string; desc: string; locked?: string }
/** Bedingung (alle Felder optional, alle müssen passen). Ränge als Rang-ID. */
export interface StoryCond { intro?: boolean; minRank?: string; maxRank?: string; done?: string[]; notDone?: string[] }
export interface StoryNpcDef { id: string; character: string; at: string; when: StoryCond; talk: DialogueLine[] }
export interface ChoiceOption { id: string; label: string; style: number; money?: number; wanted?: number; rep?: Partial<Record<GangId, number>>; reply: DialogueLine[] }
export interface ChoiceDef { who: string; prompt: DialogueLine[]; options: ChoiceOption[] }
export interface StoryEffects {
  rank?: string; unlockHomes?: string[]; lockHomes?: string[]; home?: string; income?: boolean;
  rep?: Partial<Record<GangId, number>>; crew?: string; scene?: string;
}
export interface StoryMission {
  id: string; act: 1 | 2; giver: string; kind: 'main' | 'side'; order: number; when: StoryCond; hint: string;
  /** Ohne Quest-Definition: wird durch ein Ereignis erledigt (Rennsieg, komplette Crew). */
  virtual?: boolean; title?: string;
  briefing?: DialogueLine[]; outro?: DialogueLine[];
  /** Darstellung des Abschlussdialogs (Standard: Gespräch). */
  outroKind?: 'talk' | 'radio' | 'call';
  /** Anruf, sobald die Mission freigeschaltet wird. */
  call?: DialogueLine[];
  effects?: StoryEffects;
}
export interface StoryScene { day: number; lines: DialogueLine[] }
export interface StoryData {
  characters: Record<string, CharacterDef>;
  intro: { title: string; startCash: number; day: number; car: { model: string; color: number; name: string }; lines: DialogueLine[]; startMission: string };
  homes: Record<string, HomeDef>;
  npcs: StoryNpcDef[];
  choices: Record<string, ChoiceDef>;
  style: { hard: string; smooth: string; mixed: string };
  income: { intervalMinutes: number; amount: number; bossFactor: number; text: string };
  scenes: Record<string, StoryScene>;
  texts: Record<string, string>;
  missions: StoryMission[];
}

export const RANKS = RANKS_JSON as RankDef[];
export const STORY = STORY_JSON as unknown as StoryData;
/** Neue Story-Missionen (Quest-Definitionen; Texte kommen aus STORY.missions). */
export const STORY_QUESTS = MISSIONS_JSON as unknown as QuestDefinition[];
export const MISSION_META = new Map(STORY.missions.map((m) => [m.id, m]));
/** Crew-Mitglieder, die für „Eine Crew“ gebraucht werden. */
export const CREW_IDS = ['racer', 'pilot', 'lou'];
export const CREW_MISSION = 'story_10_crew';
export const RACER_MISSION = 'story_10a_rennfahrerin';
export const RACER_RACE = 'race_cane';

/** Gespeicherter Story-Fortschritt eines Charakters (Teil des Spielerprofils). Erledigte Missionen: profile.questsDone. */
export interface StoryProgress {
  /** Intro gesehen. */
  intro: boolean;
  /** Index in RANKS. */
  rank: number;
  /** Entscheidungen (Mission 3): Choice-ID → Option-ID. */
  choices: Record<string, string>;
  /** Spielstil aus den Entscheidungen (< 0 einschüchternd, > 0 verhandelnd). */
  style: number;
  /** Freigeschaltete und gesperrte Wohnorte, aktuelles Zuhause (Spawnpunkt). */
  homes: string[];
  locked: string[];
  home: string | null;
  /** Rekrutierte Crew (Akt 2). */
  crew: string[];
  /** Freigeschaltete (startbare) Story-Missionen – wird bei jeder Änderung neu berechnet. */
  unlocked: string[];
  /** Anrufe, die schon kamen (Mission-IDs). */
  calls: string[];
  /** Dauerhaftes Einkommen aktiv. */
  income: boolean;
}
/** Was der Client bekommt: Fortschritt + erledigte Missionen. */
export interface StoryView extends StoryProgress { done: string[] }

export function freshStory(): StoryProgress {
  return { intro: false, rank: 0, choices: {}, style: 0, homes: [], locked: [], home: null, crew: [], unlocked: [], calls: [], income: false };
}
/** Alte/teilweise Spielstände auffüllen. */
export function normalizeStory(s: Partial<StoryProgress> | undefined): StoryProgress {
  const f = freshStory();
  if (!s || typeof s !== 'object') return f;
  return {
    intro: !!s.intro, rank: Math.max(0, Math.min(RANKS.length - 1, Math.floor(Number(s.rank) || 0))),
    choices: s.choices && typeof s.choices === 'object' ? { ...s.choices } : {}, style: Number(s.style) || 0,
    homes: Array.isArray(s.homes) ? [...s.homes] : [], locked: Array.isArray(s.locked) ? [...s.locked] : [],
    home: typeof s.home === 'string' ? s.home : null, crew: Array.isArray(s.crew) ? [...s.crew] : [],
    unlocked: Array.isArray(s.unlocked) ? [...s.unlocked] : [], calls: Array.isArray(s.calls) ? [...s.calls] : [], income: !!s.income,
  };
}

export const rankIndex = (id: string) => RANKS.findIndex((r) => r.id === id);
export const rankOf = (i: number) => RANKS[Math.max(0, Math.min(RANKS.length - 1, i))];

export function meets(c: StoryCond | undefined, s: StoryProgress, done: readonly string[]): boolean {
  if (!c) return true;
  if (c.intro !== undefined && c.intro !== s.intro) return false;
  if (c.minRank && s.rank < rankIndex(c.minRank)) return false;
  if (c.maxRank && s.rank > rankIndex(c.maxRank)) return false;
  if (c.done && !c.done.every((d) => done.includes(d))) return false;
  if (c.notDone && c.notDone.some((d) => done.includes(d))) return false;
  return true;
}

export function missionTitle(id: string): string {
  return MISSION_META.get(id)?.title ?? STORY_QUESTS.find((q) => q.id === id)?.title ?? id;
}

/** Grund, warum eine Mission (noch) gesperrt ist; '' = Story erlaubt sie (oder sie gehört nicht zur Story). */
export function storyGate(questId: string, s: StoryProgress, done: readonly string[]): string {
  const m = MISSION_META.get(questId);
  if (!m) return '';
  const c = m.when;
  if (c.intro && !s.intro) return 'Erst nach der Ankunft in der Stadt.';
  const missing = c.done?.find((d) => !done.includes(d));
  if (missing) return `Erst „${missionTitle(missing)}“ abschließen.`;
  if (c.minRank && s.rank < rankIndex(c.minRank)) return `Ab Rang „${rankOf(rankIndex(c.minRank)).name}“.`;
  if (c.maxRank && s.rank > rankIndex(c.maxRank)) return 'Nicht mehr verfügbar – du hast hier Hausverbot.';
  if (!meets(c, s, done)) return 'Gerade nicht verfügbar.';
  return '';
}

/** Startbare Story-Missionen (nicht virtuell, Bedingung erfüllt, Hauptmissionen noch offen). */
export function unlockedMissions(s: StoryProgress, done: readonly string[]): string[] {
  return STORY.missions.filter((m) => meets(m.when, s, done) && !(m.kind === 'main' && done.includes(m.id))).map((m) => m.id);
}

/** Nächste offene Hauptmission (für die HUD-Anzeige „Nächstes Ziel“). */
export function nextMain(s: StoryProgress, done: readonly string[]): StoryMission | null {
  const open = STORY.missions.filter((m) => m.kind === 'main' && !done.includes(m.id) && meets(m.when, s, done)).sort((a, b) => a.order - b.order);
  return open[0] ?? null;
}

/** Spielstil-Zeilen filtern (if: 'hard' | 'smooth'). */
export function filterLines(lines: DialogueLine[] | undefined, s: StoryProgress): DialogueLine[] {
  const st = s.style < 0 ? 'hard' : s.style > 0 ? 'smooth' : 'mixed';
  return (lines ?? []).filter((l) => !l.if || l.if === st);
}
export function styleName(style: number): string {
  return style < 0 ? STORY.style.hard : style > 0 ? STORY.style.smooth : STORY.style.mixed;
}

export function visibleNpcs(s: StoryProgress, done: readonly string[]): StoryNpcDef[] {
  return STORY.npcs.filter((n) => meets(n.when, s, done));
}

/** Missionen, die eine Figur persönlich vergibt (Hauptmissionen per NPC + ihre Nebenjobs). */
export function missionsBy(character: string): StoryMission[] {
  return STORY.missions.filter((m) => m.giver === character && !m.virtual).sort((a, b) => a.order - b.order);
}

export const homeUsable = (id: string, s: StoryProgress) => s.homes.includes(id) && !s.locked.includes(id) && !!STORY.homes[id];
export const charOf = (who: string): CharacterDef | undefined => STORY.characters[who];
export const fill = (t: string, vars: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

/** Story-Texte über bestehende Quest-Definitionen legen (Briefing des Auftraggebers ersetzt das Intro). */
export function withStoryText(defs: QuestDefinition[]): QuestDefinition[] {
  return defs.map((q) => {
    const m = MISSION_META.get(q.id);
    if (!m?.briefing?.length) return q;
    return { ...q, intro: m.briefing };
  });
}

/** Inhaltsprüfung (npm test): Referenzen auf Orte, Missionen, Ränge, Figuren und Wohnorte. */
export function validateStory(locations: Set<string>, questIds: Set<string>): string[] {
  const errs: string[] = [];
  const ids = new Set(STORY.missions.map((m) => m.id));
  const rank = (where: string, r?: string) => { if (r && rankIndex(r) < 0) errs.push(`${where}: unbekannter Rang "${r}"`); };
  const cond = (where: string, c: StoryCond) => {
    rank(where, c.minRank); rank(where, c.maxRank);
    for (const d of [...(c.done ?? []), ...(c.notDone ?? [])]) if (!ids.has(d)) errs.push(`${where}: unbekannte Mission "${d}"`);
  };
  const lines = (where: string, ls?: DialogueLine[]) => { for (const l of ls ?? []) if (!l.text?.trim()) errs.push(`${where}: leere Dialogzeile`); };
  for (const m of STORY.missions) {
    if (!m.virtual && !questIds.has(m.id)) errs.push(`Mission ${m.id}: keine Quest-Definition`);
    if (m.virtual && !m.title) errs.push(`Mission ${m.id}: virtuelle Mission ohne Titel`);
    if (!STORY.characters[m.giver]) errs.push(`Mission ${m.id}: unbekannter Auftraggeber "${m.giver}"`);
    cond(`Mission ${m.id}`, m.when);
    lines(m.id, m.briefing); lines(m.id, m.outro); lines(m.id, m.call);
    const e = m.effects;
    rank(`Mission ${m.id}`, e?.rank);
    for (const h of [...(e?.unlockHomes ?? []), ...(e?.lockHomes ?? []), ...(e?.home ? [e.home] : [])]) if (!STORY.homes[h]) errs.push(`Mission ${m.id}: unbekannter Wohnort "${h}"`);
    if (e?.scene && !STORY.scenes[e.scene]) errs.push(`Mission ${m.id}: unbekannte Szene "${e.scene}"`);
    if (e?.crew && !CREW_IDS.includes(e.crew)) errs.push(`Mission ${m.id}: unbekanntes Crew-Mitglied "${e.crew}"`);
  }
  for (const q of STORY_QUESTS) {
    if (!MISSION_META.has(q.id)) errs.push(`Quest ${q.id}: keine Story-Metadaten`);
    for (const st of q.stages) for (const o of st.objectives) if (o.type === 'choice' && !STORY.choices[o.id]) errs.push(`Quest ${q.id}: unbekannte Entscheidung "${o.id}"`);
  }
  for (const n of STORY.npcs) {
    if (!STORY.characters[n.character]) errs.push(`NPC ${n.id}: unbekannte Figur`);
    if (!locations.has(n.at)) errs.push(`NPC ${n.id}: unbekannter Ort "${n.at}"`);
    cond(`NPC ${n.id}`, n.when);
  }
  for (const [id, h] of Object.entries(STORY.homes)) if (!locations.has(h.at)) errs.push(`Wohnort ${id}: unbekannter Ort "${h.at}"`);
  for (const r of RANKS) if (r.home && !STORY.homes[r.home]) errs.push(`Rang ${r.id}: unbekannter Wohnort "${r.home}"`);
  if (!questIds.has(STORY.intro.startMission)) errs.push('Intro: Startmission fehlt');
  return errs;
}
