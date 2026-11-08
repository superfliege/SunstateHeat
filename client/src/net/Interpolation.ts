// Interpolation fremder Entitäten: Wir rendern leicht in der Vergangenheit
// (INTERP_DELAY_MS) und interpolieren zwischen den zwei passenden Snapshots.
// Fahrzeuge werden zusätzlich kurz anhand ihrer Geschwindigkeit extrapoliert, damit sie
// näher an der Gegenwart erscheinen (wichtig für Kollisionen mit dem eigenen Auto).
//
// Snapshots kommen als Delta (nur geänderte Fahrzeuge/Fußgänger) – der Puffer führt einen
// vollständigen Zustand und legt pro Snapshot eine Kopie für die Interpolation ab.
import { INTERP_DELAY_MS } from '../../../shared/src/constants';
import type { PedTuple, PlayerTuple, SnapshotMsg, VehicleTuple } from '../../../shared/src/protocol';

interface Entry {
  snap: SnapshotMsg;
  time: number;
  players: Map<number, PlayerTuple>;
  vehicles: Map<number, VehicleTuple>;
  peds: Map<number, PedTuple>;
}

export interface Frame {
  a: Entry;
  b: Entry;
  t: number; // 0..1 zwischen a und b
  /** Sekunden, um die über b hinaus extrapoliert werden darf (0 = innerhalb). */
  over: number;
}

/** Fahrzeuge: so weit (s) über den Interpolationszeitpunkt hinaus extrapolieren. */
export const VEHICLE_EXTRAPOLATION = 0.08;

export class SnapshotBuffer {
  private entries: Entry[] = [];
  private offset = 0; // Serverzeit - lokale Zeit
  private hasOffset = false;
  /** Vollständiger aktueller Zustand (aus Deltas zusammengesetzt). */
  readonly vehicles = new Map<number, VehicleTuple>();
  readonly peds = new Map<number, PedTuple>();

  push(snap: SnapshotMsg) {
    const off = snap.time - performance.now();
    if (!this.hasOffset) { this.offset = off; this.hasOffset = true; }
    else this.offset += (off - this.offset) * 0.05; // Jitter glätten
    for (const v of snap.v ?? []) this.vehicles.set(v[0], v);
    for (const id of snap.vg ?? []) this.vehicles.delete(id);
    for (const p of snap.p ?? []) this.peds.set(p[0], p);
    for (const id of snap.pg ?? []) this.peds.delete(id);
    this.entries.push({
      snap, time: snap.time,
      players: new Map(snap.players.map((p) => [p[0], p])),
      vehicles: new Map(this.vehicles),
      peds: new Map(this.peds),
    });
    if (this.entries.length > 40) this.entries.shift();
  }

  get latest(): SnapshotMsg | null {
    return this.entries.length ? this.entries[this.entries.length - 1].snap : null;
  }

  /** Geschätzte aktuelle Serverzeit (ms). */
  get serverNow() { return performance.now() + this.offset; }

  /** Alter des neuesten Snapshots relativ zur geschätzten Serverzeit (s). */
  latestAge(): number {
    const n = this.entries.length;
    return n ? Math.max(0, (this.serverNow - this.entries[n - 1].time) / 1000) : 0;
  }

  frame(): Frame | null {
    const n = this.entries.length;
    if (n === 0) return null;
    const rt = this.serverNow - INTERP_DELAY_MS;
    for (let i = n - 1; i > 0; i--) {
      const a = this.entries[i - 1], b = this.entries[i];
      if (a.time <= rt) {
        const span = b.time - a.time || 1;
        const t = (rt - a.time) / span;
        return { a, b, t: Math.min(1, Math.max(0, t)), over: Math.max(0, (rt - b.time) / 1000) };
      }
    }
    const first = this.entries[0];
    return { a: first, b: first, t: 0, over: 0 };
  }
}
