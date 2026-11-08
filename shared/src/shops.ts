// Läden (Spec 14.4): Standorte werden deterministisch aus der Karte abgeleitet (Client und Server
// erzeugen dieselbe Liste), die Sortimente stehen hier. Preise kommen aus weapons.ts/items.ts.
import { CELL, GRID_SIZE } from './constants';
import { findFootSpot } from './sim/movement';
import { ITEMS } from './items';
import { WEAPONS, type WeaponId } from './weapons';
import type { Vec2 } from './world/geometry';
import { Tile } from './world/tiles';
import type { WorldMap } from './world/WorldMap';
import { BuildingStyle, Zone } from './world/WorldMap';

export type ShopType = 'sunmart' | 'ammo' | 'paint';
export interface ShopDef { id: string; type: ShopType; name: string; x: number; z: number }
export interface ShopItem {
  /** "w:<waffe>" Waffe kaufen, "a:<waffe>" Munition, "i:<item>" Gegenstand, "repair", "respray". */
  key: string;
  name: string;
  price: number;
  minLevel: number;
  desc: string;
}

export const SHOP_NAMES: Record<ShopType, string> = { sunmart: '24/7 Sunmart', ammo: 'Ammo & Ammo', paint: 'Paint & Pray' };
export const SHOP_COLORS: Record<ShopType, number> = { sunmart: 0x4fd16b, ammo: 0xff4f4f, paint: 0xc98bff };
/** Wie nah man sein muss (m), um mit F einzukaufen. */
export const SHOP_RANGE = 6;
export const RESPRAY_PRICE = 250;
export const REPAIR_PRICE = 100;

/**
 * Läden sind begehbare Gebäude aus 7x5 Zellen (14x10 m, Zelle = 2 m): Außenring = Wände (Kachel
 * BUILDING), innen und in der 1 Zelle breiten Tür Boden (PLAZA). Lokal: i = Breite, j = Tiefe, +j = Front.
 * Nur die vier Himmelsrichtungen, damit die Wände genau auf dem Kollisionsraster liegen.
 */
const SHOP_CW = 7, SHOP_CD = 5;
const SHOP_W = SHOP_CW * CELL, SHOP_D = SHOP_CD * CELL, SHOP_H = 4.5;
const SHOP_BUILD_COLOR = 0xf4e9d8;
/** Bodenarten, auf denen ein Laden stehen darf (keine Straße, kein Wasser, kein Gebäude). */
const SHOP_GROUND = new Set<number>([Tile.GRASS, Tile.PLAZA, Tile.SIDEWALK, Tile.SAND, Tile.DIRT]);
/** Mindestabstand der Ladenmitte zum Spawn (damit man nicht im Gebäude startet). */
const SPAWN_CLEAR = 11;

/** Weltposition der Zellmitte (i, j) eines Ladens mit Mitte (cx, cz), Himmelsrichtung k (0..3). */
function shopCell(cx: number, cz: number, k: number, i: number, j: number): Vec2 {
  const s = Math.round(Math.sin((k * Math.PI) / 2)), c = Math.round(Math.cos((k * Math.PI) / 2));
  const lx = i * CELL, lz = j * CELL;
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
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
 * freier Platz, entfällt der Laden. Der Laden-Marker (F zum Einkaufen) liegt im Innenraum.
 * Paint & Pray ist ein Werkstattdienst: nur Marker am Werkstattplatz, kein Gebäude.
 * Läuft am Ende von generateWorld (danach wird der Chunk-Index neu gebaut).
 */
export function placeShops(map: WorldMap) {
  const sp = map.spawn;
  /** Gewünschter Standort plus Ausweichpositionen im Umkreis (9 m und 14 m). */
  const anchors: [number, number][] = [[0, 0]];
  for (const r of [9, 14]) for (let k = 0; k < 8; k++) anchors.push([Math.cos((k / 8) * Math.PI * 2) * r, Math.sin((k / 8) * Math.PI * 2) * r]);

  const tryPlace = (type: ShopType, cx: number, cz: number, toward: Vec2): boolean => {
    if (Math.hypot(cx - sp.x, cz - sp.z) < SPAWN_CLEAR) return false;
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
      map.buildings.push({ x: cx, z: cz, w: SHOP_W, d: SHOP_D, h: SHOP_H, rot: (k * Math.PI) / 2, color: SHOP_BUILD_COLOR, style: BuildingStyle.Store });
      map.clearAreas.push([cx - 10, cz - 10, cx + 10, cz + 10]); // keine Bäume
      map.vehicleSpawns = map.vehicleSpawns.filter((v) => Math.abs(v.x - cx) > 10 || Math.abs(v.z - cz) > 10);
      map.shops.push({ id: `${type}${map.shops.length}`, type, name: SHOP_NAMES[type], x: cx, z: cz });
      return true;
    }
    return false;
  };
  const add = (type: ShopType, ax: number, az: number, toward: Vec2) => {
    for (const [dx, dz] of anchors) {
      // Mitte auf Zellmitte einrasten (7 und 5 Zellen sind ungerade)
      const cx = Math.floor((ax + dx) / CELL) * CELL + CELL / 2, cz = Math.floor((az + dz) / CELL) * CELL + CELL / 2;
      if (tryPlace(type, cx, cz, toward)) return;
    }
  };
  // Beim Start (Spawn): beide Läden links und rechts, Türen zum Spawn
  add('sunmart', sp.x + 15, sp.z, [sp.x, sp.z]);
  add('ammo', sp.x - 15, sp.z, [sp.x, sp.z]);
  // Je Werkstatt: Paint & Pray (Marker), Sunmart; Waffenladen in den Hauptzonen
  const ammoZones = new Set<number>([Zone.PortCoralia, Zone.CoralKeys, Zone.DryPine, Zone.PortSabal]);
  for (const w of map.workshops) {
    const c: Vec2 = [w.x, w.z];
    const spot = findFootSpot(map, w.x, w.z + 3, 10);
    if (spot) map.shops.push({ id: `paint${map.shops.length}`, type: 'paint', name: SHOP_NAMES.paint, x: Math.round(spot.x * 10) / 10, z: Math.round(spot.z * 10) / 10 });
    add('sunmart', w.x + 13, w.z, c);
    if (ammoZones.has(map.zoneAt(w.x, w.z))) add('ammo', w.x - 13, w.z, c);
  }
}

export function generateShops(map: WorldMap): ShopDef[] {
  return map.shops;
}

export function shopCatalog(type: ShopType): ShopItem[] {
  const item = (id: string): ShopItem => ({ key: `i:${id}`, name: ITEMS[id].name, price: ITEMS[id].price, minLevel: 1, desc: describe(id) });
  if (type === 'sunmart') return ['burger', 'sandwich', 'energy', 'medkit'].map(item);
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

/** Nächster Laden in Reichweite (oder null). */
export function shopNear(shops: ShopDef[], x: number, z: number, range = SHOP_RANGE): ShopDef | null {
  let best: ShopDef | null = null, bd = range * range;
  for (const s of shops) {
    const d = (s.x - x) ** 2 + (s.z - z) ** 2;
    if (d <= bd) { bd = d; best = s; }
  }
  return best;
}
