// Drift-Wertung (geteilt, damit auch Rennen oder freies Fahren sie nutzen können).
// Erkennung wie im Stunt-System (sim/stunts.ts): Schräglaufwinkel aus Längs-/Quergeschwindigkeit,
// Bodenkontakt, Mindesttempo. Dazu Punkte nach Winkel/Tempo/Dauer und Combo-Kette.
import type { CarState } from '../sim/car';

export interface DriftRules {
  minAngle: number; minSpeed: number; maxAngleFactor: number; rate: number;
  calm: number; chainWindow: number; comboStep: number; comboMax: number;
}

export interface DriftMeter {
  /** Läuft gerade ein Drift? Rohpunkte des laufenden Drifts, Dauer, ruhige Zeit. */
  active: boolean; cur: number; t: number; calm: number;
  /** Combo-Multiplikator und Zeit seit dem letzten Drift-Ende. */
  mult: number; sinceEnd: number;
  /** Gutgeschriebene Punkte und bester Einzeldrift. */
  total: number; best: number;
}

export const newDriftMeter = (): DriftMeter => ({ active: false, cur: 0, t: 0, calm: 0, mult: 1, sinceEnd: 99, total: 0, best: 0 });

/** Schräglaufwinkel in Grad (0 = geradeaus) und Tempo. */
export function slipAngle(c: CarState): { beta: number; speed: number; forward: boolean } {
  const speed = Math.hypot(c.vx, c.vz);
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  const vLong = c.vx * fx + c.vz * fz, vLat = c.vx * fz - c.vz * fx;
  return { beta: (Math.abs(Math.atan2(vLat, Math.abs(vLong))) * 180) / Math.PI, speed, forward: vLong > 0 };
}

/**
 * Ein Schritt. inZone: nur dort gibt es Punkte. Rückgabe: gutgeschriebene Punkte dieses Schritts
 * (> 0 wenn ein Drift endete), sonst 0.
 */
export function stepDrift(m: DriftMeter, c: CarState, dt: number, inZone: boolean, r: DriftRules): number {
  const { beta, speed, forward } = slipAngle(c);
  const drifting = inZone && c.ground !== 0 && forward && speed > r.minSpeed && beta > r.minAngle;
  if (drifting) {
    if (!m.active) {
      // Combo: neuer Drift kurz nach dem letzten
      m.mult = m.sinceEnd <= r.chainWindow ? Math.min(r.comboMax, m.mult + r.comboStep) : 1;
      m.active = true; m.cur = 0; m.t = 0;
    }
    m.calm = 0; m.t += dt;
    m.cur += dt * speed * Math.min(r.maxAngleFactor, beta / r.minAngle) * r.rate;
    return 0;
  }
  if (!m.active) { m.sinceEnd += dt; if (m.sinceEnd > r.chainWindow) m.mult = 1; return 0; }
  m.calm += dt;
  if (m.calm < r.calm && speed > 4) return 0;
  return endDrift(m);
}

/** Drift beenden und gutschreiben. */
export function endDrift(m: DriftMeter): number {
  if (!m.active) return 0;
  const pts = Math.round(m.cur * m.mult);
  m.total += pts; m.best = Math.max(m.best, pts);
  m.active = false; m.cur = 0; m.sinceEnd = 0;
  return pts;
}

/** Kontakt (Wand/Fahrzeug): laufender Drift verfällt, Combo zurück auf 1. */
export function breakDrift(m: DriftMeter): boolean {
  const had = m.active || m.mult > 1;
  m.active = false; m.cur = 0; m.mult = 1; m.sinceEnd = 99;
  return had;
}
