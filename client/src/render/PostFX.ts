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
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure, uSaturation, uWarmth, uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uExposure;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col *= vec3(1.0 + uWarmth * 0.08, 1.0 + uWarmth * 0.02, 1.0 - uWarmth * 0.08);
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
  update(mood: Mood, night: number) {
    const u = this.grade.uniforms;
    u.uExposure.value = mood.exposure;
    u.uSaturation.value = mood.saturation;
    u.uWarmth.value = mood.warmth * (1 - night * 0.7);
    this.bloom.strength = 0.3 + night * 0.3 * mood.neon;
  }

  render() { this.composer.render(); }
}
