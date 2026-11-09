// Fahrzeug-Minispiele: gemeinsame Typen, Arena-Daten und Modus-Konfigurationen.
// Alle Zahlenwerte stehen in JSON-Dateien (config/*.json, arenas.json) – nicht im Code.
// Server: server/src/minigames/ (Basisklasse, Bots, Modi). Client: HUD + ArenaView.
import arenaData from './arenas.json';
import botData from './config/bots.json';
import sumoConfig from './config/sumo.json';
import derbyConfig from './config/derby.json';
import hotPotatoConfig from './config/hotpotato.json';

/** ID des Minispiel-Telefons am Spawn; Aufträge dort heißen `mg:<modus>`. */
export const MG_PHONE_ID = 'minigames';
export const MG_PREFIX = 'mg:';

export type MinigameId = 'sumo' | 'derby' | 'hotpotato';

// ------------------------------------------------------------------ Arenen
export type DeathZone =
  | { type: 'below'; margin: number }
  | { type: 'water' }
  | { type: 'outside' };

export interface ArenaDef {
  id: string;
  name: string;
  center: [number, number];
  /** wall: Bande rundherum (Dicke in m, 0/fehlt = offen, Sturz möglich). */
  floor?: { shape: 'disc' | 'grid'; y: number; r?: number; cell?: number; cols?: number; rows?: number; wall?: number };
  bounds: number;
  death: DeathZone[];
  spawns: { type: 'ring'; radius: number } | { type: 'list'; points: [number, number, number][] };
  spectate: [number, number];
  zones?: { id: string; x: number; z: number; r: number }[];
}

export const ARENAS: ArenaDef[] = (arenaData as unknown as { arenas: ArenaDef[] }).arenas;
export const arenaById = (id: string) => ARENAS.find((a) => a.id === id);

// ------------------------------------------------------------------ Bots
export interface BotDifficulty { reaction: number; aimError: number; mistakeRate: number; mistakeTime: number; caution: number }
export type DifficultyId = 'leicht' | 'normal' | 'schwer';
export const BOT_DIFFICULTIES = botData.difficulties as Record<DifficultyId, BotDifficulty>;
export const BOT_NAMES: string[] = botData.names;
export const isDifficulty = (s: string): s is DifficultyId => s in BOT_DIFFICULTIES;

// ------------------------------------------------------------------ Konfiguration
/** Felder, die jede Modus-Konfiguration hat (siehe config/*.json). */
export interface BaseModeConfig {
  arena: string;
  lobbyTime: number;
  joinRange: number;
  gridTime: number;
  endTime: number;
  timeLimit: number;
  players: { min: number; max: number; maxHumans: number };
  /** difficulty: Standardstufe; mix: Bots bekommen gemischte Stufen um diesen Wert. */
  bots: { difficulty: DifficultyId; mix: boolean };
  vehicles: string[];
  onLeave: 'bot' | 'eliminate';
  /** Runde abbrechen, wenn kein echter Spieler mehr dabei ist (außer Debug-Runden nur mit NPCs). */
  abortWithoutHumans: boolean;
  /** Sekunden auf dem Dach, bis man ausscheidet (0 = nie). */
  flipTimeout: number;
  /** Zu Fuß statt im Fahrzeug (Fallout-Variante). */
  onFoot?: boolean;
  rewards: [number, number][];
  participation: [number, number];
}

export interface SumoConfig extends BaseModeConfig {
  shrink: { after: number; duration: number; minRadius: number };
  pushBoost: number;
  damageScale: number;
  timeUp: 'center' | 'tie';
}

export interface DerbyConfig extends BaseModeConfig {
  damage: { scale: number; front: number; rear: number; side: number; wall: number };
  engineDead: number;
  botAI: { fleeBelow: number; opportunisticRange: number };
  tieGap: number;
}

export interface HotPotatoConfig extends BaseModeConfig {
  fuse: { start: number; step: number; min: number };
  passImmunity: number;
  passMinSpeed: number;
  roundPause: number;
  damageScale: number;
}

export interface MinigameMeta { id: MinigameId; name: string; icon: string; intro: string[]; config: BaseModeConfig }

export const MINIGAMES: Record<MinigameId, MinigameMeta> = {
  sumo: {
    id: 'sumo', name: 'Sumo', icon: '🤼',
    intro: [
      'Kleine Plattform über dem Meer, alle gegen alle: Schieb die anderen ins Wasser!',
      'Wer die Plattform verlässt, ist raus. Nach einer Weile schrumpft sie – der Letzte auf der Plattform gewinnt.',
    ],
    config: sumoConfig as unknown as SumoConfig,
  },
  derby: {
    id: 'derby', name: 'Destruction Derby', icon: '💥',
    intro: [
      'Geschlossene Crash-Bowl, alle gegen alle: Fahr die anderen zu Schrott!',
      'Heck und Seite sind empfindlich, die Front hält am meisten aus. Wer kein fahrbares Auto mehr hat, ist raus.',
    ],
    config: derbyConfig as unknown as DerbyConfig,
  },
  hotpotato: {
    id: 'hotpotato', name: 'Hot Potato', icon: '💣',
    intro: [
      'Einer hat die Bombe – ramm jemanden, um sie loszuwerden!',
      'Läuft der Zünder ab, fliegt der Träger in die Luft. Nach dem Weitergeben bist du kurz geschützt. Letzter Überlebender gewinnt.',
    ],
    config: hotPotatoConfig as unknown as HotPotatoConfig,
  },
};
export const isMinigame = (s: string): s is MinigameId => s in MINIGAMES;

// ------------------------------------------------------------------ HUD (Server → Client, in QuestState.mg)
export interface MgResult { name: string; place: number; score: string; me: boolean; bot: boolean }

export interface MgHud {
  mode: MinigameId;
  /** Verbleibende / gestartete Teilnehmer. */
  alive: number;
  total: number;
  /** Eigener Status: spielt, ausgeschieden (mit Platz), wartet auf die nächste Runde. */
  me: 'alive' | 'out' | 'waiting';
  place?: number;
  /** Modusspezifische Zeile (z. B. „Plattform schrumpft in 12 s“) und ob sie warnt. */
  info?: string;
  warn?: boolean;
  /** Modusspezifischer Balken 0..1 (Tempo, Bomben-Timer …). */
  bar?: { label: string; value: number; warn: boolean };
  /** Große Warnung in der Bildmitte (z. B. „ZU LANGSAM! 0,8 s“, „DU HAST DIE BOMBE“). */
  alert?: string;
  /** Eliminierungs-Feed, neueste zuerst. */
  feed: string[];
  /** Ergebnis-Bildschirm (nur in der Endphase). */
  results?: MgResult[];
  headline?: string;
  /** Zuschauerkamera: Arena-Mitte (für Ausgeschiedene, Wartende und Debug-Zuschauer zu Fuß). */
  spectate?: [number, number];
}
