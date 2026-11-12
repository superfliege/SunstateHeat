// Luftfahrzeuge (Flugzeuge und Helikopter): Werte aus aircraft.json, Arcade-Flugmodell auf dem
// gemeinsamen Fahrzeugzustand (CarState + FlyState). Läuft identisch auf Server und in der
// Client-Prediction.
//
// Höhe: car.y = Unterkante des Luftfahrzeugs über dem Meer. Stufen: Boden (fly.ground = 1),
// Tief (unter settings.lowCeiling – Gebäude, die höher sind als car.y, sind Hindernisse) und
// Hoch (keine Gebäudekollision).
//
// Steuerung (wie Autos, plus Steigen/Sinken):
//   Flugzeug: ay = Schub/Bremse, ax = Kurve, SPRINT (Shift) = Steigen, BRAKE (Leertaste) = Sinken
//             bzw. Radbremse am Boden. Abheben ab takeoffSpeed mit Shift.
//   Helikopter: ay = vor/zurück, ax = drehen, STRAFE_L/R (Q/R) = seitwärts, Shift/Leertaste = Steigen/Sinken.
import AIR_JSON from './aircraft.json';
import { approach, clamp, wrapAngle } from '../math';
import { Btn } from '../protocol';
import { boxesNear, circleBox, exactCell, type Box } from '../world/collision';
import { onRunway } from '../world/airport';
import { Tile } from '../world/tiles';
import type { WorldMap } from '../world/WorldMap';
import { CELL, WORLD_SIZE } from '../constants';
import { setOrientation, type CarState } from './car';
import type { CarDamage } from './damage';
import { newFlyState, type FlyState } from './flystate';
import { base, type HandlingProfile } from './handling';

export interface AirSettings {
  fuelEnabled: boolean; rankGate: boolean; lowCeiling: number; ceiling: number;
  heliExitAlt: number; planeExitSpeed: number; respawnDestroyed: number; respawnAbandoned: number; abandonDistance: number;
  refuelPerSecond: number; refuelCostFull: number; airInterest: number; farUpdateEvery: number; runwayWarnRadius: number;
  policeHeliWanted: number;
}

export interface AircraftDef {
  id: string; name: string; type: 'plane' | 'heli'; desc: string;
  seats: number; minRank: string; spawn: string; police?: boolean; color: string; accent: string;
  maxSpeed: number; accel: number; brake: number;
  // Flugzeug
  cruise?: number; takeoffSpeed?: number; takeoffDistance?: number; stallSpeed?: number; runwayOnly?: boolean;
  turnRate?: number; groundTurn?: number; taxiSpeed?: number; landingMaxSpeed?: number;
  // Helikopter
  strafe?: number; yawRate?: number; spinUp?: number;
  climbRate: number; sinkRate: number; landingMaxVs: number;
  armor: number; fuelSeconds: number;
  length: number; span: number; height: number; radius: number; mass: number;
  /** Vorbereitet: Lasthaken (Fahrzeug unten tragen) – noch ohne Funktion. */
  cargoHook?: boolean;
  /** Varianten-Nummer (AIR_VARIANT_BASE + Index) */
  variant: number;
}

/** Varianten-Nummern der Luftfahrzeuge (Autos 0..n, Sonderfahrzeuge 100..103). */
export const AIR_VARIANT_BASE = 110;

export const AIR_SETTINGS: AirSettings = AIR_JSON.settings as AirSettings;
export const AIRCRAFT: AircraftDef[] = Object.entries(AIR_JSON.aircraft).map(([id, d], i) => ({ ...(d as Omit<AircraftDef, 'id' | 'variant'>), id, variant: AIR_VARIANT_BASE + i }));
export const isAircraftVariant = (v: number) => v >= AIR_VARIANT_BASE && v < AIR_VARIANT_BASE + AIRCRAFT.length;
export const aircraftDef = (variant: number): AircraftDef => AIRCRAFT[variant - AIR_VARIANT_BASE] ?? AIRCRAFT[0];
export const aircraftById = (id: string): AircraftDef | undefined => AIRCRAFT.find((a) => a.id === id || a.name.toLowerCase() === id.toLowerCase());
const hexColor = (s: string) => parseInt(s.replace('#', ''), 16) || 0xffffff;
export const aircraftColor = (d: AircraftDef) => hexColor(d.color);
export const aircraftAccent = (d: AircraftDef) => hexColor(d.accent);

/** Beschleunigung am Boden aus Abhebegeschwindigkeit und Startstrecke (v² = 2·a·s). */
export const groundAccel = (d: AircraftDef) => ((d.takeoffSpeed ?? 20) ** 2) / (2 * Math.max(10, d.takeoffDistance ?? 80));

const profiles = new Map<number, HandlingProfile>();
/** Handling-Profil (Kollisionsbox, Masse, Panzerung) für die gemeinsamen Fahrzeug-Systeme. */
export function aircraftProfile(variant: number): HandlingProfile {
  let p = profiles.get(variant);
  if (!p) {
    const d = aircraftDef(variant);
    p = base({
      name: d.name, mass: d.mass, length: d.length, width: d.type === 'plane' ? Math.min(d.span, 3.2) : Math.min(d.span * 0.4, 3.2), height: d.height,
      cgHeight: 0, wheelbase: d.length * 0.6, track: 2, wheelRadius: 0.35, durability: d.armor, topSpeed: d.maxSpeed,
    });
    profiles.set(variant, p);
  }
  return p;
}

export function newFly(d: AircraftDef): FlyState {
  const f = newFlyState();
  f.fuel = 1;
  if (d.type === 'plane') f.spd = 0;
  return f;
}

/** Höhenstufe: 0 Boden, 1 Tief, 2 Hoch. */
export function airLevel(c: CarState): number {
  const f = c.fly;
  if (!f || f.ground) return 0;
  return c.y < AIR_SETTINGS.lowCeiling ? 1 : 2;
}
export const AIR_LEVEL_NAMES = ['Boden', 'Tief', 'Hoch'];

// ------------------------------------------------------------------ Boden, Dächer, Hindernisse
const near: Box[] = [];
const hit = [0, 0, 0];
interface GroundInfo { y: number; water: boolean; tile: number; roof: boolean }
const gi: GroundInfo = { y: 0, water: false, tile: 0, roof: false };

/** Bodenhöhe unter dem Luftfahrzeug (mit Dächern für Helikopter). */
export function airGround(map: WorldMap, x: number, z: number, y: number, roofs: boolean): GroundInfo {
  const t = map.tileAt(x, z);
  gi.tile = t; gi.roof = false;
  gi.water = t === Tile.WATER || t === Tile.SWAMP;
  gi.y = gi.water ? -0.3 : Math.max(0, map.surfaceY(x, z));
  if (roofs) {
    for (const b of boxesNear(map, x, z, 0.5, near)) {
      if (b.top === undefined || !circleBox(b, x, z, 0.01, hit)) continue;
      if (y >= b.top - 1.5 && b.top > gi.y) { gi.y = b.top; gi.water = false; gi.roof = true; gi.tile = Tile.PLAZA; }
    }
  }
  return gi;
}

/**
 * Hindernisse in Flughöhe: Gebäude, deren Dach über der Unterkante liegt (ohne das Dach, auf dem
 * man gerade steht). Schiebt p heraus; Rückgabe = Eindringtiefe (0 = frei) und Normale in nrm.
 */
const nrm = [0, 0];
function obstacleHit(map: WorldMap, p: { x: number; z: number }, y: number, r: number): number {
  let depth = 0;
  for (const b of boxesNear(map, p.x, p.z, r, near)) {
    if (b.top === undefined || y >= b.top - 0.05) continue;
    if (!circleBox(b, p.x, p.z, r, hit)) continue;
    p.x += hit[0] * (hit[2] + 0.01); p.z += hit[1] * (hit[2] + 0.01);
    if (hit[2] > depth) { depth = hit[2]; nrm[0] = hit[0]; nrm[1] = hit[1]; }
  }
  // Kachel-Hindernisse ohne Rechteck (Läden, Fels in Bodennähe, Kartenrand)
  if (y < 6) {
    const t = map.tileAt(p.x, p.z);
    const cx = Math.floor(p.x / CELL), cz = Math.floor(p.z / CELL);
    if ((t === Tile.BUILDING && !exactCell(map, cx, cz)) || t === Tile.VOID) { depth = Math.max(depth, 0.5); nrm[0] = 0; nrm[1] = 0; }
  }
  return depth;
}

/** Bodentauglichkeit für rollende Flugzeuge (Tempo-Faktor, 0 = unmöglich). */
function rollSurface(t: number): number {
  switch (t) {
    case Tile.ROAD: case Tile.BRIDGE: case Tile.PLAZA: case Tile.SIDEWALK: case Tile.DOCK: return 1;
    case Tile.GRASS: case Tile.DIRT: case Tile.DESERT: case Tile.FARM: case Tile.BADLANDS: case Tile.FIELD: return 0.85;
    case Tile.SAND: return 0.55;
    default: return 0;
  }
}

/** Steht (x, z) auf einer Start-/Landebahn? */
export function onAnyRunway(map: WorldMap, x: number, z: number): boolean {
  for (const r of map.runways) if (onRunway(r, x, z, 1)) return true;
  return false;
}

// ------------------------------------------------------------------ Schritt
export interface AirVehicle { kind: number; variant: number; car: CarState; dmg: CarDamage }

/** Ein fester Simulationsschritt. Ereignisse (hit/crash/warn) stehen danach in car.fly. */
export function stepAircraft(map: WorldMap, v: AirVehicle, ax: number, ay: number, buttons: number, dt: number) {
  const c = v.car;
  const d = aircraftDef(v.variant);
  const f = (c.fly ??= newFly(d));
  f.hit = 0; f.crash = 0; f.warn = 0;
  const dead = v.dmg.wreck > 0 || v.dmg.hp <= 0;
  const piloted = (buttons & Btn.PILOT) !== 0 && !dead;
  if (!piloted) { ax = 0; ay = 0; buttons &= ~(Btn.SPRINT | Btn.STRAFE_L | Btn.STRAFE_R); if (!dead) buttons |= Btn.BRAKE; }
  // Geparkt: schlafen (spart Rechenzeit), bis jemand einsteigt
  if (!piloted && f.ground && f.rotor < 0.01 && Math.abs(f.spd) < 0.05 && Math.abs(c.vx) + Math.abs(c.vz) < 0.05) {
    c.sleep += dt;
    if (c.sleep > 0.6) { c.t += dt; return; }
  } else c.sleep = 0;

  const hasFuel = !AIR_SETTINGS.fuelEnabled || f.fuel > 0;
  const engine = piloted && hasFuel;
  if (piloted && !hasFuel) f.warn = 3;
  const spin = d.type === 'heli' ? (d.spinUp ?? 3) : 1.5;
  f.rotor = approach(f.rotor, engine ? 1 : 0, dt / (engine ? spin : spin * 1.6));
  const climb = (buttons & Btn.SPRINT) !== 0, sink = (buttons & Btn.BRAKE) !== 0;

  if (d.type === 'heli') stepHeli(map, c, f, d, ax, ay, buttons, climb, sink, dead, dt);
  else stepPlane(map, c, f, d, ax, ay, climb, sink, engine, dead, dt);

  // Kartenrand
  c.x = clamp(c.x, 4, WORLD_SIZE - 4); c.z = clamp(c.z, 4, WORLD_SIZE - 4);
  // Treibstoff
  if (AIR_SETTINGS.fuelEnabled && engine) {
    const load = d.type === 'heli' ? 0.55 + 0.45 * Math.max(Math.abs(ay), climb ? 1 : 0) : f.ground ? 0.2 + 0.4 * Math.max(0, ay) : 0.4 + 0.6 * clamp(f.spd / d.maxSpeed, 0, 1);
    f.fuel = Math.max(0, f.fuel - (dt / d.fuelSeconds) * load);
  }
  setOrientation(c, c.a, f.pitch, f.bank);
  c.s = f.ground || d.type === 'plane' ? f.spd : c.vx * Math.sin(c.a) + c.vz * Math.cos(c.a);
  c.wx = c.wz = 0;
  c.rpm = f.rotor * 6000;
  c.thr = Math.max(0, ay); c.brk = f.ground && sink ? 1 : 0; c.rev = f.spd < -0.3; c.hb = false; c.boost = false;
  c.engLoad = Math.abs(ay);
  c.air = f.ground ? 0 : c.air + dt;
  c.ground = f.ground ? 15 : 0;
  c.flip = 0;
  c.t += dt;
}

/** Aufsetzen auswerten: Wasser = Absturz, zu steil/zu schnell = Schaden oder Absturz. */
function touchdown(f: FlyState, d: AircraftDef, vs: number, speed: number, water: boolean, maxSpeed: number) {
  if (water) { f.crash = 1; return; }
  const overV = vs / d.landingMaxVs, overS = speed / maxSpeed;
  if (overV > 2.2 || overS > 1.5) { f.crash = 1; return; }
  const over = Math.max(0, overV - 1) + Math.max(0, overS - 1);
  if (over > 0) f.hit = 6 + over * 16;
}

function stepHeli(map: WorldMap, c: CarState, f: FlyState, d: AircraftDef, ax: number, ay: number, buttons: number, climb: boolean, sink: boolean, dead: boolean, dt: number) {
  const g = airGround(map, c.x, c.z, c.y, true);
  const lift = f.rotor >= 0.97;
  if (f.ground) {
    c.vx = c.vy = c.vz = 0;
    f.bank = approach(f.bank, 0, dt); f.pitch = approach(f.pitch, 0, dt);
    if (g.water && !g.roof) { f.crash = 1; return; }
    // Boden unter den Kufen weg (Dachkante) -> fällt
    if (c.y > g.y + 0.6) f.ground = 0;
    else c.y = g.y;
    if (lift && climb) { f.ground = 0; c.vy = d.climbRate * 0.5; c.y += 0.05; }
    else if (f.rotor > 0.6 && Math.abs(ax) > 0.05) c.a = wrapAngle(c.a - ax * (d.yawRate ?? 1.5) * 0.4 * dt); // auf dem Boden langsam drehen
    return;
  }
  // in der Luft
  const fx = Math.sin(c.a), fz = Math.cos(c.a), rx = -fz, rz = fx;
  const strafe = (buttons & Btn.STRAFE_R ? 1 : 0) - (buttons & Btn.STRAFE_L ? 1 : 0);
  const ctrl = lift && !dead ? 1 : 0.15;
  const fwd = ay * d.maxSpeed * ctrl, side = strafe * d.maxSpeed * (d.strafe ?? 0.6) * ctrl;
  const wx = fx * fwd + rx * side, wz = fz * fwd + rz * side;
  const rate = (Math.abs(ay) > 0.05 || strafe ? d.accel : d.brake) * dt;
  const dvx = wx - c.vx, dvz = wz - c.vz, dl = Math.hypot(dvx, dvz);
  if (dl > rate) { c.vx += (dvx / dl) * rate; c.vz += (dvz / dl) * rate; } else { c.vx = wx; c.vz = wz; }
  // Gieren
  const spinDead = dead ? 2.4 : 0; // zerstört: unkontrolliertes Kreiseln
  c.a = wrapAngle(c.a - ax * (d.yawRate ?? 1.5) * ctrl * dt + spinDead * dt);
  // Steigen/Sinken; ohne Rotorkraft Autorotation (langsames Sinken)
  let target = lift && !dead ? (climb ? d.climbRate : sink ? -d.sinkRate : 0) : -(3 + (1 - f.rotor) * 9);
  if (c.y > AIR_SETTINGS.ceiling && target > 0) target = 0;
  c.vy = approach(c.vy, target, (lift ? 11 : 6) * dt);
  // Bewegen + Hindernisse (Rotor schlägt an Gebäude)
  const p = { x: c.x + c.vx * dt, z: c.z + c.vz * dt };
  const depth = c.y < AIR_SETTINGS.lowCeiling + 30 ? obstacleHit(map, p, c.y, d.radius) : 0;
  if (depth > 0) {
    const sp = Math.hypot(c.vx, c.vz);
    f.hit = Math.max(f.hit, 4 + sp * 0.9);
    const vn = c.vx * nrm[0] + c.vz * nrm[1];
    if (vn < 0) { c.vx -= vn * 1.4 * nrm[0]; c.vz -= vn * 1.4 * nrm[1]; }
    c.vx *= 0.5; c.vz *= 0.5;
  }
  c.x = p.x; c.z = p.z;
  c.y += c.vy * dt;
  // Optik: nach vorne/seitlich neigen
  const vf = c.vx * fx + c.vz * fz, vs = c.vx * rx + c.vz * rz;
  f.pitch = approach(f.pitch, clamp(vf / d.maxSpeed, -1, 1) * 0.22, dt * 1.5);
  f.bank = approach(f.bank, clamp(vs / d.maxSpeed, -1, 1) * 0.3 + (dead ? 0.3 : 0), dt * 1.5);
  // Aufsetzen
  const g2 = airGround(map, c.x, c.z, c.y, true);
  if (c.y <= g2.y) {
    touchdown(f, d, -c.vy, Math.hypot(c.vx, c.vz), g2.water, 10);
    if (dead) f.crash = 1;
    c.y = g2.y; c.vy = 0; c.vx = c.vz = 0; f.ground = 1;
  }
}

function stepPlane(map: WorldMap, c: CarState, f: FlyState, d: AircraftDef, ax: number, ay: number, climb: boolean, sink: boolean, engine: boolean, dead: boolean, dt: number) {
  const tos = d.takeoffSpeed ?? 20, stall = d.stallSpeed ?? tos * 0.75;
  if (f.ground) {
    const g = airGround(map, c.x, c.z, c.y, false);
    if (g.water) { f.crash = 1; return; }
    let sfc = rollSurface(g.tile);
    let cap = d.maxSpeed;
    if (d.runwayOnly && !onAnyRunway(map, c.x, c.z)) { cap = Math.min(cap, tos * 0.8); if (Math.abs(f.spd) > tos * 0.7) f.warn = 2; }
    if (!climb) cap = Math.min(cap, tos * 1.1);
    if (sfc <= 0) sfc = 0.3;
    cap *= sfc;
    const thrust = engine ? groundAccel(d) * f.rotor : 0;
    if (ay > 0.05) f.spd += thrust * ay * dt;
    else if (ay < -0.05) f.spd = f.spd > 0.2 ? f.spd - d.brake * -ay * dt : Math.max(-3, f.spd - 2 * -ay * dt * (engine ? 1 : 0));
    else f.spd = approach(f.spd, 0, (1.2 + (1 - sfc) * 4) * dt);
    if (sink) f.spd = approach(f.spd, 0, d.brake * dt);
    if (f.spd > cap) f.spd = approach(f.spd, cap, d.brake * 1.5 * dt);
    // Lenken am Boden (Bugrad), bei Tempo weniger
    const steerK = clamp(Math.abs(f.spd) / 3, 0, 1) * Math.min(1, ((d.taxiSpeed ?? 9) * 1.5) / Math.max(1, Math.abs(f.spd)));
    c.a = wrapAngle(c.a - ax * (d.groundTurn ?? 1.2) * steerK * Math.sign(f.spd || 1) * dt);
    const fx = Math.sin(c.a), fz = Math.cos(c.a);
    const p = { x: c.x + fx * f.spd * dt, z: c.z + fz * f.spd * dt };
    if (obstacleHit(map, p, c.y, d.radius * 0.55) > 0) {
      if (Math.abs(f.spd) > 4) f.hit = Math.abs(f.spd) * 1.2;
      if (Math.abs(f.spd) > tos * 0.9) f.crash = 1;
      f.spd *= -0.2;
    }
    c.x = p.x; c.z = p.z;
    c.vx = fx * f.spd; c.vz = fz * f.spd; c.vy = 0;
    const g2 = airGround(map, c.x, c.z, c.y, false);
    if (c.y - g2.y > 1.2) f.ground = 0; // über eine Kante gerollt
    else c.y += (g2.y - c.y) * Math.min(1, dt * 14);
    f.bank = approach(f.bank, 0, dt * 2);
    f.pitch = approach(f.pitch, 0, dt * 2);
    // Abheben
    if (climb && f.spd >= tos && engine && !dead) { f.ground = 0; c.vy = d.climbRate * 0.4; c.y += 0.1; }
    return;
  }
  // in der Luft
  if (!dead && engine) {
    if (ay > 0.05) f.spd += d.accel * ay * dt;
    else if (ay < -0.05) f.spd -= d.brake * 0.6 * -ay * dt;
    else f.spd = approach(f.spd, d.cruise ?? d.maxSpeed * 0.6, 1.2 * dt);
  } else f.spd -= 1.1 * dt;
  // Auftrieb: unter der Abrissgeschwindigkeit sackt das Flugzeug durch
  const stalled = f.spd < stall;
  f.stall = stalled ? 1 : 0;
  if (stalled) f.warn = 1;
  const liftK = clamp((f.spd - stall) / Math.max(1, tos - stall), 0, 1);
  let target: number;
  if (dead) target = -16;
  else if (stalled) target = -(6 + (stall - f.spd) * 1.6);
  else if (!engine) target = sink ? -d.sinkRate : -d.sinkRate * 0.45; // Gleitflug
  else target = climb ? d.climbRate * liftK : sink ? -d.sinkRate : 0;
  if (c.y > AIR_SETTINGS.ceiling && target > 0) target = 0;
  // Abfangen kurz vor dem Boden (Arcade-Hilfe): mit laufendem Triebwerk wird das Sinken begrenzt
  const agl = c.y - airGround(map, c.x, c.z, c.y, false).y;
  const flare = !dead && !stalled && engine && agl < 9 && target < -d.landingMaxVs * 0.7;
  if (flare) target = -d.landingMaxVs * 0.7;
  c.vy = approach(c.vy, target, (stalled ? 9 : flare ? 8 : 5) * dt);
  // Steigen kostet Fahrt, Sinken bringt Fahrt
  f.spd += -c.vy * 0.3 * dt;
  f.spd = clamp(f.spd, 0, d.maxSpeed * 1.12);
  // Kurven (Querlage)
  const k = clamp(f.spd / tos, 0.3, 1.2) * (stalled ? 0.4 : 1) * (dead ? 0.2 : 1);
  c.a = wrapAngle(c.a - ax * (d.turnRate ?? 0.6) * k * dt + (dead ? 0.6 * dt : 0));
  f.bank = approach(f.bank, ax * 0.6 + (dead ? 0.5 : 0), dt * 1.6);
  f.pitch = approach(f.pitch, -Math.atan2(c.vy, Math.max(8, f.spd)) * 0.9, dt * 1.5);
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  const p = { x: c.x + fx * f.spd * dt, z: c.z + fz * f.spd * dt };
  // Gebäude in Flughöhe: Absturz
  if (c.y < AIR_SETTINGS.lowCeiling + 30 && obstacleHit(map, p, c.y, d.radius * 0.6) > 0) { f.crash = 1; f.hit = f.spd; }
  c.x = p.x; c.z = p.z;
  c.vx = fx * f.spd; c.vz = fz * f.spd;
  c.y += c.vy * dt;
  // Aufsetzen
  const g = airGround(map, c.x, c.z, c.y, false);
  if (c.y <= g.y) {
    touchdown(f, d, -c.vy, f.spd, g.water || rollSurface(g.tile) === 0, d.landingMaxSpeed ?? d.maxSpeed * 0.5);
    if (dead || f.stall) { if (-c.vy > d.landingMaxVs) f.crash = 1; }
    if (dead) f.crash = 1;
    c.y = g.y; c.vy = 0; f.ground = 1; f.stall = 0;
  }
}

/** Darf hier ausgestiegen werden? (Flugzeug am Boden und langsam, Helikopter knapp über Grund) */
export function canExitAircraft(map: WorldMap, v: AirVehicle): boolean {
  const c = v.car, f = c.fly;
  if (!f) return true;
  const d = aircraftDef(v.variant);
  if (v.dmg.wreck) return true;
  if (d.type === 'plane') return f.ground === 1 && Math.abs(f.spd) <= AIR_SETTINGS.planeExitSpeed;
  const g = airGround(map, c.x, c.z, c.y, true);
  return f.ground === 1 || c.y - g.y <= AIR_SETTINGS.heliExitAlt;
}

/** Luftfahrzeug abstellen (Spawn/Respawn): am Boden bzw. auf dem Dach, Motor aus, voll getankt. */
export function placeAircraft(map: WorldMap, c: CarState, variant: number, x: number, z: number, a: number) {
  const d = aircraftDef(variant);
  c.fly = newFly(d);
  c.x = x; c.z = z; c.a = a;
  c.y = airGround(map, x, z, 1e4, d.type === 'heli').y;
  c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
  c.sleep = 0; c.air = 0; c.flip = 0; c.steer = 0;
  setOrientation(c, a, 0, 0);
  c.s = 0;
}

/** Kollision zweier Luftfahrzeuge nur auf gleicher Höhenstufe (und vertikal nah). */
export function sameAirLevel(a: CarState, b: CarState): boolean {
  return airLevel(a) === airLevel(b) && Math.abs(a.y - b.y) < 6;
}

