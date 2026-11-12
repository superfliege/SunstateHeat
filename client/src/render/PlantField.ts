// Vegetation mit Culling pro Instanz.
//
// Vorher: je 128-m-Chunk und Pflanzenvariante eine InstancedMesh – war ein Teil des Chunks im Bild
// (oder im ±110-m-Schattenbereich), wurden ALLE Bäume des Chunks gezeichnet, dreifach (Farbe,
// Umrisshülle, Schattenpass). Die Kamera (feste Neigung 56°) sieht aber nur einen Bodenstreifen von
// ~120 x 60 m – gemessen wurden bis zu 4,6 Mio. Dreiecke pro Bild, fast alles unsichtbare Vegetation.
//
// Jetzt: je Variante (Modellteil) EINE InstancedMesh für die ganze Welt. Pro Bild werden nur die
// Instanzen hineinkopiert, die
//   - im Kamera-Frustum liegen (Kugeltest), oder
//   - deren Schatten ins Bild fallen kann (Kugel entlang der Schattenrichtung verschoben), und
//   - nicht komplett im Dunst verschwinden (Sichttiefe > fog.far).
// Alle Pflanzen bleiben in der Welt; es entfällt nur, was ohnehin nicht zu sehen ist.
// Draw-Calls skalieren mit der Zahl sichtbarer Varianten statt mit der Zahl der Chunks.
import * as THREE from 'three';
import { WORLD_SIZE } from '../../../shared/src/constants';
import { addOutline, LINE } from './materials/toon';
import type { PlantVariant } from './Vegetation';

/** Rasterzelle für die Kandidatensuche (m). */
const CELL = 32;
const CELLS = Math.ceil(WORLD_SIZE / CELL);
/** Bodendecker (Gras, Blumen …) nur bis zu dieser Entfernung vom Kamerafokus – wie vorher (230 m + Chunk-Toleranz). */
const COVER_DISTANCE = 230 + 128 * 0.71;
/** Längster berücksichtigter Schatten (m) – flache Sonne. */
const MAX_SHADOW = 70;
/**
 * Sicherheitsrand (m): Kugeln werden um so viel vergrößert getestet. Dafür muss die Auswahl erst neu
 * berechnet werden, wenn sich die Kamera um mehr als diesen Rand bewegt hat (statt in jedem Bild).
 */
const MARGIN = 3;

export interface PlantKind {
  variant: PlantVariant;
  cover: boolean;
  /** Basismatrizen aller Instanzen (16 Floats je Instanz). */
  mats: Float32Array;
  /** Mittelpunkt und Radius der Hüllkugel je Instanz. */
  sphere: Float32Array;
  /** Höhe (für die Schattenlänge) je Instanz. */
  height: Float32Array;
  n: number;
  /** Instanz-Indizes je Rasterzelle. */
  cells: Map<number, number[]>;
  meshes: THREE.InstancedMesh[];
  /** Index der Instanz je Ausgabeplatz (für Wackel-Updates). */
  slots: Int32Array;
  count: number;
}

const tmpS = new THREE.Sphere(), tmpM = new THREE.Matrix4();
const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const ray = new THREE.Vector3();

/**
 * Sichtbarkeit pro Instanz (geteilt von Pflanzen und Straßenmöbeln): Kamera-Frustum, Schatten, die ins
 * Bild fallen können, und Dunst-Ende. prepare() einmal pro Bild, dann test() je Instanz; die
 * Kandidaten-Rasterzellen (CELL m) stehen in cx0..cx1 / cz0..cz1.
 */
export class ViewCull {
  readonly frustum = new THREE.Frustum();
  readonly origin = new THREE.Vector3();
  cx0 = 0; cx1 = -1; cz0 = 0; cz1 = -1;
  private fx = 0; private fy = 0; private fz = 0;
  private fogFar = Infinity;
  private sx = 0; private sz = 0; private shadow = false;
  private key = '';
  private last = new THREE.Vector3(1e9, 0, 0);

  /** Kamera/Sonne/Dunst übernehmen; false = unverändert seit dem letzten Aufruf (Neuaufbau unnötig). */
  prepare(camera: THREE.PerspectiveCamera, shadowDir: THREE.Vector3 | null, fogFar: number): boolean {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const sx = shadowDir ? shadowDir.x : 0, sz = shadowDir ? shadowDir.z : 0;
    // Kamera-Position relativ zum letzten Neuaufbau: erst ab MARGIN Bewegung neu rechnen
    const moved = Math.hypot(e[12] - this.last.x, e[13] - this.last.y, e[14] - this.last.z) > MARGIN * 0.9;
    const key = `${(e[8] * 200) | 0},${(e[10] * 200) | 0},${camera.fov | 0},${(camera.aspect * 100) | 0},${(sx * 50) | 0},${(sz * 50) | 0},${(fogFar / 4) | 0}`;
    if (key === this.key && !moved) return false;
    this.last.set(e[12], e[13], e[14]);
    this.key = key;
    this.sx = sx; this.sz = sz; this.shadow = !!shadowDir; this.fogFar = fogFar;
    this.frustum.setFromProjectionMatrix(tmpM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const origin = this.origin.setFromMatrixPosition(camera.matrixWorld);
    // Kandidatenbereich: Schnitt der Frustum-Eckstrahlen mit den Ebenen y = -2 und y = 60
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const far = Math.min(camera.far, fogFar + 40);
    for (const [nx, ny] of ndc) {
      ray.set(nx, ny, 0.5).unproject(camera).sub(origin).normalize();
      for (const py of [-2, 60]) {
        let t = ray.y !== 0 ? (py - origin.y) / ray.y : far;
        if (!(t > 0) || t > far) t = far;
        const px = origin.x + ray.x * t, pz = origin.z + ray.z * t;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
      }
    }
    // Schattenwerfer stehen von der Bildfläche aus gesehen Richtung Sonne
    if (shadowDir) {
      const sl = Math.hypot(sx, sz) || 1, shLen = Math.min(MAX_SHADOW, sl * 30);
      x0 = Math.min(x0, x0 - (sx / sl) * shLen); x1 = Math.max(x1, x1 - (sx / sl) * shLen);
      z0 = Math.min(z0, z0 - (sz / sl) * shLen); z1 = Math.max(z1, z1 - (sz / sl) * shLen);
    }
    const pad = 12;
    this.cx0 = Math.max(0, Math.floor((x0 - pad) / CELL)); this.cx1 = Math.min(CELLS - 1, Math.floor((x1 + pad) / CELL));
    this.cz0 = Math.max(0, Math.floor((z0 - pad) / CELL)); this.cz1 = Math.min(CELLS - 1, Math.floor((z1 + pad) / CELL));
    // Blickrichtung für die Sichttiefe (wie der Dunst im Shader)
    this.fx = -e[8]; this.fy = -e[9]; this.fz = -e[10];
    return true;
  }

  /** Kugel (Mitte, Radius) mit Höhe h sichtbar – oder ihr Bodenschatten (falls casts)? */
  test(px: number, py: number, pz: number, r: number, h: number, casts: boolean): boolean {
    const o = this.origin;
    r += MARGIN;
    if ((px - o.x) * this.fx + (py - o.y) * this.fy + (pz - o.z) * this.fz - r > this.fogFar) return false;
    tmpS.center.set(px, py, pz); tmpS.radius = r;
    if (this.frustum.intersectsSphere(tmpS)) return true;
    if (!casts || !this.shadow) return false;
    // Schatten auf dem Boden: Mitte und Spitze prüfen (Länge = Höhe / tan(Sonnenhöhe), gedeckelt)
    let ox = this.sx * h, oz = this.sz * h;
    const ol = Math.hypot(ox, oz);
    if (ol > MAX_SHADOW) { ox *= MAX_SHADOW / ol; oz *= MAX_SHADOW / ol; }
    const gy = py - h * 0.5;
    tmpS.center.set(px + ox * 0.5, gy, pz + oz * 0.5);
    if (this.frustum.intersectsSphere(tmpS)) return true;
    tmpS.center.set(px + ox, gy, pz + oz);
    return this.frustum.intersectsSphere(tmpS);
  }
}

/** Instanz-Index in die Rasterzelle eintragen. */
export function cellOf(x: number, z: number) {
  const cx = Math.min(CELLS - 1, Math.max(0, Math.floor(x / CELL)));
  const cz = Math.min(CELLS - 1, Math.max(0, Math.floor(z / CELL)));
  return cz * CELLS + cx;
}
export const CULL_CELLS = CELLS;

export class PlantField {
  readonly group = (() => { const g = new THREE.Group(); g.name = 'plants'; return g; })();
  readonly kinds: PlantKind[] = [];
  private cull = new ViewCull();
  /** Neuaufbau beim nächsten update() erzwingen (Wackeln, Aufwärmen). */
  private dirty = true;
  /** Statistik fürs Debug-Overlay: sichtbare Instanzen. */
  visible = 0;

  /** Aus gesammelten Matrizen aufbauen (einmal beim Start). */
  add(variant: PlantVariant, cover: boolean, list: THREE.Matrix4[]) {
    const n = list.length;
    if (!n) return null;
    const mats = new Float32Array(n * 16), sphere = new Float32Array(n * 4), height = new Float32Array(n);
    // Hüllkugel der Variante (alle Teile)
    const box = new THREE.Box3();
    for (const p of variant.parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    const local = box.getBoundingSphere(new THREE.Sphere());
    const cells = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const m = list[i];
      m.toArray(mats, i * 16);
      tmpS.copy(local).applyMatrix4(m);
      sphere.set([tmpS.center.x, tmpS.center.y, tmpS.center.z, tmpS.radius], i * 4);
      const sy = Math.hypot(m.elements[4], m.elements[5], m.elements[6]);
      height[i] = box.max.y * sy;
      const k = cellOf(m.elements[12], m.elements[14]);
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push(i);
    }
    const meshes: THREE.InstancedMesh[] = [];
    let shared: THREE.InstancedBufferAttribute | null = null;
    for (const part of variant.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, n);
      if (shared) mesh.instanceMatrix = shared; else { shared = mesh.instanceMatrix; shared.setUsage(THREE.DynamicDrawUsage); }
      mesh.count = 0;
      mesh.frustumCulled = false; // eigenes Culling pro Instanz
      mesh.castShadow = variant.shadow;
      mesh.receiveShadow = true;
      mesh.userData.plant = true;
      meshes.push(mesh);
      this.group.add(mesh);
      if (variant.outline) {
        const hull = addOutline(mesh, cover ? LINE.prop : LINE.tree, { wind: true }) as THREE.InstancedMesh;
        hull.frustumCulled = false;
        hull.count = 0;
        meshes.push(hull);
      }
    }
    const kind: PlantKind = { variant, cover, mats, sphere, height, n, cells, meshes, slots: new Int32Array(n), count: 0 };
    this.kinds.push(kind);
    return kind;
  }

  /** Instanz-Matrix ändern (Baum wackelt) – wird beim nächsten update() übernommen. */
  setMatrix(kind: PlantKind, idx: number, m: THREE.Matrix4) {
    m.toArray(kind.mats, idx * 16);
    // direkt in den Ausgabepuffer, falls sichtbar (sonst beim nächsten Neuaufbau)
    for (let s = 0; s < kind.count; s++) {
      if (kind.slots[s] !== idx) continue;
      const attr = kind.meshes[0].instanceMatrix;
      m.toArray(attr.array as Float32Array, s * 16);
      attr.needsUpdate = true;
      break;
    }
  }

  matrix(kind: PlantKind, idx: number, out: THREE.Matrix4) { return out.fromArray(kind.mats, idx * 16); }

  /**
   * Sichtbare Instanzen bestimmen. shadowDir = Richtung, in die Schatten fallen (horizontal, Länge
   * je Meter Objekthöhe); null = keine Schatten. fogFar = Sichttiefe, ab der alles im Dunst liegt.
   */
  update(camera: THREE.PerspectiveCamera, focus: THREE.Vector3, shadowDir: THREE.Vector3 | null, fogFar: number) {
    const V = this.cull;
    if (!V.prepare(camera, shadowDir, fogFar) && !this.dirty) return;
    this.dirty = false;
    const cover2 = COVER_DISTANCE * COVER_DISTANCE;
    let visible = 0;
    for (const k of this.kinds) {
      const out = k.meshes[0].instanceMatrix.array as Float32Array;
      let w = 0;
      for (let cz = V.cz0; cz <= V.cz1; cz++) {
        for (let cx = V.cx0; cx <= V.cx1; cx++) {
          const list = k.cells.get(cz * CELLS + cx);
          if (!list) continue;
          for (const i of list) {
            const o = i * 4;
            const px = k.sphere[o], pz = k.sphere[o + 2];
            if (k.cover && (px - focus.x) ** 2 + (pz - focus.z) ** 2 > cover2) continue;
            if (!V.test(px, k.sphere[o + 1], pz, k.sphere[o + 3], k.height[i], k.variant.shadow)) continue;
            out.set(k.mats.subarray(i * 16, i * 16 + 16), w * 16);
            k.slots[w] = i;
            w++;
          }
        }
      }
      if (w !== k.count || w > 0) {
        const attr = k.meshes[0].instanceMatrix;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, Math.max(1, w) * 16);
        attr.needsUpdate = true;
      }
      k.count = w;
      for (const m of k.meshes) { m.count = w; if (!m.userData.outline) m.visible = w > 0; }
      visible += w;
    }
    this.visible = visible;
  }

  /** Shader-Aufwärmen: jede Variante kurz mit einer Instanz zeigen (nächstes update() baut neu auf). */
  warmup() {
    for (const k of this.kinds) {
      (k.meshes[0].instanceMatrix.array as Float32Array).set(k.mats.subarray(0, 16), 0);
      k.meshes[0].instanceMatrix.needsUpdate = true;
      for (const m of k.meshes) { m.count = 1; if (!m.userData.outline) m.visible = true; }
    }
    this.dirty = true;
  }

  /** Nach Änderungen (z. B. Wackeln) beim nächsten update() neu aufbauen. */
  invalidate() { this.dirty = true; }
}
