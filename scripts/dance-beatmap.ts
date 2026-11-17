// Beatmap-Entwurf für „Dance Floor Heat“ erzeugen (zum Nachbearbeiten von Hand).
//
//   npx tsx scripts/dance-beatmap.ts --song <id>            Entwurf aus den Song-Daten (symbolische Onsets)
//   npx tsx scripts/dance-beatmap.ts --all [--force]         alle Songs aus shared/src/content/dance/songs.ts
//   npx tsx scripts/dance-beatmap.ts --audio <datei> --id <name> [--bpm 120] [--offset 0.5]
//                                                           Entwurf aus einer Audiodatei (ffmpeg dekodiert):
//                                                           Spektral-Fluss-Onsets, BPM per Autokorrelation
//                                                           (falls nicht angegeben), Phase = bester Raster-Treffer
//
// Ausgabe: shared/src/content/dance/<id>.json (vorhandene Dateien nur mit --force überschreiben).
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { draftBeatmap, draftForSong, type BeatmapFile, type Onset } from '../shared/src/content/dance/beatmap';
import { SONG_BY_ID, SONGS } from '../shared/src/content/dance/songs';

const OUT = join(process.cwd(), 'shared/src/content/dance');
const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const force = args.includes('--force');

function write(bm: BeatmapFile) {
  const file = join(OUT, `${bm.song}.json`);
  if (existsSync(file) && !force) { console.log(`übersprungen (existiert, --force zum Überschreiben): ${file}`); return; }
  // Kompakt: eine Note pro Zeile, gut von Hand editierbar
  const notes = (n: BeatmapFile['easy']) => `[\n    ${n.map((x) => JSON.stringify(x)).join(',\n    ')}\n  ]`;
  const json = `{\n  "song": ${JSON.stringify(bm.song)},\n  "bpm": ${bm.bpm},\n  "offset": ${bm.offset},\n  "easy": ${notes(bm.easy)},\n  "medium": ${notes(bm.medium)},\n  "hard": ${notes(bm.hard)}\n}\n`;
  writeFileSync(file, json);
  console.log(`${file}: Leicht ${bm.easy.length}, Mittel ${bm.medium.length}, Schwer ${bm.hard.length} Noten`);
}

// ------------------------------------------------------------------ Audio-Analyse
const SR = 22050;
function decode(file: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** Einfache FFT (Radix-2, in place). */
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k], br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi; re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Spektral-Fluss je Hop (positiver Zuwachs der log-Beträge). */
function spectralFlux(pcm: Float32Array, N = 1024, hop = 256): Float64Array {
  const frames = Math.max(0, Math.floor((pcm.length - N) / hop));
  const flux = new Float64Array(frames);
  let prev = new Float64Array(N / 2);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let f = 0; f < frames; f++) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = pcm[f * hop + i] * win[i];
    fft(re, im);
    const mag = new Float64Array(N / 2);
    let s = 0;
    for (let k = 1; k < N / 2; k++) { mag[k] = Math.log1p(Math.hypot(re[k], im[k]) * 10); const d = mag[k] - prev[k]; if (d > 0) s += d; }
    flux[f] = s; prev = mag;
  }
  return flux;
}

function analyse(file: string, bpmArg?: number, offArg?: number): { bpm: number; offset: number; onsets: { t: number; s: number }[] } {
  const pcm = decode(file);
  const hop = 256, fps = SR / hop;
  const flux = spectralFlux(pcm, 1024, hop);
  // Peak-Picking mit adaptiver Schwelle (Mittel + 1,4 · Std im ±0,25-s-Fenster)
  const W = Math.round(fps * 0.25);
  const onsets: { t: number; s: number }[] = [];
  let maxF = 0; for (const v of flux) maxF = Math.max(maxF, v);
  for (let i = 1; i < flux.length - 1; i++) {
    let m = 0, q = 0, n = 0;
    for (let j = Math.max(0, i - W); j < Math.min(flux.length, i + W); j++) { m += flux[j]; q += flux[j] ** 2; n++; }
    m /= n; const sd = Math.sqrt(Math.max(0, q / n - m * m));
    if (flux[i] > m + 1.4 * sd && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) onsets.push({ t: i / fps, s: flux[i] / maxF });
  }
  // BPM: Autokorrelation des Fluss-Signals zwischen 80 und 160 BPM
  let bpm = bpmArg ?? 0;
  if (!bpm) {
    let best = 0;
    for (let b = 80; b <= 160; b += 0.5) {
      const lag = (60 / b) * fps;
      let acc = 0;
      for (let i = 0; i + lag * 4 < flux.length; i++) acc += flux[i] * (flux[Math.round(i + lag)] + 0.5 * flux[Math.round(i + lag * 2)] + 0.25 * flux[Math.round(i + lag * 4)]);
      if (acc > best) { best = acc; bpm = b; }
    }
  }
  // Phase: Versatz, bei dem die meiste Onset-Energie auf ganze Schläge fällt
  let offset = offArg ?? 0;
  if (offArg === undefined) {
    const period = 60 / bpm;
    let best = -1;
    for (let k = 0; k < 64; k++) {
      const off = (k / 64) * period;
      let acc = 0;
      for (const o of onsets) { const ph = ((o.t - off) / period) % 1; acc += o.s * Math.cos(ph * 2 * Math.PI); }
      if (acc > best) { best = acc; offset = off; }
    }
  }
  return { bpm, offset: Math.round(offset * 1000) / 1000, onsets };
}

// ------------------------------------------------------------------ Ablauf
if (args.includes('--all')) {
  for (const s of SONGS) write(draftForSong(s));
} else if (arg('--song')) {
  const s = SONG_BY_ID[arg('--song')!];
  if (!s) { console.error(`Unbekannter Song. Verfügbar: ${SONGS.map((x) => x.id).join(', ')}`); process.exit(1); }
  write(draftForSong(s));
} else if (arg('--audio')) {
  const id = arg('--id');
  if (!id) { console.error('--id <name> fehlt'); process.exit(1); }
  const res = analyse(arg('--audio')!, arg('--bpm') ? Number(arg('--bpm')) : undefined, arg('--offset') ? Number(arg('--offset')) : undefined);
  const spb = 60 / res.bpm;
  const onsets: Onset[] = res.onsets.map((o) => ({ beat: (o.t - res.offset) / spb, strength: Math.min(1, o.s * 1.6) }));
  const total = Math.max(...onsets.map((o) => o.beat), 0) + 1;
  console.log(`BPM ${res.bpm}, erster Schlag bei ${res.offset}s, ${onsets.length} Onsets`);
  write({ song: id, bpm: res.bpm, offset: res.offset, easy: draftBeatmap(onsets, total, 'easy'), medium: draftBeatmap(onsets, total, 'medium'), hard: draftBeatmap(onsets, total, 'hard') });
} else {
  console.log('Aufruf: --song <id> | --all [--force] | --audio <datei> --id <name> [--bpm n] [--offset s]');
}
