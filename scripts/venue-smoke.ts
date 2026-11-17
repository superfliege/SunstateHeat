// Rauchtest Club & Casino ohne Browser: echter WorldRoom mit simulierten Spielern.
// Prüft Tür/Dresscode/Eintritt, Innenraum-Bewegung, Dance Floor Heat (Plausibilisierung, Belohnung),
// Automaten (RTP-Stichprobe, Jackpot), Blackjack, Roulette, Gator Derby, Limits, Chips 1:1,
// Polizei drinnen + Abriegelung, Ereignisse E57–E64 und die drei Quests.  Aufruf: npm run venue-test
import { MAP_SEED, SIM_DT } from '../shared/src/constants';
import { BALANCE } from '../shared/src/balance';
import type { ServerMsg } from '../shared/src/protocol';
import { BEATMAPS, maxScore, noteTime } from '../shared/src/content/dance';
import { evaluateSlot, slotPayout, slotRtp, spinReels } from '../shared/src/content/casino/slots';
import { interiorFrame, INTERIORS, spotById, tileCenter, toLocal, toWorld } from '../shared/src/venues/interiors';
import { generateWorld } from '../shared/src/world/mapgen';
import { newPawn } from '../shared/src/sim/movement';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { ServerPlayer } from '../server/src/entities/types';
import { vprof } from '../server/src/venues/Bank';
import { QUEST_BY_ID } from '../shared/src/questData';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
// Virtuelle Uhr: der Server rechnet Sessions/Tische mit Date.now() – die Simulation läuft schneller als Echtzeit
let fakeNow = Date.now();
Date.now = () => fakeNow;
const map = generateWorld(MAP_SEED);
const room = new WorldRoom('venue-test', map);
const R = room as unknown as { tick(d: number): void; dispose(): void; quests: { view(p: unknown): { title: string; stage: string; prog: string } | null; start(p: ServerPlayer, def: unknown, lvl: number): boolean } };
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++; };
const mk = (name: string, money = 100_000) => {
  const msgs: ServerMsg[] = [];
  const conn = { send: (m: ServerMsg) => msgs.push(m), close: () => {}, sendRaw: () => {} };
  const fresh = { key: 'guest:' + name, name, money, bank: 0, xp: 50_000, health: 100, armor: 0, reputation: {}, inventory: {}, questsDone: [], questCooldowns: {}, weapons: {}, pos: null, playtimeSeconds: 0, createdAt: 0, lastLogin: 0 };
  const p = room.addPlayer(conn as never, name, fresh as never);
  room.handleMessage(p, { t: 'introDone' });
  return { p, msgs };
};
const run = (s: number) => { for (let i = 0; i < s * 20; i++) { fakeNow += 50; R.tick(1 / 20); } };
const last = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => [...msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
const V = (p: ServerPlayer, v: object) => room.handleMessage(p, { t: 'venue', v } as never);
const chat = (p: ServerPlayer, t: string) => { p.lastChatAt = 0; room.handleMessage(p, { t: 'chat', text: t }); };
const club = interiorFrame(map, 'club')!, casino = interiorFrame(map, 'casino')!;
// Zufällige Ereignisse aus (der Test startet sie gezielt mit /event)
for (const st of (room.venues as unknown as { v: Map<string, { director: { nextT: number } }> }).v.values()) st.director.nextT = 1e9;
const atDoor = (p: ServerPlayer, f: typeof club) => { p.pawn = newPawn(f.door.x + Math.sin(f.door.a) * 2, f.door.z + Math.cos(f.door.a) * 2, 0); };
const goLocal = (p: ServerPlayer, f: typeof club, x: number, z: number) => { const w = toWorld(f, x, z); p.pawn.x = w.x; p.pawn.z = w.z; };

check(!!club && !!casino, 'Club und Casino stehen in der Welt (Wahrzeichen)');
check(slotRtp('classic').rtp > 0.88 && slotRtp('classic').rtp < 0.95 && slotRtp('goldrush').rtp > 0.88 && slotRtp('goldrush').rtp < 0.95, `Automaten-RTP Grundspiel ${(slotRtp('classic').rtp * 100).toFixed(1)} % / ${(slotRtp('goldrush').rtp * 100).toFixed(1)} % (+${BALANCE.casino.jackpotShare * 100} % Jackpot-Topf)`);
check(slotRtp('classic').hitRate > slotRtp('goldrush').hitRate * 3, 'Varianten unterscheiden sich in der Volatilität (Trefferquote)');
{
  // Ziehung + Auszahlung (ohne Jackpot-Topf) gegen die exakte RTP prüfen: 300.000 Drehungen
  let ret = 0; const n = 300_000; const r = (k: number) => Math.floor(Math.random() * k);
  for (let i = 0; i < n; i++) ret += slotPayout('classic', spinReels('classic', r), 1).win || (evaluateSlot('classic', spinReels('classic', () => 0))?.pays === 'jackpot' ? 0 : 0);
  check(Math.abs(ret / n - slotRtp('classic').rtp) < 0.03, `Ziehung entspricht der Gewinntabelle (Stichprobe ${(ret / n * 100).toFixed(1)} %)`);
}

// ---------------------------------------------------------------- Club: Tür
const A = mk('Tanzbär');
chat(A.p, '/club offen');
atDoor(A.p, club);
V(A.p, { a: 'enter', which: 'club' });
check(last(A.msgs, 'vdlg')?.d.lines.includes('Nicht mit den Schuhen.') === true, 'Türsteher: „Nicht mit den Schuhen.“ (Strandklamotten)');
const money0 = A.p.profile.money;
V(A.p, { a: 'opt', dlg: 'teo', id: 'pay' });
check(A.p.interior?.id === 'club' && A.p.profile.money === money0 - BALANCE.club.entryFee, `Eintritt ${BALANCE.club.entryFee} $ bezahlt → im Club`);
check(last(A.msgs, 'venue')?.in === 'club', 'Client bekommt Innenraum-Zustand (Blende + Tür)');
run(0.6);
check(A.msgs.some((m) => m.t === 'vnpc' && (m.n?.length ?? 0) >= 40), 'Menge im Club synchronisiert (≥ 40 NPCs)');
// Bewegung drinnen: gegen die Bartheke laufen
goLocal(A.p, club, -10, 0);
const before = toLocal(club, A.p.pawn.x, A.p.pawn.z);
room.handleMessage(A.p, { t: 'input', cmds: Array.from({ length: 30 }, (_, i) => [A.p.lastSeq + 1 + i, -1, 0, 0]) as never });
const after = toLocal(club, A.p.pawn.x, A.p.pawn.z);
check(after.x < before.x && after.x > -12.4, `Innenwände blockieren (Bartheke): x ${before.x.toFixed(1)} → ${after.x.toFixed(1)}`);
// VIP-Gate ohne Armband
goLocal(A.p, club, 10.3, 1.0);
room.handleMessage(A.p, { t: 'input', cmds: Array.from({ length: 40 }, (_, i) => [A.p.lastSeq + 1 + i, 0, 1, 0]) as never });
check(toLocal(club, A.p.pawn.x, A.p.pawn.z).z > -2, 'VIP-Treppe gesperrt ohne Ruf/VIP-Karte');

// ---------------------------------------------------------------- Tanzen
const [tx, tz] = tileCenter(13);
goLocal(A.p, club, tx, tz);
V(A.p, { a: 'dance', op: 'setup', song: 'neon_nights', diff: 'medium', mode: 'solo' });
const bm = BEATMAPS.neon_nights;
const notes = bm.medium;
check(A.p.interior?.seat === 'tile13', 'Solo-Session auf Kachel gestartet');
// Unplausibel: Treffer für Noten weit in der Zukunft
run(3.2);
V(A.p, { a: 'dance', op: 'hits', h: notes.slice(0, 40).map((_, i) => [i, 0, 0]) });
const sessView = () => [...A.msgs].reverse().find((m) => m.t === 'vgame' && m.s.g === 'dance' && m.s.s) as Extract<ServerMsg, { t: 'vgame' }> | undefined;
run(0.3);
const early = (sessView()?.s as { s: { dancers: { score: number }[] } }).s.dancers[0].score;
check(early === 0, 'Vorgespulte Treffer (Noten in der Zukunft) werden verworfen');
// Song „spielen“: jede Note zum richtigen Zeitpunkt perfekt melden
const songLen = noteTime(bm, notes[notes.length - 1][0]) + 2;
let sent = 0;
for (let t = 0; t < songLen; t += 0.25) {
  run(0.25);
  const songNow = (Date.now() - ((sessView()?.s as { s: { t0: number } }).s.t0)) / 1000;
  const batch: [number, number, number][] = [];
  while (sent < notes.length && noteTime(bm, notes[sent][0]) <= songNow) { batch.push([sent, 0, notes[sent][2] === 1 ? notes[sent][3] : 0]); sent++; }
  if (batch.length) V(A.p, { a: 'dance', op: 'hits', h: batch });
}
run(4);
const notes2 = A.msgs.filter((m) => m.t === 'notice' && m.text.startsWith('Dance Floor Heat')).map((m) => (m as { text: string }).text);
check(notes2.some((t) => t.includes('Rang S')), `Song komplett perfekt → Rang S (${notes2[0]?.slice(0, 80) ?? 'keine Meldung'})`);
check((A.p.profile.reputation.neon ?? 0) >= 1, 'Neon-Syndicate-Ruf +1 … +3 fürs Tanzen');
check(vprof(A.p).styles.includes('roboter'), 'Tanzstil freigeschaltet (Roboter)');
check(A.msgs.some((m) => m.t === 'vfx' && m.k === 'spotlight'), 'Hype-Meter voll → Spotlight');
const max = maxScore(bm, 'medium', BALANCE.club.spotlightSeconds, BALANCE.club.spotlightMult);
check((vprof(A.p).best['neon_nights:medium'] ?? 0) <= max, `Punkte nie über dem Maximum (${vprof(A.p).best['neon_nights:medium']} ≤ ${max})`);
chat(A.p, '/tanz roboter');
check(A.p.act === 31, 'Emote „/tanz roboter“ nutzbar (freigeschaltet)');

// ---------------------------------------------------------------- Ereignisse im Club
chat(A.p, '/event E57');
run(8);
const djSpot = spotById(INTERIORS.club, 'dj')!;
goLocal(A.p, club, djSpot.x, djSpot.z);
V(A.p, { a: 'use', spot: 'dj' });
check(A.msgs.some((m) => m.t === 'vgame' && m.s.g === 'dj' && m.s.on), 'E57 DJ fällt aus: DJ-Pult übernehmen');
run(20);
V(A.p, { a: 'dj', ok: 40, miss: 3, done: true });
run(1);
check(!!A.p.profile.inventory.free_drink, 'E57: Menge feiert, Freigetränk von Vee');
chat(A.p, '/event E60');
run(16);
check(!A.p.interior && A.msgs.some((m) => m.t === 'venue' && m.door === 'evac'), 'E60 Feueralarm: alle raus auf die Straße');
atDoor(A.p, club);
V(A.p, { a: 'enter', which: 'club' });
check(!A.p.interior, 'Während des Alarms kein Einlass');

// ---------------------------------------------------------------- Casino
const B = mk('Zocker');
atDoor(B.p, casino);
V(B.p, { a: 'enter', which: 'casino' });
check(last(B.msgs, 'vdlg')?.d.id === 'doorman', 'Casino: in Badehose nur mit Leih-Sakko');
V(B.p, { a: 'opt', dlg: 'doorman', id: 'pay' });
check(B.p.interior?.id === 'casino', 'Leih-Sakko → im Casino');
const cage = spotById(INTERIORS.casino, 'cage')!;
goLocal(B.p, casino, cage.x, cage.z);
const cash0 = B.p.profile.money;
V(B.p, { a: 'chips', amount: 20_000 });
check(vprof(B.p).chips === 20_000 && B.p.profile.money === cash0 - 20_000, 'Kasse: Bargeld → Chips 1:1');
// Automaten: viele Drehungen (Stichprobe)
const slot = INTERIORS.casino.spots.find((s) => s.kind === 'slot' && s.v === 'classic')!;
goLocal(B.p, casino, slot.x, slot.z);
V(B.p, { a: 'use', spot: slot.id });
check(B.p.interior?.seat === slot.id, 'Am Automaten Platz genommen');
const pool0 = room.venues.casino.jackpotPool;
let stake = 0;
const chips0 = vprof(B.p).chips;
const N = 3000;
for (let i = 0; i < N; i++) {
  const occ = (room.venues.casino as unknown as { machines: Map<number, { last: number }> }).machines.get(slot.n!)!;
  occ.last = 0;
  V(B.p, { a: 'slot', m: slot.n, bet: 10 });
  stake += 10;
}
const ret = (vprof(B.p).chips - chips0 + stake) / stake;
check(ret > 0.6 && ret < 1.3, `Server: ${N} Drehungen, Rückfluss ${(ret * 100).toFixed(1)} % (Erwartung ~${(slotRtp('classic').rtp * 100).toFixed(0)} %)`);
check(room.venues.casino.jackpotPool > pool0, `Progressiver Jackpot wächst mit Einsätzen (${pool0} → ${Math.floor(room.venues.casino.jackpotPool)} $)`);
check(vprof(B.p).spins >= N, 'Bilanz zählt Drehungen');
V(B.p, { a: 'leave' });
// Blackjack
const bjSeat = spotById(INTERIORS.casino, 'bj1:2')!;
goLocal(B.p, casino, bjSeat.x, bjSeat.z);
V(B.p, { a: 'use', spot: 'bj1:2' });
V(B.p, { a: 'bj', table: 'bj1', op: 'bet', amount: 100 });
run(2);
let bjView = () => [...B.msgs].reverse().find((m) => m.t === 'vgame' && m.s.g === 'bj') as Extract<ServerMsg, { t: 'vgame' }> & { s: { g: 'bj'; view: { phase: string; turn: number; seats: { pid: number; hands: { cards: number[] }[] }[] } } };
let guard = 0;
while (guard++ < 200) {
  const v = bjView()?.s.view;
  if (!v) break;
  if (v.phase === 'insurance') V(B.p, { a: 'bj', table: 'bj1', op: 'noinsure' });
  if (v.phase === 'play' && v.seats[v.turn]?.pid === B.p.id) V(B.p, { a: 'bj', table: 'bj1', op: 'stand' });
  if (v.phase === 'settle') break;
  run(0.5);
}
check(vprof(B.p).hands >= 1, 'Blackjack: Runde gespielt und abgerechnet');
V(B.p, { a: 'leave' });
// Roulette
const ruSeat = spotById(INTERIORS.casino, 'ru1:0')!;
goLocal(B.p, casino, ruSeat.x, ruSeat.z);
V(B.p, { a: 'use', spot: 'ru1:0' });
const ruChips = vprof(B.p).chips;
V(B.p, { a: 'ru', table: 'ru1', op: 'bet', type: 'red', amount: 100 });
V(B.p, { a: 'ru', table: 'ru1', op: 'bet', type: 'straight', n: 17, amount: 10 });
check(vprof(B.p).chips === ruChips - 110, 'Roulette: Einsätze abgebucht');
run(BALANCE.casino.rouletteBetSeconds + 9);
check(vprof(B.p).spinsRu >= 1, 'Roulette: Kugel gefallen, abgerechnet');
V(B.p, { a: 'leave' });
// Derby
const derby = spotById(INTERIORS.casino, 'derby')!;
goLocal(B.p, casino, derby.x, derby.z);
V(B.p, { a: 'derby', gator: 2, amount: 100 });
chat(B.p, '/derby');
run(40);
check(vprof(B.p).races >= 1, 'Gator Derby: Wette abgerechnet');
// Limits
const vp = vprof(B.p);
vp.hour.push([Date.now(), -BALANCE.casino.maxLossPerHour + 5]);
goLocal(B.p, casino, slot.x, slot.z);
V(B.p, { a: 'use', spot: slot.id });
const c1 = vp.chips;
(room.venues.casino as unknown as { machines: Map<number, { last: number }> }).machines.get(slot.n!)!.last = 0;
V(B.p, { a: 'slot', m: slot.n, bet: 10 });
check(vp.chips === c1 && /Verlustlimit/.test(last(B.msgs, 'notice')?.text ?? ''), 'Verlustlimit pro Stunde greift');
V(B.p, { a: 'leave' });
// Auszahlen
goLocal(B.p, casino, cage.x, cage.z);
const cashBefore = B.p.profile.money, chipsBefore = vp.chips;
V(B.p, { a: 'chips', amount: -chipsBefore });
check(vp.chips === 0 && B.p.profile.money === cashBefore + chipsBefore, 'Chips → Bargeld 1:1');
// Casino deaktivieren
V(B.p, { a: 'casinoOff', on: true });
V(B.p, { a: 'chips', amount: 100 });
check(vp.chips === 0, 'Casino für das eigene Konto deaktiviert → kein Chipkauf');
V(B.p, { a: 'casinoOff', on: false });
V(B.p, { a: 'stats' });
check(last(B.msgs, 'vstats')?.s.spins === vp.spins, 'Statistik fürs Handy (Bilanz)');
// Jackpot durch NPC → E64
chat(B.p, '/jackpot');
run(1);
check(B.msgs.some((m) => m.t === 'vfx' && m.k === 'jackpot'), 'NPC-Jackpot: Lichtshow/Sirene');
run(30);
for (const k of ['E61', 'E62', 'E63']) { chat(B.p, `/event ${k}`); run(45); }
check(true, 'Casino-Ereignisse E61–E63 laufen durch');

// ---------------------------------------------------------------- Polizei & Abriegelung
B.p.wanted = 2;
run(1.5);
check(last(B.msgs, 'venue')?.lockdown === true, 'Fahndung 2 drinnen → Gebäude abgeriegelt');
const ex = spotById(INTERIORS.casino, 'exit')!;
goLocal(B.p, casino, ex.x, ex.z);
V(B.p, { a: 'exit' });
check(B.p.interior?.id === 'casino', 'Haupteingang zu (Polizei) – nur Hinterausgang');
run(8);
check(!B.p.interior, 'Polizei betritt den Innenraum und nimmt fest');

// ---------------------------------------------------------------- Quests
const C = mk('Questi');
C.p.profile.reputation.neon = 30;
const qd = QUEST_BY_ID.get('neon_02_dance_for_your_life')!;
qd.nightOnly = false;
room.handleMessage(C.p, { t: 'questAbandon' });
run(0.2);
R.quests.start(C.p, qd, 10);
room.handleMessage(C.p, { t: 'lobbyStart' });
run(0.5);

atDoor(C.p, club);
V(C.p, { a: 'enter', which: 'club' });
run(1.2);
if (!R.quests.view(C.p)?.stage.includes('Glitch')) console.log('  Quest:', JSON.stringify(R.quests.view(C.p)), C.msgs.filter((m) => m.t === 'notice').slice(-4).map((m) => (m as { text: string }).text), C.p.interior?.id);
check(R.quests.view(C.p)?.stage.includes('Glitch') === true, 'Quest „Tanz um dein Leben“: Club betreten → Glitch herausfordern');
const glitch = [...(room.venues as unknown as { v: Map<string, { crowd: { npcs: Map<number, { tag: string; x: number; z: number }> } }> }).v.get('club')!.crowd.npcs.values()].find((n) => n.tag.startsWith('glitch:'))!;
goLocal(C.p, club, glitch.x - 1, glitch.z);
V(C.p, { a: 'use', spot: 'tile14' });
check(C.p.interior?.seat?.startsWith('tile') === true, 'Battle gegen Glitch gestartet');
const gs = () => [...C.msgs].reverse().find((m) => m.t === 'vgame' && m.s.g === 'dance' && m.s.s && m.s.s.dancers.length === 2) as Extract<ServerMsg, { t: 'vgame' }> | undefined;
const bm2 = BEATMAPS.static_shock, n2 = bm2.medium;
let s2 = 0;
for (let t = 0; t < noteTime(bm2, n2[n2.length - 1][0]) + 10; t += 0.25) {
  run(0.25);
  const v = gs()?.s as { s: { t0: number; phase: string } } | undefined;
  if (!v || v.s.phase !== 'play') continue;
  const now = (Date.now() - v.s.t0) / 1000;
  const b: [number, number, number][] = [];
  while (s2 < n2.length && noteTime(bm2, n2[s2][0]) <= now) { b.push([s2, 0, n2[s2][2] === 1 ? n2[s2][3] : 0]); s2++; }
  if (b.length) V(C.p, { a: 'dance', op: 'hits', h: b });
}
run(8);
check(!!C.p.profile.inventory.usb_stick, 'Glitch geschlagen → USB-Stick');

console.log(fails ? `\n✗ ${fails} Prüfung(en) fehlgeschlagen` : '\n✓ Club & Casino: alle Prüfungen bestanden');
room.dispose();
process.exit(fails ? 1 : 0);
void SIM_DT;
