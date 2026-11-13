// Läden (Spec 14.4): Standorte werden deterministisch aus der Karte abgeleitet (Client und Server
// erzeugen dieselbe Liste), die Sortimente stehen hier. Preise kommen aus weapons.ts/items.ts.
import { CELL, GRID_SIZE } from './constants';
import { findFootSpot } from './sim/movement';
import { ITEMS } from './items';
import { WEAPONS, type WeaponId } from './weapons';
import { centroid, distToSegment, orientedRect, pointAt, rasterizePolygon, type Vec2 } from './world/geometry';
import { Tile } from './world/tiles';
import type { WorldMap } from './world/WorldMap';
import { BuildingStyle, LotUse, RoadType, Zone } from './world/WorldMap';

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
 * Frei drehbar (parallel zur Straße); Wände und Einrichtung kollidieren als gedrehte Rechtecke.
 */
const SHOP_CW = 7, SHOP_CD = 5; // in Zellen (2 m)
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
/** Mindestabstand des Spawns zu den Ladenwänden (m). */
const SPAWN_CLEAR = 3;
/** Mindestabstand der Ladenmitte zur Werkstatt-/Tankplatzmitte. */
const WORKSHOP_CLEAR = 12;
/** Abstand der Ladenfront zur Gehwegkante (kleiner Vorplatz vor der Tür). */
const FRONT_GAP = 1.5;
/** Die fünf Wandstücke (lokal: Mitte x, z, Breite, Tiefe): Rückwand, Seiten, Front links/rechts der Tür. */
const hw0 = SHOP_W / 2, hd0 = SHOP_D / 2;
export const STORE_WALLS: [number, number, number, number][] = [
  [0, -(hd0 - 1), SHOP_W, 2],
  [-(hw0 - 1), 0, 2, SHOP_D - 4],
  [hw0 - 1, 0, 2, SHOP_D - 4],
  [-(hw0 + 1) / 2, hd0 - 1, hw0 - 1, 2],
  [(hw0 + 1) / 2, hd0 - 1, hw0 - 1, 2],
];

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

/** Gebäudefläche (mit Rand) und Vorplatz vor der Tür müssen freier Boden sein. */
function shopSiteFree(map: WorldMap, cx: number, cz: number, rot: number): boolean {
  const at = { x: cx, z: cz, rot };
  for (let lz = -hd0 - 0.6; lz <= hd0 + 0.61; lz += 1) {
    for (let lx = -hw0 - 0.6; lx <= hw0 + 0.61; lx += 1) {
      const [x, z] = storeToWorld(at, lx, lz);
      if (!SHOP_GROUND.has(map.tileAt(x, z)) || map.storeTileAt(x, z)) return false;
    }
  }
  for (const lz of [hd0 + 1, hd0 + 2.5]) for (const lx of [-1, 0, 1]) { // Vorplatz
    const [x, z] = storeToWorld(at, lx, lz);
    if (!SHOP_GROUND.has(map.tileAt(x, z)) || map.storeTileAt(x, z)) return false;
  }
  return true;
}

/**
 * Erzeugt die Läden als begehbare Gebäude (BuildingStyle.Store) und legt sie in map.shops ab.
 * Läden stehen an der Straße: Tür zur Fahrbahn, Front parallel zum Straßenverlauf (frei gedreht).
 * Unter dem Laden sind die Kacheln für Fahrzeuge massiv; zu Fuß gelten die exakten Wände und die
 * Einrichtung (map.furniture). Findet sich kein freier Platz, entfällt der Laden. Eingekauft wird
 * beim Verkäufer hinter der Theke (E). Tankstellen-Shops (Gas & Go) ersetzen das massive
 * Shop-Gebäude der Tankstelle. Paint & Pray ist ein Werkstattdienst: ein Mechaniker steht am
 * Werkstattplatz, kein Gebäude. Läuft am Ende von generateWorld (danach wird der Chunk-Index neu gebaut).
 */
export function placeShops(map: WorldMap) {
  const sp = map.spawn;
  const keeperName = (type: ShopType) => {
    const names = KEEPER_NAMES[type];
    return names[map.shops.filter((x) => x.type === type).length % names.length];
  };
  /** replace >= 0: vorhandenes Gebäude (Tankstellen-Shop) an diesem Index ersetzen. */
  const tryPlace = (type: Exclude<ShopType, 'paint'>, cx: number, cz: number, rot: number, replace = -1, avoid?: [number, number, number]): boolean => {
    // Spawn nicht im oder direkt am Gebäude
    const [slx, slz] = worldToStore({ x: cx, z: cz, rot }, sp.x, sp.z);
    if (Math.abs(slx) < hw0 + SPAWN_CLEAR && Math.abs(slz) < hd0 + SPAWN_CLEAR) return false;
    // Werkstattplatz (Zapfsäulen, Reparatur-Zone) frei lassen: [x, z, Mindestabstand]
    if (avoid && Math.hypot(cx - avoid[0], cz - avoid[1]) < avoid[2]) return false;
    if (map.shops.some((s) => s.building && Math.hypot(s.x - cx, s.z - cz) < SHOP_W + 1.5)) return false;
    if (!shopSiteFree(map, cx, cz, rot)) return false;
    const at = { x: cx, z: cz, rot };
    // Kacheln: ganz im Innenraum begehbar (PLAZA), sonst für Fahrzeuge massiv (Ladenkachel)
    rasterizePolygon(orientedRect(cx, cz, hw0 + 0.7, hd0 + 0.7, rot), CELL, GRID_SIZE, (tx, tz) => {
      const i = tz * GRID_SIZE + tx;
      let inner = true;
      for (const [ox, oz] of [[0, 0], [CELL, 0], [0, CELL], [CELL, CELL]]) {
        const [lx, lz] = worldToStore(at, tx * CELL + ox, tz * CELL + oz);
        if (Math.abs(lx) > STORE_IN_X || Math.abs(lz) > STORE_IN_Z) inner = false;
      }
      map.ground[i] = Tile.PLAZA;
      if (inner) map.tiles[i] = Tile.PLAZA;
      else { map.tiles[i] = Tile.BUILDING; map.storeTiles.add(i); }
    });
    const def = { x: cx, z: cz, w: SHOP_W, d: SHOP_D, h: SHOP_H, rot, color: SHOP_BUILD_COLOR, style: BuildingStyle.Store };
    if (replace >= 0) map.buildings[replace] = def; else map.buildings.push(def);
    map.clearAreas.push([cx - 10, cz - 10, cx + 10, cz + 10]); // keine Bäume
    map.vehicleSpawns = map.vehicleSpawns.filter((v) => Math.hypot(v.x - cx, v.z - cz) > 10);
    for (const [fx, fz, fw, fd] of [...STORE_WALLS, ...STORE_FURNITURE[type]]) {
      const [x, z] = storeToWorld(at, fx, fz);
      map.addFurniture(x, z, fw / 2, fd / 2, rot);
    }
    const [kl, kz, ka] = STORE_KEEPER[type];
    const [kx, kzw] = storeToWorld(at, kl, kz);
    map.shops.push({
      id: `${type}${map.shops.length}`, type, name: SHOP_NAMES[type], x: cx, z: cz, rot, building: true,
      keeper: { x: kx, z: kzw, a: ka + rot, name: keeperName(type) },
    });
    return true;
  };

  /**
   * Bauplätze an Straßen nahe (ax, az): auf der Straßenseite des Ankers (farSide: gegenüber),
   * Front zur Fahrbahn, hinter dem Gehweg, mit Abstand zu Kreuzungen; nach Entfernung sortiert.
   */
  const roadSites = (ax: number, az: number, farSide = false, maxD = 45, onlyRoad = '') => {
    const out: { cx: number; cz: number; rot: number; d: number }[] = [];
    for (const e of map.edges) {
      if (e.type === RoadType.Pier || e.type === RoadType.Highway || (onlyRoad && e.name !== onlyRoad)) continue;
      let bd = maxD, bs = -1;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        const r = distToSegment(ax, az, a[0], a[1], b[0], b[1]);
        if (r.d < bd) { bd = r.d; bs = e.cum[i] + (e.cum[i + 1] - e.cum[i]) * r.t; }
      }
      if (bs < 0) continue;
      for (let k = 0; k < 55; k++) {
        const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5; // 0, ±1,5 … ±40,5
        const s = bs + off;
        if (s < e.trimA + hw0 + 2 || s > e.len - e.trimB - hw0 - 2) continue; // nicht in die Kreuzung
        const q = pointAt(e.pts, e.cum, s);
        let nx = -q.dz, nz = q.dx;
        if (((ax - q.x) * nx + (az - q.z) * nz < 0) !== farSide) { nx = -nx; nz = -nz; }
        const back = e.width / 2 + e.sidewalk + FRONT_GAP + hd0;
        const cx = q.x + nx * back, cz = q.z + nz * back;
        out.push({ cx, cz, rot: Math.atan2(-nx, -nz), d: Math.hypot(cx - ax, cz - az) });
      }
    }
    return out.sort((p, q) => p.d - q.d);
  };
  const addAtRoad = (type: Exclude<ShopType, 'paint'>, ax: number, az: number, avoid?: [number, number, number], onlyRoad = '') => {
    for (const site of roadSites(ax, az, false, 45, onlyRoad)) if (tryPlace(type, site.cx, site.cz, site.rot, -1, avoid)) return true;
    return false;
  };

  // Beim Start (Spawn): Supermarkt und Waffenladen an der nächsten Straße, auf der Seite des
  // Spawns, Türen zur Straße (aus der Kamerasicht schaut man auf die Fronten)
  let spawnRoad = '', sd = Infinity;
  for (const e of map.edges) {
    if (e.type === RoadType.Pier || e.type === RoadType.Highway) continue;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const r = distToSegment(sp.x, sp.z, e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]);
      if (r.d < sd) { sd = r.d; spawnRoad = e.name; }
    }
  }
  // jeweils so nah am Spawn wie möglich, also nebeneinander
  for (const type of ['sunmart', 'ammo'] as const) addAtRoad(type, sp.x, sp.z, undefined, spawnRoad) || addAtRoad(type, sp.x, sp.z);
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
    // gleiche Ausrichtung wie der alte Shop (Front zur Straße), etwas nach hinten bzw. zur Seite
    // gerückt, damit Zapfsäulen und Werkstatt (Lot-Mitte) frei bleiben
    const c = centroid(l.poly);
    const fx = Math.sin(old.rot), fz = Math.cos(old.rot), rx = Math.cos(old.rot), rz = -Math.sin(old.rot);
    let placed = false;
    for (const clear of [WORKSHOP_CLEAR, 8, 6]) {
      for (const back of [1, 3, 5, 7]) {
        for (const side of [0, 4, -4, 8, -8, 12, -12, 16, -16]) {
          const x = old.x - fx * back + rx * side, z = old.z - fz * back + rz * side;
          if ((placed = tryPlace('gas', x, z, old.rot, l.building, [c[0], c[1], clear]))) break;
        }
        if (placed) break;
      }
      if (placed) break;
    }
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
    let spot = findFootSpot(map, w.x, w.z + 3, 10);
    if (spot && storeAt(map.shops, spot.x, spot.z, 1)) spot = findFootSpot(map, w.x, w.z, 10);
    if (spot) {
      const x = Math.round(spot.x * 10) / 10, z = Math.round(spot.z * 10) / 10;
      const a = Math.atan2(w.x - x, w.z - z); // schaut zur Werkstatt
      map.shops.push({ id: `paint${map.shops.length}`, type: 'paint', name: SHOP_NAMES.paint, x, z, rot: a, building: false, keeper: { x, z, a, name: keeperName('paint') } });
    }
    const avoid: [number, number, number] = [w.x, w.z, WORKSHOP_CLEAR];
    if (!gasStores.has(wi)) addAtRoad('sunmart', w.x + 14, w.z, avoid);
    if (ammoZones.has(map.zoneAt(w.x, w.z))) addAtRoad('ammo', w.x - 14, w.z, avoid);
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
