// Statische Optik des Flughafens Port Coralia International und der Flugfelder: Bahnen (Asphalt,
// Mittellinie, Schwellen, Bahnnummern, Rand- und Anflugbefeuerung), Rollwege mit gelben Markierungen,
// Vorfeld mit Parkpositionen, Parkplatz, Helipads, Tankstelle sowie die Flughafengebäude und der Zaun.
// Schreibt in die Chunk-Geometrien von WorldView (gleiche Materialien, Umrisslinien, Schatten).
// Bewegliches (Schranke, Leuchtfeuer, Neon-Schriftzug, Deko-Verkehr) liegt in AirportView.ts.
import * as THREE from 'three';
import {
  AIR_FUEL, AIRPORT_APRON, AIRPORT_PARKING, HANGAR_1, HELIPADS, STANDS, TAXIWAYS, runwayNames,
} from '../../../shared/src/world/airport';
import { centroid, orientedRect, type Vec2 } from '../../../shared/src/world/geometry';
import { Tile } from '../../../shared/src/world/tiles';
import { CURB_TOP, type BuildingDef, type Runway, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { GeoBuilder } from './GeoBuilder';

export interface AirportChunk { flat: GeoBuilder; solid: GeoBuilder; decals: GeoBuilder; neon: GeoBuilder; lamps: THREE.Matrix4[]; pools: THREE.Matrix4[] }
export interface AirportCtx {
  map: WorldMap;
  chunk(x: number, z: number): AirportChunk;
}

const WHITE = 0xffffff;
const YELLOW = 0xffd23a;
const EDGE_LIGHT = 0xfff2c0, GREEN_LIGHT = 0x6dff9c, APPROACH_LIGHT = 0xffffff, BLUE_LIGHT = 0x4f8bff;

const groundY = (map: WorldMap, x: number, z: number) => Math.max(0.05, map.terrainHeight(x, z));
const m4 = (x: number, y: number, z: number, s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, 1, s));

// ------------------------------------------------------------------ Siebensegment-Schrift (Bahnnummern)
// Segmente in Zellkoordinaten (u nach rechts 0..1, v nach vorne 0..1): [u0, v0, u1, v1]
const SEG: Record<string, [number, number, number, number]> = {
  a: [0, 1, 1, 1], b: [1, 0.5, 1, 1], c: [1, 0, 1, 0.5], d: [0, 0, 1, 0], e: [0, 0, 0, 0.5], f: [0, 0.5, 0, 1], g: [0, 0.5, 1, 0.5],
};
const GLYPH: Record<string, string> = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  L: 'fed', R: 'abefg/', P: 'abefg', H: 'bcefg',
};

/**
 * Text flach auf den Boden malen. (ox, oz) = Mitte der Grundlinie, (fx, fz) = Leserichtung "oben",
 * Zeichen w x h Meter, Strichstärke t.
 */
function paintText(g: GeoBuilder, text: string, ox: number, y: number, oz: number, fx: number, fz: number, w: number, h: number, t: number, color = WHITE) {
  const rx = -fz, rz = fx; // rechts (von oben gesehen, Blick entlang f)
  const rot = Math.atan2(fx, fz);
  const gap = w * 0.45, total = text.length * w + (text.length - 1) * gap;
  for (let i = 0; i < text.length; i++) {
    const segs = GLYPH[text[i]] ?? '';
    const u0 = -total / 2 + i * (w + gap);
    for (const s of segs) {
      if (s === '/') {
        // Schrägstrich des R (Mitte -> unten rechts)
        const cu = u0 + w * 0.65, cv = h * 0.25, len = Math.hypot(w * 0.6, h * 0.5);
        g.box(ox + rx * cu + fx * cv, y, oz + rz * cu + fz * cv, t, 0.01, len, rot + Math.atan2(w * 0.6, h * 0.5), color);
        continue;
      }
      const [a0, b0, a1, b1] = SEG[s];
      const cu = u0 + ((a0 + a1) / 2) * w, cv = ((b0 + b1) / 2) * h;
      const horiz = b0 === b1;
      const len = horiz ? w + t : h / 2 + t;
      const px = ox + rx * cu + fx * cv, pz = oz + rz * cu + fz * cv;
      // box: w entlang lokaler x-Achse (= -rechts), d entlang f
      if (horiz) g.box(px, y, pz, len, 0.01, t, rot, color);
      else g.box(px, y, pz, t, 0.01, len, rot, color);
    }
  }
}

// ------------------------------------------------------------------ Boden
export function buildAirportGround(ctx: AirportCtx) {
  const { map } = ctx;
  // Vorfeld und Parkplatz
  const ac = centroid(AIRPORT_APRON);
  const apronY = groundY(map, ac[0], ac[1]) + CURB_TOP;
  ctx.chunk(ac[0], ac[1]).flat.use('concrete').polygon(AIRPORT_APRON, apronY, WHITE);
  const pc = centroid(AIRPORT_PARKING);
  const parkY = groundY(map, pc[0], pc[1]) + CURB_TOP;
  const pk = ctx.chunk(pc[0], pc[1]);
  pk.flat.use('asphalt_worn').polygon(AIRPORT_PARKING, parkY, WHITE);
  pk.flat.use('paint_white');
  for (const x of [1140, 1154]) for (let z = 1200; z < 1290; z += 4) pk.flat.box(x + (x < 1147 ? -2.5 : 2.5), parkY + 0.01, z, 5, 0.01, 0.15, 0, WHITE);
  // Laternen auf dem Parkplatz (warmes Licht am Abend)
  for (const [x, z] of [[1147, 1206], [1147, 1236], [1147, 1266], [1147, 1288]] as Vec2[]) {
    const ch = ctx.chunk(x, z);
    ch.solid.use('container_steel').box(x, parkY, z, 0.25, 6.6, 0.25, 0, 0x5a5a66);
    ch.lamps.push(m4(x, parkY + 6.6, z));
    ch.pools.push(m4(x, parkY + 0.06, z, 1.2));
  }
  // Rollwege
  for (const t of TAXIWAYS) buildTaxiway(ctx, t.pts, t.width);
  // Bahnen (alle Flugfelder)
  map.runways.forEach((r, i) => buildRunway(ctx, r, i));
  // Parkpositionen: gelbe Führungslinie, Haltebalken, Nummer
  for (const s of STANDS) {
    const g = ctx.chunk(s.x, s.z).flat.use('paint_yellow');
    const fx = Math.sin(s.a), fz = Math.cos(s.a);
    g.box(s.x - fx * 8, apronY + 0.01, s.z - fz * 8, 0.35, 0.01, 28, s.a, YELLOW);
    g.box(s.x + fx * 5, apronY + 0.01, s.z + fz * 5, 6, 0.01, 0.5, s.a, YELLOW);
    // Rahmen der Position
    for (const side of [-1, 1]) g.box(s.x + fz * side * 9 * -1, apronY + 0.01, s.z - fx * side * 9 * -1, 0.25, 0.01, 22, s.a, YELLOW);
    paintText(g, 'P' + s.id.slice(1), s.x - fx * 9, apronY + 0.012, s.z - fz * 9, -fx, -fz, 1.6, 2.6, 0.35, YELLOW);
  }
  // Helipads
  for (const h of HELIPADS) buildHelipad(ctx, h.x, h.z, h.r, h.roof > 0 ? h.roof + 0.05 : apronY + 0.01);
  // Tankstelle für Luftfahrzeuge
  buildFuel(ctx, apronY);
}

function buildTaxiway(ctx: AirportCtx, pts: Vec2[], width: number) {
  const { map } = ctx;
  // Enden auf einer Bahn-Mittellinie bis an den Bahnrand kürzen (die Bahn liegt obenauf)
  const draw = pts.map((p): Vec2 => [p[0], p[1]]);
  for (const [ei, ni] of [[0, 1], [draw.length - 1, draw.length - 2]]) {
    const e = draw[ei], o = draw[ni];
    const r = map.runways.find((q) => Math.abs((e[0] - q.x) * Math.cos(q.rot) - (e[1] - q.z) * Math.sin(q.rot)) < 2.5);
    if (!r) continue;
    const dx = o[0] - e[0], dz = o[1] - e[1], l = Math.hypot(dx, dz) || 1;
    e[0] += (dx / l) * (r.wid / 2 - 0.5); e[1] += (dz / l) * (r.wid / 2 - 0.5);
  }
  for (let i = 0; i + 1 < draw.length; i++) {
    const a = draw[i], b = draw[i + 1];
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
    const y = groundY(map, cx, cz) + 0.04;
    const ch = ctx.chunk(cx, cz);
    ch.flat.use('asphalt_new').polygon(orientedRect(cx, cz, width / 2, len / 2, rot), y, WHITE);
    // gelbe Mittellinie und Randlinien
    ch.flat.use('paint_yellow').box(cx, y + 0.012, cz, 0.3, 0.01, len, rot, YELLOW);
    const rx = Math.cos(rot), rz = -Math.sin(rot);
    for (const s of [-1, 1]) ch.flat.box(cx + rx * s * (width / 2 - 0.4), y + 0.012, cz + rz * s * (width / 2 - 0.4), 0.15, 0.01, len, rot, YELLOW);
    // blaue Rollwegrandfeuer
    for (let d = -len / 2 + 3; d <= len / 2 - 3; d += 9) {
      for (const s of [-1, 1]) {
        const fx = Math.sin(rot), fz = Math.cos(rot);
        ch.neon.box(cx + fx * d + rx * s * (width / 2 + 0.6), y, cz + fz * d + rz * s * (width / 2 + 0.6), 0.25, 0.35, 0.25, 0, BLUE_LIGHT);
      }
    }
  }
  // Haltelinie vor jeder Bahn: zwei durchgehende + zwei gestrichelte Linien quer
  for (const end of [pts[0], pts[pts.length - 1]]) {
    for (const r of map.runways) {
      const fx = Math.sin(r.rot), fz = Math.cos(r.rot);
      const across = (end[0] - r.x) * fz - (end[1] - r.z) * fx;
      const along = (end[0] - r.x) * fx + (end[1] - r.z) * fz;
      if (Math.abs(across) > 2 || Math.abs(along) > r.len / 2) continue;
      // Richtung vom Bahnende weg in den Rollweg
      const other = end === pts[0] ? pts[1] : pts[pts.length - 2];
      const dx = other[0] - end[0], dz = other[1] - end[1], l = Math.hypot(dx, dz) || 1;
      const ux = dx / l, uz = dz / l;
      const k = r.wid / 2 + 5;
      const hx = end[0] + ux * k, hz = end[1] + uz * k;
      const g = ctx.chunk(hx, hz).flat.use('paint_yellow');
      const y = groundY(map, hx, hz) + 0.055;
      const rot = Math.atan2(ux, uz);
      for (let j = 0; j < 4; j++) {
        const o = j * 0.6, px = hx + ux * o, pz = hz + uz * o;
        if (j < 2) g.box(px, y, pz, width - 1, 0.01, 0.22, rot, YELLOW);
        else for (let q = -width / 2 + 1; q < width / 2 - 1; q += 1.6) g.box(px + Math.cos(rot) * (q + 0.4), y, pz - Math.sin(rot) * (q + 0.4), 0.9, 0.01, 0.22, rot, YELLOW);
      }
    }
  }
}

function buildRunway(ctx: AirportCtx, r: Runway, index: number) {
  const { map } = ctx;
  const ch = ctx.chunk(r.x, r.z);
  const y = groundY(map, r.x, r.z) + 0.05;
  const fx = Math.sin(r.rot), fz = Math.cos(r.rot), rx = Math.cos(r.rot), rz = -Math.sin(r.rot);
  ch.flat.use('highway').polygon(orientedRect(r.x, r.z, r.wid / 2, r.len / 2, r.rot), y, WHITE);
  const g = ch.flat.use('paint_white');
  const P = (d: number, q: number): Vec2 => [r.x + fx * d + rx * q, r.z + fz * d + rz * q];
  // Mittellinie (gestrichelt), Randlinien
  for (let d = -r.len / 2 + 42; d < r.len / 2 - 42; d += 12) { const [x, z] = P(d, 0); g.box(x, y + 0.01, z, 0.6, 0.01, 6, r.rot, WHITE); }
  for (const s of [-1, 1]) { const [x, z] = P(0, s * (r.wid / 2 - 0.6)); g.box(x, y + 0.01, z, 0.35, 0.01, r.len - 4, r.rot, WHITE); }
  const names = runwayNames(index);
  const bars = Math.max(2, Math.floor(r.wid / 5));
  for (const e of [-1, 1]) {
    // Schwelle: "Klaviertasten" beidseits der Mitte
    for (let k = 0; k < bars; k++) {
      for (const s of [-1, 1]) {
        const [x, z] = P(e * (r.len / 2 - 6), s * (1.4 + k * ((r.wid / 2 - 2.4) / bars)));
        g.box(x, y + 0.01, z, 0.9, 0.01, 8, r.rot, WHITE);
      }
    }
    // Bahnnummer: Schwelle am Westende (e = -1) trägt die Kursnummer nach Osten
    const name = e < 0 ? names[0] : names[1];
    const num = name.replace(/[LR]$/, ''), side = name.slice(num.length);
    const cw = Math.min(3.2, r.wid * 0.17), chh = cw * 2.2;
    const dirX = -e * fx, dirZ = -e * fz; // Leserichtung: in Landerichtung
    let [bx, bz] = P(e * (r.len / 2 - 14), 0);
    if (side) { paintText(g, side, bx, y + 0.012, bz, dirX, dirZ, cw, chh, 0.55); bx += dirX * (chh + 2); bz += dirZ * (chh + 2); }
    paintText(g, num, bx, y + 0.012, bz, dirX, dirZ, cw, chh, 0.55);
    // Aufsetzzone: Reifenabrieb
    // Schwellenfeuer (grün) quer über die Bahn
    for (let q = -r.wid / 2; q <= r.wid / 2 + 0.01; q += 2.5) { const [x, z] = P(e * (r.len / 2 + 0.6), q); ch.neon.box(x, y, z, 0.35, 0.3, 0.35, 0, GREEN_LIGHT); }
    // Anflugbefeuerung: Balken mit je 5 Lampen, bis Zaun/Straße/Wasser im Weg sind
    for (let d = 8; d <= 36; d += 7) {
      const [cx, cz] = P(e * (r.len / 2 + d), 0);
      const t = map.tileAt(cx, cz);
      if (t === Tile.WATER || t === Tile.BUILDING || t === Tile.SIDEWALK || t === Tile.BRIDGE || t === Tile.VOID) break;
      if (t === Tile.ROAD && !onAnyRunwayOrTaxi(map, cx, cz)) break;
      const cy = groundY(map, cx, cz);
      const bar = ctx.chunk(cx, cz);
      bar.solid.use('container_steel').box(cx, cy, cz, 0.15, 0.5, 0.15, 0, 0x6a6a72);
      for (let q = -4; q <= 4; q += 2) { const lx = cx + rx * q, lz = cz + rz * q; bar.neon.box(lx, cy + 0.5, lz, 0.35, 0.3, 0.35, 0, APPROACH_LIGHT); }
    }
  }
  // Randbefeuerung (alle 30 m beidseitig)
  const n = Math.max(2, Math.round(r.len / 30));
  for (let k = 0; k <= n; k++) {
    const d = -r.len / 2 + (k * r.len) / n;
    for (const s of [-1, 1]) {
      const [x, z] = P(d, s * (r.wid / 2 + 0.8));
      ctx.chunk(x, z).neon.box(x, y, z, 0.3, 0.35, 0.3, 0, EDGE_LIGHT);
    }
  }
  // Reifenabrieb in den Aufsetzzonen
  for (const e of [-1, 1]) for (let k = 0; k < 6; k++) {
    const [x, z] = P(e * (r.len / 2 - 38 - k * 9), (k % 2 ? 1.5 : -1.5));
    ch.decals.use('decal_tire');
    const hw = 1.4, hd = 1.4, s = Math.sin(r.rot), c = Math.cos(r.rot);
    const Q = (lx: number, lz: number) => [x + lx * c + lz * s, y + 0.03, z - lx * s + lz * c];
    ch.decals.quad(Q(-hw, hd), Q(hw, hd), Q(hw, -hd), Q(-hw, -hd), WHITE, true, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
}

function onAnyRunwayOrTaxi(map: WorldMap, x: number, z: number): boolean {
  for (const r of map.runways) {
    const fx = Math.sin(r.rot), fz = Math.cos(r.rot), dx = x - r.x, dz = z - r.z;
    if (Math.abs(dx * fx + dz * fz) <= r.len / 2 + 40 && Math.abs(dx * fz - dz * fx) <= r.wid / 2 + 1) return true;
  }
  return false;
}

function buildHelipad(ctx: AirportCtx, x: number, z: number, r: number, y: number) {
  const ch = ctx.chunk(x, z);
  const ring: Vec2[] = [];
  for (let k = 0; k < 28; k++) ring.push([x + Math.cos((k / 28) * Math.PI * 2) * r, z + Math.sin((k / 28) * Math.PI * 2) * r]);
  ch.flat.use('asphalt_new').polygon(ring, y, 0x9aa0a8);
  const g = ch.flat.use('paint_white');
  // Kreis aus Segmenten (gelb), "H" in der Mitte (weiß), Lichter am Rand (grün)
  for (let k = 0; k < 28; k++) {
    const a0 = (k / 28) * Math.PI * 2, a1 = ((k + 1) / 28) * Math.PI * 2, am = (a0 + a1) / 2;
    const rr = r * 0.78;
    g.box(x + Math.cos(am) * rr, y + 0.01, z + Math.sin(am) * rr, 0.5, 0.01, rr * (a1 - a0) + 0.05, Math.atan2(-Math.sin(am), Math.cos(am)), YELLOW);
  }
  const hs = r * 0.36;
  g.box(x - hs * 0.55, y + 0.012, z, 0.9, 0.01, hs * 2, 0, WHITE);
  g.box(x + hs * 0.55, y + 0.012, z, 0.9, 0.01, hs * 2, 0, WHITE);
  g.box(x, y + 0.012, z, hs * 1.1, 0.01, 0.9, 0, WHITE);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    ch.neon.box(x + Math.cos(a) * (r + 0.4), y, z + Math.sin(a) * (r + 0.4), 0.35, 0.25, 0.35, 0, GREEN_LIGHT);
  }
}

function buildFuel(ctx: AirportCtx, y: number) {
  const { x, z, r } = AIR_FUEL;
  const ch = ctx.chunk(x, z);
  // Tankzone: gestrichelter gelber Kreis
  const g = ch.flat.use('paint_yellow');
  for (let k = 0; k < 24; k += 2) {
    const a = ((k + 0.5) / 24) * Math.PI * 2;
    g.box(x + Math.cos(a) * r, y + 0.01, z + Math.sin(a) * r, 0.4, 0.01, 2.2, Math.atan2(-Math.sin(a), Math.cos(a)), YELLOW);
  }
  // Tank (liegender Zylinder als Kasten mit Kappen), Zapfsäule, Neonleiste
  ch.solid.use('container_steel').box(x + 7, y, z + 6, 3.2, 3, 9, 0, 0xf2f2ee);
  ch.solid.box(x + 7, y + 3, z + 6, 2.4, 0.5, 8, 0, 0xdedcd6);
  ch.solid.box(x + 3.5, y, z + 6, 1.2, 1.8, 0.9, 0, 0xff7a2f);
  ch.neon.box(x + 7, y + 2.2, z + 6, 3.3, 0.25, 9.1, 0, 0xff4fae);
}

// ------------------------------------------------------------------ Gebäude
/** Neonleiste rund um ein achsparalleles Rechteck (w entlang x, d entlang z). */
function neonFrame(g: GeoBuilder, x: number, y: number, z: number, w: number, d: number, color: number) {
  g.box(x, y, z - d / 2, w, 0.25, 0.25, 0, color);
  g.box(x, y, z + d / 2, w, 0.25, 0.25, 0, color);
  g.box(x - w / 2, y, z, 0.25, 0.25, d, 0, color);
  g.box(x + w / 2, y, z, 0.25, 0.25, d, 0, color);
}

/** Flughafengebäude nach tag. base = Bodenhöhe. */
export function buildAirportBuilding(ctx: AirportCtx, b: BuildingDef, base: number) {
  const ch = ctx.chunk(b.x, b.z);
  switch (b.tag) {
    case 'fence': {
      // Maschendraht (beidseitig) zwischen Pfosten
      const hw = b.w / 2, s = Math.sin(b.rot), c = Math.cos(b.rot);
      const P = (lx: number, y: number) => [b.x + lx * c, y, b.z - lx * s];
      const u = b.w / 2, v = b.h / 2;
      ch.decals.use('fence');
      ch.decals.quad(P(-hw, base), P(hw, base), P(hw, base + b.h), P(-hw, base + b.h), WHITE, false, [[0, 0], [u, 0], [u, v], [0, v]]);
      ch.decals.quad(P(hw, base), P(-hw, base), P(-hw, base + b.h), P(hw, base + b.h), WHITE, false, [[0, 0], [u, 0], [u, v], [0, v]]);
      ch.solid.use('container_steel');
      for (let lx = -hw; lx <= hw + 0.01; lx += b.w / 2) { const p = P(lx, base); ch.solid.box(p[0], base, p[2], 0.14, b.h + 0.2, 0.14, b.rot, 0x7d858c); }
      const top = P(0, base + b.h);
      ch.solid.box(top[0], top[1], top[2], b.w, 0.08, 0.08, b.rot, 0x7d858c);
      return;
    }
    case 'terminal': {
      // Sockel, Glasfassaden zu beiden Seiten, weißes Flachdach mit Vordach zur Landseite
      ch.solid.use('facade_office').box(b.x, base, b.z, b.w - 3, b.h, b.d, b.rot, b.color);
      ch.solid.use('kit_glass');
      for (const s of [-1, 1]) ch.solid.box(b.x + s * (b.w / 2 - 1.3), base + 0.3, b.z, 0.4, b.h - 1.6, b.d - 4, b.rot, 0x9fd8e8);
      ch.solid.use('roof_deck').box(b.x, base + b.h, b.z, b.w + 1.4, 0.7, b.d + 1.4, b.rot, 0xfbfaf6);
      // Vordach (landseitig, Osten) mit Säulen
      ch.solid.use('container_steel').box(b.x + b.w / 2 + 3, base + 5, b.z, 6, 0.5, b.d - 10, b.rot, 0xf6f4ee);
      for (let dz = -b.d / 2 + 8; dz <= b.d / 2 - 8; dz += 12) ch.solid.box(b.x + b.w / 2 + 5.4, base, b.z + dz, 0.4, 5, 0.4, b.rot, 0xe8e6e0);
      // Fluggastbrücken zum Vorfeld (Westen)
      for (const dz of [-24, 0, 24]) ch.solid.box(b.x - b.w / 2 - 5, base + 3, b.z + dz, 10, 2.6, 3, b.rot, 0xd8dcde);
      // Neonkanten am Dach (Miami-Look): pink und türkis
      neonFrame(ch.neon, b.x, base + b.h + 0.7, b.z, b.w + 1.6, b.d + 1.6, 0xff4fae);
      ch.neon.box(b.x + b.w / 2 + 3, base + 4.85, b.z, 6.1, 0.15, b.d - 9.8, b.rot, 0x4ff2ff);
      // warmes Licht unter dem Vordach
      for (let dz = -b.d / 2 + 10; dz <= b.d / 2 - 10; dz += 15) { ch.lamps.push(m4(b.x + b.w / 2 + 3, base + 4.8, b.z + dz, 0.6)); ch.pools.push(m4(b.x + b.w / 2 + 3, base + CURB_TOP + 0.06, b.z + dz, 0.9)); }
      return;
    }
    case 'tower': {
      const tb = ch.solid.use('concrete');
      tb.box(b.x, base, b.z, b.w, 3, b.d, b.rot, 0xe4e2dc);
      tb.cylinder(b.x, base + 3, b.z, 2.4, b.h - 9, 12, b.color);
      ch.solid.use('container_steel').cylinder(b.x, base + b.h - 6, b.z, 4.6, 0.6, 12, 0xf4f4f2);
      ch.solid.use('kit_glass').cylinder(b.x, base + b.h - 5.4, b.z, 4.3, 3.6, 12, 0x7fc8e0);
      ch.solid.use('container_steel').cylinder(b.x, base + b.h - 1.8, b.z, 4.8, 0.6, 12, 0xf4f4f2);
      ch.solid.box(b.x, base + b.h - 1.2, b.z, 0.2, 3.5, 0.2, 0, 0x8a8a92);
      ch.neon.box(b.x, base + b.h + 2.2, b.z, 0.4, 0.4, 0.4, 0, 0xff3030);
      ch.neon.cylinder(b.x, base + b.h - 2.0, b.z, 4.65, 0.2, 12, 0x4ff2ff);
      return;
    }
    case 'hangar-wall': {
      ch.solid.use('alu_siding').box(b.x, base, b.z, b.w, b.h, b.d, b.rot, b.color);
      // Dach einmal (an der Rückwand) über die ganze Halle; Tor offen, Nummer aufs Dach
      if (b.d > b.w) {
        const cx = (HANGAR_1.x0 + HANGAR_1.x1) / 2, cz = (HANGAR_1.z0 + HANGAR_1.z1) / 2;
        const w = HANGAR_1.x1 - HANGAR_1.x0 + 1, d = HANGAR_1.z1 - HANGAR_1.z0 + 2;
        ch.solid.use('corrugated_rust').gableRoof(cx, base + b.h, cz, w, d, 2.2, Math.PI / 2, 0xb8c0c8, 0.4);
        ch.neon.box(HANGAR_1.x1 + 0.2, base + b.h - 0.6, cz, 0.3, 0.3, d - 2, 0, 0xffe468);
        ch.solid.use('container_steel').box(HANGAR_1.x1 - 0.5, base + b.h - 1.6, cz, 1, 1.6, d, 0, 0xdfe3e6);
        ch.flat.use('concrete').polygon(orientedRect(cx, cz, (w - 2) / 2, (d - 2) / 2, 0), base + CURB_TOP + 0.02, 0xd8d6d2);
      }
      return;
    }
    case 'hangar': {
      ch.solid.use('alu_siding').box(b.x, base, b.z, b.w, b.h, b.d, b.rot, b.color);
      ch.solid.use('roof_gravel').box(b.x, base + b.h, b.z, b.w + 0.6, 0.15, b.d + 0.6, b.rot, 0x8c8c90);
      // geschlossene Rolltore zum Vorfeld (Osten)
      ch.solid.use('corrugated_rust').box(b.x + b.w / 2 + 0.05, base, b.z, 0.2, b.h - 2, b.d - 4, b.rot, 0x9fb0bd);
      ch.neon.box(b.x + b.w / 2 + 0.2, base + b.h - 1.2, b.z, 0.3, 0.3, b.d - 3, 0, 0xffe468);
      return;
    }
    case 'fire': {
      ch.solid.use('facade_house').box(b.x, base, b.z, b.w, b.h, b.d, b.rot, b.color);
      ch.solid.use('roof_gravel').box(b.x, base + b.h, b.z, b.w + 0.5, 0.25, b.d + 0.5, b.rot, 0x6a6a6a);
      // zwei Tore (Osten), Blaulicht
      ch.solid.use('container_steel');
      for (const dz of [-3.4, 3.4]) ch.solid.box(b.x + b.w / 2 + 0.05, base, b.z + dz, 0.2, 4.2, 5.4, b.rot, 0xf0f0f0);
      ch.neon.box(b.x + b.w / 2 - 1, base + b.h + 0.25, b.z, 0.5, 0.4, 1.4, 0, 0x4f8bff);
      ch.neon.box(b.x + b.w / 2 + 0.25, base + 4.6, b.z, 0.2, 0.5, b.d - 1, 0, 0xff3030);
      return;
    }
    default:
      ch.solid.use('alu_siding').box(b.x, base, b.z, b.w, b.h, b.d, b.rot, b.color);
  }
}
