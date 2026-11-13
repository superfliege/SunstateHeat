// Tiere als Figuren (Rinder, Milchkühe, Pferde, Hühner, Ziegen, Hofhunde, Hirsche, Wildtruthähne).
// Low-Poly aus Boxen, Beine als eigene Pivots: Laufen = Beinschwingen + Wippen, Stehen = Grasen
// (Kopf senkt sich). Gleiche Schnittstelle wie die Passanten-Figuren (EntityViews.Figure) – damit
// gelten dieselbe Animations-LOD (fern: seltener/gar nicht animiert) und dasselbe Culling.
import * as THREE from 'three';
import type { AnimalSpecies } from '../../../shared/src/npc/archetypes';
import { toonMaterial } from './materials/toon';
import { colored, merge } from './geom';

interface Spec {
  body: [number, number, number]; bodyY: number; color: number; spots?: number;
  head: [number, number, number]; headColor?: number; neck: number;
  leg: [number, number]; legs: number; legColor?: number;
  tail?: boolean; horns?: boolean; mane?: number; comb?: boolean; antlers?: boolean; fan?: boolean; beak?: boolean;
}
const SPECS: Record<AnimalSpecies, Spec> = {
  cow: { body: [0.9, 0.85, 1.9], bodyY: 0.95, color: 0x8a5a3a, spots: 0xf2ece0, head: [0.5, 0.5, 0.6], neck: 0.25, leg: [0.16, 0.6], legs: 4, tail: true, horns: true },
  dairy_cow: { body: [0.9, 0.85, 1.9], bodyY: 0.95, color: 0xf2ece0, spots: 0x2a2a30, head: [0.48, 0.5, 0.6], headColor: 0xf2ece0, neck: 0.25, leg: [0.16, 0.6], legs: 4, tail: true },
  horse: { body: [0.65, 0.8, 1.9], bodyY: 1.25, color: 0x7a4a2a, head: [0.32, 0.4, 0.75], neck: 0.55, leg: [0.14, 0.95], legs: 4, tail: true, mane: 0x3a2a1e },
  chicken: { body: [0.28, 0.3, 0.38], bodyY: 0.28, color: 0xf2ece0, head: [0.14, 0.16, 0.14], neck: 0.12, leg: [0.04, 0.16], legs: 2, comb: true, beak: true },
  goat: { body: [0.45, 0.5, 0.95], bodyY: 0.65, color: 0xe8e0d0, head: [0.25, 0.3, 0.38], neck: 0.22, leg: [0.09, 0.42], legs: 4, tail: true, horns: true },
  dog: { body: [0.35, 0.38, 0.85], bodyY: 0.5, color: 0xc8955a, head: [0.28, 0.28, 0.36], neck: 0.15, leg: [0.09, 0.35], legs: 4, tail: true },
  deer: { body: [0.5, 0.6, 1.25], bodyY: 1.0, color: 0xa86a3a, head: [0.25, 0.3, 0.42], neck: 0.45, leg: [0.08, 0.8], legs: 4, tail: true, antlers: true },
  turkey: { body: [0.45, 0.45, 0.55], bodyY: 0.45, color: 0x4a3a2a, head: [0.12, 0.18, 0.14], headColor: 0xc0392b, neck: 0.25, leg: [0.05, 0.28], legs: 2, fan: true, beak: true },
};

let vcMat: THREE.Material | null = null;
const material = () => (vcMat ??= toonMaterial({ vertexColors: true, nightTint: 0.35 } as never));

export class AnimalFigure {
  readonly root = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private head: THREE.Object3D;
  private body: THREE.Object3D;
  private tail: THREE.Object3D | null = null;
  private phase = Math.random() * 10;
  private graze = 0;

  constructor(readonly species: AnimalSpecies, seed: number) {
    const s = SPECS[species];
    const rnd = (k: number) => (((Math.imul(seed + 13 * k, 2654435761) >>> 0) / 4294967296));
    const scale = 0.9 + rnd(1) * 0.2;
    // leichte Fellfarben-Variation (Rinder, Hunde, Pferde)
    const col = new THREE.Color(s.color).multiplyScalar(0.85 + rnd(2) * 0.3).getHex();
    // Teile je Gelenk sammeln und am Ende zu EINER Geometrie pro Gelenk verschmelzen (wenige Draw-Calls)
    const parts = new Map<THREE.Object3D, THREE.BufferGeometry[]>();
    const part = (w: number, h: number, d: number, hex: number, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const g = colored(new THREE.BoxGeometry(w, h, d), hex);
      const holder = { rotation: { z: 0, x: 0 } };
      const list = parts.get(parent) ?? [];
      list.push(g);
      parts.set(parent, list);
      // Rotation nachträglich (Fächer, Geweih): wird beim Verschmelzen angewendet
      (g as THREE.BufferGeometry & { _t?: [number, number, number, typeof holder] })._t = [x, y, z, holder];
      return holder;
    };
    const [bw, bh, bd] = s.body;
    this.body = new THREE.Group();
    this.body.position.y = s.bodyY;
    this.root.add(this.body);
    part(bw, bh, bd, col, this.body, 0, 0, 0);
    if (s.spots) for (let k = 0; k < 3; k++) part(bw * 1.02, bh * 0.4, bd * 0.22, s.spots, this.body, 0, (rnd(10 + k) - 0.4) * bh * 0.6, (rnd(20 + k) - 0.5) * bd * 0.7);
    if (s.fan) for (let k = 0; k < 5; k++) { const f = part(0.12, 0.55, 0.06, k % 2 ? 0x8a6a4a : 0x5a4030, this.body, (k - 2) * 0.1, bh * 0.45, -bd * 0.45); f.rotation.z = (k - 2) * 0.35; }
    if (species === 'dairy_cow') part(0.3, 0.18, 0.3, 0xffb4c0, this.body, 0, -bh * 0.55, -bd * 0.2); // Euter
    // Kopf am Hals-Pivot (Grasen: Kopf senken)
    this.head = new THREE.Group();
    this.head.position.set(0, bh * 0.3, bd / 2);
    this.body.add(this.head);
    const [hw, hh, hd] = s.head;
    const neckLen = s.neck;
    part(hw * 0.7, hh * 0.7, neckLen + 0.01, col, this.head, 0, neckLen * 0.4, neckLen * 0.5);
    part(hw, hh, hd, s.headColor ?? col, this.head, 0, neckLen * 0.8, neckLen + hd * 0.4);
    if (s.horns) for (const x of [-1, 1]) part(0.06, 0.18, 0.06, 0xe8e0c8, this.head, x * hw * 0.45, neckLen * 0.8 + hh * 0.6, neckLen + hd * 0.2);
    if (s.antlers && rnd(3) < 0.6) for (const x of [-1, 1]) { const a = part(0.05, 0.45, 0.05, 0x8a6a4a, this.head, x * hw * 0.4, neckLen * 0.8 + hh * 0.75, neckLen + hd * 0.2); a.rotation.z = -x * 0.4; }
    if (s.mane) part(0.08, hh * 0.6, neckLen + 0.2, s.mane, this.head, 0, neckLen * 0.6 + hh * 0.3, neckLen * 0.4);
    if (s.comb) part(0.04, 0.08, 0.1, 0xd83a3a, this.head, 0, neckLen * 0.8 + hh * 0.6, neckLen + hd * 0.3);
    if (s.beak) part(0.05, 0.05, 0.08, 0xffb020, this.head, 0, neckLen * 0.8, neckLen + hd * 0.9);
    if (species === 'turkey') part(0.05, 0.12, 0.04, 0xd83a3a, this.head, 0, neckLen * 0.7 - 0.06, neckLen + hd * 0.85);
    // Beine (Pivot an der Hüfte)
    const [lw, lh] = s.leg;
    const lp: [number, number][] = s.legs === 4 ? [[bw * 0.32, bd * 0.36], [-bw * 0.32, bd * 0.36], [bw * 0.32, -bd * 0.36], [-bw * 0.32, -bd * 0.36]] : [[bw * 0.2, 0], [-bw * 0.2, 0]];
    for (const [x, z] of lp) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -bh / 2 + 0.02, z);
      part(lw, lh, lw, s.legColor ?? (s.legs === 2 ? 0xffb020 : col), pivot, 0, -lh / 2, 0);
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    if (s.tail) {
      this.tail = new THREE.Group();
      this.tail.position.set(0, bh * 0.3, -bd / 2);
      part(0.06, 0.5, 0.06, s.mane ?? col, this.tail, 0, -0.25, -0.02);
      this.body.add(this.tail);
    }
    for (const [parent, list] of parts) {
      for (const g of list) {
        const [x, y, z, h] = (g as THREE.BufferGeometry & { _t: [number, number, number, { rotation: { x: number; z: number } }] })._t;
        if (h.rotation.z) g.rotateZ(h.rotation.z);
        if (h.rotation.x) g.rotateX(h.rotation.x);
        g.translate(x, y, z);
      }
      const m = new THREE.Mesh(merge(list), material());
      m.castShadow = true;
      parent.add(m);
    }
    this.root.scale.setScalar(scale);
  }

  /** speed m/s; dist = Entfernung zur Kamera (fern: keine Gliedanimation – Animations-LOD wie bei Passanten). */
  animate(speed: number, dt: number, _seated?: boolean, dist = 0) {
    if (dist > 70) return;
    this.phase += dt * (2 + speed * 3.2);
    const swing = Math.min(0.7, speed * 0.35);
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i % 2 === (i < 2 ? 0 : 1) ? 0 : Math.PI)) * swing; });
    this.body.position.y += ((SPECS[this.species].bodyY + Math.abs(Math.sin(this.phase)) * Math.min(0.08, speed * 0.03)) - this.body.position.y) * 0.5;
    // Grasen im Stand (Kopf langsam runter und wieder hoch), sonst Kopf oben
    const want = speed < 0.2 ? (Math.sin(this.phase * 0.08) > -0.2 ? 0.9 : 0.1) : 0;
    this.graze += (want - this.graze) * Math.min(1, dt * 2);
    this.head.rotation.x = this.graze * (this.species === 'chicken' || this.species === 'turkey' ? 1.1 : 0.75);
    if (this.tail) this.tail.rotation.z = Math.sin(this.phase * 0.7) * 0.3;
  }

  dispose() { /* Geometrie/Material sind geteilt */ }
}
