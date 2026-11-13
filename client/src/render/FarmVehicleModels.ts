// Prozedurale Low-Poly-Modelle der Land- und Bergfahrzeuge (Traktoren mit Anbaugeräten, Mähdrescher,
// Pick-ups, Quad, Buggy, Milch-/Vieh-/Holztransporter, Muldenkipper, Rasenmäher, Wohnmobil, Sheriff).
// Gleiches Template-Format wie CarModel.ts (eine Geometrie + Lichter, Räder als Instanzen); die
// Räder dürfen je Achse unterschiedlich groß sein (Traktor: kleine Vorder-, große Hinterräder).
// Lokal: +x = links, +y = oben, +z = vorne, Ursprung = Schwerpunkt. Erfundene Marken, keine Logos.
import * as THREE from 'three';
import { derive, type HandlingProfile } from '../../../shared/src/sim/handling';
import { PART_COUNT } from '../../../shared/src/sim/damage';
import { computeOutlineNormals } from './materials/toon';
import { palmaraize } from './palette';
import type { CarTemplate } from './CarModel';

const DARK = 0x1c1c22, GLASS = 0x2a4a66, CHROME = 0xc9ccd6, RUBBER = 0x26262a, RUST = 0x9a4a2a, WOOD = 0x9a7652, HAY = 0xe8c860;
const HEAD = 0xfff6c8, TAIL = 0xff2a3a;
const SH = { paint: 0.9, glass: 1.3, chrome: 1.6, rubber: 0 };

interface Range { start: number; count: number }

class B {
  pos: number[] = []; col: number[] = []; shine: number[] = [];
  private c = new THREE.Color();
  get count() { return this.pos.length / 3; }
  tri(a: number[], b: number[], c: number[], color: number, shine: number) {
    this.c.setHex(palmaraize(color));
    for (const p of [a, b, c]) { this.pos.push(p[0], p[1], p[2]); this.col.push(this.c.r, this.c.g, this.c.b); this.shine.push(shine); }
  }
  quad(a: number[], b: number[], c: number[], d: number[], color: number, shine: number) { this.tri(a, b, c, color, shine); this.tri(a, c, d, color, shine); }
  /** Quader (x0..x1, y0..y1, z0..z1), Boden weggelassen. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, shine = SH.paint, top = color) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, shine);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, shine);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, shine);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, shine);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, shine);
  }
  /** Liegender Zylinder entlang z (Tank, Silo-Anhänger) oder x (Walze). */
  cylZ(x: number, y: number, r: number, z0: number, z1: number, color: number, seg = 10) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, z: number) => [x + Math.cos(a) * r, y + Math.sin(a) * r, z];
      this.quad(p(a0, z0), p(a1, z0), p(a1, z1), p(a0, z1), color, SH.paint);
      this.tri([x, y, z1], p(a0, z1), p(a1, z1), color, SH.paint);
      this.tri([x, y, z0], p(a1, z0), p(a0, z0), color, SH.paint);
    }
  }
  /** Statisches Rad (z. B. Anhängerachse ohne Physik-Rad): Scheibe entlang x. */
  wheel(x: number, y: number, z: number, r: number, w: number) {
    const seg = 10;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a: number, xx: number) => [xx, y + Math.sin(a) * r, z + Math.cos(a) * r];
      this.quad(p(a0, x - w / 2), p(a1, x - w / 2), p(a1, x + w / 2), p(a0, x + w / 2), RUBBER, 0);
      this.tri([x + w / 2 + 0.01, y, z], p(a0, x + w / 2 + 0.01), p(a1, x + w / 2 + 0.01), 0xc8c0a8, SH.chrome);
      this.tri([x - w / 2 - 0.01, y, z], p(a1, x - w / 2 - 0.01), p(a0, x - w / 2 - 0.01), 0xc8c0a8, SH.chrome);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('shine', new THREE.Float32BufferAttribute(this.shine, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Fahrerkabine mit Scheiben (offen = nur Rahmen + Dach). */
function cab(b: B, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, open = false) {
  const t = 0.09;
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) b.box(x - t, x + t, y0, y1, z - t, z + t, DARK, SH.paint);
  b.box(x0 - 0.12, x1 + 0.12, y1, y1 + 0.12, z0 - 0.15, z1 + 0.15, color);
  if (!open) {
    b.quad([x0, y0 + 0.5, z1], [x1, y0 + 0.5, z1], [x1, y1, z1], [x0, y1, z1], GLASS, SH.glass);
    b.quad([x1, y0 + 0.5, z0], [x0, y0 + 0.5, z0], [x0, y1, z0], [x1, y1, z0], GLASS, SH.glass);
    b.quad([x1, y0 + 0.5, z1], [x1, y0 + 0.5, z0], [x1, y1, z0], [x1, y1, z1], GLASS, SH.glass);
    b.quad([x0, y0 + 0.5, z0], [x0, y0 + 0.5, z1], [x0, y1, z1], [x0, y1, z0], GLASS, SH.glass);
  }
}

/** Rundballen (liegend, Achse x). */
function bale(b: B, x: number, y: number, z: number, r = 0.6, w = 1.1) {
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a: number, xx: number) => [xx, y + Math.sin(a) * r, z + Math.cos(a) * r];
    b.quad(p(a0, x - w / 2), p(a1, x - w / 2), p(a1, x + w / 2), p(a0, x + w / 2), HAY, 0.2);
    b.tri([x + w / 2, y, z], p(a0, x + w / 2), p(a1, x + w / 2), 0xd8b450, 0.2);
    b.tri([x - w / 2, y, z], p(a1, x - w / 2), p(a0, x - w / 2), 0xd8b450, 0.2);
  }
}

type Wheel = { x: number; z: number; r: number; w: number };

/** Baut das Modell; null = unbekannter Modellname. */
export function buildFarmVehicle(p: HandlingProfile, model: string, paintIn: number): CarTemplate | null {
  if (!model.startsWith('farm_')) return null;
  const b = new B();
  const d = derive(p);
  const g0 = -p.cgHeight, L = p.length, hw = p.width / 2;
  const [[, zf], , [, zr]] = d.wheels;
  const tr = p.track / 2;
  // Radgrößen je Achse (Physik nutzt p.wheelRadius; EntityViews gleicht die Höhe aus)
  let rf = p.wheelRadius, rr = p.wheelRadius, wf = Math.min(0.4, p.wheelRadius * 0.7), wr = wf;
  let paint = paintIn;
  let exhaust = new THREE.Vector3(hw * 0.4, g0 + 1.6, zf - 0.2);
  let lightsZ = [L / 2 + 0.02, -L / 2 - 0.02], lightsY = g0 + 1.0, lightsX = hw * 0.6;
  const y = (h: number) => g0 + h;

  /** Traktor-Grundkörper vorne ab zFront: Motorhaube, Kabine, Kotflügel. */
  const tractor = (zFront: number, zRearAxle: number, color: number, scale: number, open: boolean, old = false) => {
    const s = scale;
    const hoodW = 0.55 * s, hoodTop = y(old ? 1.25 * s : 1.45 * s);
    // Rahmen + Motorhaube
    b.box(-hoodW, hoodW, y(0.55 * s), hoodTop, zRearAxle + 0.3 * s, zFront, color);
    if (old) b.cylZ(0, hoodTop - 0.05, hoodW * 0.95, zRearAxle + 0.6 * s, zFront - 0.1, color, 8);
    b.box(-hoodW * 0.85, hoodW * 0.85, y(0.65 * s), hoodTop - 0.15, zFront, zFront + 0.08, DARK, SH.chrome); // Kühlergrill
    // Kotflügel über den Hinterrädern
    for (const sx of [1, -1]) b.box(sx > 0 ? tr - 0.35 * s : -tr - 0.35 * s, sx > 0 ? tr + 0.35 * s : -tr + 0.35 * s, y(rr * 2 + 0.05), y(rr * 2 + 0.15), zRearAxle - rr * 0.9, zRearAxle + rr * 0.9, color);
    // Sitz und Kabine
    b.box(-0.35 * s, 0.35 * s, y(1.0 * s), y(1.45 * s), zRearAxle - 0.4 * s, zRearAxle + 0.2 * s, DARK, 0);
    cab(b, -0.7 * s, 0.7 * s, y(1.2 * s), y(old ? 2.2 * s : 2.75 * s), zRearAxle - 0.7 * s, zRearAxle + 0.75 * s, old ? color : 0xf4f1e8, open);
    // Auspuff
    b.box(hoodW * 0.4, hoodW * 0.4 + 0.12, hoodTop, hoodTop + 0.9 * s, zFront - 0.6 * s, zFront - 0.48 * s, old ? RUST : DARK, SH.chrome);
    exhaust = new THREE.Vector3(hoodW * 0.46, hoodTop + 0.9 * s, zFront - 0.54 * s);
    lightsZ = [zFront + 0.09, zRearAxle - 0.8 * s]; lightsY = hoodTop - 0.3; lightsX = hoodW * 0.6;
  };

  switch (model) {
    case 'farm_tractor_small': {
      paint = 0xe8862a; rf = 0.4; rr = 0.62; wf = 0.28; wr = 0.4;
      tractor(L / 2 - 0.05, zr, paint, 0.8, true);
      break;
    }
    case 'farm_tractor_big': {
      paint = 0x2e8a3a; rf = 0.62; rr = 0.98; wf = 0.42; wr = 0.6;
      tractor(L / 2 - 0.1, zr, paint, 1.05, false);
      b.box(-1.0, 1.0, y(0.4), y(0.55), L / 2 - 0.1, L / 2 + 0.05, 0x3a3a40); // Frontgewicht
      break;
    }
    case 'farm_tractor_old': {
      paint = 0xc0392b; rf = 0.36; rr = 0.85; wf = 0.24; wr = 0.36;
      tractor(L / 2 - 0.05, zr, paint, 0.9, true, true);
      break;
    }
    case 'farm_tractor_hay': case 'farm_tractor_cattle': case 'farm_tractor_slurry': case 'farm_tractor_plow': case 'farm_tractor_crates': {
      // Physik-Räder: vorne = Traktor-Vorderachse, hinten = Anhängerachse; die großen Traktor-Hinterräder sind Teil des Körpers
      paint = model === 'farm_tractor_hay' ? 0xe8862a : 0x2e8a3a; rf = 0.55; rr = 0.5; wf = 0.38; wr = 0.36;
      const tAxle = zf - 2.5;
      tractor(L / 2 - 0.05, tAxle, paint, 0.95, model === 'farm_tractor_hay');
      for (const sx of [1, -1]) b.wheel(sx * (tr + 0.1), y(0.92), tAxle, 0.92, 0.55);
      // Deichsel
      b.box(-0.1, 0.1, y(0.6), y(0.75), tAxle - 2.0, tAxle - 0.6, DARK);
      const t0 = -L / 2 + 0.1, t1 = tAxle - 1.6;
      if (model === 'farm_tractor_hay') {
        b.box(-1.25, 1.25, y(0.9), y(1.05), t0, t1, WOOD);
        for (let z = t0 + 0.7; z < t1 - 0.5; z += 1.3) for (const sx of [-0.62, 0.62]) bale(b, sx, y(1.65), z, 0.6, 1.15);
        bale(b, 0, y(2.75), (t0 + t1) / 2, 0.6, 1.15);
      } else if (model === 'farm_tractor_cattle') {
        b.box(-1.2, 1.2, y(0.7), y(2.6), t0, t1, 0xb8b0a0, SH.chrome);
        for (let z = t0 + 0.3; z < t1; z += 0.6) b.box(-1.22, 1.22, y(1.6), y(2.2), z, z + 0.25, DARK, 0); // Lüftungsschlitze
      } else if (model === 'farm_tractor_slurry') {
        b.cylZ(0, y(1.6), 0.95, t0, t1, 0x2e6a3a, 12);
        b.box(-0.6, 0.6, y(0.55), y(0.8), t0 - 0.3, t0 + 0.2, DARK); // Prallteller
      } else if (model === 'farm_tractor_plow') {
        // Volldrehpflug: Rahmen schräg, Pflugkörper
        b.box(-0.12, 0.12, y(0.6), y(0.85), t0 + 0.5, t1, 0xc0392b);
        for (let k = 0; k < 4; k++) {
          const z = t0 + 0.5 + k * ((t1 - t0 - 0.6) / 4), x = -0.8 + k * 0.45;
          b.box(x - 0.25, x + 0.25, y(0.05), y(0.65), z, z + 0.4, 0xc9ccd6, SH.chrome);
        }
      } else {
        b.box(-1.25, 1.25, y(0.9), y(1.05), t0, t1, WOOD);
        for (let z = t0 + 0.4; z < t1 - 0.3; z += 0.75) for (const sx of [-0.8, 0, 0.8]) {
          b.box(sx - 0.35, sx + 0.35, y(1.05), y(1.5), z - 0.3, z + 0.3, WOOD);
          b.box(sx - 0.3, sx + 0.3, y(1.5), y(1.6), z - 0.25, z + 0.25, 0xffa23a); // Orangen obenauf
        }
      }
      break;
    }
    case 'farm_combine': {
      paint = 0xe0b020; rf = 0.85; rr = 0.5; wf = 0.7; wr = 0.4;
      // Rumpf, Korntank, Kabine vorne, Schneidwerk (sehr breit) und Abtankrohr
      b.box(-1.4, 1.4, y(0.7), y(3.0), zr - 0.6, zf + 0.9, paint);
      b.box(-1.2, 1.2, y(3.0), y(3.7), zr - 0.2, zf - 0.5, paint);
      cab(b, -0.9, 0.9, y(2.4), y(3.8), zf + 0.2, zf + 1.6, paint);
      b.box(-hw, hw, y(0.25), y(1.0), L / 2 - 1.3, L / 2, 0xc8a018);
      for (let x = -hw + 0.2; x < hw; x += 0.5) b.box(x, x + 0.06, y(0.25), y(0.4), L / 2 - 0.05, L / 2 + 0.25, CHROME, SH.chrome); // Halmteiler
      b.cylZ(0, y(1.2), 0.45, L / 2 - 1.2, L / 2 - 0.2, 0xd8b020, 8); // Haspel (vereinfacht)
      b.box(1.4, 3.8, y(3.2), y(3.45), zr + 0.4, zr + 0.7, DARK); // Abtankrohr seitlich
      exhaust = new THREE.Vector3(-0.8, y(3.9), zr);
      lightsZ = [zf + 1.65, zr - 0.62]; lightsY = y(3.2); lightsX = 0.8;
      break;
    }
    case 'farm_pickup_rusty': case 'farm_pickup_hay': case 'farm_pickup_ranger': case 'farm_pickup_sheriff': {
      const rusty = model === 'farm_pickup_rusty' || model === 'farm_pickup_hay';
      paint = model === 'farm_pickup_ranger' ? 0x3e6a3a : model === 'farm_pickup_sheriff' ? 0xf2ece0 : model === 'farm_pickup_hay' ? 0x5a8ab8 : 0xa85a3a;
      const zc = L / 2 - 1.6;
      b.box(-hw, hw, y(0.45), y(1.2), zc, L / 2, paint); // Motorhaube
      b.box(-hw, hw, y(0.45), y(1.25), zc - 1.6, zc, paint);
      b.box(-hw + 0.1, hw - 0.1, y(1.25), y(1.95), zc - 1.4, zc - 0.05, paint);
      b.quad([-hw + 0.1, y(1.3), zc - 0.04], [hw - 0.1, y(1.3), zc - 0.04], [hw - 0.1, y(1.9), zc - 0.04], [-hw + 0.1, y(1.9), zc - 0.04], GLASS, SH.glass);
      for (const sx of [1, -1]) b.quad([sx * (hw - 0.09), y(1.32), zc - 1.3], [sx * (hw - 0.09), y(1.32), zc - 0.15], [sx * (hw - 0.09), y(1.88), zc - 0.15], [sx * (hw - 0.09), y(1.88), zc - 1.3], GLASS, SH.glass);
      // Ladefläche
      const bz0 = -L / 2, bz1 = zc - 1.6;
      b.box(-hw, hw, y(0.45), y(0.7), bz0, bz1, rusty ? RUST : paint);
      for (const sx of [1, -1]) b.box(sx > 0 ? hw - 0.08 : -hw, sx > 0 ? hw : -hw + 0.08, y(0.7), y(1.2), bz0, bz1, paint);
      b.box(-hw, hw, y(0.7), y(1.2), bz0, bz0 + 0.08, paint);
      b.box(-hw - 0.05, hw + 0.05, y(0.35), y(0.6), L / 2, L / 2 + 0.15, CHROME, SH.chrome);
      if (rusty) for (const [x, z] of [[hw * 0.5, L / 2 - 0.6], [-hw * 0.3, zc - 1.0], [hw * 0.8, bz0 + 0.8]]) b.box(x - 0.25, x + 0.25, y(1.21), y(1.27), z - 0.2, z + 0.25, RUST, 0); // Rostflecken
      if (model === 'farm_pickup_hay') for (const z of [bz0 + 0.7, bz0 + 1.7]) for (const sx of [-0.45, 0.45]) b.box(sx - 0.42, sx + 0.42, y(0.7), y(1.3), z - 0.45, z + 0.45, HAY, 0.2);
      if (model === 'farm_pickup_sheriff' || model === 'farm_pickup_ranger') {
        b.box(-0.6, -0.05, y(1.95), y(2.1), zc - 0.8, zc - 0.5, model === 'farm_pickup_sheriff' ? 0x3a6bff : 0xffb020, SH.glass);
        b.box(0.05, 0.6, y(1.95), y(2.1), zc - 0.8, zc - 0.5, model === 'farm_pickup_sheriff' ? 0xff3a4a : 0xffb020, SH.glass);
        // Stern-/Abzeichen-Streifen an der Tür
        for (const sx of [1, -1]) b.box(sx > 0 ? hw - 0.01 : -hw - 0.02, sx > 0 ? hw + 0.02 : -hw + 0.01, y(0.75), y(0.95), zc - 1.4, zc - 0.2, model === 'farm_pickup_sheriff' ? 0x8a6a2a : 0xe8d8a0, 0.4);
      }
      lightsZ = [L / 2 + 0.02, bz0 - 0.02]; lightsY = y(0.9); lightsX = hw * 0.65;
      exhaust = new THREE.Vector3(hw * 0.5, y(0.35), -L / 2 - 0.1);
      break;
    }
    case 'farm_quad': {
      paint = 0x6a8a3a;
      b.box(-0.45, 0.45, y(0.45), y(0.85), -0.7, 0.8, paint);
      b.box(-0.55, 0.55, y(0.75), y(0.85), 0.4, 1.0, paint); b.box(-0.55, 0.55, y(0.75), y(0.85), -1.0, -0.45, paint);
      b.box(-0.18, 0.18, y(0.85), y(1.05), -0.45, 0.25, DARK, 0); // Sitz
      b.box(-0.45, 0.45, y(1.12), y(1.17), 0.45, 0.5, DARK, SH.chrome); // Lenker
      b.box(-0.04, 0.04, y(0.85), y(1.15), 0.42, 0.5, DARK);
      b.box(-0.5, 0.5, y(0.86), y(0.9), -1.0, -0.55, DARK); // Gepäckträger
      lightsZ = [1.02, -1.02]; lightsY = y(0.75); lightsX = 0.3;
      exhaust = new THREE.Vector3(0.3, y(0.6), -1.05);
      break;
    }
    case 'farm_buggy': {
      paint = 0xffd23a;
      b.box(-0.6, 0.6, y(0.4), y(0.7), -1.4, 1.5, paint);
      b.box(-0.35, 0.35, y(0.7), y(1.05), -1.5, -0.5, DARK); // Motor hinten
      // Überrollkäfig
      for (const [x0, z0, x1, z1] of [[-0.6, -0.4, -0.6, 0.6], [0.6, -0.4, 0.6, 0.6]]) { b.box(x0 - 0.05, x0 + 0.05, y(0.7), y(1.6), z0, z0 + 0.08, DARK); b.box(x1 - 0.05, x1 + 0.05, y(0.7), y(1.5), z1, z1 + 0.08, DARK); }
      b.box(-0.65, 0.65, y(1.5), y(1.6), -0.45, 0.68, DARK);
      b.box(-0.3, 0.3, y(0.7), y(1.0), -0.3, 0.2, 0x2a2a30, 0);
      lightsZ = [1.52, -1.52]; lightsY = y(0.6); lightsX = 0.45;
      break;
    }
    case 'farm_milk_tanker': case 'farm_cattle_truck': case 'farm_log_truck': case 'farm_semi': {
      paint = model === 'farm_milk_tanker' ? 0xf2f2f2 : model === 'farm_cattle_truck' ? 0x2e5a8a : model === 'farm_log_truck' ? 0x3e6a3a : 0x9a4a2a;
      const zc = L / 2 - 2.2;
      b.box(-hw, hw, y(0.6), y(1.6), zc, L / 2, paint); // Haube/Front
      b.box(-hw, hw, y(0.6), y(2.9), zc - 0.4, zc + 0.9, paint); // Kabine
      b.quad([-hw + 0.1, y(1.9), zc + 0.91], [hw - 0.1, y(1.9), zc + 0.91], [hw - 0.1, y(2.7), zc + 0.91], [-hw + 0.1, y(2.7), zc + 0.91], GLASS, SH.glass);
      b.box(-hw - 0.05, hw + 0.05, y(0.5), y(0.75), L / 2, L / 2 + 0.15, CHROME, SH.chrome);
      b.box(hw - 0.2, hw - 0.05, y(1.6), y(3.4), zc - 0.4, zc - 0.25, CHROME, SH.chrome); // Auspuffrohr
      exhaust = new THREE.Vector3(hw - 0.12, y(3.4), zc - 0.32);
      const t0 = -L / 2, t1 = zc - 0.6;
      b.box(-0.5, 0.5, y(0.6), y(0.9), t0, t1, DARK); // Rahmen
      if (model === 'farm_milk_tanker') { b.cylZ(0, y(1.85), 1.05, t0 + 0.2, t1, 0xe8e8ec, 14); b.box(-0.25, 0.25, y(2.9), y(3.05), (t0 + t1) / 2 - 0.4, (t0 + t1) / 2 + 0.4, CHROME, SH.chrome); }
      else if (model === 'farm_cattle_truck') { b.box(-hw, hw, y(0.9), y(3.0), t0, t1, 0xb8b0a0, SH.chrome); for (let z = t0 + 0.3; z < t1; z += 0.6) b.box(-hw - 0.02, hw + 0.02, y(2.0), y(2.6), z, z + 0.25, DARK, 0); }
      else if (model === 'farm_log_truck') {
        for (const z of [t0 + 0.4, t1 - 0.4]) for (const sx of [1, -1]) b.box(sx * hw - 0.08, sx * hw + 0.08, y(0.9), y(2.6), z, z + 0.15, DARK);
        for (let i = 0; i < 6; i++) { const x = -0.8 + (i % 3) * 0.8, yy = y(1.3 + Math.floor(i / 3) * 0.75); b.cylZ(x, yy, 0.36, t0 - 0.2, t1 + 0.2, 0x8a5a32, 7); }
      } else { b.box(-hw, hw, y(0.9), y(3.4), t0, t1, 0xe0d0b0); }
      lightsZ = [L / 2 + 0.16, -L / 2 - 0.02]; lightsY = y(1.0);
      break;
    }
    case 'farm_dump_truck': {
      paint = 0xe8b818;
      b.box(-hw, hw, y(1.2), y(2.2), -L / 2, L / 2, DARK);
      // Mulde (hinten hochgezogen)
      b.box(-hw, hw, y(2.2), y(3.9), -L / 2, L / 2 - 2.6, paint);
      b.box(-hw + 0.3, hw - 0.3, y(3.9), y(4.25), -L / 2 + 0.2, L / 2 - 2.0, paint);
      b.box(-hw + 0.4, hw - 0.4, y(3.6), y(3.95), -L / 2 + 0.4, L / 2 - 2.9, 0x8a8070, 0.1); // Ladung Kies
      // Kabine links vorne, Motorgrill
      cab(b, 0.3, hw - 0.1, y(2.2), y(3.9), L / 2 - 2.3, L / 2 - 0.4, paint);
      b.box(-hw + 0.2, 0.2, y(2.2), y(3.2), L / 2 - 2.4, L / 2, paint);
      exhaust = new THREE.Vector3(-0.4, y(3.6), L / 2 - 2.0);
      lightsZ = [L / 2 + 0.02, -L / 2 - 0.02]; lightsY = y(2.0); lightsX = hw * 0.7;
      break;
    }
    case 'farm_mower': {
      paint = 0x2e8a3a;
      b.box(-0.45, 0.45, y(0.3), y(0.62), -0.6, 0.95, paint);
      b.box(-0.55, 0.55, y(0.12), y(0.3), -0.1, 0.6, 0x3a3a40); // Mähwerk
      b.box(-0.25, 0.25, y(0.62), y(1.05), -0.75, -0.35, 0xf2c418, 0); // Sitz
      b.box(-0.03, 0.03, y(0.62), y(1.05), 0.3, 0.36, DARK); b.box(-0.2, 0.2, y(1.02), y(1.06), 0.28, 0.4, DARK); // Lenkrad
      lightsZ = [0.96, -0.62]; lightsY = y(0.5); lightsX = 0.25;
      break;
    }
    case 'farm_rv': {
      paint = 0xf2ece0;
      b.box(-hw, hw, y(0.5), y(3.2), -L / 2, L / 2 - 1.4, paint);
      b.box(-hw, hw, y(0.5), y(1.6), L / 2 - 1.4, L / 2, paint);
      b.box(-hw, hw, y(2.4), y(3.2), L / 2 - 1.4, L / 2 - 0.6, paint); // Alkoven
      b.quad([-hw + 0.1, y(1.6), L / 2 - 1.39], [hw - 0.1, y(1.6), L / 2 - 1.39], [hw - 0.1, y(2.35), L / 2 - 1.39], [-hw + 0.1, y(2.35), L / 2 - 1.39], GLASS, SH.glass);
      for (const sx of [1, -1]) b.box(sx > 0 ? hw - 0.01 : -hw - 0.02, sx > 0 ? hw + 0.02 : -hw + 0.01, y(1.3), y(1.55), -L / 2 + 0.2, L / 2 - 1.5, 0xd85a3a, 0.4); // Zierstreifen
      for (const z of [-2, 0.5]) for (const sx of [1, -1]) b.box(sx > 0 ? hw - 0.01 : -hw - 0.02, sx > 0 ? hw + 0.02 : -hw + 0.01, y(1.8), y(2.5), z, z + 1.1, GLASS, SH.glass);
      b.box(-0.6, 0.6, y(3.2), y(3.45), -1.5, -0.4, 0xd8d8d8); // Dachklima
      lightsZ = [L / 2 + 0.02, -L / 2 - 0.02]; lightsY = y(1.0);
      break;
    }
    default:
      return null;
  }
  const wheels: Wheel[] = [
    { x: tr, z: zf, r: rf, w: wf }, { x: -tr, z: zf, r: rf, w: wf },
    { x: tr, z: zr, r: rr, w: wr }, { x: -tr, z: zr, r: rr, w: wr },
  ];
  const body = b.geometry();
  computeOutlineNormals(body);

  // Lichter: 0 VL, 1 VR, 2 HL, 3 HR, 4/5 Rückfahrlicht
  const lb = new B();
  const ranges: Range[] = [];
  for (const sx of [1, -1]) {
    const st = lb.count, x = sx * lightsX, z = lightsZ[0];
    lb.quad([x - 0.14, lightsY, z], [x + 0.14, lightsY, z], [x + 0.14, lightsY + 0.14, z], [x - 0.14, lightsY + 0.14, z], HEAD, 0);
    ranges.push({ start: st, count: 6 });
  }
  for (const sx of [1, -1]) {
    const st = lb.count, x = sx * lightsX, z = lightsZ[1];
    lb.quad([x + 0.12, lightsY, z], [x - 0.12, lightsY, z], [x - 0.12, lightsY + 0.12, z], [x + 0.12, lightsY + 0.12, z], TAIL, 0);
    ranges.push({ start: st, count: 6 });
  }
  ranges.push({ start: lb.count, count: 0 }, { start: lb.count, count: 0 });
  void paint;
  return {
    body, lights: lb.geometry(), parts: new Array(PART_COUNT).fill(null), glass: [[], [], [], []], lightRanges: ranges,
    wheels, wheelBaseY: d.mountY - d.rest,
    engine: new THREE.Vector3(0, g0 + 1.2, L / 2 - 1), exhaust: [exhaust], seatY: 0,
    cell: [-L / 2, L / 2, g0 + 0.3], bike: false,
  };
}
