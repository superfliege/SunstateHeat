// Fahr-Effekte ("Juice"): Reifenqualm, Staub, Wasserspritzer, Funken, Auspuffflammen,
// Motorrauch und Feuer, Explosionen, Hydranten-Fontänen, Blutspritzer – als Partikel in zwei
// Draw-Calls (Rauch/Blut mit Alpha, Leuchtendes additiv) – sowie Bremsspuren und Blutlachen als
// gepoolte Decals (je ein Draw-Call, verblassen von selbst) und abgefallene Fahrzeugteile als
// Trümmer (30 s, gepoolt). Nichts davon erzeugt im laufenden Spiel neue Objekte oder Materialien.
import * as THREE from 'three';
import { groundHeight } from '../../../shared/src/sim/car';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { U, addOutline, LINE } from './materials/toon';

const MAX_SMOKE = 1600, MAX_GLOW = 900;
const SKID_MAX = 900, SKID_LIFE = 30;
const DEBRIS_MAX = 24, DEBRIS_LIFE = 30;
const BLOOD_MAX = 320, BLOOD_LIFE = 75;
const FLASH_MAX = 8;

interface Pool {
  points: THREE.Points;
  pos: Float32Array; col: Float32Array; size: Float32Array; alpha: Float32Array;
  vel: Float32Array; life: Float32Array; max: Float32Array; s0: Float32Array; s1: Float32Array;
  c0: Float32Array; c1: Float32Array; a0: Float32Array; drag: Float32Array; grav: Float32Array;
  next: number; n: number;
}

function makePool(n: number, additive: boolean): Pool {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3).fill(-9999), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uNight: U.uNight },
    vertexShader: /* glsl */`
      attribute float size; attribute float alpha; attribute vec3 color;
      varying vec3 vCol; varying float vA;
      uniform float uScale;
      void main() {
        vCol = color; vA = alpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / max(1.0, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol; varying float vA;
      uniform float uNight;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        if (d > 1.0 || vA <= 0.01) discard;
        // gestufter Rand (Pixel-Look) statt weichem Verlauf
        float a = vA * (d < 0.6 ? 1.0 : d < 0.85 ? 0.7 : 0.4);
        ${additive ? 'gl_FragColor = vec4(vCol * a, 1.0);' : 'gl_FragColor = vec4(vCol * (1.0 - uNight * 0.55), a);'}
      }`,
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 6 : 5;
  const f = () => new Float32Array(n);
  return { points, pos, col, size, alpha, vel: new Float32Array(n * 3), life: f(), max: f(), s0: f(), s1: f(), c0: new Float32Array(n * 3), c1: new Float32Array(n * 3), a0: f(), drag: f(), grav: f(), next: 0, n };
}

export interface EmitOpts {
  vx?: number; vy?: number; vz?: number;
  life?: number; size?: number; size1?: number;
  color?: number; color1?: number; alpha?: number;
  drag?: number; gravity?: number; spread?: number;
}

const tmpC = new THREE.Color(), tmpC1 = new THREE.Color();
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0), tmpE = new THREE.Euler();

interface Debris { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; rest: boolean }

export class VehicleFx {
  readonly group = new THREE.Group();
  private smoke = makePool(MAX_SMOKE, false);
  private glow = makePool(MAX_GLOW, true);
  // Bremsspuren
  private skid: THREE.InstancedMesh;
  private skidBirth: THREE.InstancedBufferAttribute;
  private skidShade: THREE.InstancedBufferAttribute;
  private skidNext = 0;
  private skidLast = new Map<number, { x: number; y: number; z: number; t: number }>();
  private time = 0;
  private debris: Debris[] = [];
  // Leuchtkugeln (Explosion): fester Pool statt neuer Meshes/Materialien je Explosion
  private flashes: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; life: number; size: number }[] = [];
  private flashNext = 0;
  // Blutlachen
  private blood: THREE.InstancedMesh;
  private bloodBirth: THREE.InstancedBufferAttribute;
  private bloodSeed: THREE.InstancedBufferAttribute;
  private bloodNext = 0;
  private rnd = Math.random;

  constructor(private map: WorldMap, private debrisMat: THREE.Material) {
    this.group.add(this.smoke.points, this.glow.points);
    // Bremsspuren: Einheits-Streifen (Länge 1 entlang z), Instanz-Matrix = Segment
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: SKID_LIFE } },
      vertexShader: /* glsl */`
        attribute float aBirth; attribute float aShade;
        varying float vA; varying float vShade;
        uniform float uTime; uniform float uLife;
        void main() {
          float age = uTime - aBirth;
          vA = aBirth < 0.0 ? 0.0 : clamp(1.0 - age / uLife, 0.0, 1.0);
          vShade = aShade;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vShade;
        void main() {
          if (vA <= 0.01) discard;
          vec3 c = mix(vec3(0.06, 0.05, 0.07), vec3(0.42, 0.3, 0.18), vShade);
          gl_FragColor = vec4(c, vA * 0.7);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    this.skid = new THREE.InstancedMesh(geo, mat, SKID_MAX);
    this.skidBirth = new THREE.InstancedBufferAttribute(new Float32Array(SKID_MAX).fill(-1), 1);
    this.skidShade = new THREE.InstancedBufferAttribute(new Float32Array(SKID_MAX), 1);
    this.skid.geometry.setAttribute('aBirth', this.skidBirth);
    this.skid.geometry.setAttribute('aShade', this.skidShade);
    for (let i = 0; i < SKID_MAX; i++) this.skid.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    this.skid.frustumCulled = false;
    this.skid.renderOrder = 3;
    this.group.add(this.skid);

    // Blutlachen: Einheits-Quad, Form (unregelmäßige Kleckse) im Fragment-Shader aus dem Zufallswert
    const bgeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const bmat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLife: { value: BLOOD_LIFE }, uNight: U.uNight },
      vertexShader: /* glsl */`
        attribute float aBirth; attribute float aSeed;
        varying float vA; varying vec2 vUv; varying float vSeed; varying float vGrow;
        uniform float uTime; uniform float uLife;
        void main() {
          float age = uTime - aBirth;
          vA = aBirth < 0.0 ? 0.0 : clamp((uLife - age) / 8.0, 0.0, 1.0);
          vGrow = clamp(age / 0.35, 0.25, 1.0); // läuft kurz aus
          vUv = uv - 0.5; vSeed = aSeed;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying vec2 vUv; varying float vSeed; varying float vGrow;
        uniform float uNight;
        void main() {
          if (vA <= 0.01) discard;
          float ang = atan(vUv.y, vUv.x);
          float r = length(vUv) * 2.0;
          // Klecks: Kreis mit zufälligen Ausbuchtungen und Spritz-Zacken
          float edge = 0.62 + 0.13 * sin(ang * 3.0 + vSeed * 17.0) + 0.09 * sin(ang * 7.0 + vSeed * 41.0)
                     + 0.16 * pow(max(0.0, sin(ang * 5.0 + vSeed * 23.0)), 8.0);
          edge *= vGrow;
          if (r > edge) discard;
          float inner = smoothstep(edge, edge * 0.55, r);
          vec3 c = mix(vec3(0.30, 0.015, 0.02), vec3(0.50, 0.03, 0.04), inner * (0.6 + 0.4 * fract(vSeed * 7.31)));
          c *= 1.0 - uNight * 0.5;
          // gestufter Rand (Pixel-Look wie die Partikel)
          float a = vA * (r < edge * 0.8 ? 0.92 : 0.7);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    this.blood = new THREE.InstancedMesh(bgeo, bmat, BLOOD_MAX);
    this.bloodBirth = new THREE.InstancedBufferAttribute(new Float32Array(BLOOD_MAX).fill(-1), 1);
    this.bloodSeed = new THREE.InstancedBufferAttribute(new Float32Array(BLOOD_MAX), 1);
    this.blood.geometry.setAttribute('aBirth', this.bloodBirth);
    this.blood.geometry.setAttribute('aSeed', this.bloodSeed);
    for (let i = 0; i < BLOOD_MAX; i++) this.blood.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    this.blood.frustumCulled = false;
    this.blood.renderOrder = 3;
    this.group.add(this.blood);

    for (let i = 0; i < FLASH_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3, 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(this.flashGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.flashes.push({ mesh, mat, t: 0, life: 0, size: 0 });
    }
  }
  private flashGeo = new THREE.IcosahedronGeometry(1, 1);

  /** Punktgröße an die Render-Auflösung anpassen (Höhe in Pixeln). */
  setScale(heightPx: number) {
    for (const p of [this.smoke, this.glow]) (p.points.material as THREE.ShaderMaterial).uniforms.uScale.value = heightPx * 1.3;
  }

  // ------------------------------------------------------------------ Partikel
  private emit(pool: Pool, x: number, y: number, z: number, o: EmitOpts) {
    const i = pool.next;
    pool.next = (pool.next + 1) % pool.n;
    const sp = o.spread ?? 0;
    pool.pos[i * 3] = x + (this.rnd() - 0.5) * sp; pool.pos[i * 3 + 1] = y; pool.pos[i * 3 + 2] = z + (this.rnd() - 0.5) * sp;
    pool.vel[i * 3] = o.vx ?? 0; pool.vel[i * 3 + 1] = o.vy ?? 0; pool.vel[i * 3 + 2] = o.vz ?? 0;
    pool.life[i] = 0; pool.max[i] = o.life ?? 1;
    pool.s0[i] = o.size ?? 1; pool.s1[i] = o.size1 ?? (o.size ?? 1) * 2.5;
    tmpC.setHex(o.color ?? 0xdddddd); tmpC1.setHex(o.color1 ?? o.color ?? 0xdddddd);
    pool.c0[i * 3] = tmpC.r; pool.c0[i * 3 + 1] = tmpC.g; pool.c0[i * 3 + 2] = tmpC.b;
    pool.c1[i * 3] = tmpC1.r; pool.c1[i * 3 + 1] = tmpC1.g; pool.c1[i * 3 + 2] = tmpC1.b;
    pool.a0[i] = o.alpha ?? 0.8; pool.drag[i] = o.drag ?? 1.5; pool.grav[i] = o.gravity ?? 0;
  }
  private updatePool(pool: Pool, dt: number, hdr: number) {
    for (let i = 0; i < pool.n; i++) {
      if (pool.life[i] >= pool.max[i]) { if (pool.alpha[i] !== 0) { pool.alpha[i] = 0; pool.pos[i * 3 + 1] = -9999; } continue; }
      pool.life[i] += dt;
      const t = Math.min(1, pool.life[i] / pool.max[i]);
      const d = Math.max(0, 1 - pool.drag[i] * dt);
      pool.vel[i * 3] *= d; pool.vel[i * 3 + 1] = pool.vel[i * 3 + 1] * d - pool.grav[i] * dt; pool.vel[i * 3 + 2] *= d;
      pool.pos[i * 3] += pool.vel[i * 3] * dt; pool.pos[i * 3 + 1] += pool.vel[i * 3 + 1] * dt; pool.pos[i * 3 + 2] += pool.vel[i * 3 + 2] * dt;
      pool.size[i] = pool.s0[i] + (pool.s1[i] - pool.s0[i]) * t;
      for (let k = 0; k < 3; k++) pool.col[i * 3 + k] = (pool.c0[i * 3 + k] + (pool.c1[i * 3 + k] - pool.c0[i * 3 + k]) * t) * hdr;
      pool.alpha[i] = pool.a0[i] * (1 - t * t);
    }
    const g = pool.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('size') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Reifenqualm (Drift, Burnout) */
  tireSmoke(x: number, y: number, z: number, amount: number, vx: number, vz: number) {
    if (this.rnd() > amount) return;
    this.emit(this.smoke, x, y + 0.2, z, { vx: vx * 0.15 + (this.rnd() - 0.5) * 1.5, vy: 0.8 + this.rnd() * 0.8, vz: vz * 0.15 + (this.rnd() - 0.5) * 1.5, life: 1.6 + this.rnd(), size: 1.0, size1: 3.6, color: 0xe8e6ee, color1: 0xc9c6d4, alpha: 0.55, drag: 1.4, spread: 0.3 });
  }
  /** Staubwolke (Sand, Schotter, Erde) */
  dust(x: number, y: number, z: number, amount: number, color: number, vx: number, vz: number) {
    if (this.rnd() > amount) return;
    this.emit(this.smoke, x, y + 0.15, z, { vx: vx * 0.25 + (this.rnd() - 0.5) * 2, vy: 0.6 + this.rnd(), vz: vz * 0.25 + (this.rnd() - 0.5) * 2, life: 1.2 + this.rnd() * 0.8, size: 0.9, size1: 3.2, color, alpha: 0.6, drag: 1.8, spread: 0.4 });
  }
  /** Wasserspritzer (Pfützen, Boote, Sumpf, Hydrant) */
  splash(x: number, y: number, z: number, vx: number, vy: number, vz: number, n = 1) {
    for (let k = 0; k < n; k++) {
      this.emit(this.smoke, x, y, z, { vx: vx + (this.rnd() - 0.5) * 2.5, vy: vy + this.rnd() * 2, vz: vz + (this.rnd() - 0.5) * 2.5, life: 0.7 + this.rnd() * 0.4, size: 0.35, size1: 0.6, color: 0xe6f6ff, color1: 0xa8d8f0, alpha: 0.85, drag: 0.4, gravity: 12, spread: 0.3 });
    }
  }
  /** Funken (Blechkontakt, Felge auf Asphalt) */
  sparks(x: number, y: number, z: number, vx: number, vz: number, n: number) {
    for (let k = 0; k < n; k++) {
      this.emit(this.glow, x, y, z, { vx: vx * 0.5 + (this.rnd() - 0.5) * 7, vy: 1 + this.rnd() * 4, vz: vz * 0.5 + (this.rnd() - 0.5) * 7, life: 0.25 + this.rnd() * 0.35, size: 0.22, size1: 0.08, color: 0xfff2a0, color1: 0xff6a10, alpha: 1, drag: 1, gravity: 14 });
    }
  }
  /** Auspuff: Fehlzündung (orange) oder Nitro (blau) */
  exhaustFlame(x: number, y: number, z: number, dx: number, dz: number, nitro: boolean) {
    for (let k = 0; k < (nitro ? 3 : 4); k++) {
      const sp = 3 + this.rnd() * 5;
      this.emit(this.glow, x, y, z, { vx: dx * sp, vy: this.rnd() * 0.5, vz: dz * sp, life: 0.12 + this.rnd() * 0.12, size: nitro ? 0.7 : 0.55, size1: 0.15, color: nitro ? 0x9fd8ff : 0xffe28a, color1: nitro ? 0x2a5bff : 0xff4a10, alpha: 1, drag: 3 });
    }
  }
  /** Motorrauch je Schadensstufe (1 hell, 2 dunkel, 3 Feuer) */
  damageSmoke(x: number, y: number, z: number, stage: number, vx: number, vz: number) {
    if (stage >= 3) {
      if (this.rnd() < 0.8) this.emit(this.glow, x, y, z, { vx: vx * 0.3 + (this.rnd() - 0.5), vy: 2 + this.rnd() * 2, vz: vz * 0.3 + (this.rnd() - 0.5), life: 0.45 + this.rnd() * 0.3, size: 1.1, size1: 0.3, color: 0xffd060, color1: 0xff3000, alpha: 1, drag: 1, spread: 0.6 });
    }
    if (this.rnd() < (stage === 1 ? 0.25 : 0.5)) {
      const c = stage === 1 ? 0xdedbe6 : 0x3a3640;
      this.emit(this.smoke, x, y + 0.2, z, { vx: vx * 0.3 + (this.rnd() - 0.5) * 0.6, vy: 1.5 + this.rnd(), vz: vz * 0.3 + (this.rnd() - 0.5) * 0.6, life: 2 + this.rnd(), size: 0.8, size1: 3.4, color: c, color1: stage === 1 ? 0xbfbcc8 : 0x252229, alpha: stage === 1 ? 0.45 : 0.7, drag: 1, spread: 0.4 });
    }
  }
  /** Comic-Explosion */
  explosion(x: number, y: number, z: number) {
    for (let k = 0; k < 70; k++) {
      const a = this.rnd() * Math.PI * 2, e = this.rnd() * 0.9 + 0.1, sp = 4 + this.rnd() * 10;
      this.emit(this.glow, x, y + 0.5, z, { vx: Math.cos(a) * sp * (1 - e * 0.5), vy: e * sp, vz: Math.sin(a) * sp * (1 - e * 0.5), life: 0.5 + this.rnd() * 0.5, size: 2.2, size1: 0.6, color: 0xfff0a0, color1: 0xff3a00, alpha: 1, drag: 2.5, gravity: 2 });
    }
    for (let k = 0; k < 40; k++) {
      const a = this.rnd() * Math.PI * 2, sp = 2 + this.rnd() * 5;
      this.emit(this.smoke, x, y + 0.8, z, { vx: Math.cos(a) * sp, vy: 2 + this.rnd() * 4, vz: Math.sin(a) * sp, life: 2.5 + this.rnd() * 1.5, size: 2, size1: 6, color: 0x4a4048, color1: 0x22202a, alpha: 0.85, drag: 1.6, spread: 1.5 });
    }
    this.sparks(x, y + 0.8, z, 0, 0, 40);
    this.flash(x, y + 1, z, 5, 0.35);
  }
  /** Leuchtende Kugel (Explosion, Hit-Flash) */
  flash(x: number, y: number, z: number, size: number, life: number) {
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % FLASH_MAX;
    f.mesh.position.set(x, y, z);
    f.t = 0; f.life = life; f.size = size;
    f.mesh.visible = true;
  }

  // ------------------------------------------------------------------ Blut
  /**
   * Blutspritzer an einer Figur: Tröpfchen + feiner Nebel in Stoßrichtung (dx, dz) und Lachen am Boden.
   * kind 0 = Treffer, 1 = angefahren (weiter gestreut), 2 = überfahren (Lache unter dem Auto).
   */
  bloodSplash(x: number, y: number, z: number, dx: number, dz: number, amount: number, kind: number) {
    const a = Math.max(0.2, Math.min(1.6, amount));
    const reach = kind === 1 ? 6 : kind === 2 ? 2.5 : 3.5;
    const drops = Math.round(8 + a * (kind === 1 ? 30 : 20));
    for (let k = 0; k < drops; k++) {
      const sp = (0.3 + this.rnd()) * reach * (0.5 + a * 0.5);
      this.emit(this.smoke, x, y, z, {
        vx: dx * sp + (this.rnd() - 0.5) * 3, vy: 1 + this.rnd() * (kind === 2 ? 2.5 : 4), vz: dz * sp + (this.rnd() - 0.5) * 3,
        life: 0.45 + this.rnd() * 0.5, size: 0.1 + this.rnd() * 0.14, size1: 0.08, color: 0xb0121a, color1: 0x5a0408,
        alpha: 0.95, drag: 0.5, gravity: 15, spread: 0.25,
      });
    }
    for (let k = 0; k < 2 + Math.round(a * 3); k++) {
      this.emit(this.smoke, x, y, z, { vx: dx * 1.5 + (this.rnd() - 0.5), vy: 0.4 + this.rnd() * 0.6, vz: dz * 1.5 + (this.rnd() - 0.5), life: 0.35 + this.rnd() * 0.25, size: 0.45, size1: 1.3, color: 0x9a1018, color1: 0x5a0a10, alpha: 0.45, drag: 3, spread: 0.3 });
    }
    // Lachen: eine große nahe der Figur, kleinere Spritzer in Stoßrichtung verteilt
    const gx = x + dx * (kind === 2 ? 0 : 0.5), gz = z + dz * (kind === 2 ? 0 : 0.5);
    const main = kind === 2 ? 1.6 + a * 1.2 : 0.8 + a * 1.1;
    this.bloodDecal(gx, gz, main, main * (kind === 2 ? 1.6 : 1.15), Math.atan2(dx, dz));
    const smalls = Math.round(2 + a * (kind === 1 ? 7 : 4));
    for (let k = 0; k < smalls; k++) {
      const t = this.rnd() * reach * (0.4 + a * 0.4);
      const side = (this.rnd() - 0.5) * (1 + t * 0.5);
      const px = gx + dx * t + dz * side, pz = gz + dz * t - dx * side;
      const s = 0.18 + this.rnd() * 0.45;
      this.bloodDecal(px, pz, s, s * (1 + this.rnd() * 1.4), Math.atan2(dx, dz) + (this.rnd() - 0.5) * 0.6);
    }
  }
  private bloodDecal(x: number, z: number, w: number, l: number, rot: number) {
    const i = this.bloodNext;
    this.bloodNext = (this.bloodNext + 1) % BLOOD_MAX;
    tmpQ.setFromAxisAngle(UP, rot);
    tmpP.set(x, groundHeight(this.map, x, z) + 0.035, z);
    tmpS.set(w, 1, l);
    this.blood.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    this.bloodBirth.setX(i, this.time);
    this.bloodSeed.setX(i, this.rnd());
    this.blood.instanceMatrix.needsUpdate = true;
    this.bloodBirth.needsUpdate = true;
    this.bloodSeed.needsUpdate = true;
  }

  // ------------------------------------------------------------------ Bremsspuren
  /** Bremsspur je Rad fortsetzen (key = Fahrzeug+Rad). shade 0 = Gummi, 1 = Erdspur. */
  skidmark(key: number, x: number, y: number, z: number, width: number, shade: number) {
    const last = this.skidLast.get(key);
    if (!last) { this.skidLast.set(key, { x, y, z, t: this.time }); return; }
    const dx = x - last.x, dz = z - last.z;
    const len = Math.hypot(dx, dz);
    if (this.time - last.t > 0.12 || len > 4) { last.x = x; last.y = y; last.z = z; last.t = this.time; return; }
    if (len < 0.25) return; // Startpunkt halten, bis das Rad weit genug gerollt ist
    const lx = last.x, ly = last.y, lz = last.z;
    last.x = x; last.y = y; last.z = z; last.t = this.time;
    const i = this.skidNext;
    this.skidNext = (this.skidNext + 1) % SKID_MAX;
    tmpQ.setFromAxisAngle(UP, Math.atan2(dx, dz));
    tmpP.set(lx, Math.max(ly, y) + 0.03, lz);
    tmpS.set(width, 1, len + 0.05);
    this.skid.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
    this.skidBirth.setX(i, this.time);
    this.skidShade.setX(i, shade);
    this.skid.instanceMatrix.needsUpdate = true;
    this.skidBirth.needsUpdate = true;
    this.skidShade.needsUpdate = true;
  }
  /** Spur unterbrechen (Rad rutscht nicht mehr) */
  skidEnd(key: number) { this.skidLast.delete(key); }

  // ------------------------------------------------------------------ Trümmer
  /** Abgefallenes Teil als Trümmer (geo zentriert, matrix = Welt-Matrix des Fahrzeugs). */
  spawnDebris(geo: THREE.BufferGeometry, carMatrix: THREE.Matrix4, vx: number, vy: number, vz: number) {
    if (this.debris.length >= DEBRIS_MAX) {
      const old = this.debris.shift()!;
      this.group.remove(old.mesh);
      old.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(geo, this.debrisMat);
    addOutline(mesh, LINE.vehicle);
    const c = geo.userData.center as THREE.Vector3;
    carMatrix.decompose(tmpP, tmpQ, tmpS);
    mesh.position.copy(c).applyMatrix4(carMatrix);
    mesh.quaternion.copy(tmpQ);
    this.group.add(mesh);
    const out = c.clone().setY(0).applyQuaternion(tmpQ).normalize();
    this.debris.push({
      mesh, life: 0, rest: false,
      vel: new THREE.Vector3(vx * 0.7 + out.x * 3, vy + 2.5 + this.rnd() * 2, vz * 0.7 + out.z * 3),
      spin: new THREE.Vector3((this.rnd() - 0.5) * 10, (this.rnd() - 0.5) * 8, (this.rnd() - 0.5) * 10),
    });
  }

  // ------------------------------------------------------------------ Frame
  update(dt: number) {
    this.time += dt;
    (this.skid.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    (this.blood.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    // Spuren verschwundener Fahrzeuge vergessen (sonst wächst die Tabelle beim Herumfahren)
    for (const [k, l] of this.skidLast) if (this.time - l.t > 1) this.skidLast.delete(k);
    const night = U.uNight.value;
    this.updatePool(this.smoke, dt, 1);
    this.updatePool(this.glow, dt, 1.6 + night);
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.t += dt;
      const k = f.t / f.life;
      f.mesh.scale.setScalar(f.size * (0.4 + k * 1.2));
      f.mat.opacity = Math.max(0, 1 - k);
      if (k >= 1) f.mesh.visible = false;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      if (d.life > DEBRIS_LIFE) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); this.debris.splice(i, 1); continue; }
      if (d.life > DEBRIS_LIFE - 1) d.mesh.scale.setScalar(Math.max(0.01, DEBRIS_LIFE - d.life));
      if (d.rest) continue;
      d.vel.y -= 9.81 * 1.4 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      tmpQ.setFromEuler(tmpE.set(d.spin.x * dt, d.spin.y * dt, d.spin.z * dt));
      d.mesh.quaternion.premultiply(tmpQ);
      const g = groundHeight(this.map, d.mesh.position.x, d.mesh.position.z) + 0.08;
      if (d.mesh.position.y < g) {
        d.mesh.position.y = g;
        d.vel.y = d.vel.y < -2 ? -d.vel.y * 0.3 : 0;
        d.vel.x *= 0.7; d.vel.z *= 0.7; d.spin.multiplyScalar(0.6);
        if (d.vel.length() < 0.3) d.rest = true;
      }
    }
  }
}
