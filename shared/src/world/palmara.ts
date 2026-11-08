// Kartendatei von Palmara: handgepflegte Vektordaten in Metern (x = Osten, z = Süden).
// Alles, was nicht hier steht (Nebenstraßen, Blöcke, Grundstücke, Gebäude, Vegetation),
// erzeugt mapgen.ts prozedural und deterministisch daraus.
import type { Poly, Vec2 } from './geometry';
import { RoadType, Zone } from './WorldMap';

// ------------------------------------------------------------------ Land & Wasser
/** amp = Ausfransung in Metern, wave = typische Buchtenbreite. */
export interface ShapeDef { name: string; poly: Poly; amp: number; wave: number }

/** Küstenlinie der Halbinsel (im Uhrzeigersinn). Die Stadtküste ist ruhiger, aber nicht gerade. */
export const COAST: Vec2[] = [
  [320, 416], [368, 288], [448, 208], [560, 144], [672, 120], [768, 104], [880, 120], [1008, 112], [1136, 128],
  [1248, 152], [1344, 184], [1424, 224], [1456, 272], [1440, 352], [1424, 480], [1432, 608], [1448, 720],
  [1452, 820], [1446, 920], [1450, 1020], [1444, 1120], [1450, 1230], [1448, 1328],
  [1424, 1376], [1376, 1424], [1328, 1472], [1296, 1536], [1264, 1616], [1216, 1664], [1120, 1688], [992, 1696],
  [864, 1696], [784, 1672], [744, 1600], [736, 1472], [720, 1360], [656, 1216], [576, 1072], [512, 928],
  [496, 832], [464, 752], [448, 672], [424, 576], [368, 496],
];
/** Bereich der Stadtküste mit kleiner Ausfransung (Uferpromenade). */
export const CALM_COAST = { x0: 1380, z0: 700, x1: 1470, z1: 1340 };

/** Inseln: [Name, Mitte x, Mitte z, Radius x, Radius z, Superellipsen-Exponent, Drehung (Grad)]. */
export const ISLANDS: [string, number, number, number, number, number, number][] = [
  ['Ocean Strip', 1576, 936, 68, 186, 4, 2],
  ['Hafeninsel', 1530, 1178, 66, 50, 4, -4],
  ['Damm-Insel West', 1476, 856, 15, 13, 2, 0],
  ['Damm-Insel Ost', 1510, 858, 14, 12, 2, 0],
  ['Villeninsel', 1488, 944, 26, 22, 2.4, 10],
  ['Resortinsel', 1642, 1250, 34, 28, 2.2, -15],
  ['Blue Hook Key', 1188, 1716, 60, 42, 2.2, 15],
  ['Pelican Key', 1112, 1792, 44, 30, 2, 25],
  ['Conch Key', 1024, 1856, 42, 30, 2, 15],
  ['Long Key', 928, 1896, 54, 34, 2.2, 5],
  ['Marlin Key', 832, 1904, 44, 30, 2, -8],
  ['Driftwood Key', 752, 1870, 36, 26, 2, -20],
  ['Sunset Key', 608, 1804, 124, 68, 2.6, -4],
];

/** Die schmale Nehrung im Nordosten (Polylinie + Breite). */
export const SPIT: { pts: Vec2[]; width: number } = {
  pts: [[1556, 770], [1530, 640], [1504, 480], [1476, 360], [1450, 286]], width: 44,
};

/** Seen und Buchten (werden aus dem Land geschnitten). */
export const LAKES: ShapeDef[] = [
  { name: 'Lake Okee', poly: [[1180, 440], [1270, 420], [1330, 480], [1320, 590], [1250, 610], [1176, 560]], amp: 12, wave: 70 },
  { name: 'Sabal Bay', poly: [[480, 620], [560, 600], [612, 640], [600, 700], [530, 712], [478, 676]], amp: 8, wave: 50 },
];

/** Flüsse und Kanäle (Polylinie, Breite in Metern). */
export const RIVERS: { name: string; pts: Vec2[]; width: number }[] = [
  { name: 'Sabal River', pts: [[656, 300], [646, 380], [628, 450], [592, 520], [560, 590], [540, 630]], width: 18 },
  { name: 'Bay Channel', pts: [[512, 676], [496, 740], [480, 800], [440, 840]], width: 40 },
  { name: 'Gator Canal', pts: [[912, 1340], [896, 1420], [880, 1504], [884, 1600], [904, 1720]], width: 16 },
  { name: 'Snake Run', pts: [[752, 1568], [800, 1552], [880, 1540]], width: 14 },
  { name: 'Coralia Canal', pts: [[1300, 1340], [1340, 1352], [1400, 1356], [1450, 1352]], width: 14 },
];

/** Berge: [x, z, Radius, Höhe]. */
export const HILLS: [number, number, number, number][] = [
  [880, 224, 96, 34], [784, 416, 60, 18], [912, 432, 76, 24], [1040, 448, 60, 18], [1136, 392, 44, 14],
];

// ------------------------------------------------------------------ Zonen
/** Zonen-Zentren (Voronoi); Viertel überschreiben die Zone in ihrem Polygon. */
export const ZONE_SEEDS: [number, number, number][] = [
  [1280, 832, Zone.PortCoralia], [1280, 1040, Zone.PortCoralia], [1280, 1264, Zone.PortCoralia],
  [1576, 928, Zone.PortCoralia], [1528, 1176, Zone.PortCoralia], [1328, 1400, Zone.PortCoralia], [1056, 1248, Zone.PortCoralia],
  [1184, 1728, Zone.CoralKeys], [1008, 1864, Zone.CoralKeys], [816, 1904, Zone.CoralKeys], [608, 1808, Zone.CoralKeys],
  [1024, 1552, Zone.GatorFlats], [832, 1536, Zone.GatorFlats], [672, 1280, Zone.GatorFlats],
  [896, 880, Zone.DryPine], [944, 1024, Zone.DryPine], [800, 1024, Zone.DryPine], [880, 720, Zone.DryPine],
  [560, 256, Zone.Highlands], [880, 240, Zone.Highlands], [1200, 240, Zone.Highlands], [416, 432, Zone.Highlands],
  [1472, 352, Zone.Highlands], [864, 416, Zone.Highlands],
  [656, 576, Zone.PortSabal], [704, 736, Zone.PortSabal], [528, 688, Zone.PortSabal],
  [1088, 688, Zone.CaneRidge], [1280, 688, Zone.CaneRidge],
];

// ------------------------------------------------------------------ Viertel
/**
 * Jedes Viertel hat ein eigenes Straßenraster: Drehwinkel (Grad) und Blockgröße
 * [entlang lokaler x-Achse, entlang lokaler z-Achse]. style steuert Gebäude und Höhen.
 */
export interface DistrictDef {
  name: string; zone: number; poly: Poly; angle: number; block: [number, number]; style: string;
  /** Straßentyp des Rasters (Standard: Nebenstraße); jede n-te Linie wird Hauptstraße. */
  road?: number; mainEvery?: number;
}

export const DISTRICTS: DistrictDef[] = [
  { name: 'Northgate', zone: Zone.PortCoralia, style: 'industrial', angle: 4, block: [86, 64], mainEvery: 3,
    poly: [[1160, 750], [1300, 744], [1426, 742], [1430, 878], [1250, 874], [1166, 878]] },
  { name: 'Downtown', zone: Zone.PortCoralia, style: 'downtown', angle: 9, block: [70, 62], mainEvery: 2,
    poly: [[1250, 878], [1430, 880], [1428, 1134], [1244, 1130]] },
  { name: 'Little Havana Heights', zone: Zone.PortCoralia, style: 'havana', angle: -14, block: [52, 46],
    poly: [[1092, 884], [1250, 878], [1244, 1130], [1104, 1138], [1086, 1000]] },
  { name: 'Port District', zone: Zone.PortCoralia, style: 'port', angle: -6, block: [96, 72], mainEvery: 2,
    poly: [[1176, 1140], [1244, 1134], [1428, 1138], [1430, 1330], [1300, 1336], [1200, 1300]] },
  { name: 'Port District (Hafeninsel)', zone: Zone.PortCoralia, style: 'port', angle: -4, block: [64, 52],
    poly: [[1468, 1132], [1596, 1124], [1600, 1226], [1468, 1232]] },
  { name: 'Ocean Strip', zone: Zone.PortCoralia, style: 'deco', angle: 2, block: [46, 92],
    poly: [[1514, 768], [1600, 762], [1606, 1112], [1520, 1114]] },
  { name: 'Brickell Hills', zone: Zone.PortCoralia, style: 'villa', angle: 28, block: [92, 70],
    poly: [[1236, 1350], [1420, 1340], [1396, 1420], [1310, 1470], [1236, 1430]] },
  { name: 'Port Sabal', zone: Zone.PortSabal, style: 'town', angle: -18, block: [64, 56], mainEvery: 3,
    poly: [[612, 530], [780, 536], [790, 660], [776, 780], [624, 772], [616, 660]] },
  { name: 'Cane Ridge', zone: Zone.CaneRidge, style: 'town', angle: 12, block: [70, 58], mainEvery: 3,
    poly: [[992, 606], [1160, 610], [1166, 700], [1160, 780], [1000, 776]] },
  { name: 'Raffinerie', zone: Zone.CaneRidge, style: 'industrial', angle: 0, block: [104, 62],
    poly: [[1204, 640], [1396, 636], [1400, 742], [1208, 746]] },
  { name: 'Mangrove Bend', zone: Zone.GatorFlats, style: 'stilt', angle: 6, block: [60, 54],
    poly: [[972, 1446], [1148, 1440], [1146, 1606], [978, 1604]] },
  { name: 'Sunset Village', zone: Zone.CoralKeys, style: 'keys', angle: -4, block: [56, 40],
    poly: [[526, 1754], [690, 1752], [692, 1822], [530, 1828]] },
  { name: 'Sunny Acres', zone: Zone.DryPine, style: 'trailer', angle: 22, block: [42, 26], road: RoadType.Dirt,
    poly: [[880, 984], [1000, 992], [996, 1052], [884, 1046]] },
];

// ------------------------------------------------------------------ Hauptachsen
/**
 * Hauptstraßen als wenige Kontrollpunkte (Catmull-Rom). rural = Amplitude (m) der
 * Noise-Verformung für geschwungene Landstraßen; palms = Palmen am Straßenrand.
 */
export interface RoadDef { name: string; type: number; pts: Vec2[]; palms?: boolean; rural?: number }

export const ROADS: RoadDef[] = [
  // Port Coralia
  { name: 'Ocean Drive', type: RoadType.Main, palms: true,
    pts: [[1592, 764], [1600, 860], [1598, 962], [1592, 1060], [1580, 1114]] },
  { name: 'Collins Causeway', type: RoadType.Main, palms: true,
    pts: [[1428, 848], [1476, 856], [1510, 858], [1540, 854], [1598, 860]] },
  { name: 'Venetian Causeway', type: RoadType.Main,
    pts: [[1428, 990], [1466, 962], [1490, 944], [1530, 958], [1596, 1010]] },
  { name: 'Bayshore Boulevard', type: RoadType.Main, palms: true,
    pts: [[1424, 744], [1428, 860], [1426, 1000], [1428, 1140], [1420, 1330]] },
  { name: 'Harbor Bridge', type: RoadType.Main, pts: [[1428, 1176], [1470, 1178], [1530, 1180]] },
  { name: 'Route 41', type: RoadType.Highway,
    pts: [[1426, 1060], [1300, 1078], [1180, 1092], [1060, 1088], [960, 1074], [880, 1062], [800, 1010], [736, 910], [706, 776]] },
  { name: 'Coastline Highway', type: RoadType.Highway, palms: true,
    pts: [[1424, 744], [1416, 620], [1408, 480], [1398, 360], [1372, 262], [1330, 206]] },
  { name: 'Spit Road', type: RoadType.Side, palms: true, pts: [[1592, 764], [1540, 640], [1508, 480], [1476, 356], [1404, 330]] },
  { name: 'Causeway Road', type: RoadType.Main, rural: 10,
    pts: [[1210, 1300], [1186, 1380], [1146, 1436], [1100, 1470]] },
  { name: 'Airport Road', type: RoadType.Main, pts: [[1150, 1092], [1110, 1150], [1060, 1196]] },
  { name: 'Villa Drive', type: RoadType.Side, pts: [[1420, 1330], [1386, 1376], [1320, 1420]] },
  // Inland
  { name: 'Highway 9', type: RoadType.Highway, rural: 18,
    pts: [[880, 1062], [852, 1160], [832, 1280], [880, 1400], [960, 1466], [1000, 1500]] },
  { name: 'Seven Spans Bridge', type: RoadType.Highway,
    pts: [[1120, 1596], [1176, 1650], [1186, 1712], [1112, 1790], [1024, 1852], [928, 1892], [832, 1900], [752, 1866], [676, 1806]] },
  { name: 'Sabal–Cane Road', type: RoadType.Main, rural: 22, pts: [[780, 620], [880, 604], [994, 640]] },
  { name: 'Cane Ridge Road', type: RoadType.Main, rural: 8, pts: [[1162, 770], [1210, 790], [1262, 812]] },
  { name: 'Refinery Road', type: RoadType.Main, pts: [[1164, 690], [1206, 690], [1300, 694], [1398, 690], [1414, 620]] },
  { name: 'Pinecrest Parkway', type: RoadType.Side, rural: 14,
    pts: [[692, 534], [688, 440], [706, 370], [800, 342], [960, 346], [1074, 372], [1092, 470], [1076, 608]] },
  { name: 'Northwest Road', type: RoadType.Side, rural: 16, pts: [[688, 440], [580, 430], [500, 440], [470, 480]] },
  { name: 'Northeast Road', type: RoadType.Dirt, rural: 10, pts: [[1330, 206], [1290, 190], [1240, 210]] },
  { name: 'Pine Hollow Road', type: RoadType.Side, rural: 20,
    pts: [[760, 960], [770, 880], [850, 850], [940, 870], [1000, 930], [1010, 1000]] },
  { name: 'Okee Trail', type: RoadType.Dirt, rural: 24, pts: [[880, 604], [900, 720], [880, 850]] },
  { name: 'Swamp Track', type: RoadType.Dirt, rural: 16, pts: [[960, 1466], [900, 1520], [820, 1500], [760, 1440]] },
  { name: 'Sunset Airfield Road', type: RoadType.Side, pts: [[600, 1826], [610, 1846]] },
  { name: 'Sabal Airfield Road', type: RoadType.Side, rural: 6, pts: [[700, 776], [660, 840], [610, 876]] },
];

/** Stege (Pier) – über Wasser als Holzdeck, in Gator Flats als Boardwalk. */
export const PIERS: { name: string; pts: Vec2[] }[] = [
  { name: 'Bayside Pier', pts: [[1426, 920], [1470, 912], [1490, 900]] },
  { name: 'Coralia Pier', pts: [[1428, 1100], [1480, 1104]] },
  { name: 'Hafenkai Nord', pts: [[1546, 1226], [1548, 1262]] },
  { name: 'Hafenkai Süd', pts: [[1504, 1228], [1502, 1262]] },
  { name: 'Blue Hook Marina', pts: [[1220, 1714], [1256, 1716]] },
  { name: 'Sabal Docks', pts: [[616, 650], [590, 660]] },
  { name: 'Airboat-Anleger', pts: [[1000, 1500], [960, 1530], [930, 1560]] },
  { name: 'Mangrove Boardwalk', pts: [[1060, 1604], [1050, 1640], [1010, 1660]] },
  { name: 'Sunset Pier', pts: [[700, 1790], [740, 1784]] },
];

/** Kreisverkehre: Kreuzung nahe dieser Punkte (Radius in Metern). */
export const ROUNDABOUTS: [number, number, number][] = [
  [880, 1062, 18], // Route 41 / Highway 9
  [1598, 962, 14], // Ocean Drive / Venetian Causeway
  [1076, 690, 14], // Ortsmitte Cane Ridge
  [700, 650, 14], // Ortsmitte Port Sabal
];

/** Landebahnen: Mitte, Länge, Breite, Richtung (Grad, 90 = Ost-West). */
export const RUNWAYS: [number, number, number, number, number][] = [
  [1020, 1168, 260, 20, 92], [1020, 1316, 260, 20, 88], // Port Coralia International
  [596, 884, 136, 14, 96], // Flugfeld Port Sabal
  [606, 1852, 130, 14, 90], // Flugfeld Sunset Key
];
/** Vorfeld des Flughafens (Platz) und Terminal. */
export const AIRPORT_APRON: Poly = [[940, 1196], [1110, 1196], [1110, 1290], [940, 1290]];

/** Besondere Orte. */
export const POI = {
  spawnDistrict: 'Downtown',
  questStart: [1530, 1214] as Vec2, // Kai auf der Hafeninsel
  questDest: [940, 1020] as Vec2, // Trailerpark Sunny Acres
  gasStations: [[836, 1104], [1160, 812], [720, 560]] as Vec2[],
  airboats: [[948, 1548], [936, 1566], [924, 1540]] as Vec2[],
};
