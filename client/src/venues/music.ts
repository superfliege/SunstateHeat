// Club-Musik: die Songs aus shared/content/dance/songs.ts werden prozedural gerendert (OfflineAudioContext,
// mono, 22,05 kHz – ca. 6 MB je Song, höchstens 3 im Speicher). Dieselben Daten erzeugen auch die
// Beatmaps → Beat und Noten sitzen exakt aufeinander.
//
// ClubSound: Beschallung des Clubs (PA) über den Musik-Bus der AudioEngine – drinnen voll mit Bass,
// auf Toiletten/im Foyer und draußen gedämpft (Tiefpass + Pegel nach Entfernung), plus Lounge-Musik im Casino.
import { SONG_BY_ID, songEvents, songOffset, songSeconds, type SongDef, type SongEvent, type Wave } from '../../../shared/src/content/dance/songs';
import type { AudioEngine } from '../audio/AudioEngine';

const SR = 22050;
const cache = new Map<string, Promise<AudioBuffer>>();
const order: string[] = [];

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Lounge-Musik (Casino-Bar): ruhige Akkorde, gewischtes Becken, Kontrabass. */
export const LOUNGE: SongDef = {
  id: 'lounge', title: 'Palm Royale Lounge', artist: 'Archibald am Flügel', genre: 'House', bpm: 84,
  root: 50, scale: [0, 2, 4, 5, 7, 9, 11], swing: 0.22,
  kick: 'x.........x.....', snare: '................', hat: 'x..x..x.x..x..x.', clap: '................', perc: '................',
  bass: ['0...4...5...4...', '3...7...5...2...'], lead: ['4-----2-1-----0-5-----4-2-------', '7---5---4---2---4-------------..'],
  chords: [0, 3, 1, 4], leadWave: 'tri', padWave: 'sine', bassWave: 'sine', color: 0xe8c35a,
  sections: [{ name: 'Lounge', bars: 16, drums: 'half', bass: true, lead: true, pad: true }],
};

function noiseBuffer(ctx: BaseAudioContext) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 1234567;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
  return b;
}

function oscType(w: Wave): OscillatorType { return w === 'pluck' ? 'sawtooth' : w === 'saw' ? 'sawtooth' : w === 'tri' ? 'triangle' : w; }

/** Song rendern (zwischengespeichert). */
export function renderSong(song: SongDef): Promise<AudioBuffer> {
  const hit = cache.get(song.id);
  if (hit) return hit;
  const p = (async () => {
    const len = songSeconds(song) + 1.5;
    const ctx = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
    const master = ctx.createGain(); master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    const noise = noiseBuffer(ctx);
    const spb = 60 / song.bpm, off = songOffset(song);
    const at = (e: SongEvent) => off + e.beat * spb;
    // Gemeinsame Filter je Stimme
    const leadLp = ctx.createBiquadFilter(); leadLp.type = 'lowpass'; leadLp.frequency.value = 3200; leadLp.Q.value = 2;
    const leadG = ctx.createGain(); leadG.gain.value = 0.16; leadLp.connect(leadG).connect(master);
    const padLp = ctx.createBiquadFilter(); padLp.type = 'lowpass'; padLp.frequency.value = 1400;
    const padG = ctx.createGain(); padG.gain.value = 0.07; padLp.connect(padG).connect(master);
    const bassLp = ctx.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 520; bassLp.Q.value = 3;
    const bassG = ctx.createGain(); bassG.gain.value = 0.32; bassLp.connect(bassG).connect(master);
    // Echo für den Lead (Synthwave-Gefühl)
    const delay = ctx.createDelay(1); delay.delayTime.value = spb * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    leadG.connect(delay).connect(fb).connect(delay); fb.connect(master);

    const env = (g: GainNode, t: number, a: number, peak: number, d: number) => {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
    };
    const noiseHit = (t: number, f: number, type: BiquadFilterType, q: number, peak: number, d: number) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loopStart = 0;
      const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
      const g = ctx.createGain(); env(g, t, 0.001, peak, d);
      src.connect(bf).connect(g).connect(master);
      src.start(t, (t * 7.31) % 0.9, d + 0.05);
    };
    for (const e of songEvents(song)) {
      const t = at(e);
      switch (e.voice) {
        case 'kick': {
          const o = ctx.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
          const g = ctx.createGain(); env(g, t, 0.002, 0.9 * e.vel, 0.28);
          o.connect(g).connect(master); o.start(t); o.stop(t + 0.35);
          break;
        }
        case 'snare': noiseHit(t, 1800, 'bandpass', 0.8, 0.5 * e.vel, 0.16); { const o = ctx.createOscillator(); o.frequency.value = 190; const g = ctx.createGain(); env(g, t, 0.001, 0.25 * e.vel, 0.09); o.connect(g).connect(master); o.start(t); o.stop(t + 0.12); } break;
        case 'clap': for (let k = 0; k < 3; k++) noiseHit(t + k * 0.012, 1300, 'bandpass', 1.2, 0.35 * e.vel, 0.07 + k * 0.03); break;
        case 'hat': noiseHit(t, 8000, 'highpass', 0.7, 0.14 * e.vel, 0.045); break;
        case 'perc': { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(song.genre === 'Latin-Elektro' ? 620 : 900, t); const g = ctx.createGain(); env(g, t, 0.001, 0.12 * e.vel, 0.06); o.connect(g).connect(master); o.start(t); o.stop(t + 0.1); break; }
        case 'bass': case 'lead': case 'pad': {
          const wave = e.voice === 'bass' ? song.bassWave : e.voice === 'lead' ? song.leadWave : song.padWave;
          const dur = (e.len ?? 0.25) * spb;
          const o = ctx.createOscillator(); o.type = oscType(wave); o.frequency.value = midiHz(e.midi ?? 60);
          if (e.voice === 'pad') o.detune.value = (e.midi ?? 0) % 2 ? 7 : -7;
          const g = ctx.createGain();
          const pluck = wave === 'pluck';
          if (e.voice === 'pad') { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.4); g.gain.setValueAtTime(1, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur); }
          else env(g, t, 0.005, 1, pluck ? Math.min(0.25, dur) : Math.max(0.08, dur * 0.9));
          o.connect(g).connect(e.voice === 'bass' ? bassLp : e.voice === 'lead' ? leadLp : padLp);
          o.start(t); o.stop(t + dur + 0.3);
          break;
        }
      }
    }
    return ctx.startRendering();
  })();
  cache.set(song.id, p);
  order.push(song.id);
  while (order.length > 3) { const old = order.shift()!; if (old !== song.id) cache.delete(old); }
  return p;
}

/**
 * Beschallung eines Innenraums: Quelle → Tiefpass → Pegel → Musik-Bus. Steuerung pro Bild über
 * level (0..1) und cutoff (Hz). Startet Songs an einer Server-Zeit (alle Spieler hören dieselbe Stelle).
 */
export class VenuePA {
  private src: AudioBufferSourceNode | null = null;
  private lp: BiquadFilterNode;
  private gain: GainNode;
  private song = '';
  private t0 = 0;
  private loading = '';
  /** Aktueller Song + Startzeit (Server-ms) – für Beat-Sync von Licht und Tänzern */
  playing: { song: SongDef; t0: number } | null = null;

  constructor(private eng: AudioEngine) {
    const ctx = eng.ctx;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.8;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.lp.connect(this.gain).connect(eng.bus('music').input);
  }

  /** Song `id` ab Server-Zeit t0 spielen (serverNow = aktuelle Server-Zeit in ms). loop: neu starten am Ende. */
  play(id: string | null, t0: number, serverNow: number, loop = false) {
    if (!id) { this.stop(); this.song = ''; this.playing = null; return; }
    const song = id === 'lounge' ? LOUNGE : SONG_BY_ID[id];
    if (!song) return;
    this.playing = { song, t0 };
    if (this.song === id && this.t0 === t0 && this.src) return;
    this.song = id; this.t0 = t0;
    this.loading = `${id}@${t0}`;
    const key = this.loading;
    void renderSong(song).then((buf) => {
      if (this.loading !== key) return;
      this.stop();
      const ctx = this.eng.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = loop;
      src.connect(this.lp);
      const elapsed = Math.max(0, (serverNow - t0) / 1000 + (performance.now() - this.reqAt) / 1000);
      const offset = loop ? elapsed % buf.duration : elapsed;
      if (offset < buf.duration) src.start(ctx.currentTime + 0.02, offset);
      this.src = src;
    });
    this.reqAt = performance.now();
  }
  private reqAt = 0;

  stop() { try { this.src?.stop(); } catch { /* schon gestoppt */ } this.src?.disconnect(); this.src = null; }

  /** Pro Bild: Pegel 0..1 und Grenzfrequenz (Dämpfung durch Wände/Entfernung). */
  set(level: number, cutoff: number) {
    const t = this.eng.ctx.currentTime;
    this.gain.gain.setTargetAtTime(level, t, 0.15);
    this.lp.frequency.setTargetAtTime(cutoff, t, 0.12);
  }

  /** Beat-Position (Beats seit dem ersten Schlag) zur Server-Zeit now; -1 = keine Musik. */
  beat(now: number): number {
    const p = this.playing;
    if (!p) return -1;
    return ((now - p.t0) / 1000 - songOffset(p.song)) * (p.song.bpm / 60);
  }
}

/** Song für das Tanz-Minispiel: eigener Ausgang (direkt, laut), gestartet zu einer exakten Audio-Zeit. */
export class DanceTrack {
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  /** Audio-Zeit (ctx.currentTime), zu der Songzeit 0 erklingt */
  startAt = 0;
  constructor(private eng: AudioEngine) {
    this.gain = eng.ctx.createGain(); this.gain.gain.value = 0.95;
    this.gain.connect(eng.bus('music').input);
  }
  async start(song: SongDef, audioStart: number) {
    const buf = await renderSong(song);
    this.stop();
    const ctx = this.eng.ctx;
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(this.gain);
    const now = ctx.currentTime;
    if (audioStart >= now) src.start(audioStart);
    else src.start(now, now - audioStart);
    this.startAt = audioStart;
    this.src = src;
  }
  stop() { try { this.src?.stop(); } catch { /* egal */ } this.src?.disconnect(); this.src = null; }
  /** Songzeit (s) – ohne Latenzausgleich */
  time() { return this.eng.ctx.currentTime - this.startAt; }
  /** Klick (Metronom für den Kalibrier-Test) zur Audio-Zeit t */
  click(t: number, hi = false) {
    const ctx = this.eng.ctx;
    const o = ctx.createOscillator(); o.frequency.value = hi ? 1760 : 1320;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.002); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g).connect(this.eng.bus('ui').input); o.start(t); o.stop(t + 0.1);
  }
}

export { songSeconds };
