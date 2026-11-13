// Gegenstände am Boden (#35, #36): Geldbündel und fallengelassene Waffen. Drehen sich leicht und
// schweben über einem Leuchtring, damit man sie zwischen Leichen und Verkehr sieht.
import * as THREE from 'three';
import type { PickupTuple } from '../../../shared/src/protocol';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

interface Item { root: THREE.Group; spin: THREE.Group; t: number }

const ringGeo = new THREE.RingGeometry(0.42, 0.62, 24).rotateX(-Math.PI / 2);
const moneyRingMat = new THREE.MeshBasicMaterial({ color: 0x5dff7a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const weaponRingMat = new THREE.MeshBasicMaterial({ color: 0xffc04a, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
const billMat = new THREE.MeshBasicMaterial({ color: 0x3fae55 });
const bandMat = new THREE.MeshBasicMaterial({ color: 0xf1e7c6 });
const gunMat = new THREE.MeshBasicMaterial({ color: 0x2a2a30 });
const gripMat = new THREE.MeshBasicMaterial({ color: 0x6b4a32 });
const batMat = new THREE.MeshBasicMaterial({ color: 0xc89a5a });

function moneyModel(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.18), billMat);
    b.position.set((i - 1) * 0.05, i * 0.065, (i % 2) * 0.03);
    b.rotation.y = (i - 1) * 0.25;
    g.add(b);
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.21, 0.2), bandMat);
  band.position.y = 0.065;
  g.add(band);
  return g;
}

function weaponModel(kind: string): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'bat' || kind === 'machete') {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.85, 8).rotateZ(Math.PI / 2), kind === 'bat' ? batMat : gunMat);
    g.add(b);
    return g;
  }
  const len = kind === 'pistol' ? 0.3 : kind === 'smg' ? 0.5 : 0.75;
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.07), gunMat);
  body.position.y = 0.08;
  g.add(body);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.06), gripMat);
  grip.position.set(-len * 0.25, -0.02, 0);
  grip.rotation.z = 0.25;
  g.add(grip);
  if (kind !== 'pistol') {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.06), gripMat);
    stock.position.set(-len * 0.55, 0.06, 0);
    g.add(stock);
  }
  return g;
}

export class PickupsView {
  readonly group = new THREE.Group();
  private items = new Map<number, Item>();

  constructor(private map: WorldMap) { this.group.name = 'pickups'; }

  apply(add: PickupTuple[] | undefined, gone: number[] | undefined) {
    for (const id of gone ?? []) this.remove(id);
    for (const [id, x, z, kind] of add ?? []) {
      this.remove(id);
      const root = new THREE.Group();
      const y = this.map.surfaceY(x, z);
      root.position.set(x, y, z);
      const ring = new THREE.Mesh(ringGeo, kind === 'money' ? moneyRingMat : weaponRingMat);
      ring.position.y = 0.04;
      ring.renderOrder = 2;
      const spin = new THREE.Group();
      spin.add(kind === 'money' ? moneyModel() : weaponModel(kind));
      spin.position.y = 0.45;
      root.add(ring, spin);
      this.group.add(root);
      this.items.set(id, { root, spin, t: Math.random() * 6 });
    }
  }

  private remove(id: number) {
    const it = this.items.get(id);
    if (!it) return;
    this.group.remove(it.root);
    it.root.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry !== ringGeo) o.geometry.dispose(); });
    this.items.delete(id);
  }

  update(dt: number) {
    for (const it of this.items.values()) {
      it.t += dt;
      it.spin.rotation.y = it.t * 1.8;
      it.spin.position.y = 0.45 + Math.sin(it.t * 2.5) * 0.08;
    }
  }
}
