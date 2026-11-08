// Fahrspaß-Boni: Drift-Punkte mit Multiplikator, Sprünge (Weite, Drehung, saubere Landung)
// und Beinahe-Unfälle mit Gegenverkehr. Läuft auf dem Client (sofortige Anzeige) und auf dem
// Server (zahlt das Bonusgeld aus) mit demselben Code.
import { pitchRoll, type CarState } from './car';

export interface BonusEvent {
  kind: 'drift' | 'stunt' | 'near' | 'driftFail';
  points: number;
  /** Bonusgeld ($, klein). */
  money: number;
  /** Zusatzinfo für die Anzeige (Weite, Drehung, sauber, Multiplikator). */
  info: string;
}

export interface StuntTracker {
  // Drift
  driftT: number; driftPts: number; driftCalm: number;
  // Sprung
  airT: number; airX: number; airZ: number; airYaw: number; airPrevYaw: number; airMaxH: number; airY0: number;
  // Beinahe-Unfall: Fahrzeug-ID -> Abklingzeit
  near: Map<number, number>;
}

export const newStuntTracker = (): StuntTracker => ({
  driftT: 0, driftPts: 0, driftCalm: 0,
  airT: 0, airX: 0, airZ: 0, airYaw: 0, airPrevYaw: 0, airMaxH: 0, airY0: 0,
  near: new Map(),
});

export const STUNT = {
  /** Ab diesem Schwimmwinkel (rad) und Tempo (m/s) zählt es als Drift. */
  driftAngle: 0.28, driftSpeed: 8,
  /** Drift-Punkte pro Sekunde und m/s; Multiplikator +1 alle n Sekunden (max). */
  driftRate: 1.2, driftStep: 1.5, driftMaxMul: 5,
  /** Mindestdauer eines gewerteten Drifts (s). */
  driftMin: 1.2,
  /** Mindest-Luftzeit für einen Stunt (s). */
  airMin: 0.6,
  /** Abstand für Beinahe-Unfälle (m) und Mindesttempo (relativ, m/s). */
  nearDist: 1.6, nearSpeed: 14,
  /** Punkte -> Geld */
  moneyPerPoint: 0.02,
};

/** Multiplikator eines laufenden Drifts. */
export function driftMultiplier(t: StuntTracker) {
  return Math.min(STUNT.driftMaxMul, 1 + Math.floor(t.driftT / STUNT.driftStep));
}

/**
 * Pro Simulationsschritt. impactDv = stärkster Aufprall in diesem Schritt (beendet Drift/Stunt).
 */
export function updateStunts(t: StuntTracker, c: CarState, dt: number, impactDv: number, out: BonusEvent[]) {
  const speed = Math.hypot(c.vx, c.vz);
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  const vLong = c.vx * fx + c.vz * fz, vLat = c.vx * fz - c.vz * fx;
  const beta = Math.abs(Math.atan2(vLat, Math.abs(vLong)));
  const grounded = c.ground !== 0;

  // ---- Drift
  if (grounded && speed > STUNT.driftSpeed && beta > STUNT.driftAngle && vLong > 0) {
    t.driftT += dt;
    t.driftCalm = 0;
    t.driftPts += dt * speed * STUNT.driftRate * driftMultiplier(t);
  } else if (t.driftT > 0) {
    t.driftCalm += dt;
    if (t.driftCalm > 0.45 || speed < 4) endDrift(t, out, false);
  }
  if (impactDv > 6 && t.driftT > 0) endDrift(t, out, true);

  // ---- Sprung
  if (!grounded) {
    if (t.airT === 0) { t.airX = c.x; t.airZ = c.z; t.airYaw = 0; t.airPrevYaw = c.a; t.airMaxH = 0; t.airY0 = c.y; }
    t.airT += dt;
    let d = c.a - t.airPrevYaw;
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    t.airYaw += d; t.airPrevYaw = c.a;
    t.airMaxH = Math.max(t.airMaxH, c.y - t.airY0);
  } else if (t.airT > 0) {
    if (t.airT >= STUNT.airMin) {
      const dist = Math.hypot(c.x - t.airX, c.z - t.airZ);
      const [pitch, roll] = pitchRoll(c);
      const clean = Math.abs(pitch) < 0.4 && Math.abs(roll) < 0.4 && impactDv < 9;
      const turns = Math.abs(t.airYaw) / (Math.PI * 2);
      let pts = dist * 8 + t.airT * 40 + Math.floor(turns * 2) * 120;
      if (clean) pts *= 1.5; else pts *= 0.4;
      pts = Math.round(pts);
      const spin = Math.floor(Math.abs(t.airYaw) * 180 / Math.PI / 90) * 90;
      out.push({ kind: 'stunt', points: pts, money: Math.round(pts * STUNT.moneyPerPoint), info: `${dist.toFixed(0)} m${spin >= 180 ? ` · ${spin}°` : ''}${clean ? ' · sauber' : ''}` });
    }
    t.airT = 0;
  }
}

function endDrift(t: StuntTracker, out: BonusEvent[], crashed: boolean) {
  if (crashed) {
    if (t.driftT > STUNT.driftMin) out.push({ kind: 'driftFail', points: 0, money: 0, info: '' });
  } else if (t.driftT >= STUNT.driftMin) {
    const pts = Math.round(t.driftPts);
    out.push({ kind: 'drift', points: pts, money: Math.round(pts * STUNT.moneyPerPoint), info: `x${driftMultiplier(t)} · ${t.driftT.toFixed(1)} s` });
  }
  t.driftT = 0; t.driftPts = 0; t.driftCalm = 0;
}

/**
 * Beinahe-Unfall: knapp (Lücke < nearDist) an einem entgegenkommenden/überholten Fahrzeug
 * mit hoher Relativgeschwindigkeit vorbei, ohne es zu berühren.
 * others: [id, x, z, vx, vz, halbe Breite, halbe Länge, yaw]
 */
export function checkNearMiss(t: StuntTracker, c: CarState, halfW: number, others: Iterable<[number, number, number, number, number, number, number, number]>, dt: number, out: BonusEvent[]) {
  for (const [id, cd] of t.near) { const r = cd - dt; if (r <= 0) t.near.delete(id); else t.near.set(id, r); }
  const speed = Math.hypot(c.vx, c.vz);
  if (speed < 12 || c.ground === 0) return;
  for (const [id, x, z, vx, vz, hw, hl, yaw] of others) {
    if (t.near.has(id)) continue;
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz > 64) continue;
    const rel = Math.hypot(vx - c.vx, vz - c.vz);
    if (rel < STUNT.nearSpeed) continue;
    // seitlicher Abstand im System des anderen Fahrzeugs
    const ofx = Math.sin(yaw), ofz = Math.cos(yaw);
    const along = dx * ofx + dz * ofz, side = Math.abs(dx * ofz - dz * ofx);
    if (Math.abs(along) > hl + 1) continue;
    const gap = side - hw - halfW;
    if (gap > 0.15 && gap < STUNT.nearDist) {
      t.near.set(id, 3);
      const pts = Math.round(50 + rel * 4);
      out.push({ kind: 'near', points: pts, money: Math.round(pts * STUNT.moneyPerPoint), info: `${(rel * 3.6).toFixed(0)} km/h` });
    } else if (gap <= 0.15) {
      t.near.set(id, 3); // Berührung zählt nicht
    }
  }
}
