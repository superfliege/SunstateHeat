// Dynamische Arena-Böden für Minispiele (Sumo-Plattform, Fallout-Kacheln, …).
// Ein Boden schwebt in Höhe `y` über Wasser oder Gelände. Solange ein Minispiel läuft, kennen
// Server UND Client denselben Boden (Snapshot-Feld `af`) – dadurch rechnen Fahrphysik und
// Client-Prediction identisch: Wer über den Rand fährt, fällt wirklich hinunter.
// WorldMap.tileAt/surfaceY fragen diese Böden zuerst ab (siehe WorldMap.floors).

/** Kachelzustand: 0 weg, 1 fest, 2 Vorwarnung (blinkt, trägt aber noch). */
export const FloorCell = { GONE: 0, SOLID: 1, WARN: 2 } as const;

export interface ArenaFloor {
  id: string;
  /** Mitte und Höhe der Oberfläche (Meter). */
  cx: number; cz: number; y: number;
  /** disc: runde Plattform mit Radius r. grid: cols × rows Kacheln (Kantenlänge cell), zentriert. */
  shape: 'disc' | 'grid';
  r: number;
  cell: number; cols: number; rows: number;
  /** Nur grid: Zustand je Kachel (Zeilen von -z nach +z, Spalten von -x nach +x). */
  cells: number[];
  /** Optischer Stil (Client): 0 Asphalt mit Rot-Weiß-Rand, 1 Kacheln. */
  style: number;
  /** Bande rund um den Boden (Dicke in Metern, 0 = offen). Für Fahrzeuge und Fußgänger eine Wand. */
  wall: number;
}

/** Netzformat (kompakt): Kacheln als Ziffernfolge. */
export interface FloorNet {
  id: string; cx: number; cz: number; y: number; shape: 'disc' | 'grid'; r: number;
  cell: number; cols: number; rows: number; cells: string; style: number; wall: number;
}

export function newFloor(id: string, cx: number, cz: number, y: number, shape: 'disc' | 'grid', opts: { r?: number; cell?: number; cols?: number; rows?: number; style?: number; wall?: number }): ArenaFloor {
  const cols = opts.cols ?? 0, rows = opts.rows ?? 0;
  return {
    id, cx, cz, y, shape, r: opts.r ?? 0, cell: opts.cell ?? 4, cols, rows,
    cells: new Array(cols * rows).fill(FloorCell.SOLID), style: opts.style ?? (shape === 'disc' ? 0 : 1), wall: opts.wall ?? 0,
  };
}

/** Index der Kachel an (x, z), -1 außerhalb des Rasters. */
export function floorCellIndex(f: ArenaFloor, x: number, z: number): number {
  const hx = (f.cols * f.cell) / 2, hz = (f.rows * f.cell) / 2;
  const lx = x - f.cx + hx, lz = z - f.cz + hz;
  if (lx < 0 || lz < 0 || lx >= hx * 2 || lz >= hz * 2) return -1;
  return Math.floor(lz / f.cell) * f.cols + Math.floor(lx / f.cell);
}

/** Mitte der Kachel i. */
export function floorCellCenter(f: ArenaFloor, i: number): [number, number] {
  const col = i % f.cols, row = Math.floor(i / f.cols);
  return [f.cx - (f.cols * f.cell) / 2 + (col + 0.5) * f.cell, f.cz - (f.rows * f.cell) / 2 + (row + 0.5) * f.cell];
}

/** Trägt der Boden an (x, z)? */
export function floorSolid(f: ArenaFloor, x: number, z: number): boolean {
  if (f.shape === 'disc') {
    const dx = x - f.cx, dz = z - f.cz;
    return dx * dx + dz * dz <= f.r * f.r;
  }
  const i = floorCellIndex(f, x, z);
  return i >= 0 && f.cells[i] !== FloorCell.GONE;
}

/** Liegt (x, z) in der Bande des Bodens? */
export function floorWall(f: ArenaFloor, x: number, z: number): boolean {
  if (f.wall <= 0) return false;
  if (f.shape === 'disc') {
    const d = Math.hypot(x - f.cx, z - f.cz);
    return d > f.r && d <= f.r + f.wall;
  }
  const hx = (f.cols * f.cell) / 2, hz = (f.rows * f.cell) / 2;
  const ax = Math.abs(x - f.cx), az = Math.abs(z - f.cz);
  return ax <= hx + f.wall && az <= hz + f.wall && (ax > hx || az > hz);
}

/** Abstand zum Rand (positiv = auf dem Boden). Für grid grob über die Nachbarkacheln. */
export function floorEdgeDistance(f: ArenaFloor, x: number, z: number): number {
  if (f.shape === 'disc') return f.r - Math.hypot(x - f.cx, z - f.cz);
  if (!floorSolid(f, x, z)) return -1;
  let d = f.cell * 3;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (let s = f.cell * 0.5; s < d; s += f.cell * 0.5) {
      if (!floorSolid(f, x + Math.sin(a) * s, z + Math.cos(a) * s)) { d = s; break; }
    }
  }
  return d;
}

/** Höhe des obersten tragenden Bodens an (x, z) oder null. */
export function floorHeight(floors: ArenaFloor[], x: number, z: number): number | null {
  let best: number | null = null;
  for (const f of floors) if (floorSolid(f, x, z) && (best === null || f.y > best)) best = f.y;
  return best;
}

export function packFloor(f: ArenaFloor): FloorNet {
  return {
    id: f.id, cx: f.cx, cz: f.cz, y: f.y, shape: f.shape, r: Math.round(f.r * 10) / 10,
    cell: f.cell, cols: f.cols, rows: f.rows, cells: f.cells.join(''), style: f.style, wall: f.wall,
  };
}

export function unpackFloor(n: FloorNet): ArenaFloor {
  return {
    id: n.id, cx: n.cx, cz: n.cz, y: n.y, shape: n.shape, r: n.r, cell: n.cell, cols: n.cols, rows: n.rows,
    cells: [...n.cells].map(Number), style: n.style, wall: n.wall ?? 0,
  };
}
