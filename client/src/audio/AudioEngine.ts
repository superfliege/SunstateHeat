// Audio-Engine (Web Audio API):
//   Busse   Effekte · Fahrzeuge · Waffen · Stimmen · Ambience · Musik/Radio · UI → Master
//           → Kompressor → Limiter → Unterwasser-Tiefpass → Einblenden → Ausgang
//           Jeder Bus hat Lautstärke (Einstellungen, localStorage) und einen Duck-Regler.
//   Hall    Send je Stimme → Faltungshall je Umgebung (Impulsantworten prozedural, Überblendung
//           beim Umgebungswechsel). Wet-Pfad läuft über die Bus-Lautstärke mit.
//   3D      PannerNode (equalpower, optional HRTF) relativ zum Hörer an der Spielfigur, Blickrichtung
//           der Kamera. Abstandskurven je Kategorie (manifest.SPATIAL), Luftdämpfung + Verdeckung
//           (Tiefpass) über einen Raycast-Callback, Doppler als Faktor für die Abspielrate.
//   Stimmen max. 32; je Sound begrenzte Instanzen; bei Überlauf fliegt die leiseste/unwichtigste.
import { BUSES, SOUND_INDEX, dbToGain, type BusId, type SpatialSpec } from './manifest';
import { SoundBank, type Variant } from './SoundBank';

export interface Vec3 { x: number; y: number; z: number }
export const MAX_VOICES = 32;
const SPEED_OF_SOUND = 343;

export interface VoiceOpts {
  name: string;
  bus: BusId;
  /** Weltposition (fehlt/null = 2D, z. B. eigenes Fahrzeug, UI) */
  pos?: Vec3 | null;
  spatial?: SpatialSpec;
  /** Hallanteil 0..1 (multipliziert mit spatial.wet bzw. 0.25 bei 2D) */
  wet?: number;
  priority?: number;
  /** Dauer-Stimme (Motor, Loop): endet nicht von selbst, wird nicht für andere geklaut */
  persistent?: boolean;
  /** Verdeckung prüfen (Gebäude zwischen Quelle und Hörer) */
  occlude?: boolean;
}

export interface PlayOpts {
  pos?: Vec3 | null;
  /** linearer Lautstärke-Faktor */
  vol?: number;
  /** zusätzlicher Faktor auf die Abspielrate */
  rate?: number;
  /** Start verzögern (s) */
  delay?: number;
  loop?: boolean;
  bus?: BusId;
  wet?: number;
  priority?: number;
}

export interface LoopHandle { voice: Voice; src: AudioBufferSourceNode; variant: Variant }

interface Bus { input: GainNode; duck: GainNode; wetIn: GainNode; wetVol: GainNode; wetDuck: GainNode; analyser: AnalyserNode }

export interface EnvPreset { len: number; decay: number; wet: number; lp: number; early: number }
/** Hall je Umgebung (Gasse/Tunnel/Parkhaus stark, offene Straße/Strand schwach, Sumpf weich). */
export const ENVIRONMENTS = {
  open: { len: 0.9, decay: 0.3, wet: 0.1, lp: 5000, early: 0.1 },
  street: { len: 1.3, decay: 0.45, wet: 0.17, lp: 6500, early: 0.3 },
  alley: { len: 1.8, decay: 0.65, wet: 0.32, lp: 7500, early: 0.6 },
  tunnel: { len: 2.8, decay: 1.2, wet: 0.45, lp: 4500, early: 0.8 },
  garage: { len: 2.2, decay: 0.9, wet: 0.38, lp: 5500, early: 0.7 },
  beach: { len: 0.5, decay: 0.18, wet: 0.05, lp: 3000, early: 0 },
  swamp: { len: 1.4, decay: 0.55, wet: 0.13, lp: 2200, early: 0.05 },
} satisfies Record<string, EnvPreset>;
export type EnvName = keyof typeof ENVIRONMENTS;

export interface AudioSettings { master: number; buses: Record<BusId, number>; hrtf: boolean }
const DEFAULT_SETTINGS: AudioSettings = {
  master: 0.8, hrtf: false,
  buses: { sfx: 1, vehicles: 0.9, weapons: 1, voice: 1, ambience: 0.7, music: 0.6, ui: 0.7 },
};

// ------------------------------------------------------------------ Stimme
export class Voice {
  readonly input: GainNode;
  private out: GainNode;
  private filter: BiquadFilterNode | null = null;
  private panner: PannerNode | null = null;
  private send: GainNode | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private vol = 1;
  dead = false;
  pos: Vec3 | null;
  occl = 0;
  occlTarget = 0;
  readonly born: number;
  constructor(private eng: AudioEngine, readonly o: VoiceOpts) {
    const ctx = eng.ctx;
    this.pos = o.pos ? { ...o.pos } : null;
    this.born = ctx.currentTime;
    this.input = ctx.createGain();
    this.out = ctx.createGain();
    const bus = eng.bus(o.bus);
    if (this.pos && o.spatial) {
      const s = o.spatial;
      this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 18000; this.filter.Q.value = 0.5;
      const p = (this.panner = ctx.createPanner());
      p.panningModel = eng.settings.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse'; p.refDistance = s.ref; p.maxDistance = s.max; p.rolloffFactor = s.rolloff;
      this.place(this.pos, true);
      this.input.connect(this.filter).connect(p).connect(this.out);
    } else this.input.connect(this.out);
    this.out.connect(bus.input);
    const wet = (o.wet ?? 1) * (o.spatial ? o.spatial.wet : 0.25);
    if (wet > 0.01) { this.send = ctx.createGain(); this.send.gain.value = wet; this.out.connect(this.send).connect(bus.wetIn); }
  }
  get spatial() { return this.o.spatial ?? null; }

  private place(p: Vec3, now = false) {
    const pn = this.panner!;
    const t = this.eng.ctx.currentTime;
    if (pn.positionX) {
      if (now) { pn.positionX.value = p.x; pn.positionY.value = p.y; pn.positionZ.value = p.z; }
      else { pn.positionX.setTargetAtTime(p.x, t, 0.02); pn.positionY.setTargetAtTime(p.y, t, 0.02); pn.positionZ.setTargetAtTime(p.z, t, 0.02); }
    } else pn.setPosition(p.x, p.y, p.z);
  }
  setPos(x: number, y: number, z: number) {
    if (!this.panner || !this.pos) return;
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.place(this.pos);
  }
  /** Lautstärke (linear) mit Zeitkonstante */
  setVolume(v: number, tc = 0.04) {
    if (this.dead) return;
    this.vol = v;
    this.out.gain.setTargetAtTime(v * (1 - 0.45 * this.occl), this.eng.ctx.currentTime, tc);
  }
  get volume() { return this.vol; }

  addSource(src: AudioScheduledSourceNode) {
    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      try { src.disconnect(); } catch { /* egal */ }
      if (!this.sources.size && !this.o.persistent) this.finish();
    };
  }

  /** Geschätzte Hörbarkeit 0..1 (für Prioritäten/Debug) */
  audibility(): number {
    if (!this.pos || !this.o.spatial) return this.vol;
    const s = this.o.spatial, d = this.eng.distTo(this.pos);
    if (d > s.max) return 0;
    return this.vol * (s.ref / (s.ref + s.rolloff * (Math.max(d, s.ref) - s.ref))) * (1 - 0.45 * this.occl);
  }

  /** Verdeckung/Luftdämpfung/Hallanteil nachführen (vom Engine-Update, gedrosselt) */
  refresh(occl: number) {
    if (!this.filter || !this.pos || this.dead) return;
    this.occl = occl;
    const d = this.eng.distTo(this.pos);
    const air = 18000 * Math.exp(-d / 260);
    const f = Math.min(air, 18000 * Math.pow(800 / 18000, occl), this.eng.underwaterCut);
    const t = this.eng.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(Math.max(300, f), t, 0.08);
    this.out.gain.setTargetAtTime(this.vol * (1 - 0.45 * occl), t, 0.08);
    if (this.send && this.o.spatial) this.send.gain.setTargetAtTime((this.o.wet ?? 1) * this.o.spatial.wet * (0.45 + Math.min(1, d / 70) * 0.8 + occl * 0.4), t, 0.1);
  }

  stop(fade = 0.05) {
    if (this.dead) return;
    const t = this.eng.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    for (const s of this.sources) { try { s.stop(t + fade + 0.02); } catch { /* schon gestoppt */ } }
    if (!this.sources.size) this.finish();
    else setTimeout(() => this.finish(), (fade + 0.1) * 1000);
    this.dead = true;
  }

  private finished = false;
  private finish() {
    if (this.finished) return;
    this.finished = this.dead = true;
    try { this.out.disconnect(); this.input.disconnect(); this.send?.disconnect(); this.panner?.disconnect(); this.filter?.disconnect(); } catch { /* egal */ }
  }
}

// ------------------------------------------------------------------ Engine
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly bank: SoundBank;
  settings: AudioSettings;
  private buses = {} as Record<BusId, Bus>;
  private master: GainNode;
  private fade: GainNode;
  private underwater: BiquadFilterNode;
  underwaterCut = 22000;
  private reverbIn: GainNode;
  private conv: { node: ConvolverNode; gain: GainNode }[] = [];
  private convActive = 0;
  private irCache = new Map<EnvName, AudioBuffer>();
  env: EnvName = 'open';
  readonly voices: Voice[] = [];
  private occlIdx = 0;
  readonly listener = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fz: -1 };
  /** Raycast: Verdeckung 0..1 zwischen Quelle und Hörer (wird vom Spiel gesetzt) */
  occluder: ((sx: number, sz: number, lx: number, lz: number) => number) | null = null;
  /** Abgelehnte/geklaute Stimmen (Debug) */
  stolen = 0;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.settings = loadSettings();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.knee.value = 8; comp.attack.value = 0.006; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.001; lim.release.value = 0.08;
    this.underwater = ctx.createBiquadFilter(); this.underwater.type = 'lowpass'; this.underwater.frequency.value = 22000;
    this.fade = ctx.createGain(); this.fade.gain.value = 0;
    this.master.connect(comp).connect(lim).connect(this.underwater).connect(this.fade).connect(ctx.destination);
    // Hall: zwei Faltungen zum Überblenden
    this.reverbIn = ctx.createGain();
    for (let i = 0; i < 2; i++) {
      const node = ctx.createConvolver(); const gain = ctx.createGain(); gain.gain.value = 0;
      this.reverbIn.connect(node).connect(gain).connect(this.master);
      this.conv.push({ node, gain });
    }
    for (const id of BUSES) {
      const input = ctx.createGain(), duck = ctx.createGain(), analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      input.connect(duck).connect(analyser).connect(this.master);
      const wetIn = ctx.createGain(), wetVol = ctx.createGain(), wetDuck = ctx.createGain();
      wetIn.connect(wetVol).connect(wetDuck).connect(this.reverbIn);
      this.buses[id] = { input, duck, wetIn, wetVol, wetDuck, analyser };
    }
    this.applySettings();
    this.setEnvironment('open', true);
    this.bank = new SoundBank(ctx);
  }

  /** Nach der ersten Nutzeraktion: Kontext fortsetzen und sanft einblenden. */
  start() {
    void this.ctx.resume();
    const t = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(t);
    this.fade.gain.setValueAtTime(this.fade.gain.value, t);
    this.fade.gain.linearRampToValueAtTime(1, t + 2.5);
  }

  bus(id: BusId) { return this.buses[id]; }

  applySettings() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master, t, 0.05);
    for (const id of BUSES) {
      const v = this.settings.buses[id];
      this.buses[id].input.gain.setTargetAtTime(v, t, 0.05);
      this.buses[id].wetVol.gain.setTargetAtTime(v, t, 0.05);
    }
    try { localStorage.setItem('sunstate.audio', JSON.stringify(this.settings)); } catch { /* egal */ }
  }

  // ---------------------------------------------------------------- Hörer
  setListener(x: number, y: number, z: number, fx: number, fz: number, dt: number) {
    const L = this.listener;
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      L.vx += ((x - L.x) / dt - L.vx) * k; L.vy += ((y - L.y) / dt - L.vy) * k; L.vz += ((z - L.z) / dt - L.vz) * k;
      if (Math.hypot(x - L.x, z - L.z) > 30) { L.vx = 0; L.vy = 0; L.vz = 0; } // Teleport
    }
    L.x = x; L.y = y; L.z = z;
    const n = Math.hypot(fx, fz) || 1; L.fx = fx / n; L.fz = fz / n;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.02); l.positionY.setTargetAtTime(y, t, 0.02); l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(L.fx, t, 0.05); l.forwardY.setTargetAtTime(0, t, 0.05); l.forwardZ.setTargetAtTime(L.fz, t, 0.05);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(x, y, z); l.setOrientation(L.fx, 0, L.fz, 0, 1, 0); }
  }

  distTo(p: Vec3) { const L = this.listener; return Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z); }

  /** Doppler-Faktor (dezent) für eine bewegte Quelle. */
  doppler(p: Vec3, vx: number, vz: number, amount = 0.6): number {
    const L = this.listener;
    const dx = L.x - p.x, dz = L.z - p.z, d = Math.hypot(dx, dz);
    if (d < 1) return 1;
    const ux = dx / d, uz = dz / d;
    const vs = vx * ux + vz * uz; // Quelle → Hörer
    const vl = -(L.vx * ux + L.vz * uz); // Hörer → Quelle
    const f = (SPEED_OF_SOUND + vl) / Math.max(150, SPEED_OF_SOUND - vs);
    return 1 + (Math.max(0.75, Math.min(1.3, f)) - 1) * amount;
  }

  /** Grobe Hörbarkeit eines Punktes (ohne Stimme), z. B. um ferne Effekte gar nicht erst zu starten. */
  gainAt(p: Vec3 | null | undefined, s: SpatialSpec | undefined) {
    if (!p || !s) return 1;
    const d = this.distTo(p);
    if (d > s.max) return 0;
    return s.ref / (s.ref + s.rolloff * (Math.max(d, s.ref) - s.ref));
  }

  // ---------------------------------------------------------------- Stimmen
  /** Neue (leere) Stimme anlegen – null, wenn das Stimmen-Budget das nicht hergibt. */
  voice(o: VoiceOpts, expected = 1): Voice | null {
    this.reap();
    const prio = o.priority ?? 0.5;
    if (this.voices.length >= MAX_VOICES) {
      const score = prio * expected * this.gainAt(o.pos, o.spatial);
      let worst: Voice | null = null, ws = Infinity;
      for (const v of this.voices) {
        if (v.o.persistent && !o.persistent) continue;
        const s = (v.o.priority ?? 0.5) * v.audibility();
        if (s < ws) { ws = s; worst = v; }
      }
      if (!worst || ws > score) { this.stolen++; return null; }
      worst.stop(0.03); this.stolen++;
      this.reap();
    }
    const v = new Voice(this, o);
    this.voices.push(v);
    if (o.occlude !== false && v.spatial) v.refresh(this.occlusionFor(v));
    return v;
  }

  private reap() { for (let i = this.voices.length - 1; i >= 0; i--) if (this.voices[i].dead) this.voices.splice(i, 1); }

  /** Sound aus dem Manifest abspielen (Variante, Pitch-/Pegelstreuung, 3D, Limits). */
  play(id: string, o: PlayOpts = {}): Voice | null {
    const def = SOUND_INDEX.get(id);
    if (!def) { console.warn(`[audio] unbekannter Sound ${id}`); return null; }
    const spatial = o.pos ? def.spatial : undefined;
    let vol = (o.vol ?? 1) * dbToGain(def.vol ?? 0);
    if (def.volJitter) vol *= dbToGain((Math.random() * 2 - 1) * def.volJitter);
    if (vol < 0.003 || this.gainAt(o.pos, spatial) * vol < 0.004) return null;
    const variant = this.bank.pick(id);
    if (!variant) return null;
    // Instanz-Limit je Sound: älteste ersetzen
    const max = def.maxInst ?? 6;
    let same = 0, oldest: Voice | null = null;
    for (const v of this.voices) if (!v.dead && v.o.name === id) { same++; if (!oldest || v.born < oldest.born) oldest = v; }
    if (same >= max && oldest) oldest.stop(0.04);
    const v = this.voice({ name: id, bus: o.bus ?? def.bus, pos: o.pos, spatial, wet: o.wet, priority: o.priority ?? def.priority, persistent: o.loop }, vol);
    if (!v) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = variant.buf;
    const [p0, p1] = def.pitch ?? [1, 1];
    src.playbackRate.value = (p0 + Math.random() * (p1 - p0)) * (o.rate ?? 1);
    const when = this.ctx.currentTime + (o.delay ?? 0);
    if (o.loop) {
      src.loop = true;
      if (variant.offset > 0) { src.loopStart = variant.offset; src.loopEnd = variant.offset + variant.dur; }
      src.start(when, variant.offset + Math.random() * variant.dur * 0.9);
    } else src.start(when, Math.max(0, variant.offset - (variant.offset > 0 ? 0.02 : 0)), variant.dur + (variant.offset > 0 ? 0.04 : 0));
    src.connect(v.input);
    v.addSource(src);
    v.setVolume(vol, 0.001);
    return v;
  }

  /** Variante als laufende Loop-Quelle an eine Stimme hängen. */
  loopSource(v: Voice, variant: Variant, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = variant.buf; src.loop = true; src.playbackRate.value = rate;
    if (variant.offset > 0) { src.loopStart = variant.offset; src.loopEnd = variant.offset + variant.dur; }
    src.start(0, variant.offset + Math.random() * variant.dur * 0.9);
    src.connect(v.input);
    v.addSource(src);
    return src;
  }

  /** Dauer-Loop aus dem Manifest (startet stumm; Lautstärke/Tonhöhe führt der Aufrufer nach). */
  loop(id: string, pos: Vec3 | null, o: { priority?: number; wet?: number; bus?: BusId } = {}): LoopHandle | null {
    const def = SOUND_INDEX.get(id);
    const variant = def && this.bank.pick(id);
    if (!def || !variant) return null;
    const v = this.voice({ name: id, bus: o.bus ?? def.bus, pos, spatial: pos ? def.spatial : undefined, wet: o.wet, priority: o.priority ?? def.priority ?? 0.6, persistent: true });
    if (!v) return null;
    v.setVolume(0, 0.001);
    return { voice: v, src: this.loopSource(v, variant), variant };
  }

  // ---------------------------------------------------------------- Umgebung
  private makeIR(name: EnvName): AudioBuffer {
    let b = this.irCache.get(name);
    if (b) return b;
    const p: EnvPreset = ENVIRONMENTS[name];
    const sr = this.ctx.sampleRate, len = Math.round(sr * p.len);
    b = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const cut = p.lp * Math.exp(-t / (p.decay * 1.5)) + 400; // Höhen klingen schneller ab
        const k = 1 - Math.exp((-2 * Math.PI * cut) / sr);
        lp += ((Math.random() * 2 - 1) - lp) * k;
        d[i] = lp * Math.exp(-t / (p.decay * 0.45)) * Math.min(1, t / 0.008);
      }
      // frühe Reflexionen (Wände)
      for (let e = 0; e < 6; e++) {
        const at = Math.round(sr * (0.006 + Math.random() * 0.05));
        if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * p.early * (0.6 - e * 0.07);
      }
    }
    this.irCache.set(name, b);
    return b;
  }

  setEnvironment(name: EnvName, now = false) {
    if (name === this.env && !now) return;
    this.env = name;
    const t = this.ctx.currentTime;
    const next = now ? 0 : 1 - this.convActive;
    const c = this.conv[next];
    if (c.node.buffer !== this.makeIR(name)) c.node.buffer = this.makeIR(name);
    c.gain.gain.setTargetAtTime(ENVIRONMENTS[name].wet * 2.2, t, now ? 0.001 : 0.4);
    if (!now) this.conv[this.convActive].gain.gain.setTargetAtTime(0, t, 0.4);
    this.convActive = next;
  }

  setUnderwater(on: boolean) {
    const f = on ? 650 : 22000;
    if (f === this.underwaterCut) return;
    this.underwaterCut = f;
    this.underwater.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.15);
  }

  /** Radio/Ambience kurz absenken (Explosion, Dialog, Missionsansage). */
  duck(db = -9, hold = 1.2, buses: BusId[] = ['music', 'ambience']) {
    const t = this.ctx.currentTime, g = dbToGain(db);
    for (const id of buses) for (const p of [this.buses[id].duck.gain, this.buses[id].wetDuck.gain]) {
      p.cancelScheduledValues(t);
      p.setTargetAtTime(Math.min(g, p.value), t, 0.04);
      p.setTargetAtTime(1, t + hold, 0.6);
    }
  }

  private occlusionFor(v: Voice) {
    if (!this.occluder || !v.pos || v.o.occlude === false) return 0;
    return this.occluder(v.pos.x, v.pos.z, this.listener.x, this.listener.z);
  }

  /** Einmal pro Bild: Verdeckung/Luftdämpfung einiger Stimmen nachführen, Tote entfernen. */
  update() {
    this.reap();
    const n = this.voices.length;
    if (!n) return;
    for (let k = 0; k < Math.min(4, n); k++) {
      this.occlIdx = (this.occlIdx + 1) % n;
      const v = this.voices[this.occlIdx];
      if (v.spatial) v.refresh(this.occlusionFor(v));
    }
  }

  // ---------------------------------------------------------------- Debug
  busLevel(id: BusId): number {
    const a = this.buses[id].analyser;
    const d = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(d);
    let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    const r = Math.sqrt(s / d.length);
    return r > 1e-5 ? 20 * Math.log10(r) : -99;
  }
}

function loadSettings(): AudioSettings {
  const s: AudioSettings = { ...DEFAULT_SETTINGS, buses: { ...DEFAULT_SETTINGS.buses } };
  try {
    const raw = JSON.parse(localStorage.getItem('sunstate.audio') ?? 'null') as Partial<AudioSettings> | null;
    if (raw) {
      if (typeof raw.master === 'number') s.master = raw.master;
      if (typeof raw.hrtf === 'boolean') s.hrtf = raw.hrtf;
      for (const id of BUSES) if (typeof raw.buses?.[id] === 'number') s.buses[id] = raw.buses[id];
    }
  } catch { /* egal */ }
  return s;
}
