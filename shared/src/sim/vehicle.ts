// Ein Fahrzeug der Simulation (Server und Client-Prediction): Art, Variante, Handling-Profil,
// Physik-Zustand und Schaden. stepSimVehicle() wählt das passende Fahrmodell.
import type { WorldMap } from '../world/WorldMap';
import { createCar, placeCar, stepCar, type CarState, type StepOut } from './car';
import { newDamage, type CarDamage } from './damage';
import { AIRBOAT_VARIANT, BIKE_VARIANT, BOAT_VARIANT, HANDLING, variantInfo, type HandlingProfile } from './handling';
import { stepWater } from './movement';
import { VEHICLE_DEFS, VehicleKind, isAircraft, isWaterVehicle, type VehicleKindId } from './vehicleDefs';
import { aircraftProfile, isAircraftVariant, placeAircraft, stepAircraft } from './aircraft';

export interface SimVehicle {
  kind: number;
  variant: number;
  prof: HandlingProfile;
  car: CarState;
  dmg: CarDamage;
}

/** Standard-Variante je Fahrzeugart (Autos: aus der Variantentabelle). */
export function defaultVariant(kind: number, carVariant = 0): number {
  return kind === VehicleKind.Bike ? BIKE_VARIANT : kind === VehicleKind.Boat ? BOAT_VARIANT : kind === VehicleKind.Airboat ? AIRBOAT_VARIANT : carVariant;
}

export function profileOf(variant: number): HandlingProfile {
  if (isAircraftVariant(variant)) return aircraftProfile(variant);
  return HANDLING[variantInfo(variant).cls];
}

export function createSimVehicle(map: WorldMap, kind: number, variant: number, x: number, z: number, a: number): SimVehicle {
  const prof = profileOf(variant);
  const car = createCar();
  if (isAircraft(kind)) placeAircraft(map, car, variant, x, z, a);
  else placeCar(map, car, prof, x, z, a);
  return { kind, variant, prof, car, dmg: newDamage() };
}

/** Ein fester Simulationsschritt (SIM_DT). Wracks rollen nur noch aus. */
export function stepSimVehicle(map: WorldMap, v: SimVehicle, ax: number, ay: number, buttons: number, dt: number, out: StepOut | null) {
  if (isAircraft(v.kind)) {
    stepAircraft(map, v, ax, ay, buttons, dt);
    const f = v.car.fly!;
    if (out && f.hit > out.impact.dv) Object.assign(out.impact, { dv: f.hit, x: v.car.x, y: v.car.y + 1, z: v.car.z, nx: -Math.sin(v.car.a), ny: 0, nz: -Math.cos(v.car.a), kind: 0, id: -1, scrape: 0 });
    return;
  }
  if (v.dmg.wreck) { ax = 0; ay = 0; buttons = 0; }
  if (isWaterVehicle(v.kind)) {
    const hit = stepWater(map, VEHICLE_DEFS[v.kind as VehicleKindId], v.car, ax, ay, buttons, dt);
    if (out && hit > out.impact.dv) Object.assign(out.impact, { dv: hit, x: v.car.x, y: v.car.y, z: v.car.z, nx: -Math.sin(v.car.a), ny: 0, nz: -Math.cos(v.car.a), kind: 0, id: -1, scrape: 0 });
    return;
  }
  stepCar(map, v.car, v.prof, v.dmg, ax, ay, buttons, dt, out);
}
