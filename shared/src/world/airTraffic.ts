// Deko-Flugverkehr am Flughafen: ein Zubringerflugzeug landet auf der Südbahn (09R), rollt zur
// Parkposition P4, wartet, rollt zur Nordbahn und startet wieder (09L). Rein deterministisch aus der
// Serveruhr berechnet – alle Clients sehen dasselbe, ohne Netzverkehr; der Server nutzt dieselbe
// Bahn für die Warnung an Spieler auf der Bahn. Nicht fliegbar, keine Kollision.
import { RUNWAYS } from './palmara';
import { STANDS } from './airport';

export interface DecoPose { x: number; y: number; z: number; a: number; speed: number; runway: number; phase: 'landing' | 'taxi' | 'parked' | 'takeoff' }

interface Wp { x: number; z: number; y: number; v: number; hold?: number; runway?: number; phase: DecoPose['phase'] }

/** Punkt auf Bahn i: d Meter entlang der Bahn ab Mitte (+ = Richtung Osten). */
function onRw(i: number, d: number): [number, number] {
  const [x, z, , , deg] = RUNWAYS[i];
  const r = (deg * Math.PI) / 180;
  return [x + Math.sin(r) * d, z + Math.cos(r) * d];
}

function buildRoute(): Wp[] {
  const p4 = STANDS[3];
  const w: Wp[] = [];
  const add = (p: [number, number], y: number, v: number, phase: DecoPose['phase'], runway = -1, hold = 0) => w.push({ x: p[0], z: p[1], y, v, phase, runway, hold });
  // Anflug von Westen auf 09R (Südbahn): Gleitpfad, Aufsetzen hinter der Schwelle, Ausrollen
  add(onRw(1, -900), 55, 48, 'landing', 1);
  add(onRw(1, -420), 24, 44, 'landing', 1);
  add(onRw(1, -125), 4, 38, 'landing', 1);
  add(onRw(1, -95), 0, 34, 'landing', 1);
  add(onRw(1, 40), 0, 10, 'landing', 1);
  add(onRw(1, 65), 0, 7, 'taxi', 1);
  // Abrollen über B3 aufs Vorfeld zur Parkposition P4
  add([1085, 1300], 0, 6, 'taxi');
  add([1085, 1282], 0, 6, 'taxi');
  add([p4.x, 1282], 0, 5, 'taxi');
  add([p4.x, p4.z], 0, 0.1, 'parked', -1, 45);
  // Zur Nordbahn über A2, Rollen zum Westende, Start nach Osten (09L)
  add([p4.x, 1205], 0, 6, 'taxi');
  add([1020, 1198], 0, 6, 'taxi');
  add(onRw(0, 8), 0, 6, 'taxi', 0);
  add(onRw(0, -105), 0, 4, 'taxi', 0, 6);
  add(onRw(0, -60), 0, 18, 'takeoff', 0);
  add(onRw(0, 40), 0, 36, 'takeoff', 0);
  add(onRw(0, 90), 3, 40, 'takeoff', 0);
  add(onRw(0, 400), 30, 46, 'takeoff', 0);
  add(onRw(0, 1000), 90, 52, 'takeoff', 0);
  return w;
}

const ROUTE = buildRoute();
/** Startzeit (s) je Wegpunkt */
const TIMES: number[] = [];
{
  let t = 0;
  for (let i = 0; i < ROUTE.length; i++) {
    TIMES.push(t);
    const a = ROUTE[i], b = ROUTE[i + 1];
    t += a.hold ?? 0;
    if (b) t += Math.hypot(b.x - a.x, b.z - a.z) / Math.max(0.8, (a.v + b.v) / 2);
  }
}
const ROUTE_TIME = TIMES[TIMES.length - 1];
/** Ein Umlauf: Flug + Pause ohne Flugzeug (s). */
export const DECO_PERIOD = Math.ceil(ROUTE_TIME + 150);

/** Stellung des Deko-Flugzeugs zur Serverzeit (ms) – null in der Pause. */
export function decoFlight(nowMs: number): DecoPose | null {
  const t = (nowMs / 1000) % DECO_PERIOD;
  if (t >= ROUTE_TIME) return null;
  let i = 0;
  while (i < ROUTE.length - 2 && TIMES[i + 1] <= t) i++;
  const a = ROUTE[i], b = ROUTE[i + 1];
  const start = TIMES[i] + (a.hold ?? 0);
  const dir = Math.atan2(b.x - a.x, b.z - a.z);
  if (t < start) return { x: a.x, y: a.y, z: a.z, a: lastDir(i) ?? dir, speed: 0, runway: a.runway ?? -1, phase: a.phase };
  const dur = Math.max(0.001, TIMES[i + 1] - start);
  const u = Math.min(1, (t - start) / dur);
  // gleichmäßig beschleunigt zwischen den Wegpunkt-Geschwindigkeiten
  const va = Math.max(0.8, a.v), vb = Math.max(0.8, b.v);
  const s = (va * u + ((vb - va) * u * u) / 2) / ((va + vb) / 2);
  return {
    x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s,
    a: dir, speed: va + (vb - va) * u, runway: a.runway ?? -1, phase: a.phase,
  };
}
function lastDir(i: number): number | null {
  if (i <= 0) return null;
  const p = ROUTE[i - 1], q = ROUTE[i];
  return Math.atan2(q.x - p.x, q.z - p.z);
}
