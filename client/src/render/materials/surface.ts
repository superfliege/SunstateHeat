// Oberflächen-Material für die statische Welt (Straßen, Gehwege, Fassaden, Dächer, Kit-Modelle, Decals).
// EIN Toon-Material mit Atlas: Material-Kachel und Shader-Flags kommen pro Vertex (Attribut `surf`),
// die Kachel-UV in Metern/Kachelgröße (Attribut `auv`). Dazu:
//   - Tönung: Vertex-Farbe färbt nur Pixel mit Alpha (Putz, Lack), Glas/Zierleisten bleiben
//   - Welt-Rauschen: leichte Helligkeitsvariation, damit sich Kacheln nicht sichtbar wiederholen
//   - Fenster leuchten nachts zufällig (pro Fensterachse), Leuchtreklame flackert
//   - Spiegelglas reflektiert die Himmelsfarbe (Env-Map-Fake), Hitzeflimmern auf Highways
import * as THREE from 'three';
import { ATLAS_GLSL, getAtlas } from './atlas';
import { FADE_PARS, toonGradient, U } from './toon';

let noiseTex: THREE.DataTexture | null = null;
/** Kachelbares Value-Noise (64 x 64, linear gefiltert) für Variation und Übergänge. */
export function noiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
  const octave = (cells: number) => {
    const g = Array.from({ length: cells * cells }, rnd);
    return (x: number, y: number) => {
      const fx = (x / N) * cells, fy = (y / N) * cells, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[(b % cells) * cells + (a % cells)];
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy;
    };
  };
  const o = [octave(4), octave(8), octave(16), octave(32)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = Math.round((o[0](x, y) * 0.55 + o[1](x, y) * 0.3 + o[2](x, y) * 0.15) * 255);
      data[i + 1] = Math.round(o[2](x, y) * 255);
      data[i + 2] = Math.round(o[3](x, y) * 255);
      data[i + 3] = Math.round(rnd() * 255);
    }
  }
  noiseTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

const COMMON_VERT = /* glsl */ `
  attribute vec2 auv;
  attribute vec2 surf;
  varying vec2 vAuv;
  varying vec2 vSurf;
  varying vec3 vWorldPos;
`;

const COMMON_FRAG = /* glsl */ `
  varying vec2 vAuv;
  varying vec2 vSurf;
  varying vec3 vWorldPos;
  uniform sampler2D uNoise;
  uniform float uTime;
  uniform float uNight;
  uniform float uDay;
  uniform float uWet;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  ${ATLAS_GLSL}
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  bool hasFlag(int f, int bit) { return (f & bit) != 0; }
`;

export interface SurfaceOptions {
  decal?: boolean;
  /** Fragmente zwischen Kamera und Spieler werden ausgedithert (Häuser durchsichtig). */
  fade?: boolean;
}

/**
 * Atlas-Toon-Material. decal = Alpha-Cutout + Polygon-Offset (Risse, Ölflecken, Graffiti …).
 */
export function surfaceMaterial(o: SurfaceOptions = {}): THREE.MeshToonMaterial {
  const atlas = getAtlas();
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
  if (o.decal) {
    m.alphaTest = 0.5;
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
  }
  m.onBeforeCompile = (shader) => {
    for (const k of ['uTime', 'uNight', 'uDay', 'uWet', 'uSkyTop', 'uSkyHorizon'] as const) shader.uniforms[k] = U[k];
    shader.uniforms.uAtlas = { value: atlas.color };
    shader.uniforms.uAtlasE = { value: atlas.emissive };
    shader.uniforms.uAtlasInfo = { value: atlas.info };
    shader.uniforms.uNoise = { value: noiseTexture() };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_VERT)
      .replace('#include <worldpos_vertex>', /* glsl */ `#include <worldpos_vertex>
        vAuv = auv; vSurf = surf;
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vWorldPos = (modelMatrix * wp).xyz;
        }`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + COMMON_FRAG)
      // Atlas statt einfacher Vertex-Farbe
      .replace('#include <color_fragment>', /* glsl */ `
        int sflags = int(vSurf.y + 0.5);
        float sidx = floor(vSurf.x + 0.5);
        vec2 suv = vAuv;
        vec2 sdx = dFdx(vAuv), sdy = dFdy(vAuv);
        float camDist = length(vWorldPos - cameraPosition);
        if (hasFlag(sflags, 4)) {
          // Hitzeflimmern: Textur wabert mit Abstand, nur tagsüber
          float k = smoothstep(25.0, 90.0, camDist) * uDay;
          suv.x += sin(vWorldPos.z * 2.7 + uTime * 7.0) * 0.02 * k;
        }
        vec4 tex = atlasSampleGrad(uAtlas, sidx, suv, sdx, sdy);
        #ifdef DECAL
          if (hasFlag(sflags, 2)) tex.a *= step(0.5, uWet * (0.6 + texture2D(uNoise, vWorldPos.xz * 0.05).r)); // Pfützen nur bei Nässe
          if (tex.a < 0.5) discard;
          diffuseColor.rgb = tex.rgb * (hasFlag(sflags, 32) ? vec3(1.0) : vColor);
        #else
          diffuseColor.rgb = tex.rgb * mix(vec3(1.0), vColor, hasFlag(sflags, 32) ? 0.0 : tex.a);
        #endif
        // Welt-Rauschen (zwei Maßstäbe) gegen sichtbare Wiederholung
        float wn = texture2D(uNoise, vWorldPos.xz * 0.013 + vWorldPos.y * 0.01).r * 0.65 + texture2D(uNoise, vWorldPos.xz * 0.07).g * 0.35;
        diffuseColor.rgb *= 0.9 + 0.2 * wn;
        // großräumige Farbtonwanderung (sonnengebleicht/gelblich <-> satt)
        float hv = texture2D(uNoise, vWorldPos.xz * 0.0041 + 0.5).r;
        diffuseColor.rgb *= mix(vec3(0.97, 1.0, 1.03), vec3(1.06, 1.02, 0.88), smoothstep(0.3, 0.75, hv));
        if (hasFlag(sflags, 4)) {
          float k = smoothstep(40.0, 120.0, camDist) * uDay;
          diffuseColor.rgb += vec3(0.05, 0.06, 0.08) * k * (0.5 + 0.5 * sin(vWorldPos.z * 1.3 + uTime * 5.0));
        }
      `)
      .replace('#include <alphatest_fragment>', '')
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        if (hasFlag(sflags, 1)) {
          // Fensterachsen: Kachel = 2 x 2 Fenster; Gebäude über Weltposition entkoppelt
          vec2 cell = floor(vAuv * 2.0) + floor(vWorldPos.xz / 37.0) * 7.13;
          float h = hash12(cell);
          float lit = step(h, 0.52) * smoothstep(0.15, 0.6, uNight);
          vec3 wc = h < 0.1 ? vec3(1.0, 0.55, 0.85) : h < 0.18 ? vec3(0.55, 0.9, 1.0) : vec3(1.0, 0.78, 0.45);
          vec3 em = atlasSampleGrad(uAtlasE, sidx, vAuv, sdx, sdy).rgb;
          // knapp an der Bloom-Schwelle: Fenster glühen leicht, überstrahlen aber nicht
          totalEmissiveRadiance += em * wc * lit * 1.05;
        }
        if (hasFlag(sflags, 16)) {
          float h = hash12(floor(vWorldPos.xz / 3.0));
          float flick = h > 0.86 ? step(0.25, fract(sin(floor(uTime * 12.0) * 12.9898 + h * 78.233) * 43758.5453)) : 1.0;
          vec3 em = atlasSampleGrad(uAtlasE, sidx, vAuv, sdx, sdy).rgb * vColor;
          totalEmissiveRadiance += em * (0.25 + 2.4 * uNight * flick);
        }
      `)
      .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        if (hasFlag(sflags, 8)) {
          vec3 hsum = directionalLights[0].direction + normalize(vViewPosition);
            vec3 hdir = hsum / max(length(hsum), 1e-4); // kein NaN bei Nullvektor (-> Bloom-Flackern)
          float k = step(0.93, dot(normal, hdir));
          reflectedLight.directSpecular += directionalLights[0].color * k * 0.6;
        }
        #endif
      `)
      .replace('#include <opaque_fragment>', /* glsl */ `
        {
          vec3 lit = outgoingLight - totalEmissiveRadiance;
          if (hasFlag(sflags, 2)) {
            // Spiegelglas: Himmelsverlauf im reflektierten Blick + harte Glanzbänder
            vec3 wn = inverseTransformDirection(normal, viewMatrix);
            vec3 vd = normalize(vWorldPos - cameraPosition);
            vec3 r = reflect(vd, wn);
            vec3 sky = mix(uSkyHorizon, uSkyTop, clamp(abs(r.y) * 1.6, 0.0, 1.0));
            float band = step(0.93, fract(dot(vWorldPos, vec3(0.031, 0.017, 0.029)) + r.x * 0.4));
            lit = mix(lit, sky * (0.55 + 0.45 * (1.0 - uNight)), 0.5) + band * 0.25 * (1.0 - uNight);
          }
          lit = mix(lit, lit * vec3(0.62, 0.7, 1.08), uNight * 0.55);
          outgoingLight = lit + totalEmissiveRadiance;
        }
        #include <opaque_fragment>`);
    if (o.decal) shader.fragmentShader = '#define DECAL\n' + shader.fragmentShader;
    if (o.fade) {
      shader.uniforms.uFocus = U.uFocus;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FADE_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfadeDiscard(vWorldPos);');
    }
  };
  m.customProgramCacheKey = () => `surface:${o.decal ? 1 : 0}:${o.fade ? 1 : 0}`;
  return m;
}

/** Neonröhren: unbeleuchtet, nachts > 1.0 (-> Bloom), einzelne Röhren flackern. */
export function neonMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = U.uTime;
    shader.uniforms.uNight = U.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vWP;
        uniform float uTime;
        uniform float uNight;`)
      .replace('#include <opaque_fragment>', /* glsl */ `
        {
          float h = fract(sin(dot(floor(vWP.xz / 6.0), vec2(12.9898, 78.233))) * 43758.5453);
          float t = floor(uTime * 14.0);
          float flick = h > 0.82 ? mix(1.0, 0.25, step(0.7, fract(sin(t * 3.7 + h * 91.0) * 4375.85))) : 1.0;
          float buzz = 0.94 + 0.06 * sin(uTime * 40.0 + h * 20.0);
          outgoingLight *= mix(0.6, 2.6 * flick * buzz, uNight);
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'neon';
  return m;
}
