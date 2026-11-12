// Okee Peak: der große Berg im Norden von Palmara (Dry Pine Country / Pinecrest Highlands).
// Ersetzt die alten unpassierbaren Randberge (ROCK-Hügel) durch ein befahrbares Massiv:
// Hauptgipfel mit zwei Nebengipfeln und Grat, Felsstufen, Geröllfelder, bewaldete Hänge.
//
// Alles hier ist eine reine Funktion fester Daten (eigener Seed) – Client und Server erzeugen
// dieselbe Form, dieselben Straßen und dieselben Orte. terrain.ts schreibt das Höhenfeld,
// roads.ts übernimmt die Bergstraßen (Switchback Road, Pfade) als Kanten, die Höhenprofile der
// Straßen werden in das Gelände „eingeschnitten“ (Hangschnitt/Damm), damit die Fahrbahn eine
// fahrbare Steigung behält.
import { makeValueNoise } from '../math';
import { catmullRom, cumulative, pointAt, type Vec2 } from './geometry';

// ------------------------------------------------------------------ Form
export interface Peak { name: string; x: number; z: number; h: number; rx: number; rzN: number; rzS: number; pow: number }

/** Gipfel: Hauptgipfel + zwei Nebengipfel (Höhe in m; Downtown-Türme enden bei ~150 m). */
export const PEAKS: Peak[] = [
  { name: 'Okee Peak', x: 868, z: 228, h: 214, rx: 290, rzN: 190, rzS: 262, pow: 1.75 },
  { name: 'West Knob', x: 728, z: 250, h: 128, rx: 150, rzN: 140, rzS: 175, pow: 1.6 },
  { name: 'Eagle Tooth', x: 1000, z: 226, h: 142, rx: 120, rzN: 130, rzS: 170, pow: 1.5 },
  // Hügel um den Stausee (halten das Wasser im Tal) und westlich davon
  { name: 'Rimrock Hills', x: 614, z: 210, h: 50, rx: 112, rzN: 100, rzS: 92, pow: 1.3 },
  { name: 'Sabal Knob', x: 518, z: 246, h: 66, rx: 110, rzN: 110, rzS: 130, pow: 1.4 },
  // sanfte Vorberge am Südfuß (vorher die Felsbuckel an der Pinecrest-Schleife)
  { name: 'Pine Shoulder', x: 1128, z: 400, h: 22, rx: 70, rzN: 60, rzS: 60, pow: 1.3 },
];
export const SUMMIT = PEAKS[0];
/** Höhe des Gipfelplateaus (Aussichtspunkt, Café, Funkturm). */
export const SUMMIT_PLATEAU = { x: 866, z: 258, r: 20 };

/** Grat zwischen den Gipfeln: Polylinie mit Höhe je Punkt. */
const RIDGE: [number, number, number][] = [[728, 250, 118], [790, 238, 96], [868, 228, 200], [940, 222, 108], [1000, 226, 132]];

/** Stausee auf der Westseite (oberhalb des Sabal River), Wasserspiegel in m. */
export const RESERVOIR = {
  name: 'Okee Reservoir', level: 30,
  poly: [[580, 198], [606, 184], [638, 188], [654, 208], [648, 232], [624, 242], [598, 240], [580, 222]] as Vec2[],
  /** Staumauer am Südende: von a nach b (Krone), Kronenhöhe. */
  dam: { a: [586, 250] as Vec2, b: [640, 244] as Vec2, crest: 32 },
  /** Wasserfall (Überlauf) unterhalb der Mauer: Fallpunkt oben und Becken unten. */
  fall: { x: 613, z: 252, top: 31, bottom: 12, pool: [614, 268] as Vec2 },
  /** Bootssteg (Polylinie ins Wasser) und Angelplätze am Ufer. */
  jetty: [[652, 214], [636, 212]] as Vec2[],
  fishSpots: [[650, 226, -2.2], [592, 236, 0.6], [584, 204, 1.2], [626, 186, 2.9]] as [number, number, number][],
};

/** Testgelände (features.ts) bleibt flach: Maskenrechteck mit Rand. */
const FLAT_RECTS: [number, number, number, number][] = [[1056, 176, 1252, 322]];

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SEED = 7703;
const n1 = makeValueNoise(SEED), n2 = makeValueNoise(SEED + 1), n3 = makeValueNoise(SEED + 2);

/** Großform ohne Detail-Rauschen (für Straßenführung und Fern-LOD). */
export function okeeBase(x: number, z: number): number {
  // Domain-Warp, damit Bergfüße nicht elliptisch wirken
  const wx = x + (n1(x * 0.006, z * 0.006) - 0.5) * 70, wz = z + (n1(x * 0.006 + 40, z * 0.006) - 0.5) * 70;
  let h = 0;
  for (const p of PEAKS) {
    const dx = (wx - p.x) / p.rx, dz = (wz - p.z) / (wz < p.z ? p.rzN : p.rzS);
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= 1) continue;
    // Profil: gewölbte Kuppe oben, konkave Flanken unten (kein glatter Kegel)
    const u = 1 - d;
    const c = p.h * (u * u * (3 - 2 * u) * 0.45 + Math.pow(u, p.pow) * 0.55);
    // weiches Maximum: Sättel zwischen den Gipfeln bleiben gefüllt
    h = h > c ? h + c * 0.12 * (c / h) : c + h * 0.12 * (h / c);
  }
  // Grat
  for (let i = 0; i < RIDGE.length - 1; i++) {
    const [ax, az, ah] = RIDGE[i], [bx, bz, bh] = RIDGE[i + 1];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((wx - ax) * ex + (wz - az) * ez) / l2));
    const px = ax + ex * t, pz = az + ez * t;
    const dp = Math.hypot(wx - px, wz - pz);
    const top = Math.min(ah, bh) * 0.62 + (Math.max(ah, bh) - Math.min(ah, bh)) * 0.25 * (1 - Math.abs(t - (ah > bh ? 0 : 1)));
    const w = 46 + top * 0.25;
    if (dp < w) h = Math.max(h, top * Math.pow(1 - dp / w, 1.4));
  }
  return h * flatMask(x, z);
}

function flatMask(x: number, z: number): number {
  let m = 1;
  for (const [x0, z0, x1, z1] of FLAT_RECTS) {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
    m = Math.min(m, smooth(Math.hypot(dx, dz) / 40));
  }
  return m;
}

/**
 * Volle Höhe mit Detail: Rauschen proportional zur Höhe, Felsstufen (Abbrüche) in Bändern,
 * Grate mit Zacken. `base` = okeeBase(x, z) (falls schon berechnet).
 */
export function okeeDetail(x: number, z: number, base = okeeBase(x, z)): number {
  if (base <= 0.01) return 0;
  const k = Math.min(1, base / 30);
  const fbm = (n2(x * 0.02, z * 0.02) - 0.5) * 0.6 + (n2(x * 0.055 + 9, z * 0.055) - 0.5) * 0.3 + (n3(x * 0.14, z * 0.14) - 0.5) * 0.12;
  let h = base + fbm * (4 + base * 0.09) * k;
  // Zacken (ridged noise) weiter oben
  const r = 1 - Math.abs(n3(x * 0.03 + 5, z * 0.03) * 2 - 1);
  h += r * r * Math.max(0, base - 60) * 0.08;
  // Felsstufen: in Rauschflecken wird das Profil getreppt -> Abbrüche mit Felswänden
  const cliff = smooth((n1(x * 0.021 + 77, z * 0.021) * 0.7 + n2(x * 0.06, z * 0.06 + 3) * 0.3 - 0.58) * 6);
  if (cliff > 0 && h > 25) {
    const step = 11 + n3(x * 0.01, z * 0.01 + 50) * 10, f = h / step, fl = Math.floor(f), fr = f - fl;
    const stepped = (fl + smooth((fr - 0.55) / 0.45)) * step;
    h += (stepped - h) * cliff * 0.6;
  }
  return Math.max(0, h);
}

/** Steilheit (Gradient-Betrag) der Großform. */
export function okeeSlope(x: number, z: number): number {
  const e = 2;
  return Math.hypot(okeeBase(x + e, z) - okeeBase(x - e, z), okeeBase(x, z + e) - okeeBase(x, z - e)) / (2 * e);
}

// ------------------------------------------------------------------ Bergstraßen
/** Straßentyp wie RoadType (WorldMap) – hier als Zahl, um Importkreise zu vermeiden. */
const RT = { Main: 1, Side: 2, Dirt: 3 } as const;

export interface MountainRoad {
  name: string; type: number;
  /** Dichte Mittellinie (≈ 3 m Abstand) und Höhenprofil je Punkt. */
  pts: Vec2[]; prof: number[];
  /** Höchste erlaubte Steigung (für das Profil). */
  grade: number;
  dest?: 'start' | 'end' | 'both';
  /** Leitplanken auf der Talseite. */
  guard?: boolean;
  /** Bogenlängen der Aussichtsbuchten (Haltebuchten auf der Talseite). */
  bays?: number[];
  /** Bogenlängen-Bereich, der als Tunnel (Felsdach) dargestellt wird. */
  tunnel?: [number, number];
}

/** Startpunkt der Switchback Road an der Pinecrest-Schleife (Fuß des Bergs). */
export const SWITCHBACK_START: Vec2 = [952, 508];

/**
 * Serpentine automatisch erzeugen: Die Straße folgt den Höhenlinien der Großform mit fester
 * Steigung (Kontur + Steigungsanteil bergauf), wechselt an den Grenzen des Südhangs per
 * Haarnadelkurve die Richtung und endet am Gipfelplateau.
 */
function traceSwitchback(): Vec2[] {
  const g = 0.135, step = 3, R = 9.5;
  const px = SUMMIT.x, pz = SUMMIT.z;
  // Fenster (Azimut um den Gipfel, 0 = Süden): Westgrenze, Ostgrenze
  const wMin = -1.3, wMax = 1.05;
  const pts: Vec2[] = [];
  let x = SWITCHBACK_START[0], z = SWITCHBACK_START[1];
  pts.push([x, z]);
  // erst gerade nach Norden auf den Hangfuß
  for (let i = 0; i < 10; i++) { z -= step; pts.push([x, z]); }
  let dir = -1; // -1 = nach Westen (Azimut fällt), +1 = nach Osten
  let guard = 0;
  const grad = (qx: number, qz: number): [number, number] => {
    const e = 2;
    return [(okeeBase(qx + e, qz) - okeeBase(qx - e, qz)) / (2 * e), (okeeBase(qx, qz + e) - okeeBase(qx, qz - e)) / (2 * e)];
  };
  while (guard++ < 2000) {
    const dPeak = Math.hypot(x - SUMMIT_PLATEAU.x, z - SUMMIT_PLATEAU.z);
    const hNow = okeeBase(x, z);
    if (dPeak < SUMMIT_PLATEAU.r + 4 || hNow > SUMMIT.h - 16) break;
    // oberer Teil: Gipfelschleife (Spirale um den Kegel, keine Kehren mehr)
    const spiral = hNow > SUMMIT.h * 0.62;
    const [gx, gz] = grad(x, z);
    const gl = Math.hypot(gx, gz) || 1e-6;
    const nx = gx / gl, nz = gz / gl; // bergauf
    // Konturtangente: Azimut steigt, wenn man (Blick bergauf) nach rechts geht -> Vorzeichen prüfen
    let tx = -nz, tz = nx;
    const az = Math.atan2(x - px, z - pz), az2 = Math.atan2(x + tx - px, z + tz - pz);
    if (Math.sign(az2 - az) !== dir) { tx = -tx; tz = -tz; }
    const b = Math.min(1, g / gl), a = Math.sqrt(1 - b * b);
    let dx = tx * a + nx * b, dz = tz * a + nz * b;
    const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
    // Fenstergrenze erreicht -> Haarnadel (Halbkreis bergauf)
    const azNow = Math.atan2(x - px, z - pz);
    // Fenster wird nach oben enger, damit die obersten Kehren nicht über den Grat laufen
    const tighten = Math.min(1, Math.max(0.8, dPeak / 140));
    if (!spiral && ((dir < 0 && azNow < wMin * tighten) || (dir > 0 && azNow > wMax * tighten))) {
      const cx = x + nx * R, cz = z + nz * R;
      const a0 = Math.atan2(x - cx, z - cz);
      // Drehsinn: weiter in Laufrichtung, dann zurück
      const sgn = (Math.sin(a0) * dz - Math.cos(a0) * dx) > 0 ? -1 : 1;
      const steps = Math.ceil((Math.PI * R) / step);
      for (let k = 1; k <= steps; k++) {
        const ang = a0 + sgn * (Math.PI * k) / steps;
        x = cx + Math.sin(ang) * R; z = cz + Math.cos(ang) * R;
        pts.push([x, z]);
      }
      dir = -dir;
      // ein Stück geradeaus aus der Kehre heraus, damit der Azimut sicher wieder im Fenster liegt
      continue;
    }
    x += dx * step; z += dz * step;
    pts.push([x, z]);
  }
  // Schlussstück aufs Plateau
  const [ex, ez] = pts[pts.length - 1];
  const tx = SUMMIT_PLATEAU.x, tz = SUMMIT_PLATEAU.z + 10;
  const L = Math.hypot(tx - ex, tz - ez);
  for (let d = step; d < L; d += step) pts.push([ex + ((tx - ex) * d) / L, ez + ((tz - ez) * d) / L]);
  pts.push([tx, tz]);
  return pts;
}

/** Glättung einer Punktfolge (gleitender Mittelwert, Enden fest). */
function smoothPts(p: Vec2[], r: number, passes: number): Vec2[] {
  let cur = p;
  for (let k = 0; k < passes; k++) {
    const out: Vec2[] = cur.map((q) => [q[0], q[1]] as Vec2);
    for (let i = r; i < cur.length - r; i++) {
      let sx = 0, sz = 0;
      for (let j = -r; j <= r; j++) { sx += cur[i + j][0]; sz += cur[i + j][1]; }
      out[i] = [sx / (2 * r + 1), sz / (2 * r + 1)];
    }
    cur = out;
  }
  return cur;
}

/** Gleichmäßig neu abtasten. */
function resample(p: Vec2[], spacing: number): Vec2[] {
  const cum = cumulative(p), L = cum[cum.length - 1];
  const out: Vec2[] = [];
  const n = Math.max(1, Math.round(L / spacing));
  for (let i = 0; i <= n; i++) { const q = pointAt(p, cum, (L * i) / n); out.push([q.x, q.z]); }
  return out;
}

/**
 * Höhenprofil: folgt dem Gelände, aber höchstens `grade` Steigung je Meter (vorwärts und
 * rückwärts begrenzt), danach geglättet. `fixEnd` = Ende auf Geländehöhe zwingen (Gipfel).
 */
function profileOf(pts: Vec2[], grade: number, ground: (x: number, z: number) => number): number[] {
  const cum = cumulative(pts);
  const nat = pts.map(([x, z]) => ground(x, z));
  const prof = nat.slice();
  for (let i = 1; i < prof.length; i++) {
    const ds = cum[i] - cum[i - 1];
    prof[i] = Math.min(prof[i - 1] + grade * ds, Math.max(prof[i - 1] - grade * ds, prof[i]));
  }
  for (let i = prof.length - 2; i >= 0; i--) {
    const ds = cum[i + 1] - cum[i];
    prof[i] = Math.min(prof[i + 1] + grade * ds, Math.max(prof[i + 1] - grade * ds, prof[i]));
  }
  // glätten (Kuppen/Wannen weich), Enden bleiben
  for (let pass = 0; pass < 3; pass++) {
    const src = prof.slice();
    for (let i = 3; i < prof.length - 3; i++) prof[i] = (src[i - 3] + src[i - 2] + src[i - 1] + src[i] + src[i + 1] + src[i + 2] + src[i + 3]) / 7;
  }
  return prof;
}

const ctrlRoad = (ctrl: Vec2[]) => resample(catmullRom(ctrl, 2), 3);

let cached: MountainRoad[] | null = null;

/** Nächster Punkt einer Straße (Index) zu (x, z). */
function nearestIdx(pts: Vec2[], x: number, z: number): number {
  let best = 0, bd = Infinity;
  pts.forEach(([px, pz], i) => { const d = (px - x) ** 2 + (pz - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

/** Alle Bergstraßen (Switchback Road, Tunnel, Staumauer, Holzfällerweg, Steinbruch). */
export function mountainRoads(): MountainRoad[] {
  if (cached) return cached;
  const ground = (x: number, z: number) => okeeGround(x, z);
  const roads: MountainRoad[] = [];
  const mk = (name: string, type: number, pts: Vec2[], grade: number, extra: Partial<MountainRoad> = {}, fix: [number?, number?] = []) => {
    const prof = profileOf(pts, grade, ground);
    // feste Anschlusshöhen (Einmündung in eine andere Bergstraße, Dammkrone): linear einblenden
    const cum = cumulative(pts), L = cum[cum.length - 1];
    const d0 = fix[0] !== undefined ? fix[0] - prof[0] : 0, d1 = fix[1] !== undefined ? fix[1] - prof[prof.length - 1] : 0;
    for (let i = 0; i < prof.length; i++) prof[i] += d0 * (1 - cum[i] / L) + d1 * (cum[i] / L);
    const r: MountainRoad = { name, type, pts, prof, grade, ...extra };
    roads.push(r);
    return r;
  };
  // Switchback Road: Hauptstraße mit Leitplanken und Aussichtsbuchten
  const sw = resample(smoothPts(traceSwitchback(), 2, 3), 3);
  const swCum = cumulative(sw), swL = swCum[swCum.length - 1];
  const swRoad = mk('Switchback Road', RT.Main, sw, 0.165, { dest: 'end', guard: true, bays: [0.27, 0.47, 0.66, 0.84].map((f) => f * swL) });
  // Okee Notch Tunnel: Abkürzung durch die Schulter des West Knob zur Staumauer
  // zweigt unterhalb der ersten Haarnadel ab und läuft westlich an ihr vorbei durch den Rimrock-Sattel
  const ni = nearestIdx(sw, 704, 352);
  const notch = ctrlRoad([sw[ni], [684, 352], [656, 336], [634, 304], [632, 276], [640, 252]]);
  const nCum0 = cumulative(notch), nL = nCum0[nCum0.length - 1], h0 = swRoad.prof[ni], h1 = RESERVOIR.dam.crest;
  // Tunnel mit gleichmäßigem Gefälle (Profil linear zwischen Einmündung und Dammkrone)
  const nr: MountainRoad = { name: 'Okee Notch Tunnel', type: RT.Side, pts: notch, prof: nCum0.map((c) => h0 + (h1 - h0) * (c / nL)), grade: Math.abs(h1 - h0) / nL };
  roads.push(nr);
  // Tunnelbereich = tiefer Einschnitt (Gelände > 9 m über der Fahrbahn)
  const nCum = cumulative(notch);
  let t0 = -1, t1 = -1;
  notch.forEach(([x, z], k) => { if (okeeDetail(x, z) - nr.prof[k] > 5) { if (t0 < 0) t0 = nCum[k]; t1 = nCum[k]; } });
  if (t0 >= 0 && t1 - t0 > 12) nr.tunnel = [t0 - 4, t1 + 4];
  // Dammkrone (eben) und Holzfällerweg hinunter zur Northwest Road
  const crest = ctrlRoad([[640, 248], [613, 251], [586, 254]]);
  roads.push({ name: 'Dam Crest', type: RT.Side, pts: crest, prof: crest.map(() => RESERVOIR.dam.crest), grade: 0, guard: true });
  mk('Timber Trail', RT.Dirt, ctrlRoad([[584, 255], [566, 290], [552, 330], [556, 372], [574, 410], [588, 436]]), 0.2, {}, [RESERVOIR.dam.crest]);
  // Steinbruch-Zufahrt an der Ostflanke
  mk('Quarry Road', RT.Side, ctrlRoad([[1078, 488], [1068, 440], [1056, 392], [1044, 346], [1036, 312]]), 0.12, { dest: 'end' });
  cached = roads;
  return roads;
}

// ------------------------------------------------------------------ Orte am Berg
export interface OkeePad { name: string; x: number; z: number; r: number; h?: number; tile: 'gravel' | 'plaza' | 'grass' }

/** Orte am Berg (Weltkoordinaten). Höhen ohne `h` = Geländehöhe in der Mitte (nach dem Einschnitt). */
export const OKEE_PLACES = {
  summit: { x: SUMMIT_PLATEAU.x, z: SUMMIT_PLATEAU.z },
  radioTower: { x: 868, z: 230 },
  cafe: { x: 878, z: 262, rot: -0.3 },
  telescopes: [[855, 251, 2.9], [851, 262, -2.4], [884, 252, 0.4]] as [number, number, number][],
  ranger: { x: 904, z: 432, rot: 0.2 },
  campground: { x: 724, z: 456, r: 30 },
  quarry: { x: 1030, z: 292, r: 38 },
  logYard: { x: 552, z: 344, r: 18 },
  truckstop: { x: 1008, z: 548, rot: 0 },
};

/** Ebene Flächen (Gipfelplateau, Camping, Ranger, Steinbruchsohle, Holzplatz, Aussichtsbuchten). */
export function okeePads(): OkeePad[] {
  const roads = mountainRoads();
  const sw = roads[0];
  const out: OkeePad[] = [
    { name: 'Gipfelplateau', x: SUMMIT_PLATEAU.x, z: SUMMIT_PLATEAU.z, r: SUMMIT_PLATEAU.r, h: sw.prof[sw.prof.length - 1], tile: 'plaza' },
    { name: 'Pinecone Campground', x: OKEE_PLACES.campground.x, z: OKEE_PLACES.campground.z, r: OKEE_PLACES.campground.r, tile: 'grass' },
    { name: 'Ranger-Station', x: OKEE_PLACES.ranger.x, z: OKEE_PLACES.ranger.z, r: 14, tile: 'gravel' },
    { name: 'Steinbruch', x: OKEE_PLACES.quarry.x, z: OKEE_PLACES.quarry.z, r: 26, h: 6, tile: 'gravel' },
    { name: 'Holzplatz', x: OKEE_PLACES.logYard.x, z: OKEE_PLACES.logYard.z, r: OKEE_PLACES.logYard.r, tile: 'gravel' },
  ];
  // Aussichtsbuchten: auf der Talseite neben der Fahrbahn, auf Fahrbahnhöhe
  const cum = cumulative(sw.pts);
  for (const s of sw.bays ?? []) {
    const q = pointAt(sw.pts, cum, s);
    const k = nearestIdx(sw.pts, q.x, q.z);
    // Talseite: die Seite mit dem niedrigeren Gelände
    const l = okeeBase(q.x - q.dz * 12, q.z + q.dx * 12), r = okeeBase(q.x + q.dz * 12, q.z - q.dx * 12);
    const side = l < r ? 1 : -1;
    out.push({ name: 'Aussichtsbucht', x: q.x - q.dz * 9 * side, z: q.z + q.dx * 9 * side, r: 6.5, h: sw.prof[k], tile: 'plaza' });
  }
  return out;
}

/** Offroad-/Wanderpfade (nur Untergrund Schotter, folgen dem Gelände – keine Verkehrskanten). */
export const OKEE_TRAILS: { name: string; pts: Vec2[]; width: number }[] = [
  { name: 'Scree Run', pts: [[850, 266], [822, 296], [790, 322], [754, 350], [724, 372]], width: 5 },
  { name: 'Eagle Trail', pts: [[944, 290], [962, 270], [980, 250], [996, 232]], width: 4 },
  { name: 'Pine Traverse', pts: [[912, 440], [948, 424], [990, 410], [1030, 396], [1056, 388]], width: 5 },
  { name: 'Ridge Path', pts: [[858, 236], [826, 238], [792, 240], [760, 244], [736, 248]], width: 3 },
  { name: 'Camp Loop', pts: [[700, 470], [690, 430], [700, 396], [724, 376]], width: 4 },
];

/** Sprungschanzen an Abhängen (auf den Pfaden, Richtung bergab). */
export const OKEE_RAMPS: { x: number; z: number; len: number; w: number; h: number }[] = [
  { x: 800, z: 315, len: 12, w: 6, h: 2.8 },
  { x: 742, z: 359, len: 10, w: 6, h: 2.2 },
  { x: 1000, z: 406, len: 12, w: 7, h: 2.6 },
  { x: 694, z: 420, len: 9, w: 5, h: 1.8 },
];

// ------------------------------------------------------------------ Gelände (ohne Straßen)
/** Liegt (x, z) im Stausee? */
export function inReservoir(x: number, z: number): boolean {
  const p = RESERVOIR.poly;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToPoly(x: number, z: number, p: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [ax, az] = p[j], [bx, bz] = p[i];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return best;
}

/**
 * Natürliches Berg-Gelände inkl. Stausee-Becken, Staumauer und Steinbruch-Bermen (ohne Straßen).
 * Das ist die Höhe, die terrain.ts für den Berg einsetzt (vor dem Einschnitt der Straßen).
 */
export function okeeGround(x: number, z: number): number {
  let h = okeeDetail(x, z);
  // Stausee: Becken unter dem Wasserspiegel, Ufer mindestens knapp darüber
  const R = RESERVOIR;
  if (Math.abs(x - 616) < 110 && Math.abs(z - 220) < 90) {
    const inside = inReservoir(x, z);
    const d = inside ? 0 : distToPoly(x, z, R.poly);
    if (inside) h = Math.min(h, R.level - 3 - Math.min(5, distToPoly(x, z, R.poly) * 0.25));
    else if (d < 26) h = Math.max(h, R.level + 2.2 - Math.max(0, d - 8) * 0.25);
    // Staumauer: Krone als Damm, talseitig steil
    const [ax, az] = R.dam.a, [bx, bz] = R.dam.b;
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    const dd = Math.hypot(x - ax - ex * t, z - az - ez * t);
    if (dd < 5) h = Math.max(h, R.dam.crest);
    // Tosbecken unterhalb des Wasserfalls
    const [px, pz] = R.fall.pool;
    const dp = Math.hypot(x - px, z - pz);
    if (dp < 16) h = Math.min(h, R.fall.bottom + Math.max(0, dp - 6) * 1.2);
  }
  // Steinbruch: Bermen (Stufen) in die Ostflanke geschnitten
  const Q = OKEE_PLACES.quarry;
  const dq = Math.hypot(x - Q.x, z - Q.z);
  if (dq < Q.r + 30) {
    const benches = 6 + Math.floor(Math.max(0, dq - 22) / 9) * 7;
    const cut = Math.min(h, benches);
    const k = smooth((Q.r + 30 - dq) / 18);
    h = h + (cut - h) * k;
  }
  return h;
}
