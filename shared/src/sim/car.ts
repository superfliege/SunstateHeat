// Raycast-Fahrzeugphysik (Arcade, keine Simulation). Läuft IDENTISCH auf Client (Prediction)
// und Server (autoritativ) – nur Karte, Profil, Schaden und Eingaben gehen ein, keine Zufälle.
//
// Modell: ein starrer Körper (Position, Quaternion, Geschwindigkeit, Winkelgeschwindigkeit)
// mit vier Rädern. Jedes Rad schießt einen Strahl entlang der Karosserie-Hochachse nach unten
// gegen das Höhenfeld; die Federung (Feder + Dämpfer + Stabilisator + Anschlag) erzeugt die
// Normalkraft. Die Reifenkräfte (Schlupfkurve quer, Antrieb/Bremse längs, Reibungskreis)
// greifen am Aufstandspunkt an – Gewichtsverlagerung, Wanken und Nicken entstehen dadurch
// von selbst. Arcade-Hilfen (ASSISTS in handling.ts) glätten das Ganze.
//
// Koordinaten: Welt x = Osten, y = oben, z = Süden. Fahrzeug lokal: +x = LINKS, +y = oben,
// +z = vorne. Gierwinkel a: vorwärts = (sin a, 0, cos a) – wie im restlichen Spiel.
import { Btn } from '../protocol';
import { isWet, obstaclesNear, rampAt, type Obstacle } from '../world/features';
import { Tile } from '../world/tiles';
import { boxesNear, exactCell, type Box } from '../world/collision';
import type { WorldMap } from '../world/WorldMap';
import { enginePower, steerPull, type CarDamage } from './damage';
import { ASSISTS, derive, Drive, GRAVITY, handlingVersion, surfaceGrip, torqueCurve, type Derived, type HandlingProfile } from './handling';

export interface CarState {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
  vx: number; vy: number; vz: number;
  wx: number; wy: number; wz: number;
  /** Radeinschlag vorne (rad, + = links). */
  steer: number;
  rpm: number;
  /** -1 = Rückwärtsgang, 1..n */
  gear: number;
  /** Restzeit der Zugkraftunterbrechung beim Schalten (s). */
  shift: number;
  /** Fahrzeug-Uhr (s) – für deterministisches Motorstottern. */
  t: number;
  /** Sekunden ohne Bodenkontakt. */
  air: number;
  /** Sekunden auf Dach/Seite. */
  flip: number;
  /** Nitro-Ladung 0..1 */
  nitro: number;
  /** Einfederung je Rad (m). */
  comp: number[];
  /** Sekunden in Ruhe (freie Fahrzeuge schlafen ein). */
  sleep: number;

  // ---- abgeleitete Werte (nicht für die Reconciliation nötig, aber für Anzeige/Effekte/Audio)
  /** Gierwinkel und vorzeichenbehaftete Vorwärtsgeschwindigkeit. */
  a: number; s: number;
  /** Rutsch-Geschwindigkeit je Rad (m/s) – Quietschen, Qualm, Bremsspuren. */
  slip: number[];
  /** Untergrund je Rad (Tile, 255 = in der Luft). */
  surf: number[];
  /** Normalkraft je Rad (N). */
  load: number[];
  /** Bitmaske der Räder mit Bodenkontakt. */
  ground: number;
  /** Aktuelle Gas-/Bremsstellung (0..1), Rückwärts, Handbremse, Nitro aktiv. */
  thr: number; brk: number; rev: boolean; hb: boolean; boost: boolean;
  /** Last des Motors (0..1) für den Motorsound, Zähler für Gangwechsel (Audio). */
  engLoad: number; shifts: number;
  /** Raddrehwinkel (rad, nur Optik). */
  spin: number[];
  /** Kräfte für das Debug-Overlay (Welt, N): je Rad [Fx, Fy(Feder), Fz] … */
  dbg: number[];
}

export function createCar(): CarState {
  return {
    x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
    steer: 0, rpm: 800, gear: 1, shift: 0, t: 0, air: 0, flip: 0, nitro: 1, comp: [0, 0, 0, 0], sleep: 0,
    a: 0, s: 0, slip: [0, 0, 0, 0], surf: [255, 255, 255, 255], load: [0, 0, 0, 0], ground: 0,
    thr: 0, brk: 0, rev: false, hb: false, boost: false, engLoad: 0, shifts: 0, spin: [0, 0, 0, 0],
    dbg: new Array(24).fill(0),
  };
}

/** Fahrzeug auf den Boden stellen (Spawn, Aufrichten, Reset). */
export function placeCar(map: WorldMap, c: CarState, p: HandlingProfile, x: number, z: number, a: number) {
  const d = derive(p);
  c.x = x; c.z = z;
  c.y = groundHeight(map, x, z) + p.cgHeight;
  setYaw(c, a);
  c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
  const statComp = (p.mass / 4) * GRAVITY * ASSISTS.gravityScale / d.springK;
  for (let i = 0; i < 4; i++) c.comp[i] = statComp;
  c.air = 0; c.flip = 0; c.sleep = 0; c.steer = 0; c.gear = 1; c.shift = 0;
  syncDerived(c);
}

export function setYaw(c: CarState, a: number) {
  c.qx = 0; c.qy = Math.sin(a / 2); c.qz = 0; c.qw = Math.cos(a / 2);
  c.a = a;
}

// ------------------------------------------------------------------ Boden & Hindernisse
/** Höhe der befahrbaren Oberfläche (Gelände, Brücke, Bordstein, Sumpf, Rampen). */
export function groundHeight(map: WorldMap, x: number, z: number): number {
  if (map.tileAt(x, z) === Tile.WATER) return CAR_WATER_FLOOR;
  return map.surfaceY(x, z) + rampAt(map, x, z);
}

/** Landfahrzeuge im Wasser sinken bis etwa zur Hälfte ein (Höhe des „Wasserbodens“ für die Räder). */
export const CAR_WATER_FLOOR = -1.05;

/** Steht das Landfahrzeug im tiefen Wasser (Motor aus, Auto säuft ab)? */
export function carInWater(map: WorldMap, c: { x: number; z: number }): boolean {
  return map.tileAt(c.x, c.z) === Tile.WATER;
}

/** Glatte Höhe (ohne Bordsteinstufen) für die Bodennormale. */
function smoothHeight(map: WorldMap, x: number, z: number): number {
  const t = map.tileAt(x, z);
  const base = t === Tile.BRIDGE ? 0.6 : t === Tile.SWAMP ? -0.45 : Math.max(0, map.terrainHeight(x, z));
  return base + rampAt(map, x, z);
}

/** Kacheln, die für Autos eine Wand sind. */
export function blocksCar(t: number): boolean {
  return t === Tile.BUILDING || t === Tile.ROCK || t === Tile.VOID;
}

// ------------------------------------------------------------------ Quaternion-Helfer
// Alle Helfer schreiben in ein übergebenes Array (keine Allokation im Physik-Schritt).
type V3 = Float64Array;
const v3 = () => new Float64Array(3);

/** Vektor (x, y, z) mit der Orientierung von c drehen (lokal -> Welt). */
function rotate(c: CarState, x: number, y: number, z: number, out: V3) {
  const { qx, qy, qz, qw } = c;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}
/** Welt -> lokal (Drehung mit dem konjugierten Quaternion). */
function unrotate(c: CarState, x: number, y: number, z: number, out: V3) {
  const qx = -c.qx, qy = -c.qy, qz = -c.qz, qw = c.qw;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  out[0] = x + qw * tx + (qy * tz - qz * ty);
  out[1] = y + qw * ty + (qz * tx - qx * tz);
  out[2] = z + qw * tz + (qx * ty - qy * tx);
  return out;
}

const AX = v3(), AY = v3(), AZ = v3(); // Karosserie-Achsen in Welt (links, oben, vorne)
function axes(c: CarState) {
  rotate(c, 1, 0, 0, AX); rotate(c, 0, 1, 0, AY); rotate(c, 0, 0, 1, AZ);
}

/** Gierwinkel + Vorwärtsgeschwindigkeit aus dem Zustand ableiten. */
export function syncDerived(c: CarState) {
  rotate(c, 0, 0, 1, AZ);
  c.a = Math.atan2(AZ[0], AZ[2]);
  const fl = Math.hypot(AZ[0], AZ[2]) || 1;
  c.s = (c.vx * AZ[0] + c.vz * AZ[2]) / fl;
}

const tmpA = v3(), tmpB = v3(), tmpC = v3();

/** Impuls (Welt) am Weltpunkt (px, py, pz) anwenden. */
export function applyImpulse(c: CarState, d: Derived, px: number, py: number, pz: number, jx: number, jy: number, jz: number, spinScale = 1) {
  const m = d.p.mass;
  c.vx += jx / m; c.vy += jy / m; c.vz += jz / m;
  const rx = px - c.x, ry = py - c.y, rz = pz - c.z;
  // Drehimpuls L = r x j -> lokal -> / I -> Welt
  const lx = ry * jz - rz * jy, ly = rz * jx - rx * jz, lz = rx * jy - ry * jx;
  unrotate(c, lx, ly, lz, tmpA);
  tmpA[0] /= d.inertia[0]; tmpA[1] = tmpA[1] / d.inertia[1] * spinScale; tmpA[2] /= d.inertia[2];
  rotate(c, tmpA[0], tmpA[1], tmpA[2], tmpB);
  c.wx += tmpB[0]; c.wy += tmpB[1]; c.wz += tmpB[2];
  c.sleep = 0;
}

/** Effektive inverse Masse am Punkt r in Richtung n (für Impuls-Berechnung). */
function invMassAt(c: CarState, d: Derived, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): number {
  const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx; // r x n
  unrotate(c, cx, cy, cz, tmpA);
  tmpA[0] /= d.inertia[0]; tmpA[1] /= d.inertia[1]; tmpA[2] /= d.inertia[2];
  rotate(c, tmpA[0], tmpA[1], tmpA[2], tmpB); // I^-1 (r x n)
  // (I^-1 (r x n)) x r · n
  const ex = tmpB[1] * rz - tmpB[2] * ry, ey = tmpB[2] * rx - tmpB[0] * rz, ez = tmpB[0] * ry - tmpB[1] * rx;
  return 1 / d.p.mass + ex * nx + ey * ny + ez * nz;
}

// ------------------------------------------------------------------ Kontakte
/** Stärkster Aufprall eines Schritts (für Schaden, Sounds, Funken, Kamera). */
export interface Impact {
  /** Aufprallgeschwindigkeit entlang der Normale (m/s). */
  dv: number;
  x: number; y: number; z: number; // Kontaktpunkt (Welt)
  nx: number; ny: number; nz: number; // Normale (vom Hindernis weg, zum Auto hin)
  /** 0 Wand, 1 Boden (Karosserie), 2 Baum, 3 Prop, 4 Fahrzeug */
  kind: number;
  /** Baum-/Prop-/Fahrzeug-ID */
  id: number;
  /** Tangentiale Rutschgeschwindigkeit (Schaben). */
  scrape: number;
}
export const newImpact = (): Impact => ({ dv: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, kind: 0, id: -1, scrape: 0 });

export interface StepOut {
  impact: Impact; // stärkster Aufprall (dv = 0: keiner)
  scrape: Impact; // stärkstes Schaben (scrape = 0: keins)
  /** Bäume, die getroffen wurden (Index in obstacles) + Stärke. */
  trees: [number, number][];
}
export const newStepOut = (): StepOut => ({ impact: newImpact(), scrape: newImpact(), trees: [] });
export function clearStepOut(o: StepOut) { o.impact.dv = 0; o.scrape.scrape = 0; o.trees.length = 0; }

function record(o: StepOut | null, dv: number, scrape: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: number, id: number) {
  if (!o) return;
  if (dv > o.impact.dv) Object.assign(o.impact, { dv, x, y, z, nx, ny, nz, kind, id, scrape });
  if (scrape > o.scrape.scrape) Object.assign(o.scrape, { dv, x, y, z, nx, ny, nz, kind, id, scrape });
}

/** Statischer Kontakt Welt <-> Auto: Impuls mit Rückprall + Reibung. Gibt den Normalimpuls zurück. */
function resolveStatic(c: CarState, d: Derived, px: number, py: number, pz: number, nx: number, ny: number, nz: number, e: number, mu: number, out: StepOut | null, kind: number, id: number): number {
  const rx = px - c.x, ry = py - c.y, rz = pz - c.z;
  // Geschwindigkeit am Punkt: v + w x r
  const vpx = c.vx + c.wy * rz - c.wz * ry, vpy = c.vy + c.wz * rx - c.wx * rz, vpz = c.vz + c.wx * ry - c.wy * rx;
  const vn = vpx * nx + vpy * ny + vpz * nz;
  if (vn >= 0) return 0;
  const k = invMassAt(c, d, rx, ry, rz, nx, ny, nz);
  // kleine Stöße kaum zurückprallen lassen (kein Zittern beim Anlehnen)
  const rest = -vn > 2 ? e : 0;
  const j = (-(1 + rest) * vn) / k;
  // Reibung (tangential)
  let tx = vpx - vn * nx, ty = vpy - vn * ny, tz = vpz - vn * nz;
  const vt = Math.hypot(tx, ty, tz);
  let jt = 0;
  if (vt > 1e-4) {
    tx /= vt; ty /= vt; tz /= vt;
    const kt = invMassAt(c, d, rx, ry, rz, tx, ty, tz);
    jt = Math.min(vt / kt, mu * j);
  }
  applyImpulse(c, d, px, py, pz, nx * j - tx * jt, ny * j - ty * jt, nz * j - tz * jt);
  record(out, -vn, vt, px, py, pz, nx, ny, nz, kind, id);
  return j;
}

// ------------------------------------------------------------------ Schlupfkurve
/** Seitenkraft-Faktor (-1..1) aus dem Schräglaufwinkel (Grad): steigt bis zum Peak, fällt dann ab. */
export function lateralCurve(alphaDeg: number, peak: number, falloff: number): number {
  const x = Math.abs(alphaDeg) / peak;
  const f = x <= 1 ? x * (2 - x) : Math.max(falloff, 1 - (1 - falloff) * Math.min(1, (x - 1) / 1.5));
  return alphaDeg < 0 ? -f : f;
}

// ------------------------------------------------------------------ Eingabe
export interface CarInput { ax: number; ay: number; buttons: number }

/** Lenkwinkel-Maximum bei Tempo v (rad). */
export function steerLimit(p: HandlingProfile, v: number, handbrake = false): number {
  const base = (p.steerMax * Math.PI / 180) / (1 + p.steerSpeedFalloff * Math.abs(v));
  // Arcade: nie mehr Einschlag, als die Vorderreifen bei diesem Tempo umsetzen können
  const grip = Math.atan((p.wheelbase * p.gripFront * GRAVITY * ASSISTS.gravityScale * ASSISTS.steerGrip) / Math.max(1, v * v));
  return Math.min(base, Math.max(grip, base * 0.12)) * (handbrake && !p.upright ? 1.6 : 1);
}

// ------------------------------------------------------------------ Schritt
const WP = v3(); // Radaufhängung (Welt)
const obsTmp: Obstacle[] = [];
const compPrev = [0, 0, 0, 0];
const supF = [0, 0, 0, 0];

/**
 * Ein Simulationsschritt (dt = SIM_DT); intern in ASSISTS.substeps Unterschritte geteilt.
 * dmg darf null sein (unzerstörbar). out sammelt Aufpralle (für Schaden/Effekte).
 */
export function stepCar(map: WorldMap, c: CarState, p: HandlingProfile, dmg: CarDamage | null, ax: number, ay: number, buttons: number, dt: number, out: StepOut | null) {
  const d = derive(p);
  const n = Math.max(1, ASSISTS.substeps | 0);
  const h = dt / n;

  // Aufrichten (E nach 3 s auf Dach/Seite)
  if (buttons & Btn.UNFLIP && c.flip >= ASSISTS.unflipDelay) {
    placeCar(map, c, p, c.x, c.z, c.a);
    c.y += 0.8;
    return;
  }
  const idle = Math.abs(ax) < 0.05 && Math.abs(ay) < 0.05 && !(buttons & (Btn.BRAKE | Btn.SPRINT));
  if (idle && c.sleep > 0.6) { c.t += dt; return; } // schläft
  if (!idle) c.sleep = 0;

  for (let i = 0; i < n; i++) substep(map, c, p, d, dmg, ax, ay, buttons, h, out);
  syncDerived(c);

  // Einschlafen nur ohne Fahrer-Eingabe, in Ruhe, auf allen Rädern
  const still = Math.abs(c.vx) + Math.abs(c.vy) + Math.abs(c.vz) < ASSISTS.sleepSpeed * 3 && Math.abs(c.wx) + Math.abs(c.wy) + Math.abs(c.wz) < ASSISTS.sleepSpeed * 3;
  if (idle && still && c.ground === 15) c.sleep += dt; else c.sleep = 0;
  if (c.sleep > 0.6) { c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0; }
}

function substep(map: WorldMap, c: CarState, p: HandlingProfile, d: Derived, dmg: CarDamage | null, ax: number, ay: number, buttons: number, h: number, out: StepOut | null) {
  const m = p.mass, g = GRAVITY * ASSISTS.gravityScale;
  c.t += h;
  axes(c);
  const upY = AY[1];

  // ---- Geschwindigkeit im Fahrzeugsystem
  const vLongBody = c.vx * AZ[0] + c.vy * AZ[1] + c.vz * AZ[2];
  const vLatBody = c.vx * AX[0] + c.vy * AX[1] + c.vz * AX[2];
  const speed = Math.hypot(c.vx, c.vz);

  // ---- Eingabe -> Gas / Bremse / Gang
  const handbrake = (buttons & Btn.BRAKE) !== 0;
  let throttle = 0, brake = 0;
  if (c.gear < 0) {
    if (ay < -0.05) throttle = -ay;
    if (ay > 0.05) { if (vLongBody < -0.8) brake = ay; else c.gear = 1; }
  } else {
    if (ay > 0.05) throttle = ay;
    if (ay < -0.05) { if (vLongBody > 0.8) brake = -ay; else { c.gear = -1; throttle = -ay; } }
  }
  // Im tiefen Wasser: Motor aus, das Auto säuft ab und kommt schnell zum Stehen
  if (map.tileAt(c.x, c.z) === Tile.WATER) {
    throttle = 0; brake = 0;
    const k = Math.exp(-1.6 * h);
    c.vx *= k; c.vz *= k;
    const kr = Math.exp(-3 * h);
    c.wx *= kr; c.wy *= kr; c.wz *= kr; c.vy *= Math.exp(-1.5 * h); // Wasser dämpft Wippen und Drehen
    if (c.nitro > 0) c.nitro = Math.max(0, c.nitro - h * 0.5);
  }
  c.thr = throttle; c.brk = brake; c.hb = handbrake; c.rev = c.gear < 0;

  // ---- Lenkung: tempoabhängig, geglättet, Gegenlenk-Hilfe, Schadenszug
  const limit = steerLimit(p, vLongBody, handbrake);
  let target = -ax * limit;
  const grounded = c.ground !== 0;
  if (grounded && vLongBody > 4 && c.gear > 0) {
    const beta = Math.atan2(vLatBody, Math.abs(vLongBody)); // Schwimmwinkel (+ = rutscht nach links)
    if (Math.abs(beta) > 0.06) target += ASSISTS.counterSteer * beta * (handbrake ? 0.4 : 1);
  }
  if (dmg) target += steerPull(dmg);
  const maxSteer = (p.steerMax * Math.PI / 180) * 1.15;
  target = Math.max(-maxSteer, Math.min(maxSteer, target));
  const k = 1 - Math.exp(-h / Math.max(0.005, ASSISTS.steerSmoothing));
  const maxRate = p.steerRate * (p.steerMax * Math.PI / 180) * h;
  c.steer += Math.max(-maxRate, Math.min(maxRate, (target - c.steer) * k));

  // ---- Antrieb: Drehzahl, Automatik, Drehmoment
  const ratio = c.gear < 0 ? d.ratios[0] : d.ratios[Math.max(0, Math.min(d.ratios.length - 1, c.gear - 1))];
  const drivenFront = p.drive !== Drive.RWD, drivenRear = p.drive !== Drive.FWD;
  // Raddrehzahl der angetriebenen Achse (inkl. Durchdrehen aus dem letzten Schritt)
  let wheelV = 0, nd = 0;
  for (let i = 0; i < 4; i++) {
    if ((i < 2 && !drivenFront) || (i >= 2 && !drivenRear)) continue;
    wheelV += Math.abs(vLongBody) + (c.slip[i] > 2 && throttle > 0.3 ? c.slip[i] : 0);
    nd++;
  }
  wheelV /= Math.max(1, nd);
  const rpmWheels = (wheelV / (2 * Math.PI * p.wheelRadius)) * 60 * ratio * d.finalDrive;
  // Kupplung schleift beim Anfahren: Motor dreht mit dem Gas hoch
  const launchRpm = p.idleRpm + throttle * (p.redline * 0.55 - p.idleRpm);
  const rpmTarget = Math.max(p.idleRpm, rpmWheels, Math.abs(c.gear) === 1 ? launchRpm : 0);
  c.rpm += (Math.min(p.redline * 1.03, rpmTarget) - c.rpm) * Math.min(1, h * 14);
  if (c.shift > 0) c.shift -= h;
  else if (c.gear > 0 && grounded) {
    if (c.rpm > p.redline * 0.92 && c.gear < p.gears && rpmWheels > p.redline * 0.85) { c.gear++; c.shift = p.shiftTime; c.shifts++; }
    else if (c.rpm < p.redline * 0.42 && c.gear > 1) { c.gear--; c.shift = p.shiftTime * 0.5; c.shifts++; }
  }
  let engineTorque = p.torque * torqueCurve(c.rpm / p.redline) * throttle;
  if (c.shift > 0) engineTorque *= 0.05; // Zugkraftunterbrechung
  if (c.rpm >= p.redline) engineTorque *= 0.2; // Begrenzer
  if (dmg) engineTorque *= enginePower(dmg, c.t);
  if (c.gear < 0) engineTorque *= Math.max(0, 1 - Math.abs(vLongBody) / ASSISTS.reverseSpeed);
  const dir = c.gear < 0 ? -1 : 1;
  const driveForce = (engineTorque * ratio * d.finalDrive * 0.85) / p.wheelRadius;
  c.engLoad = c.shift > 0 ? 0 : throttle;
  // Nitro (Shift im Auto)
  const boost = (buttons & Btn.SPRINT) !== 0 && p.nitroForce > 0 && c.nitro > 0.01 && c.gear > 0 && throttle > 0.2;
  c.boost = boost;
  if (boost) c.nitro = Math.max(0, c.nitro - h / p.nitroTime);
  else if (p.nitroForce > 0) c.nitro = Math.min(1, c.nitro + h * ASSISTS.nitroRefill);

  // ---- Räder: Federung + Reifen
  let groundMask = 0;
  const brakeTotal = p.brake * m * GRAVITY * brake;
  for (let i = 0; i < 4; i++) {
    const [lx, lz] = d.wheels[i];
    rotate(c, lx, d.mountY, lz, WP);
    const mx = c.x + WP[0], my = c.y + WP[1], mz = c.z + WP[2];
    compPrev[i] = c.comp[i];
    supF[i] = 0;
    c.load[i] = 0;
    c.slip[i] = 0;
    c.surf[i] = 255;
    const rayLen = d.rest + p.wheelRadius;
    if (upY < 0.25) { c.comp[i] = 0; continue; } // auf der Seite: keine Radkräfte
    // Strahl entlang -AY; Höhenfeld zweimal abtasten (annähernd senkrecht)
    let t = (my - groundHeight(map, mx, mz)) / upY;
    const hx = mx - AY[0] * t, hz = mz - AY[2] * t;
    t = (my - groundHeight(map, hx, hz)) / upY;
    if (t > rayLen || t < -0.5) { c.comp[i] = Math.max(0, c.comp[i] - h * 3); continue; }
    const px = mx - AY[0] * t, py = my - AY[1] * t, pz = mz - AY[2] * t; // Aufstandspunkt
    let comp = rayLen - t;
    c.comp[i] = Math.min(comp, d.rest + 0.15);
    const compVel = (c.comp[i] - compPrev[i]) / h;
    let f = d.springK * comp + d.damperC * compVel;
    if (comp > d.rest) f += d.springK * 12 * (comp - d.rest) + d.damperC * 2 * Math.max(0, compVel); // Anschlag
    // Stabilisator: Achsgegenseite
    const other = i ^ 1;
    f += (comp - c.comp[other]) * d.springK * p.antiRoll * 0.8;
    f = Math.max(0, f);
    supF[i] = f;
    groundMask |= 1 << i;

    // Untergrund
    const tile = map.tileAt(px, pz);
    c.surf[i] = tile;
    const sg = surfaceGrip(tile);
    let mu = (i < 2 ? p.gripFront : p.gripRear) * sg.grip * (isWet(map, px, pz) ? ASSISTS.wetGrip : 1);
    if (dmg && dmg.tires & (1 << i)) mu *= 0.45; // geplatzter Reifen
    const nominal = (m / 4) * g;
    mu *= Math.max(0.6, 1 - ASSISTS.loadSensitivity * (f / nominal - 1));
    const N = Math.min(f, nominal * 3.5);
    c.load[i] = N;

    // Bodennormale (glatt) für die Reifenebene
    const e = 0.6;
    const gnx = smoothHeight(map, px - e, pz) - smoothHeight(map, px + e, pz);
    const gnz = smoothHeight(map, px, pz - e) - smoothHeight(map, px, pz + e);
    const gl = Math.hypot(gnx, 2 * e, gnz);
    const nX = gnx / gl, nY = (2 * e) / gl, nZ = gnz / gl;

    // Radrichtung: Karosserie-vorne um die Hochachse gedreht (Vorderräder lenken)
    const st = i < 2 ? c.steer : 0;
    const cs = Math.cos(st), sn = Math.sin(st);
    let fx = AZ[0] * cs + AX[0] * sn, fy = AZ[1] * cs + AX[1] * sn, fz = AZ[2] * cs + AX[2] * sn;
    const fd = fx * nX + fy * nY + fz * nZ;
    fx -= nX * fd; fy -= nY * fd; fz -= nZ * fd;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    // seitlich (links) = n x f
    const sx = nY * fz - nZ * fy, sy = nZ * fx - nX * fz, sz = nX * fy - nY * fx;

    // Geschwindigkeit am Aufstandspunkt
    const rx = px - c.x, ry = py - c.y, rz = pz - c.z;
    const vpx = c.vx + c.wy * rz - c.wz * ry, vpy = c.vy + c.wz * rx - c.wx * rz, vpz = c.vz + c.wx * ry - c.wy * rx;
    const vLong = vpx * fx + vpy * fy + vpz * fz;
    const vLat = vpx * sx + vpy * sy + vpz * sz;

    const rear = i >= 2;
    const peak = rear ? p.slipPeakRear : p.slipPeakFront;
    const hbLock = handbrake && rear;

    // -- Längs: Antrieb, Bremse, Handbremse, Rollwiderstand, Motorbremse
    let Fx = 0;
    const driven = rear ? drivenRear : drivenFront;
    if (driven) {
      const share = p.drive === Drive.AWD ? (rear ? 0.6 : 0.4) * 2 : 1;
      Fx += (driveForce * dir * share) / Math.max(1, nd);
      if (throttle < 0.05 && c.gear !== 0 && Math.abs(vLong) > 0.5) Fx -= Math.sign(vLong) * ASSISTS.engineBrake * (p.torque * ratio * d.finalDrive / p.wheelRadius) * (c.rpm / p.redline) / Math.max(1, nd);
      if (boost) Fx += p.nitroForce / Math.max(1, nd);
    }
    const bShare = (rear ? 1 - p.brakeBias : p.brakeBias) / 2;
    const mWheel = m / 4;
    const stopF = (Math.abs(vLong) * mWheel) / h; // Kraft, die das Rad in diesem Schritt stoppt
    if (brake > 0) Fx -= Math.sign(vLong) * Math.min(brakeTotal * bShare, stopF);
    Fx -= Math.sign(vLong) * Math.min(sg.roll * N, stopF);
    // Ohne Gas im Fast-Stand festhalten (kein Wegrollen am Hang)
    if (throttle < 0.05 && Math.abs(vLong) < 0.6) Fx -= Math.max(-mu * N, Math.min(mu * N, (vLong * mWheel / h) * 0.5));

    // -- Quer: Schlupfkurve
    const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 1.5)) * 180 / Math.PI;
    let latGrip = mu;
    if (hbLock) latGrip *= p.handbrakeGrip;
    let Fy = -latGrip * N * lateralCurve(alpha, peak, p.slipFalloff);
    // Haftung bei sehr wenig Tempo (kein Rutschen am Hang/Bordstein)
    if (speed < 3) Fy += Math.max(-mu * N, Math.min(mu * N, (-vLat * mWheel / h) * ASSISTS.staticGrip * (1 - speed / 3)));

    // -- Reibungskreis
    const maxF = mu * N;
    let spinExcess = 0;
    if (hbLock) {
      // blockiertes Hinterrad rutscht längs
      Fx = -Math.sign(vLong) * Math.min(maxF * ASSISTS.handbrakeDrag, stopF);
      spinExcess = Math.abs(vLong);
    } else if (Math.abs(Fx) > maxF) {
      // Durchdrehen / Blockieren: Seitengrip bricht ein (Leistungsübersteuern, je nach Driftfreudigkeit)
      const over = Math.abs(Fx) / maxF - 1;
      spinExcess = Math.min(25, over * 14);
      Fx = Math.sign(Fx) * maxF;
      Fy *= Math.max(0.2, 1 - over * (0.35 + p.drift * 0.9));
    }
    const tot = Math.hypot(Fx, Fy);
    const lim = hbLock ? maxF * 1.05 : maxF * 1.1;
    if (tot > lim) { Fx *= lim / tot; Fy *= lim / tot; }

    // Rutsch-Geschwindigkeit für Effekte
    const latSlide = Math.abs(alpha) > peak * 0.85 ? Math.abs(vLat) : 0;
    c.slip[i] = Math.max(latSlide, spinExcess);

    // Raddrehung (Optik)
    c.spin[i] = (c.spin[i] + ((hbLock ? 0 : vLong + Math.sign(Fx || 1) * spinExcess * (throttle > 0 ? 1 : 0)) / p.wheelRadius) * h) % (Math.PI * 2);

    // Kraft: Feder entlang Karosserie-Hochachse am Aufstandspunkt, Reifenkräfte etwas angehoben (rollCenter)
    const lift = (d.groundOffset) * ASSISTS.rollCenter;
    const ax2 = px + AY[0] * lift, ay2 = py + AY[1] * lift, az2 = pz + AY[2] * lift;
    const Fwx = fx * Fx + sx * Fy, Fwy = fy * Fx + sy * Fy, Fwz = fz * Fx + sz * Fy;
    applyImpulse(c, d, px, py, pz, AY[0] * f * h, AY[1] * f * h, AY[2] * f * h);
    applyImpulse(c, d, ax2, ay2, az2, Fwx * h, Fwy * h, Fwz * h);
    c.dbg[i * 6] = Fwx; c.dbg[i * 6 + 1] = f; c.dbg[i * 6 + 2] = Fwz;
    c.dbg[i * 6 + 3] = Fx; c.dbg[i * 6 + 4] = Fy; c.dbg[i * 6 + 5] = alpha;
  }
  c.ground = groundMask;

  // ---- Schwerkraft, Luftwiderstand
  c.vy -= g * h;
  const drag = d.dragC * speed / m * h;
  c.vx -= c.vx * drag; c.vz -= c.vz * drag;

  // ---- Arcade-Hilfen
  if (groundMask) {
    c.air = 0;
    // Gierdämpfung: dämpft das Drehen, das über die Lenkung hinausgeht
    const yawRate = c.wx * AY[0] + c.wy * AY[1] + c.wz * AY[2];
    const expected = (vLongBody * Math.tan(c.steer)) / p.wheelbase;
    const excess = yawRate - expected;
    const damp = ASSISTS.yawDamping * 10 * (handbrake ? 0.25 : 1) * (1 - p.drift * 0.5) * Math.min(1, speed / 6);
    const dy = -excess * Math.min(1, damp * h);
    c.wx += AY[0] * dy; c.wy += AY[1] * dy; c.wz += AY[2] * dy;
    // Drift-Schub: mit Gas im Drift nicht zu schnell verhungern
    const beta = Math.abs(Math.atan2(vLatBody, Math.abs(vLongBody)));
    if (beta > 0.2 && throttle > 0.3 && speed > 6 && c.gear > 0) {
      const push = ASSISTS.driftKeep * g * throttle * Math.min(1, (beta - 0.2) * 3) * h / speed;
      c.vx += c.vx * push; c.vz += c.vz * push;
    }
  } else {
    c.air += h;
    // Luftkontrolle (schwach): W/S neigen, A/D drehen
    if (c.air > 0.15) {
      const pr = ay * ASSISTS.airPitch * h;
      c.wx += AX[0] * pr; c.wy += AX[1] * pr; c.wz += AX[2] * pr;
      c.wy += -ax * ASSISTS.airYaw * h;
    }
    const ad = 1 - ASSISTS.angularDamping * h;
    c.wx *= ad; c.wy *= ad; c.wz *= ad;
  }
  // Anti-Überschlag: aufrichtendes Moment ab stabilityAngle (nicht mehr, wenn schon fast auf dem Dach)
  const tilt = Math.acos(Math.max(-1, Math.min(1, upY))) * 180 / Math.PI;
  if (tilt > ASSISTS.stabilityAngle && tilt < 80) {
    // Achse = AY x Welt-oben
    let kx = -AY[2], kz = AY[0];
    const kl = Math.hypot(kx, kz) || 1;
    kx /= kl; kz /= kl;
    const s = (tilt - ASSISTS.stabilityAngle) / 30 * ASSISTS.stability * h * (groundMask ? 1 : 0.4);
    c.wx += kx * s; c.wz += kz * s;
  }
  // Motorrad: Rollen um die Längsachse unterdrücken (die Optik legt sich selbst in die Kurve)
  if (p.upright) {
    const roll = AX[1]; // > 0: linke Seite oben
    const rollRate = c.wx * AZ[0] + c.wy * AZ[1] + c.wz * AZ[2];
    const corr = (-roll * 30 - rollRate * 6) * h * p.upright;
    c.wx += AZ[0] * corr; c.wy += AZ[1] * corr; c.wz += AZ[2] * corr;
  }
  // Auf Dach/Seite?
  if (upY < 0.35 && speed < 4) c.flip += h; else if (upY > 0.6) c.flip = 0;

  // ---- Integration
  c.x += c.vx * h; c.y += c.vy * h; c.z += c.vz * h;
  integrateRotation(c, h);

  // ---- Kollisionen mit der Welt
  collideWorld(map, c, p, d, out);
}

function integrateRotation(c: CarState, h: number) {
  const { wx, wy, wz } = c;
  let { qx, qy, qz, qw } = c;
  const hx = wx * h * 0.5, hy = wy * h * 0.5, hz = wz * h * 0.5;
  // dq = 0.5 * w * q
  const nx = qx + (hx * qw + hy * qz - hz * qy);
  const ny = qy + (hy * qw + hz * qx - hx * qz);
  const nz = qz + (hz * qw + hx * qy - hy * qx);
  const nw = qw - (hx * qx + hy * qy + hz * qz);
  const l = Math.hypot(nx, ny, nz, nw) || 1;
  qx = nx / l; qy = ny / l; qz = nz / l; qw = nw / l;
  c.qx = qx; c.qy = qy; c.qz = qz; c.qw = qw;
}

// ------------------------------------------------------------------ Welt-Kollision
const CP = v3();
/** Abtastpunkte der Karosserie (lokal, relativ zum Schwerpunkt). */
function hullPoints(p: HandlingProfile): number[][] {
  const hl = p.length / 2, hw = p.width / 2;
  const yb = -p.cgHeight + 0.28, yt = p.height - p.cgHeight - 0.1, ym = (yb + yt) / 2;
  const pts: number[][] = [];
  for (const y of [yb, yt]) for (const x of [-hw, hw]) for (const z of [-hl, hl]) pts.push([x, y, z]);
  pts.push([0, ym, hl], [0, ym, -hl], [hw, ym, hl * 0.4], [-hw, ym, hl * 0.4], [hw, ym, -hl * 0.4], [-hw, ym, -hl * 0.4]);
  pts.push([hw * 0.5, yb, hl], [-hw * 0.5, yb, hl], [hw * 0.5, yb, -hl], [-hw * 0.5, yb, -hl]);
  return pts;
}
const hullCache = new WeakMap<HandlingProfile, { v: number; pts: number[][] }>();

function collideWorld(map: WorldMap, c: CarState, p: HandlingProfile, d: Derived, out: StepOut | null) {
  let hc = hullCache.get(p);
  if (!hc || hc.v !== handlingVersion()) hullCache.set(p, (hc = { v: handlingVersion(), pts: hullPoints(p) }));
  const pts = hc.pts;
  let accX = 0, accY = 0, accZ = 0;
  const e = ASSISTS.wallRestitution, mu = ASSISTS.wallFriction;
  for (const lp of pts) {
    rotate(c, lp[0], lp[1], lp[2], CP);
    const px = c.x + CP[0] + accX, py = c.y + CP[1] + accY, pz = c.z + CP[2] + accZ;
    // Karosserie am Boden (Dach, Seite, harte Landung)
    const gh = groundHeight(map, px, pz);
    if (py < gh) {
      const depth = gh - py;
      resolveStatic(c, d, px, py, pz, 0, 1, 0, 0.1, 0.5, out, 1, -1);
      if (depth > accY) accY = Math.min(depth, 0.5);
    }
    // Wände (Kacheln)
    // (Gebäude mit exaktem Rechteck übernimmt collideBuildings – hier nur Fels, Wasser, Mauern …)
    const cx = Math.floor(px / 2), cz = Math.floor(pz / 2);
    if (!wallCell(map, cx, cz)) continue;
    // Normale aus dem Belegungs-Gradienten (glatter als die Rasterkante)
    const occ = (x: number, z: number) => (wallCell(map, Math.floor(x / 2), Math.floor(z / 2)) ? 1 : 0);
    let nx = occ(px - 1.2, pz) - occ(px + 1.2, pz), nz = occ(px, pz - 1.2) - occ(px, pz + 1.2);
    // Tiefe: kürzester Weg aus der Zelle in eine freie Nachbarzelle
    const x0 = cx * 2, z0 = cz * 2;
    const opts: [number, number, number][] = [
      [px - x0, -1, 0], [x0 + 2 - px, 1, 0], [pz - z0, 0, -1], [z0 + 2 - pz, 0, 1],
    ];
    let best = 9, bx = 0, bz = 0;
    for (const [dist, dx, dz] of opts) {
      if (wallCell(map, cx + dx, cz + dz)) continue;
      if (dist < best) { best = dist; bx = dx; bz = dz; }
    }
    if (best === 9) { // tief drin: zurück zur Fahrzeugmitte
      bx = c.x - px; bz = c.z - pz;
      const l = Math.hypot(bx, bz) || 1;
      bx /= l; bz /= l; best = 0.3;
    }
    if (!nx && !nz) { nx = bx; nz = bz; }
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    if (nx * bx + nz * bz < 0.3) { nx = bx; nz = bz; }
    const depth = Math.min(best + 0.01, 1);
    resolveStatic(c, d, px, py, pz, nx, 0, nz, e, mu, out, 0, -1);
    const already = accX * nx + accZ * nz;
    if (depth > already) { accX += nx * (depth - already); accZ += nz * (depth - already); }
  }
  // Gebäude: exakte gedrehte Rechtecke gegen die Fahrzeugbox (SAT)
  for (const b of boxesNear(map, c.x, c.z, Math.hypot(p.length, p.width) / 2, boxTmp)) {
    if (!carVsBox(c, p, b, satOut)) continue;
    const [nx, nz, depth, px, pz] = satOut;
    const py = c.y - p.cgHeight + Math.min(0.75, p.height * 0.45);
    resolveStatic(c, d, px, py, pz, nx, 0, nz, e, mu, out, 0, -1);
    const already = accX * nx + accZ * nz;
    if (depth > already) { accX += nx * (depth - already); accZ += nz * (depth - already); }
  }
  // Baumstämme (Kreise) gegen die Fahrzeugbox
  for (const o of obstaclesNear(map, c.x, c.z, obsTmp)) {
    const r = boxCircle(c, p, o.x, o.z, o.r);
    if (!r) continue;
    const [nx, nz, depth, px, pz] = r;
    const py = c.y - p.cgHeight + 0.6;
    const j = resolveStatic(c, d, px, py, pz, nx, 0, nz, 0.3, 0.4, out, 2, o.tree);
    if (j > 0 && out) out.trees.push([o.tree, j / p.mass]);
    const already = accX * nx + accZ * nz;
    if (depth > already) { accX += nx * (depth - already); accZ += nz * (depth - already); }
  }
  c.x += accX; c.y += accY; c.z += accZ;
}

/** Wand-Kachel für Autos, die nicht schon exakt als Gebäude-Rechteck kollidiert. */
function wallCell(map: WorldMap, cx: number, cz: number) {
  return blocksCar(map.tile(cx, cz)) && !exactCell(map, cx, cz);
}

const boxTmp: Box[] = [];
const satOut = [0, 0, 0, 0, 0];
const carCorners = new Float64Array(8), boxCorners = new Float64Array(8);
/**
 * Fahrzeugbox (Grundriss) gegen ein Gebäude-Rechteck, Separating Axis Test über die 4 Kantenachsen.
 * out = [nx, nz, Tiefe, Kontakt-x, Kontakt-z], Normale vom Gebäude zum Fahrzeug.
 */
export function carVsBox(c: CarState, p: HandlingProfile, b: Box, out: number[]): boolean {
  const fa = Math.sin(c.a), ca = Math.cos(c.a);
  const hl = p.length / 2, hw = p.width / 2;
  const dx = c.x - b.x, dz = c.z - b.z;
  // Achsen: Auto vorne (sin, cos) und links (cos, -sin); Gebäude z (s, c) und x (c, -s)
  const ax = [fa, ca, ca, -fa, b.s, b.c, b.c, -b.s];
  let best = Infinity, nx = 0, nz = 0;
  for (let k = 0; k < 4; k++) {
    const ux = ax[k * 2], uz = ax[k * 2 + 1];
    const rc = Math.abs(fa * ux + ca * uz) * hl + Math.abs(ca * ux - fa * uz) * hw;
    const rb = Math.abs(b.c * ux - b.s * uz) * b.hw + Math.abs(b.s * ux + b.c * uz) * b.hd;
    const dist = dx * ux + dz * uz;
    const overlap = rc + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) { best = overlap; const sg = dist < 0 ? -1 : 1; nx = ux * sg; nz = uz * sg; }
  }
  // Kontaktpunkt: Mittel der Ecken, die im jeweils anderen Körper stecken
  let k = 0;
  for (const sl of [1, -1]) for (const sf of [1, -1]) {
    carCorners[k] = c.x + fa * hl * sf + ca * hw * sl * sf; carCorners[k + 1] = c.z + ca * hl * sf - fa * hw * sl * sf;
    boxCorners[k] = b.x + b.s * b.hd * sf + b.c * b.hw * sl * sf; boxCorners[k + 1] = b.z + b.c * b.hd * sf - b.s * b.hw * sl * sf;
    k += 2;
  }
  let px = 0, pz = 0, n = 0;
  for (let i = 0; i < 8; i += 2) {
    const qx = carCorners[i] - b.x, qz = carCorners[i + 1] - b.z;
    if (Math.abs(qx * b.c - qz * b.s) <= b.hw && Math.abs(qx * b.s + qz * b.c) <= b.hd) { px += carCorners[i]; pz += carCorners[i + 1]; n++; }
    const rx = boxCorners[i] - c.x, rz = boxCorners[i + 1] - c.z;
    if (Math.abs(rx * fa + rz * ca) <= hl && Math.abs(rx * ca - rz * fa) <= hw) { px += boxCorners[i]; pz += boxCorners[i + 1]; n++; }
  }
  if (n) { px /= n; pz /= n; } else {
    // Kanten kreuzen sich ohne Ecke im anderen Körper: Punkt der Fahrzeugkontur zur Wand hin
    const rc = Math.abs(fa * nx + ca * nz) * hl + Math.abs(ca * nx - fa * nz) * hw;
    px = c.x - nx * rc; pz = c.z - nz * rc;
  }
  out[0] = nx; out[1] = nz; out[2] = best; out[3] = px; out[4] = pz;
  return true;
}

/**
 * Kreis (Welt) gegen die Fahrzeugbox (XZ-Ebene). Rückgabe [nx, nz, Tiefe, Kontakt-x, Kontakt-z]
 * mit der Normale vom Kreis zum Fahrzeug, oder null.
 */
export function boxCircle(c: CarState, p: HandlingProfile, ox: number, oz: number, r: number): [number, number, number, number, number] | null {
  const dx = ox - c.x, dz = oz - c.z;
  if (dx * dx + dz * dz > (p.length / 2 + r + 0.5) ** 2) return null;
  const fx = Math.sin(c.a), fz = Math.cos(c.a); // vorne
  const lx = dx * fz - dz * fx; // links (+x lokal) = (cos a, -sin a)
  const lz = dx * fx + dz * fz;
  const hl = p.length / 2, hw = p.width / 2;
  const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hl, Math.min(hl, lz));
  let ddx = lx - qx, ddz = lz - qz;
  let dist = Math.hypot(ddx, ddz);
  let depth: number;
  if (dist > 1e-6) {
    if (dist >= r) return null;
    depth = r - dist;
    ddx /= dist; ddz /= dist;
  } else {
    // Mittelpunkt in der Box: entlang der kürzesten Achse hinaus
    const ex = hw - Math.abs(lx), ez = hl - Math.abs(lz);
    if (ex < ez) { ddx = Math.sign(lx) || 1; ddz = 0; depth = ex + r; } else { ddx = 0; ddz = Math.sign(lz) || 1; depth = ez + r; }
  }
  // Normale vom Kreis zum Auto = -(lokale Richtung Box->Kreis), zurück in Welt
  const wx = -(ddx * fz + ddz * fx), wz = -(-ddx * fx + ddz * fz);
  const cpx = c.x + qx * fz + qz * fx, cpz = c.z - qx * fx + qz * fz;
  return [wx, wz, depth, cpx, cpz];
}

/**
 * Festes rundes Hindernis (z. B. Laterne, die nicht umknickt): Impuls + Herausschieben.
 * Gibt die Aufprallgeschwindigkeit zurück (0 = kein Kontakt).
 */
export function collideStaticCircle(c: CarState, p: HandlingProfile, ox: number, oz: number, r: number, out: StepOut | null, kind: number, id: number): number {
  const hit = boxCircle(c, p, ox, oz, r);
  if (!hit) return 0;
  const [nx, nz, depth, px, pz] = hit;
  const d = derive(p);
  const py = c.y - p.cgHeight + 0.6;
  const rx = px - c.x, rz = pz - c.z;
  const vn = (c.vx + c.wy * rz) * nx + (c.vz - c.wy * rx) * nz;
  resolveStatic(c, d, px, py, pz, nx, 0, nz, 0.25, 0.4, out, kind, id);
  c.x += nx * depth; c.z += nz * depth;
  return Math.max(0, -vn);
}

/** Geschwindigkeit des Fahrzeugs am Weltpunkt (x, y, z). */
export function velocityAt(c: CarState, x: number, y: number, z: number, out: number[] = [0, 0, 0]) {
  const rx = x - c.x, ry = y - c.y, rz = z - c.z;
  out[0] = c.vx + c.wy * rz - c.wz * ry; out[1] = c.vy + c.wz * rx - c.wx * rz; out[2] = c.vz + c.wx * ry - c.wy * rx;
  return out;
}

// ------------------------------------------------------------------ Fahrzeug <-> Fahrzeug
export interface CarCollision {
  /** Normalimpuls (Ns), Aufprall-Δv je Fahrzeug (m/s) */
  j: number; dvA: number; dvB: number;
  /** Kontaktpunkt (Welt) und Normale (von A nach B) */
  x: number; y: number; z: number; nx: number; nz: number;
  /** Relative Annäherungsgeschwindigkeit */
  vn: number;
}

const cornersA = new Float64Array(8), cornersB = new Float64Array(8);
function corners(c: CarState, p: HandlingProfile, out: Float64Array) {
  const fx = Math.sin(c.a), fz = Math.cos(c.a), lx = fz, lz = -fx;
  const hl = p.length / 2, hw = p.width / 2;
  let k = 0;
  for (const sl of [1, -1]) for (const sf of [1, -1]) {
    out[k++] = c.x + fx * hl * sf + lx * hw * sl * sf;
    out[k++] = c.z + fz * hl * sf + lz * hw * sl * sf;
  }
}
function inside(c: CarState, p: HandlingProfile, x: number, z: number) {
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  const dx = x - c.x, dz = z - c.z;
  return Math.abs(dx * fx + dz * fz) <= p.length / 2 && Math.abs(dx * fz - dz * fx) <= p.width / 2;
}

/**
 * Zwei Fahrzeuge (orientierte Boxen in der Ebene, SAT) gegeneinander auflösen.
 * moveB = false: B wird nicht verändert (Client-Prediction gegen fremde Fahrzeuge).
 */
export function collideCars(A: CarState, pa: HandlingProfile, B: CarState, pb: HandlingProfile, moveB: boolean, out: CarCollision): boolean {
  const dx = B.x - A.x, dz = B.z - A.z;
  const reach = (pa.length + pb.length) / 2;
  if (dx * dx + dz * dz > reach * reach) return false;
  if (Math.abs((A.y - pa.cgHeight + pa.height / 2) - (B.y - pb.cgHeight + pb.height / 2)) > (pa.height + pb.height) / 2) return false;
  // SAT über die 4 Achsen
  const axesList = [Math.sin(A.a), Math.cos(A.a), Math.cos(A.a), -Math.sin(A.a), Math.sin(B.a), Math.cos(B.a), Math.cos(B.a), -Math.sin(B.a)];
  let best = Infinity, nx = 0, nz = 0;
  for (let k = 0; k < 4; k++) {
    const ux = axesList[k * 2], uz = axesList[k * 2 + 1];
    const ra = projRadius(A, pa, ux, uz), rb = projRadius(B, pb, ux, uz);
    const dist = dx * ux + dz * uz;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) { best = overlap; const s = dist < 0 ? -1 : 1; nx = ux * s; nz = uz * s; }
  }
  // Kontaktpunkt: Mittel der Ecken, die im jeweils anderen Fahrzeug stecken
  corners(A, pa, cornersA); corners(B, pb, cornersB);
  let cx = 0, cz = 0, cn = 0;
  for (let k = 0; k < 4; k++) {
    if (inside(B, pb, cornersA[k * 2], cornersA[k * 2 + 1])) { cx += cornersA[k * 2]; cz += cornersA[k * 2 + 1]; cn++; }
    if (inside(A, pa, cornersB[k * 2], cornersB[k * 2 + 1])) { cx += cornersB[k * 2]; cz += cornersB[k * 2 + 1]; cn++; }
  }
  if (cn) { cx /= cn; cz /= cn; } else { cx = (A.x + B.x) / 2; cz = (A.z + B.z) / 2; }
  const cy = Math.min(A.y - pa.cgHeight, B.y - pb.cgHeight) + Math.min(pa.height, pb.height) * 0.4;

  const da = derive(pa), db = derive(pb);
  const rax = cx - A.x, ray = cy - A.y, raz = cz - A.z;
  const rbx = cx - B.x, rby = cy - B.y, rbz = cz - B.z;
  const vax = A.vx + A.wy * raz - A.wz * ray, vay = A.vy + A.wz * rax - A.wx * raz, vaz = A.vz + A.wx * ray - A.wy * rax;
  const vbx = B.vx + B.wy * rbz - B.wz * rby, vby = B.vy + B.wz * rbx - B.wx * rbz, vbz = B.vz + B.wx * rby - B.wy * rbx;
  const rvx = vbx - vax, rvy = vby - vay, rvz = vbz - vaz;
  const vn = rvx * nx + rvz * nz;

  // Trennen (nach Masse verteilt)
  const ima = 1 / pa.mass, imb = moveB ? 1 / pb.mass : 0;
  const share = ima / (ima + imb || 1);
  const sep = best + 0.005;
  A.x -= nx * sep * share; A.z -= nz * sep * share;
  if (moveB) { B.x += nx * sep * (1 - share); B.z += nz * sep * (1 - share); }
  A.sleep = 0; if (moveB) B.sleep = 0;

  out.j = 0; out.dvA = 0; out.dvB = 0; out.vn = -vn;
  out.x = cx; out.y = cy; out.z = cz; out.nx = nx; out.nz = nz;
  if (vn >= 0) return true; // entfernen sich schon
  const k = invMassAt(A, da, rax, ray, raz, nx, 0, nz) + invMassAt(B, db, rbx, rby, rbz, nx, 0, nz);
  const e = -vn > 2 ? ASSISTS.carRestitution : 0;
  const j = (-(1 + e) * vn) / k;
  // Reibung
  let tx = rvx - vn * nx, ty = rvy, tz = rvz - vn * nz;
  const vt = Math.hypot(tx, ty, tz);
  let jt = 0;
  if (vt > 1e-4) {
    tx /= vt; ty /= vt; tz /= vt;
    const kt = invMassAt(A, da, rax, ray, raz, tx, ty, tz) + invMassAt(B, db, rbx, rby, rbz, tx, ty, tz);
    jt = Math.min(vt / kt, ASSISTS.carFriction * j);
  }
  const jx = nx * j + tx * jt, jy = ty * jt, jz = nz * j + tz * jt;
  applyImpulse(A, da, cx, cy, cz, -jx, -jy, -jz, ASSISTS.crashSpin);
  if (moveB) applyImpulse(B, db, cx, cy, cz, jx, jy, jz, ASSISTS.crashSpin);
  syncDerived(A); if (moveB) syncDerived(B);
  out.j = j; out.dvA = j / pa.mass; out.dvB = j / pb.mass;
  return true;
}

function projRadius(c: CarState, p: HandlingProfile, ux: number, uz: number) {
  const fx = Math.sin(c.a), fz = Math.cos(c.a);
  return Math.abs(fx * ux + fz * uz) * p.length / 2 + Math.abs(fz * ux - fx * uz) * p.width / 2;
}

// ------------------------------------------------------------------ Lokale Koordinaten
/** Weltpunkt -> lokale Fahrzeugkoordinaten (x links, y oben, z vorne), relativ zum Schwerpunkt. */
export function toLocal(c: CarState, x: number, y: number, z: number, out: number[] = [0, 0, 0]) {
  unrotate(c, x - c.x, y - c.y, z - c.z, tmpC);
  out[0] = tmpC[0]; out[1] = tmpC[1]; out[2] = tmpC[2];
  return out;
}
/** Weltrichtung -> lokal */
export function dirToLocal(c: CarState, x: number, y: number, z: number, out: number[] = [0, 0, 0]) {
  unrotate(c, x, y, z, tmpC);
  out[0] = tmpC[0]; out[1] = tmpC[1]; out[2] = tmpC[2];
  return out;
}
export function toWorld(c: CarState, x: number, y: number, z: number, out: number[] = [0, 0, 0]) {
  rotate(c, x, y, z, tmpC);
  out[0] = c.x + tmpC[0]; out[1] = c.y + tmpC[1]; out[2] = c.z + tmpC[2];
  return out;
}
/** Hochachse der Karosserie (Welt). */
export function upVector(c: CarState, out: number[] = [0, 0, 0]) {
  rotate(c, 0, 1, 0, tmpC);
  out[0] = tmpC[0]; out[1] = tmpC[1]; out[2] = tmpC[2];
  return out;
}

// ------------------------------------------------------------------ Netzwerk
const r4 = (v: number) => Math.round(v * 10000) / 10000;
/** Vollständiger Zustand für die Reconciliation des EIGENEN Fahrzeugs. */
export function packCar(c: CarState): number[] {
  return [
    r4(c.x), r4(c.y), r4(c.z), r4(c.qx), r4(c.qy), r4(c.qz), r4(c.qw),
    r4(c.vx), r4(c.vy), r4(c.vz), r4(c.wx), r4(c.wy), r4(c.wz),
    r4(c.steer), Math.round(c.rpm), c.gear, r4(c.shift), r4(c.t), r4(c.air), r4(c.flip), r4(c.nitro),
    r4(c.comp[0]), r4(c.comp[1]), r4(c.comp[2]), r4(c.comp[3]), r4(c.sleep),
  ];
}
export function unpackCar(a: number[], c: CarState) {
  [c.x, c.y, c.z, c.qx, c.qy, c.qz, c.qw, c.vx, c.vy, c.vz, c.wx, c.wy, c.wz, c.steer, c.rpm, c.gear, c.shift, c.t, c.air, c.flip, c.nitro] = a;
  for (let i = 0; i < 4; i++) c.comp[i] = a[21 + i];
  c.sleep = a[25] ?? 0;
  syncDerived(c);
}
export function copyCar(src: CarState, dst: CarState) {
  unpackCar(packCar(src), dst);
}

/** Neigung (Nicken, Rollen) für die kompakte Übertragung fremder Fahrzeuge. */
export function pitchRoll(c: CarState): [number, number] {
  axes(c);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -AZ[1]))); // + = Nase unten
  const roll = Math.atan2(AX[1], AY[1]); // + = linke Seite oben
  return [pitch, roll];
}
/** Quaternion aus Gier/Nicken/Rollen (gleiche Konvention wie pitchRoll). */
export function setOrientation(c: CarState, yaw: number, pitch: number, roll: number) {
  // q = qYaw * qPitch(um x) * qRoll(um z)
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  // qYaw*qPitch
  const ax = cy * sp, ay = sy * cp, az = -sy * sp, aw = cy * cp;
  // * qRoll (0,0,sr,cr)
  c.qx = ax * cr + ay * sr; c.qy = ay * cr - ax * sr; c.qz = aw * sr + az * cr; c.qw = aw * cr - az * sr;
  c.a = yaw;
}
