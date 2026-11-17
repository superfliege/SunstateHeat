// 21 (Blackjack) – Regeln und Hilfsfunktionen (Server spielt, Client zeigt an).
// Standardregeln: 6 Decks im Schlitten, Dealer zieht bis 16 und steht ab 17 (auch Soft 17), Blackjack
// zahlt 3:2, Karte / Stehen / Verdoppeln / Teilen (einmal) / Versicherung bei Ass des Dealers,
// gemischt wird nach ~75 % des Schlittens. Karten: 0–51, Rang = c % 13 (0 = Ass, 1–9 = 2–10, 10–12 = Bube/Dame/König),
// Farbe = floor(c / 13) (eigene Comic-Symbole: Sonne, Welle, Palme, Muschel – kein Nachbau realer Kartendesigns).

export const SUITS = ['☀', '🌊', '🌴', '🐚'] as const;
export const SUIT_NAMES = ['Sonnen', 'Wellen', 'Palmen', 'Muscheln'] as const;
export const RANK_LABEL = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'] as const;

export const rankOf = (c: number) => c % 13;
export const suitOf = (c: number) => Math.floor(c / 13) % 4;
/** Punktwert einer Karte (Ass = 1, Bilder = 10). */
export const cardPoints = (c: number) => Math.min(10, rankOf(c) + 1);

export function handValue(cards: readonly number[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) { total += cardPoints(c); if (rankOf(c) === 0) aces++; }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}
export const isBlackjack = (cards: readonly number[]) => cards.length === 2 && handValue(cards).total === 21;
export const isBust = (cards: readonly number[]) => handValue(cards).total > 21;
/** Dealer zieht bis 16, steht ab 17 – auch bei Soft 17. */
export const dealerMustHit = (cards: readonly number[]) => handValue(cards).total < 17;

/** Neuer Schlitten: decks x 52 Karten, gemischt mit rnd (Fisher-Yates; rnd(n) = 0 … n-1). */
export function newShoe(decks: number, rnd: (n: number) => number): number[] {
  const shoe: number[] = [];
  for (let d = 0; d < decks; d++) for (let c = 0; c < 52; c++) shoe.push(c);
  for (let i = shoe.length - 1; i > 0; i--) { const j = rnd(i + 1); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  return shoe;
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split';
export const BJ_ACTION_LABEL: Record<BjAction, string> = { hit: 'Karte', stand: 'Stehen', double: 'Verdoppeln', split: 'Teilen' };

/**
 * Grundstrategie (vereinfacht, für 6 Decks, Dealer steht auf Soft 17) – Tipp-Anzeige für Anfänger.
 * up = Dealer-Karte (Punktwert 1–10, Ass = 1).
 */
export function basicStrategy(cards: readonly number[], up: number, canDouble: boolean, canSplit: boolean): BjAction {
  const d = up === 1 ? 11 : up;
  const { total, soft } = handValue(cards);
  if (canSplit && cards.length === 2 && cardPoints(cards[0]) === cardPoints(cards[1])) {
    const p = cardPoints(cards[0]);
    if (p === 1 || p === 8) return 'split';
    if ((p === 2 || p === 3 || p === 7) && d <= 7) return 'split';
    if (p === 6 && d <= 6) return 'split';
    if (p === 9 && d !== 7 && d < 10) return 'split';
    if (p === 4 && (d === 5 || d === 6)) return 'split';
  }
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return d <= 6 ? (canDouble && d >= 3 ? 'double' : 'stand') : d <= 8 ? 'stand' : 'hit';
    if (canDouble && ((total >= 15 && d >= 4 && d <= 6) || (total >= 13 && d >= 5 && d <= 6))) return 'double';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return canDouble ? 'double' : 'hit';
  if (total === 10) return canDouble && d <= 9 ? 'double' : 'hit';
  if (total === 9) return canDouble && d >= 3 && d <= 6 ? 'double' : 'hit';
  return 'hit';
}

/** Ausgang einer Spielerhand gegen den Dealer → Auszahlung (inkl. Einsatz) für den Einsatz bet. */
export function settleHand(player: readonly number[], dealer: readonly number[], bet: number, fromSplit: boolean): { pay: number; result: 'blackjack' | 'win' | 'push' | 'lose' | 'bust' } {
  const pv = handValue(player).total, dv = handValue(dealer).total;
  if (pv > 21) return { pay: 0, result: 'bust' };
  const pBJ = !fromSplit && isBlackjack(player), dBJ = isBlackjack(dealer);
  if (pBJ && !dBJ) return { pay: Math.floor(bet * 2.5), result: 'blackjack' };
  if (dBJ && !pBJ) return { pay: 0, result: 'lose' };
  if (pBJ && dBJ) return { pay: bet, result: 'push' };
  if (dv > 21 || pv > dv) return { pay: bet * 2, result: 'win' };
  if (pv === dv) return { pay: bet, result: 'push' };
  return { pay: 0, result: 'lose' };
}

// ------------------------------------------------------------------ Netz-Ansicht eines Tisches
export interface BjHandView { cards: number[]; bet: number; done: boolean; result?: string; doubled?: boolean }
export interface BjSeatView {
  seat: number;
  /** Spieler-ID (> 0), NPC (-1), frei (0) */
  pid: number;
  name: string;
  hands: BjHandView[];
  /** Aktive Hand (Index) während des eigenen Zugs */
  active: number;
  insurance: number;
  /** Platzhalter-Einsatz in der Setzphase */
  bet: number;
}
export interface BjTableView {
  id: string;
  phase: 'idle' | 'bet' | 'insurance' | 'play' | 'dealer' | 'settle';
  /** Restzeit der Phase / des Zugs (s) */
  t: number;
  /** Sitz am Zug (-1 = keiner) */
  turn: number;
  dealer: number[];
  /** Dealer-Lochkarte verdeckt? */
  hole: boolean;
  seats: BjSeatView[];
  limits: [number, number];
  /** Schlitten-Füllstand 0–1 */
  shoe: number;
  /** Letzter Spruch des Croupiers */
  say?: string;
}
