// Lädt die freien CC0-Assets (Modelle + Sounds) aus GitHub-Repos nach
// client/public/assets/<quelle>/<kit>/. Commits sind fest gepinnt, damit jeder exakt
// dieselben Dateien bekommt. Bereits vorhandene Dateien werden übersprungen (--force lädt neu).
//
// Die Kenney-Kits aus spec.md 4.6 (City Kit Roads/Commercial/Suburban/Industrial, Car Kit,
// Watercraft, Blaster, Nature, Audio) und Quaternius Stylized Nature kommen aus dem Sammel-Repo
// series-ai/jam-ready-assets (Original-Packs inkl. License.txt, alle CC0). Dort liegen die
// Dateien in Git LFS -> Download über media.githubusercontent.com. Von glTF/GLB referenzierte
// Dateien (Texturen, .bin) werden automatisch mitgeladen.
//
// Aufruf:  npm run assets
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'assets');
const force = process.argv.includes('--force');

const gltf = (names) => names.flatMap((n) => [`${n}.gltf`, `${n}.bin`]);
const glb = (names) => names.map((n) => `${n}.glb`);
const range = (prefix, letters) => [...letters].map((l) => prefix + l);

const JRA = 'series-ai/jam-ready-assets';
const JRA_COMMIT = 'ab1b21fe61bc3adeb759c286e770033563f18a97';
/** Kenney-Kit aus dem Sammel-Repo: nur GLB-Modelle + Lizenz. */
const kenneyKit = (dest, pack, theme, models, sub = 'GLB format') => ({
  dest, repo: JRA, commit: JRA_COMMIT, lfs: true,
  base: `${pack}/3D/${theme}/Models/${sub}`,
  files: glb(models),
  extra: [[`${pack}/3D/${theme}/License.txt`, 'License.txt']],
});
const kenneyAudio = (dest, pack, names) => ({
  dest, repo: JRA, commit: JRA_COMMIT, lfs: true, base: `${pack}/audio/Audio`,
  files: names.map((n) => `${n}.ogg`),
  extra: [[`${pack}/audio/License.txt`, 'License.txt']],
});
const nums = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}_00${i}`);

/** Quelle -> Repo, Commit, Unterordner im Repo und Liste der Dateien. */
const SOURCES = [
  {
    dest: 'kaykit/city-builder-bits',
    repo: 'KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0',
    commit: '63976910ca04d16f0fc531b9c614244be8128713',
    base: 'addons/kaykit_city_builder_bits/Assets/gltf',
    files: [
      ...gltf([
        'building_A_withoutBase', 'building_B_withoutBase', 'building_C_withoutBase', 'building_D_withoutBase',
        'building_E_withoutBase', 'building_F_withoutBase', 'building_G_withoutBase', 'building_H_withoutBase',
        'car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi',
        'streetlight', 'trafficlight_A', 'firehydrant', 'bench', 'dumpster', 'trash_A', 'bush',
      ]),
      'citybits_texture.png',
    ],
    extra: [['addons/kaykit_city_builder_bits/Assets/LICENSE.txt', 'LICENSE.txt']],
  },
  {
    dest: 'kenney/starter-kit-city-builder',
    repo: 'KenneyNL/Starter-Kit-City-Builder',
    commit: '4535092b740b378b700efd9df9e27a631815b84a',
    base: '',
    files: [
      'models/building-small-a.glb', 'models/building-small-b.glb', 'models/building-small-c.glb',
      'models/building-small-d.glb', 'models/Textures/colormap.png',
      'sounds/ambience.ogg', 'sounds/toggle.ogg', 'sounds/placement-a.ogg',
    ],
  },
  {
    dest: 'kenney/starter-kit-racing',
    repo: 'KenneyNL/Starter-Kit-Racing',
    commit: '2f2e5f2646dda89cb21d4e8539bab60c6e955dc8',
    base: '',
    files: [
      'models/vehicle-motorcycle.glb', 'models/vehicle-truck-yellow.glb', 'models/vehicle-truck-red.glb',
      'models/Textures/colormap.png',
      'audio/engine.ogg', 'audio/engine-motorcycle.ogg', 'audio/impact.ogg', 'audio/skid.ogg',
    ],
  },
  // ---------------------------------------------------------------- Kenney-Kits (spec.md 4.6)
  kenneyKit('kenney/car-kit', 'kenney-car-kit', 'vehicles-racing', [
    'sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'police', 'ambulance',
    'firetruck', 'garbage-truck', 'delivery', 'van', 'truck', 'race',
  ]),
  kenneyKit('kenney/city-kit-commercial', 'kenney-city-kit-commercial', 'city', [
    ...range('building-', 'abcdefghijklmn'), ...range('building-skyscraper-', 'abcde'), 'detail-parasol-a', 'detail-parasol-b',
  ]),
  kenneyKit('kenney/city-kit-suburban', 'kenney-city-kit-suburban', 'city', [
    ...range('building-type-', 'abcdefghijklmnopqrstu'),
    'fence', 'planter',
  ]),
  kenneyKit('kenney/city-kit-industrial', 'kenney-city-kit-industrial', 'city', [
    ...range('building-', 'abcdefghijklmnopqrst'), 'chimney-large', 'chimney-medium', 'detail-tank',
  ]),
  kenneyKit('kenney/city-kit-roads', 'kenney-city-kit-roads', 'city', [
    'light-curved', 'construction-barrier', 'construction-cone', 'construction-light', 'sign-highway', 'sign-highway-wide',
  ]),
  kenneyKit('kenney/watercraft', 'kenney-watercraft-pack', 'vehicles-racing', [
    ...range('boat-speed-', 'abcdefghj'), 'boat-fan', 'boat-fishing-small', 'boat-row-small', 'boat-sail-a', 'boat-sail-b',
    'boat-tug-a', 'boat-tow-a', 'ship-cargo-a', 'ship-cargo-b', 'ship-large', 'ship-ocean-liner-small', 'buoy', 'buoy-flag',
    'cargo-container-a', 'cargo-container-b', 'cargo-container-c', 'cargo-pile-a', 'cargo-pile-b',
  ]),
  kenneyKit('kenney/blaster-kit', 'kenney-blaster-kit', 'space-scifi', [
    'blaster-b', 'blaster-d', 'blaster-e', 'blaster-f', 'blaster-h', 'crate-medium', 'crate-wide',
  ]),
  kenneyKit('kenney/nature-kit', 'kenney-nature-kit', 'nature', [
    'tree_palm', 'tree_palmBend', 'tree_palmShort', 'tree_palmTall', 'tree_palmDetailedShort', 'tree_palmDetailedTall',
    'tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'tree_pineRoundA', 'tree_pineRoundC', 'tree_pineTallA', 'tree_pineTallB',
    'plant_bush', 'plant_bushDetailed', 'plant_bushLarge', 'rock_largeA', 'rock_largeC', 'rock_tallA', 'rock_smallA',
    'flower_redA', 'flower_yellowA', 'flower_purpleA', 'grass', 'grass_large', 'cactus_tall', 'cactus_short',
  ], 'GLTF format'),
  kenneyAudio('kenney/impact-sounds', 'kenney-impact-sounds', [
    ...nums('footstep_concrete', 5), ...nums('footstep_grass', 5), ...nums('footstep_wood', 3),
    ...nums('impactPunch_heavy', 5), ...nums('impactPunch_medium', 3), ...nums('impactMetal_heavy', 5),
    ...nums('impactMetal_light', 3), ...nums('impactGlass_heavy', 3), ...nums('impactPlate_heavy', 3), ...nums('impactSoft_heavy', 3),
  ]),
  kenneyAudio('kenney/interface-sounds', 'kenney-interface-sounds', [
    'click_001', 'click_002', 'confirmation_001', 'confirmation_002', 'error_004', 'select_001', 'open_001', 'close_001',
    'drop_002', 'maximize_006', 'pluck_001', 'switch_002', 'tick_001',
  ]),
  // ---------------------------------------------------------------- Quaternius Stylized Nature
  // Landet unter assets/quaternius/ -> wird von client/src/render/quaternius.ts automatisch erkannt.
  {
    dest: 'quaternius/stylized-nature', repo: JRA, commit: JRA_COMMIT, lfs: true,
    base: 'quaternius-stylized-nature/3D/nature',
    files: [
      'CommonTree_3', 'CommonTree_4', 'Pine_1', 'Pine_2', 'TwistedTree_1', 'Bush_Common', 'Bush_Common_Flowers',
      'Fern_1', 'Plant_1', 'Plant_7', 'Flower_3_Group', 'Flower_4_Group', 'Grass_Common_Short', 'Grass_Common_Tall',
      'Grass_Wispy_Tall', 'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
    ].map((n) => `${n}.gltf`),
    extra: [['quaternius-stylized-nature/3D/nature/License.txt', 'License.txt']],
    // Normal-Maps braucht der Toon-Look nicht; Texturen werden auf 256 px verkleinert
    slim: true,
  },
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

let loaded = 0, skipped = 0;

/**
 * Verschlanken (nur bei `slim`): glTF ohne Normal-/Occlusion-Maps, PNGs max. 256 px (Flächenmittel).
 * Die Darstellung verkleinert ohnehin auf 64–128 px (quaternius.ts) – das spart viele MB Download.
 */
function slim(buf, file) {
  if (file.endsWith('.gltf')) {
    const j = JSON.parse(buf.toString('utf8'));
    for (const m of j.materials ?? []) { delete m.normalTexture; delete m.occlusionTexture; }
    // nur noch Bilder behalten, die von Materialien benutzt werden (sonst lädt sie keiner)
    const used = new Set();
    for (const m of j.materials ?? []) {
      for (const t of [m.pbrMetallicRoughness?.baseColorTexture, m.emissiveTexture]) if (t) used.add(j.textures[t.index].source);
    }
    (j.images ?? []).forEach((im, i) => { if (!used.has(i)) im.uri = 'data:image/png;base64,'; });
    return Buffer.from(JSON.stringify(j));
  }
  if (file.endsWith('.png')) {
    const src = PNG.sync.read(buf);
    // *_C.png sind Farbmasken (rot), gedacht zum Tönen per Shader -> Graustufen, dann färbt die
    // Vertex-/Materialfarbe sie (sonst werden Büsche und Kiefern dunkelrot)
    if (/_C\.png$/.test(file)) {
      for (let i = 0; i < src.data.length; i += 4) {
        const v = Math.min(255, Math.round(Math.max(src.data[i], src.data[i + 1], src.data[i + 2]) * 1.45));
        src.data[i] = src.data[i + 1] = src.data[i + 2] = v;
      }
    }
    const k = Math.min(1, 256 / Math.max(src.width, src.height));
    if (k >= 1) return PNG.sync.write(src);
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const out = new PNG({ width: w, height: h });
    const fx = src.width / w, fy = src.height / h;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy += 2) for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx += 2) {
        const o = (sy * src.width + sx) * 4;
        const a = src.data[o + 3];
        // Farbe mit Alpha gewichten, sonst färben transparente Pixel die Blattkanten dunkel
        for (let c = 0; c < 3; c++) acc[c] += src.data[o + c] * a;
        acc[3] += a;
        n++;
      }
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out.data[o + c] = acc[3] ? Math.round(acc[c] / acc[3]) : 0;
      out.data[o + 3] = Math.round(acc[3] / Math.max(1, n));
    }
    return PNG.sync.write(out);
  }
  return buf;
}

/** Externe Verweise (Texturen, .bin) aus .gltf (JSON) oder .glb (JSON-Chunk). */
function references(buf, file) {
  let json;
  try {
    if (file.endsWith('.glb')) {
      if (buf.readUInt32LE(0) !== 0x46546c67) return [];
      const len = buf.readUInt32LE(12);
      json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
    } else if (file.endsWith('.gltf')) json = JSON.parse(buf.toString('utf8'));
    else return [];
  } catch { return []; }
  return [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri).filter((u) => u && !u.startsWith('data:')).map(decodeURIComponent);
}

async function download(src, remote, local) {
  const out = join(ROOT, src.dest, local);
  let buf;
  if (!force && (await exists(out))) { skipped++; buf = await readFile(out); }
  else {
    const path = `${src.repo}/${src.commit}/${remote.split('/').map(encodeURIComponent).join('/')}`;
    // LFS-Dateien über media.*, normale Dateien (Lizenztexte) liefert media.* nicht -> raw.*
    let url = `${src.lfs ? 'https://media.githubusercontent.com/media' : 'https://raw.githubusercontent.com'}/${path}`;
    let res = await fetch(url);
    if (res.status === 404 && src.lfs) res = await fetch((url = `https://raw.githubusercontent.com/${path}`));
    if (!res.ok) throw new Error(`${res.status} beim Laden von ${url}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.subarray(0, 40).toString().startsWith('version https://git-lfs')) throw new Error(`LFS-Zeiger statt Datei: ${url}`);
    if (src.slim) buf = slim(buf, local);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, buf);
    loaded++;
    console.log(`  ${src.dest}/${local}`);
  }
  // referenzierte Dateien (relativ zur Modelldatei) mitnehmen
  for (const ref of references(buf, local)) {
    const r = posix.join(posix.dirname(remote), ref), l = posix.join(posix.dirname(local), ref);
    if (!seen.has(src.dest + '/' + l)) { seen.add(src.dest + '/' + l); await download(src, r, l); }
  }
}

const seen = new Set();
for (const src of SOURCES) {
  const jobs = [
    ...src.files.map((f) => [src.base ? `${src.base}/${f}` : f, f]),
    ...(src.extra ?? []),
  ];
  // in kleinen Gruppen parallel
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(([remote, local]) => {
      seen.add(src.dest + '/' + local);
      return download(src, remote, local);
    }));
  }
}
console.log(`Assets: ${loaded} geladen, ${skipped} schon vorhanden.`);
