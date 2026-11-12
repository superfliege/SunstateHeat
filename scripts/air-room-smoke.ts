// Luftfahrt-Rauchtest mit echtem WorldRoom (ohne Browser): Flotte, Rangsperre, Einsteigen,
// Mitfahrer, Flug, Aussteigen in der Luft verboten, Tanken, Absturz + Respawn, Netz-Sichtweite.
// Aufruf: npx tsx scripts/air-room-smoke.ts (wird von npm run air-test mit ausgeführt)
import { MAP_SEED, SIM_DT } from '../shared/src/constants';
import { Btn, type ServerMsg } from '../shared/src/protocol';
import { AIR_SETTINGS, aircraftById } from '../shared/src/sim/aircraft';
import { newPawn } from '../shared/src/sim/movement';
import { rankIndex } from '../shared/src/story';
import { AIR_FUEL } from '../shared/src/world/airport';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { ServerPlayer, ServerVehicle } from '../server/src/entities/types';

const map = generateWorld(MAP_SEED);
const room = new WorldRoom('air-test', map);
const R = room as unknown as { tick(d: number): void; dispose(): void; vehicles: Map<number, ServerVehicle> };
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++; };

const mk = (name: string) => {
  const msgs: ServerMsg[] = [];
  const raw: string[] = [];
  const conn = { send: (m: ServerMsg) => msgs.push(m), close: () => {}, sendRaw: (s: string) => { raw.push(s); if (raw.length > 5) raw.shift(); } };
  const fresh = { key: 'guest:' + name, name, money: 5000, bank: 0, xp: 0, health: 100, armor: 0, reputation: {}, inventory: {}, questsDone: [], questCooldowns: {}, weapons: {}, pos: null, playtimeSeconds: 0, createdAt: 0, lastLogin: 0 };
  return { p: room.addPlayer(conn as never, name, fresh as never), msgs, raw };
};
let seq = 1;
/** s Sekunden simulieren; Eingaben je Spieler (60 Hz Kommandos, 20 Hz Server-Ticks) */
const run = (s: number, inputs: [ServerPlayer, number, number, number][] = []) => {
  for (let i = 0; i < s * 20; i++) {
    for (const [p, ax, ay, b] of inputs) room.handleMessage(p, { t: 'input', cmds: [[seq++, ax, ay, b], [seq++, ax, ay, b], [seq++, ax, ay, b]] });
    R.tick(1 / 20);
  }
};
const use = (p: ServerPlayer) => room.handleMessage(p, { t: 'use' });
const chat = (p: ServerPlayer, t: string) => { p.lastChatAt = 0; room.handleMessage(p, { t: 'chat', text: t }); };
const lastNotice = (msgs: ServerMsg[]) => [...msgs].reverse().find((m) => m.t === 'notice') as Extract<ServerMsg, { t: 'notice' }> | undefined;
const fleet = (id: string) => [...R.vehicles.values()].find((v) => v.air?.id === id)!;
const put = (p: ServerPlayer, x: number, z: number) => { p.pawn = newPawn(x, z, 0); };

// --- Flotte
for (const id of ['sunbird', 'marlin', 'kolibri', 'pelikan']) {
  const v = fleet(id);
  check(!!v && v.sim.car.fly?.ground === 1, `${aircraftById(id)!.name} steht bereit (${v?.sim.car.x.toFixed(0)}, ${v?.sim.car.z.toFixed(0)}, Höhe ${v?.sim.car.y.toFixed(1)})`);
}
check(SIM_DT > 0, 'Simulation läuft mit festem Schritt');

// --- Rang: Neuling darf den Kolibri fliegen, bekommt dafür aber 3 Sterne
const A = mk('Pilotin'), B = mk('Gast'), C = mk('Zaungast');
const kol = fleet('kolibri');
A.p.profile.story = { ...A.p.profile.story!, rank: 0 };
put(A.p, kol.sim.car.x + 3, kol.sim.car.z);
use(A.p);
check(A.p.vehicleId === kol.id && (!AIR_SETTINGS.rankGate || A.p.wanted >= 3), `Unter Rang: fliegen erlaubt, Fahndung ${A.p.wanted} (${lastNotice(A.msgs)?.text})`);
// Rang „Fahrer“: darf ohne Fahndung fliegen
use(A.p); // wieder aussteigen
check(A.p.vehicleId < 0, 'Aussteigen am Boden');
A.p.wanted = 0; A.p.heat = 0; A.p.searchT = 0; A.p.reports.length = 0;
A.p.profile.story!.rank = rankIndex('fahrer');
use(A.p);
check(A.p.vehicleId === kol.id && A.p.wanted === 0, 'Rang Fahrer: Pilotin sitzt im Kolibri, keine Fahndung');
// Mitfahrer
put(B.p, kol.sim.car.x - 3, kol.sim.car.z);
use(B.p);
check(B.p.ride === kol.id && kol.riders?.includes(B.p.id) === true, 'Zweiter Spieler steigt als Mitfahrer ein');
put(C.p, kol.sim.car.x, kol.sim.car.z + 3);
use(C.p);
check(C.p.ride < 0 && C.p.vehicleId < 0, `Kolibri voll (2 Sitze): ${lastNotice(C.msgs)?.text}`);

// --- Flug: Rotor hoch, steigen, Mitfahrer fliegt mit
run(4, [[A.p, 0, 0, Btn.SPRINT], [B.p, 1, 1, Btn.SPRINT]]);
const y1 = kol.sim.car.y;
check(kol.sim.car.fly!.ground === 0 && y1 > 8, `Kolibri steigt (${y1.toFixed(1)} m)`);
const pos = room.positionOf(B.p);
check(Math.hypot(pos.x - kol.sim.car.x, pos.z - kol.sim.car.z) < 0.5, 'Mitfahrer-Position folgt dem Helikopter (Eingaben des Mitfahrers ignoriert)');
use(A.p);
check(A.p.vehicleId === kol.id, `Aussteigen in der Luft verboten: ${lastNotice(A.msgs)?.text}`);
use(B.p);
check(B.p.ride === kol.id, 'Mitfahrer kann in der Luft nicht aussteigen');
// Snapshot enthält Höhe und ride
const snap = JSON.parse(B.raw[B.raw.length - 1]);
check(snap.me?.ride === kol.id, 'Snapshot meldet dem Mitfahrer sein Luftfahrzeug');
const vt = (snap.v as number[][] | undefined)?.find((t) => t[0] === kol.id);
check(!vt || vt[3] > 5, 'Snapshot überträgt die Flughöhe');

// --- Sichtweite: Luftfahrzeug in 300 m Entfernung bleibt sichtbar
put(C.p, kol.sim.car.x + 300, kol.sim.car.z);
run(0.5);
const seen = C.p.view.veh.has(kol.id);
check(seen, 'Luftfahrzeug ist in 300 m Entfernung im Netz sichtbar');

// --- Landen auf dem Vorfeld, aussteigen
run(6, [[A.p, 0, 0, Btn.BRAKE]]);
check(kol.sim.car.fly!.ground === 1, `Kolibri gelandet (Schaden ${(1000 - kol.sim.dmg.hp).toFixed(0)})`);
use(B.p);
check(B.p.ride < 0, 'Mitfahrer steigt nach der Landung aus');

// --- Tanken
kol.sim.car.fly!.fuel = 0.4;
kol.sim.car.x = AIR_FUEL.x; kol.sim.car.z = AIR_FUEL.z;
const money0 = A.p.profile.money;
run(6, [[A.p, 0, 0, 0]]);
check(kol.sim.car.fly!.fuel > 0.95 && A.p.profile.money < money0, `Tankstelle: ${Math.round(kol.sim.car.fly!.fuel * 100)} %, −$${money0 - A.p.profile.money}`);
use(A.p);
check(A.p.vehicleId < 0, 'Pilotin steigt am Boden aus');

// --- Absturz: Sunbird über Wasser abschmieren lassen -> Explosion, Insassen ausgeknockt, Respawn
const sb = fleet('sunbird');
A.p.profile.story!.rank = rankIndex('fahrer');
put(A.p, sb.sim.car.x + 2, sb.sim.car.z);
use(A.p);
check(A.p.vehicleId === sb.id, 'Pilotin sitzt im Sunbird');
const f = sb.sim.car.fly!;
sb.sim.car.x = 1560; sb.sim.car.z = 1400; sb.sim.car.a = Math.PI / 2; sb.sim.car.y = 12; f.ground = 0; f.spd = 25; f.rotor = 1;
run(5, [[A.p, 0, 0, Btn.BRAKE]]);
if (!sb.sim.dmg.wreck) console.log('  Sunbird:', sb.sim.car.x.toFixed(0), sb.sim.car.z.toFixed(0), sb.sim.car.y.toFixed(1), JSON.stringify(sb.sim.car.fly), 'Tile', map.tileAt(sb.sim.car.x, sb.sim.car.z), 'Pilot', sb.driver, A.p.id);
check(sb.sim.dmg.wreck === 1, 'Wasserlandung: Sunbird zerstört');
check(A.p.vehicleId < 0 && A.p.downT > 0, 'Pilotin herausgeschleudert und ausgeknockt (Respawn nach normalen Regeln)');
(sb.air as { deadT: number }).deadT = AIR_SETTINGS.respawnDestroyed + 1;
put(A.p, 100, 100); put(B.p, 100, 100); put(C.p, 100, 100);
run(0.2);
check(sb.sim.dmg.wreck === 0 && Math.hypot(sb.sim.car.x - sb.air!.home.x, sb.sim.car.z - sb.air!.home.z) < 1, 'Sunbird nach Respawn-Zeit wieder auf P1');

// --- Dev-Befehl
chat(C.p, '/flug pelikan');
const pel = C.p.vehicleId >= 0 ? R.vehicles.get(C.p.vehicleId) : undefined;
check(pel?.air === undefined && pel?.sim.car.fly !== undefined, '/flug pelikan stellt einen Pelikan bereit');

// --- Bahnwarnung: Spieler zu Fuß auf der Südbahn, Sunbird startet dort
{
  const E = mk('Spaziergänger'), F = mk('Startpilot');
  F.p.profile.story!.rank = rankIndex('fahrer');
  const r = map.runways[1];
  const sx = r.x - Math.sin(r.rot) * (r.len / 2 - 8), sz = r.z - Math.cos(r.rot) * (r.len / 2 - 8);
  sb.sim.car.x = sx; sb.sim.car.z = sz; sb.sim.car.a = r.rot; sb.sim.car.sleep = 0;
  put(F.p, sx + 2, sz + 3);
  use(F.p);
  put(E.p, r.x + 40, r.z);
  run(5, [[F.p, 0, 1, 0]]);
  const warn = E.msgs.some((m) => m.t === 'notice' && /Bahn/.test(m.text));
  check(F.p.vehicleId === sb.id && warn, `Bahnwarnung: ${(E.msgs.filter((m) => m.t === 'notice').pop() as { text?: string } | undefined)?.text}`);
  check(!F.msgs.some((m) => m.t === 'notice' && /runter von der Bahn/.test(m.text)), 'Pilot selbst bekommt keine Bahnwarnung');
  use(F.p); run(3, [[F.p, 0, -1, Btn.BRAKE]]); use(F.p);
  put(E.p, 300, 300); put(F.p, 300, 300);
}

// --- Polizeihubschrauber ab Fahndungsstufe 4
const D = mk('Gesucht');
put(D.p, 1300, 1000);
chat(D.p, `/fahndung ${AIR_SETTINGS.policeHeliWanted}`);
run(0.2);
const heli = () => [...R.vehicles.values()].find((v) => v.copHeli === D.p.id);
check(!!heli(), 'Polizeihubschrauber wird angefordert');
for (let i = 0; i < 10; i++) { D.p.wanted = AIR_SETTINGS.policeHeliWanted; D.p.searchT = 0; run(1); }
const h = heli();
const hd = h ? Math.hypot(h.sim.car.x - D.p.pawn.x, h.sim.car.z - D.p.pawn.z) : 1e9;
check(!!h && hd < 80 && h.sim.car.y > 20 && !h.sim.dmg.wreck, `Polizeihubschrauber kreist über dem Spieler (${hd.toFixed(0)} m, Höhe ${h?.sim.car.y.toFixed(0)} m)`);
chat(D.p, '/fahndung 0');
put(D.p, 300, 300);
run(25);
check(!heli(), 'Fahndung vorbei: Hubschrauber zieht ab');

room.dispose();
console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : '\nAlle Luftfahrt-Server-Prüfungen bestanden.');
process.exit(fails ? 1 : 0);
