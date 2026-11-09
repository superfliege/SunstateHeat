// Audio-Pipeline: Rohdateien (assets-src/audio/<quelle>/…) → spielfertige Dateien in client/public/audio/
//
//   npm run audio              verarbeiten (nur Geändertes, Cache in client/public/audio/.cache.json)
//   npm run audio -- --force   alles neu
//   npm run audio -- --scan    sichten: alle Rohdateien mit Dauer/Kanälen/Lautheit, Vorschläge zu
//                              passenden Manifest-Einträgen, fehlende Dateien → assets-src/audio/_scan.md
//   npm run audio -- --credits nur den Audio-Abschnitt in CREDITS.md neu erzeugen
//
// Ablauf je Datei (Einstellungen aus client/src/audio/manifest.ts):
//   1. ffmpeg: dekodieren, zuschneiden (start/dur), 48 kHz, Mono (3D-Effekte) bzw. Stereo (Musik/Ambience)
//   2. Effekte: Stille am Anfang/Ende entfernen; Loops: Naht überblenden (loopXfade)
//   3. Lautheit nach ITU BS.1770 messen und auf das Ziel des Busses bringen (Effekte -16, Ambience -24,
//      Musik -18 LUFS), Spitzen auf -1 dBFS begrenzen
//   4. OGG/Opus + AAC (.m4a, Fallback für Safari); kurze Effekte mit gleichem `sprite` landen in einem
//      gemeinsamen Audio-Sprite (weniger Requests), Loops/Streams als Einzeldateien
//   5. client/public/audio/index.json (id → Datei/Ausschnitt), CREDITS.md-Abschnitt aus den Lizenzen
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LICENSES, LOUDNESS, SOUNDS, type LicenseId, type SoundDef, type SoundFile } from '../client/src/audio/manifest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Rohdaten-Ordner (der zweite für die in der Aufgabe genannte Struktur packages/client/…) */
const SRC_DIRS = [join(ROOT, 'assets-src', 'audio'), join(ROOT, 'packages', 'client', 'assets-src', 'audio')];
const OUT = join(ROOT, 'client', 'public', 'audio');
const TMP = join(ROOT, 'node_modules', '.cache', 'sunstate-audio');
const CREDITS = join(ROOT, 'CREDITS.md');
const SR = 48000;
const SPRITE_GAP = 0.25; // s Stille zwischen Sprite-Einträgen
const INITIAL_BUDGET = 3 * 1024 * 1024; // Spec: initialer Audio-Download < 3 MB
const AUDIO_EXT = /\.(wav|ogg|oga|opus|mp3|flac|aiff?|m4a|wma)$/i;

const args = new Set(process.argv.slice(2));

// ------------------------------------------------------------------ Hilfen
function findSrc(rel: string): string | null {
  for (const d of SRC_DIRS) { const p = join(d, rel); if (existsSync(p)) return p; }
  return null;
}
function ff(argv: string[]) { return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { maxBuffer: 1 << 30 }); }
function probe(file: string): { dur: number; ch: number; sr: number } {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate:format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  return { dur: Number(j.format?.duration ?? 0), ch: Number(j.streams?.[0]?.channels ?? 0), sr: Number(j.streams?.[0]?.sample_rate ?? 0) };
}

/** Dekodieren (+ Zuschnitt, Resampling, Kanäle) → interleaved Float32 */
function decode(file: string, ch: number, start?: number, dur?: number): Float32Array {
  const a = [...(start ? ['-ss', String(start)] : []), ...(dur ? ['-t', String(dur)] : []), '-i', file, '-ac', String(ch), '-ar', String(SR), '-f', 'f32le', '-'];
  const buf = ff(a);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Stille am Anfang/Ende entfernen (Schwelle -50 dBFS, kleine Ränder bleiben). */
function trimSilence(d: Float32Array, ch: number): Float32Array {
  const thr = Math.pow(10, -50 / 20), frames = d.length / ch;
  let a = 0, b = frames - 1;
  const loud = (f: number) => { for (let c = 0; c < ch; c++) if (Math.abs(d[f * ch + c]) > thr) return true; return false; };
  while (a < frames && !loud(a)) a++;
  while (b > a && !loud(b)) b--;
  a = Math.max(0, a - Math.round(SR * 0.005)); b = Math.min(frames - 1, b + Math.round(SR * 0.03));
  const out = d.slice(a * ch, (b + 1) * ch);
  const fo = Math.min(Math.round(SR * 0.01), out.length / ch); // kurzes Ausblenden gegen Knacken
  for (let i = 0; i < fo; i++) for (let c = 0; c < ch; c++) out[out.length - (i + 1) * ch + c] *= i / fo;
  return out;
}

/** Loop-Naht: das Ende über den Anfang blenden (equal power). */
function loopify(d: Float32Array, ch: number, xf: number): Float32Array {
  const frames = d.length / ch, x = Math.min(Math.round(xf * SR), Math.floor(frames / 3));
  if (x < 2) return d;
  const n = frames - x, out = d.slice(0, n * ch);
  for (let i = 0; i < x; i++) {
    const t = i / x, a = Math.sqrt(t), b = Math.sqrt(1 - t);
    for (let c = 0; c < ch; c++) out[i * ch + c] = d[i * ch + c] * a + d[(n + i) * ch + c] * b;
  }
  return out;
}

/** Integrierte Lautheit nach ITU-R BS.1770-4 (K-Filter, 400-ms-Blöcke, Gates -70/-10). */
export function lufs(d: Float32Array, ch: number): number {
  // K-Filter-Koeffizienten für 48 kHz
  const s1 = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] };
  const s2 = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] };
  const frames = d.length / ch;
  const sq = new Float64Array(frames);
  for (let c = 0; c < ch; c++) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < frames; i++) {
      const x = d[i * ch + c];
      const y = s1.b[0] * x + s1.b[1] * x1 + s1.b[2] * x2 - s1.a[0] * y1 - s1.a[1] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const z = s2.b[0] * y + s2.b[1] * u1 + s2.b[2] * u2 - s2.a[0] * z1 - s2.a[1] * z2;
      u2 = u1; u1 = y; z2 = z1; z1 = z;
      sq[i] += z * z;
    }
  }
  const block = Math.round(SR * 0.4), hop = Math.round(SR * 0.1);
  const blocks: number[] = [];
  if (frames < block) { let s = 0; for (let i = 0; i < frames; i++) s += sq[i]; blocks.push(s / Math.max(1, frames)); }
  else for (let st = 0; st + block <= frames; st += hop) { let s = 0; for (let i = st; i < st + block; i++) s += sq[i]; blocks.push(s / block); }
  const L = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const abs = blocks.filter((m) => L(m) > -70);
  if (!abs.length) return -Infinity;
  const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((m) => L(m) > rel);
  return L(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Auf Ziel-LUFS bringen, Spitzen auf -1 dBFS begrenzen. Liefert die erreichte Lautheit. */
function normalize(d: Float32Array, ch: number, target: number): number {
  const m = lufs(d, ch);
  if (!Number.isFinite(m)) return m;
  let g = Math.pow(10, (target - m) / 20);
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const ceil = Math.pow(10, -1 / 20);
  if (peak * g > ceil) g = ceil / peak;
  for (let i = 0; i < d.length; i++) d[i] *= g;
  return m + 20 * Math.log10(g);
}

/** Roh-PCM als OGG/Opus + AAC schreiben; liefert die Dateigrößen. */
function encode(d: Float32Array, ch: number, outBase: string, music: boolean): { ogg: number; m4a: number } {
  mkdirSync(dirname(outBase), { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const raw = join(TMP, `${createHash('sha1').update(outBase).digest('hex')}.raw`);
  writeFileSync(raw, Buffer.from(d.buffer, d.byteOffset, d.byteLength));
  const inp = ['-f', 'f32le', '-ar', String(SR), '-ac', String(ch), '-i', raw];
  const kbps = music ? (ch > 1 ? 128 : 96) : ch > 1 ? 96 : 56;
  ff([...inp, '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-application', 'audio', `${outBase}.ogg`]);
  ff([...inp, '-c:a', 'aac', '-b:a', `${Math.round(kbps * 1.4)}k`, '-movflags', '+faststart', `${outBase}.m4a`]);
  rmSync(raw, { force: true });
  return { ogg: statSync(`${outBase}.ogg`).size, m4a: statSync(`${outBase}.m4a`).size };
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase();

// ------------------------------------------------------------------ Verarbeitung
interface IndexEntry { f: string; o?: number; d?: number; rpm?: number }
interface Prepared { def: SoundDef; file: SoundFile; pcm: Float32Array; ch: number; measured: number; reached: number }

function prepare(def: SoundDef, file: SoundFile): Prepared | null {
  const path = findSrc(file.src!);
  if (!path) { console.warn(`  fehlt: ${file.src} (${def.id}) – prozeduraler Ersatz bleibt aktiv`); return null; }
  const ch = def.stereo ? 2 : 1;
  let pcm = decode(path, ch, file.start, file.dur);
  if (def.kind === 'oneshot') pcm = trimSilence(pcm, ch);
  if (def.kind === 'loop') pcm = loopify(pcm, ch, def.loopXfade ?? 0.05);
  const measured = lufs(pcm, ch);
  const reached = normalize(pcm, ch, LOUDNESS[def.bus]);
  return { def, file, pcm, ch, measured, reached };
}

function processAll() {
  mkdirSync(OUT, { recursive: true });
  const cacheFile = join(OUT, '.cache.json');
  const oldCache: Record<string, { key: string; entries: IndexEntry[] }> = !args.has('--force') && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const cache: typeof oldCache = {};
  const index: Record<string, IndexEntry[]> = {};
  const sprites = new Map<string, SoundDef[]>();
  let initialBytes = 0, total = 0;
  const sizeOf = (f: string) => { const p = join(OUT, `${f}.ogg`); return existsSync(p) ? statSync(p).size : 0; };

  /** Cache-Schlüssel: Manifest-Eintrag + Größe/Datum aller Quelldateien */
  const keyOf = (defs: SoundDef[]) => createHash('sha1').update(JSON.stringify(defs.map((d) => [d, d.files.map((f) => {
    const p = f.src ? findSrc(f.src) : null;
    if (!p) return null;
    const st = statSync(p); return [st.size, st.mtimeMs];
  })]))).digest('hex');

  for (const def of SOUNDS) {
    const srcFiles = def.files.filter((f) => f.src);
    if (!srcFiles.length) continue;
    if (def.kind === 'oneshot' && def.sprite) { const l = sprites.get(def.sprite) ?? []; l.push(def); sprites.set(def.sprite, l); continue; }
    const key = keyOf([def]);
    const ck = `sound:${def.id}`;
    if (oldCache[ck]?.key === key && oldCache[ck].entries.every((e) => existsSync(join(OUT, `${e.f}.ogg`)))) {
      cache[ck] = oldCache[ck]; index[def.id] = oldCache[ck].entries;
    } else {
      console.log(`• ${def.id}`);
      const entries: IndexEntry[] = [];
      srcFiles.forEach((file, i) => {
        const p = prepare(def, file);
        if (!p) return;
        const f = `${def.kind === 'stream' ? 'stream' : 'sfx'}/${slug(def.id)}${srcFiles.length > 1 ? `_${i}` : ''}`;
        const sz = encode(p.pcm, p.ch, join(OUT, f), def.bus === 'music');
        console.log(`    ${file.src}: ${p.measured.toFixed(1)} → ${p.reached.toFixed(1)} LUFS, ${(p.pcm.length / p.ch / SR).toFixed(2)} s, ${(sz.ogg / 1024).toFixed(0)} KB`);
        entries.push({ f, ...(file.rpm ? { rpm: file.rpm } : {}) });
      });
      if (entries.length) { index[def.id] = entries; cache[ck] = { key, entries }; }
    }
    for (const e of index[def.id] ?? []) { const s = sizeOf(e.f); total += s; if (!def.zones && def.kind !== 'stream') initialBytes += s; }
  }

  for (const [name, defs] of sprites) {
    const key = keyOf(defs);
    const ck = `sprite:${name}`;
    const f = `sprites/${slug(name)}`;
    if (oldCache[ck]?.key === key && existsSync(join(OUT, `${f}.ogg`))) {
      cache[ck] = oldCache[ck];
    } else {
      console.log(`• Sprite ${name} (${defs.length} Sounds)`);
      const parts: Float32Array[] = [];
      const entries: (IndexEntry & { id: string })[] = [];
      let pos = SPRITE_GAP;
      for (const def of defs) for (const file of def.files.filter((x) => x.src)) {
        const p = prepare(def, file);
        if (!p) continue;
        const dur = p.pcm.length / SR;
        parts.push(p.pcm);
        entries.push({ id: def.id, f, o: Number(pos.toFixed(4)), d: Number(dur.toFixed(4)) });
        pos += dur + SPRITE_GAP;
      }
      const all = new Float32Array(Math.round(pos * SR) + 16);
      let o = Math.round(SPRITE_GAP * SR);
      for (const p of parts) { all.set(p, o); o += p.length + Math.round(SPRITE_GAP * SR); }
      if (entries.length) {
        const sz = encode(all, 1, join(OUT, f), false);
        console.log(`    ${(pos).toFixed(1)} s, ${(sz.ogg / 1024).toFixed(0)} KB`);
        cache[ck] = { key, entries };
      }
    }
    for (const e of (cache[ck]?.entries ?? []) as (IndexEntry & { id: string })[]) (index[e.id] ??= []).push({ f: e.f, o: e.o, d: e.d });
    const s = sizeOf(f); total += s;
    if (defs.some((d) => !d.zones)) initialBytes += s;
  }

  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ version: 1, formats: ['ogg', 'm4a'], sounds: index }, null, 0));
  writeFileSync(cacheFile, JSON.stringify(cache));
  console.log(`\nindex.json: ${Object.keys(index).length} Sounds · gesamt ${(total / 1024).toFixed(0)} KB (OGG) · initial ${(initialBytes / 1024).toFixed(0)} KB`);
  if (initialBytes > INITIAL_BUDGET) console.warn(`⚠ Initialer Audio-Download über 3 MB – Sounds per zones/stream auslagern!`);
  const procOnly = SOUNDS.filter((d) => !index[d.id] && !d.files.some((f) => f.asset) && d.proc).length;
  console.log(`${procOnly} Einträge klingen (noch) prozedural.`);
}

// ------------------------------------------------------------------ Lizenzprüfung + CREDITS.md
function checkLicenses() {
  let ok = true;
  for (const def of SOUNDS) for (const f of def.files) {
    if (!LICENSES[f.license]) { console.error(`✗ ${def.id}: unbekannte Lizenz ${f.license}`); ok = false; }
    if (f.src && !LICENSES[f.license].redistributable && !/^(sonniss|pixabay)\//.test(f.src))
      console.warn(`⚠ ${def.id}: ${f.src} (${f.license}) liegt nicht in einem per .gitignore ausgeschlossenen Ordner (sonniss/, pixabay/)`);
    if (f.src && f.license === 'freesound-cc0' && !f.url) console.warn(`⚠ ${def.id}: Freesound-Datei ohne url – bitte Link zum CC0-Eintrag angeben`);
  }
  return ok;
}

function writeCredits() {
  const by = new Map<LicenseId, Map<string, { ids: Set<string>; author?: string; url?: string }>>();
  const idxFile = join(OUT, 'index.json');
  const built: Record<string, unknown> = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, 'utf8')).sounds ?? {} : {};
  for (const def of SOUNDS) for (const f of def.files) {
    const name = f.src ? `assets-src/audio/${f.src}` : `client/public/assets/${f.asset}`;
    if (f.src && !findSrc(f.src) && !built[def.id]) continue; // nur tatsächlich verwendete Rohdateien
    const m = by.get(f.license) ?? new Map();
    const e = m.get(name) ?? { ids: new Set<string>(), author: f.author, url: f.url };
    e.ids.add(def.id);
    m.set(name, e);
    by.set(f.license, m);
  }
  const procCount = SOUNDS.filter((d) => d.proc).length;
  let md = '<!-- audio-credits:start (automatisch erzeugt von scripts/process-audio.ts – nicht von Hand ändern) -->\n';
  md += '## Audio\n\n';
  md += `Alle Sounds sind in \`client/src/audio/manifest.ts\` mit Quelle und Lizenz erfasst. ${procCount} Einträge haben zusätzlich einen\n`;
  md += 'prozeduralen Ersatz (Web Audio, `client/src/audio/procedural.ts`), der klingt, solange keine Datei vorliegt.\n';
  md += 'Rohdateien ohne Weitergaberecht (Sonniss, Pixabay) liegen nicht im Repository (`.gitignore`).\n\n';
  for (const [lic, files] of by) {
    const L = LICENSES[lic];
    md += `### ${L.name}\n\n- **Lizenz/Quelle:** ${L.url} – ${L.note}\n`;
    for (const [name, e] of [...files].sort()) {
      md += `- \`${name}\`${e.author ? ` – ${e.author}` : ''}${e.url ? ` (${e.url})` : ''} → ${[...e.ids].join(', ')}\n`;
    }
    md += '\n';
  }
  md += '<!-- audio-credits:end -->';
  let text = existsSync(CREDITS) ? readFileSync(CREDITS, 'utf8') : '# Credits\n';
  const re = /<!-- audio-credits:start[\s\S]*?<!-- audio-credits:end -->/;
  text = re.test(text) ? text.replace(re, md) : `${text.trimEnd()}\n\n${md}\n`;
  writeFileSync(CREDITS, text);
  console.log('CREDITS.md: Audio-Abschnitt aktualisiert.');
}

// ------------------------------------------------------------------ Sichten
/** Stichwörter im Dateinamen → passende Manifest-Einträge (nur Vorschläge). */
const HINTS: [RegExp, string][] = [
  [/idle/i, 'veh.engine.<klasse>.idle.on'], [/(engine|motor).*(low|1st|slow)/i, 'veh.engine.<klasse>.low.on'],
  [/(engine|motor).*(mid|cruise)/i, 'veh.engine.<klasse>.mid.on'], [/(engine|motor).*(high|rev|redline|fast)/i, 'veh.engine.<klasse>.high.on'],
  [/(decel|coast|off.?load|overrun)/i, 'veh.engine.<klasse>.*.off'], [/(skid|squeal|screech)/i, 'veh.tire.squeal'],
  [/gravel/i, 'veh.roll.gravel'], [/(asphalt|road.?noise|tyre.?roll|tire.?roll)/i, 'veh.roll.asphalt'],
  [/(crash|impact|collision).*(car|vehicle|metal)/i, 'veh.crash.metal'], [/glass/i, 'veh.crash.glass'],
  [/(debris|rubble)/i, 'veh.crash.debris'], [/scrape/i, 'veh.scrape'], [/(backfire|pop)/i, 'veh.backfire'],
  [/(blow.?off|bov)/i, 'veh.turbo.bov'], [/air.?brake/i, 'veh.airbrake'], [/(explosion|explode)/i, 'veh.explosion'],
  [/(fire|burn)/i, 'veh.dmg.fire'], [/(hiss|steam)/i, 'veh.dmg.hiss'], [/siren/i, '(Sirene – derzeit Synthese)'],
  [/horn/i, '(Hupe – derzeit Synthese)'], [/airboat|propell/i, 'veh.prop.airboat'], [/(boat|outboard)/i, 'veh.engine.boat.*'],
  [/(motorcycle|motorbike|bike)/i, 'veh.engine.bike.*'], [/(truck|diesel|lorry)/i, 'veh.engine.truck.*'],
  [/(gull|seagull|möwe)/i, 'Phase 2: Ocean Strip'], [/(cicada|zikade|frog|frosch|gator|alligator)/i, 'Phase 2: Gator Flats'],
  [/(footstep|step)/i, 'foot.*'], [/(gun|shot|pistol|rifle)/i, 'Phase 3: Waffen'],
];

function scan() {
  const rows: string[] = [];
  const referenced = new Set(SOUNDS.flatMap((d) => d.files.map((f) => f.src).filter(Boolean) as string[]));
  let n = 0;
  for (const base of SRC_DIRS) {
    if (!existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!AUDIO_EXT.test(e)) continue;
        const rel = relative(base, p).split('\\').join('/');
        let info = '';
        try {
          const pr = probe(p);
          info = `${pr.dur.toFixed(2)} s · ${pr.ch} ch · ${pr.sr} Hz`;
          if (args.has('--loudness')) info += ` · ${lufs(decode(p, Math.min(2, pr.ch) || 1), Math.min(2, pr.ch) || 1).toFixed(1)} LUFS`;
        } catch { info = 'nicht lesbar'; }
        const hint = HINTS.filter(([re]) => re.test(rel)).map(([, id]) => id).slice(0, 2).join(', ');
        rows.push(`| ${referenced.has(rel) ? '✓' : ' '} | \`${rel}\` | ${info} | ${hint} |`);
        n++;
      }
    };
    walk(base);
  }
  const missing = SOUNDS.flatMap((d) => d.files.filter((f) => f.src && !findSrc(f.src)).map((f) => `- \`${f.src}\` (${d.id})`));
  const procOnly = SOUNDS.filter((d) => !d.files.length).map((d) => d.id);
  const md = [
    '# Audio-Sichtung (automatisch, `npm run audio -- --scan`)', '',
    `${n} Rohdateien gefunden in: ${SRC_DIRS.map((d) => `\`${relative(ROOT, d)}\``).join(', ')}`, '',
    '| im Manifest | Datei | Eigenschaften | Vorschlag |', '|---|---|---|---|', ...rows, '',
    '## Im Manifest eingetragen, aber nicht gefunden', '', ...(missing.length ? missing : ['(keine)']), '',
    `## Nur prozedural (${procOnly.length} Einträge ohne Datei)`, '', procOnly.map((i) => `\`${i}\``).join(', '), '',
  ].join('\n');
  mkdirSync(SRC_DIRS[0], { recursive: true });
  writeFileSync(join(SRC_DIRS[0], '_scan.md'), md);
  console.log(`${n} Rohdateien gesichtet → ${relative(ROOT, join(SRC_DIRS[0], '_scan.md'))}`);
}

// ------------------------------------------------------------------ Start
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch {
  console.error('ffmpeg nicht gefunden – bitte installieren (https://ffmpeg.org) und in den PATH legen.');
  process.exit(1);
}
if (!checkLicenses()) process.exit(1);
if (args.has('--scan')) scan();
else if (args.has('--credits')) writeCredits();
else { processAll(); writeCredits(); }
