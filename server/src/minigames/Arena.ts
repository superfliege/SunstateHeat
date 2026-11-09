// Laufzeit-Arena: aus den Daten in shared/minigames/arenas.json erzeugt.
// Kennt Boden, Startplätze, Todeszonen und liefert den Bots eine Gefahrenkarte (hazard).
import { carInWater, type CarState } from '../../../shared/src/sim/car';
import type { ArenaDef } from '../../../shared/src/minigames';
import { floorEdgeDistance, floorSolid, newFloor, FloorCell, type ArenaFloor } from '../../../shared/src/world/arenaFloor';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

export interface Spot { x: number; z: number; a: number }

export class Arena {
  readonly cx: number;
  readonly cz: number;
  floor: ArenaFloor | null = null;

  constructor(readonly def: ArenaDef, private map: WorldMap) {
    [this.cx, this.cz] = def.center;
  }

  /** Boden in die Welt einsetzen (Server-Karte; Clients bekommen ihn über den Snapshot). */
  open() {
    const f = this.def.floor;
    if (!f) return;
    this.floor = newFloor(this.def.id, this.cx, this.cz, f.y, f.shape, { r: f.r, cell: f.cell, cols: f.cols, rows: f.rows });
    this.map.floors = [...this.map.floors.filter((o) => o.id !== this.def.id), this.floor];
  }

  close() {
    this.map.floors = this.map.floors.filter((o) => o.id !== this.def.id);
    this.floor = null;
  }

  /** Grundradius des Bodens (für Startplätze). */
  get radius(): number {
    const f = this.floor;
    if (!f) return this.def.bounds * 0.6;
    return f.shape === 'disc' ? f.r : (Math.min(f.cols, f.rows) * f.cell) / 2;
  }

  /** n Startplätze laut Daten. */
  spawns(n: number): Spot[] {
    const s = this.def.spawns;
    if (s.type === 'list') return s.points.slice(0, n).map(([x, z, a]) => ({ x: this.cx + x, z: this.cz + z, a }));
    const r = this.radius * s.radius;
    const out: Spot[] = [];
    const off = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const x = this.cx + Math.sin(a) * r, z = this.cz + Math.cos(a) * r;
      out.push({ x, z, a: Math.atan2(this.cx - x, this.cz - z) });
    }
    return out;
  }

  get spectate() { return { x: this.def.spectate[0], z: this.def.spectate[1] }; }

  /** Todeszonen prüfen: Grund des Ausscheidens oder '' (noch im Spiel). */
  deathReason(c: CarState): string {
    for (const d of this.def.death) {
      if (d.type === 'below' && this.floor && c.y < this.floor.y - d.margin) return 'ist von der Plattform gestürzt';
      // erst wenn das Auto wirklich unten ist (über dem Rand hängend zählt noch nicht)
      if (d.type === 'water' && carInWater(this.map, c) && c.y < 1) return 'liegt im Wasser';
      if (d.type === 'outside' && Math.hypot(c.x - this.cx, c.z - this.cz) > this.def.bounds) return 'hat die Arena verlassen';
    }
    return '';
  }

  /** Abstand zum Bodenrand (positiv = drauf); ohne Boden: Abstand zur Grenze. */
  edgeDistance(x: number, z: number): number {
    if (this.floor) return floorEdgeDistance(this.floor, x, z);
    return this.def.bounds - Math.hypot(x - this.cx, z - this.cz);
  }

  /**
   * Gefahr an (x, z) für Bots: 0 sicher … 1 tödlich. Kachel mit Vorwarnung = 0,7,
   * Randnähe steigt in den letzten `soft` Metern sanft an.
   */
  hazard(x: number, z: number, soft = 3): number {
    const f = this.floor;
    if (f) {
      if (!floorSolid(f, x, z)) return 1;
      if (f.shape === 'grid') {
        const col = Math.floor((x - f.cx + (f.cols * f.cell) / 2) / f.cell), row = Math.floor((z - f.cz + (f.rows * f.cell) / 2) / f.cell);
        if (f.cells[row * f.cols + col] === FloorCell.WARN) return 0.7;
      }
      const e = f.shape === 'disc' ? f.r - Math.hypot(x - f.cx, z - f.cz) : soft;
      return e < soft ? 0.5 * (1 - e / soft) : 0;
    }
    const e = this.def.bounds - Math.hypot(x - this.cx, z - this.cz);
    return e <= 0 ? 1 : e < soft ? 0.5 * (1 - e / soft) : 0;
  }

  zone(id: string) {
    const z = this.def.zones?.find((q) => q.id === id);
    return z ? { x: this.cx + z.x, z: this.cz + z.z, r: z.r } : { x: this.cx, z: this.cz, r: 6 };
  }
}
