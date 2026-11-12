// Bewegliches am Flughafen: Schranke am Haupteingang (öffnet für Fahrzeuge), Neon-Schriftzug am
// Terminal, Drehfeuer auf dem Tower, Windsack, Gepäckwagen auf dem Vorfeld und das Deko-Flugzeug
// (deterministisch aus der Serverzeit, siehe shared/src/world/airTraffic.ts).
import * as THREE from 'three';
import { AIRPORT_NAME, AIRPORT_BUILDINGS, STANDS } from '../../../shared/src/world/airport';
import { decoFlight } from '../../../shared/src/world/airTraffic';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { animateAircraft, buildDecoPlane, type AircraftParts } from './AircraftModel';
import { box, merge } from './geom';
import { addOutline, LINE } from './materials/toon';

interface Cart { root: THREE.Group; path: [number, number][]; len: number[]; total: number; s: number; speed: number }

export class AirportView {
  readonly group = new THREE.Group();
  private gateBoom: THREE.Object3D | null = null;
  private gateOpen = 0;
  private sign: THREE.Mesh;
  private signMat: THREE.MeshBasicMaterial;
  private beacon: THREE.Mesh;
  private deco: AircraftParts;
  private decoPrev = { y: 0 };
  private carts: Cart[] = [];

  constructor(private map: WorldMap, mat: THREE.Material, rotorMat: THREE.Material) {
    // Schranke: Häuschen + Schlagbaum (dreht um die Stütze)
    const g = map.airportGate;
    if (g) {
      const y = Math.max(0.05, map.terrainHeight(g.x, g.z));
      const half = g.w / 2;
      const booth = new THREE.Mesh(merge([
        box(2.2, 2.6, 2.2, 0, 0, 0, 0xf4efe6), box(2.6, 0.25, 2.6, 0, 2.6, 0, 0xff4fae), box(2.24, 0.9, 1.4, 0, 1.2, 0, 0x2a3f5c),
        box(0.35, 1.1, 0.35, 1.6, 0, 0, 0xf2c230),
      ]), mat);
      booth.position.set(g.x - half - 1.8, y, g.z);
      addOutline(booth, LINE.vehicle);
      const pivot = new THREE.Group();
      pivot.position.set(g.x - half + 0.2, y + 1.0, g.z);
      const boomParts = [];
      for (let k = 0; k < Math.ceil(g.w / 1.2); k++) boomParts.push(box(1.2, 0.18, 0.18, 0.6 + k * 1.2, -0.09, 0, k % 2 ? 0xffffff : 0xe0303a));
      const boom = new THREE.Mesh(merge(boomParts), mat);
      pivot.add(boom);
      this.group.add(booth, pivot);
      this.gateBoom = pivot;
    }
    // Neon-Schriftzug auf dem Terminaldach (nach Süden, zur Kamera)
    const term = AIRPORT_BUILDINGS.find((b) => b.tag === 'terminal')!;
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'italic 900 92px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff4fae'; ctx.shadowBlur = 24;
    ctx.fillStyle = '#ffd6ec';
    ctx.fillText(AIRPORT_NAME.toUpperCase(), 512, 70, 990);
    ctx.font = 'bold 34px Trebuchet MS, sans-serif';
    ctx.shadowColor = '#4ff2ff'; ctx.fillStyle = '#c8fbff';
    ctx.fillText('✈  WILLKOMMEN IN PALMARA  ✈', 512, 132, 900);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, fog: false });
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 4.7), this.signMat);
    const ty = Math.max(0.05, map.terrainHeight(term.x, term.z)) + term.h + 3.4;
    this.sign.position.set(term.x, ty, term.z + term.d / 2 - 2);
    this.sign.rotation.y = 0; // Vorderseite nach Süden (+z)
    const frame = new THREE.Mesh(merge([box(0.3, 3.2, 0.3, -12, -3.4, 0, 0x8a8a92), box(0.3, 3.2, 0.3, 12, -3.4, 0, 0x8a8a92)]), mat);
    frame.position.copy(this.sign.position);
    this.group.add(this.sign, frame);
    // Drehfeuer auf dem Tower
    const tower = AIRPORT_BUILDINGS.find((b) => b.tag === 'tower')!;
    this.beacon = new THREE.Mesh(merge([box(0.5, 0.5, 0.5, 0.35, 0, 0, 0x6dff9c), box(0.5, 0.5, 0.5, -0.35, 0, 0, 0xffffff)]), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    this.beacon.position.set(tower.x, Math.max(0.05, map.terrainHeight(tower.x, tower.z)) + tower.h + 0.2, tower.z);
    this.group.add(this.beacon);
    // Windsack zwischen den Bahnen (westlich)
    const sock = new THREE.Group();
    const pole = new THREE.Mesh(merge([box(0.15, 6, 0.15, 0, 0, 0, 0xdedede)]), mat);
    const cone = new THREE.Mesh(merge([box(0.9, 0.9, 1, 0, 5.2, 0.6, 0xff7a2f), box(0.75, 0.75, 1, 0, 5.27, 1.6, 0xffffff), box(0.6, 0.6, 1, 0, 5.35, 2.6, 0xff7a2f)]), mat);
    cone.rotation.y = 0.9;
    sock.add(pole, cone);
    sock.position.set(925, Math.max(0.05, map.terrainHeight(925, 1240)), 1300);
    this.group.add(sock);
    // Deko-Flugzeug
    this.deco = buildDecoPlane(mat, rotorMat);
    addOutline(this.deco.body, LINE.vehicle);
    this.deco.root.visible = false;
    this.group.add(this.deco.root);
    // Gepäckwagen: Schlepper + 3 Anhänger auf Rundkursen zwischen Terminal und Parkpositionen
    const p2 = STANDS[1], p4 = STANDS[3];
    this.addCart([[1097, 1212], [p2.x + 10, 1212], [p2.x + 10, 1232], [1097, 1232]], 4.2, 0);
    this.addCart([[1097, 1258], [p4.x + 10, 1258], [p4.x + 10, 1278], [1097, 1278]], 3.6, 0.5);
  }

  private addCart(path: [number, number][], speed: number, start: number) {
    const root = new THREE.Group();
    const tug = merge([box(1.4, 0.9, 2.2, 0, 0.25, 0, 0xffc020), box(1.2, 0.6, 0.8, 0, 1.15, -0.3, 0x2a3f5c), box(1.5, 0.12, 2.3, 0, 1.75, -0.3, 0xffc020)]);
    const m = new THREE.Mesh(tug, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true;
    root.add(m);
    for (let k = 1; k <= 3; k++) {
      const t = new THREE.Mesh(merge([
        box(1.4, 0.3, 2.0, 0, 0.35, -k * 2.6, 0x8a8a92),
        box(1.2, 0.7, 0.8, 0, 0.65, -k * 2.6 - 0.4, [0xc0392b, 0x2e86de, 0x27ae60, 0x6b4f2a][(k + Math.round(start * 10)) % 4]),
        box(1.0, 0.5, 0.7, 0.05, 0.65, -k * 2.6 + 0.45, [0x34495e, 0xf39c12, 0x8e44ad][k % 3]),
      ]), m.material);
      t.castShadow = true;
      root.add(t);
    }
    const len: number[] = [0];
    for (let i = 1; i <= path.length; i++) {
      const a = path[i - 1], b = path[i % path.length];
      len.push(len[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = len[len.length - 1];
    this.carts.push({ root, path, len, total, s: start * total, speed });
    this.group.add(root);
  }

  /** dt, Nacht 0..1, Serverzeit (ms), Fahrzeuge in der Nähe (für die Schranke), Kameraziel. */
  update(dt: number, night: number, serverNow: number, vehicles: Iterable<{ x: number; z: number }>, focus: THREE.Vector3) {
    // Schranke öffnet, wenn ein Fahrzeug nah ist
    const g = this.map.airportGate;
    if (g && this.gateBoom) {
      let near = false;
      for (const v of vehicles) if (Math.hypot(v.x - g.x, v.z - g.z) < 16) { near = true; break; }
      this.gateOpen += ((near ? 1 : 0) - this.gateOpen) * Math.min(1, dt * 3);
      this.gateBoom.rotation.z = this.gateOpen * 1.35;
    }
    const k = 0.75 + night * 0.9 + Math.sin(serverNow / 140) * 0.05 * night;
    this.signMat.color.setScalar(Math.min(1.6, k));
    this.beacon.rotation.y += dt * 3;
    this.beacon.visible = night > 0.25 || Math.floor(serverNow / 600) % 2 === 0;
    for (const c of this.carts) {
      c.s = (c.s + c.speed * dt) % c.total;
      let i = 1;
      while (i < c.len.length - 1 && c.len[i] < c.s) i++;
      const a = c.path[i - 1], b = c.path[i % c.path.length];
      const t = (c.s - c.len[i - 1]) / Math.max(0.01, c.len[i] - c.len[i - 1]);
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const want = Math.atan2(b[0] - a[0], b[1] - a[1]);
      let d = want - c.root.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.root.rotation.y += d * Math.min(1, dt * 3);
      c.root.position.set(x, Math.max(0.05, this.map.terrainHeight(x, z)) + 0.18, z);
    }
    // Deko-Flugzeug
    const pose = decoFlight(serverNow);
    const far = !pose || Math.hypot(pose.x - focus.x, pose.z - focus.z) > 700;
    this.deco.root.visible = !far;
    if (pose && !far) {
      const ground = Math.max(0.05, this.map.terrainHeight(pose.x, pose.z)) + (pose.phase === 'parked' || (pose.phase === 'taxi' && pose.runway < 0) ? 0.18 : 0.05);
      const y = pose.y + ground;
      const vy = dt > 0 ? (y - this.decoPrev.y) / dt : 0;
      this.decoPrev.y = y;
      this.deco.root.position.set(pose.x, y, pose.z);
      const pitch = pose.speed > 5 ? -Math.atan2(vy, pose.speed) * 0.8 : 0;
      this.deco.root.rotation.set(pitch, pose.a, 0, 'YXZ');
      animateAircraft(this.deco, pose.phase === 'parked' && pose.speed < 0.5 ? 0 : 1, dt, serverNow / 1000, night);
    }
  }
}
