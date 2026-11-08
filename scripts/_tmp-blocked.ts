// Temporär: prüft, ob geparkte Autos (driver = DRIVER_NONE) im Sichtkegel der Verkehrs-KI liegen.
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import { DRIVER_NONE, DRIVER_NPC, type Connection, type ServerVehicle } from '../server/src/entities/types';

const map = generateWorld(MAP_SEED);
const room = new WorldRoom('probe', map);
const fake: Connection = { send: () => {}, sendRaw: () => {}, close: () => {} };
room.addPlayer(fake, 'Probe', { name: 'Probe', money: 0 } as never);

type Tickable = { tick(d: number): void; vehicles: Map<number, ServerVehicle> };
const r = room as unknown as Tickable;
const dt = 1 / SERVER_TICK_HZ;

// 60 s Simulationszeit: zählen, wie oft ein Verkehrsauto einen geparkten Wagen im Kegel hat
let blockedTicks = 0, trafficTicks = 0, stuckTicks = 0;
for (let t = 0; t < 60 * SERVER_TICK_HZ; t++) {
  r.tick(dt);
  for (const v of r.vehicles.values()) {
    if (v.driver !== DRIVER_NPC) continue;
    trafficTicks++;
    if (Math.abs(v.state.s) < 0.5 && t % 2 === 0) stuckTicks++;
    const fx = Math.sin(v.state.a), fz = Math.cos(v.state.a);
    const look = 8 + Math.abs(v.state.s) * 0.6;
    let hit = false;
    for (const o of r.vehicles.values()) {
      if (o === v || o.driver !== DRIVER_NONE) continue;
      const dx = o.state.x - v.state.x, dz = o.state.z - v.state.z;
      const along = dx * fx + dz * fz;
      if (along <= 0 || along > look) continue;
      if (Math.abs(dx * fz - dz * fx) < 2.4) { hit = true; break; }
    }
    if (hit) blockedTicks++;
  }
}
console.log(`Verkehrsautos: ${[...r.vehicles.values()].filter((v) => v.driver === DRIVER_NPC).length}`);
console.log(`geparkt/frei:   ${[...r.vehicles.values()].filter((v) => v.driver === DRIVER_NONE).length}`);
console.log(`Tick-Paare Verkehr: ${trafficTicks}`);
console.log(`davon geparktes Auto im Kegel: ${(100 * blockedTicks / trafficTicks).toFixed(1)} %`);
console.log(`davon stehend (<0.5 m/s, halbe Auflösung): ${(100 * stuckTicks * 2 / trafficTicks).toFixed(1)} %`);
room.dispose();
