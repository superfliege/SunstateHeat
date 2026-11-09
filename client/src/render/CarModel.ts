// Prozedurale Fahrzeugmodelle mit Schadensdarstellung.
//
// Jede Klasse (Kompakt, Limousine, Kombi, Taxi, Sport, Muscle, Pick-up, Lkw, Polizei) wird aus
// einer geloftete Karosserie (genug Vertices in den Knautschzonen), einer Fahrgastzelle mit
// Scheiben und abtrennbaren Teilen (Stoßstangen, Haube, Kofferraum, Türen, Spiegel) gebaut –
// alles in EINER Geometrie (ein Draw-Call + Umrisslinie). Lichter sind eine zweite kleine
// Geometrie (Scheinwerfer, Rück-, Brems- und Rückfahrlicht). Räder zeichnet EntityViews
// gesammelt als InstancedMesh.
//
// Verformung: applyDent() drückt Vertices im Radius um den Kontaktpunkt entlang der
// Aufprallrichtung ein (Stärke begrenzt, Fahrgastzelle geschützt). Die Funktion hängt nur
// von den Beulen-Daten ab -> jeder Client bildet dieselbe Verformung nach.
//
// Lokales System wie in der Physik: +x = links, +y = oben, +z = vorne, Ursprung = Schwerpunkt.
import * as THREE from 'three';
import { VEHICLE_COLORS } from '../../../shared/src/constants';
import { derive, HANDLING, variantInfo, type HandlingProfile } from '../../../shared/src/sim/handling';
import { Part, PART_COUNT } from '../../../shared/src/sim/damage';
import { getModel, type ModelName } from './assets';
import { computeOutlineNormals } from './materials/toon';
import { palmaraize } from './palette';

// ------------------------------------------------------------------ Farben
const DARK = 0x1c1c22, CHASSIS = 0x15151a, GLASS = 0x2a4a66, CHROME = 0xc9ccd6, PLASTIC = 0x2a2a30;
const ENGINE = 0x3a3a40, INTERIOR = 0x2b2228, CRACK_A = 0xb8d4e8, CRACK_B = 0x7fa2bf;
const HEAD = 0xfff6c8, TAIL = 0xff2a3a, REV = 0xf4f4ff;

/** Glanzstärke je Materialart (Attribut shine im Toon-Shader). */
const SHINE = { paint: 0.9, glass: 1.3, chrome: 1.6, rubber: 0 } as const;

// ------------------------------------------------------------------ Formen
interface Shape {
  /** Schulterlinie (Oberkante Karosserie) hinten/Mitte/vorne über dem Boden (m) */
  deckY: number; beltY: number; hoodY: number;
  roofY: number;
  /** Fahrgastzelle (normiert 0 = Heck … 1 = Front): Heckscheibe unten, Dach hinten, Dach vorne, Frontscheibe unten */
  cab: [number, number, number, number];
  sillY: number;
  roofW: number;
  noseDrop: number; tailDrop: number;
  bed?: boolean;
  box?: [number, number, number]; // Lkw-Koffer: z0, z1 (normiert), Höhe über Boden
  spoiler?: boolean; scoop?: boolean; stripes?: number; lightbar?: boolean; taxi?: boolean;
  bumper: number; // Farbe
  paintOverride?: number;
  hatch?: boolean; // Heckklappe statt Kofferraumdeckel
}

const SHAPES: Record<string, Shape> = {
  car_hatchback: { deckY: 0.92, beltY: 0.95, hoodY: 0.88, roofY: 1.45, cab: [0.06, 0.16, 0.6, 0.72], sillY: 0.26, roofW: 0.8, noseDrop: 0.12, tailDrop: 0.05, bumper: PLASTIC, hatch: true },
  car_sedan: { deckY: 0.95, beltY: 0.97, hoodY: 0.9, roofY: 1.45, cab: [0.22, 0.32, 0.6, 0.7], sillY: 0.27, roofW: 0.78, noseDrop: 0.1, tailDrop: 0.06, bumper: CHROME },
  car_stationwagon: { deckY: 0.97, beltY: 0.97, hoodY: 0.9, roofY: 1.47, cab: [0.04, 0.08, 0.6, 0.7], sillY: 0.27, roofW: 0.82, noseDrop: 0.1, tailDrop: 0.03, bumper: PLASTIC, hatch: true },
  car_taxi: { deckY: 0.95, beltY: 0.97, hoodY: 0.9, roofY: 1.45, cab: [0.22, 0.32, 0.6, 0.7], sillY: 0.27, roofW: 0.78, noseDrop: 0.1, tailDrop: 0.06, bumper: CHROME, taxi: true, paintOverride: 0xf2c418 },
  proc_sport: { deckY: 0.82, beltY: 0.8, hoodY: 0.7, roofY: 1.18, cab: [0.25, 0.36, 0.52, 0.64], sillY: 0.2, roofW: 0.7, noseDrop: 0.16, tailDrop: 0.04, bumper: PLASTIC, spoiler: true, stripes: 0 },
  proc_muscle: { deckY: 0.92, beltY: 0.9, hoodY: 0.92, roofY: 1.32, cab: [0.18, 0.34, 0.52, 0.62], sillY: 0.25, roofW: 0.76, noseDrop: 0.06, tailDrop: 0.04, bumper: CHROME, scoop: true, stripes: 0xf4f1e8 },
  truck_red: { deckY: 1.2, beltY: 1.25, hoodY: 1.2, roofY: 1.95, cab: [0.36, 0.42, 0.64, 0.72], sillY: 0.45, roofW: 0.84, noseDrop: 0.08, tailDrop: 0.02, bumper: CHROME, bed: true },
  truck_yellow: { deckY: 1.2, beltY: 1.25, hoodY: 1.2, roofY: 1.95, cab: [0.36, 0.42, 0.64, 0.72], sillY: 0.45, roofW: 0.84, noseDrop: 0.08, tailDrop: 0.02, bumper: PLASTIC, bed: true },
  proc_boxtruck: { deckY: 1.25, beltY: 1.45, hoodY: 1.35, roofY: 2.75, cab: [0.66, 0.72, 0.86, 0.92], sillY: 0.5, roofW: 0.86, noseDrop: 0.15, tailDrop: 0, bumper: PLASTIC, box: [0.0, 0.64, 3.2] },
  police: { deckY: 0.97, beltY: 0.98, hoodY: 0.92, roofY: 1.47, cab: [0.22, 0.32, 0.6, 0.7], sillY: 0.27, roofW: 0.78, noseDrop: 0.1, tailDrop: 0.06, bumper: PLASTIC, lightbar: true, paintOverride: 0x1d1d26 },
};

// ------------------------------------------------------------------ Geometrie-Bauer
interface Range { start: number; count: number }
interface PartInfo extends Range {
  hinge: THREE.Vector3; axis: THREE.Vector3;
  /** Grundwinkel im "wackelt"-Zustand und Schwingweite */
  loose: number; swing: number;
  /** Fläche darunter, die beim Abfallen eingefärbt wird (Innenraum/Motorraum) */
  under?: Range; underColor?: number;
}

class Builder {
  pos: number[] = [];
  col: number[] = [];
  shine: number[] = [];
  private c = new THREE.Color();
  get count() { return this.pos.length / 3; }

  tri(a: number[], b: number[], c: number[], color: number, shine: number) {
    this.c.setHex(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.shine.push(shine);
    }
  }
  /** Viereck a-b-c-d (gegen den Uhrzeigersinn von außen gesehen). */
  quad(a: number[], b: number[], c: number[], d: number[], color: number, shine: number) {
    this.tri(a, b, c, color, shine);
    this.tri(a, c, d, color, shine);
  }
  /** Unterteilte Box (für verformbare Flächen): n Segmente je Achse. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, n: [number, number, number], color: number, shine: number, skipBottom = true) {
    const [nx, ny, nz] = n;
    const L = (a: number, b: number, t: number) => a + (b - a) * t;
    const face = (pt: (u: number, v: number) => number[], nu: number, nv: number) => {
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        this.quad(pt(i / nu, j / nv), pt((i + 1) / nu, j / nv), pt((i + 1) / nu, (j + 1) / nv), pt(i / nu, (j + 1) / nv), color, shine);
      }
    };
    face((u, v) => [L(x0, x1, u), L(y0, y1, v), z1], nx, ny); // vorne
    face((u, v) => [L(x1, x0, u), L(y0, y1, v), z0], nx, ny); // hinten
    face((u, v) => [x1, L(y0, y1, v), L(z1, z0, u)], nz, ny); // links (+x)
    face((u, v) => [x0, L(y0, y1, v), L(z0, z1, u)], nz, ny); // rechts
    face((u, v) => [L(x0, x1, u), y1, L(z1, z0, v)], nx, nz); // oben
    if (!skipBottom) face((u, v) => [L(x0, x1, u), y0, L(z0, z1, v)], nx, nz);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('shine', new THREE.Float32BufferAttribute(this.shine, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

export interface CarTemplate {
  body: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  parts: (PartInfo | null)[];
  /** Scheiben-Dreiecke je Zone (0 vorne, 1 hinten, 2 links, 3 rechts): Vertex-Bereiche */
  glass: Range[][];
  /** Licht-Bereiche: 0 VL, 1 VR (Scheinwerfer), 2 HL, 3 HR (Rücklicht), 4/5 Rückfahrlicht */
  lightRanges: Range[];
  /** Räder (lokal): Mittelpunkt bei Einfederung 0, Radius, Breite */
  wheels: { x: number; z: number; r: number; w: number }[];
  /** Ruhelage der Radmitte relativ zum Schwerpunkt (ohne Einfederung) */
  wheelBaseY: number;
  /** Motorraum (Rauch/Feuer), Auspuff, Sitz für sichtbare Fahrer */
  engine: THREE.Vector3; exhaust: THREE.Vector3[]; seatY: number;
  /** Fahrgastzelle (geschützt): z-Bereich und Sockelhöhe (lokal) */
  cell: [number, number, number];
  bike: boolean;
}

const templates = new Map<string, CarTemplate>();

/** Modell-Name je Variante (Polizei-Klasse bekommt das Polizei-Modell). */
function modelKey(variant: number): string {
  const info = variantInfo(variant);
  if (info.cls === 'police') return 'police';
  return info.model;
}

export function carTemplate(variant: number, colorIdx: number): CarTemplate {
  const key = `${variant}:${colorIdx}`;
  let t = templates.get(key);
  if (!t) { t = buildTemplate(variant, colorIdx); templates.set(key, t); }
  return t;
}

function buildTemplate(variant: number, colorIdx: number): CarTemplate {
  const info = variantInfo(variant);
  const p = profileFor(info.cls);
  if (info.cls === 'bike') return buildBike(p, VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length]);
  if (info.cls === 'tank') return buildTank(p);
  // Kenney Car Kit (Polizei nutzt das Kit-Polizeiauto, falls geladen)
  const key = modelKey(variant);
  const kitName = (key === 'police' ? 'ck-police' : key) as ModelName;
  if (kitName.startsWith('ck-') && getModel(kitName)) {
    return buildKitCar(p, kitName, KIT_FIXED_PAINT.has(kitName) ? null : VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length]);
  }
  const shape = SHAPES[key] ?? SHAPES[KIT_FALLBACK[info.cls] ?? 'car_sedan'] ?? SHAPES.car_sedan;
  const paint = shape.paintOverride ?? VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length];
  return buildCar(p, shape, paint);
}


function profileFor(cls: string): HandlingProfile { return (HANDLING as Record<string, HandlingProfile>)[cls] ?? HANDLING.sedan; }

/** Bodenhöhe (lokal) des Fahrzeugs im Stand. */
function groundLocal(p: HandlingProfile) { return -p.cgHeight; }

function buildCar(p: HandlingProfile, s: Shape, paint: number): CarTemplate {
  const b = new Builder();
  const L = p.length, hw = p.width / 2;
  const g0 = groundLocal(p);
  const Z = (t: number) => -L / 2 + t * L; // normiert -> lokal
  const [c0, c1, c2, c3] = s.cab.map(Z);
  // Schulterlinie (über Boden) entlang z
  const shoulder = (z: number) => {
    const t = (z + L / 2) / L;
    let y: number;
    if (z < c0) y = s.deckY;
    else if (z > c3) y = s.hoodY;
    else y = s.beltY;
    // weiche Übergänge
    const blend = (edge: number, a: number, bb: number, w = 0.25) => { const k = Math.max(0, Math.min(1, (z - edge) / w + 0.5)); return a + (bb - a) * k * k * (3 - 2 * k); };
    if (Math.abs(z - c0) < 0.3) y = blend(c0, s.deckY, s.beltY);
    if (Math.abs(z - c3) < 0.3) y = blend(c3, s.beltY, s.hoodY);
    if (t > 0.94) y -= s.noseDrop * (t - 0.94) / 0.06;
    if (t < 0.05) y -= s.tailDrop * (0.05 - t) / 0.05;
    if (s.box && t < s.box[1]) y = s.deckY;
    return y;
  };
  const halfW = (z: number) => {
    const t = (z + L / 2) / L;
    const e = Math.max(0, Math.abs(t - 0.5) * 2 - 0.82) / 0.18; // Rundung an den Enden
    return hw * (1 - 0.07 * e * e);
  };
  // Stationen: dichter an Front und Heck (Knautschzonen)
  const st: number[] = [];
  const N = 18;
  for (let i = 0; i <= N; i++) { const u = i / N; st.push(Z(0.5 - 0.5 * Math.cos(u * Math.PI) * 0.15 + (u - 0.5) * 0.85 + 0.0)); }
  st.sort((a, b2) => a - b2);
  st[0] = -L / 2; st[N] = L / 2;
  const crown = 0.04;

  // Ring je Station: [x, y] (y über Boden), 9 Punkte, offene Unterseite wird extra geschlossen
  const ring = (z: number, top: number) => {
    const w = halfW(z), sill = s.sillY, sh = shoulder(z);
    const floorTop = s.bed && (z + L / 2) / L < s.cab[0] - 0.02 ? sill + 0.42 : sh + crown;
    const mid = s.bed && (z + L / 2) / L < s.cab[0] - 0.02 ? sill + 0.42 : sh + crown * 1.3 + top;
    return [
      [w * 0.93, sill], [w, sill + (sh - sill) * 0.45], [w * 0.98, sh],
      [w * 0.55, floorTop], [0, mid], [-w * 0.55, floorTop],
      [-w * 0.98, sh], [-w, sill + (sh - sill) * 0.45], [-w * 0.93, sill],
    ];
  };
  const isHood = (z: number) => z > c3 + 0.05 && z < L / 2 - 0.12;
  const isTrunk = (z: number) => !s.hatch && !s.bed && !s.box && z < c0 - 0.05 && z > -L / 2 + 0.12;
  const isDoor = (z: number) => z > c0 + 0.1 && z < c3 - 0.05;
  const scoop = (z: number) => (s.scoop && z > c3 + 0.4 && z < c3 + 1.1 ? 0.08 : 0);
  const rings = st.map((z) => ring(z, scoop(z)));
  const P = (i: number, k: number) => [rings[i][k][0], rings[i][k][1] + g0, st[i]];

  const bodyStart = b.count;
  const underHood: Range = { start: 0, count: 0 }, underTrunk: Range = { start: 0, count: 0 };
  const underDoorL: Range = { start: 0, count: 0 }, underDoorR: Range = { start: 0, count: 0 };
  // Seiten und Oberseite
  for (let i = 0; i < N; i++) {
    const zm = (st[i] + st[i + 1]) / 2;
    for (let k = 0; k < 8; k++) {
      const topSeg = k >= 2 && k <= 5;
      let color = paint;
      if (s.stripes !== undefined && s.stripes && (k === 3 || k === 4)) color = s.stripes;
      const start = b.count;
      // Reihenfolge so, dass die Fläche nach außen zeigt (Ring läuft links -> oben -> rechts)
      b.quad(P(i, k), P(i, k + 1), P(i + 1, k + 1), P(i + 1, k), color, SHINE.paint);
      const r: Range = { start, count: 6 };
      if (topSeg && isHood(zm)) extend(underHood, r);
      if (topSeg && isTrunk(zm)) extend(underTrunk, r);
      if (!topSeg && isDoor(zm)) extend(k < 2 ? underDoorL : underDoorR, r);
    }
    // Unterboden
    b.quad(P(i, 8), P(i, 0), P(i + 1, 0), P(i + 1, 8), CHASSIS, SHINE.rubber);
  }
  // Front- und Heckfläche (Fächer)
  for (const [i, front] of [[N, true], [0, false]] as [number, boolean][]) {
    const cx = 0, cy = rings[i].reduce((a, q) => a + q[1], 0) / 9 + g0;
    for (let k = 0; k < 9; k++) {
      const a = P(i, k), c = P(i, (k + 1) % 9), m = [cx, cy, st[i]];
      const grille = front && cy - g0 < s.hoodY;
      if (front) b.tri(a, c, m, grille && k !== 3 && k !== 4 ? PLASTIC : paint, SHINE.paint);
      else b.tri(c, a, m, paint, SHINE.paint);
    }
  }
  // Lkw-Koffer
  if (s.box) {
    const z0 = Z(s.box[0]) + 0.05, z1 = Z(s.box[1]);
    b.box(-hw * 1.02, hw * 1.02, s.deckY + g0, s.box[2] + g0, z0, z1, [4, 5, 7], 0xf4f1e8, SHINE.paint);
  }
  const bodyEnd = b.count;

  // ---- Fahrgastzelle
  const cabSt: { z: number; y: number; w: number }[] = [
    { z: c0, y: shoulder(c0), w: halfW(c0) * 0.95 },
    { z: c1, y: s.roofY, w: hw * s.roofW },
    { z: c1 + (c2 - c1) / 3, y: s.roofY + 0.02, w: hw * s.roofW },
    { z: c1 + (c2 - c1) * 2 / 3, y: s.roofY + 0.02, w: hw * s.roofW },
    { z: c2, y: s.roofY, w: hw * s.roofW },
    { z: c3, y: shoulder(c3), w: halfW(c3) * 0.95 },
  ];
  const cabRing = (q: { z: number; y: number; w: number }, i: number) => {
    const flat = i === 0 || i === cabSt.length - 1;
    const yb = shoulder(q.z) + g0, yt = q.y + g0;
    const wb = halfW(q.z) * 0.95;
    return flat
      ? [[wb, yb, q.z], [wb * 0.9, yb, q.z], [wb * 0.3, yb, q.z], [-wb * 0.3, yb, q.z], [-wb * 0.9, yb, q.z], [-wb, yb, q.z]]
      : [[wb, yb, q.z], [q.w, yt, q.z], [q.w * 0.33, yt + 0.03, q.z], [-q.w * 0.33, yt + 0.03, q.z], [-q.w, yt, q.z], [-wb, yb, q.z]];
  };
  const cr = cabSt.map(cabRing);
  const glass: Range[][] = [[], [], [], []];
  for (let i = 0; i < cabSt.length - 1; i++) {
    for (let k = 0; k < 5; k++) {
      const side = k === 0 || k === 4;
      let color = paint, sh: number = SHINE.paint, zone = -1;
      if (i === cabSt.length - 2 && !side) { color = GLASS; sh = SHINE.glass; zone = 0; } // Frontscheibe
      else if (i === 0 && !side) { color = GLASS; sh = SHINE.glass; zone = 1; } // Heckscheibe
      else if (side && i > 0 && i < cabSt.length - 2) { color = GLASS; sh = SHINE.glass; zone = k === 0 ? 2 : 3; }
      if (s.taxi && !side && i === 2) color = paint;
      const start = b.count;
      b.quad(cr[i][k], cr[i][k + 1], cr[i + 1][k + 1], cr[i + 1][k], color, sh);
      if (zone >= 0) glass[zone].push({ start, count: 6 });
    }
  }
  // Dach-Extras
  const roofY = s.roofY + g0 + 0.05, roofZ = (c1 + c2) / 2;
  if (s.taxi) b.box(-0.3, 0.3, roofY, roofY + 0.22, roofZ - 0.15, roofZ + 0.15, [1, 1, 1], 0xfff3b0, SHINE.paint);
  if (s.lightbar) {
    b.box(-0.55, -0.05, roofY, roofY + 0.14, roofZ - 0.12, roofZ + 0.12, [1, 1, 1], 0x3a6bff, SHINE.glass);
    b.box(0.05, 0.55, roofY, roofY + 0.14, roofZ - 0.12, roofZ + 0.12, [1, 1, 1], 0xff3a4a, SHINE.glass);
  }
  if (s.spoiler) {
    const zz = -L / 2 + 0.18, yy = s.deckY + g0;
    b.box(-hw * 0.85, hw * 0.85, yy + 0.22, yy + 0.27, zz - 0.15, zz + 0.12, [3, 1, 1], paint, SHINE.paint);
    b.box(hw * 0.6, hw * 0.66, yy, yy + 0.22, zz - 0.05, zz + 0.05, [1, 1, 1], DARK, SHINE.rubber);
    b.box(-hw * 0.66, -hw * 0.6, yy, yy + 0.22, zz - 0.05, zz + 0.05, [1, 1, 1], DARK, SHINE.rubber);
  }
  // Radkästen (dunkle Blenden außen, damit die Räder "in" der Karosserie sitzen)
  const d = derive(p);
  for (const [, wz] of d.wheels) {
    for (const sx of [1, -1]) {
      const x = sx * (hw + 0.005), r = p.wheelRadius + 0.06, yc = g0 + p.wheelRadius;
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
        const pa = [x, yc + Math.sin(a0) * r, wz + Math.cos(a0) * r], pb = [x, yc + Math.sin(a1) * r, wz + Math.cos(a1) * r];
        const ia = [x, yc + Math.sin(a0) * (r - 0.07), wz + Math.cos(a0) * (r - 0.07)], ib = [x, yc + Math.sin(a1) * (r - 0.07), wz + Math.cos(a1) * (r - 0.07)];
        if (sx > 0) b.quad(pb, pa, ia, ib, PLASTIC, SHINE.rubber); else b.quad(pa, pb, ib, ia, PLASTIC, SHINE.rubber);
      }
    }
  }

  // ---- Abtrennbare Teile
  const parts: (PartInfo | null)[] = new Array(PART_COUNT).fill(null);
  const addPart = (part: number, build: () => void, hinge: number[], axis: number[], loose: number, swing: number, under?: Range, underColor?: number) => {
    const start = b.count;
    build();
    parts[part] = { start, count: b.count - start, hinge: new THREE.Vector3(...hinge), axis: new THREE.Vector3(...axis).normalize(), loose, swing, under, underColor };
  };
  const by = s.sillY + g0 + 0.02;
  // Stoßstangen
  addPart(Part.BUMPER_F, () => b.box(-hw * 0.98, hw * 0.98, by, by + 0.24, L / 2 - 0.08, L / 2 + 0.1, [4, 1, 1], s.bumper, s.bumper === CHROME ? SHINE.chrome : SHINE.rubber), [-hw, by + 0.12, L / 2], [0, 0, 1], -0.28, 0.12);
  addPart(Part.BUMPER_R, () => b.box(-hw * 0.98, hw * 0.98, by, by + 0.24, -L / 2 - 0.1, -L / 2 + 0.08, [4, 1, 1], s.bumper, s.bumper === CHROME ? SHINE.chrome : SHINE.rubber), [hw, by + 0.12, -L / 2], [0, 0, 1], 0.28, 0.12);
  // Motorhaube: Platte über den oberen Segmenten im Haubenbereich
  addPart(Part.HOOD, () => panelTop(b, st, rings, g0, isHood, paint, s.stripes, 0.018), [0, shoulder(c3 + 0.1) + g0 + 0.02, c3 + 0.08], [1, 0, 0], -0.35, 0.18, underHood, ENGINE);
  if (s.hatch || s.bed || s.box) {
    // Heckklappe / Bordwand
    const zr = -L / 2 - 0.012, yTop = (s.box ? s.box[2] - 0.1 : shoulder(-L / 2 + 0.01)) + g0;
    addPart(Part.TRUNK, () => b.box(-hw * 0.82, hw * 0.82, by + 0.3, yTop, zr - 0.03, zr, [3, 2, 1], s.box ? 0xe8e4da : paint, SHINE.paint), [0, yTop, zr], [1, 0, 0], 0.5, 0.15);
  } else {
    addPart(Part.TRUNK, () => panelTop(b, st, rings, g0, isTrunk, paint, s.stripes, 0.018), [0, shoulder(c0 - 0.1) + g0 + 0.02, c0 - 0.06], [1, 0, 0], 0.4, 0.15, underTrunk, INTERIOR);
  }
  // Türen (je Seite eine)
  for (const [part, sx] of [[Part.DOOR_L, 1], [Part.DOOR_R, -1]] as [number, number][]) {
    const z0 = c0 + 0.12, z1 = c3 - 0.06;
    addPart(part, () => doorPanel(b, st, rings, g0, z0, z1, sx, paint), [sx * hw, 0, z1], [0, 1, 0], -sx * 0.35, 0.25, sx > 0 ? underDoorL : underDoorR, INTERIOR);
  }
  // Spiegel
  for (const [part, sx] of [[Part.MIRROR_L, 1], [Part.MIRROR_R, -1]] as [number, number][]) {
    const z = c3 - 0.12, y = shoulder(c3) + g0 + 0.08, x0 = sx * (hw + 0.02), x1 = sx * (hw + 0.2);
    addPart(part, () => b.box(Math.min(x0, x1), Math.max(x0, x1), y, y + 0.13, z - 0.06, z + 0.06, [1, 1, 1], paint, SHINE.paint), [x0, y, z], [0, 0, 1], -sx * 0.9, 0.4);
  }
  void bodyStart; void bodyEnd;

  const body = b.geometry();
  computeOutlineNormals(body);

  // ---- Lichter
  const lb = new Builder();
  const lightRanges: Range[] = [];
  const hy = shoulder(L / 2 - 0.05) + g0 - s.noseDrop - 0.12;
  const ty = shoulder(-L / 2 + 0.05) + g0 - s.tailDrop - 0.14;
  const lw = Math.min(0.42, hw * 0.4);
  for (const sx of [1, -1]) {
    const start = lb.count;
    const x = sx * hw * 0.62;
    lb.quad([x - lw / 2, hy, L / 2 + 0.012], [x + lw / 2, hy, L / 2 + 0.012], [x + lw / 2, hy + 0.15, L / 2 + 0.012], [x - lw / 2, hy + 0.15, L / 2 + 0.012], HEAD, 0);
    lightRanges.push({ start, count: 6 });
  }
  for (const sx of [1, -1]) {
    const start = lb.count;
    const x = sx * hw * 0.66, z = -L / 2 - 0.012 - (s.box ? 0.02 : 0);
    const yy = s.box ? g0 + s.sillY + 0.35 : ty;
    lb.quad([x + lw / 2, yy, z], [x - lw / 2, yy, z], [x - lw / 2, yy + 0.14, z], [x + lw / 2, yy + 0.14, z], TAIL, 0);
    lightRanges.push({ start, count: 6 });
  }
  for (const sx of [1, -1]) {
    const start = lb.count;
    const x = sx * hw * 0.3, z = -L / 2 - 0.013 - (s.box ? 0.02 : 0);
    const yy = (s.box ? g0 + s.sillY + 0.35 : ty) + 0.02;
    lb.quad([x + 0.08, yy, z], [x - 0.08, yy, z], [x - 0.08, yy + 0.1, z], [x + 0.08, yy + 0.1, z], 0x555560, 0);
    lightRanges.push({ start, count: 6 });
  }
  const lights = lb.geometry();

  return {
    body, lights, parts, glass, lightRanges,
    wheels: d.wheels.map(([x, z]) => ({ x, z, r: p.wheelRadius, w: Math.min(0.32, p.wheelRadius * 0.75) })),
    wheelBaseY: d.mountY - d.rest,
    engine: new THREE.Vector3(0, s.hoodY + g0 + 0.1, s.box ? L / 2 - 0.6 : c3 + (L / 2 - c3) * 0.5),
    exhaust: [new THREE.Vector3(hw * 0.5, s.sillY + g0 + 0.05, -L / 2 - 0.1), ...(p.cylinders >= 8 ? [new THREE.Vector3(-hw * 0.5, s.sillY + g0 + 0.05, -L / 2 - 0.1)] : [])],
    seatY: 0,
    cell: [c0, c3, s.sillY + g0 + 0.1],
    bike: false,
  };
}


// ------------------------------------------------------------------ Kenney Car Kit
/** Modelle mit Originallackierung (Einsatzfahrzeuge, Taxi). */
const KIT_FIXED_PAINT = new Set<string>(['ck-police', 'ck-taxi', 'ck-ambulance', 'ck-firetruck', 'ck-garbage-truck']);
/** Ersatzform je Klasse, falls die Kit-Datei fehlt. */
const KIT_FALLBACK: Record<string, string> = { sport: 'proc_sport', suv: 'truck_red', truck: 'proc_boxtruck', muscle: 'proc_muscle', compact: 'car_hatchback' };

function rgbOf(hex: number) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }

/** Farbton (0–360) oder -1 für Grau/Schwarz/Weiß. */
function hueOf(hex: number): number {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 60 || max - min < 50) return -1;
  const h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return ((h * 60) % 360 + 360) % 360;
}

/** Kit-Scheiben: hell, leicht bläulich, wenig gesättigt (Kenney: ~#cfe6f5). */
function isKitGlass(hex: number) {
  const [r, g, b] = rgbOf(hex);
  return b > 170 && b >= g && b >= r + 12 && r > 120;
}

/**
 * Car-Kit-Modell als Schadens-Vorlage: Geometrie auf das Fahrzeugprofil skaliert, lange Kanten
 * unterteilt (damit Beulen weich ausfallen), Lackfläche umgefärbt, Scheiben je Seite erfasst
 * (für Sprünge/Bruch) und Lichter als eigene Geometrie. Abtrennbare Teile gibt es hier nicht.
 */
function buildKitCar(p: HandlingProfile, name: ModelName, paint: number | null): CarTemplate {
  const m = getModel(name)!;
  const L = p.length, hw = p.width / 2;
  const g0 = groundLocal(p);
  const sx = p.width / m.size.x, sz = L / m.size.z;
  const sy = (sx + sz) / 2 * 0.92; // Kenney-Autos sind etwas "spielzeughoch"
  const H = m.size.y * sy;

  // Lackfläche: stärkster Farbton nach Fläche (±28°)
  const pos = m.body.getAttribute('position');
  const tri = m.triColors;
  const bins = new Float32Array(36), hues = new Float32Array(tri.length), area = new Float32Array(tri.length);
  const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < tri.length; t++) {
    a.fromBufferAttribute(pos, t * 3); bb.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
    area[t] = bb.sub(a).cross(c.sub(a)).length();
    hues[t] = isKitGlass(tri[t]) ? -1 : hueOf(tri[t]);
    if (hues[t] >= 0) bins[Math.floor(hues[t] / 10) % 36] += area[t];
  }
  let best = 0;
  for (let k = 1; k < 36; k++) if (bins[k] > bins[best]) best = k;
  let refLum = 0, refA = 0;
  const isPaint = (t: number) => { if (hues[t] < 0) return false; const d = Math.abs(hues[t] - (best * 10 + 5)); return Math.min(d, 360 - d) <= 28; };
  for (let t = 0; t < tri.length; t++) if (isPaint(t)) { const [r, g, b2] = rgbOf(tri[t]); refLum += area[t] * (r + g + b2) / 3; refA += area[t]; }
  refLum = refA ? refLum / refA : 128;
  const [pr, pg, pb] = paint === null ? [0, 0, 0] : rgbOf(paint);

  const b = new Builder();
  const glass: Range[][] = [[], [], [], []];
  const P = (i: number) => [pos.getX(i) * sx, pos.getY(i) * sy + g0, pos.getZ(i) * sz];
  const MAX_EDGE = 0.55;
  /** Dreieck rekursiv unterteilen, bis keine Kante länger als MAX_EDGE ist. */
  const emit = (v0: number[], v1: number[], v2: number[], color: number, shine: number, depth: number) => {
    const d01 = Math.hypot(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]);
    const d12 = Math.hypot(v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]);
    const d20 = Math.hypot(v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]);
    const mx = Math.max(d01, d12, d20);
    if (mx <= MAX_EDGE || depth > 4) { b.tri(v0, v1, v2, color, shine); return; }
    const mid = (p0: number[], p1: number[]) => [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    if (mx === d01) { const mm = mid(v0, v1); emit(v0, mm, v2, color, shine, depth + 1); emit(mm, v1, v2, color, shine, depth + 1); }
    else if (mx === d12) { const mm = mid(v1, v2); emit(v0, v1, mm, color, shine, depth + 1); emit(v0, mm, v2, color, shine, depth + 1); }
    else { const mm = mid(v2, v0); emit(v0, v1, mm, color, shine, depth + 1); emit(mm, v1, v2, color, shine, depth + 1); }
  };
  const n = new THREE.Vector3();
  for (let t = 0; t < tri.length; t++) {
    const v0 = P(t * 3), v1 = P(t * 3 + 1), v2 = P(t * 3 + 2);
    // Entartete Dreiecke (Fläche 0) weglassen: ihre Normale ist 0 – zieht eine Beule sie auf,
    // liefert der Shader NaN, und der Bloom verteilt das schwarze Pixel übers ganze Bild
    if (area[t] < 1e-7) continue;
    const hex = tri[t];
    let color: number, shine: number, zone = -1;
    if (isKitGlass(hex)) {
      color = GLASS; shine = SHINE.glass;
      n.set(v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]).cross(a.set(v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]));
      // Seite nach der dominanten horizontalen Normalen
      zone = Math.abs(n.z) >= Math.abs(n.x) ? (n.z > 0 ? 0 : 1) : (n.x > 0 ? 2 : 3);
    } else if (paint !== null && isPaint(t)) {
      const [r, g, b2] = rgbOf(hex);
      const k = Math.min(1.35, ((r + g + b2) / 3) / refLum);
      const ch = (v: number) => Math.min(255, Math.round(v * k));
      color = (ch(pr) << 16) | (ch(pg) << 8) | ch(pb); shine = SHINE.paint;
    } else {
      color = palmaraize(hex);
      const [r, g, b2] = rgbOf(hex);
      const max = Math.max(r, g, b2), min = Math.min(r, g, b2);
      shine = max < 70 ? SHINE.rubber : max - min < 24 && max > 170 ? SHINE.chrome : SHINE.paint;
    }
    const start = b.count;
    emit(v0, v1, v2, color, shine, 0);
    if (zone >= 0) glass[zone].push({ start, count: b.count - start });
  }
  const body = b.geometry();
  computeOutlineNormals(body);

  // Lichter: Scheinwerfer vorne, Rück- und Rückfahrlichter hinten (wie bei den prozeduralen Autos)
  const lb = new Builder();
  const lightRanges: Range[] = [];
  const hy = g0 + H * 0.36, ty = g0 + H * 0.4, lw = Math.min(0.42, hw * 0.4);
  const zf = L / 2 + 0.015, zr = -L / 2 - 0.015;
  for (const s of [1, -1]) {
    const start = lb.count, x = s * hw * 0.6;
    lb.quad([x - lw / 2, hy, zf], [x + lw / 2, hy, zf], [x + lw / 2, hy + 0.15, zf], [x - lw / 2, hy + 0.15, zf], HEAD, 0);
    lightRanges.push({ start, count: 6 });
  }
  for (const s of [1, -1]) {
    const start = lb.count, x = s * hw * 0.64;
    lb.quad([x + lw / 2, ty, zr], [x - lw / 2, ty, zr], [x - lw / 2, ty + 0.14, zr], [x + lw / 2, ty + 0.14, zr], TAIL, 0);
    lightRanges.push({ start, count: 6 });
  }
  for (const s of [1, -1]) {
    const start = lb.count, x = s * hw * 0.3;
    lb.quad([x + 0.08, ty + 0.02, zr - 0.001], [x - 0.08, ty + 0.02, zr - 0.001], [x - 0.08, ty + 0.12, zr - 0.001], [x + 0.08, ty + 0.12, zr - 0.001], 0x555560, 0);
    lightRanges.push({ start, count: 6 });
  }
  const d = derive(p);
  return {
    body, lights: lb.geometry(), parts: new Array(PART_COUNT).fill(null), glass, lightRanges,
    wheels: d.wheels.map(([x, z]) => ({ x, z, r: p.wheelRadius, w: Math.min(0.32, p.wheelRadius * 0.75) })),
    wheelBaseY: d.mountY - d.rest,
    engine: new THREE.Vector3(0, g0 + H * 0.55, L * 0.32),
    exhaust: [new THREE.Vector3(hw * 0.5, g0 + 0.3, -L / 2 - 0.1)],
    seatY: 0,
    cell: [-L * 0.22, L * 0.18, g0 + 0.4],
    bike: false,
  };
}

function extend(r: Range, add: Range) {
  if (!r.count) { r.start = add.start; r.count = add.count; return; }
  // Bereiche sind zusammenhängend in Bau-Reihenfolge nicht garantiert -> Liste über Hilfs-Array
  (r as Range & { list?: Range[] }).list ??= [{ start: r.start, count: r.count }];
  (r as Range & { list?: Range[] }).list!.push(add);
}

/** Platte (Haube/Deckel) auf den oberen Segmenten der Stationen, die cond erfüllen. */
function panelTop(b: Builder, st: number[], rings: number[][][], g0: number, cond: (z: number) => boolean, paint: number, stripes: number | undefined, lift: number) {
  for (let i = 0; i < st.length - 1; i++) {
    const zm = (st[i] + st[i + 1]) / 2;
    if (!cond(zm)) continue;
    for (let k = 2; k <= 5; k++) {
      const P = (ii: number, kk: number) => [rings[ii][kk][0] * 0.99, rings[ii][kk][1] + g0 + lift, st[ii]];
      const color = stripes && (k === 3 || k === 4) ? stripes : paint;
      b.quad(P(i, k), P(i, k + 1), P(i + 1, k + 1), P(i + 1, k), color, SHINE.paint);
    }
  }
}

/** Türblatt: Seitensegmente 0..1 (links) bzw. 6..8 (rechts) im z-Bereich, leicht nach außen versetzt. */
function doorPanel(b: Builder, st: number[], rings: number[][][], g0: number, z0: number, z1: number, sx: number, paint: number) {
  const ks = sx > 0 ? [0, 1] : [6, 7];
  for (let i = 0; i < st.length - 1; i++) {
    const zm = (st[i] + st[i + 1]) / 2;
    if (zm < z0 || zm > z1) continue;
    for (const k of ks) {
      const P = (ii: number, kk: number) => [rings[ii][kk][0] + sx * 0.016, rings[ii][kk][1] + g0, st[ii]];
      b.quad(P(i, k), P(i, k + 1), P(i + 1, k + 1), P(i + 1, k), paint, SHINE.paint);
    }
  }
  // Türgriff
  const zz = z1 - 0.25, x = sx * (Math.abs(rings[0][1][0]) + 0.03);
  void zz; void x;
}

// ------------------------------------------------------------------ Motorrad
function buildBike(p: HandlingProfile, paint: number): CarTemplate {
  const b = new Builder();
  const g0 = groundLocal(p), r = p.wheelRadius;
  const yb = g0 + r;
  b.box(-0.2, 0.2, yb - 0.05, yb + 0.35, -0.35, 0.45, [1, 2, 3], paint, SHINE.paint); // Tank/Rahmen
  b.box(-0.17, 0.17, yb + 0.3, yb + 0.42, -0.75, -0.15, [1, 1, 2], 0x222222, SHINE.rubber); // Sitz
  b.box(-0.14, 0.14, yb - 0.12, yb + 0.12, -0.2, 0.25, [1, 1, 1], ENGINE, SHINE.chrome); // Motor
  b.box(-0.45, 0.45, yb + 0.62, yb + 0.68, 0.5, 0.56, [2, 1, 1], CHROME, SHINE.chrome); // Lenker
  b.box(-0.04, 0.04, yb, yb + 0.65, 0.58, 0.64, [1, 2, 1], CHROME, SHINE.chrome); // Gabel
  b.box(-0.12, 0.12, yb + 0.12, yb + 0.22, -0.95, -0.55, [1, 1, 1], paint, SHINE.paint); // Heck
  b.box(0.12, 0.2, yb - 0.1, yb - 0.02, -0.85, -0.2, [1, 1, 2], CHROME, SHINE.chrome); // Auspuff
  const body = b.geometry();
  computeOutlineNormals(body);
  const lb = new Builder();
  const ranges: Range[] = [];
  let st = lb.count;
  lb.quad([-0.08, yb + 0.42, 0.72], [0.08, yb + 0.42, 0.72], [0.08, yb + 0.54, 0.72], [-0.08, yb + 0.54, 0.72], HEAD, 0); ranges.push({ start: st, count: 6 });
  ranges.push({ start: st, count: 0 });
  st = lb.count;
  lb.quad([0.07, yb + 0.16, -0.96], [-0.07, yb + 0.16, -0.96], [-0.07, yb + 0.24, -0.96], [0.07, yb + 0.24, -0.96], TAIL, 0); ranges.push({ start: st, count: 6 });
  ranges.push({ start: st, count: 0 }, { start: st, count: 0 }, { start: st, count: 0 });
  const d = derive(p);
  const zf = d.wheels[0][1], zr = d.wheels[2][1];
  return {
    body, lights: lb.geometry(), parts: new Array(PART_COUNT).fill(null), glass: [[], [], [], []], lightRanges: ranges,
    wheels: [{ x: 0, z: zf, r, w: 0.16 }, { x: 0, z: zf, r, w: 0 }, { x: 0, z: zr, r, w: 0.2 }, { x: 0, z: zr, r, w: 0 }],
    wheelBaseY: d.mountY - d.rest,
    engine: new THREE.Vector3(0, yb, 0), exhaust: [new THREE.Vector3(0.16, yb - 0.06, -0.9)], seatY: yb + 0.36 - g0,
    cell: [0, 0, 99], bike: true,
  };
}

/** Panzer der Fahndungsstufe 4: Ketten, Wanne, Turm mit Rohr, Blaulicht auf dem Turm. */
function buildTank(p: HandlingProfile): CarTemplate {
  const b = new Builder();
  const g0 = groundLocal(p), L = p.length, hw = p.width / 2;
  const OLIVE = 0x4f5a36, OLIVE_D = 0x3c4529, TRACK = 0x26262a;
  // Ketten
  for (const sx of [1, -1]) {
    const x0 = sx > 0 ? hw - 0.6 : -hw, x1 = sx > 0 ? hw : -hw + 0.6;
    b.box(x0, x1, g0, g0 + 0.95, -L / 2, L / 2, [1, 2, 6], TRACK, SHINE.rubber);
    b.box(x0 - 0.02, x1 + 0.02, g0 + 0.95, g0 + 1.05, -L / 2 + 0.1, L / 2 - 0.1, [1, 1, 4], OLIVE_D, SHINE.paint); // Kettenblech
  }
  // Wanne mit Bugschräge
  b.box(-hw + 0.55, hw - 0.55, g0 + 0.35, g0 + 1.35, -L / 2 + 0.25, L / 2 - 0.9, [2, 2, 5], OLIVE, SHINE.paint);
  b.quad([hw - 0.55, g0 + 1.35, L / 2 - 0.9], [-hw + 0.55, g0 + 1.35, L / 2 - 0.9], [-hw + 0.55, g0 + 0.45, L / 2 - 0.2], [hw - 0.55, g0 + 0.45, L / 2 - 0.2], OLIVE, SHINE.paint);
  // Turm + Rohr
  const ty = g0 + 1.35;
  b.box(-1.15, 1.15, ty, ty + 0.75, -1.7, 0.7, [2, 1, 3], OLIVE_D, SHINE.paint);
  b.box(-0.55, 0.55, ty + 0.75, ty + 0.95, -1.2, -0.2, [1, 1, 1], OLIVE, SHINE.paint); // Luke
  b.box(-0.13, 0.13, ty + 0.25, ty + 0.5, 0.7, L / 2 + 1.1, [1, 1, 4], TRACK, SHINE.chrome);
  b.box(-0.18, 0.18, ty + 0.2, ty + 0.55, L / 2 + 0.8, L / 2 + 1.15, [1, 1, 1], TRACK, SHINE.chrome); // Mündungsbremse
  // Polizei-Kennung: Streifen + Blaulicht
  b.box(-1.17, 1.17, ty + 0.3, ty + 0.45, -1.72, 0.72, [2, 1, 3], 0x2850c8, SHINE.paint);
  b.box(-0.45, -0.05, ty + 0.95, ty + 1.1, -0.8, -0.6, [1, 1, 1], 0x3a6bff, SHINE.glass);
  b.box(0.05, 0.45, ty + 0.95, ty + 1.1, -0.8, -0.6, [1, 1, 1], 0xff3a4a, SHINE.glass);
  const body = b.geometry();
  computeOutlineNormals(body);
  // Lichter: 0 VL, 1 VR, 2 HL, 3 HR, 4/5 Rückfahrlicht (leer)
  const lb = new Builder();
  const ranges: Range[] = [];
  const zf = L / 2 - 0.19, zr = -L / 2 + 0.24, yl = g0 + 1.0;
  for (const sx of [1, -1]) {
    const st = lb.count, x = sx * (hw - 0.8);
    lb.quad([x - 0.18, yl, zf], [x + 0.18, yl, zf], [x + 0.18, yl + 0.16, zf], [x - 0.18, yl + 0.16, zf], HEAD, 0);
    ranges.push({ start: st, count: 6 });
  }
  for (const sx of [1, -1]) {
    const st = lb.count, x = sx * (hw - 0.8);
    lb.quad([x + 0.15, yl, zr], [x - 0.15, yl, zr], [x - 0.15, yl + 0.12, zr], [x + 0.15, yl + 0.12, zr], TAIL, 0);
    ranges.push({ start: st, count: 6 });
  }
  ranges.push({ start: lb.count, count: 0 }, { start: lb.count, count: 0 });
  const d = derive(p);
  return {
    body, lights: lb.geometry(), parts: new Array(PART_COUNT).fill(null), glass: [[], [], [], []], lightRanges: ranges,
    // Laufrollen stecken in den Ketten (unsichtbar, w = 0)
    wheels: d.wheels.map(([x, z]) => ({ x, z, r: p.wheelRadius, w: 0 })),
    wheelBaseY: d.mountY - d.rest,
    engine: new THREE.Vector3(0, g0 + 1.2, -L / 2 + 1), exhaust: [new THREE.Vector3(hw - 0.7, g0 + 1.1, -L / 2 + 0.1)], seatY: 0,
    cell: [-L / 2, L / 2, g0 + 0.3], bike: false,
  };
}

// ------------------------------------------------------------------ Instanz mit Schaden
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();

/** Hash für deterministisches "Knittern" (nur von der Vertex-Position abhängig). */
function jitter(x: number, y: number, z: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) - 0.5;
}

export interface DebrisSpawn { geo: THREE.BufferGeometry; matrix: THREE.Matrix4; part: number }

export class CarModel {
  readonly root = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly lights: THREE.Mesh;
  readonly tpl: CarTemplate;
  private ownGeo = false;
  private ownLights = false;
  /** Unverformte Positionen + aufsummierter Versatz je Vertex */
  private base: Float32Array;
  private offset: Float32Array | null = null;
  private lightBase: Float32Array;
  private lightOffset: Float32Array | null = null;
  private partState = new Array(PART_COUNT).fill(0);
  private glassState = 0;
  private lightBroken = 0;
  private lightKey = '';
  private wreck = 0;
  private time = Math.random() * 10;
  dents = 0;

  constructor(readonly variant: number, readonly colorIdx: number, bodyMat: THREE.Material, lightMat: THREE.Material) {
    this.tpl = carTemplate(variant, colorIdx);
    this.body = new THREE.Mesh(this.tpl.body, bodyMat);
    this.lights = new THREE.Mesh(this.tpl.lights, lightMat);
    this.root.add(this.body, this.lights);
    this.base = this.tpl.body.getAttribute('position').array as Float32Array;
    this.lightBase = this.tpl.lights.getAttribute('position').array as Float32Array;
  }

  /** Eigene Geometrie anlegen (erst bei Schaden – unbeschädigte Autos teilen sich die Vorlage). */
  private own() {
    if (this.ownGeo) return;
    const g = this.tpl.body.clone();
    g.setAttribute('position', this.tpl.body.getAttribute('position').clone());
    g.setAttribute('color', this.tpl.body.getAttribute('color').clone());
    this.body.geometry = g;
    this.ownGeo = true;
    this.offset = new Float32Array(this.base.length);
  }
  private ownL() {
    if (this.ownLights) return;
    const g = this.tpl.lights.clone();
    g.setAttribute('position', this.tpl.lights.getAttribute('position').clone());
    g.setAttribute('color', this.tpl.lights.getAttribute('color').clone());
    this.lights.geometry = g;
    this.ownLights = true;
    this.lightOffset = new Float32Array(this.lightBase.length);
  }

  /**
   * Beule: Kontaktpunkt (lokal), Richtung (in die Karosserie, lokal), Stärke 0..1.
   * Deterministisch: nur Vorlage + Beulenliste gehen ein.
   */
  applyDent(d: number[]) {
    if (this.tpl.bike) return;
    this.own(); this.ownL();
    const [cx, cy, cz, dx, dy, dz, s] = d;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;
    const R = 0.55 + s * 0.95;
    const depth = 0.06 + s * 0.38;
    const [cell0, cell1, cellY] = this.tpl.cell;
    const deform = (base: Float32Array, off: Float32Array) => {
      for (let i = 0; i < base.length; i += 3) {
        const px = base[i] + off[i], py = base[i + 1] + off[i + 1], pz = base[i + 2] + off[i + 2];
        const ex = px - cx, ey = py - cy, ez = pz - cz;
        const dist = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (dist >= R) continue;
        const f = (1 - dist / R) ** 2;
        const j = jitter(base[i], base[i + 1], base[i + 2]) * 0.5 * f * s;
        let ox = off[i] + nx * depth * f + j * 0.12, oy = off[i + 1] + ny * depth * f + j * 0.08, oz = off[i + 2] + nz * depth * f - j * 0.1;
        // Fahrgastzelle geschützt, Knautschzonen dürfen tief
        const inCell = base[i + 2] > cell0 && base[i + 2] < cell1 && base[i + 1] > cellY;
        const max = inCell ? 0.11 : 0.48;
        const m = Math.hypot(ox, oy, oz);
        if (m > max) { ox *= max / m; oy *= max / m; oz *= max / m; }
        off[i] = ox; off[i + 1] = oy; off[i + 2] = oz;
      }
    };
    deform(this.base, this.offset!);
    deform(this.lightBase, this.lightOffset!);
    this.dents++;
    this.writePositions();
  }

  /** Positionen = Vorlage + Beulen (+ Teile-Animation in update) */
  private writePositions() {
    if (!this.ownGeo) return;
    const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array, off = this.offset!;
    for (let i = 0; i < arr.length; i++) arr[i] = this.base[i] + off[i];
    // abgefallene Teile: auf einen Punkt zusammenfalten (unsichtbar)
    this.tpl.parts.forEach((pi, k) => {
      if (!pi || this.partState[k] < 2) return;
      for (let v = pi.start * 3; v < (pi.start + pi.count) * 3; v++) arr[v] = 0;
    });
    pos.needsUpdate = true;
    this.body.geometry.computeVertexNormals();
    if (this.ownLights) {
      const lp = this.lights.geometry.getAttribute('position') as THREE.BufferAttribute;
      const la = lp.array as Float32Array, lo = this.lightOffset!;
      for (let i = 0; i < la.length; i++) la[i] = this.lightBase[i] + lo[i];
      this.tpl.lightRanges.forEach((r, k) => {
        if (k < 4 && this.lightBroken & (1 << k)) for (let v = r.start * 3; v < (r.start + r.count) * 3; v++) la[v] = 0;
      });
      lp.needsUpdate = true;
    }
  }

  /** Alle Beulen und Teile zurücksetzen (Werkstatt). */
  resetDamage() {
    if (this.ownGeo) { this.body.geometry.dispose(); this.body.geometry = this.tpl.body; this.ownGeo = false; this.offset = null; }
    if (this.ownLights) { this.lights.geometry.dispose(); this.lights.geometry = this.tpl.lights; this.ownLights = false; this.lightOffset = null; }
    this.partState.fill(0); this.glassState = 0; this.lightBroken = 0; this.wreck = 0; this.dents = 0; this.lightKey = '';
  }

  /**
   * Schadenszustand übernehmen. Gibt Teile zurück, die gerade abgefallen sind (für Trümmer).
   * spawnDebris = false: beim ersten Sichtkontakt keine Trümmer erzeugen.
   */
  setDamage(parts: number, glass: number, lights: number, wreck: number, spawnDebris: boolean): DebrisSpawn[] {
    if (this.tpl.bike) return [];
    const out: DebrisSpawn[] = [];
    let dirty = false;
    for (let k = 0; k < PART_COUNT; k++) {
      const st = (parts >> (k * 2)) & 3;
      if (st === this.partState[k]) continue;
      const pi = this.tpl.parts[k];
      this.own();
      if (st === 2 && pi && spawnDebris) out.push({ geo: this.extractPart(pi), matrix: this.body.matrixWorld.clone(), part: k });
      this.partState[k] = st;
      if (pi?.under && st === 2) this.recolor(pi.under, pi.underColor ?? INTERIOR);
      dirty = true;
    }
    if (glass !== this.glassState) {
      this.own();
      for (let z = 0; z < 4; z++) if (glass & (1 << z) && !(this.glassState & (1 << z))) this.crackGlass(z);
      this.glassState = glass;
    }
    if (lights !== this.lightBroken) { this.ownL(); this.lightBroken = lights; dirty = true; }
    if (wreck && !this.wreck) { this.own(); this.char(); this.wreck = 1; }
    if (dirty) this.writePositions();
    return out;
  }

  /** Teil als eigene Geometrie herauslösen (Trümmer), zentriert auf seinen Schwerpunkt. */
  private extractPart(pi: PartInfo): THREE.BufferGeometry {
    const src = this.body.geometry;
    const pos = src.getAttribute('position') as THREE.BufferAttribute, col = src.getAttribute('color') as THREE.BufferAttribute;
    const n = pi.count;
    const p = new Float32Array(n * 3), c = new Float32Array(n * 3), sh = new Float32Array(n);
    const cen = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const v = pi.start + i;
      p[i * 3] = this.base[v * 3] + this.offset![v * 3]; p[i * 3 + 1] = this.base[v * 3 + 1] + this.offset![v * 3 + 1]; p[i * 3 + 2] = this.base[v * 3 + 2] + this.offset![v * 3 + 2];
      c[i * 3] = col.getX(v); c[i * 3 + 1] = col.getY(v); c[i * 3 + 2] = col.getZ(v);
      sh[i] = 0.9;
      cen.x += p[i * 3]; cen.y += p[i * 3 + 1]; cen.z += p[i * 3 + 2];
    }
    void pos;
    cen.divideScalar(Math.max(1, n));
    for (let i = 0; i < n; i++) { p[i * 3] -= cen.x; p[i * 3 + 1] -= cen.y; p[i * 3 + 2] -= cen.z; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.setAttribute('shine', new THREE.BufferAttribute(sh, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.userData.center = cen;
    computeOutlineNormals(g);
    return g;
  }

  private recolor(r: Range & { list?: Range[] }, color: number) {
    const col = this.body.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = new THREE.Color(color);
    for (const rr of r.list ?? [r]) for (let v = rr.start; v < rr.start + rr.count; v++) col.setXYZ(v, c.r, c.g, c.b);
    col.needsUpdate = true;
  }

  /** Scheibe splittert: Dreiecke abwechselnd hell/dunkel (Sprung-Muster). */
  private crackGlass(zone: number) {
    const col = this.body.geometry.getAttribute('color') as THREE.BufferAttribute;
    const a = new THREE.Color(CRACK_A), bb = new THREE.Color(CRACK_B);
    for (const r of this.tpl.glass[zone]) {
      for (let t = 0; t < r.count / 3; t++) {
        const c = (t + r.start) % 2 ? a : bb;
        for (let k = 0; k < 3; k++) col.setXYZ(r.start + t * 3 + k, c.r, c.g, c.b);
      }
    }
    col.needsUpdate = true;
  }

  /** Ausgebrannt: alles dunkel verkohlt. */
  private char() {
    const col = this.body.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let v = 0; v < col.count; v++) {
      const l = (col.getX(v) + col.getY(v) + col.getZ(v)) / 3;
      const k = 0.08 + l * 0.12;
      col.setXYZ(v, k, k * 0.9, k * 0.85);
    }
    col.needsUpdate = true;
  }

  /**
   * Pro Frame: wackelnde Teile animieren, Lichter schalten.
   * lat = Querbeschleunigung (m/s²), speed in m/s.
   */
  update(dt: number, speed: number, lat: number, lightsOn: boolean, brake: boolean, reverse: boolean) {
    this.time += dt;
    if (this.ownGeo && this.partState.some((s, k) => s === 1 && this.tpl.parts[k])) {
      const pos = this.body.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array, off = this.offset!;
      this.tpl.parts.forEach((pi, k) => {
        if (!pi || this.partState[k] !== 1) return;
        const ang = pi.loose + pi.swing * Math.sin(this.time * (6 + speed * 0.4) + k) * Math.min(1, 0.3 + speed / 15) + lat * 0.01 * Math.sign(pi.loose);
        tmpQ.setFromAxisAngle(pi.axis, ang);
        tmpM.makeRotationFromQuaternion(tmpQ);
        for (let v = pi.start; v < pi.start + pi.count; v++) {
          tmpV.set(this.base[v * 3] + off[v * 3] - pi.hinge.x, this.base[v * 3 + 1] + off[v * 3 + 1] - pi.hinge.y, this.base[v * 3 + 2] + off[v * 3 + 2] - pi.hinge.z).applyMatrix4(tmpM);
          arr[v * 3] = tmpV.x + pi.hinge.x; arr[v * 3 + 1] = tmpV.y + pi.hinge.y; arr[v * 3 + 2] = tmpV.z + pi.hinge.z;
        }
      });
      pos.needsUpdate = true;
    }
    // Lichter: Scheinwerfer an/aus, Bremslicht hell, Rückfahrlicht weiß
    const key = `${lightsOn ? 1 : 0}${brake ? 1 : 0}${reverse ? 1 : 0}${this.wreck}`;
    if (key !== this.lightKey) {
      this.lightKey = key;
      this.ownL();
      const col = this.lights.geometry.getAttribute('color') as THREE.BufferAttribute;
      const set = (r: Range, hex: number, k: number) => { const c = new THREE.Color(hex).multiplyScalar(k); for (let v = r.start; v < r.start + r.count; v++) col.setXYZ(v, c.r, c.g, c.b); };
      const lr = this.tpl.lightRanges;
      const dead = this.wreck ? 0.15 : 1;
      set(lr[0], HEAD, (lightsOn ? 1.6 : 0.55) * dead); set(lr[1], HEAD, (lightsOn ? 1.6 : 0.55) * dead);
      const tail = brake ? 2.2 : lightsOn ? 0.9 : 0.45;
      set(lr[2], TAIL, tail * dead); set(lr[3], TAIL, tail * dead);
      if (lr[4]) set(lr[4], reverse ? REV : 0x55555f, reverse ? 1.8 : 0.6);
      if (lr[5]) set(lr[5], reverse ? REV : 0x55555f, reverse ? 1.8 : 0.6);
      col.needsUpdate = true;
    }
  }

  dispose() {
    if (this.ownGeo) this.body.geometry.dispose();
    if (this.ownLights) this.lights.geometry.dispose();
  }
}
