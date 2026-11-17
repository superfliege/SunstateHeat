// Minimap im Stil eines zweiten DS-Bildschirms: pixelige Karte, Norden oben,
// zentriert auf den Spieler. K schaltet eine große Gesamtkarte ein; dort zeigt ein Tooltip
// beim Überfahren (Maus) bzw. Antippen (Touch) eines Punkts, was sich dahinter verbirgt.
// Große Karte: Zoom (Mausrad, Doppelklick, Knöpfe), Verschieben (Ziehen), Ortssuche (Club, Casino,
// Läden, Telefone, Wahrzeichen, Viertel) und Wegpunkt per Klick → GPS-Route.
import { CELL, GRID_SIZE, OUTFIT_COLORS, WORLD_SIZE } from '../../../shared/src/constants';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { groundColor } from '../render/WorldView';

/** Navigationsroute (GPS): Polylinie in Weltmetern vom Spieler zum Ziel und Restlänge. */
export interface MapRoute { pts: [number, number][]; dist: number }

export interface MapDot {
  x: number; z: number; color: string; size: number; ring?: boolean;
  /** Tooltip auf der großen Karte: erste Zeile = Titel, danach Beschreibung. */
  label?: string[];
  /** Symbol auf der großen Karte (z. B. Minispiel-Emoji). */
  icon?: string;
  /** Zusätzliche Suchbegriffe (Kartensuche), z. B. „casino glücksspiel“. */
  keys?: string;
  /** Wichtiger Ort: Symbol auch auf der kleinen Minimap. */
  poi?: boolean;
}

/** Suchtreffer der Kartensuche. */
interface SearchHit { title: string; sub: string; x: number; z: number; icon: string; color: string }

const fold = (t: string) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ZONES: [string, number, number][] = [
  ['PINECREST HIGHLANDS', 896, 80], ['PORT SABAL', 624, 500], ['CANE RIDGE', 1072, 580], ['DRY PINE COUNTRY', 864, 960],
  ['PORT CORALIA', 1300, 730], ['GATOR FLATS', 900, 1420], ['CORAL KEYS', 900, 1990],
];

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/** Kartenbild (1 Pixel je Zelle) – auch für das Debug-Overlay. */
export function renderMapImage(map: WorldMap): HTMLCanvasElement {
  const base = document.createElement('canvas');
  base.width = base.height = GRID_SIZE;
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(GRID_SIZE, GRID_SIZE);
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = map.tile(x, z);
      let c = groundColor(map, t, (x + 0.5) * CELL, (z + 0.5) * CELL);
      if (t === Tile.WATER) c = 0x1fa8b8;
      if (t === Tile.SWAMP) c = 0x3f6b4a;
      if (t === Tile.BRIDGE || t === Tile.ROAD) c = 0x3a3a4a;
      if (t === Tile.SIDEWALK) c = 0xa89a9a;
      if (t === Tile.DOCK) c = 0x9b6b43;
      if (t === Tile.BUILDING) c = 0xb59ac8;
      const i = (z * GRID_SIZE + x) * 4;
      img.data[i] = (c >> 16) & 255; img.data[i + 1] = (c >> 8) & 255; img.data[i + 2] = c & 255; img.data[i + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  return base;
}

export class Minimap {
  readonly base: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bigCtx: CanvasRenderingContext2D;
  private bigEl: HTMLElement;
  /** Zeiger über der großen Karte (Canvas-Pixel) oder null. */
  private hover: { x: number; y: number } | null = null;
  /** Große Karte: Zoom (1 = ganze Insel) und Mittelpunkt (Weltmeter). */
  private zoom = 1;
  private cx = WORLD_SIZE / 2;
  private cz = WORLD_SIZE / 2;
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean } | null = null;
  /** Hervorgehobener Ort (Suche) und Wegpunkt (GPS). */
  private focusHit: SearchHit | null = null;
  private focusT = 0;
  private searchEl: HTMLInputElement;
  private resultEl: HTMLDivElement;
  private lastDots: MapDot[] = [];
  private districts: { name: string; x: number; z: number }[];
  /** Wegpunkt gesetzt (null = gelöscht) – das Spiel führt dann per GPS-Route dorthin. */
  onWaypoint: (p: { x: number; z: number; title: string } | null) => void = () => {};
  waypoint: { x: number; z: number; title: string } | null = null;

  constructor(map: WorldMap, canvas: HTMLCanvasElement, bigCanvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bigCtx = bigCanvas.getContext('2d')!;
    this.bigEl = bigCanvas.parentElement!;
    this.base = renderMapImage(map);
    this.districts = map.districts.map((d) => {
      let x = 0, z = 0;
      for (const [px, pz] of d.poly) { x += px; z += pz; }
      return { name: d.name, x: x / d.poly.length, z: z / d.poly.length };
    });
    const toCanvas = (e: { clientX: number; clientY: number }) => {
      const b = bigCanvas.getBoundingClientRect();
      return b.width ? { x: (e.clientX - b.left) * (bigCanvas.width / b.width), y: (e.clientY - b.top) * (bigCanvas.height / b.height) } : null;
    };
    const track = (e: PointerEvent) => { this.hover = toCanvas(e); };
    bigCanvas.addEventListener('pointermove', (e) => {
      track(e);
      const d = this.drag;
      if (d && this.hover) {
        const s = this.scale();
        if (Math.hypot(this.hover.x - d.x, this.hover.y - d.y) > 4) d.moved = true;
        this.cx = d.cx - (this.hover.x - d.x) / s;
        this.cz = d.cz - (this.hover.y - d.y) / s;
        this.clampView();
      }
    });
    bigCanvas.addEventListener('pointerdown', (e) => {
      track(e);
      if (this.hover) { this.drag = { x: this.hover.x, y: this.hover.y, cx: this.cx, cz: this.cz, moved: false }; bigCanvas.setPointerCapture(e.pointerId); }
    });
    bigCanvas.addEventListener('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      // Klick (ohne Ziehen) auf einen beschrifteten Ort: Wegpunkt dorthin
      if (d && !d.moved) {
        const hit = this.dotAt(d.x, d.y);
        if (hit) this.pick({ title: hit.label![0], sub: hit.label![1] ?? '', x: hit.x, z: hit.z, icon: hit.icon ?? '📍', color: hit.color }, false);
      }
    });
    bigCanvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hover = null; });
    bigCanvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const h = toCanvas(e);
      this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, h?.x, h?.y);
    }, { passive: false });
    bigCanvas.addEventListener('dblclick', (e) => { const h = toCanvas(e); this.zoomAt(2, h?.x, h?.y); });

    // Bedienleiste: Suche, Treffer, Zoom, Wegpunkt löschen
    const bar = document.createElement('div');
    bar.id = 'bigmap-bar';
    bar.innerHTML = `<div class="bm-search"><input type="search" placeholder="🔍 Ort suchen – z. B. Casino, Nachtclub, Krankenhaus …" autocomplete="off" spellcheck="false"><div class="bm-results"></div></div>
      <div class="bm-zoom"><button data-z="in" title="Hineinzoomen (Mausrad)">＋</button><button data-z="out" title="Herauszoomen">－</button><button data-z="all" title="Ganze Karte">⤢</button><button data-z="me" title="Zu mir">◎</button><button data-z="clear" title="Wegpunkt löschen">✖ Ziel</button></div>`;
    this.bigEl.appendChild(bar);
    this.searchEl = bar.querySelector('input')!;
    this.resultEl = bar.querySelector('.bm-results')!;
    // Tippen im Suchfeld nicht ans Spiel weitergeben (Enter = Chat, E/F/M … = Aktionen)
    for (const ev of ['keydown', 'keyup'] as const) this.searchEl.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev !== 'keydown') return;
      if (e.key === 'Escape') { this.searchEl.value = ''; this.searchEl.blur(); this.renderResults(); }
      if (e.key === 'Enter') { const first = this.results()[0]; if (first) this.pick(first, true); }
    });
    this.searchEl.addEventListener('input', () => this.renderResults());
    this.resultEl.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
      if (el) { const hit = this.results()[Number(el.dataset.i)]; if (hit) this.pick(hit, true); }
    });
    bar.querySelector('.bm-zoom')!.addEventListener('click', (e) => {
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      if (z === 'in') this.zoomAt(1.5);
      else if (z === 'out') this.zoomAt(1 / 1.5);
      else if (z === 'all') { this.zoom = 1; this.cx = this.cz = WORLD_SIZE / 2; }
      else if (z === 'me') { this.zoom = Math.max(this.zoom, 3); this.cx = this.me.x; this.cz = this.me.z; this.clampView(); }
      else if (z === 'clear') { this.waypoint = null; this.focusHit = null; this.onWaypoint(null); }
    });
  }
  private me = { x: 0, z: 0 };

  get bigVisible() { return !this.bigEl.classList.contains('hidden'); }
  toggleBig() { this.bigEl.classList.toggle('hidden'); this.hover = null; this.drag = null; if (!this.bigVisible) this.searchEl.blur(); }
  /** Große Karte öffnen und gleich ins Suchfeld (z. B. aus dem Handy). */
  openSearch(q = '') { if (!this.bigVisible) this.toggleBig(); this.searchEl.value = q; this.renderResults(); this.searchEl.focus(); }

  private scale() { return (this.bigCtx.canvas.width / WORLD_SIZE) * this.zoom; }
  private clampView() {
    const half = WORLD_SIZE / 2 / this.zoom;
    this.cx = Math.max(half, Math.min(WORLD_SIZE - half, this.cx));
    this.cz = Math.max(half, Math.min(WORLD_SIZE - half, this.cz));
  }
  /** Zoom um einen Bildpunkt (Canvas-Pixel; ohne = Mitte), der dabei an seiner Stelle bleibt. */
  private zoomAt(f: number, sx?: number, sy?: number) {
    const W = this.bigCtx.canvas.width;
    const s0 = this.scale();
    const px = sx ?? W / 2, py = sy ?? W / 2;
    const wx = this.cx + (px - W / 2) / s0, wz = this.cz + (py - W / 2) / s0;
    this.zoom = Math.max(1, Math.min(8, this.zoom * f));
    const s1 = this.scale();
    this.cx = wx - (px - W / 2) / s1; this.cz = wz - (py - W / 2) / s1;
    this.clampView();
  }

  /** Suchtreffer: beschriftete Orte (Club, Casino, Läden, Telefone, Wahrzeichen …) und Viertel. */
  private results(): SearchHit[] {
    const q = fold(this.searchEl.value.trim());
    if (!q) return [];
    const words = q.split(/\s+/);
    const out: SearchHit[] = [];
    const seen = new Set<string>();
    const add = (h: SearchHit, text: string) => {
      const t = fold(text);
      if (!words.every((w) => t.includes(w))) return;
      const key = `${h.title}@${Math.round(h.x / 20)},${Math.round(h.z / 20)}`;
      if (seen.has(key)) return;
      seen.add(key); out.push(h);
    };
    for (const d of this.lastDots) {
      if (!d.label) continue;
      const icon = d.icon ?? '📍';
      const title = d.label[0].startsWith(icon) ? d.label[0].slice(icon.length).trim() : d.label[0];
      add({ title, sub: d.label[1] ?? '', x: d.x, z: d.z, icon, color: d.color }, `${d.label.join(' ')} ${d.keys ?? ''}`);
    }
    for (const d of this.districts) add({ title: d.name, sub: 'Viertel', x: d.x, z: d.z, icon: '🗺️', color: '#ffffff' }, `${d.name} viertel stadtteil`);
    for (const [n, x, z] of ZONES) add({ title: n.charAt(0) + n.slice(1).toLowerCase().replace(/ (\w)/g, (m) => m.toUpperCase()), sub: 'Zone', x, z, icon: '🗺️', color: '#ffffff' }, `${n} zone`);
    // Nächste zuerst
    out.sort((a, b) => Math.hypot(a.x - this.me.x, a.z - this.me.z) - Math.hypot(b.x - this.me.x, b.z - this.me.z));
    return out.slice(0, 8);
  }
  private renderResults() {
    const list = this.results();
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const dist = (h: SearchHit) => { const d = Math.hypot(h.x - this.me.x, h.z - this.me.z); return d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(d / 10) * 10} m`; };
    this.resultEl.innerHTML = this.searchEl.value.trim() && !list.length
      ? '<div class="bm-none">Nichts gefunden.</div>'
      : list.map((h, i) => `<div class="bm-hit" data-i="${i}"><span class="bm-ic">${h.icon}</span><b>${esc(h.title)}</b><small>${esc(h.sub)} · ${dist(h)}</small></div>`).join('');
  }
  /** Ort auswählen: Karte hinzoomen, hervorheben, Wegpunkt (GPS-Route) setzen. */
  private pick(h: SearchHit, fromSearch: boolean) {
    this.focusHit = h; this.focusT = 0;
    if (fromSearch) { this.zoom = Math.max(this.zoom, 4); this.cx = h.x; this.cz = h.z; this.clampView(); this.searchEl.blur(); this.resultEl.innerHTML = ''; }
    this.waypoint = { x: h.x, z: h.z, title: h.title };
    this.onWaypoint(this.waypoint);
  }
  private dotAt(x: number, y: number): MapDot | null {
    let best: MapDot | null = null, bd = 14 * 14;
    for (const d of this.lastDots) {
      if (!d.label) continue;
      const p = this.toBig(d.x, d.z);
      const q = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (q < bd) { bd = q; best = d; }
    }
    return best;
  }
  private toBig(x: number, z: number) {
    const W = this.bigCtx.canvas.width, s = this.scale();
    return { x: W / 2 + (x - this.cx) * s, y: W / 2 + (z - this.cz) * s };
  }

  draw(px: number, pz: number, pa: number, zoomOut: boolean, dots: MapDot[], route: MapRoute | null = null) {
    this.lastDots = dots;
    this.me = { x: px, z: pz };
    const ctx = this.ctx;
    const W = ctx.canvas.width;
    const scale = zoomOut ? 0.32 : 0.5; // Pixel pro Meter
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1fa8b8';
    ctx.fillRect(0, 0, W, W);
    ctx.save();
    ctx.translate(W / 2 - px * scale, W / 2 - pz * scale);
    ctx.scale(scale * CELL, scale * CELL);
    ctx.drawImage(this.base, 0, 0);
    ctx.restore();

    const toScreen = (x: number, z: number) => ({ sx: W / 2 + (x - px) * scale, sy: W / 2 + (z - pz) * scale });
    if (route) this.routeLine(ctx, route.pts.map(([x, z]) => [W / 2 + (x - px) * scale, W / 2 + (z - pz) * scale]), 4);
    for (const d of dots) {
      let { sx, sy } = toScreen(d.x, d.z);
      const out = sx < 6 || sy < 6 || sx > W - 6 || sy > W - 6;
      if (out && (!d.ring || d.icon) && !d.poi) continue; // Minispiel-Telefone nicht am Rand stapeln
      // Quest-Ziele außerhalb werden am Rand festgeklemmt
      sx = Math.max(6, Math.min(W - 6, sx));
      sy = Math.max(6, Math.min(W - 6, sy));
      if (d.poi && d.icon) this.iconDot(ctx, sx, sy, d); else this.dot(ctx, sx, sy, d);
    }
    if (this.waypoint) {
      const p = toScreen(this.waypoint.x, this.waypoint.z);
      this.pin(ctx, Math.max(8, Math.min(W - 8, p.sx)), Math.max(14, Math.min(W - 4, p.sy)));
    }
    this.arrow(ctx, W / 2, W / 2, pa);
    if (route) this.routeDistance(ctx, W, route.dist);

    if (this.bigVisible) this.drawBig(px, pz, pa, dots, route);
  }

  /** GPS-Linie: dunkle Kontur, darüber hellblau (wie eine Navi-Route). */
  private routeLine(ctx: CanvasRenderingContext2D, pts: number[][], width: number) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = '#0b2a52';
    ctx.lineWidth = width + 3;
    ctx.stroke();
    ctx.strokeStyle = '#3ab4ff';
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.restore();
  }

  /** Restentfernung unten auf der Minimap. */
  private routeDistance(ctx: CanvasRenderingContext2D, W: number, dist: number) {
    const text = dist >= 1000 ? `📍 ${(dist / 1000).toFixed(1).replace('.', ',')} km` : `📍 ${Math.max(10, Math.round(dist / 10) * 10)} m`;
    ctx.save();
    ctx.font = 'bold 14px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(11, 42, 82, 0.85)';
    ctx.beginPath(); ctx.roundRect(W / 2 - w / 2, W - 26, w, 20, 8); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, W / 2, W - 11);
    ctx.restore();
  }

  private dot(ctx: CanvasRenderingContext2D, sx: number, sy: number, d: MapDot) {
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#120d1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (d.ring) {
      ctx.rect(sx - d.size, sy - d.size, d.size * 2, d.size * 2); // Quest-Punkte als Quadrat
    } else {
      ctx.arc(sx, sy, d.size, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
  }

  /** Spielerpfeil; a = Blickwinkel (vorwärts = sin a, cos a). */
  private arrow(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-a + Math.PI); // Kartenrotation: a=PI zeigt nach oben
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ff4f9a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawBig(px: number, pz: number, pa: number, dots: MapDot[], route: MapRoute | null) {
    const ctx = this.bigCtx;
    const W = ctx.canvas.width;
    const s = this.scale();
    const B = (x: number, z: number) => this.toBig(x, z);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1fa8b8';
    ctx.fillRect(0, 0, W, W);
    const o = B(0, 0);
    ctx.drawImage(this.base, o.x, o.y, WORLD_SIZE * s, WORLD_SIZE * s);
    ctx.font = 'bold 15px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    const label = (t: string, x: number, z: number, font?: string) => {
      const p = B(x, z);
      if (font) ctx.font = font;
      ctx.strokeStyle = '#120d1f'; ctx.strokeText(t, p.x, p.y);
      ctx.fillStyle = '#ffffff'; ctx.fillText(t, p.x, p.y);
    };
    // Zonennamen, ab Zoom 2 zusätzlich die Viertel
    for (const [n, x, z] of ZONES) label(n, x, z, 'bold 15px Trebuchet MS, sans-serif');
    if (this.zoom >= 2) for (const d of this.districts) label(d.name, d.x, d.z - 30 / this.zoom, 'bold 12px Trebuchet MS, sans-serif');
    if (route) this.routeLine(ctx, route.pts.map(([x, z]) => { const p = B(x, z); return [p.x, p.y]; }), 4);
    const inView = (p: { x: number; y: number }) => p.x > -20 && p.y > -20 && p.x < W + 20 && p.y < W + 20;
    const ds = Math.min(3, 1 + (this.zoom - 1) * 0.35);
    for (const d of dots) if (!d.icon) { const p = B(d.x, d.z); if (inView(p)) this.dot(ctx, p.x, p.y, { ...d, size: (d.size + 1) * ds }); }
    for (const d of dots) if (d.icon) { const p = B(d.x, d.z); if (inView(p)) this.iconDot(ctx, p.x, p.y, d, d.poi ? 1.35 * Math.min(1.6, ds) : 1); } // Symbole obenauf
    // Wichtige Orte ab Zoom 2 mit Namen
    if (this.zoom >= 2) for (const d of dots) if (d.poi && d.label) { const p = B(d.x, d.z); if (inView(p)) { ctx.font = 'bold 12px Trebuchet MS, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#120d1f'; ctx.strokeText(d.label[0], p.x, p.y - 18); ctx.fillStyle = d.color; ctx.fillText(d.label[0], p.x, p.y - 18); } }
    if (this.waypoint) { const p = B(this.waypoint.x, this.waypoint.z); this.pin(ctx, p.x, p.y); }
    // Suchtreffer: pulsierender Ring
    if (this.focusHit) {
      this.focusT += 1 / 15;
      const p = B(this.focusHit.x, this.focusHit.z), r = 14 + (this.focusT * 20) % 18;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.globalAlpha = Math.max(0, 1 - ((this.focusT * 20) % 18) / 18);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const me = B(px, pz);
    this.arrow(ctx, me.x, me.y, pa);
    // Maßstab
    ctx.font = 'bold 11px Trebuchet MS, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#120d1f'; ctx.lineWidth = 3;
    const metres = this.zoom >= 4 ? 100 : this.zoom >= 2 ? 250 : 500;
    ctx.fillRect(12, W - 16, metres * s, 4);
    ctx.strokeText(`${metres} m · Zoom ${this.zoom.toFixed(1).replace('.', ',')}x`, 12, W - 22); ctx.fillText(`${metres} m · Zoom ${this.zoom.toFixed(1).replace('.', ',')}x`, 12, W - 22);

    // Tooltip: nächster beschrifteter Punkt unter dem Zeiger
    const h = this.hover;
    if (!h || this.drag?.moved) return;
    const best = this.dotAt(h.x, h.y);
    if (best) { const p = B(best.x, best.z); this.tooltip(ctx, p.x, p.y, { ...best, label: [...best.label!, 'Klick: Wegpunkt setzen (GPS)'] }); }
  }

  /** Stecknadel für den Wegpunkt. */
  private pin(ctx: CanvasRenderingContext2D, x: number, y: number) {
    ctx.fillStyle = '#ff3fa4'; ctx.strokeStyle = '#120d1f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y - 12); ctx.arc(x, y - 14, 6, Math.PI * 0.85, Math.PI * 2.15); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y - 14, 2.2, 0, Math.PI * 2); ctx.fill();
  }

  private iconDot(ctx: CanvasRenderingContext2D, sx: number, sy: number, d: MapDot, k = 1) {
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#120d1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(sx - 9 * k, sy - 9 * k, 18 * k, 18 * k, 4 * k);
    ctx.fill(); ctx.stroke();
    ctx.font = `${Math.round(12 * k)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.icon!, sx, sy + 1);
    ctx.textBaseline = 'alphabetic';
  }

  private tooltip(ctx: CanvasRenderingContext2D, sx: number, sy: number, d: MapDot) {
    const W = ctx.canvas.width, maxW = 280, pad = 8, lh = 16;
    // Zeilen umbrechen
    const lines: { text: string; bold: boolean }[] = [];
    d.label!.forEach((raw, i) => {
      ctx.font = i === 0 ? 'bold 14px Trebuchet MS, sans-serif' : '12px Trebuchet MS, sans-serif';
      let cur = '';
      for (const word of raw.split(' ')) {
        const next = cur ? `${cur} ${word}` : word;
        if (cur && ctx.measureText(next).width > maxW) { lines.push({ text: cur, bold: i === 0 }); cur = word; } else cur = next;
      }
      if (cur) lines.push({ text: cur, bold: i === 0 });
    });
    let w = 0;
    for (const l of lines) { ctx.font = l.bold ? 'bold 14px Trebuchet MS, sans-serif' : '12px Trebuchet MS, sans-serif'; w = Math.max(w, ctx.measureText(l.text).width); }
    const bw = w + pad * 2, bh = lines.length * lh + pad * 2 - 2;
    let bx = sx + 14, by = sy - bh / 2;
    if (bx + bw > W - 4) bx = sx - 14 - bw;
    by = Math.max(4, Math.min(W - bh - 4, by));
    // Markierung um den Punkt
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(18, 13, 31, 0.92)';
    ctx.strokeStyle = d.color;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = l.bold ? 'bold 14px Trebuchet MS, sans-serif' : '12px Trebuchet MS, sans-serif';
      ctx.fillStyle = l.bold ? '#ffffff' : '#d6cfe8';
      ctx.fillText(l.text, bx + pad, by + pad + i * lh);
    });
    ctx.textBaseline = 'alphabetic';
  }
}

export const playerDotColor = (outfit: number) => hex(OUTFIT_COLORS[outfit % OUTFIT_COLORS.length]);
