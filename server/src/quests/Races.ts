// Straßenrennen (shared/races.ts): beliebig oft wiederholbar, immer 5 Starter.
// Ablauf: Anmeldung am Renntelefon (andere Spieler in der Nähe können 15 s lang beitreten,
// max. 4 Spieler) → Startaufstellung mit ausgelosten Fahrzeugen, freie Plätze bekommen
// KI-Fahrer → Countdown (Fahrzeuge stehen) → Rennen über Checkpoints → Preisgeld je Platz.
// KI-Fahrer nutzen dieselbe Fahrphysik wie Spieler und folgen der Ideallinie.
import { clamp, dist2, wrapAngle } from '../../../shared/src/math';
import { Btn, type PhoneQuest, type QuestState } from '../../../shared/src/protocol';
import { CHECKPOINT_RADIUS, RACE_FIELD, RACE_MAX_PLAYERS, raceTracks, trackPose, type RaceTrack } from '../../../shared/src/races';
import { placeCar, upVector } from '../../../shared/src/sim/car';
import { CAR_VARIANTS, variantInfo } from '../../../shared/src/sim/handling';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { ServerPlayer, ServerVehicle } from '../entities/types';

export interface RaceHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  chat(p: ServerPlayer, text: string): void;
  /** Leerer String = Spieler darf ein Rennen starten/beitreten, sonst der Grund. */
  blocked(p: ServerPlayer): string;
  /** Rennwagen erzeugen (KI: driver = DRIVER_NPC, sonst frei). */
  spawnCar(variant: number, x: number, z: number, a: number, ai: boolean): ServerVehicle;
  /** Spieler in das Fahrzeug setzen (verlässt ein evtl. aktuelles Fahrzeug). */
  seat(p: ServerPlayer, v: ServerVehicle): void;
  /** Verkehr/freie Fahrzeuge im Umkreis entfernen (Startaufstellung freiräumen). */
  clearArea(x: number, z: number, r: number, keep: Set<number>): void;
  removeVehicle(id: number): void;
  /** Ein Physik-Schritt (SIM_DT) für ein KI-Fahrzeug. */
  stepAi(v: ServerVehicle, ax: number, ay: number, buttons: number): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  grantXp(p: ServerPlayer, xp: number): void;
  persist(p: ServerPlayer): void;
  /** Spieler ist im Ziel (Story: Sieg bei der Cane Ridge Rally wirbt die Rennfahrerin an). */
  finished?(p: ServerPlayer, raceId: string, place: number): void;
}

const LOBBY_TIME = 15;
const JOIN_RANGE = 60;
const GRID_TIME = 5;
const COUNT_FROM = 3;
const END_TIME = 8;
const AI_NAMES = ['Rico „Turbo“ Vega', 'Candy Flash', 'Big Earl', 'Mila Nitro', 'Dex Sideways', 'Luz Overdrive', 'Junior Cruz', 'Tammy Twin-Cam'];

interface Ai { skill: number; lane: number; stuck: number; reverse: number; flipT: number; offT: number; bestS: number; noProg: number }
interface Racer {
  /** Spieler-ID, -1 = KI */
  pid: number;
  name: string;
  vid: number;
  ai: Ai | null;
  /** nächster Checkpoint (Index) */
  cp: number;
  /** Fortschritt entlang der Ideallinie und Pfadindex (Suchfenster) */
  s: number;
  seg: number;
  /** Zielplatz (0 = noch unterwegs), Zeit, ausgeschieden */
  place: number;
  time: number;
  dnf: boolean;
}
interface Race {
  id: number;
  track: RaceTrack;
  phase: 'lobby' | 'grid' | 'run' | 'end';
  t: number;
  members: number[];
  racers: Racer[];
  elapsed: number;
  limit: number;
  finished: number;
}

let nextRace = 1;
const steps = (dt: number) => Math.max(1, Math.round(dt / (1 / 60)));

export class Races {
  private races = new Map<number, Race>();
  private byPlayer = new Map<number, Race>();
  readonly tracks: RaceTrack[];

  constructor(private h: RaceHost) {
    this.tracks = raceTracks(h.map);
  }

  has(pid: number) { return this.byPlayer.has(pid); }
  isTrack(id: string) { return this.tracks.some((t) => t.def.id === id); }

  /** Startaufstellung/Countdown: Spielerfahrzeug darf nicht losfahren. */
  frozen(pid: number) {
    const r = this.byPlayer.get(pid);
    return !!r && r.phase === 'grid';
  }

  /** Nur der eigene Rennwagen darf bestiegen werden; KI-Wagen gar nicht. */
  mayEnter(pid: number, v: ServerVehicle) {
    return v.race === undefined || v.raceOwner === pid;
  }

  private active(trackId: string) {
    return [...this.races.values()].find((r) => r.track.def.id === trackId && r.phase !== 'end');
  }

  // ------------------------------------------------------------------ Telefon
  listing(p: ServerPlayer, trackId: string): PhoneQuest[] {
    const track = this.tracks.find((t) => t.def.id === trackId);
    if (!track) return [];
    const d = track.def;
    const run = this.active(trackId);
    let reason = this.h.blocked(p) || (this.byPlayer.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    let title = d.name;
    if (run?.phase === 'lobby') {
      title += ` – Anmeldung offen (${run.members.length}/${RACE_MAX_PLAYERS}, noch ${Math.ceil(run.t)} s)`;
      if (!reason && run.members.length >= RACE_MAX_PLAYERS) reason = 'Das Starterfeld ist voll.';
    } else if (run && !reason) reason = 'Gerade läuft ein Rennen auf dieser Strecke.';
    const km = (track.finish / 1000).toFixed(1);
    const info = `${track.laps > 1 ? `${track.laps} Runden` : 'Sprint'} · ${km} km · ${track.checkpoints.length} Checkpoints · ${RACE_FIELD} Starter (bis zu ${RACE_MAX_PLAYERS} Spieler, Rest KI) · Zufallsfahrzeug`;
    return [{
      id: d.id, title, intro: [{ who: 'Rennleiter', text: d.intro }, { who: 'Rennleiter', text: info }],
      rewardText: `bis $${d.prize[0]} · bis ${d.xp[0]} XP`, coop: [1, RACE_MAX_PLAYERS], ok: !reason, reason,
    }];
  }

  /** Rennen am Telefon starten bzw. einer offenen Anmeldung beitreten. */
  request(p: ServerPlayer, trackId: string) {
    const track = this.tracks.find((t) => t.def.id === trackId);
    if (!track) return;
    const why = this.h.blocked(p) || (this.byPlayer.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    if (why) { this.h.notice(p, why, 'bad'); return; }
    const run = this.active(trackId);
    if (run) {
      if (run.phase !== 'lobby') { this.h.notice(p, 'Gerade läuft ein Rennen auf dieser Strecke – gleich wieder frei.', 'bad'); return; }
      if (run.members.length >= RACE_MAX_PLAYERS) { this.h.notice(p, 'Das Starterfeld ist voll.', 'bad'); return; }
      run.members.push(p.id);
      this.byPlayer.set(p.id, run);
      for (const m of this.members(run)) this.h.notice(m, `${p.name} fährt mit! (${run.members.length}/${RACE_MAX_PLAYERS})`, 'good');
      if (run.members.length >= RACE_MAX_PLAYERS) run.t = Math.min(run.t, 1);
      return;
    }
    const race: Race = { id: nextRace++, track, phase: 'lobby', t: 0, members: [p.id], racers: [], elapsed: 0, limit: 0, finished: 0 };
    // Andere freie Spieler in der Nähe einladen – dann wartet die Anmeldung kurz
    const ph = track.phone;
    const nearby = [...this.h.players.values()].filter((o) => {
      if (o === p || this.byPlayer.has(o.id) || this.h.blocked(o)) return false;
      const q = this.h.positionOf(o);
      return dist2(q.x, q.z, ph.x, ph.z) < JOIN_RANGE * JOIN_RANGE;
    });
    if (nearby.length) {
      race.t = LOBBY_TIME;
      for (const o of nearby) this.h.notice(o, `${p.name} startet das Straßenrennen „${track.def.name}“ – drück F am 🏁 Renntelefon, um mitzufahren (${LOBBY_TIME} s)!`, 'info');
      this.h.notice(p, `Anmeldung offen: ${nearby.length} Spieler in der Nähe können ${LOBBY_TIME} s lang beitreten.`, 'info');
    }
    this.races.set(race.id, race);
    this.byPlayer.set(p.id, race);
  }

  abandon(p: ServerPlayer) {
    const race = this.byPlayer.get(p.id);
    if (!race) return false;
    this.drop(race, p.id, 'Rennen abgebrochen.');
    return true;
  }

  onPlayerLeave(pid: number) {
    const race = this.byPlayer.get(pid);
    if (race) this.drop(race, pid, '');
  }

  private drop(race: Race, pid: number, msg: string) {
    this.byPlayer.delete(pid);
    race.members = race.members.filter((id) => id !== pid);
    const r = race.racers.find((x) => x.pid === pid);
    if (r && !r.place) r.dnf = true;
    if (r) { const v = this.h.vehicles.get(r.vid); if (v) { v.race = undefined; v.raceOwner = undefined; } }
    const p = this.h.players.get(pid);
    if (p && msg) this.h.notice(p, msg, 'info');
    if (!race.members.length && race.phase === 'lobby') this.races.delete(race.id);
  }

  private members(race: Race): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const id of race.members) { const p = this.h.players.get(id); if (p) out.push(p); }
    return out;
  }

  // ------------------------------------------------------------------ Ablauf
  update(dt: number) {
    for (const race of [...this.races.values()]) {
      race.t -= dt;
      switch (race.phase) {
        case 'lobby':
          // Mitglieder, die inzwischen anderweitig beschäftigt sind, fliegen raus
          for (const p of this.members(race)) { const why = this.h.blocked(p); if (why) this.drop(race, p.id, `Rennen verlassen: ${why}`); }
          if (!race.members.length) { this.races.delete(race.id); break; }
          if (race.t <= 0) this.setupGrid(race);
          break;
        case 'grid':
          this.driveAll(race, dt);
          if (race.t <= 0) {
            race.phase = 'run'; race.t = 0;
            for (const p of this.members(race)) this.h.notice(p, 'LOS!', 'good');
          }
          break;
        case 'run':
          race.elapsed += dt;
          this.driveAll(race, dt);
          this.track(race);
          if (!race.members.length || race.racers.every((r) => r.pid < 0 || r.place || r.dnf)) this.end(race);
          else if (race.elapsed > race.limit) this.end(race, 'Zeit abgelaufen.');
          break;
        case 'end':
          this.driveAll(race, dt);
          if (race.t <= 0) this.cleanup(race);
          break;
      }
    }
  }

  private setupGrid(race: Race) {
    const track = race.track;
    const crew = this.members(race);
    const keep = new Set<number>();
    for (const p of crew) if (p.vehicleId >= 0) keep.add(p.vehicleId);
    for (const g of track.grid) this.h.clearArea(g.x, g.z, 6, keep);
    const variants = CAR_VARIANTS.map((v, i) => ({ v, i })).filter((x) => x.v.cls !== 'truck').map((x) => x.i);
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5);
    const order = [...crew.map((p) => p as ServerPlayer | null)];
    while (order.length < RACE_FIELD) order.push(null);
    // Spieler zufällig auf die Startplätze verteilen (KI füllt auf)
    order.sort(() => Math.random() - 0.5);
    order.forEach((p, i) => {
      const g = track.grid[i];
      const variant = variants[Math.floor(Math.random() * variants.length)];
      const v = this.h.spawnCar(variant, g.x, g.z, g.a, !p);
      v.race = race.id;
      v.raceOwner = p ? p.id : -1;
      if (p) this.h.seat(p, v);
      const lane = (i % 2 ? -1 : 1) * (0.8 + Math.random() * 0.9);
      race.racers.push({
        pid: p ? p.id : -1, name: p ? p.name : names[i % names.length], vid: v.id,
        ai: p ? null : { skill: 0.94 + Math.random() * 0.09, lane, stuck: 0, reverse: 0, flipT: 0, offT: 0, bestS: 0, noProg: 0 },
        cp: 0, s: 0, seg: 0, place: 0, time: 0, dnf: false,
      });
      if (p) this.h.notice(p, `Dein Fahrzeug: ${variantInfo(variant).name}. Startplatz ${i + 1}.`, 'info');
    });
    for (const r of race.racers) this.progress(race, r, true);
    race.phase = 'grid';
    race.t = GRID_TIME;
    race.limit = track.finish / 8 + 90;
    const humans = crew.length;
    for (const p of crew) this.h.notice(p, `${track.def.name}: ${humans} Spieler, ${RACE_FIELD - humans} KI-Gegner. Mach dich bereit!`, 'info');
  }

  /** Fortschritt entlang der Ideallinie (lokales Suchfenster, damit Runden nicht übersprungen werden). */
  private progress(race: Race, r: Racer, init = false) {
    const v = this.h.vehicles.get(r.vid);
    const pl = r.pid >= 0 ? this.h.players.get(r.pid) : undefined;
    const pos = pl ? this.h.positionOf(pl) : v ? { x: v.sim.car.x, z: v.sim.car.z } : null;
    if (!pos) return;
    const { path, cum } = race.track;
    const from = init ? 0 : Math.max(0, r.seg - 3), to = Math.min(path.length - 1, init ? 12 : r.seg + 25);
    let best = r.seg, bd = Infinity;
    for (let i = from; i <= to; i++) {
      const d = dist2(pos.x, pos.z, path[i][0], path[i][1]);
      if (d < bd) { bd = d; best = i; }
    }
    // nur vorwärts (oder minimal zurück) – und nicht über große Entfernung „springen“
    if (bd < 30 * 30 || init) { r.seg = best; r.s = cum[best]; }
  }

  private track(race: Race) {
    const t = race.track;
    for (const r of race.racers) {
      if (r.place || r.dnf) { if (r.ai) this.progress(race, r); continue; }
      const v = this.h.vehicles.get(r.vid);
      if (!v || v.sim.dmg.wreck) {
        r.dnf = true;
        const p = this.h.players.get(r.pid);
        if (p) this.h.notice(p, 'Dein Rennwagen ist hinüber – ausgeschieden.', 'bad');
        continue;
      }
      this.progress(race, r);
      const cpS = t.checkpoints[r.cp];
      let passed: boolean;
      if (r.ai) passed = r.s >= cpS;
      else {
        const p = this.h.players.get(r.pid);
        const pos = p ? this.h.positionOf(p) : null;
        const cp = trackPose(t, cpS);
        passed = !!pos && pos.inVehicle && p!.vehicleId === r.vid && dist2(pos.x, pos.z, cp.x, cp.z) < CHECKPOINT_RADIUS * CHECKPOINT_RADIUS;
        if (passed) r.s = Math.max(r.s, cpS);
      }
      if (!passed) continue;
      r.cp++;
      if (r.cp >= t.checkpoints.length) this.finishRacer(race, r);
    }
  }

  private finishRacer(race: Race, r: Racer) {
    r.place = ++race.finished;
    r.time = race.elapsed;
    const d = race.track.def;
    const time = fmt(r.time);
    for (const p of this.members(race)) if (p.id !== r.pid) this.h.notice(p, `${r.name} ist im Ziel – Platz ${r.place} (${time})`, 'info');
    const p = this.h.players.get(r.pid);
    if (!p) return;
    const money = d.prize[r.place - 1] ?? 0, xp = d.xp[r.place - 1] ?? 0;
    if (money) this.h.addMoney(p, money, `race:${d.id}`);
    this.h.grantXp(p, xp);
    this.h.persist(p);
    this.h.notice(p, `🏁 Ziel! Platz ${r.place} von ${RACE_FIELD} in ${time} – +$${money} · +${xp} XP`, r.place === 1 ? 'good' : 'info');
    this.h.finished?.(p, d.id, r.place);
  }

  private ranking(race: Race): Racer[] {
    return [...race.racers].sort((a, b) => {
      if (a.place || b.place) return (a.place || 99) - (b.place || 99);
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      return b.cp - a.cp || b.s - a.s;
    });
  }

  private end(race: Race, why = '') {
    race.phase = 'end';
    race.t = END_TIME;
    const rank = this.ranking(race);
    const lines = rank.map((r, i) => `${i + 1}. ${r.name}${r.pid < 0 ? ' (KI)' : ''} – ${r.place ? fmt(r.time) : r.dnf ? 'ausgeschieden' : 'nicht im Ziel'}`);
    for (const p of this.members(race)) {
      const me = race.racers.find((r) => r.pid === p.id);
      if (me && !me.place) this.h.notice(p, `Rennen vorbei${why ? ` – ${why}` : ''}. Nicht im Ziel, kein Preisgeld.`, 'bad');
      this.h.chat(p, `Ergebnis „${race.track.def.name}“: ${lines.join(' · ')}`);
      this.byPlayer.delete(p.id);
    }
    // Spielerwagen gehören ab jetzt niemandem mehr (dürfen behalten werden)
    for (const r of race.racers) if (r.pid >= 0) { const v = this.h.vehicles.get(r.vid); if (v) { v.race = undefined; v.raceOwner = undefined; } }
    race.members = [];
  }

  private cleanup(race: Race) {
    for (const r of race.racers) if (r.ai) this.h.removeVehicle(r.vid);
    this.races.delete(race.id);
  }

  // ------------------------------------------------------------------ KI
  private driveAll(race: Race, dt: number) {
    // Gummiband: bester Spieler als Bezug
    let lead = -Infinity;
    for (const r of race.racers) if (r.pid >= 0 && !r.dnf) lead = Math.max(lead, r.s + (r.place ? 1e5 : 0));
    for (const r of race.racers) {
      if (!r.ai) continue;
      const v = this.h.vehicles.get(r.vid);
      if (!v) { if (!r.place) r.dnf = true; continue; }
      if (race.phase === 'grid') { for (let k = 0; k < steps(dt); k++) this.h.stepAi(v, 0, 0, Btn.BRAKE); continue; }
      if (v.sim.dmg.wreck) { r.dnf = true; for (let k = 0; k < steps(dt); k++) this.h.stepAi(v, 0, 0, 0); continue; }
      this.driveAi(race, r, v, lead, dt);
    }
  }

  private driveAi(race: Race, r: Racer, v: ServerVehicle, lead: number, dt: number) {
    const ai = r.ai!;
    const t = race.track;
    const c = v.sim.car;
    const speed = Math.hypot(c.vx, c.vz);
    if (race.phase !== 'run') this.progress(race, r);
    const end = t.cum[t.cum.length - 1];

    // Ideallinie mit leichtem Spurversatz (die Fahrer fahren nicht alle auf einer Linie)
    const look = 7 + speed * 0.45;
    const sT = Math.min(end, r.s + look);
    const aim = trackPose(t, sT);
    const lat = ai.lane * (1 - Math.min(1, Math.abs(wrapAngle(trackPose(t, sT + 10).a - aim.a)) * 3));
    const tx = aim.x - Math.cos(aim.a) * lat, tz = aim.z + Math.sin(aim.a) * lat;
    const diff = wrapAngle(Math.atan2(tx - c.x, tz - c.z) - c.a);
    let ax = clamp(-diff * 2.4, -1, 1);

    // Tempo: Kurven voraus (Krümmung) mit Bremsweg zurückrechnen
    let skill = race.track.def.skill * ai.skill;
    if (lead > -Infinity && lead < 1e5) {
      const gap = r.s - lead;
      if (gap > 60) skill *= 0.9; else if (gap < -60) skill *= 1.07;
    }
    const DEC = 8, MU = 9.5;
    let want = 60;
    const horizon = speed * speed / (2 * DEC) + 25;
    for (let d = 0; d < horizon; d += 6) {
      const a1 = trackPose(t, r.s + d).a, a2 = trackPose(t, r.s + d + 12).a;
      const k = Math.abs(wrapAngle(a2 - a1)) / 12;
      const vC = Math.sqrt(MU / Math.max(k, 1e-4));
      want = Math.min(want, Math.sqrt(vC * vC + 2 * DEC * d));
    }
    want *= skill;
    const done = r.place > 0 || race.phase === 'end';
    if (done) want = Math.min(want, 9);
    if (r.s > end - 25) want = 0;

    let ay = speed < want - 0.5 ? 1 : speed > want + 1.5 ? -1 : 0.25;
    if (Math.abs(diff) > 0.9 && speed > 9) ay = -0.7;
    let buttons = want === 0 && speed < 2 ? Btn.BRAKE : 0;
    if (!done && race.phase === 'run' && speed > 18 && ay > 0 && Math.abs(diff) < 0.08 && c.nitro > 0.3 && skill > 0.95) buttons |= Btn.SPRINT;

    // Festgefahren: zurücksetzen; überschlagen/weit weg: auf die Strecke setzen
    if (want > 3 && speed < 1.5) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt * 2);
    if (ai.stuck > 1.6 && ai.reverse <= 0) { ai.reverse = 1.3; ai.stuck = 0; }
    if (r.s > ai.bestS + 4 || want < 3) { ai.bestS = Math.max(ai.bestS, r.s); ai.noProg = 0; } else ai.noProg += dt;
    if (ai.reverse > 0) { ai.reverse -= dt; ay = -1; ax = -ax; buttons = 0; }
    const up = upVector(c);
    ai.flipT = up[1] < 0.4 ? ai.flipT + dt : 0;
    const here = trackPose(t, r.s);
    ai.offT = dist2(c.x, c.z, here.x, here.z) > 22 * 22 ? ai.offT + dt : 0;
    if (ai.flipT > 2.5 || ai.offT > 3 || ai.noProg > 8) {
      const back = trackPose(t, Math.max(0, r.s - 6));
      placeCar(this.h.map, c, v.sim.prof, back.x, back.z, back.a);
      ai.flipT = 0; ai.offT = 0; ai.stuck = 0; ai.reverse = 0; ai.noProg = 0;
      return;
    }
    for (let k = 0; k < steps(dt); k++) this.h.stepAi(v, ax, ay, buttons);
  }

  // ------------------------------------------------------------------ Anzeige
  view(p: ServerPlayer): QuestState | null {
    const race = this.byPlayer.get(p.id);
    if (!race) return null;
    const t = race.track, d = t.def;
    const base = { id: d.id, title: `🏁 ${d.name}`, stageIdx: 0, stageCount: 1, timer: -1, targets: [] as QuestState['targets'] };
    if (race.phase === 'lobby') {
      return { ...base, stage: 'Anmeldung läuft – andere Spieler können am Renntelefon beitreten.', prog: `Fahrer: ${race.members.length}/${RACE_MAX_PLAYERS} · Start in ${Math.max(0, Math.ceil(race.t))} s`, timer: Math.max(0, Math.ceil(race.t)) };
    }
    const me = race.racers.find((r) => r.pid === p.id);
    if (!me) return null;
    const rank = this.ranking(race);
    const place = rank.indexOf(me) + 1;
    const start = t.finish - t.lapLen * t.laps;
    const lap = clamp(Math.floor((me.s - start) / t.lapLen) + 1, 1, t.laps);
    const raceInfo = { place: me.place || place, field: RACE_FIELD, lap, laps: t.laps };
    if (race.phase === 'grid') {
      const cnt = Math.ceil(race.t);
      return { ...base, stage: 'Startaufstellung – gleich geht’s los!', prog: `Startplatz ${race.racers.indexOf(me) + 1} · ${RACE_FIELD} Starter`, freeze: true, count: cnt <= COUNT_FROM ? cnt : undefined, race: raceInfo };
    }
    if (me.place) {
      return { ...base, stage: `Im Ziel: Platz ${me.place} (${fmt(me.time)}) – warte auf die anderen …`, prog: '', race: raceInfo };
    }
    if (me.dnf) return { ...base, stage: 'Ausgeschieden.', prog: '' };
    const targets: QuestState['targets'] = [];
    const v = this.h.vehicles.get(me.vid);
    const inCar = p.vehicleId === me.vid;
    for (let k = me.cp; k < Math.min(t.checkpoints.length, me.cp + 2); k++) {
      const cp = trackPose(t, t.checkpoints[k]);
      targets.push([Math.round(cp.x * 10) / 10, Math.round(cp.z * 10) / 10, CHECKPOINT_RADIUS, k === t.checkpoints.length - 1 ? 7 : 2]);
    }
    if (!inCar && v) targets.unshift([v.sim.car.x, v.sim.car.z, 4, 6]);
    return {
      ...base,
      stage: inCar ? (me.cp === t.checkpoints.length - 1 ? 'Letzter Abschnitt – ab ins Ziel!' : 'Fahr durch die Checkpoints!') : 'Steig wieder in deinen Rennwagen!',
      prog: `Checkpoint ${Math.min(me.cp + 1, t.checkpoints.length)}/${t.checkpoints.length} · ${fmt(race.elapsed)}`,
      timer: Math.max(0, Math.ceil(race.limit - race.elapsed)),
      targets,
      count: race.elapsed < 1.2 ? 0 : undefined,
      race: raceInfo,
    };
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
