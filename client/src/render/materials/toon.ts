// Kern des Cel-Shading-Looks:
//   - globale Uniforms (Zeit, Nacht, Wind, Linienstärke, Himmelsfarben), von allen Shadern geteilt
//   - 3-stufige Gradient-Map für MeshToonMaterial
//   - toonMaterial(): Toon-Material mit optionalem Wind, Toon-Glanzlicht (harte Kante) und Nachttönung
//   - Umrisslinien per Inverted Hull: Rückseiten, im Bildschirmraum entlang geglätteter Normalen
//     verschoben -> konstante Pixelbreite, skaliert mit Zoom und Auflösung
import * as THREE from 'three';

// ------------------------------------------------------------------ globale Uniforms
export const U = {
  uTime: { value: 0 },
  /** 0 = Tag, 1 = tiefe Nacht. */
  uNight: { value: 0 },
  /** 0..1 Tageslicht-Stärke (für Hitzeflimmern, Glanzlinien). */
  uDay: { value: 1 },
  /** Linienstärke-Faktor (Zoom x Auflösung). */
  uOutlineScale: { value: 1 },
  uResolution: { value: new THREE.Vector2(1280, 720) },
  uSkyTop: { value: new THREE.Color(0x5cbcf2) },
  uSkyHorizon: { value: new THREE.Color(0x8ff2e0) },
  /** Nässe nach Regen (Pfützen) – Wetter kommt in M3, Wert ist schon vorbereitet. */
  uWet: { value: 0 },
  uWind: { value: 1 },
  /** Weltposition des Spielers: Gebäude zwischen Kamera und diesem Punkt werden ausgeblendet. */
  uFocus: { value: new THREE.Vector3(0, -1000, 0) },
};

/** Durchsicht-Dither: Fragmente nahe der Sichtlinie Kamera -> Spieler (und davor) werden zur Hälfte verworfen. */
export const FADE_PARS = /* glsl */ `
  uniform vec3 uFocus;
  float fadeAmount(vec3 wp) {
    vec3 ro = cameraPosition;
    vec3 rd = uFocus - ro;
    float L = length(rd);
    rd /= max(L, 1e-3);
    float t = dot(wp - ro, rd);
    float d = length(wp - (ro + rd * t));
    float front = smoothstep(L - 1.0, L - 4.0, t) * step(1.0, t); // nur zwischen Kamera und Spieler
    return front * (1.0 - smoothstep(3.0, 6.5, d)); // Radius um die Sichtlinie
  }
  void fadeDiscard(vec3 wp) {
    float a = fadeAmount(wp) * 0.55;
    if (a <= 0.0) return;
    // Interleaved-Gradient-Noise als Bildschirm-Dither
    float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (n < a) discard;
  }
`;

type Shader = THREE.WebGLProgramParametersWithUniforms;

function shareUniforms(shader: Shader, names: (keyof typeof U)[]) {
  for (const n of names) shader.uniforms[n] = U[n];
}

// ------------------------------------------------------------------ Gradient-Map
let gradient: THREE.DataTexture | null = null;
/** Drei Helligkeitsstufen: Schatten, Halbschatten, Licht. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([105, 105, 105, 255, 185, 185, 185, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

// ------------------------------------------------------------------ GLSL-Bausteine
/** Wind: Attribut `wind` (0 = starr, 1 = Blattspitze) + Weltposition -> Versatz. */
export const WIND_PARS = /* glsl */ `
  attribute float wind;
  uniform float uTime;
  uniform float uWind;
  vec3 windOffset(vec3 worldPos, float w) {
    float t = uTime * 1.6 + worldPos.x * 0.21 + worldPos.z * 0.17;
    float gust = 0.6 + 0.4 * sin(uTime * 0.37 + worldPos.x * 0.013);
    return vec3(sin(t), 0.0, cos(t * 0.83 + 1.3) * 0.7) * w * 0.22 * gust * uWind;
  }
`;
/** Nach <begin_vertex>: `transformed` im Objektraum verschieben (Instanzen beachten). */
export const WIND_VERTEX = /* glsl */ `
  {
    vec4 wp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp;
    #endif
    wp = modelMatrix * wp;
    vec3 off = windOffset(wp.xyz, wind);
    // Versatz ist in Welt-Metern; zurück in Objektmaßstab (gleichmäßige Skalierung angenommen)
    float s = length(modelMatrix[0].xyz);
    #ifdef USE_INSTANCING
      s *= length(instanceMatrix[0].xyz);
    #endif
    transformed += off / max(s, 1e-3);
  }
`;

// ------------------------------------------------------------------ Toon-Material
export interface ToonOptions {
  color?: number;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  alphaTest?: number;
  transparent?: boolean;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
  /** Vertex-Wind (Attribut `wind` muss vorhanden sein). */
  wind?: boolean;
  /** Hartes Toon-Glanzlicht: Schwelle (0.9 = kleiner Punkt) und Stärke. Attribut `shine` skaliert pro Vertex. */
  spec?: { threshold: number; strength: number; perVertex?: boolean };
  /** Nachts dunkler mit bläulichem Ton (0..1). */
  nightTint?: number;
  fog?: boolean;
}

export function toonMaterial(o: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    map: o.map ?? null,
    gradientMap: toonGradient(),
    alphaTest: o.alphaTest ?? 0,
    transparent: o.transparent ?? false,
    side: o.side ?? THREE.FrontSide,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    fog: o.fog ?? true,
  });
  const nightTint = o.nightTint ?? 0.5;
  const spec = o.spec;
  m.onBeforeCompile = (shader) => {
    shareUniforms(shader, ['uTime', 'uNight', 'uWind']);
    shader.uniforms.uNightTint = { value: nightTint };
    if (o.wind) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + WIND_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERTEX);
    }
    if (spec) {
      shader.uniforms.uSpecT = { value: spec.threshold };
      shader.uniforms.uSpecS = { value: spec.strength };
      if (spec.perVertex) {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float shine;\nvarying float vShine;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShine = shine;');
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uSpecT;\nuniform float uSpecS;\n${spec.perVertex ? 'varying float vShine;' : ''}`)
        .replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
          #if NUM_DIR_LIGHTS > 0
          {
            vec3 hsum = directionalLights[0].direction + normalize(vViewPosition);
            vec3 hdir = hsum / max(length(hsum), 1e-4); // kein NaN bei Nullvektor (-> Bloom-Flackern)
            float k = step(uSpecT, dot(normal, hdir));
            float sh = ${spec.perVertex ? 'vShine' : '1.0'};
            reflectedLight.directSpecular += directionalLights[0].color * k * uSpecS * sh;
            // zweite, weiche Kante (Rim) für Lackglanz von oben
            float rim = step(0.72, 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0));
            reflectedLight.indirectDiffuse += diffuseColor.rgb * rim * 0.18 * sh;
          }
          #endif`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uNightTint;')
      .replace('#include <opaque_fragment>', /* glsl */ `
        {
          vec3 lit = outgoingLight - totalEmissiveRadiance; // Leuchtflächen nicht abdunkeln
          outgoingLight = mix(lit, lit * vec3(0.62, 0.7, 1.08), uNight * uNightTint) + totalEmissiveRadiance;
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `toon:${o.wind ? 1 : 0}:${spec ? (spec.perVertex ? 2 : 1) : 0}`;
  return m;
}

// ------------------------------------------------------------------ Umrisslinien
export const OUTLINE_COLOR = 0x1e1230;
/** Linienstärke in Pixeln (bei 720p und Fußgänger-Zoom). Figuren dicker als Gebäude. */
export const LINE = { building: 1.5, prop: 1.3, tree: 1.4, vehicle: 2.1, character: 2.6 } as const;

const outlineCache = new Map<string, THREE.MeshBasicMaterial>();

/**
 * Inverted-Hull-Material. Erwartet das Attribut `outlineNormal` (geglättete Normalen, siehe
 * computeOutlineNormals) – sonst entstehen an harten Kanten Lücken.
 */
export function outlineMaterial(widthPx: number, opts: { wind?: boolean; color?: number; fade?: boolean } = {}): THREE.MeshBasicMaterial {
  const key = `${widthPx}:${opts.wind ? 1 : 0}:${opts.color ?? OUTLINE_COLOR}:${opts.fade ? 1 : 0}`;
  const hit = outlineCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshBasicMaterial({ color: opts.color ?? OUTLINE_COLOR, side: THREE.BackSide, fog: true });
  m.onBeforeCompile = (shader) => {
    shareUniforms(shader, ['uTime', 'uWind', 'uOutlineScale', 'uResolution']);
    shader.uniforms.uWidth = { value: widthPx };
    let vs = shader.vertexShader.replace('#include <common>', /* glsl */ `#include <common>
      attribute vec3 outlineNormal;
      uniform float uOutlineScale;
      uniform vec2 uResolution;
      uniform float uWidth;
      ${opts.wind ? WIND_PARS : ''}`);
    if (opts.wind) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERTEX);
    vs = vs.replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
      {
        vec3 on = outlineNormal;
        #ifdef USE_SKINNING
          on = (skinMatrix * vec4(on, 0.0)).xyz;
        #endif
        #ifdef USE_INSTANCING
          on = mat3(instanceMatrix) * on;
        #endif
        vec3 vn = normalize(mat3(modelViewMatrix) * on);
        vec2 d = (projectionMatrix * vec4(vn, 0.0)).xy;
        float l = length(d);
        if (l > 1e-4) {
          gl_Position.xy += (d / l) * (uWidth * uOutlineScale * 2.0 / uResolution) * gl_Position.w;
        }
        // Linie minimal nach hinten, damit sie nie vor der eigenen Fläche liegt
        gl_Position.z += 0.0004 * gl_Position.w;
      }`);
    // skinMatrix existiert nur, wenn skinnormal_vertex eingebunden ist -> erzwingen
    vs = vs.replace('#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )', '#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING ) || 1');
    if (opts.fade) {
      shader.uniforms.uFocus = U.uFocus;
      vs = vs
        .replace('#include <common>', '#include <common>\nvarying vec3 vFadePos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFadePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFadePos;\n' + FADE_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfadeDiscard(vFadePos);');
    }
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => `outline:${opts.wind ? 1 : 0}:${opts.fade ? 1 : 0}`;
  outlineCache.set(key, m);
  return m;
}

/**
 * Geglättete Normalen für die Umrisslinie: alle Vertices an derselben Position (1 cm Raster)
 * bekommen die gemittelte Normale. Funktioniert für indizierte und nicht indizierte Geometrie.
 */
export function computeOutlineNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getAttribute('outlineNormal')) return g;
  const pos = g.getAttribute('position');
  let nor = g.getAttribute('normal');
  if (!nor) { g.computeVertexNormals(); nor = g.getAttribute('normal'); }
  const n = pos.count;
  // offene Hash-Tabelle über quantisierte Positionen
  let cap = 1;
  while (cap < n * 2) cap <<= 1;
  const keys = new Int32Array(cap * 3);
  const slot = new Int32Array(cap).fill(-1);
  const sums: number[] = [];
  const group = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.round(pos.getX(i) * 100), y = Math.round(pos.getY(i) * 100), z = Math.round(pos.getZ(i) * 100);
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (cap - 1);
    while (slot[h] >= 0 && !(keys[h * 3] === x && keys[h * 3 + 1] === y && keys[h * 3 + 2] === z)) h = (h + 1) & (cap - 1);
    if (slot[h] < 0) {
      slot[h] = sums.length / 3;
      keys[h * 3] = x; keys[h * 3 + 1] = y; keys[h * 3 + 2] = z;
      sums.push(0, 0, 0);
    }
    const s = slot[h];
    group[i] = s;
    sums[s * 3] += nor.getX(i); sums[s * 3 + 1] += nor.getY(i); sums[s * 3 + 2] += nor.getZ(i);
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = group[i];
    let x = sums[s * 3], y = sums[s * 3 + 1], z = sums[s * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l < 1e-5) { x = nor.getX(i); y = nor.getY(i); z = nor.getZ(i); } else { x /= l; y /= l; z /= l; }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  g.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Konstantes Attribut (z. B. wind = 0 oder shine = 0), falls eine Geometrie es nicht mitbringt. */
export function ensureAttribute(g: THREE.BufferGeometry, name: string, value: number) {
  if (g.getAttribute(name)) return;
  const n = g.getAttribute('position').count;
  g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(value), 1));
}

/** Wind-Gewicht aus der Höhe: Stamm unten starr, Krone/Spitzen schwingen. */
export function addHeightWind(g: THREE.BufferGeometry, start = 0.35, strength = 1) {
  const pos = g.getAttribute('position');
  g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y, h = Math.max(1e-3, g.boundingBox!.max.y - y0);
  const w = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / h;
    // start >= 1 (z. B. Seerosen) = kein Wind; sonst 0/0 -> NaN, das der Bloom übers ganze Bild verteilt
    w[i] = start >= 1 ? 0 : Math.max(0, (t - start) / (1 - start)) ** 1.5 * strength * h * 0.25;
  }
  g.setAttribute('wind', new THREE.BufferAttribute(w, 1));
}

/** Hängt eine Umrisslinie an ein Mesh (gleiche Geometrie; Instanzen/Skelett werden geteilt). */
export function addOutline(mesh: THREE.Mesh, widthPx: number, opts: { wind?: boolean; fade?: boolean } = {}): THREE.Mesh {
  computeOutlineNormals(mesh.geometry);
  if (opts.wind) ensureAttribute(mesh.geometry, 'wind', 0);
  const mat = outlineMaterial(widthPx, opts);
  let hull: THREE.Mesh;
  if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
    const im = mesh as THREE.InstancedMesh;
    const h = new THREE.InstancedMesh(im.geometry, mat, im.instanceMatrix.count);
    h.instanceMatrix = im.instanceMatrix;
    h.count = im.count;
    h.boundingSphere = im.boundingSphere;
    hull = h;
  } else if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    const sm = mesh as THREE.SkinnedMesh;
    const h = new THREE.SkinnedMesh(sm.geometry, mat);
    h.bind(sm.skeleton, sm.bindMatrix);
    hull = h;
  } else {
    hull = new THREE.Mesh(mesh.geometry, mat);
  }
  hull.name = 'outline';
  hull.renderOrder = mesh.renderOrder;
  hull.frustumCulled = mesh.frustumCulled;
  hull.userData.outline = true;
  if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
    // SkinnedMesh: Hülle als Geschwister (gleicher Elternknoten, gleiche Transformation)
    hull.position.copy(mesh.position); hull.quaternion.copy(mesh.quaternion); hull.scale.copy(mesh.scale);
    mesh.parent?.add(hull);
  } else {
    mesh.add(hull);
  }
  return hull;
}
