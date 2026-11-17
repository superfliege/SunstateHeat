// Casino-Kasse: Chips (nur Spielgeld, 1:1), gleitende Stundenlimits für Verlust und Gewinn, Bilanz und
// Transaktionsprotokoll. Chips sind nicht zwischen Spielern übertragbar (es gibt schlicht keinen Weg dafür).
import { randomInt } from 'node:crypto';
import { BALANCE } from '../../../shared/src/balance';
import type { CasinoStats } from '../../../shared/src/venues/net';
import type { ServerPlayer } from '../entities/types';
import { logTransaction } from '../services/Ledger';
import type { VenueProfile } from '../services/PlayerStore';

const HOUR = 3_600_000;
const C = BALANCE.casino;

/** Sicherer Zufall 0 … n-1 (crypto). Alle Casino-Ergebnisse laufen hierüber. */
export const secureRnd = (n: number) => (n <= 1 ? 0 : randomInt(n));

/** Venue-Teil des Profils (bei alten Spielständen anlegen / ergänzen). */
export function vprof(p: ServerPlayer): VenueProfile {
  const pr = p.profile;
  const v = (pr.venue ??= {} as VenueProfile);
  v.chips = Number.isFinite(v.chips) ? Math.max(0, Math.floor(v.chips)) : 0;
  v.casinoOff = !!v.casinoOff;
  for (const k of ['won', 'lost', 'spins', 'hands', 'spinsRu', 'races', 'jackpots'] as const) v[k] = Number.isFinite(v[k]) ? v[k] : 0;
  if (!Array.isArray(v.hour)) v.hour = [];
  v.vip = !!v.vip;
  v.danceDay = Number.isFinite(v.danceDay) ? v.danceDay : -1;
  if (!Array.isArray(v.styles) || !v.styles.length) v.styles = ['wippen'];
  v.best ??= {};
  v.outfit ??= null;
  v.jacket = Number.isFinite(v.jacket) ? v.jacket : 0;
  v.valet ??= null;
  return v;
}

/** Netto der letzten Stunde (alte Einträge werden entfernt). */
export function hourNet(v: VenueProfile, now = Date.now()): number {
  while (v.hour.length && now - v.hour[0][0] > HOUR) v.hour.shift();
  let s = 0;
  for (const [, n] of v.hour) s += n;
  return s;
}

/** Darf der Spieler `bet` Chips setzen? '' = ja, sonst Grund. */
export function betBlocked(p: ServerPlayer, bet: number, now = Date.now()): string {
  const v = vprof(p);
  const lim = limitBlocked(p, bet, now);
  if (lim) return lim;
  if (v.chips < bet) return 'Nicht genug Chips – an der Kasse („Cage“) tauschen.';
  return '';
}

/** Nur Sperre und Stundenlimits prüfen (Wetten mit Bargeld an Terminals). */
export function limitBlocked(p: ServerPlayer, bet: number, now = Date.now()): string {
  const v = vprof(p);
  if (v.casinoOff) return 'Glücksspiel ist für dein Konto deaktiviert (Einstellungen).';
  if (!Number.isInteger(bet) || bet <= 0) return 'Ungültiger Einsatz.';
  const net = hourNet(v, now);
  if (net - bet < -C.maxLossPerHour) return `Verlustlimit erreicht (${C.maxLossPerHour.toLocaleString('de-DE')} $ pro Stunde). Gönn dir eine Pause – das Casino gewinnt sowieso.`;
  if (net >= C.maxWinPerHour) return `Gewinnlimit erreicht (${C.maxWinPerHour.toLocaleString('de-DE')} $ pro Stunde). Das Haus bittet um eine Pause. Und um Gnade.`;
  return '';
}

/** Einsatz abbuchen (vorher betBlocked prüfen). */
export function takeChips(p: ServerPlayer, amount: number, reason: string): boolean {
  const v = vprof(p);
  if (amount <= 0 || v.chips < amount) return false;
  v.chips -= amount;
  logTransaction(p.profile.key, p.name, -amount, `chips:${reason}`);
  return true;
}

/**
 * Runde abrechnen: stake = gesamter Einsatz dieser Runde (schon abgebucht), payout = Auszahlung inkl. Einsatz.
 * Bucht Chips gut, führt Bilanz und Stundenfenster.
 */
export function settleRound(p: ServerPlayer, stake: number, payout: number, game: 'slot' | 'bj' | 'ru' | 'derby', now = Date.now()) {
  const v = vprof(p);
  if (payout > 0) { v.chips += payout; logTransaction(p.profile.key, p.name, payout, `chips:${game}:auszahlung`); }
  const net = payout - stake;
  if (net > 0) v.won += net; else v.lost += -net;
  v.hour.push([now, net]);
  if (game === 'slot') v.spins++;
  else if (game === 'bj') v.hands++;
  else if (game === 'ru') v.spinsRu++;
  else v.races++;
}

/** Bargeld → Chips (amount > 0) bzw. Chips → Bargeld (amount < 0). Rückgabe: Fehlertext oder ''. */
export function exchange(p: ServerPlayer, amount: number, addMoney: (p: ServerPlayer, a: number, r: string) => void): string {
  const v = vprof(p);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1_000_000) return 'Ungültiger Betrag.';
  if (amount > 0) {
    if (v.casinoOff) return 'Casino-Spiele sind für dein Konto deaktiviert – nur Auszahlen ist möglich.';
    if (p.profile.money < amount) return 'Nicht genug Bargeld.';
    addMoney(p, -amount, 'casino:chips_kauf');
    v.chips += amount;
    logTransaction(p.profile.key, p.name, amount, 'chips:kauf');
  } else {
    const n = -amount;
    if (v.chips < n) return 'So viele Chips hast du nicht.';
    v.chips -= n;
    logTransaction(p.profile.key, p.name, -n, 'chips:auszahlung_cage');
    addMoney(p, n, 'casino:chips_auszahlung');
  }
  return '';
}

export function casinoStats(p: ServerPlayer): CasinoStats {
  const v = vprof(p);
  return {
    won: v.won, lost: v.lost, net: v.won - v.lost, spins: v.spins, hands: v.hands, spinsRu: v.spinsRu, races: v.races, jackpots: v.jackpots,
    hourNet: hourNet(v), hourLimitLoss: C.maxLossPerHour, hourLimitWin: C.maxWinPerHour, chips: v.chips, off: v.casinoOff,
  };
}
