// Hilfsfunktionen zum Zusammenbauen von Low-Poly-Modellen aus einfachen Formen.
// Alle Teile bekommen Vertex-Farben und werden zu EINER Geometrie verschmolzen
// (= ein Draw-Call pro Modell).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Färbt eine Geometrie ein und vereinheitlicht die Attribute (nicht-indiziert, ohne UV). */
export function colored(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = geo.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Box mit Größe (w, h, d) an Position (x, y, z) – y ist die UNTERKANTE. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotY = 0, rotX = 0, rotZ = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return colored(g, color);
}

export function cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, color: number) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y + h / 2, z);
  return colored(g, color);
}

export function ico(r: number, x: number, y: number, z: number, color: number, sy = 1) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.scale(1, sy, 1);
  g.translate(x, y, z);
  return colored(g, color);
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}
