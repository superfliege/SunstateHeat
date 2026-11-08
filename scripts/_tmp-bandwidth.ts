// Temporär: Snapshot-Größe und Tick-Zeit bei verschiedenen Fahrzeugzahlen.
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import { DRIVER_NONE, DRIVER_NPC, type Connection, type ServerVehicle } from '../server/src/entities/types';
import type { WorldMap } from '../shared/src/world/WorldMap';

function run(scale: number) {
  const base = generateWorld(MAP_SEED);
  const map = Object.create(base) as WorldMap;
  (map as { vehicleSpawns: unknown }).vehicleSpawns = base.vehicleSpawns.slice(0, Math.round(base.vehicleSpawns.length * scale));

  let bytes = 0, snaps = 0;
  const room = new WorldRoom('probe', map);
  const fake: Connection = {
    send: () => {}, sendRaw: (json: string) => { bytes += Buffer.byteLength(json); snaps++; }, close: () => {},
  };
  for (let i = 0; i < 16; i++) room.addPlayer(fake, `P${i}`, { name: 'P', money: 0 } as never);
  const r = room as unknown as { tick(d: number): void; vehicles: Map<number, ServerVehicle> };
  const dt = 1 / SERVER_TICK_HZ;
  for (let t = 0; t < 5 * SERVER_TICK_HZ; t++) r.tick(dt); // einschwingen

  const t0 = performance.now();
  bytes = 0; snaps = 0;
  const runs = 100;
  for (let t = 0; t < runs; t++) r.tick(dt);
  const ms = (performance.now() - t0) / runs;

  const veh = [...r.vehicles.values()];
  const perSnapKB = bytes / snaps / 1024;
  console.log(
    `Spawns ${String(map.vehicleSpawns.length).padStart(3)} | gesamt ${String(veh.length).padStart(3)} ` +
    `(${veh.filter((v) => v.driver === DRIVER_NPC).length} fahrend, ${veh.filter((v) => v.driver === DRIVER_NONE).length} frei) | ` +
    `Snapshot ${perSnapKB.toFixed(1)} KB (= ${(perSnapKB * SERVER_TICK_HZ).toFixed(0)} KB/s pro Client) | Tick ${ms.toFixed(2)} ms`,
  );
  room.dispose();
}

for (const s of [1, 2, 3, 4, 5]) run(s);
