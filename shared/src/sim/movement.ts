// Bewegungs-Simulation für Spieler zu Fuß und Wasserfahrzeuge (Landfahrzeuge: car.ts).
// WICHTIG: Dieser Code läuft identisch auf Client (Prediction) und Server (autoritativ).
// Er darf daher nur von der Karte und den Eingaben abhängen – keine Zufälle, keine Zeit.
import { WATER_LEVEL } from '../world/tiles';
import { approach, approachAngle, clamp, wrapAngle } from '../math';
import { Btn } from '../protocol';
import { footSurface } from '../world/tiles';
import type { WorldMap } from '../world/WorldMap';
import { setYaw, type CarState } from './car';
import type { VehicleDef } from './vehicleDefs';

export const WALK_SPEED = 5;
export const SPRINT_SPEED = 9.5;
export const PAWN_RADIUS = 0.45;

/**
 * Spieler/Fußgänger. Blickrichtung: Vorwärts = (sin a, cos a).
 * h/vx/vy/vz/rt: Comic-Ragdoll nach einem Treffer (rt = Restzeit am Boden/in der Luft).
 */
export interface PawnState { x: number; z: number; a: number; h: number; vx: number; vy: number; vz: number; rt: number }
export const newPawn = (x = 0, z = 0, a = 0): PawnState => ({ x, z, a, h: 0, vx: 0, vy: 0, vz: 0, rt: 0 });

type SurfaceFn = (tile: number) => number;

/** Prüft 5 Punkte eines Kreises gegen unbegehbare Kacheln (und zu Fuß gegen Ladeneinrichtung). */
function blocked(map: WorldMap, x: number, z: number, r: number, surface: SurfaceFn): boolean {
  const foot = surface === footSurface;
  // Ladenkacheln zählen zu Fuß nicht, dort gelten die exakten Wände (furniture)
  const solid = (px: number, pz: number) => surface(map.tileAt(px, pz)) === 0 && !(foot && map.storeTileAt(px, pz));
  return (
    (foot && map.furnitureHit(x, z, r)) ||
    solid(x, z) || solid(x + r, z) || solid(x - r, z) || solid(x, z + r) || solid(x, z - r)
  );
}

/**
 * Bewegt `s` nach (nx, nz) mit Gleiten an Wänden.
 * Rückgabe: 0 = frei, 1 = an Wand entlanggeglitten, 2 = komplett blockiert.
 */
function moveWithCollision(
  map: WorldMap, s: { x: number; z: number }, nx: number, nz: number, r: number, surface: SurfaceFn,
): 0 | 1 | 2 {
  // Steckt man schon fest (z. B. weggeschoben), darf man sich frei herausbewegen.
  if (blocked(map, s.x, s.z, r, surface) || !blocked(map, nx, nz, r, surface)) {
    s.x = nx; s.z = nz;
    return 0;
  }
  if (!blocked(map, nx, s.z, r, surface)) { s.x = nx; return 1; }
  if (!blocked(map, s.x, nz, r, surface)) { s.z = nz; return 1; }
  return 2;
}

/** Figur wegschleudern (Comic-Ragdoll): Geschwindigkeit + Flugzeit. */
export function knockPawn(p: PawnState, vx: number, vz: number, up: number, time: number) {
  p.vx = vx; p.vz = vz; p.vy = up; p.rt = Math.max(p.rt, time);
}

/** Ein Simulationsschritt zu Fuß. ax/ay sind kamerabezogen (oben = Norden = -z). */
export function stepPawn(
  map: WorldMap, p: PawnState, ax: number, ay: number, buttons: number, dt: number, speedOverride?: number,
): boolean {
  if (p.rt > 0) {
    // Ragdoll: ballistisch, Abprallen am Boden, Reibung – Eingaben werden ignoriert
    p.rt -= dt;
    p.vy -= 9.81 * 1.6 * dt;
    p.h += p.vy * dt;
    if (p.h <= 0) {
      p.h = 0;
      p.vy = p.vy < -3 ? -p.vy * 0.35 : 0;
      const f = Math.max(0, 1 - 5 * dt);
      p.vx *= f; p.vz *= f;
    }
    const res = moveWithCollision(map, p, p.x + p.vx * dt, p.z + p.vz * dt, PAWN_RADIUS, footSurface);
    if (res) { p.vx *= -0.3; p.vz *= -0.3; }
    if (Math.hypot(p.vx, p.vz) > 1) p.a = wrapAngle(p.a + dt * 9);
    if (p.rt <= 0) { p.rt = 0; p.h = 0; p.vx = p.vz = p.vy = 0; }
    return false;
  }
  let mx = ax, mz = -ay;
  const len = Math.hypot(mx, mz);
  if (len < 0.15) return false;
  if (len > 1) { mx /= len; mz /= len; }
  const f = footSurface(map.tileAt(p.x, p.z)) || 1;
  const speed = (speedOverride ?? (buttons & Btn.SPRINT ? SPRINT_SPEED : WALK_SPEED)) * f;
  const res = moveWithCollision(map, p, p.x + mx * speed * dt, p.z + mz * speed * dt, PAWN_RADIUS, footSurface);
  p.a = approachAngle(p.a, Math.atan2(mx, mz), 14 * dt);
  return res === 2; // true = steckt fest
}

/**
 * Wasserfahrzeuge (Boot, Airboat): einfaches Arcade-Modell auf dem gemeinsamen Fahrzeugzustand
 * (nutzt a und s, schreibt Position, Gier-Quaternion und Geschwindigkeit zurück).
 * Rückgabe: Aufprallgeschwindigkeit bei Wandkontakt (0 = keiner).
 */
export function stepWater(map: WorldMap, def: VehicleDef, v: CarState, ax: number, ay: number, buttons: number, dt: number): number {
  const f = def.surface(map.tileAt(v.x, v.z)) || 0.3;
  const handbrake = (buttons & Btn.BRAKE) !== 0;
  let s = v.s;
  if (ay > 0.05) s += (s < 0 ? def.brake : def.accel) * ay * dt;
  else if (ay < -0.05) s += (s > 0 ? def.brake : def.accel * 0.6) * ay * dt;
  else s = approach(s, 0, def.drag * dt);
  if (handbrake) s = approach(s, 0, def.brake * 1.2 * dt);
  const maxF = def.maxSpeed * f, maxR = def.maxSpeed * 0.35 * f;
  if (s > maxF) s = approach(s, maxF, def.brake * 1.5 * dt);
  if (s < -maxR) s = approach(s, -maxR, def.brake * 1.5 * dt);
  let turn = -ax * def.turnRate * clamp(Math.abs(s) / 5, 0, 1) * (handbrake ? 1.5 : 1);
  if (s < 0) turn = -turn;
  const a = wrapAngle(v.a + turn * dt);
  const fx = Math.sin(a), fz = Math.cos(a);
  const res = moveWithCollision(map, v, v.x + fx * s * dt, v.z + fz * s * dt, def.radius, def.surface);
  let hit = 0;
  if (res === 2) { hit = Math.abs(s) * 1.25; s *= -0.25; } else if (res === 1) s *= 0.985;
  setYaw(v, a);
  v.s = s; v.vx = fx * s; v.vz = fz * s; v.vy = 0;
  v.wx = v.wz = 0; v.wy = turn;
  v.thr = Math.max(0, ay); v.brk = Math.max(0, -ay); v.rev = s < -0.5; v.hb = handbrake;
  v.rpm = 900 + Math.abs(s) / def.maxSpeed * 5000; v.engLoad = Math.abs(ay);
  // Auf dem Wasser schwimmen, Airboats auf Grasinseln am Boden
  const tile = map.tileAt(v.x, v.z);
  const water = tile === 0 || tile === 6 || tile === 8;
  v.y = water ? WATER_LEVEL + 0.15 : Math.max(0, map.terrainHeight(v.x, v.z));
  v.t += dt;
  return hit;
}

/** Sucht eine begehbare Position neben (x, z), z. B. zum Aussteigen. */
export function findFootSpot(map: WorldMap, x: number, z: number, maxR = 6): { x: number; z: number } | null {
  if (!blocked(map, x, z, PAWN_RADIUS, footSurface)) return { x, z };
  for (let r = 1.5; r <= maxR; r += 1.5) {
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const px = x + Math.cos(ang) * r, pz = z + Math.sin(ang) * r;
      if (!blocked(map, px, pz, PAWN_RADIUS, footSurface)) return { x: px, z: pz };
    }
  }
  return null;
}
