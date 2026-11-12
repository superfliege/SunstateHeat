// Zerstörbare Straßenmöbel (Laternen, Hydranten, Bänke, Mülltonnen, Zeitungsautomaten, Kegel,
// Strandliegen). Intakte Props: EINE InstancedMesh je Typ für die ganze Welt, gefüllt pro Bild nur
// mit den Instanzen im Sichtfeld bzw. deren Schatten ins Bild fallen kann (ViewCull, wie Pflanzen).
// Vorher: je Typ und 256-m-Region – ganze Regionen samt Umriss und Schattenpass.
// Getroffene Props kommen mit Position/Orientierung vom Server und werden als eigene Meshes gezeigt;
// ihre Instanz wird so lange ausgeblendet. Laternen haben eine Leuchte, die nachts brennt.
import * as THREE from 'three';
import type { PropTuple } from '../../../shared/src/protocol';
import { generateProps, PropType, type Prop } from '../../../shared/src/world/features';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { getModel, type ModelName } from './assets';
import { box, cyl, merge } from './geom';
import { standaloneTexture } from './materials/atlas';
import { addOutline, LINE } from './materials/toon';
import { toonVC } from './models';
import { cellOf, CULL_CELLS, ViewCull } from './PlantField';

const LAMP_SCALE = 6.8;

interface TypeGeo { geo: THREE.BufferGeometry; mat: THREE.Material }
/** Alle Props eines Typs: Basismatrizen (+ Leuchte/Lichtkegel bei Laternen), Raster, Ausgabe-Meshes. */
interface TypeInst {
  ids: number[]; mats: Float32Array; bulbs: Float32Array | null; pools: Float32Array | null;
  sphere: Float32Array; height: number; cells: Map<number, number[]>;
  mesh: THREE.InstancedMesh; hull: THREE.InstancedMesh; bulbMesh: THREE.InstancedMesh | null; poolMesh: THREE.InstancedMesh | null;
}
interface Inst { t: TypeInst; index: number; matrix: THREE.Matrix4 }
interface Loose { mesh: THREE.Mesh; target: THREE.Vector3; q: THREE.Quaternion; spray: boolean; first: boolean; confirmed: boolean; age: number }

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Kit-Modell skaliert, oder null */
function kit(name: ModelName, scale: number) {
  const m = getModel(name);
  if (!m) return null;
  return m.body.clone().scale(scale, scale, scale);
}

export class PropsView {
  readonly group = new THREE.Group();
  readonly props: Prop[];
  private types: TypeGeo[] = [];
  private inst = new Map<number, Inst>();
  private loose = new Map<number, Loose>();
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
  private poolMat = new THREE.MeshBasicMaterial({ color: 0xffc070, map: standaloneTexture('lamp_pool'), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private bulbLocal = new THREE.Vector3();
  private typeInst: TypeInst[] = [];
  /** Umgeworfene Props (Instanz ausgeblendet). */
  private hidden = new Set<number>();
  private cull = new ViewCull();
  private dirty = true;
  /** Hydranten mit Fontäne (für die Effekte) */
  readonly sprays: THREE.Vector3[] = [];

  constructor(private map: WorldMap) {
    this.props = generateProps(map);
    this.buildTypes();
    this.buildInstances();
  }

  private buildTypes() {
    const lamp = getModel('streetlight');
    const curved = getModel('light-curved');
    let lampGeo: THREE.BufferGeometry;
    if (curved) {
      // Kenney Roads: geschwungene Mastleuchte. Mast an den Ursprung, Ausleger nach +z (zur Fahrbahn)
      const g = curved.body.clone();
      const k = 7.6 / curved.size.y;
      g.scale(k, k, k);
      const pos = g.getAttribute('position');
      const H = curved.size.y * k;
      let mx = 0, mz = 0, mn = 0, tx = 0, tz = 0, tn = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < H * 0.15) { mx += pos.getX(i); mz += pos.getZ(i); mn++; }
        if (y > H * 0.85) { tx += pos.getX(i); tz += pos.getZ(i); tn++; }
      }
      mx /= mn || 1; mz /= mn || 1; tx /= tn || 1; tz /= tn || 1;
      g.translate(-mx, 0, -mz);
      // Ausleger-Richtung (tx-mx, tz-mz) auf +z drehen
      g.rotateY(-Math.atan2(tx - mx, tz - mz));
      lampGeo = g;
      g.computeBoundingBox();
      this.bulbLocal.set(0, H - 0.45, g.boundingBox!.max.z - 0.35);
    } else if (lamp) {
      const w = lamp.size.x * LAMP_SCALE;
      // Mast an den Ursprung, Arm entlang +z (= Richtung Fahrbahn)
      lampGeo = lamp.body.clone().scale(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE).translate(-w / 2, 0, 0).rotateY(Math.PI / 2);
      this.bulbLocal.set(0, lamp.size.y * LAMP_SCALE - 0.35, w - 0.3);
    } else {
      lampGeo = merge([box(0.18, 6, 0.18, 0, 0, 0, 0x5a5a66), box(0.12, 0.12, 2.2, 0, 5.9, 1.1, 0x5a5a66)]);
      this.bulbLocal.set(0, 5.8, 2.1);
    }
    const g = (geo: THREE.BufferGeometry | null, fallback: () => THREE.BufferGeometry) => geo ?? fallback();
    const geos: THREE.BufferGeometry[] = [];
    geos[PropType.Lamp] = lampGeo;
    geos[PropType.Hydrant] = g(kit('hydrant', 5), () => merge([cyl(0.2, 0.22, 0.7, 8, 0, 0, 0, 0xd83a3a), cyl(0.24, 0.24, 0.12, 8, 0, 0.7, 0, 0xd83a3a)]));
    geos[PropType.Bench] = g(kit('bench', 5), () => merge([box(1.6, 0.08, 0.5, 0, 0.45, 0, 0x9a6a3a), box(1.6, 0.4, 0.08, 0, 0.5, -0.22, 0x9a6a3a), box(0.08, 0.45, 0.45, -0.7, 0, 0, 0x333333), box(0.08, 0.45, 0.45, 0.7, 0, 0, 0x333333)]));
    geos[PropType.Trash] = g(kit('trash', 5), () => cyl(0.32, 0.28, 0.9, 8, 0, 0, 0, 0x3f7a4a));
    geos[PropType.Newsbox] = merge([box(0.55, 1.0, 0.45, 0, 0.1, 0, 0x2a5bd8), box(0.45, 0.3, 0.02, 0, 0.6, 0.23, 0xd8e6f0), box(0.08, 0.12, 0.4, -0.2, 0, 0, 0x333333), box(0.08, 0.12, 0.4, 0.2, 0, 0, 0x333333)]);
    geos[PropType.Cone] = kit('construction-cone', 0.75 / (getModel('construction-cone')?.size.y ?? 1)) ?? merge([box(0.5, 0.05, 0.5, 0, 0, 0, 0x222222), cyl(0.04, 0.22, 0.7, 8, 0, 0.05, 0, 0xff6a1a), cyl(0.12, 0.15, 0.12, 8, 0, 0.36, 0, 0xf4f4f4)]);
    geos[PropType.Lounger] = merge([box(0.65, 0.08, 1.7, 0, 0.3, 0, 0xf2f2ea), box(0.6, 0.06, 0.6, 0, 0.42, -0.65, 0x2ad4c9, 0, 0.6), box(0.06, 0.3, 0.06, 0.28, 0, 0.75, 0xcccccc), box(0.06, 0.3, 0.06, -0.28, 0, 0.75, 0xcccccc), box(0.06, 0.3, 0.06, 0.28, 0, -0.75, 0xcccccc), box(0.06, 0.3, 0.06, -0.28, 0, -0.75, 0xcccccc)]);
    for (const geo of geos) geo.computeBoundingSphere();
    // Kit-Modelle haben Vertex-Farben – alle mit dem Toon-Material
    this.types = geos.map((geo) => ({ geo, mat: toonVC }));
  }

  private matrixOf(p: Prop, out: THREE.Matrix4) {
    tmpQ.setFromAxisAngle(UP, p.rot);
    tmpP.set(p.x, p.y, p.z);
    return out.compose(tmpP, tmpQ, tmpS.set(1, 1, 1));
  }

  private buildInstances() {
    const byType = new Map<number, Prop[]>();
    for (const p of this.props) {
      let l = byType.get(p.type);
      if (!l) byType.set(p.type, (l = []));
      l.push(p);
    }
    const bulbGeo = new THREE.BoxGeometry(0.7, 0.25, 0.7);
    const poolGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
    for (const [type, list] of byType) {
      const tg = this.types[type];
      const n = list.length;
      tg.geo.computeBoundingBox();
      const bb = tg.geo.boundingBox!;
      const lamp = type === PropType.Lamp;
      const mesh = new THREE.InstancedMesh(tg.geo, tg.mat, n);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false; // eigenes Culling pro Instanz
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      const hull = addOutline(mesh, LINE.prop) as THREE.InstancedMesh;
      hull.frustumCulled = false;
      this.group.add(mesh);
      const t: TypeInst = {
        ids: [], mats: new Float32Array(n * 16), bulbs: lamp ? new Float32Array(n * 16) : null, pools: lamp ? new Float32Array(n * 16) : null,
        sphere: new Float32Array(n * 4), height: bb.max.y, cells: new Map(), mesh, hull, bulbMesh: null, poolMesh: null,
      };
      if (lamp) {
        t.bulbMesh = new THREE.InstancedMesh(bulbGeo, this.lampMat, n);
        t.poolMesh = new THREE.InstancedMesh(poolGeo, this.poolMat, n);
        t.poolMesh.renderOrder = 2;
        for (const m of [t.bulbMesh, t.poolMesh]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.group.add(m); }
      }
      const r = Math.hypot(Math.max(-bb.min.x, bb.max.x), bb.max.y / 2, Math.max(-bb.min.z, bb.max.z)) + (lamp ? 5 : 0.3); // Laterne: Lichtkegel 10 m
      list.forEach((p, i) => {
        const m = this.matrixOf(p, new THREE.Matrix4());
        m.toArray(t.mats, i * 16);
        if (t.bulbs && t.pools) {
          tmpP.copy(this.bulbLocal).applyMatrix4(m);
          tmpM.makeTranslation(tmpP.x, tmpP.y, tmpP.z).toArray(t.bulbs, i * 16);
          tmpM.makeTranslation(tmpP.x, this.map.surfaceY(tmpP.x, tmpP.z) + 0.08, tmpP.z).toArray(t.pools, i * 16);
        }
        t.sphere.set([p.x, p.y + bb.max.y / 2, p.z, r], i * 4);
        t.ids.push(p.id);
        const k = cellOf(p.x, p.z);
        let c = t.cells.get(k);
        if (!c) t.cells.set(k, (c = []));
        c.push(i);
        this.inst.set(p.id, { t, index: i, matrix: m });
      });
      this.typeInst.push(t);
    }
    void CULL_CELLS;
  }

  /**
   * Sichtbare Props in die Instanz-Meshes kopieren (nur bei Kamera-/Sonnen-/Dunst-Änderung oder
   * umgeworfenen Props). shadowDir = Schattenversatz je Meter Höhe oder null.
   */
  cullView(camera: THREE.PerspectiveCamera, shadowDir: THREE.Vector3 | null, fogFar: number) {
    const V = this.cull;
    if (!V.prepare(camera, shadowDir, fogFar) && !this.dirty) return;
    this.dirty = false;
    for (const t of this.typeInst) {
      const out = t.mesh.instanceMatrix.array as Float32Array;
      const ob = t.bulbMesh?.instanceMatrix.array as Float32Array | undefined, op = t.poolMesh?.instanceMatrix.array as Float32Array | undefined;
      let w = 0;
      for (let cz = V.cz0; cz <= V.cz1; cz++) {
        for (let cx = V.cx0; cx <= V.cx1; cx++) {
          const list = t.cells.get(cz * CULL_CELLS + cx);
          if (!list) continue;
          for (const i of list) {
            if (this.hidden.has(t.ids[i])) continue;
            const o = i * 4;
            if (!V.test(t.sphere[o], t.sphere[o + 1], t.sphere[o + 2], t.sphere[o + 3], t.height, true)) continue;
            out.set(t.mats.subarray(i * 16, i * 16 + 16), w * 16);
            if (ob && op) { ob.set(t.bulbs!.subarray(i * 16, i * 16 + 16), w * 16); op.set(t.pools!.subarray(i * 16, i * 16 + 16), w * 16); }
            w++;
          }
        }
      }
      for (const m of [t.mesh, t.bulbMesh, t.poolMesh]) {
        if (!m) continue;
        m.count = w; m.visible = w > 0;
        const a = m.instanceMatrix;
        a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, w) * 16); a.needsUpdate = true;
      }
      t.hull.count = w;
    }
  }

  /** Shader-Aufwärmen: je Typ eine Instanz zeigen (nächstes cullView() baut neu auf). */
  warmupInstances() {
    for (const t of this.typeInst) {
      for (const [m, src] of [[t.mesh, t.mats], [t.bulbMesh, t.bulbs], [t.poolMesh, t.pools]] as const) {
        if (!m || !src) continue;
        (m.instanceMatrix.array as Float32Array).set(src.subarray(0, 16), 0);
        m.instanceMatrix.needsUpdate = true; m.count = 1; m.visible = true;
      }
      t.hull.count = 1;
    }
    this.dirty = true;
  }

  private setInstanceVisible(id: number, visible: boolean) {
    if (!this.inst.has(id)) return;
    if (visible) this.hidden.delete(id); else this.hidden.add(id);
    this.dirty = true;
  }

  /** Prop lokal sofort umwerfen (Vorhersage), bis der Server-Zustand kommt. */
  knockLocal(id: number, vx: number, vz: number) {
    if (this.loose.has(id)) return;
    const p = this.props[id];
    if (!p) return;
    this.setInstanceVisible(id, false);
    const m = this.addLoose(p);
    // grobe Vorschau der Flugrichtung
    m.target.set(p.x + vx * 0.15, p.y + (p.type === PropType.Lamp || p.type === PropType.Hydrant ? 0 : 0.6), p.z + vz * 0.15);
  }

  private addLoose(p: Prop): Loose {
    const t = this.types[p.type];
    const mesh = new THREE.Mesh(t.geo, t.mat);
    mesh.castShadow = true;
    addOutline(mesh, LINE.prop);
    mesh.position.set(p.x, p.y, p.z);
    mesh.quaternion.setFromAxisAngle(UP, p.rot);
    this.group.add(mesh);
    const l: Loose = { mesh, target: mesh.position.clone(), q: mesh.quaternion.clone(), spray: false, first: true, confirmed: false, age: 0 };
    this.loose.set(p.id, l);
    return l;
  }

  /** Je ein umgeworfenes Prop pro Typ (nur fürs Shader-Aufwärmen; Aufrufer entfernt sie wieder). */
  warmupMeshes(x: number, y: number, z: number): THREE.Object3D[] {
    return this.types.map((t) => {
      const mesh = new THREE.Mesh(t.geo, t.mat);
      mesh.castShadow = true;
      addOutline(mesh, LINE.prop);
      mesh.position.set(x, y, z);
      return mesh;
    });
  }

  /** Delta vom Server: verschobene Props + zurückgesetzte (respawnte) IDs. */
  apply(list: PropTuple[] | undefined, gone: number[] | undefined) {
    for (const t of list ?? []) {
      const [id, x, y, z, qx, qy, qz, qw, flags] = t;
      const p = this.props[id];
      if (!p) continue;
      let l = this.loose.get(id);
      if (!l) { this.setInstanceVisible(id, false); l = this.addLoose(p); }
      l.target.set(x, y, z);
      l.q.set(qx, qy, qz, qw);
      l.spray = (flags & 2) !== 0;
      l.confirmed = true;
      if (l.first && !(flags & 1)) l.first = false;
    }
    for (const id of gone ?? []) {
      const l = this.loose.get(id);
      if (!l) continue;
      this.group.remove(l.mesh);
      this.loose.delete(id);
      this.setInstanceVisible(id, true);
    }
  }

  setNight(night: number) {
    this.lampMat.color.setHex(0x9a9488).lerp(new THREE.Color(0xfff0b0), night).multiplyScalar(1 + night * 0.6);
    this.poolMat.opacity = night * 0.45;
  }

  update(dt: number) {
    const k = 1 - Math.exp(-14 * dt);
    this.sprays.length = 0;
    for (const [id, l] of this.loose) {
      // lokal vorhergesagter Treffer, den der Server nicht bestätigt hat: zurücksetzen
      l.age += dt;
      if (!l.confirmed && l.age > 1.5) { this.group.remove(l.mesh); this.loose.delete(id); this.setInstanceVisible(id, true); continue; }
      l.mesh.position.lerp(l.target, k);
      l.mesh.quaternion.slerp(l.q, k);
      if (l.spray) this.sprays.push(l.mesh.position);
    }
  }

  /** Ist das Prop laut letztem Server-Stand verschoben? */
  isLoose(id: number) { return this.loose.has(id); }
}

