// Temporär: verteilt die Entitäten über die Karte und zählt sie im Umkreis eines Spielers.
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { dist2 } from '../shared/src/math';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import { DRIVER_NPC, type Connection, type ServerVehicle } from '../server/src/entities/types';

const map = generateWorld(MAP_SEED);
const room = new WorldRoom('probe', map);
const fake: Connection = { send: () => {}, sendRaw: () => {}, close: () => {} };
const me = room.addPlayer(fake, 'Ich', { name: 'Ich', money: 0 } as never);
me.pawn.x = map.spawn.x; me.pawn.z = map.spawn.z;

type Tickable = { tick(d: number): void; vehicles: Map<number, ServerVehicle> };
const r = room as unknown as Tickable;
const dt = 1 / SERVER_TICK_HZ;
for (let t = 0; t < 5 * SERVER_TICK_HZ; t++) r.tick(dt);

console.log(`Spawn: ${map.spawn.x.toFixed(0)} / ${map.spawn.z.toFixed(0)}`);
console.log(`Karte ${map.size} m breit (Grenzen ${map.size} m)`);

const radii = [80, 150, 300, 600, 2000];
const veh = [...r.vehicles.values()];
for (const R of radii) {
  const v = veh.filter((o) => dist2(o.state.x, o.state.z, map.spawn.x, map.spawn.z) < R * R);
  const peds = [...(room as never as { peds: { peds: Map<number, { x: number; z: number }> } }).peds.peds.values()]
    .filter((p) => dist2(p.x, p.z, map.spawn.x, map.spawn.z) < R * R);
  console.log(`Radius ${String(R).padStart(4)} m: ${String(v.length).padStart(3)} Fahrzeuge (${v.filter((o) => o.driver === DRIVER_NPC).length} fahrend), ${String(peds.length).padStart(3)} Fußgänger`);
}
console.log(`Gesamt: ${veh.length} Fahrzeuge, ${(room as never as { peds: { peds: Map<number, unknown> } }).peds.peds.size} Fußgänger`);
room.dispose();

void MAP_SEED;
