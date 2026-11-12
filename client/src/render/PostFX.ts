// Post-Processing (eigene, schlanke Kette statt EffectComposer + UnrealBloomPass):
//
//   1. Szene  -> sceneRT (HalfFloat) in der Render-Auflösung (Preset x dynamische Auflösung)
//   2. Bloom  -> Helligkeitsauszug in halber Auflösung (inkl. NaN-Wächter), 5 Mip-Stufen runter,
//               wieder hoch addiert (Dual-Filter) – nur für sehr helle Pixel (Neon, Lichter, Glanz)
//   3. Abschluss (EIN Vollbild-Pass in Bildschirmauflösung): Szene hochskalieren + schärfen,
//               Bloom addieren, Farbkorrektur je Zonenstimmung, Vignette, sRGB-Ausgabe
//   4. Overlay -> Namensschilder und Sprechblasen (Ebene OVERLAY_LAYER) direkt in voller Auflösung
//               darüber – bleiben bei reduzierter Render-Auflösung immer scharf
//
// Vorher: Szene, NaN-Wächter, Bloom-Mischung, Farbkorrektur und Ausgabe waren je ein eigener
// Vollbild-Pass in voller Auflösung (4 zusätzliche Lese-/Schreibdurchgänge HalfFloat) – auf
// integrierten GPUs (Speicherbandbreite!) einer der größten Posten.
// Retro-Modus: Render-Scale 0,6 und Nearest-Neighbor-Hochskalierung (ohne Schärfung).
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Mood } from './palette';
import type { GpuTimer } from '../perf/Profiler';

/** Ebene für Bildschirm-Beschriftungen (Namen, Sprechblasen): werden nach der Nachbearbeitung scharf gezeichnet. */
export const OVERLAY_LAYER = 1;
/** Ebene für Objekte, die NUR in die Schattentextur gezeichnet werden (vereinfachte Schattenwerfer). */
export const SHADOW_ONLY_LAYER = 2;

export interface GfxSettings {
  retro: boolean; shadows: boolean; outlines: boolean; bloom: boolean;
  /** Qualitätsstufe (bestimmt Schattenauflösung, Render-Auflösung, Pixel-Ratio-Deckel). */
  preset?: GfxPreset;
}
export type GfxPreset = 'hoch' | 'mittel' | 'niedrig';

const QUAD_VS = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Helligkeitsauszug + Verkleinern auf halbe Auflösung (4 bilineare Abgriffe) + NaN/Inf-Wächter. */
const BRIGHT_FS = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
  varying vec2 vUv;
  vec3 safe(vec3 c) { return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(64.0)); }
  void main() {
    vec3 c = safe(texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb) + safe(texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb)
           + safe(texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb) + safe(texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb);
    c *= 0.25;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.01, l), 1.0);
  }`;

/** Dual-Filter (Kawase) runter: 5 Abgriffe. */
const DOWN_FS = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
    c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
    c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
    gl_FragColor = vec4(c / 8.0, 1.0);
  }`;

/** Dual-Filter hoch: kleinere Stufe weich (Zelt, 8 Abgriffe) + eigene Stufe gewichtet. */
const UP_FS = /* glsl */ `
  uniform sampler2D tSrc; uniform sampler2D tSelf; uniform vec2 uTexel; uniform float uSelf; uniform float uLow;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 c = texture2D(tSrc, vUv + vec2(-o.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(o.x * 2.0, 0.0)).rgb
           + texture2D(tSrc, vUv + vec2(0.0, -o.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, o.y * 2.0)).rgb;
    c += (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb
        + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
    gl_FragColor = vec4(c / 12.0 * uLow + texture2D(tSelf, vUv).rgb * uSelf, 1.0);
  }`;

/** Abschluss: Hochskalieren (+ Schärfen bzw. Nearest im Retro-Modus), Bloom, Farbkorrektur, Vignette, sRGB. */
const FINAL_FS = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform vec2 uSceneSize; uniform float uSharp; uniform float uRetro; uniform float uBloom;
  uniform float uExposure, uSaturation, uWarmth, uVignette, uDusk, uNight;
  varying vec2 vUv;
  vec3 safe(vec3 c) { return (any(isnan(c)) || any(isinf(c))) ? vec3(0.0) : min(c, vec3(64.0)); }
  void main() {
    vec3 col;
    if (uRetro > 0.5) {
      col = safe(texture2D(tScene, (floor(vUv * uSceneSize) + 0.5) / uSceneSize).rgb);
    } else {
      col = safe(texture2D(tScene, vUv).rgb);
      if (uSharp > 0.0) {
        // Kontrast-adaptive Schärfung (CAS-artig), auf das Nachbar-Minimum/-Maximum begrenzt -> kein Überschwingen
        vec2 t = 1.0 / uSceneSize;
        vec3 n = safe(texture2D(tScene, vUv + vec2(0.0, t.y)).rgb), s = safe(texture2D(tScene, vUv - vec2(0.0, t.y)).rgb);
        vec3 e = safe(texture2D(tScene, vUv + vec2(t.x, 0.0)).rgb), w = safe(texture2D(tScene, vUv - vec2(t.x, 0.0)).rgb);
        vec3 mn = min(col, min(min(n, s), min(e, w))), mx = max(col, max(max(n, s), max(e, w)));
        col = clamp(col + (col * 4.0 - n - s - e - w) * uSharp * 0.25, mn, mx);
      }
    }
    col += texture2D(tBloom, vUv).rgb * uBloom;
    // --- Farbkorrektur (wie zuvor im Grade-Pass) ---
    col *= uExposure;
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, uSaturation);
    col *= vec3(1.0 + uWarmth * 0.08, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.08);
    // Vice-City-Look (nur Farbmathe): weicher S-Kontrast, leicht angehobene Schwarzwerte, Split-Toning
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, col * col * (3.0 - 2.0 * min(col, vec3(1.0))), 0.28);
    col = col * 0.96 + vec3(0.030, 0.012, 0.045) * (1.0 - uNight * 0.4);
    float sh = 1.0 - smoothstep(0.0, 0.55, lum), hi = smoothstep(0.45, 1.1, lum);
    col += vec3(0.060, 0.010, 0.085) * sh * (0.5 + uNight * 0.3);
    col += vec3(0.070, 0.035, -0.020) * hi * (1.0 - uNight * 0.6);
    col = mix(col, col * vec3(1.20, 0.80, 0.98) + vec3(0.05, 0.0, 0.03), uDusk * 0.35);
    col = mix(col, col * vec3(0.86, 0.92, 1.20), uNight * 0.18);
    vec2 d = vUv - 0.5;
    float v = 1.0 - smoothstep(0.35, 0.85, length(d * vec2(1.15, 1.0))) * uVignette;
    gl_FragColor = vec4(col * v, 1.0);
    #include <colorspace_fragment>
  }`;

/** Gewichte je Bloom-Stufe (wie UnrealBloomPass: Faktoren 1,0 … 0,2, Radius 0,3). */
const MIPS = 5;
const BLOOM_FACTORS = [1.0, 0.8, 0.6, 0.4, 0.2].map((f) => f + (1.2 - 2 * f) * 0.3);

const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };

export class PostFX {
  private sceneRT: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private brightMat: THREE.ShaderMaterial;
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private bloomOn = true;
  private retro = false;
  private black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  private gpuTimer: GpuTimer | null = null;
  private size = new THREE.Vector2(1, 1);

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene, private camera: THREE.Camera) {
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true });
    for (let i = 0; i < MIPS; i++) { this.down.push(new THREE.WebGLRenderTarget(1, 1, rtOpts)); this.up.push(new THREE.WebGLRenderTarget(1, 1, rtOpts)); }
    const mat = (fs: string, uniforms: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    // Schwelle knapp unter 1: beleuchtete Flächen bleiben darunter, Neon/Lampen (HDR > 1) nicht
    this.brightMat = mat(BRIGHT_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.92 } });
    this.downMat = mat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = mat(UP_FS, { tSrc: { value: null }, tSelf: { value: null }, uTexel: { value: new THREE.Vector2() }, uSelf: { value: 1 }, uLow: { value: 1 } });
    this.finalMat = mat(FINAL_FS, {
      tScene: { value: this.sceneRT.texture }, tBloom: { value: this.black }, uSceneSize: { value: new THREE.Vector2(1, 1) },
      uSharp: { value: 0 }, uRetro: { value: 0 }, uBloom: { value: 0.4 },
      uExposure: { value: 1 }, uSaturation: { value: 1 }, uWarmth: { value: 0 }, uVignette: { value: 0.28 }, uDusk: { value: 0 }, uNight: { value: 0 },
    });
    this.black.needsUpdate = true;
    // Schattenpass: Ebene SHADOW_ONLY_LAYER zuschalten (Hauptpass sieht sie nicht). three.js prüft die
    // Ebenen der Hauptkamera auch beim Schattenwerfen; die Renderliste des Hauptpasses steht da schon.
    const sm = renderer.shadowMap as THREE.WebGLShadowMap & { render: (...a: unknown[]) => void };
    const shadowRender = sm.render.bind(sm);
    sm.render = (...a: unknown[]) => {
      const c = a[2] as THREE.Camera;
      c.layers.enable(SHADOW_ONLY_LAYER);
      shadowRender(...a);
      c.layers.disable(SHADOW_ONLY_LAYER);
    };
  }

  /** GPU-Zeit je Pass messen (Schatten, Szene, Bloom, Post, Overlay). */
  attachTimer(gpu: GpuTimer) {
    const sm = this.renderer.shadowMap as THREE.WebGLShadowMap & { render: (...a: unknown[]) => void };
    const shadow = sm.render.bind(sm);
    sm.render = (...a: unknown[]) => {
      if (!(a[0] as unknown[]).length || !sm.enabled || (!sm.autoUpdate && !sm.needsUpdate)) { shadow(...a); return; }
      const prev = gpu.current; gpu.pass('shadow'); shadow(...a); gpu.pass(prev);
    };
    this.gpuTimer = gpu;
  }

  setCamera(camera: THREE.Camera) { this.camera = camera; }

  /**
   * Bildschirmgröße (CSS-Pixel), Pixel-Ratio der Leinwand (volle Schärfe für Overlay/Abschluss) und
   * Faktor der Szenen-Auflösung relativ zur Leinwand.
   */
  setSize(w: number, h: number, canvasRatio: number, sceneScale: number, retro = false) {
    this.retro = retro;
    const sw = Math.max(1, Math.round(w * canvasRatio * sceneScale)), sh = Math.max(1, Math.round(h * canvasRatio * sceneScale));
    this.size.set(sw, sh);
    this.sceneRT.setSize(sw, sh);
    let bw = Math.max(1, Math.round(sw / 2)), bh = Math.max(1, Math.round(sh / 2));
    for (let i = 0; i < MIPS; i++) {
      this.down[i].setSize(bw, bh); this.up[i].setSize(bw, bh);
      bw = Math.max(1, Math.round(bw / 2)); bh = Math.max(1, Math.round(bh / 2));
    }
    const u = this.finalMat.uniforms;
    u.uSceneSize.value.set(sw, sh);
    u.uRetro.value = retro ? 1 : 0;
    // Schärfen nur beim Hochskalieren (je kleiner die Render-Auflösung, desto mehr)
    u.uSharp.value = retro ? 0 : Math.min(0.6, Math.max(0, (1 - sceneScale) * 2));
    const filter = retro ? THREE.NearestFilter : THREE.LinearFilter;
    this.sceneRT.texture.magFilter = this.sceneRT.texture.minFilter = filter;
  }

  /** Szenen-Auflösung in Pixeln (für Linienbreiten). */
  get sceneSize() { return this.size; }

  setBloom(on: boolean) { this.bloomOn = on; }

  /** Stimmung und Nacht: nachts kräftigerer Bloom (Neon dominiert). */
  update(mood: Mood, night: number, dusk = 0) {
    const u = this.finalMat.uniforms;
    u.uExposure.value = mood.exposure * (1 + night * 0.18); // nachts etwas aufhellen (Sicht)
    u.uSaturation.value = mood.saturation;
    u.uWarmth.value = (mood.warmth + dusk * (mood.golden ?? 0) * 0.25) * (1 - night * 0.7);
    u.uDusk.value = dusk; u.uNight.value = night;
    u.uBloom.value = 0.34 + night * 0.34 * mood.neon + dusk * (0.12 + (mood.golden ?? 0) * 0.1); // Neon & Sonnenuntergang glühen
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  render() {
    const r = this.renderer, gpu = this.gpuTimer;
    const cam = this.camera;
    // 1) Szene (ohne Overlay-Ebene)
    gpu?.pass('scene');
    cam.layers.disable(OVERLAY_LAYER);
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    // 2) Bloom
    gpu?.pass('bloom');
    const fu = this.finalMat.uniforms;
    if (this.bloomOn) {
      const b = this.brightMat.uniforms;
      b.tSrc.value = this.sceneRT.texture;
      b.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
      this.pass(this.brightMat, this.down[0]);
      const d = this.downMat.uniforms;
      for (let i = 1; i < MIPS; i++) {
        d.tSrc.value = this.down[i - 1].texture;
        d.uTexel.value.set(1 / this.down[i - 1].width, 1 / this.down[i - 1].height);
        this.pass(this.downMat, this.down[i]);
      }
      const up = this.upMat.uniforms;
      // kleinste Stufe: nur sich selbst gewichtet; darüber: weich hochskalierte kleinere + eigene
      let src = this.down[MIPS - 1];
      up.uLow.value = 0; up.uSelf.value = BLOOM_FACTORS[MIPS - 1];
      up.tSrc.value = src.texture; up.tSelf.value = src.texture; up.uTexel.value.set(1 / src.width, 1 / src.height);
      this.pass(this.upMat, this.up[MIPS - 1]);
      for (let i = MIPS - 2; i >= 0; i--) {
        src = this.up[i + 1];
        up.uLow.value = 1; up.uSelf.value = BLOOM_FACTORS[i];
        up.tSrc.value = src.texture; up.tSelf.value = this.down[i].texture; up.uTexel.value.set(1 / src.width, 1 / src.height);
        this.pass(this.upMat, this.up[i]);
      }
      fu.tBloom.value = this.up[0].texture;
    } else fu.tBloom.value = this.black;
    // 3) Abschluss in voller Auflösung
    gpu?.pass('post');
    fu.tScene.value = this.sceneRT.texture;
    this.pass(this.finalMat, null);
    // 4) Beschriftungen scharf darüber (ohne Schatten-Neuberechnung, ohne Löschen)
    gpu?.pass('overlay');
    const sm = r.shadowMap, auto = sm.autoUpdate, clear = r.autoClear;
    sm.autoUpdate = false; r.autoClear = false;
    const bg = this.scene.background; this.scene.background = null;
    cam.layers.set(OVERLAY_LAYER);
    r.render(this.scene, cam);
    cam.layers.set(0);
    this.scene.background = bg; sm.autoUpdate = auto; r.autoClear = clear;
    gpu?.pass(null);
  }
}
