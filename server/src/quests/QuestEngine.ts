// Datengetriebene Quest-Engine (Spec 13): wertet QuestDefinition-Daten (shared/questData.ts) aus.
// Ein "Lauf" gehört einer Gruppe von Teilnehmern (Koop: alle Spieler im Umkreis von 50 m beim Start).
// Ziele werden geteilt ausgewertet; Belohnungen bekommt jeder Teilnehmer voll (Spec 13.3).
import { GANGS, questRep, repStatus, type GangId } from '../../../shared/src/gangs';
import { dist2 } from '../../../shared/src/math';
import type { PhoneQuest, QuestState } from '../../../shared/src/protocol';
import { QUESTS, QUEST_BY_ID } from '../../../shared/src/questData';
import { racePoints, waterNear, type Point } from '../../../shared/src/questLocations';
import type { DialogueLine, Objective, QuestAction, QuestDefinition } from '../../../shared/src/quests';
import { CAR_VARIANTS } from '../../../shared/src/sim/handling';
import { findFootSpot } from '../../../shared/src/sim/movement';
import { snapRoad } from '../../../shared/src/story/places';
import { defaultVariant } from '../../../shared/src/sim/vehicle';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { DRIVER_NPC, type ServerPlayer, type ServerVehicle } from '../entities/types';
import type { Ped } from '../sim/Pedestrians';

export interface QuestHost {
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  peds: { peds: Map<number, Ped> };
  locations: Record<string, Point>;
  /** Mindestanzahl Koop-Spieler ignorieren (Dev-Modus). */
  soloOk: boolean;
  seed: number;
  map: import('../../../shared/src/world/WorldMap').WorldMap;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  isNight(): boolean;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  spawnVehicle(kind: number, variant: number, x: number, z: number, a: number, color?: number): ServerVehicle | null;
  removeVehicle(id: number): void;
  /** Fahrzeug an den Verkehr übergeben (ein NPC fährt es, z. B. Konvoi). */
  adoptTraffic(v: ServerVehicle): void;
  spawnEnemy(gang: GangId, x: number, z: number, o: { tag: string; run: number; tgt: string; hp?: number }): Ped;
  spawnNpc(x: number, z: number, o: { tag: string; run: number; hp: number }): Ped;
  nearestTraffic(x: number, z: number, maxR: number): ServerVehicle | null;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  grantXp(p: ServerPlayer, xp: number): void;
  persist(p: ServerPlayer): void;
  raiseWanted(p: ServerPlayer, level: number): void;
  sendLog(p: ServerPlayer): void;
  // ---- Story (server/quests/Story.ts)
  /** Story-Sperre: '' = erlaubt, sonst der Grund. */
  gate(p: ServerPlayer, def: QuestDefinition): string;
  /** Darf der Spieler bei diesem Auftrag mitmachen (Koop-Start, Beitritt)? */
  canJoin(p: ServerPlayer, def: QuestDefinition): boolean;
  /** Auftrag erfolgreich beendet (firstTime: zum ersten Mal) – Rang, Wohnorte, Abschlussdialog. */
  completed(p: ServerPlayer, def: QuestDefinition, firstTime: boolean): void;
  dialog(p: ServerPlayer, lines: DialogueLine[], kind: 'talk' | 'radio' | 'call'): void;
  /** Entscheidung anbieten bzw. anwenden (Rückgabe: gültige Option). */
  offerChoice(p: ServerPlayer, id: string): void;
  applyChoice(p: ServerPlayer, id: string, option: string): boolean;
}

interface Pickup { tag: string; x: number; z: number }
interface ObjState { def: Objective; done: boolean; t: number; n: number; pts?: Point[]; idx: Map<number, number> }
interface Run {
  id: number;
  def: QuestDefinition;
  stage: number;
  participants: Set<number>;
  start: Point;
  stageT: number;
  timeLeft: number;
  objs: ObjState[];
  pickups: Pickup[];
  spawned: Map<string, number>;
  maxHp: Map<string, number>;
  places: number[];
  ending: number; // > 0: Aufräumzeit nach Ende
  elapsed: number;
}

const PHONE_RANGE = 10;
const JOIN_RANGE = 50;
/** Laufenden Koop-Aufträgen (openJoin) beitreten: Abstand zu einem Teilnehmer. */
const LATE_JOIN_RANGE = 60;
const CHOICE_RANGE = 6;
const variantByModel = (model: string) => Math.max(0, CAR_VARIANTS.findIndex((v) => v.model === model));
let nextRun = 1;

export class QuestEngine {
  private runs = new Map<number, Run>();
  private byPlayer = new Map<number, Run>();

  constructor(private h: QuestHost) {}

  // ------------------------------------------------------------------ Verfügbarkeit
  /** Leerer String = verfügbar, sonst der Grund. */
  unavailable(p: ServerPlayer, def: QuestDefinition, level: number): string {
    const pr = p.profile;
    if (this.byPlayer.has(p.id)) return 'Du hast bereits einen aktiven Auftrag.';
    const gate = this.h.gate(p, def);
    if (gate) return gate;
    if (level < def.minLevel) return `Ab Stufe ${def.minLevel}.`;
    if (!def.repeatable && pr.questsDone.includes(def.id)) return 'Bereits abgeschlossen.';
    const cd = pr.questCooldowns[def.id] ?? 0;
    if (cd > Date.now()) return `Wieder verfügbar in ${Math.ceil((cd - Date.now()) / 60000)} Min.`;
    for (const [g, v] of Object.entries(def.requirements?.reputation ?? {})) {
      if ((pr.reputation[g] ?? 0) < (v as number)) return `Ruf bei ${GANGS[g as GangId].name} zu niedrig.`;
    }
    for (const q of def.requirements?.questsCompleted ?? []) if (!pr.questsDone.includes(q)) return 'Erst frühere Aufträge abschließen.';
    if (def.nightOnly && !this.h.isNight()) return 'Nur nachts verfügbar.';
    return '';
  }

  listing(p: ServerPlayer, phoneId: string, level: number): PhoneQuest[] {
    return this.listingOf(p, QUESTS.filter((q) => q.giver.type === 'payphone' && q.giver.id === phoneId), level);
  }

  // ------------------------------------------------------------------ Start/Ende
  start(starter: ServerPlayer, def: QuestDefinition, level: number): boolean {
    const reason = this.unavailable(starter, def, level);
    if (reason) { this.h.notice(starter, reason, 'bad'); return false; }
    const sp = this.h.positionOf(starter);
    const crew: ServerPlayer[] = [starter];
    for (const o of this.h.players.values()) {
      if (o === starter || crew.length >= def.coop.max || this.byPlayer.has(o.id) || o.downT > 0 || !this.h.canJoin(o, def)) continue;
      const q = this.h.positionOf(o);
      if (dist2(q.x, q.z, sp.x, sp.z) <= JOIN_RANGE * JOIN_RANGE) crew.push(o);
    }
    if (crew.length < def.coop.min && !this.h.soloOk) {
      this.h.notice(starter, `„${def.title}“ braucht mindestens ${def.coop.min} Spieler im Umkreis von ${JOIN_RANGE} m.`, 'bad');
      return false;
    }
    const run: Run = {
      id: nextRun++, def, stage: -1, participants: new Set(crew.map((c) => c.id)), start: { x: sp.x, z: sp.z },
      stageT: 0, timeLeft: -1, objs: [], pickups: [], spawned: new Map(), maxHp: new Map(), places: [], ending: 0, elapsed: 0,
    };
    this.runs.set(run.id, run);
    for (const c of crew) {
      this.byPlayer.set(c.id, run);
      this.h.notice(c, `Auftrag gestartet: ${def.title}${crew.length > 1 ? ` (${crew.length} Spieler)` : ''}`, 'info');
    }
    this.beginStage(run, 0);
    return true;
  }

  /** Laufender Koop-Auftrag in der Nähe, dem p beitreten kann (openJoin). */
  joinable(p: ServerPlayer): Run | null {
    if (this.byPlayer.has(p.id) || p.downT > 0) return null;
    const me = this.h.positionOf(p);
    for (const run of this.runs.values()) {
      if (!run.def.openJoin || run.ending > 0 || run.participants.size >= run.def.coop.max || !this.h.canJoin(p, run.def)) continue;
      for (const q of this.members(run)) {
        const o = this.h.positionOf(q);
        if (dist2(o.x, o.z, me.x, me.z) <= LATE_JOIN_RANGE * LATE_JOIN_RANGE) return run;
      }
    }
    return null;
  }
  joinableTitle(p: ServerPlayer): string | undefined { return this.joinable(p)?.def.title; }

  join(p: ServerPlayer): boolean {
    const run = this.joinable(p);
    if (!run) return false;
    run.participants.add(p.id);
    this.byPlayer.set(p.id, run);
    this.notifyAll(run, `${p.name} macht bei „${run.def.title}“ mit!`, 'good');
    this.h.notice(p, run.def.stages[run.stage].description, 'info');
    return true;
  }

  /** Antwort auf eine angebotene Entscheidung. */
  choose(p: ServerPlayer, id: string, option: string) {
    const run = this.byPlayer.get(p.id);
    if (!run || run.ending > 0) return;
    const o = run.objs.find((x) => !x.done && x.def.type === 'choice' && x.def.id === id);
    if (!o || o.def.type !== 'choice') return;
    const l = this.loc(run, o.def.at), q = this.h.positionOf(p);
    const r = (o.def.radius ?? CHOICE_RANGE) + 4;
    if (!l || dist2(l.x, l.z, q.x, q.z) > r * r) return;
    if (this.h.applyChoice(p, id, option)) o.done = true;
  }

  /** Dev: aktiven Auftrag sofort erfolgreich beenden. */
  forceComplete(p: ServerPlayer): string | null {
    const run = this.byPlayer.get(p.id);
    if (!run || run.ending > 0) return null;
    this.finish(run, true);
    return run.def.id;
  }

  /** Auftragsliste für beliebige Definitionen (Telefon oder Story-Figur). */
  listingOf(p: ServerPlayer, defs: QuestDefinition[], level: number): PhoneQuest[] {
    return defs.map((q) => {
      const reason = this.unavailable(p, q, level);
      const r = q.rewards;
      const money = r.byPlace ? `bis $${r.byPlace[0]}` : `$${r.money}`;
      const rep = r.reputation ? ` · ${GANGS[r.reputation.gang].name} +${r.reputation.gain}` : '';
      return { id: q.id, title: q.title, intro: q.intro, rewardText: `${money} · ${r.xp} XP${rep}`, coop: [q.coop.min, q.coop.max], ok: !reason, reason };
    });
  }

  abandon(p: ServerPlayer) {
    const run = this.byPlayer.get(p.id);
    if (!run || run.ending > 0) return;
    this.leave(run, p.id);
    this.h.notice(p, 'Auftrag abgebrochen.', 'info');
  }

  onPlayerLeave(id: number) {
    const run = this.byPlayer.get(id);
    if (run) this.leave(run, id);
  }

  private leave(run: Run, id: number) {
    run.participants.delete(id);
    this.byPlayer.delete(id);
    if (!run.participants.size && run.ending <= 0) this.finish(run, false, 'Alle Teilnehmer haben den Auftrag verlassen.');
  }

  private members(run: Run): ServerPlayer[] {
    const out: ServerPlayer[] = [];
    for (const id of run.participants) { const p = this.h.players.get(id); if (p) out.push(p); }
    return out;
  }

  private notifyAll(run: Run, text: string, kind: 'info' | 'good' | 'bad') { for (const p of this.members(run)) this.h.notice(p, text, kind); }

  private finish(run: Run, success: boolean, why = '') {
    if (run.ending > 0) return;
    const crew = this.members(run);
    if (success) {
      const d = run.def, r = d.rewards;
      // Bonus für ein (fast) unbeschädigtes Fahrzeug
      let bonus = 0;
      if (r.damageBonus) {
        const v = this.tagged(run, r.damageBonus.tag).veh[0];
        if (v && !v.sim.dmg.wreck && v.sim.dmg.hp / 1000 >= r.damageBonus.minHealth) bonus = r.damageBonus.money;
      }
      for (const p of crew) {
        const firstTime = !p.profile.questsDone.includes(d.id);
        const place = run.places.indexOf(p.id);
        const money = r.byPlace ? (place >= 0 ? r.byPlace[Math.min(place, r.byPlace.length - 1)] ?? 0 : 0) : r.money;
        if (r.byPlace && place < 0) { this.h.notice(p, `„${d.title}“ nicht beendet – keine Belohnung.`, 'bad'); continue; }
        if (money) this.h.addMoney(p, money, `quest:${d.id}`);
        this.h.grantXp(p, r.xp);
        if (r.reputation) {
          p.profile.reputation = questRep(p.profile.reputation, r.reputation.gang, r.reputation.gain, r.reputation.rivalLoss);
        }
        if (!p.profile.questsDone.includes(d.id)) p.profile.questsDone.push(d.id);
        if (d.cooldownMinutes) p.profile.questCooldowns[d.id] = Date.now() + d.cooldownMinutes * 60000;
        const place1 = r.byPlace ? ` (Platz ${place + 1})` : '';
        this.h.notice(p, `Auftrag erfüllt: ${d.title}${place1}! +$${money} · +${r.xp} XP${r.reputation ? ` · ${GANGS[r.reputation.gang].name} +${r.reputation.gain}` : ''}`, 'good');
        if (bonus) { this.h.addMoney(p, bonus, `quest:${d.id}:bonus`); this.h.notice(p, `Bonus: kaum Kratzer! +$${bonus}`, 'good'); }
        this.h.completed(p, d, firstTime);
        this.h.persist(p);
        this.h.sendLog(p);
      }
    } else {
      for (const p of crew) this.h.notice(p, `Auftrag gescheitert: ${run.def.title}${why ? ` – ${why}` : ''}`, 'bad');
    }
    for (const p of crew) this.byPlayer.delete(p.id);
    run.participants.clear();
    run.ending = 0.1;
    this.cleanup(run);
  }

  /** Quest-Figuren und -Fahrzeuge entfernen (besetzte Fahrzeuge bleiben stehen). */
  private cleanup(run: Run) {
    for (const [id, ped] of [...this.h.peds.peds]) if (ped.run === run.id) this.h.peds.peds.delete(id);
    for (const v of [...this.h.vehicles.values()]) {
      if (v.qrun !== run.id) continue;
      if (v.driver >= 0) { v.qrun = undefined; v.qtag = undefined; } else this.h.removeVehicle(v.id);
    }
    run.pickups.length = 0;
  }

  // ------------------------------------------------------------------ Stufen
  private beginStage(run: Run, idx: number) {
    run.stage = idx;
    const st = run.def.stages[idx];
    run.stageT = 0;
    run.timeLeft = st.timeLimitSeconds ?? -1;
    run.objs = st.objectives.map((def) => ({ def, done: false, t: 0, n: 0, idx: new Map() }));
    for (const o of run.objs) {
      if (o.def.type === 'race') {
        const refs = Array.isArray(o.def.points) ? o.def.points : [o.def.points];
        const pts = refs.map((r) => this.loc(run, r)).filter((p): p is Point => !!p);
        o.pts = refs.length === 1 && o.def.count ? racePoints(this.h.map, pts[0], o.def.count, this.h.seed + run.id) : pts;
        if (!o.pts.length) o.done = true;
      }
    }
    for (const a of st.onStart ?? []) this.act(run, a);
    this.notifyAll(run, st.description, 'info');
  }

  private loc(run: Run, ref: string): Point | null {
    if (ref === 'here') return run.start;
    if (ref.startsWith('tag:')) {
      const t = this.tagged(run, ref.slice(4));
      if (t.veh[0]) return { x: t.veh[0].sim.car.x, z: t.veh[0].sim.car.z };
      if (t.ped[0]) return { x: t.ped[0].x, z: t.ped[0].z };
      return null;
    }
    return this.h.locations[ref] ?? null;
  }

  private act(run: Run, a: QuestAction) {
    const crew = this.members(run);
    switch (a.do) {
      case 'say': this.notifyAll(run, a.text, 'info'); break;
      case 'dialog': for (const p of crew) this.h.dialog(p, a.lines, a.kind ?? 'talk'); break;
      case 'setWanted': for (const p of crew) this.h.raiseWanted(p, a.level); break;
      case 'spawnVehicle': {
        const base = this.loc(run, a.at);
        if (!base) break;
        const count = a.perPlayer ? crew.length : 1;
        for (let i = 0; i < count; i++) {
          const ang = (i / Math.max(1, count)) * Math.PI * 2;
          const want = { x: base.x + Math.cos(ang) * (count > 1 ? 9 : 0), z: base.z + Math.sin(ang) * (count > 1 ? 9 : 0) };
          let heading = Math.random() * Math.PI * 2;
          let spot: Point | null;
          if (a.pose && !a.water) {
            // Auf die Straße stellen: in Fahrtrichtung bzw. quer (Straßensperre), optional versetzt
            const r = snapRoad(this.h.map, want.x, want.z);
            // Freien Platz entlang der Straße suchen (z. B. mehrere neue Spieler gleichzeitig am Busbahnhof)
            const base0 = (a.ahead ?? 0) + (count > 1 ? i * 9 : 0);
            let r2 = r;
            for (let k = 0; k < 8; k++) {
              const ahead = base0 + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7);
              r2 = ahead ? snapRoad(this.h.map, r.x + Math.sin(r.a) * ahead, r.z + Math.cos(r.a) * ahead) : r;
              if (![...this.h.vehicles.values()].some((o) => dist2(o.sim.car.x, o.sim.car.z, r2.x, r2.z) < 5 * 5)) break;
            }
            spot = { x: r2.x, z: r2.z };
            heading = a.pose === 'across' ? r2.a + Math.PI / 2 : r2.a;
          } else spot = a.water ? waterNear(this.h.map, want.x, want.z) : findFootSpot(this.h.map, want.x, want.z, 12);
          if (!spot) continue;
          const kind = a.kind === 'boat' ? VehicleKind.Boat : a.kind === 'airboat' ? VehicleKind.Airboat : a.kind === 'bike' ? VehicleKind.Bike : VehicleKind.Car;
          const variant = a.model && kind === VehicleKind.Car ? variantByModel(a.model) : a.variant ?? defaultVariant(kind, 0);
          const v = this.h.spawnVehicle(kind, variant, spot.x, spot.z, heading, a.color);
          if (v) { v.qtag = a.tag; v.qrun = run.id; v.home = null; if (a.traffic) this.h.adoptTraffic(v); }
        }
        break;
      }
      case 'spawnEnemies': {
        const base = this.loc(run, a.at);
        if (!base) break;
        let tgt = 'players';
        if (a.target && a.target !== 'players') {
          const ped = [...this.h.peds.peds.values()].find((p) => p.run === run.id && p.tag === a.target);
          const veh = [...this.h.vehicles.values()].find((v) => v.qrun === run.id && v.qtag === a.target);
          tgt = ped ? `ped:${ped.id}` : veh ? `veh:${veh.id}` : 'players';
        }
        let n = 0;
        for (let i = 0; i < a.count * 4 && n < a.count; i++) {
          const ang = Math.random() * Math.PI * 2, r = (a.radius ?? 20) * (0.6 + Math.random() * 0.4);
          const spot = findFootSpot(this.h.map, base.x + Math.cos(ang) * r, base.z + Math.sin(ang) * r, 3);
          if (!spot) continue;
          this.h.spawnEnemy(a.gang, spot.x, spot.z, { tag: a.tag, run: run.id, tgt, hp: a.hp });
          n++;
        }
        run.spawned.set(a.tag, (run.spawned.get(a.tag) ?? 0) + n);
        break;
      }
      case 'spawnNpc': {
        const base = this.loc(run, a.at);
        if (!base) break;
        const spot = findFootSpot(this.h.map, base.x, base.z, 6) ?? base;
        this.h.spawnNpc(spot.x, spot.z, { tag: a.tag, run: run.id, hp: a.hp });
        run.maxHp.set(a.tag, a.hp);
        break;
      }
      case 'spawnPickups': {
        const base = this.loc(run, a.at);
        if (!base) break;
        for (let i = 0; i < a.count; i++) {
          const ang = Math.random() * Math.PI * 2, r = a.radius * Math.sqrt(Math.random());
          const spot = findFootSpot(this.h.map, base.x + Math.cos(ang) * r, base.z + Math.sin(ang) * r, 4) ?? base;
          run.pickups.push({ tag: a.tag, x: spot.x, z: spot.z });
        }
        break;
      }
      case 'tagTraffic': {
        const near = this.loc(run, a.near) ?? run.start;
        const v = this.h.nearestTraffic(near.x, near.z, 250);
        if (v) { v.qtag = a.tag; v.qrun = run.id; v.driver = DRIVER_NPC; } else this.notifyAll(run, 'Kein Verkehr in der Nähe – Ziel übersprungen.', 'info');
        break;
      }
    }
  }

  // ------------------------------------------------------------------ Tick
  update(dt: number) {
    for (const run of [...this.runs.values()]) {
      if (run.ending > 0) { run.ending -= dt; if (run.ending <= 0) this.runs.delete(run.id); continue; }
      this.tick(run, dt);
    }
  }

  private tick(run: Run, dt: number) {
    const crew = this.members(run);
    if (!crew.length) { this.finish(run, false); return; }
    run.stageT += dt; run.elapsed += dt;
    if (crew.every((p) => p.downT > 0)) { this.finish(run, false, 'Alle Spieler wurden ausgeknockt.'); return; }
    if (run.timeLeft >= 0) {
      run.timeLeft -= dt;
      if (run.timeLeft <= 0) { this.finish(run, false, 'Zeit abgelaufen.'); return; }
    }
    for (const o of run.objs) {
      if (o.done) continue;
      const failure = this.evaluate(run, o, crew, dt);
      if (failure) { this.finish(run, false, failure); return; }
    }
    if (run.objs.every((o) => o.done)) this.completeStage(run);
  }

  private completeStage(run: Run) {
    const st = run.def.stages[run.stage];
    for (const a of st.onComplete ?? []) this.act(run, a);
    if (run.stage + 1 >= run.def.stages.length) { this.finish(run, true); return; }
    this.beginStage(run, run.stage + 1);
  }

  private tagged(run: Run, tag: string): { veh: ServerVehicle[]; ped: Ped[] } {
    return {
      veh: [...this.h.vehicles.values()].filter((v) => v.qrun === run.id && v.qtag === tag),
      ped: [...this.h.peds.peds.values()].filter((p) => p.run === run.id && p.tag === tag),
    };
  }

  /** Wertet ein Ziel aus. Rückgabe: Fehlschlaggrund oder null. */
  private evaluate(run: Run, o: ObjState, crew: ServerPlayer[], dt: number): string | null {
    const d = o.def;
    const at = (p: ServerPlayer) => this.h.positionOf(p);
    const vehOf = (p: ServerPlayer) => (p.vehicleId >= 0 ? this.h.vehicles.get(p.vehicleId) : undefined);
    const kindOk = (p: ServerPlayer, k?: string) => {
      if (!k) return true;
      const v = vehOf(p);
      return !!v && v.kind === (k === 'boat' ? VehicleKind.Boat : k === 'airboat' ? VehicleKind.Airboat : VehicleKind.Car);
    };
    switch (d.type) {
      case 'goTo': {
        const l = this.loc(run, d.at); if (!l) { o.done = true; break; }
        const r = d.radius ?? 12;
        if (crew.some((p) => { const q = at(p); return dist2(q.x, q.z, l.x, l.z) <= r * r && kindOk(p, d.vehicleKind) && (!d.vehicleTag || vehOf(p)?.qtag === d.vehicleTag); })) o.done = true;
        break;
      }
      case 'enterVehicle': {
        if (crew.some((p) => vehOf(p)?.qtag === d.tag && vehOf(p)?.qrun === run.id)) o.done = true;
        else if (!this.tagged(run, d.tag).veh.length) return 'Das Fahrzeug ist weg.';
        break;
      }
      case 'deliverVehicle': {
        const v = this.tagged(run, d.tag).veh[0];
        if (!v || v.sim.dmg.wreck) return 'Das Fahrzeug wurde zerstört.';
        if (d.minHealth && v.sim.dmg.hp / 1000 < d.minHealth) return 'Das Fahrzeug ist zu stark beschädigt.';
        const l = this.loc(run, d.at); if (!l) { o.done = true; break; }
        const r = d.radius ?? 12;
        if (dist2(v.sim.car.x, v.sim.car.z, l.x, l.z) <= r * r && crew.some((p) => p.vehicleId === v.id)) o.done = true;
        break;
      }
      case 'follow': {
        const v = this.tagged(run, d.tag).veh[0];
        if (!v) { o.done = true; break; } // kein Verkehr gefunden: übersprungen
        let best = Infinity;
        for (const p of crew) { const q = at(p); best = Math.min(best, Math.hypot(q.x - v.sim.car.x, q.z - v.sim.car.z)); }
        if (best < d.minDist || best > d.maxDist) { o.n += dt; if (o.n > 6) return best < d.minDist ? 'Du warst zu auffällig nah dran.' : 'Du hast das Ziel verloren.'; } else { o.n = Math.max(0, o.n - dt); o.t += dt; }
        if (o.t >= d.seconds) o.done = true;
        break;
      }
      case 'defeat': {
        const alive = this.tagged(run, d.tag).ped.filter((p) => p.hp > 0).length;
        if (!alive && (run.spawned.get(d.tag) ?? 0) > 0) o.done = true;
        break;
      }
      case 'protect': {
        const t = this.tagged(run, d.tag);
        const ped = t.ped[0], veh = t.veh[0];
        if (ped) { if (ped.hp <= 0) return 'Der Schützling wurde besiegt.'; }
        else if (veh) {
          if (veh.sim.dmg.wreck || veh.sim.dmg.hp / 1000 < (d.minHealth ?? 0.01)) return 'Das Fahrzeug wurde zu stark beschädigt.';
        } else return 'Der Schützling ist weg.';
        o.t += dt;
        if (o.t >= d.seconds) o.done = true;
        break;
      }
      case 'collect': {
        for (let i = run.pickups.length - 1; i >= 0; i--) {
          const k = run.pickups[i];
          if (k.tag !== d.tag) continue;
          if (crew.some((p) => { const q = at(p); return dist2(q.x, q.z, k.x, k.z) < 3 * 3; })) {
            run.pickups.splice(i, 1);
            for (const p of crew) this.h.notice(p, 'Eingesammelt!', 'good');
          }
        }
        if (!run.pickups.some((k) => k.tag === d.tag)) o.done = true;
        break;
      }
      case 'survive': {
        o.t += dt;
        if (d.keepWanted) for (const p of crew) if (p.wanted < d.keepWanted) this.h.raiseWanted(p, d.keepWanted);
        if (o.t >= d.seconds) o.done = true;
        break;
      }
      case 'loseWanted': {
        if (run.stageT > 1 && crew.every((p) => p.wanted === 0)) o.done = true;
        break;
      }
      case 'race': {
        const pts = o.pts ?? [];
        let finished = 0;
        for (const p of crew) {
          const i = o.idx.get(p.id) ?? 0;
          if (i >= pts.length) { finished++; continue; }
          const q = at(p);
          if (dist2(q.x, q.z, pts[i].x, pts[i].z) < 16 * 16) {
            o.idx.set(p.id, i + 1);
            if (i + 1 >= pts.length) { run.places.push(p.id); finished++; this.h.notice(p, `Ziel erreicht – Platz ${run.places.length}!`, 'good'); }
          }
        }
        const byPlace = !!run.def.rewards.byPlace;
        if (finished >= crew.length || (!byPlace && finished > 0)) o.done = true;
        break;
      }
      case 'groupAt': {
        const l = this.loc(run, d.at); if (!l) { o.done = true; break; }
        const r = d.radius ?? 15;
        if (crew.every((p) => { const q = at(p); return dist2(q.x, q.z, l.x, l.z) <= r * r; })) o.done = true;
        break;
      }
      case 'choice': {
        // Wer zu Fuß in der Nähe steht, bekommt die Entscheidung angeboten (einmal je Annäherung)
        const l = this.loc(run, d.at); if (!l) { o.done = true; break; }
        const r = d.radius ?? CHOICE_RANGE;
        for (const p of crew) {
          const q = at(p), dd = dist2(q.x, q.z, l.x, l.z);
          if (dd <= r * r && !q.inVehicle) { if (!o.idx.has(p.id)) { o.idx.set(p.id, 1); this.h.offerChoice(p, d.id); } }
          else if (dd > (r + 4) * (r + 4)) o.idx.delete(p.id);
        }
        break;
      }
      case 'destroy': {
        const v = this.tagged(run, d.tag).veh[0];
        if (!v) return 'Das Ziel ist entkommen.';
        if (v.sim.dmg.wreck || v.sim.dmg.hp <= 0) o.done = true;
        break;
      }
      case 'interact': {
        const l = this.loc(run, d.at); if (!l) { o.done = true; break; }
        const holding = crew.some((p) => { const q = at(p); return p.hold && !q.inVehicle && dist2(q.x, q.z, l.x, l.z) <= 7 * 7; });
        o.t = holding ? o.t + dt : Math.max(0, o.t - dt * 2);
        if (o.t >= d.holdSeconds) o.done = true;
        break;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ Anzeige
  /** Spieler hat einen aktiven Auftrag. */
  isActive(playerId: number) { return this.byPlayer.has(playerId); }

  isCarrying(playerId: number): boolean {
    const run = this.byPlayer.get(playerId);
    return !!run && run.pickups.length > 0;
  }

  /** Aktiver Auftrag für einen Spieler (Fortschritt, Zeit, Zielmarkierungen). */
  view(p: ServerPlayer): QuestState | null {
    const run = this.byPlayer.get(p.id);
    if (!run || run.ending > 0) return null;
    const st = run.def.stages[run.stage];
    const targets: QuestState['targets'] = [];
    const prog: string[] = [];
    for (const o of run.objs) {
      const d = o.def;
      const l = 'at' in d ? this.loc(run, d.at) : null;
      switch (d.type) {
        case 'goTo': case 'deliverVehicle': case 'groupAt': if (l && !o.done) targets.push([l.x, l.z, d.radius ?? 12, 1]); break;
        case 'choice': if (l && !o.done) { targets.push([l.x, l.z, 3, 4]); prog.push('Hingehen und reden'); } break;
        case 'destroy': {
          const v = this.tagged(run, d.tag).veh[0];
          if (v && !o.done) { targets.push([v.sim.car.x, v.sim.car.z, 4, 5]); prog.push(`Ziel: ${Math.max(0, Math.round(v.sim.dmg.hp / 10))} %`); }
          break;
        }
        case 'interact': if (l && !o.done) { targets.push([l.x, l.z, 7, 1]); prog.push(`Halten ${Math.floor(o.t)}/${d.holdSeconds} s (F)`); } break;
        case 'race': {
          const i = o.idx.get(p.id) ?? 0, pts = o.pts ?? [];
          if (i < pts.length) { targets.push([pts[i].x, pts[i].z, 16, 2]); if (pts[i + 1]) targets.push([pts[i + 1].x, pts[i + 1].z, 16, 2]); }
          prog.push(`Checkpoint ${Math.min(i + 1, pts.length)}/${pts.length}`);
          break;
        }
        case 'collect': {
          const left = run.pickups.filter((k) => k.tag === d.tag);
          for (const k of left.slice(0, 8)) targets.push([k.x, k.z, 3, 3]);
          prog.push(`Gesammelt: noch ${left.length}`);
          break;
        }
        case 'enterVehicle': for (const v of this.tagged(run, d.tag).veh) targets.push([v.sim.car.x, v.sim.car.z, 4, 6]); break;
        case 'follow': {
          const v = this.tagged(run, d.tag).veh[0];
          if (v) targets.push([v.sim.car.x, v.sim.car.z, 4, 6]);
          prog.push(`Dranbleiben ${Math.floor(o.t)}/${d.seconds} s`);
          break;
        }
        case 'protect': {
          const t = this.tagged(run, d.tag);
          const ped = t.ped[0], veh = t.veh[0];
          if (ped) targets.push([ped.x, ped.z, 4, 4]);
          else if (veh) targets.push([veh.sim.car.x, veh.sim.car.z, 4, 4]);
          prog.push(`Schützen ${Math.floor(o.t)}/${d.seconds} s`);
          break;
        }
        case 'defeat': {
          const alive = this.tagged(run, d.tag).ped.filter((q) => q.hp > 0);
          for (const q of alive.slice(0, 6)) targets.push([q.x, q.z, 2, 5]);
          prog.push(`Gegner: ${alive.length}`);
          break;
        }
        case 'survive': prog.push(`Überleben ${Math.floor(o.t)}/${d.seconds} s`); break;
        case 'loseWanted': prog.push('Fahndung abschütteln'); break;
      }
    }
    if (run.places.length && run.def.rewards.byPlace) prog.push(`Platz ${run.places.indexOf(p.id) + 1 || '–'}`);
    return {
      id: run.def.id, title: run.def.title, stage: st.description, stageIdx: run.stage, stageCount: run.def.stages.length,
      prog: prog.join(' · '), timer: run.timeLeft >= 0 ? Math.ceil(run.timeLeft) : -1, targets,
    };
  }

  repStatusOf(p: ServerPlayer, gang: GangId) { return repStatus(p.profile.reputation[gang] ?? 0); }
  find(id: string) { return QUEST_BY_ID.get(id); }
}
