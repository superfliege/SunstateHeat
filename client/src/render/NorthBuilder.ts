// Statische Optik des Nordens: Bauernhöfe (Scheunen, Silos, Ställe, Hofläden …), Felder (Zuckerrohr,
// Gemüse, Melonen, Heu) und Zäune per Instancing, Hof-Requisiten, sowie die Bauten am Okee Peak:
// Leitplanken und Aussichtsbuchten der Switchback Road, Tunnelportale, Staumauer, Bootssteg,
// Campingplatz, Steinbruch (Förderbänder, Kiesberge), Holzplatz, Gipfelplateau, Ranger-Station,
// Truckstop. Schreibt in die Chunk-Geometrien von WorldView (gleiche Materialien, Umrisslinien,
// Schatten, Culling); Bewegliches (Wasser, Wasserfall, Funkturm-Blinklicht, Windräder, Lagerfeuer,
// Agrarflugzeug, Tiere) liegt in NorthView.ts.
import * as THREE from 'three';
import { mulberry32 } from '../../../shared/src/math';
import { cumulative, pointAt, type Vec2 } from '../../../shared/src/world/geometry';
import { FARMS, farmFences, type FarmProp } from '../../../shared/src/world/farms';
import { mountainRoads, OKEE_PLACES, okeePads, RESERVOIR } from '../../../shared/src/world/okeePeak';
import { type BuildingDef, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { GeoBuilder } from './GeoBuilder';
import { colored } from './geom';
import type { CoverKind } from './plants';

export interface NorthChunk { flat: GeoBuilder; solid: GeoBuilder; decals: GeoBuilder; neon: GeoBuilder; lamps: THREE.Matrix4[]; pools: THREE.Matrix4[] }
export interface NorthCtx {
  map: WorldMap;
  chunk(x: number, z: number): NorthChunk;
  /** Wand mit Fassadenmaterial (wie WorldView.facadeBox). */
  facade(x: number, z: number, w: number, d: number, rot: number, y0: number, h: number, mat: string, color: THREE.Color, roof: string | null): void;
  /** Instanzierte Pflanze/Requisite mit fester Drehung; liefert eine Referenz (für umfallende Zäune). */
  cover(kind: CoverKind, x: number, y: number, z: number, rot: number, s?: number): unknown;
  /** Zaunsegment-Instanzen je Zaunlinie (Index wie farmFences()). */
  fenceRefs?: unknown[][];
  tree(type: number, x: number, y: number, z: number, rot: number, s: number): void;
  decal(name: string, x: number, y: number, z: number, rot: number, scale?: number, color?: number): void;
}

const WHITE = 0xffffff, WOOD = 0x9a7652, WOOD_D = 0x6e4e32, STEEL = 0xb8b8c0, DARK = 0x2a2a30, RED = 0xc0392b, HAY = 0xe8c860;
const gy = (ctx: NorthCtx, x: number, z: number) => Math.max(0.05, ctx.map.terrainHeight(x, z));
const L = (x: number, z: number, rot: number, lx: number, lz: number): [number, number] => {
  const s = Math.sin(rot), c = Math.cos(rot);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
};

// ------------------------------------------------------------------ Gebäude (BuildingStyle.Farm, tag = "art:ort")
export function buildFarmBuilding(ctx: NorthCtx, b: BuildingDef, base: number) {
  const ch = ctx.chunk(b.x, b.z);
  const kind = (b.tag ?? 'shed').split(':')[0];
  const y0 = base - 1.2, top = base + b.h;
  const col = new THREE.Color(b.color);
  const P = (lx: number, lz: number) => L(b.x, b.z, b.rot, lx, lz);
  switch (kind) {
    case 'house': {
      // Farmhaus: Holzverkleidung, Walmdach, Veranda mit Pfosten
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'facade_house', col, null);
      ch.solid.use('roof_terracotta').hipRoof(b.x, top, b.z, b.w, b.d, Math.min(b.w, b.d) * 0.35, b.rot, 0x8a5a4a);
      const [vx, vz] = P(0, b.d / 2 + 1.4);
      ch.solid.use('planks').box(vx, base, vz, b.w, 0.3, 2.8, b.rot, 0xd8c8b0);
      ch.solid.use('flat').box(vx, base + 2.6, vz, b.w + 0.4, 0.15, 3.0, b.rot, 0x8a5a4a);
      for (const lx of [-b.w / 2 + 0.3, 0, b.w / 2 - 0.3]) { const [px, pz] = P(lx, b.d / 2 + 2.6); ch.solid.box(px, base, pz, 0.18, 2.6, 0.18, b.rot, 0xf2ece0); }
      const [cx, cz] = P(b.w * 0.3, -b.d * 0.2); // Schornstein
      ch.solid.use('flat').box(cx, top - 1, cz, 0.8, 3.0, 0.8, b.rot, 0x9a5a4a);
      break;
    }
    case 'barn': case 'stable': case 'packing': {
      // Rote (oder verwitterte) Scheune: Bretterwände, Satteldach aus Wellblech, großes Tor mit weißem X
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, kind === 'barn' ? 'facade_barn' : 'planks', col, null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, b.d * (kind === 'barn' ? 0.45 : 0.25), b.rot, kind === 'barn' ? 0x6e4e46 : 0x9a8a7a);
      const [dx, dz] = P(0, b.d / 2 + 0.06);
      const dw = Math.min(4.2, b.w * 0.35), dh = Math.min(b.h - 1.5, 4.5);
      ch.solid.use('planks').box(dx, base, dz, dw, dh, 0.12, b.rot, kind === 'barn' ? 0x8a2a1e : 0x7a5a42);
      ch.solid.use('flat');
      for (const s of [1, -1]) ch.solid.box(dx, base + dh / 2 - 0.1, dz + 0.02, 0.22, Math.hypot(dw, dh) * 0.95, 0.06, b.rot, WHITE); // X (vereinfacht: zwei Streben)
      ch.solid.box(dx, base + dh, dz + 0.02, dw + 0.2, 0.2, 0.08, b.rot, WHITE);
      if (kind === 'barn') { const [hx, hz] = P(0, b.d / 2 + 0.07); ch.solid.box(hx, base + b.h - 1.2, hz, 1.4, 1.2, 0.1, b.rot, 0x3a2a24); } // Heuluke
      break;
    }
    case 'silo': {
      const r = Math.min(b.w, b.d) / 2;
      ch.solid.use('alu_siding').cylinder(b.x, y0, b.z, r, b.h + 1.2, 12, 0xd8d4c8, 0, Math.PI * 2, false);
      ch.solid.use('flat');
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ch.solid.cylinder(b.x, top + (k % 2) * 0, b.z, r * (1 - 0.2), 0.01, 12, 0xc8c8cc); void a; }
      // Kuppel
      for (let i = 0; i < 4; i++) ch.solid.cylinder(b.x, top + i * 0.45, b.z, r * Math.cos((i / 4) * Math.PI / 2), 0.45, 12, 0xb8bcc4);
      ch.solid.box(b.x + r * 0.9, base, b.z, 0.15, b.h, 0.15, 0, DARK); // Leiter
      break;
    }
    case 'coop': {
      // Langer Hühnerstall: niedrige Holzwand, Lüftungsband, flaches Wellblechdach
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, 0.9, b.rot, 0xb8b0a0);
      ch.solid.use('flat');
      for (const s of [1, -1]) { const [vx, vz] = P(0, s * (b.d / 2 + 0.03)); ch.solid.box(vx, base + b.h - 1.1, vz, b.w - 1, 0.5, 0.05, b.rot, 0x3a3a34); }
      break;
    }
    case 'milking': {
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'alu_siding', col, null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, 1.6, b.rot, 0x5e6a7a);
      const [tx, tz] = P(-b.w / 2 - 1.6, 0);
      ch.solid.use('alu_siding').cylinder(tx, base, tz, 1.2, 3.2, 10, 0xe8e8ec); // Milchtank
      break;
    }
    case 'mill': {
      // Zuckerrohrmühle: Holzbau, Ziegelschornstein (Rauch in NorthView), Pressen-Anbau
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, b.d * 0.3, b.rot, 0x7a6a5a);
      const [cx, cz] = P(b.w * 0.25, 0);
      ch.solid.use('brick_path').box(cx, base, cz, 1.6, b.h + 8, 1.6, b.rot, 0xb85a3a);
      const [ax, az] = P(-b.w / 2 - 2.5, 0);
      ctx.facade(ax, az, 5, 6, b.rot, y0, 4.2, 'corrugated_rust', new THREE.Color(0x9a8a7a), 'roof_gravel');
      break;
    }
    case 'shop': case 'store': {
      // Hofladen / Campingladen: Holzhütte mit Markise und Kisten davor
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, null);
      ch.solid.use('corrugated_rust').gableRoof(b.x, top, b.z, b.w, b.d, 1.4, b.rot, 0x7a5a42);
      const [ax, az] = P(0, b.d / 2 + 1);
      ch.solid.use('flat').box(ax, base + 2.4, az, b.w, 0.12, 2.0, b.rot, kind === 'shop' ? 0xff9f5a : 0x52a850);
      for (const lx of [-b.w / 2 + 0.6, 0, b.w / 2 - 0.6]) { const [kx, kz] = P(lx, b.d / 2 + 1.3); ctx.cover('crate', kx, base, kz, b.rot); }
      break;
    }
    case 'shed': case 'garage': case 'office': {
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, kind === 'office' ? 'container_steel' : 'corrugated_rust', col, 'roof_gravel');
      break;
    }
    case 'cafe': {
      // Gipfelcafé: Blockhütte, Terrasse mit Tischen, Schild
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, null);
      ch.solid.use('roof_terracotta').gableRoof(b.x, top, b.z, b.w, b.d, 2, b.rot, 0x5a4a3a);
      const [tx, tz] = P(0, b.d / 2 + 2.5);
      ch.solid.use('boardwalk').box(tx, base, tz, b.w + 2, 0.3, 5, b.rot, WHITE);
      ch.solid.use('flat');
      for (const lx of [-3, 0, 3]) {
        const [px, pz] = P(lx, b.d / 2 + 2.6);
        ch.solid.cylinder(px, base + 0.3, pz, 0.45, 0.75, 8, 0xf2ece0);
        ch.solid.cylinder(px, base + 1.05, pz, 1.1, 0.06, 8, 0xd85a3a, 0, Math.PI * 2, true); // Sonnenschirm-Rand
        ch.solid.box(px, base + 1.1, pz, 0.08, 1.6, 0.08, 0, DARK);
      }
      const [sx, sz] = P(0, b.d / 2 + 0.1);
      ch.neon.box(sx, top - 0.4, sz, 4.5, 0.6, 0.12, b.rot, 0xffb36b); // „SUMMIT CAFÉ“-Leuchtschild (schlicht)
      break;
    }
    case 'radio': {
      // Funkturm: Gitterturm (4 Stiele, Querstreben), rot-weiß, Antennen
      const H = b.h;
      ch.solid.use('flat');
      for (let k = 0; k < 4; k++) {
        const ax = (k & 1 ? 1 : -1) * 1.4, az = (k & 2 ? 1 : -1) * 1.4;
        for (let i = 0; i < 6; i++) {
          const t0 = i / 6, t1 = (i + 1) / 6;
          const s0 = 1 - t0 * 0.8, s1 = 1 - t1 * 0.8;
          const x0 = b.x + ax * s0, z0 = b.z + az * s0, x1 = b.x + ax * s1, z1 = b.z + az * s1;
          ch.solid.box((x0 + x1) / 2, base + t0 * H, (z0 + z1) / 2, 0.16, H / 6, 0.16, 0, i % 2 ? RED : 0xf2f2f2);
        }
      }
      for (let i = 1; i < 6; i++) { const s = 1 - (i / 6) * 0.8; ch.solid.box(b.x, base + (i / 6) * H, b.z, 2.9 * s, 0.1, 2.9 * s, 0, i % 2 ? 0xf2f2f2 : RED); }
      ch.solid.box(b.x, base + H, b.z, 0.12, 6, 0.12, 0, STEEL);
      ch.solid.box(b.x + 0.4, base + H * 0.8, b.z, 0.6, 0.6, 0.15, 0.4, 0xe8e8ec); // Richtfunk-Schüssel
      ch.solid.use('concrete').box(b.x + 3, base, b.z + 2, 2.4, 2.2, 2, 0, 0xd8d4c8); // Technikhäuschen
      break;
    }
    case 'ranger': {
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, null);
      ch.solid.use('roof_terracotta').gableRoof(b.x, top, b.z, b.w, b.d, 2.2, b.rot, 0x3e5a3a);
      const [fx, fz] = P(b.w / 2 + 2, b.d / 2 + 1);
      ch.solid.use('flat').box(fx, base, fz, 0.12, 7, 0.12, 0, STEEL); // Fahnenmast
      ch.solid.box(fx + 0.6, base + 6, fz, 1.1, 0.7, 0.04, 0, 0x3e6a3a);
      break;
    }
    case 'watchtower': {
      // Feuerwachturm: vier schräge Holzbeine, Kanzel mit Dach, Leiter
      const H = b.h;
      ch.solid.use('planks');
      for (const [lx, lz] of [[-1.8, -1.8], [1.8, -1.8], [1.8, 1.8], [-1.8, 1.8]]) {
        const [px, pz] = P(lx * 0.8, lz * 0.8);
        ch.solid.box(px, base, pz, 0.3, H - 3, 0.3, b.rot, WOOD_D);
      }
      for (let i = 1; i < 4; i++) ch.solid.box(b.x, base + (i * (H - 3)) / 4, b.z, 3.2, 0.12, 3.2, b.rot, WOOD);
      ctx.facade(b.x, b.z, 4.2, 4.2, b.rot, base + H - 3, 2.2, 'planks', new THREE.Color(0x8a6a4a), null);
      ch.solid.use('roof_terracotta').hipRoof(b.x, base + H - 0.8, b.z, 4.4, 4.4, 1.4, b.rot, 0x5a3a2a);
      break;
    }
    case 'crusher': {
      // Brecheranlage: Stahlgerüst, Trichter, Förderband zum Kiesberg
      ch.solid.use('container_steel').box(b.x, base, b.z, b.w, b.h * 0.6, b.d, b.rot, 0xe8b818);
      ch.solid.use('flat').box(b.x, base + b.h * 0.6, b.z, b.w * 0.7, b.h * 0.4, b.d * 0.7, b.rot, 0x8a8070);
      break;
    }
    case 'diner': {
      // Truckstop-Diner: Chrom-/Blechbau, Neon „EAT“, Fensterband
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'facade_shop', col, 'roof_gravel');
      const [sx, sz] = P(0, b.d / 2 + 0.15);
      ch.neon.box(sx, top + 0.6, sz, 3.2, 1.2, 0.15, b.rot, 0xff4fae);
      ch.solid.use('flat').box(sx, top, sz, 0.2, 0.7, 0.2, b.rot, DARK);
      break;
    }
    case 'hq': {
      // Dustline-Hauptquartier: Lagerhalle mit Rolltoren, rostrotem Schild
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'corrugated_rust', col, 'roof_gravel');
      for (const lx of [-b.w / 4, b.w / 4]) { const [dx, dz] = P(lx, b.d / 2 + 0.06); ch.solid.use('alu_siding').box(dx, base, dz, 4.2, 4.6, 0.1, b.rot, 0xb8b0a0); }
      const [sx, sz] = P(0, b.d / 2 + 0.12);
      ch.solid.use('flat').box(sx, top - 1.8, sz, b.w * 0.6, 1.2, 0.1, b.rot, 0x9a4a2a);
      break;
    }
    default:
      ctx.facade(b.x, b.z, b.w, b.d, b.rot, y0, b.h + 1.2, 'planks', col, 'roof_gravel');
  }
}

// ------------------------------------------------------------------ Hof-Requisiten
function buildProp(ctx: NorthCtx, f: { x: number; z: number }, p: FarmProp, rnd: () => number) {
  const ch = ctx.chunk(p.x, p.z);
  const y = gy(ctx, p.x, p.z);
  const g = ch.solid;
  switch (p.k) {
    case 'windpump': {
      // Altes Pumpen-Windrad: Gittermast, Rad (dreht sich in NorthView), Wassertank daneben
      g.use('flat');
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(p.x + lx * 0.9, y, p.z + lz * 0.9, 0.12, 9, 0.12, 0, STEEL);
      for (let i = 1; i < 4; i++) g.box(p.x, y + i * 2.4, p.z, 1.9 - i * 0.2, 0.08, 1.9 - i * 0.2, 0, STEEL);
      g.cylinder(p.x + 3, y, p.z, 1.6, 1.4, 10, 0x8a8a90);
      break;
    }
    case 'water_tower':
      g.use('planks');
      for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]) g.box(p.x + lx, y, p.z + lz, 0.3, 7, 0.3, 0, WOOD_D);
      g.cylinder(p.x, y + 7, p.z, 2.4, 3.2, 12, 0xb88a5a);
      g.use('corrugated_rust').cylinder(p.x, y + 10.2, p.z, 2.6, 0.2, 12, 0x6e5a4a);
      g.cylinder(p.x, y + 10.4, p.z, 1.4, 0.8, 12, 0x6e5a4a);
      break;
    case 'mailbox': {
      g.use('flat').box(p.x, y, p.z, 0.1, 1.1, 0.1, p.rot, WOOD_D);
      g.box(p.x, y + 1.1, p.z, 0.35, 0.3, 0.55, p.rot, rnd() < 0.5 ? STEEL : RED);
      const [fx, fz] = L(p.x, p.z, p.rot, 0.2, 0);
      g.box(fx, y + 1.25, fz, 0.04, 0.3, 0.08, p.rot, RED); // Fähnchen
      break;
    }
    case 'hay_round': ctx.cover('hay', p.x, y, p.z, p.rot + rnd() * 0.6); break;
    case 'hay_square': ctx.cover('haySquare', p.x, y, p.z, p.rot); break;
    case 'trough': case 'feed_trough':
      g.use('flat').box(p.x, y, p.z, 3, 0.7, 0.8, p.rot, p.k === 'trough' ? 0x9a9aa4 : WOOD);
      g.box(p.x, y + 0.55, p.z, 2.8, 0.05, 0.6, p.rot, p.k === 'trough' ? 0x3a8ab8 : HAY);
      break;
    case 'scarecrow': {
      g.use('flat').box(p.x, y, p.z, 0.1, 2.2, 0.1, p.rot, WOOD_D);
      g.box(p.x, y + 1.6, p.z, 1.8, 0.1, 0.1, p.rot, WOOD_D);
      g.box(p.x, y + 1.0, p.z, 0.6, 0.8, 0.3, p.rot, 0x4a6ab8); // Latzhose
      g.box(p.x, y + 1.5, p.z, 0.8, 0.35, 0.32, p.rot, 0xc0392b); // kariertes Hemd
      g.box(p.x, y + 1.95, p.z, 0.35, 0.35, 0.35, p.rot, HAY);
      g.cylinder(p.x, y + 2.25, p.z, 0.45, 0.06, 8, 0xc8a040);
      g.cylinder(p.x, y + 2.3, p.z, 0.22, 0.25, 8, 0xc8a040);
      break;
    }
    case 'juice_press':
      g.use('flat').box(p.x, y, p.z, 1.4, 1.1, 1.0, p.rot, WOOD);
      g.cylinder(p.x, y + 1.1, p.z, 0.45, 0.6, 8, STEEL);
      g.box(p.x, y + 1.7, p.z, 0.1, 0.7, 0.1, p.rot, DARK);
      g.cylinder(p.x + 0.9, y, p.z, 0.3, 0.6, 8, 0xffa23a);
      break;
    case 'egg_stand': case 'farm_stand': {
      g.use('planks').box(p.x, y, p.z, 2.6, 1.0, 1.0, p.rot, 0xd8c8b0);
      g.use('flat');
      for (const lx of [-1.2, 1.2]) { const [px, pz] = L(p.x, p.z, p.rot, lx, -0.4); g.box(px, y, pz, 0.1, 2.3, 0.1, p.rot, WOOD_D); }
      const [rx, rz] = L(p.x, p.z, p.rot, 0, -0.1);
      g.box(rx, y + 2.3, rz, 2.9, 0.1, 1.4, p.rot, p.k === 'egg_stand' ? 0xf2ece0 : 0xff9f5a);
      g.box(p.x, y + 1.0, p.z, 2.2, 0.15, 0.7, p.rot, p.k === 'egg_stand' ? 0xf7f0e4 : 0xffa23a); // Eier / Orangen
      const [sx, sz] = L(p.x, p.z, p.rot, 0, 0.55);
      g.box(sx, y + 1.3, sz, 1.6, 0.6, 0.05, p.rot, 0xf2ece0); // Schild (Preise)
      break;
    }
    case 'porch_swing':
      g.use('flat').box(p.x, y + 0.6, p.z, 1.6, 0.12, 0.6, p.rot, 0xf2ece0);
      g.box(p.x, y + 0.6, p.z - 0.25, 1.6, 0.6, 0.08, p.rot, 0xf2ece0);
      break;
    case 'irrigation': {
      // Kreisberegnung: lange Gitterbrücke auf Rädern
      g.use('flat');
      for (let k = 0; k < 5; k++) {
        const [px, pz] = L(p.x, p.z, p.rot, -16 + k * 8, 0);
        const yy = gy(ctx, px, pz);
        g.box(px, yy, pz, 0.15, 2.6, 0.15, p.rot, STEEL); g.cylinder(px, yy, pz, 0.6, 0.15, 8, DARK);
      }
      const [ax, az] = L(p.x, p.z, p.rot, 0, 0);
      g.box(ax, y + 2.6, az, 32, 0.18, 0.18, p.rot + Math.PI / 2 - Math.PI / 2, STEEL);
      break;
    }
    case 'harvest_wagon':
      g.use('planks').box(p.x, y + 0.6, p.z, 2.2, 0.9, 4, p.rot, WOOD);
      g.use('flat');
      for (const lz of [-1.4, 1.4]) for (const lx of [-1.1, 1.1]) { const [wx, wz] = L(p.x, p.z, p.rot, lx, lz); g.cylinder(wx, y, wz, 0.45, 0.25, 8, DARK); }
      for (let k = 0; k < 5; k++) { const [mx, mz] = L(p.x, p.z, p.rot, (k % 2 - 0.5) * 0.8, -1.4 + k * 0.7); ctx.cover('melon', mx, y + 1.5, mz, k); }
      break;
    case 'doghouse':
      g.use('planks').box(p.x, y, p.z, 1.1, 0.9, 1.3, p.rot, 0xc0392b);
      g.use('corrugated_rust').gableRoof(p.x, y + 0.9, p.z, 1.1, 1.3, 0.5, p.rot + Math.PI / 2, 0x6e4e46, 0.1);
      break;
    case 'chimney': break; // Teil der Mühle; Rauch in NorthView
    case 'bleachers':
      g.use('planks');
      for (let k = 0; k < 4; k++) { const [bx, bz] = L(p.x, p.z, p.rot, 0, -k * 0.8); g.box(bx, y, bz, 14, 0.5 + k * 0.5, 0.8, p.rot, k % 2 ? WOOD : 0xa88660); }
      break;
    case 'water_wheel':
      g.use('planks');
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const [wx, wz] = L(p.x, p.z, p.rot, 0, Math.cos(a) * 2); g.box(wx, y + 2.2 + Math.sin(a) * 2 - 0.3, wz, 1.4, 0.6, 0.15, p.rot, WOOD_D); }
      break;
    case 'tool_bench':
      g.use('planks').box(p.x, y, p.z, 2.2, 0.9, 0.8, p.rot, WOOD);
      g.use('flat').box(p.x - 0.5, y + 0.9, p.z, 0.5, 0.25, 0.3, p.rot, RED); // Werkzeugkiste
      break;
    case 'guitar_chair':
      g.use('planks').box(p.x, y, p.z, 0.6, 0.45, 0.6, p.rot, WOOD);
      g.box(p.x, y + 0.45, p.z - 0.25, 0.6, 0.6, 0.08, p.rot, WOOD);
      break;
    case 'orange_crates':
      for (let k = 0; k < 4; k++) { const [cx, cz] = L(p.x, p.z, p.rot, (k % 2) * 0.8 - 0.4, Math.floor(k / 2) * 0.6); ctx.cover('crate', cx, y + (k === 3 ? 0.53 : 0), cz, p.rot); }
      break;
    case 'milk_cans':
      g.use('alu_siding');
      for (let k = 0; k < 4; k++) g.cylinder(p.x + (k % 2) * 0.5, y, p.z + Math.floor(k / 2) * 0.5, 0.2, 0.7, 8, 0xd8d8e0);
      break;
    case 'tracks':
      // Traktorspuren (Decals) quer übers Feld
      for (let k = -4; k <= 4; k++) { const [tx, tz] = L(p.x, p.z, p.rot, 0, k * 4); ctx.decal('decal_tire', tx, gy(ctx, tx, tz) + 0.03, tz, p.rot, 1.2, 0x8a6a4a); }
      break;
  }
  void f;
}

// ------------------------------------------------------------------ Felder & Zäune
function buildFields(ctx: NorthCtx) {
  const rnd = mulberry32(4242);
  for (const f of FARMS) {
    for (const fl of f.fields) {
      const c = Math.cos(fl.rot), s = Math.sin(fl.rot);
      const at = (u: number, v: number): [number, number] => [fl.x + u * c + v * s, fl.z - u * s + v * c];
      switch (fl.k) {
        case 'orange': {
          // lange Baumreihen (Bäume sind Teil der Vegetation -> hier nur Erntehelfer-Leitern und Kisten)
          for (let v = -fl.hd + 3; v < fl.hd - 2; v += 5) for (let u = -fl.hw + 3; u < fl.hw - 2; u += 4.5) {
            if (rnd() < 0.04) { const [x, z] = at(u + 2.2, v); ctx.cover('crate', x, gy(ctx, x, z), z, fl.rot); }
          }
          break;
        }
        case 'cane':
          for (let v = -fl.hd + 1; v < fl.hd; v += 1.6) for (let u = -fl.hw + 1; u < fl.hw; u += 1.4) {
            const [x, z] = at(u + (rnd() - 0.5) * 0.5, v + (rnd() - 0.5) * 0.4);
            ctx.cover('cane', x, gy(ctx, x, z), z, rnd() * 6.28, 0.85 + rnd() * 0.3);
          }
          break;
        case 'crop': {
          const melons = f.kind === 'melon' && fl.x < f.x; // westliches Feld: Melonen, sonst Gemüse
          for (let v = -fl.hd + 1; v < fl.hd; v += 2) for (let u = -fl.hw + 1; u < fl.hw; u += melons ? 1.6 : 1.1) {
            if (rnd() < 0.15) continue;
            const [x, z] = at(u, v);
            ctx.cover(melons ? 'melon' : 'crop', x, gy(ctx, x, z), z, rnd() * 6.28, 0.8 + rnd() * 0.4);
          }
          break;
        }
        case 'hay':
          for (let k = 0; k < 10; k++) { const [x, z] = at((rnd() - 0.5) * fl.hw * 1.6, (rnd() - 0.5) * fl.hd * 1.6); ctx.cover('hay', x, gy(ctx, x, z), z, rnd() * 6.28); }
          break;
        case 'arena': {
          // Rodeo-Arena: Bande aus Brettern rundum (zusätzlich zum Zaun), Sandboden
          const ch = ctx.chunk(fl.x, fl.z);
          ch.solid.use('flat').box(fl.x, gy(ctx, fl.x, fl.z), fl.z - fl.hd + 2, 4, 2.2, 0.3, fl.rot, RED); // Startbox
          break;
        }
        default: break;
      }
    }
  }
  // Zäune: 3-m-Segmente entlang der Linien (Holz an Höfen/Koppeln, Stacheldraht an Weiden)
  farmFences().forEach((seg, si) => {
    const refs: unknown[] = [];
    ctx.fenceRefs?.push(refs);
    const dx = seg.bx - seg.ax, dz = seg.bz - seg.az, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 3));
    const rot = Math.atan2(-dz, dx); // Segment-x-Achse entlang der Linie
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = seg.ax + dx * t, z = seg.az + dz * t;
      refs.push(ctx.cover(seg.kind === 'wire' ? 'fenceWire' : 'fenceWood', x, gy(ctx, x, z), z, rot, len / n / 3));
    }
    void si;
  });
  for (const f of FARMS) for (const p of f.props) buildProp(ctx, f, p, rnd);
}

// ------------------------------------------------------------------ Okee Peak
function buildMountain(ctx: NorthCtx) {
  const rnd = mulberry32(777);
  const roads = mountainRoads();
  for (const r of roads) {
    const cum = cumulative(r.pts), Ltot = cum[cum.length - 1];
    const hw = r.type === 1 ? 3.6 : 3.0;
    // Leitplanken auf der Talseite (Stahl, Pfosten alle 4 m)
    if (r.guard) {
      for (let s = 2; s < Ltot - 2; s += 4) {
        if (r.bays?.some((b) => Math.abs(b - s) < 9)) continue; // Lücke an der Aussichtsbucht
        const p = pointAt(r.pts, cum, s);
        const lx = p.x - p.dz * (hw + 1.2), lz = p.z + p.dx * (hw + 1.2), rx = p.x + p.dz * (hw + 1.2), rz = p.z - p.dx * (hw + 1.2);
        const left = ctx.map.terrainHeight(lx - p.dz * 4, lz + p.dx * 4) < ctx.map.terrainHeight(rx + p.dz * 4, rz - p.dx * 4);
        const [x, z] = left ? [lx, lz] : [rx, rz];
        const y = gy(ctx, x, z);
        const ch = ctx.chunk(x, z).solid.use('flat');
        ch.box(x, y, z, 0.14, 0.75, 0.14, Math.atan2(p.dx, p.dz), 0x8a8a90);
        ch.box(x, y + 0.48, z, 0.12, 0.3, 4.05, Math.atan2(p.dx, p.dz), 0xd8d8e0);
      }
    }
    // Tunnel: Portale aus Fels/Beton und Felsdach dazwischen
    if (r.tunnel) {
      const t0 = Math.max(0, r.tunnel[0]), t1 = Math.min(Ltot, r.tunnel[1]);
      for (let s = t0; s <= t1; s += 3) {
        const p = pointAt(r.pts, cum, s);
        const k = Math.max(0, Math.min(r.pts.length - 1, Math.round((s / Ltot) * (r.pts.length - 1))));
        const y = r.prof[k];
        const rot = Math.atan2(p.dx, p.dz);
        const ch = ctx.chunk(p.x, p.z).solid;
        const portal = s - t0 < 3 || t1 - s < 3;
        ch.use(portal ? 'concrete' : 'rock');
        for (const side of [-1, 1]) {
          const wx = p.x - p.dz * (hw + 0.8) * side, wz = p.z + p.dx * (hw + 0.8) * side;
          ch.box(wx, y - 0.5, wz, 1.4, 6.2, 3.2, rot, portal ? 0xd8d4c8 : 0x8a827c);
        }
        ch.box(p.x, y + 5.4, p.z, hw * 2 + 3, portal ? 1.2 : 2.5, 3.2, rot, portal ? 0xd8d4c8 : 0x8a827c);
        if (portal) ctx.chunk(p.x, p.z).neon.box(p.x, y + 5.0, p.z, hw * 2, 0.15, 0.2, rot, 0xffe468);
      }
    }
  }
  // Aussichtsbuchten: Bänke + Münzfernrohr
  for (const pad of okeePads()) {
    const y = pad.h ?? gy(ctx, pad.x, pad.z);
    const ch = ctx.chunk(pad.x, pad.z).solid;
    if (pad.name === 'Aussichtsbucht') {
      ch.use('planks').box(pad.x + 2, y, pad.z, 1.8, 0.45, 0.6, 0, WOOD);
      telescope(ctx, pad.x - 2, y, pad.z, 0);
    }
  }
  // Gipfel: Fernrohre, Geländer, Gipfelkreuz-Stein
  const S = OKEE_PLACES;
  for (const [x, z, rot] of S.telescopes) telescope(ctx, x, gy(ctx, x, z), z, rot);
  {
    const y = gy(ctx, S.summit.x, S.summit.z);
    const ch = ctx.chunk(S.summit.x, S.summit.z).solid;
    ch.use('rock').box(S.summit.x - 10, y, S.summit.z - 8, 1.6, 1.4, 1.2, 0.3, 0x9a928a); // Gipfelstein
    ch.use('flat').box(S.summit.x - 10, y + 1.4, S.summit.z - 8, 0.8, 0.5, 0.08, 0.3, 0x6e4e32); // Höhenschild
  }
  // Staumauer: talseitige Betonwand mit Überlauf, Krone mit Geländer
  {
    const { a, b, crest } = RESERVOIR.dam;
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), rot = Math.atan2(dx, dz);
    const nx = -dz / len, nz = dx / len; // Normale (talwärts: +z ungefähr)
    const side = nz > 0 ? 1 : -1;
    for (let t = 0; t <= len; t += 3) {
      const x = a[0] + (dx * t) / len + nx * 4 * side, z = a[1] + (dz * t) / len + nz * 4 * side;
      const yb = Math.min(crest, ctx.map.terrainHeight(x + nx * 4 * side, z + nz * 4 * side));
      ctx.chunk(x, z).solid.use('concrete').box(x, yb - 1, z, 3.2, crest - yb + 1.5, 2.6, rot + Math.PI / 2, 0xd8d4c8);
    }
    for (let t = 0; t <= len; t += 2.5) {
      const x = a[0] + (dx * t) / len, z = a[1] + (dz * t) / len;
      const ch = ctx.chunk(x, z).solid.use('flat');
      for (const s2 of [-1, 1]) ch.box(x + nx * 3.4 * s2, crest + 0.1, z + nz * 3.4 * s2, 0.1, 1.0, 2.5, rot, 0xb8b8c0);
    }
  }
  // Bootssteg + Angelplätze am Stausee
  {
    const [p0, p1] = RESERVOIR.jetty;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), rot = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    for (let t = 0; t <= len; t += 2) {
      const x = p0[0] + ((p1[0] - p0[0]) * t) / len, z = p0[1] + ((p1[1] - p0[1]) * t) / len;
      ctx.chunk(x, z).solid.use('boardwalk').box(x, RESERVOIR.level + 0.2, z, 2.4, 0.25, 2.1, rot, WHITE);
      ctx.chunk(x, z).solid.use('flat').box(x, RESERVOIR.level - 1.5, z, 0.2, 1.8, 0.2, rot, WOOD_D);
    }
    for (const [x, z, a] of RESERVOIR.fishSpots) {
      const ch = ctx.chunk(x, z).solid.use('flat');
      ch.box(x, gy(ctx, x, z), z, 0.5, 0.45, 0.5, a, 0x3a6ab8); // Kühlbox
      ch.box(x + 0.8, gy(ctx, x, z), z, 0.06, 1.2, 0.06, a, WOOD_D); // Rutenhalter
    }
  }
  // Campingplatz: Zelte, Feuerstellen, Picknicktische (Wohnmobile sind Fahrzeuge)
  {
    const C = S.campground;
    const spots: [number, number][] = [[-16, 10], [-4, 14], [8, 10], [-20, -4], [14, -6], [0, 0]];
    spots.forEach(([lx, lz], i) => {
      const x = C.x + lx, z = C.z + lz, y = gy(ctx, x, z);
      const ch = ctx.chunk(x, z).solid;
      if (i < 4) {
        const col = [0xff9f5a, 0x3fd8cc, 0xffe468, 0x8f6bff][i];
        ch.use('flat').gableRoof(x, y, z, 2.4, 2.6, 1.6, 0.5 * i, col, 0.05); // Zelt
      }
      const fx = x + 3, fz = z + 1;
      ch.use('rock');
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ch.box(fx + Math.cos(a) * 0.7, gy(ctx, fx, fz), fz + Math.sin(a) * 0.7, 0.35, 0.25, 0.35, a, 0x8a827c); }
      ch.use('planks').box(fx + 2.5, gy(ctx, fx, fz), fz - 1.5, 1.8, 0.75, 0.9, 0.3, WOOD);
      ch.box(fx + 2.5, gy(ctx, fx, fz), fz - 2.4, 1.8, 0.45, 0.3, 0.3, WOOD);
      ch.box(fx + 2.5, gy(ctx, fx, fz), fz - 0.6, 1.8, 0.45, 0.3, 0.3, WOOD);
    });
  }
  // Steinbruch: Kiesberge, Förderbänder (schräg), Abraumhalden
  {
    const Q = S.quarry;
    const piles: [number, number, number, number][] = [[-14, 12, 6, 0xb8aea0], [-2, 18, 7, 0x9a928a], [12, 8, 5, 0xc8bca8]];
    for (const [lx, lz, r, col] of piles) {
      const x = Q.x + lx, z = Q.z + lz, y = gy(ctx, x, z);
      const ch = ctx.chunk(x, z).solid.use('gravel');
      for (let i = 0; i < 4; i++) ch.cylinder(x, y + i * r * 0.18, z, r * (1 - i * 0.24), r * 0.18, 12, col);
    }
    for (const [lx, lz, rot, len] of [[-8, 2, 0.6, 16], [6, -2, -0.8, 14]] as [number, number, number, number][]) {
      const x = Q.x + lx, z = Q.z + lz, y = gy(ctx, x, z);
      const ch = ctx.chunk(x, z).solid.use('flat');
      for (let t = 0; t < len; t += 2) {
        const [bx, bz] = L(x, z, rot, 0, t);
        ch.box(bx, y + t * 0.35, bz, 1.2, 0.2, 2.1, rot, DARK);
        if (t % 4 === 0) ch.box(bx, gy(ctx, bx, bz), bz, 0.15, y + t * 0.35 - gy(ctx, bx, bz), 0.15, rot, 0xe8b818);
      }
    }
  }
  // Holzplatz: Stammstapel
  {
    const Y = S.logYard;
    for (let k = 0; k < 3; k++) {
      const x = Y.x + 4 + k * 4, z = Y.z + 2, y = gy(ctx, x, z);
      const ch = ctx.chunk(x, z).solid.use('bark_pine');
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
        const g = colored(new THREE.CylinderGeometry(0.35, 0.35, 8, 7).rotateX(Math.PI / 2).translate(0, 0.35, 0), 0x9a6a46);
        ch.addGeometry(g, new THREE.Matrix4().makeRotationY(0.4).setPosition(x + (i - (3 - r) / 2) * 0.72, y + r * 0.6, z));
      }
    }
  }
  // Ranger-Station: Schild und Parkbänke; Truckstop: Zapfsäulen-Insel für Lkw
  {
    const R = S.ranger, y = gy(ctx, R.x, R.z + 10);
    ctx.chunk(R.x, R.z).solid.use('planks').box(R.x - 8, y, R.z + 10, 3.2, 1.6, 0.25, 0, 0x6e5a3a);
    const T = S.truckstop;
    const ch = ctx.chunk(T.x, T.z).solid.use('flat');
    for (let k = 0; k < 3; k++) { const x = T.x + 24 + k * 8, z = T.z - 4, yy = gy(ctx, x, z); ch.box(x, yy, z, 1.2, 1.8, 0.8, 0, 0x9a4a2a); }
    ch.box(T.x + 32, gy(ctx, T.x + 32, T.z - 4) + 5, T.z - 4, 22, 0.4, 9, 0, 0xf2ece0);
  }
  // Waldboden-Akzente: umgestürzte Stämme an der Pine Traverse
  for (let k = 0; k < 8; k++) {
    const x = 930 + rnd() * 120, z = 400 + rnd() * 40;
    const ch = ctx.chunk(x, z).solid.use('bark_pine');
    const g = colored(new THREE.CylinderGeometry(0.3, 0.35, 5, 7).rotateX(Math.PI / 2), 0x7a5a3a);
    ch.addGeometry(g, new THREE.Matrix4().makeRotationY(rnd() * 6.28).setPosition(x, gy(ctx, x, z) + 0.25, z));
  }
}

function telescope(ctx: NorthCtx, x: number, y: number, z: number, rot: number) {
  const ch = ctx.chunk(x, z).solid.use('flat');
  ch.box(x, y, z, 0.15, 1.1, 0.15, rot, 0x3a6a8a);
  ch.box(x, y + 1.1, z, 0.35, 0.35, 0.8, rot, 0x3a6a8a);
  const [ex, ez] = L(x, z, rot, 0, 0.45);
  ch.box(ex, y + 1.15, ez, 0.25, 0.25, 0.15, rot, 0x222228);
}

/** Alles Statische im Norden bauen (einmal, nach den Gebäuden). */
export function buildNorth(ctx: NorthCtx) {
  buildFields(ctx);
  buildMountain(ctx);
}
export type { Vec2 };
