// Gemeinsame Konstanten für Client UND Server.
// Alles, was beide Seiten identisch kennen müssen (Karte, Physik-Takt), steht hier.

/** Kartengröße in Metern (quadratisch, 1 Einheit = 1 Meter). */
export const WORLD_SIZE = 2048;
/** Kantenlänge einer Untergrund-/Kollisionszelle in Metern. */
export const CELL = 2;
/** Anzahl Zellen je Kartenseite. */
export const GRID_SIZE = WORLD_SIZE / CELL;
/** Abstand der Gitterpunkte des Höhenfelds in Metern. */
export const HEIGHT_STEP = 4;
/** Auflösung der Zonenkarte in Metern. */
export const ZONE_RES = 8;
/** Kantenlänge eines Chunks (Index für Kollision, Rendering, Interest Management). */
export const CHUNK = 64;
/** Seed der prozeduralen Karte – Client und Server erzeugen damit dieselbe Welt. */
export const MAP_SEED = 1337;

/** Fester Simulationsschritt für Spieler-Eingaben (Client-Prediction == Server). */
export const SIM_DT = 1 / 60;
/** Server-Tick (NPCs, Quests, Snapshots) in Hz. */
export const SERVER_TICK_HZ = 20;
/** Wie weit der Client andere Entitäten "in der Vergangenheit" rendert (Interpolation). */
export const INTERP_DELAY_MS = 110;

export const MAX_PLAYERS_PER_ROOM = 16;
/** Länge eines kompletten Tag-Nacht-Zyklus. */
export const DAY_LENGTH_MS = 8 * 60 * 1000;

/**
 * Bevölkerungsdichte der Welt. Multipliziert Fußgänger, fahrenden Verkehr und die
 * geparkten Autos der Kartengenerierung (1 = Basiswert des Prototyps).
 */
export const NPC_DENSITY = 10;

/** Radius, in dem man mit E in ein Fahrzeug einsteigen kann. */
export const ENTER_RADIUS = 4.5;

export const SERVER_PORT = Number(globalThis.process?.env?.PORT ?? 2567);
export const WS_PATH = '/ws';

export const MAX_NAME_LENGTH = 16;
export const MAX_CHAT_LENGTH = 140;

/** Farbpalette für Spieler/NPC-Kleidung (Index wird übertragen, nicht die Farbe). */
export const OUTFIT_COLORS = [
  0xff4f8b, 0x2ad4c9, 0xffa23a, 0x8f6bff, 0x4fd16b, 0xffe14d, 0x3a8dff, 0xf25c3c,
  0xffffff, 0x2b2b38, 0xc98bff, 0x00b3a4,
];

/** Lackfarben für Fahrzeuge. */
export const VEHICLE_COLORS = [
  0xff3d7f, 0x18c5c9, 0xff9a2e, 0xf4f1e8, 0x23233a, 0x7a4dff, 0xe8d43a, 0x3fae5a,
  0xd83a3a, 0x5aa8ff,
];
