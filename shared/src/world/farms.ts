// Bauernhöfe zwischen Okeefield (Cane Ridge / Sunny Acres / Port Sabal) und dem Okee Peak.
// Reine Daten + deterministische Ableitungen (Client und Server gleich):
//   - Gebäude (BuildingStyle.Farm mit tag) für Kollision und Darstellung,
//   - Felder/Weiden/Hofplätze als Untergrund (terrain.ts -> applyFarmTiles),
//   - Zäune (Holz/Stacheldraht) als Liniensegmente – Darstellung per Instancing, der Server erkennt
//     Durchbrüche (Farmer sind empfindlich, siehe server/src/sim/Countryside.ts),
//   - Hofzufahrten (Feldwege) als Straßenkanten, Fahrzeuge (Traktoren, Pick-ups …) und Tiere.
// Jeder Hof hat einen eigenen Charakter, einen Namen und einen Stammgast (content/regulars.ts).
import { orientedRect, pointInPolygon, rasterizePolygon, type Poly, type Vec2 } from './geometry';
import { CELL, GRID_SIZE } from '../constants';
import { Tile } from './tiles';
import { BuildingStyle, type BuildingDef, type WorldMap } from './WorldMap';
import { centroid } from './geometry';
import { CAR_VARIANTS } from '../sim/handling';
import { VehicleKind } from '../sim/vehicleDefs';

export type FarmKind = 'orange' | 'cattle' | 'dairy' | 'chicken' | 'melon' | 'cane';
export type FarmBuildingKind = 'house' | 'barn' | 'shed' | 'silo' | 'coop' | 'milking' | 'stable' | 'mill' | 'shop' | 'packing' | 'garage';
export type FieldKind = 'orange' | 'pasture' | 'crop' | 'cane' | 'hay' | 'run' | 'corral' | 'arena';
export type FenceKind = 'wood' | 'wire' | 'none';
export type FarmPropKind =
  | 'windpump' | 'water_tower' | 'mailbox' | 'hay_round' | 'hay_square' | 'trough' | 'scarecrow' | 'juice_press' | 'egg_stand'
  | 'farm_stand' | 'porch_swing' | 'irrigation' | 'harvest_wagon' | 'doghouse' | 'chimney' | 'bleachers' | 'water_wheel'
  | 'tool_bench' | 'guitar_chair' | 'orange_crates' | 'milk_cans' | 'feed_trough' | 'tracks';
export type AnimalKind = 'cow' | 'dairy_cow' | 'horse' | 'chicken' | 'dog' | 'goat' | 'deer' | 'turkey' | 'hawk' | 'raccoon';

export interface FarmBuilding { k: FarmBuildingKind; x: number; z: number; w: number; d: number; h: number; rot: number; color: number }
export interface FarmField { k: FieldKind; x: number; z: number; hw: number; hd: number; rot: number; fence: FenceKind; poly: Poly }
export interface FarmProp { k: FarmPropKind; x: number; z: number; rot: number }
export interface FarmAnimals { kind: AnimalKind; count: number; field: number; name?: string }
/** Fahrzeug nach Variantenname (sim/handling.ts CAR_VARIANTS). */
export interface FarmVehicle { variant: string; x: number; z: number; a: number }

export interface FarmDef {
  id: string; name: string; kind: FarmKind;
  x: number; z: number;
  /** Stammgast (content/regulars.ts) und was ihn ausmacht. */
  regular: { id: string; name: string; role: string };
  /** Hofplatz (Schotter): halbe Breite/Tiefe, Drehung. */
  yard: [number, number, number];
  buildings: FarmBuilding[];
  fields: FarmField[];
  props: FarmProp[];
  animals: FarmAnimals[];
  vehicles: FarmVehicle[];
  /** Zufahrt vom Hofplatz zur nächsten Straße (Feldweg). */
  lane: Vec2[];
  /** Begrenzung des ganzen Hofs (Felder + Hof), für Untergrund und Bebauungsverbot. */
  bounds: [number, number, number, number];
}

// ------------------------------------------------------------------ Bau-Helfer
const RED_BARN = 0xa83c2a, WEATHERED = 0x8a6a52, WHITE_HOUSE = 0xf2ece0, YELLOW_HOUSE = 0xf0d890, BLUE_HOUSE = 0xa8c8d8, SILO = 0xd8d4c8;
const B = (k: FarmBuildingKind, x: number, z: number, w: number, d: number, h: number, rot = 0, color = RED_BARN): FarmBuilding => ({ k, x, z, w, d, h, rot, color });
const F = (k: FieldKind, x: number, z: number, hw: number, hd: number, rot = 0, fence: FenceKind = 'none'): FarmField =>
  ({ k, x, z, hw, hd, rot, fence, poly: orientedRect(x, z, hw, hd, rot) });
const P = (k: FarmPropKind, x: number, z: number, rot = 0): FarmProp => ({ k, x, z, rot });

function farm(def: Omit<FarmDef, 'bounds'>): FarmDef {
  let x0 = def.x - def.yard[0], z0 = def.z - def.yard[1], x1 = def.x + def.yard[0], z1 = def.z + def.yard[1];
  for (const f of def.fields) for (const [px, pz] of f.poly) { x0 = Math.min(x0, px); z0 = Math.min(z0, pz); x1 = Math.max(x1, px); z1 = Math.max(z1, pz); }
  for (const b of def.buildings) { x0 = Math.min(x0, b.x - b.w); z0 = Math.min(z0, b.z - b.d); x1 = Math.max(x1, b.x + b.w); z1 = Math.max(z1, b.z + b.d); }
  return { ...def, bounds: [x0 - 4, z0 - 4, x1 + 4, z1 + 4] };
}

// ------------------------------------------------------------------ Die Höfe
export const FARMS: FarmDef[] = [
  farm({
    id: 'sunny_grove', name: 'Sunny Grove Farm', kind: 'orange', x: 934, z: 700,
    regular: { id: 'ok_sunny_grove', name: 'Rosie Peck', role: 'Orangenbäuerin, führt den Hofladen mit eiserner Freundlichkeit („Das ist eine Orange, Schätzchen.“)' },
    yard: [16, 12, 0],
    buildings: [
      B('house', 926, 686, 11, 8, 5.5, 0, YELLOW_HOUSE), B('packing', 946, 690, 14, 9, 6, 0, WEATHERED), B('shop', 958, 666, 8, 5, 3.6, 0.2, 0xf4e0b0),
      B('barn', 916, 712, 10, 12, 7, Math.PI / 2, RED_BARN),
    ],
    fields: [
      F('orange', 966, 718, 24, 26, 0.04, 'wood'), F('orange', 944, 752, 30, 12, 0.04, 'wood'), F('orange', 984, 680, 10, 16, 0, 'wood'),
    ],
    props: [
      P('juice_press', 950, 700), P('orange_crates', 944, 702, 0.3), P('orange_crates', 958, 672), P('farm_stand', 962, 660, 0.2),
      P('mailbox', 914, 696, Math.PI / 2), P('porch_swing', 926, 691), P('windpump', 908, 724), P('water_tower', 938, 716),
      P('tool_bench', 938, 696, Math.PI), P('guitar_chair', 931, 691), P('doghouse', 920, 696), P('tracks', 944, 735, 0),
    ],
    animals: [{ kind: 'dog', count: 1, field: -1, name: 'Biscuit' }, { kind: 'chicken', count: 4, field: -1 }],
    vehicles: [{ variant: 'Dirt Buddy', x: 940, z: 708, a: 0 }, { variant: 'Orangenkisten-Anhänger', x: 950, z: 712, a: 0 }, { variant: 'Hay Hauler', x: 918, z: 680, a: Math.PI / 2 }],
    lane: [[934, 700], [912, 700], [896, 702]],
  }),
  farm({
    id: 'double_r', name: 'Double R Ranch', kind: 'cattle', x: 836, z: 712,
    regular: { id: 'ok_rancher', name: 'Doris Whitlock', role: 'Rancherin der Double R Ranch, redet mit Kühen netter als mit Menschen' },
    yard: [16, 14, 0],
    buildings: [
      B('house', 822, 702, 10, 8, 5.5, 0, WHITE_HOUSE), B('barn', 848, 700, 14, 12, 8, 0, RED_BARN), B('stable', 852, 722, 16, 7, 4.5, 0, WEATHERED),
      B('silo', 862, 696, 4, 4, 12, 0, SILO),
    ],
    fields: [
      F('pasture', 832, 662, 30, 20, 0.02, 'wire'), F('pasture', 828, 762, 26, 18, 0, 'wire'), F('corral', 822, 728, 9, 8, 0, 'wood'),
      F('arena', 840, 806, 22, 16, 0, 'wood'),
    ],
    props: [
      P('trough', 834, 668), P('trough', 822, 732), P('windpump', 812, 676), P('hay_round', 860, 714), P('hay_round', 862, 718), P('hay_round', 858, 718),
      P('bleachers', 840, 788, Math.PI), P('bleachers', 862, 806, -Math.PI / 2), P('mailbox', 866, 708, -Math.PI / 2), P('porch_swing', 822, 707),
      P('feed_trough', 846, 708), P('tracks', 850, 760, 1.4),
    ],
    animals: [
      { kind: 'cow', count: 10, field: 0 }, { kind: 'cow', count: 7, field: 1 }, { kind: 'horse', count: 4, field: 2 },
      { kind: 'dog', count: 1, field: -1, name: 'Sheriff' },
    ],
    vehicles: [{ variant: 'Field King 400', x: 838, z: 718, a: Math.PI / 2 }, { variant: 'Viehtransporter', x: 856, z: 730, a: 0 }, { variant: 'Rusty Ranch Pick-up', x: 826, z: 716, a: 0 }],
    lane: [[836, 712], [870, 712], [888, 714]],
  }),
  farm({
    id: 'henderson', name: 'Henderson Dairy', kind: 'dairy', x: 828, z: 552,
    regular: { id: 'ok_henderson', name: 'Walt Henderson', role: 'Milchbauer, kennt jede Kuh beim Namen und jede Kuh kennt seine Witze' },
    yard: [14, 9, 0],
    buildings: [
      B('house', 806, 544, 9, 8, 5.5, 0, BLUE_HOUSE), B('milking', 830, 540, 18, 9, 5, 0, WHITE_HOUSE), B('barn', 852, 546, 12, 12, 8, 0, RED_BARN),
      B('silo', 864, 534, 4, 4, 13, 0, SILO), B('silo', 868, 540, 4, 4, 11, 0, SILO),
    ],
    fields: [F('pasture', 830, 574, 34, 10, 0, 'wood'), F('hay', 880, 566, 12, 18, 0, 'wire')],
    props: [
      P('milk_cans', 822, 546), P('feed_trough', 828, 566), P('water_tower', 798, 556), P('mailbox', 816, 530, Math.PI),
      P('porch_swing', 806, 549), P('hay_square', 876, 560), P('hay_square', 879, 560), P('hay_square', 877, 563), P('tool_bench', 842, 548),
    ],
    animals: [{ kind: 'dairy_cow', count: 9, field: 0 }, { kind: 'goat', count: 1, field: -1, name: 'Gertrude' }, { kind: 'dog', count: 1, field: -1, name: 'Butter' }],
    vehicles: [{ variant: 'Milchtanklaster', x: 838, z: 532, a: Math.PI / 2 }, { variant: 'Rusty Ol\' Red', x: 816, z: 556, a: 0 }],
    lane: [[828, 552], [828, 530], [828, 512]],
  }),
  farm({
    id: 'cluck', name: 'Cluck & Co.', kind: 'chicken', x: 934, z: 560,
    regular: { id: 'ok_cluck', name: 'Betty-Lou Cluckett', role: 'Hühnerfarmerin, verkauft am Eierstand jedes Ei mit einer Lebensweisheit' },
    yard: [12, 8, 0],
    buildings: [
      B('house', 918, 548, 9, 8, 5, 0, YELLOW_HOUSE), B('coop', 944, 548, 28, 6, 3.2, 0, WEATHERED), B('coop', 944, 560, 28, 6, 3.2, 0, WEATHERED),
      B('coop', 944, 572, 28, 6, 3.2, 0, 0xd8c8a8), B('shed', 916, 568, 7, 6, 3.5, 0, RED_BARN),
    ],
    fields: [F('run', 948, 588, 22, 8, 0, 'wire')],
    props: [P('egg_stand', 934, 528, Math.PI), P('mailbox', 928, 528, Math.PI), P('windpump', 908, 580), P('feed_trough', 948, 584), P('porch_swing', 918, 553), P('guitar_chair', 924, 553)],
    animals: [{ kind: 'chicken', count: 22, field: 0 }, { kind: 'dog', count: 1, field: -1, name: 'Pancake' }],
    vehicles: [{ variant: 'Mule ATV', x: 930, z: 566, a: 0 }, { variant: 'Rusty Ranch Pick-up', x: 924, z: 538, a: Math.PI / 2 }],
    lane: [[934, 560], [934, 532], [934, 514]],
  }),
  farm({
    id: 'big_melon', name: 'Big Melon Acres', kind: 'melon', x: 1000, z: 820,
    regular: { id: 'ok_big_melon', name: 'Hank Mellow', role: 'Gemüsebauer, Vogelscheuchen-Künstler, gibt jeder Melone einen Namen' },
    yard: [12, 9, 0],
    buildings: [B('house', 988, 810, 9, 8, 5, 0, WHITE_HOUSE), B('shed', 1010, 808, 12, 8, 5, 0, WEATHERED), B('barn', 1018, 826, 10, 10, 7, 0, RED_BARN)],
    fields: [F('crop', 970, 848, 26, 16, 0, 'wire'), F('crop', 1040, 850, 26, 18, 0, 'wire'), F('crop', 1052, 812, 14, 14, 0, 'wire')],
    props: [
      P('scarecrow', 966, 846), P('scarecrow', 1044, 852, 1.2), P('scarecrow', 1052, 808, 2.4), P('irrigation', 1040, 850), P('harvest_wagon', 996, 830),
      P('mailbox', 984, 800, Math.PI), P('water_tower', 1026, 810), P('porch_swing', 988, 815), P('tracks', 970, 850, 0),
    ],
    animals: [{ kind: 'dog', count: 1, field: -1, name: 'Pickle' }, { kind: 'turkey', count: 3, field: -1 }],
    vehicles: [{ variant: 'Harvest Titan', x: 1006, z: 840, a: Math.PI / 2 }, { variant: 'Dirt Buddy', x: 994, z: 826, a: 0 }, { variant: 'Pflug', x: 1012, z: 840, a: Math.PI / 2 }],
    lane: [[1000, 820], [1000, 800], [1002, 784]],
  }),
  farm({
    id: 'cane_creek', name: 'Cane Creek Mill', kind: 'cane', x: 1128, z: 560,
    regular: { id: 'ok_cane_creek', name: 'Earl Pritchard', role: 'Müller der Zuckerrohrmühle, zündet die Ernte an und erzählt dabei Gruselgeschichten' },
    yard: [12, 10, 0],
    buildings: [B('mill', 1140, 552, 14, 12, 9, 0, WEATHERED), B('house', 1114, 548, 9, 8, 5, 0, WHITE_HOUSE), B('shed', 1118, 572, 9, 7, 4, 0, RED_BARN)],
    fields: [F('cane', 1146, 504, 22, 22, 0.05, 'none'), F('cane', 1150, 590, 18, 16, 0, 'none'), F('cane', 1112, 600, 12, 12, 0, 'none')],
    props: [P('chimney', 1146, 546), P('water_wheel', 1150, 562, Math.PI / 2), P('mailbox', 1104, 556, -Math.PI / 2), P('porch_swing', 1114, 553), P('harvest_wagon', 1132, 576)],
    animals: [{ kind: 'dog', count: 1, field: -1, name: 'Molasses' }],
    vehicles: [{ variant: 'Rusty Ol\' Red', x: 1124, z: 562, a: 0 }, { variant: 'Heuwagen', x: 1134, z: 568, a: 0 }],
    lane: [[1128, 560], [1104, 560], [1090, 560]],
  }),
];

// ------------------------------------------------------------------ Ableitungen
/** Hofzufahrten (Feldwege, RoadType.Dirt = 3) – enden am Hofplatz. */
export function farmLanes(): { name: string; type: number; pts: Vec2[] }[] {
  // Zufahrt beginnt an der Straße (loses Ende wird angeschlossen) und endet am Hof
  return FARMS.map((f) => ({ name: `Zufahrt ${f.name}`, type: 3, pts: f.lane.slice().reverse() }));
}

/** Liegt (x, z) im Bereich eines Hofs (Bounds)? */
export function farmAt(x: number, z: number): FarmDef | null {
  for (const f of FARMS) { const [x0, z0, x1, z1] = f.bounds; if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return f; }
  return null;
}

/** Untergrund der Höfe ins Kachelraster schreiben (vor Straßen und Gebäuden). */
export function applyFarmTiles(tiles: Uint8Array) {
  const N = GRID_SIZE;
  const put = (poly: Poly, t: number) => rasterizePolygon(poly, CELL, N, (x, z) => {
    const k = z * N + x;
    if (tiles[k] !== Tile.WATER && tiles[k] !== Tile.SWAMP) tiles[k] = t;
  });
  const fieldTile: Record<FieldKind, number> = {
    orange: Tile.FARM, pasture: Tile.PASTURE, crop: Tile.CROP, cane: Tile.FIELD, hay: Tile.PASTURE, run: Tile.DIRT, corral: Tile.DIRT, arena: Tile.DIRT,
  };
  for (const f of FARMS) {
    // Umgebung des Hofs: Grasland statt zufälliger Plantagen-Flecken
    const [x0, z0, x1, z1] = f.bounds;
    put([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], Tile.GRASS);
    for (const fl of f.fields) put(fl.poly, fieldTile[fl.k]);
    put(orientedRect(f.x, f.z, f.yard[0], f.yard[1], f.yard[2]), Tile.GRAVEL);
  }
}

/** Zaunsegmente [ax, az, bx, bz, kind] (mit Lücke für das Gatter). */
export interface FenceSeg { ax: number; az: number; bx: number; bz: number; kind: FenceKind; farm: string }
let fenceCache: FenceSeg[] | null = null;
export function farmFences(): FenceSeg[] {
  if (fenceCache) return fenceCache;
  const out: FenceSeg[] = [];
  for (const f of FARMS) {
    for (const fl of f.fields) {
      if (fl.fence === 'none') continue;
      const p = fl.poly;
      for (let i = 0; i < 4; i++) {
        const a = p[i], b = p[(i + 1) % 4];
        // Gatter: Lücke von 5 m in der Mitte der dem Hof zugewandten Seite
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const facing = Math.hypot(mx - f.x, mz - f.z) < Math.hypot(fl.x - f.x, fl.z - f.z);
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (facing && L > 12) {
          const t0 = 0.5 - 2.5 / L, t1 = 0.5 + 2.5 / L;
          out.push({ ax: a[0], az: a[1], bx: a[0] + (b[0] - a[0]) * t0, bz: a[1] + (b[1] - a[1]) * t0, kind: fl.fence, farm: f.id });
          out.push({ ax: a[0] + (b[0] - a[0]) * t1, az: a[1] + (b[1] - a[1]) * t1, bx: b[0], bz: b[1], kind: fl.fence, farm: f.id });
        } else out.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], kind: fl.fence, farm: f.id });
      }
    }
  }
  fenceCache = out;
  return out;
}

/** Felder, in denen ein Punkt liegt (für Tiere, Ernte, Pflugfurchen). */
export function fieldAt(x: number, z: number): { farm: FarmDef; field: FarmField; index: number } | null {
  const f = farmAt(x, z);
  if (!f) return null;
  for (let i = 0; i < f.fields.length; i++) if (pointInPolygon(x, z, f.fields[i].poly)) return { farm: f, field: f.fields[i], index: i };
  return null;
}

/**
 * Hofgebäude eintragen (nach buildCity, vor der Rasterung): verdrängt zufällige Landhäuser im
 * Hofbereich, legt Gebäude (BuildingStyle.Farm, tag = Art) und je ein Grundstück an.
 */
export function placeFarmBuildings(map: WorldMap) {
  const inside = (x: number, z: number) => FARMS.some((f) => x >= f.bounds[0] && x <= f.bounds[2] && z >= f.bounds[1] && z <= f.bounds[3]);
  const remap = new Map<number, number>();
  const kept: BuildingDef[] = [];
  map.buildings.forEach((b, i) => {
    const lot = map.lots.find((l) => l.building === i);
    if (inside(b.x, b.z) && (!lot || lot.block < 0)) return;
    remap.set(i, kept.length); kept.push(b);
  });
  map.buildings = kept;
  map.lots = map.lots.filter((l) => { const c = centroid(l.poly); return !(l.block < 0 && inside(c[0], c[1])); });
  map.lots.forEach((l, i) => { l.id = i; if (l.building >= 0) l.building = remap.get(l.building) ?? -1; });
  for (const f of FARMS) {
    for (const b of f.buildings) {
      map.buildings.push({ x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, rot: b.rot, color: b.color, style: BuildingStyle.Farm, tag: `${b.k}:${f.id}` });
    }
  }
}

/** Hof-Fahrzeuge (Traktoren, Pick-ups, Anhänger …) als feste Spawns. */
export function placeFarmVehicles(map: WorldMap) {
  for (const f of FARMS) {
    for (const v of f.vehicles) {
      const variant = CAR_VARIANTS.findIndex((c) => c.name === v.variant);
      if (variant < 0) continue;
      map.vehicleSpawns.push({ kind: VehicleKind.Car, x: v.x, z: v.z, a: v.a, color: 0, variant });
    }
  }
}
