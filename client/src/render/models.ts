// Low-Poly-Modelle: Figuren, Fahrzeuge, Bäume. Autos und Motorrad kommen aus den
// CC0-Kits (assets.ts), alles andere – und der Ersatz bei fehlenden Dateien – ist prozedural.
// Alle Modelle schauen entlang +z (passt zu "vorwärts = (sin a, cos a)").
import * as THREE from 'three';
import { OUTFIT_COLORS, VEHICLE_COLORS } from '../../../shared/src/constants';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import { TreeType } from '../../../shared/src/world/WorldMap';
import { getModel, triangleColors, type BakedModel, type ModelName } from './assets';
import { box, cyl, ico, merge } from './geom';
import { addHeightWind, addOutline, computeOutlineNormals, LINE, toonMaterial } from './materials/toon';
import { isGlass, palmaraize } from './palette';

/** Toon-Material mit Vertex-Farben (Figuren, Deko). */
export const toonVC = toonMaterial({ vertexColors: true });
/** Fahrzeuglack: hartes Toon-Glanzlicht, Stärke pro Vertex (Attribut `shine`: Lack, Chrom, Gummi, Glas). */
export const vehicleMat = toonMaterial({ vertexColors: true, spec: { threshold: 0.9, strength: 0.85, perVertex: true }, nightTint: 0.4 });
/** Scheinwerfer/Rücklichter: HDR-Farbe > 1 -> werden vom Bloom erfasst. */
export const lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.8, 1.8, 1.8) });
/** Bäume und Pflanzen: Toon + Wind im Vertex-Shader. */
export const plantMat = toonMaterial({ vertexColors: true, wind: true, nightTint: 0.6 });

const SKIN = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
const CHAR_SCALE = 1.25; // etwas größer als real – besser lesbar von oben

// ------------------------------------------------------------------ Figuren
const bodyCache = new Map<number, THREE.BufferGeometry>();
let legGeo: THREE.BufferGeometry | null = null;

function bodyGeometry(outfit: number): THREE.BufferGeometry {
  let g = bodyCache.get(outfit);
  if (!g) {
    const shirt = OUTFIT_COLORS[outfit % OUTFIT_COLORS.length];
    const skin = SKIN[outfit % SKIN.length];
    g = merge([
      box(0.62, 0.72, 0.36, 0, 0.72, 0, shirt), // Oberkörper
      box(0.2, 0.62, 0.22, -0.42, 0.82, 0, shirt), // Arme
      box(0.2, 0.62, 0.22, 0.42, 0.82, 0, shirt),
      box(0.4, 0.4, 0.4, 0, 1.46, 0, skin), // Kopf
      box(0.42, 0.12, 0.42, 0, 1.84, -0.02, 0x2b1d14), // Haare
      box(0.3, 0.06, 0.06, 0, 1.6, 0.21, 0x1a1a1a), // Sonnenbrille
    ]);
    bodyCache.set(outfit, g);
  }
  return g;
}

/** Figur mit schwingenden Beinen (3 Meshes, Beine teilen sich eine Geometrie). */
export class CharacterModel {
  readonly root = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private phase = Math.random() * 10;

  constructor(outfit: number) {
    legGeo ??= merge([box(0.24, 0.72, 0.26, 0, -0.72, 0, 0x2d3a5a), box(0.26, 0.1, 0.34, 0, -0.78, 0.04, 0x222222)]);
    const inner = new THREE.Group();
    inner.scale.setScalar(CHAR_SCALE);
    const body = new THREE.Mesh(bodyGeometry(outfit), toonVC);
    inner.add(body);
    this.legL = new THREE.Mesh(legGeo, toonVC);
    this.legR = new THREE.Mesh(legGeo, toonVC);
    this.legL.position.set(-0.15, 0.74, 0);
    this.legR.position.set(0.15, 0.74, 0);
    inner.add(this.legL, this.legR);
    for (const m of [body, this.legL, this.legR]) addOutline(m, LINE.character);
    this.root.add(inner);
  }

  dispose() { /* Geometrien sind geteilt */ }

  /** speed in m/s; seated = sitzt auf Motorrad/Boot. dist (Kameraabstand) nur für die gleiche Signatur wie AnimatedCharacter. */
  animate(speed: number, dt: number, seated = false, _dist = 0) {
    if (seated) {
      this.legL.rotation.x = this.legR.rotation.x = -1.3;
      return;
    }
    const amount = Math.min(speed / 4, 1);
    this.phase += dt * (4 + speed * 1.2);
    const swing = Math.sin(this.phase) * 0.7 * amount;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.root.children[0].position.y = Math.abs(Math.cos(this.phase)) * 0.08 * amount;
  }
}

// ------------------------------------------------------------------ Fahrzeuge
export interface VehicleGeometry {
  body: THREE.BufferGeometry;
  lights: THREE.BufferGeometry; // unbeleuchtete Teile (Scheinwerfer), leuchten nachts
  seatY: number; // Sitzhöhe für sichtbare Fahrer (0 = Fahrer unsichtbar, z. B. Auto)
  fanZ?: number; // Airboat-Propeller
}

const vehicleCache = new Map<string, VehicleGeometry>();

/** Auto-Modelle aus den Kits; welches ein Fahrzeug bekommt, hängt an seiner ID. */
const CAR_MODELS: ModelName[] = [
  'car_sedan', 'car_hatchback', 'car_stationwagon', 'car_sedan', 'car_hatchback', 'car_stationwagon',
  'truck_red', 'truck_yellow', 'car_taxi',
];
/** Modelle mit fester Lackierung (werden nicht umgefärbt). */
const FIXED_PAINT = new Set<ModelName>(['car_taxi']);
const CAR_LENGTH = 4.3;
const BIKE_LENGTH = 2.1;

function srgbParts(hex: number) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]; }

/** Farbton in Grad (0–360) oder -1 für dunkle/graue Farben (Reifen, Scheiben, Chrom). */
function paintHue(hex: number): number {
  const [r, g, b] = srgbParts(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 40 || max - min < 45) return -1;
  const h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return ((h * 60) % 360 + 360) % 360;
}

/**
 * Lackfläche eines Modells finden: alle kräftigen Farben im Umkreis von ±28° um den
 * (nach Fläche) stärksten Farbton. Die Atlanten haben Farbverläufe, daher kein exakter Farbvergleich.
 */
function paintMask(m: BakedModel): { mask: Uint8Array; refLum: number } {
  const tri = m.triColors;
  const pos = m.body.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const hues = new Float32Array(tri.length), area = new Float32Array(tri.length);
  const bins = new Float32Array(36);
  for (let t = 0; t < tri.length; t++) {
    a.fromBufferAttribute(pos, t * 3); b.fromBufferAttribute(pos, t * 3 + 1); c.fromBufferAttribute(pos, t * 3 + 2);
    area[t] = b.sub(a).cross(c.sub(a)).length() / 2;
    hues[t] = paintHue(tri[t]);
    if (hues[t] >= 0) bins[Math.floor(hues[t] / 10) % 36] += area[t];
  }
  let best = 0;
  for (let k = 1; k < 36; k++) if (bins[k] > bins[best]) best = k;
  const center = best * 10 + 5;
  const mask = new Uint8Array(tri.length);
  let sum = 0, lum = 0;
  for (let t = 0; t < tri.length; t++) {
    if (hues[t] < 0) continue;
    const d = Math.abs(hues[t] - center);
    if (Math.min(d, 360 - d) > 28) continue;
    mask[t] = 1;
    const [r, g, bl] = srgbParts(tri[t]);
    sum += area[t];
    lum += area[t] * (r + g + bl) / 3;
  }
  return { mask, refLum: sum ? lum / sum : 128 };
}

/** Kit-Modell skalieren, umlackieren und mit (prozeduralen) Scheinwerfern versehen. */
function modelVehicle(name: ModelName, paint: number, length: number, bike: boolean): Omit<VehicleGeometry, 'seatY'> | null {
  const m = getModel(name);
  if (!m) return null;
  const s = length / m.size.z;
  const body = m.body.clone();
  const final = new Uint32Array(m.triColors.length);
  if (FIXED_PAINT.has(name)) {
    for (let t = 0; t < final.length; t++) final[t] = palmaraize(m.triColors[t]);
  } else {
    // Helligkeitsverlauf des Originals behalten, Farbton = Spiel-Lackfarbe
    const { mask, refLum } = paintMask(m);
    const [pr, pg, pb] = srgbParts(paint);
    for (let t = 0; t < final.length; t++) {
      if (!mask[t]) { final[t] = palmaraize(m.triColors[t]); continue; }
      const [r, g, b] = srgbParts(m.triColors[t]);
      const k = Math.min(1.4, ((r + g + b) / 3) / refLum);
      const ch = (v: number) => Math.min(255, Math.round(v * k));
      final[t] = (ch(pr) << 16) | (ch(pg) << 8) | ch(pb);
    }
  }
  body.setAttribute('color', new THREE.Float32BufferAttribute(triangleColors(final, (h) => h), 3));
  body.scale(s, s, s);
  body.computeBoundingSphere();

  const w = m.size.x * s, h = m.size.y * s, l = m.size.z * s;
  const lights = bike
    ? box(0.2, 0.16, 0.06, 0, h * 0.62, l / 2 - 0.1, 0xfff6c8)
    : merge([
        box(0.42, 0.18, 0.06, -w * 0.3, h * 0.36, l / 2, 0xfff6c8),
        box(0.42, 0.18, 0.06, w * 0.3, h * 0.36, l / 2, 0xfff6c8),
        box(0.42, 0.16, 0.06, -w * 0.3, h * 0.38, -l / 2 - 0.06, 0xff2a3a),
        box(0.42, 0.16, 0.06, w * 0.3, h * 0.38, -l / 2 - 0.06, 0xff2a3a),
      ]);
  return { body, lights };
}

/** variant = Fahrzeug-ID (wählt das Auto-Modell). */
export function vehicleGeometry(kind: number, colorIdx: number, variant = 0): VehicleGeometry {
  const model = kind === VehicleKind.Car ? CAR_MODELS[variant % CAR_MODELS.length] : null;
  const key = `${kind}:${colorIdx}:${model ?? ''}`;
  let v = vehicleCache.get(key);
  if (v) return v;
  const paint = VEHICLE_COLORS[colorIdx % VEHICLE_COLORS.length];
  const dark = 0x1c1c22, glass = 0x24324d, chrome = 0xc9ccd6;

  const fromKit = model ? modelVehicle(model, paint, CAR_LENGTH, false)
    : kind === VehicleKind.Bike ? modelVehicle('motorcycle', paint, BIKE_LENGTH, true) : null;
  if (fromKit) {
    v = { ...fromKit, seatY: kind === VehicleKind.Bike ? 0.35 : 0 };
    vehicleCache.set(key, finishVehicle(v));
    return v;
  }

  switch (kind) {
    case VehicleKind.Car:
      v = {
        body: merge([
          box(2.0, 0.62, 4.3, 0, 0.32, 0, paint),
          box(1.72, 0.58, 2.2, 0, 0.94, -0.25, glass),
          box(1.76, 0.1, 2.0, 0, 1.5, -0.3, paint),
          box(2.06, 0.2, 0.25, 0, 0.3, 2.15, chrome), // Stoßstangen
          box(2.06, 0.2, 0.25, 0, 0.3, -2.15, chrome),
          box(0.3, 0.62, 0.66, -0.92, 0, 1.35, dark), // Räder
          box(0.3, 0.62, 0.66, 0.92, 0, 1.35, dark),
          box(0.3, 0.62, 0.66, -0.92, 0, -1.35, dark),
          box(0.3, 0.62, 0.66, 0.92, 0, -1.35, dark),
        ]),
        lights: merge([
          box(0.45, 0.2, 0.06, -0.65, 0.62, 2.16, 0xfff6c8),
          box(0.45, 0.2, 0.06, 0.65, 0.62, 2.16, 0xfff6c8),
          box(0.45, 0.18, 0.06, -0.65, 0.62, -2.16, 0xff2a3a),
          box(0.45, 0.18, 0.06, 0.65, 0.62, -2.16, 0xff2a3a),
        ]),
        seatY: 0,
      };
      break;
    case VehicleKind.Bike:
      v = {
        body: merge([
          box(0.16, 0.66, 0.66, 0, 0, 0.75, dark),
          box(0.16, 0.66, 0.66, 0, 0, -0.75, dark),
          box(0.42, 0.42, 1.3, 0, 0.42, 0, paint), // Tank/Rahmen
          box(0.36, 0.14, 0.7, 0, 0.84, -0.35, 0x222222), // Sitz
          box(0.9, 0.08, 0.08, 0, 1.12, 0.62, chrome), // Lenker
          box(0.08, 0.5, 0.08, 0, 0.62, 0.7, chrome),
        ]),
        lights: box(0.2, 0.16, 0.06, 0, 0.82, 0.92, 0xfff6c8),
        seatY: 0.35,
      };
      break;
    case VehicleKind.Boat:
      v = {
        body: merge([
          box(2.2, 0.7, 4.0, 0, -0.2, -0.4, 0xf4f4f0), // Rumpf
          box(1.56, 0.7, 1.56, 0, -0.2, 1.6, 0xf4f4f0, Math.PI / 4), // Bug
          box(2.24, 0.14, 4.0, 0, 0.32, -0.4, paint), // Zierstreifen
          box(1.6, 0.5, 0.1, 0, 0.5, 0.4, glass), // Windschutzscheibe
          box(0.5, 0.9, 0.5, 0, 0.0, -2.55, 0x2a2a2a), // Außenborder
        ]),
        lights: box(0.2, 0.2, 0.2, 0, 0.5, 2.3, 0x5cff7a),
        seatY: 0.1,
      };
      break;
    default: // Airboat
      v = {
        body: merge([
          box(2.4, 0.4, 4.2, 0, -0.1, 0, 0x6f7f5a), // flacher Rumpf
          box(2.0, 0.4, 0.6, 0, -0.1, 2.25, 0x6f7f5a),
          box(2.44, 0.1, 4.2, 0, 0.28, 0, paint),
          box(0.6, 1.1, 0.6, 0, 0.3, -0.6, 0x3a3a3a), // Sitzbock
          cyl(1.15, 1.15, 0.25, 10, 0, 0, 0, 0x2a2a2a).rotateX(Math.PI / 2).translate(0, 1.6, -1.8), // Käfig
          box(0.2, 1.4, 0.2, 0, 0.3, -1.8, 0x2a2a2a),
        ]),
        lights: box(0.3, 0.2, 0.1, 0, 0.3, 2.56, 0xfff6c8),
        seatY: 0.75,
        fanZ: -1.65,
      };
  }
  vehicleCache.set(key, finishVehicle(v));
  return v;
}

let fanGeo: THREE.BufferGeometry | null = null;
export function fanGeometry() {
  fanGeo ??= merge([box(2.0, 0.16, 0.06, 0, -0.08, 0, 0xd8d0b0), box(0.16, 2.0, 0.06, 0, -1.0, 0, 0xd8d0b0)]);
  return fanGeo;
}

// ------------------------------------------------------------------ Fahrzeug-Feinschliff
/**
 * Pro Vertex die Glanzstärke (Attribut shine) aus der Farbe ableiten: Lack glänzt hart, Chrom stark,
 * Gummi gar nicht; Scheiben werden dunkel getönt. Dazu geglättete Normalen für die Umrisslinie.
 */
function finishVehicle(v: VehicleGeometry): VehicleGeometry {
  const g = v.body;
  if (g.getAttribute('shine')) return v;
  const col = g.getAttribute('color');
  const n = col.count;
  const shine = new Float32Array(n);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const hex = c.getHex(THREE.SRGBColorSpace);
    const r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255;
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    if (isGlass(hex)) {
      c.setHex(0x2a4a66, THREE.SRGBColorSpace); // getönte Scheibe
      col.setXYZ(i, c.r, c.g, c.b);
      shine[i] = 1.3;
    } else if (max < 50) shine[i] = 0; // Gummi
    else if (max - min < 24 && max > 150) shine[i] = 1.6; // Chrom
    else shine[i] = 0.9; // Lack
  }
  col.needsUpdate = true;
  g.setAttribute('shine', new THREE.BufferAttribute(shine, 1));
  computeOutlineNormals(g);
  return v;
}

export { treeGeometry } from './plants';

