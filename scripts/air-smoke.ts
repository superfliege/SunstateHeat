// Rauchtest der Flugphysik ohne Browser/Server: npm run air-test
// Prüft Start, Steigflug, Strömungsabriss, Landung, Wasserlandung, Helikopter-Schweben und Dachlandung.
import { MAP_SEED, SIM_DT } from '../shared/src/constants';
import { Btn } from '../shared/src/protocol';
import { AIRCRAFT, aircraftById, airLevel, canExitAircraft, groundAccel } from '../shared/src/sim/aircraft';
import { createSimVehicle, stepSimVehicle, type SimVehicle } from '../shared/src/sim/vehicle';
import { VehicleKind } from '../shared/src/sim/vehicleDefs';
import { airSpawnPoint } from '../shared/src/world/airport';
import { generateWorld } from '../shared/src/world/mapgen';

const map = generateWorld(MAP_SEED);
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) fails++; };
const kmh = (v: number) => Math.round(v * 3.6);

function spawn(id: string, x?: number, z?: number, a?: number): SimVehicle {
  const d = aircraftById(id)!;
  const sp = airSpawnPoint(d.spawn) ?? { x: x!, z: z!, a: a!, roof: 0 };
  return createSimVehicle(map, d.type === 'heli' ? VehicleKind.Heli : VehicleKind.Plane, d.variant, x ?? sp.x, z ?? sp.z, a ?? sp.a);
}
/** n Sekunden mit fester Eingabe fliegen; Rückgabe: Ereignisse */
function run(v: SimVehicle, sec: number, ax: number, ay: number, buttons: number) {
  const ev = { hit: 0, crash: false };
  for (let t = 0; t < sec; t += SIM_DT) {
    stepSimVehicle(map, v, ax, ay, buttons | Btn.PILOT, SIM_DT, null);
    const f = v.car.fly!;
    ev.hit = Math.max(ev.hit, f.hit);
    if (f.crash) { ev.crash = true; break; }
  }
  return ev;
}

console.log('Luftfahrzeuge:', AIRCRAFT.map((d) => `${d.name} (${d.type}, Startstrecke ${d.takeoffDistance ?? '–'} m, a=${d.type === 'plane' ? groundAccel(d).toFixed(2) : '–'})`).join(', '));

// --- Sunbird: Startlauf auf der Nordbahn nach Osten, Steigflug, Landung
{
  const r = map.runways[0];
  const sx = r.x - Math.sin(r.rot) * (r.len / 2 - 10), sz = r.z - Math.cos(r.rot) * (r.len / 2 - 10);
  const v = spawn('sunbird', sx, sz, r.rot);
  const f = v.car.fly!;
  run(v, 2, 0, 0, 0); // Motor hochlaufen
  let dist = 0, t = 0;
  const x0 = v.car.x, z0 = v.car.z;
  while (f.ground && t < 20) { run(v, SIM_DT, 0, 1, Btn.SPRINT); t += SIM_DT; dist = Math.hypot(v.car.x - x0, v.car.z - z0); }
  check(!f.ground && dist < 140, `Sunbird hebt ab nach ${dist.toFixed(0)} m (${t.toFixed(1)} s, ${kmh(f.spd)} km/h)`);
  run(v, 8, 0, 1, Btn.SPRINT);
  check(v.car.y > 25 && airLevel(v.car) === 1, `Sunbird steigt auf ${v.car.y.toFixed(0)} m (Stufe Tief)`);
  run(v, 12, 0, 0, Btn.SPRINT);
  check(airLevel(v.car) === 2, `Sunbird erreicht Stufe Hoch (${v.car.y.toFixed(0)} m)`);
  // Strömungsabriss: Gas weg und bremsen
  const yb = v.car.y;
  const ev = run(v, 8, 0, -1, 0);
  check(f.stall === 1 || v.car.y < yb - 15, `Strömungsabriss bei ${kmh(f.spd)} km/h, Höhe ${yb.toFixed(0)} -> ${v.car.y.toFixed(0)} m${ev.crash ? ' (Absturz)' : ''}`);
  check(!canExitAircraft(map, v), 'Aussteigen in der Luft verboten');
}

// --- Sunbird: sanfter Sinkflug auf die Südbahn -> heile Landung
{
  const r = map.runways[1];
  const v = spawn('sunbird', r.x - Math.sin(r.rot) * 110, r.z - Math.cos(r.rot) * 110, r.rot);
  const f = v.car.fly!;
  f.ground = 0; v.car.y += 12; f.spd = 26; f.rotor = 1;
  let ev = { hit: 0, crash: false };
  for (let t = 0; t < 20 && !f.ground; t += SIM_DT) {
    const e = run(v, SIM_DT, 0, 0, Btn.BRAKE);
    ev = { hit: Math.max(ev.hit, e.hit), crash: ev.crash || e.crash };
  }
  check(f.ground === 1 && !ev.crash && ev.hit === 0, `Sunbird landet weich (Schaden ${ev.hit.toFixed(1)})`);
  run(v, 8, 0, -1, Btn.BRAKE);
  check(Math.abs(f.spd) < 1 && canExitAircraft(map, v), `Sunbird rollt aus (${f.spd.toFixed(1)} m/s), Aussteigen erlaubt`);
}

// --- Marlin: harte Landung = Schaden/Absturz, Startlauf nur auf der Bahn
{
  const r = map.runways[1];
  const v = spawn('marlin', r.x, r.z, r.rot);
  const f = v.car.fly!;
  f.ground = 0; v.car.y += 20; f.spd = 60; f.rotor = 1; v.car.vy = -14;
  const ev = run(v, 4, 0, 0, Btn.BRAKE);
  check(ev.crash || ev.hit > 10, `Marlin: zu steiles Aufsetzen -> ${ev.crash ? 'Absturz' : `Schaden ${ev.hit.toFixed(0)}`}`);
  // Startversuch auf dem Vorfeld-Parkplatz (keine Bahn)
  const w = spawn('marlin', 1140, 1240, Math.PI);
  run(w, 2, 0, 0, 0);
  run(w, 6, 0, 1, Btn.SPRINT);
  check(w.car.fly!.ground === 1, `Marlin hebt abseits der Bahn nicht ab (${kmh(w.car.fly!.spd)} km/h)`);
  const m = spawn('marlin');
  check(m.car.fly!.ground === 1, `Marlin steht im Hangar (${m.car.x.toFixed(0)}, ${m.car.z.toFixed(0)})`);
}

// --- Wasserlandung = Absturz
{
  const v = spawn('sunbird', 1520, 1320, 0);
  const f = v.car.fly!;
  f.ground = 0; v.car.y = 6; f.spd = 25; f.rotor = 1;
  const ev = run(v, 6, 0, 0, Btn.BRAKE);
  check(ev.crash, 'Sunbird auf dem Wasser -> Absturz');
}

// --- Kolibri: Rotor hochlaufen, steigen, schweben, Dachlandung, Rotorschlag
{
  const v = spawn('kolibri');
  const f = v.car.fly!;
  run(v, 1, 0, 0, Btn.SPRINT);
  check(f.ground === 1, `Kolibri hebt mit kaltem Rotor nicht ab (Rotor ${(f.rotor * 100).toFixed(0)} %)`);
  run(v, 3, 0, 0, Btn.SPRINT);
  check(f.ground === 0, `Kolibri hebt ab (Rotor ${(f.rotor * 100).toFixed(0)} %)`);
  run(v, 3, 0, 0, Btn.SPRINT);
  run(v, 1.5, 0, 0, 0);
  const y = v.car.y;
  run(v, 3, 0, 0, 0);
  check(Math.abs(v.car.y - y) < 2.5, `Kolibri schwebt (${y.toFixed(1)} -> ${v.car.y.toFixed(1)} m)`);
  const a0 = v.car.a;
  run(v, 1, 1, 0, 0);
  check(Math.abs(v.car.a - a0) > 0.5, 'Kolibri dreht auf der Stelle');
  // Dachlandung auf Hangar 2
  v.car.x = 946; v.car.z = 1267; v.car.y = 16; v.car.vx = v.car.vz = 0;
  let ev = run(v, 6, 0, 0, Btn.BRAKE);
  check(f.ground === 1 && Math.abs(v.car.y - 10) < 0.3 && !ev.crash, `Kolibri landet auf dem Hangardach (${v.car.y.toFixed(1)} m)`);
  check(canExitAircraft(map, v), 'Aussteigen auf dem Dach erlaubt');
  // Rotorschlag: tief in die Terminalwand
  run(v, 3, 0, 0, Btn.SPRINT);
  v.car.x = 1085; v.car.z = 1245; v.car.y = 6; v.car.vy = 0; v.car.a = Math.PI / 2;
  ev = run(v, 3, 0, 1, 0);
  check(ev.hit > 0, `Rotor trifft das Terminal (Schaden ${ev.hit.toFixed(0)})`);
  // Hoch fliegen: keine Gebäudekollision
  v.car.y = 120; f.ground = 0;
  ev = run(v, 2, 0, 1, 0);
  check(ev.hit === 0, 'Stufe Hoch: keine Gebäudekollision');
}

// --- Pelikan: auf dem Hangardach, träger als Kolibri
{
  const v = spawn('pelikan');
  check(v.car.fly!.ground === 1 && Math.abs(v.car.y - 10) < 0.5, `Pelikan steht auf dem Hangar-Helipad (${v.car.y.toFixed(1)} m)`);
  run(v, 8, 0, 0, Btn.SPRINT);
  check(v.car.fly!.ground === 0, `Pelikan steigt (${v.car.y.toFixed(1)} m)`);
}

// --- Treibstoff
{
  const v = spawn('kolibri', 1000, 1240, 0);
  v.car.fly!.fuel = 0.002;
  run(v, 8, 0, 0, Btn.SPRINT);
  check(v.car.fly!.fuel === 0, 'Treibstoff wird verbraucht');
}

console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen` : '\nAlle Flug-Prüfungen bestanden.');
process.exit(fails ? 1 : 0);
