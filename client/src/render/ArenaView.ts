// Darstellung der Minispiel-Arenen (Böden aus shared/world/arenaFloor.ts, kommen per Snapshot).
// disc: Plattform mit gut sichtbarem Rot-Weiß-Rand, Leuchtring und Stützpfeilern ins Wasser.
//       Schrumpft live mit (Radius kommt vom Server).
// grid: Kacheln; Vorwarnung = rot blinkend, verschwundene Kacheln werden ausgeblendet.
import * as THREE from 'three';
import { FloorCell, floorCellCenter, type ArenaFloor } from '../../../shared/src/world/arenaFloor';

const THICK = 1.4;

function stripeTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#e8262f'; g.fillRect(i * 16, 0, 16, 16); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface DiscView { kind: 'disc'; g: THREE.Group; top: THREE.Mesh; rim: THREE.Mesh; glow: THREE.Mesh; r: number; stripes: THREE.Texture }
interface GridView { kind: 'grid'; g: THREE.Group; tiles: THREE.InstancedMesh; key: string; cells: number[] }
type View = DiscView | GridView;

export class ArenaView {
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private floors: ArenaFloor[] = [];
  private t = 0;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

  set(floors: ArenaFloor[]) {
    this.floors = floors;
    const ids = new Set(floors.map((f) => f.id));
    for (const [id, v] of this.views) {
      if (ids.has(id)) continue;
      this.group.remove(v.g);
      v.g.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      this.views.delete(id);
    }
    for (const f of floors) {
      let v = this.views.get(f.id);
      if (v && v.kind === 'grid' && v.key !== `${f.cols}x${f.rows}x${f.cell}`) { this.group.remove(v.g); this.views.delete(f.id); v = undefined; }
      if (!v) {
        v = f.shape === 'disc' ? this.buildDisc(f) : this.buildGrid(f);
        if (f.wall > 0) v.g.add(this.buildWall(f));
        this.views.set(f.id, v); this.group.add(v.g);
      }
      if (v.kind === 'disc') this.sizeDisc(v, f);
      else v.cells = f.cells;
    }
  }

  private buildDisc(f: ArenaFloor): DiscView {
    const g = new THREE.Group();
    g.position.set(f.cx, f.y, f.cz);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, THICK, 64), new THREE.MeshStandardMaterial({ color: 0x3b3d48, roughness: 0.85 }));
    top.position.y = -THICK / 2;
    top.receiveShadow = true;
    const stripes = stripeTexture();
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.5, 64, 1, true), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6, side: THREE.DoubleSide }));
    rim.position.y = 0.05;
    const glow = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    // Mittelkreis (Sumo-Ring)
    const mid = new THREE.Mesh(new THREE.RingGeometry(5.6, 6, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
    mid.rotation.x = -Math.PI / 2;
    mid.position.y = 0.03;
    g.add(top, rim, glow, mid);
    // Stützpfeiler (nur Optik) unter der Ausgangsgröße
    const legMat = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2, rr = (f.r || 10) * 0.35;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, f.y + 2, 8), legMat);
      leg.position.set(Math.sin(a) * rr, -(f.y + 2) / 2 - THICK, Math.cos(a) * rr);
      g.add(leg);
    }
    const v: DiscView = { kind: 'disc', g, top, rim, glow, r: 0, stripes };
    this.sizeDisc(v, f);
    return v;
  }

  /** Bande (Leitplanke mit Rot-Weiß-Streifen) rund um den Boden. Bei Scheiben: feste Größe (schrumpft nicht). */
  private buildWall(f: ArenaFloor): THREE.Object3D {
    const H = 1.6;
    const tex = stripeTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    const g = new THREE.Group();
    if (f.shape === 'disc') {
      const r = f.r + f.wall / 2;
      tex.repeat.set(Math.max(4, Math.round((r * Math.PI * 2) / 3 / 16)), 1);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + f.wall / 2, r + f.wall / 2, H, 72, 1, true), mat);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(f.r, f.r, H, 72, 1, true), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.BackSide }));
      const top = new THREE.Mesh(new THREE.RingGeometry(f.r, f.r + f.wall, 72), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
      top.rotation.x = -Math.PI / 2; top.position.y = H / 2;
      g.add(ring, inner, top);
      g.position.y = H / 2;
      return g;
    }
    // Raster: Position relativ zur Gruppe (grid-Gruppe liegt im Ursprung)
    const w = f.cols * f.cell, d = f.rows * f.cell, t = f.wall;
    tex.repeat.set(4, 1);
    for (const [x, z, sx, sz] of [[0, -(d + t) / 2, w + 2 * t, t], [0, (d + t) / 2, w + 2 * t, t], [-(w + t) / 2, 0, t, d], [(w + t) / 2, 0, t, d]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), mat);
      m.position.set(f.cx + x, f.y + H / 2, f.cz + z);
      g.add(m);
    }
    return g;
  }

  private sizeDisc(v: DiscView, f: ArenaFloor) {
    if (Math.abs(v.r - f.r) < 0.01) return;
    v.r = f.r;
    v.top.scale.set(f.r, 1, f.r);
    v.rim.scale.set(f.r + 0.02, 1, f.r + 0.02);
    v.glow.scale.set(f.r, f.r, 1);
    v.stripes.repeat.set(Math.max(4, Math.round((f.r * Math.PI * 2) / 3 / 16)), 1);
  }

  private buildGrid(f: ArenaFloor): GridView {
    const g = new THREE.Group();
    const n = f.cols * f.rows;
    const geo = new THREE.BoxGeometry(f.cell * 0.96, THICK, f.cell * 0.96);
    const tiles = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), n);
    tiles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    tiles.receiveShadow = true;
    for (let i = 0; i < n; i++) {
      const [x, z] = floorCellCenter(f, i);
      this.tmpM.makeTranslation(x, f.y - THICK / 2, z);
      tiles.setMatrixAt(i, this.tmpM);
    }
    g.add(tiles);
    return { kind: 'grid', g, tiles, key: `${f.cols}x${f.rows}x${f.cell}`, cells: f.cells };
  }

  update(dt: number) {
    this.t += dt;
    const blink = Math.sin(this.t * 14) > 0;
    for (const f of this.floors) {
      const v = this.views.get(f.id);
      if (!v) continue;
      if (v.kind === 'disc') {
        (v.glow.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.t * 4) * 0.3;
        continue;
      }
      for (let i = 0; i < v.cells.length; i++) {
        const st = v.cells[i];
        const [x, z] = floorCellCenter(f, i);
        if (st === FloorCell.GONE) { v.tiles.setMatrixAt(i, this.zeroM); continue; }
        this.tmpM.makeTranslation(x, f.y - THICK / 2, z);
        v.tiles.setMatrixAt(i, this.tmpM);
        const checker = ((i % f.cols) + Math.floor(i / f.cols)) % 2 === 0;
        if (st === FloorCell.WARN) this.tmpC.setHex(blink ? 0xff3030 : 0xffa020);
        else this.tmpC.setHex(checker ? 0x2ad4c9 : 0x8f6bff);
        v.tiles.setColorAt(i, this.tmpC);
      }
      v.tiles.instanceMatrix.needsUpdate = true;
      if (v.tiles.instanceColor) v.tiles.instanceColor.needsUpdate = true;
    }
  }
}
