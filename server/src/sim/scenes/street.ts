// Straßenereignisse (Weltgeschehen, siehe Scenes.ts): Damit in Palmara ständig etwas los ist, löst der
// Server um jeden Spieler herum regelmäßig eines davon aus – gewichtet nach Viertel-DNA (Bandenstimmung,
// Polizeipräsenz, Heimat-/Rivalen-Gang):
//   Streife      – Streifenwagen mit Sirene rauschen vorbei.
//   Verfolgung   – Taschendieb rennt vorbei, zwei Polizisten zu Fuß und ein Streifenwagen hinterher.
//   Bandenkrieg  – zwei verfeindete Gangs, bis zu 5 gegen 5, schießen sich quer über die Straße an.
//   Razzia       – Streifenwagen rauschen an, Polizisten springen raus, Gefecht mit einer Gang.
//   Anquatscher  – ein Passant kommt zu dir und labert dich voll.
// Sprüche kommen aus den Fraktions-Profilen (Slang, Spitznamen für Rivalen, Polizei-Sprüche) und der
// Viertel-DNA (Sorgen, Gesprächsthemen).
import { dist2 } from '../../../../shared/src/math';
import { findFootSpot } from '../../../../shared/src/sim/movement';
import { WEAPONS } from '../../../../shared/src/weapons';
import { NpcEv } from '../../../../shared/src/npc/reactions';
import { ARCH_INDEX, archetypeOf, type ArchetypeId } from '../../../../shared/src/npc/archetypes';
import { Act } from '../../../../shared/src/npc/scenarios';
import { GANG_IDS, type GangId } from '../../../../shared/src/gangs';
import { GANG_PROFILES, POLICE, gangRelation } from '../../../../shared/src/factions';
import type { DistrictDNA } from '../../../../shared/src/world/districts';
import {
  BAILS, CHATTY_ARCHETYPES, FAREWELLS, MONOLOGUES, OPENERS, TOPIC_LINES, WORRY_LINES,
} from '../../../../shared/src/content/chatter';
import { OUTFIT_COLORS } from '../../../../shared/src/constants';
import { DRIVER_COP, type ServerPlayer, type ServerVehicle } from '../../entities/types';
import { GANG_OUTFIT } from '../Gangs';
import type { Ped } from '../Pedestrians';
import { project, Scene, type Lane, type SceneHost } from './Scene';
import { V_SEDAN } from './arrival';

const W = Object.keys(WEAPONS);
const PISTOL = W.indexOf('pistol'), SMG = W.indexOf('smg'), SHOTGUN = W.indexOf('shotgun');

export const STREET_NAMES = ['Streife', 'Verfolgung', 'Bandenkrieg', 'Razzia', 'Anquatscher'] as const;
export type StreetKind = 0 | 1 | 2 | 3 | 4;
/** Platzbedarf auf der Spur [Anlauf, nach s0]; der Anquatscher braucht keine Straße. */
export const STREET_NEED: [number, number][] = [[75, 40], [48, 40], [24, 24], [72, 26], [0, 0]];

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ Sprüche

function nick(g: GangId, about: GangId | 'police'): string {
  return pick(GANG_PROFILES[g].slang.rivalNicknames[about] ?? (about === 'police' ? ['Bullen'] : ['Clowns']));
}
function gangTaunt(g: GangId, enemy: GangId | 'police'): string {
  const n = nick(g, enemy), prof = GANG_PROFILES[g];
  const bare = n.replace(/^(die|der|das) /i, ''); // „ihr Disco-Kinder“ statt „ihr die Disco-Kinder“
  return pick([
    `Haut ab, ihr ${bare}!`, `Na, ${n}? Heute ohne Mama da?`, `Für ${prof.name}!`, prof.motto,
    `${n[0].toUpperCase()}${n.slice(1)}! Ihr seid sowas von erledigt!`, `Das ist UNSER Block!`,
  ]);
}
const CHEERS = ['Erwischt!', 'Einer weniger!', 'Wer ist der Nächste?', 'Ha! Lag am Outfit!', 'Sauber!'];
const OUCH = ['AUA!', 'Mein Lieblingshemd!', 'Ich bin getroffen! …Ach nee, doch nicht.', 'Das gibt ’nen blauen Fleck!'];
const RETREAT = ['Rückzug! RÜCKZUG!', 'Das war nur Aufwärmen!', 'Wir kommen wieder!', 'Taktischer Rückzug!'];
const COP_SHOUT = ['Polizei! Waffen runter!', 'Keine Bewegung!', 'Hier spricht die Polizei!', 'Wir brauchen Verstärkung! …Die steht im Stau.'];
const COP_WIN = ['Lage unter Kontrolle.', 'Das gibt Papierkram. VIEL Papierkram.', ...POLICE.expressions];

/** Zwei verfeindete Gangs fürs Viertel: Heim-Gang gegen einen Herausforderer, sonst die schlechteste Beziehung. */
export function rivalPair(dna: DistrictDNA | null): [GangId, GangId] {
  const home = dna?.homeGang, cont = dna?.contestedBy ?? [];
  if (home && cont.length) return [home, pick(cont)];
  if (cont.length >= 2) { const a = pick(cont); return [a, pick(cont.filter((g) => g !== a))]; }
  const pairs: [GangId, GangId, number][] = [];
  for (const a of GANG_IDS) for (const b of GANG_IDS) if (a < b) pairs.push([a, b, gangRelation(a, b)?.value ?? 0]);
  const pool = pairs.filter((p) => (cont.length ? p[0] === cont[0] || p[1] === cont[0] : true)).sort((x, y) => x[2] - y[2]).slice(0, 2);
  const [a, b] = pick(pool);
  return Math.random() < 0.5 ? [a, b] : [b, a];
}
/** Gang, die im Viertel Ärger macht (Heim-Gang oder Herausforderer). */
export function localGang(dna: DistrictDNA | null): GangId {
  const opts = [dna?.homeGang, ...(dna?.contestedBy ?? [])].filter(Boolean) as GangId[];
  return opts.length ? pick(opts) : pick(GANG_IDS);
}

// ------------------------------------------------------------------ Streife

/** Ein oder zwei Streifenwagen mit Sirene rauschen vorbei. */
export class PatrolEvent extends Scene {
  readonly name = STREET_NAMES[0];
  readonly duration = 0;
  private units: ServerVehicle[];
  private speed = 15 + Math.random() * 3;
  private sirenT = 0;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    this.clearRoute(-75, 40);
    const n = Math.random() < 0.45 ? 2 : 1;
    this.units = [-62, -72].slice(0, n).map((ds) => this.car(V_SEDAN, ds, 0, DRIVER_COP, 3, this.speed));
  }

  protected update(dt: number): boolean {
    this.sirenT -= dt;
    for (const v of this.units) {
      this.drive(v, this.speed);
      if (this.sirenT <= 0 && this.exists(v)) this.h.perceive(NpcEv.Siren, v.sim.car.x, v.sim.car.z);
    }
    if (this.sirenT <= 0) this.sirenT = 1.5;
    this.focus = this.exists(this.units[0]) ? project(this.lane.pts, this.lane.cum, this.units[0].sim.car.x, this.units[0].sim.car.z).s - this.lane.s0 : 0;
    return (this.t < 4 || this.sweepDriving()) && this.t < 30;
  }
}

// ------------------------------------------------------------------ Verfolgung zu Fuß

const THIEF_LINES = ['Ich hab nix gemacht!', 'Die Handtasche hat MICH geklaut!', 'Ihr kriegt mich nie!', 'Aus dem Weg!'];
const CHASE_COP = ['Stehen bleiben! Polizei!', 'Ich hab zwei Wochen bis zum Urlaub!', 'Halt! Im Namen des Pelikans!'];

/** Taschendieb auf dem Gehweg gegenüber, zwei Polizisten zu Fuß und ein Streifenwagen hinterher. */
export class FootChaseEvent extends Scene {
  readonly name = STREET_NAMES[1];
  readonly duration = 0;
  private thief: Ped;
  private cops: Ped[];
  private unit: ServerVehicle;
  private ts = -26;
  private caught = -1;
  private escapes = Math.random() < 0.4;
  private ended = false;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer) {
    super(h, lane, viewer);
    this.clearRoute(-48, 40);
    const a = this.walkSide(this.ts, true);
    this.thief = this.ped(a.x, a.z, Math.floor(Math.random() * OUTFIT_COLORS.length), -1, 60);
    this.cops = [-7, -10].map((d) => { const q = this.walkSide(this.ts + d, true); return this.officer(q.x, q.z); });
    this.unit = this.car(V_SEDAN, this.ts - 16, 0, DRIVER_COP, 3, 8);
  }

  protected update(dt: number): boolean {
    const th = this.thief;
    this.focus = this.ts;
    if (this.ended) return this.wrapUp();
    if (this.once('a', 0.3)) this.say(th, pick(THIEF_LINES));
    if (this.once('b', 1.2)) this.say(this.cops[0], pick(CHASE_COP));
    if (this.caught < 0) {
      // Dieb rennt den Gehweg entlang, die Polizisten hinterher
      this.ts += 6.1 * dt;
      const q = this.walkSide(this.ts + 3, true);
      this.run(th, q.x, q.z, dt, 6.1);
      for (const c of this.cops) {
        this.run(c, th.x, th.z, dt, this.escapes && this.t > 6 ? 5.6 : 7.2);
        if (this.standing(c) && this.standing(th) && dist2(c.x, c.z, th.x, th.z) < 1.4 * 1.4) {
          this.caught = this.t;
          this.h.peds.knock(th, (th.x - c.x) * 2, (th.z - c.z) * 2, 2.5);
          break;
        }
      }
      if (this.once('c', 4)) this.say(th, this.escapes ? 'Haha! Eingeölt!' : 'Ich hab Seitenstechen!');
      if (this.escapes && this.t > 9) {
        if (this.once('d', 9)) this.say(this.cops[1], 'Ich… brauch… ’ne Pause.');
        if (this.t > 10.5) { this.release(th, this.cops[0].x, this.cops[0].z); for (const c of this.cops) this.stroll(c); this.ended = true; }
      }
      if (!this.alive(th) || this.t > 20) { for (const c of this.cops) this.stroll(c); this.ended = true; }
    } else {
      const since = this.t - this.caught;
      for (const c of this.cops) this.face(c, th.x, th.z);
      if (this.once('e', this.caught + 0.6)) this.say(this.cops[0], 'Sie haben das Recht zu schweigen. Bitte nutzen Sie es.');
      if (this.once('f', this.caught + 2.4)) { this.say(th, 'Ich wollte die Handtasche nur zurückbringen!'); th.act = Act.Cower; }
      if (this.once('g', this.caught + 4.4)) this.say(this.cops[1], 'Erzählen Sie das dem Richter.');
      if (since > 7) {
        // abführen: alle schlendern davon (der Dieb geduckt, die Polizisten hinterher)
        this.stroll(th, 20); for (const c of this.cops) this.stroll(c, 20);
        this.ended = true;
      }
    }
    // Streifenwagen fährt auf Höhe des Diebs mit
    const cs = this.exists(this.unit) ? project(this.lane.pts, this.lane.cum, this.unit.sim.car.x, this.unit.sim.car.z).s - this.lane.s0 : 0;
    this.drive(this.unit, this.caught >= 0 ? 0 : Math.max(0, Math.min(15, (this.ts - 4 - cs) * 1.6)));
    return true;
  }

  /** Nach der Jagd: Streifenwagen fährt weiter, bis er aus dem Bild ist. */
  private wrapUp(): boolean {
    this.drive(this.unit, 13);
    return this.sweepDriving() && this.t < 40;
  }
}

// ------------------------------------------------------------------ Bandenkrieg

/** Zwei verfeindete Gangs, bis zu 5 gegen 5, quer über die Straße. Nach einer Weile kommt die Polizei. */
export class GangWarEvent extends Scene {
  readonly name = STREET_NAMES[2];
  readonly duration = 0;
  private gangs: [GangId, GangId];
  private over = -1;
  private unit: ServerVehicle | null = null;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer, dna: DistrictDNA | null) {
    super(h, lane, viewer);
    this.gangs = rivalPair(dna);
    // Mitte etwas seitlich vom Spieler: halb im Bild, der Rest lockt mit Schüssen
    const c = 12 * this.flip;
    this.focus = c;
    const n = 4 + (Math.random() < 0.6 ? 1 : 0);
    for (const team of [0, 1] as const) {
      for (let i = 0; i < n; i++) {
        const q = this.walkSide(c - 7 + (14 * i) / (n - 1) + (Math.random() - 0.5) * 1.5, team === 0);
        const wpn = pick([PISTOL, PISTOL, SMG, SHOTGUN]);
        const p = this.ped(q.x, q.z, GANG_OUTFIT[this.gangs[team]], wpn, 45);
        this.addFighter(p, team, wpn);
      }
    }
    // Anfangs schauen sich alle über die Straße an
    for (const f of this.fighters) { const o = this.fighters.find((g) => g.team !== f.team)!; this.face(f.ped, o.ped.x, o.ped.z); f.cd += 1.8; }
  }

  protected update(dt: number): boolean {
    const [ga, gb] = this.gangs;
    const lead = (team: 0 | 1) => this.standingIn(team)[0]?.ped;
    if (this.once('a', 0.3)) { const p = lead(0); if (p) this.say(p, gangTaunt(ga, gb)); }
    if (this.once('b', 1.4)) { const p = lead(1); if (p) this.say(p, gangTaunt(gb, ga)); }
    if (this.over < 0) {
      this.fight(dt, (shooter) => { if (Math.random() < 0.6) this.say(shooter.ped, pick(CHEERS), 'c' + this.t.toFixed(2)); });
      // Hin und wieder ein Spruch mitten im Gefecht
      if (Math.random() < dt * 0.35) { const f = pick(this.fighters); if (this.standing(f.ped)) this.say(f.ped, gangTaunt(this.gangs[f.team], this.gangs[1 - f.team]), 'mid' + this.t.toFixed(1)); }
      const a = this.aliveIn(0).length, b = this.aliveIn(1).length;
      // Nach 16 s kommt ein Streifenwagen mit Sirene
      if (!this.unit && this.t > 16) this.unit = this.car(V_SEDAN, this.focus - 70, 0, DRIVER_COP, 3, 15);
      const copsHere = this.unit && this.exists(this.unit) && Math.abs(project(this.lane.pts, this.lane.cum, this.unit.sim.car.x, this.unit.sim.car.z).s - this.lane.s0 - this.focus) < 25;
      if (a <= 1 || b <= 1 || copsHere || this.t > 34) {
        this.over = this.t;
        const loser: 0 | 1 = copsHere ? 0 : a < b ? 0 : 1;
        for (const f of this.aliveIn(loser)) { this.say(f.ped, copsHere ? `Achtung, ${nick(this.gangs[f.team], 'police')}!` : pick(RETREAT), 'r' + f.ped.id); }
        for (const f of copsHere ? this.fighters : this.aliveIn(loser)) this.release(f.ped, this.at(this.focus).x, this.at(this.focus).z);
        if (!copsHere) for (const f of this.standingIn((1 - loser) as 0 | 1)) this.say(f.ped, pick(['Das ist UNSER Viertel!', ...GANG_PROFILES[this.gangs[f.team]].slang.farewells]), 'w' + f.ped.id);
      }
    } else if (this.t - this.over > 3 && this.once('scatter', 0)) {
      for (const f of this.fighters) this.release(f.ped, this.at(this.focus).x, this.at(this.focus).z);
    }
    if (this.unit) this.drive(this.unit, this.over >= 0 && this.t - this.over < 4 ? 4 : 15);
    if (this.over >= 0 && this.t - this.over > 4) return (!this.unit || this.sweepDriving()) && this.t < 60;
    return true;
  }
}

// ------------------------------------------------------------------ Razzia

/** Gang hängt am Straßenrand ab, Streifenwagen rauschen an, Polizisten springen raus – Gefecht. */
export class RaidEvent extends Scene {
  readonly name = STREET_NAMES[3];
  readonly duration = 0;
  private gang: GangId;
  private units: ServerVehicle[];
  private stops: number[];
  private landed: boolean[];
  private over = -1;
  private copsWon = false;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer, dna: DistrictDNA | null) {
    super(h, lane, viewer);
    this.gang = localGang(dna);
    const c = 11 * this.flip;
    this.focus = c;
    this.clearRoute(-75, 26);
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const q = this.walkSide(c - 3 + i * 2.6, true);
      const wpn = pick([PISTOL, SMG, SHOTGUN]);
      const p = this.ped(q.x, q.z, GANG_OUTFIT[this.gang], wpn, 50);
      p.act = pick([Act.Talk, Act.Smoke, Act.Phone]);
      this.addFighter(p, 1, wpn);
    }
    // Wagen halten vor bzw. (bei gespiegelter Szene) hinter der Gang, die Fahrzeuge dienen als Deckung
    // vorderer Wagen hält weiter vorne (sonst müsste der hintere überholen)
    this.stops = [c - 11 * this.flip, c - 17 * this.flip].sort((a, b) => b - a);
    this.units = [-58, -66].map((ds) => this.car(V_SEDAN, ds, 0, DRIVER_COP, 3, 15));
    this.landed = [false, false];
  }

  protected update(dt: number): boolean {
    const gangFs = this.fighters.filter((f) => f.team === 1);
    this.units.forEach((v, i) => {
      if (!this.exists(v)) return;
      const cs = project(this.lane.pts, this.lane.cum, v.sim.car.x, v.sim.car.z).s - this.lane.s0;
      if (this.landed[i]) { this.drive(v, this.over >= 0 && this.t - this.over > 8 ? 12 : 0); return; }
      const left = this.stops[i] - cs;
      this.drive(v, Math.max(0, Math.min(16, left * 1.3)));
      const speed = Math.hypot(v.sim.car.vx, v.sim.car.vz);
      if ((left < 2 && speed < 1.5) || this.t > 14) {
        // Polizisten steigen auf der Straßenseite aus (Auto als Deckung zwischen ihnen und der Gang)
        this.landed[i] = true;
        for (const off of [-1.3, 1.3]) {
          const q = this.at(cs + off, -2.6);
          const spot = findFootSpot(this.h.map, q.x, q.z, 3) ?? q;
          const cop = this.officer(spot.x, spot.z);
          this.addFighter(cop, 0, PISTOL);
          if (off < 0) this.say(cop, pick(COP_SHOUT), 'cop' + i);
        }
      }
    });
    const near = this.units.some((v) => this.exists(v) && dist2(v.sim.car.x, v.sim.car.z, this.at(this.focus).x, this.at(this.focus).z) < 35 * 35);
    if (near && this.once('alarm', 0)) {
      const p = gangFs.find((f) => this.standing(f.ped))?.ped;
      if (p) this.say(p, `Achtung, ${nick(this.gang, 'police')}!`);
      for (const f of gangFs) f.ped.act = 0;
    }
    if (this.over < 0) {
      if (this.landed.some(Boolean)) {
        this.fight(dt, (s) => { if (Math.random() < 0.5) this.say(s.ped, s.team === 0 ? pick(['Verdächtiger am Boden!', 'Einer weniger!']) : pick(CHEERS), 'd' + this.t.toFixed(2)); });
        if (Math.random() < dt * 0.3) {
          const f = pick(this.fighters);
          if (this.standing(f.ped)) this.say(f.ped, f.team === 0 ? pick(POLICE.sampleLines) : gangTaunt(this.gang, 'police'), 'm' + this.t.toFixed(1));
        }
      }
      const cops = this.aliveIn(0).length, gang = this.aliveIn(1).length;
      const started = this.landed.every(Boolean);
      if ((started && (gang <= 1 || cops === 0)) || this.t > 45) {
        this.over = this.t;
        this.copsWon = gang <= cops;
        for (const f of this.aliveIn(1)) { this.say(f.ped, pick(RETREAT), 'r' + f.ped.id); this.release(f.ped, this.at(this.focus).x, this.at(this.focus).z); }
        const boss = this.standingIn(0)[0]?.ped;
        if (boss) this.say(boss, this.copsWon ? pick(COP_WIN) : 'Wir ziehen uns zurück! …Ordentlich!');
      }
    } else {
      // Nach dem Gefecht: Polizisten gehen zurück zu ihren Wagen und „steigen ein“
      const since = this.t - this.over;
      for (const f of this.fighters) {
        if (f.team !== 0 || !this.standing(f.ped) || since < 3) continue;
        const v = this.units.reduce((a, b) => (dist2(a.sim.car.x, a.sim.car.z, f.ped.x, f.ped.z) < dist2(b.sim.car.x, b.sim.car.z, f.ped.x, f.ped.z) ? a : b));
        const d = this.run(f.ped, v.sim.car.x, v.sim.car.z, dt, 2.2);
        if (d < 2.6) this.h.peds.peds.delete(f.ped.id);
      }
      if (since > 8) return this.sweepDriving() && this.t < 80;
    }
    return true;
  }
}

// ------------------------------------------------------------------ Anquatscher

/** Ein Passant kommt auf den Spieler zu und labert ihn voll; läuft der Spieler weg, beschwert er sich. */
export class TalkerEvent extends Scene {
  readonly name = STREET_NAMES[4];
  readonly duration = 0;
  private p: Ped;
  private lines: string[];
  private phase: 'approach' | 'talk' | 'done' = 'approach';
  private next = 0;
  private idx = 0;
  private n = 0;

  constructor(h: SceneHost, lane: Lane, viewer: ServerPlayer, dna: DistrictDNA | null, spot: { x: number; z: number }) {
    super(h, lane, viewer);
    const arch: ArchetypeId = pick(CHATTY_ARCHETYPES);
    const def = archetypeOf(ARCH_INDEX[arch]);
    this.p = this.ped(spot.x, spot.z, def.shirts ? pick(def.shirts) : Math.floor(Math.random() * OUTFIT_COLORS.length));
    this.p.arch = ARCH_INDEX[arch];
    const mono = pick(MONOLOGUES.filter((m) => !m.arch || m.arch.includes(arch))).lines;
    const extra: string[] = [];
    if (dna && Math.random() < 0.6) {
      const r = Math.random();
      if (r < 0.4 && dna.worries.length) extra.push(pick(WORRY_LINES).replace('{worry}', pick(dna.worries)));
      else if (r < 0.75) { const topics = Object.values(dna.topics); if (topics.length) extra.push(pick(TOPIC_LINES).replace('{topic}', pick(topics))); }
      else if (dna.sampleLines.length) extra.push(pick(dna.sampleLines));
    }
    this.lines = [pick(OPENERS), ...mono, ...extra, pick(FAREWELLS)];
  }

  /** Sprechblase mit festem Schlüssel je Zeile. */
  private line(text: string) { this.say(this.p, text, 'l' + this.n++); }

  protected update(dt: number): boolean {
    const p = this.p, v = this.viewer;
    if (!this.alive(p) || !this.h.players.has(v.id)) return false;
    const pos = this.h.positionOf(v);
    const d = Math.hypot(pos.x - p.x, pos.z - p.z);
    if (this.phase === 'approach') {
      if (d < 2.4) { this.phase = 'talk'; this.next = 0; }
      else {
        this.run(p, pos.x, pos.z, dt, d > 6 ? 2.6 : 1.8);
        p.flee = d > 6 ? 1 : 0; // nah dran: gehen statt rennen
        if (this.t > 14 || pos.inVehicle) return this.finish();
      }
      return true;
    }
    if (this.phase === 'talk') {
      if (pos.inVehicle || d > 15) { this.line(pick(BAILS)); return this.finish(); }
      if (d > 2.8) { this.run(p, pos.x, pos.z, dt, d > 6 ? 4.2 : 2); if (d > 6 && this.once('wait', 0)) this.line('Warte doch mal!'); }
      else { this.face(p, pos.x, pos.z); p.act = Act.Talk; }
      this.next -= dt;
      if (this.next <= 0) {
        if (this.idx >= this.lines.length) return this.finish();
        this.line(this.lines[this.idx++]);
        this.next = 2.9;
      }
      return true;
    }
    return this.t < 120;
  }

  private finish(): boolean {
    this.phase = 'done';
    this.stroll(this.p, 25);
    return false;
  }
}
