// Lasttest der NPC-Bevölkerung (Population Tables, Absichtsketten, Wahrnehmung, Barks):
// 16 Spieler verteilt im Ocean Strip, die herumlaufen, ab und zu schießen/sprinten. Misst die
// Server-Tick-Zeit, Snapshot-Bandbreite pro Spieler und zählt, was die NPCs tun.
//   npx tsx scripts/npc-bench.ts [Sekunden=90] [Tageszeit=noon]
import { MAP_SEED, SERVER_TICK_HZ } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';
import { centroid } from '../shared/src/world/geometry';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { Connection, ServerPlayer } from '../server/src/entities/types';
import { NpcEv } from '../shared/src/npc/reactions';
import type { DayPart } from '../shared/src/npc/population';

import { NpcBrain } from '../server/src/sim/NpcBrain';
import { Perception } from '../server/src/sim/Perception';
import { Population } from '../server/src/sim/Population';
import { Traffic } from '../server/src/sim/Traffic';

// PROF=1: längste Einzelaufrufe der NPC-Systeme messen (Spitzen finden)
const slowest: Record<string, number> = {};
if (process.env.PROF) {
  const wrap = (proto: Record<string, unknown>, name: string, label: string) => {
    const f = proto[name] as (...a: unknown[]) => unknown;
    proto[name] = function (this: unknown, ...a: unknown[]) {
      const t = performance.now(); const res = f.apply(this, a); const d = performance.now() - t;
      if (d > (slowest[label] ?? 0)) slowest[label] = d;
      return res;
    };
  };
  const B = NpcBrain.prototype as unknown as Record<string, unknown>;
  for (const n of ['route', 'walkNear', 'findObject', 'findParkedCar', 'nextStep', 'tick', 'meet', 'startExit']) wrap(B, n, 'brain.' + n);
  for (const n of ['adopt', 'returnHome', 'driveDynamic', 'driveKinematic', 'spawn', 'extend']) wrap(Traffic.prototype as unknown as Record<string, unknown>, n, 'traffic.' + n);
  wrap(Traffic.prototype as unknown as Record<string, unknown>, 'update', 'traffic.update');
  wrap(Perception.prototype as unknown as Record<string, unknown>, 'update', 'perception.update');
  wrap(Population.prototype as unknown as Record<string, unknown>, 'update', 'pop.update');
  const W = WorldRoom.prototype as unknown as Record<string, unknown>;
  const ps = W.physicsStep as (...a: unknown[]) => unknown; let slowCalls = 0;
  W.physicsStep = function (this: unknown, ...a: unknown[]) { const t = performance.now(); const r = ps.apply(this, a); const d = performance.now() - t; if (d > 20) console.log(`physicsStep ${d.toFixed(0)} ms (#${++slowCalls})`); return r; };
}

const secs = Number(process.argv[2] ?? 90);
const part = (process.argv[3] ?? 'noon') as DayPart;
const map = generateWorld(MAP_SEED);
const room = new WorldRoom('bench', map);
const r = room as unknown as {
  tick(d: number): void; pop: { forcePart: DayPart | null; describe(): string };
  brain: { stats: Record<string, number> }; perception: { stats: Record<string, number>; event(ev: number, x: number, z: number, src: number): void };
  peds: { peds: Map<number, { mind: unknown; pop: boolean }> };
};
r.pop.forcePart = part;

const ocean = map.districts.find((d) => d.name === 'Ocean Strip')!;
const [cx, cz] = centroid(ocean.poly);
// Gehwegpunkte im Viertel als Startplätze
const spots: [number, number][] = [];
for (const e of map.edges) {
  if (e.sidewalk <= 0) continue;
  for (const p of e.pts) if (Math.hypot(p[0] - cx, p[1] - cz) < 260) spots.push([p[0] + (e.width / 2 + 1), p[1]]);
}
let bytes = 0, snaps = 0, barks = 0;
const players: ServerPlayer[] = [];
for (let i = 0; i < 16; i++) {
  const conn: Connection = {
    send: () => {}, close: () => {},
    sendRaw: (json: string) => { if (i === 0) { bytes += Buffer.byteLength(json); snaps++; barks += (json.match(/\["bark"/g) ?? []).length; } },
  };
  const p = room.addPlayer(conn, `P${i}`, { name: 'P', money: 0, reputation: {}, inventory: {}, weapons: { pistol: 50 }, xp: 0, bank: 0 } as never);
  const s = spots[Math.floor((i / 16) * spots.length)];
  p.pawn.x = s[0]; p.pawn.z = s[1];
  players.push(p);
}

const dt = 1 / SERVER_TICK_HZ;
let worst = 0, total = 0, n = 0;
const ticks = secs * SERVER_TICK_HZ;
for (let t = 0; t < ticks; t++) {
  // Spieler schlendern (Kreisbahnen), Spieler 0 schießt alle 20 s einmal
  for (const [i, p] of players.entries()) {
    const a = t * dt * 0.15 + i;
    p.pawn.x += Math.sin(a) * 1.4 * dt; p.pawn.z += Math.cos(a) * 1.4 * dt;
  }
  if (t % (20 * SERVER_TICK_HZ) === 10 * SERVER_TICK_HZ) r.perception.event(NpcEv.Shot, players[0].pawn.x, players[0].pawn.z, players[0].id);
  const t0 = performance.now();
  r.tick(dt);
  const ms = performance.now() - t0;
  if (t > 5 * SERVER_TICK_HZ) { total += ms; n++; worst = Math.max(worst, ms); }
}
let minds = 0, managed = 0;
for (const p of r.peds.peds.values()) { if (p.mind) minds++; if (p.pop) managed++; }
console.log(`Tageszeit ${part}, ${secs} s simuliert, 16 Spieler im Ocean Strip`);
console.log(`Tick: Ø ${(total / n).toFixed(2)} ms, max ${worst.toFixed(1)} ms (Budget ${(1000 / SERVER_TICK_HZ).toFixed(0)} ms)`);
console.log(`Snapshot an Spieler 0: Ø ${(bytes / snaps / 1024).toFixed(2)} KB, ${(bytes / secs / 1024).toFixed(1)} KB/s, Barks empfangen: ${barks}`);
console.log(`NPCs verwaltet: ${managed} (mit Gehirn ${minds})`);
console.log('Gehirn:', JSON.stringify(r.brain.stats));
console.log('Wahrnehmung:', JSON.stringify(r.perception.stats));
console.log(r.pop.describe());
if (process.env.PROF) console.log('Längste Aufrufe (ms):', JSON.stringify(Object.fromEntries(Object.entries(slowest).map(([k, v]) => [k, +v.toFixed(1)]))));
room.dispose();
