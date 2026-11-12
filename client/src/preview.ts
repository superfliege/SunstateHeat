// Render-Vorschau ohne Server (nur im Dev-Modus): http://localhost:5173/preview.html
// Parameter: ?x=..&z=.. (Position, Standard = Spawn), ?day=0.5 (Tageszeit), ?district=Ocean Strip,
//            ?ragdoll=1 (Passanten werden reihum weggeschleudert – Ragdoll testen),
//            ?retro=1, ?zoom=1.4 (Kameraabstand-Faktor), ?air=1 (Luftfahrzeug-Vitrine statt Autos, ?alt=30 Flughöhe).
//            Shader-Fehler werden auf der Seite angezeigt.
import * as THREE from 'three';
import { MAP_SEED } from '../../shared/src/constants';
import { centroid } from '../../shared/src/world/geometry';
import { generateWorld } from '../../shared/src/world/mapgen';
import { generateVegetation } from '../../shared/src/world/vegetation';
import { EntityViews } from './game/EntityViews';
import { loadAssets } from './render/assets';
import { CameraRig } from './render/CameraRig';
import { loadTextureOverrides } from './render/materials/atlas';
import { U } from './render/materials/toon';
import { moodFor } from './render/palette';
import { Particles } from './render/Particles';
import { PostFX } from './render/PostFX';
import { loadQuaternius } from './render/quaternius';
import { loadKenneyCharacters } from './render/kenneyCharacters';
import { Sky } from './render/Sky';
import { WorldView } from './render/WorldView';
import { PropsView } from './render/PropsView';
import { FeaturesView } from './render/FeaturesView';
import { profileOf } from '../../shared/src/sim/vehicle';
import { CAR_VARIANTS } from '../../shared/src/sim/handling';
import { AIRCRAFT } from '../../shared/src/sim/aircraft';
import { VehicleKind } from '../../shared/src/sim/vehicleDefs';
import { knockPawn, newPawn, stepPawn } from '../../shared/src/sim/movement';

const log = document.getElementById('log')!;
const errors: string[] = [];
const report = (s: string) => { log.textContent += s + '\n'; };

async function main() {
  const q = new URLSearchParams(location.search);
  const t0 = performance.now();
  await Promise.all([loadAssets(), loadQuaternius(), loadKenneyCharacters(), loadTextureOverrides()]);
  const map = generateWorld(MAP_SEED);
  let x = Number(q.get('x') ?? map.spawn.x), z = Number(q.get('z') ?? map.spawn.z);
  const dname = q.get('district');
  if (dname) {
    const d = map.districts.find((d) => d.name === dname);
    if (d) [x, z] = centroid(d.poly);
  }
  const day = Number(q.get('day') ?? 0.42);
  const retro = q.get('retro') === '1';

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const msg = `${gl.getProgramInfoLog(program)}\nVS: ${gl.getShaderInfoLog(vs)}\nFS: ${gl.getShaderInfoLog(fs)}`;
    errors.push(msg);
    report('SHADERFEHLER: ' + msg.slice(0, 3000));
  };
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ratio = retro ? 0.6 : 1;
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  U.uResolution.value.set(innerWidth * ratio, innerHeight * ratio);

  const scene = new THREE.Scene();
  const rig = new CameraRig(innerWidth / innerHeight);
  const sky = new Sky(scene, true);
  const world = new WorldView(map, generateVegetation(map, MAP_SEED));
  const views = new EntityViews(map);
  const particles = new Particles(map);
  scene.add(world.group, views.group, particles.group);
  const post = new PostFX(renderer, scene, rig.camera);
  post.setSize(innerWidth, innerHeight, ratio);
  report(`Welt gebaut in ${Math.round(performance.now() - t0)} ms`);

  const zoom = Number(q.get('zoom') ?? 1);
  sky.setMood(moodFor(map.zoneAt(x, z), map.districtAt(x, z)?.style ?? null));
  // Fahrzeug-Vitrine: alle Klassen nebeneinander, eines mit Beulen + Teileschaden (?cars=1 = näher ran)
  const lineup = [...CAR_VARIANTS.keys(), 100];
  const props = new PropsView(map);
  const features = new FeaturesView(map);
  scene.add(props.group, features.group);
  const dentDemo = [[0.3, 0.1, 2.3, 0, 0, -1, 0.9], [-0.9, 0.2, 0.4, 1, 0, 0, 0.6]];
  let damaged = false;
  const ragdollDemo = q.get('ragdoll') === '1';
  const pawns = Array.from({ length: 6 }, (_, i) => newPawn(x - 5 + i * 2, z + 3, 0));
  let ragT = 0;
  const frame = (dt: number) => {
    views.beginFrame(dt);
    if (ragdollDemo) {
      // Ragdoll-Test: dieselbe Flug-Simulation wie auf dem Server, alle ~3,5 s wird reihum jemand umgefahren
      ragT += dt;
      pawns.forEach((p, i) => {
        if (p.rt <= 0 && ragT > 1 + i * 0.6 && (ragT - i * 0.6) % 3.5 < dt) {
          const ang = i * 1.7 + ragT;
          knockPawn(p, Math.sin(ang) * (6 + i * 2), Math.cos(ang) * (6 + i * 2), 4 + i, 1.9);
        }
        stepPawn(map, p, 0, 0, 0, dt);
        views.setPed({ id: i, x: p.x, z: p.z, a: p.a, color: i, running: false, h: p.h, ragdoll: p.rt > 0, cop: false, gang: false, angry: false }, dt);
      });
    } else {
      for (let i = 0; i < 6; i++) {
        const a = U.uTime.value * 0.3 + i;
        views.setPed({ id: i, x: x + Math.cos(a) * (4 + i), z: z + Math.sin(a) * (4 + i), a: a + Math.PI / 2, color: i, running: false, h: 0, ragdoll: false, cop: false, gang: false, angry: i === 2 }, dt);
      }
    }
    if (q.get('air') === '1') {
      // Luftfahrzeug-Vitrine: alle Typen nebeneinander, Rotoren laufen; ?alt= hebt sie an
      const alt = Number(q.get('alt') ?? 0);
      AIRCRAFT.forEach((d, k) => {
        const vx = x - 36 + k * 18, vz = z - 4;
        const qq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + 0.4);
        views.setVehicle({ id: 300 + k, kind: d.type === 'heli' ? VehicleKind.Heli : VehicleKind.Plane, variant: d.variant, color: 0, driver: -1, x: vx, y: map.surfaceY(vx, vz) + (k % 2 ? alt : alt * 0.4), z: vz, q: qq, vx: 0, vz: 0, steer: 0, flags: 0, rpm: 5000 }, dt);
      });
    } else lineup.forEach((variant, k) => {
      const vx = x - 28 + (k % 12) * 5, vz = z - 6 - Math.floor(k / 12) * 9;
      const kind = variant === 100 ? 1 : 0;
      const prof = profileOf(variant);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5 + Math.sin(U.uTime.value * 0.4 + k) * 0.2);
      views.setVehicle({ id: 200 + k, kind, variant, color: k % 10, driver: -1, x: vx, y: map.surfaceY(vx, vz) + prof.cgHeight, z: vz, q, vx: 0, vz: 0, steer: Math.sin(U.uTime.value) * 0.4, flags: k % 3 === 0 ? 1 : 0 }, dt);
    });
    if (!damaged) {
      damaged = true;
      for (const d of dentDemo) views.dent(201, d);
      views.setDamage(201, (1 << 0) | (2 << 4) | (1 << 8), 1, 1, 0, false, 0, 0);
    }
    views.endFrame();
    rig.update(x, map.surfaceY(x, z), z, 0, 0, 0, zoom > 1, dt);
    U.uTime.value += dt;
    sky.update(day, rig.target, 1);
    world.update(rig.target.x, rig.target.z);
    world.setNight(sky.night);
    world.setLight(sky.light);
    props.setNight(sky.night);
    props.update(dt);
    views.night = sky.night;
    views.sunDir.copy(sky.sun.position).sub(sky.sun.target.position).normalize();
    views.setFocus(rig.target);
    views.setCamera(rig.camera);
    particles.update(dt, rig.target);
    U.uOutlineScale.value = rig.zoom * (U.uResolution.value.y / 720);
    post.update(sky.mood, sky.night);
    post.render();
  };
  renderer.info.autoReset = false;
  for (let i = 0; i < 4; i++) { renderer.info.reset(); frame(0.05); }
  const info = renderer.info;
  report(`Draw-Calls: ${info.render.calls}, Dreiecke: ${info.render.triangles}, Programme: ${info.programs?.length}`);
  report(errors.length ? `FEHLER: ${errors.length}` : 'OK – keine Shaderfehler');
  (window as unknown as Record<string, unknown>).__dbg = { views, scene, renderer };
  document.body.dataset.done = '1';
  let last = performance.now();
  const loop = (now: number) => { frame(Math.max(0, Math.min(0.1, (now - last) / 1000))); last = now; requestAnimationFrame(loop); };
  if (q.get('still') !== '1') requestAnimationFrame(loop);
}

main().catch((e) => { report('FEHLER: ' + (e as Error).stack); document.body.dataset.done = '1'; });
