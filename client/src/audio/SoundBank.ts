// Lädt Sounds laut Manifest: zuerst verarbeitete Dateien (client/public/audio/index.json aus
// scripts/process-audio.ts, Sprites werden nur einmal dekodiert), sonst fertige Kit-Dateien
// (assets/…), sonst prozeduraler Ersatz. Zonen-Sounds werden erst geladen, wenn der Spieler in
// der Zone oder daneben ist (Lazy Loading). Auswahl der Variante zufällig, nie zweimal dieselbe.
import { SOUNDS, SOUND_INDEX, type SoundDef } from './manifest';
import { generate } from './procedural';

export interface Variant { buf: AudioBuffer; offset: number; dur: number; /** Motor-Loops: Drehzahl der Aufnahme */ rpm?: number }

/** Format von client/public/audio/index.json (siehe scripts/process-audio.ts). */
export interface BuiltIndex {
  version: number;
  formats: string[];
  /** id → Varianten: f = Datei ohne Endung (relativ zu audio/), o/d = Ausschnitt im Sprite (s) */
  sounds: Record<string, { f: string; o?: number; d?: number; rpm?: number }[]>;
}

export class SoundBank {
  private variants = new Map<string, Variant[]>();
  private proc = new Map<string, Variant[]>();
  private last = new Map<string, number>();
  private files = new Map<string, Promise<AudioBuffer | null>>();
  private requested = new Set<string>();
  private index: BuiltIndex | null = null;
  private ext: 'ogg' | 'm4a';
  /** Steigt, sobald echte Motor-/Propeller-Dateien nachgeladen wurden (Motor-Rigs bauen sich dann neu auf). */
  version = 0;
  /** Statistik fürs Debug-Overlay */
  bytes = 0; pending = 0;
  readonly ready: Promise<void>;

  constructor(private ctx: AudioContext) {
    let ogg = true;
    try { ogg = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== ''; } catch { /* egal */ }
    this.ext = ogg ? 'ogg' : 'm4a';
    this.ready = fetch('audio/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((idx: BuiltIndex | null) => {
        this.index = idx && idx.sounds ? idx : null;
        for (const def of SOUNDS) if (!def.zones && def.kind !== 'stream') this.request(def);
      });
  }

  /** Zonen-Sounds der aktuellen und benachbarter Zonen anfordern. */
  setZones(zones: Iterable<string>) {
    const set = new Set(zones);
    for (const def of SOUNDS) if (def.zones && def.kind !== 'stream' && def.zones.some((z) => set.has(z))) this.request(def);
  }

  /** URL einer Stream-Datei (Musik/große Loops) oder null. */
  streamUrl(id: string): string | null {
    const v = this.index?.sounds[id]?.[0];
    if (v) return `audio/${v.f}.${this.ext}`;
    const def = SOUND_INDEX.get(id);
    const a = def?.files.find((f) => f.asset);
    return a?.asset ? `assets/${a.asset}` : null;
  }

  private load(url: string): Promise<AudioBuffer | null> {
    let p = this.files.get(url);
    if (!p) {
      this.pending++;
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => { this.bytes += data.byteLength; return this.ctx.decodeAudioData(data); })
        .catch(() => { console.warn(`[audio] ${url} nicht geladen`); return null; })
        .finally(() => { this.pending--; });
      this.files.set(url, p);
    }
    return p;
  }

  private request(def: SoundDef) {
    if (this.requested.has(def.id)) return;
    this.requested.add(def.id);
    const built = this.index?.sounds[def.id];
    const list: Variant[] = [];
    const jobs: Promise<void>[] = [];
    if (built?.length) {
      for (const v of built) jobs.push(this.load(`audio/${v.f}.${this.ext}`).then((buf) => {
        if (buf) list.push({ buf, offset: v.o ?? 0, dur: v.d ?? buf.duration, rpm: v.rpm });
      }));
    } else {
      for (const f of def.files) if (f.asset) jobs.push(this.load(`assets/${f.asset}`).then((buf) => {
        if (buf) list.push({ buf, offset: 0, dur: buf.duration, rpm: f.rpm });
      }));
    }
    if (!jobs.length) return;
    Promise.all(jobs).then(() => {
      if (!list.length) return;
      this.variants.set(def.id, list);
      if (/^veh\.(engine|prop|water\.rush)/.test(def.id)) this.version++; // Motor-Rigs neu aufbauen
    });
  }

  /** Echte Datei geladen (sonst prozedural oder still)? */
  loaded(id: string) { return (this.variants.get(id)?.length ?? 0) > 0; }

  private procVariants(id: string): Variant[] | undefined {
    let v = this.proc.get(id);
    if (v) return v;
    const def = SOUND_INDEX.get(id);
    if (!def?.proc) return undefined;
    const res = generate(this.ctx, def.proc);
    v = (res?.buffers ?? []).map((buf) => ({ buf, offset: 0, dur: buf.duration, rpm: res?.rpm }));
    this.proc.set(id, v);
    return v;
  }

  /** Zufällige Variante (nie direkt dieselbe wie zuletzt). */
  pick(id: string): Variant | undefined {
    const list = this.variants.get(id) ?? this.procVariants(id);
    if (!list?.length) return undefined;
    if (list.length === 1) return list[0];
    const prev = this.last.get(id) ?? -1;
    let i = Math.floor(Math.random() * (list.length - 1));
    if (i >= prev) i++;
    this.last.set(id, i);
    return list[i];
  }

  /** Prozedurale Puffer vorab erzeugen (z. B. beim Einsteigen, damit es nicht ruckelt). */
  warm(ids: string[]) { for (const id of ids) if (!this.loaded(id)) this.procVariants(id); }

  /** Im Leerlauf nach und nach erzeugen (je Tick ein Puffer, ~10 ms) – kein Ruckler im Spiel. */
  warmGradually(ids: string[]) {
    const queue = ids.filter((id) => !this.proc.has(id));
    const idle = (cb: () => void) => ((globalThis as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 40)))(cb, { timeout: 500 });
    const step = () => {
      const id = queue.shift();
      if (!id) return;
      if (!this.loaded(id)) this.procVariants(id);
      idle(step);
    };
    idle(step);
  }
}
