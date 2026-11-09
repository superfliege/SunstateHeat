// Spielmodus „Catch the Taxi“ (shared/taxiHunt.ts).
// Ablauf: Anmeldung am Telefon direkt am Spawn (andere Spieler in der Nähe können 15 s lang
// beitreten) → ein zufälliger Spieler wird Taxi, alle anderen Jäger in LKWs; freie Jägerplätze
// bekommen KI-LKWs → Countdown (alle stehen) → Taxi bekommt Vorsprung → 2 Minuten Jagd.
// Taxi: unendlich Nitro, darf aus dem Fahrzeug schießen. Jäger: dürfen nicht schießen, nur rammen.
// Ende: Taxi zerstört → Jäger gewinnen, Zeit abgelaufen → Taxi gewinnt. Danach stehen alle
// wieder am Startpunkt (Telefon), alle Fahrzeuge des Modus verschwinden.
import { clamp, dist2, wrapAngle } from '../../../shared/src/math';
import { Btn, type PhoneQuest, type QuestState } from '../../../shared/src/protocol';
import { carInWater, placeCar, upVector } from '../../../shared/src/sim/car';
import { findFootSpot } from '../../../shared/src/sim/movement';
import {
  HUNTER_VARIANTS, TAXI_HUNT_DURATION, TAXI_HUNT_HEAD_START, TAXI_HUNT_HUNTERS, TAXI_HUNT_ID, TAXI_HUNT_MAX_PLAYERS,
  TAXI_HUNT_NAME, TAXI_HUNT_REWARD, TAXI_VARIANT, taxiProfile,
} from '../../../shared/src/taxiHunt';
import { Tile } from '../../../shared/src/world/tiles';
import { RoadType, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { Vec2 } from '../../../shared/src/world/geometry';
import { wallDistance } from '../sim/Combat';
import { DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../entities/types';

export interface TaxiHuntHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  /** Startpunkt (Telefon am Spawn). */
  start: { x: number; z: number };
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  chat(p: ServerPlayer, text: string): void;
  /** Leerer String = Spieler darf mitspielen, sonst der Grund. */
  blocked(p: ServerPlayer): string;
  /** Fahrzeug erzeugen (KI: driver = DRIVER_NPC, sonst frei). */
  spawnCar(variant: number, x: number, z: number, a: number, ai: boolean, color: number): ServerVehicle;
  /** Spieler in das Fahrzeug setzen (verlässt ein evtl. aktuelles Fahrzeug). */
  seat(p: ServerPlayer, v: ServerVehicle): void;
  /** Spieler aus dem Fahrzeug holen und zu Fuß an (x, z) stellen. */
  placeOnFoot(p: ServerPlayer, x: number, z: number, a: number): void;
  clearArea(x: number, z: number, r: number, keep: Set<number>): void;
  removeVehicle(id: number): void;
  /** Ein Physik-Schritt (SIM_DT) für ein KI-Fahrzeug. */
  stepAi(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  grantXp(p: ServerPlayer, xp: number): void;
  persist(p: ServerPlayer): void;
}

const LOBBY_TIME = 15;
const JOIN_RANGE = 70;
const GRID_TIME = 4;
const COUNT_FROM = 3;
const END_TIME = 6;
const RESPAWN_TIME = 3;
/** Taxi nimmt bei Rammstößen durch Jäger-LKWs mehr Schaden (Aufprall-Tempo × Faktor). */
const TAXI_RAM_SCALE = 1.4;
const AI_NAMES = ['Brutus', 'Diesel-Dora', 'Kalle Kipper', 'Rammbock Ron', 'Hank Haul', 'Mona Monster', 'Trucker Tex', 'Big Bertha', 'Ollie Overload', 'Gina Gearbox', 'Sledge', 'Tonnen-Toni', 'Rusty', 'Momo Mack'];
/** Marker in ServerVehicle.race für Fahrzeuge dieses Modus (Races nutzt positive IDs). */
const HUNT_MARK = -7;

type Role = 'taxi' | 'hunter';
interface Brain {
  stuck: number; reverse: number; revSteer: number; flipT: number; far: number;
  /** Wegpunkte über das Straßennetz Richtung Taxi, Neuplanung in `plan` Sekunden. */
  path: Vec2[]; plan: number;
  /** Kein Näherkommen ans Taxi seit … Sekunden (dann neu einsetzen). */
  bestD: number; noProg: number;
}
interface Driver {
  /** Spieler-ID, -1 = KI */
  pid: number;
  name: string;
  role: Role;
  vid: number;
  ai: Brain | null;
  /** Sekunden bis zum neuen LKW (Wrack), 0 = fährt */
  respawn: number;
}
interface Match {
  phase: 'lobby' | 'grid' | 'run' | 'end';
  t: number;
  members: number[];
  drivers: Driver[];
  elapsed: number;
  winner: Role | null;
  /** Letzter Jäger, der das Taxi gerammt hat (Abschuss-Anzeige). */
  lastRam: string;
}

const steps = (dt: number) => Math.max(1, Math.round(dt / (1 / 60)));

export class TaxiHunt {
  private match: Match | null = null;
  /** Wegweiser zum Taxi über das Straßennetz (Dijkstra ab dem Taxi-Knoten). */
  private flow = { next: new Int32Array(0), via: new Int32Array(0), node: -1, t: 0 };

  constructor(private h: TaxiHuntHost) {}

  has(pid: number) { return !!this.match?.members.includes(pid); }

  private driverOf(pid: number): Driver | undefined {
    const m = this.match;
    if (!m || m.phase === 'lobby' || m.phase === 'end') return undefined;
    return m.drivers.find((d) => d.pid === pid);
  }

  /** Rolle während der laufenden Runde (Countdown + Jagd). */
  role(pid: number): Role | null { return this.driverOf(pid)?.role ?? null; }

  /** Countdown bzw. Vorsprung des Taxis: Fahrzeug darf nicht losfahren. */
  frozen(pid: number) {
    const m = this.match, d = this.driverOf(pid);
    if (!m || !d) return false;
    if (m.phase === 'grid') return true;
    return d.role === 'hunter' && m.phase === 'run' && m.elapsed < TAXI_HUNT_HEAD_START;
  }

  /** Während der Runde bleibt jeder in seinem Fahrzeug. */
  locked(pid: number) { return !!this.driverOf(pid); }

  /** Unendlich Nitro fürs Taxi. */
  nitro(pid: number) { return this.role(pid) === 'taxi'; }

  /** Fahrzeuge dieses Modus darf nur ihr Fahrer besteigen. */
  mayEnter(pid: number, v: ServerVehicle) { return v.race !== HUNT_MARK || v.raceOwner === pid; }

  /**
   * Zusammenstoß zweier Fahrzeuge: Faktor für das Aufpralltempo von `victim`.
   * Jäger-LKW rammt Taxi → mehr Schaden, und der Rammer wird gemerkt.
   */
  ramScale(victim: ServerVehicle, other: ServerVehicle): number {
    const m = this.match;
    if (!m || m.phase !== 'run' || victim.race !== HUNT_MARK || other.race !== HUNT_MARK) return 1;
    const taxi = m.drivers.find((d) => d.role === 'taxi');
    if (!taxi || taxi.vid !== victim.id) return 1;
    const hunter = m.drivers.find((d) => d.vid === other.id);
    if (hunter) m.lastRam = hunter.name;
    return TAXI_RAM_SCALE;
  }

  // ------------------------------------------------------------------ Telefon
  listing(p: ServerPlayer): PhoneQuest[] {
    const m = this.match;
    let reason = this.h.blocked(p) || (this.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    let title = `🚕 ${TAXI_HUNT_NAME}`;
    if (m?.phase === 'lobby') {
      title += ` – Anmeldung offen (${m.members.length}/${TAXI_HUNT_MAX_PLAYERS}, noch ${Math.ceil(m.t)} s)`;
      if (!reason && m.members.length >= TAXI_HUNT_MAX_PLAYERS) reason = 'Alle Plätze sind belegt.';
    } else if (m && !reason) reason = 'Gerade läuft eine Runde – gleich wieder frei.';
    const R = TAXI_HUNT_REWARD;
    return [{
      id: TAXI_HUNT_ID, title,
      intro: [
        { who: 'Dispatcher', text: 'Einer von euch fährt das Taxi – alle anderen sitzen in LKWs und müssen es zu Schrott fahren.' },
        { who: 'Dispatcher', text: `Taxi: unendlich Nitro, darf aus dem Fenster schießen und muss ${TAXI_HUNT_DURATION / 60} Minuten überleben. Jäger: kein Schießen – nur rammen! Freie Plätze füllen KI-Trucker auf (${TAXI_HUNT_HUNTERS} Jäger).` },
        { who: 'Dispatcher', text: 'Wer das Taxi wird, entscheidet das Los. Danach geht’s für alle zurück hierher.' },
      ],
      rewardText: `Taxi: $${R.taxi.money} · ${R.taxi.xp} XP · Jäger: $${R.hunter.money} · ${R.hunter.xp} XP`,
      coop: [1, TAXI_HUNT_MAX_PLAYERS], ok: !reason, reason,
    }];
  }

  /** Runde starten bzw. einer offenen Anmeldung beitreten. */
  request(p: ServerPlayer) {
    const why = this.h.blocked(p) || (this.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    if (why) { this.h.notice(p, why, 'bad'); return; }
    const m = this.match;
    if (m) {
      if (m.phase !== 'lobby') { this.h.notice(p, 'Gerade läuft eine Runde „Catch the Taxi“ – gleich wieder frei.', 'bad'); return; }
      if (m.members.length >= TAXI_HUNT_MAX_PLAYERS) { this.h.notice(p, 'Alle Plätze sind belegt.', 'bad'); return; }
      m.members.push(p.id);
      for (const o of this.members(m)) this.h.notice(o, `${p.name} ist dabei! (${m.members.length}/${TAXI_HUNT_MAX_PLAYERS})`, 'good');
      if (m.members.length >= TAXI_HUNT_MAX_PLAYERS) m.t = Math.min(m.t, 1);
      return;
    }
    const match: Match = { phase: 'lobby', t: 0, members: [p.id], drivers: [], elapsed: 0, winner: null, lastRam: '' };
    const s = this.h.start;
    const nearby = [...this.h.players.values()].filter((o) => {
      if (o === p || this.h.blocked(o)) return false;
      const q = this.h.positionOf(o);
      return dist2(q.x, q.z, s.x, s.z) < JOIN_RANGE * JOIN_RANGE;
    });
    if (nearby.length) {
      match.t = LOBBY_TIME;
      for (const o of nearby) this.h.notice(o, `${p.name} startet „${TAXI_HUNT_NAME}“ – drück F am 🚕 Telefon, um mitzuspielen (${LOBBY_TIME} s)!`, 'info');
      this.h.notice(p, `Anmeldung offen: ${nearby.length} Spieler in der Nähe können ${LOBBY_TIME} s lang beitreten.`, 'info');
    } else match.t = 1;
    this.match = match;
  }

  abandon(p: ServerPlayer) {
    if (!this.has(p.id)) return false;
    this.drop(p.id, 'Catch the Taxi verlassen.', true);
    return true;
  }

  onPlayerLeave(pid: number) {
    if (this.has(pid)) this.drop(pid, '', false);
  }

  private drop(pid: number, msg: string, sendHome: boolean) {
    const m = this.match!;
    m.members = m.members.filter((id) => id !== pid);
    const p = this.h.players.get(pid);
    const d = m.drivers.find((x) => x.pid === pid);
    // Zuerst nach Hause (steigt dabei aus), dann übernimmt ggf. die KI den LKW
    if (p && sendHome && m.phase !== 'lobby') this.sendHome(p, undefined);
    if (p && msg) this.h.notice(p, msg, 'info');
    if (d && (m.phase === 'grid' || m.phase === 'run')) {
      if (d.role === 'taxi') {
        this.finish(m, 'hunter', `${d.name} hat das Taxi verlassen.`);
      } else {
        d.pid = -1; d.ai = newBrain(); d.name = `${d.name} (KI)`;
        const v = this.h.vehicles.get(d.vid);
        if (v) { v.raceOwner = -1; v.driver = DRIVER_NPC; v.buttons = 0; }
      }
    }
    if (!m.members.length && (m.phase === 'lobby' || m.phase === 'end')) this.cleanup(m);
    else if (!m.members.length) { this.finish(m, null, 'Alle Spieler sind weg.'); }
  }

  private members(m: Match): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const id of m.members) { const p = this.h.players.get(id); if (p) out.push(p); }
    return out;
  }

  // ------------------------------------------------------------------ Ablauf
  update(dt: number) {
    const m = this.match;
    if (!m) return;
    m.t -= dt;
    // Während der Runde: keine Fahndung, keine Verletzungen (nur das Taxi zählt)
    if (m.phase !== 'lobby') for (const p of this.members(m)) { p.wanted = 0; p.heat = 0; p.searchT = 0; p.arrestT = 0; p.reports.length = 0; p.invuln = Math.max(p.invuln, 0.5); }
    switch (m.phase) {
      case 'lobby':
        for (const p of this.members(m)) { const why = this.h.blocked(p); if (why) this.drop(p.id, `Catch the Taxi verlassen: ${why}`, false); }
        if (!this.match) return;
        if (!m.members.length) { this.cleanup(m); return; }
        if (m.t <= 0) this.setup(m);
        break;
      case 'grid':
        this.driveAll(m, dt);
        if (m.t <= 0) {
          m.phase = 'run'; m.t = 0;
          for (const p of this.members(m)) {
            const r = this.role(p.id);
            this.h.notice(p, r === 'taxi' ? 'LOS! Gib Nitro – die LKWs starten in ein paar Sekunden!' : `Das Taxi hat ${TAXI_HUNT_HEAD_START} s Vorsprung …`, r === 'taxi' ? 'good' : 'info');
          }
        }
        break;
      case 'run': {
        const wasHead = m.elapsed < TAXI_HUNT_HEAD_START;
        m.elapsed += dt;
        if (wasHead && m.elapsed >= TAXI_HUNT_HEAD_START) for (const p of this.members(m)) if (this.role(p.id) === 'hunter') this.h.notice(p, 'LOS! Schnapp dir das Taxi!', 'good');
        this.driveAll(m, dt);
        this.respawnHunters(m, dt);
        const taxi = m.drivers.find((d) => d.role === 'taxi')!;
        const tv = this.h.vehicles.get(taxi.vid);
        const tp = taxi.pid >= 0 ? this.h.players.get(taxi.pid) : undefined;
        if (!tv || tv.sim.dmg.wreck || tv.sim.dmg.burn > 0 || tv.sim.dmg.hp <= 0) {
          this.finish(m, 'hunter', m.lastRam ? `${m.lastRam} hat dem Taxi den Rest gegeben!` : 'Das Taxi ist Schrott!');
        } else if (carInWater(this.h.map, tv.sim.car)) {
          this.finish(m, 'hunter', `${taxi.name} ist im Wasser gelandet!`);
        } else if (tp && tp.vehicleId !== taxi.vid) {
          this.finish(m, 'hunter', 'Der Taxifahrer ist ausgestiegen.');
        } else if (m.elapsed >= TAXI_HUNT_DURATION) {
          this.finish(m, 'taxi', `${taxi.name} hat ${TAXI_HUNT_DURATION / 60} Minuten überlebt!`);
        }
        break;
      }
      case 'end':
        this.driveAll(m, dt);
        if (m.t <= 0) {
          for (const p of this.members(m)) this.sendHome(p, m.drivers.find((d) => d.pid === p.id));
          this.cleanup(m);
        }
        break;
    }
  }

  /** Spawnpunkte auf Straßen: Taxi nahe am Start, Jäger im Ring darum, Blick zum Taxi. */
  private spots(): { taxi: { x: number; z: number; a: number }; hunters: { x: number; z: number; a: number }[] } {
    const map = this.h.map, s = this.h.start;
    const onRoad = (x: number, z: number) => map.tileAt(x, z) === Tile.ROAD;
    let taxi = { x: s.x, z: s.z, a: 0 }, bd = Infinity;
    for (const e of map.edges) {
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const [x, z] = e.pts[i], [nx, nz] = e.pts[i + 1];
        const d = dist2(x, z, s.x, s.z);
        if (d < bd && d > 12 * 12 && onRoad(x, z)) { bd = d; taxi = { x, z, a: Math.atan2(nx - x, nz - z) }; }
      }
    }
    const cand: { x: number; z: number; d: number }[] = [];
    for (const e of map.edges) for (const [x, z] of e.pts) {
      const d = Math.sqrt(dist2(x, z, taxi.x, taxi.z));
      if (d > 55 && d < 160 && onRoad(x, z)) cand.push({ x, z, d });
    }
    cand.sort(() => Math.random() - 0.5);
    const hunters: { x: number; z: number; a: number }[] = [];
    for (const c of cand) {
      if (hunters.length >= TAXI_HUNT_HUNTERS) break;
      if (hunters.some((o) => dist2(o.x, o.z, c.x, c.z) < 16 * 16)) continue;
      hunters.push({ x: c.x, z: c.z, a: Math.atan2(taxi.x - c.x, taxi.z - c.z) });
    }
    // Notfall (kaum Straßen): im Kreis um das Taxi
    for (let k = 0; hunters.length < TAXI_HUNT_HUNTERS && k < 60; k++) {
      const a = (k / 12) * Math.PI * 2, r = 70 + 12 * Math.floor(k / 12);
      const x = taxi.x + Math.cos(a) * r, z = taxi.z + Math.sin(a) * r;
      if (findFootSpot(map, x, z, 0)) hunters.push({ x, z, a: Math.atan2(taxi.x - x, taxi.z - z) });
    }
    return { taxi, hunters };
  }

  private setup(m: Match) {
    const crew = this.members(m);
    if (!crew.length) { this.cleanup(m); return; }
    const { taxi, hunters } = this.spots();
    const keep = new Set<number>();
    for (const p of crew) if (p.vehicleId >= 0) keep.add(p.vehicleId);
    this.h.clearArea(taxi.x, taxi.z, 10, keep);
    for (const g of hunters) this.h.clearArea(g.x, g.z, 9, keep);

    const order = [...crew].sort(() => Math.random() - 0.5);
    const taxiPlayer = order.shift()!;
    const tv = this.h.spawnCar(TAXI_VARIANT, taxi.x, taxi.z, taxi.a, false, 9);
    tv.race = HUNT_MARK; tv.raceOwner = taxiPlayer.id;
    tv.sim.prof = taxiProfile(tv.sim.prof);
    this.h.seat(taxiPlayer, tv);
    m.drivers.push({ pid: taxiPlayer.id, name: taxiPlayer.name, role: 'taxi', vid: tv.id, ai: null, respawn: 0 });

    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const slots = hunters.slice(0, TAXI_HUNT_HUNTERS);
    slots.forEach((g, i) => {
      const p = order[i] ?? null;
      const v = this.h.spawnCar(pick(HUNTER_VARIANTS), g.x, g.z, g.a, !p, Math.floor(Math.random() * 10));
      v.race = HUNT_MARK; v.raceOwner = p ? p.id : -1;
      if (p) this.h.seat(p, v);
      m.drivers.push({ pid: p ? p.id : -1, name: p ? p.name : names[i % names.length], role: 'hunter', vid: v.id, ai: p ? null : newBrain(), respawn: 0 });
    });
    // Mehr Spieler als Startplätze (sehr enge Karte): Rest schaut zu
    for (const p of order.slice(slots.length)) this.drop(p.id, 'Kein Startplatz mehr frei – nächste Runde!', false);

    m.phase = 'grid';
    m.t = GRID_TIME;
    const humans = m.drivers.filter((d) => d.role === 'hunter' && d.pid >= 0).length;
    for (const p of this.members(m)) {
      if (p === taxiPlayer) this.h.notice(p, `🚕 DU bist das Taxi! Überlebe ${TAXI_HUNT_DURATION / 60} Minuten – Nitro ist unendlich (Shift), schießen mit der Maus.`, 'good');
      else this.h.notice(p, `🚚 Du jagst das Taxi von ${taxiPlayer.name}! Rammen, bis es brennt – schießen ist verboten.`, 'info');
      this.h.chat(p, `${TAXI_HUNT_NAME}: ${taxiPlayer.name} fährt das Taxi · ${humans} Spieler-Jäger · ${slots.length - humans} KI-Trucker.`);
    }
  }

  private finish(m: Match, winner: Role | null, why: string) {
    if (m.phase === 'end') return;
    m.phase = 'end';
    m.t = END_TIME;
    m.winner = winner;
    const R = TAXI_HUNT_REWARD;
    for (const p of this.members(m)) {
      const d = m.drivers.find((x) => x.pid === p.id);
      if (!d) continue;
      const won = winner !== null && d.role === winner;
      const rw = won ? (d.role === 'taxi' ? R.taxi : R.hunter) : R.loss;
      if (rw.money) this.h.addMoney(p, rw.money, `taxihunt:${d.role}`);
      this.h.grantXp(p, rw.xp);
      this.h.persist(p);
      const head = winner === 'taxi' ? '🚕 Das Taxi gewinnt!' : winner === 'hunter' ? '🚚 Die Jäger gewinnen!' : 'Runde abgebrochen.';
      this.h.notice(p, `${head} ${why}${won ? ` +$${rw.money} · +${rw.xp} XP` : ''}`, won ? 'good' : 'bad');
      this.h.chat(p, `${TAXI_HUNT_NAME}: ${head} ${why} (Zeit ${fmt(m.elapsed)})`);
    }
  }

  /** Zurück zum Startpunkt (zu Fuß, rund ums Telefon verteilt). */
  private sendHome(p: ServerPlayer, d: Driver | undefined) {
    const s = this.h.start;
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
    const spot = findFootSpot(this.h.map, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, 10) ?? s;
    this.h.placeOnFoot(p, spot.x, spot.z, Math.atan2(s.x - spot.x, s.z - spot.z));
    if (d) { const v = this.h.vehicles.get(d.vid); if (v) this.h.removeVehicle(v.id); }
  }

  private cleanup(m: Match) {
    for (const v of [...this.h.vehicles.values()]) if (v.race === HUNT_MARK) this.h.removeVehicle(v.id);
    if (this.match === m) this.match = null;
  }

  /** Zerstörte Jäger-LKWs: nach kurzer Pause neuer LKW in der Nähe des Taxis. */
  private respawnHunters(m: Match, dt: number) {
    const taxi = m.drivers.find((d) => d.role === 'taxi');
    const tv = taxi && this.h.vehicles.get(taxi.vid);
    if (!tv) return;
    for (const d of m.drivers) {
      if (d.role !== 'hunter') continue;
      const v = this.h.vehicles.get(d.vid);
      const p = d.pid >= 0 ? this.h.players.get(d.pid) : undefined;
      const dead = !v || v.sim.dmg.wreck || v.sim.dmg.burn > 0;
      // Ein KI-LKW, der weit abgehängt ist, wird ebenfalls neu eingesetzt
      const lost = !!v && !!d.ai && d.ai.far > 6;
      if (!dead && !lost) { d.respawn = 0; continue; }
      if (dead && d.respawn <= 0) {
        d.respawn = RESPAWN_TIME;
        if (p) this.h.notice(p, `LKW zerstört – neuer LKW in ${RESPAWN_TIME} s.`, 'bad');
        continue;
      }
      if (dead) { d.respawn -= dt; if (d.respawn > 0) continue; }
      const spot = this.huntSpot(tv.sim.car.x, tv.sim.car.z);
      if (!spot) continue;
      if (v && lost && !dead) {
        placeCar(this.h.map, v.sim.car, v.sim.prof, spot.x, spot.z, spot.a);
        v.dmgVer++;
        d.ai = newBrain();
        continue;
      }
      if (v) v.raceOwner = -1; // Wrack gehört niemandem mehr (wird am Ende entfernt)
      const nv = this.h.spawnCar(pick(HUNTER_VARIANTS), spot.x, spot.z, spot.a, !p, Math.floor(Math.random() * 10));
      nv.race = HUNT_MARK; nv.raceOwner = p ? p.id : -1;
      if (p) this.h.seat(p, nv);
      d.vid = nv.id; d.respawn = 0;
      if (d.ai) d.ai = newBrain();
    }
  }

  /** Straßenpunkt 80–150 m vom Taxi entfernt, Blick in Fahrtrichtung zum Taxi. */
  private huntSpot(tx: number, tz: number): { x: number; z: number; a: number } | null {
    const map = this.h.map;
    const cars = [...this.h.vehicles.values()];
    for (let t = 0; t < 120; t++) {
      const e = map.edges[Math.floor(Math.random() * map.edges.length)];
      if (!e || e.type === RoadType.Pier || e.pts.length < 2) continue;
      const i = Math.floor(Math.random() * (e.pts.length - 1));
      const [x, z] = e.pts[i], [nx, nz] = e.pts[i + 1];
      const d2 = dist2(x, z, tx, tz);
      if (d2 < 80 * 80 || d2 > 150 * 150 || map.tileAt(x, z) !== Tile.ROAD) continue;
      if (cars.some((v) => dist2(v.sim.car.x, v.sim.car.z, x, z) < 9 * 9)) continue;
      // entlang der Straße, in die Richtung, die eher zum Taxi zeigt
      let a = Math.atan2(nx - x, nz - z);
      if (Math.cos(a - Math.atan2(tx - x, tz - z)) < 0) a += Math.PI;
      return { x, z, a };
    }
    return null;
  }

  // ------------------------------------------------------------------ Wegfindung
  private nearestNode(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (const n of this.h.map.nodes) { const d = dist2(n.x, n.z, x, z); if (d < bd) { bd = d; best = n.id; } }
    return best;
  }

  /** Dijkstra vom Taxi-Knoten aus: für jeden Knoten der nächste Knoten Richtung Taxi. */
  private updateFlow(tx: number, tz: number, dt: number) {
    const f = this.flow;
    f.t -= dt;
    const goal = this.nearestNode(tx, tz);
    if (goal === f.node && f.t > 0) return;
    f.node = goal; f.t = 1;
    const { nodes, edges } = this.h.map;
    const n = nodes.length;
    if (f.next.length !== n) { f.next = new Int32Array(n); f.via = new Int32Array(n); }
    const dist = new Float64Array(n).fill(Infinity);
    const done = new Uint8Array(n);
    f.next.fill(-1); f.via.fill(-1);
    if (goal < 0) return;
    dist[goal] = 0;
    for (;;) {
      let u = -1, bu = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < bu) { bu = dist[i]; u = i; }
      if (u < 0) break;
      done[u] = 1;
      for (const eid of nodes[u].edges) {
        const e = edges[eid];
        if (e.type === RoadType.Pier) continue;
        const w = e.a === u ? e.b : e.a;
        const nd = bu + e.len;
        if (nd < dist[w]) { dist[w] = nd; f.next[w] = u; f.via[w] = eid; }
      }
    }
  }

  /** Wegpunkte vom LKW zum Taxi: zum nächsten Knoten (bevorzugt voraus), dann den Wegweisern nach. */
  private planPath(v: ServerVehicle): Vec2[] {
    const c = v.sim.car, { nodes, edges } = this.h.map, f = this.flow;
    const fx = Math.sin(c.a), fz = Math.cos(c.a);
    let start = -1, bs = Infinity;
    for (const nd of nodes) {
      const dx = nd.x - c.x, dz = nd.z - c.z, d = Math.hypot(dx, dz);
      if (d > 220) continue;
      const behind = (dx * fx + dz * fz) < 0 && d > 12 ? 40 : 0;
      if (d + behind < bs) { bs = d + behind; start = nd.id; }
    }
    const out: Vec2[] = [];
    if (start < 0) return out;
    out.push([nodes[start].x, nodes[start].z]);
    let u = start, len = 0;
    for (let k = 0; k < 40 && len < 320 && f.next[u] >= 0; k++) {
      const e = edges[f.via[u]];
      const pts = e.a === u ? e.pts : [...e.pts].reverse();
      for (let i = 1; i < pts.length; i++) if (i % 2 === 0 || i === pts.length - 1) out.push(pts[i]);
      len += e.len;
      u = f.next[u];
    }
    return out;
  }

  // ------------------------------------------------------------------ KI
  private driveAll(m: Match, dt: number) {
    const taxi = m.drivers.find((d) => d.role === 'taxi');
    const tv = taxi && this.h.vehicles.get(taxi.vid);
    if (tv && m.phase === 'run') this.updateFlow(tv.sim.car.x, tv.sim.car.z, dt);
    for (const d of m.drivers) {
      if (!d.ai) continue;
      const v = this.h.vehicles.get(d.vid);
      if (!v) continue;
      const hold = m.phase !== 'run' || m.elapsed < TAXI_HUNT_HEAD_START || !tv || v.sim.dmg.wreck || v.sim.dmg.burn > 0;
      if (hold) { for (let k = 0; k < steps(dt); k++) this.h.stepAi(v, 0, 0, v.sim.dmg.wreck ? 0 : Btn.BRAKE); continue; }
      this.chase(d.ai, v, tv!, dt);
    }
  }


  /**
   * Verfolgung: in der Nähe (freie Sicht) direkt auf die vorausberechnete Taxi-Position,
   * sonst den Wegpunkten über das Straßennetz folgen. Festgefahren → zurücksetzen.
   */
  private chase(ai: Brain, v: ServerVehicle, target: ServerVehicle, dt: number) {
    const map = this.h.map;
    const c = v.sim.car, t = target.sim.car;
    const speed = Math.hypot(c.vx, c.vz);
    const d0 = Math.sqrt(dist2(c.x, c.z, t.x, t.z));
    const lead = clamp(d0 / Math.max(10, speed), 0, 1.6);
    const px = t.x + t.vx * lead, pz = t.z + t.vz * lead;
    const direct = d0 < 45 && wallDistance(map, c.x, c.z, Math.atan2(t.x - c.x, t.z - c.z), d0) >= d0 - 2;
    let tx = px, tz = pz, corner = 0;
    if (!direct) {
      ai.plan -= dt;
      if (ai.plan <= 0 || !ai.path.length) { ai.path = this.planPath(v); ai.plan = 1.2 + Math.random() * 0.6; }
      // erreichte bzw. schon überholte Wegpunkte abhaken
      while (ai.path.length) {
        const [wx, wz] = ai.path[0];
        const dd = Math.hypot(wx - c.x, wz - c.z);
        const behind = (wx - c.x) * Math.sin(c.a) + (wz - c.z) * Math.cos(c.a) < 0;
        if (dd < 7 + speed * 0.25 || (behind && dd < 16 && ai.path.length > 1)) ai.path.shift(); else break;
      }
      if (ai.path.length) {
        [tx, tz] = ai.path[0];
        if (ai.path.length > 1) {
          const a1 = Math.atan2(tx - c.x, tz - c.z), a2 = Math.atan2(ai.path[1][0] - tx, ai.path[1][1] - tz);
          corner = Math.abs(wrapAngle(a2 - a1));
        }
      }
    }
    const dx = tx - c.x, dz = tz - c.z;
    const diff = wrapAngle(Math.atan2(dx, dz) - c.a);
    let ax = clamp(-diff * 2.2, -1, 1);
    let ay = 1;
    // vor Kurven abbremsen (schwerer LKW), bei großer Abweichung erst langsamer werden
    const want = corner > 0.9 ? 9 : corner > 0.45 ? 14 : 30;
    if (speed > want + 2 && Math.hypot(dx, dz) < speed * 1.6) ay = -0.6;
    if (Math.abs(diff) > 1.2 && speed > 9) ay = -0.5;
    let buttons = 0;
    if (Math.abs(diff) > 1.6 && speed > 6 && speed < 16) buttons = Btn.BRAKE; // Handbremswende
    if (direct && d0 < 25 && Math.abs(diff) < 0.4) buttons = Btn.SPRINT; // Ramm-Boost

    if (speed < 1.5) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
    // festgefahren – oder am Taxi klebend ohne Schwung: zurücksetzen und neu Anlauf nehmen
    if (direct && d0 < 14 && speed < 3) ai.stuck += dt;
    if (ai.stuck > 1.4 && ai.reverse <= 0) {
      ai.reverse = direct && d0 < 20 ? 1.8 : 1.2; ai.stuck = 0; ai.plan = 0;
      ai.revSteer = clamp(diff * 2, -1, 1) || (Math.random() < 0.5 ? -1 : 1); // schräg zurück, um aus dem Pulk zu kommen
    }
    if (ai.reverse > 0) { ai.reverse -= dt; ay = -1; ax = ai.revSteer; buttons = 0; }
    ai.flipT = upVector(c)[1] < 0.4 ? ai.flipT + dt : 0;
    if (d0 < ai.bestD - 5 || d0 < 9) { ai.bestD = d0; ai.noProg = 0; } else ai.noProg += dt;
    if (ai.noProg > 14) { ai.bestD = d0; ai.noProg = 0; ai.far = 99; } // hängt fest → neu einsetzen
    ai.far = d0 > 240 || ai.flipT > 2.5 || ai.far >= 99 ? ai.far + dt : 0;
    if (ai.flipT > 2.5) buttons |= Btn.UNFLIP;
    for (let k = 0; k < steps(dt); k++) this.h.stepAi(v, ax, ay, buttons);
  }

  // ------------------------------------------------------------------ Anzeige
  view(p: ServerPlayer): QuestState | null {
    const m = this.match;
    if (!m || !this.has(p.id)) return null;
    const base = { id: TAXI_HUNT_ID, title: `🚕 ${TAXI_HUNT_NAME}`, stageIdx: 0, stageCount: 1, timer: -1, targets: [] as QuestState['targets'] };
    if (m.phase === 'lobby') {
      return { ...base, stage: 'Anmeldung läuft – andere Spieler können am 🚕 Telefon beitreten.', prog: `Spieler: ${m.members.length}/${TAXI_HUNT_MAX_PLAYERS} · Start in ${Math.max(0, Math.ceil(m.t))} s`, timer: Math.max(0, Math.ceil(m.t)) };
    }
    const me = m.drivers.find((d) => d.pid === p.id);
    if (!me) return null;
    const taxi = m.drivers.find((d) => d.role === 'taxi')!;
    if (m.phase === 'end') {
      const won = m.winner !== null && me.role === m.winner;
      return { ...base, stage: m.winner === null ? 'Runde vorbei.' : won ? 'Gewonnen! 🎉' : 'Verloren.', prog: 'Gleich geht’s zurück zum Start …', timer: Math.max(0, Math.ceil(m.t)) };
    }
    const left = Math.max(0, Math.ceil(TAXI_HUNT_DURATION - m.elapsed));
    const tv = this.h.vehicles.get(taxi.vid);
    const hp = tv ? Math.max(0, Math.round(tv.sim.dmg.hp / 10)) : 0;
    const hunters = m.drivers.filter((d) => d.role === 'hunter');
    const targets: QuestState['targets'] = [];
    if (me.role === 'hunter' && tv) targets.push([Math.round(tv.sim.car.x * 10) / 10, Math.round(tv.sim.car.z * 10) / 10, 4, 5]);
    if (m.phase === 'grid') {
      const cnt = Math.ceil(m.t);
      return { ...base, stage: me.role === 'taxi' ? 'Du bist das TAXI – gleich geht’s los!' : `Du jagst das Taxi von ${taxi.name}!`, prog: `${hunters.length} LKWs · ${TAXI_HUNT_DURATION / 60}:00 Minuten`, freeze: true, count: cnt <= COUNT_FROM ? cnt : undefined, targets, hunt: me.role };
    }
    const head = m.elapsed < TAXI_HUNT_HEAD_START;
    const stage = me.role === 'taxi'
      ? 'Überleb die LKWs! Shift = Nitro (unendlich), Maus = schießen.'
      : head ? `Das Taxi hat Vorsprung – noch ${Math.ceil(TAXI_HUNT_HEAD_START - m.elapsed)} s …`
        : me.respawn > 0 ? `Neuer LKW in ${Math.ceil(me.respawn)} s …` : 'Ramm das Taxi zu Schrott! (Schießen verboten)';
    return {
      ...base, stage, prog: `Taxi-Zustand: ${hp} % · ${hunters.length} Jäger`, timer: left, targets, hunt: me.role,
      freeze: me.role === 'hunter' && head ? true : undefined,
      count: m.elapsed < 1.2 ? 0 : undefined,
    };
  }
}

function newBrain(): Brain { return { stuck: 0, reverse: 0, revSteer: 0, flipT: 0, far: 0, path: [], plan: 0, bestD: Infinity, noProg: 0 }; }
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }
function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
