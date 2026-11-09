// Temporär: Benchmark der Server-Tick-Zeit (Simulation + Snapshot-Serialisierung).
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { Connection, ServerPlayer } from '../server/src/entities/types';

const map = generateWorld(MAP_SEED);
const room = new WorldRoom('bench', map);

// 1 Fake-Spieler, damit die Snapshot-Serialisierung mitgemessen wird
const fake: Connection = { send: () => {}, sendRaw: () => {}, close: () => {} };
const player = room.addPlayer(fake, 'Bench', { name: 'Bench', money: 0 } as never);
(player as ServerPlayer).pawn.x = map.spawn.x;
(player as ServerPlayer).pawn.z = map.spawn.z;

const dt = 1 / SERVER_TICK_HZ;
const rooms = [room];
// 16 Spieler: Kollisionen mit Fahrzeugen skalieren damit
for (let i = 1; i < 16; i++) room.addPlayer(fake, `Bench${i}`, { name: 'B', money: 0 } as never);

// Aufwärmen
for (let i = 0; i < 20; i++) (room as never as { tick(d: number): void }).tick(dt);

const runs = 200;
const t0 = performance.now();
for (let i = 0; i < runs; i++) (room as never as { tick(d: number): void }).tick(dt);
const total = performance.now() - t0;

const veh = (room as never as { vehicles: Map<number, unknown> }).vehicles.size;
console.log(`Fahrzeuge: ${veh}`);
console.log(`Tick: ${(total / runs).toFixed(2)} ms  (Budget: 15 ms bei 16 Spielern)`);
room.dispose();
void rooms;
