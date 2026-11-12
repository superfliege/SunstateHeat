// Prozedurale Klangerzeugung (offline in Float32-Puffer, einmal pro Sitzung): Ersatz für jeden
// Manifest-Eintrag ohne Datei (manifest.ts → proc). Die Puffer verhalten sich wie Samples, d. h.
// dieselbe Engine (Layer-Crossfade, Pitch, 3D, Hall) arbeitet mit echten Aufnahmen und mit diesen.
//
// Motor-Loops: pro Zündung ein kurzer Impuls (Auspuffresonanz + Körperschall + Verbrennungsrauschen)
// mit festen Abweichungen je Zylinder (V8-Blubbern, Twin-Pulsieren), exakt ganzzahlig viele
// Arbeitsspiele lang → nahtloser Loop. Last = hell/verzerrt, Schiebebetrieb = dumpf mit Blubbern.
import { ENGINE_LAYERS, type EngineLayer, type EngineSet } from './manifest';

// ------------------------------------------------------------------ Grundbausteine
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

/** RBJ-Biquad (Transposed Direct Form II). */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0; private z1 = 0; private z2 = 0;
  constructor(sr: number, type: 'lp' | 'hp' | 'bp', f: number, q = 0.707) { this.set(sr, type, f, q); }
  set(sr: number, type: 'lp' | 'hp' | 'bp', f: number, q = 0.707) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr, cw = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === 'lp') { this.b0 = (1 - cw) / 2 / a0; this.b1 = (1 - cw) / a0; this.b2 = this.b0; }
    else if (type === 'hp') { this.b0 = (1 + cw) / 2 / a0; this.b1 = -(1 + cw) / a0; this.b2 = this.b0; }
    else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }
    this.a1 = (-2 * cw) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  p(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Filter zirkulär anwenden (Zustand mit dem Pufferende vorwärmen) → Loop bleibt nahtlos. */
function filterLoop(d: Float32Array, f: Biquad) {
  const warm = Math.min(d.length, 4096);
  for (let i = d.length - warm; i < d.length; i++) f.p(d[i]);
  for (let i = 0; i < d.length; i++) d[i] = f.p(d[i]);
}
function filterOnce(d: Float32Array, f: Biquad) { for (let i = 0; i < d.length; i++) d[i] = f.p(d[i]); }

/** Nicht-periodisches Material loopbar machen: Ende über den Anfang blenden. */
function loopify(d: Float32Array, xf: number): Float32Array {
  const n = d.length - xf, out = d.slice(0, n);
  for (let i = 0; i < xf; i++) {
    const t = i / xf;
    out[i] = d[i] * Math.sqrt(t) + d[n + i] * Math.sqrt(1 - t);
  }
  return out;
}

function rms(d: Float32Array) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, d.length)); }
function normRms(d: Float32Array, target: number) { const r = rms(d) || 1; const k = target / r; for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i] * k)); return d; }
function normPeak(d: Float32Array, target = 0.9) {
  let p = 0; for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  const k = p > 0 ? target / p : 1; for (let i = 0; i < d.length; i++) d[i] *= k; return d;
}
const env = (n: number, sr: number, tau: number) => Math.exp(-n / (tau * sr));

// ------------------------------------------------------------------ Motor
export interface EngineSynth {
  cyl: number; idle: number; redline: number;
  /** Auspuff-Resonanz (Hz) und Abklingzeit (s) */
  exhaust: number; exDecay: number;
  /** tiefer Körperschall (Hz) */
  body: number;
  noise: number; clatter: number;
  /** Unregelmäßigkeit (Zündabstände/Pegel) */
  uneven: number;
  drive: number; bright: number; whine: number; burble: number;
  /** feste Zündzeitpunkte als Anteil am Arbeitsspiel */
  offsets?: number[];
}
export const ENGINE_SYNTH: Record<EngineSet, EngineSynth> = {
  compact: { cyl: 4, idle: 850, redline: 6800, exhaust: 210, exDecay: 0.012, body: 70, noise: 0.35, clatter: 0.08, uneven: 0.05, drive: 1.6, bright: 2400, whine: 0.04, burble: 0 },
  sedan: { cyl: 4, idle: 800, redline: 6500, exhaust: 170, exDecay: 0.016, body: 60, noise: 0.3, clatter: 0.05, uneven: 0.06, drive: 1.5, bright: 2000, whine: 0.02, burble: 0.05 },
  sport: { cyl: 6, idle: 950, redline: 7800, exhaust: 260, exDecay: 0.012, body: 85, noise: 0.45, clatter: 0.05, uneven: 0.04, drive: 2.6, bright: 4200, whine: 0.08, burble: 0.5 },
  muscle: { cyl: 8, idle: 700, redline: 6000, exhaust: 120, exDecay: 0.024, body: 48, noise: 0.4, clatter: 0.04, uneven: 0.22, drive: 2.8, bright: 2600, whine: 0.03, burble: 0.9,
    offsets: [0, 0.105, 0.25, 0.38, 0.5, 0.6, 0.75, 0.885] },
  suv: { cyl: 6, idle: 750, redline: 5600, exhaust: 140, exDecay: 0.02, body: 55, noise: 0.35, clatter: 0.07, uneven: 0.07, drive: 1.8, bright: 2000, whine: 0.02, burble: 0.1 },
  truck: { cyl: 6, idle: 600, redline: 2600, exhaust: 95, exDecay: 0.03, body: 38, noise: 0.5, clatter: 0.55, uneven: 0.08, drive: 2.2, bright: 1500, whine: 0.06, burble: 0.05 },
  bike: { cyl: 2, idle: 1300, redline: 11000, exhaust: 330, exDecay: 0.01, body: 110, noise: 0.5, clatter: 0.12, uneven: 0.1, drive: 2.4, bright: 4800, whine: 0.06, burble: 0.4,
    offsets: [0, 0.375] },
  boat: { cyl: 6, idle: 700, redline: 5500, exhaust: 130, exDecay: 0.02, body: 50, noise: 0.45, clatter: 0.1, uneven: 0.08, drive: 1.6, bright: 1400, whine: 0.03, burble: 0.3 },
  airboat: { cyl: 4, idle: 900, redline: 4800, exhaust: 160, exDecay: 0.014, body: 60, noise: 0.5, clatter: 0.2, uneven: 0.08, drive: 2.0, bright: 2600, whine: 0.0, burble: 0.2 },
  // Traktor-Diesel: langsames, unrundes Tuckern mit viel Nageln
  tractor: { cyl: 3, idle: 650, redline: 2300, exhaust: 75, exDecay: 0.04, body: 32, noise: 0.45, clatter: 0.85, uneven: 0.18, drive: 2.4, bright: 1100, whine: 0.02, burble: 0.15,
    offsets: [0, 0.31, 0.68] },
  // Quad/ATV: kleiner Einzylinder, hell und knatternd
  quad: { cyl: 1, idle: 1300, redline: 8500, exhaust: 290, exDecay: 0.009, body: 120, noise: 0.55, clatter: 0.2, uneven: 0.14, drive: 2.6, bright: 4200, whine: 0.04, burble: 0.35 },
  // Aufsitzrasenmäher: Einzylinder mit Klappern und Messer-Surren
  mower: { cyl: 1, idle: 1500, redline: 3600, exhaust: 180, exDecay: 0.012, body: 90, noise: 0.6, clatter: 0.5, uneven: 0.2, drive: 1.8, bright: 2600, whine: 0.25, burble: 0 },
};

/** Drehzahl eines Layers (bezogen auf die Synth-Klasse). */
export function layerRpm(set: EngineSet, layer: EngineLayer) {
  const s = ENGINE_SYNTH[set];
  const k = layer === 'idle' ? 0 : layer === 'low' ? 0.25 : layer === 'mid' ? 0.55 : 0.9;
  return s.idle + k * (s.redline - s.idle);
}

/** Erzeugt einen Motor-Loop; liefert auch die exakt erreichte Drehzahl (für die Tonhöhe). */
export function engineLoop(sr: number, set: EngineSet, layer: EngineLayer, on: boolean): { data: Float32Array; rpm: number } {
  const s = ENGINE_SYNTH[set];
  const r = rng(hash(`${set}:${layer}:${on}`));
  const target = layerRpm(set, layer);
  const cycleT = 120 / target;
  const K = Math.max(3, Math.round(0.9 / cycleT));
  const len = Math.round(K * cycleT * sr);
  const rpm = (120 * sr * K) / len;
  const cycleS = len / K;
  const out = new Float32Array(len);
  const clat = new Float32Array(len);
  const RL = Math.min(Math.round(0.07 * sr), Math.round(cycleS * 2));
  const hiLoad = layerRpm(set, layer) / s.redline;
  // Impulsantwort je Zylinder (leicht verstimmt: unterschiedliche Krümmerlängen)
  const resp: Float32Array[] = [];
  const ampJ: number[] = [], offJ: number[] = [];
  for (let j = 0; j < s.cyl; j++) {
    const fex = s.exhaust * (1 + (r() - 0.5) * 0.12 * (1 + s.uneven * 3));
    const ph = r() * Math.PI;
    const a = new Float32Array(RL);
    const nb = new Biquad(sr, 'bp', s.exhaust * 3, 0.8);
    for (let n = 0; n < RL; n++) {
      const t = n / sr;
      a[n] = env(n, sr, s.exDecay) * Math.sin(2 * Math.PI * fex * t + ph)
        + 0.8 * env(n, sr, s.exDecay * 2.2) * Math.sin(2 * Math.PI * s.body * t)
        + s.noise * env(n, sr, 0.004) * nb.p(r() * 2 - 1) * 3;
    }
    // weicher Einsatz (kein Knacken)
    for (let n = 0; n < Math.min(24, RL); n++) a[n] *= n / 24;
    resp.push(a);
    ampJ.push(1 + (r() - 0.5) * s.uneven * 1.6);
    offJ.push((s.offsets ? s.offsets[j] : j / s.cyl) + (r() - 0.5) * s.uneven * 0.04);
  }
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < s.cyl; j++) {
      const pos = Math.round((k + offJ[j]) * cycleS + (r() - 0.5) * s.uneven * 0.02 * cycleS);
      let amp = ampJ[j] * (1 + (r() - 0.5) * 0.18 * (1 + s.uneven * 3));
      if (!on) {
        amp *= 0.42;
        const x = r();
        if (x < s.burble * 0.22) amp *= 2.4; // Blubbern / Nachverbrennung
        else if (x < s.burble * 0.5) amp *= 0.25;
      }
      const a = resp[j];
      for (let n = 0; n < RL; n++) out[(pos + n + len * 4) % len] += a[n] * amp;
      // Ventil-/Einspritz-Klappern (Diesel) als kurzer heller Burst
      if (s.clatter > 0) {
        const cp = (pos + Math.round(cycleS * 0.13 / s.cyl) + len * 4) % len;
        const cn = Math.round(0.0025 * sr);
        for (let n = 0; n < cn; n++) clat[(cp + n) % len] += (r() * 2 - 1) * env(n, sr, 0.0008) * s.clatter * (on ? 1 : 0.6);
      }
    }
  }
  // Klangfarbe: Last = hell + gesättigt, Schiebebetrieb = dumpf
  filterLoop(out, new Biquad(sr, 'lp', on ? s.bright * (0.75 + hiLoad * 0.5) : s.bright * 0.4, 0.8));
  normRms(out, 0.22);
  const drive = on ? s.drive : Math.max(1.1, s.drive * 0.6);
  const td = Math.tanh(drive);
  for (let i = 0; i < len; i++) out[i] = Math.tanh(out[i] * drive * 2.2) / td * 0.5;
  // Klappern (hell, über dem Tiefpass)
  if (s.clatter > 0) { filterLoop(clat, new Biquad(sr, 'bp', 4200, 1.2)); for (let i = 0; i < len; i++) out[i] += clat[i] * 0.9; }
  // Heulen (Kompressor/Getriebe) als ganzzahlige Harmonische des Arbeitsspiels → nahtlos
  if (s.whine > 0) {
    const cyc = rpm / 120;
    const h = Math.max(1, Math.round((rpm / 60) * s.cyl * 2.5 / cyc));
    for (let i = 0; i < len; i++) out[i] += Math.sin((2 * Math.PI * h * cyc * i) / sr) * s.whine * (on ? 0.12 : 0.05) * (0.4 + hiLoad);
  }
  filterLoop(out, new Biquad(sr, 'hp', 28, 0.7));
  normRms(out, on ? 0.25 : 0.16);
  return { data: out, rpm };
}

/** Airboat-Propeller: Blattdurchgänge (Luftschläge) + Brummen, ganzzahlig periodisch. */
function propLoop(sr: number): { data: Float32Array; rpm: number } {
  const r = rng(77);
  const bladeHz = 70; // bei Referenz-Drehzahl
  const per = Math.round(sr / bladeHz);
  const N = Math.round(1.0 * bladeHz);
  const len = per * N;
  const d = new Float32Array(len);
  const bp = new Biquad(sr, 'bp', 600, 0.9);
  for (let i = 0; i < len; i++) {
    const ph = (i % per) / per;
    const chop = Math.pow(Math.max(0, Math.sin(Math.PI * ph)), 6);
    d[i] = bp.p(r() * 2 - 1) * (0.25 + chop * 1.4) + Math.sin(2 * Math.PI * ph) * 0.35 + Math.sin(4 * Math.PI * ph) * 0.15;
  }
  filterLoop(d, new Biquad(sr, 'lp', 2400, 0.7));
  return { data: normRms(d, 0.25), rpm: 2400 };
}

// ------------------------------------------------------------------ Rausch-Loops
type Gen = (r: () => number, sr: number) => Float32Array;

function noiseLoop(sr: number, seconds: number, seed: number, fn: (white: number, i: number, r: () => number) => number, filters: Biquad[], target = 0.2) {
  const r = rng(seed);
  const xf = Math.round(sr * 0.25);
  const n = Math.round(sr * seconds) + xf;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = fn(r() * 2 - 1, i, r);
  for (const f of filters) filterOnce(d, f);
  return normRms(loopify(d, xf), target);
}

/** Einfache Musik-Loops für die Radiosender (Ersatz, bis Tracks in assets-src/audio liegen). */
function musicLoop(sr: number, bpm: number, bars: number, seed: number, voice: (t: number, beat: number, r: () => number) => number, target = 0.18) {
  const seconds = (bars * 4 * 60) / bpm;
  return noiseLoop(sr, seconds, seed, (_w, i, r) => { const t = i / sr; return voice(t, (t * bpm) / 60, r); }, [new Biquad(sr, 'lp', 5200, 0.7)], target);
}
const note = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const pluck = (f: number, dt: number, decay: number) => (dt < 0 ? 0 : (((dt * f) % 1) * 2 - 1) * Math.exp(-dt / decay) + Math.sin(2 * Math.PI * f * 2 * dt) * 0.3 * Math.exp(-dt / (decay * 0.5)));

const LOOPS: Record<string, Gen> = {
  // ---------------- Radio
  // Swamp Radio 101: 12-Takt-Blues-Shuffle in E (Bass, Gitarren-Riff, Besen-Snare)
  'radio:swamp': (_r, sr) => {
    const prog = [40, 40, 40, 40, 45, 45, 40, 40, 47, 45, 40, 47];
    return musicLoop(sr, 96, 12, 61, (t, beat, r) => {
      const bar = Math.floor(beat / 4) % 12, root = prog[bar];
      const sw = beat % 1, eighth = Math.floor(beat * 2) + (sw > 0.66 ? 1 : 0);
      const bt = (beat - Math.floor(beat)) * 60 / 96;
      const bass = pluck(note(root - 12 + ((Math.floor(beat) % 4) === 2 ? 7 : 0)), bt, 0.25) * 0.8;
      const riffN = [0, 7, 9, 7][Math.floor(beat) % 4];
      const gt = ((beat * 1.5) % 1) * 40 / 96;
      const gtr = pluck(note(root + 12 + riffN), gt, 0.12) * 0.35 + pluck(note(root + 19 + riffN), gt, 0.1) * 0.2;
      const snare = (Math.floor(beat) % 2 === 1 && sw < 0.08) ? (r() * 2 - 1) * (1 - sw / 0.08) * 0.5 : 0;
      const kick = (Math.floor(beat) % 2 === 0 && sw < 0.1) ? Math.sin(2 * Math.PI * 60 * sw * 0.6) * (1 - sw / 0.1) * 0.9 : 0;
      void eighth; void t;
      return bass + gtr + snare + kick;
    });
  },
  // Coral 88.1: Synthwave-Arpeggio über Am–F–C–G
  'radio:coral': (_r, sr) => {
    const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    return musicLoop(sr, 110, 8, 67, (_t, beat, r) => {
      const ch = chords[Math.floor(beat / 8) % 4];
      const step = Math.floor(beat * 4) % 8, st = ((beat * 4) % 1) * 60 / 110 / 4;
      const arp = Math.sin(2 * Math.PI * note(ch[step % 3] + 12) * st) * Math.exp(-st / 0.12) * 0.35;
      const padT = (beat % 8) * 60 / 110;
      let pad = 0; for (const n of ch) pad += Math.sin(2 * Math.PI * note(n) * padT) * 0.08;
      const kick = (beat % 1) < 0.1 ? Math.sin(2 * Math.PI * 55 * (beat % 1)) * (1 - (beat % 1) / 0.1) : 0;
      const hat = ((beat * 2) % 1) < 0.03 ? (r() * 2 - 1) * 0.2 : 0;
      return arp + pad + kick * 0.8 + hat;
    });
  },
  // Rauschen beim Umschalten / schwacher Empfang
  'radio:static': (_r, sr) => noiseLoop(sr, 2, 71, (w, i) => w * (0.7 + 0.3 * Math.sin(i / sr * 23)), [new Biquad(sr, 'bp', 2200, 0.4)], 0.12),
  // ---------------- Land & Berg (Ambience)
  'amb:crickets': (_r, sr) => {
    // Zirpen: viele Grillen mit leicht verschiedenen Pulsraten (Trägerton ~4,5 kHz)
    const bugs = Array.from({ length: 7 }, (_, k) => ({ f: 4200 + k * 160, rate: 14 + k * 1.7, ph: k * 0.37, a: 0.4 + (k % 3) * 0.2 }));
    return noiseLoop(sr, 4, 41, (w, i) => {
      const t = i / sr;
      let v = 0;
      for (const b of bugs) { const gate = Math.max(0, Math.sin(2 * Math.PI * (t * b.rate + b.ph))) ** 6 * (Math.sin(2 * Math.PI * t * 0.5 + b.ph) > -0.3 ? 1 : 0); v += Math.sin(2 * Math.PI * b.f * t) * gate * b.a; }
      return v * 0.35 + w * 0.01;
    }, [new Biquad(sr, 'hp', 2500, 0.7)], 0.08);
  },
  'amb:wind': (_r, sr) => {
    const lfo = (i: number) => 0.55 + 0.45 * Math.sin((2 * Math.PI * i) / sr * 0.13) * Math.sin((2 * Math.PI * i) / sr * 0.31 + 1);
    let b = 0;
    return noiseLoop(sr, 6, 43, (w, i) => { b = b * 0.97 + w * 0.03; return (b * 6 + w * 0.15) * lfo(i); }, [new Biquad(sr, 'bp', 520, 0.5), new Biquad(sr, 'lp', 1800)], 0.16);
  },
  'amb:waterfall': (_r, sr) => noiseLoop(sr, 3, 47, (w, i) => w * (0.85 + 0.15 * Math.sin(i / sr * 7)), [new Biquad(sr, 'lp', 2600, 0.5), new Biquad(sr, 'hp', 90)], 0.22),
  'amb:birds': (_r, sr) => {
    const r0 = rng(53);
    const chirps = Array.from({ length: 14 }, () => ({ t0: r0() * 5.6, f: 2400 + r0() * 2600, d: 0.05 + r0() * 0.12, n: 1 + Math.floor(r0() * 4) }));
    return noiseLoop(sr, 6, 53, (w, i) => {
      const t = i / sr;
      let v = 0;
      for (const c of chirps) for (let k = 0; k < c.n; k++) { const dt = t - c.t0 - k * (c.d + 0.04); if (dt > 0 && dt < c.d) v += Math.sin(2 * Math.PI * (c.f + dt * 9000) * dt) * Math.sin(Math.PI * dt / c.d); }
      return v * 0.5 + w * 0.004;
    }, [new Biquad(sr, 'hp', 1500, 0.6)], 0.07);
  },
  'water:rush': (_r, sr) => {
    const lfo = (i: number) => 0.7 + 0.3 * Math.sin((2 * Math.PI * i) / sr * 0.7) * Math.sin((2 * Math.PI * i) / sr * 1.9);
    return noiseLoop(sr, 3, 11, (w, i) => w * lfo(i), [new Biquad(sr, 'lp', 1100, 0.6), new Biquad(sr, 'hp', 120)], 0.2);
  },
  nitro: (_r, sr) => noiseLoop(sr, 2, 12, (w) => w, [new Biquad(sr, 'hp', 1200, 0.6), new Biquad(sr, 'lp', 7000)], 0.18),
  squeal: (_r, sr) => {
    const r = rng(21), xf = Math.round(sr * 0.3), n = Math.round(sr * 2.5) + xf, d = new Float32Array(n);
    let fm = 0, am = 1, p1 = 0, p2 = 0, p3 = 0;
    const bp = new Biquad(sr, 'bp', 1800, 3);
    for (let i = 0; i < n; i++) {
      fm += (r() - 0.5) * 0.004; fm *= 0.9995;
      am += (r() - 0.5) * 0.01; am = Math.max(0.5, Math.min(1.2, am * 0.9999 + 0.0001));
      const f = 880 * (1 + fm * 3);
      p1 += (2 * Math.PI * f) / sr; p2 += (2 * Math.PI * f * 1.51) / sr; p3 += (2 * Math.PI * f * 2.27) / sr;
      d[i] = am * (Math.sin(p1) * 0.6 + Math.sin(p2) * 0.25 + Math.sin(p3) * 0.12) + bp.p(r() * 2 - 1) * 0.5;
    }
    return normRms(loopify(d, xf), 0.22);
  },
  'roll:asphalt': (_r, sr) => {
    let b = 0;
    return noiseLoop(sr, 3, 31, (w, i) => { b = b * 0.985 + w * 0.15; return b + Math.sin((2 * Math.PI * 95 * i) / sr) * 0.04 + w * 0.03; },
      [new Biquad(sr, 'lp', 520, 0.6), new Biquad(sr, 'hp', 35)], 0.2);
  },
  'roll:gravel': (_r, sr) => {
    let b = 0;
    const g = noiseLoop(sr, 3, 32, (w, _i, r) => { b = b * 0.98 + w * 0.12; return (r() < 0.035 ? (r() * 2 - 1) * 6 : 0) + b; },
      [new Biquad(sr, 'bp', 2200, 0.7), new Biquad(sr, 'lp', 6000)], 0.2);
    return g;
  },
  'roll:sand': (_r, sr) => noiseLoop(sr, 3, 33, (w, _i, r) => w * 0.6 + (r() < 0.01 ? (r() - 0.5) * 3 : 0), [new Biquad(sr, 'lp', 1300, 0.6), new Biquad(sr, 'hp', 150)], 0.18),
  'roll:grass': (_r, sr) => {
    let am = 0.5, tgt = 0.5;
    return noiseLoop(sr, 3, 34, (w, i, r) => { if (i % 2000 === 0) tgt = 0.3 + r() * 0.9; am += (tgt - am) * 0.002; return w * am; },
      [new Biquad(sr, 'bp', 2600, 0.6), new Biquad(sr, 'lp', 7000)], 0.18);
  },
  'roll:wet': (_r, sr) => {
    let am = 0.8;
    return noiseLoop(sr, 3, 35, (w, _i, r) => { am += (0.6 + r() * 0.8 - am) * 0.001; return w * am; },
      [new Biquad(sr, 'hp', 1800, 0.7), new Biquad(sr, 'lp', 9000)], 0.2);
  },
  scrape: (_r, sr) => {
    const fs = [new Biquad(sr, 'bp', 1900, 9), new Biquad(sr, 'bp', 2950, 10), new Biquad(sr, 'bp', 4400, 12), new Biquad(sr, 'bp', 3300, 2)];
    const r = rng(41), xf = Math.round(sr * 0.2), n = Math.round(sr * 2) + xf, d = new Float32Array(n);
    let am = 1;
    for (let i = 0; i < n; i++) {
      if (i % 300 === 0) am = 0.4 + r() * 1.2;
      const w = (r() * 2 - 1) * am;
      d[i] = fs[0].p(w) * 1.2 + fs[1].p(w) + fs[2].p(w) * 0.8 + fs[3].p(w) * 0.6;
    }
    return normRms(loopify(d, xf), 0.22);
  },
  sparks: (_r, sr) => {
    const r = rng(42), xf = Math.round(sr * 0.1), n = Math.round(sr * 2) + xf, d = new Float32Array(n);
    for (let i = 0; i < n; i++) if (r() < 0.004) { const a = r(); const L = Math.round(sr * 0.003); for (let k = 0; k < L && i + k < n; k++) d[i + k] += (r() * 2 - 1) * a * env(k, sr, 0.0008); }
    filterOnce(d, new Biquad(sr, 'hp', 2500, 0.7));
    return normRms(loopify(d, xf), 0.12);
  },
  fire: (_r, sr) => {
    const r = rng(43), xf = Math.round(sr * 0.3), n = Math.round(sr * 4) + xf, d = new Float32Array(n);
    let b = 0, am = 1;
    const lp = new Biquad(sr, 'lp', 420, 0.6), bp = new Biquad(sr, 'bp', 1600, 1.2);
    for (let i = 0; i < n; i++) {
      if (i % 4000 === 0) am = 0.6 + r() * 0.7;
      b = b * 0.99 + (r() * 2 - 1) * 0.1;
      let c = 0;
      if (r() < 0.0012) c = (r() * 2 - 1) * 8;
      d[i] = lp.p(b * am) * 2 + bp.p(c);
    }
    return normRms(loopify(d, xf), 0.22);
  },
  hiss: (_r, sr) => {
    let am = 1;
    return noiseLoop(sr, 2, 44, (w, _i, r) => { am += (0.7 + r() * 0.6 - am) * 0.003; return w * am; }, [new Biquad(sr, 'hp', 2600, 0.7), new Biquad(sr, 'lp', 9000)], 0.16);
  },
};

// ------------------------------------------------------------------ Einzel-Effekte (je 4 Varianten)
function shot(sr: number, seconds: number, seed: number, fn: (i: number, t: number, r: () => number, d: Float32Array) => number, post?: (d: Float32Array) => void, peak = 0.9) {
  const r = rng(seed);
  const d = new Float32Array(Math.round(sr * seconds));
  for (let i = 0; i < d.length; i++) d[i] = fn(i, i / sr, r, d);
  post?.(d);
  // Ende sanft ausblenden
  const fo = Math.min(d.length, Math.round(sr * 0.02));
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  return normPeak(d, peak);
}
const sine = (f: number, t: number) => Math.sin(2 * Math.PI * f * t);
/** Tonhöhen-Sweep (Phase integriert) */
function sweep(f0: number, f1: number, dur: number) { let ph = 0; return (t: number, sr: number) => { const f = f0 * Math.pow(f1 / f0, Math.min(1, t / dur)); ph += (2 * Math.PI * f) / sr; return Math.sin(ph); }; }

/** Inharmonisches Metall: Teiltöne mit eigener Abklingzeit */
function metalPartials(r: () => number, base: number, count: number) {
  return Array.from({ length: count }, () => ({ f: base * (1 + r() * 5.5), a: 0.3 + r() * 0.7, tau: 0.05 + r() * 0.35 }));
}

const SHOTS: Record<string, (sr: number, v: number) => Float32Array> = {
  // ---------------- Land & Berg
  'amb:moo': (sr, v) => {
    // Muhen: tiefer Sägezahn mit Formant, Tonhöhe fällt ab
    const f0 = 105 + v * 12; const bp = new Biquad(sr, 'bp', 520 + v * 40, 2.2); const lp = new Biquad(sr, 'lp', 1400, 0.7);
    let ph = 0;
    return shot(sr, 1.6, 900 + v, (_i, t) => {
      const f = f0 * (1.05 - Math.min(1, t / 1.4) * 0.25 + Math.sin(t * 9) * 0.01); ph += f / sr;
      const saw = (ph % 1) * 2 - 1;
      const envv = Math.min(1, t / 0.15) * Math.max(0, 1 - Math.max(0, t - 1.1) / 0.5);
      return (bp.p(saw) * 2.2 + lp.p(saw) * 0.4) * envv;
    });
  },
  'amb:cowbell': (sr, v) => shot(sr, 0.9, 910 + v, (_i, t) => (Math.sin(2 * Math.PI * (560 + v * 30) * t) + 0.6 * Math.sin(2 * Math.PI * (1340 + v * 50) * t) + 0.3 * Math.sin(2 * Math.PI * 2210 * t)) * Math.exp(-t / 0.22)),
  'amb:rooster': (sr, v) => {
    // Kikeriki: vier Silben mit Tonhöhenbogen
    const sylls = [[0, 0.12, 620], [0.16, 0.12, 720], [0.32, 0.18, 800], [0.55, 0.55, 760]];
    const bp = new Biquad(sr, 'bp', 1400, 1.4);
    let ph = 0;
    return shot(sr, 1.2, 920 + v, (_i, t) => {
      let a = 0, f = 600;
      for (const [s0, d, ff] of sylls) if (t >= s0 && t < s0 + d) { a = Math.sin(Math.PI * (t - s0) / d); f = ff * (1 + 0.15 * Math.sin(Math.PI * (t - s0) / d)) * (1 + v * 0.03); }
      ph += f / sr; const saw = (ph % 1) * 2 - 1;
      return bp.p(saw) * a * 2.5;
    });
  },
  'amb:dog': (sr, v) => {
    const bp = new Biquad(sr, 'bp', 700 + v * 60, 1.6); let ph = 0;
    return shot(sr, 0.7, 930 + v, (_i, t, r) => {
      const barks = [0, 0.32]; let a = 0;
      for (const b of barks) if (t > b && t < b + 0.14) a = Math.sin(Math.PI * (t - b) / 0.14);
      ph += (220 + v * 20 - (t % 0.32) * 300) / sr;
      return (bp.p(((ph % 1) * 2 - 1) + (r() * 2 - 1) * 0.3)) * a * 2.4;
    });
  },
  'amb:squeak': (sr, v) => { const sw = sweep(900 + v * 60, 1400, 0.35); return shot(sr, 0.5, 940 + v, (_i, t) => sw(t, sr) * Math.sin(Math.PI * Math.min(1, t / 0.45)) * 0.6 * (1 + 0.4 * Math.sin(t * 90))); },
  'amb:churchbell': (sr, v) => shot(sr, 4, 950 + v, (_i, t) => {
    const f = 196 * (1 + v * 0.06);
    return (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 2.2) + 0.5 * Math.sin(2 * Math.PI * f * 2.4 * t) * Math.exp(-t / 1.1) + 0.3 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t / 0.7) + 0.2 * Math.sin(2 * Math.PI * f * 0.5 * t) * Math.exp(-t / 3)) * 0.7;
  }),
  'amb:truckhorn': (sr, v) => {
    const lp = new Biquad(sr, 'lp', 900, 0.7);
    return shot(sr, 1.6, 960 + v, (_i, t) => { const a = Math.min(1, t / 0.05) * Math.max(0, 1 - Math.max(0, t - 0.9) / 0.5); let s = 0; for (const f of [185, 233, 277]) s += ((t * f) % 1) * 2 - 1; return lp.p(s * 0.4) * a; });
  },
  'amb:siren': (sr, v) => { let ph = 0; return shot(sr, 4, 970 + v, (_i, t) => { const f = 500 + 350 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t / 2)); ph += f / sr; return Math.sin(2 * Math.PI * ph) * Math.min(1, t / 0.2) * Math.max(0, 1 - Math.max(0, t - 3.5) / 0.5) * 0.7; }); },
  'amb:hawk': (sr, v) => { const sw = sweep(2600 + v * 100, 1700, 0.9); return shot(sr, 1.0, 980 + v, (_i, t, r) => (sw(t, sr) * 0.8 + (r() * 2 - 1) * 0.15) * Math.sin(Math.PI * Math.min(1, t / 0.95)) * 0.7); },
  'hit:thud': (sr, v) => {
    const sw = sweep(130 + v * 15, 38, 0.25); const lp = new Biquad(sr, 'lp', 500 + v * 80, 0.7);
    return shot(sr, 0.45, 100 + v, (_i, t, r) => sw(t, sr) * env(t * sr, sr, 0.11) + lp.p(r() * 2 - 1) * env(t * sr, sr, 0.05) * 1.5);
  },
  'hit:metal': (sr, v) => {
    const r0 = rng(200 + v); const ps = metalPartials(r0, 300 + v * 60, 9); const bp = new Biquad(sr, 'bp', 2400, 0.9);
    return shot(sr, 0.9, 210 + v, (_i, t, r) => {
      let s = 0; for (const p of ps) s += p.a * Math.sin(2 * Math.PI * p.f * t) * Math.exp(-t / p.tau);
      return s * 0.25 + bp.p(r() * 2 - 1) * Math.exp(-t / 0.03) * 1.2;
    });
  },
  'hit:crunch': (sr, v) => {
    const bp = new Biquad(sr, 'bp', 1800 + v * 300, 1.4); const lp = new Biquad(sr, 'lp', 300);
    let am = 1;
    return shot(sr, 0.5, 300 + v, (i, t, r) => {
      if (i % 220 === 0) am = r() < 0.6 ? r() * 1.5 : 0.1;
      return bp.p(r() * 2 - 1) * am * Math.exp(-t / 0.16) * 1.4 + lp.p(r() * 2 - 1) * Math.exp(-t / 0.06) * 2;
    });
  },
  'hit:glass': (sr, v) => {
    const r0 = rng(400 + v);
    const tinks = Array.from({ length: 40 + v * 6 }, () => ({ t0: Math.pow(r0(), 1.8) * 0.75, f: 2800 + r0() * 6500, a: 0.2 + r0() * 0.8, tau: 0.01 + r0() * 0.05 }));
    const hp = new Biquad(sr, 'hp', 4000, 0.7);
    return shot(sr, 0.95, 410 + v, (_i, t, r) => {
      let s = hp.p(r() * 2 - 1) * Math.exp(-t / 0.04) * 0.9;
      for (const k of tinks) if (t >= k.t0) { const dt = t - k.t0; if (dt < k.tau * 6) s += k.a * Math.sin(2 * Math.PI * k.f * dt) * Math.exp(-dt / k.tau) * 0.5; }
      return s;
    });
  },
  'hit:debris': (sr, v) => {
    const r0 = rng(500 + v);
    const bits = Array.from({ length: 10 + v * 3 }, () => ({ t0: 0.05 + Math.pow(r0(), 1.3) * 1.3, ps: metalPartials(r0, 900 + r0() * 1800, 3), a: 0.3 + r0() * 0.7 }));
    return shot(sr, 1.7, 510 + v, (_i, t) => {
      let s = 0;
      for (const b of bits) if (t >= b.t0 && t - b.t0 < 0.12) { const dt = t - b.t0; for (const p of b.ps) s += b.a * p.a * Math.sin(2 * Math.PI * p.f * dt) * Math.exp(-dt / 0.025); }
      return s * 0.4;
    });
  },
  boom: (sr, v) => {
    const sw = sweep(70, 22, 1.4); const lp = new Biquad(sr, 'lp', 2400, 0.6); const lp2 = new Biquad(sr, 'lp', 260, 0.7);
    let crackA = 0;
    return shot(sr, 3.2, 600 + v, (_i, t, r) => {
      lp.set(sr, 'lp', 2400 * Math.exp(-t / 0.5) + 180, 0.6);
      if (r() < 0.002 * Math.exp(-t / 0.8)) crackA = 1;
      crackA *= 0.995;
      const w = r() * 2 - 1;
      return lp.p(w) * Math.exp(-t / 0.55) * 1.6 + lp2.p(w) * Math.exp(-t / 1.1) * 2.5 + sw(t, sr) * Math.exp(-t / 0.6) * 1.2 + w * crackA * 0.5;
    });
  },
  pop: (sr, v) => {
    const bp = new Biquad(sr, 'bp', 700 + v * 150, 1.1);
    return shot(sr, 0.16, 700 + v, (_i, t, r) => bp.p(r() * 2 - 1) * Math.exp(-t / 0.012) * 3 + sine(110 + v * 20, t) * Math.exp(-t / 0.03) * 0.9);
  },
  shift: (sr, v) => {
    const hp = new Biquad(sr, 'hp', 2000);
    return shot(sr, 0.14, 800 + v, (_i, t, r) => sine(85 + v * 8, t) * Math.exp(-t / 0.025) + hp.p(r() * 2 - 1) * Math.exp(-t / 0.004) * 0.7, undefined, 0.7);
  },
  bov: (sr, v) => {
    const bp = new Biquad(sr, 'bp', 2500, 2);
    return shot(sr, 0.45, 900 + v, (_i, t, r) => { bp.set(sr, 'bp', 2600 - t * 3200 + v * 100, 2.2); return bp.p(r() * 2 - 1) * Math.min(1, t / 0.01) * Math.exp(-t / 0.13); });
  },
  airbrake: (sr, v) => {
    const hp = new Biquad(sr, 'hp', 2600, 0.7); const bp = new Biquad(sr, 'bp', 5200, 2);
    return shot(sr, 0.9, 1000 + v, (_i, t, r) => { const w = r() * 2 - 1; return (hp.p(w) * 0.8 + bp.p(w) * 0.6) * Math.min(1, t / 0.012) * (t < 0.12 ? 1.4 : Math.exp(-(t - 0.12) / 0.22)); });
  },
  burst: (sr, v) => {
    const lp = new Biquad(sr, 'lp', 3000);
    return shot(sr, 0.4, 1100 + v, (_i, t, r) => lp.p(r() * 2 - 1) * Math.exp(-t / 0.02) * 2 + sine(70, t) * Math.exp(-t / 0.08));
  },
  curb: (sr, v) => {
    const bp = new Biquad(sr, 'bp', 900, 1.5);
    return shot(sr, 0.25, 1200 + v, (_i, t, r) => sine(62 + v * 9, t) * Math.exp(-t / 0.05) + bp.p(r() * 2 - 1) * Math.exp(-t / 0.03) * 0.5);
  },
  land: (sr, v) => {
    const sw = sweep(75, 35, 0.2);
    return shot(sr, 0.5, 1300 + v, (_i, t, r) => sw(t, sr) * Math.exp(-t / 0.12) * 1.2 + (r() * 2 - 1) * Math.exp(-t / 0.015) * 0.4 + sine(260 - t * 200, t) * Math.exp(-t / 0.1) * 0.12);
  },
  rattle: (sr, v) => {
    const bp = new Biquad(sr, 'bp', 1300 + v * 250, 4);
    return shot(sr, 0.12, 1400 + v, (_i, t, r) => bp.p(r() * 2 - 1) * (Math.exp(-t / 0.006) + (t > 0.035 ? Math.exp(-(t - 0.035) / 0.006) * 0.6 : 0)) * 3);
  },
  sputter: (sr, v) => {
    const lp = new Biquad(sr, 'lp', 380, 0.8);
    return shot(sr, 0.3, 1500 + v, (_i, t, r) => lp.p(r() * 2 - 1) * Math.exp(-t / 0.05) * 3 + sine(55, t) * Math.exp(-t / 0.07));
  },
  'water:slap': (sr, v) => {
    const lp = new Biquad(sr, 'lp', 800 + v * 100); const bp = new Biquad(sr, 'bp', 420, 1.5);
    return shot(sr, 0.3, 1600 + v, (_i, t, r) => { const w = r() * 2 - 1; return (lp.p(w) + bp.p(w) * 1.5) * Math.min(1, t / 0.01) * Math.exp(-t / 0.06); });
  },
  'water:splash': (sr, v) => {
    const lp = new Biquad(sr, 'lp', 1800); const r0 = rng(1700 + v);
    const bubbles = Array.from({ length: 12 }, () => ({ t0: 0.08 + r0() * 0.5, f: 300 + r0() * 700 }));
    return shot(sr, 1.0, 1710 + v, (_i, t, r) => {
      let s = lp.p(r() * 2 - 1) * Math.min(1, t / 0.02) * Math.exp(-t / 0.22);
      for (const b of bubbles) if (t > b.t0 && t - b.t0 < 0.06) { const dt = t - b.t0; s += Math.sin(2 * Math.PI * b.f * (1 + dt * 8) * dt) * Math.exp(-dt / 0.02) * 0.3; }
      return s;
    });
  },
};

// ------------------------------------------------------------------ Öffentliche Schnittstelle
export interface ProcResult { buffers: AudioBuffer[]; /** Motor-Loops: Drehzahl der Aufnahme */ rpm?: number }

function toBuffer(ctx: BaseAudioContext, d: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, d.length, ctx.sampleRate);
  b.getChannelData(0).set(d);
  return b;
}

/** Erzeugt den prozeduralen Ersatz für einen Schlüssel (undefined = unbekannt). */
export function generate(ctx: BaseAudioContext, key: string): ProcResult | undefined {
  const sr = ctx.sampleRate;
  if (key.startsWith('eng:')) {
    const [, set, layer, load] = key.split(':');
    if (!(ENGINE_LAYERS as readonly string[]).includes(layer)) return undefined;
    const { data, rpm } = engineLoop(sr, set as EngineSet, layer as EngineLayer, load === 'on');
    return { buffers: [toBuffer(ctx, data)], rpm };
  }
  if (key === 'prop:airboat') { const { data, rpm } = propLoop(sr); return { buffers: [toBuffer(ctx, data)], rpm }; }
  const loop = LOOPS[key];
  if (loop) return { buffers: [toBuffer(ctx, loop(rng(hash(key)), sr))] };
  const s = SHOTS[key];
  if (s) return { buffers: [0, 1, 2, 3].map((v) => toBuffer(ctx, s(sr, v))) };
  return undefined;
}
