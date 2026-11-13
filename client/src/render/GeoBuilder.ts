// Sammelt Dreiecke für eine gemeinsame Geometrie (ein Draw-Call) mit:
//   position, normal, color (Tönung), auv (Kachel-UV in Metern / Kachelgröße), surf (Atlas-Kachel, Flags)
// Mit use('material') wird das aktuelle Material aus der Bibliothek gewählt; die UV entsteht
// automatisch als planare Projektion je Dreieck (oben: x/z, Wände: entlang der Wand / Höhe).
import * as THREE from 'three';
import type { Vec2 } from '../../../shared/src/world/geometry';
import { MATERIALS, matIndex } from './materials/library';

const tmp = new THREE.Color();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  auv: number[] = [];
  surf: number[] = [];
  private mat = 0;
  private flags = 0;
  private tileW = 4;
  private tileH = 4;
  /** Explizite UV für die nächsten Vertices (Fassaden); null = automatisch. */
  private uvOverride: number[][] | null = null;

  get empty() { return this.pos.length === 0; }
  get count() { return this.pos.length / 3; }

  /** Gebäude-Grundriss je Vertex-Bereich (für das Durchsichtig-Werden ganzer Gebäude, #51). */
  private bldRanges: number[][] = [];
  private bldCur: number[] | null = null;
  /** Ab jetzt hinzugefügte Vertices gehören zum Gebäude (Mitte, halbe Breite/Tiefe, Drehung, Dachhöhe). */
  beginBuilding(cx: number, cz: number, hw: number, hd: number, rot: number, top: number) {
    this.bldCur = [this.count, cx, cz, hw, hd, rot, top];
  }
  endBuilding() {
    if (this.bldCur && this.count > this.bldCur[0]) this.bldRanges.push([...this.bldCur, this.count]);
    this.bldCur = null;
  }

  /** Material aus der Bibliothek wählen (Flags: zusätzlich zu den Toon-Flags des Materials). */
  use(name: string, extraFlags = 0) {
    this.mat = matIndex(name);
    const def = MATERIALS[this.mat];
    this.flags = (def.toon.flags ?? 0) | extraFlags;
    this.tileW = def.tile[0]; this.tileH = def.tile[1];
    return this;
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, u: number, v: number) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b);
    this.auv.push(u, v); this.surf.push(this.mat, this.flags);
  }

  /** Dreieck; Normale wird berechnet. upOnly: so drehen, dass sie nach oben zeigt. */
  tri(a: number[], b: number[], c: number[], color: number | THREE.Color, upOnly = false) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let uvs = this.uvOverride;
    if (upOnly && ny < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; if (uvs) uvs = [uvs[0], uvs[2], uvs[1]]; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const col = typeof color === 'number' ? tmp.setHex(color) : color;
    const proj = (p: number[]): [number, number] => {
      if (Math.abs(ny) > 0.7) return [p[0] / this.tileW, p[2] / this.tileH];
      // Wand: horizontale Achse senkrecht zur Normalen
      const tl = Math.hypot(nx, nz) || 1;
      const tx = -nz / tl, tz = nx / tl;
      return [(p[0] * tx + p[2] * tz) / this.tileW, p[1] / this.tileH];
    };
    const [au, av] = uvs ? uvs[0] : proj(a), [bu, bv] = uvs ? uvs[1] : proj(b), [cu, cv] = uvs ? uvs[2] : proj(c);
    this.vert(a[0], a[1], a[2], nx, ny, nz, col, au, av);
    this.vert(b[0], b[1], b[2], nx, ny, nz, col, bu, bv);
    this.vert(c[0], c[1], c[2], nx, ny, nz, col, cu, cv);
  }

  /** Viereck a-b-c-d (zwei Dreiecke). uv: optionale UV je Ecke (in Kacheln). */
  quad(a: number[], b: number[], c: number[], d: number[], color: number | THREE.Color, upOnly = false, uv?: number[][]) {
    if (uv) this.uvOverride = [uv[0], uv[1], uv[2]];
    this.tri(a, b, c, color, upOnly);
    if (uv) this.uvOverride = [uv[0], uv[2], uv[3]];
    this.tri(a, c, d, color, upOnly);
    this.uvOverride = null;
  }

  /** Waagerechtes Band zwischen zwei gleich langen Punktlisten (Straßen, Gehwege, Markierungen). */
  ribbon(left: Vec2[], right: Vec2[], y: number | ((i: number) => number), color: number | THREE.Color | ((i: number) => number)) {
    for (let i = 0; i < left.length - 1; i++) {
      const y0 = typeof y === 'number' ? y : y(i), y1 = typeof y === 'number' ? y : y(i + 1);
      const c = typeof color === 'function' ? color(i) : color;
      this.quad([left[i][0], y0, left[i][1]], [right[i][0], y0, right[i][1]], [right[i + 1][0], y1, right[i + 1][1]], [left[i + 1][0], y1, left[i + 1][1]], c, true);
    }
  }

  /** Senkrechte Wand entlang einer Linie (Bordsteinkante, Geländer), beidseitig. */
  wall(line: Vec2[], y0: number | ((i: number) => number), h: number, color: number, twoSided = true) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const ya = typeof y0 === 'number' ? y0 : y0(i), yb = typeof y0 === 'number' ? y0 : y0(i + 1);
      this.quad([a[0], ya, a[1]], [b[0], yb, b[1]], [b[0], yb + h, b[1]], [a[0], ya + h, a[1]], color);
      if (twoSided) this.quad([b[0], yb, b[1]], [a[0], ya, a[1]], [a[0], ya + h, a[1]], [b[0], yb + h, b[1]], color);
    }
  }

  /** Waagerechtes (auch konkaves) Polygon. */
  polygon(poly: Vec2[], y: number, color: number | THREE.Color) {
    if (poly.length < 3) return;
    const pts = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    let faces: number[][];
    try { faces = THREE.ShapeUtils.triangulateShape(pts, []); } catch { return; }
    for (const [a, b, c] of faces) this.tri([poly[a][0], y, poly[a][1]], [poly[b][0], y, poly[b][1]], [poly[c][0], y, poly[c][1]], color, true);
  }

  /** Fächer um einen Mittelpunkt (für sternförmige Kreuzungsflächen). */
  fan(center: Vec2, ring: Vec2[], y: number, color: number | THREE.Color) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      this.tri([center[0], y, center[1]], [a[0], y, a[1]], [b[0], y, b[1]], color, true);
    }
  }

  /** Quader (Mitte unten bei x/y/z), gedreht um rot (vorwärts = sin rot, cos rot). top = Deckelfarbe. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, rot: number, color: number, top?: number) {
    const s = Math.sin(rot), c = Math.cos(rot);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const b0 = P(-hw, 0, -hd), b1 = P(hw, 0, -hd), b2 = P(hw, 0, hd), b3 = P(-hw, 0, hd);
    const t0 = P(-hw, h, -hd), t1 = P(hw, h, -hd), t2 = P(hw, h, hd), t3 = P(-hw, h, hd);
    this.quad(b3, b2, t2, t3, color); // vorne (+z)
    this.quad(b1, b0, t0, t1, color); // hinten
    this.quad(b2, b1, t1, t2, color);
    this.quad(b0, b3, t3, t0, color);
    this.quad(t3, t2, t1, t0, top ?? color);
  }

  /** Senkrechter Zylinder (Art-déco-Rundungen, Säulen, Rettungsturm-Beine). */
  cylinder(x: number, y: number, z: number, r: number, h: number, seg: number, color: number, a0 = 0, a1 = Math.PI * 2, cap = true) {
    for (let i = 0; i < seg; i++) {
      const p = a0 + ((a1 - a0) * i) / seg, q = a0 + ((a1 - a0) * (i + 1)) / seg;
      const A = [x + Math.sin(p) * r, y, z + Math.cos(p) * r], B = [x + Math.sin(q) * r, y, z + Math.cos(q) * r];
      this.quad(A, B, [B[0], y + h, B[2]], [A[0], y + h, A[2]], color);
      if (cap) this.tri([x, y + h, z], [A[0], y + h, A[2]], [B[0], y + h, B[2]], color, true);
    }
  }

  /** Walmdach (Pyramidenstumpf mit First) über einem gedrehten Rechteck. */
  hipRoof(x: number, y: number, z: number, w: number, d: number, h: number, rot: number, color: number, overhang = 0.4) {
    const s = Math.sin(rot), c = Math.cos(rot);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2 + overhang, hd = d / 2 + overhang;
    const ridge = Math.max(0, hw - hd);
    const e0 = P(-hw, 0, -hd), e1 = P(hw, 0, -hd), e2 = P(hw, 0, hd), e3 = P(-hw, 0, hd);
    const r0 = P(-ridge, h, 0), r1 = P(ridge, h, 0);
    this.quad(e3, e2, r1, r0, color); // vorne
    this.quad(e1, e0, r0, r1, color); // hinten
    this.tri(e2, e1, r1, color);
    this.tri(e0, e3, r0, color);
    // Unterseite (Dachüberstand) – damit von unten nichts durchscheint
    this.quad(e0, e1, e2, e3, 0x6e4e32);
  }

  /** Satteldach entlang der Breite (Scheunen). */
  gableRoof(x: number, y: number, z: number, w: number, d: number, h: number, rot: number, color: number, overhang = 0.4) {
    const s = Math.sin(rot), c = Math.cos(rot);
    const P = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hw = w / 2 + overhang, hd = d / 2 + overhang;
    const e0 = P(-hw, 0, -hd), e1 = P(hw, 0, -hd), e2 = P(hw, 0, hd), e3 = P(-hw, 0, hd);
    const r0 = P(-hw, h, 0), r1 = P(hw, h, 0);
    this.quad(e3, e2, r1, r0, color);
    this.quad(e1, e0, r0, r1, color);
    // Giebelwände
    const g0 = P(-w / 2, 0, -d / 2), g3 = P(-w / 2, 0, d / 2), g1 = P(w / 2, 0, -d / 2), g2 = P(w / 2, 0, d / 2);
    this.tri(g0, g3, P(-w / 2, h * (d / 2) / hd, 0), color);
    this.tri(g2, g1, P(w / 2, h * (d / 2) / hd, 0), color);
  }

  /** Fremde Geometrie (mit position/normal/color, nicht indiziert) transformiert übernehmen. */
  addGeometry(g: THREE.BufferGeometry, m: THREE.Matrix4, tint?: THREE.Color) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const tw = this.tileW, th = this.tileH;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(nv.x, nv.y, nv.z);
      const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
      if (tint) this.col.push(r * tint.r, gg * tint.g, b * tint.b); else this.col.push(r, gg, b);
      if (Math.abs(nv.y) > 0.7) this.auv.push(v.x / tw, v.z / th);
      else this.auv.push((v.x * -nv.z + v.z * nv.x) / tw, v.y / th);
      this.surf.push(this.mat, this.flags);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('auv', new THREE.Float32BufferAttribute(this.auv, 2));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 2));
    if (this.bldRanges.length) {
      const n = this.count, A = new Float32Array(n * 4), B = new Float32Array(n * 2);
      for (const [s, cx, cz, hw, hd, rot, top, e] of this.bldRanges) {
        for (let i = s; i < e; i++) { A.set([cx, cz, hw, hd], i * 4); B.set([rot, top], i * 2); }
      }
      g.setAttribute('bldA', new THREE.BufferAttribute(A, 4));
      g.setAttribute('bldB', new THREE.BufferAttribute(B, 2));
    }
    g.computeBoundingSphere();
    return g;
  }
}
