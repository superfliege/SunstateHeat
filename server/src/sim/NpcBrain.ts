// Gehirn der verwalteten Passanten (Schritt 3 + 4): führt die Absichtskette aus (shared/npc/intents.ts),
// wählt Smart Objects per Bedürfnis-Utility, plant Wege über das Gehweg-Netz (Dijkstra über die
// Straßenknoten), lässt NPCs die Welt glaubwürdig verlassen (Tür, Bus, geparktes Auto) und spielt die
// Reaktionen ab, die Perception auswählt (hinschauen, filmen, flüchten …). Kurzzeitgedächtnis: wer
// einen Vorfall gesehen hat, meidet den Verursacher 60 s lang.
//
// Detailstufen (spec Schritt 9): NPCs, die weiter als 40 m von allen Spielern entfernt sind, denken
// seltener (1 Hz statt ~3 Hz); Bewegung läuft für alle im Tick.
import { dist2 } from '../../../shared/src/math';
import { archetypeOf } from '../../../shared/src/npc/archetypes';
import {
  EXIT_PREF, GOAL_PER_STEP, NEED_RATE, NEED_START, isExit, pickChain, utility,
  type ExitStep, type IntentStep, type Needs,
} from '../../../shared/src/npc/intents';
import type { DayPart } from '../../../shared/src/npc/population';
import { FEAR_MEMORY, type ReactionId } from '../../../shared/src/npc/reactions';
import {
  Act, SCENARIOS, SMART_KINDS, SmartKind, scenarioAllowed, slotWorld, type ScenarioDef, type ScenarioId, type SmartKindId,
} from '../../../shared/src/npc/scenarios';
import { stepPawn } from '../../../shared/src/sim/movement';
import { generateSmartObjects, type SmartObject } from '../../../shared/src/world/smartObjects';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_NONE, type ServerVehicle } from '../entities/types';
import type { BarkSit } from '../../../shared/src/npc/barks';
import { FLEE_SPEED, nearestIdx, type Ped, type PedBrain, type Pedestrians, type Threat, type Walkway } from './Pedestrians';

/** Ziel eines Schritts: Smart-Object-Slot, Tür, geparktes Auto. */
export interface Goal {
  kind: 'obj' | 'car';
  sc: ScenarioId | null;
  exit: ExitStep | null;
  obj: number; slot: number; car: number;
  x: number; z: number; a: number;
  /** Gehweg + Index, von dem aus der NPC den Gehweg verlässt (null = direkt hingehen) */
  walk: Walkway | null; idx: number;
  /** Noch zu laufende Kanten (Straßengraph) bis zum Ziel-Gehweg */
  route: number[];
  phase: 'route' | 'approach';
  t: number;
  /** Kettenschritt, zu dem das Ziel gehört (bei Abbruch wird er wiederholt) */
  step: number;
}

export interface Reaction { id: ReactionId; t: number; ev: number; x: number; z: number; src: number }

export interface Mind {
  chain: IntentStep[];
  /** Index des nächsten Kettenschritts */
  step: number;
  needs: Needs;
  courage: number;
  /** Neigt zum Filmen (Touristen, Partygänger) */
  filmer: boolean;
  goal: Goal | null;
  react: Reaction | null;
  fear: { pid: number; t: number } | null;
  /** Weicht gerade dem Verursacher aus (hat den Gehweg verlassen) */
  avoiding: boolean;
  barkCd: number;
  strollT: number;
  think: number;
  /** Verlässt die Welt (Kette fertig, wartet z. B. auf den Bus) */
  leaving: boolean;
  /** > 0: geht gerade durch die Tür / steigt ins Auto (Sekunden) */
  exitT: number;
  exitCar: number;
  /** Detailstufe: 0 = nah (< 40 m zu einem Spieler), 1 = mittel */
  lod: 0 | 1;
  /** Entscheidungs-Takt fällig (nah ~3 Hz, mittel 1 Hz) */
  decide: boolean;
  /** Debug: zuletzt wahrgenommene Ereignisse [Ereignis-ID, Restzeit] */
  seen: [number, number][];
  /** Debug: letzte Entscheidung */
  last: string;
}

export interface BrainHost {
  map: WorldMap;
  peds: Pedestrians;
  vehicles: Map<number, ServerVehicle>;
  part(): DayPart;
  /** Spielerposition (null = nicht da) */
  player(id: number): { x: number; z: number; veh: boolean } | null;
  players(): { x: number; z: number }[];
  bark(p: Ped, sit: BarkSit): boolean;
  /** Geparktes Auto fährt mit dem NPC davon. */
  departCar(v: ServerVehicle): void;
}

const NEAR_LOD = 40;
const OBJ_RANGE = 110;
const CAR_RANGE = 70;
const DOOR_RANGE = 160;
const ENTER_TIME = 1.2;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class NpcBrain implements PedBrain {
  readonly objects: SmartObject[];
  private objWalk = new Map<number, { w: Walkway; idx: number } | null>();
  /** Reservierungen: Objekt*16+Slot → Ped-ID (gültig, solange der NPC Ziel/Szenario dort hat) */
  private res = new Map<number, number>();
  /** Für Autos: Fahrzeug-ID → Ped-ID */
  private carRes = new Map<number, number>();
  /** Zähler (Lasttest/Debug) */
  stats = { door: 0, car: 0, bus: 0, objScn: 0, freeScn: 0, meet: 0, routes: 0, routeFail: 0, aborts: 0 };

  constructor(private h: BrainHost) {
    this.objects = generateSmartObjects(h.map);
  }

  // ------------------------------------------------------------------ Einrichtung
  /** Neuer verwalteter NPC: Bedürfnisse, Mut, Absichtskette. inScenario = startet direkt in einem Szenario. */
  initMind(p: Ped, part: DayPart, inScenario: boolean) {
    const def = archetypeOf(p.arch);
    const base = NEED_START[def.id] ?? {};
    const needs: Needs = {
      hunger: clamp01((base.hunger ?? 0.25) + rnd(-0.2, 0.25)),
      boredom: clamp01((base.boredom ?? 0.3) + rnd(-0.2, 0.25)),
      fatigue: clamp01((base.fatigue ?? 0.25) + rnd(-0.2, 0.25)),
      goal: inScenario ? 0.25 : 0,
    };
    let chain = pickChain(def.id, part, Math.random());
    if (inScenario && chain.length > 2) chain = chain.slice(1); // das aktuelle Szenario zählt als erster Schritt
    p.mind = {
      chain, step: 0, needs, courage: clamp01(def.courage + rnd(-0.15, 0.15)),
      filmer: def.id === 'tourist' || def.id === 'partygoer' || (def.id === 'beachgoer' && Math.random() < 0.5) || (def.id === 'local' && Math.random() < 0.3),
      goal: null, react: null, fear: null, avoiding: false, barkCd: rnd(2, 10),
      strollT: inScenario ? 0 : rnd(4, 14), think: rnd(0, 0.5), leaving: false, exitT: 0, exitCar: -1,
      lod: 0, decide: false, seen: [], last: inScenario ? 'startet im Szenario' : 'schlendert los',
    };
    if (p.scn && p.scn.obj >= 0) this.res.set(p.scn.obj * 16 + p.scn.slot, p.id);
  }

  // ------------------------------------------------------------------ Reservierungen
  isFree(obj: number, slot: number, me = -1): boolean {
    const k = obj * 16 + slot;
    const id = this.res.get(k);
    if (id === undefined || id === me) return true;
    const o = this.h.peds.peds.get(id);
    const valid = !!o && ((o.scn?.obj === obj && o.scn.slot === slot) || (o.mind?.goal?.obj === obj && o.mind.goal.slot === slot));
    if (!valid) { this.res.delete(k); return true; }
    return false;
  }
  reserve(obj: number, slot: number, id: number) { this.res.set(obj * 16 + slot, id); }
  private carFree(vid: number, me: number): boolean {
    const id = this.carRes.get(vid);
    if (id === undefined || id === me) return true;
    const o = this.h.peds.peds.get(id);
    if (!o || o.mind?.goal?.car !== vid && o.mind?.exitCar !== vid) { this.carRes.delete(vid); return true; }
    return false;
  }

  // ------------------------------------------------------------------ Tick (Bewegung + Entscheidungen)
  tick(p: Ped, dt: number, threats: Threat[]) {
    const m = p.mind!;
    m.barkCd -= dt;
    m.think -= dt;
    if (m.think <= 0) {
      m.lod = this.nearestPlayer2(p.x, p.z) < NEAR_LOD * NEAR_LOD ? 0 : 1;
      m.think = m.lod ? 1 : 0.35;
      m.decide = true;
    }
    for (let i = m.seen.length - 1; i >= 0; i--) if ((m.seen[i][1] -= dt) <= 0) m.seen.splice(i, 1);
    if (m.fear && (m.fear.t -= dt) <= 0) { m.fear = null; }
    if (p.angry > 0) p.angry -= dt;

    // Durch die Tür / ins Auto: kurz weitergehen, dann verschwinden
    if (m.exitT > 0) {
      m.exitT -= dt;
      const sp = m.exitCar >= 0 ? 0.6 : 1.0;
      p.x += Math.sin(p.a) * sp * dt; p.z += Math.cos(p.a) * sp * dt;
      if (m.exitT <= 0) this.finishExit(p);
      return;
    }

    // Schnelles Fahrzeug in der Nähe: zur Seite springen / weglaufen (Bark „fast angefahren“)
    if (!m.react || (m.react.id !== 'flee' && m.react.id !== 'panic')) {
      for (const t of threats) {
        if (Math.abs(t.speed) < 5) continue;
        const dx = p.x - t.x, dz = p.z - t.z;
        if (dx * dx + dz * dz > 24 * 24) continue;
        // Kollisionskurs? Nächste Annäherung in den nächsten 1,4 s (Autos, die brav vorbeifahren, stören nicht)
        const v2 = t.vx * t.vx + t.vz * t.vz;
        const tc = Math.max(0, Math.min(1.4, (dx * t.vx + dz * t.vz) / v2));
        const cx = dx - t.vx * tc, cz = dz - t.vz * tc;
        if (cx * cx + cz * cz > 2.4 * 2.4) continue;
        // seitlich wegspringen (weg von der Fahrlinie), bei sehr knapper Zeit einfach weg
        const l = Math.hypot(cx, cz) || 1;
        p.fdx = cx / l; p.fdz = cz / l;
        if (l < 0.05) { const sv = Math.sqrt(v2); p.fdx = -t.vz / sv; p.fdz = t.vx / sv; }
        this.react(p, tc < 0.5 ? 'dodge' : 'flee', tc < 0.5 ? 0.9 : 1.8, -1, p.x - p.fdx, p.z - p.fdz, -1);
        if (Math.random() < 0.5) this.h.bark(p, 'near_miss');
        break;
      }
    }

    if (m.react) { this.doReaction(p, dt); return; }
    if (p.flee > 0) {
      // nach einem Ragdoll-Flug o. Ä.: weglaufen, dann zurück auf den Gehweg
      p.flee -= dt;
      stepPawn(this.h.map, p, p.fdx, -p.fdz, 0, dt, FLEE_SPEED);
      if (p.flee <= 0) this.rejoin(p);
      return;
    }
    if (m.fear && this.avoidFeared(p, dt)) return;

    if (p.scn) {
      p.scn.t -= dt;
      const r = SCENARIOS[p.scn.id].relief;
      if (r) for (const k of ['hunger', 'boredom', 'fatigue'] as const) if (r[k]) m.needs[k] = Math.max(0, m.needs[k] - r[k]! * dt / 25);
      if (p.scn.t <= 0) this.endScenario(p);
      return;
    }

    // Bedürfnisse steigen beim Laufen
    m.needs.hunger = Math.min(1, m.needs.hunger + NEED_RATE.hunger * dt);
    m.needs.boredom = Math.min(1, m.needs.boredom + NEED_RATE.boredom * dt);
    m.needs.fatigue = Math.min(1, m.needs.fatigue + NEED_RATE.fatigue * dt);
    m.needs.goal = Math.min(1, m.needs.goal + NEED_RATE.goal * dt);

    if (m.goal) { this.navigate(p, dt); return; }
    if (p.wait > 0) { p.wait -= dt; return; }

    if (m.decide) {
      m.decide = false;
      if (m.strollT > 0) m.strollT -= m.lod ? 1 : 0.35;
      else this.nextStep(p);
      if (m.goal || p.scn) return;
    }
    if (!p.walk) { this.rejoin(p); return; }
    this.h.peds.walkStep(p, dt);
  }

  // ------------------------------------------------------------------ Absichtskette
  private nextStep(p: Ped) {
    const m = p.mind!;
    if (m.leaving) { m.strollT = 20; return; } // kein Ausgang gefunden: weiterlaufen, Population entfernt außer Sicht
    if (m.step >= m.chain.length) m.chain.push(m.needs.goal > 0.6 || m.chain.length >= 4 ? 'exit' : 'need');
    const idx = m.step++;
    const step = m.chain[idx];
    if (step === 'stroll') { m.strollT = rnd(12, 30); m.last = 'schlendert'; return; }
    if (step === 'meet') {
      if (!this.meet(p)) { m.strollT = rnd(6, 14); m.last = 'niemanden getroffen'; }
      return;
    }
    if (isExit(step)) { this.startExit(p, step, idx); return; }
    if (step === 'need') { this.chooseByNeed(p, idx); return; }
    const sc = SCENARIOS[step];
    if (!sc || !scenarioAllowed(sc, this.h.part()) || !this.startScenarioStep(p, sc, idx)) this.chooseByNeed(p, idx);
  }

  /** Utility-Wahl: alle erlaubten Szenarien des Archetyps, Smart Objects in Reichweite bewertet nach Weg. */
  private chooseByNeed(p: Ped, idx: number) {
    const m = p.mind!;
    const part = this.h.part();
    const def = archetypeOf(p.arch);
    let best: { sc: ScenarioDef; o: SmartObject | null; slot: number; u: number } | null = null;
    for (const id of def.scenarios) {
      const sc = SCENARIOS[id];
      if (!scenarioAllowed(sc, part) || sc.id === 'busk' || sc.id === 'busk_watch') continue;
      if (!sc.where) {
        if (sc.group) continue;
        const u = utility(m.needs, sc, 0) * 0.7 + Math.random() * 0.12;
        if (!best || u > best.u) best = { sc, o: null, slot: 0, u };
        continue;
      }
      const c = this.findObject(p, sc);
      if (!c) continue;
      const u = utility(m.needs, sc, c.d) + Math.random() * 0.12;
      if (!best || u > best.u) best = { sc, o: c.o, slot: c.slot, u };
    }
    if (!best || best.u < 0.16) { m.strollT = rnd(10, 22); m.last = 'nichts Passendes – schlendert'; return; }
    if (best.o) this.goTo(p, best.o, best.slot, best.sc.id, null, idx);
    else this.startFree(p, best.sc);
    m.last = `Bedürfnis → ${best.sc.name} (${best.u.toFixed(2)})`;
  }

  private startScenarioStep(p: Ped, sc: ScenarioDef, idx: number): boolean {
    if (!sc.where) {
      if (sc.id === 'talk') return this.meet(p);
      if (sc.group) return false;
      this.startFree(p, sc);
      p.mind!.last = sc.name;
      return true;
    }
    const c = this.findObject(p, sc);
    if (!c) return false;
    this.goTo(p, c.o, c.slot, sc.id, null, idx);
    p.mind!.last = `geht zu ${SMART_KINDS[c.o.kind].name}: ${sc.name}`;
    return true;
  }

  /** Nächstes freies Objekt mit passendem Slot (Weg gewichtet, etwas Zufall gegen Gleichschritt). */
  private findObject(p: Ped, sc: ScenarioDef): { o: SmartObject; slot: number; d: number } | null {
    let best: { o: SmartObject; slot: number; d: number } | null = null, bs = Infinity;
    for (const o of this.objects) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d > OBJ_RANGE) continue;
      for (const wh of sc.where!) {
        if (wh.kind !== o.kind) continue;
        const slots = sc.id === 'club_queue' ? wh.slots : [...wh.slots].sort(() => Math.random() - 0.5);
        for (const s of slots) {
          if (!this.isFree(o.id, s, p.id)) continue;
          const score = d * (0.7 + Math.random() * 0.6);
          if (score < bs) { bs = score; best = { o, slot: s, d }; }
          break;
        }
      }
    }
    return best;
  }

  /** Freies Szenario am aktuellen Ort (Telefonieren, Rauchen, Fotos). */
  private startFree(p: Ped, sc: ScenarioDef) {
    const m = p.mind!;
    let a = p.a;
    if (p.walk) {
      const w = p.walk, i = Math.max(1, Math.min(w.pts.length - 1, p.idx));
      const along = Math.atan2(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]);
      a = along + (w.side > 0 ? -1 : 1) * Math.PI / 2 + (sc.id === 'photo' ? Math.PI : 0) + rnd(-0.4, 0.4);
    }
    const t = rnd(sc.dur[0], sc.dur[1]) * 0.7;
    this.h.peds.startScenario(p, { id: sc.id, obj: -1, slot: 0, dur: t, t }, sc.act, p.x, p.z, a);
    this.stats.freeScn++;
    m.needs.goal = Math.min(1, m.needs.goal + GOAL_PER_STEP * 0.5);
  }

  /** „Bekannte treffen“: ein anderer laufender NPC in der Nähe bleibt stehen, beide reden. */
  private meet(p: Ped): boolean {
    let other: Ped | null = null, bd = 9 * 9;
    for (const o of this.h.peds.peds.values()) {
      if (o === p || !o.mind || o.scn || o.mind.goal || o.mind.react || o.mind.leaving || o.mind.exitT > 0 || o.rt > 0 || !o.walk) continue;
      const d = dist2(o.x, o.z, p.x, p.z);
      if (d < bd) { bd = d; other = o; }
    }
    if (!other) return false;
    const mx = (p.x + other.x) / 2, mz = (p.z + other.z) / 2;
    const a = Math.atan2(other.x - p.x, other.z - p.z);
    const t = rnd(15, 35);
    const place = (q: Ped, sign: number) => {
      const x = mx - Math.sin(a) * 0.75 * sign, z = mz - Math.cos(a) * 0.75 * sign;
      this.h.peds.startScenario(q, { id: 'talk', obj: -1, slot: 0, dur: t, t }, Act.Talk, x, z, a + (sign < 0 ? Math.PI : 0));
      q.mind!.last = 'trifft Bekannte';
    };
    place(p, 1); place(other, -1);
    this.stats.meet++;
    if (Math.random() < 0.5) this.h.bark(p, 'greet');
    return true;
  }

  /** Szenario zu Ende: Bedürfnis-Ziel steigt, zurück auf den Gehweg, nächster Schritt. */
  private endScenario(p: Ped) {
    const m = p.mind!;
    const leaving = m.leaving;
    p.scn = null;
    p.act = this.h.peds.walkAct(p.arch);
    m.needs.goal = Math.min(1, m.needs.goal + GOAL_PER_STEP);
    m.think = 0;
    if (leaving) { m.strollT = 30; }
    this.rejoin(p);
  }

  // ------------------------------------------------------------------ Ausgänge
  private startExit(p: Ped, step: ExitStep, idx: number) {
    const m = p.mind!;
    const order: ExitStep[] = step === 'exit'
      ? [...(EXIT_PREF[archetypeOf(p.arch).id] ?? ['exit_door', 'exit_bus']).sort(() => Math.random() - 0.4), 'exit_door', 'exit_bus']
      : [step, 'exit_door', 'exit_bus'];
    for (const e of order) {
      if (e === 'exit_car') {
        const v = this.findParkedCar(p);
        if (!v) continue;
        const c = v.sim.car, w = v.sim.prof.width / 2 + 0.7;
        // Fahrertür links (Rechtsverkehr): links = (cos a, -sin a)
        const x = c.x + Math.cos(c.a) * w, z = c.z - Math.sin(c.a) * w;
        this.goToPoint(p, x, z, Math.atan2(c.x - x, c.z - z), idx, 'car', v.id);
        this.carRes.set(v.id, p.id);
        m.last = 'geht zum geparkten Auto';
        return;
      }
      const kind: SmartKindId = e === 'exit_door' ? SmartKind.Door : SmartKind.BusStop;
      const slots = e === 'exit_door' ? [0] : [2, 3];
      let best: { o: SmartObject; slot: number } | null = null, bd = (e === 'exit_door' ? DOOR_RANGE : OBJ_RANGE) ** 2;
      for (const o of this.objects) {
        if (o.kind !== kind) continue;
        const d = dist2(o.x, o.z, p.x, p.z) * (0.8 + Math.random() * 0.4);
        if (d >= bd) continue;
        const s = kind === SmartKind.Door ? 0 : slots.find((sl) => this.isFree(o.id, sl, p.id)); // Türen: beliebig viele
        if (s === undefined) continue;
        bd = d; best = { o, slot: s };
      }
      if (!best) continue;
      this.goTo(p, best.o, best.slot, e === 'exit_bus' ? 'bus_wait' : null, e, idx);
      m.last = e === 'exit_door' ? 'geht nach Hause (Tür)' : 'geht zum Bus';
      return;
    }
    m.leaving = true; m.strollT = 25; m.last = 'kein Ausgang – geht weg';
  }

  private findParkedCar(p: Ped): ServerVehicle | null {
    let best: ServerVehicle | null = null, bd = CAR_RANGE * CAR_RANGE;
    for (const v of this.h.vehicles.values()) {
      if (!v.home || v.driver !== DRIVER_NONE || v.sim.dmg.wreck || v.sim.dmg.hp < 300) continue;
      const c = v.sim.car;
      if (dist2(c.x, c.z, v.home.x, v.home.z) > 4) continue; // nur Autos, die ordentlich geparkt stehen
      const d = dist2(c.x, c.z, p.x, p.z);
      if (d < bd && this.carFree(v.id, p.id)) { bd = d; best = v; }
    }
    return best;
  }

  private finishExit(p: Ped) {
    const m = p.mind!;
    if (m.exitCar >= 0) this.stats.car++; else this.stats.door++;
    if (m.exitCar >= 0) {
      const v = this.h.vehicles.get(m.exitCar);
      if (v && v.driver === DRIVER_NONE) this.h.departCar(v);
      this.carRes.delete(m.exitCar);
    }
    this.h.peds.peds.delete(p.id);
  }

  // ------------------------------------------------------------------ Navigation
  /** Zu einem Smart-Object-Slot gehen (sc = Szenario bei Ankunft, exit = Ausgang). */
  private goTo(p: Ped, o: SmartObject, slot: number, sc: ScenarioId | null, exit: ExitStep | null, step: number) {
    const sw = slotWorld(o.x, o.z, o.rot, SMART_KINDS[o.kind].slots[slot]);
    this.goToPoint(p, sw.x, sw.z, sw.a, step, 'obj', -1, o.id, slot, sc, exit);
    if (o.kind !== SmartKind.Door) this.reserve(o.id, slot, p.id);
  }

  private goToPoint(p: Ped, x: number, z: number, a: number, step: number, kind: 'obj' | 'car', car = -1, obj = -1, slot = 0, sc: ScenarioId | null = null, exit: ExitStep | null = null) {
    const m = p.mind!;
    if (!p.walk) this.rejoin(p);
    const near = this.walkNear(x, z, obj);
    const g: Goal = { kind, sc, exit: kind === 'car' ? 'exit_car' : exit, obj, slot, car, x, z, a, walk: near?.w ?? null, idx: near?.idx ?? 0, route: [], phase: 'route', t: 0, step };
    m.goal = g;
    if (!near || !p.walk || Math.hypot(x - p.x, z - p.z) < 6) { g.phase = 'approach'; return; }
    if (p.walk === near.w) { p.dir = near.idx >= p.idx ? 1 : -1; return; }
    if (p.walk.edge === near.w.edge) { p.walk = near.w; p.idx = nearestIdx(near.w, p.x, p.z); p.dir = near.idx >= p.idx ? 1 : -1; return; }
    const r = this.route(p, near.w, near.idx);
    if (r) this.stats.routes++; else this.stats.routeFail++;
    if (!r) { g.phase = Math.hypot(x - p.x, z - p.z) < 45 ? 'approach' : 'route'; if (g.phase === 'route') { this.abortGoal(p, false); m.strollT = 8; } return; }
    g.route = r.edges;
    p.dir = r.dir;
    p.idx = Math.max(0, Math.min(p.walk.pts.length - 1, p.idx));
  }

  /** Nächster Gehwegpunkt zum Ziel (gecacht für Objekte). */
  private walkNear(x: number, z: number, obj: number): { w: Walkway; idx: number } | null {
    if (obj >= 0 && this.objWalk.has(obj)) return this.objWalk.get(obj)!;
    const w = this.h.peds.nearestWalkway(x, z);
    const r = w ? { w, idx: nearestIdx(w, x, z) } : null;
    if (r && dist2(r.w.pts[r.idx][0], r.w.pts[r.idx][1], x, z) > 70 * 70) return null;
    if (obj >= 0) this.objWalk.set(obj, r);
    return r;
  }

  /** Dijkstra über die Straßenknoten (Kanten mit Gehweg). Gibt die Kantenfolge und die Startrichtung zurück. */
  private route(p: Ped, gw: Walkway, gi: number): { edges: number[]; dir: 1 | -1 } | null {
    const w = p.walk!;
    const n = w.pts.length - 1 || 1, gn = gw.pts.length - 1 || 1;
    const cost = new Map<number, number>(), prev = new Map<number, { node: number; edge: number }>();
    const open: number[] = [];
    const startB = (1 - p.idx / n) * w.edge.len, startA = (p.idx / n) * w.edge.len;
    cost.set(w.edge.b, startB); cost.set(w.edge.a, Math.min(cost.get(w.edge.a) ?? Infinity, startA));
    open.push(w.edge.a, w.edge.b);
    const goalA = gw.edge.a, goalB = gw.edge.b;
    const tailA = (gi / gn) * gw.edge.len, tailB = (1 - gi / gn) * gw.edge.len;
    let best = Infinity, bestNode = -1;
    const done = new Set<number>();
    let expansions = 0;
    while (open.length && expansions++ < 500) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (cost.get(open[i])! < cost.get(open[bi])!) bi = i;
      const node = open.splice(bi, 1)[0];
      if (done.has(node)) continue;
      done.add(node);
      const c = cost.get(node)!;
      if (c > best || c > 700) break;
      if (node === goalA && c + tailA < best) { best = c + tailA; bestNode = node; }
      if (node === goalB && c + tailB < best) { best = c + tailB; bestNode = node; }
      for (const ww of this.h.peds.byNode.get(node) ?? []) {
        const e = ww.edge;
        if (e === w.edge || e === gw.edge) continue;
        const other = e.a === node ? e.b : e.a;
        const nc = c + e.len;
        if (nc < (cost.get(other) ?? Infinity)) { cost.set(other, nc); prev.set(other, { node, edge: e.id }); open.push(other); }
      }
    }
    if (bestNode < 0) return null;
    const edges: number[] = [gw.edge.id];
    let node = bestNode;
    while (prev.has(node)) { const pr = prev.get(node)!; edges.unshift(pr.edge); node = pr.node; }
    // node ist jetzt der Start-Knoten (Ende des aktuellen Gehwegs)
    return { edges, dir: node === w.edge.b ? 1 : -1 };
  }

  /** Pedestrians fragt an Kreuzungen: Welcher Gehweg liegt auf der Route? */
  routeNext(p: Ped, node: number, options: Walkway[]): Walkway | null {
    const g = p.mind?.goal;
    if (!g || g.phase !== 'route' || !g.route.length) return null;
    const next = g.route[0];
    const cand = options.filter((o) => o.edge.id === next);
    if (!cand.length) { g.route = []; return null; }
    g.route.shift();
    if (g.walk && cand.includes(g.walk)) return g.walk;
    // Straßenseite: der Anfang, der am nächsten liegt (gleiche Ecke, keine unnötige Querung)
    let best = cand[0], bd = Infinity;
    for (const o of cand) {
      const q = o.edge.a === node ? o.pts[0] : o.pts[o.pts.length - 1];
      const d = dist2(q[0], q[1], p.x, p.z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  private navigate(p: Ped, dt: number) {
    const m = p.mind!, g = m.goal!;
    g.t += dt;
    if (g.t > 150) { this.abortGoal(p, false); return; }
    if (g.kind === 'car') {
      const v = this.h.vehicles.get(g.car);
      if (!v || v.driver !== DRIVER_NONE || dist2(v.sim.car.x, v.sim.car.z, v.home?.x ?? 0, v.home?.z ?? 0) > 4) {
        this.abortGoal(p, true); return; // Auto weg (z. B. vom Spieler geklaut): anderen Ausgang suchen
      }
    } else if (g.exit !== 'exit_door' && !this.isFree(g.obj, g.slot, p.id)) { this.abortGoal(p, true); return; }

    if (g.phase === 'route') {
      if (!p.walk) { this.rejoin(p); return; }
      if (p.walk === g.walk) {
        if ((g.idx - p.idx) * p.dir < 0 || p.idx === g.idx) { g.phase = 'approach'; return; }
      } else if (!g.route.length && g.t > 3) {
        // Route verloren (Sackgasse o. Ä.): nah dran → direkt hin, sonst neu planen
        if (Math.hypot(g.x - p.x, g.z - p.z) < 40) { g.phase = 'approach'; return; }
        const r = g.walk ? this.route(p, g.walk, g.idx) : null;
        if (!r) { this.abortGoal(p, false); return; }
        g.route = r.edges; p.dir = r.dir;
      }
      this.h.peds.walkStep(p, dt);
      return;
    }
    // Annäherung: direkt zum Platz
    const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.4 || (g.t > 20 && d < 2.5)) { this.arrive(p); return; }
    const stuck = stepPawn(this.h.map, p, dx / d, -dz / d, 0, dt, p.spd);
    p.stk = stuck ? (p.stk ?? 0) + dt : 0;
    if (stuck && d < 2.5) this.arrive(p);
    else if (g.t > 60 || p.stk > 5) { p.stk = 0; this.abortGoal(p, false); } // Ziel hinter einer Wand: aufgeben (#37)
  }

  private arrive(p: Ped) {
    const m = p.mind!, g = m.goal!;
    m.goal = null;
    p.x = g.x; p.z = g.z; p.a = g.a;
    if (g.kind === 'car' || g.exit === 'exit_door') {
      p.act = Act.Enter; p.walk = null;
      m.exitT = g.kind === 'car' ? 1.0 : ENTER_TIME;
      m.exitCar = g.kind === 'car' ? g.car : -1;
      m.last = g.kind === 'car' ? 'steigt ins Auto' : 'geht durch die Tür';
      return;
    }
    if (g.sc) {
      const sc = SCENARIOS[g.sc];
      const leaving = g.exit === 'exit_bus';
      const t = leaving ? 1e9 : rnd(sc.dur[0], sc.dur[1]);
      this.h.peds.startScenario(p, { id: sc.id, obj: g.obj, slot: g.slot, dur: t, t }, sc.act, g.x, g.z, g.a);
      this.reserve(g.obj, g.slot, p.id);
      if (leaving) { m.leaving = true; this.stats.bus++; } else this.stats.objScn++;
      m.last = leaving ? 'wartet auf den Bus' : sc.name;
    }
  }

  /** Ziel aufgeben. retry = denselben Kettenschritt gleich nochmal (anderes Objekt). */
  private abortGoal(p: Ped, retry: boolean) {
    const m = p.mind!;
    if (!m.goal) return;
    this.stats.aborts++;
    if (m.goal.kind === 'car') this.carRes.delete(m.goal.car);
    if (retry) m.step = Math.min(m.step, m.goal.step);
    m.goal = null;
    m.think = retry ? 0.5 : 0;
    m.last = retry ? 'Ziel belegt – sucht neu' : 'Ziel nicht erreichbar';
    if (!p.walk) this.rejoin(p);
  }

  /** Zurück auf den nächsten Gehweg (läuft vom aktuellen Ort zum nächsten Wegpunkt). */
  rejoin(p: Ped) {
    const w = this.h.peds.nearestWalkway(p.x, p.z);
    if (!w) { p.ttl = 6; return; }
    p.walk = w; p.idx = nearestIdx(w, p.x, p.z); p.dir = Math.random() < 0.5 ? 1 : -1;
    if (p.mind) p.mind.avoiding = false;
  }

  // ------------------------------------------------------------------ Reaktionen
  /**
   * Reaktion beginnen (von Perception gewählt). src = verursachender Spieler (-1 = keiner).
   * Stärkere Reaktionen ersetzen schwächere; Szenarien werden bei Flucht & Co. abgebrochen.
   */
  react(p: Ped, id: ReactionId, dur: number, ev: number, x: number, z: number, src: number): boolean {
    const m = p.mind;
    if (!m || m.exitT > 0 || p.rt > 0) return false;
    if (m.react && PRIO[m.react.id] > PRIO[id]) return false;
    const seated = p.scn && (p.act === Act.Sit || p.act === Act.Drink || p.act === Act.Lie || p.scn.id === 'bench_sit');
    if (seated && (id === 'look' || id === 'flinch' || id === 'dodge')) return false; // Sitzende bleiben sitzen
    const moving = id === 'flee' || id === 'panic' || id === 'dodge' || id === 'intervene' || id === 'stumble';
    if (moving && p.scn) { p.scn = null; }
    if (moving && m.goal) this.abortGoal(p, true);
    m.react = { id, t: dur, ev, x, z, src };
    if (id === 'flee' || id === 'panic') {
      const d = Math.hypot(p.x - x, p.z - z) || 1;
      if (ev >= 0 || d > 0.01) { p.fdx = (p.x - x) / d; p.fdz = (p.z - z) / d; }
      p.flee = dur;
    }
    if (id === 'dodge') { const d = Math.hypot(p.x - x, p.z - z) || 1; p.fdx = (p.x - x) / d; p.fdz = (p.z - z) / d; }
    p.act = REACT_ACT[id] ?? p.act;
    p.wait = 0;
    return true;
  }

  private doReaction(p: Ped, dt: number) {
    const m = p.mind!, r = m.react!;
    r.t -= dt;
    // Verursacher verfolgen (Blick/Annäherung)
    if (r.src >= 0) { const pl = this.h.player(r.src); if (pl) { r.x = pl.x; r.z = pl.z; } }
    const face = () => { p.a = Math.atan2(r.x - p.x, r.z - p.z); };
    switch (r.id) {
      case 'flee': case 'panic':
        p.flee = Math.max(0, r.t);
        stepPawn(this.h.map, p, p.fdx, -p.fdz, 0, dt, FLEE_SPEED * (r.id === 'panic' ? 1.1 : 1));
        if (r.id === 'panic') p.a = Math.atan2(p.fdx, p.fdz);
        break;
      case 'dodge': stepPawn(this.h.map, p, p.fdx, -p.fdz, 0, dt, 2.4); break;
      case 'stumble': if (r.t > 1.2) { p.x += p.fdx * dt * 0.8; p.z += p.fdz * dt * 0.8; } break;
      case 'cower': p.a = Math.atan2(p.x - r.x, p.z - r.z); break;
      case 'intervene': {
        const d = Math.hypot(r.x - p.x, r.z - p.z);
        if (d > 2.8) { p.act = Act.None; stepPawn(this.h.map, p, (r.x - p.x) / d, -(r.z - p.z) / d, 0, dt, 2.3); }
        else { p.act = Act.Scold; face(); }
        break;
      }
      default: face();
    }
    if (r.t > 0) return;
    // Ende der Reaktion
    m.react = null;
    p.flee = 0;
    if (p.scn) { p.act = SCENARIOS[p.scn.id].act; return; }
    p.act = this.h.peds.walkAct(p.arch);
    if (r.id === 'flee' || r.id === 'panic' || r.id === 'dodge' || r.id === 'intervene' || r.id === 'stumble' || !p.walk) this.rejoin(p);
    if (m.goal) { const g = m.goal; m.goal = null; m.step = Math.min(m.step, g.step); }
    m.think = 0.3;
  }

  /** Verursacher merken (Kurzzeitgedächtnis). */
  remember(p: Ped, pid: number) {
    if (p.mind && pid >= 0) p.mind.fear = { pid, t: FEAR_MEMORY };
  }

  /** Gemiedener Spieler nah: ausweichen, sehr nah: flüchten. true = Bewegung übernommen. */
  private avoidFeared(p: Ped, dt: number): boolean {
    const m = p.mind!, f = m.fear!;
    const pl = this.h.player(f.pid);
    if (!pl) { m.fear = null; return false; }
    const dx = p.x - pl.x, dz = p.z - pl.z, d = Math.hypot(dx, dz) || 1;
    if (d < 2.6 && !pl.veh) {
      this.react(p, 'flee', 2.5, -1, pl.x, pl.z, -1);
      this.h.bark(p, 'fear');
      return true;
    }
    if (d < 7) {
      if (p.scn && p.scn.obj >= 0) return false; // Sitzende/Anstehende bleiben (schauen nur ängstlich)
      if (p.scn) p.scn = null;
      if (m.goal) this.abortGoal(p, true);
      m.avoiding = true;
      p.walk = null;
      p.act = this.h.peds.walkAct(p.arch);
      stepPawn(this.h.map, p, dx / d, -dz / d, 0, dt, p.spd * 1.3);
      return true;
    }
    if (m.avoiding && d > 9) this.rejoin(p);
    return false;
  }

  // ------------------------------------------------------------------ Hilfen
  private nearestPlayer2(x: number, z: number): number {
    let b = Infinity;
    for (const q of this.h.players()) b = Math.min(b, dist2(q.x, q.z, x, z));
    return b;
  }

  /** Ist der Platz begehbar (für Gruppen-Spawns)? */
  walkable(x: number, z: number): boolean {
    const t = this.h.map.tileAt(x, z);
    return t === Tile.SIDEWALK || t === Tile.PLAZA || t === Tile.SAND || t === Tile.GRASS;
  }
}

/** Priorität der Reaktionen (höher ersetzt niedriger). */
const PRIO: Record<ReactionId, number> = {
  look: 1, dodge: 2, stumble: 3, flinch: 3, point: 3, scold: 4, film: 4, call: 5, intervene: 6, cower: 7, flee: 8, panic: 9,
};
const REACT_ACT: Partial<Record<ReactionId, number>> = {
  look: Act.Look, flinch: Act.Flinch, stumble: Act.Flinch, scold: Act.Scold, film: Act.Film, call: Act.Call,
  cower: Act.Cower, point: Act.Point, panic: Act.Panic, flee: Act.None, dodge: Act.None, intervene: Act.None,
};

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
