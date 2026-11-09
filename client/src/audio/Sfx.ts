// Einstieg ins Audio-System für das Spiel: startet die AudioEngine nach der ersten Nutzeraktion,
// führt Hörer, Hallzone, Verdeckung und Zonen-Lazy-Loading nach und bietet einfache Aufrufe
// (UI-Sounds, 3D-Effekte, Waffen) plus das Fahrzeug-Audio (VehicleAudio).
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { AudioEngine, type Vec3 } from './AudioEngine';
import { AudioEnvironment } from './Environment';
import { BUSES, SPATIAL } from './manifest';
import { VehicleAudio } from './VehicleAudio';

export type UiSound = 'open' | 'close' | 'click' | 'good' | 'bad' | 'info' | 'money' | 'toggle' | 'notice';

export class Sfx {
  engine: AudioEngine | null = null;
  /** Fahrzeug-Audio (null, solange Audio nicht freigegeben ist) */
  car: VehicleAudio | null = null;
  private env: AudioEnvironment | null = null;
  private envT = 0; private zoneT = 0;
  zone = '';

  /** Muss aus einer Nutzeraktion heraus (Klick/Enter) aufgerufen werden – Autoplay-Regeln. */
  init() {
    if (this.engine) { this.engine.start(); return; }
    try { this.engine = new AudioEngine(); } catch (e) { console.warn('[audio] Web Audio nicht verfügbar', e); return; }
    this.engine.start();
    this.car = new VehicleAudio(this.engine);
    // Fahrzeug-Puffer schon jetzt erzeugen (kein Ruckler beim ersten Einsteigen)
    // Häufige Klassen zuerst (Verkehr), Effekte, dann der Rest
    const first = ['sedan', 'compact', 'suv', 'muscle', 'sport', 'truck', 'bike', 'boat', 'airboat'];
    const eng = first.flatMap((set) => ['idle', 'low', 'mid', 'high'].flatMap((l) => [`veh.engine.${set}.${l}.on`, `veh.engine.${set}.${l}.off`]));
    this.engine.bank.warmGradually([
      'veh.crash.thud', 'veh.crash.crunch', 'veh.shift', 'veh.tire.squeal', 'veh.roll.asphalt', ...eng.slice(0, 16),
      'veh.backfire', 'veh.curb', 'veh.land', 'veh.crash.debris', 'veh.scrape', 'veh.roll.grass', 'veh.roll.gravel', 'veh.roll.sand',
      ...eng.slice(16), 'veh.prop.airboat', 'veh.water.rush', 'veh.water.slap', 'veh.explosion', 'veh.crash.glass', 'veh.sparks',
      'veh.dmg.hiss', 'veh.dmg.fire', 'veh.dmg.sputter', 'veh.turbo.bov', 'veh.airbrake', 'veh.nitro', 'veh.tire.burst', 'veh.roll.wet',
    ]);
  }

  /** Karte für Hall/Verdeckung/Zonen setzen. */
  setWorld(map: WorldMap) {
    this.env = new AudioEnvironment(map);
    if (this.engine) this.engine.occluder = (sx, sz, lx, lz) => this.env!.occlusion(sx, sz, lx, lz);
  }

  /** Einmal pro Bild: Hörer an der Spielfigur, Blickrichtung der Kamera. */
  frame(dt: number, x: number, y: number, z: number, fx: number, fz: number) {
    const e = this.engine;
    if (!e) return;
    e.setListener(x, y + 1.6, z, fx, fz, dt);
    if (this.env) {
      if (!e.occluder) e.occluder = (sx, sz, lx, lz) => this.env!.occlusion(sx, sz, lx, lz);
      this.envT -= dt;
      if (this.envT <= 0) { this.envT = 0.3; e.setEnvironment(this.env.reverbAt(x, z)); }
      this.zoneT -= dt;
      if (this.zoneT <= 0) {
        this.zoneT = 1;
        this.zone = this.env.zoneAt(x, z);
        e.bank.setZones(this.env.zonesNear(x, z));
      }
    }
    e.update();
  }

  ui(name: UiSound, vol = 0.6) { this.engine?.play(`ui.${name}`, { vol }); }

  /** Manifest-Sound an einer Weltposition (null = 2D). */
  at(id: string, pos: Vec3 | null, vol = 1) { this.engine?.play(id, { pos, vol }); }

  /** Radio/Ambience kurz absenken (Missionsansage, Dialog). */
  duck(db = -8, hold = 1.5) { this.engine?.duck(db, hold); }

  /** Prozeduraler Waffen-Sound (Spec 5.4: dumpf, comicartig) – Phase 3 ersetzt ihn durch Schichten. */
  weapon(kind: 'swing' | 'shot' | 'heavy' | 'hit', pos: Vec3 | null) {
    const e = this.engine;
    if (!e) return;
    if (kind === 'hit') { e.play('hit.punch', { pos, vol: 0.9 }); return; }
    const v = e.voice({ name: `weapon.${kind}`, bus: 'weapons', pos, spatial: pos ? SPATIAL.weapon : undefined, priority: 0.8 }, 1);
    if (!v) return;
    const ctx = e.ctx, t = ctx.currentTime;
    const dur = kind === 'heavy' ? 0.28 : kind === 'shot' ? 0.14 : 0.1;
    const out = ctx.createGain();
    out.connect(v.input);
    out.gain.setValueAtTime(kind === 'swing' ? 0.25 : 0.6, t);
    out.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f0 = kind === 'heavy' ? 120 : kind === 'shot' ? 220 : 400;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f0 * 0.25), t + dur);
    osc.connect(out); osc.start(t); osc.stop(t + dur);
    v.addSource(osc);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = kind === 'swing' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'swing' ? 1800 : 1400;
    src.connect(f).connect(out); src.start(t);
    v.addSource(src);
    v.setVolume(1, 0.001);
  }

  /**
   * „Gemurmel“: unverständliche Silben (Formant-gefilterte Sägezahn-Stimme) zu einer Sprechblase –
   * Länge nach Textlänge, Tonhöhe und Vokale je NPC (seed) stabil. Leise, nur in der Nähe hörbar.
   */
  murmur(pos: Vec3, seed: number, textLen: number) {
    const e = this.engine;
    if (!e) return;
    const v = e.voice({ name: 'npc.murmur', bus: 'voice', pos, spatial: SPATIAL.voice, priority: 0.2 }, 1);
    if (!v) return;
    const ctx = e.ctx, t0 = ctx.currentTime + 0.02;
    let s = (seed * 2654435761 + textLen * 97) >>> 0;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const base = 95 + ((seed * 37) % 100) * 1.5; // 95–245 Hz: tiefe bis hohe Stimme
    const syl = Math.max(3, Math.min(10, Math.round(textLen / 3.2)));
    const FORMANTS: [number, number][] = [[730, 1090], [530, 1840], [300, 2300], [570, 840], [320, 800]]; // a e i o u
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(v.input);
    let t = t0;
    for (let i = 0; i < syl; i++) {
      const dur = 0.07 + rnd() * 0.07;
      if (rnd() < 0.18) { t += 0.09 + rnd() * 0.08; continue; } // kurze Sprechpause
      const f0 = base * (0.85 + rnd() * 0.4);
      const [f1, f2] = FORMANTS[Math.floor(rnd() * FORMANTS.length)];
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.linearRampToValueAtTime(f0 * (0.9 + rnd() * 0.2), t + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.5, t + dur * 0.3);
      env.gain.linearRampToValueAtTime(0.0001, t + dur);
      for (const [f, q, g] of [[f1, 6, 1], [f2, 8, 0.5]] as const) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
        const gg = ctx.createGain(); gg.gain.value = g * 2.2;
        osc.connect(bp).connect(gg).connect(env);
      }
      env.connect(out);
      osc.start(t); osc.stop(t + dur + 0.02);
      v.addSource(osc);
      t += dur + 0.015 + rnd() * 0.03;
    }
    v.setVolume(0.22, 0.01);
  }

  /** Text fürs Debug-Overlay (F3 → Audio). */
  debugText(): string {
    const e = this.engine;
    if (!e) return 'Audio noch nicht gestartet (erst nach einer Nutzeraktion).';
    const L = e.listener;
    const lines = [
      `Kontext ${e.ctx.state} · ${e.ctx.sampleRate} Hz · Latenz ${(e.ctx.baseLatency * 1000).toFixed(0)} ms`,
      `Hallzone ${e.env} · Zone ${this.zone} · Stimmen ${e.voices.length}/32 · verworfen ${e.stolen}`,
      `geladen ${(e.bank.bytes / 1024).toFixed(0)} KB · offen ${e.bank.pending} · Bank-Version ${e.bank.version}`,
      '',
      'Bus-Pegel (dBFS):',
      BUSES.map((b) => `${b.padEnd(8)} ${e.busLevel(b).toFixed(0).padStart(4)}  ${'█'.repeat(Math.max(0, Math.round((e.busLevel(b) + 60) / 3)))}`).join('\n'),
      '',
      this.car?.debug() ?? '',
      '',
      'Aktive Stimmen (Name · Bus · Entfernung · Hörbarkeit · Verdeckung):',
    ];
    const vs = [...e.voices].filter((v) => !v.dead).sort((a, b) => b.audibility() - a.audibility());
    for (const v of vs.slice(0, 32)) {
      const d = v.pos ? `${Math.hypot(v.pos.x - L.x, v.pos.z - L.z).toFixed(0).padStart(4)} m` : '   2D ';
      lines.push(`${v.o.name.padEnd(28).slice(0, 28)} ${v.o.bus.padEnd(8)} ${d} ${v.audibility().toFixed(2)} ${v.occl > 0 ? v.occl.toFixed(2) : ''}`);
    }
    return lines.join('\n');
  }
}
