// Datenmodell der Welt. Wird von mapgen.ts deterministisch aus den Vektordaten in
// palmara.ts erzeugt und von Server (Kollision, NPCs) und Client (Rendering, Minimap,
// Debug-Overlay) gleichermaßen genutzt. Kollision und Chunks stammen aus denselben Daten.
import { CELL, CHUNK, GRID_SIZE, HEIGHT_STEP, WORLD_SIZE, ZONE_RES } from '../constants';
import type { Poly, Vec2 } from './geometry';
import { pointInPolygon } from './geometry';
import { Tile } from './tiles';
import type { Ramp } from './features';
import type { Landmark } from './landmarks';
import type { ShopDef } from '../shops';
import { floorHeight, floorSolid, floorWall, type ArenaFloor } from './arenaFloor';

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
  Store: 10, // begehbarer Laden (Hohlgebäude mit Tür, shops.ts)
  Airport: 11, // Flughafengebäude und -zaun (Optik nach tag, AirportView)
  Farm: 12, // Hofgebäude (Scheune, Silo, Melkstall … nach tag, NorthBuilder) und Bauten am Okee Peak
  Landmark: 13, // Krankenhaus, Polizeirevier, Story-Garage (tag = LandmarkId, landmarks.ts)
} as const;

/** Gedrehtes Rechteck: [Mitte x, Mitte z, halbe Breite, halbe Tiefe, cos rot, sin rot]. */
export type Obb = [number, number, number, number, number, number];

export interface BuildingDef {
  x: number; z: number; // Mittelpunkt in Metern
  w: number; d: number; h: number; // w entlang der Front, d in die Tiefe
  /** Blickrichtung der Front: vorwärts = (sin rot, cos rot), zeigt zur nächsten Straße. */
  rot: number;
  color: number;
  style: number;
  /** Unterart für Sondergebäude (Flughafen: terminal, tower, hangar, hangar-wall, fire, fence). */
  tag?: string;
}

export const TreeType = { Palm: 0, Pine: 1, Orange: 2, Mangrove: 3, Cypress: 4, Oak: 5 } as const;

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
  /** Haupteingang des Flughafens: Lücke im Zaun mit Schranke (Mitte, Drehung, Breite). */
  airportGate: { x: number; z: number; rot: number; w: number } | null = null;
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
  /**
   * Wände und Einrichtung begehbarer Läden (frei gedreht, siehe shops.ts) als Hindernisse zu Fuß:
   * Kachelindex -> gedrehte Rechtecke [Mitte x, Mitte z, halbe Breite, halbe Tiefe, cos, sin].
   */
  furniture = new Map<number, Obb[]>();
  /**
   * Kacheln unter einem Laden, die für Fahrzeuge massiv (BUILDING) sind, zu Fuß aber nicht zählen:
   * dort gelten nur die exakten Wand-Rechtecke aus `furniture` (die Kacheln sind achsparallel,
   * der Laden steht parallel zur Straße).
   */
  storeTiles = new Set<number>();
  /** Werkstätten (Reparatur): Mittelpunkt + Radius. */
  workshops: { x: number; z: number; r: number }[] = [];
  /** Läden (Sunmart, Ammo & Ammo, Paint & Pray) mit Tür-Position; Gebäude liegen in `buildings` (shops.ts). */
  shops: ShopDef[] = [];
  chunks: ChunkContent[] = [];
  /**
   * Dynamische Arena-Böden der Minispiele (arenaFloor.ts). Leer, solange kein Minispiel läuft.
   * Auf einem tragenden Boden gilt Straßenbelag in Bodenhöhe – auch über Wasser.
   */
  floors: ArenaFloor[] = [];
  /**
   * Auffahrten zu den Brücken (#44): Zellindex -> Fahrbahnhöhe in der Zellmitte. Enthält alle Brückenzellen
   * und die Straßen-/Gehwegzellen davor, die zur Deckhöhe ansteigen (buildBridgeRamps). Zwischen den
   * Zellmitten wird bilinear interpoliert – Physik und Darstellung sehen dieselbe glatte Rampe.
   */
  bridgeRamp = new Map<number, number>();
  /** Krankenhaus, Polizeirevier, Story-Garage (landmarks.ts) */
  landmarks: Landmark[] = [];
  spawn = { x: 0, z: 0 };
  questStart = { x: 0, z: 0 };
  questDest = { x: 0, z: 0 };

  constructor() {
    this.tiles = new Uint8Array(GRID_SIZE * GRID_SIZE).fill(Tile.WATER);
    this.ground = new Uint8Array(GRID_SIZE * GRID_SIZE).fill(Tile.WATER);
  }

  /** Untergrund an Zellkoordinate (außerhalb = VOID). */
  tile(cx: number, cz: number): number {
    // Bande einer Minispiel-Arena (Zellmitte) – für Fahrzeuge und Fußgänger massiv
    if (this.floors.length) {
      const x = cx * CELL + CELL / 2, z = cz * CELL + CELL / 2;
      for (const f of this.floors) if (floorWall(f, x, z) && !floorSolid(f, x, z)) return Tile.BUILDING;
    }
    if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) return Tile.VOID;
    return this.tiles[cz * GRID_SIZE + cx];
  }

  /** Steht (x, z) auf einem tragenden Arena-Boden? */
  onFloor(x: number, z: number): boolean {
    for (const f of this.floors) if (floorSolid(f, x, z)) return true;
    return false;
  }

  /** Untergrund an Weltposition in Metern. */
  tileAt(x: number, z: number): number {
    if (this.floors.length && this.onFloor(x, z)) return Tile.ROAD;
    return this.tile(Math.floor(x / CELL), Math.floor(z / CELL));
  }

  /** Hindernis eintragen: gedrehtes Rechteck (Mitte, halbe Breite/Tiefe, Drehung wie Gebäude). */
  addFurniture(x: number, z: number, hw: number, hd: number, rot: number) {
    const o: Obb = [x, z, hw, hd, Math.cos(rot), Math.sin(rot)];
    // in alle Kacheln eintragen, die das Rechteck plus Figurenradius (< 1 m) berühren können
    const r = Math.hypot(hw, hd) + 1;
    for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) continue;
        const i = cz * GRID_SIZE + cx;
        const list = this.furniture.get(i);
        if (list) list.push(o); else this.furniture.set(i, [o]);
      }
    }
  }

  /** Überschneidet ein Kreis (x, z, Radius rad) ein Hindernis aus `furniture`? */
  furnitureHit(x: number, z: number, rad: number): boolean {
    if (!this.furniture.size) return false;
    const list = this.furniture.get(this.tileIndex(x, z));
    if (!list) return false;
    for (const [ox, oz, hw, hd, c, s] of list) {
      // in lokale Koordinaten (Breite entlang (cos, -sin), Tiefe entlang (sin, cos))
      const dx = x - ox, dz = z - oz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ex = Math.abs(lx) - hw, ez = Math.abs(lz) - hd;
      const qx = Math.max(ex, 0), qz = Math.max(ez, 0);
      if (qx * qx + qz * qz < rad * rad) return true;
    }
    return false;
  }

  /** Kachelindex einer Weltposition (-1 außerhalb). */
  tileIndex(x: number, z: number): number {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) return -1;
    return cz * GRID_SIZE + cx;
  }

  /** Liegt die Position auf einer Ladenkachel (zu Fuß begehbar, siehe storeTiles)? */
  storeTileAt(x: number, z: number): boolean {
    return this.storeTiles.size > 0 && this.storeTiles.has(this.tileIndex(x, z));
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
    if (this.floors.length) { const h = floorHeight(this.floors, x, z); if (h !== null) return h; }
    if (this.bridgeRamp.size) { const r = this.rampY(x, z); if (r !== null) return r; }
    return this.plainSurfaceY(x, z);
  }

  /**
   * Fahrbahnhöhe auf einer Brücke oder deren Auffahrt (null = keine Rampe hier). Gehwegzellen werden nur
   * mit Gehwegzellen interpoliert, Fahrbahn nur mit Fahrbahn – der Bordstein bleibt eine Kante.
   */
  rampY(x: number, z: number): number | null {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const own = this.bridgeRamp.get(cz * GRID_SIZE + cx);
    if (own === undefined) return null;
    const ownSw = this.tile(cx, cz) === Tile.SIDEWALK;
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5;
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const at = (gx: number, gz: number) => {
      const v = this.bridgeRamp.get(gz * GRID_SIZE + gx);
      return v === undefined || (this.tile(gx, gz) === Tile.SIDEWALK) !== ownSw ? own : v;
    };
    const a = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * tx;
    const b = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * tx;
    return a + (b - a) * tz;
  }

  /** Auffahrten zu den Brücken berechnen (nach dem Rastern): Steigung BRIDGE_RAMP_SLOPE entlang des Straßennetzes. */
  buildBridgeRamps() {
    this.bridgeRamp.clear();
    const N = GRID_SIZE;
    const dist = new Map<number, number>();
    const queue: number[] = [];
    const maxGap = 40; // m
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] !== Tile.BRIDGE) continue;
      this.bridgeRamp.set(i, BRIDGE_DECK);
      dist.set(i, 0);
      queue.push(i);
    }
    // Kurze Landstücke zwischen zwei Brückenteilen derselben Straße (Sandbank, Inselchen) auf Deckhöhe
    // halten – sonst gäbe es mitten auf der Brücke eine Senke
    for (const e of this.edges) {
      const hw = e.width / 2 + e.sidewalk;
      const pts: [number, number, boolean][] = [];
      for (let k = 0; k < e.pts.length - 1; k++) {
        const [ax, az] = e.pts[k], [bx, bz] = e.pts[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        for (let t = 0; t < L; t += 1) { const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L; pts.push([x, z, this.tileAt(x, z) === Tile.BRIDGE]); }
      }
      let lastB = -1;
      for (let i = 0; i < pts.length; i++) {
        if (!pts[i][2]) continue;
        if (lastB >= 0 && i - lastB > 1 && i - lastB <= maxGap) {
          for (let k = lastB + 1; k < i; k++) {
            const [x, z] = pts[k];
            const nx = -(pts[i][1] - pts[lastB][1]), nz = pts[i][0] - pts[lastB][0], nl = Math.hypot(nx, nz) || 1;
            for (let o = -hw; o <= hw; o += 1) {
              const cx = Math.floor((x + nx / nl * o) / CELL), cz = Math.floor((z + nz / nl * o) / CELL);
              if (cx < 0 || cz < 0 || cx >= N || cz >= N) continue;
              const j = cz * N + cx, tt = this.tiles[j];
              if ((tt !== Tile.ROAD && tt !== Tile.SIDEWALK) || dist.has(j)) continue;
              this.bridgeRamp.set(j, BRIDGE_DECK + (tt === Tile.SIDEWALK ? CURB_TOP : 0));
              dist.set(j, 0);
              queue.push(j);
            }
          }
        }
        lastB = i;
      }
    }
    const maxD = BRIDGE_DECK / BRIDGE_RAMP_SLOPE;
    const NB: [number, number, number][] = [[1, 0, CELL], [-1, 0, CELL], [0, 1, CELL], [0, -1, CELL], [1, 1, CELL * Math.SQRT2], [1, -1, CELL * Math.SQRT2], [-1, 1, CELL * Math.SQRT2], [-1, -1, CELL * Math.SQRT2]];
    // Kürzeste Wege über Fahrbahn-/Gehwegzellen (kleiner Radius: einfache Relaxation genügt)
    while (queue.length) {
      const i = queue.pop()!;
      const d0 = dist.get(i)!;
      const cx = i % N, cz = (i / N) | 0;
      for (const [dx, dz, w] of NB) {
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx, t = this.tiles[j];
        if (t !== Tile.ROAD && t !== Tile.SIDEWALK && t !== Tile.DIRT && t !== Tile.DOCK && t !== Tile.PLAZA) continue;
        const d = d0 + w;
        if (d >= maxD || d >= (dist.get(j) ?? Infinity)) continue;
        dist.set(j, d);
        queue.push(j);
      }
    }
    for (const [i, d] of dist) {
      if (d === 0) continue;
      const cx = i % N, cz = (i / N) | 0;
      const x = cx * CELL + CELL / 2, z = cz * CELL + CELL / 2;
      const base = this.plainSurfaceY(x, z);
      const y = BRIDGE_DECK - d * BRIDGE_RAMP_SLOPE + (this.tiles[i] === Tile.SIDEWALK ? CURB_TOP : 0);
      if (y > base + 0.005) this.bridgeRamp.set(i, y);
    }
  }

  private plainSurfaceY(x: number, z: number): number {
    if (this.storeTileAt(x, z)) return Math.max(0.05, this.terrainHeight(x, z)) + CURB_TOP; // Ladenboden
    switch (this.tileAt(x, z)) {
      case Tile.BRIDGE: return BRIDGE_DECK;
      case Tile.DOCK: return 0.4;
      case Tile.SWAMP: return -0.45; // man watet im Wasser
      case Tile.WATER: return -0.55; // Schwimmer ragen etwa bis zur Brust heraus
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
/** Steigung der Brückenauffahrten (0,06 = 6 % → 10 m Anlauf). */
export const BRIDGE_RAMP_SLOPE = 0.06;
/** Oberkante von Gehweg und Blockflächen über dem Gelände (Fahrbahn + Bordstein). */
export const CURB_TOP = 0.18;
