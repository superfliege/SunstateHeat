// Zerstörbare Straßenmöbel (Laternen, Hydranten, Bänke, Mülltonnen, Zeitungsautomaten, Kegel,
// Strandliegen). Intakte Props: instanziert je Typ und 256-m-Region (Culling). Getroffene Props
// kommen mit Position/Orientierung vom Server und werden als eigene Meshes gezeigt; ihre
// Instanz wird so lange ausgeblendet. Laternen haben eine Leuchte, die nachts brennt.
import * as THREE from 'three';
import type { PropTuple } from '../../../shared/src/protocol';
import { generateProps, PropType, type Prop } from '../../../shared/src/world/features';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { getModel, type ModelName } from './assets';
import { box, cyl, merge } from './geom';
import { standaloneTexture } from './materials/atlas';
import { addOutline, LINE } from './materials/toon';
import { toonVC } from './models';

const REGION = 256;
const LAMP_SCALE = 6.8;

interface TypeGeo { geo: THREE.BufferGeometry; mat: THREE.Material }
interface Inst { mesh: THREE.InstancedMesh; index: number; bulb?: { mesh: THREE.InstancedMesh; index: number }; matrix: THREE.Matrix4 }
interface Loose { mesh: THREE.Mesh; target: THREE.Vector3; q: THREE.Quaternion; spray: boolean; first: boolean; confirmed: boolean; age: number }

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

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
  private dirty = new Set<THREE.InstancedMesh>();
  /** Hydranten mit Fontäne (für die Effekte) */
  readonly sprays: THREE.Vector3[] = [];

  constructor(private map: WorldMap) {
    this.props = generateProps(map);
    this.buildTypes();
    this.buildInstances();
  }

  private buildTypes() {
    const lamp = getModel('streetlight');
    let lampGeo: THREE.BufferGeometry;
    if (lamp) {
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
    geos[PropType.Cone] = merge([box(0.5, 0.05, 0.5, 0, 0, 0, 0x222222), cyl(0.04, 0.22, 0.7, 8, 0, 0.05, 0, 0xff6a1a), cyl(0.12, 0.15, 0.12, 8, 0, 0.36, 0, 0xf4f4f4)]);
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
    // nach Typ und Region gruppieren
    const groups = new Map<string, Prop[]>();
    for (const p of this.props) {
      const k = `${p.type}:${Math.floor(p.x / REGION)}:${Math.floor(p.z / REGION)}`;
      let l = groups.get(k);
      if (!l) groups.set(k, (l = []));
      l.push(p);
    }
    const bulbGeo = new THREE.BoxGeometry(0.7, 0.25, 0.7);
    const poolGeo = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
    for (const list of groups.values()) {
      const t = this.types[list[0].type];
      const mesh = new THREE.InstancedMesh(t.geo, t.mat, list.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      let bulbs: THREE.InstancedMesh | null = null, pools: THREE.InstancedMesh | null = null;
      if (list[0].type === PropType.Lamp) {
        bulbs = new THREE.InstancedMesh(bulbGeo, this.lampMat, list.length);
        pools = new THREE.InstancedMesh(poolGeo, this.poolMat, list.length);
        pools.renderOrder = 2;
      }
      list.forEach((p, i) => {
        const m = this.matrixOf(p, new THREE.Matrix4());
        mesh.setMatrixAt(i, m);
        const inst: Inst = { mesh, index: i, matrix: m };
        if (bulbs && pools) {
          tmpP.copy(this.bulbLocal).applyMatrix4(m);
          bulbs.setMatrixAt(i, tmpM.makeTranslation(tmpP.x, tmpP.y, tmpP.z));
          pools.setMatrixAt(i, tmpM.makeTranslation(tmpP.x, this.map.surfaceY(tmpP.x, tmpP.z) + 0.08, tmpP.z));
          inst.bulb = { mesh: bulbs, index: i };
        }
        this.inst.set(p.id, inst);
      });
      mesh.computeBoundingSphere();
      addOutline(mesh, LINE.prop);
      this.group.add(mesh);
      if (bulbs && pools) {
        bulbs.computeBoundingSphere(); pools.computeBoundingSphere();
        this.group.add(bulbs, pools);
        // Lichtkegel teilt sich die Sichtbarkeit mit der Leuchte
        (bulbs.userData as { pools?: THREE.InstancedMesh }).pools = pools;
      }
    }
  }

  private setInstanceVisible(id: number, visible: boolean) {
    const inst = this.inst.get(id);
    if (!inst) return;
    inst.mesh.setMatrixAt(inst.index, visible ? inst.matrix : ZERO);
    this.dirty.add(inst.mesh);
    if (inst.bulb) {
      const pools = (inst.bulb.mesh.userData as { pools?: THREE.InstancedMesh }).pools!;
      if (visible) {
        tmpP.copy(this.bulbLocal).applyMatrix4(inst.matrix);
        inst.bulb.mesh.setMatrixAt(inst.bulb.index, tmpM.makeTranslation(tmpP.x, tmpP.y, tmpP.z));
        pools.setMatrixAt(inst.bulb.index, tmpM.makeTranslation(tmpP.x, this.map.surfaceY(tmpP.x, tmpP.z) + 0.08, tmpP.z));
      } else {
        inst.bulb.mesh.setMatrixAt(inst.bulb.index, ZERO);
        pools.setMatrixAt(inst.bulb.index, ZERO);
      }
      this.dirty.add(inst.bulb.mesh); this.dirty.add(pools);
    }
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
    for (const m of this.dirty) m.instanceMatrix.needsUpdate = true;
    this.dirty.clear();
  }

  /** Ist das Prop laut letztem Server-Stand verschoben? */
  isLoose(id: number) { return this.loose.has(id); }
}

