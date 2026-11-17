// Sprechblasen im DS-Stil für Innenräume und Straßenszenen der Venues – alle Stile des Ereignis-Systems:
// say (rund), shout (gezackt, rot umrandet), whisper (gestrichelt), think (Wolke), gang (Gangfarbe),
// symbol (nur Symbol, groß), sfx (Comic-Lautmalerei, gelb). Sprites liegen auf der Overlay-Ebene (scharf).
import * as THREE from 'three';
import type { BubbleStyle } from '../../../shared/src/content/events/schema';
import { OVERLAY_LAYER } from '../render/PostFX';

export interface VBubble { sprite: THREE.Sprite; t: number; w: number; h: number; life: number; follow: (() => THREE.Vector3 | null) | null; pos: THREE.Vector3 }

export function makeBubble(text: string, style: BubbleStyle, gangColor = '#ff2fd0'): { sprite: THREE.Sprite; w: number; h: number } {
  text = text.trim() || '…';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const big = style === 'symbol' || style === 'sfx';
  const font = `${style === 'shout' || big ? '900' : 'bold'} ${big ? 40 : 30}px Trebuchet MS, sans-serif`;
  ctx.font = font;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > 320 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const lh = big ? 44 : 34;
  const W = Math.ceil(tw + 60), H = lines.length * lh + 34 + 26;
  c.width = W + 16; c.height = H + 16;
  const g = c.getContext('2d')!;
  const ox = 8, oy = 8, bw = W - 6, bh = H - 30;
  const fill = style === 'gang' ? gangColor : style === 'sfx' ? '#ffe14d' : '#fffdf4';
  const ink = style === 'gang' ? '#ffffff' : '#1a1030';
  const outline = style === 'shout' ? '#e0203a' : '#1a1030';
  const path = (dx: number, dy: number) => {
    g.beginPath();
    if (style === 'shout' || style === 'sfx') {
      // gezackte Explosion
      const cx = ox + dx + bw / 2, cy = oy + dy + bh / 2, n = 18;
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? 1 : 0.86;
        const x = cx + Math.cos(a) * (bw / 2 + 8) * r, y = cy + Math.sin(a) * (bh / 2 + 6) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    } else if (style === 'think') {
      const cx = ox + dx + bw / 2, cy = oy + dy + bh / 2;
      g.ellipse(cx, cy, bw / 2, bh / 2, 0, 0, Math.PI * 2);
      g.moveTo(ox + dx + bw * 0.3 + 9, oy + dy + bh + 10); g.arc(ox + dx + bw * 0.3, oy + dy + bh + 10, 9, 0, Math.PI * 2);
      g.moveTo(ox + dx + bw * 0.24 + 5, oy + dy + bh + 24); g.arc(ox + dx + bw * 0.24, oy + dy + bh + 24, 5, 0, Math.PI * 2);
    } else {
      g.roundRect(ox + dx, oy + dy, bw, bh, 16);
      g.moveTo(W * 0.32 + dx, oy + bh + dy - 1); g.lineTo(W * 0.26 + dx, H + dy); g.lineTo(W * 0.46 + dx, oy + bh + dy - 1);
    }
  };
  if (style !== 'symbol') {
    g.fillStyle = 'rgba(26,16,48,0.85)'; path(5, 5); g.fill();
    g.fillStyle = fill; g.strokeStyle = outline; g.lineWidth = style === 'shout' ? 6 : 5; g.lineJoin = 'round';
    if (style === 'whisper') g.setLineDash([10, 8]);
    path(0, 0); g.fill(); g.stroke(); g.setLineDash([]);
  }
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = style === 'symbol' ? '#ffffff' : ink;
  if (style === 'symbol') { g.strokeStyle = '#1a1030'; g.lineWidth = 6; }
  lines.forEach((l, i) => {
    const y = oy + 17 + lh / 2 + i * lh - 2;
    if (style === 'symbol') g.strokeText(l, (W + 2) / 2, y);
    if (style === 'whisper') g.globalAlpha = 0.75;
    g.fillText(l, (W + 2) / 2, y);
    g.globalAlpha = 1;
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, transparent: true, color: 0xd8d8d8, toneMapped: false }));
  sprite.renderOrder = 11;
  sprite.layers.set(OVERLAY_LAYER);
  sprite.center.set(0.3, 0);
  const k = 1 / 100;
  return { sprite, w: c.width * k, h: c.height * k };
}

/** Verwaltung: Blasen folgen einer Figur (follow) oder stehen an einer Position, max. N gleichzeitig. */
export class BubbleLayer {
  readonly group = new THREE.Group();
  private list: VBubble[] = [];
  constructor(private max = 7) { this.group.name = 'venueBubbles'; }

  show(text: string, style: BubbleStyle, follow: (() => THREE.Vector3 | null) | null, at?: THREE.Vector3, gangColor?: string) {
    const b = makeBubble(text, style, gangColor);
    b.sprite.scale.set(0.01, 0.01, 1);
    this.group.add(b.sprite);
    const life = Math.min(6, 2.4 + text.length * 0.05);
    this.list.push({ sprite: b.sprite, t: 0, w: b.w, h: b.h, life, follow, pos: at ? at.clone() : new THREE.Vector3() });
    while (this.list.length > this.max) this.drop(0);
  }

  private drop(i: number) {
    const b = this.list[i];
    this.group.remove(b.sprite); b.sprite.material.map?.dispose(); b.sprite.material.dispose();
    this.list.splice(i, 1);
  }

  update(dt: number, scale = 1) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t += dt;
      const p = b.follow ? b.follow() : b.pos;
      if (!p || b.t > b.life) { this.drop(i); continue; }
      const pop = b.t < 0.18 ? 0.4 + (b.t / 0.18) * 0.8 : b.t < 0.3 ? 1.2 - ((b.t - 0.18) / 0.12) * 0.2 : 1;
      const k = 1.1 * pop * scale;
      b.sprite.scale.set(b.w * k, b.h * k, 1);
      b.sprite.position.set(p.x, p.y + (b.follow ? 2.3 : 0), p.z);
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, (b.life - b.t) / 0.35);
    }
  }

  clear() { while (this.list.length) this.drop(0); }
}
