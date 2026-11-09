// Prozedurales Fahrzeug-Audio (Web Audio API, keine Samples nötig):
//   Motor: zwei Oszillatoren auf der Zündfrequenz (Drehzahl x Zylinder), Verzerrung und
//          Tiefpass je nach Last – klingt unter Gas rauer und heller
//   Gangwechsel: kurzer Lastabfall + "Klack"; Fehlzündungen beim Gaswegnehmen (Sportwagen)
//   Reifen: bandpassgefiltertes Rauschen, Lautstärke nach Schlupf; Untergrund: Abrollen auf
//           Asphalt, Knirschen auf Schotter/Sand, Platschen im Schlamm
//   Crash in 3 Stärken (dumpf / Blech / großer Knall + Glas), Blech-Schaben, Hupe, Explosion
import { Tile } from '../../../shared/src/world/tiles';

interface EngineVoice {
  osc1: OscillatorNode; osc2: OscillatorNode; shaper: WaveShaperNode; filter: BiquadFilterNode;
  gain: GainNode; pan: StereoPannerNode; rumble: AudioBufferSourceNode; rumbleGain: GainNode; rumbleFilter: BiquadFilterNode;
  lastThr: number; popT: number; shifts: number; cyl: number; idle: number; redline: number; used: boolean;
}

export interface EngineInput {
  rpm: number; load: number; throttle: number; cylinders: number; idle: number; redline: number;
  shifts: number; sport: boolean; boost: boolean; volume: number; pan: number; water: boolean;
}

function curve(amount: number) {
  const n = 256, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return c;
}

export class CarAudio {
  private noise: AudioBuffer;
  private voices = new Map<number, EngineVoice>();
  private tire: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode; tone: OscillatorNode; toneGain: GainNode };
  private road: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private gravel: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private scrape: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private hornNodes = new Map<number, { o1: OscillatorNode; o2: OscillatorNode; g: GainNode }>();
  private nitro: { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode };
  private shaperSoft = curve(1.5);
  private shaperHard = curve(4);
  /** Zuletzt gemeldete Positionen, damit Hupen-Knoten abgebaut werden */
  private hornSeen = new Set<number>();

  constructor(
    private ctx: AudioContext, private out: AudioNode, private impactBuf: () => AudioBuffer | undefined,
    /** Kenney-Impact-Varianten (Metall, Glas, Blech …), siehe Sfx.GROUPS */
    private sample: (group: 'metalHeavy' | 'metalLight' | 'glass' | 'plate' | 'soft') => AudioBuffer | undefined = () => undefined,
  ) {
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loopNoise = (type: BiquadFilterType, freq: number, q: number) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(out);
      src.start(0, Math.random() * 1.5);
      return { src, filter, gain };
    };
    const t = loopNoise('bandpass', 1800, 6);
    const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = 880;
    const toneGain = ctx.createGain(); toneGain.gain.value = 0;
    tone.connect(toneGain).connect(out); tone.start();
    this.tire = { ...t, tone, toneGain };
    this.road = loopNoise('lowpass', 380, 0.7);
    this.gravel = loopNoise('bandpass', 900, 1.2);
    this.scrape = loopNoise('bandpass', 3200, 3);
    this.nitro = loopNoise('highpass', 1400, 0.5);
  }

  private now() { return this.ctx.currentTime; }

  // ------------------------------------------------------------------ Motor
  private voice(id: number, cyl: number, idle: number, redline: number): EngineVoice {
    let v = this.voices.get(id);
    if (v && v.cyl === cyl) return v;
    if (v) this.killVoice(id);
    const ctx = this.ctx;
    const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth';
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    const shaper = ctx.createWaveShaper(); shaper.curve = this.shaperSoft;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = 2.5;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    osc1.connect(mix); osc2.connect(mix);
    mix.connect(shaper).connect(filter).connect(gain).connect(pan).connect(this.out);
    const rumble = ctx.createBufferSource(); rumble.buffer = this.noise; rumble.loop = true;
    const rumbleFilter = ctx.createBiquadFilter(); rumbleFilter.type = 'bandpass'; rumbleFilter.Q.value = 3;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0;
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(pan);
    osc1.start(); osc2.start(); rumble.start(0, Math.random());
    v = { osc1, osc2, shaper, filter, gain, pan, rumble, rumbleGain, rumbleFilter, lastThr: 0, popT: 0, shifts: 0, cyl, idle, redline, used: true };
    this.voices.set(id, v);
    return v;
  }

  private killVoice(id: number) {
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.now();
    v.gain.gain.setTargetAtTime(0, t, 0.05);
    v.rumbleGain.gain.setTargetAtTime(0, t, 0.05);
    v.osc1.stop(t + 0.3); v.osc2.stop(t + 0.3); v.rumble.stop(t + 0.3);
    this.voices.delete(id);
  }

  /** Vor dem Setzen der Motoren eines Frames */
  begin() { for (const v of this.voices.values()) v.used = false; this.hornSeen.clear(); }
  /** Nach dem Frame: nicht mehr gemeldete Motoren/Hupen abbauen */
  end() {
    for (const [id, v] of this.voices) if (!v.used) this.killVoice(id);
    for (const [id, h] of this.hornNodes) if (!this.hornSeen.has(id)) { h.g.gain.setTargetAtTime(0, this.now(), 0.03); h.o1.stop(this.now() + 0.2); h.o2.stop(this.now() + 0.2); this.hornNodes.delete(id); }
  }

  engine(id: number, e: EngineInput) {
    const v = this.voice(id, e.cylinders, e.idle, e.redline);
    v.used = true;
    const t = this.now();
    // Zündfrequenz: rpm/60 * Zylinder/2 (Viertakt)
    const fire = (e.rpm / 60) * (e.cylinders / 2) * (e.water ? 0.5 : 1);
    v.osc1.frequency.setTargetAtTime(fire, t, 0.03);
    v.osc2.frequency.setTargetAtTime(fire * 0.5, t, 0.03);
    const r = Math.min(1, e.rpm / e.redline);
    v.shaper.curve = e.load > 0.5 ? this.shaperHard : this.shaperSoft;
    v.filter.frequency.setTargetAtTime(220 + e.load * 1800 + r * 1400 + (e.boost ? 800 : 0), t, 0.04);
    v.gain.gain.setTargetAtTime(e.volume * (0.06 + e.load * 0.07 + r * 0.04), t, 0.04);
    v.rumbleFilter.frequency.setTargetAtTime(fire * 2, t, 0.05);
    v.rumbleGain.gain.setTargetAtTime(e.volume * (0.04 + e.load * 0.08), t, 0.05);
    v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, e.pan)), t, 0.05);
    // Gangwechsel: Klack + kurzer Einbruch
    if (e.shifts !== v.shifts) {
      if (v.shifts !== 0) {
        v.gain.gain.setValueAtTime(e.volume * 0.03, t);
        this.click(e.volume * 0.25, e.pan);
      }
      v.shifts = e.shifts;
    }
    // Fehlzündungen beim Gaswegnehmen aus hoher Drehzahl
    if (e.sport && v.lastThr > 0.6 && e.throttle < 0.1 && r > 0.55) v.popT = 0.7;
    v.lastThr = e.throttle;
    return v;
  }

  /** Fehlzündungen abspielen; true = in diesem Frame knallte es (für die Auspuffflamme). */
  backfire(id: number, dt: number, volume: number, pan: number): boolean {
    const v = this.voices.get(id);
    if (!v || v.popT <= 0) return false;
    v.popT -= dt;
    if (Math.random() > dt * 9) return false;
    this.burst(volume * 0.5, 700 + Math.random() * 600, 0.06, 'bandpass', pan);
    this.burst(volume * 0.3, 140, 0.08, 'lowpass', pan);
    return true;
  }

  // ------------------------------------------------------------------ Reifen & Untergrund (eigenes Auto)
  /** slip = Rutsch-Geschwindigkeit (m/s), surf = Untergrund der meisten Räder, speed m/s */
  tires(slip: number, surf: number, speed: number, scrape: number, boost: boolean) {
    const t = this.now();
    const asphalt = surf === Tile.ROAD || surf === Tile.BRIDGE || surf === Tile.PLAZA || surf === Tile.SIDEWALK || surf === Tile.DOCK;
    const loose = surf === Tile.SAND || surf === Tile.DIRT || surf === Tile.DESERT || surf === Tile.BADLANDS;
    const squeal = asphalt ? Math.min(1, Math.max(0, (slip - 1.5) / 8)) : 0;
    this.tire.gain.gain.setTargetAtTime(squeal * 0.22, t, 0.05);
    this.tire.filter.frequency.setTargetAtTime(1500 + squeal * 900 + Math.sin(t * 13) * 120, t, 0.05);
    this.tire.toneGain.gain.setTargetAtTime(squeal * 0.025, t, 0.05);
    this.tire.tone.frequency.setTargetAtTime(780 + squeal * 260 + Math.sin(t * 9) * 25, t, 0.05);
    const roll = Math.min(1, speed / 30);
    this.road.gain.gain.setTargetAtTime((asphalt ? roll * 0.12 : 0) + (surf === Tile.GRASS ? roll * 0.08 : 0), t, 0.1);
    this.road.filter.frequency.setTargetAtTime(surf === Tile.GRASS ? 900 : 300 + roll * 200, t, 0.1);
    const gv = loose || surf === Tile.SWAMP ? Math.min(1, speed / 12 + slip / 10) : 0;
    this.gravel.gain.gain.setTargetAtTime(gv * (0.14 + Math.random() * 0.06), t, 0.03);
    this.gravel.filter.frequency.setTargetAtTime(surf === Tile.SWAMP ? 300 : surf === Tile.SAND ? 650 : 1100, t, 0.1);
    const sc = Math.min(1, Math.max(0, (scrape - 1.5) / 10));
    this.scrape.gain.gain.setTargetAtTime(sc * (0.18 + Math.random() * 0.12), t, 0.02);
    this.scrape.filter.frequency.setTargetAtTime(2400 + Math.random() * 1600, t, 0.02);
    this.nitro.gain.gain.setTargetAtTime(boost ? 0.12 : 0, t, boost ? 0.05 : 0.2);
  }

  /** Alle Dauergeräusche aus (zu Fuß) */
  silenceTires() { this.tires(0, Tile.GRASS, 0, 0, false); }

  // ------------------------------------------------------------------ Einzel-Effekte
  private burst(vol: number, freq: number, dur: number, type: BiquadFilterType, pan = 0, q = 1) {
    const ctx = this.ctx, t = this.now();
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(f).connect(g).connect(p).connect(this.out);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  private tone(vol: number, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', pan = 0) {
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g).connect(p).connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private click(vol: number, pan: number) { this.burst(vol, 2500, 0.03, 'highpass', pan); }

  /** Blechklang: unharmonische Teiltöne */
  private metal(vol: number, dur: number, pan: number) {
    for (const f of [420, 610, 935, 1470, 2210]) this.tone(vol * (0.4 + Math.random() * 0.4), f * (0.9 + Math.random() * 0.2), f * 0.8, dur * (0.6 + Math.random() * 0.6), 'triangle', pan);
  }

  /** Kenney-Impact-Sample als zusätzliche Schicht (leichte Tonhöhenstreuung). */
  private layer(buf: AudioBuffer | undefined, vol: number, pan: number, rate = 1) {
    if (!buf || vol < 0.01) return;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
    const g = this.ctx.createGain(); g.gain.value = vol;
    const p = this.ctx.createStereoPanner(); p.pan.value = pan;
    src.connect(g).connect(p).connect(this.out); src.start();
  }

  /** Crash: Stärke aus der Aufprallgeschwindigkeit (3 Stufen), glass = Scheibe ging zu Bruch */
  crash(dv: number, volume: number, pan: number, glass = false) {
    if (volume < 0.02) return;
    const level = dv > 14 ? 3 : dv > 7 ? 2 : 1;
    const v = volume * Math.min(1, 0.35 + dv / 18);
    this.burst(v * 0.8, level === 1 ? 500 : 900, 0.12 + level * 0.12, 'lowpass', pan);
    this.tone(v * 0.7, 140 - level * 25, 45, 0.12 + level * 0.15, 'sine', pan);
    if (level >= 2) this.metal(v * 0.18, 0.35 + level * 0.2, pan);
    if (level >= 3) { this.burst(v * 0.6, 2200, 0.5, 'bandpass', pan, 0.8); this.tone(v * 0.6, 90, 30, 0.8, 'sine', pan); }
    if (glass || level >= 3) for (let k = 0; k < 6; k++) setTimeout(() => this.burst(v * 0.12, 5000 + Math.random() * 3000, 0.05 + Math.random() * 0.08, 'bandpass', pan, 6), k * 25 + Math.random() * 60);
    // Blech und Glas aus dem Kenney Impact Pack
    this.layer(this.sample(level >= 2 ? 'metalHeavy' : 'metalLight'), v * (level >= 2 ? 0.55 : 0.4), pan, level === 3 ? 0.8 : 1);
    if (glass || level >= 3) this.layer(this.sample('glass'), v * 0.45, pan);
    // Kit-Aufprall als Bass-Schicht
    const buf = this.impactBuf();
    if (buf) {
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = level === 3 ? 0.7 : level === 2 ? 0.85 : 1.1;
      const g = this.ctx.createGain(); g.gain.value = v * 0.5;
      src.connect(g).connect(this.out); src.start();
    }
  }

  /** Prop-Treffer (leicht: Plastik-Klong, schwer: Metall) */
  propHit(heavy: boolean, volume: number, pan: number) {
    if (heavy) { this.metal(volume * 0.1, 0.6, pan); this.tone(volume * 0.4, 110, 50, 0.25, 'sine', pan); this.layer(this.sample('metalHeavy'), volume * 0.5, pan, 0.9); }
    else { this.burst(volume * 0.2, 700, 0.1, 'bandpass', pan, 2); this.layer(this.sample(Math.random() < 0.5 ? 'plate' : 'soft'), volume * 0.5, pan); }
  }

  explosion(volume: number, pan: number) {
    this.burst(volume * 1.0, 1200, 1.4, 'lowpass', pan);
    this.burst(volume * 0.6, 300, 2.0, 'lowpass', pan);
    this.tone(volume * 0.9, 85, 25, 1.4, 'sine', pan);
    this.metal(volume * 0.12, 1.2, pan);
  }

  splash(volume: number) { this.burst(volume * 0.3, 800, 0.35, 'lowpass'); }

  /** Hupe (pro Frame melden, solange sie gedrückt ist) */
  horn(id: number, volume: number, pan: number) {
    this.hornSeen.add(id);
    let h = this.hornNodes.get(id);
    if (!h) {
      const ctx = this.ctx;
      const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = 392;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 494;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
      const g = ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g).connect(this.out);
      o1.start(); o2.start();
      h = { o1, o2, g };
      this.hornNodes.set(id, h);
    }
    h.g.gain.setTargetAtTime(volume * 0.09, this.now(), 0.01);
    void pan;
  }
}
