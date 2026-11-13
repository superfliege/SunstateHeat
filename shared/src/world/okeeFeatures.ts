// Bauten, Schanzen und Fahrzeuge am Okee Peak (Gipfelcafé, Funkturm, Ranger-Station mit Wachturm,
// Steinbruch, Campingplatz, Holzplatz, Dustline-Truckstop). Deterministisch aus okeePeak.ts.
import { CAR_VARIANTS } from '../sim/handling';
import { VehicleKind } from '../sim/vehicleDefs';
import { OKEE_PLACES, OKEE_RAMPS, okeeBase } from './okeePeak';
import { BuildingStyle, type WorldMap } from './WorldMap';

interface Spot { tag: string; x: number; z: number; w: number; d: number; h: number; rot: number; color: number }

const P = OKEE_PLACES;
/** Gebäude am Berg (tag = Art:Ort, Darstellung in NorthBuilder). */
export const OKEE_BUILDINGS: Spot[] = [
  { tag: 'cafe:summit', x: P.cafe.x, z: P.cafe.z, w: 10, d: 7, h: 4, rot: P.cafe.rot, color: 0x8a6a52 },
  { tag: 'radio:summit', x: P.radioTower.x, z: P.radioTower.z, w: 3, d: 3, h: 30, rot: 0, color: 0xd83a3a },
  { tag: 'ranger:station', x: P.ranger.x - 4, z: P.ranger.z, w: 9, d: 7, h: 4.5, rot: P.ranger.rot, color: 0x6e5a3a },
  { tag: 'watchtower:ranger', x: P.ranger.x + 8, z: P.ranger.z - 5, w: 4, d: 4, h: 14, rot: P.ranger.rot, color: 0x7a5a3a },
  { tag: 'store:camp', x: P.campground.x + 20, z: P.campground.z + 18, w: 7, d: 5, h: 3.5, rot: 0, color: 0x9a7652 },
  { tag: 'office:quarry', x: P.quarry.x + 18, z: P.quarry.z + 22, w: 8, d: 5, h: 3.4, rot: 0, color: 0xe8d43a },
  { tag: 'crusher:quarry', x: P.quarry.x - 8, z: P.quarry.z - 6, w: 8, d: 7, h: 9, rot: 0.3, color: 0x8a8070 },
  { tag: 'shed:logyard', x: P.logYard.x - 8, z: P.logYard.z - 8, w: 9, d: 6, h: 4.5, rot: 0.4, color: 0x6e4e32 },
  { tag: 'diner:truckstop', x: P.truckstop.x - 10, z: P.truckstop.z + 22, w: 16, d: 9, h: 5, rot: 0, color: 0xc0392b },
  { tag: 'hq:dustline', x: P.truckstop.x + 30, z: P.truckstop.z + 20, w: 22, d: 14, h: 8, rot: 0, color: 0x9a4a2a },
];

/** Gebäude + Schanzen eintragen (vor der Rasterung). */
export function placeOkeeFeatures(map: WorldMap) {
  for (const b of OKEE_BUILDINGS) map.buildings.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, rot: b.rot, color: b.color, style: BuildingStyle.Farm, tag: b.tag });
  for (const r of OKEE_RAMPS) {
    // Auffahrt zeigt bergab (Sprung ins Tal)
    const e = 3;
    const gx = okeeBase(r.x + e, r.z) - okeeBase(r.x - e, r.z), gz = okeeBase(r.x, r.z + e) - okeeBase(r.x, r.z - e);
    const rot = Math.atan2(-gx, -gz);
    map.ramps.push({ x: r.x - Math.sin(rot) * r.len / 2, z: r.z - Math.cos(rot) * r.len / 2, rot, len: r.len, w: r.w, h: r.h });
  }
}

/** Fahrzeuge am Berg: Muldenkipper, Holztransporter, Wohnmobile, Quads, Buggy, Ranger-Pick-up. */
export const OKEE_VEHICLES: { variant: string; x: number; z: number; a: number }[] = [
  { variant: 'Muldenkipper', x: P.quarry.x - 10, z: P.quarry.z + 10, a: 0.4 },
  { variant: 'Muldenkipper', x: P.quarry.x + 8, z: P.quarry.z - 4, a: 2.1 },
  { variant: 'Holztransporter', x: P.logYard.x + 6, z: P.logYard.z + 6, a: 1.2 },
  { variant: 'Wanderlust RV', x: P.campground.x - 14, z: P.campground.z - 8, a: 0.3 },
  { variant: 'Wanderlust RV', x: P.campground.x + 4, z: P.campground.z - 16, a: 1.9 },
  { variant: 'Mule ATV', x: P.ranger.x + 2, z: P.ranger.z + 8, a: 0 },
  { variant: 'Ridge Runner Buggy', x: P.campground.x + 14, z: P.campground.z + 2, a: -0.6 },
  { variant: 'County Ranger', x: P.ranger.x - 10, z: P.ranger.z + 8, a: Math.PI / 2 },
  { variant: 'Dustline Rig', x: P.truckstop.x + 30, z: P.truckstop.z + 4, a: Math.PI / 2 },
  { variant: 'Holztransporter', x: P.truckstop.x + 46, z: P.truckstop.z + 4, a: Math.PI / 2 },
];

export function placeOkeeVehicles(map: WorldMap) {
  for (const v of OKEE_VEHICLES) {
    const variant = CAR_VARIANTS.findIndex((c) => c.name === v.variant);
    if (variant >= 0) map.vehicleSpawns.push({ kind: VehicleKind.Car, x: v.x, z: v.z, a: v.a, color: 0, variant });
  }
}
