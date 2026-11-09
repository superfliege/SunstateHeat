// Sichtbare Smart Objects (shared/world/smartObjects.ts): Bänke, Haltestellen, Taco-Stand, Geldautomat,
// Telefonzelle, Club-Eingang mit Absperrseilen und Neonschild, Café-Tische, Basketballkorb, Angelplatz.
// Liegen, Mülltonnen und Zeitungsautomaten sind schon zerstörbare Props (PropsView). Alles wird zu
// zwei Geometrien (toon + Neon) verschmolzen: 2 Draw-Calls für die ganze Welt.
import * as THREE from 'three';
import { SmartKind, type SmartKindId } from '../../../shared/src/npc/scenarios';
import { generateSmartObjects, type SmartObject } from '../../../shared/src/world/smartObjects';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { box, cyl, merge } from './geom';
import { addOutline, LINE, toonMaterial } from './materials/toon';
import { toonVC } from './models';

type Parts = THREE.BufferGeometry[];
const WOOD = 0xb07a45, TEAL = 0x2ad4c9, PINK = 0xff4f8b, WHITE = 0xf4f1e8, DARK = 0x2b2b38, GRAY = 0x8a8aa0, BLUE = 0x3a8dff, YELLOW = 0xffe14d, RED = 0xe0453a;

const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Modell einer Art in lokalen Koordinaten (+z = Vorderseite). `neon` bekommt leuchtende Teile. */
function build(kind: SmartKindId, solid: Parts, neon: Parts) {
  switch (kind) {
    case SmartKind.Bench:
      solid.push(box(1.6, 0.08, 0.5, 0, 0.45, -0.05, WOOD), box(1.6, 0.5, 0.07, 0, 0.55, -0.3, WOOD, 0, -0.12),
        box(0.08, 0.45, 0.45, -0.7, 0, -0.05, DARK), box(0.08, 0.45, 0.45, 0.7, 0, -0.05, DARK));
      break;
    case SmartKind.BusStop:
      solid.push(
        box(0.09, 2.4, 0.09, -1.4, 0, -0.75, DARK), box(0.09, 2.4, 0.09, 1.4, 0, -0.75, DARK),
        box(0.09, 2.4, 0.09, -1.4, 0, 0.75, DARK), box(0.09, 2.4, 0.09, 1.4, 0, 0.75, DARK),
        box(3.1, 0.12, 1.8, 0, 2.4, 0, TEAL), box(2.8, 1.5, 0.05, 0, 0.7, -0.78, 0xaee3f2),
        box(1.6, 0.07, 0.45, 0, 0.45, -0.38, WOOD), box(1.6, 0.4, 0.06, 0, 0.55, -0.62, WOOD),
        box(0.07, 2.7, 0.07, 1.9, 0, 0.2, GRAY), box(0.7, 0.5, 0.06, 1.9, 2.3, 0.2, BLUE));
      neon.push(box(0.5, 0.3, 0.02, 1.9, 2.4, 0.24, 0xffffff));
      break;
    case SmartKind.TacoStand:
      solid.push(
        box(2.8, 1.0, 1.1, 0, 0, 0, 0xffa23a), box(2.9, 0.08, 1.2, 0, 1.0, 0, WOOD), box(2.8, 2.5, 0.1, 0, 0, -0.55, 0x3fae5a),
        box(0.08, 2.4, 0.08, -1.35, 0, 0.5, DARK), box(0.08, 2.4, 0.08, 1.35, 0, 0.5, DARK),
        ...[0, 1, 2, 3, 4, 5].map((i) => box(0.5, 0.06, 1.5, -1.25 + i * 0.5, 2.3 - 0.0, 0.0, i % 2 ? WHITE : RED, 0, 0.22)),
        box(1.5, 0.45, 0.06, 0, 1.35, -0.4, YELLOW));
      neon.push(box(1.3, 0.28, 0.02, 0, 1.43, -0.36, 0xff3d7f));
      break;
    case SmartKind.Atm:
      solid.push(box(0.9, 1.9, 0.5, 0, 0, 0, GRAY), box(0.7, 0.55, 0.05, 0, 1.1, 0.26, 0x1e2a44), box(0.7, 0.3, 0.2, 0, 0.8, 0.3, DARK, 0, -0.3), box(1.0, 0.35, 0.55, 0, 1.9, 0, BLUE));
      neon.push(box(0.6, 0.3, 0.02, 0, 1.92, 0.29, 0x6dffb0), box(0.6, 0.4, 0.02, 0, 1.12, 0.29, 0x7ac8ff));
      break;
    case SmartKind.Payphone:
      solid.push(
        box(0.08, 2.4, 0.08, -0.5, 0, -0.5, RED), box(0.08, 2.4, 0.08, 0.5, 0, -0.5, RED), box(0.08, 2.4, 0.08, -0.5, 0, 0.5, RED), box(0.08, 2.4, 0.08, 0.5, 0, 0.5, RED),
        box(1.2, 0.1, 1.2, 0, 2.4, 0, RED), box(1.0, 1.6, 0.04, 0, 0.5, -0.52, 0xaee3f2), box(0.4, 0.55, 0.15, 0, 1.0, -0.42, DARK));
      break;
    case SmartKind.ClubDoor: {
      solid.push(
        box(0.4, 3.4, 0.5, -1.5, 0, 0, DARK), box(0.4, 3.4, 0.5, 1.5, 0, 0, DARK), box(3.4, 0.5, 0.55, 0, 3.0, 0, DARK), box(2.6, 2.9, 0.1, 0, 0, -0.1, 0x120c20),
        box(1.5, 0.03, 6.4, 0, 0.0, 3.6, 0x8a1030));
      neon.push(box(3.0, 0.08, 0.06, 0, 2.85, 0.3, 0xff4fd8), box(3.0, 0.08, 0.06, 0, 0.08, 0.3, 0x2af0e6), box(0.08, 2.8, 0.06, -1.25, 0.1, 0.3, 0x2af0e6), box(0.08, 2.8, 0.06, 1.25, 0.1, 0.3, 0xff4fd8));
      // Absperrständer mit Seil entlang der Warteschlange (x = ±0.95)
      for (let i = 0; i < 4; i++) {
        const z = 1.4 + i * 1.9;
        for (const sx of [-1, 1]) {
          solid.push(cyl(0.05, 0.07, 0.95, 6, sx * 0.95, 0, z, 0xe8c04a), cyl(0.09, 0.09, 0.04, 6, sx * 0.95, 0, z, 0xe8c04a));
          if (i < 3) solid.push(box(0.04, 0.05, 1.9, sx * 0.95, 0.75, z + 0.95, 0x8a1030));
        }
      }
      break;
    }
    case SmartKind.CafeTable:
      // Tisch bei x = 0; Stühle bei x = ±0.9 blicken zum Tisch (Platzpositionen siehe SMART_KINDS)
      solid.push(cyl(0.55, 0.55, 0.05, 12, 0, 0.72, 0, WHITE), cyl(0.05, 0.05, 0.72, 6, 0, 0, 0, DARK), cyl(0.3, 0.3, 0.04, 8, 0, 0, 0, DARK),
        box(0.45, 0.06, 0.45, -0.95, 0.45, 0, TEAL), box(0.06, 0.5, 0.45, -1.17, 0.5, 0, TEAL), box(0.04, 0.45, 0.04, -0.95, 0, 0, DARK),
        box(0.45, 0.06, 0.45, 0.95, 0.45, 0, PINK), box(0.06, 0.5, 0.45, 1.17, 0.5, 0, PINK), box(0.04, 0.45, 0.04, 0.95, 0, 0, DARK),
        box(0.05, 2.1, 0.05, 0, 0.1, 0, WHITE), cyl(0.15, 1.5, 0.35, 8, 0, 2.15, 0, 0xffa23a));
      break;
    case SmartKind.Hoop:
      solid.push(box(0.16, 3.1, 0.16, 0, 0, -0.1, DARK), box(1.8, 1.1, 0.07, 0, 2.55, 0.05, WHITE), box(0.6, 0.45, 0.04, 0, 2.7, 0.1, RED),
        box(0.5, 0.04, 0.5, 0, 2.55, 0.4, 0xff8a2a), box(7.5, 0.03, 8.5, 0, 0, 4.0, 0x3a6aa8));
      break;
    case SmartKind.FishSpot:
      solid.push(box(0.5, 0.35, 0.35, 1.0, 0, -0.4, 0x2ad4c9), cyl(0.18, 0.15, 0.3, 8, -0.9, 0, -0.3, GRAY), box(0.04, 1.0, 0.04, -0.2, 0, 0.9, WOOD, 0, -0.5));
      break;
    case SmartKind.Door: // Tür an der Fassade (Wand liegt 0,9 m hinter dem Objekt), Lampe darüber
      solid.push(box(1.5, 2.45, 0.14, 0, 0, -0.86, DARK), box(1.2, 2.25, 0.1, 0, 0, -0.8, 0x6a4a3a), box(0.08, 0.08, 0.1, 0.42, 1.1, -0.74, 0xe8c04a),
        box(1.3, 0.12, 0.5, 0, 2.5, -0.65, TEAL));
      neon.push(box(0.3, 0.1, 0.1, 0, 2.42, -0.6, 0xfff1b0));
      break;
    case SmartKind.Grill:
      solid.push(cyl(0.45, 0.4, 0.5, 10, 0, 0.7, 0, DARK), box(0.06, 0.7, 0.06, -0.25, 0, 0, DARK), box(0.06, 0.7, 0.06, 0.25, 0, 0, DARK));
      break;
    default:
      break; // Wand, Liege, Mülltonne, Zeitungsautomat: kein eigenes Modell
  }
}

function neonSign(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.font = 'italic 900 84px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 68);
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(4.2, 1.05, 1);
  return s;
}

export class SmartObjectsView {
  readonly group = new THREE.Group();
  readonly objects: SmartObject[];

  constructor(private map: WorldMap) {
    this.objects = generateSmartObjects(map);
    const solid: Parts = [], neon: Parts = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const o of this.objects) {
      const s: Parts = [], n: Parts = [];
      build(o.kind, s, n);
      if (!s.length && !n.length) continue;
      const y = Math.max(map.surfaceY(o.x, o.z), map.terrainHeight(o.x, o.z)) + 0.02;
      m.compose(new THREE.Vector3(o.x, y, o.z), q.setFromAxisAngle(up, o.rot), new THREE.Vector3(1, 1, 1));
      for (const g of s) solid.push(g.applyMatrix4(m));
      for (const g of n) neon.push(g.applyMatrix4(m));
      if (o.kind === SmartKind.ClubDoor) {
        const sign = neonSign('CLUB', '#ff4fd8');
        const fx = Math.sin(o.rot), fz = Math.cos(o.rot);
        sign.position.set(o.x + fx * 0.6, y + 4.2, o.z + fz * 0.6);
        this.group.add(sign);
      }
      if (o.kind === SmartKind.TacoStand) {
        const sign = neonSign('TACOS', '#ffe14d');
        sign.scale.set(2.8, 0.7, 1);
        sign.position.set(o.x, y + 3.0, o.z);
        this.group.add(sign);
      }
    }
    if (solid.length) {
      const mesh = new THREE.Mesh(merge(solid), toonVC);
      mesh.frustumCulled = false;
      addOutline(mesh, LINE.prop);
      this.group.add(mesh);
    }
    if (neon.length) {
      const mesh = new THREE.Mesh(merge(neon), neonMat);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    void toonMaterial;
  }
}
