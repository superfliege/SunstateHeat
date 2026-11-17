// Casino „Palm Royale“: Spielautomaten (progressiver Jackpot pro Instanz), Blackjack-Tische, Roulette und
// Gator Derby. Alles mit Spielgeld-Chips; Ergebnisse bestimmt ausschließlich der Server mit sicherem Zufall,
// und zwar erst nachdem der Einsatz abgebucht ist (Walzen beim Dreh, Karten beim Ziehen, Kugel bei Setzschluss).
import { BALANCE } from '../../../shared/src/balance';
import {
  basicStrategy, cardPoints, dealerMustHit, handValue, isBlackjack, newShoe, settleHand,
  type BjSeatView, type BjTableView,
} from '../../../shared/src/content/casino/blackjack';
import { derbyChances, derbyOdds, derbyScript, GATORS, type DerbyView } from '../../../shared/src/content/casino/derby';
import { betKey, betLabel, betPayout, colorOf, validBet, type RouletteBet, type RouletteView } from '../../../shared/src/content/casino/roulette';
import { slotPayout, SLOTS, spinReels, SYMBOL_NAME, type SlotVariant } from '../../../shared/src/content/casino/slots';
import { CASINO_TABLES, SLOT_MACHINES, type TableDef } from '../../../shared/src/venues/interiors';
import type { ServerPlayer } from '../entities/types';
import { betBlocked, limitBlocked, secureRnd, settleRound, takeChips, vprof } from './Bank';
import type { VenueHost } from './host';

const C = BALANCE.casino;
const pick = <T>(a: readonly T[]) => a[secureRnd(a.length)];

export interface CasinoCtx {
  h: VenueHost;
  /** Spieler im Casino */
  inside(): ServerPlayer[];
  /** Sprechblase am Croupier/NPC (Schlüssel z. B. 'croupier:bj1') */
  bubble(key: string, text: string, style?: 'say' | 'shout'): void;
  /** Jackpot geknackt (Lichtshow, Sirene, Radiomeldung) – winner: Spieler oder null (NPC) */
  jackpot(winner: ServerPlayer | null, amount: number): void;
  /** Großer Gewinn an einem Automaten (Jubel in der Nähe) */
  bigWin(machine: number, amount: number): void;
  /** Gerücht ins Instanz-Register */
  rumor(text: string): void;
}

// ------------------------------------------------------------------ Blackjack
interface BjHand { cards: number[]; bet: number; done: boolean; result?: string; doubled?: boolean; split?: boolean }
interface BjSeat { pid: number; name: string; hands: BjHand[]; active: number; insurance: number; bet: number; npc?: { style: number } }
interface BjTable { def: TableDef; phase: BjTableView['phase']; t: number; turn: number; dealer: number[]; hole: boolean; seats: BjSeat[]; shoe: number[]; shoeSize: number; say?: string; dirty: boolean; npcT: number }

const BJ_LINES = {
  bust: ['Die Bank dankt.', 'Zu viel des Guten.', 'Zweiundzwanzig ist auch eine schöne Zahl. Nur nicht hier.'],
  double: ['Mutige Entscheidung, Sir.', 'Verdoppelt. Ich bewundere Ihren Optimismus.', 'Oh, wir werden mutig.'],
  bj: ['Blackjack! Herzlichen Glückwunsch.', 'Einundzwanzig mit zwei Karten. Ich bin fast beeindruckt.'],
  dealerBust: ['Die Bank hat sich überschätzt.', 'Ich habe mich verzählt. Das passiert. Nie.'],
  shuffle: ['Neuer Schlitten. Neues Glück. Gleicher Hausvorteil.', 'Ich mische. Sie hoffen.'],
  win: ['Gut gespielt.', 'Na bitte.', 'Die Bank zahlt. Widerwillig.'],
  insurance: ['Versicherung gefällig? Das Ass guckt so komisch.'],
};

// ------------------------------------------------------------------ Roulette
interface RuTable { def: TableDef; phase: RouletteView['phase']; t: number; result: number; spin: number; history: number[]; bets: { pid: number; name: string; bet: RouletteBet }[]; seats: Map<number, string>; say?: string }

// ------------------------------------------------------------------ Gator Derby
interface DerbyState { race: number; phase: DerbyView['phase']; t: number; form: number[]; odds: number[]; order?: number[]; script?: number[][]; bets: { pid: number; gator: number; amount: number; cash: boolean }[]; say?: string; history: number[] }
const DERBY_RUN = 22, DERBY_RESULT = 10;
const NPC_NAMES = ['Tourist Hank', 'Oma Dolores', 'Systemspieler Bernd', 'Junggeselle Kevin', 'Dame mit Fächer', 'Trauzeuge Dennis', 'Mr. Sonnenbrille'];

export class Casino {
  jackpotPool = C.jackpotSeed;
  private jackpotDirty = true;
  /** Automaten: wer sitzt dran (Spieler-ID), letzte Drehung (ms) */
  private machines = new Map<number, { pid: number; last: number }>();
  readonly bj = new Map<string, BjTable>();
  readonly ru = new Map<string, RuTable>();
  derby: DerbyState;
  private boardT = 0;

  constructor(private c: CasinoCtx) {
    for (const t of CASINO_TABLES) {
      if (t.kind === 'bj') {
        const shoe = newShoe(C.bjDecks, secureRnd);
        this.bj.set(t.id, { def: t, phase: 'idle', t: 0, turn: -1, dealer: [], hole: true, seats: Array.from({ length: t.seats }, () => ({ pid: 0, name: '', hands: [], active: 0, insurance: 0, bet: 0 })), shoe, shoeSize: shoe.length, dirty: true, npcT: 0 });
      } else this.ru.set(t.id, { def: t, phase: 'bet', t: C.rouletteBetSeconds, result: 0, spin: 0, history: [], bets: [], seats: new Map() });
    }
    this.derby = this.newDerby(1);
    this.derby.t = 60; // erstes Rennen bald nach dem Serverstart
  }

  // ================================================================== Automaten
  occupyMachine(p: ServerPlayer, m: number): string {
    if (!SLOT_MACHINES[m]) return 'Kein Automat.';
    const o = this.machines.get(m);
    if (o && o.pid !== p.id && this.c.h.players.get(o.pid)?.interior?.seat === `slot${m}`) return 'Der Automat ist besetzt.';
    this.machines.set(m, { pid: p.id, last: 0 });
    return '';
  }
  leaveMachine(p: ServerPlayer) { for (const [m, o] of this.machines) if (o.pid === p.id) this.machines.delete(m); }

  spin(p: ServerPlayer, m: number, bet: number) {
    const mach = SLOT_MACHINES[m];
    const occ = this.machines.get(m);
    if (!mach || !occ || occ.pid !== p.id) return this.c.h.notice(p, 'Setz dich erst an den Automaten.', 'bad');
    const now = Date.now();
    if (now - occ.last < 1800) return; // Walzen laufen noch
    if (!(C.slotBets as readonly number[]).includes(bet)) return this.c.h.notice(p, 'Ungültiger Einsatz.', 'bad');
    const why = betBlocked(p, bet, now);
    if (why) return this.c.h.notice(p, why, 'bad');
    if (!takeChips(p, bet, `slot:${mach.v}`)) return;
    occ.last = now;
    // Topf wächst mit jedem Einsatz – Ergebnis erst jetzt (nach dem Einsatz) ziehen
    this.jackpotPool += bet * C.jackpotShare;
    this.jackpotDirty = true;
    const v: SlotVariant = mach.v;
    const reels = spinReels(v, secureRnd);
    const res = slotPayout(v, reels, bet);
    let win = res.win;
    if (res.jackpot) {
      win = Math.floor(this.jackpotPool);
      vprof(p).jackpots++;
      this.c.jackpot(p, win);
      this.jackpotPool = C.jackpotSeed;
    } else if (win >= bet * 40) this.c.bigWin(m, win);
    settleRound(p, bet, win, 'slot', now);
    this.c.h.send(p, { t: 'vgame', s: { g: 'slot', m, v, reels, win, jackpot: res.jackpot, line: res.line?.name ?? '', bet, spin: now, chips: vprof(p).chips } });
  }

  /** NPC-Spieler knacken selten den Jackpot (E64 Jackpot-Hysterie). */
  npcJackpot(): number {
    const amount = Math.floor(this.jackpotPool);
    this.jackpotPool = C.jackpotSeed;
    this.jackpotDirty = true;
    this.c.jackpot(null, amount);
    return amount;
  }
  /** NPC-Einsätze lassen den Topf langsam wachsen (Automatenhalle ist nie leer). */
  npcSpins(n: number) { this.jackpotPool += n * 25 * C.jackpotShare; this.jackpotDirty = true; }

  // ================================================================== Blackjack
  sit(p: ServerPlayer, tableId: string, seat: number): string {
    const t = this.bj.get(tableId) ?? null;
    const r = this.ru.get(tableId) ?? null;
    if (r) { r.seats.set(p.id, p.name); return ''; }
    if (!t || !t.seats[seat]) return 'Kein Platz.';
    if (t.def.high && !(p.interior && p.interior.mask & 2)) return 'Nur für High-Roller.';
    const s = t.seats[seat];
    if (s.pid > 0 && s.pid !== p.id) return 'Der Platz ist besetzt.';
    if (s.pid === -1 && s.hands.length && t.phase !== 'idle' && t.phase !== 'bet') return 'Die Runde läuft noch – gleich wird der Platz frei.';
    Object.assign(s, { pid: p.id, name: p.name, hands: [], active: 0, insurance: 0, bet: 0, npc: undefined });
    if (t.phase === 'idle') { t.phase = 'bet'; t.t = C.bjBetSeconds; }
    t.dirty = true;
    return '';
  }

  leaveTables(p: ServerPlayer) {
    for (const t of this.bj.values()) for (const s of t.seats) if (s.pid === p.id) {
      // Laufende Hände verfallen nicht: sie werden als „Stehen“ zu Ende gespielt (Einsatz bleibt im Spiel)
      if (s.hands.some((h) => !h.done)) for (const h of s.hands) h.done = true;
      if (!s.hands.length) { if (s.bet > 0) { vprof(p).chips += s.bet; s.bet = 0; } s.pid = 0; s.name = ''; }
      else s.pid = -2; // „verlassen“: wird nach der Abrechnung frei, Auszahlung geht trotzdem an den Spieler
      (s as BjSeat & { owner?: number }).owner = p.id;
      t.dirty = true;
    }
    for (const r of this.ru.values()) r.seats.delete(p.id);
  }

  bjAction(p: ServerPlayer, tableId: string, op: string, amount?: number) {
    const t = this.bj.get(tableId);
    if (!t) return;
    const si = t.seats.findIndex((s) => s.pid === p.id);
    if (si < 0) return this.c.h.notice(p, 'Setz dich erst an den Tisch.', 'bad');
    const s = t.seats[si];
    const [lo, hi] = t.def.high ? C.bjHighLimits : C.bjLimits;
    switch (op) {
      case 'bet': {
        if (t.phase !== 'bet') return;
        const a = Math.floor(amount ?? 0);
        if (a < lo || a > hi) return this.c.h.notice(p, `Tischlimit: ${lo}–${hi.toLocaleString('de-DE')} $.`, 'bad');
        if (s.bet > 0) { vprof(p).chips += s.bet; s.bet = 0; } // Einsatz ändern
        const why = betBlocked(p, a);
        if (why) return this.c.h.notice(p, why, 'bad');
        takeChips(p, a, `bj:${tableId}`);
        s.bet = a;
        t.dirty = true;
        // Alle menschlichen Spieler haben gesetzt → sofort austeilen
        if (t.seats.every((x) => x.pid <= 0 || x.bet > 0)) t.t = Math.min(t.t, 1);
        return;
      }
      case 'insure': case 'noinsure': {
        if (t.phase !== 'insurance' || s.insurance !== 0 || !s.hands.length) return;
        if (op === 'insure') {
          const ins = Math.floor(s.hands[0].bet / 2);
          if (ins > 0 && !betBlocked(p, ins) && takeChips(p, ins, `bj:${tableId}:versicherung`)) s.insurance = ins;
        } else s.insurance = -1;
        t.dirty = true;
        if (t.seats.every((x) => x.pid <= 0 || !x.hands.length || x.insurance !== 0)) t.t = Math.min(t.t, 0.5);
        return;
      }
    }
    if (t.phase !== 'play' || t.turn !== si) return;
    const h = s.hands[s.active];
    if (!h || h.done) return;
    this.playHand(t, s, si, h, op, p);
  }

  private playHand(t: BjTable, s: BjSeat, si: number, h: BjHand, op: string, p: ServerPlayer | null) {
    const draw = () => this.draw(t);
    switch (op) {
      case 'hit': h.cards.push(draw()); if (handValue(h.cards).total >= 21) { h.done = true; if (handValue(h.cards).total > 21) this.croupier(t, pick(BJ_LINES.bust)); } break;
      case 'stand': h.done = true; break;
      case 'double': {
        if (h.cards.length !== 2 || h.doubled) return;
        if (p) { const why = betBlocked(p, h.bet); if (why) { this.c.h.notice(p, why, 'bad'); return; } takeChips(p, h.bet, `bj:${t.def.id}:verdoppeln`); }
        h.bet *= 2; h.doubled = true; h.cards.push(draw()); h.done = true;
        this.croupier(t, pick(BJ_LINES.double));
        break;
      }
      case 'split': {
        if (h.cards.length !== 2 || s.hands.length > 1 || cardPoints(h.cards[0]) !== cardPoints(h.cards[1])) return;
        if (p) { const why = betBlocked(p, h.bet); if (why) { this.c.h.notice(p, why, 'bad'); return; } takeChips(p, h.bet, `bj:${t.def.id}:teilen`); }
        const second: BjHand = { cards: [h.cards.pop()!, draw()], bet: h.bet, done: false, split: true };
        h.cards.push(draw()); h.split = true;
        s.hands.push(second);
        // Geteilte Asse: je eine Karte, dann Schluss
        if (cardPoints(h.cards[0]) === 1) { h.done = true; second.done = true; }
        break;
      }
      default: return;
    }
    t.dirty = true;
    this.advance(t, si);
  }

  private draw(t: BjTable): number {
    if (!t.shoe.length) { t.shoe = newShoe(C.bjDecks, secureRnd); t.shoeSize = t.shoe.length; }
    return t.shoe.pop()!;
  }
  private croupier(t: BjTable, text: string) { t.say = text; this.c.bubble(`croupier:${t.def.id}`, text); }

  /** Nächste offene Hand am Sitz bzw. nächster Sitz. */
  private advance(t: BjTable, si: number) {
    const s = t.seats[si];
    const open = s.hands.findIndex((h) => !h.done);
    if (open >= 0) { s.active = open; return; }
    this.nextTurn(t, si + 1);
  }
  private nextTurn(t: BjTable, from: number) {
    for (let i = from; i < t.seats.length; i++) {
      const s = t.seats[i];
      if (s.hands.some((h) => !h.done)) { t.turn = i; s.active = s.hands.findIndex((h) => !h.done); t.t = C.bjTurnSeconds; t.npcT = 0.9; return; }
    }
    t.turn = -1; t.phase = 'dealer'; t.hole = false; t.t = 0.9;
  }

  private tickBj(t: BjTable, dt: number) {
    t.t -= dt;
    const humans = t.seats.filter((s) => s.pid > 0);
    switch (t.phase) {
      case 'idle': return;
      case 'bet': {
        // NPC-Mitspieler füllen ab und zu freie Plätze (nur Anzeige, kein Geld)
        if (t.t > C.bjBetSeconds - 0.2) {
          for (const s of t.seats) {
            if (s.pid === 0 && humans.length && secureRnd(100) < 35) {
              const used = new Set(t.seats.map((x) => x.name));
              const free = NPC_NAMES.filter((n) => !used.has(n));
              if (free.length) Object.assign(s, { pid: -1, name: pick(free), npc: { style: secureRnd(3) }, bet: 0, hands: [] });
            }
            if (s.pid === -1 && !s.bet) s.bet = (t.def.high ? 500 : 10) * (1 + secureRnd(5));
          }
          t.dirty = true;
        }
        if (!humans.length) { this.resetTable(t); return; }
        if (t.t > 0) return;
        if (!humans.some((s) => s.bet > 0)) { t.t = C.bjBetSeconds; return; }
        this.deal(t);
        return;
      }
      case 'insurance': if (t.t <= 0) this.afterInsurance(t); return;
      case 'play': {
        const s = t.seats[t.turn];
        if (!s) { this.nextTurn(t, 0); return; }
        const h = s.hands[s.active];
        if (s.pid === -1 || s.pid === -2) {
          // NPC (oder verlassener Platz): Grundstrategie nach kurzer Denkpause
          t.npcT -= dt;
          if (t.npcT > 0) return;
          t.npcT = 0.8;
          const act = s.pid === -2 ? 'stand' : basicStrategy(h.cards, cardPoints(t.dealer[0]), h.cards.length === 2, s.hands.length === 1);
          this.playHand(t, s, t.turn, h, act, null);
          return;
        }
        if (t.t <= 0) { h.done = true; this.croupier(t, 'Die Zeit ist um – ich werte das als „Stehen“.'); this.advance(t, t.turn); t.dirty = true; }
        return;
      }
      case 'dealer': {
        if (t.t > 0) return;
        const anyAlive = t.seats.some((s) => s.hands.some((h) => handValue(h.cards).total <= 21));
        if (anyAlive && dealerMustHit(t.dealer)) { t.dealer.push(this.draw(t)); t.t = 0.8; t.dirty = true; return; }
        this.settle(t);
        return;
      }
      case 'settle': {
        if (t.t > 0) return;
        for (const s of t.seats) {
          if (s.pid === -2 || (s.pid === -1 && secureRnd(100) < 30)) { s.pid = 0; s.name = ''; }
          s.hands = []; s.bet = 0; s.insurance = 0; s.active = 0;
        }
        t.dealer = []; t.hole = true;
        if (t.shoe.length < t.shoeSize * (1 - C.bjShuffleAt)) { t.shoe = newShoe(C.bjDecks, secureRnd); t.shoeSize = t.shoe.length; this.croupier(t, pick(BJ_LINES.shuffle)); }
        t.phase = t.seats.some((s) => s.pid > 0) ? 'bet' : 'idle';
        t.t = C.bjBetSeconds;
        t.dirty = true;
      }
    }
  }

  private resetTable(t: BjTable) {
    for (const s of t.seats) { s.pid = 0; s.name = ''; s.hands = []; s.bet = 0; s.insurance = 0; }
    t.phase = 'idle'; t.dealer = []; t.turn = -1; t.dirty = true;
  }

  private deal(t: BjTable) {
    for (const s of t.seats) {
      if (s.pid !== 0 && s.bet > 0) s.hands = [{ cards: [], bet: s.bet, done: false }];
      else if (s.pid === -1) { s.pid = 0; s.name = ''; }
    }
    t.dealer = [];
    for (let r = 0; r < 2; r++) {
      for (const s of t.seats) if (s.hands.length) s.hands[0].cards.push(this.draw(t));
      t.dealer.push(this.draw(t));
    }
    t.hole = true;
    for (const s of t.seats) if (s.hands.length && isBlackjack(s.hands[0].cards)) s.hands[0].done = true;
    if (cardPoints(t.dealer[0]) === 1 && t.seats.some((s) => s.pid > 0 && s.hands.length)) {
      t.phase = 'insurance'; t.t = 8; this.croupier(t, pick(BJ_LINES.insurance));
      for (const s of t.seats) if (s.pid <= 0) s.insurance = -1;
    } else this.afterInsurance(t);
    t.dirty = true;
  }

  private afterInsurance(t: BjTable) {
    if (isBlackjack(t.dealer)) { t.hole = false; this.croupier(t, 'Blackjack für die Bank. Die Bank dankt.'); this.settle(t); return; }
    t.phase = 'play';
    this.nextTurn(t, 0);
    t.dirty = true;
  }

  private settle(t: BjTable) {
    t.hole = false;
    const dealerBJ = isBlackjack(t.dealer);
    let dealerBust = handValue(t.dealer).total > 21;
    for (const s of t.seats) {
      if (!s.hands.length) continue;
      const owner = s.pid > 0 ? s.pid : (s as BjSeat & { owner?: number }).owner ?? 0;
      const p = owner > 0 ? this.c.h.players.get(owner) : undefined;
      let stake = 0, pay = 0;
      for (const h of s.hands) {
        const r = settleHand(h.cards, t.dealer, h.bet, s.hands.length > 1);
        h.result = r.result; h.done = true;
        stake += h.bet; pay += r.pay;
        if (r.result === 'blackjack' && p) this.croupier(t, pick(BJ_LINES.bj));
      }
      if (s.insurance > 0) { stake += s.insurance; if (dealerBJ) pay += s.insurance * 3; }
      if (p && (s.pid > 0 || s.pid === -2)) {
        settleRound(p, stake, pay, 'bj');
        if (pay > stake) this.c.h.notice(p, `Blackjack: +${(pay - stake).toLocaleString('de-DE')} $ in Chips`, 'good');
      }
    }
    if (dealerBust) { this.croupier(t, pick(BJ_LINES.dealerBust)); dealerBust = false; }
    t.phase = 'settle'; t.t = 4; t.turn = -1; t.dirty = true;
  }

  bjView(t: BjTable): BjTableView {
    const seats: BjSeatView[] = t.seats.map((s, i) => ({ seat: i, pid: s.pid === -2 ? -1 : s.pid, name: s.name, hands: s.hands.map((h) => ({ cards: [...h.cards], bet: h.bet, done: h.done, result: h.result, doubled: h.doubled })), active: s.active, insurance: s.insurance, bet: s.bet }));
    return { id: t.def.id, phase: t.phase, t: Math.max(0, Math.round(t.t * 10) / 10), turn: t.turn, dealer: t.hole && t.dealer.length ? [t.dealer[0], -1] : [...t.dealer], hole: t.hole, seats, limits: [...(t.def.high ? C.bjHighLimits : C.bjLimits)] as [number, number], shoe: Math.round((t.shoe.length / t.shoeSize) * 100) / 100, say: t.say };
  }

  // ================================================================== Roulette
  ruBet(p: ServerPlayer, tableId: string, op: string, type?: string, n?: number, amount?: number) {
    const r = this.ru.get(tableId);
    if (!r) return;
    r.seats.set(p.id, p.name);
    if (r.phase !== 'bet') return this.c.h.notice(p, 'Nichts geht mehr.', 'bad');
    if (op === 'clear') {
      const mine = r.bets.filter((b) => b.pid === p.id);
      const back = mine.reduce((a, b) => a + b.bet.amount, 0);
      if (back > 0) { vprof(p).chips += back; r.bets = r.bets.filter((b) => b.pid !== p.id); }
      return;
    }
    const bet: RouletteBet = { type: type as RouletteBet['type'], n, amount: Math.floor(amount ?? 0) };
    if (!validBet(bet)) return this.c.h.notice(p, 'Ungültiger Einsatz.', 'bad');
    const [lo, hi] = C.rouletteLimits;
    const already = r.bets.filter((b) => b.pid === p.id).reduce((a, b) => a + b.bet.amount, 0);
    if (bet.amount < lo || already + bet.amount > hi) return this.c.h.notice(p, `Tischlimit: ${lo}–${hi.toLocaleString('de-DE')} $ pro Runde.`, 'bad');
    // Verlustlimit für alle Einsätze dieser Runde zusammen
    const why = betBlocked(p, bet.amount + already);
    if (why) return this.c.h.notice(p, why, 'bad');
    if (!takeChips(p, bet.amount, `ru:${betKey(bet)}`)) return;
    const same = r.bets.find((b) => b.pid === p.id && betKey(b.bet) === betKey(bet));
    if (same) same.bet.amount += bet.amount; else r.bets.push({ pid: p.id, name: p.name, bet });
  }

  private tickRu(r: RuTable, dt: number) {
    r.t -= dt;
    const nearby = this.c.inside().some((p) => r.seats.has(p.id));
    if (r.phase === 'bet') {
      if (!nearby && !r.bets.length) { r.t = C.rouletteBetSeconds; return; }
      // NPC-Einsätze (Anzeige)
      if (secureRnd(100) < 3 && r.bets.filter((b) => b.pid < 0).length < 5) {
        const types: RouletteBet['type'][] = ['red', 'black', 'straight', 'even', 'dozen'];
        const type = pick(types);
        r.bets.push({ pid: -1, name: pick(['Systemspieler Bernd', 'Oma Dolores', 'Tourist', 'Junggeselle']), bet: { type, n: type === 'straight' ? secureRnd(37) : type === 'dozen' ? 1 + secureRnd(3) : undefined, amount: 5 * (1 + secureRnd(10)) } });
      }
      if (r.t <= 0) {
        // Ergebnis erst jetzt: alle Einsätze stehen fest
        r.result = secureRnd(37); r.spin++; r.phase = 'spin'; r.t = 7;
        r.say = 'Nichts geht mehr!';
        this.c.bubble(`croupier:${r.def.id}`, 'Nichts geht mehr!');
      }
    } else if (r.phase === 'spin') {
      if (r.t <= 0) {
        r.phase = 'result'; r.t = 5;
        r.history.unshift(r.result); r.history.length = Math.min(r.history.length, 12);
        const col = colorOf(r.result);
        r.say = `${r.result} – ${col === 'green' ? 'Null!' : col === 'red' ? 'Rot' : 'Schwarz'}.`;
        this.c.bubble(`croupier:${r.def.id}`, r.say);
        const byPlayer = new Map<number, { stake: number; pay: number }>();
        for (const b of r.bets) {
          if (b.pid < 0) continue;
          const e = byPlayer.get(b.pid) ?? { stake: 0, pay: 0 };
          e.stake += b.bet.amount; e.pay += betPayout(b.bet, r.result);
          byPlayer.set(b.pid, e);
        }
        for (const [pid, e] of byPlayer) {
          const p = this.c.h.players.get(pid);
          if (!p) continue;
          settleRound(p, e.stake, e.pay, 'ru');
          if (e.pay > e.stake) this.c.h.notice(p, `Roulette: ${r.result} – +${(e.pay - e.stake).toLocaleString('de-DE')} $`, 'good');
          else this.c.h.notice(p, `Roulette: ${r.result} – die Bank dankt.`, 'info');
          if (e.pay >= 10_000) this.c.rumor(`Am Roulette im Palm Royale hat ${p.name} ${e.pay.toLocaleString('de-DE')} $ auf einmal gewonnen. Der Croupier hat kurz gezuckt.`);
        }
      }
    } else if (r.t <= 0) { r.phase = 'bet'; r.t = C.rouletteBetSeconds; r.bets = []; r.say = 'Faites vos jeux – bitte setzen!'; }
  }

  ruView(r: RuTable): RouletteView {
    return {
      id: r.def.id, phase: r.phase, t: Math.max(0, Math.round(r.t * 10) / 10), result: r.phase === 'bet' ? -1 : r.result, spin: r.spin, history: r.history,
      bets: r.bets.map((b) => [b.pid, b.name, betLabel(b.bet), b.bet.amount]), seats: [...r.seats.entries()], limits: [...C.rouletteLimits] as [number, number], say: r.say,
    };
  }

  // ================================================================== Gator Derby
  private newDerby(race: number): DerbyState {
    const form = GATORS.map(() => secureRnd(5) - 2);
    return { race, phase: 'bet', t: C.derbyInterval - DERBY_RUN - DERBY_RESULT, form, odds: derbyOdds(form), bets: [], history: this.derby?.history ?? [] };
  }

  /** Wette (cash = Terminal in einer Bar/einem Wettbüro mit Bargeld, sonst Chips im Casino). */
  derbyBet(p: ServerPlayer, gator: number, amount: number, cash: boolean) {
    const d = this.derby;
    if (d.phase !== 'bet') return this.c.h.notice(p, 'Die Alligatoren sind schon unterwegs – nächstes Rennen!', 'bad');
    if (!GATORS[gator]) return;
    const a = Math.floor(amount);
    const [lo, hi] = C.derbyLimits;
    const already = d.bets.filter((b) => b.pid === p.id).reduce((s, b) => s + b.amount, 0);
    if (a < lo || already + a > hi) return this.c.h.notice(p, `Wettlimit: ${lo}–${hi.toLocaleString('de-DE')} $ pro Rennen.`, 'bad');
    if (cash) {
      const why = limitBlocked(p, a);
      if (why) return this.c.h.notice(p, why, 'bad');
      if (p.profile.money < a) return this.c.h.notice(p, 'Nicht genug Bargeld.', 'bad');
      this.c.h.addMoney(p, -a, 'derby:wette');
    } else {
      const why = betBlocked(p, a);
      if (why) return this.c.h.notice(p, why, 'bad');
      if (!takeChips(p, a, 'derby:wette')) return;
    }
    d.bets.push({ pid: p.id, gator, amount: a, cash });
    this.c.h.notice(p, `Wette: ${a.toLocaleString('de-DE')} $ auf ${GATORS[gator].name} (Quote ${d.odds[gator].toFixed(1)})`, 'info');
  }

  private tickDerby(dt: number) {
    const d = this.derby;
    d.t -= dt;
    if (d.phase === 'bet' && d.t <= 0) {
      // Sieger nach Siegchancen ziehen (sicherer Zufall), Rest der Reihenfolge ebenso
      const chances = derbyChances(d.form);
      const left = GATORS.map((g) => g.id);
      const order: number[] = [];
      while (left.length) {
        const w = left.map((i) => chances[i]); const sum = w.reduce((a, b) => a + b, 0);
        let r = (secureRnd(1_000_000) / 1_000_000) * sum, k = 0;
        while (k < left.length - 1 && r >= w[k]) { r -= w[k]; k++; }
        order.push(left.splice(k, 1)[0]);
      }
      d.order = order; d.script = derbyScript(order, secureRnd(2 ** 31));
      d.phase = 'run'; d.t = DERBY_RUN;
      d.say = `Und sie sind los! ${GATORS[order[order.length - 1]].name} gähnt noch am Start …`;
    } else if (d.phase === 'run') {
      const lines = [`${GATORS[d.order![2]].name} schnappt nach dem Kameramann!`, `${GATORS[d.order![1]].name} macht Druck auf der Gegengeraden!`, `Wer ist das da vorn?! Es ist ${GATORS[d.order![0]].name}!`];
      const k = Math.floor(((DERBY_RUN - d.t) / DERBY_RUN) * 4) - 1;
      if (k >= 0 && k < lines.length) d.say = lines[k];
      if (d.t <= 0) {
        d.phase = 'result'; d.t = DERBY_RESULT;
        const win = d.order![0];
        d.history.unshift(win); d.history.length = Math.min(d.history.length, 8);
        d.say = `Sieger: ${GATORS[win].name}! ${win === 2 ? 'Old Grumpy hat es wieder allen gezeigt. Er wird es tagelang erzählen.' : 'Was für ein Rennen!'}`;
        const byPlayer = new Map<number, { stake: number; pay: number; cash: boolean }>();
        for (const b of d.bets) {
          const e = byPlayer.get(b.pid) ?? { stake: 0, pay: 0, cash: b.cash };
          e.stake += b.amount; if (b.gator === win) e.pay += Math.floor(b.amount * d.odds[win]);
          byPlayer.set(b.pid, e);
        }
        for (const [pid, e] of byPlayer) {
          const p = this.c.h.players.get(pid);
          if (!p) continue;
          if (e.cash) {
            // Terminal: Auszahlung in bar, Bilanz trotzdem im Casino-Konto
            if (e.pay > 0) this.c.h.addMoney(p, e.pay, 'derby:gewinn');
            const v = vprof(p); const net = e.pay - e.stake;
            if (net > 0) v.won += net; else v.lost -= net; v.hour.push([Date.now(), net]); v.races++;
          } else settleRound(p, e.stake, e.pay, 'derby');
          this.c.h.notice(p, e.pay > 0 ? `Gator Derby: ${GATORS[win].name} gewinnt – +${e.pay.toLocaleString('de-DE')} $!` : `Gator Derby: ${GATORS[win].name} gewinnt. Dein Alligator war … emotional nicht bereit.`, e.pay > 0 ? 'good' : 'info');
        }
      }
    } else if (d.phase === 'result' && d.t <= 0) this.derby = this.newDerby(d.race + 1);
  }

  derbyView(p: ServerPlayer | null): DerbyView {
    const d = this.derby;
    return {
      race: d.race, phase: d.phase, t: Math.max(0, Math.round(d.t)), form: d.form, odds: d.odds, order: d.phase !== 'bet' ? d.order : undefined, script: d.phase !== 'bet' ? d.script : undefined,
      mine: p ? d.bets.filter((b) => b.pid === p.id).map((b) => [b.gator, b.amount] as [number, number]) : [], say: d.say, history: d.history,
    };
  }

  // ================================================================== Takt
  update(dt: number) {
    for (const t of this.bj.values()) this.tickBj(t, dt);
    for (const r of this.ru.values()) this.tickRu(r, dt);
    const derbyPhase = this.derby.phase;
    this.tickDerby(dt);
    // Sichtbare Zustände verteilen (2 Hz bzw. bei Änderung)
    this.boardT -= dt;
    const tick = this.boardT <= 0;
    if (tick) this.boardT = 0.5;
    const inside = this.c.inside();
    for (const t of this.bj.values()) {
      if (!t.dirty && !(tick && t.phase !== 'idle')) continue;
      t.dirty = false;
      const view = this.bjView(t);
      for (const p of inside) if (p.interior?.seat?.startsWith(`${t.def.id}:`) || this.near(p, t.def.x, t.def.z, 7)) this.c.h.send(p, { t: 'vgame', s: { g: 'bj', view, me: t.seats.findIndex((s) => s.pid === p.id) } });
    }
    if (tick) {
      for (const r of this.ru.values()) {
        const view = this.ruView(r);
        for (const p of inside) if (p.interior?.seat?.startsWith(`${r.def.id}:`) || this.near(p, r.def.x, r.def.z, 7)) this.c.h.send(p, { t: 'vgame', s: { g: 'ru', view } });
      }
    }
    if (tick || derbyPhase !== this.derby.phase) {
      for (const p of this.c.h.players.values()) {
        const watching = p.interior?.id === 'casino' || this.derby.bets.some((b) => b.pid === p.id) || (p as ServerPlayer & { derbyWatch?: number }).derbyWatch! > Date.now();
        if (watching) this.c.h.send(p, { t: 'vgame', s: { g: 'derby', view: this.derbyView(p) } });
      }
    }
    if (this.jackpotDirty && tick) {
      this.jackpotDirty = false;
      for (const p of inside) this.c.h.send(p, { t: 'vfx', k: 'jackpotBoard', v: Math.floor(this.jackpotPool) });
    }
  }

  private near(p: ServerPlayer, lx: number, lz: number, r: number) {
    const f = p.interior?.f; if (!f) return false;
    const dx = p.pawn.x - (f.cx + lx * f.cos + lz * f.sin), dz = p.pawn.z - (f.cz - lx * f.sin + lz * f.cos);
    return dx * dx + dz * dz < r * r;
  }

  onLeave(p: ServerPlayer) { this.leaveMachine(p); this.leaveTables(p); }

  /** Beschreibung eines Automaten (Hilfe-Text). */
  static slotHelp(v: SlotVariant) {
    const d = SLOTS[v];
    return d.lines.map((l) => `${l.pattern.map((s) => (s === null ? '·' : s === 'any7' ? '7' : SYMBOL_NAME[s])).join(' ')} → ${l.pays === 'jackpot' ? 'JACKPOT' : `${l.pays}x`}`);
  }
}
