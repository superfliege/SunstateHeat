// Läden (Spec 14.4): Standorte werden deterministisch aus der Karte abgeleitet (Client und Server
// erzeugen dieselbe Liste), die Sortimente stehen hier. Preise kommen aus weapons.ts/items.ts.
import { CELL, GRID_SIZE } from './constants';
import { findFootSpot } from './sim/movement';
import { ITEMS } from './items';
import { WEAPONS, type WeaponId } from './weapons';
import { centroid, orientedRect, rasterizePolygon, type Vec2 } from './world/geometry';
import { Tile } from './world/tiles';
import type { WorldMap } from './world/WorldMap';
import { BuildingStyle, LotUse, Zone } from './world/WorldMap';

export type ShopType = 'sunmart' | 'ammo' | 'gas' | 'paint';
/** Verkäufer bzw. Mechaniker: Weltposition und Blickrichtung (vorwärts = sin a, cos a). */
export interface ShopKeeper { x: number; z: number; a: number; name: string }
export interface ShopDef {
  id: string; type: ShopType; name: string;
  /** Mitte des Gebäudes (bzw. Standort des Mechanikers bei Paint & Pray). */
  x: number; z: number;
  /** Blickrichtung der Front (Tür), Vielfaches von 90°. */
  rot: number;
  /** true = begehbares Gebäude (BuildingStyle.Store), false = nur Person im Freien. */
  building: boolean;
  keeper: ShopKeeper;
}
export interface ShopItem {
  /** "w:<waffe>" Waffe kaufen, "a:<waffe>" Munition, "i:<item>" Gegenstand, "repair", "respray". */
  key: string;
  name: string;
  price: number;
  minLevel: number;
  desc: string;
}

export const SHOP_NAMES: Record<ShopType, string> = { sunmart: '24/7 Sunmart', ammo: 'Ammo & Ammo', gas: 'Gas & Go', paint: 'Paint & Pray' };
export const SHOP_COLORS: Record<ShopType, number> = { sunmart: 0x4fd16b, ammo: 0xff4f4f, gas: 0xffb33a, paint: 0xc98bff };
/** Wie nah man (zu Fuß) am Verkäufer stehen muss, um ihn mit F anzusprechen (m). */
export const SHOP_RANGE = 3.4;
/** Mechaniker von Paint & Pray: Reichweite, auch aus dem Fahrzeug heraus. */
export const MECHANIC_RANGE = 8;
/** Großzügigere Prüfung auf dem Server (Latenz, Laufen während des Gesprächs). */
export const SHOP_SERVER_RANGE = 7;
export const RESPRAY_PRICE = 250;
export const REPAIR_PRICE = 100;

/**
 * Läden sind begehbare Gebäude aus 7x5 Zellen (14x10 m, Zelle = 2 m): Außenring = Wände (Kachel
 * BUILDING), innen und in der 1 Zelle breiten Tür Boden (PLAZA). Lokal: i = Breite, j = Tiefe, +j = Front.
 * Nur die vier Himmelsrichtungen, damit die Wände genau auf dem Kollisionsraster liegen.
 */
const SHOP_CW = 7, SHOP_CD = 5;
/** Innenraum (lokal, ohne Wände): |x| < STORE_IN_X, |z| < STORE_IN_Z; Tür bei z = +3 … +5, |x| < 1. */
export const STORE_IN_X = 5, STORE_IN_Z = 3;
/**
 * Einrichtung je Ladentyp, die für die Logik zählt: Standort des Verkäufers hinter der Theke
 * (lokal x, z, Blickrichtung). Die übrige Einrichtung zeichnet nur der Client (StoresView).
 */
export const STORE_KEEPER: Record<Exclude<ShopType, 'paint'>, [number, number, number]> = {
  sunmart: [-4.25, 1.1, Math.PI / 2], // Kasse links neben der Tür, Blick in den Gang
  gas: [-2.4, -2.45, 0], // Tresen an der Rückwand, Zigarettenregal dahinter
  ammo: [0.9, -2.3, 0], // lange Glasvitrine quer durch den Laden
};
/**
 * Blockierende Einrichtung je Ladentyp (lokal: Mitte x, z, Breite in x, Tiefe in z). Der Client
 * zeichnet an genau diesen Stellen Theke, Regale usw. (StoresView); Gänge sind ≥ 1 m breit.
 */
export const STORE_FURNITURE: Record<Exclude<ShopType, 'paint'>, [number, number, number, number][]> = {
  sunmart: [
    [0.4, -2.62, 8.6, 0.76], // Kühlregale an der Rückwand
    [-3.3, 1.1, 0.8, 2.4], // Kassentheke
    [-4.4, -0.6, 1.2, 0.7], // Zeitungs-/Lottoständer (schließt die Kassennische)
    [0.6, 0.2, 0.9, 2.4], // Regal-Gondel 1
    [3.2, 0.2, 0.9, 2.4], // Regal-Gondel 2
    [4.3, 2.4, 1.1, 0.8], // Eistruhe
  ],
  gas: [
    [-2.85, -1.5, 4.3, 0.8], // Tresen
    [-0.9, -2.45, 0.4, 1.1], // Tresen-Seitenteil
    [4.55, -0.4, 0.9, 4.4], // Getränkekühlwand
    [1.4, 0.2, 0.8, 2.2], // Snackregal
    [-4.5, 1.4, 1.0, 1.6], // Kaffeestation
  ],
  ammo: [
    [-0.6, -1.3, 6.4, 0.9], // Glasvitrine
    [-4.4, -2.4, 1.2, 1.2], // Waffentresor
    [2.8, -2.375, 0.4, 1.25], // Vitrinen-Seitenteil
    [4.1, -2.3, 1.6, 1.2], // Munitionskisten
    [-4.75, 1.0, 0.5, 3.0], // Gewehrständer an der Wand
    [4.3, 1.2, 0.9, 0.9], // Westen-Puppe
    [-2.6, 1.3, 1.6, 1.0], // Auslagetisch
  ],
};
const KEEPER_NAMES: Record<ShopType, string[]> = {
  sunmart: ['Dolores', 'Hector', 'Marisol', 'Kenny', 'Yolanda'],
  ammo: ['Buck', 'Ruby', 'Waylon', 'Dee'],
  gas: ['Earl', 'Shonda', 'Lyle', 'Pilar'],
  paint: ['Rosa', 'Manny', 'Tito', 'Jolene'],
};
const SHOP_W = SHOP_CW * CELL, SHOP_D = SHOP_CD * CELL, SHOP_H = 4.5;
const SHOP_BUILD_COLOR = 0xf4e9d8;
/** Bodenarten, auf denen ein Laden stehen darf (keine Straße, kein Wasser, kein Gebäude). */
const SHOP_GROUND = new Set<number>([Tile.GRASS, Tile.PLAZA, Tile.SIDEWALK, Tile.SAND, Tile.DIRT]);
/** Mindestabstand der Ladenmitte zum Spawn (damit man nicht im Gebäude startet). */
const SPAWN_CLEAR = 11;
/** Mindestabstand der Ladenmitte zur Werkstatt-/Tankplatzmitte. */
const WORKSHOP_CLEAR = 12;

/** Weltposition der Zellmitte (i, j) eines Ladens mit Mitte (cx, cz), Himmelsrichtung k (0..3). */
function shopCell(cx: number, cz: number, k: number, i: number, j: number): Vec2 {
  const s = Math.round(Math.sin((k * Math.PI) / 2)), c = Math.round(Math.cos((k * Math.PI) / 2));
  const lx = i * CELL, lz = j * CELL;
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}

/** Lokaler Punkt (lx, lz) eines Ladens mit Mitte (cx, cz) und Frontrichtung rot -> Welt. */
export function storeToWorld(shop: { x: number; z: number; rot: number }, lx: number, lz: number): Vec2 {
  const s = Math.sin(shop.rot), c = Math.cos(shop.rot);
  return [shop.x + lx * c + lz * s, shop.z - lx * s + lz * c];
}

/** Weltpunkt -> lokale Ladenkoordinaten. */
export function worldToStore(shop: { x: number; z: number; rot: number }, x: number, z: number): Vec2 {
  const s = Math.sin(shop.rot), c = Math.cos(shop.rot), dx = x - shop.x, dz = z - shop.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Steht der Punkt im Innenraum (inkl. Türschwelle) eines begehbaren Ladens? */
export function insideStore(shop: ShopDef, x: number, z: number, margin = 0): boolean {
  if (!shop.building) return false;
  const [lx, lz] = worldToStore(shop, x, z);
  return Math.abs(lx) < STORE_IN_X + margin && lz > -STORE_IN_Z - margin && lz < STORE_IN_Z + 1 + margin;
}

/** Gebäudefläche plus Vorplatz vor der Tür muss freier Boden sein. */
function shopSiteFree(map: WorldMap, cx: number, cz: number, k: number): boolean {
  const hi = (SHOP_CW - 1) / 2, hj = (SHOP_CD - 1) / 2;
  for (let j = -hj; j <= hj + 2; j++) {
    for (let i = -hi; i <= hi; i++) {
      if (j > hj && Math.abs(i) > 1) continue; // Vorplatz nur vor der Tür
      const [x, z] = shopCell(cx, cz, k, i, j);
      if (!SHOP_GROUND.has(map.tileAt(x, z))) return false;
    }
  }
  return true;
}

/**
 * Erzeugt die Läden als begehbare Gebäude (BuildingStyle.Store) und legt sie in map.shops ab.
 * Die Front (Tür) zeigt möglichst zum Ziel `toward` (Spawn bzw. Werkstatt). Findet sich kein
 * freier Platz, entfällt der Laden. Eingekauft wird beim Verkäufer hinter der Theke (F).
 * Tankstellen-Shops (Gas & Go) ersetzen das massive Shop-Gebäude der Tankstelle.
 * Paint & Pray ist ein Werkstattdienst: ein Mechaniker steht am Werkstattplatz, kein Gebäude.
 * Läuft am Ende von generateWorld (danach wird der Chunk-Index neu gebaut).
 */
export function placeShops(map: WorldMap) {
  const sp = map.spawn;
  /** Gewünschter Standort plus Ausweichpositionen im Umkreis (9 m und 14 m). */
  const anchors: [number, number][] = [[0, 0]];
  for (const r of [9, 14]) for (let k = 0; k < 8; k++) anchors.push([Math.cos((k / 8) * Math.PI * 2) * r, Math.sin((k / 8) * Math.PI * 2) * r]);

  const keeperName = (type: ShopType) => {
    const names = KEEPER_NAMES[type];
    return names[map.shops.filter((x) => x.type === type).length % names.length];
  };
  /** replace >= 0: vorhandenes Gebäude (Tankstellen-Shop) an diesem Index ersetzen. */
  const tryPlace = (type: ShopType, cx: number, cz: number, toward: Vec2, replace = -1, avoid?: [number, number, number]): boolean => {
    if (Math.hypot(cx - sp.x, cz - sp.z) < SPAWN_CLEAR) return false;
    // Werkstattplatz (Zapfsäulen, Reparatur-Zone) frei lassen: [x, z, Mindestabstand]
    if (avoid && Math.hypot(cx - avoid[0], cz - avoid[1]) < avoid[2]) return false;
    // Himmelsrichtungen nach Nähe zur Zielrichtung sortieren (k: 0 = +z, 1 = +x, 2 = -z, 3 = -x)
    const base = Math.atan2(toward[0] - cx, toward[1] - cz);
    const diff = (k: number) => Math.abs(Math.atan2(Math.sin((k * Math.PI) / 2 - base), Math.cos((k * Math.PI) / 2 - base)));
    for (const k of [0, 1, 2, 3].sort((a, b) => diff(a) - diff(b))) {
      if (!shopSiteFree(map, cx, cz, k)) continue;
      const hi = (SHOP_CW - 1) / 2, hj = (SHOP_CD - 1) / 2;
      for (let j = -hj; j <= hj; j++) for (let i = -hi; i <= hi; i++) {
        const [x, z] = shopCell(cx, cz, k, i, j);
        const idx = Math.floor(z / CELL) * GRID_SIZE + Math.floor(x / CELL);
        const wall = Math.abs(i) === hi || Math.abs(j) === hj;
        const door = i === 0 && j === hj;
        if (wall && !door) map.tiles[idx] = Tile.BUILDING;
        else { map.tiles[idx] = Tile.PLAZA; map.ground[idx] = Tile.PLAZA; }
      }
      const rot = (k * Math.PI) / 2;
      const def = { x: cx, z: cz, w: SHOP_W, d: SHOP_D, h: SHOP_H, rot, color: SHOP_BUILD_COLOR, style: BuildingStyle.Store };
      if (replace >= 0) map.buildings[replace] = def; else map.buildings.push(def);
      map.clearAreas.push([cx - 10, cz - 10, cx + 10, cz + 10]); // keine Bäume
      map.vehicleSpawns = map.vehicleSpawns.filter((v) => Math.abs(v.x - cx) > 10 || Math.abs(v.z - cz) > 10);
      const t = type as Exclude<ShopType, 'paint'>;
      for (const [fx, fz, fw, fd] of STORE_FURNITURE[t]) {
        const [ax, az] = storeToWorld({ x: cx, z: cz, rot }, fx - fw / 2, fz - fd / 2);
        const [bx, bz] = storeToWorld({ x: cx, z: cz, rot }, fx + fw / 2, fz + fd / 2);
        map.addFurniture(ax, az, bx, bz);
      }
      const [kl, kz, ka] = STORE_KEEPER[t];
      const [kx, kzw] = storeToWorld({ x: cx, z: cz, rot }, kl, kz);
      map.shops.push({
        id: `${type}${map.shops.length}`, type, name: SHOP_NAMES[type], x: cx, z: cz, rot, building: true,
        keeper: { x: kx, z: kzw, a: ka + rot, name: keeperName(type) },
      });
      return true;
    }
    return false;
  };
  const add = (type: ShopType, ax: number, az: number, toward: Vec2, replace = -1, avoid?: [number, number, number]): boolean => {
    for (const [dx, dz] of anchors) {
      // Mitte auf Zellmitte einrasten (7 und 5 Zellen sind ungerade)
      const cx = Math.floor((ax + dx) / CELL) * CELL + CELL / 2, cz = Math.floor((az + dz) / CELL) * CELL + CELL / 2;
      if (tryPlace(type, cx, cz, toward, replace, avoid)) return true;
    }
    return false;
  };
  // Beim Start (Spawn): beide Läden links und rechts, Türen zum Spawn
  add('sunmart', sp.x + 15, sp.z, [sp.x, sp.z]);
  add('ammo', sp.x - 15, sp.z, [sp.x, sp.z]);
  // Tankstellen: der bisherige (massive) Shop wird zum begehbaren „Gas & Go“ mit Tankwart
  const gasStores = new Set<number>(); // Index der Werkstatt mit eigenem Tankstellen-Shop
  for (const l of map.lots) {
    if (l.use !== LotUse.Gas || l.building < 0) continue;
    const old = map.buildings[l.building];
    if (old.style !== BuildingStyle.Shop) continue;
    // Altes Gebäude aus dem Kollisionsraster nehmen; klappt der Umbau nicht, wiederherstellen
    const saved: [number, number][] = [];
    rasterizePolygon(orientedRect(old.x, old.z, old.w / 2, old.d / 2, old.rot), CELL, GRID_SIZE, (x, z) => {
      const i = z * GRID_SIZE + x;
      if (map.tiles[i] === Tile.BUILDING) { saved.push([i, map.tiles[i]]); map.tiles[i] = Tile.PLAZA; }
    });
    // vom Tankplatz (Lot-Mitte) weg nach hinten schieben, damit Zapfsäulen und Werkstatt frei bleiben
    const c = centroid(l.poly);
    const dl = Math.hypot(old.x - c[0], old.z - c[1]) || 1, push = Math.max(dl, WORKSHOP_CLEAR + 1) / dl;
    const placed = add('gas', c[0] + (old.x - c[0]) * push, c[1] + (old.z - c[1]) * push, c, l.building, [c[0], c[1], WORKSHOP_CLEAR])
      || add('gas', old.x, old.z, c, l.building, [c[0], c[1], 8]); // enges Grundstück: näher ran
    if (placed) {
      const wi = map.workshops.findIndex((w) => Math.hypot(w.x - c[0], w.z - c[1]) < 1);
      if (wi >= 0) gasStores.add(wi);
    } else {
      for (const [i, t] of saved) map.tiles[i] = t;
    }
  }
  // Je Werkstatt: Paint & Pray (Mechaniker im Freien), Sunmart (falls kein Tankstellen-Shop);
  // Waffenladen in den Hauptzonen
  const ammoZones = new Set<number>([Zone.PortCoralia, Zone.CoralKeys, Zone.DryPine, Zone.PortSabal]);
  map.workshops.forEach((w, wi) => {
    const c: Vec2 = [w.x, w.z];
    let spot = findFootSpot(map, w.x, w.z + 3, 10);
    if (spot && storeAt(map.shops, spot.x, spot.z, 1)) spot = findFootSpot(map, w.x, w.z, 10);
    if (spot) {
      const x = Math.round(spot.x * 10) / 10, z = Math.round(spot.z * 10) / 10;
      const a = Math.atan2(w.x - x, w.z - z); // schaut zur Werkstatt
      map.shops.push({ id: `paint${map.shops.length}`, type: 'paint', name: SHOP_NAMES.paint, x, z, rot: a, building: false, keeper: { x, z, a, name: keeperName('paint') } });
    }
    if (!gasStores.has(wi)) add('sunmart', w.x + 14, w.z, c, -1, [w.x, w.z, WORKSHOP_CLEAR]);
    if (ammoZones.has(map.zoneAt(w.x, w.z))) add('ammo', w.x - 14, w.z, c, -1, [w.x, w.z, WORKSHOP_CLEAR]);
  });
}

export function generateShops(map: WorldMap): ShopDef[] {
  return map.shops;
}

export function shopCatalog(type: ShopType): ShopItem[] {
  const item = (id: string): ShopItem => ({ key: `i:${id}`, name: ITEMS[id].name, price: ITEMS[id].price, minLevel: 1, desc: describe(id) });
  if (type === 'sunmart') return ['burger', 'sandwich', 'energy', 'medkit'].map(item);
  if (type === 'gas') return ['sandwich', 'energy', 'burger'].map(item);
  if (type === 'paint') {
    return [
      { key: 'repair', name: 'Fahrzeug reparieren', price: REPAIR_PRICE, minLevel: 1, desc: 'Stell dich mit dem Fahrzeug in die Nähe.' },
      { key: 'respray', name: 'Umlackieren (Fahndung 1–2 weg)', price: RESPRAY_PRICE, minLevel: 1, desc: 'Nicht bei Sichtkontakt zur Polizei.' },
    ];
  }
  const list: ShopItem[] = [];
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const w = WEAPONS[id];
    if (id === 'fists') continue;
    list.push({ key: `w:${id}`, name: w.name, price: w.price, minLevel: w.unlockLevel, desc: `Schaden ${w.damage}${w.ammoPack ? ` · ${w.ammoPack} Schuss inklusive` : ''}` });
  }
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const w = WEAPONS[id];
    if (w.ammoPack > 0) list.push({ key: `a:${id}`, name: `Munition ${w.name}`, price: w.ammoPrice, minLevel: w.unlockLevel, desc: `+${w.ammoPack} Schuss` });
  }
  list.push(item('vest_light'), item('vest_heavy'));
  return list;
}

function describe(id: string): string {
  const it = ITEMS[id];
  if (it.heal) return `+${it.heal} Gesundheit`;
  if (it.stamina) return 'Ausdauer voll';
  if (it.armor) return `Rüstung ${it.armor}`;
  return '';
}

/**
 * Nächster ansprechbarer Verkäufer (oder null). Zu Fuß muss man vor ihm stehen (bei Läden im
 * Innenraum), den Mechaniker erreicht man auch aus dem Fahrzeug.
 */
export function shopNear(shops: ShopDef[], x: number, z: number, inVehicle = false, slack = 0): ShopDef | null {
  let best: ShopDef | null = null, bd = Infinity;
  for (const s of shops) {
    if (inVehicle && s.type !== 'paint') continue;
    const r = (s.type === 'paint' ? MECHANIC_RANGE : SHOP_RANGE) + slack;
    const d = (s.keeper.x - x) ** 2 + (s.keeper.z - z) ** 2;
    if (d > r * r || d >= bd) continue;
    if (s.building && slack === 0 && !insideStore(s, x, z)) continue; // nicht durch die Wand
    bd = d; best = s;
  }
  return best;
}

/** Laden, in dessen Innenraum der Punkt liegt (für das ausgeblendete Dach). */
export function storeAt(shops: ShopDef[], x: number, z: number, margin = 0): ShopDef | null {
  for (const s of shops) if (s.building && Math.abs(s.x - x) < 9 && Math.abs(s.z - z) < 9 && insideStore(s, x, z, margin)) return s;
  return null;
}
