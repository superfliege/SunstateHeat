// Laden-Markierungen in der Welt: farbiger Ring, schwebender Pfeil und Schild mit dem Ladennamen.
import * as THREE from 'three';
import type { QuestState } from '../../../shared/src/protocol';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

function sign(text: string, color: number): THREE.Sprite {
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

/** Zielmarkierungen des aktiven Auftrags (Ringe am Boden mit Pfeil). */
export class QuestMarkers {
  readonly group = new THREE.Group();
  private pool: { g: THREE.Group; ring: THREE.Mesh; arrow: THREE.Mesh }[] = [];
  private t = 0;

  constructor(private map: WorldMap) {
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
    const list = q?.targets ?? [];
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
    for (const m of this.pool) if (m.g.visible) { m.arrow.position.y += Math.sin(this.t * 4) * 0.02; m.arrow.rotation.y += dt * 1.5; }
  }
}
