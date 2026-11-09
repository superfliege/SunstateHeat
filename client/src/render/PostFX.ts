// Post-Processing: leichter Bloom nur für sehr helle Pixel (Neon, Lichter, Glanzpunkte – alles
// andere bleibt unter der Schwelle), Farbkorrektur je Zonenstimmung, leichte Vignette.
// Retro-Modus: Render-Scale 0,6 und Nearest-Neighbor-Hochskalierung (CSS image-rendering: pixelated).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Mood } from './palette';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uExposure: { value: 1 },
    uSaturation: { value: 1 },
    uWarmth: { value: 0 },
    uVignette: { value: 0.28 },
    uDusk: { value: 0 },
    uNight: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uSaturation, uWarmth, uVignette, uDusk, uNight;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uExposure;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col *= vec3(1.0 + uWarmth * 0.08, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.08);
      // Vice-City-Look (nur Farbmathe, kein zusätzlicher Texturzugriff):
      // weicher S-Kontrast, leicht angehobene Schwarzwerte (pastelliger Dunst) und Split-Toning:
      // Schatten -> Violett/Magenta, Lichter -> warmes Pfirsich/Gold; zur Dämmerung kippt alles in Pink/Orange.
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * col * (3.0 - 2.0 * min(col, vec3(1.0))), 0.28);
      col = col * 0.96 + vec3(0.030, 0.012, 0.045) * (1.0 - uNight * 0.4);
      float sh = 1.0 - smoothstep(0.0, 0.55, lum), hi = smoothstep(0.45, 1.1, lum);
      col += vec3(0.060, 0.010, 0.085) * sh * (0.5 + uNight);
      col += vec3(0.070, 0.035, -0.020) * hi * (1.0 - uNight * 0.6);
      col = mix(col, col * vec3(1.20, 0.80, 0.98) + vec3(0.05, 0.0, 0.03), uDusk * 0.35);
      col = mix(col, col * vec3(0.86, 0.92, 1.20), uNight * 0.18);
      vec2 d = vUv - 0.5;
      float v = 1.0 - smoothstep(0.35, 0.85, length(d * vec2(1.15, 1.0))) * uVignette;
      gl_FragColor = vec4(col * v, c.a);
    }`,
};

export interface GfxSettings { retro: boolean; shadows: boolean; outlines: boolean; bloom: boolean }

export class PostFX {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    // Schwelle knapp unter 1: beleuchtete Flächen bleiben darunter, Neon/Lampen (HDR > 1) nicht
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.3, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.Camera) { this.renderPass.camera = camera; }

  setSize(w: number, h: number, pixelRatio: number) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  setBloom(on: boolean) { this.bloom.enabled = on; }

  /** Stimmung und Nacht: nachts kräftigerer Bloom (Neon dominiert). */
  update(mood: Mood, night: number, dusk = 0) {
    const u = this.grade.uniforms;
    u.uExposure.value = mood.exposure;
    u.uSaturation.value = mood.saturation;
    u.uWarmth.value = mood.warmth * (1 - night * 0.7);
    u.uDusk.value = dusk; u.uNight.value = night;
    this.bloom.strength = 0.34 + night * 0.34 * mood.neon + dusk * 0.12; // Neon & Sonnenuntergang glühen
  }

  render() { this.composer.render(); }
}
