// Datenmodell der Welt. Wird von mapgen.ts deterministisch aus den Vektordaten in
// palmara.ts erzeugt und von Server (Kollision, NPCs) und Client (Rendering, Minimap,
// Debug-Overlay) gleichermaßen genutzt. Kollision und Chunks stammen aus denselben Daten.
import { CELL, CHUNK, GRID_SIZE, HEIGHT_STEP, WORLD_SIZE, ZONE_RES } from '../constants';
import type { Poly, Vec2 } from './geometry';
import { pointInPolygon } from './geometry';
import { Tile } from './tiles';
import type { Ramp } from './features';

export const BuildingStyle = {
  Tower: 0,
  Deco: 1, // Art-déco an der Strandpromenade (mit Neon)
  Midrise: 2,
  Warehouse: 3,
  House: 4,
  Trailer: 5,
  Shop: 6,
  Container: 7,
  Barn: 8,
  Stilt: 9, // Stelzenhütte in Gator Flats
} as const;

export interface BuildingDef {
  x: number; z: number; // Mittelpunkt in Metern
  w: number; d: number; h: number; // w entlang der Front, d in die Tiefe
  /** Blickrichtung der Front: vorwärts = (sin rot, cos rot), zeigt zur nächsten Straße. */
  rot: number;
  color: number;
  style: number;
}

export const TreeType = { Palm: 0, Pine: 1, Orange: 2, Mangrove: 3, Cypress: 4 } as const;

export interface TreeDef { x: number; z: number; type: number; s: number; rot: number }

export interface VehicleSpawn { kind: number; x: number; z: number; a: number; color: number; variant?: number }

// ------------------------------------------------------------------ Straßengraph
export const RoadType = { Highway: 0, Main: 1, Side: 2, Dirt: 3, Pier: 4 } as const;
export const ROAD_TYPE_NAMES = ['Highway', 'Hauptstraße', 'Nebenstraße', 'Schotterweg', 'Steg'];

export interface RoadNode {
  id: number;
  x: number; z: number;
  edges: number[];
  /** Radius des Kreisverkehrs (0 = normale Kreuzung). */
  roundabout: number;
}

export interface RoadEdge {
  id: number;
  a: number; b: number; // Knoten-IDs
  type: number;
  lanes: number; // Fahrspuren gesamt (beide Richtungen)
  laneWidth: number;
  width: number; // Fahrbahnbreite gesamt
  sidewalk: number; // Gehwegbreite je Seite (0 = keiner)
  /** Abgetastete Mittelkurve (Catmull-Rom) von a nach b. */
  pts: Vec2[];
  cum: number[]; // kumulierte Bogenlänge je Punkt
  len: number;
  /** Abstand ab Knoten a/b, ab dem die Fahrbahn beginnt (davor liegt die Kreuzungsfläche). */
  trimA: number; trimB: number;
  /** Palmen am Rand (Küstenstraßen). */
  palms: boolean;
  name: string;
}

// ------------------------------------------------------------------ Viertel, Blöcke, Grundstücke
export interface District {
  id: number;
  name: string;
  zone: number;
  poly: Poly;
  /** Drehwinkel des Straßenrasters (Radiant) und Blockgröße (entlang/quer). */
  angle: number;
  block: [number, number];
  style: string;
}

export const LotUse = { Building: 0, Park: 1, Parking: 2, Gas: 3, Vacant: 4 } as const;
export const LOT_USE_NAMES = ['Gebäude', 'Park', 'Parkplatz', 'Tankstelle', 'Brache'];

/** open = eine Straße (z. B. Stichstraße) führt hinein; dann gibt es keine geschlossene Blockfläche. */
export interface Block { id: number; district: number; poly: Poly; open: boolean }
export interface Lot { id: number; block: number; district: number; poly: Poly; use: number; building: number }

export const Zone = {
  PortCoralia: 0, CoralKeys: 1, GatorFlats: 2, DryPine: 3, Highlands: 4, PortSabal: 5, CaneRidge: 6,
} as const;
export const ZONE_NAMES = [
  'Port Coralia', 'Coral Keys', 'Gator Flats', 'Dry Pine Country', 'Pinecrest Highlands', 'Port Sabal', 'Cane Ridge',
];

/** Landebahn als gedrehtes Rechteck. */
export interface Runway { x: number; z: number; len: number; wid: number; rot: number }

/** Pro Chunk (CHUNK x CHUNK m): Indizes der Inhalte. */
export interface ChunkContent { edges: number[]; nodes: number[]; buildings: number[]; lots: number[] }

const HGRID = WORLD_SIZE / HEIGHT_STEP + 1;
const CHUNKS = WORLD_SIZE / CHUNK;

export class WorldMap {
  readonly size = GRID_SIZE;
  /** Untergrund je Zelle (CELL m) – Grundlage für Kollision und Fahrverhalten. */
  tiles: Uint8Array;
  /** Natürlicher Boden ohne Straßen und Gebäude (für Bodenfarben). */
  ground: Uint8Array;
  /** Geländehöhe an den Gitterpunkten (HEIGHT_STEP m). */
  heights = new Float32Array(HGRID * HGRID);
  /** Zone je ZONE_RES-m-Zelle. */
  zones = new Uint8Array((WORLD_SIZE / ZONE_RES) ** 2);
  districts: District[] = [];
  nodes: RoadNode[] = [];
  edges: RoadEdge[] = [];
  blocks: Block[] = [];
  lots: Lot[] = [];
  buildings: BuildingDef[] = [];
  trees: TreeDef[] = [];
  runways: Runway[] = [];
  docks: Poly[] = [];
  vehicleSpawns: VehicleSpawn[] = [];
  /** Rampen/Sprungschanzen (features.ts). */
  ramps: Ramp[] = [];
  /** Nasse Flächen [x0, z0, x1, z1] (Grip x 0,85). */
  wet: [number, number, number, number][] = [];
  /** Nagelbänder [x0, z0, x1, z1]: zerstechen Reifen (Testgelände; später Polizei-Sperren). */
  spikes: [number, number, number, number][] = [];
  /** Baumfreie Rechtecke [x0, z0, x1, z1] (Testgelände, Rampen). */
  clearAreas: [number, number, number, number][] = [];
  /** Werkstätten (Reparatur): Mittelpunkt + Radius. */
  workshops: { x: number; z: number; r: number }[] = [];
  chunks: ChunkContent[] = [];
  spawn = { x: 0, z: 0 };
  questStart = { x: 0, z: 0 };
  questDest = { x: 0, z: 0 };

  constructor() {
    this.tiles = new Uint8Array(GRID_SIZE * GRID_SIZE).fill(Tile.WATER);
    this.ground = new Uint8Array(GRID_SIZE * GRID_SIZE).fill(Tile.WATER);
  }

  /** Untergrund an Zellkoordinate (außerhalb = VOID). */
  tile(cx: number, cz: number): number {
    if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) return Tile.VOID;
    return this.tiles[cz * GRID_SIZE + cx];
  }

  /** Untergrund an Weltposition in Metern. */
  tileAt(x: number, z: number): number {
    return this.tile(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  groundAt(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) return Tile.WATER;
    return this.ground[cz * GRID_SIZE + cx];
  }

  /** Welche Zone liegt an dieser Weltposition? (außerhalb = nächster Rand) */
  zoneAt(x: number, z: number): number {
    const n = WORLD_SIZE / ZONE_RES;
    const cx = Math.min(n - 1, Math.max(0, Math.floor(x / ZONE_RES)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor(z / ZONE_RES)));
    return this.zones[cz * n + cx];
  }

  /** Viertel an dieser Position (oder null). */
  districtAt(x: number, z: number): District | null {
    for (const d of this.districts) if (pointInPolygon(x, z, d.poly)) return d;
    return null;
  }

  /** Geländehöhe (bilinear interpoliert). */
  terrainHeight(x: number, z: number): number {
    const fx = Math.max(0, Math.min(HGRID - 1.001, x / HEIGHT_STEP));
    const fz = Math.max(0, Math.min(HGRID - 1.001, z / HEIGHT_STEP));
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const h = this.heights, i = iz * HGRID + ix;
    const a = h[i] + (h[i + 1] - h[i]) * tx, b = h[i + HGRID] + (h[i + HGRID + 1] - h[i + HGRID]) * tx;
    return a + (b - a) * tz;
  }

  /** Höhe, auf der Figuren und Landfahrzeuge stehen (Brücken, Stege, Sumpf beachtet). */
  surfaceY(x: number, z: number): number {
    switch (this.tileAt(x, z)) {
      case Tile.BRIDGE: return BRIDGE_DECK;
      case Tile.DOCK: return 0.4;
      case Tile.SWAMP: return -0.45; // man watet im Wasser
      case Tile.WATER: return 0;
      case Tile.SIDEWALK: case Tile.PLAZA: return Math.max(0.05, this.terrainHeight(x, z)) + CURB_TOP; // Bordsteinhöhe
      default: return Math.max(0, this.terrainHeight(x, z));
    }
  }

  /** Chunk-Inhalt an einer Position. */
  chunkAt(x: number, z: number): ChunkContent | undefined {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) return undefined;
    return this.chunks[cz * CHUNKS + cx];
  }
}

/** Höhe der Brückenfahrbahn über dem Meeresspiegel. */
export const BRIDGE_DECK = 0.6;
/** Oberkante von Gehweg und Blockflächen über dem Gelände (Fahrbahn + Bordstein). */
export const CURB_TOP = 0.18;
