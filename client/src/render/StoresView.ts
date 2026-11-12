// Begehbare Läden (shops.ts), beweglicher Teil:
//   - „Haube“ je Laden: obere Wände, Türsturz, Dach, Neonkante, Markise und Schild. Betritt der
//     Spieler den Laden, fährt sie nach unten weg (Cutaway) und gibt den Blick auf die Einrichtung frei.
//   - Einrichtung je Ladentyp (Supermarkt, Tankstellen-Shop, Waffenladen) an genau den Stellen,
//     die shops.ts als Hindernis einträgt (STORE_FURNITURE).
//   - Verkäufer hinter der Theke bzw. Mechaniker an der Werkstatt, die man mit F anspricht.
// Der feste Teil (Wandsockel bis STORE_CUT_H) liegt in den Chunk-Geometrien von WorldView.
import * as THREE from 'three';
import { OVERLAY_LAYER } from './PostFX';
import { mulberry32 } from '../../../shared/src/math';
import { SHOP_COLORS, STORE_FURNITURE, STORE_WALLS, storeAt, type ShopDef, type ShopType } from '../../../shared/src/shops';
import { BuildingStyle, CURB_TOP, type BuildingDef, type WorldMap } from '../../../shared/src/world/WorldMap';
import { createQuaterniusCharacter, type Style } from './characters';
import { GeoBuilder } from './GeoBuilder';
import { neonMaterial, surfaceMaterial } from './materials/surface';
import { addOutline, LINE, U } from './materials/toon';
import { CharacterModel } from './models';

/** Höhe der Wandsockel über dem Boden, die beim Betreten stehen bleiben (m). */
export const STORE_CUT_H = 1.3;
const WHITE = 0xffffff;

type Local = (lx: number, lz: number) => [number, number];
const localOf = (b: { x: number; z: number; rot: number }): Local => {
  const s = Math.sin(b.rot), c = Math.cos(b.rot);
  return (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
};

/** Die fünf Wandstücke eines Ladens (STORE_WALLS: Rückwand, Seiten, Front neben der Tür) ab Höhe y. */
export function storeWalls(g: GeoBuilder, b: BuildingDef, y: number, h: number) {
  const local = localOf(b);
  for (const [lx, lz, w, d] of STORE_WALLS) {
    const [x, z] = local(lx, lz);
    g.box(x, y, z, w, h, d, b.rot, b.color);
  }
}

/** Leuchtschild mit dem Ladennamen (Canvas-Textur). */
function signTexture(text: string, color: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  const hex = '#' + color.toString(16).padStart(6, '0');
  ctx.fillStyle = '#1c1030';
  ctx.beginPath(); ctx.roundRect(4, 4, 504, 120, 22); ctx.fill();
  ctx.strokeStyle = hex; ctx.lineWidth = 8; ctx.stroke();
  ctx.font = 'bold italic 64px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = hex; ctx.shadowBlur = 18;
  ctx.fillStyle = '#fff';
  ctx.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Sprechblase über dem Verkäufer, wenn man ihn ansprechen kann. */
function bubbleSprite(): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1c1030'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.roundRect(8, 8, 80, 58, 18); ctx.moveTo(30, 64); ctx.lineTo(26, 88); ctx.lineTo(50, 64); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1c1030';
  for (const x of [30, 48, 66]) { ctx.beginPath(); ctx.arc(x, 37, 6, 0, Math.PI * 2); ctx.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }));
  s.layers.set(OVERLAY_LAYER); // Beschriftung: nach der Nachbearbeitung scharf in voller Auflösung
  s.scale.set(0.9, 0.9, 1);
  s.renderOrder = 9;
  return s;
}

/** Kleines Schild über dem Mechaniker (kein Gebäude, das ein Schild tragen könnte). */
function labelSprite(text: string, color: number): THREE.Sprite {
  const tex = signTexture(text, color);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false }));
  s.scale.set(3.6, 0.9, 1);
  return s;
}

const DRINKS = [0xff4f4f, 0x4fd16b, 0xffd23a, 0x3a8dff, 0xff9f5a, 0xc98bff, 0x4ff2ff, 0xf7f0e4];
const GOODS = [0xff6a6a, 0xffd23a, 0x4fd16b, 0x3a8dff, 0xc98bff, 0xff9f5a, 0xf7f0e4, 0x9a7652, 0xff7eb0];
const AWNING: Record<Exclude<ShopType, 'paint'>, string> = { sunmart: 'awning_teal', gas: 'awning_orange', ammo: 'awning_pink' };
const FLOOR: Record<Exclude<ShopType, 'paint'>, [string, number]> = { sunmart: ['terrazzo', 0xffffff], gas: ['terrazzo', 0xd8d0c8], ammo: ['planks', 0xc8a882] };
const KEEPER_LOOK: Record<ShopType, [Style, number]> = {
  sunmart: ['casual', 0x2a9d5c], gas: ['casual', 0xd4583f], ammo: ['outdoor', 0x5a6b3a], paint: ['outdoor', 0x2a5f9e],
};

interface Hood { group: THREE.Group; shop: ShopDef; k: number }
interface Keeper { shop: ShopDef; root: THREE.Object3D; model: { animate(speed: number, dt: number, seated?: boolean, dist?: number): void }; a: number; y: number }

export class StoresView {
  readonly group = new THREE.Group();
  private hoods: Hood[] = [];
  private keepers: Keeper[] = [];
  private bubble = bubbleSprite();
  private talkable: ShopDef | null = null;
  private t = 0;
  private hoodMat = surfaceMaterial({ fade: true });
  private innerMat = surfaceMaterial();
  private neonMat = neonMaterial();
  private rnd = mulberry32(4242);
  /** Deckenleuchte des Ladens, in dem der Spieler steht (bleibt in der Szene, sonst Shader-Neubau). */
  private light = new THREE.PointLight(0xfff0d0, 0, 7.5, 2);

  constructor(private map: WorldMap, private shops: ShopDef[]) {
    // Einrichtung je Laden als eigenes Mesh (vorher: alle Läden der Welt in EINEM Mesh – das wurde
    // nie gecullt und lag mit Umriss und Schatten in jedem Bild, ~39k Dreiecke)
    for (const shop of shops) {
      const inner = new GeoBuilder(), innerNeon = new GeoBuilder();
      if (shop.building) {
        const b = map.buildings.find((x) => x.style === BuildingStyle.Store && x.x === shop.x && x.z === shop.z);
        if (!b) continue;
        const ground = map.terrainHeight(b.x, b.z);
        const base = Math.max(0, ground);
        const fy = Math.max(0.05, ground) + CURB_TOP + 0.04;
        this.buildHood(shop, b, base);
        this.furnish(inner, innerNeon, shop as ShopDef & { type: Exclude<ShopType, 'paint'> }, b, fy);
      } else {
        this.mechanicCorner(inner, shop);
      }
      this.addKeeper(shop);
      if (!inner.empty) {
        const m = new THREE.Mesh(inner.build(), this.innerMat);
        m.castShadow = m.receiveShadow = true;
        addOutline(m, LINE.prop);
        this.group.add(m);
      }
      if (!innerNeon.empty) this.group.add(new THREE.Mesh(innerNeon.build(), this.neonMat));
    }
    this.bubble.visible = false;
    this.group.add(this.bubble, this.light);
  }

  // ------------------------------------------------------------------ Haube (Dach + obere Wände)
  private buildHood(shop: ShopDef, b: BuildingDef, base: number) {
    const g = new GeoBuilder(), n = new GeoBuilder();
    const local = localOf(b);
    const cutY = base + STORE_CUT_H, top = base + b.h;
    const hw = b.w / 2, hd = b.d / 2;
    const type = shop.type as Exclude<ShopType, 'paint'>;
    const color = SHOP_COLORS[type];
    storeWalls(g.use('facade_shop'), b, cutY, b.h - STORE_CUT_H);
    const [lx, lz] = local(0, hd - 1);
    g.box(lx, base + 2.6, lz, 2, b.h - 2.6, 2, b.rot, b.color); // Türsturz
    // Flachdach mit Attika und Klimagerät
    g.use('roof_gravel').box(b.x, top, b.z, b.w, 0.25, b.d, b.rot, WHITE);
    g.use('concrete');
    for (const [px, pz, w, d] of [[0, hd - 0.15, b.w, 0.3], [0, -hd + 0.15, b.w, 0.3], [hw - 0.15, 0, 0.3, b.d], [-hw + 0.15, 0, 0.3, b.d]]) {
      const [x, z] = local(px, pz);
      g.box(x, top + 0.25, z, w, 0.45, d, b.rot, 0xf2ece8);
    }
    const [ax, az] = local(hw * 0.45, -hd * 0.3);
    g.use('alu_siding').box(ax, top + 0.25, az, 1.6, 1.0, 1.2, b.rot, 0xe0e0e8);
    // Markise über der Front
    const s = Math.sin(b.rot), c = Math.cos(b.rot);
    const P = (px: number, py: number, pz: number) => [b.x + px * c + pz * s, base + py, b.z - px * s + pz * c];
    const aw = hw - 0.3, z0 = hd, z1 = hd + 1.8;
    const uv = [[0, 1], [b.w / 2, 1], [b.w / 2, 0], [0, 0]];
    g.use(AWNING[type]);
    g.quad(P(-aw, 3.3, z1), P(aw, 3.3, z1), P(aw, 4.1, z0), P(-aw, 4.1, z0), WHITE, false, uv);
    g.quad(P(aw, 3.3, z1), P(-aw, 3.3, z1), P(-aw, 4.1, z0), P(aw, 4.1, z0), WHITE, false, uv);
    g.quad(P(-aw, 3.0, z1), P(aw, 3.0, z1), P(aw, 3.3, z1), P(-aw, 3.3, z1), WHITE, false, [[0, 1], [b.w / 2, 1], [b.w / 2, 0.85], [0, 0.85]]);
    // Neonkante in Ladenfarbe
    n.box(b.x, top - 0.6, b.z, b.w + 0.3, 0.35, b.d + 0.3, b.rot, color);

    const group = new THREE.Group();
    group.position.set(b.x, cutY, b.z);
    const geo = g.build();
    geo.translate(-b.x, -cutY, -b.z);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.hoodMat);
    mesh.castShadow = mesh.receiveShadow = true;
    addOutline(mesh, LINE.building, { fade: true });
    const neo = n.build();
    neo.translate(-b.x, -cutY, -b.z);
    neo.computeBoundingSphere();
    group.add(mesh, new THREE.Mesh(neo, this.neonMat));
    // Schild mit Ladennamen auf der Dachkante über der Tür, nach hinten gekippt: so ist es aus der
    // schrägen Draufsicht in jeder Ausrichtung lesbar
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ map: signTexture(shop.name, color), fog: false, side: THREE.DoubleSide }));
    const [sx, sz] = local(0, hd - 0.9);
    sign.position.set(sx - b.x, top + 1.0 - cutY, sz - b.z);
    sign.rotation.set(-0.85, b.rot, 0, 'YXZ');
    const [px0, pz0] = local(0, hd - 1.3); // Träger
    const post = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 0.15), new THREE.MeshBasicMaterial({ color: 0x2c2a40 }));
    post.position.set(px0 - b.x, top + 0.55 - cutY, pz0 - b.z);
    post.rotation.y = b.rot;
    group.add(sign, post);
    this.group.add(group);
    this.hoods.push({ group, shop, k: 1 });
  }

  // ------------------------------------------------------------------ Einrichtung
  private furnish(g: GeoBuilder, n: GeoBuilder, shop: ShopDef & { type: Exclude<ShopType, 'paint'> }, b: BuildingDef, fy: number) {
    const rnd = this.rnd;
    const local = localOf(b);
    const color = SHOP_COLORS[shop.type];
    /** Quader im Ladenkoordinatensystem: Mitte (lx, lz), Unterkante ly über dem Boden. */
    const F = (lx: number, ly: number, lz: number, w: number, h: number, d: number, col: number, top?: number) => {
      const [x, z] = local(lx, lz);
      g.box(x, fy + ly, z, w, h, d, b.rot, col, top);
    };
    const N = (lx: number, ly: number, lz: number, w: number, h: number, d: number, col: number) => {
      const [x, z] = local(lx, lz);
      n.box(x, fy + ly, z, w, h, d, b.rot, col);
    };
    const pick = (list: number[]) => list[Math.floor(rnd() * list.length)];

    // Boden
    const [fm, ft] = FLOOR[shop.type];
    g.use(fm);
    F(0, -0.04, 0, b.w - 4, 0.07, b.d - 4, ft);
    F(0, -0.04, 4, 2, 0.07, 2, ft); // Türschwelle
    g.use('flat');
    F(0, 0, 2.6, 1.8, 0.03, 0.7, 0xb8a888); // Fußmatte mit farbigem Rand
    F(0, 0.03, 2.6, 1.5, 0.01, 0.45, color);

    /** Kühlregal (offen, Ware auf Böden), Front zeigt in Richtung dirX/dirZ (lokal). */
    const cooler = (cx: number, cz: number, len: number, alongX: boolean, facing: 1 | -1) => {
      const W = (a: number, d: number) => (alongX ? [a, d] : [d, a]) as [number, number];
      const at = (along: number, depth: number): [number, number] => (alongX ? [cx + along, cz + depth * facing] : [cx + depth * facing, cz + along]);
      // Korpus: Rückwand, Sockel, Kopfteil mit Leuchtband
      { const [x, z] = at(0, -0.33); const [w, d] = W(len, 0.1); F(x, 0, z, w, 2.1, d, 0xe9eef2); }
      { const [x, z] = at(0, 0); const [w, d] = W(len, 0.76); F(x, 0, z, w, 0.28, d, 0x8a96a3); F(x, 1.85, z, w, 0.25, d, color); }
      { const [x, z] = at(0, 0.36); const [w, d] = W(len - 0.1, 0.04); N(x, 1.8, z, w, 0.05, d, 0xbff4ff); }
      const units = Math.max(1, Math.round(len / 1.4));
      for (let u = 0; u <= units; u++) { // Trennwände
        const [x, z] = at(-len / 2 + (u * len) / units, 0);
        const [w, d] = W(0.06, 0.76);
        F(x, 0.28, z, w, 1.57, d, 0xcfd8e0);
      }
      for (const h of [0.7, 1.2]) {
        const [x, z] = at(0, 0);
        const [w, d] = W(len - 0.1, 0.66);
        F(x, h, z, w, 0.04, d, 0xdfe6ee);
      }
      for (const h of [0.28, 0.74, 1.24]) {
        for (let along = -len / 2 + 0.18; along < len / 2 - 0.1; along += 0.24) {
          const [x, z] = at(along, 0.05 + (rnd() - 0.5) * 0.1);
          const [w, d] = W(0.16, 0.16);
          F(x, h, z, w, 0.28 + rnd() * 0.12, d, pick(DRINKS));
        }
      }
    };

    /** Regal-Gondel (beidseitig bestückt), Längsachse entlang lokal z. */
    const gondola = (cx: number, cz: number, w: number, len: number, height: number) => {
      F(cx, 0, cz, w, 0.12, len, 0x5d6b7a);
      F(cx, 0, cz, 0.08, height, len, 0xc9d2db);
      F(cx, height, cz, w * 0.6, 0.06, len, color); // Kopfleiste in Ladenfarbe
      const levels = height > 1.4 ? [0.12, 0.55, 1.0] : [0.12, 0.55];
      for (const side of [-1, 1]) {
        for (const h of levels) {
          if (h > 0.12) F(cx + side * w * 0.26, h - 0.04, cz, w * 0.45, 0.04, len, 0xe6ebf0);
          for (let z = cz - len / 2 + 0.16; z < cz + len / 2 - 0.1; z += 0.26 + rnd() * 0.06) {
            F(cx + side * w * 0.27, h, z, w * 0.32, 0.16 + rnd() * 0.2, 0.2, pick(GOODS));
          }
        }
      }
    };

    if (shop.type === 'sunmart') {
      // Kühlregale an der Rückwand (Front zeigt in den Raum, +z)
      cooler(0.4, -2.62, 8.6, true, 1);
      gondola(0.6, 0.2, 0.9, 2.4, 1.5);
      gondola(3.2, 0.2, 0.9, 2.4, 1.5);
      // Kasse: Theke mit Laufband, Kasse und Süßigkeiten-Auslage zur Tür hin
      F(-3.3, 0, 1.1, 0.8, 0.95, 2.4, color, 0xf2f2f2);
      F(-3.2, 0.95, 0.5, 0.5, 0.02, 1.0, 0x222228);
      F(-3.45, 0.95, 1.6, 0.4, 0.22, 0.4, 0x333344);
      F(-3.5, 1.17, 1.6, 0.06, 0.25, 0.35, 0x222228);
      N(-3.47, 1.2, 1.6, 0.02, 0.18, 0.28, 0x7fffb0); // Kassendisplay
      for (let i = 0; i < 5; i++) F(-3.3, 0.2 + (i % 2) * 0.3, 1.9 + (i >> 1) * 0.15, 0.1, 0.2, 0.12, pick(GOODS));
      // Zeitungs-/Lottoständer schließt die Kassennische nach hinten
      F(-4.4, 0, -0.6, 1.2, 1.15, 0.7, 0x9a7652, 0x6e4e32);
      for (let i = 0; i < 4; i++) F(-4.75 + i * 0.25, 1.15, -0.55, 0.2, 0.02, 0.3, pick([0xf7f0e4, 0xffd23a, 0xff7eb0]));
      // Eistruhe neben der Tür
      F(4.3, 0, 2.4, 1.1, 0.85, 0.8, WHITE, 0x9fe8ff);
      F(4.3, 0.5, 2.82, 1.0, 0.18, 0.02, 0x3a8dff);
      // Werbeplakate an den Seitenwänden
      F(-4.97, 1.5, -1.8, 0.04, 0.8, 1.2, 0xffd23a);
      F(4.97, 1.4, -0.8, 0.04, 0.7, 1.6, 0xff7eb0);
    } else if (shop.type === 'gas') {
      // Tresen (L-Form) mit Kasse, dahinter das Zigaretten-/Lottoregal
      F(-2.85, 0, -1.5, 4.3, 1.0, 0.8, 0xb5452f, 0x3a3a44);
      F(-0.9, 0, -2.45, 0.4, 1.0, 1.1, 0xb5452f, 0x3a3a44);
      F(-2.0, 1.0, -1.55, 0.45, 0.25, 0.4, 0x333344);
      N(-2.0, 1.27, -1.36, 0.36, 0.14, 0.02, 0x7fffb0);
      for (let i = 0; i < 6; i++) F(-3.9 + i * 0.22, 1.0, -1.25, 0.16, 0.25, 0.14, pick(GOODS)); // Kaugummi-Auslage
      F(-2.8, 1.1, -2.92, 3.4, 1.3, 0.16, 0x4a3b30);
      for (let r = 0; r < 4; r++) for (let i = 0; i < 12; i++) F(-4.3 + i * 0.27, 1.17 + r * 0.31, -2.82, 0.2, 0.24, 0.06, pick([0xf7f0e4, 0xff4f4f, 0xffd23a, 0x3a8dff, 0x1a1a24]));
      N(-2.8, 2.5, -2.88, 1.6, 0.3, 0.04, 0xffd23a); // „LOTTO“-Leuchtband
      // Getränkekühlwand rechts (Front zeigt zur Raummitte, −x)
      cooler(4.55, -0.4, 4.4, false, -1);
      gondola(1.4, 0.2, 0.8, 2.2, 1.25);
      // Kaffeestation
      F(-4.5, 0, 1.4, 1.0, 0.95, 1.6, 0x6e4e32, 0x2a2a30);
      F(-4.65, 0.95, 1.1, 0.5, 0.6, 0.5, 0x22222a);
      N(-4.38, 1.35, 1.1, 0.02, 0.08, 0.2, 0xff4f4f);
      for (let i = 0; i < 4; i++) F(-4.5, 0.95, 1.6 + i * 0.13, 0.1, 0.14, 0.1, WHITE);
      // Motoröl-Stapel und Plakat
      for (let i = 0; i < 3; i++) F(2.2 + i * 0.35, 0, 2.5, 0.3, 0.45 + (i % 2) * 0.3, 0.3, 0x2a5f9e);
      F(-4.97, 1.5, -0.4, 0.04, 0.8, 1.4, 0xffb33a);
    } else {
      // Waffenladen: Glasvitrine quer durch den Raum, dahinter Lochwand mit Gewehren
      F(-0.6, 0, -1.3, 6.4, 0.35, 0.9, 0x2c2a40);
      F(-0.6, 0.35, -1.3, 6.4, 0.6, 0.9, 0x7fbcc8, 0xa8e4ec);
      for (let i = 0; i < 7; i++) F(-3.4 + i * 0.85, 0.96, -1.3, 0.5, 0.05, 0.22, 0x1a1a1a); // Pistolen in der Auslage
      F(-0.6, 0.95, -1.3, 6.45, 0.05, 0.05, 0x2c2a40);
      F(2.8, 0, -2.375, 0.4, 1.0, 1.25, 0x2c2a40, 0x3a3a50);
      F(0.9, 0.8, -2.93, 4.6, 1.9, 0.12, 0xb08850);
      for (let r = 0; r < 4; r++) {
        for (let i = 0; i < 2; i++) {
          const x = -0.3 + i * 2.3, y = 1.0 + r * 0.44;
          F(x, y, -2.84, 1.5, 0.1, 0.06, 0x1d1d22); // Lauf + Gehäuse
          F(x - 0.55, y - 0.08, -2.84, 0.45, 0.2, 0.07, r % 2 ? 0x6e4e32 : 0x2c2a30); // Schaft
        }
      }
      N(0.9, 2.85, -2.86, 3.2, 0.12, 0.04, color);
      // Waffentresor
      F(-4.4, 0, -2.4, 1.2, 1.9, 1.2, 0x3a4048, 0x4a5058);
      F(-4.4, 0.9, -1.79, 0.25, 0.25, 0.04, 0xc0c0c8);
      // Munitionskisten
      for (const [x, z, y] of [[3.7, -2.3, 0], [4.5, -2.3, 0], [4.1, -2.3, 0.5]]) F(x, y, z, 0.78, 0.5, 1.15, 0x5a6b3a, 0x6b7c45);
      F(4.1, 0.85, -1.72, 0.4, 0.1, 0.02, 0xffd23a);
      // Gewehrständer an der linken Wand
      F(-4.75, 0, 1.0, 0.5, 0.25, 3.0, 0x6e4e32);
      for (let i = 0; i < 6; i++) F(-4.85, 0.25, -0.2 + i * 0.48, 0.08, 1.25, 0.1, i % 2 ? 0x1d1d22 : 0x6e4e32);
      // Puppe mit Schutzweste
      F(4.3, 0, 1.2, 0.5, 0.08, 0.5, 0x2c2a30);
      F(4.3, 0.08, 1.2, 0.08, 0.8, 0.08, 0x9a9aa4);
      F(4.3, 0.88, 1.2, 0.6, 0.7, 0.36, 0x3d4a2f);
      F(4.3, 1.58, 1.2, 0.26, 0.3, 0.26, 0xd8c8b8);
      // Auslagetisch mit Munitionsschachteln
      F(-2.6, 0, 1.3, 1.6, 0.8, 1.0, 0x6e4e32, 0x8a6a4a);
      for (let i = 0; i < 6; i++) F(-3.1 + (i % 3) * 0.5, 0.8, 1.1 + (i >> 1 & 1) * 0.4, 0.35, 0.15, 0.25, pick([0xff4f4f, 0xffd23a, 0x4fd16b]));
      // Zielscheiben-Plakate rechts
      for (const z of [-0.6, 0.6]) { F(4.97, 1.3, z, 0.04, 0.9, 0.7, WHITE); F(4.94, 1.6, z, 0.04, 0.3, 0.24, 0xff4f4f); }
    }
  }

  /** Paint & Pray: Werkzeugkiste, Lackdosen und ein Aufsteller neben dem Mechaniker. */
  private mechanicCorner(g: GeoBuilder, shop: ShopDef) {
    const k = shop.keeper;
    const local = localOf({ x: k.x, z: k.z, rot: k.a });
    const y = this.map.surfaceY(k.x, k.z);
    g.use('flat');
    const B = (lx: number, ly: number, lz: number, w: number, h: number, d: number, col: number, top?: number) => {
      const [x, z] = local(lx, lz);
      g.box(x, y + ly, z, w, h, d, k.a, col, top);
    };
    B(-1.1, 0, -0.2, 0.9, 0.55, 0.5, 0xd4583f, 0x9a2f20); // Werkzeugwagen
    B(-1.1, 0.55, -0.2, 0.6, 0.12, 0.3, 0x2c2a30);
    for (let i = 0; i < 3; i++) B(1.0 + i * 0.22, 0, -0.4, 0.16, 0.32, 0.16, [0xc98bff, 0x4ff2ff, 0xff7eb0][i]); // Lackdosen
    B(1.3, 0, 0.6, 0.06, 1.2, 0.06, 0x9a9aa4); // Aufsteller
    B(1.3, 1.2, 0.6, 0.8, 0.6, 0.06, 0xc98bff, 0xc98bff);
    const label = labelSprite(shop.name, SHOP_COLORS.paint);
    label.position.set(k.x, y + 5.6, k.z); // über dem Tankstellendach (4,2 m)
    this.group.add(label);
  }

  // ------------------------------------------------------------------ Verkäufer
  private addKeeper(shop: ShopDef) {
    const [style, shirt] = KEEPER_LOOK[shop.type];
    const seed = Array.from(shop.id).reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) >>> 0;
    const model = createQuaterniusCharacter(style, seed, shirt) ?? new CharacterModel(seed % 6);
    const y = this.map.surfaceY(shop.keeper.x, shop.keeper.z);
    model.root.position.set(shop.keeper.x, y, shop.keeper.z);
    model.root.rotation.y = shop.keeper.a;
    this.group.add(model.root);
    this.keepers.push({ shop, root: model.root, model, a: shop.keeper.a, y });
  }

  /** Verkäufer, den man gerade ansprechen kann (Sprechblase), oder null. */
  setTalkable(shop: ShopDef | null) { this.talkable = shop; }

  /** px/pz: Spielerposition; inVehicle: im Fahrzeug fährt keine Haube weg. */
  update(dt: number, px: number, pz: number, inVehicle: boolean) {
    this.t += dt;
    const inside = inVehicle ? null : storeAt(this.shops, px, pz, 0.2);
    for (const h of this.hoods) {
      const want = h.shop === inside ? 0 : 1;
      if (h.k === want) continue;
      h.k = want < h.k ? Math.max(want, h.k - dt * 4) : Math.min(want, h.k + dt * 3);
      const e = h.k * h.k * (3 - 2 * h.k); // weich ein- und ausfahren
      h.group.scale.y = Math.max(0.001, e);
      h.group.visible = h.k > 0.005;
    }
    // Deckenlicht: tagsüber leicht aufhellen, nachts deutlich
    const lit = this.hoods.find((h) => h.k < 0.5);
    this.light.intensity = lit ? 1 + U.uNight.value * 5 : 0;
    if (lit) this.light.position.set(lit.shop.x, lit.group.position.y + 2.4, lit.shop.z);
    for (const k of this.keepers) {
      const dx = px - k.root.position.x, dz = pz - k.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 120) { k.root.visible = false; continue; }
      k.root.visible = true;
      // Kunde in der Nähe: zu ihm drehen, sonst zurück in die Grundhaltung
      const want = d < 6 ? Math.atan2(dx, dz) : k.shop.keeper.a;
      let diff = want - k.a;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      k.a += diff * Math.min(1, dt * 5);
      k.root.rotation.y = k.a;
      k.model.animate(0, dt, false, d);
    }
    const tk = this.talkable && this.keepers.find((k) => k.shop === this.talkable);
    this.bubble.visible = !!tk;
    if (tk) this.bubble.position.set(tk.root.position.x, tk.y + 2.75 + Math.sin(this.t * 4) * 0.08, tk.root.position.z);
  }
}
