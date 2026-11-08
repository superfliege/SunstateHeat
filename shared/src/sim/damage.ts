// Schadensmodell (spec.md 8.3): 0–1000 Lebenspunkte, Schadenszonen mit Auswirkung aufs Fahren,
// abtrennbare Teile in drei Stufen, Scheiben, Scheinwerfer, Reifen, Feuer.
// Der Server ist autoritativ; Clients bekommen Zonen/Teile kompakt im Snapshot und bilden
// die Blechverformung aus den Aufprall-Ereignissen (Kontaktpunkt + Stärke) selbst nach.
import { ASSISTS, type HandlingProfile } from './handling';

export const MAX_HP = 1000;
export const Zone5 = { FRONT: 0, REAR: 1, LEFT: 2, RIGHT: 3, ENGINE: 4 } as const;
/** Teile: je 2 Bit (0 intakt, 1 wackelt/hängt, 2 abgefallen). */
export const Part = { BUMPER_F: 0, BUMPER_R: 1, HOOD: 2, TRUNK: 3, DOOR_L: 4, DOOR_R: 5, MIRROR_L: 6, MIRROR_R: 7 } as const;
export const PART_COUNT = 8;
/** Feuer: so lange brennt ein Fahrzeug bei 0 HP, bevor es explodiert (s). */
export const BURN_TIME = 5;
export const EXPLOSION_RADIUS = 6;

export interface CarDamage {
  hp: number;
  zones: number[]; // 5 x 0..1
  parts: number; // 8 x 2 Bit
  glass: number; // Bits: 0 vorne, 1 hinten, 2 links, 3 rechts (gesplittert)
  lights: number; // Bits: 0 VL, 1 VR, 2 HL, 3 HR (kaputt)
  tires: number; // Bits je Rad (geplatzt)
  burn: number; // Sekunden seit Brandbeginn (0 = brennt nicht)
  wreck: number; // 1 = ausgebrannt
}

export function newDamage(): CarDamage {
  return { hp: MAX_HP, zones: [0, 0, 0, 0, 0], parts: 0, glass: 0, lights: 0, tires: 0, burn: 0, wreck: 0 };
}

export function resetDamage(d: CarDamage) { Object.assign(d, newDamage()); }

export const partState = (d: CarDamage, part: number) => (d.parts >> (part * 2)) & 3;
function setPart(d: CarDamage, part: number, st: number) {
  if (st <= partState(d, part)) return false;
  d.parts = (d.parts & ~(3 << (part * 2))) | (st << (part * 2));
  return true;
}

/** Stufe für Rauch/Feuer: 0 nichts, 1 Rauch hell, 2 Rauch dunkel, 3 Feuer. */
export function smokeStage(hp: number): number {
  return hp <= 150 ? 3 : hp <= 350 ? 2 : hp <= 600 ? 1 : 0;
}

export interface PartChange { part: number; state: number }

/**
 * Aufprall auf das Fahrzeug. (lx, lz) = Kontaktpunkt im Fahrzeug-Koordinatensystem (x rechts,
 * z vorne), dv = Aufprallgeschwindigkeit (m/s). Gibt geänderte Teile zurück.
 */
export function applyImpact(d: CarDamage, p: HandlingProfile, lx: number, lz: number, dv: number): PartChange[] {
  const over = dv - ASSISTS.damageThreshold;
  if (over <= 0 || d.wreck) return [];
  const changes: PartChange[] = [];
  const dur = p.durability;
  // ~30 km/h Wand: -60 HP, ~50 km/h: -190, ~90 km/h: -530 (Kompakt) – zwei harte Crashs = Feuer
  d.hp = Math.max(0, d.hp - (over ** 1.5 * 4) / dur);
  // Zone: Kontaktpunkt relativ zur halben Länge/Breite
  const fz = lz / (p.length / 2), fx = lx / (p.width / 2);
  const zone = Math.abs(fz) * 0.8 > Math.abs(fx) ? (fz > 0 ? Zone5.FRONT : Zone5.REAR) : fx < 0 ? Zone5.LEFT : Zone5.RIGHT;
  const amount = (over * 0.032) / dur;
  d.zones[zone] = Math.min(1, d.zones[zone] + amount);
  d.zones[Zone5.ENGINE] = Math.min(1, d.zones[Zone5.ENGINE] + amount * (zone === Zone5.FRONT ? 0.6 : 0.12));
  const z = d.zones[zone];
  const step = (part: number, loose: number, off: number) => {
    const st = z >= off ? 2 : z >= loose ? 1 : 0;
    if (st && setPart(d, part, st)) changes.push({ part, state: st });
  };
  switch (zone) {
    case Zone5.FRONT:
      step(Part.BUMPER_F, 0.22, 0.55); step(Part.HOOD, 0.4, 0.8);
      if (z > 0.3 || dv > 14) d.lights |= fx < 0.3 ? 1 : 0, d.lights |= fx > -0.3 ? 2 : 0;
      if (z > 0.45 || dv > 17) d.glass |= 1;
      break;
    case Zone5.REAR:
      step(Part.BUMPER_R, 0.22, 0.55); step(Part.TRUNK, 0.45, 0.85);
      if (z > 0.3 || dv > 14) d.lights |= fx < 0.3 ? 4 : 0, d.lights |= fx > -0.3 ? 8 : 0;
      if (z > 0.45 || dv > 17) d.glass |= 2;
      break;
    case Zone5.LEFT:
      step(Part.MIRROR_L, 0.08, 0.2); step(Part.DOOR_L, 0.35, 0.75);
      if (z > 0.4 || dv > 16) d.glass |= 4;
      break;
    case Zone5.RIGHT:
      step(Part.MIRROR_R, 0.08, 0.2); step(Part.DOOR_R, 0.35, 0.75);
      if (z > 0.4 || dv > 16) d.glass |= 8;
      break;
  }
  // Sehr harte Treffer an einer Radecke können den Reifen platzen lassen
  if (dv > 22 && Math.abs(fz) > 0.45 && Math.abs(fx) > 0.5) d.tires |= 1 << ((fz > 0 ? 0 : 2) + (fx > 0 ? 1 : 0));
  if (d.hp <= 0 && !d.burn) d.burn = 0.0001;
  return changes;
}

/** Reifen platzen lassen (Spike-Strips, Beschuss – Schnittstelle für spätere Systeme). */
export function burstTire(d: CarDamage, wheel: number) { d.tires |= 1 << wheel; }

/** Leistungsfaktor des Motors (Motorschaden, kurz vor dem Ausbrennen). */
export function enginePower(d: CarDamage, t: number): number {
  if (d.wreck) return 0;
  let k = 1 - 0.7 * d.zones[Zone5.ENGINE];
  if (d.hp < 150) k *= 0.6;
  // Stottern bei schwerem Motorschaden (deterministisch über die Fahrzeugzeit)
  if (d.zones[Zone5.ENGINE] > 0.5 && Math.sin(t * 9.3) + Math.sin(t * 23.7) > 1.2) k *= 0.15;
  return k;
}

/** Lenkung zieht zur beschädigten Seite (Radiant). */
export function steerPull(d: CarDamage): number {
  return (d.zones[Zone5.LEFT] - d.zones[Zone5.RIGHT]) * 0.07 + (d.zones[Zone5.FRONT] > 0.6 ? 0.02 : 0);
}

/** Kompakte Übertragung: [hp, z0..z4 (x100), parts, glass|lights<<4|tires<<8, burn x10, wreck]. */
export function packDamage(d: CarDamage): number[] {
  return [Math.round(d.hp), ...d.zones.map((z) => Math.round(z * 100)), d.parts, d.glass | (d.lights << 4) | (d.tires << 8), Math.round(d.burn * 10), d.wreck];
}
export function unpackDamage(a: number[], d: CarDamage) {
  d.hp = a[0];
  for (let i = 0; i < 5; i++) d.zones[i] = a[1 + i] / 100;
  d.parts = a[6];
  d.glass = a[7] & 15; d.lights = (a[7] >> 4) & 15; d.tires = (a[7] >> 8) & 15;
  d.burn = a[8] / 10; d.wreck = a[9];
}
