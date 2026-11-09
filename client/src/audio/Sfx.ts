// Soundeffekte aus den Kenney-Packs (Starter Kits, Impact Sounds, Interface Sounds – CC0, siehe
// CREDITS.md) über die Web Audio API, dazu das prozedurale Fahrzeug-Audio (CarAudio). Gruppen mit
// mehreren Varianten werden zufällig mit leichter Tonhöhenstreuung gespielt, damit sich nichts
// wiederholt anhört. Fehlt eine Datei oder blockiert der Browser Audio, bleibt es einfach still.
import { CarAudio } from './CarAudio';

const IMPACT = 'kenney/impact-sounds/';
const UI = 'kenney/interface-sounds/';
const n = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${IMPACT}${prefix}_00${i}.ogg`);
/** Variantengruppen (Kenney Impact/Interface Sounds). */
const GROUPS = {
  punch: [...n('impactPunch_heavy', 5), ...n('impactPunch_medium', 3)],
  metalHeavy: n('impactMetal_heavy', 5),
  metalLight: n('impactMetal_light', 3),
  glass: n('impactGlass_heavy', 3),
  plate: n('impactPlate_heavy', 3),
  soft: n('impactSoft_heavy', 3),
  stepConcrete: n('footstep_concrete', 5),
  stepGrass: n('footstep_grass', 5),
  stepWood: n('footstep_wood', 3),
  uiOpen: [`${UI}open_001.ogg`],
  uiClose: [`${UI}close_001.ogg`],
  uiClick: [`${UI}click_001.ogg`, `${UI}click_002.ogg`],
  uiGood: [`${UI}confirmation_001.ogg`, `${UI}confirmation_002.ogg`],
  uiBad: [`${UI}error_004.ogg`],
  uiInfo: [`${UI}select_001.ogg`],
  money: [`${UI}maximize_006.ogg`, `${UI}pluck_001.ogg`],
} as const;
export type SoundGroup = keyof typeof GROUPS;

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
  private groups = new Map<SoundGroup, AudioBuffer[]>();
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
    this.car = new CarAudio(this.ctx, this.master, () => this.buffers.get('impact'), (g) => this.pick(g));
    for (const [group, files] of Object.entries(GROUPS) as [SoundGroup, readonly string[]][]) {
      const list: AudioBuffer[] = [];
      this.groups.set(group, list);
      for (const file of files) {
        fetch(`assets/${file}`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
          .then((data) => this.ctx!.decodeAudioData(data))
          .then((buf) => { list.push(buf); })
          .catch(() => console.warn(`[sfx] ${file} nicht geladen`));
      }
    }
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

  /** Zufällige Variante einer Gruppe (undefined, solange nichts geladen ist). */
  pick(group: SoundGroup): AudioBuffer | undefined {
    const list = this.groups.get(group);
    return list?.length ? list[Math.floor(Math.random() * list.length)] : undefined;
  }

  /** Variante einer Gruppe abspielen (Tonhöhe ±spread, Stereo-Position pan). */
  playGroup(group: SoundGroup, volume = 1, pan = 0, spread = 0.08) {
    const buf = this.pick(group);
    if (!this.ctx || !this.master || !buf || volume < 0.01) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = pan;
    src.connect(gain).connect(panner).connect(this.master);
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
    if (kind === 'hit') this.playGroup('punch', volume * 0.9, pan, 0.12);
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
