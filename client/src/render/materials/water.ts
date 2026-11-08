// Toon-Wasser: Farbe nach Tiefe und Gewässertyp (türkises Flachwasser mit durchscheinendem
// Sandgrund, Tiefwasser blau, Hafen grünlich, Sumpf braun-grün), harter heller Schaumrand an
// Küsten und um Stege, animierte Glanzlinien. Alles aus einer kleinen Daten-Textur über die Welt.
import * as THREE from 'three';
import { WORLD_SIZE } from '../../../../shared/src/constants';
import { Tile } from '../../../../shared/src/world/tiles';
import { Zone, type WorldMap } from '../../../../shared/src/world/WorldMap';
import { noiseTexture } from './surface';
import { U } from './toon';

const RES = 512; // 4 m pro Texel
const MAX_DEPTH = 6;
const MAX_SHORE = 40;

/** R = Tiefe, G = Abstand zum Ufer, B = Hafen-Anteil, A = Sumpf-Anteil. */
export function buildWaterInfo(map: WorldMap): THREE.DataTexture {
  const step = WORLD_SIZE / RES;
  const land = new Uint8Array(RES * RES);
  const harbor = new Uint8Array(RES * RES), swamp = new Uint8Array(RES * RES), depth = new Uint8Array(RES * RES);
  const portStyles = new Set(['port', 'industrial']);
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const x = (i + 0.5) * step, z = (j + 0.5) * step;
      const t = map.tileAt(x, z);
      const k = j * RES + i;
      const isWater = t === Tile.WATER || t === Tile.SWAMP || t === Tile.BRIDGE;
      land[k] = isWater ? 0 : 1;
      if (t === Tile.SWAMP || map.zoneAt(x, z) === Zone.GatorFlats) swamp[k] = 255;
      if (map.zoneAt(x, z) === Zone.PortCoralia) {
        const d = map.districtAt(x, z);
        if (d && portStyles.has(d.style)) harbor[k] = 255;
      }
      const h = map.terrainHeight(x, z);
      depth[k] = Math.round(Math.min(1, Math.max(0, -h) / MAX_DEPTH) * 255);
    }
  }
  // Abstand zum Ufer (Chamfer-Distanztransformation, in Texeln)
  const INF = 1e6;
  const dist = new Float32Array(RES * RES);
  for (let k = 0; k < dist.length; k++) dist[k] = land[k] ? 0 : INF;
  const pass = (fwd: boolean) => {
    const offs = fwd ? [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]] : [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
    for (let jj = 0; jj < RES; jj++) {
      const j = fwd ? jj : RES - 1 - jj;
      for (let ii = 0; ii < RES; ii++) {
        const i = fwd ? ii : RES - 1 - ii;
        let d = dist[j * RES + i];
        for (const [dx, dz, w] of offs) {
          const x = i + dx, z = j + dz;
          if (x < 0 || z < 0 || x >= RES || z >= RES) continue;
          d = Math.min(d, dist[z * RES + x] + w);
        }
        dist[j * RES + i] = d;
      }
    }
  };
  pass(true); pass(false);
  // Hafen/Sumpf-Anteile weich ausblenden (Box-Blur)
  const blur = (a: Uint8Array, r: number) => {
    const out = new Uint8Array(a.length);
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      let s = 0, n = 0;
      for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) {
        const x = i + dx, z = j + dz;
        if (x < 0 || z < 0 || x >= RES || z >= RES) continue;
        s += a[z * RES + x]; n++;
      }
      out[j * RES + i] = s / n;
    }
    return out;
  };
  const hb = blur(harbor, 6), sb = blur(swamp, 4);
  const data = new Uint8Array(RES * RES * 4);
  for (let k = 0; k < RES * RES; k++) {
    data[k * 4] = depth[k];
    data[k * 4 + 1] = Math.round(Math.min(1, (dist[k] * step) / MAX_SHORE) * 255);
    data[k * 4 + 2] = hb[k];
    data[k * 4 + 3] = sb[k];
  }
  const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

export function waterMaterial(info: THREE.DataTexture) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uInfo: { value: info },
    uNoise: { value: noiseTexture() },
    uWorld: { value: WORLD_SIZE },
    uLight: { value: new THREE.Color(1, 1, 1) },
  }]);
  // geteilte Werte als Referenz (merge kopiert sonst)
  uniforms.uInfo.value = info;
  uniforms.uNoise.value = noiseTexture();
  Object.assign(uniforms, { uTime: U.uTime, uNight: U.uNight, uDay: U.uDay, uSkyTop: U.uSkyTop, uSkyHorizon: U.uSkyHorizon });
  const m = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWP;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uInfo;
      uniform sampler2D uNoise;
      uniform float uWorld;
      uniform float uTime;
      uniform float uNight;
      uniform float uDay;
      uniform vec3 uLight;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      varying vec3 vWP;
      void main() {
        vec4 info = texture2D(uInfo, vWP.xz / uWorld);
        float depth = info.r * ${MAX_DEPTH.toFixed(1)};
        float shore = info.g * ${MAX_SHORE.toFixed(1)};
        float n = texture2D(uNoise, vWP.xz * 0.02 + vec2(uTime * 0.01, 0.0)).r;
        float n2 = texture2D(uNoise, vWP.xz * 0.06 - vec2(0.0, uTime * 0.015)).g;

        // Grundfarben (sRGB-nah, gestuft)
        vec3 sandFloor = vec3(0.86, 0.85, 0.62);
        vec3 shallow = vec3(0.16, 0.86, 0.80);
        vec3 deep = vec3(0.10, 0.36, 0.66);
        vec3 harbor = vec3(0.20, 0.52, 0.46);
        vec3 swamp = vec3(0.30, 0.36, 0.20);
        // Tiefe in 3 Stufen (Toon) – Sandgrund scheint im Flachen durch
        float d = depth + (n - 0.5) * 0.8;
        float band = d < 0.9 ? 0.0 : d < 2.4 ? 0.5 : 1.0;
        vec3 col = mix(mix(sandFloor, shallow, 0.55), shallow, smoothstep(0.0, 0.5, band));
        col = mix(col, deep, smoothstep(0.5, 1.0, band) * smoothstep(2.0, 5.0, d));
        col = mix(col, harbor, info.b * 0.85);
        col = mix(col, swamp, info.a * 0.9);
        // Glanzlinien: wandernde, harte Streifen
        float g = sin(vWP.x * 0.22 + sin(vWP.z * 0.09 + uTime * 0.5) * 2.2 + uTime * 0.9) * 0.5 + 0.5;
        float glint = step(0.965, g) * step(0.45, n2) * (1.0 - info.a * 0.7);
        col += glint * mix(vec3(0.55, 0.6, 0.55), vec3(0.6, 0.35, 0.8), uNight) * (0.35 + 0.65 * uDay);
        col = pow(col, vec3(2.2)); // oben in sRGB gedacht -> linear
        // Himmel spiegelt sich leicht
        col = mix(col, uSkyHorizon, 0.12);
        col *= uLight;
        // Schaumrand: zwei Linien, die rhythmisch zum Ufer laufen; Sumpf ohne Brandung
        float wob = (n2 - 0.5) * 1.6;
        float pulse = sin(uTime * 1.3 - shore * 0.6) * 0.5 + 0.5;
        float foam = step(shore + wob, 1.4 + pulse * 0.9);
        float foam2 = step(abs(shore + wob - (3.2 + pulse * 2.0)), 0.35) * step(0.4, n);
        foam = max(foam, foam2 * 0.8) * (1.0 - info.a * 0.75);
        vec3 foamCol = pow(mix(vec3(0.97, 0.97, 0.94), vec3(0.55, 0.55, 0.75), uNight * 0.7), vec3(2.2)) * max(uLight, vec3(0.35));
        col = mix(col, foamCol, foam);
        // Seerosen-/Algenschimmer im Sumpf
        col = mix(col, col * vec3(0.8, 1.05, 0.7), info.a * step(0.62, n) * 0.6);
        float alpha = mix(0.82, 0.95, smoothstep(0.5, 3.0, depth)) ;
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  return m;
}
