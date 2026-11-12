// Minimap im Stil eines zweiten DS-Bildschirms: pixelige Karte, Norden oben,
// zentriert auf den Spieler. M schaltet eine große Gesamtkarte ein; dort zeigt ein Tooltip
// beim Überfahren (Maus) bzw. Antippen (Touch) eines Punkts, was sich dahinter verbirgt.
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
}

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

  constructor(map: WorldMap, canvas: HTMLCanvasElement, bigCanvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bigCtx = bigCanvas.getContext('2d')!;
    this.bigEl = bigCanvas.parentElement!;
    this.base = renderMapImage(map);
    const track = (e: PointerEvent) => {
      const b = bigCanvas.getBoundingClientRect();
      if (!b.width) return;
      this.hover = { x: (e.clientX - b.left) * (bigCanvas.width / b.width), y: (e.clientY - b.top) * (bigCanvas.height / b.height) };
    };
    bigCanvas.addEventListener('pointermove', track);
    bigCanvas.addEventListener('pointerdown', track);
    bigCanvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hover = null; });
  }

  get bigVisible() { return !this.bigEl.classList.contains('hidden'); }
  toggleBig() { this.bigEl.classList.toggle('hidden'); this.hover = null; }

  draw(px: number, pz: number, pa: number, zoomOut: boolean, dots: MapDot[], route: MapRoute | null = null) {
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
      if (out && (!d.ring || d.icon)) continue; // Minispiel-Telefone nicht am Rand stapeln
      // Quest-Ziele außerhalb werden am Rand festgeklemmt
      sx = Math.max(6, Math.min(W - 6, sx));
      sy = Math.max(6, Math.min(W - 6, sy));
      this.dot(ctx, sx, sy, d);
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
    const s = W / WORLD_SIZE;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base, 0, 0, W, W);
    // Zonennamen
    ctx.font = 'bold 15px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    const label = (t: string, x: number, z: number) => {
      ctx.strokeStyle = '#120d1f'; ctx.strokeText(t, x * s, z * s);
      ctx.fillStyle = '#ffffff'; ctx.fillText(t, x * s, z * s);
    };
    label('PINECREST HIGHLANDS', 896, 80);
    label('PORT SABAL', 624, 500);
    label('CANE RIDGE', 1072, 580);
    label('DRY PINE COUNTRY', 864, 960);
    label('PORT CORALIA', 1300, 730);
    label('GATOR FLATS', 900, 1420);
    label('CORAL KEYS', 900, 1990);
    if (route) this.routeLine(ctx, route.pts.map(([x, z]) => [x * s, z * s]), 4);
    for (const d of dots) if (!d.icon) this.dot(ctx, d.x * s, d.z * s, { ...d, size: d.size + 1 });
    for (const d of dots) if (d.icon) this.iconDot(ctx, d.x * s, d.z * s, d); // Symbole obenauf
    this.arrow(ctx, px * s, pz * s, pa);

    // Tooltip: nächster beschrifteter Punkt unter dem Zeiger
    const h = this.hover;
    if (!h) return;
    let best: MapDot | null = null, bd = 12 * 12;
    for (const d of dots) {
      if (!d.label) continue;
      const q = (d.x * s - h.x) ** 2 + (d.z * s - h.y) ** 2;
      if (q < bd) { bd = q; best = d; }
    }
    if (best) this.tooltip(ctx, best.x * s, best.z * s, best);
  }

  private iconDot(ctx: CanvasRenderingContext2D, sx: number, sy: number, d: MapDot) {
    ctx.fillStyle = d.color;
    ctx.strokeStyle = '#120d1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(sx - 9, sy - 9, 18, 18, 4);
    ctx.fill(); ctx.stroke();
    ctx.font = '12px sans-serif';
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
