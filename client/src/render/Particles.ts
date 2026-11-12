// Atmosphäre-Partikel rund um die Kamera (billig: je Art ein Draw-Call):
//   Möwen an der Küste (tagsüber kreisend), fallende Blätter in grünen Gegenden,
//   Glühwürmchen im Sumpf (nachts, HDR -> Bloom).
import * as THREE from 'three';
import { Tile } from '../../../shared/src/world/tiles';
import { Zone, type WorldMap } from '../../../shared/src/world/WorldMap';
import { U } from './materials/toon';

const GULLS = 14, LEAVES = 60, FLIES = 120;
const RANGE = 70;

interface Gull { cx: number; cz: number; r: number; a: number; speed: number; y: number; flap: number }
interface Leaf { x: number; y: number; z: number; vy: number; spin: number; phase: number; life: number }
interface Fly { x: number; y: number; z: number; phase: number; ok: boolean }

const tmpC = new THREE.Color();
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpE = new THREE.Euler();

export class Particles {
  readonly group = new THREE.Group();
  private gullMesh: THREE.InstancedMesh;
  private leafMesh: THREE.InstancedMesh;
  private flyPoints: THREE.Points;
  private gulls: Gull[] = [];
  private leaves: Leaf[] = [];
  private flies: Fly[] = [];
  private flyMat: THREE.PointsMaterial;
  private rnd = Math.random;

  constructor(private map: WorldMap) {
    // Möwe: flaches "V" aus zwei Dreiecken
    const gull = new THREE.BufferGeometry();
    gull.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.25, -0.9, 0.15, -0.1, 0, 0, -0.25,
      0, 0, 0.25, 0, 0, -0.25, 0.9, 0.15, -0.1,
    ], 3));
    gull.computeVertexNormals();
    this.gullMesh = new THREE.InstancedMesh(gull, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), GULLS);
    for (let i = 0; i < GULLS; i++) this.gullMesh.setColorAt(i, new THREE.Color(0xf7f0e4));
    this.leafMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: 0x8fcc72, side: THREE.DoubleSide }), LEAVES);
    const leafColors = [0x8fcc72, 0x52b85a, 0xb8c46a, 0xffb36b];
    for (let i = 0; i < LEAVES; i++) this.leafMesh.setColorAt(i, new THREE.Color(leafColors[i % leafColors.length]));
    for (const m of [this.gullMesh, this.leafMesh]) { m.frustumCulled = false; this.group.add(m); }

    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FLIES * 3), 3));
    this.flyMat = new THREE.PointsMaterial({ color: new THREE.Color(3, 2.8, 0.9), size: 3, sizeAttenuation: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flyPoints = new THREE.Points(flyGeo, this.flyMat);
    this.flyPoints.frustumCulled = false;
    this.group.add(this.flyPoints);

    for (let i = 0; i < GULLS; i++) this.gulls.push({ cx: 0, cz: 0, r: 0, a: 0, speed: 0, y: -100, flap: 0 });
    for (let i = 0; i < LEAVES; i++) this.leaves.push({ x: 0, y: -100, z: 0, vy: 0, spin: 0, phase: 0, life: 0 });
    for (let i = 0; i < FLIES; i++) this.flies.push({ x: 0, y: 0, z: 0, phase: Math.random() * 10, ok: false });
  }

  private near(cx: number, cz: number) {
    const a = this.rnd() * Math.PI * 2, r = 10 + this.rnd() * RANGE;
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  }

  update(dt: number, focus: THREE.Vector3) {
    const t = U.uTime.value, day = U.uDay.value, night = U.uNight.value;

    // Möwen: über Sand/Wasser in Küstennähe kreisen
    for (let i = 0; i < GULLS; i++) {
      const g = this.gulls[i];
      if (Math.hypot(g.cx - focus.x, g.cz - focus.z) > RANGE * 1.6 || g.y < -50) {
        const [x, z] = this.near(focus.x, focus.z);
        const tile = this.map.tileAt(x, z);
        const coast = tile === Tile.SAND || tile === Tile.WATER || tile === Tile.DOCK;
        // Greifvögel kreisen hoch über dem Okee Peak (dunkel, langsam, große Kreise)
        const hy = this.map.terrainHeight(x, z);
        const hawk = !coast && this.map.zoneAt(x, z) === Zone.Highlands && hy > 30;
        Object.assign(g, { cx: x, cz: z, r: hawk ? 18 + this.rnd() * 20 : 6 + this.rnd() * 14, a: this.rnd() * 6, speed: (hawk ? 0.12 : 0.25 + this.rnd() * 0.3) * (this.rnd() < 0.5 ? 1 : -1), y: day > 0.2 ? (hawk ? hy + 28 + this.rnd() * 20 : coast ? 12 + this.rnd() * 10 : -100) : -100, flap: this.rnd() * 6 });
        this.gullMesh.setColorAt(i, tmpC.setHex(hawk ? 0x5a3a24 : 0xf7f0e4));
        if (this.gullMesh.instanceColor) this.gullMesh.instanceColor.needsUpdate = true;
      }
      g.a += g.speed * dt;
      const x = g.cx + Math.cos(g.a) * g.r, z = g.cz + Math.sin(g.a) * g.r;
      const flap = Math.sin(t * 6 + g.flap) * 0.5 + 0.5;
      tmpP.set(x, g.y + Math.sin(t * 0.7 + g.flap) * 1.5, z);
      tmpE.set(0, -g.a + (g.speed > 0 ? 0 : Math.PI), (g.speed > 0 ? -1 : 1) * 0.3);
      tmpQ.setFromEuler(tmpE);
      tmpS.set(1, 0.4 + flap, 1);
      this.gullMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, g.y < -50 ? tmpS.setScalar(0) : tmpS));
    }
    this.gullMesh.instanceMatrix.needsUpdate = true;

    // Blätter: in grünen Gegenden tagsüber, trudeln zu Boden
    for (let i = 0; i < LEAVES; i++) {
      const l = this.leaves[i];
      l.life -= dt;
      if (l.life <= 0 || l.y < this.map.surfaceY(l.x, l.z)) {
        const [x, z] = this.near(focus.x, focus.z);
        const tile = this.map.tileAt(x, z), zone = this.map.zoneAt(x, z);
        const green = (tile === Tile.GRASS || tile === Tile.PLAZA || tile === Tile.FARM || tile === Tile.PASTURE || tile === Tile.CROP || tile === Tile.FIELD) && zone !== Zone.CoralKeys;
        // Norden: Heu-Flusen und Pollen (gold/weiß) statt Blätter
        const north = zone === Zone.DryPine || zone === Zone.CaneRidge || zone === Zone.Highlands;
        this.leafMesh.setColorAt(i, tmpC.setHex(north ? (i % 3 ? 0xe8d08a : 0xfff4c8) : [0x8fcc72, 0x52b85a, 0xb8c46a, 0xffb36b][i % 4]));
        if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
        Object.assign(l, { x, z, y: green ? (north ? 0.6 + this.rnd() * 3 : 4 + this.rnd() * 6) : -100, vy: 0.6 + this.rnd() * 0.6, spin: this.rnd() * 6, phase: this.rnd() * 6, life: 6 + this.rnd() * 8 });
      }
      l.y -= l.vy * dt;
      l.x += Math.sin(t * 1.3 + l.phase) * dt * 0.8 * U.uWind.value;
      l.z += Math.cos(t * 1.1 + l.phase) * dt * 0.5;
      tmpP.set(l.x, l.y, l.z);
      tmpE.set(t * 2 + l.spin, l.spin, t * 1.5);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(l.y < -50 ? 0 : 1);
      this.leafMesh.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    this.leafMesh.instanceMatrix.needsUpdate = true;
    this.leafMesh.visible = day > 0.1;

    // Glühwürmchen: nachts im Sumpf und in Gator Flats
    const pos = this.flyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < FLIES; i++) {
      const f = this.flies[i];
      if (Math.hypot(f.x - focus.x, f.z - focus.z) > RANGE * 1.3 || !f.ok) {
        const [x, z] = this.near(focus.x, focus.z);
        const tile = this.map.tileAt(x, z);
        // Sumpf, und abends an Feldrändern im Norden
        const zn = this.map.zoneAt(x, z);
        f.ok = zn === Zone.GatorFlats || tile === Tile.SWAMP
          || ((zn === Zone.DryPine || zn === Zone.CaneRidge || zn === Zone.Highlands) && (tile === Tile.PASTURE || tile === Tile.CROP || tile === Tile.FIELD || tile === Tile.FARM || tile === Tile.GRASS));
        f.x = x; f.z = z; f.y = Math.max(this.map.surfaceY(x, z), -0.3) + 0.5 + this.rnd() * 2.5;
      }
      const blink = Math.sin(t * 2.3 + f.phase * 7) > 0.2 ? 1 : 0;
      pos.setXYZ(i,
        f.x + Math.sin(t * 0.6 + f.phase) * 1.2,
        f.ok && blink ? f.y + Math.sin(t * 0.9 + f.phase) * 0.4 : -1000,
        f.z + Math.cos(t * 0.5 + f.phase) * 1.2);
    }
    pos.needsUpdate = true;
    this.flyPoints.visible = night > 0.3;
    this.flyMat.opacity = Math.min(1, (night - 0.3) * 2);
  }
}
