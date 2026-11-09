// Temporär: Stau-Kennzahlen in Abhängigkeit von der Zahl der geparkten Autos.
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import { DRIVER_NONE, DRIVER_NPC, type Connection, type ServerVehicle } from '../server/src/entities/types';
import type { WorldMap } from '../shared/src/world/WorldMap';

function run(parkedScale: number) {
  const base = generateWorld(MAP_SEED);
  const map = Object.create(base) as WorldMap;
  // Nur die ersten N Spawns behalten (deterministisch dieselbe Teilmenge)
  const keep = Math.round(base.vehicleSpawns.length * parkedScale);
  (map as { vehicleSpawns: unknown }).vehicleSpawns = base.vehicleSpawns.slice(0, keep);

  const room = new WorldRoom('probe', map);
  const fake: Connection = { send: () => {}, sendRaw: () => {}, close: () => {} };
  room.addPlayer(fake, 'Probe', { name: 'Probe', money: 0 } as never);
  const r = room as unknown as { tick(d: number): void; vehicles: Map<number, ServerVehicle> };
  const dt = 1 / SERVER_TICK_HZ;

  for (let t = 0; t < 10 * SERVER_TICK_HZ; t++) r.tick(dt); // einschwingen
  let trafficTicks = 0, blocked = 0, standing = 0, shoved = 0;
  const startXYZ = new Map<number, { x: number; z: number }>();
  for (const v of r.vehicles.values()) if (v.driver === DRIVER_NONE) startXYZ.set(v.id, { x: v.state.x, z: v.state.z });

  for (let t = 0; t < 60 * SERVER_TICK_HZ; t++) {
    r.tick(dt);
    for (const v of r.vehicles.values()) {
      if (v.driver !== DRIVER_NPC) continue;
      trafficTicks++;
      if (Math.abs(v.state.s) < 0.5) standing++;
      const fx = Math.sin(v.state.a), fz = Math.cos(v.state.a);
      const look = 8 + Math.abs(v.state.s) * 0.6;
      for (const o of r.vehicles.values()) {
        if (o === v || o.driver !== DRIVER_NONE) continue;
        const dx = o.state.x - v.state.x, dz = o.state.z - v.state.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along <= look && Math.abs(dx * fz - dz * fx) < 2.4) { blocked++; break; }
      }
    }
  }
  for (const v of r.vehicles.values()) {
    const s = startXYZ.get(v.id);
    if (s && Math.hypot(v.state.x - s.x, v.state.z - s.z) > 2) shoved++;
  }
  const traffic = [...r.vehicles.values()].filter((v) => v.driver === DRIVER_NPC).length;
  const free = [...r.vehicles.values()].filter((v) => v.driver === DRIVER_NONE).length;
  room.dispose();
  return { parked: keep, free, traffic, blocked: 100 * blocked / trafficTicks, standing: 100 * standing / trafficTicks, shoved };
}

console.log('geparkt  frei  Verkehr  blockiert%  stehend%  verschoben');
for (const k of [1, 2, 3, 4, 5]) {
  const r = run(k);
  console.log(`${String(r.parked).padStart(7)}  ${String(r.free).padStart(4)}  ${String(r.traffic).padStart(7)}  ${r.blocked.toFixed(1).padStart(10)}  ${r.standing.toFixed(1).padStart(8)}  ${r.shoved}`);
}
