// Leichter Frame-Profiler (CPU-Abschnitte, Bildzeiten, GPU-Zeit je Render-Pass).
//
// CPU: begin(name)/end(name) summieren performance.now()-Differenzen je Bild. Mit `?prof=1` oder im
//   Benchmark werden zusätzlich performance.measure()-Einträge erzeugt – die erscheinen im
//   Chrome-DevTools-Performance-Profil als eigene Spur „Timings“.
// GPU: EXT_disjoint_timer_query_webgl2 (wo verfügbar) misst je Pass (Schatten, Szene, Bloom, Post …).
//   Es ist immer nur eine Abfrage aktiv (WebGL erlaubt keine verschachtelten) – gpuPass() schaltet um.
//   Ohne Extension (Software-Renderer, Firefox …) misst der Benchmark per gl.finish() (blockierend,
//   nur in Mess-Fenstern), sonst gibt es keine GPU-Zahlen.
// Kosten im normalen Spiel: ein paar performance.now()-Aufrufe pro Bild, kein measure, keine Queries.

export type CpuSection =
  | 'sim' | 'net' | 'entities' | 'world' | 'effects' | 'camera' | 'ui' | 'minimap' | 'audio' | 'render';
export const CPU_SECTIONS: CpuSection[] = ['sim', 'net', 'entities', 'world', 'effects', 'camera', 'ui', 'minimap', 'audio', 'render'];
export const CPU_LABELS: Record<CpuSection, string> = {
  sim: 'Simulation (Vorhersage/Physik)', net: 'Netzwerk-Decoding', entities: 'Figuren/Fahrzeuge (Animation, NPC-Darstellung)',
  world: 'Welt (Chunks, Wackeln, Props)', effects: 'Effekte/Partikel', camera: 'Kamera/Licht/Himmel', ui: 'UI/HUD/Sprechblasen',
  minimap: 'Minimap', audio: 'Audio', render: 'Rendering-Vorbereitung (three.js, Culling, Upload)',
};

export type GpuPass = 'shadow' | 'scene' | 'overlay' | 'bloom' | 'post';
export const GPU_PASSES: GpuPass[] = ['shadow', 'scene', 'overlay', 'bloom', 'post'];

interface QueryRec { q: WebGLQuery; pass: GpuPass; frame: number }

export class GpuTimer {
  readonly supported: boolean;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private active: QueryRec | null = null;
  private pending: QueryRec[] = [];
  private pool: WebGLQuery[] = [];
  private frame = 0;
  /** Fertige Ergebnisse: Bildnummer -> ms je Pass. */
  private results = new Map<number, Partial<Record<GpuPass, number>>>();
  enabled = false;
  /** Ersatz ohne Extension: gl.finish() an jeder Pass-Grenze (blockiert die CPU – nur für Mess-Fenster). */
  sync = false;
  private syncPass: GpuPass | null = null;
  private syncT = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer['ext'];
    this.supported = !!this.ext;
  }

  /** Geglättete GPU-Zeit je Bild (ms, alle Passes) – für die dynamische Auflösung. 0 = noch keine Daten. */
  emaMs = 0;
  private curFrame = -1;
  private curSum = 0;
  private keep = false;

  /** Pass, der gerade gemessen wird. */
  get current(): GpuPass | null { return this.ext ? this.active?.pass ?? null : this.syncPass; }

  beginFrame(frame: number) { this.frame = frame; this.poll(); }

  /** Laufende Messung beenden und (falls pass gesetzt) eine neue für diesen Pass starten. */
  pass(pass: GpuPass | null) {
    if (!this.enabled) return;
    const gl = this.gl;
    if (!this.ext) {
      if (!this.sync) return;
      gl.finish();
      const now = performance.now();
      if (this.syncPass) {
        let rec = this.results.get(this.frame);
        if (!rec) this.results.set(this.frame, (rec = {}));
        rec[this.syncPass] = (rec[this.syncPass] ?? 0) + now - this.syncT;
      }
      this.syncPass = pass; this.syncT = now;
      return;
    }
    if (this.active) { gl.endQuery(this.ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
    if (!pass) return;
    const q = this.pool.pop() ?? gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = { q, pass, frame: this.frame };
  }

  private poll() {
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const r = this.pending[0];
      if (!gl.getQueryParameter(r.q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = gl.getQueryParameter(r.q, gl.QUERY_RESULT) / 1e6;
        if (r.frame !== this.curFrame) {
          if (this.curFrame >= 0) this.emaMs = this.emaMs ? this.emaMs + (this.curSum - this.emaMs) * 0.1 : this.curSum;
          this.curFrame = r.frame; this.curSum = 0;
        }
        this.curSum += ms;
        if (!this.keep) { this.pool.push(r.q); continue; }
        let rec = this.results.get(r.frame);
        if (!rec) this.results.set(r.frame, (rec = {}));
        rec[r.pass] = (rec[r.pass] ?? 0) + ms;
      }
      this.pool.push(r.q);
    }
  }

  /** Ergebnisse je Pass sammeln (Benchmark); sonst wird nur emaMs geführt. */
  collect(on: boolean) { this.keep = on; if (!on) this.results.clear(); }

  /** Ergebnisse (alle fertigen Bilder) abholen und vergessen. */
  take(): Partial<Record<GpuPass, number>>[] {
    const out = [...this.results.values()];
    this.results.clear();
    return out;
  }
}

/** Eine Bild-Messung (für Statistiken im Benchmark). */
export interface FrameSample {
  /** Abstand zum vorigen Bild (ms) – das, was der Spieler sieht. */
  dt: number;
  /** JS-Arbeit in frame() (ms). */
  cpu: number;
  sec: Record<CpuSection, number>;
  calls: number; tris: number; programs: number; geometries: number; textures: number;
  res: number;
}

export class Profiler {
  /** performance.measure()-Einträge erzeugen (DevTools-Spur). */
  marks: boolean;
  readonly gpu: GpuTimer;
  private t: Partial<Record<CpuSection, number>> = {};
  sec = Object.fromEntries(CPU_SECTIONS.map((s) => [s, 0])) as Record<CpuSection, number>;
  /** Netz-Decoding passiert außerhalb von frame() (WebSocket-Ereignis) – wird ins nächste Bild gebucht. */
  private netCarry = 0;
  frameNo = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.marks = new URLSearchParams(location.search).has('prof');
    this.gpu = new GpuTimer(gl);
  }

  beginFrame() {
    this.frameNo++;
    for (const s of CPU_SECTIONS) this.sec[s] = 0;
    this.sec.net = this.netCarry; this.netCarry = 0;
    this.gpu.beginFrame(this.frameNo);
  }

  begin(s: CpuSection) {
    this.t[s] = performance.now();
    if (this.marks) performance.mark('sh:' + s);
  }

  end(s: CpuSection) {
    const t0 = this.t[s];
    if (t0 === undefined) return;
    this.sec[s] += performance.now() - t0;
    this.t[s] = undefined;
    if (this.marks) performance.measure('sh:' + s, 'sh:' + s);
  }

  /** Außerhalb des Bildes gemessene Zeit (Netz). */
  addNet(ms: number) { this.netCarry += ms; }
}

/**
 * Draw-Call-Zähler nach Kategorie (Benchmark): umhüllt renderer.renderBufferDirect und ordnet jeden
 * Aufruf dem obersten benannten Szenen-Knoten zu (world, entities, props …), getrennt nach Pass
 * (Schatten/Szene) und Umrisshülle. Nur aktiv, solange `on` gesetzt ist.
 */
export class CallCounter {
  on = false;
  counts: Record<string, number> = {};
  /** Dreiecke je Kategorie (Schätzung aus Index-/Vertexzahl x Instanzen). */
  tris: Record<string, number> = {};
  private shadow = false;

  constructor(renderer: import('three').WebGLRenderer) {
    const r = renderer as unknown as { renderBufferDirect: (...a: unknown[]) => void; shadowMap: { render: (...a: unknown[]) => void } };
    const draw = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (...a: unknown[]) => {
      if (this.on) {
        const obj = a[4] as import('three').Object3D;
        let o: import('three').Object3D | null = obj, top = '?';
        while (o) { if (o.name && o.parent && !o.parent.parent) { top = o.name; break; } if (!o.parent) break; o = o.parent; }
        if (top === '?' && obj.parent && !obj.parent.parent) top = obj.type;
        else if (!obj.parent) top = 'postQuad'; // Vollbild-Quads der Nachbearbeitung
        const kind = obj.userData.outline ? 'hull' : (obj as import('three').InstancedMesh).isInstancedMesh ? 'inst' : (obj as import('three').SkinnedMesh).isSkinnedMesh ? 'skin' : (obj as import('three').Sprite).isSprite ? 'sprite' : 'mesh';
        const sub = top === 'world' ? ':' + (obj.name || obj.parent?.name || '-') : '';
        const k = `${this.shadow ? 'shadow' : 'main'}:${top}${sub}:${kind}`;
        this.counts[k] = (this.counts[k] ?? 0) + 1;
        const g = a[2] as import('three').BufferGeometry;
        const n = Math.min(g.index ? g.index.count : g.attributes.position?.count ?? 0, g.drawRange.count) / 3;
        const inst = (obj as import('three').InstancedMesh).isInstancedMesh ? (obj as import('three').InstancedMesh).count : 1;
        this.tris[k] = (this.tris[k] ?? 0) + n * inst;
      }
      draw(...a);
    };
    const sm = r.shadowMap;
    const shadow = sm.render.bind(sm);
    sm.render = (...a: unknown[]) => { this.shadow = true; shadow(...a); this.shadow = false; };
  }

  take() { const c = this.counts; this.counts = {}; return c; }
  takeTris() { const t = this.tris; this.tris = {}; return t; }
}
