// Reproduzierbare Benchmark-Route (`?bench=1`, nur mit Dev-Server – nutzt Dev-Chatbefehle).
//
// Fünf Abschnitte à ~36 s (zusammen ~3 min): Teleport an den Start, Tageszeit/Wetter/Ereignis per
// Dev-Befehl setzen, 4 s Einschwingen (Streaming/Spawns – Hänger werden extra gezählt), dann fährt
// ein Autopilot im Sportwagen die Straßenroute ab. Zufall ist auf Client UND Server geseedet
// (Math.random; Server mit BENCH_SEED), damit NPCs, Verkehr und Partikel jedes Mal gleich starten.
//
// Pro Abschnitt: Ø-FPS, 1 %-Low, Bildzeit-Verteilung, Draw-Calls, Dreiecke, Shader-Programme,
// Texturen/Geometrien (+ geschätzter GPU-Speicher), JS-Heap, CPU-Zeit je Bereich, GPU-Zeit je Pass.
// Optional (`&ablate=1`): am Abschnittsende stehen bleiben und Umrisse/Schatten/Bloom/… einzeln
// abschalten – die Differenz ist der Preis des Features (Kostenzerlegung per Ablation).
//
// Ergebnis: window.__benchResult (JSON), Konsole „BENCH_RESULT {…}“, Tabelle im Overlay.
// Läuft automatisch über scripts/bench-client.ts (Playwright) oder von Hand im Browser.
import * as THREE from 'three';
import { mulberry32 } from '../../../shared/src/math';
import { Btn } from '../../../shared/src/protocol';
import { roadRoute } from '../../../shared/src/story/places';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { CPU_SECTIONS, GPU_PASSES, type CallCounter, type CpuSection, type FrameSample, type GpuPass, type Profiler } from './Profiler';

export interface BenchSection {
  id: string; name: string;
  /** Stunde (0–24) für /zeit */
  hour: number;
  weather: 'klar' | 'regen' | 'hitze';
  /** zusätzliche Dev-Befehle (Ereignis, Fahndung …) */
  extra?: string[];
  from: [number, number]; to: [number, number];
  /** Zieltempo des Autopiloten (m/s) */
  speed: number;
  drive: number;
}

export const BENCH_ROUTE: BenchSection[] = [
  { id: 'ocean', name: 'Ocean Strip · Sonnenuntergang', hour: 17.8, weather: 'klar', from: [1576, 820], to: [1560, 1080], speed: 15, drive: 32 },
  // Nachts im Regen, mit laufender Verfolgungsjagd (Streifenwagen, Sirenen, Polizisten zu Fuß) als Straßenereignis
  { id: 'downtown', name: 'Downtown · Nacht, Regen, Verfolgung', hour: 23, weather: 'regen', extra: ['/fahndung 2'], from: [1290, 950], to: [1395, 1070], speed: 13, drive: 32 },
  { id: 'port', name: 'Port District · Mittag', hour: 13, weather: 'klar', extra: ['/fahndung 0'], from: [1250, 1190], to: [1370, 1270], speed: 14, drive: 32 },
  // Gator Flats: frühmorgens (Dunst/Glühwürmchen-Ende), Stelzenhütten, Sumpf, viel Vegetation
  { id: 'gator', name: 'Gator Flats · Morgendunst', hour: 6.3, weather: 'klar', from: [1000, 1490], to: [1120, 1560], speed: 13, drive: 32 },
  { id: 'highway', name: 'Highway nach Okeefield · Nachmittag', hour: 16, weather: 'hitze', from: [1180, 1092], to: [820, 1030], speed: 26, drive: 32 },
];

const SETTLE = 4;
const ABLATIONS = ['outlines', 'shadows', 'bloom', 'water', 'characters', 'vegetation', 'labels'] as const;
export type Ablation = typeof ABLATIONS[number] | 'none';

export interface BenchHost {
  map: WorldMap;
  prof: Profiler;
  calls: CallCounter;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  command(text: string): void;
  car(): { x: number; z: number; a: number; speed: number; inVehicle: boolean };
  drive(ax: number, ay: number, buttons: number): void;
  /** Feature für die Ablation an/aus (true = an). */
  feature(f: Ablation, on: boolean): void;
  resScale(): number;
  /** Spiel bereit (kein blockierender Dialog) – überspringt dabei Story-Dialoge. */
  ready(): boolean;
}

interface SectionStats {
  id: string; name: string; frames: number; seconds: number;
  fps: number; low1: number; p50ms: number; p99ms: number; maxMs: number; spikes33: number; spikes50: number;
  hist: Record<string, number>;
  settleMaxMs: number; settleSpikes33: number;
  calls: { avg: number; max: number }; tris: { avg: number; max: number };
  programs: number; textures: number; geometries: number;
  /** Shader-Programme, die während Einschwingen + Fahrt neu kompiliert wurden (= potenzielle Hänger). */
  progNew: number;
  gpuMemMB: number; heapMB: [number, number];
  cpu: Record<CpuSection, number> & { total: number };
  gpu: Partial<Record<GpuPass, number>> & { total?: number; method: string };
  res: number;
  ablation?: Record<string, { gpu: number; cpu: number; calls: number; tris: number }>;
  /** Draw-Calls je Kategorie (Pass:Gruppe[:Teil]:Art), Mittel über Stichproben-Bilder. */
  callsBy: Record<string, number>;
  /** Dreiecke je Kategorie (Tausend), Mittel über Stichproben-Bilder. */
  trisBy: Record<string, number>;
}

const HIST = [16.7, 20, 25, 33.3, 50, Infinity];
const histKey = (b: number) => (b === Infinity ? '>50' : '<' + b);

export class Bench {
  private i = -1;
  private t = 0;
  private phase: 'start' | 'settle' | 'drive' | 'ablate' | 'done' = 'start';
  private samples: FrameSample[] = [];
  private settle: number[] = [];
  private gpuFrames: Partial<Record<GpuPass, number>>[] = [];
  private path: [number, number][] = [];
  private stuckT = 0;
  private heap0 = 0;
  private results: SectionStats[] = [];
  private abl: { idx: number; t: number; frames: { gpu: number; cpu: number; calls: number; tris: number }[]; out: Record<string, { gpu: number; cpu: number; calls: number; tris: number }> } | null = null;
  private overlay: HTMLDivElement;
  private queue: [number, string][] = [];
  private ablate: boolean;
  private clock = 0;
  private callFrames = 0;
  private prog0 = 0;
  private callSum: Record<string, number> = {};
  private triSum: Record<string, number> = {};

  constructor(private host: BenchHost) {
    const q = new URLSearchParams(location.search);
    this.ablate = q.get('ablate') === '1';
    const only = q.get('only');
    if (only) this.route = BENCH_ROUTE.filter((s) => only.split(',').includes(s.id));
    host.prof.gpu.enabled = true;
    host.prof.gpu.collect(true);
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = 'position:fixed;left:8px;top:40px;z-index:99;font:12px monospace;color:#fff;background:rgba(10,5,25,.8);padding:6px 8px;white-space:pre;pointer-events:none';
    document.body.appendChild(this.overlay);
    host.command('/auto sport');
  }
  private route = BENCH_ROUTE;

  /** Seedet Math.random (vor dem Erzeugen der Spielobjekte aufrufen). */
  static seedRandom(seed: number) { Math.random = mulberry32(seed); }

  private get sec() { return this.route[this.i]; }

  private later(delay: number, text: string) { this.queue.push([this.clock + delay, text]); }

  beforeFrame(dt: number) {
    this.clock += dt;
    for (let k = this.queue.length - 1; k >= 0; k--) if (this.queue[k][0] <= this.clock) { this.host.command(this.queue[k][1]); this.queue.splice(k, 1); }
    if (this.phase === 'done') return;
    this.t += dt;
    this.host.ready(); // Story-Dialoge (Funk, Szenen) während der Fahrt wegklicken
    if (this.phase === 'start') {
      if (this.t < 1.5 || (!this.host.ready() && this.t < 30)) return; // Intro überspringen, Auto bereitstellen lassen
      this.next();
      return;
    }
    if (this.phase === 'settle' || this.phase === 'ablate') { this.host.drive(0, 0, Btn.BRAKE); }
    if (this.phase === 'settle' && this.t >= SETTLE) { this.phase = 'drive'; this.t = 0; this.heap0 = heapMB(); }
    if (this.phase === 'drive') {
      this.autopilot(dt);
      if (this.t >= this.sec.drive) {
        this.host.drive(0, 0, Btn.BRAKE);
        if (this.ablate) { this.phase = 'ablate'; this.t = 0; this.abl = { idx: -1, t: 0, frames: [], out: {} }; }
        else this.finishSection();
      }
    }
    if (this.phase === 'ablate') this.ablationStep(dt);
  }

  afterFrame(dtMs: number, cpuMs: number) {
    const P = this.host.prof;
    const info = this.host.renderer.info;
    if (this.phase === 'settle') { this.settle.push(dtMs); }
    if (this.phase === 'drive') {
      const cc = this.host.calls;
      if (cc.on) {
        cc.on = false; this.callFrames++;
        for (const [k, v] of Object.entries(cc.take())) this.callSum[k] = (this.callSum[k] ?? 0) + v;
        for (const [k, v] of Object.entries(cc.takeTris())) this.triSum[k] = (this.triSum[k] ?? 0) + v;
      } else if (this.samples.length % 30 === 15) cc.on = true; // nächstes Bild zählen
      this.samples.push({
        dt: dtMs, cpu: cpuMs, sec: { ...P.sec },
        calls: info.render.calls, tris: info.render.triangles, programs: info.programs?.length ?? 0,
        geometries: info.memory.geometries, textures: info.memory.textures, res: this.host.resScale(),
      });
      this.gpuFrames.push(...P.gpu.take());
    }
    if (this.phase === 'ablate' && this.abl && this.abl.idx >= 0 && this.abl.t > 0.4) {
      const g = P.gpu.take();
      const gpu = g.reduce((s, r) => s + Object.values(r).reduce((a, b) => a + (b ?? 0), 0), 0) / Math.max(1, g.length);
      this.abl.frames.push({ gpu, cpu: cpuMs, calls: info.render.calls, tris: info.render.triangles });
    } else if (this.phase !== 'drive') P.gpu.take();
    this.draw();
  }

  // ------------------------------------------------------------------ Ablauf
  private next() {
    this.i++;
    if (this.i >= this.route.length) { this.finish(); return; }
    const s = this.sec;
    this.phase = 'settle'; this.t = 0;
    this.samples = []; this.settle = []; this.gpuFrames = []; this.stuckT = 0;
    this.prog0 = this.host.renderer.info.programs?.length ?? 0;
    this.callFrames = 0; this.callSum = {}; this.triSum = {}; this.host.calls.on = false; this.host.calls.take(); this.host.calls.takeTris();
    this.path = roadRoute(this.host.map, { x: s.from[0], z: s.from[1] }, { x: s.to[0], z: s.to[1] }) as [number, number][];
    if (!this.path.length) this.path = [s.from, s.to];
    const [x0, z0] = this.path[0];
    // Befehle zeitversetzt (Chat-Spamschutz des Servers: 0,7 s)
    this.host.command(`/ort ${Math.round(x0)} ${Math.round(z0)}`);
    const cmds = [`/zeit ${s.hour}`, `/wetter ${s.weather}`, ...(s.extra ?? [])];
    cmds.forEach((c, k) => this.later(0.75 * (k + 1), c));
  }

  /** Pure-Pursuit über die Straßenroute; steckt das Auto fest, geht es per Teleport weiter. */
  private autopilot(dt: number) {
    const c = this.host.car();
    if (!c.inVehicle) { if (this.t % 2 < dt) this.host.command('/auto sport'); return; }
    // nächster Routenpunkt, Zielpunkt ~14 m weiter
    let near = 0, nd = Infinity;
    for (let k = 0; k < Math.min(this.path.length, 30); k++) { const d = Math.hypot(this.path[k][0] - c.x, this.path[k][1] - c.z); if (d < nd) { nd = d; near = k; } }
    if (near > 0) this.path.splice(0, near);
    let look = 0, acc = 0;
    while (look < this.path.length - 1 && acc < 14) { acc += Math.hypot(this.path[look + 1][0] - this.path[look][0], this.path[look + 1][1] - this.path[look][1]); look++; }
    const [tx, tz] = this.path[Math.min(look, this.path.length - 1)];
    if (this.path.length < 2 && Math.hypot(tx - c.x, tz - c.z) < 10) {
      // Route zu Ende: zurück zum Start und weiter (gleiche Strecke)
      const s = this.sec;
      this.path = roadRoute(this.host.map, { x: c.x, z: c.z }, { x: s.from[0], z: s.from[1] }) as [number, number][];
      return;
    }
    const want = Math.atan2(tx - c.x, tz - c.z);
    let diff = want - c.a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, -diff * 2.2));
    const target = this.sec.speed * (Math.abs(diff) > 0.6 ? 0.45 : 1);
    const ay = c.speed < target ? 1 : c.speed > target + 4 ? -0.5 : 0;
    this.host.drive(steer, ay, 0);
    // festgefahren?
    this.stuckT = c.speed < 1.5 ? this.stuckT + dt : 0;
    if (this.stuckT > 2.5 && this.path.length > 3) {
      this.stuckT = 0;
      const p = this.path[Math.min(3, this.path.length - 1)];
      this.host.command(`/ort ${Math.round(p[0])} ${Math.round(p[1])}`);
    }
  }

  private ablationStep(dt: number) {
    const a = this.abl!;
    a.t += dt;
    const P = this.host.prof;
    P.gpu.sync = !P.gpu.supported; // ohne Timer-Extension: gl.finish() an den Pass-Grenzen
    if (a.idx === -1 || a.t > 1.6) {
      if (a.idx >= 0) {
        const name = a.idx === 0 ? 'none' : ABLATIONS[a.idx - 1];
        const f = a.frames;
        const avg = (k: 'gpu' | 'cpu' | 'calls' | 'tris') => f.reduce((s, r) => s + r[k], 0) / Math.max(1, f.length);
        a.out[name] = { gpu: avg('gpu'), cpu: avg('cpu'), calls: avg('calls'), tris: avg('tris') };
        if (a.idx > 0) this.host.feature(ABLATIONS[a.idx - 1], true);
      }
      a.idx++; a.t = 0; a.frames = [];
      if (a.idx > ABLATIONS.length) { P.gpu.sync = false; this.finishSection(); return; }
      if (a.idx > 0) this.host.feature(ABLATIONS[a.idx - 1], false);
    }
  }

  private finishSection() {
    const s = this.sec;
    const n = this.samples.length;
    const dts = this.samples.map((r) => r.dt).sort((x, y) => x - y);
    const total = dts.reduce((a, b) => a + b, 0);
    const pct = (p: number) => dts[Math.min(n - 1, Math.floor(n * p))] ?? 0;
    const hist: Record<string, number> = {};
    for (const b of HIST) hist[histKey(b)] = 0;
    for (const d of dts) { const b = HIST.find((h) => d < h)!; hist[histKey(b)]++; }
    for (const k in hist) hist[k] = +(hist[k] / Math.max(1, n) * 100).toFixed(1);
    // 1 %-Low: mittlere FPS der langsamsten 1 % Bilder
    const worst = dts.slice(Math.floor(n * 0.99));
    const low1 = worst.length ? 1000 / (worst.reduce((a, b) => a + b, 0) / worst.length) : 0;
    const avg = (f: (r: FrameSample) => number) => this.samples.reduce((a, r) => a + f(r), 0) / Math.max(1, n);
    const cpu = Object.fromEntries(CPU_SECTIONS.map((k) => [k, +avg((r) => r.sec[k]).toFixed(3)])) as Record<CpuSection, number> & { total: number };
    cpu.total = +avg((r) => r.cpu).toFixed(3);
    const g = this.gpuFrames;
    const gpu: SectionStats['gpu'] = { method: this.host.prof.gpu.supported ? 'EXT_disjoint_timer_query_webgl2' : 'keine (Timer-Extension fehlt)' };
    if (g.length) {
      let tot = 0;
      for (const p of GPU_PASSES) { const v = g.reduce((a, r) => a + (r[p] ?? 0), 0) / g.length; if (v > 0) { gpu[p] = +v.toFixed(3); tot += v; } }
      gpu.total = +tot.toFixed(3);
    }
    const last = this.samples[n - 1];
    const stats: SectionStats = {
      id: s.id, name: s.name, frames: n, seconds: +(total / 1000).toFixed(1),
      fps: +(n / Math.max(1e-3, total / 1000)).toFixed(1), low1: +low1.toFixed(1),
      p50ms: +pct(0.5).toFixed(2), p99ms: +pct(0.99).toFixed(2), maxMs: +(dts[n - 1] ?? 0).toFixed(1),
      spikes33: dts.filter((d) => d > 33.3).length, spikes50: dts.filter((d) => d > 50).length, hist,
      settleMaxMs: +Math.max(0, ...this.settle.slice(2)).toFixed(1), settleSpikes33: this.settle.slice(2).filter((d) => d > 33.3).length,
      calls: { avg: Math.round(avg((r) => r.calls)), max: Math.max(0, ...this.samples.map((r) => r.calls)) },
      tris: { avg: Math.round(avg((r) => r.tris)), max: Math.max(0, ...this.samples.map((r) => r.tris)) },
      programs: last?.programs ?? 0, progNew: (last?.programs ?? 0) - this.prog0, textures: last?.textures ?? 0, geometries: last?.geometries ?? 0,
      gpuMemMB: +estimateGpuMemory(this.host.renderer, this.host.scene).toFixed(1),
      heapMB: [+this.heap0.toFixed(1), +heapMB().toFixed(1)],
      cpu, gpu, res: +avg((r) => r.res).toFixed(2),
      trisBy: Object.fromEntries(Object.entries(this.triSum).map(([k, v]) => [k, +(v / Math.max(1, this.callFrames) / 1000).toFixed(1)]).sort((a, b) => (b[1] as number) - (a[1] as number))),
      callsBy: Object.fromEntries(Object.entries(this.callSum).map(([k, v]) => [k, +(v / Math.max(1, this.callFrames)).toFixed(1)]).sort((a, b) => (b[1] as number) - (a[1] as number))),
    };
    if (this.abl) { stats.ablation = Object.fromEntries(Object.entries(this.abl.out).map(([k, v]) => [k, { gpu: +v.gpu.toFixed(2), cpu: +v.cpu.toFixed(2), calls: Math.round(v.calls), tris: Math.round(v.tris) }])); this.abl = null; }
    this.results.push(stats);
    this.next();
  }

  private finish() {
    this.phase = 'done';
    this.host.drive(0, 0, 0);
    const result = {
      date: new Date().toISOString(), ua: navigator.userAgent, gl: glInfo(this.host.renderer),
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, sections: this.results,
    };
    (globalThis as { __benchResult?: unknown }).__benchResult = result;
    console.log('BENCH_RESULT ' + JSON.stringify(result));
  }

  private lastDraw = 0;
  private draw() {
    const now = performance.now();
    if (now - this.lastDraw < 500) return;
    this.lastDraw = now;
    const lines = [`BENCH ${this.phase} ${this.sec ? this.sec.name : ''} ${this.t.toFixed(0)} s`];
    for (const r of this.results) lines.push(`${r.id.padEnd(9)} ${String(r.fps).padStart(6)} fps  1%low ${String(r.low1).padStart(5)}  calls ${r.calls.avg}  tris ${(r.tris.avg / 1000).toFixed(0)}k  cpu ${r.cpu.total.toFixed(1)} ms`);
    this.overlay.textContent = lines.join('\n');
  }
}

function heapMB() {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : 0;
}

function glInfo(r: THREE.WebGLRenderer) {
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
  };
}

/**
 * Grobe Schätzung des GPU-Speichers: alle Vertex-/Index-Puffer der Szene (je Geometrie einmal),
 * Texturen (RGBA8 + Mipmaps, 4/3) und Render-Ziele des Renderers/Composers sind nicht vollständig
 * erfassbar – daher plus Bildschirm-Puffer (Farbe + Tiefe + 2 HalfFloat-Ziele) als Pauschale.
 */
export function estimateGpuMemory(r: THREE.WebGLRenderer, scene: THREE.Scene): number {
  const geos = new Set<THREE.BufferGeometry>(), texs = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const im = o as THREE.InstancedMesh;
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texs.add(v);
    for (const mat of mats) {
      const u = (mat as THREE.ShaderMaterial).uniforms;
      if (u) for (const x of Object.values(u)) if (x.value instanceof THREE.Texture) texs.add(x.value);
    }
    if (im.isInstancedMesh) void 0;
  });
  let bytes = 0;
  const attrs = new Set<THREE.BufferAttribute | THREE.InterleavedBuffer>();
  for (const g of geos) {
    for (const a of Object.values(g.attributes)) attrs.add((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).data : a as THREE.BufferAttribute);
    if (g.index) attrs.add(g.index);
  }
  scene.traverse((o) => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) { attrs.add(im.instanceMatrix); if (im.instanceColor) attrs.add(im.instanceColor); } });
  for (const a of attrs) bytes += (a.array as ArrayLike<number> & { byteLength: number }).byteLength;
  for (const t of texs) {
    const img = (t.image ?? {}) as { width?: number; height?: number; data?: { byteLength: number } };
    const w = img.width ?? 0, h = img.height ?? 0;
    bytes += (img.data?.byteLength ?? w * h * 4) * (t.generateMipmaps ? 4 / 3 : 1);
  }
  const size = r.getDrawingBufferSize(new THREE.Vector2());
  bytes += size.x * size.y * (4 + 4 + 8 * 3); // Back-Buffer, Tiefe, Composer-Ziele (HalfFloat)
  const shadow = 2048 * 2048 * 4;
  return (bytes + shadow) / 1048576;
}
