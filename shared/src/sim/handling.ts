// BALANCING-DATEI für das Fahrgefühl.
// Jedes Fahrzeug hat ein Handling-Profil (reine Daten, zur Laufzeit im Dev-Tuning-Panel änderbar)
// und alle Arcade-Hilfen stehen gesammelt in ASSISTS. Abgeleitete Werte (Federrate,
// Übersetzungen, Luftwiderstand …) berechnet derive() – so bleiben die Profile lesbar.
import { Tile } from '../world/tiles';

export const Drive = { FWD: 0, RWD: 1, AWD: 2 } as const;

export interface HandlingProfile {
  name: string;
  // Karosserie
  mass: number; // kg
  length: number; width: number; height: number; // m (Kollisionsbox)
  wheelbase: number; track: number; // m
  cgHeight: number; // Schwerpunkt über Boden (m) – tief = stabil
  cgForward: number; // Schwerpunkt vor der Achsmitte (m)
  wheelRadius: number;
  // Federung
  suspFreq: number; // Eigenfrequenz (Hz) – höher = straffer
  suspDamping: number; // Dämpfungsmaß (0.3 weich … 0.8 straff)
  suspTravel: number; // Federweg (m)
  antiRoll: number; // Stabilisator 0..1 (weniger Wanken)
  // Antrieb
  torque: number; // Nm (Spitze)
  redline: number; idleRpm: number;
  gears: number; // Anzahl Vorwärtsgänge (4–6)
  topSpeed: number; // m/s (bestimmt Übersetzung + Luftwiderstand)
  launch: number; // Verhältnis 1. Gang / letzter Gang (Spurtstärke)
  shiftTime: number; // s Zugkraftunterbrechung beim Schalten
  drive: number; // Drive.FWD / RWD / AWD
  // Bremsen & Reifen
  brake: number; // Verzögerung in g
  brakeBias: number; // Anteil vorne
  gripFront: number; gripRear: number; // Reibwert
  slipPeakFront: number; slipPeakRear: number; // Schräglaufwinkel des Grip-Maximums (Grad)
  slipFalloff: number; // Grip-Rest nach dem Peak (0..1) – niedrig = rutschig
  handbrakeGrip: number; // Seitengrip der Hinterräder bei Handbremse (Faktor)
  drift: number; // 0..1 Driftfreudigkeit (Leistungsübersteuern, weicherer Abriss)
  // Lenkung
  steerMax: number; // Grad Radeinschlag im Stand
  steerSpeedFalloff: number; // weniger Einschlag bei Tempo
  steerRate: number; // Lenkgeschwindigkeit (1/s)
  // Sonstiges
  durability: number; // Schadensmultiplikator (> 1 = robuster)
  nitroForce: number; // N Schub (0 = kein Nitro möglich)
  sportExhaust: number; // 1 = Auspuffknallen beim Gaswegnehmen
  /** Motorsound: Zylinderzahl und Grundcharakter. */
  cylinders: number;
  /** 1 = Motorrad: Rollwinkel wird physikalisch aufrecht gehalten (Optik legt sich in die Kurve). */
  upright: number;
  /** Nitro-Dauer bei voller Ladung (s). */
  nitroTime: number;
}

export type HandlingClass = 'compact' | 'sedan' | 'sport' | 'muscle' | 'suv' | 'truck' | 'bike' | 'police' | 'boat' | 'airboat' | 'tank';

export const base = (p: Partial<HandlingProfile> & { name: string }): HandlingProfile => ({
  mass: 1300, length: 4.4, width: 1.85, height: 1.45, wheelbase: 2.65, track: 1.55,
  cgHeight: 0.5, cgForward: 0.1, wheelRadius: 0.33,
  suspFreq: 1.6, suspDamping: 0.45, suspTravel: 0.22, antiRoll: 0.5,
  torque: 260, redline: 6500, idleRpm: 850, gears: 5, topSpeed: 44, launch: 3.6, shiftTime: 0.22, drive: Drive.FWD,
  brake: 1.0, brakeBias: 0.66,
  gripFront: 1.15, gripRear: 1.15, slipPeakFront: 7, slipPeakRear: 7, slipFalloff: 0.75, handbrakeGrip: 0.35, drift: 0.3,
  steerMax: 34, steerSpeedFalloff: 0.045, steerRate: 4.5,
  durability: 1, nitroForce: 0, sportExhaust: 0, cylinders: 4, upright: 0, nitroTime: 3.5,
  ...p,
});

/** Handling-Profile je Klasse (spec.md 8.1). Klassen sollen sich deutlich unterscheiden. */
export const HANDLING: Record<HandlingClass, HandlingProfile> = {
  // Kompakt: leicht, Front, wendig, schwach, gutmütig
  compact: base({
    name: 'Kompakt', mass: 1100, length: 3.9, width: 1.75, height: 1.45, wheelbase: 2.45, track: 1.5, cgHeight: 0.5, wheelRadius: 0.31,
    suspFreq: 1.8, torque: 165, redline: 6800, gears: 5, topSpeed: 38, launch: 3.8, drive: Drive.FWD,
    gripFront: 1.15, gripRear: 1.2, slipPeakFront: 8, slipPeakRear: 8, slipFalloff: 0.82, handbrakeGrip: 0.4, drift: 0.15,
    steerMax: 38, steerRate: 5.5, durability: 0.85,
  }),
  // Limousine: ausgewogen
  sedan: base({
    name: 'Limousine', mass: 1400, length: 4.5, width: 1.85, wheelbase: 2.75, track: 1.58, cgHeight: 0.52,
    torque: 270, gears: 5, topSpeed: 44, drive: Drive.RWD, gripFront: 1.15, gripRear: 1.12, drift: 0.35,
  }),
  // Sportwagen: schnell, tief, viel Grip, empfindlich
  sport: base({
    name: 'Sportwagen', mass: 1350, length: 4.4, width: 1.95, height: 1.2, wheelbase: 2.6, track: 1.65, cgHeight: 0.4, wheelRadius: 0.34,
    suspFreq: 2.3, suspDamping: 0.55, suspTravel: 0.15, antiRoll: 0.75,
    torque: 450, redline: 7800, gears: 6, topSpeed: 58, launch: 3.4, shiftTime: 0.12, drive: Drive.AWD, brake: 1.3,
    gripFront: 1.35, gripRear: 1.35, slipPeakFront: 6, slipPeakRear: 6, slipFalloff: 0.7, handbrakeGrip: 0.3, drift: 0.35,
    steerMax: 32, steerSpeedFalloff: 0.05, steerRate: 5.5, durability: 0.7, nitroForce: 6500, sportExhaust: 1, cylinders: 6,
  }),
  // Muscle Car: schwer, Heck, viel Drehmoment, driftet
  muscle: base({
    name: 'Muscle Car', mass: 1600, length: 4.8, width: 1.95, height: 1.35, wheelbase: 2.85, track: 1.62, cgHeight: 0.48, wheelRadius: 0.34,
    suspFreq: 1.5, suspDamping: 0.4, suspTravel: 0.22, antiRoll: 0.4,
    torque: 560, redline: 6000, idleRpm: 750, gears: 4, topSpeed: 53, launch: 3.0, shiftTime: 0.25, drive: Drive.RWD, brake: 0.9,
    gripFront: 1.12, gripRear: 0.98, slipPeakFront: 7, slipPeakRear: 6, slipFalloff: 0.6, handbrakeGrip: 0.25, drift: 0.85,
    steerMax: 33, steerRate: 4.2, durability: 1.1, nitroForce: 7000, sportExhaust: 1, cylinders: 8,
  }),
  // SUV / Pick-up: hoch, Allrad, robust, gut im Gelände, wankt
  suv: base({
    name: 'SUV / Pick-up', mass: 2100, length: 4.9, width: 2.0, height: 1.8, wheelbase: 2.95, track: 1.7, cgHeight: 0.72, wheelRadius: 0.4,
    suspFreq: 1.3, suspDamping: 0.4, suspTravel: 0.32, antiRoll: 0.55,
    torque: 420, redline: 5600, gears: 5, topSpeed: 40, launch: 3.6, drive: Drive.AWD, brake: 0.85,
    gripFront: 1.05, gripRear: 1.05, slipPeakFront: 8, slipPeakRear: 8, slipFalloff: 0.8, handbrakeGrip: 0.45, drift: 0.2,
    steerMax: 33, steerRate: 3.8, durability: 1.5, cylinders: 6,
  }),
  // Truck: sehr schwer, langsam, schiebt alles weg
  truck: base({
    name: 'Truck', mass: 8000, length: 7.4, width: 2.45, height: 3.2, wheelbase: 4.6, track: 2.0, cgHeight: 1.05, cgForward: 0.4, wheelRadius: 0.5,
    suspFreq: 1.4, suspDamping: 0.5, suspTravel: 0.25, antiRoll: 0.8,
    torque: 1900, redline: 2600, idleRpm: 600, gears: 6, topSpeed: 30, launch: 5.0, shiftTime: 0.4, drive: Drive.RWD, brake: 0.65,
    gripFront: 0.95, gripRear: 1.0, slipPeakFront: 9, slipPeakRear: 9, slipFalloff: 0.85, handbrakeGrip: 0.6, drift: 0.05,
    steerMax: 36, steerSpeedFalloff: 0.06, steerRate: 2.8, durability: 3, cylinders: 6,
  }),
  // Motorrad (vier Raycasts, sehr schmale Spur, starke Stabilisierung, Optik legt sich in Kurven)
  bike: base({
    name: 'Motorrad', mass: 260, length: 2.1, width: 0.7, height: 1.2, wheelbase: 1.45, track: 0.36, cgHeight: 0.55, wheelRadius: 0.32,
    suspFreq: 2.0, suspDamping: 0.5, suspTravel: 0.15, antiRoll: 1,
    torque: 105, redline: 11000, idleRpm: 1300, gears: 6, topSpeed: 50, launch: 3.2, shiftTime: 0.08, drive: Drive.RWD, brake: 1.1,
    gripFront: 1.25, gripRear: 1.2, slipPeakFront: 7, slipPeakRear: 7, slipFalloff: 0.7, handbrakeGrip: 0.7, drift: 0.25,
    steerMax: 30, steerSpeedFalloff: 0.06, steerRate: 6, durability: 0.5, sportExhaust: 1, cylinders: 2, upright: 1,
  }),
  // Wasserfahrzeuge: nur Masse/Maße für Kollisionen (Fahrmodell: movement.ts/stepWater)
  boat: base({ name: 'Boot', mass: 1400, length: 5.2, width: 2.3, height: 1.4, cgHeight: 0.4, durability: 1.2, cylinders: 6 }),
  airboat: base({ name: 'Airboat', mass: 750, length: 4.8, width: 2.5, height: 2.4, cgHeight: 0.4, durability: 1, cylinders: 4 }),
  police: base({
    name: 'Polizei', mass: 1650, length: 4.9, width: 1.95, wheelbase: 2.9, track: 1.62, cgHeight: 0.5,
    torque: 420, gears: 5, topSpeed: 52, drive: Drive.RWD, brake: 1.15, gripFront: 1.25, gripRear: 1.2, drift: 0.4,
    durability: 1.4, cylinders: 8,
  }),
  // Panzer (nur Polizei/Militär bei Fahndungsstufe 4): sehr schwer, langsam, kaum kaputtzukriegen
  tank: base({
    name: 'Panzer', mass: 16000, length: 7.0, width: 3.2, height: 2.4, wheelbase: 4.6, track: 2.6, cgHeight: 0.9, wheelRadius: 0.45,
    suspFreq: 1.6, suspDamping: 0.6, suspTravel: 0.18, antiRoll: 0.9,
    torque: 5200, redline: 2600, idleRpm: 600, gears: 4, topSpeed: 20, launch: 5.0, shiftTime: 0.4, drive: Drive.AWD, brake: 0.9,
    gripFront: 1.3, gripRear: 1.3, slipPeakFront: 9, slipPeakRear: 9, slipFalloff: 0.9, handbrakeGrip: 0.9, drift: 0,
    steerMax: 40, steerSpeedFalloff: 0.04, steerRate: 3, durability: 8, cylinders: 12,
  }),
};

/** Arcade-Hilfen (gelten für alle Fahrzeuge). */
export const ASSISTS = {
  /** Schwerkraft-Faktor: > 1 wirkt "schwerer", Sprünge landen satter. */
  gravityScale: 1.4,
  /** Physik-Unterschritte je SIM_DT (Federung braucht kleine Schritte). */
  substeps: 2,
  /** Lenk-Eingabe glätten: Zeitkonstante (s). */
  steerSmoothing: 0.07,
  /** Lenkwinkel-Begrenzung nach Grip: 1 = genau am Haftlimit, > 1 = etwas mehr (Übersteuern möglich). */
  steerGrip: 1.25,
  /** Handbremse: Längsreibung der blockierten Hinterräder (Anteil) – niedrig = Drift behält Tempo. */
  handbrakeDrag: 0.3,
  /** Drift-Schub: hält im Drift mit Gas etwas Tempo (Anteil von m·g). */
  driftKeep: 0.25,
  /** Automatische Gegenlenkung im Drift (Anteil des Schwimmwinkels). */
  counterSteer: 0.35,
  /** Gierdämpfung gegen ungewolltes Drehen (0..1). */
  yawDamping: 0.22,
  /** Höhe, in der Reifenkräfte angreifen (0 = Aufstandspunkt, 1 = Schwerpunkt) – weniger Kippen. */
  rollCenter: 0.6,
  /** Anti-Überschlag: aufrichtendes Moment ab dieser Neigung (Grad) und dessen Stärke. */
  stabilityAngle: 30,
  stability: 9,
  /** Luftkontrolle: Neigen (W/S) und Drehen (A/D) in der Luft – schwach. */
  airPitch: 1.6,
  airYaw: 1.4,
  /** Nach so vielen Sekunden auf dem Dach/der Seite kann man mit E aufrichten. */
  unflipDelay: 3,
  /** Winkel-Dämpfung (gegen Taumeln). */
  angularDamping: 0.35,
  /** Wandkontakt: Rückprall und Reibung. */
  wallRestitution: 0.22,
  wallFriction: 0.35,
  /** Schadens-Schwelle: unter dieser Aufprallgeschwindigkeit (m/s) kein Schaden. */
  damageThreshold: 3.5,
  /** Ab diesem Δv (m/s) gilt ein Crash als "hart" (Hit-Stop, Herausschleudern). */
  hardCrash: 13,
  /** Nässe senkt den Grip (spec: nass x 0,85). */
  wetGrip: 0.85,
  /** Fahrzeug-Fahrzeug: Rückprall, Reibung und Verstärkung des Drehimpulses (seitliche Treffer schleudern). */
  carRestitution: 0.25,
  carFriction: 0.35,
  crashSpin: 1.35,
  /** Haftung im Stand (verhindert Rutschen am Hang), Anteil pro Schritt. */
  staticGrip: 0.35,
  /** Lastabhängigkeit des Grips: mehr Last -> etwas weniger Reibwert je kg (0 = aus). */
  loadSensitivity: 0.12,
  /** Rückwärtsgang: Höchstgeschwindigkeit (m/s). */
  reverseSpeed: 11,
  /** Motorbremse beim Gaswegnehmen (Anteil des Drehmoments). */
  engineBrake: 0.12,
  /** Nitro: Nachfüllen pro Sekunde (Anteil), FOV-Zuschlag (Grad). */
  nitroRefill: 0.04,
  nitroFov: 9,
  /** Unterhalb dieser Geschwindigkeit + Ruhe schläft ein freies Fahrzeug ein (spart Server-Zeit). */
  sleepSpeed: 0.08,
};

/** Untergrund-Grip (spec.md 8.2: Asphalt 1,0 / Sand 0,6 / Gras 0,7 / Schlamm 0,5) + Rollwiderstand. */
export function surfaceGrip(tile: number): { grip: number; roll: number; dust: number } {
  switch (tile) {
    case Tile.ROAD: case Tile.BRIDGE: case Tile.PLAZA: case Tile.SIDEWALK: case Tile.DOCK:
      return { grip: 1, roll: 0.012, dust: 0 };
    case Tile.DIRT: return { grip: 0.75, roll: 0.03, dust: 1 }; // Schotter
    case Tile.GRASS: case Tile.FIELD: case Tile.FARM: return { grip: 0.7, roll: 0.04, dust: 0.4 };
    case Tile.SAND: case Tile.DESERT: return { grip: 0.6, roll: 0.07, dust: 1 };
    case Tile.BADLANDS: return { grip: 0.7, roll: 0.04, dust: 1 };
    case Tile.SWAMP: return { grip: 0.5, roll: 0.12, dust: 0 }; // Schlamm
    default: return { grip: 0.7, roll: 0.04, dust: 0.3 };
  }
}

// ------------------------------------------------------------------ Fahrzeug-Varianten
/**
 * Konkrete Modelle: welches Profil + welches 3D-Modell. Die Variante wird pro Fahrzeug
 * übertragen (Snapshot) – Server und Client nutzen dieselbe Tabelle.
 */
export interface VehicleVariant { cls: HandlingClass; model: string; name: string; weight: number }
export const CAR_VARIANTS: VehicleVariant[] = [
  { cls: 'compact', model: 'car_hatchback', name: 'Bimini Bug', weight: 4 },
  { cls: 'sedan', model: 'car_sedan', name: 'Palmara Cruiser', weight: 4 },
  { cls: 'sedan', model: 'car_stationwagon', name: 'Sedano Kombi', weight: 3 },
  { cls: 'sedan', model: 'car_taxi', name: 'Coralia Cab', weight: 2 },
  { cls: 'sport', model: 'proc_sport', name: 'Neon Vortex', weight: 1 },
  { cls: 'muscle', model: 'proc_muscle', name: 'Gator V8', weight: 1.5 },
  { cls: 'suv', model: 'truck_red', name: 'Swamprunner', weight: 2 },
  { cls: 'suv', model: 'truck_yellow', name: 'Ranch Hauler', weight: 1.5 },
  { cls: 'truck', model: 'proc_boxtruck', name: 'Citrus Express', weight: 1 },
  // Kenney Car Kit (Indizes ab 9 – die oberen bleiben stabil für /auto, Rennen und Spielstände)
  { cls: 'sedan', model: 'ck-sedan', name: 'Coastline LX', weight: 3 },
  { cls: 'sport', model: 'ck-sedan-sports', name: 'Riviera GT', weight: 1.2 },
  { cls: 'sport', model: 'ck-hatchback-sports', name: 'Keys Hornet', weight: 1.2 },
  { cls: 'suv', model: 'ck-suv', name: 'Everglade XT', weight: 2 },
  { cls: 'suv', model: 'ck-suv-luxury', name: 'Brickell Prestige', weight: 1.2 },
  { cls: 'suv', model: 'ck-van', name: 'Sunshine Van', weight: 1.8 },
  { cls: 'truck', model: 'ck-delivery', name: 'Parcel Runner', weight: 0.8 },
  { cls: 'truck', model: 'ck-garbage-truck', name: 'Coralia Sanitation', weight: 0.4 },
  { cls: 'truck', model: 'ck-truck', name: 'Harbor Hauler', weight: 0.6 },
  { cls: 'suv', model: 'ck-ambulance', name: 'Palmara Rescue', weight: 0.4 },
  { cls: 'truck', model: 'ck-firetruck', name: 'Engine 7', weight: 0.25 },
  { cls: 'sedan', model: 'ck-taxi', name: 'Sunshine Cab', weight: 1.5 },
  { cls: 'sport', model: 'ck-race', name: 'Ocean Drive Racer', weight: 0.3 },
];
export const BIKE_VARIANT = 100;
export const BOAT_VARIANT = 101;
export const AIRBOAT_VARIANT = 102;
export const TANK_VARIANT = 103;

/** Variante zufällig nach Gewicht (rnd 0..1). */
export function pickCarVariant(rnd: number): number {
  const total = CAR_VARIANTS.reduce((s, v) => s + v.weight, 0);
  let r = rnd * total;
  for (let i = 0; i < CAR_VARIANTS.length; i++) { r -= CAR_VARIANTS[i].weight; if (r <= 0) return i; }
  return 0;
}

export function variantInfo(variant: number): VehicleVariant {
  if (variant === BIKE_VARIANT) return { cls: 'bike', model: 'motorcycle', name: 'Sunburst 600', weight: 0 };
  if (variant === BOAT_VARIANT) return { cls: 'boat', model: 'boat', name: 'Keys Skiff', weight: 0 };
  if (variant === AIRBOAT_VARIANT) return { cls: 'airboat', model: 'airboat', name: 'Marsh Glider', weight: 0 };
  if (variant === TANK_VARIANT) return { cls: 'tank', model: 'proc_tank', name: 'Panzer', weight: 0 };
  return CAR_VARIANTS[variant] ?? CAR_VARIANTS[0];
}

// ------------------------------------------------------------------ abgeleitete Werte
export interface Derived {
  p: HandlingProfile;
  inertia: [number, number, number]; // Hauptträgheitsmomente (Körper x, y, z)
  springK: number; damperC: number; rest: number; mountY: number;
  ratios: number[]; finalDrive: number; dragC: number;
  /** Lokale Radaufhängungspunkte [x, z] relativ zum Schwerpunkt. Lokal: +x = links, +z = vorne.
   *  Reihenfolge: 0 vorne links, 1 vorne rechts, 2 hinten links, 3 hinten rechts. */
  wheels: [number, number][];
  /** Abstand Schwerpunkt -> Boden im Stand. */
  groundOffset: number;
}

const cache = new Map<HandlingProfile, Derived>();
/** Profil-Version: bei Live-Tuning hochzählen, damit der Cache neu rechnet. */
let version = 0;
export function invalidateHandling() { version++; cache.clear(); }
export function handlingVersion() { return version; }

export const GRAVITY = 9.81;

export function derive(p: HandlingProfile): Derived {
  const hit = cache.get(p);
  if (hit) return hit;
  const m = p.mass, g = GRAVITY * ASSISTS.gravityScale;
  const l = p.length, w = p.width, h = p.height;
  const inertia: [number, number, number] = [m * (h * h + l * l) / 12, m * (w * w + l * l) / 12 * 1.1, m * (w * w + h * h) / 12];
  const corner = m / 4;
  const springK = corner * (2 * Math.PI * p.suspFreq) ** 2;
  const damperC = 2 * p.suspDamping * Math.sqrt(springK * corner);
  const rest = p.suspTravel;
  const staticComp = (corner * g) / springK;
  // Aufhängung so legen, dass der Schwerpunkt im Stand cgHeight über dem Boden liegt
  const mountY = -p.cgHeight + p.wheelRadius + rest - staticComp + p.wheelRadius * 0; // Radmitte unter dem Montagepunkt
  // Übersetzungen: letzter Gang erreicht topSpeed knapp unter dem Begrenzer
  const wheelRpsTop = p.topSpeed / (2 * Math.PI * p.wheelRadius);
  const topTotal = (p.redline * 0.95) / 60 / wheelRpsTop;
  const finalDrive = 3.5;
  const top = topTotal / finalDrive;
  const ratios: number[] = [];
  for (let i = 0; i < p.gears; i++) ratios.push(top * Math.pow(p.launch, (p.gears - 1 - i) / Math.max(1, p.gears - 1)));
  // Luftwiderstand so, dass die Zugkraft im letzten Gang bei topSpeed aufgebraucht ist
  const driveTop = (p.torque * 0.85 * top * finalDrive) / p.wheelRadius;
  const dragC = driveTop / (p.topSpeed * p.topSpeed);
  const wb = p.wheelbase / 2, tr = p.track / 2;
  const wheels: [number, number][] = [[tr, wb - p.cgForward], [-tr, wb - p.cgForward], [tr, -wb - p.cgForward], [-tr, -wb - p.cgForward]];
  const d: Derived = { p, inertia, springK, damperC, rest, mountY, ratios, finalDrive, dragC, wheels, groundOffset: p.cgHeight };
  cache.set(p, d);
  return d;
}

/** Drehmomentkurve (0..1 über Drehzahl/Begrenzer): bullig in der Mitte, fällt oben ab. */
export function torqueCurve(x: number): number {
  if (x < 0.15) return 0.55;
  if (x < 0.55) return 0.55 + ((x - 0.15) / 0.4) * 0.45;
  if (x < 0.8) return 1;
  return Math.max(0.55, 1 - ((x - 0.8) / 0.2) * 0.4);
}
