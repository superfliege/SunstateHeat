// Markierungen in der Welt (Telefone): farbiger Ring, schwebender Pfeil und Schild mit dem Namen.
// Läden haben keine Marker mehr, dort spricht man mit dem Verkäufer (StoresView).
import * as THREE from 'three';
import { OVERLAY_LAYER } from './PostFX';
import type { QuestState } from '../../../shared/src/protocol';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

export function sign(text: string, color: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,10,46,0.85)';
  ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(4, 4, 312, 64, 14); ctx.fill(); ctx.stroke();
  ctx.font = 'bold 34px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 160, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  s.layers.set(OVERLAY_LAYER); // Beschriftung: nach der Nachbearbeitung scharf in voller Auflösung
  s.scale.set(8, 1.8, 1);
  s.renderOrder = 9;
  return s;
}

export interface MarkerDef { x: number; z: number; name: string; color: number }

export class ShopsView {
  readonly group = new THREE.Group();
  private arrows: THREE.Object3D[] = [];
  private t = 0;

  constructor(private map: WorldMap, shops: MarkerDef[]) {
    for (const s of shops) {
      const color = s.color;
      const g = new THREE.Group();
      g.position.set(s.x, map.surfaceY(s.x, s.z), s.z);
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 1.6, 20, 1, true),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      ring.position.y = 0.8;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.4, 4), new THREE.MeshBasicMaterial({ color, fog: false }));
      arrow.rotation.x = Math.PI;
      arrow.position.y = 4.2;
      const label = sign(s.name, color);
      label.position.y = 6;
      g.add(ring, arrow, label);
      this.arrows.push(arrow);
      this.group.add(g);
    }
  }

  update(dt: number) {
    this.t += dt;
    this.arrows.forEach((a, i) => { a.position.y = 4.2 + Math.sin(this.t * 3 + i) * 0.4; a.rotation.y += dt * 1.5; });
  }
}

const KIND_COLORS: Record<number, number> = { 1: 0x4dff9a, 2: 0x2af0e6, 3: 0xffa23a, 4: 0x3a8dff, 5: 0xff3d5a, 6: 0xffe14d };
const CP_COLOR = 0xffd23a;
const FINISH_COLOR = 0xffffff;

/** Vertikaler Verlauf (unten kräftig, oben transparent) für die Checkpoint-Zylinder. */
function fadeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Zielflagge (Schachbrett) als Sprite. */
function flagSprite(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const ctx = c.getContext('2d')!;
  const n = 6, w = 128 / n, h = 96 / 4.5;
  for (let y = 0; y < 4; y++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
    ctx.fillRect(x * w, 6 + y * h, w, h);
  }
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.strokeRect(2, 6, 124, h * 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false }));
  s.scale.set(5, 3.75, 1);
  return s;
}

/** Doppel-Chevron („>>“) als flache Form, zeigt in +Z. */
function chevronGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const one = (z0: number) => {
    s.moveTo(-1.6, z0); s.lineTo(0, z0 + 1.6); s.lineTo(1.6, z0); s.lineTo(1.6, z0 - 0.9); s.lineTo(0, z0 + 0.7); s.lineTo(-1.6, z0 - 0.9); s.closePath();
  };
  one(0.6);
  const g1 = new THREE.ShapeGeometry(s);
  const s2 = new THREE.Shape();
  s2.moveTo(-1.6, -1.6); s2.lineTo(0, 0); s2.lineTo(1.6, -1.6); s2.lineTo(1.6, -2.5); s2.lineTo(0, -0.9); s2.lineTo(-1.6, -2.5); s2.closePath();
  const g2 = new THREE.ShapeGeometry(s2);
  // Shape liegt in XY (Spitze +Y) -> in die XZ-Ebene drehen (Spitze +Z)
  const merged = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const g of [g1, g2]) {
    const p = g.getAttribute('position'), idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) { const k = idx.getX(i); pos.push(p.getX(k), 0, p.getY(k)); }
  }
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return merged;
}

interface RaceRing { g: THREE.Group; tube: THREE.Mesh; base: THREE.Mesh; chevron: THREE.Group; flag: THREE.Sprite; r: number }

/** Renn-Checkpoints im GTA-Stil: leuchtender Zylinder, Bodenring, Pfeil zum nächsten Ring. */
class RaceRings {
  readonly group = new THREE.Group();
  private rings: RaceRing[] = [];
  private t = 0;

  constructor(private map: WorldMap) {
    const fade = fadeTexture();
    const chev = chevronGeometry();
    for (let i = 0; i < 2; i++) {
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 1, 40, 1, true),
        new THREE.MeshBasicMaterial({ color: CP_COLOR, map: fade, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      const base = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 48),
        new THREE.MeshBasicMaterial({ color: CP_COLOR, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      base.rotation.x = -Math.PI / 2;
      base.position.y = 0.15;
      const chevron = new THREE.Group();
      const cm = new THREE.Mesh(chev, new THREE.MeshBasicMaterial({ color: CP_COLOR, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
      cm.rotation.x = -0.6; // zum Betrachter hin gekippt, damit der Pfeil von hinten lesbar ist
      chevron.add(cm);
      const flag = flagSprite();
      const g = new THREE.Group();
      g.add(tube, base, chevron, flag);
      g.visible = false;
      tube.renderOrder = 2; base.renderOrder = 2; cm.renderOrder = 3;
      this.group.add(g);
      this.rings.push({ g, tube, base, chevron, flag, r: 1 });
    }
  }

  /** list: Checkpoint-Ziele in Reihenfolge (aktueller zuerst). */
  set(list: [number, number, number, number][]) {
    this.rings.forEach((m, i) => {
      const t = list[i];
      m.g.visible = !!t;
      if (!t) return;
      const finish = t[3] === 7;
      const color = finish ? FINISH_COLOR : CP_COLOR;
      const main = i === 0;
      const r = Math.max(3, t[2]);
      m.r = r;
      const h = main ? 5 : 3.5;
      m.tube.scale.set(r, h, r);
      m.tube.position.y = h / 2;
      m.base.scale.set(r, r, 1);
      for (const mesh of [m.tube, m.base]) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.color.setHex(color);
        mat.opacity = (mesh === m.tube ? 0.55 : 0.85) * (main ? 1 : 0.4);
      }
      m.g.position.set(t[0], this.map.surfaceY(t[0], t[1]), t[1]);
      // Pfeil in Richtung des folgenden Checkpoints (nur am aktuellen Ring)
      const next = list[i + 1];
      m.chevron.visible = main && !finish && !!next;
      if (next) m.chevron.rotation.y = Math.atan2(next[0] - t[0], next[1] - t[1]);
      (m.chevron.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.setHex(color);
      m.chevron.position.y = 3.2;
      m.flag.visible = finish;
      m.flag.position.y = h + 2.5;
    });
  }

  update(dt: number) {
    this.t += dt;
    const k = 1 + Math.sin(this.t * 5) * 0.04;
    const m = this.rings[0];
    if (m.g.visible) { m.base.scale.set(m.r * k, m.r * k, 1); m.chevron.position.y = 3.2 + Math.sin(this.t * 3) * 0.25; }
  }
}

/** Zielmarkierungen des aktiven Auftrags (Ringe am Boden mit Pfeil). */
export class QuestMarkers {
  readonly group = new THREE.Group();
  private pool: { g: THREE.Group; ring: THREE.Mesh; arrow: THREE.Mesh }[] = [];
  private race: RaceRings;
  private t = 0;

  constructor(private map: WorldMap) {
    this.race = new RaceRings(map);
    this.group.add(this.race.group);
    for (let i = 0; i < 14; i++) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 2.4, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      );
      ring.position.y = 1.2;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
      arrow.rotation.x = Math.PI;
      const g = new THREE.Group();
      g.add(ring, arrow);
      g.visible = false;
      this.group.add(g);
      this.pool.push({ g, ring, arrow });
    }
  }

  set(q: QuestState | null) {
    const all = q?.targets ?? [];
    // Checkpoints (2) und Ziellinie (7) als Renn-Ringe, alles andere als normale Marker
    this.race.set(all.filter((t) => t[3] === 2 || t[3] === 7));
    const list = all.filter((t) => t[3] !== 2 && t[3] !== 7);
    this.pool.forEach((m, i) => {
      const t = list[i];
      m.g.visible = !!t;
      if (!t) return;
      const color = KIND_COLORS[t[3]] ?? 0xffffff;
      (m.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
      (m.arrow.material as THREE.MeshBasicMaterial).color.setHex(color);
      const r = Math.max(1.5, t[2]);
      m.ring.scale.set(r, 1, r);
      m.g.position.set(t[0], this.map.surfaceY(t[0], t[1]), t[1]);
      m.arrow.position.y = r + 4;
    });
  }

  update(dt: number) {
    this.t += dt;
    this.race.update(dt);
    for (const m of this.pool) if (m.g.visible) { m.arrow.position.y += Math.sin(this.t * 4) * 0.02; m.arrow.rotation.y += dt * 1.5; }
  }
}
