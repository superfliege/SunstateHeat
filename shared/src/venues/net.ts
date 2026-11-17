// Netz-Nachrichten der Innenräume (Club „Pink Static“, Casino „Palm Royale“) und ihrer Minispiele.
// Grundsatz: Alle Zufallsergebnisse (Walzen, Karten, Kugel, Rennen) bestimmt der Server mit sicherem Zufall –
// erst NACH dem Einsatz. Der Client zeigt nur an; Tanz-Treffer bewertet der Client lokal, der Server
// rechnet die Punkte daraus nach und plausibilisiert Zeitpunkte und Anzahl.
import type { BjTableView } from '../content/casino/blackjack';
import type { DerbyView } from '../content/casino/derby';
import type { RouletteBetType, RouletteView } from '../content/casino/roulette';
import type { SlotSymbol, SlotVariant } from '../content/casino/slots';
import type { Difficulty } from '../content/dance/beatmap';
import type { BubbleStyle } from '../content/events/schema';
import type { InteriorId } from './interiors';

export type DanceMode = 'solo' | 'battle' | 'crew';
export const DANCE_MODE_LABEL: Record<DanceMode, string> = { solo: 'Solo', battle: 'Dance-Battle', crew: 'Crew (Koop)' };

/** Client → Server: eine Aktion im/am Innenraum. */
export type VenueAction =
  | { a: 'enter'; which: InteriorId }
  | { a: 'exit'; back?: boolean }
  | { a: 'use'; spot: string }
  /** Antwort auf einen Dialog (vdlg) */
  | { a: 'opt'; dlg: string; id: string }
  | { a: 'chips'; amount: number }
  | { a: 'slot'; m: number; bet: number }
  | { a: 'leave' }
  | { a: 'bj'; table: string; op: 'bet' | 'hit' | 'stand' | 'double' | 'split' | 'insure' | 'noinsure'; amount?: number }
  | { a: 'ru'; table: string; op: 'bet' | 'clear'; type?: RouletteBetType; n?: number; amount?: number }
  | { a: 'derby'; gator: number; amount: number }
  | { a: 'dance'; op: 'setup'; song: string; diff: Difficulty; mode: DanceMode }
  | { a: 'dance'; op: 'join' | 'go' | 'quit' }
  /** Treffer: [Noten-Index, Bewertung 0–3, gehaltene Beats] – fortlaufend, in Paketen. */
  | { a: 'dance'; op: 'hits'; h: [number, number, number][] }
  /** DJ-Pult (E57): Anzahl Treffer/Fehler eines Pakets. */
  | { a: 'dj'; ok: number; miss: number; done?: boolean }
  | { a: 'valet'; op: 'drop' | 'get' }
  | { a: 'casinoOff'; on: boolean }
  | { a: 'stats' };

/** NPC im Innenraum: [id, x·10, z·10 (lokal), Winkel·100 (lokal), Act, Art, Aussehen-Seed, Stil (Tanzstil/Kleidung)] */
export type VNpcTuple = [number, number, number, number, number, number, number, number];
/** NPC-Arten (Darstellung/Verhalten). */
export const VNpcKind = { GUEST: 0, DANCER: 1, STAFF: 2, BOUNCER: 3, BARKEEP: 4, DJ: 5, CROUPIER: 6, GUARD: 7, GANG: 8, VIP: 9, COP: 10, PIANIST: 11, GAMBLER: 12, WAITER: 13 } as const;

export interface VenueDialog { id: string; who: string; lines: string[]; options: { id: string; label: string }[] }

/** Laufende Tanz-Session (an alle im Club, für Zuschauer und Teilnehmer). */
export interface DanceSessionView {
  id: number;
  song: string; diff: Difficulty; mode: DanceMode;
  /** Phase: Warteraum (andere können beitreten), Countdown, läuft, Ergebnis */
  phase: 'lobby' | 'count' | 'play' | 'result';
  /** Server-Zeit (ms), zu der Beat 0 … d. h. Songzeit 0 begann (in play) */
  t0: number;
  /** Restzeit Lobby/Countdown (s) */
  t: number;
  /** Teilnehmer: Spieler-ID, Name, Kachel, Punkte, Combo, Hype, Spotlight bis (Songzeit), Rang (Ergebnis) */
  dancers: { pid: number; name: string; tile: number; score: number; combo: number; hype: number; spot: number; rank?: string }[];
  /** Crew-Modus: gemeinsame Combo */
  crew?: number;
  /** Sieger (Battle) */
  winner?: number;
  /** Ereignis-Battle (E58): Seite */
  side?: string;
}

export type VenueGame =
  | { g: 'slot'; m: number; v: SlotVariant; reels: SlotSymbol[]; win: number; jackpot: boolean; line: string; bet: number; spin: number; chips: number }
  | { g: 'bj'; view: BjTableView; me: number }
  | { g: 'ru'; view: RouletteView }
  | { g: 'derby'; view: DerbyView }
  | { g: 'dance'; s: DanceSessionView | null }
  | { g: 'dj'; on: boolean; song: string; t0: number }
  | { g: 'close' };

export interface CasinoStats { won: number; lost: number; net: number; spins: number; hands: number; spinsRu: number; races: number; jackpots: number; hourNet: number; hourLimitLoss: number; hourLimitWin: number; chips: number; off: boolean }

/** Server → Client */
export type VenueServerMsg =
  /** Innenraum betreten/verlassen (Blende + Tür-Sound), Gate-Maske, Chips */
  | { t: 'venue'; in: InteriorId | null; mask: number; chips: number; door: 'front' | 'back' | 'kick' | 'evac' | 'none'; music: string | null; lockdown: boolean }
  /** NPC-Delta des eigenen Innenraums (4 Hz) */
  | { t: 'vnpc'; n?: VNpcTuple[]; g?: number[] }
  /** Sprechblase: who > 0 NPC-ID, who < 0 Spieler (-id) */
  | { t: 'vsay'; who: number; text: string; style: BubbleStyle; /** who = 0: Sprechblase an Weltposition (Requisite, Straße) */ at?: [number, number, number] }
  | { t: 'vgame'; s: VenueGame }
  /** Effekte: jackpot, spotlight (pid), alarm, lights (an/aus), fog, confetti, music (Song), crowd (Kreis um pid), trophy (pid), move (pid, Note-Bewertung) */
  | { t: 'vfx'; k: 'jackpot' | 'spotlight' | 'alarm' | 'lights' | 'fog' | 'confetti' | 'music' | 'crowd' | 'trophy' | 'move' | 'jackpotBoard'; pid?: number; on?: boolean; v?: number; s?: string }
  | { t: 'vdlg'; d: VenueDialog }
  | { t: 'vstats'; s: CasinoStats; board?: { song: string; diff: string; inst: [string, number][]; global: [string, number][] }[] };
