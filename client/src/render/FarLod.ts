// Fern-LOD der ganzen Insel: grobes Höhenfeld (10 m, Bodenfarben der Minimap) mit Okee Peak als
// Silhouette und Gebäuden als einfache Quader – EINE Geometrie, ein Draw-Call. Die normalen
// Welt-Chunks enden bei ~450 m; das Fern-LOD liegt knapp darunter und füllt alles dahinter.
// Sichtbar nur, wenn die Kamera weit sieht: Panorama (Fernrohr am Gipfel, Foto-Kamera) oder große
// Flughöhe. In der normalen Top-Down-Sicht kostet es nichts (unsichtbar = kein Draw-Call).
import * as THREE from 'three';
import { WORLD_SIZE } from '../../../shared/src/constants';
import { okeeBase } from '../../../shared/src/world/okeePeak';
import { Tile, WATER_LEVEL } from '../../../shared/src/world/tiles';
import { BuildingStyle, type WorldMap } from '../../../shared/src/world/WorldMap';
import { groundColor } from './WorldView';
import { palmaraize } from './palette';

const STEP = 10;

export class FarLod {
  readonly group = new THREE.Group();
  private mat: THREE.MeshLambertMaterial;

  constructor(map: WorldMap) {
    this.group.name = 'farLod';
    const n = WORLD_SIZE / STEP + 1;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = Math.min(WORLD_SIZE - 1, i * STEP), z = Math.min(WORLD_SIZE - 1, j * STEP);
      const t = map.groundAt(x, z);
      const k = (j * n + i) * 3;
      const h = t === Tile.WATER ? WATER_LEVEL - 6 : map.terrainHeight(x, z); // tief, sonst zeichnet der Wasser-Shader Uferschaum
      pos[k] = i * STEP; pos[k + 1] = h - 0.6; pos[k + 2] = j * STEP;
      // Berg: Fels/Gras nach Höhe (aus der Ferne lesbar), sonst Minimap-Farben
      if (h > 20 && okeeBase(x, z) > 10) c.setHex(h > 150 ? 0xa49a90 : h > 95 ? 0x9aa070 : 0x4f7a44);
      else c.setHex(palmaraize(t === Tile.WATER ? 0x3a9ec0 : groundColor(map, map.tileAt(x, z), x, z)));
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const terrain = new THREE.Mesh(g, this.mat);
    terrain.frustumCulled = false;
    this.group.add(terrain);

    // Gebäude als Quader (Dachfarbe oben, Wandfarbe seitlich)
    const bp: number[] = [], bc: number[] = [];
    const push = (p: number[], hex: number) => { c.setHex(palmaraize(hex)); for (let q = 0; q < p.length; q += 3) { bp.push(p[q], p[q + 1], p[q + 2]); bc.push(c.r, c.g, c.b); } };
    for (const b of map.buildings) {
      if (b.w * b.d < 30 || b.style === BuildingStyle.Container) continue;
      const y0 = Math.max(0, map.terrainHeight(b.x, b.z)) - 0.5, y1 = y0 + 0.5 + b.h * 0.98;
      const s = Math.sin(b.rot), co = Math.cos(b.rot), hw = b.w * 0.49, hd = b.d * 0.49;
      const P = (lx: number, lz: number, y: number) => [b.x + lx * co + lz * s, y, b.z - lx * s + lz * co];
      const q = [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)];
      const wall = b.style === BuildingStyle.Tower ? 0x8ab8d0 : b.color;
      for (let e = 0; e < 4; e++) {
        const A = q[e], B = q[(e + 1) % 4];
        push([A[0], y0, A[2], B[0], y0, B[2], B[0], y1, B[2], A[0], y0, A[2], B[0], y1, B[2], A[0], y1, A[2]], wall);
      }
      push([q[0][0], y1, q[0][2], q[2][0], y1, q[2][2], q[1][0], y1, q[1][2], q[0][0], y1, q[0][2], q[3][0], y1, q[3][2], q[2][0], y1, q[2][2]], 0xb3aab0);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    bg.computeVertexNormals();
    const blds = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    blds.frustumCulled = false;
    this.group.add(blds);
    this.group.visible = false;
  }

  /** an = Panorama/Fernsicht aktiv. */
  setActive(on: boolean) { this.group.visible = on; }
}
