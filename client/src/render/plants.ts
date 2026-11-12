// Prozedurale Pflanzen und Felsen (Ersatz, solange keine Quaternius-Packs vorliegen).
// Alle mit Vertex-Farben aus der Palette, Wind-Gewicht (Attribut `wind`) und – bei größeren
// Objekten – geglätteten Normalen für die Umrisslinie.
import * as THREE from 'three';
import { TreeType } from '../../../shared/src/world/WorldMap';
import { box, colored, cyl, ico, merge } from './geom';
import { addHeightWind, computeOutlineNormals } from './materials/toon';

const LEAF = [0x52b85a, 0x3f9a4a, 0x6cc060];

function finishPlant(g: THREE.BufferGeometry, start: number, strength: number, outline = true) {
  addHeightWind(g, start, strength);
  if (outline) computeOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ Bäume
export function treeGeometry(type: number): THREE.BufferGeometry {
  switch (type) {
    case TreeType.Palm: {
      // geschwungener Stamm mit Ringen, hängende Wedel aus zwei Segmenten
      const parts = [
        cyl(0.2, 0.28, 1.8, 6, 0, 0, 0, 0xa8865e),
        cyl(0.18, 0.2, 1.8, 6, 0.15, 1.75, 0, 0x8a6a46),
        cyl(0.16, 0.18, 1.8, 6, 0.38, 3.5, 0, 0xa8865e),
        cyl(0.14, 0.16, 1.6, 6, 0.65, 5.2, 0, 0x8a6a46),
      ];
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + (i % 2) * 0.2;
        for (let s = 0; s < 2; s++) {
          const seg = box(0.9 - s * 0.25, 0.06, 1.7, 0, 0, 0.85, LEAF[(i + s) % 3], 0, s === 0 ? -0.15 : 0.55);
          seg.translate(0, 0, s * 1.55);
          seg.rotateY(ang);
          seg.translate(0.75, 6.85 - s * 0.35, 0);
          parts.push(seg);
        }
      }
      parts.push(ico(0.3, 0.6, 6.7, 0.2, 0x6e4e32), ico(0.28, 0.9, 6.6, -0.1, 0x6e4e32));
      return finishPlant(merge(parts), 0.5, 1.2);
    }
    case TreeType.Pine:
      return finishPlant(merge([
        cyl(0.2, 0.28, 2.4, 5, 0, 0, 0, 0x7a4e32),
        cyl(0, 2.1, 3.0, 7, 0, 1.6, 0, 0x356f45),
        cyl(0, 1.7, 2.6, 7, 0, 3.0, 0, 0x3f7d4a),
        cyl(0, 1.2, 2.2, 7, 0, 4.4, 0, 0x4a8a50),
      ]), 0.3, 0.6);
    case TreeType.Orange:
      return finishPlant(merge([
        cyl(0.15, 0.2, 1.2, 5, 0, 0, 0, 0x6e4e32),
        ico(1.4, 0, 2.2, 0, 0x3f8f3a, 0.85),
        ico(0.9, 0.6, 2.7, 0.3, 0x52a850, 0.8),
        box(0.3, 0.3, 0.3, 0.9, 2.3, 0.6, 0xffa23a),
        box(0.3, 0.3, 0.3, -0.7, 2.6, -0.8, 0xffa23a),
        box(0.3, 0.3, 0.3, 0.2, 1.6, -1.1, 0xffa23a),
        box(0.3, 0.3, 0.3, -0.9, 1.8, 0.7, 0xffa23a),
      ]), 0.4, 0.5);
    case TreeType.Mangrove:
      return finishPlant(merge([
        box(0.1, 1.2, 0.1, 0.5, -0.6, 0.3, 0x5a4a32, 0, 0, 0.4),
        box(0.1, 1.2, 0.1, -0.5, -0.6, 0.2, 0x5a4a32, 0, 0, -0.4),
        box(0.1, 1.2, 0.1, 0, -0.6, -0.5, 0x5a4a32, 0, 0.4),
        cyl(0.15, 0.2, 1.6, 5, 0, 0, 0, 0x5a4a32),
        ico(1.6, 0, 2.2, 0, 0x356f45, 0.6),
        ico(1.0, 0.8, 2.6, 0.4, 0x52864a, 0.6),
      ]), 0.4, 0.5);
    case TreeType.Oak:
      // Laubbaum (Mischwald, Schattenbaum auf Höfen): kurzer Stamm, breite runde Krone
      return finishPlant(merge([
        cyl(0.22, 0.32, 2.2, 6, 0, 0, 0, 0x6e4e32),
        box(0.12, 1.2, 0.12, 0.4, 1.6, 0, 0x6e4e32, 0, 0, -0.6),
        ico(1.9, 0, 3.4, 0, 0x4a8a3a, 0.8),
        ico(1.3, 1.1, 3.9, 0.4, 0x5aa048, 0.8),
        ico(1.2, -1.0, 3.2, -0.6, 0x3f7d3a, 0.8),
      ]), 0.35, 0.55);
    default: // Zypresse
      return finishPlant(merge([
        cyl(0.25, 0.5, 1.4, 5, 0, -0.4, 0, 0x6b5a40),
        cyl(0.2, 1.1, 6, 7, 0, 0.8, 0, 0x4a6b32),
      ]), 0.3, 0.5);
  }
}

// ------------------------------------------------------------------ Bodendecker
export type CoverKind = 'grass' | 'grassDry' | 'bush' | 'rock' | 'reed' | 'fern' | 'flower' | 'lily' | 'cactus'
  // Höfe (instanziert, Zäune als 3-m-Segmente mit fester Drehung)
  | 'cane' | 'crop' | 'melon' | 'hay' | 'haySquare' | 'fenceWood' | 'fenceWire' | 'crate';

function blade(x: number, z: number, a: number, h: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    x - 0.06, 0, z, x + 0.06, 0, z, x + Math.cos(a) * 0.15, h, z + Math.sin(a) * 0.15,
  ], 3));
  // Normale nach oben -> von oben gleichmäßig hell (wie gemalt)
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const c = new THREE.Color(color);
  g.setAttribute('color', new THREE.Float32BufferAttribute([c.r, c.g, c.b, c.r, c.g, c.b, c.r * 1.15, c.g * 1.15, c.b * 1.1], 3));
  return g;
}

export function coverGeometry(kind: CoverKind): THREE.BufferGeometry {
  switch (kind) {
    case 'grass': case 'grassDry': {
      const cols = kind === 'grass' ? [0x6cc060, 0x52a850, 0x8fcc72] : [0xc8c46a, 0xb8b868, 0xd8cc88];
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(blade(Math.cos(a) * 0.12, Math.sin(a) * 0.12, a, 0.4 + (i % 3) * 0.12, cols[i % 3]));
        parts.push(blade(Math.cos(a) * 0.12, Math.sin(a) * 0.12, a + Math.PI / 2, 0.35, cols[(i + 1) % 3]).rotateY(Math.PI / 2));
      }
      return finishPlant(merge(parts), 0, 1.5, false);
    }
    case 'bush':
      return finishPlant(merge([
        ico(0.8, 0, 0.6, 0, 0x3f9a4a, 0.75), ico(0.6, 0.5, 0.75, 0.2, 0x52b85a, 0.8), ico(0.5, -0.4, 0.55, -0.3, 0x6cc060, 0.8),
      ]), 0.2, 0.5);
    case 'rock':
      return finishPlant(merge([ico(0.7, 0, 0.25, 0, 0xb3aab0, 0.6), ico(0.4, 0.5, 0.15, 0.3, 0x9a929e, 0.7)]), 1, 0);
    case 'reed': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, r = 0.25 * ((i % 3) / 3 + 0.3);
        parts.push(box(0.05, 1.3 + (i % 3) * 0.25, 0.05, Math.cos(a) * r, 0, Math.sin(a) * r, 0x8a9a52, 0, (i % 2 - 0.5) * 0.15));
        if (i % 2) parts.push(box(0.1, 0.3, 0.1, Math.cos(a) * r, 1.2 + (i % 3) * 0.25, Math.sin(a) * r, 0x7a5a3a));
      }
      return finishPlant(merge(parts), 0, 1.6, false);
    }
    case 'fern': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const leaf = box(0.25, 0.04, 0.8, 0, 0, 0.4, LEAF[i % 3], 0, -0.6);
        leaf.rotateY((i / 6) * Math.PI * 2);
        leaf.translate(0, 0.1, 0);
        parts.push(leaf);
      }
      return finishPlant(merge(parts), 0, 1.2, false);
    }
    case 'flower': {
      const parts: THREE.BufferGeometry[] = [];
      const cols = [0xff7eb0, 0xffe468, 0xf7f0e4, 0xff9f5a];
      for (let i = 0; i < 4; i++) {
        const a = i * 1.7, r = 0.15;
        parts.push(box(0.03, 0.35, 0.03, Math.cos(a) * r, 0, Math.sin(a) * r, 0x52a850));
        parts.push(box(0.12, 0.06, 0.12, Math.cos(a) * r, 0.35, Math.sin(a) * r, cols[i]));
      }
      return finishPlant(merge(parts), 0, 1.5, false);
    }
    case 'lily':
      return finishPlant(merge([cyl(0.5, 0.5, 0.02, 7, 0, 0, 0, 0x52a850), box(0.14, 0.08, 0.14, 0.15, 0.02, -0.1, 0xffc2d6)]), 1, 0, false);
    case 'cactus':
      return finishPlant(merge([
        cyl(0.22, 0.26, 2.2, 7, 0, 0, 0, 0x52a850),
        cyl(0.14, 0.14, 0.7, 6, 0.5, 0.9, 0, 0x52a850),
        box(0.5, 0.18, 0.18, 0.25, 0.9, 0, 0x52a850),
        cyl(0.12, 0.12, 0.6, 6, -0.45, 1.3, 0, 0x6cc060),
        box(0.45, 0.16, 0.16, -0.22, 1.3, 0, 0x6cc060),
      ]), 1, 0);
    case 'cane': {
      // Zuckerrohr-Büschel: hohe Halme (verdecken die Sicht), Blätter oben – nah mit Wind
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 6; i++) {
        const a = i * 1.9, r = 0.18 + (i % 3) * 0.08, h = 2.6 + (i % 3) * 0.35;
        parts.push(box(0.07, h, 0.07, Math.cos(a) * r, 0, Math.sin(a) * r, i % 2 ? 0xa8b85a : 0x8aa048, 0, (i % 2 - 0.5) * 0.12));
        const leaf = box(0.12, 0.03, 0.9, 0, 0, 0.45, LEAF[i % 3], 0, -0.5);
        leaf.rotateY(a);
        leaf.translate(Math.cos(a) * r, h - 0.4, Math.sin(a) * r);
        parts.push(leaf);
      }
      return finishPlant(merge(parts), 0, 1.4, false);
    }
    case 'crop': {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const leaf = box(0.22, 0.04, 0.45, 0, 0, 0.2, i % 2 ? 0x6aa848 : 0x52903a, 0, -0.7);
        leaf.rotateY((i / 5) * Math.PI * 2);
        parts.push(leaf);
      }
      parts.push(ico(0.16, 0, 0.12, 0, 0x8fcc72));
      return finishPlant(merge(parts), 0, 0.8, false);
    }
    case 'melon':
      return finishPlant(merge([
        ico(0.38, 0, 0.22, 0, 0x3f8a3a, 0.75), box(0.5, 0.02, 0.06, 0, 0.42, 0, 0x2e6a2e),
        box(0.4, 0.03, 0.25, 0.4, 0, 0.1, 0x6aa848, 0.4), box(0.35, 0.03, 0.22, -0.35, 0, -0.2, 0x52903a, -0.6),
      ]), 1, 0, false);
    case 'hay': {
      // Rundballen (liegend)
      const g = new THREE.CylinderGeometry(0.65, 0.65, 1.2, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.65, 0);
      return finishPlant(merge([colored(g, 0xe8c860), box(1.22, 0.06, 0.06, 0, 0.62, 0.64, 0xc8a040)]), 1, 0);
    }
    case 'haySquare':
      return finishPlant(merge([box(1.2, 0.5, 0.6, 0, 0, 0, 0xe8c860), box(1.22, 0.04, 0.62, 0, 0.18, 0, 0xc8a040)]), 1, 0);
    case 'fenceWood':
      // 3-m-Segment entlang x: Pfosten + zwei Latten (verwittert)
      return finishPlant(merge([
        box(0.14, 1.25, 0.14, -1.5, 0, 0, 0x8a6a4a), box(3.0, 0.14, 0.06, 0, 0.55, 0, 0x9a7a58), box(3.0, 0.14, 0.06, 0, 1.0, 0, 0xa88660),
      ]), 1, 0);
    case 'fenceWire':
      return finishPlant(merge([
        box(0.1, 1.2, 0.1, -1.5, 0, 0, 0x7a5a3a), box(3.0, 0.025, 0.025, 0, 0.45, 0, 0x8a8a90), box(3.0, 0.025, 0.025, 0, 0.75, 0, 0x8a8a90), box(3.0, 0.025, 0.025, 0, 1.05, 0, 0x8a8a90),
      ]), 1, 0);
    case 'crate':
      return finishPlant(merge([box(0.7, 0.45, 0.5, 0, 0, 0, 0x9a7652), box(0.6, 0.08, 0.4, 0, 0.45, 0, 0xffa23a)]), 1, 0);
  }
}
