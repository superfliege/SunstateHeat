// Temporär: klassifiziert die erzeugten Fahrzeug-Spawns nach Untergrund (Quelle).
import { MAP_SEED } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { Tile } from '../shared/src/world/tiles';
import { VehicleKind } from '../shared/src/sim/vehicleDefs';

const map = generateWorld(MAP_SEED);
const names: Record<number, string> = {
  [Tile.ROAD]: 'Straße (Straßenrand)',
  [Tile.PLAZA]: 'Plaza (Parkplatz/Tank/Hof)',
  [Tile.GRASS]: 'Gras (Hof)',
  [Tile.DIRT]: 'Erde (Hof)',
  [Tile.DESERT]: 'Wüste (Hof)',
  [Tile.WATER]: 'Wasser (Boot)',
  [Tile.SWAMP]: 'Sumpf (Airboat)',
  [Tile.SIDEWALK]: 'Gehweg',
  [Tile.DOCK]: 'Steg',
};
const byTile = new Map<string, number>();
const byKind = new Map<string, number>();
const kindName: Record<number, string> = {
  [VehicleKind.Car]: 'Auto',
  [VehicleKind.Bike]: 'Motorrad',
  [VehicleKind.Boat]: 'Boot',
  [VehicleKind.Airboat]: 'Airboat',
};
for (const s of map.vehicleSpawns) {
  const t = map.tileAt(s.x, s.z);
  const k = names[t] ?? `Tile ${t}`;
  byTile.set(k, (byTile.get(k) ?? 0) + 1);
  const kn = kindName[s.kind] ?? `Kind ${s.kind}`;
  byKind.set(kn, (byKind.get(kn) ?? 0) + 1);
}
console.log('Gesamt:', map.vehicleSpawns.length);
console.log('nach Untergrund:', [...byTile.entries()].sort((a, b) => b[1] - a[1]));
console.log('nach Art:', [...byKind.entries()].sort((a, b) => b[1] - a[1]));
