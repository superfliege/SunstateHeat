// Einarmiger Bandit „Lucky Flamingo Slots“: 3 Walzen, gewichtete Walzenstreifen, Gewinntabelle als Daten.
// Nur Spielgeld ($). Das Ergebnis bestimmt ausschließlich der Server (sicherer Zufall, erst nach dem Einsatz).
// Zwei Varianten mit ähnlicher Auszahlungsquote (RTP), aber unterschiedlicher Volatilität:
//   classic  – viele kleine Gewinne (Orangen zahlen schon einzeln)
//   goldrush – selten, dafür groß (keine Kleinstgewinne, hohe Dreierreihen)
// RTP wird exakt per Aufzählung aller Walzenkombinationen berechnet (slotRtp) und im Inhaltstest geprüft.

export const SLOT_SYMBOLS = ['flamingo', 'palm', 'orange', 'gator', 'shades', 'seven', 'shell'] as const;
export type SlotSymbol = (typeof SLOT_SYMBOLS)[number];
export const SYMBOL_ICON: Record<SlotSymbol, string> = { flamingo: '🦩', palm: '🌴', orange: '🍊', gator: '🐊', shades: '🕶️', seven: '7', shell: '🐚' };
export const SYMBOL_NAME: Record<SlotSymbol, string> = { flamingo: 'Flamingo', palm: 'Palme', orange: 'Orange', gator: 'Alligator', shades: 'Sonnenbrille', seven: 'Neon-7', shell: 'Goldene Muschel' };

export type SlotVariant = 'classic' | 'goldrush';

/** Gewinnlinie: Muster (null = beliebig) → Multiplikator auf den Einsatz. 'jackpot' = progressiver Jackpot. */
export interface PayLine { pattern: (SlotSymbol | 'any7' | null)[]; pays: number | 'jackpot'; name: string }

export interface SlotDef {
  name: string;
  /** Gewichte je Symbol (gleich für alle drei Walzen). */
  weights: Record<SlotSymbol, number>;
  lines: PayLine[];
  /** Mindesteinsatz für den progressiven Jackpot (darunter zahlt die Muschel-Reihe `shellFallback` x Einsatz). */
  jackpotMinBet: number;
  shellFallback: number;
  /** Beschreibung für die Anzeige. */
  blurb: string;
}

const ANY = null;
export const SLOTS: Record<SlotVariant, SlotDef> = {
  classic: {
    name: 'Lucky Flamingo Classic',
    blurb: 'Viele kleine Gewinne – Orangen zahlen schon einzeln.',
    weights: { orange: 14, palm: 11, flamingo: 9, gator: 6, shades: 5, seven: 3, shell: 1 },
    lines: [
      { pattern: ['shell', 'shell', 'shell'], pays: 'jackpot', name: 'JACKPOT – drei Goldene Muscheln' },
      { pattern: ['seven', 'seven', 'seven'], pays: 100, name: 'Drei Neon-7' },
      { pattern: ['shades', 'shades', 'shades'], pays: 40, name: 'Drei Sonnenbrillen' },
      { pattern: ['gator', 'gator', 'gator'], pays: 25, name: 'Drei Alligatoren' },
      { pattern: ['flamingo', 'flamingo', 'flamingo'], pays: 15, name: 'Drei Flamingos' },
      { pattern: ['palm', 'palm', 'palm'], pays: 9, name: 'Drei Palmen' },
      { pattern: ['orange', 'orange', 'orange'], pays: 6, name: 'Drei Orangen' },
      { pattern: ['flamingo', 'flamingo', ANY], pays: 3, name: 'Zwei Flamingos' },
      { pattern: ['orange', 'orange', ANY], pays: 3, name: 'Zwei Orangen' },
      { pattern: ['orange', ANY, ANY], pays: 1, name: 'Eine Orange' },
    ],
    jackpotMinBet: 100,
    shellFallback: 250,
  },
  goldrush: {
    name: 'Lucky Flamingo Gold Rush',
    blurb: 'Selten, aber laut: keine Kleinstgewinne, dafür dicke Dreierreihen.',
    weights: { orange: 12, palm: 12, flamingo: 10, gator: 8, shades: 6, seven: 4, shell: 1.5 },
    lines: [
      { pattern: ['shell', 'shell', 'shell'], pays: 'jackpot', name: 'JACKPOT – drei Goldene Muscheln' },
      { pattern: ['seven', 'seven', 'seven'], pays: 260, name: 'Drei Neon-7' },
      { pattern: ['shades', 'shades', 'shades'], pays: 80, name: 'Drei Sonnenbrillen' },
      { pattern: ['gator', 'gator', 'gator'], pays: 46, name: 'Drei Alligatoren' },
      { pattern: ['flamingo', 'flamingo', 'flamingo'], pays: 26, name: 'Drei Flamingos' },
      { pattern: ['palm', 'palm', 'palm'], pays: 16, name: 'Drei Palmen' },
      { pattern: ['orange', 'orange', 'orange'], pays: 14, name: 'Drei Orangen' },
      { pattern: ['any7', 'any7', ANY], pays: 5, name: 'Zwei Neon-7' },
    ],
    jackpotMinBet: 100,
    shellFallback: 400,
  },
};

function matches(line: PayLine, reels: SlotSymbol[]): boolean {
  for (let i = 0; i < 3; i++) {
    const p = line.pattern[i];
    if (p === null || p === undefined) continue;
    if (p === 'any7' ? reels[i] !== 'seven' : reels[i] !== p) return false;
  }
  return true;
}

/** Bestes passendes Gewinnmuster (erste Zeile der Tabelle gewinnt) oder null. */
export function evaluateSlot(v: SlotVariant, reels: SlotSymbol[]): PayLine | null {
  for (const l of SLOTS[v].lines) if (matches(l, reels)) return l;
  return null;
}

/** Auszahlung in $ (ohne Jackpot – der kommt vom Server aus dem Topf). */
export function slotPayout(v: SlotVariant, reels: SlotSymbol[], bet: number): { win: number; jackpot: boolean; line: PayLine | null } {
  const line = evaluateSlot(v, reels);
  if (!line) return { win: 0, jackpot: false, line };
  if (line.pays === 'jackpot') {
    const def = SLOTS[v];
    return bet >= def.jackpotMinBet ? { win: 0, jackpot: true, line } : { win: bet * def.shellFallback, jackpot: false, line };
  }
  return { win: bet * line.pays, jackpot: false, line };
}

/** Walze ziehen: rnd(n) liefert eine ganze Zufallszahl 0 … n-1 (Server: crypto.randomInt). */
export function spinReels(v: SlotVariant, rnd: (n: number) => number): SlotSymbol[] {
  const w = SLOTS[v].weights;
  // Gewichte auf ganze Zahlen (x2) für die Ziehung
  const table: SlotSymbol[] = [];
  for (const s of SLOT_SYMBOLS) for (let k = 0; k < Math.round(w[s] * 2); k++) table.push(s);
  return [0, 1, 2].map(() => table[rnd(table.length)]);
}

/**
 * Exakte Auszahlungsquote des Grundspiels (alle Kombinationen). jackpotValue = angenommener Jackpot in
 * Vielfachen des Einsatzes (Standard: Fallback-Multiplikator, d. h. ohne Topf). Zusätzlich fließt
 * BALANCE.casino.jackpotShare jedes Einsatzes über den progressiven Topf an die Spieler zurück.
 */
export function slotRtp(v: SlotVariant, jackpotValue?: number): { rtp: number; hitRate: number } {
  const def = SLOTS[v];
  const syms = SLOT_SYMBOLS.map((s) => [s, Math.round(def.weights[s] * 2)] as const);
  const total = syms.reduce((a, [, w]) => a + w, 0) ** 3;
  let ret = 0, hits = 0;
  for (const [a, wa] of syms) for (const [b, wb] of syms) for (const [c, wc] of syms) {
    const p = (wa * wb * wc) / total;
    const line = evaluateSlot(v, [a, b, c]);
    if (!line) continue;
    hits += p;
    ret += p * (line.pays === 'jackpot' ? jackpotValue ?? def.shellFallback : line.pays);
  }
  return { rtp: ret, hitRate: hits };
}
