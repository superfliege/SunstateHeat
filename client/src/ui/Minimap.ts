// Minimap im Stil eines zweiten DS-Bildschirms: pixelige Karte, Norden oben,
// zentriert auf den Spieler. M schaltet eine große Gesamtkarte ein.
import { CELL, GRID_SIZE, OUTFIT_COLORS, WORLD_SIZE } from '../../../shared/src/constants';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { groundColor } from '../render/WorldView';

export interface MapDot { x: number; z: number; color: string; size: number; ring?: boolean }

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

  constructor(map: WorldMap, canvas: HTMLCanvasElement, bigCanvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.bigCtx = bigCanvas.getContext('2d')!;
    this.bigEl = bigCanvas.parentElement!;
    this.base = renderMapImage(map);
  }

  get bigVisible() { return !this.bigEl.classList.contains('hidden'); }
  toggleBig() { this.bigEl.classList.toggle('hidden'); }

  draw(px: number, pz: number, pa: number, zoomOut: boolean, dots: MapDot[]) {
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
    for (const d of dots) {
      let { sx, sy } = toScreen(d.x, d.z);
      const out = sx < 6 || sy < 6 || sx > W - 6 || sy > W - 6;
      if (out && !d.ring) continue;
      // Quest-Ziele außerhalb werden am Rand festgeklemmt
      sx = Math.max(6, Math.min(W - 6, sx));
      sy = Math.max(6, Math.min(W - 6, sy));
      this.dot(ctx, sx, sy, d);
    }
    this.arrow(ctx, W / 2, W / 2, pa);

    if (this.bigVisible) this.drawBig(px, pz, pa, dots);
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

  private drawBig(px: number, pz: number, pa: number, dots: MapDot[]) {
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
    for (const d of dots) this.dot(ctx, d.x * s, d.z * s, { ...d, size: d.size + 1 });
    this.arrow(ctx, px * s, pz * s, pa);
  }
}

export const playerDotColor = (outfit: number) => hex(OUTFIT_COLORS[outfit % OUTFIT_COLORS.length]);
