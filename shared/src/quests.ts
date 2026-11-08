// Datengetriebenes Quest-System (Spec 13.2): Quests sind reine Daten, die Engine (server/quests)
// wertet sie aus. Orte werden über Schlüssel angegeben (siehe questLocations.ts).
import type { GangId } from './gangs';

export type LocRef = string;

export interface DialogueLine { who: string; text: string }

/** Aktionen beim Start/Ende einer Stufe. */
export type QuestAction =
  /** Fahrzeug bereitstellen und unter `tag` merken. kind: car | bike | boat | airboat */
  | { do: 'spawnVehicle'; tag: string; kind: 'car' | 'boat' | 'airboat'; variant?: number; at: LocRef; water?: boolean; perPlayer?: boolean }
  /** Gegner (Gang-NPCs) erzeugen, die die Teilnehmer angreifen. */
  | { do: 'spawnEnemies'; tag: string; gang: GangId; count: number; at: LocRef; radius?: number; target?: 'players' | string }
  /** NPC, der geschützt werden muss (bleibt stehen). */
  | { do: 'spawnNpc'; tag: string; at: LocRef; hp: number }
  /** Sammelobjekte im Gebiet erzeugen. */
  | { do: 'spawnPickups'; tag: string; at: LocRef; count: number; radius: number }
  | { do: 'setWanted'; level: number }
  /** Nächstgelegenes Verkehrsfahrzeug als Verfolgungsziel markieren. */
  | { do: 'tagTraffic'; tag: string; near: LocRef }
  | { do: 'say'; text: string };

export type Objective =
  | { type: 'goTo'; at: LocRef; radius?: number; vehicleKind?: 'car' | 'boat' | 'airboat'; vehicleTag?: string; text?: string }
  | { type: 'enterVehicle'; tag: string; text?: string }
  | { type: 'deliverVehicle'; tag: string; at: LocRef; radius?: number; minHealth?: number; text?: string }
  | { type: 'follow'; tag: string; seconds: number; minDist: number; maxDist: number; text?: string }
  | { type: 'defeat'; tag: string; text?: string }
  | { type: 'protect'; tag: string; seconds: number; minHealth?: number; text?: string }
  | { type: 'collect'; tag: string; text?: string }
  | { type: 'survive'; seconds: number; keepWanted?: number; text?: string }
  | { type: 'loseWanted'; text?: string }
  | { type: 'race'; points: LocRef | LocRef[]; count?: number; vehicleTag?: string; text?: string }
  | { type: 'groupAt'; at: LocRef; radius?: number; text?: string }
  | { type: 'interact'; at: LocRef; holdSeconds: number; text?: string };

export interface QuestStage {
  id: string;
  description: string;
  objectives: Objective[];
  timeLimitSeconds?: number;
  onStart?: QuestAction[];
  onComplete?: QuestAction[];
}

export type FailCondition = 'timeout' | 'allDown' | 'targetLost' | 'vehicleDestroyed';

export interface QuestDefinition {
  id: string;
  title: string;
  giver: { type: 'payphone' | 'npc' | 'phone'; id: string };
  gang?: GangId;
  minLevel: number;
  requirements?: { reputation?: Partial<Record<GangId, number>>; questsCompleted?: string[] };
  coop: { min: number; max: number };
  repeatable: boolean;
  cooldownMinutes?: number;
  /** Nur nachts verfügbar. */
  nightOnly?: boolean;
  intro: DialogueLine[];
  stages: QuestStage[];
  rewards: {
    money: number;
    xp: number;
    reputation?: { gang: GangId; gain: number; rivalLoss: number };
    /** Preisgeld nach Platzierung (Rennen), ersetzt money. */
    byPlace?: number[];
  };
}

/** Prüft Quest-Daten (Spec 24.1: alle Definitionen gegen das Schema, Referenzen müssen existieren). */
export function validateQuests(defs: QuestDefinition[], locations: Set<string>, phoneIds: Set<string>): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  const loc = (q: string, ref: unknown) => {
    if (typeof ref === 'string' && !locations.has(ref)) errs.push(`${q}: unbekannter Ort "${ref}"`);
  };
  for (const q of defs) {
    if (ids.has(q.id)) errs.push(`${q.id}: doppelte ID`);
    ids.add(q.id);
    if (q.coop.min < 1 || q.coop.max < q.coop.min) errs.push(`${q.id}: ungültige Koop-Grenzen`);
    if (q.giver.type === 'payphone' && !phoneIds.has(q.giver.id)) errs.push(`${q.id}: unbekanntes Telefon "${q.giver.id}"`);
    if (!q.stages.length) errs.push(`${q.id}: keine Stufen`);
    for (const r of q.requirements?.questsCompleted ?? []) if (!defs.some((d) => d.id === r)) errs.push(`${q.id}: Voraussetzung "${r}" existiert nicht`);
    for (const st of q.stages) {
      if (!st.objectives.length) errs.push(`${q.id}/${st.id}: keine Ziele`);
      for (const a of [...(st.onStart ?? []), ...(st.onComplete ?? [])]) if ('at' in a) loc(q.id, a.at);
      for (const o of st.objectives) {
        if ('at' in o) loc(q.id, o.at);
        if (o.type === 'race') for (const p of Array.isArray(o.points) ? o.points : [o.points]) loc(q.id, p);
      }
    }
  }
  return errs;
}
