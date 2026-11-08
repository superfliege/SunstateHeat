// Lädt die freien CC0-Assets (Modelle + Sounds) aus den offiziellen GitHub-Repos
// nach client/public/assets/<quelle>/<kit>/. Commits sind fest gepinnt, damit
// jeder exakt dieselben Dateien bekommt. Bereits vorhandene Dateien werden
// übersprungen (mit --force neu laden).
//
// Aufruf:  npm run assets
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'public', 'assets');
const force = process.argv.includes('--force');

const gltf = (names) => names.flatMap((n) => [`${n}.gltf`, `${n}.bin`]);

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
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

let loaded = 0, skipped = 0;
for (const src of SOURCES) {
  const jobs = [
    ...src.files.map((f) => [src.base ? `${src.base}/${f}` : f, f]),
    ...(src.extra ?? []),
  ];
  for (const [remote, local] of jobs) {
    const out = join(ROOT, src.dest, local);
    if (!force && (await exists(out))) { skipped++; continue; }
    const url = `https://raw.githubusercontent.com/${src.repo}/${src.commit}/${remote}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} beim Laden von ${url}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    loaded++;
    console.log(`  ${src.dest}/${local}`);
  }
}
console.log(`Assets: ${loaded} geladen, ${skipped} schon vorhanden.`);
