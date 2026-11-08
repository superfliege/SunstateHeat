// Fahrspaß-Orte sichtbar machen: Rampen/Sprungschanzen (Baustellen, Strand, Testgelände),
// das Testgelände (Asphaltplatte, Rundkurs, Crash-Mauern, Nassfläche, Schilder) und die
// Werkstätten (Reparatur-Markierung). Die Daten kommen aus shared/world/features.ts.
import * as THREE from 'three';
import { groundHeight } from '../../../shared/src/sim/car';
import {
  inTestTrack, TEST_TRACK, TRACK_LOOP, TRACK_LOOP_WIDTH, TRACK_PAD, TRACK_PATCHES, TRACK_WALLS, TRACK_WET, type Ramp,
} from '../../../shared/src/world/features';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { box, merge } from './geom';
import { addOutline, LINE } from './materials/toon';
import { toonVC } from './models';

const ASPHALT = 0x3a3842, STRIPE_A = 0xffd23a, STRIPE_B = 0x22222a, CONCRETE = 0xbdb8c4, WOOD = 0xb07a45;

/** Keil-Geometrie einer Rampe (lokal: Auffahrt entlang +z, Fuß bei z=0). */
function rampGeometry(r: Ramp, wood: boolean): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [];
  const c = new THREE.Color();
  const tri = (a: number[], b: number[], d: number[], hex: number) => {
    c.setHex(hex);
    for (const p of [a, b, d]) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); }
  };
  const quad = (a: number[], b: number[], d: number[], e: number[], hex: number) => { tri(a, b, d, hex); tri(a, d, e, hex); };
  const hw = r.w / 2, L = r.len, H = r.h;
  // Oberfläche in Streifen (Bretter / Warnstreifen an der Kante)
  const n = 8;
  for (let i = 0; i < n; i++) {
    const z0 = (i / n) * L, z1 = ((i + 1) / n) * L;
    const y0 = (z0 / L) * H, y1 = (z1 / L) * H;
    const hex = i === n - 1 ? STRIPE_A : wood ? (i % 2 ? WOOD : 0xa06c3a) : (i % 2 ? CONCRETE : 0xaaa5b2);
    quad([hw, y0, z0], [-hw, y0, z0], [-hw, y1, z1], [hw, y1, z1], hex);
  }
  // Seiten
  for (const sx of [1, -1]) {
    const a = [sx * hw, 0, 0], b = [sx * hw, 0, L], d = [sx * hw, H, L];
    if (sx > 0) tri(a, b, d, wood ? 0x8a5a30 : 0x9a96a4); else tri(b, a, d, wood ? 0x8a5a30 : 0x9a96a4);
  }
  // Rückwand mit Warnstreifen
  const m = 6;
  for (let i = 0; i < m; i++) {
    const x0 = -hw + (i / m) * r.w, x1 = -hw + ((i + 1) / m) * r.w;
    quad([x0, 0, L], [x1, 0, L], [x1, H, L], [x0, H, L], i % 2 ? STRIPE_A : STRIPE_B);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function label(text: string, color = '#ffffff', w = 512): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = w; c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.font = 'italic 900 56px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = '#1a1030';
  ctx.strokeText(text, w / 2, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 48);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(w / 40, 96 / 40, 1);
  return s;
}

export class FeaturesView {
  readonly group = new THREE.Group();
  private workshopRings: THREE.Mesh[] = [];
  private time = 0;

  constructor(private map: WorldMap) {
    this.buildRamps();
    this.buildTestTrack();
    this.buildWorkshops();
  }

  private buildRamps() {
    const parts: THREE.BufferGeometry[] = [];
    for (const r of this.map.ramps) {
      const g = rampGeometry(r, !inTestTrack(r.x, r.z));
      // Fuß auf Bodenhöhe (ohne Rampe) – Rampenhöhe kommt in der Physik oben drauf
      const y = this.map.surfaceY(r.x + Math.sin(r.rot) * r.len / 2, r.z + Math.cos(r.rot) * r.len / 2);
      g.rotateY(r.rot);
      g.translate(r.x, y, r.z);
      parts.push(g);
    }
    if (!parts.length) return;
    const mesh = new THREE.Mesh(merge(parts), toonVC);
    mesh.castShadow = mesh.receiveShadow = true;
    addOutline(mesh, LINE.prop);
    this.group.add(mesh);
  }

  private buildTestTrack() {
    const T = TEST_TRACK;
    const parts: THREE.BufferGeometry[] = [];
    const flat: THREE.BufferGeometry[] = [];
    const y0 = this.map.terrainHeight(T.x0 + T.w / 2, T.z0 + T.d / 2);
    const quad = (x0: number, z0: number, x1: number, z1: number, y: number, color: number) => {
      flat.push(box(x1 - x0, 0.02, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, color));
    };
    // Asphaltplatte mit Slalom-Markierungen
    const [px0, pz0, px1, pz1] = TRACK_PAD;
    quad(T.x0 + px0, T.z0 + pz0, T.x0 + px1, T.z0 + pz1, y0 + 0.03, ASPHALT);
    for (let x = px0 + 6; x < px1 - 4; x += 8) quad(T.x0 + x, T.z0 + (pz0 + pz1) / 2 - 0.15, T.x0 + x + 4, T.z0 + (pz0 + pz1) / 2 + 0.15, y0 + 0.055, 0xf4f1e8);
    // Rundkurs als Band
    for (let i = 0; i < TRACK_LOOP.length - 1; i++) {
      const [ax, az] = TRACK_LOOP[i], [bx, bz] = TRACK_LOOP[i + 1];
      const len = Math.hypot(bx - ax, bz - az), rot = Math.atan2(bx - ax, bz - az);
      const g = box(TRACK_LOOP_WIDTH, 0.02, len + TRACK_LOOP_WIDTH * 0.6, 0, y0 + 0.035, 0, ASPHALT);
      g.rotateY(rot);
      g.translate(T.x0 + (ax + bx) / 2, 0, T.z0 + (az + bz) / 2);
      flat.push(g);
      // Curbs rot/weiß an den Rändern
      for (const side of [-1, 1]) {
        const c = box(0.5, 0.06, len, side * (TRACK_LOOP_WIDTH / 2 - 0.25), y0 + 0.04, 0, i % 2 ? 0xe23a3a : 0xf4f4f4);
        c.rotateY(rot);
        c.translate(T.x0 + (ax + bx) / 2, 0, T.z0 + (az + bz) / 2);
        flat.push(c);
      }
    }
    // Nagelband: dunkles Band mit silbernen Spitzen
    for (const [sx0, sz0, sx1, sz1] of this.map.spikes) {
      flat.push(box(sx1 - sx0, 0.05, sz1 - sz0, (sx0 + sx1) / 2, y0 + 0.04, (sz0 + sz1) / 2, 0x2a2a30));
      for (let zz = sz0 + 0.3; zz < sz1; zz += 0.6) for (const xx of [sx0 + 0.3, sx1 - 0.3]) {
        const c = new THREE.ConeGeometry(0.12, 0.25, 4).toNonIndexed();
        c.translate(xx, y0 + 0.2, zz);
        const n = c.getAttribute('position').count, col = new Float32Array(n * 3).fill(0.8);
        c.setAttribute('color', new THREE.BufferAttribute(col, 3));
        c.deleteAttribute('uv');
        parts.push(c);
      }
    }
    // Nassfläche
    const [wx0, wz0, wx1, wz1] = TRACK_WET;
    quad(T.x0 + wx0, T.z0 + wz0, T.x0 + wx1, T.z0 + wz1, y0 + 0.06, 0x2a4a7a);
    // Mauern (Betonblöcke mit Warnstreifen)
    for (const [x0, z0, x1, z1] of TRACK_WALLS) {
      const h = 1.3;
      const cx = T.x0 + (x0 + x1) / 2, cz = T.z0 + (z0 + z1) / 2;
      parts.push(box(x1 - x0, h, z1 - z0, cx, y0, cz, CONCRETE));
      parts.push(box(x1 - x0 + 0.04, 0.25, z1 - z0 + 0.04, cx, y0 + h - 0.35, cz, 0xe23a3a));
    }
    const mesh = new THREE.Mesh(merge(parts), toonVC);
    mesh.castShadow = mesh.receiveShadow = true;
    addOutline(mesh, LINE.building);
    const ground = new THREE.Mesh(merge(flat), toonVC);
    ground.receiveShadow = true;
    ground.renderOrder = 1;
    this.group.add(mesh, ground);
    // Schilder
    const sign = label('TESTGELÄNDE', '#2af0e6', 768);
    sign.position.set(T.x0 + 85, y0 + 6, T.z0 + T.d + 4);
    this.group.add(sign);
    const add = (text: string, x: number, z: number, color = '#ffffff') => {
      const s = label(text, color);
      s.position.set(T.x0 + x, y0 + 3.5, T.z0 + z);
      s.scale.multiplyScalar(0.6);
      this.group.add(s);
    };
    add('DRIFT-PAD', 40, 30, '#ffa23a');
    add('NASS', (wx0 + wx1) / 2, (wz0 + wz1) / 2, '#5aa8ff');
    for (const p of TRACK_PATCHES) add(p.label.toUpperCase(), (p.rect[0] + p.rect[2]) / 2, (p.rect[1] + p.rect[3]) / 2, '#ffe14d');
    add('CRASH', 88, 72, '#ff4f9a');
    add('RUNDKURS', 90, 124);
    add('NAGELBAND', 61, 106, '#ff3a4a');
  }

  private buildWorkshops() {
    const ringGeo = new THREE.RingGeometry(5.6, 7, 32).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 1.5), transparent: true, opacity: 0.55, depthWrite: false });
    for (const w of this.map.workshops) {
      const ring = new THREE.Mesh(ringGeo, mat);
      ring.position.set(w.x, groundHeight(this.map, w.x, w.z) + 0.07, w.z);
      ring.renderOrder = 2;
      this.workshopRings.push(ring);
      const s = label('🔧 WERKSTATT', '#2af0e6');
      s.position.set(w.x, ring.position.y + 4, w.z);
      s.scale.multiplyScalar(0.5);
      this.group.add(ring, s);
    }
  }

  update(dt: number) {
    this.time += dt;
    const k = 1 + Math.sin(this.time * 3) * 0.04;
    for (const r of this.workshopRings) r.scale.set(k, 1, k);
  }
}
