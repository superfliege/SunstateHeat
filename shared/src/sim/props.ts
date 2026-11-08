// Zerstörbare Umgebung: Laternen knicken um, Hydranten verlieren den Deckel und spritzen,
// Zäune/Mülltonnen/Zeitungsautomaten/Kegel/Bänke/Strandliegen fliegen weg.
//
// carVsProps() läuft in Client-Prediction UND Server (gleicher Impuls aufs Auto).
// Die Flugbahn der getroffenen Props simuliert nur der Server (PropBody) und überträgt sie.
import { PROP_INFO, PropType, propsNear, type Prop } from '../world/features';
import type { WorldMap } from '../world/WorldMap';
import { applyImpulse, boxCircle, collideStaticCircle, groundHeight, velocityAt, type CarState, type StepOut } from './car';
import { derive, type HandlingProfile } from './handling';

/** Ab dieser Geschwindigkeit (m/s) knickt eine Laterne um bzw. bricht ein Hydrant ab. */
export const PROP_BREAK = { lamp: 6, hydrant: 3.5 };
/** Respawn: nach so vielen Sekunden außerhalb der Sicht (kein Spieler im Umkreis). */
export const PROP_RESPAWN = 120;
export const PROP_RESPAWN_RANGE = 130;

export interface PropHit { prop: Prop; vx: number; vy: number; vz: number; speed: number }

const near: Prop[] = [];
const tmpV = [0, 0, 0];

/**
 * Fahrzeug gegen intakte Props. isGone(id) = Prop ist schon verschoben/zerstört.
 * Leichte Props werden weggeschleudert (Impulsaustausch nach Masse), Laternen/Hydranten
 * brechen erst ab einer Mindestgeschwindigkeit – darunter sind sie feste Hindernisse.
 */
export function carVsProps(map: WorldMap, c: CarState, p: HandlingProfile, isGone: (id: number) => boolean, hits: PropHit[], out: StepOut | null) {
  hits.length = 0;
  const speed = Math.hypot(c.vx, c.vz);
  for (const pr of propsNear(map, c.x, c.z, near)) {
    if (isGone(pr.id)) continue;
    const info = PROP_INFO[pr.type];
    // Höhe: Prop steht am Boden – Auto in der Luft fliegt drüber
    if (c.y - p.cgHeight > pr.y + 1.2) continue;
    const hit = boxCircle(c, p, pr.x, pr.z, info.r);
    if (!hit) continue;
    const [nx, nz, , px, pz] = hit;
    const py = pr.y + 0.5;
    velocityAt(c, px, py, pz, tmpV);
    const vn = -(tmpV[0] * nx + tmpV[2] * nz); // Annäherung ans Prop (> 0)
    const sturdy = pr.type === PropType.Lamp ? PROP_BREAK.lamp : pr.type === PropType.Hydrant ? PROP_BREAK.hydrant : 0;
    if (vn < sturdy * Math.min(1, 1600 / p.mass)) {
      // zu langsam: festes Hindernis
      collideStaticCircle(c, p, pr.x, pr.z, info.r, out, 3, pr.id);
      continue;
    }
    // Impulsaustausch (leicht unelastisch): Prop bekommt die Kontaktgeschwindigkeit, Auto verliert Schwung
    const mc = p.mass, mp = info.mass;
    const j = (mc * mp / (mc + mp)) * 1.25 * Math.max(0, vn);
    applyImpulse(c, derive(p), px, py, pz, nx * j, 0, nz * j);
    const k = (mc * 1.25) / (mc + mp);
    const up = pr.type === PropType.Lamp || pr.type === PropType.Hydrant ? 0 : 2 + Math.min(6, speed * 0.25);
    hits.push({ prop: pr, vx: -nx * vn * k + tmpV[0] * 0.2, vy: up, vz: -nz * vn * k + tmpV[2] * 0.2, speed: vn });
    if (out && vn > out.impact.dv) Object.assign(out.impact, { dv: vn * (mp / (mc + mp)), x: px, y: py, z: pz, nx, ny: 0, nz, kind: 3, id: pr.id, scrape: 0 });
  }
}

// ------------------------------------------------------------------ Server: Prop-Dynamik
export interface PropBody {
  id: number; type: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  qx: number; qy: number; qz: number; qw: number;
  wx: number; wy: number; wz: number;
  /** Laterne: Kippwinkel (rad) + Kippachse; Hydrant: Fontäne-Restzeit */
  tilt: number; tiltV: number; ax: number; az: number;
  spray: number;
  rest: boolean;
  /** Sekunden ohne Spieler in der Nähe (Respawn) */
  unseen: number;
}

export function createPropBody(pr: Prop, hit: PropHit): PropBody {
  const b: PropBody = {
    id: pr.id, type: pr.type, x: pr.x, y: pr.y, z: pr.z, vx: hit.vx, vy: hit.vy, vz: hit.vz,
    qx: 0, qy: Math.sin(pr.rot / 2), qz: 0, qw: Math.cos(pr.rot / 2),
    wx: 0, wy: 0, wz: 0, tilt: 0, tiltV: 0, ax: 0, az: 0, spray: 0, rest: false, unseen: 0,
  };
  const sp = Math.hypot(hit.vx, hit.vz) || 1;
  if (pr.type === PropType.Lamp) {
    // kippt in Stoßrichtung: Achse = oben x Richtung
    b.ax = hit.vz / sp; b.az = -hit.vx / sp;
    b.tiltV = Math.min(3, hit.speed * 0.15);
    b.vx = b.vy = b.vz = 0;
  } else if (pr.type === PropType.Hydrant) {
    b.spray = 25; b.vx = b.vy = b.vz = 0; b.rest = true;
  } else {
    // Taumeln: Drehung um eine Achse quer zur Flugrichtung + etwas Gieren
    b.wx = (hit.vz / sp) * Math.min(14, sp * 0.8); b.wz = (-hit.vx / sp) * Math.min(14, sp * 0.8);
    b.wy = (pr.id % 2 ? 1 : -1) * Math.min(8, sp * 0.4);
  }
  return b;
}

/** Ein Server-Schritt. Rückgabe: true, wenn sich das Prop bewegt hat. */
export function stepPropBody(map: WorldMap, b: PropBody, dt: number): boolean {
  if (b.type === PropType.Hydrant) { if (b.spray > 0) b.spray -= dt; return false; }
  if (b.rest) return false;
  if (b.type === PropType.Lamp) {
    // Umknicken um den Fuß: Winkelbeschleunigung durch Schwerkraft, Anschlag bei ~85°
    b.tiltV += 6 * Math.sin(Math.max(0.08, b.tilt)) * dt;
    b.tilt = Math.min(1.48, b.tilt + b.tiltV * dt);
    if (b.tilt >= 1.48) { b.tiltV = 0; b.rest = true; }
    const yaw = 2 * Math.atan2(b.qy, b.qw);
    setAxisAngleYaw(b, b.ax, b.az, b.tilt, yaw);
    return true;
  }
  b.vy -= 9.81 * 1.4 * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const g = groundHeight(map, b.x, b.z);
  if (b.y < g) {
    b.y = g;
    if (b.vy < -2) { b.vy = -b.vy * 0.3; b.wx *= 0.6; b.wz *= 0.6; } else b.vy = 0;
    const f = Math.max(0, 1 - 4 * dt);
    b.vx *= f; b.vz *= f; b.wy *= f;
  }
  // Drehung integrieren (Welt-Winkelgeschwindigkeit)
  const hx = b.wx * dt * 0.5, hy = b.wy * dt * 0.5, hz = b.wz * dt * 0.5;
  const { qx, qy, qz, qw } = b;
  const nx = qx + (hx * qw + hy * qz - hz * qy), ny = qy + (hy * qw + hz * qx - hx * qz);
  const nz = qz + (hz * qw + hx * qy - hy * qx), nw = qw - (hx * qx + hy * qy + hz * qz);
  const l = Math.hypot(nx, ny, nz, nw) || 1;
  b.qx = nx / l; b.qy = ny / l; b.qz = nz / l; b.qw = nw / l;
  if (b.y <= g + 0.01) {
    // am Boden: Taumeln abbremsen und flach legen
    const d = Math.max(0, 1 - 6 * dt);
    b.wx *= d; b.wz *= d;
  }
  if (b.y <= g + 0.01 && Math.hypot(b.vx, b.vy, b.vz) < 0.2 && Math.hypot(b.wx, b.wz) < 0.3) b.rest = true;
  return true;
}

function setAxisAngleYaw(b: PropBody, ax: number, az: number, angle: number, yaw: number) {
  // q = qTilt(Achse in der Ebene) * qYaw
  const s = Math.sin(angle / 2), tx = ax * s, tz = az * s, tw = Math.cos(angle / 2);
  const ys = Math.sin(yaw / 2), yw = Math.cos(yaw / 2);
  b.qw = tw * yw; b.qx = tx * yw - tz * ys; b.qy = tw * ys; b.qz = tz * yw + tx * ys;
}
