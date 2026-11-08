// Gelände-Material: 8 Untergrund-Schichten aus dem Atlas, weich überblendet (Gewichte pro Vertex,
// an den Rändern mit Noise "ausgefranst" -> gemalte, unregelmäßige Übergänge statt harter Kanten)
// und triplanar projiziert (Hänge im Gebirge verzerren nicht).
import * as THREE from 'three';
import { getAtlas, ATLAS_GLSL } from './atlas';
import { MATERIALS, matIndex } from './library';
import { noiseTexture } from './surface';
import { toonGradient, U } from './toon';

/** Reihenfolge = Kanal in den Attributen lw0 (0–3) und lw1 (4–7). */
export const TERRAIN_LAYERS = ['sand', 'grass_tropical', 'grass_dry', 'swamp_mud', 'red_earth', 'rock', 'cane_field', 'grove_soil'] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];
export const LAYER = Object.fromEntries(TERRAIN_LAYERS.map((n, i) => [n, i])) as Record<TerrainLayer, number>;

export function terrainMaterial(): THREE.MeshToonMaterial {
  const atlas = getAtlas();
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  const idx = TERRAIN_LAYERS.map((n) => matIndex(n));
  const scale = TERRAIN_LAYERS.map((n) => 1 / MATERIALS[matIndex(n)].tile[0]);
  const wetIdx = matIndex('sand_wet');
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas.color };
    shader.uniforms.uAtlasE = { value: atlas.emissive };
    shader.uniforms.uAtlasInfo = { value: atlas.info };
    shader.uniforms.uNoise = { value: noiseTexture() };
    shader.uniforms.uLayerIdx = { value: idx };
    shader.uniforms.uLayerScale = { value: scale };
    shader.uniforms.uNight = U.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        attribute vec4 lw0;
        attribute vec4 lw1;
        varying vec4 vW0;
        varying vec4 vW1;
        varying vec3 vWP;
        varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', /* glsl */ `#include <worldpos_vertex>
        vW0 = lw0; vW1 = lw1;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec4 vW0;
        varying vec4 vW1;
        varying vec3 vWP;
        varying vec3 vWN;
        uniform sampler2D uNoise;
        uniform float uNight;
        uniform float uLayerIdx[8];
        uniform float uLayerScale[8];
        ${ATLAS_GLSL}
        vec3 triSample(int i, vec3 bw, vec3 dx, vec3 dy) {
          float s = uLayerScale[i], id = uLayerIdx[i];
          vec3 c = atlasSampleGrad(uAtlas, id, vWP.xz * s, dx.xz * s, dy.xz * s).rgb * bw.y;
          if (bw.x > 0.02) c += atlasSampleGrad(uAtlas, id, vWP.zy * s, dx.zy * s, dy.zy * s).rgb * bw.x;
          if (bw.z > 0.02) c += atlasSampleGrad(uAtlas, id, vWP.xy * s, dx.xy * s, dy.xy * s).rgb * bw.z;
          return c;
        }`)
      .replace('#include <color_fragment>', /* glsl */ `
        vec3 pdx = dFdx(vWP), pdy = dFdy(vWP);
        vec3 bw = pow(abs(normalize(vWN)), vec3(4.0));
        bw /= (bw.x + bw.y + bw.z);
        float w[8];
        w[0] = vW0.x; w[1] = vW0.y; w[2] = vW0.z; w[3] = vW0.w;
        w[4] = vW1.x; w[5] = vW1.y; w[6] = vW1.z; w[7] = vW1.w;
        // ausgefranste Übergänge: Rauschen verschiebt die Gewichte, dann geschärft
        vec4 nz = texture2D(uNoise, vWP.xz * 0.045);
        vec4 nz2 = texture2D(uNoise, vWP.xz * 0.011 + 0.37);
        float total = 0.0;
        for (int i = 0; i < 8; i++) {
          float n = (i % 2 == 0 ? nz.r : nz.g) * 0.6 + (i % 3 == 0 ? nz2.r : nz2.b) * 0.4;
          float v = w[i] > 0.001 ? max(w[i] + (n - 0.5) * 0.7, 0.0) : 0.0;
          v = v * v * v;
          w[i] = v; total += v;
        }
        vec3 col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float k = w[i] / max(total, 1e-4);
          if (k < 0.02) continue;
          vec3 c = triSample(i, bw, pdx, pdy);
          if (i == 0) {
            // nasser Sand an der Wasserlinie
            float wet = smoothstep(0.35, -0.15, vWP.y + (nz.b - 0.5) * 0.3);
            float s0 = uLayerScale[0];
            if (wet > 0.01) c = mix(c, atlasSampleGrad(uAtlas, ${wetIdx.toFixed(1)}, vWP.xz * s0, pdx.xz * s0, pdy.xz * s0).rgb, wet);
          }
          col += c * k;
        }
        diffuseColor.rgb = col * vColor;
        float hv = texture2D(uNoise, vWP.xz * 0.0037 + 0.21).r;
        diffuseColor.rgb *= mix(vec3(0.96, 1.0, 1.02), vec3(1.07, 1.03, 0.86), smoothstep(0.3, 0.75, hv));
        diffuseColor.rgb *= 0.92 + 0.16 * texture2D(uNoise, vWP.xz * 0.019).b;
      `)
      .replace('#include <opaque_fragment>', /* glsl */ `
        outgoingLight = mix(outgoingLight, outgoingLight * vec3(0.62, 0.7, 1.08), uNight * 0.55);
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'terrain';
  return m;
}
