// Kurze Leuchtspuren für Schüsse und Würfe (Comic-Stil; Blut siehe VehicleFx.bloodSplash). Ein Pool aus Linien, die schnell verblassen.
import * as THREE from 'three';

const LIFE = 0.12;
const POOL = 48;

interface Tracer { line: THREE.Line; mat: THREE.LineBasicMaterial; t: number }

export class Tracers {
  readonly group = new THREE.Group();
  private pool: Tracer[] = [];
  private next = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffe14d, transparent: true, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.pool.push({ line, mat, t: 0 });
    }
  }

  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = 0xffe14d) {
    const tr = this.pool[this.next++ % POOL];
    const pos = tr.line.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, x0, y0, z0);
    pos.setXYZ(1, x1, y1, z1);
    pos.needsUpdate = true;
    tr.mat.color.setHex(color);
    tr.mat.opacity = 1;
    tr.t = LIFE;
    tr.line.visible = true;
  }

  update(dt: number) {
    for (const tr of this.pool) {
      if (tr.t <= 0) continue;
      tr.t -= dt;
      if (tr.t <= 0) tr.line.visible = false;
      else tr.mat.opacity = tr.t / LIFE;
    }
  }
}
