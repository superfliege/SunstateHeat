// Overlay der Venues im DS-Stil (zweiter „Bildschirm“ unten): Dialoge (Türsteher, Bar), Kasse, Bilanz und
// Bestenlisten, Spielautomat, Blackjack, Roulette, Gator Derby. Einheitlicher Ablauf: Einsatz wählen →
// spielen → Ergebnis mit Animation → „Nochmal“ / „Aufhören“. Bedienung per Maus, Tastatur und Gamepad.
// Das Tanz-Minispiel und das DJ-Pult liegen in DanceUi.ts (gleicher Rahmen).
import { BALANCE } from '../../../../shared/src/balance';
import { BJ_ACTION_LABEL, basicStrategy, cardPoints, handValue, RANK_LABEL, rankOf, suitOf, SUITS, type BjTableView } from '../../../../shared/src/content/casino/blackjack';
import { GATORS, type DerbyView } from '../../../../shared/src/content/casino/derby';
import { betKey, colorOf, ROULETTE_PAYS, type RouletteBetType, type RouletteView } from '../../../../shared/src/content/casino/roulette';
import { SLOTS, SYMBOL_ICON, SYMBOL_NAME, type SlotSymbol, type SlotVariant } from '../../../../shared/src/content/casino/slots';
import { SONG_BY_ID, DIFF_LABEL } from '../../../../shared/src/content/dance';
import type { CasinoStats, VenueAction, VenueDialog } from '../../../../shared/src/venues/net';
import { P, type PadFrame } from '../../input/Gamepad';
import { injectVenueCss } from './style';

const C = BALANCE.casino;
const fmt = (n: number) => Math.floor(n).toLocaleString('de-DE');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export type UiMode = 'none' | 'dialog' | 'cage' | 'stats' | 'slot' | 'bj' | 'ru' | 'derby' | 'dance' | 'dj';

export interface UiHost {
  send(v: VenueAction): void;
  sound(id: string, vol?: number): void;
  /** Overlay offen/zu (Eingaben sperren) */
  onOpen(open: boolean): void;
  money(): number;
  chips(): number;
  myId(): number;
  /** Tipp-Anzeige (Grundstrategie) aktiv? */
  tips(): boolean;
}

export function cardHtml(c: number): string {
  if (c < 0) return '<div class="v-card back"></div>';
  const s = suitOf(c), r = RANK_LABEL[rankOf(c)];
  const red = s === 0 || s === 3;
  return `<div class="v-card ${red ? 'red' : ''}"><span>${r}</span><span class="s">${SUITS[s]}</span><span class="r2">${r}</span></div>`;
}

export class VenueUi {
  readonly el: HTMLDivElement;
  private head: HTMLDivElement;
  private body: HTMLDivElement;
  private foot: HTMLDivElement;
  mode: UiMode = 'none';
  /** Aktuelle Daten */
  private dlg: VenueDialog | null = null;
  private slot = { m: -1, v: 'classic' as SlotVariant, bet: 10, spinning: false, reels: ['flamingo', 'palm', 'orange'] as SlotSymbol[], win: '', stopAt: [0, 0, 0], pay: false, auto: false };
  private bj: { view: BjTableView | null; me: number; amount: number } = { view: null, me: -1, amount: 10 };
  private ru: { view: RouletteView | null; chip: number; last: number; spinShown: number } = { view: null, chip: 10, last: -1, spinShown: -1 };
  private derby: { view: DerbyView | null; pick: number; amount: number; cash: boolean } = { view: null, pick: 0, amount: 50, cash: false };
  private stats: { s: CasinoStats | null; board: { song: string; diff: string; inst: [string, number][]; global: [string, number][] }[] } = { s: null, board: [] };
  private focus = 0;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  /** Zusatz-Renderer (DanceUi) */
  extra: { render(): void; key(e: KeyboardEvent): boolean; keyUp(e: KeyboardEvent): void; pad(f: PadFrame): boolean; close(): void; onClick(t: HTMLElement): boolean } | null = null;

  constructor(private h: UiHost) {
    injectVenueCss();
    this.el = document.createElement('div');
    this.el.id = 'venue-ds';
    this.el.innerHTML = '<div class="vh"></div><div class="vb"></div><div class="vf"></div>';
    document.body.appendChild(this.el);
    this.head = this.el.querySelector('.vh')!;
    this.body = this.el.querySelector('.vb')!;
    this.foot = this.el.querySelector('.vf')!;
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', this.keyHandler, true);
    window.addEventListener('keyup', (e) => { if ((this.mode === 'dance' || this.mode === 'dj') && this.extra) { this.extra.keyUp(e); e.stopPropagation(); } }, true);
  }

  get isOpen() { return this.mode !== 'none'; }

  open(mode: UiMode, casino = false) {
    const was = this.isOpen;
    this.mode = mode;
    this.el.classList.add('open');
    this.el.classList.toggle('casino', casino);
    this.focus = 0;
    if (!was) this.h.onOpen(true);
    this.render();
  }

  close(send = true) {
    if (!this.isOpen) return;
    const m = this.mode;
    if (send && (m === 'slot' || m === 'bj' || m === 'ru')) this.h.send({ a: 'leave' });
    if (m === 'dialog' && this.dlg && send) this.h.send({ a: 'opt', dlg: this.dlg.id, id: 'no' });
    if (m === 'dance' || m === 'dj') this.extra?.close();
    this.mode = 'none';
    this.dlg = null;
    this.el.classList.remove('open');
    this.h.onOpen(false);
  }

  // ------------------------------------------------------------------ Daten vom Server
  dialog(d: VenueDialog) { this.dlg = d; this.open('dialog', /casino|doorman|boutique|piano|barkeep/.test(d.id)); }
  slotState(s: { m: number; v: SlotVariant; reels: SlotSymbol[]; win: number; jackpot: boolean; line: string; bet: number; spin: number }) {
    if (!s.spin) { this.slot.m = s.m; this.slot.v = s.v; this.slot.win = ''; this.open('slot', true); return; }
    // Ergebnis: Walzen von links nach rechts mit Verzögerung stoppen
    const now = performance.now();
    this.slot.reels = s.reels;
    this.slot.stopAt = [now + 550, now + 1000, now + 1500];
    const tension = s.reels[0] === s.reels[1];
    if (tension) this.slot.stopAt[2] += 700; // Spannung: zwei gleiche → dritte Walze läuft länger
    this.slot.win = '';
    const win = s.jackpot ? `★ JACKPOT ★ ${fmt(s.win)} $` : s.win > 0 ? `${s.line}: +${fmt(s.win)} $` : '';
    const stop = this.slot.stopAt;
    for (let k = 0; k < 3; k++) setTimeout(() => { this.h.sound('venue.reel_stop'); if (k === 1 && tension) this.h.sound('venue.zap', 0.6); this.render(); }, stop[k] - now);
    setTimeout(() => {
      this.slot.spinning = false;
      this.slot.win = win;
      if (s.jackpot) this.h.sound('venue.jackpot');
      else if (s.win >= s.bet * 10) { this.h.sound('venue.coins'); this.h.sound('venue.win'); }
      else if (s.win > 0) this.h.sound('venue.win', 0.7);
      this.render();
      if (this.slot.auto && this.mode === 'slot') setTimeout(() => this.spin(), 700);
    }, stop[2] - now + 80);
  }
  bjState(view: BjTableView, me: number) {
    const prev = this.bj.view;
    this.bj.view = view; this.bj.me = me;
    const cards = (v: BjTableView | null) => (v ? v.dealer.length + v.seats.reduce((a, s) => a + s.hands.reduce((b, h) => b + h.cards.length, 0), 0) : 0);
    if (cards(view) > cards(prev)) this.h.sound('venue.card');
    if (me >= 0 && this.mode !== 'bj') this.open('bj', true);
    else if (this.mode === 'bj') this.render();
  }
  ruState(view: RouletteView) {
    this.ru.view = view;
    if (view.phase === 'spin' && view.spin !== this.ru.spinShown) { this.ru.spinShown = view.spin; this.h.sound('venue.ball'); }
    if (this.mode !== 'ru' && view.seats.some(([id]) => id === this.h.myId())) this.open('ru', true);
    else if (this.mode === 'ru') this.render();
  }
  derbyState(view: DerbyView, open: boolean) {
    this.derby.view = view;
    if (open && this.mode !== 'derby') this.open('derby', true);
    else if (this.mode === 'derby') this.render();
  }
  statsState(s: CasinoStats, board?: { song: string; diff: string; inst: [string, number][]; global: [string, number][] }[]) {
    this.stats = { s, board: board ?? this.stats.board };
    if (this.mode === 'cage' || this.mode === 'stats') this.render();
  }
  openCage() { this.open('cage', true); }
  openStats() { this.h.send({ a: 'stats' }); this.open('stats', false); }
  openDerby(cash: boolean) { this.derby.cash = cash; this.open('derby', true); }

  // ------------------------------------------------------------------ Darstellung
  render() {
    if (!this.isOpen) return;
    const chips = `<span class="chips">🪙 ${fmt(this.h.chips())}</span>`;
    const cash = `<span class="chips">$ ${fmt(this.h.money())}</span>`;
    switch (this.mode) {
      case 'dialog': {
        const d = this.dlg!;
        this.head.innerHTML = `<b>${esc(d.who)}</b><span class="sp"></span>`;
        this.body.innerHTML = d.lines.map((l) => `<div class="say">${esc(l)}</div>`).join('<br>');
        this.foot.innerHTML = d.options.map((o, i) => `<button data-opt="${esc(o.id)}" class="${i === 0 ? '' : 'dim'}">${esc(o.label)}</button>`).join('');
        break;
      }
      case 'cage': {
        const s = this.stats.s;
        this.head.innerHTML = `<b>Kasse „Cage“</b><span class="sp"></span>${cash}${chips}`;
        this.body.innerHTML = `<div class="muted">Bargeld ↔ Chips im Verhältnis 1:1. Nur Spielgeld – keine Echtgeld-Käufe, keine kaufbaren Chips, keine Umwandlung in echtes Geld.</div>
          <div class="row">Chips kaufen: ${[100, 500, 1000, 5000, 10000].map((n) => `<button data-buy="${n}">${fmt(n)}</button>`).join('')}</div>
          <div class="row">Auszahlen: ${[100, 1000, 5000].map((n) => `<button class="alt" data-sell="${n}">${fmt(n)}</button>`).join('')}<button class="alt" data-sell="all">Alles</button></div>
          ${s ? `<div class="row muted">Diese Stunde: ${s.hourNet >= 0 ? '+' : ''}${fmt(s.hourNet)} $ · Limits: −${fmt(s.hourLimitLoss)} / +${fmt(s.hourLimitWin)} $ pro Stunde${s.off ? ' · Casino für dein Konto deaktiviert' : ''}</div>` : ''}`;
        this.foot.innerHTML = '<button class="dim" data-act="stats">📊 Bilanz</button><span class="sp"></span><button class="pink" data-act="close">Aufhören</button>';
        break;
      }
      case 'stats': {
        const s = this.stats.s;
        this.head.innerHTML = '<b>📊 Casino-Bilanz & Bestenlisten</b><span class="sp"></span>';
        const boards = this.stats.board.map((b) => `<div class="item"><b>${esc(SONG_BY_ID[b.song]?.title ?? b.song)}</b> · ${DIFF_LABEL[b.diff as 'easy']}<br>
          <span class="muted">Instanz:</span> ${b.inst.map(([n, v]) => `${esc(n)} ${fmt(v)}`).join(', ') || '–'}<br><span class="muted">Global:</span> ${b.global.map(([n, v]) => `${esc(n)} ${fmt(v)}`).join(', ') || '–'}</div>`).join('');
        this.body.innerHTML = s ? `<div class="row"><b>Gewonnen:</b> ${fmt(s.won)} $ · <b>Verloren:</b> ${fmt(s.lost)} $ · <b>Bilanz:</b> <span style="color:${s.net >= 0 ? '#7dff6a' : '#ff6a6a'}">${s.net >= 0 ? '+' : ''}${fmt(s.net)} $</span></div>
          <div class="row muted">Drehungen ${fmt(s.spins)} · Blackjack-Hände ${fmt(s.hands)} · Roulette ${fmt(s.spinsRu)} · Derby-Wetten ${fmt(s.races)} · Jackpots ${s.jackpots}</div>
          <div class="tip">Hausvorteil: Automaten zahlen im Schnitt ~93 % zurück, Roulette 97,3 %, Derby 88 %. Auf lange Sicht gewinnt immer das Casino.</div>
          <div class="row">Chips: ${fmt(s.chips)} · Diese Stunde: ${s.hourNet >= 0 ? '+' : ''}${fmt(s.hourNet)} $</div>
          <div class="row"><button class="${s.off ? 'alt' : 'dim'}" data-act="toggleOff">${s.off ? '✔ Casino-Spiele deaktiviert – wieder aktivieren' : 'Casino-Spiele für mein Konto deaktivieren'}</button></div>
          <h4>Dance Floor Heat – Bestenlisten</h4><div class="list">${boards || '<span class="muted">Noch keine Einträge.</span>'}</div>` : 'Lade …';
        this.foot.innerHTML = '<span class="sp"></span><button class="pink" data-act="close">Schließen</button>';
        break;
      }
      case 'slot': this.renderSlot(chips); break;
      case 'bj': this.renderBj(chips); break;
      case 'ru': this.renderRu(chips); break;
      case 'derby': this.renderDerby(this.derby.cash ? cash : chips); break;
      case 'dance': case 'dj': this.extra?.render(); break;
    }
    this.highlightFocus();
  }

  /** Für DanceUi: Rahmen setzen. */
  frame(head: string, body: string, foot: string) { this.head.innerHTML = head; this.body.innerHTML = body; this.foot.innerHTML = foot; this.highlightFocus(); }
  get bodyEl() { return this.body; }

  private renderSlot(chips: string) {
    const s = this.slot, def = SLOTS[s.v];
    const now = performance.now();
    const reel = (k: number) => {
      const spinning = s.spinning && now < s.stopAt[k];
      const sym = spinning ? (['flamingo', 'palm', 'orange', 'gator', 'shades', 'seven', 'shell'] as SlotSymbol[])[Math.floor(Math.random() * 7)] : s.reels[k];
      return `<div class="v-reel ${spinning ? 'spin' : ''}" title="${SYMBOL_NAME[sym]}">${sym === 'seven' ? '<span style="color:#ff3fa4">7</span>' : SYMBOL_ICON[sym]}</div>`;
    };
    this.head.innerHTML = `<b>${esc(def.name)}</b><span class="muted">${esc(def.blurb)}</span><span class="sp"></span>${chips}`;
    this.body.innerHTML = `<div class="v-reels">${reel(0)}${reel(1)}${reel(2)}<div class="v-lever ${s.spinning ? 'pull' : ''}"><i></i></div></div>
      <div class="v-win">${esc(s.win)}</div>
      <div class="row" style="justify-content:center">Einsatz: ${C.slotBets.map((b) => `<button data-bet="${b}" class="${b === s.bet ? 'sel' : 'dim'}">${b} $</button>`).join('')}</div>
      ${s.pay ? `<div class="muted">${def.lines.map((l) => `${l.pattern.map((p) => (p === null ? '·' : p === 'any7' ? '7' : SYMBOL_ICON[p])).join(' ')} → ${l.pays === 'jackpot' ? `JACKPOT (ab ${def.jackpotMinBet} $, sonst ${def.shellFallback}x)` : `${l.pays}x`}`).join(' · ')}</div>` : ''}`;
    this.foot.innerHTML = `<button data-act="spin" ${s.spinning ? 'disabled' : ''}>🎰 Drehen (Leertaste)</button><button class="${s.auto ? 'alt' : 'dim'}" data-act="auto">Auto</button><button class="dim" data-act="pay">Gewinntabelle</button><span class="sp"></span><button class="pink" data-act="close">Aufhören</button>`;
    if (s.spinning) requestAnimationFrame(() => { if (this.mode === 'slot' && this.slot.spinning) this.renderSlot(chips); });
  }

  private spin() {
    const s = this.slot;
    if (s.spinning || s.m < 0) return;
    if (this.h.chips() < s.bet) { s.win = 'Nicht genug Chips – an der Kasse tauschen.'; s.auto = false; this.render(); return; }
    s.spinning = true; s.stopAt = [Infinity, Infinity, Infinity];
    this.h.sound('venue.reels');
    this.h.send({ a: 'slot', m: s.m, bet: s.bet });
    this.render();
    // Kein Ergebnis (Limit, Fehler): Walzen nach 2 s anhalten
    setTimeout(() => { if (this.slot.spinning && this.slot.stopAt[0] === Infinity) { this.slot.spinning = false; this.slot.auto = false; this.render(); } }, 2500);
  }

  private renderBj(chips: string) {
    const v = this.bj.view;
    if (!v) { this.frame('<b>Blackjack</b>', 'Warte auf den Tisch …', '<button class="pink" data-act="close">Aufhören</button>'); return; }
    const me = v.seats[this.bj.me];
    const dv = v.hole ? null : handValue(v.dealer.filter((c) => c >= 0));
    this.head.innerHTML = `<b>21 · ${v.limits[0]}–${fmt(v.limits[1])} $</b><span class="muted">${{ idle: 'Warte auf Spieler', bet: 'Bitte setzen', insurance: 'Versicherung?', play: 'Spiel läuft', dealer: 'Die Bank zieht', settle: 'Abrechnung' }[v.phase]} · Schlitten ${Math.round(v.shoe * 100)} %</span><span class="sp"></span>${chips}`;
    const seat = (s: typeof v.seats[number], i: number) => {
      if (!s.pid) return '';
      const hands = s.hands.map((h, k) => `<div class="v-cards">${h.cards.map(cardHtml).join('')}<span class="v-total">${handValue(h.cards).total}${h.result ? ' · ' + ({ blackjack: 'BLACKJACK', win: 'Gewonnen', push: 'Unentschieden', lose: 'Verloren', bust: 'Überkauft' } as Record<string, string>)[h.result] : ''}</span>${s.hands.length > 1 && k === s.active && v.turn === i ? ' ◀' : ''}</div><div class="muted">Einsatz ${fmt(h.bet)} $${h.doubled ? ' (verdoppelt)' : ''}</div>`).join('');
      return `<div class="v-seat ${i === this.bj.me ? 'me' : ''} ${v.turn === i ? 'turn' : ''}"><b>${esc(s.name || 'Gast')}</b>${s.pid < 0 ? ' <span class="muted">(NPC)</span>' : ''}${hands || (s.bet ? `<div class="muted">setzt ${fmt(s.bet)} $</div>` : '')}</div>`;
    };
    let tip = '';
    const myTurn = v.phase === 'play' && v.turn === this.bj.me && me;
    if (myTurn && this.h.tips()) {
      const h = me.hands[me.active];
      if (h) tip = `<div class="tip">Grundstrategie empfiehlt: ${BJ_ACTION_LABEL[basicStrategy(h.cards, cardPoints(v.dealer[0]), h.cards.length === 2, me.hands.length === 1)]}</div>`;
    }
    this.body.innerHTML = `<div class="row"><b>Croupière Margot</b> <div class="v-cards">${v.dealer.map(cardHtml).join('')}${dv ? `<span class="v-total">${dv.total}</span>` : ''}</div>${v.say ? `<span class="say">${esc(v.say)}</span>` : ''}</div>
      <div class="v-timer" style="width:${v.phase === 'play' || v.phase === 'bet' ? Math.min(100, (v.t / (v.phase === 'bet' ? C.bjBetSeconds : C.bjTurnSeconds)) * 100) : 0}%"></div>
      <div class="row">${v.seats.map(seat).join('')}</div>${tip}`;
    const h = me?.hands[me.active];
    let foot = '';
    if (v.phase === 'bet' && me) foot = `${[10, 25, 100, 500, ...(v.limits[1] > 500 ? [2000, 5000] : [])].filter((n) => n >= v.limits[0] && n <= v.limits[1]).map((n) => `<button class="${this.bj.amount === n ? 'sel' : 'dim'}" data-bjamt="${n}">${fmt(n)}</button>`).join('')}<button data-bj="bet">Setzen (${fmt(this.bj.amount)} $)</button>`;
    else if (v.phase === 'insurance' && me && me.insurance === 0) foot = `<button data-bj="insure">Versichern (${fmt(Math.floor((me.hands[0]?.bet ?? 0) / 2))} $)</button><button class="dim" data-bj="noinsure">Keine Versicherung</button>`;
    else if (myTurn && h) {
      const two = h.cards.length === 2;
      foot = `<button data-bj="hit">Karte</button><button class="alt" data-bj="stand">Stehen</button><button data-bj="double" ${two ? '' : 'disabled'}>Verdoppeln</button><button data-bj="split" ${two && me.hands.length === 1 && cardPoints(h.cards[0]) === cardPoints(h.cards[1]) ? '' : 'disabled'}>Teilen</button>`;
    } else foot = `<span class="muted">${v.phase === 'settle' ? 'Nächste Runde gleich …' : 'Warte …'}</span>`;
    this.foot.innerHTML = `${foot}<span class="sp"></span><button class="pink" data-act="close">Aufhören</button>`;
  }

  private renderRu(chips: string) {
    const v = this.ru.view;
    if (!v) { this.frame('<b>Ruleta Royale</b>', 'Warte …', '<button class="pink" data-act="close">Aufhören</button>'); return; }
    const myBets = new Map<string, number>();
    for (const [pid, , label, amt] of v.bets) if (pid === this.h.myId()) myBets.set(label, (myBets.get(label) ?? 0) + amt);
    const cell = (n: number) => { const c = colorOf(n); const lab = `Zahl ${n}`; const a = myBets.get(lab); return `<div class="${c === 'red' ? 'r' : c === 'black' ? 'k' : 'z'} ${v.phase !== 'bet' && v.result === n ? 'hit' : ''} ${a ? 'chip' : ''}" data-c="${a ?? ''}" data-ru="straight:${n}">${n}</div>`; };
    let grid = cell(0);
    for (let row = 3; row >= 1; row--) { for (let col = 0; col < 12; col++) grid += cell(col * 3 + row); const lab = `${row}. Kolonne`; grid += `<div class="${myBets.get(lab) ? 'chip' : ''}" data-c="${myBets.get(lab) ?? ''}" data-ru="column:${row}">2:1</div>`; }
    const out: [RouletteBetType, number | undefined, string][] = [['dozen', 1, '1. Dutzend'], ['dozen', 2, '2. Dutzend'], ['dozen', 3, '3. Dutzend'], ['low', undefined, '1–18'], ['even', undefined, 'Gerade'], ['red', undefined, 'Rot'], ['black', undefined, 'Schwarz'], ['odd', undefined, 'Ungerade'], ['high', undefined, '19–36']];
    const lbl: Record<string, string> = { low: '1–18', even: 'Gerade', red: 'Rot', black: 'Schwarz', odd: 'Ungerade', high: '19–36' };
    const outs = out.map(([t, n, l]) => { const key = t === 'dozen' ? `${n}. Dutzend` : lbl[t]; const a = myBets.get(key); return `<div class="${a ? 'chip' : ''}" data-c="${a ?? ''}" data-ru="${t}:${n ?? ''}" style="${t === 'red' ? 'background:#c0202a' : t === 'black' ? 'background:#16161c' : ''}">${l}</div>`; }).join('');
    const spinning = v.phase === 'spin';
    const shown = spinning ? Math.floor(Math.random() * 37) : v.result;
    const col = shown >= 0 ? colorOf(shown) : 'green';
    this.head.innerHTML = `<b>Ruleta Royale</b><span class="muted">${v.phase === 'bet' ? `Bitte setzen · ${Math.ceil(v.t)} s` : spinning ? 'Nichts geht mehr – die Kugel rollt …' : 'Ergebnis'}</span><span class="sp"></span>${chips}`;
    this.body.innerHTML = `<div class="row"><span class="v-ball" style="background:${col === 'red' ? '#c0202a' : col === 'black' ? '#16161c' : '#1aa050'}">${shown >= 0 ? shown : '–'}</span>
      <span class="muted">Letzte: ${v.history.map((n) => `<b style="color:${colorOf(n) === 'red' ? '#ff6a6a' : colorOf(n) === 'green' ? '#7dff6a' : '#ddd'}">${n}</b>`).join(' ')}</span>${v.say ? `<span class="say">${esc(v.say)}</span>` : ''}</div>
      <div class="v-tab">${grid}</div><div class="v-out">${outs}</div>
      <div class="muted">Auszahlung: Zahl ${ROULETTE_PAYS.straight}:1 · Dutzend/Kolonne 2:1 · Einfache Chancen 1:1 · Bei 0 verlieren alle einfachen Chancen.</div>`;
    this.foot.innerHTML = `Chip: ${[5, 10, 25, 100, 500].map((n) => `<button class="${this.ru.chip === n ? 'sel' : 'dim'}" data-ruchip="${n}">${n}</button>`).join('')}<button class="alt" data-act="ruclear" ${v.phase === 'bet' ? '' : 'disabled'}>Einsätze zurück</button><span class="sp"></span><button class="pink" data-act="close">Aufhören</button>`;
    if (spinning) setTimeout(() => { if (this.mode === 'ru' && this.ru.view?.phase === 'spin') this.renderRu(chips); }, 90);
  }

  private renderDerby(wallet: string) {
    const v = this.derby.view;
    if (!v) { this.frame('<b>Gator Derby</b>', 'Lade …', '<button class="pink" data-act="close">Schließen</button>'); return; }
    this.head.innerHTML = `<b>🐊 Gator Derby · Rennen ${v.race}</b><span class="muted">${v.phase === 'bet' ? `Start in ${Math.floor(v.t / 60)}:${String(v.t % 60).padStart(2, '0')}` : v.phase === 'run' ? 'Rennen läuft!' : 'Zieleinlauf'}</span><span class="sp"></span>${wallet}`;
    const form = (f: number) => ['▼▼', '▼', '–', '▲', '▲▲'][f + 2];
    this.body.innerHTML = `${v.say ? `<div class="say">🎙️ ${esc(v.say)}</div>` : ''}
      <div class="v-gators">${GATORS.map((g, i) => `<div class="v-gator ${this.derby.pick === i ? 'sel' : ''}" data-gator="${i}"><b style="color:#${g.color.toString(16).padStart(6, '0')}">${esc(g.name)}</b> <span class="chips">${v.odds[i].toFixed(1)}</span><br><span class="muted">Form ${form(v.form[i])} · ${esc(g.trait)}</span></div>`).join('')}</div>
      ${v.mine.length ? `<div class="row">Deine Wetten: ${v.mine.map(([g, a]) => `${esc(GATORS[g].name)} ${fmt(a)} $`).join(', ')}</div>` : ''}
      <div class="row muted">Letzte Sieger: ${v.history.map((g) => esc(GATORS[g].name)).join(', ') || '–'} · Quote = Auszahlung inkl. Einsatz${this.derby.cash ? ' · Terminal: Wetten mit Bargeld' : ''}</div>`;
    this.foot.innerHTML = v.phase === 'bet'
      ? `${[10, 50, 100, 500, 2000].map((n) => `<button class="${this.derby.amount === n ? 'sel' : 'dim'}" data-derbyamt="${n}">${fmt(n)}</button>`).join('')}<button data-act="derbybet">Wetten auf ${esc(GATORS[this.derby.pick].name)}</button><span class="sp"></span><button class="pink" data-act="close">Schließen</button>`
      : '<span class="sp"></span><button class="pink" data-act="close">Schließen</button>';
  }

  // ------------------------------------------------------------------ Eingaben
  private onClick(e: MouseEvent) {
    if ((this.mode === 'dance' || this.mode === 'dj') && this.extra) {
      const d = (e.target as HTMLElement).closest('[data-song],[data-diff],[data-mode],[data-dance]') as HTMLElement | null;
      if (d && this.extra.onClick(d)) return;
    }
    const t = (e.target as HTMLElement).closest('[data-act],[data-opt],[data-bet],[data-buy],[data-sell],[data-bj],[data-bjamt],[data-ru],[data-ruchip],[data-gator],[data-derbyamt]') as HTMLElement | null;
    if (!t) return;
    this.activate(t);
  }

  private activate(t: HTMLElement) {
    const d = t.dataset;
    this.h.sound('venue.chips', 0.4);
    if (d.opt) { const id = this.dlg?.id ?? ''; this.h.send({ a: 'opt', dlg: id, id: d.opt }); this.mode = 'none'; this.dlg = null; this.el.classList.remove('open'); this.h.onOpen(false); return; }
    if (d.bet) { this.slot.bet = Number(d.bet); this.render(); return; }
    if (d.buy) { this.h.send({ a: 'chips', amount: Number(d.buy) }); return; }
    if (d.sell) { const n = d.sell === 'all' ? this.h.chips() : Number(d.sell); if (n > 0) this.h.send({ a: 'chips', amount: -Math.min(n, this.h.chips()) }); return; }
    if (d.bjamt) { this.bj.amount = Number(d.bjamt); this.render(); return; }
    if (d.bj && this.bj.view) { this.h.send({ a: 'bj', table: this.bj.view.id, op: d.bj as 'hit', amount: this.bj.amount }); return; }
    if (d.ruchip) { this.ru.chip = Number(d.ruchip); this.render(); return; }
    if (d.ru && this.ru.view) {
      const [type, n] = d.ru.split(':');
      this.h.send({ a: 'ru', table: this.ru.view.id, op: 'bet', type: type as RouletteBetType, n: n === '' ? undefined : Number(n), amount: this.ru.chip });
      void betKey;
      return;
    }
    if (d.gator) { this.derby.pick = Number(d.gator); this.render(); return; }
    if (d.derbyamt) { this.derby.amount = Number(d.derbyamt); this.render(); return; }
    switch (d.act) {
      case 'close': this.close(); break;
      case 'spin': this.spin(); break;
      case 'auto': this.slot.auto = !this.slot.auto; if (this.slot.auto) this.spin(); else this.render(); break;
      case 'pay': this.slot.pay = !this.slot.pay; this.render(); break;
      case 'stats': this.openStats(); break;
      case 'toggleOff': if (this.stats.s) { this.h.send({ a: 'casinoOff', on: !this.stats.s.off }); setTimeout(() => this.h.send({ a: 'stats' }), 150); } break;
      case 'ruclear': if (this.ru.view) this.h.send({ a: 'ru', table: this.ru.view.id, op: 'clear' }); break;
      case 'derbybet': this.h.send({ a: 'derby', gator: this.derby.pick, amount: this.derby.amount }); break;
      default: break;
    }
  }

  private buttons(): HTMLElement[] { return [...this.el.querySelectorAll<HTMLElement>('button:not([disabled]),[data-ru],[data-gator],[data-song]')]; }
  private highlightFocus() {
    const b = this.buttons();
    b.forEach((x) => x.classList.remove('pad-focus'));
    if (this.padMode && b.length) b[Math.min(this.focus, b.length - 1)].classList.add('pad-focus');
  }
  private padMode = false;

  private onKey(e: KeyboardEvent) {
    if (!this.isOpen) return;
    if ((this.mode === 'dance' || this.mode === 'dj') && this.extra?.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
    const k = e.code;
    if (k === 'Escape') { this.close(); e.preventDefault(); e.stopPropagation(); return; }
    if (this.mode === 'slot' && (k === 'Space' || k === 'Enter')) { this.spin(); e.preventDefault(); e.stopPropagation(); return; }
    if (this.mode === 'bj' && this.bj.view) {
      const map: Record<string, string> = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' };
      if (map[k]) { this.h.send({ a: 'bj', table: this.bj.view.id, op: map[k] as 'hit' }); e.preventDefault(); e.stopPropagation(); return; }
      if (k === 'Space' && this.bj.view.phase === 'bet') { this.h.send({ a: 'bj', table: this.bj.view.id, op: 'bet', amount: this.bj.amount }); e.preventDefault(); e.stopPropagation(); return; }
    }
    if (this.mode === 'dialog' && /^Digit[1-9]$/.test(k)) { const b = this.foot.querySelectorAll<HTMLElement>('[data-opt]')[Number(k.slice(5)) - 1]; if (b) this.activate(b); e.preventDefault(); e.stopPropagation(); return; }
    // Bewegungstasten nicht ans Spiel durchreichen, solange das Overlay offen ist
    if (/^(Arrow|Key[WASDEF]|Space)/.test(k)) { e.preventDefault(); e.stopPropagation(); }
  }

  /** Gamepad im Overlay: Steuerkreuz wählt, A bestätigt, B schließt. Rückgabe true = verbraucht. */
  pad(f: PadFrame): boolean {
    if (!this.isOpen) return false;
    this.padMode = true;
    if ((this.mode === 'dance' || this.mode === 'dj') && this.extra?.pad(f)) return true;
    if (f.pressed(P.B)) { this.close(); f.swallow(); return true; }
    if (this.mode === 'slot' && (f.pressed(P.A) || f.pressed(P.RT))) { this.spin(); return true; }
    const nav = f.nav();
    const b = this.buttons();
    if (nav && b.length) { this.focus = (this.focus + (nav === 'right' || nav === 'down' ? 1 : -1) + b.length) % b.length; this.highlightFocus(); }
    if (f.pressed(P.A) && b.length) {
      const el = b[Math.min(this.focus, b.length - 1)];
      if (!((this.mode === 'dance' || this.mode === 'dj') && this.extra?.onClick(el))) this.activate(el);
      f.swallow();
    }
    return true;
  }
}
