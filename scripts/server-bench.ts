// Server-Tick-Benchmark: 16 Spieler, verteilt auf die Benchmark-Viertel (Ocean Strip, Downtown, Port
// District, Gator Flats, Highway) – die Hälfte fährt Auto, der Rest läuft; nachts, Regen, eine
// Verfolgungsjagd. Gibt Ø/max/p99 der Tick-Zeit und die Aufteilung je Teilsystem aus.
//   npx tsx scripts/server-bench.ts [Sekunden=60] [Spieler=16]
// Zielwert: Ø < 10 ms je Tick (Budget bei 20 Hz: 50 ms).
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { mulberry32 } from '../shared/src/math';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { Connection, ServerPlayer } from '../server/src/entities/types';

Math.random = mulberry32(1234);
const secs = Number(process.argv[2] ?? 60);
const count = Number(process.argv[3] ?? 16);
const map = generateWorld(MAP_SEED);
const room = new WorldRoom('bench', map);
const R = room as unknown as { tick(d: number): void; tickReport?(reset?: boolean): string };

const SPOTS: [number, number][] = [[1576, 900], [1300, 990], [1300, 1220], [1060, 1520], [1060, 1088], [1540, 1000], [1360, 1040], [1250, 1250]];
let bytes = 0, snaps = 0;
const players: ServerPlayer[] = [];
for (let i = 0; i < count; i++) {
  const conn: Connection = { send: () => {}, close: () => {}, sendRaw: (j: string) => { bytes += j.length; snaps++; } };
  const p = room.addPlayer(conn, `B${i}`, { name: 'B', money: 0, reputation: {}, inventory: {}, weapons: { pistol: 50 }, xp: 0, bank: 0 } as never);
  const [x, z] = SPOTS[i % SPOTS.length];
  p.pawn.x = x + (i >> 3) * 6; p.pawn.z = z;
  players.push(p);
}
const chat = (p: ServerPlayer, text: string) => { p.lastChatAt = 0; room.handleMessage(p, { t: 'chat', text }); };
chat(players[0], '/zeit 23');
chat(players[0], '/wetter regen');
chat(players[1], '/fahndung 2');
for (let i = 0; i < count; i += 2) chat(players[i], '/auto sport');

const dt = 1 / SERVER_TICK_HZ;
const times: number[] = [];
let seq = 1;
for (let t = 0; t < secs * SERVER_TICK_HZ; t++) {
  for (const [i, p] of players.entries()) {
    if (p.vehicleId >= 0) {
      const steer = Math.sin(t * dt * 0.4 + i) * 0.6;
      room.handleMessage(p, { t: 'input', cmds: [[seq++, steer, 1, 0], [seq++, steer, 1, 0], [seq++, steer, 1, 0]] });
    } else {
      const a = t * dt * 0.15 + i;
      p.pawn.x += Math.sin(a) * 1.4 * dt; p.pawn.z += Math.cos(a) * 1.4 * dt;
    }
  }
  if (t === 5 * SERVER_TICK_HZ) R.tickReport?.(true); // Einschwingen nicht mitzählen
  const t0 = performance.now();
  R.tick(dt);
  if (t >= 5 * SERVER_TICK_HZ) times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(times.length * q))].toFixed(2);
console.log(`${count} Spieler, ${secs} s, Node ${process.version}`);
console.log(`Tick p50 ${p(0.5)} ms · p99 ${p(0.99)} ms · max ${times[times.length - 1].toFixed(1)} ms`);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`Tick Ø ${mean.toFixed(2)} ms`);
if (R.tickReport) console.log(R.tickReport(false));
console.log(`Snapshots: Ø ${(bytes / Math.max(1, snaps) / 1024).toFixed(2)} KB je Spieler und Tick`);
room.dispose();
