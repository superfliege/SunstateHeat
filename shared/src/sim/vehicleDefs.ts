// Fahrzeugtypen und ihre Arcade-Fahrwerte.
import { Tile } from '../world/tiles';

export const VehicleKind = {
  Car: 0,
  Bike: 1,
  Boat: 2,
  Airboat: 3,
} as const;
export type VehicleKindId = (typeof VehicleKind)[keyof typeof VehicleKind];

export interface VehicleDef {
  kind: VehicleKindId;
  name: string;
  maxSpeed: number; // m/s vorwärts
  accel: number; // m/s²
  brake: number; // m/s²
  drag: number; // Ausrollen ohne Gas, m/s²
  turnRate: number; // rad/s bei voller Lenkung
  radius: number; // Kollisionsradius
  /** Geschwindigkeitsfaktor je Untergrund (0 = unbefahrbar). */
  surface: (tile: number) => number;
}

const landSurface = (t: number): number => {
  switch (t) {
    case Tile.ROAD: case Tile.BRIDGE: case Tile.PLAZA: case Tile.SIDEWALK: case Tile.DOCK:
      return 1;
    case Tile.GRASS: case Tile.DIRT: case Tile.FARM:
      return 0.6;
    case Tile.DESERT: case Tile.BADLANDS: case Tile.FIELD:
      return 0.5;
    case Tile.SAND:
      return 0.45;
    case Tile.SWAMP:
      return 0.2;
    default:
      return 0; // Wasser, Gebäude, Kartenrand
  }
};

const boatSurface = (t: number): number =>
  t === Tile.WATER || t === Tile.BRIDGE ? 1 : t === Tile.SWAMP ? 0.75 : 0;

const airboatSurface = (t: number): number => {
  switch (t) {
    case Tile.WATER: case Tile.SWAMP: case Tile.BRIDGE:
      return 1;
    case Tile.GRASS: case Tile.SAND: case Tile.DIRT:
      return 0.45; // Airboats rutschen auch über Grasinseln
    default:
      return 0;
  }
};

export const VEHICLE_DEFS: Record<VehicleKindId, VehicleDef> = {
  [VehicleKind.Car]: {
    kind: VehicleKind.Car, name: 'Auto',
    maxSpeed: 30, accel: 15, brake: 28, drag: 5, turnRate: 2.4, radius: 1.7, surface: landSurface,
  },
  [VehicleKind.Bike]: {
    kind: VehicleKind.Bike, name: 'Motorrad',
    maxSpeed: 34, accel: 19, brake: 30, drag: 5, turnRate: 3.0, radius: 0.9, surface: landSurface,
  },
  [VehicleKind.Boat]: {
    kind: VehicleKind.Boat, name: 'Boot',
    maxSpeed: 26, accel: 9, brake: 12, drag: 3, turnRate: 1.7, radius: 2.0, surface: boatSurface,
  },
  [VehicleKind.Airboat]: {
    kind: VehicleKind.Airboat, name: 'Airboat',
    maxSpeed: 24, accel: 11, brake: 12, drag: 3.5, turnRate: 2.1, radius: 1.8, surface: airboatSurface,
  },
};

/** Ist das Fahrzeug ein Wasserfahrzeug (Höhe = Wasseroberfläche)? */
export const isWaterVehicle = (k: number) => k === VehicleKind.Boat || k === VehicleKind.Airboat;
