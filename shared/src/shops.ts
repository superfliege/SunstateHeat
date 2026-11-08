// Läden (Spec 14.4): Standorte werden deterministisch aus der Karte abgeleitet (Client und Server
// erzeugen dieselbe Liste), die Sortimente stehen hier. Preise kommen aus weapons.ts/items.ts.
import { findFootSpot } from './sim/movement';
import { ITEMS } from './items';
import { WEAPONS, type WeaponId } from './weapons';
import type { WorldMap } from './world/WorldMap';
import { Zone } from './world/WorldMap';

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

export function generateShops(map: WorldMap): ShopDef[] {
  const shops: ShopDef[] = [];
  const add = (type: ShopType, x: number, z: number) => {
    const spot = findFootSpot(map, x, z, 10);
    if (spot) shops.push({ id: `${type}${shops.length}`, type, name: SHOP_NAMES[type], x: Math.round(spot.x * 10) / 10, z: Math.round(spot.z * 10) / 10 });
  };
  // Beim Start (Spawn) gibt es alles, damit man sofort ausstatten kann
  add('sunmart', map.spawn.x + 11, map.spawn.z + 9);
  add('ammo', map.spawn.x - 11, map.spawn.z + 9);
  // Je Werkstatt: Paint & Pray, Sunmart; Waffenladen in den Hauptzonen
  const ammoZones = new Set<number>([Zone.PortCoralia, Zone.CoralKeys, Zone.DryPine, Zone.PortSabal]);
  for (const w of map.workshops) {
    add('paint', w.x, w.z + 3);
    add('sunmart', w.x + 13, w.z);
    if (ammoZones.has(map.zoneAt(w.x, w.z))) add('ammo', w.x - 13, w.z);
  }
  return shops;
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
