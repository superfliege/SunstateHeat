// Flughafen Port Coralia International: Lage von Vorfeld, Rollwegen, Parkpositionen, Helipads,
// Gebäuden, Zaun und Tankstelle (Meter, x = Osten, z = Süden). Die beiden Bahnen selbst stehen in
// palmara.ts (RUNWAYS[0] = Nordbahn 09L/27R, RUNWAYS[1] = Südbahn 09R/27L).
// mapgen/city erzeugen daraus Raster und Gebäude, der Client (AirportView) die Optik, der Server
// Spawns, Tankstelle und Bahnwarnungen.
import type { Poly, Vec2 } from './geometry';
import { pointInPolygon } from './geometry';
import { RUNWAYS } from './palmara';
import type { Runway } from './WorldMap';

export const AIRPORT_NAME = 'Port Coralia International';

/** Rechteck [x0, z0, x1, z1] als Polygon. */
const rect = (x0: number, z0: number, x1: number, z1: number): Poly => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/** Zaun (achsparallel; Linien auf ungeraden Metern, damit die 2-m-Kacheln genau eine Reihe treffen). */
export const AIRPORT_FENCE = { x0: 881, z0: 1147, x1: 1163, z1: 1335, height: 2.4 };
export const AIRPORT_FENCE_POLY: Poly = rect(AIRPORT_FENCE.x0, AIRPORT_FENCE.z0, AIRPORT_FENCE.x1, AIRPORT_FENCE.z1);

/** Vorfeld (Beton) – reicht bis an den Parkplatz, das Terminal steht darauf. */
export const AIRPORT_APRON: Poly = rect(925, 1192, 1126, 1294);
/** Terminal-Parkplatz (landseitig, östlich vom Terminal). */
export const AIRPORT_PARKING: Poly = rect(1126, 1194, 1161, 1292);

export interface Taxiway { id: string; pts: Vec2[]; width: number }
/** Rollwege: A1–A3 Nordbahn ↔ Vorfeld, B1–B3 Vorfeld ↔ Südbahn, W verbindet beide Bahnen im Westen. */
export const TAXIWAYS: Taxiway[] = [
  { id: 'A1', pts: [[965, 1170], [965, 1194]], width: 12 },
  { id: 'A2', pts: [[1020, 1168], [1020, 1194]], width: 12 },
  { id: 'A3', pts: [[1085, 1166], [1085, 1194]], width: 12 },
  { id: 'B1', pts: [[965, 1292], [965, 1314]], width: 12 },
  { id: 'B2', pts: [[1020, 1292], [1020, 1316]], width: 12 },
  { id: 'B3', pts: [[1085, 1292], [1085, 1318]], width: 12 },
  { id: 'W', pts: [[912, 1172], [912, 1313]], width: 14 },
];

/** Parkpositionen der Flugzeuge (Blick nach Norden zu den Rollwegen). */
export const STANDS: { id: string; x: number; z: number; a: number }[] = [
  { id: 'P1', x: 990, z: 1222, a: Math.PI },
  { id: 'P2', x: 1032, z: 1222, a: Math.PI },
  { id: 'P3', x: 990, z: 1266, a: Math.PI },
  { id: 'P4', x: 1032, z: 1266, a: Math.PI },
];

/** Helipads: roof = Dachhöhe (0 = am Boden). */
export const HELIPADS: { id: string; x: number; z: number; r: number; roof: number }[] = [
  { id: 'terminal', x: 1078, z: 1214, r: 9, roof: 0 },
  { id: 'hangar', x: 946, z: 1267, r: 9, roof: 10 },
];

/** Tankstelle für Luftfahrzeuge (Tankradius in Metern). */
export const AIR_FUEL = { x: 1072, z: 1279, r: 11 };

/** Gebäude des Flughafens (gedrehte Rechtecke wie BuildingDef, tag = Gebäudeart für die Optik). */
export interface AirportBuilding { tag: string; x: number; z: number; w: number; d: number; h: number; rot: number; color: number }
export const HANGAR_1 = { x0: 935, z0: 1201, x1: 957, z1: 1229, h: 11 };
export const AIRPORT_BUILDINGS: AirportBuilding[] = [
  // Terminal: lang gestreckt zwischen Vorfeld und Parkplatz
  { tag: 'terminal', x: 1113, z: 1245, w: 22, d: 80, h: 12, rot: 0, color: 0xf4efe6 },
  // Tower im Westen zwischen den Bahnen (Blick auf beide)
  { tag: 'tower', x: 893, z: 1241, w: 10, d: 10, h: 26, rot: 0, color: 0xeef0f2 },
  // Hangar 1 ist offen (Marlin steht drin): nur Rückwand und Seitenwände sind massiv
  { tag: 'hangar-wall', x: HANGAR_1.x0, z: (HANGAR_1.z0 + HANGAR_1.z1) / 2, w: 2, d: HANGAR_1.z1 - HANGAR_1.z0 + 2, h: HANGAR_1.h, rot: 0, color: 0xc9d1d8 },
  { tag: 'hangar-wall', x: (HANGAR_1.x0 + HANGAR_1.x1) / 2, z: HANGAR_1.z0, w: HANGAR_1.x1 - HANGAR_1.x0, d: 2, h: HANGAR_1.h, rot: 0, color: 0xc9d1d8 },
  { tag: 'hangar-wall', x: (HANGAR_1.x0 + HANGAR_1.x1) / 2, z: HANGAR_1.z1, w: HANGAR_1.x1 - HANGAR_1.x0, d: 2, h: HANGAR_1.h, rot: 0, color: 0xc9d1d8 },
  // Hangar 2: geschlossen, Helipad auf dem Dach
  { tag: 'hangar', x: 946, z: 1267, w: 22, d: 28, h: 10, rot: 0, color: 0xc9d1d8 },
  // Feuerwache zwischen den Hangars, Tore zum Vorfeld
  { tag: 'fire', x: 945, z: 1241, w: 16, d: 14, h: 6.5, rot: 0, color: 0xd8473c },
];

/** Palmen am Terminal (landseitig und an der Vorfahrt). */
export const AIRPORT_PALMS: Vec2[] = [
  ...[1206, 1218, 1230, 1242, 1254, 1266, 1278].map((z): Vec2 => [1127.5, z]),
  [1131, 1199], [1131, 1288], [1104, 1198], [1122, 1198], [1104, 1290], [1122, 1290],
];

/** Parkplätze für NPC-Autos auf dem Terminal-Parkplatz [x, z, Blickwinkel]. */
export const AIRPORT_CAR_SPOTS: [number, number, number][] = [
  [1140, 1214, Math.PI / 2], [1140, 1226, Math.PI / 2], [1140, 1262, Math.PI / 2],
  [1154, 1220, -Math.PI / 2], [1154, 1250, -Math.PI / 2], [1154, 1274, -Math.PI / 2],
];

/** Gehwege für Fußgänger am Terminal (landseitig und auf dem Vorfeld). */
export const TERMINAL_WALKS: Vec2[][] = [
  [[1126, 1203], [1126, 1225], [1126, 1245], [1126, 1265], [1126, 1287]],
  [[1100, 1209], [1100, 1235], [1100, 1260], [1100, 1282]],
];

/** Bahnnummern je Bahn aus der Ausrichtung (+ L/R bei Parallelbahnen). */
export const RUNWAY_SUFFIX = [['L', 'R'], ['R', 'L'], ['', ''], ['', '']];
export function runwayNames(i: number): [string, string] {
  const deg = RUNWAYS[i][4];
  const h = (((180 - deg) % 360) + 360) % 360; // Kompasskurs Richtung +f (Westende → Ostende)
  const num = (k: number) => String(Math.round(k / 10) || 36).padStart(2, '0');
  const [sa, sb] = RUNWAY_SUFFIX[i] ?? ['', ''];
  return [num(h) + sa, num((h + 180) % 360) + sb];
}

/** Liegt (x, z) auf der Bahn (mit Rand)? */
export function onRunway(r: Runway, x: number, z: number, margin = 0): boolean {
  const fx = Math.sin(r.rot), fz = Math.cos(r.rot);
  const dx = x - r.x, dz = z - r.z;
  const along = dx * fx + dz * fz, across = dx * fz - dz * fx;
  return Math.abs(along) <= r.len / 2 + margin && Math.abs(across) <= r.wid / 2 + margin;
}

/** Innerhalb des Flughafenzauns? */
export const inAirport = (x: number, z: number) => pointInPolygon(x, z, AIRPORT_FENCE_POLY);

/** Startpositionen der Luftfahrzeuge (Kennung aus aircraft.json → Position, Höhe über Grund, Blick). */
export function airSpawnPoint(at: string): { x: number; z: number; a: number; roof: number } | null {
  const [kind, id] = at.split(':');
  if (kind === 'stand') { const s = STANDS.find((q) => q.id === id); return s ? { x: s.x, z: s.z, a: s.a, roof: 0 } : null; }
  if (kind === 'helipad') { const h = HELIPADS.find((q) => q.id === id); return h ? { x: h.x, z: h.z, a: Math.PI, roof: h.roof } : null; }
  if (kind === 'hangar') return { x: (HANGAR_1.x0 + HANGAR_1.x1) / 2 + 1.5, z: (HANGAR_1.z0 + HANGAR_1.z1) / 2, a: Math.PI / 2, roof: 0 };
  return null;
}
