// Szenen-Regie: Ankunftsszenen und Weltgeschehen.
//  - Ankunftsszene: Sobald ein frisch eingeloggter Spieler zu Fuß auf die Straße läuft (oder nach ein paar
//    Sekunden schon direkt daneben steht), passiert direkt vor ihm etwas Absurdes (scenes/arrival.ts).
//    Der begrüßte Spieler ist währenddessen unverwundbar und wird nicht umgeworfen.
//  - Weltgeschehen: Damit ständig etwas los ist, startet die Regie um jeden Spieler herum alle 25–45 s ein
//    Straßenereignis (scenes/street.ts: Streife, Verfolgung, Bandenkrieg, Razzia – ab und zu auch eine der
//    Ankunftsszenen), gewichtet nach Viertel-DNA (Bandenstimmung, Polizeipräsenz, Tageszeit). Unabhängig
//    davon quatscht alle 1–2 Minuten ein Passant den Spieler an. Ereignisse stapeln sich nicht (Abstand).
// Alles läuft auf dem Server; alle Spieler in der Nähe sehen dasselbe. Fahndung gibt es nur, wenn ein
// Spieler selbst mitmischt (z. B. auf Polizisten schießt).
import { distToSegment } from '../../../shared/src/world/geometry';
import { RoadType } from '../../../shared/src/world/WorldMap';
import { findFootSpot } from '../../../shared/src/sim/movement';
import { POLICE } from '../../../shared/src/factions';
import { dnaFor, type DistrictDNA } from '../../../shared/src/world/districts';
import type { ServerPlayer } from '../entities/types';
import { ARRIVAL_NAMES, ARRIVAL_NEED, createArrival } from './scenes/arrival';
import { findLane, shuffle, type Lane, type Scene, type SceneHost } from './scenes/Scene';
import { FootChaseEvent, GangWarEvent, PatrolEvent, RaidEvent, STREET_NAMES, STREET_NEED, TalkerEvent } from './scenes/street';

export type { SceneHost } from './scenes/Scene';
export const SCENE_NAMES = ARRIVAL_NAMES;
export { STREET_NAMES };

interface Pending { pid: number; ready: number; check: number }
/** Regie-Zustand je Spieler: Sekunden bis zum nächsten Straßenereignis bzw. Anquatscher. */
interface Watch { next: number; talk: number }

/** Mindestabstand zwischen zwei laufenden Ereignissen. */
const EVENT_SPACING = 85;

export class Scenes {
  private pending: Pending[] = [];
  private running: { scene: Scene; pid: number; talker: boolean }[] = [];
  private watch = new Map<number, Watch>();

  constructor(private h: SceneHost, private isNight: () => boolean = () => false) {}

  /** Neuer Spieler: Ankunftsszene vormerken (startet, sobald er zu Fuß an die Straße kommt). */
  welcome(p: ServerPlayer) {
    this.pending.push({ pid: p.id, ready: 0, check: 0 });
    // Das Weltgeschehen setzt erst nach der Ankunftsszene ein
    this.watch.set(p.id, { next: 40 + Math.random() * 15, talk: 55 + Math.random() * 40 });
  }

  /** Dev: Ankunftsszene sofort starten (idx 0–4, sonst zufällig). */
  startFor(p: ServerPlayer, idx?: number): string {
    this.pending = this.pending.filter((w) => w.pid !== p.id); // ersetzt die Ankunftsszene
    const s = this.startArrival(p, idx);
    return s ? `Szene: ${s.name}` : 'Keine passende Straße in der Nähe.';
  }

  /** Dev: Straßenereignis sofort starten (idx in STREET_NAMES). */
  startEventFor(p: ServerPlayer, idx: number): string {
    this.pending = this.pending.filter((w) => w.pid !== p.id); // Test geht vor: keine Ankunftsszene mehr
    const s = this.startStreet(p, idx, true);
    return s ? `Ereignis: ${s.name}` : 'Kein passender Ort in der Nähe.';
  }

  update(dt: number) {
    this.updateArrivals(dt);
    this.direct(dt);
    for (let i = this.running.length - 1; i >= 0; i--) {
      const r = this.running[i];
      if (!r.scene.step(dt)) { r.scene.end(); this.running.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- Ankunft

  private updateArrivals(dt: number) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const w = this.pending[i];
      const p = this.h.players.get(w.pid);
      if (!p || w.ready > 180) { this.pending.splice(i, 1); continue; }
      if (p.lastSeq === 0 || p.downT > 0 || p.vehicleId >= 0) continue; // Client lädt noch / sitzt im Auto
      w.ready += dt;
      if (w.ready < 1.5 || (w.check -= dt) > 0) continue;
      w.check = 0.25;
      // Läuft er auf die Straße (bzw. steht nach 10 s schon direkt daneben)? Dann geht's los.
      if (!this.nearRoad(p, w.ready > 10 ? 9 : 2)) continue;
      if (this.startArrival(p)) this.pending.splice(i, 1);
    }
  }

  /** Spieler höchstens `margin` m neben der Fahrbahn (Gehweg zählt mit)? */
  private nearRoad(p: ServerPlayer, margin: number): boolean {
    const pos = this.h.positionOf(p);
    for (const e of this.h.map.edges) {
      if (e.type === RoadType.Pier) continue;
      const r = e.width / 2 + e.sidewalk + margin;
      for (let k = 1; k < e.pts.length; k++) {
        const a = e.pts[k - 1], b = e.pts[k];
        if (Math.abs(a[0] - pos.x) > 40 || Math.abs(a[1] - pos.z) > 40) continue;
        if (distToSegment(pos.x, pos.z, a[0], a[1], b[0], b[1]).d < r) return true;
      }
    }
    return false;
  }

  private startArrival(p: ServerPlayer, idx?: number, protect = true): Scene | null {
    const pos = this.h.positionOf(p);
    const kinds = idx !== undefined && idx >= 0 && idx < ARRIVAL_NAMES.length ? [idx] : shuffle([0, 1, 2, 3, 4]);
    for (const kind of kinds) {
      const [back, fwd] = ARRIVAL_NEED[kind];
      const lane = findLane(this.h.map, pos.x, pos.z, back, fwd);
      if (!lane) continue;
      const s = createArrival(kind, this.h, lane, p);
      this.running.push({ scene: s, pid: p.id, talker: false });
      if (protect) p.invuln = Math.max(p.invuln, s.duration);
      return s;
    }
    return null;
  }

  // ---------------------------------------------------------------- Weltgeschehen

  private direct(dt: number) {
    for (const id of this.watch.keys()) if (!this.h.players.has(id)) this.watch.delete(id);
    for (const p of this.h.players.values()) {
      let w = this.watch.get(p.id);
      if (!w) { w = { next: 20 + Math.random() * 20, talk: 50 + Math.random() * 40 }; this.watch.set(p.id, w); }
      if (p.lastSeq === 0 || p.downT > 0 || this.h.busy(p) || this.pending.some((q) => q.pid === p.id)) continue;
      w.next -= dt; w.talk -= dt;
      const pos = this.h.positionOf(p);
      if (w.next <= 0) {
        if (this.eventNear(pos.x, pos.z, EVENT_SPACING)) w.next = 6;
        else w.next = this.startStreet(p) ? 25 + Math.random() * 20 : 6;
      }
      if (w.talk <= 0) {
        const busy = pos.inVehicle || p.wanted > 0 || this.running.some((r) => r.talker && r.pid === p.id);
        w.talk = busy ? 8 : this.startTalker(p) ? 60 + Math.random() * 60 : 10;
      }
    }
  }

  private eventNear(x: number, z: number, r: number): boolean {
    return this.running.some((e) => !e.talker && Math.hypot(e.scene.where.x - x, e.scene.where.z - z) < r);
  }

  private dnaAt(x: number, z: number): DistrictDNA | null {
    return dnaFor(this.h.map.districtAt(x, z)?.name);
  }

  /**
   * Straßenereignis starten. Ohne idx gewichtet nach Viertel: viel Polizei = mehr Streifen/Verfolgungen,
   * hohe Bandenstimmung (und Nacht) = mehr Bandenkriege/Razzien. Ab und zu eine Ankunftsszene als Bonus.
   */
  private startStreet(p: ServerPlayer, idx?: number, dev = false): Scene | null {
    const pos = this.h.positionOf(p);
    const dna = this.dnaAt(pos.x, pos.z);
    if (idx === 4) return this.startTalker(p);
    let order: number[];
    if (idx !== undefined) order = [idx];
    else {
      const cops = (dna ? POLICE.presence[dna.id] ?? 40 : 40) / 100;
      const gang = ((dna ? dna.mood.gang : 30) / 100) * (this.isNight() ? 1.6 : 1);
      const weights: [number, number][] = [
        [0, 2 + cops * 3], [1, 1.2 + cops * 2], [2, 0.8 + gang * 4], [3, 0.6 + gang * 2.5 + cops], [5, 1.2],
      ];
      order = [];
      while (weights.length) {
        const total = weights.reduce((s, w) => s + w[1], 0);
        let r = Math.random() * total, i = 0;
        while (i < weights.length - 1 && (r -= weights[i][1]) > 0) i++;
        order.push(weights.splice(i, 1)[0][0]);
      }
    }
    for (const kind of order) {
      if (kind === 5) { const s = this.startArrival(p, undefined, false); if (s) return s; continue; }
      const [back, fwd] = STREET_NEED[kind];
      // Zu Fuß muss es im Bild sein; im Auto (Kamera weiter weg) darf die Straße etwas entfernter liegen
      const lane = findLane(this.h.map, pos.x, pos.z, back, fwd, pos.inVehicle && !dev ? 35 : 20);
      if (!lane) continue;
      let s: Scene;
      switch (kind) {
        case 0: s = new PatrolEvent(this.h, lane, p); break;
        case 1: s = new FootChaseEvent(this.h, lane, p); break;
        case 2: s = new GangWarEvent(this.h, lane, p, dna); break;
        default: s = new RaidEvent(this.h, lane, p, dna); break;
      }
      this.running.push({ scene: s, pid: p.id, talker: false });
      return s;
    }
    return null;
  }

  /** Anquatscher: Passant taucht 11–14 m entfernt auf (möglichst nicht hinter der Minimap unten rechts). */
  private startTalker(p: ServerPlayer): Scene | null {
    const pos = this.h.positionOf(p);
    if (pos.inVehicle) return null;
    for (let t = 0; t < 16; t++) {
      const a = Math.random() * Math.PI * 2, r = 11 + Math.random() * 3;
      const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
      if (x > pos.x + 5 && z > pos.z) continue; // unten rechts liegt die Minimap
      const spot = findFootSpot(this.h.map, x, z, 3);
      if (!spot) continue;
      // Szenen brauchen eine „Spur“ als Bezug – hier genügt ein kurzes Stück um den Spieler
      const lane: Lane = { edge: this.h.map.edges[0], forward: true, pts: [[pos.x - 1, pos.z], [pos.x + 1, pos.z]], cum: [0, 2], len: 2, s0: 1 };
      const s = new TalkerEvent(this.h, lane, p, this.dnaAt(pos.x, pos.z), spot);
      this.running.push({ scene: s, pid: p.id, talker: true });
      return s;
    }
    return null;
  }
}
