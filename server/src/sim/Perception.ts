// Wahrnehmung, Reaktionen & Barks (Schritt 4 + 5). Aktionen erzeugen Ereignisse mit Radius und Stärke
// (Hupe, Unfall, Schuss, Explosion, Schlägerei, Sirene, Sprint, Auto auf dem Gehweg …). Perception
// verteilt sie an die NPCs im Radius (bei sichtbaren Ereignissen mit Sichtlinie), wählt die Reaktion
// nach Archetyp-Mut und Abstand (shared/npc/reactions.ts) und lässt NpcBrain sie ausführen.
// Barks: Abklingzeit pro NPC und globale Obergrenze je Umkreis; übers Netz geht nur ['bark', id, sit, var].
// Alles, was Gameplay betrifft (Polizei rufen, Zeugen), entscheidet hier der Server.
import { dist2 } from '../../../shared/src/math';
import { archetypeOf } from '../../../shared/src/npc/archetypes';
import {
  ACT_BARK, BARK_COOLDOWN, BARK_DURATION, BARK_INDEX, BARK_MAX_NEAR, barkLines, type BarkSit,
} from '../../../shared/src/npc/barks';
import { NEED_IDS, STEP_NAMES } from '../../../shared/src/npc/intents';
import type { DayPart, Weather } from '../../../shared/src/npc/population';
import { NPC_EVENTS, NpcEv, REACTION_NAMES, chooseReaction, type NpcEvId, type ReactionId } from '../../../shared/src/npc/reactions';
import { SCENARIOS, SMART_KINDS } from '../../../shared/src/npc/scenarios';
import { Btn, type GameEvent, type NpcDebugPed } from '../../../shared/src/protocol';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { ServerPlayer, ServerVehicle } from '../entities/types';
import { wallDistance } from './Combat';
import type { NpcBrain } from './NpcBrain';
import type { Ped, Pedestrians } from './Pedestrians';

export interface PerceptionHost {
  map: WorldMap;
  peds: Pedestrians;
  vehicles: Map<number, ServerVehicle>;
  players: Map<number, ServerPlayer>;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  emit(x: number, z: number, ev: GameEvent): void;
  part(): DayPart;
  weather(): Weather;
  isNight(): boolean;
}

interface PEvent { ev: NpcEvId; x: number; z: number; src: number; target: number; age: number }


const SIGHT_MIN = 2.5;

export class Perception {
  private queue: PEvent[] = [];
  /** Letzte Ereignisse (Debug-Kreise) */
  recent: PEvent[] = [];
  private cd = new Map<string, number>();
  private barks: { x: number; z: number; t: number }[] = [];
  private lastPos = new Map<number, { x: number; z: number }>();
  private passT = 0;
  /** Zähler für den Lasttest/Debug */
  stats = { events: 0, reactions: 0, barks: 0 };

  constructor(private h: PerceptionHost, private brain: NpcBrain) {}

  /** Ereignis melden. src = verursachender Spieler (-1 = keiner), target = nur dieser NPC (Anrempeln). */
  event(ev: NpcEvId, x: number, z: number, src = -1, target = -1) {
    this.queue.push({ ev, x, z, src, target, age: 0 });
  }

  /** Ereignis mit Abklingzeit pro Schlüssel (Dauerquellen wie Hupe, Sirene, Gehweg-Fahrt). */
  eventRL(key: string, cd: number, ev: NpcEvId, x: number, z: number, src = -1, target = -1) {
    if ((this.cd.get(key) ?? 0) > 0) return;
    this.cd.set(key, cd);
    this.event(ev, x, z, src, target);
  }

  /** Spiel-Ereignisse (WorldRoom.emit) in NPC-Ereignisse übersetzen. */
  fromGameEvent(x: number, z: number, ev: GameEvent) {
    switch (ev[0]) {
      case 'honk': this.eventRL('honk' + ev[1], 1, NpcEv.Honk, x, z, -1); break;
      case 'boom': this.event(NpcEv.Explosion, x, z, -1); break;
      case 'crash': {
        const vid = ev[1] as number, dv = ev[7] as number;
        if (dv > 3.5) this.eventRL('crash' + vid, 1.2, NpcEv.Crash, x, z, this.driverOf(vid));
        break;
      }
    }
  }

  private driverOf(vid: number): number {
    const v = this.h.vehicles.get(vid);
    return v && v.driver >= 0 ? v.driver : -1;
  }

  // ------------------------------------------------------------------ Tick
  update(dt: number) {
    for (const [k, t] of this.cd) { if (t - dt <= 0) this.cd.delete(k); else this.cd.set(k, t - dt); }
    for (let i = this.barks.length - 1; i >= 0; i--) if ((this.barks[i].t -= dt) <= 0) this.barks.splice(i, 1);
    for (let i = this.recent.length - 1; i >= 0; i--) if ((this.recent[i].age += dt) > 4) this.recent.splice(i, 1);
    this.playerEvents(dt);
    this.vehicleEvents();
    const q = this.queue;
    this.queue = [];
    for (const e of q) this.dispatch(e);
    this.passT -= dt;
    if (this.passT <= 0) { this.passT = 0.5; this.ambient(); this.pointAtWanted(); }
  }

  /** Spieler zu Fuß: Sprinten, Anrempeln; im Auto: Hupe. */
  private playerEvents(dt: number) {
    for (const p of this.h.players.values()) {
      const pos = this.h.positionOf(p);
      const last = this.lastPos.get(p.id);
      this.lastPos.set(p.id, { x: pos.x, z: pos.z });
      if (!last || p.downT > 0) continue;
      if (pos.inVehicle) {
        if (p.buttons & Btn.HORN) this.eventRL('horn' + p.id, 0.8, NpcEv.Honk, pos.x, pos.z, p.id);
        continue;
      }
      if (p.pawn.rt > 0) continue;
      const speed = Math.hypot(pos.x - last.x, pos.z - last.z) / Math.max(1e-3, dt);
      if (speed > 5.2) this.eventRL('sprint' + p.id, 0.3, NpcEv.Sprint, pos.x, pos.z, p.id);
      if (speed > 1.2) {
        for (const ped of this.h.peds.peds.values()) {
          if (!ped.mind || ped.rt > 0 || Math.abs(ped.x - pos.x) > 0.9 || Math.abs(ped.z - pos.z) > 0.9) continue;
          if (dist2(ped.x, ped.z, pos.x, pos.z) < 0.8 * 0.8) {
            ped.fdx = ped.x - pos.x; ped.fdz = ped.z - pos.z;
            const l = Math.hypot(ped.fdx, ped.fdz) || 1; ped.fdx /= l; ped.fdz /= l;
            this.eventRL('bump' + ped.id, 2.5, NpcEv.Bump, pos.x, pos.z, p.id, ped.id);
          }
        }
      }
    }
  }

  /** Fahrzeuge: Gehweg-Fahrt, Sirenen der Streifenwagen. */
  private vehicleEvents() {
    for (const v of this.h.vehicles.values()) {
      const c = v.sim.car;
      const sp = Math.hypot(c.vx, c.vz);
      if (sp < 2.5) continue;
      if (v.cop !== undefined) this.eventRL('siren' + v.id, 1.5, NpcEv.Siren, c.x, c.z, -1);
      if (sp > 3 && v.driver >= 0) {
        const t = this.h.map.tileAt(c.x, c.z);
        if (t === Tile.SIDEWALK || t === Tile.PLAZA) this.eventRL('walk' + v.id, 0.4, NpcEv.Sidewalk, c.x, c.z, v.driver);
      }
    }
  }

  /** Ereignis an alle NPCs im Radius verteilen und Reaktionen wählen. */
  private dispatch(e: PEvent) {
    const def = NPC_EVENTS[e.ev];
    this.stats.events++;
    this.recent.push(e);
    if (this.recent.length > 40) this.recent.shift();
    const r2 = def.r * def.r;
    const panicked: Ped[] = [];
    const reacted = new Set<number>();
    const culprit = e.src >= 0 && (def.crime || e.ev === NpcEv.Shot || e.ev === NpcEv.Explosion || e.ev === NpcEv.Sidewalk);
    for (const p of this.h.peds.peds.values()) {
      if (!p.mind || p.hp <= 0) continue;
      if (e.target >= 0 && p.id !== e.target) continue;
      const d2 = dist2(p.x, p.z, e.x, e.z);
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      if (def.sight && d > SIGHT_MIN && wallDistance(this.h.map, e.x, e.z, Math.atan2(p.x - e.x, p.z - e.z), d) < d - 1) continue;
      const m = p.mind;
      m.seen.push([e.ev, 3]);
      if (m.seen.length > 4) m.seen.shift();
      if (culprit) this.brain.remember(p, e.src);
      if (p.rt > 0 || m.exitT > 0) continue;
      const i = def.s * Math.sqrt(Math.max(0, 1 - d / def.r));
      const ch = chooseReaction(e.ev, i, m.courage, Math.random(), m.filmer, d);
      if (!ch) continue;
      const [id, dur] = ch;
      // Blick/Annäherung folgt dem Verursacher, Flucht geht vom Ereignisort weg
      const follow = e.src >= 0 && (id === 'scold' || id === 'intervene' || id === 'film' || id === 'look') ? e.src : -1;
      if (!this.brain.react(p, id, dur, e.ev, e.x, e.z, follow)) continue;
      this.stats.reactions++;
      reacted.add(p.id);
      m.last = `${REACTION_NAMES[id]} (${def.name})`;
      if (id === 'flee' || id === 'panic') panicked.push(p);
      this.reactBark(p, id, e.ev);
    }
    // Panik in Gruppen: wer neben einem Flüchtenden steht, läuft (je nach Mut) mit
    if (panicked.length && def.s >= 0.5) {
      for (const p of this.h.peds.peds.values()) {
        if (!p.mind || reacted.has(p.id) || p.rt > 0 || p.mind.exitT > 0) continue;
        for (const q of panicked) {
          if (dist2(p.x, p.z, q.x, q.z) > 6 * 6 || Math.random() > 1 - p.mind.courage * 0.7) continue;
          if (this.brain.react(p, 'flee', 3 + Math.random() * 2, e.ev, e.x, e.z, -1)) { p.mind.last = 'flüchtet mit der Gruppe'; this.stats.reactions++; }
          break;
        }
      }
    }
  }

  private reactBark(p: Ped, id: ReactionId, ev: NpcEvId) {
    const r = Math.random();
    switch (id) {
      case 'scold': this.bark(p, ev === NpcEv.Bump ? 'bumped' : ev === NpcEv.Sidewalk ? 'near_miss' : 'scold'); break;
      case 'stumble': this.bark(p, 'bumped'); break;
      case 'film': if (r < 0.5) this.bark(p, 'film'); break;
      case 'call': this.bark(p, 'call'); break;
      case 'intervene': this.bark(p, 'intervene'); break;
      case 'panic': if (r < 0.35) this.bark(p, 'gunfire'); break;
      case 'flee': if (r < 0.25) this.bark(p, ev === NpcEv.Shot || ev === NpcEv.Explosion ? 'gunfire' : 'near_miss'); break;
      case 'dodge': if (r < 0.3) this.bark(p, 'dodge'); break;
      case 'look': if (ev === NpcEv.Crash && r < 0.35) this.bark(p, 'crash'); else if (ev === NpcEv.Siren && r < 0.15) this.bark(p, 'police'); break;
    }
  }

  // ------------------------------------------------------------------ Zeugen (Police)
  /** Ein Passant hat ein Verbrechen gesehen und ruft die Polizei (spec 11.2: Meldung nach 3 s). */
  onWitness(ped: Ped, p: ServerPlayer, x: number, z: number) {
    if (!ped.mind) return;
    this.brain.remember(ped, p.id);
    if (this.brain.react(ped, 'call', 3.5, -1, x, z, p.id)) {
      ped.mind.last = 'ruft die Polizei';
      this.bark(ped, 'call');
    }
  }

  // ------------------------------------------------------------------ Barks
  /** Spruch auslösen (Abklingzeit pro NPC, max. BARK_MAX_NEAR gleichzeitig im Umkreis von 30 m). */
  bark(p: Ped, sit: BarkSit): boolean {
    const m = p.mind;
    if (p.rt > 0 || (m ? m.barkCd > 0 : (this.cd.get('bark' + p.id) ?? 0) > 0)) return false;
    let near = 0;
    for (const b of this.barks) if (dist2(b.x, b.z, p.x, p.z) < 30 * 30) near++;
    if (near >= BARK_MAX_NEAR) return false;
    const lines = barkLines(BARK_INDEX[sit], p.arch);
    if (!lines.length) return false;
    const cd = BARK_COOLDOWN[0] + Math.random() * (BARK_COOLDOWN[1] - BARK_COOLDOWN[0]);
    if (m) m.barkCd = cd; else this.cd.set('bark' + p.id, cd);
    this.barks.push({ x: p.x, z: p.z, t: BARK_DURATION });
    this.h.emit(p.x, p.z, ['bark', p.id, BARK_INDEX[sit], Math.floor(Math.random() * lines.length)]);
    this.stats.barks++;
    return true;
  }

  /** Umgebungs-Sprüche in Spielernähe: Gruß, Hitze, Polizei sichtbar, nachts allein, Regen, Alltag. */
  private ambient() {
    const part = this.h.part(), night = this.h.isNight(), weather = this.h.weather();
    for (const pl of this.h.players.values()) {
      if (Math.random() > 0.42) continue; // ~1 Umgebungs-Spruch pro Sekunde je Spieler (Obergrenze greift zusätzlich)
      const pos = this.h.positionOf(pl);
      const cands: Ped[] = [];
      for (const p of this.h.peds.peds.values()) {
        if (!p.mind || p.mind.react || p.mind.barkCd > 0 || p.rt > 0 || p.mind.exitT > 0) continue;
        const d2 = dist2(p.x, p.z, pos.x, pos.z);
        if (d2 < 2.5 * 2.5 || d2 > 24 * 24) continue;
        cands.push(p);
      }
      // Gang-Mitglieder (ohne Kopf-Logik) rufen gelegentlich Revier-Sprüche
      for (const g of this.h.peds.peds.values()) {
        if (!g.gang || g.rt > 0 || g.hp <= 0 || dist2(g.x, g.z, pos.x, pos.z) > 22 * 22) continue;
        if (Math.random() < 0.12) this.bark(g, 'gang');
      }
      if (!cands.length) continue;
      const p = cands[Math.floor(Math.random() * cands.length)];
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      const r = Math.random();
      let sit: BarkSit = 'idle';
      if (p.mind!.fear?.pid === pl.id) sit = 'fear';
      else if (ACT_BARK[p.act] && r < 0.7) sit = ACT_BARK[p.act]; // spricht passend zu dem, was er gerade tut
      else if (this.copNear(p.x, p.z, 25) && r < 0.6) sit = 'police';
      else if (weather === 'rain' && r < 0.6) sit = 'rain';
      else if (night && !pos.inVehicle && d < 9 && this.alone(p) && r < 0.7) sit = 'night_alone';
      else if (!pos.inVehicle && d < 5 && r < 0.55) {
        sit = 'greet';
        if (!p.scn) { p.a = Math.atan2(pos.x - p.x, pos.z - p.z); if (Math.random() < 0.5) this.brain.react(p, 'look', 1.2, -1, pos.x, pos.z, pl.id); }
      } else if ((part === 'noon' || part === 'afternoon' || weather === 'heat') && r < 0.4) sit = 'heat';
      this.bark(p, sit);
    }
  }

  private copNear(x: number, z: number, r: number): boolean {
    for (const v of this.h.vehicles.values()) if (v.cop !== undefined && dist2(v.sim.car.x, v.sim.car.z, x, z) < r * r) return true;
    for (const c of this.h.peds.peds.values()) if (c.cop && dist2(c.x, c.z, x, z) < r * r) return true;
    return false;
  }

  private alone(p: Ped): boolean {
    for (const o of this.h.peds.peds.values()) if (o !== p && !o.cop && dist2(o.x, o.z, p.x, p.z) < 12 * 12) return false;
    return true;
  }

  /** Bei bekannter Fahndung zeigen Passanten auf den Spieler (max. 2 gleichzeitig). */
  private pointAtWanted() {
    for (const pl of this.h.players.values()) {
      if (pl.wanted <= 0 || pl.downT > 0) continue;
      const pos = this.h.positionOf(pl);
      let pointing = 0;
      const cands: Ped[] = [];
      for (const p of this.h.peds.peds.values()) {
        if (!p.mind || p.rt > 0) continue;
        const d2 = dist2(p.x, p.z, pos.x, pos.z);
        if (d2 > 16 * 16) continue;
        if (p.mind.react?.id === 'point') { pointing++; continue; }
        if (!p.mind.react && !(p.scn && p.scn.obj >= 0) && d2 > 3 * 3) cands.push(p);
      }
      if (pointing >= 2 || !cands.length || Math.random() > 0.3) continue;
      const p = cands[Math.floor(Math.random() * cands.length)];
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (wallDistance(this.h.map, pos.x, pos.z, Math.atan2(p.x - pos.x, p.z - pos.z), d) < d - 1) continue;
      if (this.brain.react(p, 'point', 2.6, -1, pos.x, pos.z, pl.id)) { p.mind!.last = 'zeigt auf den Gesuchten'; this.bark(p, 'wanted'); }
    }
  }

  // ------------------------------------------------------------------ Debug (F3 → NPC-Tab)
  debugView(x: number, z: number, r = 45): { peds: NpcDebugPed[]; events: [number, number, number, number, number][] } {
    const peds: NpcDebugPed[] = [];
    for (const p of this.h.peds.peds.values()) {
      if (!p.mind || dist2(p.x, p.z, x, z) > r * r) continue;
      const m = p.mind;
      const obj = p.scn
        ? `${SCENARIOS[p.scn.id].name}${p.scn.obj >= 0 ? ' @ ' + SMART_KINDS[this.brain.objects[p.scn.obj]?.kind]?.name + ' #' + p.scn.obj : ''}${p.scn.t > 1e8 ? '' : ` (${Math.ceil(p.scn.t)} s)`}`
        : m.goal ? `→ ${m.goal.kind === 'car' ? 'Auto #' + m.goal.car : SMART_KINDS[this.brain.objects[m.goal.obj]?.kind]?.name + ' #' + m.goal.obj} (${m.goal.phase === 'route' ? 'Route ' + m.goal.route.length : 'Annäherung'})` : '';
      peds.push({
        id: p.id, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, arch: archetypeOf(p.arch).name, act: p.act,
        chain: m.chain.map((s) => STEP_NAMES[s] ?? SCENARIOS[s as keyof typeof SCENARIOS]?.name ?? s), step: m.step,
        needs: NEED_IDS.map((k) => Math.round(m.needs[k] * 100) / 100),
        obj, react: m.react ? `${REACTION_NAMES[m.react.id]} ${m.react.t.toFixed(1)} s` : '',
        goal: m.goal ? [Math.round(m.goal.x * 10) / 10, Math.round(m.goal.z * 10) / 10] : null,
        fear: m.fear ? Math.ceil(m.fear.t) : 0, lod: m.lod, last: m.last, seen: m.seen.map(([e]) => NPC_EVENTS[e as NpcEvId].name),
      });
    }
    const events: [number, number, number, number, number][] = this.recent
      .filter((e) => dist2(e.x, e.z, x, z) < (r + 60) ** 2)
      .map((e) => [e.ev, Math.round(e.x * 10) / 10, Math.round(e.z * 10) / 10, NPC_EVENTS[e.ev].r, Math.round(e.age * 10) / 10]);
    return { peds, events };
  }
}

