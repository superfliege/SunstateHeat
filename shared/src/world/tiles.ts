// Kacheltypen der Weltkarte. Bewusst als Zahlen-Objekt (kein const enum),
// damit es mit Vite/esbuild (isolatedModules) sauber funktioniert.
export const Tile = {
  WATER: 0, // tiefes Wasser (Meer, Kanäle)
  SAND: 1,
  GRASS: 2,
  ROAD: 3,
  SIDEWALK: 4,
  BUILDING: 5, // massiv
  SWAMP: 6, // flaches Sumpfwasser: watbar, Airboat-Gebiet
  DOCK: 7, // Holzsteg / Pier
  BRIDGE: 8, // Straße über Wasser (Boote fahren darunter durch)
  FARM: 9, // Orangenplantage
  DIRT: 10, // Feldweg / Trailerpark
  PLAZA: 11, // Platz, Hafenkai, Tankstelle, Flughafen-Vorfeld
  ROCK: 12, // Gebirge: massiv, wird im Client gestuft erhöht
  FIELD: 13, // Zuckerrohrfeld
  DESERT: 14, // Wüste (trockener Sandboden)
  BADLANDS: 15, // Ödland (rissige rote Erde)
  GRAVEL: 16, // Schotter: Bergpfade, Steinbruch, Hofplätze (wenig Grip, staubt)
  SCREE: 17, // Geröllfeld am Berg (sehr wenig Grip, Fahrzeuge rutschen ab)
  CLIFF: 18, // Felswand/Abbruch: befahrbar, aber fast ohne Halt
  RESERVOIR: 19, // Stausee (Wasser über dem Meeresspiegel, eigene Oberfläche) – Ufer wie eine Wand
  CROP: 20, // Gemüse-/Melonenfeld in Reihen (weicher Boden)
  PASTURE: 21, // Weide (eingezäunt, sattes Gras)
  VOID: 255, // außerhalb der Karte
} as const;

/** Laufgeschwindigkeits-Faktor zu Fuß (0 = nicht begehbar). */
export function footSurface(t: number): number {
  switch (t) {
    case Tile.WATER: case Tile.BUILDING: case Tile.ROCK: case Tile.VOID: case Tile.RESERVOIR:
      return 0;
    case Tile.CLIFF:
      return 0.45;
    case Tile.SCREE: case Tile.CROP:
      return 0.8;
    case Tile.SWAMP:
      return 0.5;
    case Tile.SAND:
      return 0.85;
    default:
      return 1;
  }
}

/** Höhe der Wasseroberfläche (für Boote und das Wasser-Mesh). */
export const WATER_LEVEL = -0.3;
