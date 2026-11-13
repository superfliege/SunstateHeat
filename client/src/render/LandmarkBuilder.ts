// Optik der Wahrzeichen (#38, #39, #40): Krankenhaus, Polizeirevier, Lous Waschanlage mit Garage.
// Statische Geometrie in die Chunk-Builder (solid = mit Umriss/Schatten, neon = leuchtet nachts),
// Schriftzüge als eigene Flächen mit Canvas-Textur (wenige Stück, unbeleuchtet).
import * as THREE from 'three';
import type { BuildingDef } from '../../../shared/src/world/WorldMap';
import type { GeoBuilder } from './GeoBuilder';

export interface LandmarkCtx {
  solid: GeoBuilder; flat: GeoBuilder; neon: GeoBuilder;
  facade(x: number, z: number, w: number, d: number, rot: number, y0: number, h: number, mat: string, color: THREE.Color, roof: string | null): void;
  /** Schriftzug-Fläche (lokal zur Front ausgerichtet) hinzufügen */
  sign(mesh: THREE.Mesh): void;
}

/** Schild mit Text als Fläche (Breite w, Höhe h in m). */
export function textSign(text: string, w: number, h: number, bg: string, fg: string, font = 'bold', icon = ''): THREE.Mesh {
  const px = 64, cw = Math.max(64, Math.round(w * px)), chh = Math.max(32, Math.round(h * px));
  const cv = document.createElement('canvas');
  cv.width = Math.min(2048, cw); cv.height = Math.min(512, chh);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = fg; g.lineWidth = Math.max(2, cv.height * 0.06); g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cv.width - g.lineWidth, cv.height - g.lineWidth);
  g.fillStyle = fg;
  const label = icon ? `${icon} ${text}` : text;
  let size = cv.height * 0.62;
  g.font = `${font} ${size}px sans-serif`;
  while (g.measureText(label).width > cv.width * 0.9 && size > 8) { size *= 0.92; g.font = `${font} ${size}px sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, cv.width / 2, cv.height / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  m.name = 'landmarkSign';
  return m;
}

const WHITE = 0xffffff;

export function buildLandmark(ctx: LandmarkCtx, b: BuildingDef, base: number) {
  const s = Math.sin(b.rot), c = Math.cos(b.rot);
  const L = (lx: number, lz: number): [number, number] => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
  const hw = b.w / 2, hd = b.d / 2, y0 = base - 1.2, top = base + b.h;
  const box = (g: GeoBuilder, lx: number, ly: number, lz: number, w: number, h: number, d: number, color: number, top2?: number) => {
    const [x, z] = L(lx, lz);
    g.box(x, ly, z, w, h, d, b.rot, color, top2);
  };
  const place = (m: THREE.Mesh, lx: number, ly: number, lz: number) => {
    const [x, z] = L(lx, lz);
    m.position.set(x, ly, z);
    m.rotation.y = b.rot;
    ctx.sign(m);
  };

  if (b.tag === 'hospital') {
    // Hauptbau: weißer Klinikblock mit Glasbändern, flacher Anbau (Notaufnahme) vorne
    ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, top - y0, 'facade_office', new THREE.Color(0xf4f7fb), 'roof_gravel');
    const g = ctx.solid;
    g.use('flat');
    box(g, 0, base + 3.4, hd + 0.12, b.w + 0.2, 0.5, 0.3, 0x2bb3a3); // türkises Band über dem Erdgeschoss
    box(g, 0, top - 1.3, hd + 0.12, b.w + 0.2, 0.4, 0.3, 0x2bb3a3);
    // Vordach der Notaufnahme mit Stützen
    box(g, 0, base + 3.7, hd + 2.4, 14, 0.45, 4.6, 0xf2f2f2);
    for (const lx of [-6.4, -2.2, 2.2, 6.4]) box(g, lx, base, hd + 4.4, 0.35, 3.7, 0.35, 0xd8dde4);
    g.use('kit_glass');
    box(g, 0, base, hd + 0.08, 6, 3, 0.2, WHITE); // Glastür
    // Rotes Kreuz an der Front (leuchtet nachts) und auf dem Dach
    const crossY = top - 4.2;
    for (const [w, h] of [[3.6, 1.1], [1.1, 3.6]] as const) box(ctx.neon, 0, crossY - h / 2, hd + 0.2, w, h, 0.18, 0xff2a3a);
    // Hubschrauberlandeplatz auf dem Dach
    const g2 = ctx.flat;
    g2.use('concrete');
    box(g2, -hw * 0.45, top + 0.02, 0, 11, 0.12, 11, 0x5a5f69);
    g2.use('paint_white');
    box(g2, -hw * 0.45 - 1.4, top + 0.15, 0, 0.6, 0.03, 4.4, WHITE);
    box(g2, -hw * 0.45 + 1.4, top + 0.15, 0, 0.6, 0.03, 4.4, WHITE);
    box(g2, -hw * 0.45, top + 0.15, 0, 2.2, 0.03, 0.6, WHITE);
    // Haustechnik auf dem Dach
    g.use('alu_siding');
    box(g, hw * 0.5, top, -hd * 0.3, 5, 1.8, 4, 0xc8ccd2);
    // Krankenwagen-Bucht: Markierung auf dem Vorplatz
    g2.use('paint_yellow');
    for (const lx of [9, 12.5]) box(g2, lx, base + 0.03, hd + 2.2, 0.15, 0.02, 4, WHITE);
    place(textSign('PALMARA GENERAL HOSPITAL', 16, 1.4, '#f8fbff', '#c4161c', 'bold', '✚'), 0, base + 4.6, hd + 4.75);
    place(textSign('NOTAUFNAHME', 6, 0.8, '#c4161c', '#ffffff'), 0, base + 3.1, hd + 0.25);
    return;
  }

  if (b.tag === 'police') {
    // Revier: hellblau-weißer Bau, dunkelblaues Band, Treppe, Blaulichter, Fahnenmasten
    ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, top - y0, 'facade_office', new THREE.Color(0xe3ebf6), 'roof_gravel');
    const g = ctx.solid;
    g.use('flat');
    box(g, 0, top - 2.2, hd + 0.12, b.w + 0.2, 1.7, 0.3, 0x1b2f6e); // Schildband
    box(g, 0, base + 3.3, hd + 0.12, b.w + 0.2, 0.35, 0.3, 0x1b2f6e);
    // Eingang: Treppe, Vordach, Glastür
    g.use('concrete');
    box(g, 0, base, hd + 1.2, 8, 0.25, 2.4, 0xd0d0d0);
    box(g, 0, base + 0.25, hd + 0.8, 7, 0.25, 1.6, 0xd8d8d8);
    g.use('flat');
    box(g, 0, base + 3.4, hd + 1.4, 9, 0.35, 2.8, 0x1b2f6e);
    for (const lx of [-4, 4]) box(g, lx, base, hd + 2.6, 0.3, 3.4, 0.3, 0xd8dde4);
    g.use('kit_glass');
    box(g, 0, base + 0.5, hd + 0.08, 4.4, 2.6, 0.2, WHITE);
    // Blaulichter neben der Tür (leuchten nachts)
    for (const lx of [-2.9, 2.9]) box(ctx.neon, lx, base + 2.6, hd + 0.25, 0.5, 0.5, 0.3, 0x2f6bff);
    // Fahnenmasten
    g.use('flat');
    for (const [lx, col] of [[-9, 0x1b2f6e], [-7, 0xffd23a]] as const) {
      const [x, z] = L(lx, hd + 2.2);
      g.cylinder(x, base, z, 0.08, 8, 6, 0xdadada);
      box(g, lx + 0.8, base + 6.8, hd + 2.2, 1.5, 1, 0.06, col);
    }
    // Funkmast auf dem Dach
    const [ax, az] = L(hw * 0.6, -hd * 0.4);
    g.cylinder(ax, top, az, 0.15, 7, 6, 0xb0b0b0);
    place(textSign('POLIZEI', 10, 1.4, '#1b2f6e', '#ffffff', 'bold', '★'), 0, top - 1.35, hd + 0.3);
    place(textSign('REVIER DOWNTOWN', 6, 0.7, '#ffffff', '#1b2f6e'), 0, base + 4.1, hd + 2.85);
    return;
  }

  if (b.tag === 'garage') {
    // Lous Waschanlage „Bubble Bath“ (links) mit Garage (rechts) – Story-Hauptpunkt
    ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, top - y0, 'facade_house', new THREE.Color(0xfde3ef), 'roof_gravel');
    const g = ctx.solid;
    // Waschstraße: offene Einfahrt (dunkel), Bürsten, Schaum
    g.use('flat');
    box(g, -hw * 0.45, base, hd + 0.06, 8, 4.6, 0.2, 0x2a2430);
    for (const lx of [-hw * 0.45 - 2.6, -hw * 0.45 + 2.6]) {
      const [x, z] = L(lx, hd - 0.6);
      g.cylinder(x, base, z, 0.55, 4.2, 10, 0x3aa6ff);
    }
    box(g, -hw * 0.45, base + 4.2, hd - 0.6, 6, 0.6, 0.6, 0x3aa6ff); // Dachbürste
    // Garage: Rolltor (Alu), daneben Personaltür
    g.use('alu_siding');
    box(g, hw * 0.42, base, hd + 0.06, 7.5, 4.2, 0.2, 0xd6d9de);
    g.use('flat');
    box(g, hw * 0.42, base + 4.2, hd + 0.15, 8.2, 0.35, 0.35, 0xff5fa2);
    box(g, hw * 0.02, base, hd + 0.06, 1.1, 2.2, 0.15, 0x7a4a6a);
    // Seifenblasen auf dem Dach (Wahrzeichen)
    const bubble = (lx: number, ly: number, lz: number, r: number, col: number) => {
      const geo = new THREE.SphereGeometry(r, 10, 7).toNonIndexed();
      const n = geo.getAttribute('position').count;
      const cc = new THREE.Color(col), arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([cc.r, cc.g, cc.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      const [x, z] = L(lx, lz);
      g.use('flat').addGeometry(geo, new THREE.Matrix4().makeTranslation(x, ly, z));
    };
    bubble(-hw * 0.5, top + 1.4, hd * 0.2, 1.4, 0x9fe3ff);
    bubble(-hw * 0.2, top + 2.3, hd * 0.1, 0.9, 0xffb7dc);
    bubble(-hw * 0.7, top + 2.6, -hd * 0.1, 0.7, 0xc8f1ff);
    // Neon-Rahmen der Einfahrt (nachts pink)
    box(ctx.neon, -hw * 0.45, base + 4.65, hd + 0.2, 8.2, 0.18, 0.12, 0xff4fae);
    place(textSign('BUBBLE BATH', 9, 1.3, '#ff5fa2', '#ffffff'), -hw * 0.45, top - 1.0, hd + 0.25);
    place(textSign('GARAGE', 5, 0.9, '#2a2430', '#ffd23a'), hw * 0.42, base + 5.1, hd + 0.25);
  }
}
