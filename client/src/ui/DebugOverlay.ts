// Debug-Overlay (F3): Draufsicht auf das Layout zum Prüfen der Weltgenerierung –
// Straßengraph (nach Typ), Knoten und Kreisverkehre, Blockpolygone, Grundstücke (nach
// Nutzung), Viertelgrenzen mit Rasterwinkel, Chunk-Gitter, Spielerposition und Leistungswerte.
// Ziehen = verschieben, Mausrad = zoomen, C = auf Spieler zentrieren, Tasten 1–6 = Ebenen.
import { CELL, CHUNK, WORLD_SIZE } from '../../../shared/src/constants';
import { centroid } from '../../../shared/src/world/geometry';
import { LOT_USE_NAMES, ROAD_TYPE_NAMES, type WorldMap } from '../../../shared/src/world/WorldMap';
import { NEED_IDS, NEED_NAMES } from '../../../shared/src/npc/intents';
import { NPC_EVENTS, type NpcEvId } from '../../../shared/src/npc/reactions';
import { ACT_NAMES } from '../../../shared/src/npc/scenarios';
import type { NpcDebugPed, ServerMsg } from '../../../shared/src/protocol';

type Tab = 'map' | 'vehicle' | 'npc';
type NpcMsg = Extract<ServerMsg, { t: 'npcDebug' }>;
const EVENT_COLORS = ['#ffe14d', '#9be7ff', '#ff9ad0', '#5aa8ff', '#ffa23a', '#ff4f4f', '#ff7af0', '#ff4f9a', '#ff2a2a', '#ff7a00'];

const ROAD_COLORS = ['#ff3b3b', '#ffffff', '#ffe14d', '#d08a4a', '#9b6b43'];
const LOT_COLORS = ['rgba(181,154,200,0.55)', 'rgba(70,190,90,0.6)', 'rgba(60,90,255,0.5)', 'rgba(255,140,0,0.6)', 'rgba(150,100,50,0.5)'];
const DISTRICT_COLORS = ['#ff4f9a', '#2af0e6', '#ffa23a', '#b04dff', '#4dff9a', '#ffe14d', '#5aa8ff'];

export interface DebugStats { fps: number; calls: number; triangles: number; entities: number }

export class DebugOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private visible = false;
  private scale = 0.45; // Pixel pro Meter
  private cx = WORLD_SIZE / 2; private cz = WORLD_SIZE / 2; // Mittelpunkt der Ansicht (Meter)
  private drag: { x: number; y: number } | null = null;
  private layers = { terrain: true, roads: true, blocks: true, lots: true, districts: true, chunks: false };
  private player = { x: 0, z: 0, a: 0 };
  private stats: DebugStats = { fps: 0, calls: 0, triangles: 0, entities: 0 };

  constructor(private map: WorldMap, private terrain: HTMLCanvasElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'debug-overlay';
    this.canvas.className = 'hidden';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.canvas.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('mouseup', () => { this.drag = null; });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag || !this.visible) return;
      this.cx -= (e.clientX - this.drag.x) / this.scale;
      this.cz -= (e.clientY - this.drag.y) / this.scale;
      this.drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Zoom um die Mausposition
      const r = this.canvas.getBoundingClientRect();
      const mx = this.cx + (e.clientX - r.width / 2) / this.scale, mz = this.cz + (e.clientY - r.height / 2) / this.scale;
      this.scale = Math.min(12, Math.max(0.2, this.scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
      this.cx = mx - (e.clientX - r.width / 2) / this.scale;
      this.cz = mz - (e.clientY - r.height / 2) / this.scale;
      this.draw();
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.toggle(); return; }
      if (!this.open) return;
      if (e.code === 'Tab') { e.preventDefault(); this.setTab(this.tab === 'map' ? 'vehicle' : this.tab === 'vehicle' ? 'npc' : 'map'); return; }
      if (!this.visible) return;
      if (e.code === 'KeyC') { this.cx = this.player.x; this.cz = this.player.z; this.draw(); }
      const keys = ['terrain', 'roads', 'blocks', 'lots', 'districts', 'chunks'] as const;
      const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
      if (k >= 0) { this.layers[keys[k]] = !this.layers[keys[k]]; this.draw(); }
    });
    // Tabs: Karte | Fahrzeug
    this.tabsEl = document.createElement('div');
    this.tabsEl.id = 'debug-tabs';
    this.tabsEl.className = 'hidden';
    for (const [id, text] of [['map', 'Karte'], ['vehicle', 'Fahrzeug'], ['npc', 'NPC']] as const) {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.tab = id;
      b.addEventListener('click', () => this.setTab(id));
      this.tabsEl.appendChild(b);
    }
    document.body.appendChild(this.tabsEl);
    this.vehEl = document.createElement('div');
    this.vehEl.id = 'veh-debug';
    this.vehEl.className = 'hidden';
    document.body.appendChild(this.vehEl);
    this.npcEl = this.buildNpcPanel();
    try { const t = localStorage.getItem('sunstate.debugTab'); if (t === 'vehicle' || t === 'npc') this.tab = t; } catch { /* egal */ }
  }

  // ------------------------------------------------------------------ NPC-Tab
  /** NPC-Tab an/aus (Server schickt dann ~2x pro Sekunde Debugdaten). */
  onNpcTab: (on: boolean) => void = () => {};
  /** Chatbefehl senden (Tageszeit/Wetter erzwingen). */
  onCommand: (text: string) => void = () => {};
  private npcEl: HTMLDivElement;
  private npcCanvas!: HTMLCanvasElement;
  private npcPop!: HTMLDivElement;
  private npcText!: HTMLPreElement;
  private npcData: NpcMsg | null = null;
  private npcOn = false;

  private buildNpcPanel(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'npc-debug';
    el.className = 'hidden';
    const row = (items: [string, string][]) => {
      const r = document.createElement('div');
      r.className = 'row';
      for (const [label, cmd] of items) {
        const b = document.createElement('button');
        b.textContent = label;
        b.addEventListener('click', () => this.onCommand(cmd));
        r.appendChild(b);
      }
      el.appendChild(r);
    };
    row([['Morgen', '/pop morgen'], ['Mittag', '/pop mittag'], ['Nachm.', '/pop nachmittag'], ['Abend', '/pop abend'], ['Nacht', '/pop nacht'], ['Auto', '/pop auto']]);
    row([['Uhr 8', '/zeit 8'], ['Uhr 13', '/zeit 13'], ['Uhr 23', '/zeit 23'], ['Klar', '/wetter klar'], ['Regen', '/wetter regen'], ['Hitze', '/wetter hitze']]);
    this.npcPop = document.createElement('div');
    this.npcPop.className = 'pop';
    el.appendChild(this.npcPop);
    this.npcCanvas = document.createElement('canvas');
    this.npcCanvas.width = 900; this.npcCanvas.height = 520;
    el.appendChild(this.npcCanvas);
    this.npcText = document.createElement('pre');
    el.appendChild(this.npcText);
    document.body.appendChild(el);
    return el;
  }

  setNpcData(msg: NpcMsg) {
    this.npcData = msg;
    if (this.open && this.tab === 'npc') this.drawNpc();
  }

  /** Draufsicht (±32 m um den Spieler): NPCs nach Zustand, Ziel-Linien, wahrgenommene Ereignisse als Kreise. */
  private drawNpc() {
    const d = this.npcData;
    if (!d) return;
    this.npcPop.textContent = d.pop;
    const c = this.npcCanvas, ctx = c.getContext('2d')!;
    const W = c.width, H = c.height, s = W / 64;
    const X = (x: number) => W / 2 + (x - this.player.x) * s, Z = (z: number) => H / 2 + (z - this.player.z) * s;
    ctx.fillStyle = '#0d0a1c'; ctx.fillRect(0, 0, W, H);
    // Straßen als Orientierung
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineCap = 'round';
    for (const e of this.map.edges) {
      if (!e.pts.some((p) => Math.abs(p[0] - this.player.x) < 60 && Math.abs(p[1] - this.player.z) < 50)) continue;
      ctx.lineWidth = e.width * s;
      ctx.beginPath(); e.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1])))); ctx.stroke();
    }
    for (const [ev, x, z, r, age] of d.events) {
      const a = Math.max(0, 1 - age / 4);
      ctx.globalAlpha = 0.25 + a * 0.6;
      ctx.strokeStyle = EVENT_COLORS[ev] ?? '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(X(x), Z(z), r * s, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 16px Consolas, monospace'; ctx.textAlign = 'center';
      ctx.fillText(NPC_EVENTS[ev as NpcEvId]?.name ?? '?', X(x), Z(z) - 6);
    }
    ctx.globalAlpha = 1;
    ctx.font = '14px Consolas, monospace'; ctx.textAlign = 'left';
    for (const p of d.peds) {
      if (p.goal) {
        ctx.strokeStyle = 'rgba(42,240,230,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(X(p.x), Z(p.z)); ctx.lineTo(X(p.goal[0]), Z(p.goal[1])); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.fillStyle = p.react ? '#ff4f4f' : p.fear ? '#ffa23a' : p.obj && !p.goal ? '#4dff9a' : p.lod ? '#8a83a8' : '#e8e0ff';
      ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c8bfe8'; ctx.fillText(String(p.id), X(p.x) + 8, Z(p.z) + 4);
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff4f9a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8a83a8'; ctx.font = '13px Consolas, monospace';
    ctx.fillText('weiß läuft · grün Szenario · rot Reaktion · orange Gedächtnis · grau Mittel-LOD · Linie = Ziel', 8, H - 8);
    // Liste: nächste NPCs zuerst
    const near = [...d.peds].sort((a, b) => dist(a, this.player) - dist(b, this.player)).slice(0, 14);
    this.npcText.textContent = near.map((p) => {
      const chain = p.chain.map((st, i) => (i === p.step - 1 ? `[${st}]` : i < p.step - 1 ? `✓${st}` : st)).join(' → ');
      const needs = NEED_IDS.map((k, i) => `${NEED_NAMES[k].slice(0, 4)} ${p.needs[i].toFixed(2)}`).join(' · ');
      return `#${p.id} ${p.arch} · ${dist(p, this.player).toFixed(0)} m · ${ACT_NAMES[p.act] ?? p.act}${p.lod ? ' · LOD Mittel' : ''}\n`
        + `  Kette: ${chain}\n  ${needs}\n`
        + (p.obj ? `  Objekt: ${p.obj}\n` : '')
        + (p.react ? `  Reaktion: ${p.react}\n` : '')
        + (p.fear ? `  Gedächtnis: meidet Spieler noch ${p.fear} s\n` : '')
        + (p.seen.length ? `  Wahrgenommen: ${p.seen.join(', ')}\n` : '')
        + `  » ${p.last}`;
    }).join('\n') || 'Keine verwalteten NPCs in der Nähe (Population Tables gibt es bisher für Ocean Strip).';
  }

  private tabsEl: HTMLDivElement;
  private vehEl: HTMLDivElement;
  private open = false;
  tab: Tab = 'map';

  get isOpen() { return this.open; }
  /** Fahrzeug-Tab aktiv (Kräfte-Pfeile im Spiel anzeigen) */
  get vehicleTab() { return this.open && this.tab === 'vehicle'; }

  toggle() {
    this.open = !this.open;
    this.tabsEl.classList.toggle('hidden', !this.open);
    this.setTab(this.tab);
  }

  private setTab(tab: Tab) {
    this.tab = tab;
    try { localStorage.setItem('sunstate.debugTab', tab); } catch { /* egal */ }
    for (const b of this.tabsEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === tab);
    this.visible = this.open && tab === 'map';
    this.canvas.classList.toggle('hidden', !this.visible);
    this.vehEl.classList.toggle('hidden', !(this.open && tab === 'vehicle'));
    const npc = this.open && tab === 'npc';
    this.npcEl.classList.toggle('hidden', !npc);
    if (npc !== this.npcOn) { this.npcOn = npc; this.onNpcTab(npc); }
    if (npc) this.drawNpc();
    if (this.visible) { this.cx = this.player.x; this.cz = this.player.z; this.draw(); }
  }

  /** Text des Fahrzeug-Tabs (nur eigene, statische Inhalte) */
  setVehicleText(text: string) { if (this.vehicleTab) this.vehEl.textContent = text; }

  private resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.visible) this.draw();
  }

  /** Pro Frame: Spielerposition und Leistungswerte (gezeichnet wird ~4x pro Sekunde). */
  update(x: number, z: number, a: number, stats: DebugStats) {
    this.player = { x, z, a };
    this.stats = stats;
  }

  redraw() { if (this.visible) this.draw(); }

  private draw() {
    const { ctx, map } = this;
    const W = this.canvas.width, H = this.canvas.height, s = this.scale;
    const X = (x: number) => W / 2 + (x - this.cx) * s, Z = (z: number) => H / 2 + (z - this.cz) * s;
    ctx.fillStyle = '#0d0a1c';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    if (this.layers.terrain) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(this.terrain, X(0), Z(0), WORLD_SIZE * s, WORLD_SIZE * s);
      ctx.globalAlpha = 1;
    }
    const path = (pts: [number, number][], close: boolean) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Z(p[1])) : ctx.moveTo(X(p[0]), Z(p[1]))));
      if (close) ctx.closePath();
    };

    if (this.layers.chunks) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      for (let v = 0; v <= WORLD_SIZE; v += CHUNK) {
        ctx.beginPath(); ctx.moveTo(X(v), Z(0)); ctx.lineTo(X(v), Z(WORLD_SIZE)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(0), Z(v)); ctx.lineTo(X(WORLD_SIZE), Z(v)); ctx.stroke();
      }
    }
    if (this.layers.lots) {
      for (const l of map.lots) { path(l.poly, true); ctx.fillStyle = LOT_COLORS[l.use]; ctx.fill(); }
    }
    if (this.layers.blocks) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1;
      for (const b of map.blocks) { path(b.poly, true); ctx.stroke(); }
    }
    if (this.layers.roads) {
      ctx.lineCap = 'round';
      for (const e of map.edges) {
        path(e.pts, false);
        ctx.strokeStyle = ROAD_COLORS[e.type];
        ctx.lineWidth = Math.max(1.5, e.width * s * 0.6);
        ctx.stroke();
      }
      for (const n of map.nodes) {
        if (n.roundabout) {
          ctx.strokeStyle = '#2af0e6'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), n.roundabout * s, 0, Math.PI * 2); ctx.stroke();
        }
        const deg = n.edges.length;
        ctx.fillStyle = deg >= 3 ? '#1a1030' : deg === 1 ? '#ff4f9a' : '#888';
        ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), deg >= 3 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (this.layers.districts) {
      ctx.font = 'bold 13px Trebuchet MS, sans-serif';
      ctx.textAlign = 'center';
      for (const d of map.districts) {
        const col = DISTRICT_COLORS[d.id % DISTRICT_COLORS.length];
        path(d.poly, true);
        ctx.setLineDash([8, 5]); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
        const c = centroid(d.poly);
        const label = `${d.name}`, sub = `${Math.round((d.angle * 180) / Math.PI)}° · ${d.block[0]}×${d.block[1]} m · ${d.style}`;
        ctx.lineWidth = 4; ctx.strokeStyle = '#0d0a1c';
        ctx.strokeText(label, X(c[0]), Z(c[1])); ctx.fillStyle = col; ctx.fillText(label, X(c[0]), Z(c[1]));
        ctx.font = '11px Consolas, monospace';
        ctx.strokeText(sub, X(c[0]), Z(c[1]) + 14); ctx.fillStyle = '#ddd'; ctx.fillText(sub, X(c[0]), Z(c[1]) + 14);
        ctx.font = 'bold 13px Trebuchet MS, sans-serif';
      }
    }

    // Spieler
    ctx.save();
    ctx.translate(X(this.player.x), Z(this.player.z));
    ctx.rotate(-this.player.a + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff4f9a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 7); ctx.lineTo(0, 3); ctx.lineTo(-7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();

    this.drawPanel();
  }

  private drawPanel() {
    const { ctx, map, stats } = this;
    const lines = [
      `F3 Debug · ${stats.fps} FPS · ${stats.calls} Draw-Calls · ${(stats.triangles / 1000).toFixed(0)}k Dreiecke · ${stats.entities} Entitäten`,
      `Knoten ${map.nodes.length} · Kanten ${map.edges.length} · Blöcke ${map.blocks.length} · Grundstücke ${map.lots.length} · Gebäude ${map.buildings.length}`,
      `Spieler ${this.player.x.toFixed(0)} / ${this.player.z.toFixed(0)} m · Zelle ${CELL} m · Chunk ${CHUNK} m · Viertel: ${map.districtAt(this.player.x, this.player.z)?.name ?? '–'}`,
      'Ziehen = verschieben · Rad = Zoom · C = Spieler · 1 Gelände · 2 Straßen · 3 Blöcke · 4 Grundstücke · 5 Viertel · 6 Chunks',
    ];
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'left';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 20;
    ctx.fillStyle = 'rgba(13,10,28,0.85)';
    ctx.fillRect(10, 10, w, lines.length * 17 + 12);
    ctx.fillStyle = '#e8e0ff';
    lines.forEach((l, i) => ctx.fillText(l, 20, 28 + i * 17));

    // Legende
    const legend: [string, string][] = [
      ...ROAD_TYPE_NAMES.map((n, i): [string, string] => [n, ROAD_COLORS[i]]),
      ...LOT_USE_NAMES.map((n, i): [string, string] => [n, LOT_COLORS[i]]),
      ['Kreisverkehr', '#2af0e6'], ['Sackgasse', '#ff4f9a'],
    ];
    const y0 = this.canvas.height - legend.length * 16 - 20;
    ctx.fillStyle = 'rgba(13,10,28,0.85)';
    ctx.fillRect(10, y0 - 8, 150, legend.length * 16 + 14);
    legend.forEach(([name, col], i) => {
      ctx.fillStyle = col; ctx.fillRect(20, y0 + i * 16, 12, 10);
      ctx.fillStyle = '#e8e0ff'; ctx.fillText(name, 40, y0 + i * 16 + 10);
    });
  }
}

function dist(p: NpcDebugPed, q: { x: number; z: number }) { return Math.hypot(p.x - q.x, p.z - q.z); }
