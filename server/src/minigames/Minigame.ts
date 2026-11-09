// Basisklasse aller Fahrzeug-Minispiele. Eine Instanz = eine Runde.
// Ablauf (wie Rennen/Catch the Taxi): lobby → grid (Countdown, alle stehen) → run → end.
//   lobby: Anmeldung am Minispiel-Telefon, Spieler in der Nähe können beitreten.
//   setup: Arena öffnen, Startplätze, Fahrzeuge (oder zu Fuß); fehlende Plätze füllen NPCs auf.
//   run:   tick() des Modus, Todeszonen/Überschlag prüfen, Eliminierungen gesammelt je Tick
//          (gleichzeitiges Ausscheiden = geteilter Platz), Siegbedingung, Zeitlimit.
//   end:   Ergebnis-Bildschirm, Belohnungen, danach alle zurück zum Telefon, Aufräumen.
// Randfälle: Disconnect → NPC übernimmt oder Eliminierung (config.onLeave); letzter echter
// Spieler weg → Abbruch (config.abortWithoutHumans, außer Debug-Runden nur mit NPCs);
// Beitritt während der Runde → Warteliste, die nächste Runde startet automatisch.
// Der Server entscheidet alles; Clients bekommen QuestState (+ mg-HUD) und Events.
import { dist2 } from '../../../shared/src/math';
import { Btn, type QuestState } from '../../../shared/src/protocol';
import { upVector, type CarCollision } from '../../../shared/src/sim/car';
import { CAR_VARIANTS } from '../../../shared/src/sim/handling';
import { findFootSpot } from '../../../shared/src/sim/movement';
import {
  arenaById, BOT_DIFFICULTIES, BOT_NAMES, MINIGAMES, type BaseModeConfig, type DifficultyId, type MgHud, type MgResult, type MinigameId,
} from '../../../shared/src/minigames';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../entities/types';
import { Arena, type Spot } from './Arena';
import { BotDriver } from './BotDriver';

export interface MinigameHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  /** Startpunkt (Minispiel-Telefon): Rückkehrpunkt nach der Runde. */
  start: { x: number; z: number };
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  chat(p: ServerPlayer, text: string): void;
  /** Leerer String = Spieler darf mitspielen, sonst der Grund. */
  blocked(p: ServerPlayer): string;
  spawnCar(variant: number, x: number, z: number, a: number, ai: boolean, color: number): ServerVehicle;
  seat(p: ServerPlayer, v: ServerVehicle): void;
  placeOnFoot(p: ServerPlayer, x: number, z: number, a: number): void;
  clearArea(x: number, z: number, r: number, keep: Set<number>): void;
  removeVehicle(id: number): void;
  stepAi(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
  /** Fahrzeug sofort explodieren lassen (Comic-Explosion mit Flächenwirkung). */
  explode(v: ServerVehicle): void;
  /** NPC zu Fuß (von außen gesteuert): erzeugen, bewegen (Richtung in Weltkoordinaten), Position, entfernen. */
  spawnPed(x: number, z: number, color: number): number;
  movePed(id: number, dx: number, dz: number, run: boolean, dt: number): void;
  pedPos(id: number): { x: number; z: number } | null;
  removePed(id: number): void;
  /** Ereignis an Clients im Umkreis (z. B. ['boom', …]). */
  emit(x: number, z: number, ev: (string | number)[], vid: number): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  grantXp(p: ServerPlayer, xp: number): void;
  persist(p: ServerPlayer): void;
}

/** Marker in ServerVehicle.race für Fahrzeuge der Minispiele (Races nutzt positive IDs, Taxi -7). */
export const MG_MARK = -9;
const COUNT_FROM = 3;
/** So lange bleibt ein ausgeschiedenes Fahrzeug liegen (Sturz/Explosion sichtbar). */
const OUT_LINGER = 2.5;
const FEED_MAX = 6;

export interface Participant {
  key: number;
  /** Spieler-ID, -1 = NPC */
  pid: number;
  name: string;
  /** Fahrzeug (-1 = keins, z. B. zu Fuß oder schon entfernt) */
  vid: number;
  /** NPC zu Fuß (Ped-ID, -1 = keiner) */
  ped: number;
  bot: BotDriver | null;
  /** Rolle im Modus (z. B. 'bus'/'hunter'), '' = keine */
  role: string;
  alive: boolean;
  /** Endplatz (0 = noch offen). */
  place: number;
  score: number;
  /** Sekunden seit dem Ausscheiden. */
  outT: number;
  flipT: number;
  /** Sekunden mit der Fahrzeugmitte neben dem Arena-Boden (Absicherung, falls kein Physikschritt kommt). */
  offT: number;
  /** Letzter Kontakt mit einem anderen Teilnehmer (für „von X ins Wasser geschoben“). */
  lastHit: { by: number; t: number } | null;
}

export type Phase = 'lobby' | 'grid' | 'run' | 'end';
export const steps = (dt: number) => Math.max(1, Math.round(dt / (1 / 60)));

export interface MinigameOptions {
  /** Debug-Runde: nur NPCs, Anzahl Teilnehmer. */
  botsOnly?: number;
  difficulty?: DifficultyId;
  /** Ohne Anmeldephase sofort starten. */
  instant?: boolean;
}

export type HudExtra = Pick<MgHud, 'info' | 'warn' | 'bar' | 'alert'>;

export abstract class Minigame<C extends BaseModeConfig = BaseModeConfig> {
  phase: Phase = 'lobby';
  t = 0;
  elapsed = 0;
  /** Echte Spieler dieser Runde (auch ausgeschiedene). */
  members: number[] = [];
  /** Während der Runde beigetreten – spielen in der nächsten Runde. */
  waiting: number[] = [];
  /** Zuschauer ohne Teilnahme (Debug-Runden nur mit NPCs): bekommen HUD und Feed. */
  watchers: number[] = [];
  parts: Participant[] = [];
  feed: string[] = [];
  headline = '';
  readonly arena: Arena;
  readonly cfg: C;
  private pendingOut: { part: Participant; reason: string }[] = [];
  private nextKey = 1;
  private started = 0;

  constructor(protected h: MinigameHost, readonly mode: MinigameId, readonly opts: MinigameOptions = {}) {
    this.cfg = MINIGAMES[mode].config as C;
    const def = arenaById(this.cfg.arena);
    if (!def) throw new Error(`Arena ${this.cfg.arena} fehlt in arenas.json`);
    this.arena = new Arena(def, h.map);
  }

  get meta() { return MINIGAMES[this.mode]; }
  get title() { return `${this.meta.icon} ${this.meta.name}`; }
  get debug() { return !!this.opts.botsOnly; }
  get onFoot() { return !!this.cfg.onFoot; }

  // ================================================================== Hooks für Modi
  /** Startplätze (Standard: laut Arena-Daten). */
  protected spawnSpots(n: number): Spot[] { return this.arena.spawns(n); }
  /** Nach dem Erzeugen aller Teilnehmer (Rollen verteilen …). */
  protected onSetup(): void {}
  /** Nach dem Countdown (Start der Runde). */
  protected onStart(): void {}
  /** Jeder Tick während der Runde (vor Todeszonen und Siegprüfung). */
  protected abstract tick(dt: number): void;
  /** NPC-Steuerung im Fahrzeug: Verhaltensbausteine aufrufen. */
  protected abstract botThink(p: Participant, v: ServerVehicle, bot: BotDriver, dt: number): void;
  /** NPC zu Fuß (nur Modi mit onFoot): gewünschte Laufrichtung. */
  protected botWalk(_p: Participant, _x: number, _z: number, _dt: number): { dx: number; dz: number; run: boolean } { return { dx: 0, dz: 0, run: false }; }
  /** Warum scheidet p aus? '' = alles gut. Standard: Todeszonen der Arena, Überschlag. */
  protected outReason(p: Participant, v: ServerVehicle | undefined): string {
    if (this.onFoot) return '';
    if (!v) return 'ist verschwunden';
    const r = this.arena.deathReason(v.sim.car);
    if (r) return r;
    if (this.cfg.flipTimeout > 0 && p.flipT > this.cfg.flipTimeout) return 'liegt auf dem Dach';
    // Mitte neben dem Boden (z. B. Spieler ohne Eingaben: sein Auto wird nicht simuliert und fiele nie)
    if (this.arena.floor && p.offT > 1.5) return 'ist von der Plattform gestürzt';
    return '';
  }
  /** Siegbedingung, Standard: höchstens einer übrig. */
  protected checkWin(): void {
    const alive = this.alive();
    if (alive.length === 1) this.finish([alive], `${alive[0].name} gewinnt!`);
    else if (alive.length === 0) this.finish([], 'Unentschieden – alle gleichzeitig raus!');
  }
  /** Zeit abgelaufen: Rangfolge der Überlebenden (Gruppen = geteilter Platz). */
  protected onTimeUp(): void {
    const alive = this.alive();
    this.finish([alive], alive.length > 1 ? 'Zeit abgelaufen – Unentschieden!' : `${alive[0]?.name ?? 'Niemand'} gewinnt!`);
  }
  /** Schadensfaktor bei Kollisionen/Aufprall; (x, z) = Kontaktpunkt, other null = Wand/Explosion. */
  damageScale(_victim: ServerVehicle, _other: ServerVehicle | null, _x: number, _z: number): number { return 1; }
  /** Zusammenstoß zweier Teilnehmer (Impuls schon angewendet). */
  protected onCollide(_a: Participant, _b: Participant, _col: CarCollision, _va: ServerVehicle, _vb: ServerVehicle): void {}
  /** Aufprall an Wand/Hindernis. */
  protected onImpact(_p: Participant, _v: ServerVehicle, _dv: number): void {}
  /** Zusatzzeilen im HUD (Modus); me fehlt bei Zuschauern. */
  protected hudInfo(_me: Participant | undefined): HudExtra { return {}; }
  /** Zielmarkierungen [x, z, Radius, Art] (siehe QuestState.targets). */
  protected targets(_me: Participant | undefined): QuestState['targets'] { return []; }
  /** Wohin die Zuschauerkamera schaut. */
  protected spectatePoint(): [number, number] { return [this.arena.cx, this.arena.cz]; }
  /** Punkte-/Ergebnisspalte im Ergebnis-Bildschirm. */
  protected scoreText(_p: Participant): string { return ''; }
  /** Fahrzeugvariante für Startplatz i. */
  protected vehicleFor(_i: number): number { return this.randomVariant(this.cfg.vehicles); }

  protected randomVariant(models: string[]): number {
    const list = models.map((m) => CAR_VARIANTS.findIndex((v) => v.model === m)).filter((i) => i >= 0);
    return list.length ? list[Math.floor(Math.random() * list.length)] : 0;
  }

  // ================================================================== Abfragen
  has(pid: number) { return this.members.includes(pid) || this.waiting.includes(pid); }
  part(pid: number) { return this.parts.find((p) => p.pid === pid); }
  partByVehicle(vid: number) { return vid >= 0 ? this.parts.find((p) => p.vid === vid) : undefined; }
  alive() { return this.parts.filter((p) => p.alive); }
  vehicle(p: Participant) { return p.vid >= 0 ? this.h.vehicles.get(p.vid) : undefined; }
  /** Position eines Teilnehmers (Fahrzeug, Spieler zu Fuß oder NPC zu Fuß). */
  pos(p: Participant): { x: number; z: number; y: number } | null {
    const v = this.vehicle(p);
    if (v) return { x: v.sim.car.x, z: v.sim.car.z, y: v.sim.car.y };
    if (p.ped >= 0) { const q = this.h.pedPos(p.ped); return q ? { ...q, y: 0 } : null; }
    const pl = p.pid >= 0 ? this.h.players.get(p.pid) : undefined;
    return pl ? { x: pl.pawn.x, z: pl.pawn.z, y: 0 } : null;
  }
  /** Countdown: Fahrzeug/Figur steht. */
  frozen(pid: number) { return this.phase === 'grid' && !!this.part(pid)?.alive; }
  /** Während der Runde bleibt man im Fahrzeug (bzw. zu Fuß: kein Einsteigen). */
  locked(pid: number) { const p = this.part(pid); return !!p && p.alive && (this.phase === 'grid' || this.phase === 'run'); }
  get humansLeft() { return this.members.filter((id) => this.h.players.has(id)).length; }

  protected humans(): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const id of this.members) { const p = this.h.players.get(id); if (p) out.push(p); }
    return out;
  }
  protected say(text: string, kind: 'info' | 'good' | 'bad' = 'info') { for (const p of this.humans()) this.h.notice(p, text, kind); }
  protected tell(p: Participant, text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const pl = p.pid >= 0 ? this.h.players.get(p.pid) : undefined;
    if (pl) this.h.notice(pl, text, kind);
  }
  protected log(text: string) { this.feed.unshift(text); if (this.feed.length > FEED_MAX) this.feed.length = FEED_MAX; }

  // ================================================================== Anmeldung
  /** Spieler meldet sich an (Lobby) oder kommt auf die Warteliste (Runde läuft). */
  join(p: ServerPlayer): void {
    if (this.has(p.id)) { this.h.notice(p, 'Du bist bereits angemeldet.', 'bad'); return; }
    if (this.phase !== 'lobby') {
      this.waiting.push(p.id);
      this.h.notice(p, `Gerade läuft eine Runde ${this.meta.name} – du bist in der nächsten dabei!`, 'info');
      return;
    }
    if (this.members.length >= this.cfg.players.maxHumans) { this.h.notice(p, 'Alle Plätze sind belegt.', 'bad'); return; }
    this.members.push(p.id);
    this.say(`${p.name} ist dabei! (${this.members.length}/${this.cfg.players.maxHumans})`, 'good');
    if (this.members.length >= this.cfg.players.maxHumans) this.t = Math.min(this.t, 1);
  }

  /** Lobby öffnen: Spieler in der Nähe einladen. */
  open(first: ServerPlayer | null) {
    if (this.opts.instant || this.opts.botsOnly || !first) { this.t = 0.5; if (first) this.members.push(first.id); return; }
    this.members.push(first.id);
    const s = this.h.start, r = this.cfg.joinRange;
    const nearby = [...this.h.players.values()].filter((o) => {
      if (o === first || this.h.blocked(o)) return false;
      const q = this.h.positionOf(o);
      return dist2(q.x, q.z, s.x, s.z) < r * r;
    });
    if (nearby.length) {
      this.t = this.cfg.lobbyTime;
      for (const o of nearby) this.h.notice(o, `${first.name} startet ${this.title} – drück F am Arena-Telefon, um mitzuspielen (${this.cfg.lobbyTime} s)!`, 'info');
      this.h.notice(first, `Anmeldung offen: ${nearby.length} Spieler in der Nähe können ${this.cfg.lobbyTime} s lang beitreten.`, 'info');
    } else this.t = 1;
  }

  /** Spieler verlässt die Runde (Abbruch per Taste oder Disconnect). */
  leave(pid: number, disconnected: boolean) {
    this.waiting = this.waiting.filter((id) => id !== pid);
    if (!this.members.includes(pid)) return;
    this.members = this.members.filter((id) => id !== pid);
    const p = this.h.players.get(pid);
    const part = this.part(pid);
    // Position merken, bevor der Spieler nach Hause geschickt wird (NPC zu Fuß übernimmt dort)
    const at = part ? this.pos(part) : null;
    if (p && !disconnected && this.phase !== 'lobby') this.sendHome(p);
    if (p && !disconnected) this.h.notice(p, `${this.meta.name} verlassen.`, 'info');
    if (part && (this.phase === 'grid' || this.phase === 'run')) {
      const v = this.vehicle(part);
      const name = part.name;
      if (part.alive && this.cfg.onLeave === 'bot' && (v || (this.onFoot && at))) {
        part.pid = -1; part.name = `${name} (KI)`;
        part.bot = new BotDriver(BOT_DIFFICULTIES[this.cfg.bots.difficulty]);
        if (v) { v.raceOwner = -1; v.driver = DRIVER_NPC; v.buttons = 0; }
        else if (at) part.ped = this.h.spawnPed(at.x, at.z, part.key % 10);
        this.log(`${name} ist weg – ein NPC übernimmt.`);
      } else if (part.alive) {
        this.eliminate(part, 'hat das Spiel verlassen');
        part.pid = -1;
      } else part.pid = -1;
    }
    if (this.cfg.abortWithoutHumans && !this.debug && this.humansLeft === 0 && this.phase !== 'end') {
      if (this.phase === 'lobby') { this.phase = 'end'; this.t = 0; this.parts.length = 0; }
      else this.finish(null, 'Alle Spieler sind weg – Runde abgebrochen.', 1);
    }
  }

  // ================================================================== Ablauf
  /** true = Runde ist vorbei und aufgeräumt (Manager entfernt sie). */
  update(dt: number): boolean {
    this.t -= dt;
    if (this.phase !== 'lobby') for (const p of this.humans()) {
      if (!this.part(p.id)) continue;
      p.wanted = 0; p.heat = 0; p.searchT = 0; p.arrestT = 0; p.reports.length = 0; p.invuln = Math.max(p.invuln, 0.5);
    }
    switch (this.phase) {
      case 'lobby':
        for (const p of this.humans()) { const why = this.h.blocked(p); if (why) this.leave(p.id, false); }
        if (!this.debug && !this.members.length) { this.cleanup(); return true; }
        if (this.t <= 0) this.setup();
        break;
      case 'grid':
        this.driveBots(dt, true);
        if (this.t <= 0) {
          this.phase = 'run'; this.t = 0; this.started = Date.now();
          this.onStart();
          this.say('LOS!', 'good');
        }
        break;
      case 'run': {
        this.elapsed += dt;
        this.tick(dt);
        if (this.phase !== 'run') break;
        this.driveBots(dt, false);
        this.checkOut(dt);
        this.flushOut();
        if (this.phase === 'run') this.checkWin();
        if (this.phase === 'run' && this.elapsed >= this.cfg.timeLimit) this.onTimeUp();
        break;
      }
      case 'end':
        this.driveBots(dt, true);
        this.lingerOut(dt);
        if (this.t <= 0) { this.cleanup(); return true; }
        break;
    }
    if (this.phase === 'run') this.lingerOut(dt);
    return false;
  }

  private setup() {
    const crew = this.humans().filter((p) => !this.h.blocked(p));
    for (const p of this.humans()) if (!crew.includes(p)) this.leave(p.id, false);
    if (!crew.length && !this.debug) { this.phase = 'end'; this.t = 0; return; }
    const total = this.debug ? Math.max(2, this.opts.botsOnly!) : Math.min(this.cfg.players.max, Math.max(this.cfg.players.min, crew.length));
    this.arena.open();
    const spots = this.spawnSpots(total);
    const keep = new Set<number>();
    for (const p of crew) if (p.vehicleId >= 0) keep.add(p.vehicleId);
    for (const s of spots) this.h.clearArea(s.x, s.z, 6, keep);
    const order = [...crew].sort(() => Math.random() - 0.5);
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    spots.forEach((s, i) => {
      const p = order[i] ?? null;
      const part: Participant = {
        key: this.nextKey++, pid: p ? p.id : -1, name: p ? p.name : names[i % names.length], vid: -1, ped: -1,
        bot: p ? null : new BotDriver(BOT_DIFFICULTIES[this.botDifficulty()]), role: '',
        alive: true, place: 0, score: 0, outT: 0, flipT: 0, offT: 0, lastHit: null,
      };
      if (this.onFoot) {
        if (p) this.h.placeOnFoot(p, s.x, s.z, s.a);
        else part.ped = this.h.spawnPed(s.x, s.z, i % 10);
      } else {
        const v = this.h.spawnCar(this.vehicleFor(i), s.x, s.z, s.a, !p, i % 10);
        v.race = MG_MARK; v.raceOwner = p ? p.id : -1;
        if (p) this.h.seat(p, v);
        part.vid = v.id;
      }
      this.parts.push(part);
    });
    for (const p of order.slice(spots.length)) { this.leave(p.id, false); this.waiting.push(p.id); }
    this.onSetup();
    this.phase = 'grid';
    this.t = this.cfg.gridTime;
    const bots = this.parts.filter((q) => q.bot).length;
    for (const p of this.humans()) this.h.chat(p, `${this.title}: ${this.parts.length} Teilnehmer · ${this.parts.length - bots} Spieler · ${bots} NPCs.`);
    this.say(`${this.title}: ${this.meta.intro[0]}`, 'info');
  }

  /** Neues Fahrzeug für einen Teilnehmer (altes wird entfernt), z. B. Respawn eines Jägers. */
  protected respawnVehicle(p: Participant, s: Spot, variant: number) {
    const human = p.pid >= 0 ? this.h.players.get(p.pid) : undefined;
    const old = p.vid;
    const v = this.h.spawnCar(variant, s.x, s.z, s.a, !human, p.key % 10);
    v.race = MG_MARK; v.raceOwner = human ? human.id : -1;
    if (human) this.h.seat(human, v);
    p.vid = v.id; p.flipT = 0;
    if (old >= 0 && old !== v.id) this.h.removeVehicle(old);
    if (p.bot) p.bot = new BotDriver(p.bot.diff);
    return v;
  }

  private botDifficulty(): DifficultyId {
    const base = this.opts.difficulty ?? this.cfg.bots.difficulty;
    if (!this.cfg.bots.mix || this.opts.difficulty) return base;
    const order: DifficultyId[] = ['leicht', 'normal', 'schwer'];
    const i = order.indexOf(base) + (Math.random() < 0.25 ? -1 : Math.random() < 0.33 ? 1 : 0);
    return order[Math.max(0, Math.min(2, i))];
  }

  private driveBots(dt: number, hold: boolean) {
    const n = steps(dt);
    for (const p of this.parts) {
      if (!p.bot) continue;
      if (p.ped >= 0) {
        if (hold || !p.alive) continue;
        const q = this.h.pedPos(p.ped);
        if (!q) continue;
        const w = this.botWalk(p, q.x, q.z, dt);
        this.h.movePed(p.ped, w.dx, w.dz, w.run, dt);
        continue;
      }
      const v = this.vehicle(p);
      if (!v || v.driver !== DRIVER_NPC) continue;
      if (hold || !p.alive) { for (let k = 0; k < n; k++) this.h.stepAi(v, 0, 0, Btn.BRAKE); continue; }
      p.bot.begin(v.sim.car);
      this.botThink(p, v, p.bot, dt);
      p.bot.drive(dt, (ax, ay, b) => this.h.stepAi(v, ax, ay, b), n);
    }
  }

  private checkOut(dt: number) {
    for (const p of this.parts) {
      if (!p.alive) continue;
      const v = this.vehicle(p);
      p.flipT = v && upVector(v.sim.car)[1] < 0.35 ? p.flipT + dt : 0;
      p.offT = v && !this.h.map.onFloor(v.sim.car.x, v.sim.car.z) ? p.offT + dt : 0;
      const human = p.pid >= 0 ? this.h.players.get(p.pid) : undefined;
      let why = '';
      if (human && !this.onFoot && human.vehicleId !== p.vid) why = 'ist ausgestiegen';
      else if (human && this.onFoot && human.vehicleId >= 0) why = 'ist eingestiegen';
      else why = this.outReason(p, v);
      if (why) this.eliminate(p, why);
    }
  }

  /** Teilnehmer scheidet aus (wirksam am Ende des Ticks – gleichzeitiges Ausscheiden teilt den Platz). */
  protected eliminate(p: Participant, reason: string) {
    if (!p.alive || this.pendingOut.some((o) => o.part === p)) return;
    this.pendingOut.push({ part: p, reason });
  }

  protected flushOut() {
    if (!this.pendingOut.length) return;
    const before = this.alive().length;
    const batch = this.pendingOut.splice(0);
    const place = before - batch.length + 1;
    for (const { part, reason } of batch) {
      part.alive = false; part.place = Math.max(1, place); part.outT = 0;
      const by = part.lastHit && this.elapsed - part.lastHit.t < 4 ? this.parts.find((q) => q.key === part.lastHit!.by) : undefined;
      this.log(by ? `💥 ${part.name} ${reason} (durch ${by.name})` : `💥 ${part.name} ${reason}`);
      if (by) by.score += 1;
      const v = this.vehicle(part);
      if (v && v.driver === DRIVER_NPC) { v.driver = DRIVER_NONE; v.buttons = 0; }
      this.tell(part, `Ausgeschieden – ${reason}! Platz ${part.place}/${this.parts.length}.`, 'bad');
    }
  }

  /** Ausgeschiedene nach kurzer Zeit entfernen, Spieler auf den Zuschauerplatz. */
  private lingerOut(dt: number) {
    for (const p of this.parts) {
      if (p.alive || (p.vid < 0 && p.ped < 0 && p.outT >= OUT_LINGER)) continue;
      p.outT += dt;
      if (p.outT < OUT_LINGER) continue;
      const hp = p.pid >= 0 ? this.h.players.get(p.pid) : undefined;
      if (hp && this.phase !== 'end') this.toSpectate(hp);
      if (p.vid >= 0) { this.h.removeVehicle(p.vid); p.vid = -1; }
      if (p.ped >= 0) { this.h.removePed(p.ped); p.ped = -1; }
    }
  }

  protected toSpectate(p: ServerPlayer) {
    const s = this.arena.spectate;
    const spot = findFootSpot(this.h.map, s.x + (Math.random() - 0.5) * 6, s.z + (Math.random() - 0.5) * 6, 12) ?? s;
    this.h.placeOnFoot(p, spot.x, spot.z, Math.atan2(this.arena.cx - spot.x, this.arena.cz - spot.z));
  }

  /**
   * Runde beenden. ranking: Gruppen der noch lebenden Teilnehmer, beste zuerst (eine Gruppe =
   * geteilter Platz). null = Abbruch ohne Wertung.
   */
  protected finish(ranking: Participant[][] | null, headline: string, endTime = this.cfg.endTime) {
    if (this.phase === 'end') return;
    this.flushOut();
    this.phase = 'end';
    this.t = endTime;
    this.headline = headline;
    if (ranking) {
      let place = 1;
      for (const g of ranking) { for (const p of g) { p.place = place; p.alive = false; } place += g.length; }
    }
    for (const p of this.parts) if (p.alive) { p.alive = false; p.place = p.place || this.parts.length; }
    this.log(`🏁 ${headline}`);
    for (const p of this.humans()) {
      const part = this.part(p.id);
      if (!part || !ranking) { this.h.notice(p, headline, 'info'); continue; }
      const [money, xp] = this.cfg.rewards[part.place - 1] ?? this.cfg.participation;
      if (money) this.h.addMoney(p, money, `minigame:${this.mode}`);
      if (xp) this.h.grantXp(p, xp);
      this.h.persist(p);
      const won = part.place === 1;
      this.h.notice(p, `${headline} Du bist ${part.place}. von ${this.parts.length}.${money || xp ? ` +$${money} · +${xp} XP` : ''}`, won ? 'good' : 'info');
      this.h.chat(p, `${this.title}: ${headline} (Zeit ${fmt(this.elapsed)})`);
    }
  }

  /** Ergebnis vorzeitig erzwingen (Dev-Befehl /mg stop). */
  abort(why: string) { if (this.phase === 'lobby') { this.phase = 'end'; this.t = 0; } else this.finish(null, why, 2); }

  private sendHome(p: ServerPlayer) {
    const s = this.h.start;
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
    const spot = findFootSpot(this.h.map, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 10) ?? s;
    this.h.placeOnFoot(p, spot.x, spot.z, Math.atan2(s.x - spot.x, s.z - spot.z));
  }

  cleanup() {
    for (const p of this.humans()) if (this.parts.some((q) => q.pid === p.id) || this.phase !== 'lobby') this.sendHome(p);
    for (const p of this.parts) {
      if (p.vid >= 0) { this.h.removeVehicle(p.vid); p.vid = -1; }
      if (p.ped >= 0) { this.h.removePed(p.ped); p.ped = -1; }
    }
    this.cleanupExtra();
    this.arena.close();
    this.phase = 'end';
  }
  /** Zusätzliche Fahrzeuge des Modus (z. B. Wracks) aufräumen. */
  protected cleanupExtra(): void {}

  // ================================================================== Kollisionen
  collide(va: ServerVehicle, vb: ServerVehicle, col: CarCollision) {
    if (this.phase !== 'run') return;
    const a = this.partByVehicle(va.id), b = this.partByVehicle(vb.id);
    if (!a || !b || !a.alive || !b.alive) return;
    if (col.vn > 1.5) { a.lastHit = { by: b.key, t: this.elapsed }; b.lastHit = { by: a.key, t: this.elapsed }; }
    this.onCollide(a, b, col, va, vb);
  }

  impact(v: ServerVehicle, dv: number) {
    if (this.phase !== 'run') return;
    const p = this.partByVehicle(v.id);
    if (p && p.alive) this.onImpact(p, v, dv);
  }

  // ================================================================== Anzeige
  private results(me: Participant | undefined): MgResult[] {
    return [...this.parts].sort((a, b) => a.place - b.place).map((q) => ({ name: q.name, place: q.place, score: this.scoreText(q), me: q === me, bot: q.pid < 0 }));
  }

  view(p: ServerPlayer): QuestState | null {
    const waiting = this.waiting.includes(p.id) || this.watchers.includes(p.id);
    if (!waiting && !this.members.includes(p.id)) return null;
    const base = { id: `mg:${this.mode}`, title: this.title, stageIdx: 0, stageCount: 1, timer: -1, targets: [] as QuestState['targets'] };
    // In der Endphase: Sieger zählen als „übrig“
    const alive = this.phase === 'end' ? this.parts.filter((q) => q.place === 1).length : this.alive().length;
    const hud: MgHud = { mode: this.mode, alive, total: this.parts.length, me: 'alive', feed: this.feed };
    if (this.phase === 'lobby') {
      return { ...base, stage: 'Anmeldung läuft – andere Spieler können am Arena-Telefon beitreten.', prog: `Spieler: ${this.members.length}/${this.cfg.players.maxHumans} · Start in ${Math.max(0, Math.ceil(this.t))} s`, timer: Math.max(0, Math.ceil(this.t)), mg: { ...hud, total: 0 } };
    }
    const me = this.part(p.id);
    if (!me || !me.alive) hud.spectate = this.spectatePoint();
    const timer = Math.max(0, Math.ceil(this.cfg.timeLimit - this.elapsed));
    if (waiting || !me) {
      const watch = this.watchers.includes(p.id);
      const results = this.phase === 'end' ? this.results(undefined) : undefined;
      return {
        ...base, stage: watch ? (this.phase === 'end' ? this.headline : 'Debug-Runde: nur NPCs – du schaust zu.') : 'Runde läuft – du bist in der nächsten dabei.',
        prog: `${alive}/${this.parts.length} im Spiel`, timer, targets: this.targets(undefined),
        mg: { ...hud, me: 'waiting', results, headline: results ? this.headline : undefined, ...this.hudInfo(undefined) },
      };
    }
    hud.me = me.alive ? 'alive' : 'out';
    if (!me.alive) hud.place = me.place;
    Object.assign(hud, this.hudInfo(me));
    if (this.phase === 'end') {
      const results = this.results(me);
      return { ...base, stage: this.headline, prog: 'Gleich geht’s zurück zum Telefon …', timer: Math.max(0, Math.ceil(this.t)), mg: { ...hud, alert: undefined, results, headline: this.headline } };
    }
    const targets = this.targets(me);
    if (this.phase === 'grid') {
      const cnt = Math.ceil(this.t);
      return { ...base, stage: this.meta.intro[0], prog: `${this.parts.length} Teilnehmer`, timer, targets, freeze: true, count: cnt <= COUNT_FROM ? cnt : undefined, mg: { ...hud, alert: undefined } };
    }
    return {
      ...base, stage: me.alive ? this.meta.intro[1] ?? '' : `Ausgeschieden – Platz ${me.place}. Zuschauen …`,
      prog: `${alive}/${this.parts.length} im Spiel`, timer, targets, mg: hud,
      freeze: me.alive && this.frozen(p.id) ? true : undefined,
      count: this.elapsed < 1.2 && Date.now() - this.started < 1500 ? 0 : undefined,
    };
  }
}

export function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
