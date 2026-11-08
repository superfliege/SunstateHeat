// Soundeffekte aus den Kenney-Starter-Kits (CC0, siehe CREDITS.md) über die Web Audio API,
// dazu das prozedurale Fahrzeug-Audio (CarAudio). Fehlt eine Datei oder blockiert der Browser
// Audio, bleibt es einfach still.
import { CarAudio } from './CarAudio';

const FILES = {
  impact: 'kenney/starter-kit-racing/audio/impact.ogg',
  ambience: 'kenney/starter-kit-city-builder/sounds/ambience.ogg',
  toggle: 'kenney/starter-kit-city-builder/sounds/toggle.ogg',
  notice: 'kenney/starter-kit-city-builder/sounds/placement-a.ogg',
} as const;
type SoundName = keyof typeof FILES;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  /** Prozedurales Fahrzeug-Audio (null, solange Audio nicht freigegeben ist) */
  car: CarAudio | null = null;

  /** Muss aus einer Nutzeraktion heraus (Klick/Enter) aufgerufen werden – Autoplay-Regeln. */
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    // sanfter Limiter, damit Crash-Schichten nicht übersteuern
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.car = new CarAudio(this.ctx, this.master, () => this.buffers.get('impact'));
    for (const [name, file] of Object.entries(FILES) as [SoundName, string][]) {
      fetch(`assets/${file}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => this.ctx!.decodeAudioData(data))
        .then((buf) => {
          this.buffers.set(name, buf);
          if (name === 'ambience') this.loop('ambience', 0.12);
        })
        .catch(() => console.warn(`[sfx] ${file} nicht geladen`));
    }
  }

  /** Einmaliger Effekt. */
  play(name: SoundName, volume = 1, rate = 1) {
    const buf = this.buffers.get(name);
    if (!this.ctx || !this.master || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }

  /** Prozeduraler Waffen-Sound (Spec 5.1: dumpf, comicartig). kind: 'swing' | 'shot' | 'heavy' | 'hit' */
  weapon(kind: 'swing' | 'shot' | 'heavy' | 'hit', volume = 1, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.master);
    const dur = kind === 'heavy' ? 0.28 : kind === 'shot' ? 0.14 : 0.1;
    out.gain.setValueAtTime(volume * (kind === 'swing' ? 0.25 : 0.55), t);
    out.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const osc = ctx.createOscillator();
    osc.type = kind === 'hit' ? 'square' : 'sawtooth';
    const f0 = kind === 'heavy' ? 120 : kind === 'shot' ? 220 : kind === 'hit' ? 160 : 400;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.25), t + dur);
    osc.connect(out);
    osc.start(t); osc.stop(t + dur);
    if (kind !== 'hit') { // Rauschen für den Knall
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = kind === 'swing' ? 'highpass' : 'lowpass';
      lp.frequency.value = kind === 'swing' ? 1800 : 1400;
      src.connect(lp).connect(out);
      src.start(t);
    }
  }

  private loop(name: SoundName, volume: number) {
    const buf = this.buffers.get(name);
    if (!this.ctx || !this.master || !buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }
}
