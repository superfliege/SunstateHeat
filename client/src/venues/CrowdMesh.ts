// Menge im Innenraum per Instancing + Animationstextur (Vertex-Animation, „VAT“):
//  - eine Low-Poly-Figur aus 11 Teilen (Becken, Oberkörper, Kopf, Ober-/Unterarme, Ober-/Unterbeine),
//    jedes Vertex kennt seinen Knochen (Attribut `bone`) und den Drehpunkt,
//  - alle Animationen (Tänze, Gehen, Jubeln, Sitzen, Croupier …) werden beim Start einmal in eine
//    Float-Textur gebacken: Zeile = Animation x Knochen, Spalte = Frame, Wert = Drehung (Euler) + Hüft-Hub,
//  - der Vertex-Shader liest pro Instanz Animation + Phase (Tänze im Takt der Club-Musik) und setzt die
//    Knochenkette zusammen. Ein Draw-Call für die ganze Menge, keine Skelette auf der CPU.
import * as THREE from 'three';
import { Act } from '../../../shared/src/npc/scenarios';

const BONES = 11; // 0 Becken, 1 Oberkörper, 2 Kopf, 3 OA-L, 4 UA-L, 5 OA-R, 6 UA-R, 7 OB-L, 8 UB-L, 9 OB-R, 10 UB-R
const PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];
const PIVOT: [number, number, number][] = [
  [0, 0.95, 0], [0, 1.0, 0], [0, 1.55, 0], [0.24, 1.45, 0], [0.24, 1.17, 0], [-0.24, 1.45, 0], [-0.24, 1.17, 0],
  [0.1, 0.92, 0], [0.1, 0.5, 0], [-0.1, 0.92, 0], [-0.1, 0.5, 0],
];
const FRAMES = 32;

/** Animationen (Zeilenblöcke der Textur). */
export const Anim = {
  IDLE: 0, WALK: 1, DANCE: 2, ROBOT: 3, SHUFFLE: 4, DISCO: 5, SPIN: 6, CHEER: 7, SIT: 8, TALK: 9, DRINK: 10, SLOT: 11,
  DEAL: 12, PANIC: 13, FAINT: 14, PHONE: 15, SCOLD: 16, DJ: 17, LEAN: 18, POINT: 19, WATCH: 20, EAT: 21, PIANO: 22,
} as const;
const ANIMS = 23;
/** Tänze laufen im Takt (Zyklus = 2 Schläge), der Rest nach Zeit. */
const BEAT_ANIMS = new Set<number>([Anim.DANCE, Anim.ROBOT, Anim.SHUFFLE, Anim.DISCO, Anim.SPIN, Anim.CHEER, Anim.DJ]);

/** Server-Act → Animation */
export function animForAct(act: number, moving: boolean): number {
  if (moving) return act === Act.Panic ? Anim.PANIC : Anim.WALK;
  switch (act) {
    case Act.Dance: return Anim.DANCE; case Act.Dance2: return Anim.ROBOT; case Act.Dance3: return Anim.SHUFFLE;
    case Act.Dance4: return Anim.DISCO; case Act.Dance5: return Anim.SPIN; case Act.Cheer: return Anim.CHEER;
    case Act.Sit: case Act.Drink: return act === Act.Drink ? Anim.DRINK : Anim.SIT;
    case Act.Talk: return Anim.TALK; case Act.Slot: return Anim.SLOT; case Act.Deal: return Anim.DEAL;
    case Act.Panic: return Anim.PANIC; case Act.Faint: case Act.Lie: return Anim.FAINT;
    case Act.Phone: case Act.Photo: case Act.Film: case Act.Call: return Anim.PHONE;
    case Act.Scold: return Anim.SCOLD; case Act.DJ: return Anim.DJ; case Act.Lean: case Act.Wait: return Anim.LEAN;
    case Act.Point: return Anim.POINT; case Act.Watch: case Act.Look: case Act.Read: return Anim.WATCH; case Act.Eat: return Anim.EAT;
    case Act.Busk: return Anim.PIANO; case Act.Atm: return Anim.DEAL;
    default: return Anim.IDLE;
  }
}

type Pose = [number, number, number][]; // je Knochen Euler (x, y, z) – x nickt nach vorn, z seitlich

/** Pose für Animation a zur Phase t (0..1). Hüft-Hub separat. */
function pose(a: number, t: number): { r: Pose; lift: number } {
  const r: Pose = Array.from({ length: BONES }, () => [0, 0, 0]);
  const s = Math.sin, c = Math.cos, P = Math.PI * 2;
  const w = t * P; // eine Periode
  let lift = 0;
  const arms = (lx: number, lz: number, lfx: number, rx: number, rz: number, rfx: number) => { r[3] = [lx, 0, lz]; r[4] = [lfx, 0, 0]; r[5] = [rx, 0, rz]; r[6] = [rfx, 0, 0]; };
  const legs = (l: number, lk: number, rr: number, rk: number) => { r[7] = [l, 0, 0]; r[8] = [lk, 0, 0]; r[9] = [rr, 0, 0]; r[10] = [rk, 0, 0]; };
  switch (a) {
    case Anim.IDLE: arms(0.05 * s(w), 0, -0.15, 0.05 * s(w + 1), 0, -0.15); r[1] = [0.03 * s(w), 0, 0]; break;
    case Anim.WALK: { const k = s(w * 2); legs(0.55 * k, Math.max(0, -k) * 0.8, -0.55 * k, Math.max(0, k) * 0.8); arms(-0.45 * k, 0.05, -0.3, 0.45 * k, -0.05, -0.3); lift = Math.abs(c(w * 2)) * 0.04; break; }
    case Anim.PANIC: { const k = s(w * 3); legs(0.8 * k, Math.max(0, -k), -0.8 * k, Math.max(0, k)); arms(-2.6 + 0.4 * k, 0.4, -0.2, -2.6 - 0.4 * k, -0.4, -0.2); lift = Math.abs(c(w * 3)) * 0.08; break; }
    case Anim.DANCE: { const b = s(w * 2); lift = Math.max(0, b) * 0.1; r[0] = [0, 0.4 * s(w), 0.12 * s(w)]; r[1] = [0.05, -0.3 * s(w), 0]; arms(-0.4, 1.6 + 0.7 * Math.max(0, s(w)), -1.2, -0.4, -1.6 - 0.7 * Math.max(0, -s(w)), -1.2); legs(0.15 * b, 0.3 * Math.max(0, b), -0.15 * b, 0.3 * Math.max(0, -b)); r[2] = [0.15 * s(w * 4), 0.2 * s(w), 0]; break; }
    case Anim.ROBOT: { const st = Math.floor(t * 8) % 4; const yy = [0.5, 0, -0.5, 0][st]; arms(-1.5, 0.1, st % 2 ? -1.57 : 0, -1.5, -0.1, st % 2 ? 0 : -1.57); r[1] = [0, yy * 0.5, 0]; r[2] = [0, yy, 0]; legs(0, 0, 0, 0); lift = st % 2 ? 0.03 : 0; break; }
    case Anim.SHUFFLE: { const k = s(w * 2); r[1] = [0.12 + 0.08 * s(w * 4), 0, 0]; r[0] = [0, 0.3 * k, 0]; arms(-0.6 + 0.6 * k, 0.4, -1.2, -0.6 - 0.6 * k, -0.4, -1.2); legs(0.5 * k, 0.4, -0.5 * k, 0.4); lift = Math.abs(s(w * 4)) * 0.07; break; }
    case Anim.DISCO: { const up = s(w) > 0; arms(-0.2, -0.5, -1.6, up ? -2.8 : -0.3, up ? -0.6 : -0.9, 0); r[0] = [0, 0, 0.2 * s(w * 2)]; r[2] = [up ? -0.25 : 0.2, 0.3, 0]; legs(0, 0.2, 0.1 * s(w * 2), 0.3); lift = Math.max(0, s(w * 2)) * 0.06; break; }
    case Anim.SPIN: r[0] = [0, w, 0]; arms(-0.1, 1.4, 0, -0.1, -1.4, 0); r[2] = [-0.2, 0, 0]; legs(0.2, 0.2, -0.1, 0.1); lift = Math.abs(s(w * 2)) * 0.05; break;
    case Anim.CHEER: { const j = Math.abs(s(w * 2)); arms(-0.2, 2.6 + 0.3 * j, 0.3, -0.2, -2.6 - 0.3 * j, 0.3); lift = j * 0.14; legs(0.1, 0.3 * j, -0.1, 0.3 * j); break; }
    case Anim.SIT: lift = -0.45; legs(-1.5, 1.5, -1.5, 1.5); arms(-0.4, 0.1, -0.8, -0.4, -0.1, -0.8); r[2] = [0, 0.4 * s(w), 0]; break;
    case Anim.DRINK: { lift = -0.45; legs(-1.5, 1.5, -1.5, 1.5); const sip = Math.max(0, s(w)) ** 2; arms(-0.3, 0.1, -0.6, -0.5 - 0.3 * sip, -0.2, -1.2 - 0.9 * sip); r[2] = [-0.15 * sip, 0, 0]; break; }
    case Anim.TALK: arms(-0.4 - 0.3 * Math.max(0, s(w * 2)), 0.3, -1.2, -0.4 - 0.3 * Math.max(0, s(w * 2 + 2)), -0.3, -1.2); r[2] = [0.05 * s(w * 3), 0.4 * s(w), 0]; break;
    case Anim.SLOT: { const pull = Math.max(0, s(w)) ** 4; arms(-0.4, 0.1, -1, -1.2 - 0.9 * pull, -0.3, -0.6 + 0.4 * pull); r[1] = [0.08, 0, 0]; break; }
    case Anim.DEAL: { const d = Math.max(0, s(w * 2)); arms(-0.6, 0.2, -1.2, -0.9 - 0.4 * d, -0.3 * d, -0.8 + 0.5 * d); r[2] = [0.35, 0.2 * s(w), 0]; r[1] = [0.12, 0, 0]; break; }
    case Anim.FAINT: r[0] = [-1.5, 0, 0]; lift = -0.72; arms(0, 1.3, 0, 0, -1.3, 0); r[2] = [0, 0.4, 0]; break;
    case Anim.PHONE: arms(-0.3, 0.1, -0.4, -0.35, -0.55, -2.3); r[2] = [0.1, 0.2 * s(w), 0.15]; break;
    case Anim.SCOLD: { const f = s(w * 4); arms(0.3, 0.9, -1.6, -2.2 + 0.4 * f, -0.2, -0.6); r[1] = [0.2, 0, 0]; r[2] = [0.1 * f, 0, 0]; break; }
    case Anim.DJ: { const b = s(w * 2); arms(-0.4, 1.2, -2.3, -0.9, -0.2, -0.8 + 0.2 * b); r[2] = [0.2 + 0.15 * b, 0, 0]; r[1] = [0.15, 0, 0]; lift = Math.max(0, b) * 0.04; break; }
    case Anim.LEAN: r[0] = [0, 0, 0.08]; arms(0.1, 0.2, -0.3, -0.2, -0.1, -0.9); r[2] = [0, 0.5 * s(w), 0]; legs(0, 0, 0.15, 0.1); break;
    case Anim.POINT: arms(-0.2, 0.1, -0.3, -1.6, -0.1, 0); r[2] = [0, -0.1, 0]; r[1] = [0.05, 0.2, 0]; break;
    case Anim.WATCH: { const clap = s(w) > 0.7 ? s(w * 14) : 0; arms(-0.7, 0.2, -1.5 - 0.2 * clap, -0.7, -0.2, -1.5 - 0.2 * clap); r[2] = [0.05, 0.25 * s(w), 0]; break; }
    case Anim.EAT: { const bite = Math.max(0, s(w * 2)) ** 2; arms(-0.5, 0.1, -1.2, -0.6 - 0.3 * bite, -0.2, -1.4 - 0.7 * bite); r[2] = [0.1 - 0.1 * bite, 0, 0]; break; }
    case Anim.PIANO: lift = -0.45; legs(-1.5, 1.5, -1.5, 1.5); arms(-1.0 + 0.1 * s(w * 6), 0.15, -0.6, -1.0 + 0.1 * s(w * 6 + 2), -0.15, -0.6); r[1] = [0.15, 0.1 * s(w), 0]; r[2] = [0.2, 0.2 * s(w), 0]; break;
  }
  return { r, lift };
}

let animTex: THREE.DataTexture | null = null;
function bakeAnimations(): THREE.DataTexture {
  if (animTex) return animTex;
  const data = new Float32Array(FRAMES * ANIMS * BONES * 4);
  for (let a = 0; a < ANIMS; a++) for (let f = 0; f < FRAMES; f++) {
    const { r, lift } = pose(a, f / FRAMES);
    for (let b = 0; b < BONES; b++) {
      const i = ((a * BONES + b) * FRAMES + f) * 4;
      data[i] = r[b][0]; data[i + 1] = r[b][1]; data[i + 2] = r[b][2]; data[i + 3] = b === 0 ? lift : 0;
    }
  }
  const t = new THREE.DataTexture(data, FRAMES, ANIMS * BONES, THREE.RGBAFormat, THREE.FloatType);
  t.needsUpdate = true;
  animTex = t;
  return t;
}

/** Figur-Geometrie: Quader je Knochen, Attribute bone (Index) und part (0 Haut, 1 Oberteil, 2 Hose, 3 Haar, 4 Schuhe, 5 Akzent). */
function figureGeometry(): THREE.BufferGeometry {
  const parts: { bone: number; part: number; c: [number, number, number]; s: [number, number, number] }[] = [
    { bone: 0, part: 2, c: [0, 0.92, 0], s: [0.36, 0.2, 0.22] },
    { bone: 1, part: 1, c: [0, 1.26, 0], s: [0.44, 0.52, 0.25] },
    { bone: 1, part: 5, c: [0, 1.4, 0.13], s: [0.18, 0.12, 0.02] },
    { bone: 2, part: 0, c: [0, 1.7, 0], s: [0.26, 0.28, 0.26] },
    { bone: 2, part: 3, c: [0, 1.86, -0.02], s: [0.28, 0.1, 0.28] },
    { bone: 3, part: 1, c: [0.29, 1.32, 0], s: [0.12, 0.3, 0.13] },
    { bone: 4, part: 0, c: [0.29, 1.03, 0], s: [0.1, 0.3, 0.11] },
    { bone: 5, part: 1, c: [-0.29, 1.32, 0], s: [0.12, 0.3, 0.13] },
    { bone: 6, part: 0, c: [-0.29, 1.03, 0], s: [0.1, 0.3, 0.11] },
    { bone: 7, part: 2, c: [0.1, 0.71, 0], s: [0.15, 0.42, 0.16] },
    { bone: 8, part: 2, c: [0.1, 0.27, 0], s: [0.13, 0.44, 0.14] },
    { bone: 8, part: 4, c: [0.1, 0.04, 0.04], s: [0.14, 0.08, 0.24] },
    { bone: 9, part: 2, c: [-0.1, 0.71, 0], s: [0.15, 0.42, 0.16] },
    { bone: 10, part: 2, c: [-0.1, 0.27, 0], s: [0.13, 0.44, 0.14] },
    { bone: 10, part: 4, c: [-0.1, 0.04, 0.04], s: [0.14, 0.08, 0.24] },
  ];
  const pos: number[] = [], nor: number[] = [], bone: number[] = [], part: number[] = [];
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]).toNonIndexed();
    g.translate(p.c[0], p.c[1], p.c[2]);
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) { pos.push(pa.getX(i), pa.getY(i), pa.getZ(i)); nor.push(na.getX(i), na.getY(i), na.getZ(i)); bone.push(p.bone); part.push(p.part); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('bone', new THREE.Float32BufferAttribute(bone, 1));
  geo.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  return geo;
}

const VERT = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uAnim;
  uniform float uTime, uBeat;
  uniform vec3 uPivot[${BONES}];
  uniform int uParent[${BONES}];
  attribute float bone, part;
  attribute vec4 iAnim;   // Animation, Phasenversatz, Tempo, Takt (1 = Beat)
  attribute vec3 iSkin, iShirt, iPants;
  varying vec3 vColor; varying vec3 vNormal; varying float vPart;
  mat3 rotE(vec3 e) {
    float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
    mat3 X = mat3(1.,0.,0., 0.,cx,sx, 0.,-sx,cx);
    mat3 Y = mat3(cy,0.,-sy, 0.,1.,0., sy,0.,cy);
    mat3 Z = mat3(cz,sz,0., -sz,cz,0., 0.,0.,1.);
    return Y * X * Z;
  }
  vec4 sampleBone(int b, float ph) {
    float f = ph * ${FRAMES}.0;
    int f0 = int(floor(f)) % ${FRAMES}, f1 = (f0 + 1) % ${FRAMES};
    int row = int(iAnim.x) * ${BONES} + b;
    return mix(texelFetch(uAnim, ivec2(f0, row), 0), texelFetch(uAnim, ivec2(f1, row), 0), fract(f));
  }
  void main() {
    float ph = iAnim.w > 0.5 ? fract(uBeat * 0.5 * iAnim.z + iAnim.y) : fract(uTime * iAnim.z + iAnim.y);
    vec3 p = position, n = normal;
    int b = int(bone + 0.5);
    // Kette vom Knochen bis zum Becken
    for (int k = 0; k < 4; k++) {
      if (b < 0) break;
      vec4 r = sampleBone(b, ph);
      mat3 R = rotE(r.xyz);
      p = R * (p - uPivot[b]) + uPivot[b];
      n = R * n;
      if (b == 0) p.y += r.w;
      b = uParent[b];
    }
    vec3 col = part < 0.5 ? iSkin : part < 1.5 ? iShirt : part < 2.5 ? iPants : part < 3.5 ? iSkin * 0.35 : part < 4.5 ? vec3(0.12, 0.1, 0.16) : iShirt * 0.5 + 0.5;
    vColor = col; vPart = part;
    vNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
  }
`;
const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uLight, uAmbient, uTint;
  uniform float uTintAmt;
  varying vec3 vColor; varying vec3 vNormal; varying float vPart;
  void main() {
    float d = max(0.0, dot(normalize(vNormal), normalize(uLight)));
    float band = d > 0.6 ? 1.0 : d > 0.25 ? 0.7 : 0.45; // Cel-Stufen
    vec3 c = vColor * (uAmbient + band * 0.75);
    c += uTint * uTintAmt * (0.4 + 0.6 * d);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

const SKINS = [0xf2c9a0, 0xd9a273, 0xa86b45, 0x7a4a2c, 0xffdcb8, 0x5a3420].map((c) => new THREE.Color(c));

export interface CrowdLook { shirt: number; pants: number; skin: number }

/** Instanzierte Menge mit bis zu `max` Figuren. */
export class CrowdMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly uniforms;
  private iAnim: THREE.InstancedBufferAttribute;
  private iSkin: THREE.InstancedBufferAttribute;
  private iShirt: THREE.InstancedBufferAttribute;
  private iPants: THREE.InstancedBufferAttribute;
  private count = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);

  constructor(readonly max: number) {
    const geo = figureGeometry();
    this.iAnim = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.iSkin = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.iShirt = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.iPants = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.iAnim, this.iSkin, this.iShirt, this.iPants]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iAnim', this.iAnim); geo.setAttribute('iSkin', this.iSkin); geo.setAttribute('iShirt', this.iShirt); geo.setAttribute('iPants', this.iPants);
    this.uniforms = {
      uAnim: { value: bakeAnimations() }, uTime: { value: 0 }, uBeat: { value: 0 },
      uPivot: { value: PIVOT.map((p) => new THREE.Vector3(...p)) }, uParent: { value: PARENT },
      uLight: { value: new THREE.Vector3(0.3, 1, 0.5) }, uAmbient: { value: new THREE.Color(0.38, 0.32, 0.42) },
      uTint: { value: new THREE.Color(1, 0.2, 0.7) }, uTintAmt: { value: 0.25 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // Innenraum ist klein, Bounding-Sphere der Instanzen wäre ohnehin der ganze Raum
    this.mesh.count = 0;
    this.mesh.name = 'venueCrowd';
  }

  begin() { this.count = 0; }

  /** Eine Figur setzen (Weltkoordinaten innerhalb der Gruppe). */
  add(x: number, y: number, z: number, a: number, anim: number, seed: number, look: CrowdLook, scale = 1) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.q.setFromAxisAngle(this.up, a);
    this.sc.setScalar(scale);
    this.m.compose(this.v.set(x, y, z), this.q, this.sc);
    this.mesh.setMatrixAt(i, this.m);
    const beat = BEAT_ANIMS.has(anim) ? 1 : 0;
    const speed = beat ? (seed % 3 === 0 ? 0.5 : 1) : 0.35 + (seed % 7) * 0.04;
    this.iAnim.setXYZW(i, anim, (seed % 97) / 97 * (beat ? 0.15 : 1), speed, beat);
    const sk = SKINS[look.skin % SKINS.length];
    this.iSkin.setXYZ(i, sk.r, sk.g, sk.b);
    tmpC.setHex(look.shirt); this.iShirt.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
    tmpC.setHex(look.pants); this.iPants.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
  }

  end(time: number, beat: number) {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [this.iAnim, this.iSkin, this.iShirt, this.iPants]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.count * a.itemSize); }
    this.uniforms.uTime.value = time;
    this.uniforms.uBeat.value = beat;
  }

  dispose() { this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
const tmpC = new THREE.Color();
