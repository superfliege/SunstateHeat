// Fahrzeug-Audio (höchste Priorität fürs Fahrgefühl):
//   Motor     pro Klangklasse 4 Drehzahl-Layer (Leerlauf/niedrig/mittel/hoch) x Last/Schiebebetrieb,
//             Equal-Power-Crossfade nach Drehzahl, Tonhöhe innerhalb des Layers, Doppler bei fremden.
//   Antrieb   Gangwechsel (Klack + Lastabfall), Auspuffknallen beim Gaswegnehmen (Sport/Muscle/
//             Motorrad), Turbo-Pfeifen + Blow-off, Druckluftbremse (Truck), Nitro.
//   Reifen    Quietschen nach Schlupf (Pegel + Tonhöhe), Abrollen je Untergrund (Asphalt, Schotter,
//             Sand, Gras, nass), Federung: Bordstein-Poltern, Landung nach Sprüngen.
//   Crash     3 Stärken, geschichtet aus Aufprall + Blech + Glas + Trümmern; Schleif-Loop + Funken.
//   Schaden   Motorstottern, Klappern loser Teile, Zischen (Rauch), Feuer-Loop, Explosion.
//   Spezial   Airboat-Propeller, Boote mit Wasserrauschen/Klatschen, Polizei-Sirenen (3 Muster),
//             Hupe je Klasse.
// Alle Werte kommen lokal aus der Simulation (Drehzahl, Schlupf, Ereignisse) – nichts übers Netz.
import { Tile } from '../../../shared/src/world/tiles';
import type { HandlingClass } from '../../../shared/src/sim/handling';
import { ENGINE_LAYERS, SPATIAL, type EngineSet } from './manifest';
import { ENGINE_SYNTH, layerRpm } from './procedural';
import type { AudioEngine, LoopHandle, Vec3, Voice } from './AudioEngine';

interface HornSpec { f: number[]; wave: OscillatorType; lp: number; vol: number }
interface ClassSound { set: EngineSet; turbo: number; backfire: boolean; airBrake: boolean; horn: HornSpec; vol: number }

/** Klang je Handling-Klasse */
const CLASS_SOUND: Record<HandlingClass, ClassSound> = {
  compact: { set: 'compact', turbo: 0, backfire: false, airBrake: false, horn: { f: [440, 554], wave: 'square', lp: 2400, vol: 0.06 }, vol: 0.85 },
  sedan: { set: 'sedan', turbo: 0, backfire: false, airBrake: false, horn: { f: [392, 494], wave: 'square', lp: 1900, vol: 0.07 }, vol: 0.9 },
  sport: { set: 'sport', turbo: 1, backfire: true, airBrake: false, horn: { f: [466, 587], wave: 'sawtooth', lp: 2600, vol: 0.06 }, vol: 1 },
  muscle: { set: 'muscle', turbo: 0, backfire: true, airBrake: false, horn: { f: [311, 392], wave: 'sawtooth', lp: 1700, vol: 0.08 }, vol: 1.05 },
  suv: { set: 'suv', turbo: 0.4, backfire: false, airBrake: false, horn: { f: [349, 440], wave: 'square', lp: 1700, vol: 0.08 }, vol: 0.95 },
  truck: { set: 'truck', turbo: 0.7, backfire: false, airBrake: true, horn: { f: [185, 233, 277], wave: 'sawtooth', lp: 1300, vol: 0.1 }, vol: 1.1 },
  bike: { set: 'bike', turbo: 0, backfire: true, airBrake: false, horn: { f: [523], wave: 'square', lp: 2800, vol: 0.05 }, vol: 0.9 },
  police: { set: 'muscle', turbo: 0, backfire: false, airBrake: false, horn: { f: [330, 415], wave: 'sawtooth', lp: 1900, vol: 0.08 }, vol: 1 },
  boat: { set: 'boat', turbo: 0, backfire: false, airBrake: false, horn: { f: [147, 185], wave: 'sawtooth', lp: 900, vol: 0.11 }, vol: 1 },
  airboat: { set: 'airboat', turbo: 0, backfire: false, airBrake: false, horn: { f: [220, 277], wave: 'sawtooth', lp: 1200, vol: 0.09 }, vol: 1 },
  tank: { set: 'truck', turbo: 0.3, backfire: false, airBrake: false, horn: { f: [110, 147], wave: 'sawtooth', lp: 800, vol: 0.12 }, vol: 1.25 },
};
export const classSound = (cls: HandlingClass) => CLASS_SOUND[cls] ?? CLASS_SOUND.sedan;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ------------------------------------------------------------------ Motor-Rig (eine Stimme pro Fahrzeug)
interface Src { src: AudioBufferSourceNode; gain: GainNode }

class EngineRig {
  readonly voice: Voice;
  private layers: { base: number; on: Src; off: Src | null }[] = [];
  private extra: { kind: 'prop' | 'water'; s: Src; base: number }[] = [];
  readonly version: number;
  load = 0.3;
  dip = 0; // Restzeit Lastabfall (Gangwechsel/Stottern)
  seen = true;

  constructor(private eng: AudioEngine, readonly cs: ClassSound, pos: Vec3 | null, withOff: boolean, water: boolean) {
    this.version = eng.bank.version;
    const v = eng.voice({ name: `veh.engine.${cs.set}`, bus: 'vehicles', pos, spatial: pos ? SPATIAL.vehicle : undefined, priority: pos ? 0.85 : 1, persistent: true, wet: pos ? 1 : 0.6 });
    if (!v) throw new Error('kein Stimmen-Budget');
    this.voice = v;
    v.setVolume(0, 0.001);
    const mk = (id: string, fallbackBase: number): { s: Src; base: number } | null => {
      const variant = eng.bank.pick(id);
      if (!variant) return null;
      const gain = eng.ctx.createGain(); gain.gain.value = 0; gain.connect(v.input);
      const src = eng.loopSource(v, variant);
      src.disconnect(); src.connect(gain);
      return { s: { src, gain }, base: variant.rpm ?? fallbackBase };
    };
    for (const layer of ENGINE_LAYERS) {
      const on = mk(`veh.engine.${cs.set}.${layer}.on`, layerRpm(cs.set, layer));
      if (!on) continue;
      const off = withOff ? mk(`veh.engine.${cs.set}.${layer}.off`, layerRpm(cs.set, layer)) : null;
      this.layers.push({ base: on.base, on: on.s, off: off?.s ?? null });
    }
    this.layers.sort((a, b) => a.base - b.base);
    if (cs.set === 'airboat') { const p = mk('veh.prop.airboat', 2400); if (p) this.extra.push({ kind: 'prop', ...p }); }
    if (water) { const w = mk('veh.water.rush', 1); if (w) this.extra.push({ kind: 'water', ...w }); }
  }

  /**
   * rpm/idle/redline des echten Fahrzeugs werden auf den Drehzahlbereich der Klangklasse abgebildet.
   * load 0..1 (Gas), vol linear, doppler Faktor, speed m/s (Wasser/Propeller).
   */
  update(dt: number, rpm: number, idle: number, redline: number, load: number, vol: number, doppler: number, speed: number) {
    const S = ENGINE_SYNTH[this.cs.set];
    const r = Math.max(-0.1, Math.min(1.08, (rpm - idle) / Math.max(1, redline - idle)));
    const setRpm = S.idle + r * (S.redline - S.idle);
    this.load += (load - this.load) * Math.min(1, dt * (load > this.load ? 12 : 6));
    if (this.dip > 0) this.dip -= dt;
    const t = this.eng.ctx.currentTime;
    const L = this.layers;
    // Equal-Power-Crossfade zwischen den beiden benachbarten Layern
    let i = 0;
    while (i < L.length - 1 && setRpm > L[i + 1].base) i++;
    const x = L.length > 1 && setRpm > L[0].base ? clamp01((setRpm - L[i].base) / Math.max(1, (L[i + 1]?.base ?? L[i].base) - L[i].base)) : 0;
    const onG = Math.sqrt(0.1 + 0.9 * this.load), offG = Math.sqrt(1 - this.load) * 0.95;
    for (let k = 0; k < L.length; k++) {
      const w = k === i ? Math.cos((x * Math.PI) / 2) : k === i + 1 ? Math.sin((x * Math.PI) / 2) : 0;
      const rate = Math.max(0.35, Math.min(2.6, (setRpm / L[k].base) * doppler));
      const l = L[k];
      l.on.src.playbackRate.setTargetAtTime(rate, t, 0.025);
      l.on.gain.gain.setTargetAtTime(w * (l.off ? onG : 1), t, 0.03);
      if (l.off) { l.off.src.playbackRate.setTargetAtTime(rate, t, 0.025); l.off.gain.gain.setTargetAtTime(w * offG, t, 0.03); }
    }
    for (const e of this.extra) {
      if (e.kind === 'prop') {
        e.s.src.playbackRate.setTargetAtTime((0.45 + Math.max(0, r) * 0.9) * doppler, t, 0.05);
        e.s.gain.gain.setTargetAtTime(0.5 + this.load * 0.7, t, 0.05);
      } else {
        e.s.src.playbackRate.setTargetAtTime((0.75 + Math.min(1, speed / 30) * 0.5) * doppler, t, 0.1);
        e.s.gain.gain.setTargetAtTime(Math.min(1, speed / 14) * 0.8, t, 0.1);
      }
    }
    const level = this.cs.vol * (0.55 + 0.45 * this.load) * (0.7 + 0.3 * clamp01(r)) * (this.dip > 0 ? 0.4 : 1);
    this.voice.setVolume(vol * level, this.dip > 0 ? 0.008 : 0.04);
  }

  stop() { this.voice.stop(0.15); }
}

// ------------------------------------------------------------------ Loop-Slot (wird bei Bedarf gestartet und nach Stille beendet)
class LoopSlot {
  h: LoopHandle | null = null;
  private quiet = 0;
  constructor(private eng: AudioEngine, readonly id: string, private spatial: boolean) {}
  set(gain: number, rate: number, dt: number, pos: Vec3 | null = null) {
    const t = this.eng.ctx.currentTime;
    if (gain > 0.01 && (!this.h || this.h.voice.dead)) this.h = this.eng.loop(this.id, this.spatial ? pos : null);
    if (!this.h) return;
    if (gain <= 0.005) { this.quiet += dt; if (this.quiet > 1.5) { this.stop(); return; } } else this.quiet = 0;
    this.h.src.playbackRate.setTargetAtTime(rate, t, 0.04);
    this.h.voice.setVolume(gain, 0.05);
    if (pos && this.spatial) this.h.voice.setPos(pos.x, pos.y, pos.z);
  }
  stop() { this.h?.voice.stop(0.12); this.h = null; this.quiet = 0; }
}

// ------------------------------------------------------------------ Eingaben
export interface OwnCarInput {
  cls: HandlingClass;
  rpm: number; idle: number; redline: number;
  load: number; thr: number; brk: number; shifts: number;
  boost: boolean; speed: number;
  slip: number[]; surf: number[]; comp: number[]; air: number;
  water: boolean; wet: boolean; scrape: number;
  /** Rauchstufe 0..3, Motorschaden 0..1, aktueller Leistungsfaktor (Stottern), lose Teile */
  smoke: number; engineDmg: number; power: number; loose: number; burning: boolean; wreck: boolean;
}

export interface RemoteCarInput {
  cls: HandlingClass;
  pos: Vec3; vx: number; vz: number; fwdX: number; fwdZ: number;
  rpm: number; idle: number; redline: number; boost: boolean; water: boolean;
}

const HARD = new Set<number>([Tile.ROAD, Tile.BRIDGE, Tile.PLAZA, Tile.SIDEWALK, Tile.DOCK]);
const GRAVEL = new Set<number>([Tile.DIRT, Tile.BADLANDS, Tile.ROCK]);
const SAND = new Set<number>([Tile.SAND, Tile.DESERT]);
const GRASS = new Set<number>([Tile.GRASS, Tile.FARM, Tile.FIELD]);

// ------------------------------------------------------------------ Hauptklasse
export class VehicleAudio {
  private own: EngineRig | null = null;
  private remotes = new Map<number, EngineRig>();
  private remoteSqueal = new Map<number, LoopSlot>();
  private horns = new Map<number, { v: Voice; o: OscillatorNode[]; seen: boolean }>();
  private sirens = new Map<number, { v: Voice; osc: OscillatorNode; lfo: OscillatorNode; depth: GainNode; pattern: number; next: number; seen: boolean }>();
  private fires = new Map<number, LoopSlot & { seen?: boolean }>();
  private loops: Record<string, LoopSlot>;
  private turbo: { v: Voice; osc: OscillatorNode; p: number } | null = null;
  // Zustand des eigenen Fahrzeugs
  private lastShifts = -1; private lastThr = 0; private popT = 0; private lastSpeed = 0;
  private prevComp = [0, 0, 0, 0]; private prevAir = 0; private curbCd = 0; private sputCd = 0; private airCd = 0;
  /** Debug */
  info = '';

  constructor(private eng: AudioEngine) {
    const s = (id: string) => new LoopSlot(eng, id, false);
    this.loops = {
      squeal: s('veh.tire.squeal'), asphalt: s('veh.roll.asphalt'), gravel: s('veh.roll.gravel'), sand: s('veh.roll.sand'),
      grass: s('veh.roll.grass'), wet: s('veh.roll.wet'), scrape: s('veh.scrape'), sparks: s('veh.sparks'),
      hiss: s('veh.dmg.hiss'), fire: s('veh.dmg.fire'), nitro: s('veh.nitro'),
    };
  }

  private get now() { return this.eng.ctx.currentTime; }

  begin() {
    for (const r of this.remotes.values()) r.seen = false;
    for (const h of this.horns.values()) h.seen = false;
    for (const s of this.sirens.values()) s.seen = false;
    for (const f of this.fires.values()) f.seen = false;
  }

  end() {
    for (const [id, r] of this.remotes) if (!r.seen || r.voice.dead) { r.stop(); this.remotes.delete(id); this.remoteSqueal.get(id)?.stop(); this.remoteSqueal.delete(id); }
    for (const [id, h] of this.horns) if (!h.seen) { h.v.stop(0.06); this.horns.delete(id); }
    for (const [id, s] of this.sirens) if (!s.seen) { s.v.stop(0.4); this.sirens.delete(id); }
    for (const [id, f] of this.fires) if (!f.seen) { f.stop(); this.fires.delete(id); }
  }

  /** Kein eigenes Fahrzeug (zu Fuß): Motor und Dauergeräusche abbauen. */
  noOwnCar() { if (this.own || this.turbo || Object.values(this.loops).some((l) => l.h)) this.leaveOwn(); }

  private leaveOwn() {
    this.own?.stop(); this.own = null;
    for (const l of Object.values(this.loops)) l.stop();
    this.turbo?.v.stop(0.1); this.turbo = null;
    this.lastShifts = -1; this.popT = 0;
  }

  // ---------------------------------------------------------------- eigenes Fahrzeug
  /** Pro Bild; liefert true, wenn es im Auspuff knallte (für die Flamme). */
  ownCar(o: OwnCarInput, dt: number): boolean {
    const cs = classSound(o.cls);
    if (this.own && (this.own.cs !== cs || this.own.version !== this.eng.bank.version)) { this.own.stop(); this.own = null; }
    if (!this.own) { try { this.own = new EngineRig(this.eng, cs, null, true, o.water); } catch { return false; } }
    const rig = this.own;
    const r = (o.rpm - o.idle) / Math.max(1, o.redline - o.idle);
    // Gangwechsel: Klack + Lastabfall (Hochschalten unter Last: bei Sportlern ein kurzes Knallen)
    if (this.lastShifts >= 0 && o.shifts !== this.lastShifts) {
      rig.dip = 0.09;
      this.eng.play('veh.shift', { vol: 0.35 + o.load * 0.3 });
      if (cs.backfire && o.load > 0.7 && Math.random() < 0.5) this.eng.play('veh.backfire', { vol: 0.35, delay: 0.03 });
    }
    this.lastShifts = o.shifts;
    // Motorschaden: Stottern
    if (o.engineDmg > 0.5 && o.power < 0.3) {
      rig.dip = Math.max(rig.dip, 0.05);
      if (this.sputCd <= 0) { this.eng.play('veh.dmg.sputter', { vol: 0.6 }); this.sputCd = 0.35 + Math.random() * 0.4; }
    }
    this.sputCd -= dt;
    rig.update(dt, o.rpm, o.idle, o.redline, o.wreck ? 0 : o.load, o.wreck ? 0 : 1, 1, o.speed);
    // Auspuffknallen beim Gaswegnehmen aus hoher Drehzahl
    let popped = false;
    if (cs.backfire && this.lastThr > 0.6 && o.thr < 0.1 && r > 0.5) this.popT = 0.5 + Math.random() * 0.4;
    if (this.popT > 0) {
      this.popT -= dt;
      if (Math.random() < dt * 9) { this.eng.play('veh.backfire', { vol: 0.5 + Math.random() * 0.3 }); popped = true; }
    }
    // Turbo: Pfeifen nach Ladedruck, Blow-off beim Gaswegnehmen
    if (cs.turbo > 0) {
      if (!this.turbo || this.turbo.v.dead) {
        const v = this.eng.voice({ name: 'veh.turbo', bus: 'vehicles', priority: 0.7, persistent: true, wet: 0.3 });
        if (v) {
          const osc = this.eng.ctx.createOscillator(); osc.type = 'sine';
          const bp = this.eng.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
          osc.connect(bp).connect(v.input); osc.start(); v.addSource(osc); v.setVolume(0, 0.001);
          this.turbo = { v, osc, p: 0 };
        }
      }
      if (this.turbo) {
        const tb = this.turbo;
        const target = o.load * clamp01((r - 0.25) / 0.6);
        tb.p += (target - tb.p) * Math.min(1, dt * (target > tb.p ? 2.5 : 8));
        if (this.lastThr > 0.7 && o.thr < 0.15 && tb.p > 0.4) { this.eng.play('veh.turbo.bov', { vol: 0.35 * cs.turbo + tb.p * 0.3 }); tb.p *= 0.2; }
        tb.osc.frequency.setTargetAtTime(1800 + 5200 * tb.p, this.now, 0.05);
        tb.v.setVolume(tb.p * (0.3 + tb.p) * 0.09 * cs.turbo, 0.05);
      }
    }
    this.lastThr = o.thr;
    // Druckluftbremse (Truck) beim Anhalten
    this.airCd -= dt;
    if (cs.airBrake && this.lastSpeed >= 0.7 && o.speed < 0.7 && o.brk > 0.2 && this.airCd <= 0) { this.eng.play('veh.airbrake', { vol: 0.6 }); this.airCd = 4; }
    this.lastSpeed = o.speed;

    // Reifen & Untergrund
    if (o.water) {
      for (const k of ['squeal', 'asphalt', 'gravel', 'sand', 'grass', 'wet'] as const) this.loops[k].set(0, 1, dt);
      if (Math.random() < dt * Math.min(3, o.speed / 6)) this.eng.play('veh.water.slap', { vol: 0.25 + Math.min(0.4, o.speed / 40) });
    } else this.tires(o, dt);

    // Federung: Bordstein-Poltern, Landung
    this.curbCd -= dt;
    let bump = 0;
    for (let i = 0; i < 4; i++) {
      const v = dt > 0 ? (o.comp[i] - this.prevComp[i]) / dt : 0;
      bump = Math.max(bump, v);
      this.prevComp[i] = o.comp[i];
    }
    if (!o.water && this.prevAir > 0.3 && o.air === 0) {
      this.eng.play('veh.land', { vol: Math.min(1, 0.3 + this.prevAir / 1.2) });
      this.eng.play('veh.crash.thud', { vol: Math.min(0.6, this.prevAir / 2), rate: 0.75 });
    } else if (!o.water && bump > 0.9 && this.curbCd <= 0) {
      this.eng.play('veh.curb', { vol: Math.min(0.9, (bump - 0.9) / 2.5 + 0.2) });
      this.curbCd = 0.12;
    }
    this.prevAir = o.air;

    // Schaden
    const sc = clamp01((o.scrape - 1.5) / 10);
    this.loops.scrape.set(sc * 0.75, 0.9 + Math.random() * 0.15, dt);
    this.loops.sparks.set(sc * 0.5, 1, dt);
    this.loops.hiss.set([0, 0.1, 0.2, 0.3][o.smoke] ?? 0, 1, dt);
    this.loops.fire.set(o.burning ? 0.7 : 0, 1, dt);
    this.loops.nitro.set(o.boost ? 0.4 : 0, 1, dt);
    if (o.loose > 0 && Math.random() < dt * o.loose * (0.3 + o.speed / 18 + bump * 2)) this.eng.play('veh.rattle', { vol: 0.2 + Math.min(0.35, bump * 0.2 + o.speed / 80) });
    this.info = `eigen ${cs.set} rpm ${Math.round(o.rpm)} last ${rig.load.toFixed(2)} turbo ${this.turbo?.p.toFixed(2) ?? '-'}`;
    return popped;
  }

  private tires(o: OwnCarInput, dt: number) {
    let hard = 0, gravel = 0, sand = 0, grass = 0, wheels = 0, slip = 0;
    for (let i = 0; i < 4; i++) {
      const s = o.surf[i];
      if (s === 255) continue;
      wheels++;
      slip = Math.max(slip, o.slip[i]);
      if (HARD.has(s)) hard++;
      else if (GRAVEL.has(s)) gravel++;
      else if (SAND.has(s) || s === Tile.SWAMP) sand++;
      else if (GRASS.has(s)) grass++;
      else hard++;
    }
    const n = Math.max(1, wheels);
    const roll = Math.pow(Math.min(1, o.speed / 28), 0.8);
    const rate = 0.7 + Math.min(1, o.speed / 40) * 0.6;
    const sq = clamp01((slip - 1.5) / 8) * (hard / n) * (o.wet ? 0.45 : 1);
    this.loops.squeal.set(sq * 0.6, 0.86 + sq * 0.24 + Math.sin(this.now * 7) * 0.01, dt);
    const spray = Math.min(0.6, slip / 12);
    this.loops.asphalt.set(roll * (hard / n) * 0.55, rate, dt);
    this.loops.gravel.set((roll + spray) * (gravel / n) * 0.6, rate, dt);
    this.loops.sand.set((roll + spray) * (sand / n) * 0.55, rate, dt);
    this.loops.grass.set((roll + spray * 0.5) * (grass / n) * 0.5, rate, dt);
    this.loops.wet.set(o.wet ? roll * 0.6 : 0, rate, dt);
  }

  // ---------------------------------------------------------------- fremde Fahrzeuge
  remote(id: number, o: RemoteCarInput, dt: number) {
    const cs = classSound(o.cls);
    let rig = this.remotes.get(id);
    if (rig && (rig.cs !== cs || rig.version !== this.eng.bank.version || rig.voice.dead)) { rig.stop(); this.remotes.delete(id); rig = undefined; }
    if (!rig) {
      try { rig = new EngineRig(this.eng, cs, o.pos, false, o.water); } catch { return; }
      this.remotes.set(id, rig);
    }
    rig.seen = true;
    rig.voice.setPos(o.pos.x, o.pos.y, o.pos.z);
    const speed = Math.hypot(o.vx, o.vz);
    const doppler = this.eng.doppler(o.pos, o.vx, o.vz);
    const load = o.boost ? 1 : Math.min(1, 0.25 + speed / 30);
    rig.update(dt, o.rpm, o.idle, o.redline, load, 0.75, doppler, speed);
    // Reifenquietschen aus der Querbewegung (Verfolgungsjagden hörbar)
    if (!o.water) {
      const lat = Math.abs(o.vx * o.fwdZ - o.vz * o.fwdX);
      const sq = clamp01((lat - 3) / 7);
      let slot = this.remoteSqueal.get(id);
      if (!slot && sq > 0.02) { slot = new LoopSlot(this.eng, 'veh.tire.squeal', true); this.remoteSqueal.set(id, slot); }
      slot?.set(sq * 0.7, (0.9 + sq * 0.2) * doppler, dt, o.pos);
    }
  }

  /** Polizei-Sirene: Muster Wail / Yelp / Hi-Lo, Wechsel wie bei echten Streifen; nah = Yelp. */
  siren(id: number, pos: Vec3, vx: number, vz: number) {
    let s = this.sirens.get(id);
    const ctx = this.eng.ctx;
    if (!s) {
      if (this.sirens.size >= 3 || this.eng.gainAt(pos, SPATIAL.siren) < 0.02) return;
      const v = this.eng.voice({ name: 'veh.siren', bus: 'vehicles', pos, spatial: SPATIAL.siren, priority: 0.9, persistent: true, wet: 1.2 });
      if (!v) return;
      const osc = ctx.createOscillator(); osc.type = 'square';
      const lfo = ctx.createOscillator(); const depth = ctx.createGain();
      lfo.connect(depth).connect(osc.frequency);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 1.5;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
      osc.connect(lp).connect(hp).connect(v.input);
      osc.start(); lfo.start(); v.addSource(osc); v.addSource(lfo);
      v.setVolume(0.16, 0.3);
      s = { v, osc, lfo, depth, pattern: -1, next: 0, seen: true };
      this.sirens.set(id, s);
    }
    s.seen = true;
    s.v.setPos(pos.x, pos.y, pos.z);
    const t = this.now;
    const close = this.eng.distTo(pos) < 35;
    if (t > s.next || (close && s.pattern !== 1 && Math.random() < 0.02)) {
      const p = close && Math.random() < 0.7 ? 1 : Math.floor(Math.random() * 3);
      s.next = t + 5 + Math.random() * 6;
      if (p !== s.pattern) {
        s.pattern = p;
        // [Wail, Yelp, Hi-Lo]
        const cfg = ([[0.23, 'sine', 920, 380], [3.6, 'triangle', 1000, 340], [0.95, 'square', 780, 150]] as const)[p];
        s.lfo.type = cfg[1]; s.lfo.frequency.setValueAtTime(cfg[0], t);
        s.osc.frequency.setTargetAtTime(cfg[2], t, 0.05); s.depth.gain.setTargetAtTime(cfg[3], t, 0.05);
      }
    }
    s.osc.detune.setTargetAtTime(1200 * Math.log2(this.eng.doppler(pos, vx, vz, 0.8)), t, 0.05);
  }

  /** Hupe (jedes Bild melden, solange sie tönt). pos null = eigenes Fahrzeug. */
  horn(id: number, cls: HandlingClass, pos: Vec3 | null) {
    let h = this.horns.get(id);
    if (!h) {
      // ferne Hupen gar nicht erst starten, höchstens 4 gleichzeitig (Stau in Downtown)
      if (pos && (this.eng.gainAt(pos, SPATIAL.vehicle) < 0.06 || this.horns.size >= 4)) return;
      const spec = classSound(cls).horn;
      const v = this.eng.voice({ name: 'veh.horn', bus: 'vehicles', pos, spatial: pos ? SPATIAL.vehicle : undefined, priority: 0.8, persistent: true });
      if (!v) return;
      const ctx = this.eng.ctx;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = spec.lp; lp.Q.value = 2;
      lp.connect(v.input);
      const o = spec.f.map((f) => { const osc = ctx.createOscillator(); osc.type = spec.wave; osc.frequency.value = f * (0.99 + Math.random() * 0.02); osc.connect(lp); osc.start(); v.addSource(osc); return osc; });
      v.setVolume(0, 0.001);
      v.setVolume(spec.vol * 2.2, 0.012);
      h = { v, o, seen: true };
      this.horns.set(id, h);
    }
    h.seen = true;
    if (pos) h.v.setPos(pos.x, pos.y, pos.z);
  }

  /** Brennendes Fahrzeug (Feuer-Loop an der Position). */
  fire(id: number, pos: Vec3, intensity: number, dt: number) {
    let f = this.fires.get(id);
    if (!f) { f = new LoopSlot(this.eng, 'veh.dmg.fire', true); this.fires.set(id, f); }
    f.seen = true;
    f.set(0.8 * intensity, 1, dt, pos);
  }

  // ---------------------------------------------------------------- Einzel-Ereignisse
  /** Aufprall: 3 Stärken aus der Geschwindigkeitsänderung; pos null = eigenes Fahrzeug (2D). */
  crash(dv: number, pos: Vec3 | null, glass = false, vol = 1) {
    const level = dv > 14 ? 3 : dv > 7 ? 2 : 1;
    const v = vol * Math.min(1, 0.35 + dv / 18);
    const p = { pos };
    this.eng.play('veh.crash.thud', { ...p, vol: v * (0.6 + level * 0.15), rate: level === 3 ? 0.72 : level === 2 ? 0.86 : 1.05 });
    if (level === 1) this.eng.play('veh.crash.metalLight', { ...p, vol: v * 0.55 });
    else {
      this.eng.play('veh.crash.metal', { ...p, vol: v * 0.75, rate: level === 3 ? 0.82 : 1 });
      this.eng.play('veh.crash.crunch', { ...p, vol: v * 0.6 });
    }
    if (level === 3) { this.eng.play('veh.crash.debris', { ...p, vol: v * 0.5, delay: 0.07 }); this.eng.duck(-4, 0.5); }
    if (glass || level === 3) this.eng.play('veh.crash.glass', { ...p, vol: v * (glass ? 0.7 : 0.45), delay: 0.02 });
  }

  /** Prop-Treffer (leicht: Plastik, schwer: Metall) */
  propHit(heavy: boolean, pos: Vec3 | null, vol = 1) {
    if (heavy) { this.eng.play('veh.crash.metal', { pos, vol: vol * 0.7, rate: 0.9 }); this.eng.play('veh.crash.thud', { pos, vol: vol * 0.5 }); }
    else this.eng.play('veh.crash.plastic', { pos, vol: vol * 0.7 });
  }

  explosion(pos: Vec3) {
    this.eng.play('veh.explosion', { pos, vol: 1 });
    this.eng.play('veh.crash.metal', { pos, vol: 0.6, rate: 0.6 });
    this.eng.play('veh.explosion.debris', { pos, vol: 0.7, delay: 0.35 }); // Trümmerregen
    this.eng.play('veh.crash.glass', { pos, vol: 0.4, delay: 0.1 });
    const near = this.eng.gainAt(pos, SPATIAL.weapon);
    if (near > 0.15) this.eng.duck(-10 * Math.min(1, near * 1.5), 1.4);
  }

  tireBurst(pos: Vec3 | null) { this.eng.play('veh.tire.burst', { pos, vol: 0.9 }); this.eng.play('veh.crash.thud', { pos, vol: 0.4, rate: 1.2 }); }

  splash(pos: Vec3 | null, vol = 1) { this.eng.play('veh.splash', { pos, vol }); }

  /** Debug-Zeilen */
  debug(): string {
    return `${this.info}\nfremde Motoren ${this.remotes.size} · Sirenen ${this.sirens.size} · Hupen ${this.horns.size} · Feuer ${this.fires.size}`;
  }
}
