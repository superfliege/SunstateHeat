// Low-Poly-Waffenmodelle. Schusswaffen kommen aus dem Kenney Blaster Kit (Spec 4.6) und werden
// von Spielzeugfarben auf brüniertes Metall umgefärbt; Nahkampfwaffen und Molotov sind prozedural
// (auch Ersatz, falls das Kit fehlt). Alle zeigen entlang +z und liegen im Ursprung der Hand;
// Index = Position in WEAPONS (shared/weapons.ts).
import * as THREE from 'three';
import { WEAPONS, type WeaponId } from '../../../shared/src/weapons';
import { getModel, triangleColors, type ModelName } from './assets';
import { box, cyl, merge } from './geom';
import { toonVC } from './models';

/** Kit-Modell, Ziellänge (m) und Grundfarbe statt der bunten Kit-Farbe. */
const KIT_WEAPONS: Partial<Record<WeaponId, [ModelName, number, number]>> = {
  pistol: ['blaster-b', 0.38, 0x34363f],
  smg: ['blaster-h', 0.58, 0x2c2e36],
  shotgun: ['blaster-d', 0.95, 0x4a3a2c],
  rifle: ['blaster-e', 1.15, 0x30333a],
  rocket: ['blaster-f', 1.25, 0x56633a],
};

/** Blaster: Lauf nach +z drehen, auf Ziellänge skalieren, Griff an den Ursprung, umfärben. */
function kitWeapon(name: ModelName, length: number, main: number): THREE.BufferGeometry | null {
  const m = getModel(name);
  if (!m) return null;
  const g = m.body.clone();
  const k = length / m.size.z;
  g.scale(k, k, k);
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  // Griff = unterste Vertices; der Lauf zeigt vom Griff weg zum entfernteren Ende
  const pos = g.getAttribute('position');
  let gz = 0, gn = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < bb.min.y + (bb.max.y - bb.min.y) * 0.2) { gz += pos.getZ(i); gn++; }
  gz = gn ? gz / gn : 0;
  const cz = (bb.min.z + bb.max.z) / 2;
  if (gz > cz) { g.rotateY(Math.PI); gz = -gz; }
  const cx = (bb.min.x + bb.max.x) / 2;
  g.translate(-cx, -(bb.min.y + (bb.max.y - bb.min.y) * 0.62), -gz);
  // Farben: kräftige Spielzeugfarben -> Grundfarbe, helle Teile -> Stahl, Dunkles bleibt
  const out = new Uint32Array(m.triColors.length);
  for (let t = 0; t < out.length; t++) {
    const h = m.triColors[t];
    const r = (h >> 16) & 255, gg = (h >> 8) & 255, b = h & 255;
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    out[t] = max - min > 50 ? main : max > 150 ? 0x9aa0b0 : max > 70 ? 0x5a5e6a : 0x1e1f24;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(triangleColors(out, (x) => x), 3));
  g.computeBoundingSphere();
  return g;
}

const WOOD = 0xb5834a, METAL = 0x4a4d5a, DARK = 0x23232e, STEEL = 0xaab0c0, RED = 0xd8372f, SKIN = 0xf0c8a0;

/** Zylinder entlang z (statt y). */
function bar(r: number, len: number, x: number, y: number, z: number, color: number, seg = 6) {
  const g = cyl(r, r, len, seg, 0, -len / 2, 0, color);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z + len / 2);
  return g;
}

const BUILD: Record<WeaponId, () => THREE.BufferGeometry> = {
  fists: () => merge([box(0.22, 0.22, 0.26, 0, -0.11, 0.05, SKIN)]),
  bat: () => merge([bar(0.05, 0.9, 0, 0, -0.1, WOOD, 6), bar(0.075, 0.45, 0, 0, 0.55, WOOD, 6)]),
  machete: () => merge([box(0.06, 0.06, 0.2, 0, -0.03, 0, DARK), box(0.04, 0.16, 0.8, 0, -0.08, 0.2, STEEL)]),
  pistol: () => merge([box(0.1, 0.12, 0.34, 0, -0.04, 0.15, METAL), box(0.09, 0.2, 0.1, 0, -0.24, 0.02, DARK)]),
  smg: () => merge([box(0.12, 0.16, 0.5, 0, -0.06, 0.2, METAL), box(0.08, 0.28, 0.1, 0, -0.34, 0.12, DARK), box(0.07, 0.14, 0.08, 0, -0.2, -0.05, DARK)]),
  shotgun: () => merge([bar(0.05, 0.8, 0, 0.02, 0.35, METAL), box(0.11, 0.14, 0.32, 0, -0.07, -0.05, WOOD), bar(0.06, 0.3, 0, -0.06, 0.4, WOOD)]),
  rifle: () => merge([bar(0.04, 1.0, 0, 0.03, 0.45, METAL), box(0.11, 0.16, 0.45, 0, -0.08, -0.05, WOOD), box(0.06, 0.1, 0.22, 0, 0.1, 0.25, DARK)]),
  molotov: () => merge([cyl(0.1, 0.12, 0.3, 7, 0, -0.15, 0.1, 0x3fae5a), cyl(0.035, 0.05, 0.16, 6, 0, 0.15, 0.1, 0x3fae5a), box(0.06, 0.12, 0.06, 0, 0.3, 0.1, RED)]),
  rocket: () => merge([bar(0.11, 1.1, 0, 0.05, 0.3, 0x5b6b3a, 8), bar(0.15, 0.2, 0, 0.05, 0.95, DARK, 8), box(0.08, 0.16, 0.1, 0, -0.14, 0.1, DARK)]),
};

const cache = new Map<string, THREE.BufferGeometry>();

export function weaponGeometry(id: WeaponId): THREE.BufferGeometry {
  let g = cache.get(id);
  if (!g) {
    const kit = KIT_WEAPONS[id];
    g = (kit && kitWeapon(...kit)) || BUILD[id]();
    cache.set(id, g);
  }
  return g;
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** Mesh einer Waffe nach Index (null bei ungültigem Index). */
export function createWeaponMesh(index: number): THREE.Mesh | null {
  const id = WEAPON_IDS[index];
  if (!id) return null;
  const m = new THREE.Mesh(weaponGeometry(id), toonVC);
  m.castShadow = false;
  return m;
}
