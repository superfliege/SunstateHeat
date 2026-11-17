// Innenräume einer Welt-Instanz: Club „Pink Static“ und Casino „Palm Royale“ als geteilte Teil-Szenen.
// Alle Spieler im selben Gebäude sehen sich und dieselbe Menge; die Außenwelt-Simulation läuft weiter.
// Spieler drinnen stehen (für Interest-Management, Quests, Polizei) im Grundriss des Gebäudes.
//
// Zuständig für: Tür (Öffnungszeit, Dresscode, Eintritt, Leih-Sakko), Gates (VIP, High-Roller, Personal),
// Menge + Ereignisse (Crowd, Director), Minispiele (DanceFloor, Casino), Polizei drinnen + Abriegelung
// ab Fahndungsstufe 2, Valet-Parking, Emotes, Quest-Ziele, Gerüchte, Netz-Sync.
import { BALANCE } from '../../../shared/src/balance';
import { DANCE_STYLES, SONGS, SONG_BY_ID, songSeconds, STYLE_BY_ID, type Difficulty } from '../../../shared/src/content/dance';
import { GATORS } from '../../../shared/src/content/casino/derby';
import type { Line } from '../../../shared/src/content/events/schema';
import type { Objective } from '../../../shared/src/quests';
import { derbyTerminals } from '../../../shared/src/questLocations';
import { Act } from '../../../shared/src/npc/scenarios';
import { VehicleKind, isAircraft, isWaterVehicle } from '../../../shared/src/sim/vehicleDefs';
import { OUTFIT_ITEMS } from '../../../shared/src/items';
import {
  clubOpen, freeLocalSpot, Gate, interiorFrame, INTERIORS, rectContains, spotById, tileAt, toLocal, toWorld, venueExterior, zoneAt,
  type InteriorFrame, type InteriorId,
} from '../../../shared/src/venues/interiors';
import { VNpcKind, type DanceMode, type VenueAction, type VenueDialog } from '../../../shared/src/venues/net';
import { newPawn } from '../../../shared/src/sim/movement';
import type { ServerPlayer } from '../entities/types';
import type { Ped } from '../sim/Pedestrians';
import { casinoStats, exchange, vprof } from './Bank';
import { Casino } from './Casino';
import { Crowd, CLUB_BARKS, type VNpc } from './Crowd';
import { DanceFloor } from './DanceFloor';
import { Director } from './Director';
import type { VenueHost } from './host';
import { globalLeaderboard } from './Leaderboard';

const CB = BALANCE.club, CC = BALANCE.casino;
const DOOR_RANGE = 4.5;
const VALET_RANGE = 9;
const pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

interface VenueState {
  id: InteriorId;
  f: InteriorFrame;
  crowd: Crowd;
  director: Director;
  music: boolean;
  lights: boolean;
  evacuated: boolean;
  lockdown: boolean;
  /** Club-Beschallung: aktueller Song und Startzeit (ms) */
  song: string;
  songT0: number;
  spotlight: { x: number; z: number; until: number } | null;
}

/** Quest-Fortschritt im Innenraum (je Auftragslauf). */
interface QuestVenue {
  goal: Objective & { type: 'venue' };
  npc?: VNpc;
  t: number;
  suspicion: number;
  flag: boolean;
  ped?: Ped;
  lostT: number;
  hold: number;
  started: boolean;
}

export class Venues {
  private v = new Map<InteriorId, VenueState>();
  readonly casino: Casino;
  readonly dance: DanceFloor;
  private instBoard = new Map<string, [string, number][]>();
  private rumors: { text: string; t: number }[] = [];
  private syncT = 0;
  private secT = 0;
  /** Dev: Club unabhängig von der Uhrzeit offen */
  forceOpen = false;
  private quests = new Map<number, QuestVenue>();
  private cops = new Map<number, { npc: VNpc; pid: number; t: number }>();
  /** Spieler, die gerade einen Türsteher-Dialog haben (Eintritt/Leih-Sakko) */
  private pending = new Map<number, InteriorId>();
  private terminals;
  private lastChips = new Map<number, number>();

  constructor(private h: VenueHost) {
    for (const id of ['club', 'casino'] as InteriorId[]) {
      const f = interiorFrame(h.map, id);
      if (!f) continue;
      const st = {} as VenueState;
      const crowd = new Crowd(id, (n, text, style) => this.say(st, n, text, style ?? 'say'));
      Object.assign(st, { id, f, crowd, music: true, lights: true, evacuated: false, lockdown: false, song: SONGS[0].id, songT0: Date.now(), spotlight: null });
      st.director = new Director(id, {
        h, crowd,
        inside: () => this.inside(id),
        local: (p) => toLocal(f, p.pawn.x, p.pawn.z),
        say: (n, text, style, at) => this.say(st, n, text, style, at),
        effect: (k, on) => this.effect(st, k, on),
        actOf: (p) => p.act ?? 0,
        hasVip: (p) => vprof(p).vip,
        rumor: (text, p) => this.rumor(text, p),
        heal: (p) => { p.health = BALANCE.player.maxHealth; },
      });
      this.v.set(id, st);
    }
    const lb = globalLeaderboard();
    this.dance = new DanceFloor({
      h,
      clubPlayers: () => this.inside('club'),
      setAct: (p, act, s) => { p.act = act; p.actT = s > 0 ? s : 0; },
      vfx: (m) => { for (const p of this.inside('club')) h.send(p, { t: 'vfx', ...m }); if (m.k === 'spotlight' && m.pid) this.spotlightOn(m.pid, m.v ?? 8); },
      react: (kind, pid) => this.react(kind, pid),
      rumor: (text) => this.rumor(text, null),
      finished: (s) => this.danceFinished(s),
    }, lb, this.instBoard);
    this.casino = new Casino({
      h,
      inside: () => this.inside('casino'),
      bubble: (key, text) => { const st = this.v.get('casino'); const n = st?.crowd.byTag(key); if (st && n) this.say(st, n, text, 'say'); },
      jackpot: (winner, amount) => this.jackpot(winner, amount),
      bigWin: (m, amount) => {
        const st = this.v.get('casino');
        if (!st) return;
        const near = [...st.crowd.npcs.values()].filter((n) => n.kind === VNpcKind.GAMBLER).sort((a, b) => Math.hypot(a.x - 15, a.z) - Math.hypot(b.x - 15, b.z))[0];
        if (near) this.say(st, near, pick(['WAHNSINN!', 'Hast du das gesehen?!', `${amount.toLocaleString('de-DE')} $?! Ich will auch!`]), 'shout');
        for (const p of this.inside('casino')) h.send(p, { t: 'vfx', k: 'confetti', v: m, on: false });
      },
      rumor: (text) => this.rumor(text, null),
    });
    this.terminals = derbyTerminals(h.map);
  }

  frame(id: InteriorId) { return this.v.get(id)?.f ?? null; }
  inside(id: InteriorId): ServerPlayer[] { return [...this.h.players.values()].filter((p) => p.interior?.id === id); }
  private local(p: ServerPlayer) { return toLocal(p.interior!.f, p.pawn.x, p.pawn.z); }

  // ================================================================== Betreten & Verlassen
  private enter(p: ServerPlayer, id: InteriorId, payFee = false, force = false) {
    const st = this.v.get(id);
    if (!st || p.interior) return;
    if (p.vehicleId >= 0 || p.ride >= 0 || p.downT > 0) return;
    const d = st.f.door;
    if (Math.hypot(p.pawn.x - d.x, p.pawn.z - d.z) > DOOR_RANGE + 2) return this.h.notice(p, 'Zu weit von der Tür entfernt.', 'bad');
    if (st.evacuated) return this.h.notice(p, 'Feueralarm! Alle müssen draußen bleiben, bis die Feuerwehr Entwarnung gibt.', 'bad');
    if (p.wanted >= 2) return this.h.notice(p, 'Die Polizei hat das Gebäude abgeriegelt – mit Fahndungsstufe 2 kommst du nicht rein.', 'bad');
    const vp = vprof(p);
    const look = this.h.lookStyle(p);
    const outfit = vp.outfit && p.profile.inventory[vp.outfit] ? vp.outfit : null;
    if (force) { /* Dev/Benchmark: ohne Tür-Prüfung */ } else if (id === 'club') {
      if (!this.forceOpen && !clubOpen(this.h.day(), CB.openFrom, CB.openTo)) return this.dlg(p, { id: 'teo', who: 'Big Teo', lines: ['Geschlossen. Wir öffnen um 22 Uhr.', 'Komm wieder, wenn du müde aussiehst.'], options: [{ id: 'ok', label: 'Alles klar' }] });
      const rep = p.profile.reputation.neon ?? 0;
      const fits = look === 'business' || !!outfit;
      if (!fits && rep < CB.repFreeEntry && !payFee) {
        this.pending.set(p.id, id);
        const why = look === 'outdoor' ? 'Arbeitskleidung? Hier wird getanzt, nicht gemolken.' : 'Strandklamotten? Hier ist kein Beachvolleyball.';
        return this.dlg(p, { id: 'teo', who: 'Big Teo', lines: ['*mustert dich von oben bis unten*', 'Nicht mit den Schuhen.', why, `Für ${CB.entryFee} $ „Eintritt“ drücke ich beide Augen zu. Auch das dritte.`], options: [{ id: 'pay', label: `${CB.entryFee} $ zahlen` }, { id: 'no', label: 'Dann eben nicht' }] });
      }
      if (payFee) {
        if (p.profile.money < CB.entryFee) return this.h.notice(p, 'Nicht genug Bargeld für den Eintritt.', 'bad');
        this.h.addMoney(p, -CB.entryFee, 'club:eintritt');
      }
      this.say(st, null, fits ? 'Schicke Schuhe. Rein mit dir.' : rep >= CB.repFreeEntry ? 'Das Syndikat kennt dich. Viel Spaß.' : 'Bezahlt ist bezahlt. Benimm dich.', 'say', 'door');
    } else {
      const beach = look === 'beach' && !outfit && vp.jacket < Date.now();
      if (beach && !payFee) {
        this.pending.set(p.id, id);
        return this.dlg(p, { id: 'doorman', who: 'Portier Reginald', lines: ['In Badehose? Im Palm Royale?', 'Wir sind ein Haus mit Stil. Und Klimaanlage.', `Ein Leih-Sakko kostet ${CC.jacketRent} $. Es riecht nur ein bisschen nach Zigarre.`], options: [{ id: 'pay', label: `Leih-Sakko (${CC.jacketRent} $)` }, { id: 'no', label: 'Lieber nicht' }] });
      }
      if (payFee) {
        if (p.profile.money < CC.jacketRent) return this.h.notice(p, 'Nicht genug Bargeld.', 'bad');
        this.h.addMoney(p, -CC.jacketRent, 'casino:leih_sakko');
        vp.jacket = Date.now() + 60 * 60 * 1000;
      }
    }
    this.pending.delete(p.id);
    const e = INTERIORS[id].entry;
    const w = toWorld(st.f, e.x, e.z);
    p.pawn = newPawn(w.x, w.z, e.a + st.f.rot);
    p.interior = { id, f: st.f, mask: 0, seat: null };
    p.interior.mask = this.maskFor(p);
    p.act = 0; p.actT = 0;
    st.crowd.forget(p.id);
    this.sendState(p, 'front');
    if (id === 'club') this.dance.syncTo(p);
    if (id === 'casino') this.h.send(p, { t: 'vfx', k: 'jackpotBoard', v: Math.floor(this.casino.jackpotPool) });
    if (p.weapon !== 'fists') this.h.notice(p, 'Waffen bleiben an der Garderobe – drinnen wird nicht geschossen.', 'info');
  }

  /** Verlassen (Tür vorn/hinten, Rauswurf, Evakuierung, Festnahme, Teleport). */
  exit(p: ServerPlayer, how: 'front' | 'back' | 'kick' | 'evac' | 'none' = 'front') {
    const it = p.interior;
    if (!it) return;
    this.casino.onLeave(p);
    this.dance.onLeave(p);
    const st = this.v.get(it.id);
    st?.crowd.forget(p.id);
    for (const [k, c] of this.cops) if (c.pid === p.id) { st?.crowd.remove(c.npc); this.cops.delete(k); }
    p.interior = null;
    p.act = 0; p.actT = 0;
    if (how !== 'none') {
      const d = how === 'back' ? it.f.back : it.f.door;
      const out = { x: d.x + Math.sin(d.a) * 1.6, z: d.z + Math.cos(d.a) * 1.6 };
      p.pawn = newPawn(out.x, out.z, d.a);
    }
    this.sendState(p, how);
  }

  private sendState(p: ServerPlayer, door: 'front' | 'back' | 'kick' | 'evac' | 'none') {
    const it = p.interior;
    const st = it ? this.v.get(it.id) : null;
    this.h.send(p, { t: 'venue', in: it?.id ?? null, mask: it?.mask ?? 0, chips: vprof(p).chips, door, music: st && st.id === 'club' && st.music ? `${st.song}@${st.songT0}` : st?.id === 'casino' ? 'lounge' : null, lockdown: !!st?.lockdown });
  }

  /** Gate-Maske: VIP (Ruf ≥ 60 oder VIP-Karte), High-Roller (Stufe 15 und 50.000 $ Chips), Quest-Freigaben. */
  private maskFor(p: ServerPlayer): number {
    let m = 0;
    const vp = vprof(p);
    if ((p.profile.reputation.neon ?? 0) >= CB.repVip || vp.vip) m |= Gate.VIP;
    const it = p.interior;
    const lp = it ? this.local(p) : null;
    const inHR = !!it && it.id === 'casino' && zoneAt(it.f.def, lp!.x, lp!.z) === 'highroller';
    if ((this.h.level(p) >= CC.highRollerLevel && vp.chips >= CC.highRollerChips) || inHR) m |= Gate.HIGHROLLER;
    for (const q of this.quests.values()) if (q.goal.goal === 'sneak' && q.started && (q as QuestVenue & { pids?: number[] }).pids?.includes(p.id)) m |= Gate.HIGHROLLER | Gate.STAFF;
    return m;
  }

  // ================================================================== Nachrichten
  handle(p: ServerPlayer, a: VenueAction) {
    if (!a || typeof a !== 'object') return;
    switch (a.a) {
      case 'enter': if (a.which === 'club' || a.which === 'casino') this.enter(p, a.which); return;
      case 'exit': return this.tryExit(p, !!a.back);
      case 'opt': return this.option(p, String(a.dlg), String(a.id));
      case 'valet': return this.valet(p, a.op);
      case 'casinoOff': {
        const vp = vprof(p); vp.casinoOff = !!a.on;
        if (vp.casinoOff) this.casino.onLeave(p);
        this.h.notice(p, vp.casinoOff ? 'Casino-Spiele für dein Konto deaktiviert. Chips kannst du jederzeit an der Kasse auszahlen.' : 'Casino-Spiele wieder aktiviert.', 'info');
        this.h.persist(p);
        return;
      }
      case 'stats': return this.sendStats(p);
      case 'derbyWatch': {
        const inCasino = p.interior?.id === 'casino';
        if (!inCasino && !this.terminals.some((t) => Math.hypot(t.x - p.pawn.x, t.z - p.pawn.z) < 5)) return;
        (p as ServerPlayer & { derbyWatch?: number }).derbyWatch = Date.now() + 120_000;
        this.h.send(p, { t: 'vgame', s: { g: 'derby', view: this.casino.derbyView(p) } });
        return;
      }
      case 'derby': {
        const term = this.terminals.find((t) => Math.hypot(t.x - p.pawn.x, t.z - p.pawn.z) < 5);
        const inCasino = p.interior?.id === 'casino';
        if (!inCasino && !term) return this.h.notice(p, 'Wetten am Schalter im Casino oder an einem Derby-Terminal.', 'bad');
        return this.casino.derbyBet(p, Math.floor(Number(a.gator)), Number(a.amount), !inCasino);
      }
    }
    const it = p.interior;
    if (!it) return;
    switch (a.a) {
      case 'use': return this.use(p, String(a.spot));
      case 'leave': return this.leaveSeat(p);
      case 'chips': {
        const cage = spotById(it.f.def, 'cage');
        const l = this.local(p);
        if (it.id !== 'casino' || !cage || Math.hypot(l.x - cage.x, l.z - cage.z) > cage.r + 2) return this.h.notice(p, 'Chips gibt es nur an der Kasse.', 'bad');
        const err = exchange(p, Math.trunc(Number(a.amount)), this.h.addMoney.bind(this.h));
        if (err) return this.h.notice(p, err, 'bad');
        this.h.notice(p, Number(a.amount) > 0 ? `${Number(a.amount).toLocaleString('de-DE')} $ in Chips getauscht. Viel Glück – das Haus hat es nicht nötig.` : `${(-Number(a.amount)).toLocaleString('de-DE')} $ ausgezahlt.`, 'good');
        it.mask = this.maskFor(p);
        this.sendState(p, 'none');
        this.h.persist(p);
        return;
      }
      case 'slot': return this.casino.spin(p, Math.floor(Number(a.m)), Math.floor(Number(a.bet)));
      case 'bj': return this.casino.bjAction(p, String(a.table), String(a.op), Number(a.amount));
      case 'ru': return this.casino.ruBet(p, String(a.table), String(a.op), a.type, a.n === undefined ? undefined : Math.floor(Number(a.n)), Number(a.amount));
      case 'dance': return this.danceAction(p, a);
      case 'dj': {
        const ok = this.dance.djHits(p, Number(a.ok), Number(a.miss), !!a.done);
        if (ok === null) return;
        const st = this.v.get('club')!;
        if (ok) { st.director.signal(p.id, 'dj'); this.h.addMoney(p, CB.djGig, 'club:dj_aushilfe'); }
        else this.h.notice(p, 'Die Menge ist… höflich. DJ Lux übernimmt wieder.', 'info');
        this.effect(st, 'music', true);
        return;
      }
    }
  }

  private tryExit(p: ServerPlayer, back: boolean) {
    const it = p.interior;
    if (!it) return;
    const st = this.v.get(it.id)!;
    const spot = spotById(it.f.def, back ? 'backdoor' : 'exit')!;
    const l = this.local(p);
    if (Math.hypot(l.x - spot.x, l.z - spot.z) > spot.r + 1.5) return;
    if (!back && st.lockdown && p.wanted >= 2) return this.h.notice(p, 'Vor dem Haupteingang wartet die Polizei! Nimm den Hinterausgang.', 'bad');
    this.exit(p, back ? 'back' : 'front');
  }

  private dlg(p: ServerPlayer, d: VenueDialog) { this.h.send(p, { t: 'vdlg', d }); }

  private option(p: ServerPlayer, dlg: string, id: string) {
    switch (dlg) {
      case 'teo': case 'doorman': {
        const which = this.pending.get(p.id);
        if (id === 'pay' && which) this.enter(p, which, true);
        else this.pending.delete(p.id);
        return;
      }
      case 'vee': case 'barkeep': {
        if (id === 'drink') {
          if (p.profile.money < 15) return this.h.notice(p, 'Nicht genug Bargeld.', 'bad');
          this.h.addMoney(p, -15, 'venue:drink');
          p.health = Math.min(BALANCE.player.maxHealth, p.health + 20);
          this.h.notice(p, dlg === 'vee' ? 'Ein „Static Shock“. Prickelt wie eine Steckdose. (+20 Gesundheit)' : 'Ein „Royal Flush“. Schmeckt nach Geld. (+20 Gesundheit)', 'good');
        } else if (id === 'rumors') this.rumorDialog(p, dlg);
        return;
      }
      case 'vip': {
        if (id !== 'buy') return;
        const vp = vprof(p);
        if (vp.vip) return this.h.notice(p, 'Du hast schon eine VIP-Karte.', 'info');
        if (p.profile.money < CB.vipCardPrice) return this.h.notice(p, 'Nicht genug Bargeld.', 'bad');
        this.h.addMoney(p, -CB.vipCardPrice, 'club:vip_karte');
        vp.vip = true;
        if (p.interior) { p.interior.mask = this.maskFor(p); this.sendState(p, 'none'); }
        this.h.notice(p, 'VIP-Karte gekauft! Die Empore gehört dir. Also, ein Stück davon.', 'good');
        this.h.persist(p);
        return;
      }
      case 'boutique': {
        if (id === 'evening') {
          if (p.profile.inventory.outfit_evening) return this.h.notice(p, 'Die Abendgarderobe hast du schon.', 'info');
          if (p.profile.money < CC.eveningWearPrice) return this.h.notice(p, 'Nicht genug Bargeld.', 'bad');
          if (!this.h.addItem(p, 'outfit_evening')) return this.h.notice(p, 'Kein Platz im Rucksack.', 'bad');
          this.h.addMoney(p, -CC.eveningWearPrice, 'casino:boutique');
          vprof(p).outfit = 'outfit_evening';
          this.h.notice(p, 'Abendgarderobe gekauft und angezogen. Big Teo wird weinen (vor Freude).', 'good');
        }
        return;
      }
      case 'piano': if (id === 'tip' && p.profile.money >= 20) { this.h.addMoney(p, -20, 'casino:trinkgeld'); const st = this.v.get('casino')!; const n = st.crowd.byTag('pianist'); if (n) this.say(st, n, '♪ Für die Person mit dem großen Herzen und dem kleinen Budget ♪', 'say'); } return;
    }
  }

  private rumorDialog(p: ServerPlayer, who: 'vee' | 'barkeep') {
    const list = this.rumors.slice(-3).reverse().map((r) => r.text);
    const lines = list.length ? list : [who === 'vee' ? 'Ruhige Nacht bisher. Zu ruhig. Irgendwer tanzt gleich auf dem Tresen.' : 'Hier passiert nie etwas. Außer Jackpots. Und Waschbären.'];
    this.dlg(p, { id: who, who: who === 'vee' ? 'Vee (Bar)' : 'Barkeeper Lucien', lines: [who === 'vee' ? 'Gerüchte? Ich hab nichts gehört. *beugt sich vor*' : 'Man hört so einiges …', ...lines], options: [{ id: 'drink', label: 'Drink (15 $)' }, { id: 'bye', label: 'Danke' }] });
  }

  // ================================================================== Interaktionspunkte
  private use(p: ServerPlayer, spotId: string) {
    const it = p.interior!;
    const def = it.f.def;
    const l = this.local(p);
    // Quest-NPCs in der Nähe haben Vorrang (Glitch auf der Tanzfläche)
    if (this.questUse(p, l)) return;
    const spot = spotById(def, spotId);
    if (!spot) return;
    if (Math.hypot(l.x - spot.x, l.z - spot.z) > spot.r + 1.6) return;
    const st = this.v.get(it.id)!;
    switch (spot.kind) {
      case 'exit': return this.tryExit(p, false);
      case 'backdoor': return this.tryExit(p, true);
      case 'bar': return this.rumorDialog(p, 'vee');
      case 'piano': return this.dlg(p, { id: 'piano', who: 'Lounge-Pianist Archibald', lines: ['Einen Wunsch? Ich spiele alles. Außer gut.', 'Die Bar hinter mir hat übrigens die besten Gerüchte der Stadt.'], options: [{ id: 'tip', label: 'Trinkgeld (20 $)' }, { id: 'rumors', label: 'Gerüchte (Barkeeper)' }, { id: 'bye', label: 'Danke' }] });
      case 'vipdesk': return this.dlg(p, { id: 'vip', who: 'VIP-Schalter', lines: [vprof(p).vip ? 'Du hast schon eine VIP-Karte. Die Empore wartet.' : `VIP-Karte: ${CB.vipCardPrice.toLocaleString('de-DE')} $. Zutritt zur Empore, solange du lebst. Oder bis wir umbauen.`], options: vprof(p).vip ? [{ id: 'ok', label: 'Super' }] : [{ id: 'buy', label: `Kaufen (${CB.vipCardPrice.toLocaleString('de-DE')} $)` }, { id: 'no', label: 'Zu teuer' }] });
      case 'lounge': { p.act = p.act === Act.Sit ? 0 : Act.Sit; p.actT = 0; return; }
      case 'dj': {
        const ev = st.director.active('dj_missing');
        if (!ev || st.director.phaseId() !== 'silence') { const dj = st.crowd.byTag('dj'); if (dj) this.say(st, dj, 'Finger weg vom Pult! Das ist ein Kunstwerk!', 'shout'); return; }
        const err = this.dance.startDj(p, pick(SONGS).id);
        if (err) this.h.notice(p, err, 'bad');
        else this.say(st, null, '♪ Neuer DJ am Pult! ♪', 'sfx', [0, -9]);
        return;
      }
      case 'buffet': {
        if (p.profile.money < CC.buffetPrice) return this.h.notice(p, 'Nicht genug Bargeld.', 'bad');
        this.h.addMoney(p, -CC.buffetPrice, 'casino:buffet');
        p.health = BALANCE.player.maxHealth;
        return this.h.notice(p, 'All you can eat! Die Krabben waren mutig, du warst mutiger. (Gesundheit voll)', 'good');
      }
      case 'ledger': return this.h.notice(p, 'Abgeschlossen. Und bewacht. Und sehr teuer aussehend.', 'info');
      case 'boutique': return this.dlg(p, { id: 'boutique', who: 'Boutique „Royal Threads“', lines: ['Abendgarderobe „Palm Royale“ – öffnet Türen. Auch die im Pink Static.', `Preis: ${CC.eveningWearPrice.toLocaleString('de-DE')} $ (nur Spielgeld, versteht sich).`], options: [{ id: 'evening', label: `Kaufen (${CC.eveningWearPrice.toLocaleString('de-DE')} $)` }, { id: 'no', label: 'Nur gucken' }] });
      case 'cage': this.h.send(p, { t: 'vstats', s: casinoStats(p) }); return;
      case 'derby': (p as ServerPlayer & { derbyWatch?: number }).derbyWatch = Date.now() + 120_000; this.h.send(p, { t: 'vgame', s: { g: 'derby', view: this.casino.derbyView(p) } }); return;
      case 'slot': {
        if (vprof(p).casinoOff) return this.h.notice(p, 'Casino-Spiele sind für dein Konto deaktiviert (Einstellungen).', 'bad');
        const err = this.casino.occupyMachine(p, spot.n!);
        if (err) return this.h.notice(p, err, 'bad');
        this.seat(p, spot.id, Act.Slot);
        this.h.send(p, { t: 'vgame', s: { g: 'slot', m: spot.n!, v: spot.v as 'classic' | 'goldrush', reels: [], win: 0, jackpot: false, line: '', bet: 0, spin: 0, chips: vprof(p).chips } });
        return;
      }
      case 'bj': case 'roulette': {
        if (vprof(p).casinoOff) return this.h.notice(p, 'Casino-Spiele sind für dein Konto deaktiviert (Einstellungen).', 'bad');
        const err = this.casino.sit(p, spot.v!, spot.n!);
        if (err) return this.h.notice(p, err, 'bad');
        this.seat(p, spot.id, Act.Watch);
        const t = this.casino.bj.get(spot.v!);
        if (t) this.h.send(p, { t: 'vgame', s: { g: 'bj', view: this.casino.bjView(t), me: spot.n! } });
        const r = this.casino.ru.get(spot.v!);
        if (r) this.h.send(p, { t: 'vgame', s: { g: 'ru', view: this.casino.ruView(r) } });
        return;
      }
      case 'tile': {
        // F auf einer Kachel: Battle in der Nähe beitreten (sonst öffnet der Client die Song-Auswahl)
        const err = this.dance.join(p, spot.n!);
        if (!err) { p.interior!.seat = spot.id; this.snapTo(p, spot.x, spot.z, Math.PI); }
        return;
      }
    }
  }

  private seat(p: ServerPlayer, spot: string, act: number) {
    const it = p.interior!;
    const s = spotById(it.f.def, spot);
    it.seat = spot;
    if (s) this.snapTo(p, s.x, s.z, s.a);
    p.act = act; p.actT = 0;
  }
  private snapTo(p: ServerPlayer, lx: number, lz: number, la: number) {
    const f = p.interior!.f;
    const w = toWorld(f, lx, lz);
    p.pawn.x = w.x; p.pawn.z = w.z; p.pawn.a = la + f.rot;
  }
  private leaveSeat(p: ServerPlayer) {
    const it = p.interior;
    if (!it) return;
    this.casino.onLeave(p);
    if (this.dance.sessionOf(p.id)) this.dance.quit(p);
    if (this.dance.dj?.pid === p.id) { this.dance.djHits(p, 0, 0, true); }
    it.seat = null;
    if (p.act === Act.Slot || p.act === Act.Watch) p.act = 0;
    this.h.send(p, { t: 'vgame', s: { g: 'close' } });
  }

  // ================================================================== Tanzen
  private danceAction(p: ServerPlayer, a: Extract<VenueAction, { a: 'dance' }>) {
    const it = p.interior!;
    if (it.id !== 'club') return;
    const st = this.v.get('club')!;
    const l = this.local(p);
    const tile = tileAt(l.x, l.z);
    switch (a.op) {
      case 'setup': {
        if (tile < 0) return this.h.notice(p, 'Stell dich auf eine freie Kachel der Tanzfläche.', 'bad');
        if (!st.music) return this.h.notice(p, 'Ohne Musik? Mutig. Aber nein.', 'bad');
        const mode = (['solo', 'battle', 'crew'].includes(a.mode) ? a.mode : 'solo') as DanceMode;
        // Ereignis-Battle (E58) läuft: Seite wählen über die Kachel links/rechts
        const ev = st.director.active('gang_dance_battle');
        let opts: Parameters<DanceFloor['setup']>[5] = {};
        if (ev && mode === 'battle') {
          const side = l.x < 0 ? 'neon' : 'marlin';
          opts = { side, npc: [{ name: side === 'neon' ? 'Tide Breakers (Crew)' : 'Neon-Syndicate-Crew', frac: 0.62, tile: -1 }] };
          this.h.notice(p, `Du tanzt für ${side === 'neon' ? 'das Neon Syndicate' : 'die Tide Breakers (Marlin Club)'}!`, 'info');
        }
        const err = this.dance.setup(p, tile, String(a.song), a.diff as Difficulty, mode, opts);
        if (err) return this.h.notice(p, err, 'bad');
        it.seat = `tile${tile}`;
        const s = spotById(it.f.def, it.seat);
        if (s) this.snapTo(p, s.x, s.z, Math.PI);
        return;
      }
      case 'join': {
        if (tile < 0) return;
        const err = this.dance.join(p, tile);
        if (err) return this.h.notice(p, err, 'bad');
        it.seat = `tile${tile}`;
        return;
      }
      case 'go': return this.dance.go(p);
      case 'quit': it.seat = null; return this.dance.quit(p);
      case 'hits': return this.dance.hits(p, a.h);
    }
  }

  private danceFinished(s: { mode: DanceMode; side?: string; questFor?: number; results: { pid: number; rank: string; score: number; won: boolean }[] }) {
    const st = this.v.get('club')!;
    for (const r of s.results) {
      const p = r.pid > 0 ? this.h.players.get(r.pid) : undefined;
      if (!p) continue;
      if (p.interior?.seat?.startsWith('tile')) p.interior.seat = null;
      if (s.side && r.won && 'SAB'.includes(r.rank)) st.director.signal(p.id, 'dance_battle', s.side);
      if (s.questFor !== undefined) {
        const q = this.quests.get(s.questFor);
        if (q && r.won) {
          q.flag = true;
          this.h.addItem(p, 'usb_stick');
          if (q.npc) this.say(st, q.npc, 'Okay, okay … du hast gewonnen. Hier ist der Stick. Und mein Stolz.', 'say');
        } else if (q?.npc) this.say(st, q.npc, 'Haha! Nochmal? Ich hab Zeit. Du auch?', 'shout');
      }
    }
  }

  private spotlightOn(pid: number, seconds: number) {
    const p = this.h.players.get(pid);
    const st = this.v.get('club');
    if (!p || !st || p.interior?.id !== 'club') return;
    const l = this.local(p);
    st.spotlight = { x: l.x, z: l.z, until: Date.now() + seconds * 1000 };
  }

  private react(kind: 'hype' | 'cringe' | 'again' | 'win', pid: number) {
    const st = this.v.get('club'); const p = this.h.players.get(pid);
    if (!st || !p?.interior) return;
    const l = this.local(p);
    const near = [...st.crowd.npcs.values()].filter((n) => !n.hidden && n.kind === VNpcKind.DANCER).sort((a, b) => Math.hypot(a.x - l.x, a.z - l.z) - Math.hypot(b.x - l.x, b.z - l.z)).slice(0, 4);
    if (near.length) this.say(st, pick(near), pick(CLUB_BARKS[kind]), kind === 'cringe' ? 'think' : 'shout');
  }

  // ================================================================== Effekte, Sprechblasen, Gerüchte
  private say(st: VenueState, n: VNpc | null, text: string, style: Line['style'], atArg?: [number, number] | 'door') {
    const toDoor = atArg === 'door';
    const at = toDoor ? undefined : atArg as [number, number] | undefined;
    if (st.evacuated || toDoor) {
      // Straße: Sprechblase vor dem Eingang für Spieler draußen in der Nähe
      const d = st.f.door;
      const off = toDoor ? 1.5 : 5;
      const w = { x: d.x + Math.sin(d.a) * off + (toDoor ? 0 : (Math.random() - 0.5) * 6), z: d.z + Math.cos(d.a) * off + (toDoor ? 0 : (Math.random() - 0.5) * 4) };
      for (const p of this.h.players.values()) if (!p.interior && Math.hypot(p.pawn.x - d.x, p.pawn.z - d.z) < 60) this.h.send(p, { t: 'vsay', who: 0, text, style, at: [w.x, 2.4, w.z] });
      if (toDoor) return;
    }
    const pos = n ? null : at ? toWorld(st.f, at[0], at[1]) : null;
    for (const p of this.inside(st.id)) this.h.send(p, n ? { t: 'vsay', who: n.id, text, style } : { t: 'vsay', who: 0, text, style, at: [pos?.x ?? 0, st.f.y + 2.4, pos?.z ?? 0] });
  }

  private effect(st: VenueState, k: string, on: boolean) {
    switch (k) {
      case 'music': if (st.music === on) return; st.music = on; if (on) st.songT0 = Date.now(); break;
      case 'lights': if (st.lights === on) return; st.lights = on; break;
      case 'evacuate': {
        if (st.evacuated === on) return;
        st.evacuated = on;
        if (on) { for (const p of this.inside(st.id)) this.exit(p, 'evac'); for (const n of st.crowd.npcs.values()) n.hidden = true; }
        else for (const n of st.crowd.npcs.values()) { n.hidden = false; n.x = n.home.x; n.z = n.home.z; n.speed = 0; }
        break;
      }
    }
    const msg = { t: 'vfx' as const, k: (k === 'evacuate' ? 'alarm' : k) as 'alarm', on, s: k === 'evacuate' ? 'street' : st.id === 'club' && k === 'music' ? `${st.song}@${st.songT0}` : st.id };
    const d = st.f.door;
    for (const p of this.h.players.values()) if (p.interior?.id === st.id || (!p.interior && Math.hypot(p.pawn.x - d.x, p.pawn.z - d.z) < 140)) this.h.send(p, msg);
  }

  private rumor(template: string, p: ServerPlayer | null) {
    const text = template.replace('{player}', p ? p.name : 'jemand').replace('{district}', 'Ocean Strip').replace('{gang}', 'das Neon Syndicate');
    this.rumors.push({ text, t: Date.now() });
    if (this.rumors.length > 12) this.rumors.shift();
  }
  /** Gerüchte für andere Systeme (z. B. Handy, Radio). */
  latestRumors(n = 3) { return this.rumors.slice(-n).map((r) => r.text); }

  private jackpot(winner: ServerPlayer | null, amount: number) {
    const st = this.v.get('casino')!;
    for (const p of this.h.players.values()) {
      const d = st.f.door;
      if (p.interior?.id === 'casino' || Math.hypot(p.pawn.x - d.x, p.pawn.z - d.z) < 90) this.h.send(p, { t: 'vfx', k: 'jackpot', on: true, v: amount, pid: winner?.id ?? 0, s: winner?.name ?? '' });
    }
    const who = winner ? winner.name : 'ein Tourist aus Ohio';
    this.h.radio(`Radio Palmara: JACKPOT im Palm Royale! ${who} hat ${amount.toLocaleString('de-DE')} $ geknackt. Die Lichtshow war bis zum Hafen zu sehen.`);
    this.rumor(`Jackpot im Palm Royale: ${who} hat ${amount.toLocaleString('de-DE')} $ gewonnen – angeblich mit Badesalz als Glücksbringer.`, winner);
    if (!winner) st.director.start('jackpot_hysteria');
    else this.h.notice(winner, `★ JACKPOT ★ ${amount.toLocaleString('de-DE')} $ in Chips!`, 'good');
  }

  // ================================================================== Takt
  update(dt: number) {
    const now = Date.now();
    // Animationen (Emotes) auslaufen lassen
    for (const p of this.h.players.values()) if (p.actT && p.actT > 0) { p.actT -= dt; if (p.actT <= 0) { p.actT = 0; p.act = p.interior?.seat?.startsWith('tile') && this.dance.sessionOf(p.id) ? Act.Dance : 0; } }
    for (const st of this.v.values()) {
      const inside = this.inside(st.id);
      if (st.id === 'club' && st.music && now - st.songT0 > songSeconds(SONG_BY_ID[st.song]) * 1000) {
        // Club-Beschallung: nächster Song
        const i = SONGS.findIndex((s) => s.id === st.song);
        st.song = SONGS[(i + 1) % SONGS.length].id; st.songT0 = now;
        const msg = { t: 'vfx' as const, k: 'music' as const, on: true, s: `${st.song}@${st.songT0}` };
        const d = st.f.door;
        for (const p of this.h.players.values()) if (p.interior?.id === 'club' || (!p.interior && Math.hypot(p.pawn.x - d.x, p.pawn.z - d.z) < 140)) this.h.send(p, msg);
      }
      if (!inside.length && !st.director.run) continue; // leerer Innenraum: Menge schläft
      const occupied = inside.filter((p) => p.interior?.seat?.startsWith('tile')).map((p) => Number(p.interior!.seat!.slice(4)));
      st.crowd.update(dt, { music: st.music, spotlight: st.spotlight, occupied, playersLocal: inside.map((p) => this.local(p)) });
      st.director.update(dt);
      // Abriegelung: Spieler mit Fahndungsstufe ≥ 2 drinnen
      const lock = inside.some((p) => p.wanted >= 2);
      if (lock !== st.lockdown) { st.lockdown = lock; for (const p of inside) { this.sendState(p, 'none'); if (lock) this.h.notice(p, 'Die Polizei riegelt das Gebäude ab! Der Haupteingang ist dicht – Hinterausgang!', 'bad'); } }
      this.updateCops(st, inside, dt);
    }
    this.dance.update(dt);
    this.casino.update(dt);
    // NPC-Jackpot: ganz selten (im Schnitt ~ alle 40 min, solange jemand im Casino ist)
    if (this.inside('casino').length && Math.random() < dt / 2400) this.casino.npcJackpot();
    if (this.inside('casino').length) this.casino.npcSpins(dt * 6);
    // Sitzplätze: wer sich wegbewegt (Teleport, Ragdoll), steht auf
    this.secT -= dt;
    if (this.secT <= 0) {
      this.secT = 0.5;
      for (const p of this.h.players.values()) {
        const it = p.interior;
        if (!it) continue;
        const m = this.maskFor(p);
        const chips = vprof(p).chips;
        // Chips/Gates geändert (Abrechnung am Tisch, Derby, Kasse): Anzeige nachziehen
        if (m !== it.mask || chips !== this.lastChips.get(p.id)) { it.mask = m; this.lastChips.set(p.id, chips); this.sendState(p, 'none'); }
        if (p.downT > 0) this.exit(p, 'none');
      }
    }
    // NPC-Sync (4 Hz)
    this.syncT -= dt;
    if (this.syncT <= 0) {
      this.syncT = 0.25;
      for (const st of this.v.values()) for (const p of this.inside(st.id)) {
        const d = st.crowd.delta(p.id);
        if (d) this.h.send(p, { t: 'vnpc', ...d });
      }
    }
  }

  /** Polizei im Innenraum: Beamte kommen zur Tür herein und nehmen gesuchte Spieler fest. */
  private updateCops(st: VenueState, inside: ServerPlayer[], dt: number) {
    const wanted = inside.filter((p) => p.wanted >= 1);
    for (const p of wanted) {
      const have = [...this.cops.values()].filter((c) => c.pid === p.id).length;
      if (have < Math.min(3, p.wanted)) {
        const e = INTERIORS[st.id].entry;
        const n = st.crowd.add(VNpcKind.COP, `cop:${p.id}`, e.x + (Math.random() - 0.5) * 2, e.z, Math.PI, Act.None, 0);
        this.cops.set(n.id, { npc: n, pid: p.id, t: 0 });
        if (!have) this.say(st, n, pick(['Polizei! Niemand rührt sich! Außer Ihnen, Sie kommen mit.', 'Musik aus! Licht an! …Okay, Licht ist schon an.', 'Halt! Im Namen des Gesetzes – und des Dresscodes!']), 'shout');
      }
    }
    for (const [id, c] of this.cops) {
      const p = this.h.players.get(c.pid);
      if (!p || p.interior?.id !== st.id || p.wanted < 1) {
        if (st.crowd.npcs.has(c.npc.id)) { st.crowd.remove(c.npc); this.cops.delete(id); }
        continue;
      }
      const l = this.local(p);
      const d = Math.hypot(l.x - c.npc.x, l.z - c.npc.z);
      st.crowd.walk(c.npc, l.x, l.z, 4.4 + p.wanted * 0.4, Act.Point);
      if (d < 1.4) {
        c.t += dt;
        if (c.t > 1.5) { this.exit(p, 'kick'); this.h.arrest(p); }
      } else c.t = Math.max(0, c.t - dt * 0.5);
    }
  }

  // ================================================================== Valet, Emotes, Outfit, Statistik
  private valet(p: ServerPlayer, op: string) {
    const f = this.frame('casino');
    if (!f) return;
    const ex = venueExterior(f);
    const vp = vprof(p);
    const v = p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId) : undefined;
    const pos = v ? v.sim.car : p.pawn;
    if (Math.hypot(pos.x - ex.valet.x, pos.z - ex.valet.z) > VALET_RANGE) return this.h.notice(p, 'Fahr an den Valet-Stand vor dem Palm Royale.', 'bad');
    if (op === 'drop') {
      if (!v || v.driver !== p.id) return this.h.notice(p, 'Du musst am Steuer sitzen.', 'bad');
      if (isAircraft(v.kind) || isWaterVehicle(v.kind) || v.qtag || v.race !== undefined) return this.h.notice(p, 'Rico: „Das parke ich nicht. Das ist entweder ein Boot, ein Flugzeug oder ein Beweisstück.“', 'bad');
      if (vp.valet) return this.h.notice(p, 'Rico: „Du hast schon einen Wagen bei mir. Einer reicht, Boss.“', 'bad');
      vp.valet = { kind: v.kind, variant: v.sim.variant, color: v.color };
      this.h.placeOnFoot(p, ex.valet.x + Math.sin(ex.valet.a) * 1.5, ex.valet.z + Math.cos(ex.valet.a) * 1.5, ex.valet.a);
      this.h.removeVehicle(v.id);
      this.h.notice(p, `Rico parkt deinen Wagen. Abholen am Valet-Stand: ${CC.valetFee} $ – Wäsche inklusive.`, 'good');
    } else {
      if (v) return;
      if (!vp.valet) return this.h.notice(p, 'Rico: „Du hast keinen Wagen bei mir. Oder ich hab ihn sehr gut versteckt.“', 'info');
      if (p.profile.money < CC.valetFee) return this.h.notice(p, 'Nicht genug Bargeld für den Valet.', 'bad');
      this.h.addMoney(p, -CC.valetFee, 'casino:valet');
      this.h.spawnCar(vp.valet.kind || VehicleKind.Car, vp.valet.variant, ex.bay.x, ex.bay.z, ex.bay.a, vp.valet.color);
      vp.valet = null;
      this.h.notice(p, 'Rico bringt deinen Wagen – frisch gewaschen und nach Kokos duftend. Ganz ohne neue Kratzer. Fast.', 'good');
    }
    this.h.persist(p);
  }

  /** Emote in der offenen Welt oder drinnen: freigeschaltete Tanzstile, Jubeln, Winken. */
  emote(p: ServerPlayer, id: string) {
    if (p.vehicleId >= 0 || p.ride >= 0 || p.downT > 0) return;
    if (id === 'stop') { p.act = 0; p.actT = 0; return; }
    if (id === 'jubeln') { p.act = Act.Cheer; p.actT = 3; return; }
    if (id === 'winken') { p.act = Act.Wave; p.actT = 2.5; return; }
    const style = STYLE_BY_ID[id];
    if (!style) return this.h.notice(p, `Unbekannt. Tanzstile: ${DANCE_STYLES.map((s) => s.id).join(', ')} – oder jubeln, winken, stop.`, 'info');
    if (!vprof(p).styles.includes(id)) return this.h.notice(p, `„${style.name}“ ist noch nicht freigeschaltet (${style.unlock}).`, 'bad');
    p.act = (Act as Record<string, number>)[style.act] ?? Act.Dance; p.actT = 8;
  }

  /** Outfit an-/ausziehen (Kosmetik-Gegenstand benutzen). */
  wear(p: ServerPlayer, item: string): boolean {
    if (!OUTFIT_ITEMS.has(item) || !p.profile.inventory[item]) return false;
    const vp = vprof(p);
    vp.outfit = vp.outfit === item ? null : item;
    this.h.notice(p, vp.outfit ? 'Outfit angezogen. Big Teo wird beeindruckt sein. Vielleicht.' : 'Outfit ausgezogen.', 'info');
    return true;
  }

  sendStats(p: ServerPlayer) {
    const board = [] as { song: string; diff: string; inst: [string, number][]; global: [string, number][] }[];
    for (const s of SONGS) for (const d of ['easy', 'medium', 'hard']) {
      const key = `${s.id}:${d}`;
      const inst = this.instBoard.get(key) ?? [], global = globalLeaderboard().top(key);
      if (inst.length || global.length) board.push({ song: s.id, diff: d, inst: inst.slice(0, 5), global: global.slice(0, 5) });
    }
    this.h.send(p, { t: 'vstats', s: casinoStats(p), board });
  }

  /** Spieler verlässt das Spiel. */
  onLeave(p: ServerPlayer) {
    this.casino.onLeave(p);
    this.dance.onLeave(p);
    for (const st of this.v.values()) st.crowd.forget(p.id);
    this.pending.delete(p.id);
  }

  // ================================================================== Quest-Ziele
  /** Auswertung eines Innenraum-Ziels für einen Auftragslauf (QuestEngine). */
  questGoal(runId: number, goal: Objective & { type: 'venue' }, crew: ServerPlayer[], dt: number): { done?: boolean; fail?: string; prog?: string; target?: [number, number] } {
    let q = this.quests.get(runId);
    if (!q || q.goal !== goal) {
      if (q) this.questCleanup(runId);
      q = { goal, t: 0, suspicion: 0, flag: false, lostT: 0, hold: 0, started: false };
      this.quests.set(runId, q);
    }
    (q as QuestVenue & { pids?: number[] }).pids = crew.map((p) => p.id);
    const st = this.v.get(goal.venue);
    if (!st) return { done: true };
    const inside = crew.filter((p) => p.interior?.id === goal.venue);
    const door: [number, number] = [st.f.door.x, st.f.door.z];
    switch (goal.goal) {
      case 'enter': return inside.length ? { done: true } : { prog: `Betritt ${st.f.def.name} (E an der Tür)`, target: door };
      case 'battle': {
        if (!q.npc || !st.crowd.npcs.has(q.npc.id)) {
          q.npc = st.crowd.add(VNpcKind.DANCER, `glitch:${runId}`, 4.6, -1, Math.PI, Act.Dance4, 4);
          q.npc.busy = 'quest';
        }
        if (q.flag) { this.questCleanup(runId); return { done: true }; }
        if (!inside.length) return { prog: 'Rein ins Pink Static', target: door };
        if (Math.random() < dt / 9) this.say(st, q.npc, pick(['Na? Traust du dich? Komm her und drück E.', 'Den Stick? Nur über meine Tanzschuhe.', 'Ich hab den Moonwalk erfunden. Rückwärts.']), 'shout');
        return { prog: 'Glitch herausfordern (E neben ihm) und das Dance-Battle gewinnen' };
      }
      case 'observe': {
        if (!q.npc || !st.crowd.npcs.has(q.npc.id)) {
          q.npc = st.crowd.add(VNpcKind.GAMBLER, `counter:${runId}`, -10.8, 7.4, Math.PI, Act.Watch, 24);
          q.npc.busy = 'quest';
        }
        if (!inside.length) return { prog: 'Rein ins Palm Royale', target: door };
        let near = false, close = false;
        for (const p of inside) {
          const l = this.local(p);
          const d = Math.hypot(l.x - q.npc.x, l.z - q.npc.z);
          if (d < 2.2) close = true; else if (d < 6.5) near = true;
        }
        if (close) { q.suspicion += dt * 22; if (Math.random() < dt) this.say(st, q.npc, pick(['Was guckst du so?', 'Hast du kein eigenes Spiel?']), 'say'); }
        else if (near) { q.t += dt; q.suspicion = Math.max(0, q.suspicion - dt * 4); if (Math.random() < dt / 4) this.say(st, q.npc, pick(['…16, 17, minus eins, plus zwei…', 'Hehe. Noch drei Runden.', '*zählt flüsternd*']), 'whisper'); }
        if (q.t >= (goal.seconds ?? 25) || q.suspicion >= 100) {
          this.say(st, q.npc, 'Mist! Die haben mich! *rennt los*', 'shout');
          const bd = spotById(st.f.def, 'backdoor')!;
          st.crowd.walk(q.npc, bd.x - 1, bd.z, 4.5, Act.Panic);
          q.flag = true;
          return { done: true };
        }
        return { prog: `Beobachten: ${Math.floor(q.t)}/${goal.seconds ?? 25} s · Misstrauen ${Math.round(q.suspicion)} %` };
      }
      case 'catch': {
        if (!q.started) {
          q.started = true;
          for (const [k, o] of this.quests) if (k !== runId && o.goal.goal === 'observe' && o.npc) { st.crowd.remove(o.npc); this.quests.delete(k); }
          const old = [...st.crowd.npcs.values()].find((n) => n.tag.startsWith('counter:'));
          if (old) st.crowd.remove(old);
          q.ped = this.h.spawnPed(st.f.back.x, st.f.back.z, `counter:${runId}`);
          for (const p of inside) this.h.notice(p, 'Er ist durch den Personalausgang raus! Hinterher!', 'bad');
        }
        const ped = q.ped;
        if (!ped || ped.hp <= 0) { this.questCleanup(runId); return { done: true }; }
        let best = Infinity, bx = 0, bz = 0;
        for (const p of crew) {
          if (p.interior) continue;
          const v = p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId)?.sim.car : null;
          const x = v ? v.x : p.pawn.x, z = v ? v.z : p.pawn.z;
          const d = Math.hypot(x - ped.x, z - ped.z);
          if (d < best) { best = d; bx = x; bz = z; }
        }
        if (best < 2.6) {
          for (const p of crew) this.h.notice(p, 'Geschnappt! In seinem Ärmel: drei Asse und ein Zahnstocher.', 'good');
          this.h.removePed(ped.id);
          this.questCleanup(runId);
          return { done: true };
        }
        // Fliehen (weg vom nächsten Verfolger, mit Haken)
        if (best < Infinity) {
          const dx = ped.x - bx, dz = ped.z - bz, dl = Math.hypot(dx, dz) || 1;
          const w = Math.sin(Date.now() / 900) * 0.6;
          this.h.movePed(ped, dx / dl + w * (-dz / dl), dz / dl + w * (dx / dl), best < 25 ? 6.6 : 5, dt);
        }
        q.lostT = best > 140 ? q.lostT + dt : 0;
        if (q.lostT > 10) { this.h.removePed(ped.id); this.questCleanup(runId); return { fail: 'Der Kartenzähler ist entkommen.' }; }
        return { prog: Number.isFinite(best) ? `Abstand: ${Math.round(best)} m` : 'Raus durch den Personalausgang!', target: [ped.x, ped.z] };
      }
      case 'sneak': {
        q.started = true;
        if (q.flag) { this.questCleanup(runId); return { done: true }; }
        if (!inside.length) return { prog: 'Rein ins Palm Royale', target: door };
        const ledger = spotById(st.f.def, 'ledger')!;
        const guards = st.crowd.ofKind(VNpcKind.GUARD).filter((g) => g.tag === 'guard_hr');
        for (const p of inside) {
          const l = this.local(p);
          if (!rectContains([7.4, -17.6, 24.6, -7.2], l.x, l.z)) continue;
          for (const g of guards) {
            const dx = l.x - g.x, dz = l.z - g.z, d = Math.hypot(dx, dz);
            let da = Math.atan2(dx, dz) - g.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            if (d < 7 && Math.abs(da) < 0.62) {
              this.say(st, g, 'HEY! Sie da! Raus hier!', 'shout');
              const e = INTERIORS.casino.entry, w = toWorld(st.f, e.x, e.z);
              p.pawn = newPawn(w.x, w.z, st.f.rot + Math.PI);
              q.hold = 0;
              this.h.notice(p, 'Erwischt! Die Wache hat dich rausgeworfen – versuch es nochmal, außerhalb ihres Blickfelds.', 'bad');
            }
          }
          if (p.hold && Math.hypot(l.x - ledger.x, l.z - ledger.z) < 1.8) {
            q.hold += dt;
            if (q.hold >= 3) { q.flag = true; this.h.addItem(p, 'evidence', 3); this.h.notice(p, '📸 Klick. Klick. Klick. Doppelte Buchführung, sauber fotografiert.', 'good'); }
          } else q.hold = Math.max(0, q.hold - dt);
        }
        return { prog: q.hold > 0 ? `Fotografieren … ${q.hold.toFixed(1)}/3 s` : 'Zum Schreibtisch im Hinterzimmer (High-Roller-Raum) – Sichtkegel der Wachen meiden' };
      }
    }
    return {};
  }

  /** Quest-NPC ansprechen (E): Glitch → Dance-Battle. */
  private questUse(p: ServerPlayer, l: { x: number; z: number }): boolean {
    for (const [runId, q] of this.quests) {
      if (q.goal.goal !== 'battle' || !q.npc || q.flag) continue;
      if (!(q as QuestVenue & { pids?: number[] }).pids?.includes(p.id)) continue;
      if (Math.hypot(l.x - q.npc.x, l.z - q.npc.z) > 2.6) continue;
      const tile = tileAt(l.x, l.z) >= 0 ? tileAt(l.x, l.z) : 14;
      const err = this.dance.setup(p, tile, 'static_shock', 'medium', 'battle', { questFor: runId, npc: [{ name: 'Kai „Glitch“ Moreno', frac: 0.62, tile: -1 }] });
      if (err) { this.h.notice(p, err, 'bad'); return true; }
      p.interior!.seat = `tile${tile}`;
      const st = this.v.get('club')!;
      this.say(st, q.npc, 'Static Shock, Mittel. Der Verlierer kauft Nachos. Und den Stick.', 'shout');
      this.h.send(p, { t: 'vgame', s: { g: 'dance', s: null } });
      return true;
    }
    return false;
  }

  questCleanup(runId: number) {
    const q = this.quests.get(runId);
    if (!q) return;
    const st = this.v.get(q.goal.venue);
    if (q.npc && st && !q.npc.tag.startsWith('counter:')) st.crowd.remove(q.npc);
    if (q.ped && !q.flag) this.h.removePed(q.ped.id);
    this.quests.delete(runId);
  }

  // ================================================================== Dev
  dev(p: ServerPlayer, cmd: string, args: string[]): boolean {
    switch (cmd) {
      case '/club': case '/casino': {
        const id = cmd === '/club' ? 'club' : 'casino';
        const f = this.frame(id);
        if (!f) return true;
        if (args[0] === 'offen') { this.forceOpen = !this.forceOpen; this.h.notice(p, `Club ${this.forceOpen ? 'immer offen' : 'mit Öffnungszeiten'}.`, 'info'); return true; }
        if (p.interior) this.exit(p, 'none');
        p.pawn = newPawn(f.door.x + Math.sin(f.door.a) * 2.5, f.door.z + Math.cos(f.door.a) * 2.5, f.door.a + Math.PI);
        if (args[0] === 'rein' || args[0] === 'voll') {
          this.enter(p, id, false, true);
          if (args[0] === 'voll') this.fill(id);
        }
        return true;
      }
      case '/event': {
        const key = args[0] ?? '';
        const ev = { E57: 'dj_missing', E58: 'gang_dance_battle', E59: 'vip_drama', E60: 'fire_alarm', E61: 'lucky_granny', E62: 'system_player', E63: 'vault_false_alarm', E64: 'jackpot_hysteria' }[key.toUpperCase()] ?? key;
        for (const st of this.v.values()) { st.director.abort(); if (st.director.start(ev)) { this.h.notice(p, `Ereignis ${key} gestartet.`, 'info'); return true; } }
        this.h.notice(p, 'Unbekanntes Ereignis (E57–E64).', 'bad');
        return true;
      }
      case '/vtp': {
        // Dev: im Innenraum zu einem Platz springen (z. B. /vtp slot5, /vtp bj1:2, /vtp tile14, /vtp cage)
        const it = p.interior;
        const sp = it ? spotById(it.f.def, args[0] ?? '') : null;
        if (!it || !sp) { this.h.notice(p, 'Nur drinnen: /vtp <platz> (exit, bar, dj, tile0–29, cage, slot0–59, bj1:0, ru1:0, derby, ledger …)', 'info'); return true; }
        this.snapTo(p, sp.x, sp.z, sp.a);
        return true;
      }
      case '/chips': { const n = Math.floor(Number(args[0] ?? 10000)); vprof(p).chips += n; this.h.notice(p, `+${n} Chips (Dev).`, 'info'); if (p.interior) this.sendState(p, 'none'); return true; }
      case '/jackpot': this.casino.npcJackpot(); return true;
      case '/derby': this.casino.derby.t = 0.1; this.h.notice(p, `Derby startet. Alligatoren: ${GATORS.map((g) => g.name).join(', ')}`, 'info'); return true;
    }
    return false;
  }

  /** Dev/Benchmark: Club zur Hauptzeit (40 Tänzer + 8 „Spieler“-Tänzer) bzw. volle Automatenhalle. */
  private fill(id: InteriorId) {
    const st = this.v.get(id)!;
    if (id === 'club') {
      for (let i = 0; i < 8; i++) { const s = st.crowd.danceSpot(); st.crowd.add(VNpcKind.DANCER, 'bench', s.x, s.z, 0, Act.Dance4, 30 + i); }
    } else {
      for (let i = 0; i < 30; i++) { const x = 8 + Math.random() * 15, z = -3 + Math.random() * 14; const s = freeLocalSpot(st.f.def, x, z); st.crowd.add(VNpcKind.GAMBLER, 'bench', s.x, s.z, 0, Act.Slot, 10 + (i % 8)); }
    }
  }
}
