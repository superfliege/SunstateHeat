// Roulette „Ruleta Royale“ – Europäisches Roulette (eine Null). Ergebnis bestimmt der Server nach Ende
// der Setzphase; der Client spielt nur die Kugel-Animation ab, die dort landet.

/** Kesselreihenfolge (europäisch), für die Animation. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n: number): 'green' | 'red' | 'black' => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

export type RouletteBetType = 'straight' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | 'dozen' | 'column';
/** n: Zahl (straight), Dutzend 1–3, Kolonne 1–3. */
export interface RouletteBet { type: RouletteBetType; n?: number; amount: number }

export const ROULETTE_PAYS: Record<RouletteBetType, number> = { straight: 35, red: 1, black: 1, even: 1, odd: 1, low: 1, high: 1, dozen: 2, column: 2 };
export const BET_LABEL: Record<RouletteBetType, string> = { straight: 'Zahl', red: 'Rot', black: 'Schwarz', even: 'Gerade', odd: 'Ungerade', low: '1–18', high: '19–36', dozen: 'Dutzend', column: 'Kolonne' };

export function validBet(b: RouletteBet): boolean {
  if (!(b.type in ROULETTE_PAYS)) return false;
  if (b.type === 'straight') return Number.isInteger(b.n) && b.n! >= 0 && b.n! <= 36;
  if (b.type === 'dozen' || b.type === 'column') return Number.isInteger(b.n) && b.n! >= 1 && b.n! <= 3;
  return true;
}

export function betWins(b: RouletteBet, n: number): boolean {
  switch (b.type) {
    case 'straight': return b.n === n;
    case 'red': return RED.has(n);
    case 'black': return n !== 0 && !RED.has(n);
    case 'even': return n !== 0 && n % 2 === 0;
    case 'odd': return n % 2 === 1;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19;
    case 'dozen': return n !== 0 && Math.ceil(n / 12) === b.n;
    case 'column': return n !== 0 && ((n - 1) % 3) + 1 === b.n;
  }
}
/** Auszahlung inkl. Einsatz (0 bei Verlust). */
export const betPayout = (b: RouletteBet, n: number) => (betWins(b, n) ? b.amount * (ROULETTE_PAYS[b.type] + 1) : 0);
export const betKey = (b: { type: RouletteBetType; n?: number }) => `${b.type}${b.n ?? ''}`;
export function betLabel(b: { type: RouletteBetType; n?: number }) {
  if (b.type === 'straight') return `Zahl ${b.n}`;
  if (b.type === 'dozen') return `${b.n}. Dutzend`;
  if (b.type === 'column') return `${b.n}. Kolonne`;
  return BET_LABEL[b.type];
}

export interface RouletteView {
  id: string;
  phase: 'bet' | 'spin' | 'result';
  t: number;
  /** Ergebnis (nur in spin/result), Spin-Zähler für die Animation */
  result: number;
  spin: number;
  /** Letzte Zahlen (neueste zuerst) */
  history: number[];
  /** Einsätze am Tisch: [Spieler-ID (-1 NPC), Name, Schlüssel, Betrag] */
  bets: [number, string, string, number][];
  seats: [number, string][];
  limits: [number, number];
  say?: string;
}
