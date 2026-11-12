// Platzhalter-Modelle der Luftfahrzeuge aus einfachen Formen (Vertex-Farben, ein Draw-Call für den
// Rumpf, Rotoren/Propeller als eigene drehende Teile). Ursprung = Unterkante (Räder/Kufen), +z = vorne.
// Echte Modelle (glTF) können später je Typ hier eingehängt werden – Liste der Assets in README.
import * as THREE from 'three';
import { aircraftAccent, aircraftColor, type AircraftDef } from '../../../shared/src/sim/aircraft';
import { box, colored, cyl, ico, merge } from './geom';

const GLASS = 0x2a3f5c, DARK = 0x2b2b30, METAL = 0x9aa3ab, TIRE = 0x1c1c1f;

/** Zylinder entlang z (Rumpf, Triebwerke). */
function tube(r0: number, r1: number, len: number, x: number, y: number, z: number, color: number, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return colored(g, color);
}

export interface AircraftParts {
  root: THREE.Group;
  body: THREE.Mesh;
  /** Hauptrotor (dreht um y) bzw. Propeller (dreht um z) */
  rotor: THREE.Object3D | null;
  rotorAxis: 'y' | 'z';
  tail: THREE.Object3D | null;
  /** Rotor-/Propellerscheibe (Bewegungsunschärfe, Deckkraft = Drehzahl) */
  blur: THREE.Mesh | null;
  /** weitere Propeller (Deko-Zubringer) */
  extra: THREE.Object3D[];
  /** Positionslichter/Blitzer (nachts) */
  lights: THREE.Mesh;
  /** Triebwerksaustritte (lokal) für Hitzeflimmern/Rauch */
  exhaust: THREE.Vector3[];
}

const blurMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

function rotorBlades(len: number, chord: number, n: number, color: number, axis: 'y' | 'x' | 'z'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(len, 0.07, chord);
    g.rotateY((i / n) * Math.PI);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    parts.push(colored(g, color));
  }
  return merge(parts);
}

function lightsGeo(points: [number, number, number, number][]): THREE.BufferGeometry {
  return merge(points.map(([x, y, z, c]) => box(0.22, 0.22, 0.22, x, y, z, c)));
}

/** Baut das Modell für ein Luftfahrzeug (Typ aus aircraft.json, optional Lackierung überschreiben). */
export function buildAircraft(def: AircraftDef, mat: THREE.Material, rotorMat: THREE.Material): AircraftParts {
  const c = aircraftColor(def), acc = aircraftAccent(def);
  const parts: THREE.BufferGeometry[] = [];
  const root = new THREE.Group();
  let rotor: THREE.Object3D | null = null, tail: THREE.Object3D | null = null, blur: THREE.Mesh | null = null;
  let axis: 'y' | 'z' = 'y';
  const extra: THREE.Object3D[] = [];
  const exhaust: THREE.Vector3[] = [];
  let lights: [number, number, number, number][] = [];

  if (def.id === 'sunbird') {
    // Hochdecker, einmotorig: weißer Rumpf, türkise Streifen
    parts.push(box(1.25, 1.3, 5.4, 0, 0.55, 0.6, c));
    parts.push(box(0.8, 0.9, 2.4, 0, 0.8, -3.2, c));
    parts.push(box(0.5, 0.6, 1.2, 0, 0.95, -4.6, c));
    parts.push(box(1.27, 0.22, 5.4, 0, 1.0, 0.6, acc)); // Seitenstreifen
    parts.push(box(1.1, 1.05, 1.0, 0, 0.62, 3.75, c)); // Motorhaube
    parts.push(tube(0.3, 0.1, 0.45, 0, 1.14, 4.3, acc, 8)); // Spinner
    parts.push(box(1.28, 0.5, 1.7, 0, 1.3, 1.6, GLASS)); // Fenster
    parts.push(box(10.5, 0.16, 1.6, 0, 1.92, 1.0, c)); // Flügel
    for (const s of [-1, 1]) parts.push(box(1.2, 0.17, 1.62, s * 4.7, 1.92, 1.0, acc)); // Flügelspitzen
    for (const s of [-1, 1]) parts.push(box(0.1, 1.2, 0.18, s * 1.6, 0.8, 1.2, METAL, 0, 0, s * 0.5)); // Streben
    parts.push(box(3.6, 0.12, 1.0, 0, 1.15, -4.7, c));
    parts.push(box(0.12, 1.4, 1.2, 0, 1.2, -4.8, acc));
    // Fahrwerk
    for (const s of [-1, 1]) { parts.push(box(0.12, 0.6, 0.12, s * 1.0, 0.1, 0.4, METAL, 0, 0, s * 0.4)); parts.push(box(0.22, 0.48, 0.48, s * 1.25, 0, 0.4, TIRE)); }
    parts.push(box(0.1, 0.55, 0.1, 0, 0.1, 3.6, METAL)); parts.push(box(0.2, 0.4, 0.4, 0, 0, 3.6, TIRE));
    const prop = new THREE.Mesh(rotorBlades(2.0, 0.16, 2, DARK, 'z'), rotorMat);
    prop.position.set(0, 1.14, 4.45);
    rotor = prop; axis = 'z';
    blur = new THREE.Mesh(new THREE.CircleGeometry(1.0, 16), blurMat.clone());
    blur.position.set(0, 1.14, 4.5);
    lights = [[-5.25, 1.95, 1.0, 0xff2020], [5.25, 1.95, 1.0, 0x20ff40], [0, 2.6, -5.3, 0xffffff]];
  } else if (def.id === 'marlin') {
    // Zweistrahliger Privatjet: weiß-gold, gepfeilte Tiefdecker-Flügel, T-Leitwerk
    parts.push(tube(0.95, 0.95, 9, 0, 1.75, 0.6, c, 12));
    parts.push(tube(0.95, 0.35, 3.2, 0, 1.65, 6.6, c, 12)); // Nase
    parts.push(tube(0.4, 0.95, 3.6, 0, 1.9, -5.7, c, 12)); // Heck
    parts.push(box(1.92, 0.18, 12, 0, 1.55, 0, acc)); // Goldstreifen
    parts.push(box(1.5, 0.45, 1.4, 0, 2.2, 5.4, GLASS)); // Cockpit
    for (let k = -3; k <= 3; k++) for (const s of [-1, 1]) parts.push(box(0.05, 0.28, 0.45, s * 0.94, 1.95, k * 1.1 + 0.6, GLASS)); // Fenster
    for (const s of [-1, 1]) {
      parts.push(box(6.6, 0.22, 2.6, s * 3.6, 1.0, 0.2, c, s * 0.38));
      parts.push(box(0.5, 0.8, 0.9, s * 6.7, 1.0, -1.2, acc)); // Winglets
      parts.push(tube(0.55, 0.5, 3.0, s * 1.55, 2.35, -4.2, METAL, 10)); // Triebwerke am Heck
      parts.push(tube(0.56, 0.56, 0.3, s * 1.55, 2.35, -2.8, acc, 10));
      parts.push(box(0.6, 0.15, 1.2, s * 1.1, 2.3, -4.2, c));
      exhaust.push(new THREE.Vector3(s * 1.55, 2.35, -5.8));
    }
    parts.push(box(0.3, 2.8, 2.2, 0, 2.3, -6.6, c, 0, -0.25));
    parts.push(box(4.6, 0.16, 1.3, 0, 4.9, -7.4, c));
    parts.push(box(0.32, 0.5, 1.3, 0, 4.6, -7.3, acc));
    for (const s of [-1, 1]) { parts.push(box(0.14, 0.9, 0.14, s * 1.4, 0.3, 0, METAL)); parts.push(box(0.28, 0.6, 0.6, s * 1.4, 0, 0, TIRE)); }
    parts.push(box(0.12, 0.9, 0.12, 0, 0.3, 5.4, METAL)); parts.push(box(0.24, 0.5, 0.5, 0, 0, 5.4, TIRE));
    lights = [[-7, 1.1, -0.9, 0xff2020], [7, 1.1, -0.9, 0x20ff40], [0, 5.1, -7.9, 0xffffff], [0, 0.75, 0.6, 0xff3030]];
  } else if (def.type === 'heli' && (def.id === 'pelikan')) {
    // Transport-Helikopter: kastiger Rumpf, großer Rotor, Räder, vorbereiteter Lasthaken
    parts.push(box(2.8, 2.6, 9, 0, 0.7, 0.4, c));
    parts.push(box(2.4, 1.8, 2.2, 0, 1.0, 5.7, c));
    parts.push(box(2.42, 0.9, 1.6, 0, 1.9, 5.9, GLASS));
    parts.push(box(2.82, 0.25, 9.02, 0, 1.9, 0.4, acc));
    parts.push(box(1.0, 1.0, 7, 0, 2.0, -7.2, c));
    parts.push(box(0.2, 2.6, 1.8, 0, 2.6, -10.4, c));
    parts.push(box(3.4, 0.16, 1.2, 0, 2.4, -9.6, c));
    parts.push(box(1.6, 0.9, 3.2, 0, 3.3, 0.6, DARK)); // Triebwerksgehäuse
    parts.push(cyl(0.3, 0.3, 0.9, 8, 0, 4.0, 0.6, METAL));
    for (const s of [-1, 1]) for (const z of [-2.5, 3.6]) parts.push(box(0.35, 0.75, 0.75, s * 1.5, 0, z, TIRE));
    parts.push(box(0.15, 0.6, 0.15, 0, 0.1, 0.4, METAL)); // Lasthaken (Hook, noch ohne Funktion)
    parts.push(box(0.4, 0.15, 0.25, 0, 0.05, 0.4, 0xffc020));
    for (const s of [-1, 1]) parts.push(box(0.05, 0.6, 2.6, s * 1.42, 1.25, -0.6, GLASS));
    const r = new THREE.Mesh(rotorBlades(def.span, 0.55, 2, DARK, 'y'), rotorMat);
    r.position.set(0, 4.55, 0.6);
    rotor = r;
    const t = new THREE.Mesh(rotorBlades(2.6, 0.25, 2, DARK, 'x'), rotorMat);
    t.position.set(0.25, 3.0, -10.6);
    tail = t;
    blur = new THREE.Mesh(new THREE.CircleGeometry(def.span / 2, 24).rotateX(-Math.PI / 2), blurMat.clone());
    blur.position.set(0, 4.6, 0.6);
    lights = [[-1.5, 2.0, 0.4, 0xff2020], [1.5, 2.0, 0.4, 0x20ff40], [0, 4.1, -10.6, 0xffffff], [0, 0.6, 2, 0xff3030]];
  } else if (def.type === 'heli') {
    // Leichter Helikopter (Kolibri, Polizei): Kanzel, Heckausleger, Kufen
    parts.push(ico(1.35, 0, 1.45, 0.6, c, 0.85));
    parts.push(box(1.7, 1.2, 2.2, 0, 0.75, 0.1, c));
    parts.push(box(1.72, 0.75, 1.3, 0, 1.25, 1.4, GLASS));
    parts.push(box(0.4, 0.4, 4.6, 0, 1.55, -3.2, c));
    parts.push(box(0.42, 0.12, 4.6, 0, 1.6, -3.2, acc));
    parts.push(box(0.12, 1.3, 0.9, 0, 1.6, -5.4, acc));
    parts.push(box(1.6, 0.1, 0.6, 0, 1.6, -4.9, c));
    parts.push(box(0.9, 0.6, 1.4, 0, 2.05, -0.1, DARK));
    parts.push(cyl(0.12, 0.12, 0.5, 6, 0, 2.6, 0.2, METAL));
    for (const s of [-1, 1]) {
      parts.push(box(0.14, 0.14, 3.2, s * 1.0, 0, 0.3, METAL));
      for (const z of [-0.6, 1.1]) parts.push(box(0.1, 0.75, 0.1, s * 0.9, 0.05, z, METAL, 0, 0, s * 0.25));
    }
    if (def.police) {
      parts.push(box(1.74, 0.25, 2.24, 0, 1.0, 0.1, 0xf2f2f2));
      parts.push(box(0.5, 0.35, 0.5, 0, 0.35, 1.6, 0xd8d8d8)); // Suchscheinwerfer
    }
    const r = new THREE.Mesh(rotorBlades(def.span, 0.32, 2, DARK, 'y'), rotorMat);
    r.position.set(0, 2.85, 0.2);
    rotor = r;
    const t = new THREE.Mesh(rotorBlades(1.4, 0.16, 2, DARK, 'x'), rotorMat);
    t.position.set(0.25, 1.75, -5.4);
    tail = t;
    blur = new THREE.Mesh(new THREE.CircleGeometry(def.span / 2, 20).rotateX(-Math.PI / 2), blurMat.clone());
    blur.position.set(0, 2.9, 0.2);
    lights = [[-0.85, 1.0, 0.4, 0xff2020], [0.85, 1.0, 0.4, 0x20ff40], [0, 2.3, -5.6, 0xffffff]];
    if (def.police) lights.push([0, 0.4, 1.9, 0xfff6d0], [-0.3, 2.4, -0.4, 0x2a6bff], [0.3, 2.4, -0.4, 0xff2030]);
  }

  const body = new THREE.Mesh(merge(parts), mat);
  body.castShadow = true;
  root.add(body);
  if (rotor) root.add(rotor);
  if (tail) root.add(tail);
  if (blur) { blur.renderOrder = 3; root.add(blur); }
  const lm = new THREE.Mesh(lightsGeo(lights.length ? lights : [[0, 0, 0, 0]]), lightMat);
  root.add(lm);
  return { root, body, rotor, rotorAxis: axis, tail, blur, extra, lights: lm, exhaust };
}

/** Deko-Zubringer (zweimotoriger Hochdecker, nicht fliegbar). */
export function buildDecoPlane(mat: THREE.Material, rotorMat: THREE.Material): AircraftParts {
  const c = 0xf4f6f8, acc = 0x1fa7b8;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(tube(1.15, 1.15, 12, 0, 1.6, 0, c, 12));
  parts.push(tube(1.15, 0.45, 2.6, 0, 1.5, 7.3, c, 12));
  parts.push(tube(0.4, 1.15, 4, 0, 1.9, -8, c, 12));
  parts.push(box(2.32, 0.3, 12, 0, 1.4, 0, acc));
  parts.push(box(1.7, 0.5, 1.2, 0, 2.2, 7.0, GLASS));
  parts.push(box(19, 0.25, 2.2, 0, 2.85, 0.8, c));
  parts.push(box(0.3, 3, 2.6, 0, 2.4, -9.2, acc, 0, -0.2));
  parts.push(box(6.4, 0.18, 1.6, 0, 4.9, -9.6, c));
  const props: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    parts.push(tube(0.55, 0.45, 3.4, s * 3.6, 2.55, 1.6, c, 10));
    parts.push(box(0.16, 1.6, 0.16, s * 1.3, 0.1, -0.3, METAL)); parts.push(box(0.3, 0.7, 0.7, s * 1.3, 0, -0.3, TIRE));
    const p = new THREE.Mesh(rotorBlades(2.6, 0.2, 3, DARK, 'z'), rotorMat);
    p.position.set(s * 3.6, 2.55, 3.4);
    props.push(p);
  }
  parts.push(box(0.14, 1.2, 0.14, 0, 0.1, 6.2, METAL)); parts.push(box(0.26, 0.6, 0.6, 0, 0, 6.2, TIRE));
  const root = new THREE.Group();
  const body = new THREE.Mesh(merge(parts), mat);
  body.castShadow = true;
  root.add(body);
  for (const p of props) root.add(p);
  const lights = new THREE.Mesh(lightsGeo([[-9.5, 2.9, 0.8, 0xff2020], [9.5, 2.9, 0.8, 0x20ff40], [0, 5, -10, 0xffffff], [0, 3.3, -2, 0xff3030]]), lightMat);
  root.add(lights);
  return { root, body, rotor: props[0], rotorAxis: 'z', tail: null, blur: null, extra: props.slice(1), lights, exhaust: [] };
}

/** Rotoren/Propeller drehen, Unschärfescheibe einblenden, Blitzlichter. rotor = Drehzahl 0..1 */
export function animateAircraft(p: AircraftParts, rotor: number, dt: number, clock: number, night: number) {
  const w = rotor * 38 * dt;
  if (p.rotor) { if (p.rotorAxis === 'y') p.rotor.rotation.y += w; else p.rotor.rotation.z += w * 1.6; }
  for (const e of p.extra) e.rotation.z += w * 1.6;
  if (p.tail) p.tail.rotation.x += w * 2.5;
  if (p.blur) { (p.blur.material as THREE.MeshBasicMaterial).opacity = Math.max(0, rotor - 0.35) * 0.35; p.blur.visible = rotor > 0.35; }
  // Positionslichter: nachts dauernd, tagsüber blitzend
  p.lights.visible = night > 0.3 || (rotor > 0.2 && (clock * 1.2) % 1 < 0.12);
}
