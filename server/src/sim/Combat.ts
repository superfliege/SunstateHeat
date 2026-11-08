// Kampf-Geometrie (Spec 9): Treffer-Strahlen, Nahkampf-Bogen, Zielhilfe und Sichtlinie.
// Reine Funktionen ohne Zustand – WorldRoom wendet Schaden und Folgen an.
import { AIM_ASSIST_CONE_DEG } from '../../../shared/src/weapons';
import { Tile } from '../../../shared/src/world/tiles';
import type { WorldMap } from '../../../shared/src/world/WorldMap';

export interface Target<T = unknown> { x: number; z: number; r: number; ref: T }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Richtung Norden/vorwärts = (sin a, cos a) – wie überall im Spiel. */
export const dirOf = (a: number): [number, number] => [Math.sin(a), Math.cos(a)];

/** Entfernung bis zum ersten massiven Hindernis (Gebäude/Fels) entlang des Strahls, sonst `range`. */
export function wallDistance(map: WorldMap, ox: number, oz: number, a: number, range: number): number {
  const [dx, dz] = dirOf(a);
  for (let d = 1; d <= range; d += 1) {
    const t = map.tileAt(ox + dx * d, oz + dz * d);
    if (t === Tile.BUILDING || t === Tile.ROCK || t === Tile.VOID) return Math.max(0, d - 0.5);
  }
  return range;
}

/** Abstand entlang des Strahls zum Kreis, oder null bei Fehlschuss. */
export function rayCircle(ox: number, oz: number, a: number, maxDist: number, t: Target): number | null {
  const [dx, dz] = dirOf(a);
  const px = t.x - ox, pz = t.z - oz;
  const along = px * dx + pz * dz;
  if (along < 0 || along > maxDist + t.r) return null;
  const off = Math.abs(px * dz - pz * dx);
  if (off > t.r) return null;
  return Math.max(0, along - Math.sqrt(Math.max(0, t.r * t.r - off * off)));
}

/** Zielhilfe: nächstes Ziel im Kegel um die Zielrichtung (Spec 9.1: 15°). Gibt den korrigierten Winkel zurück. */
export function aimAssist<T>(ox: number, oz: number, aim: number, range: number, targets: Target<T>[]): number {
  const cone = (AIM_ASSIST_CONE_DEG * Math.PI) / 180;
  let best = aim, bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - ox, dz = t.z - oz;
    const d = Math.hypot(dx, dz);
    if (d > range || d < 0.5) continue;
    const diff = Math.abs(wrap(Math.atan2(dx, dz) - aim));
    if (diff > cone) continue;
    const score = diff * 10 + d * 0.05;
    if (score < bestScore) { bestScore = score; best = Math.atan2(dx, dz); }
  }
  return best;
}

/** Nahkampf: nächstes Ziel im Halbkreis-Bogen (±60°) in Reichweite. */
export function meleeTarget<T>(ox: number, oz: number, aim: number, range: number, targets: Target<T>[]): Target<T> | null {
  let best: Target<T> | null = null, bd = Infinity;
  for (const t of targets) {
    const dx = t.x - ox, dz = t.z - oz;
    const d = Math.hypot(dx, dz) - t.r;
    if (d > range) continue;
    if (Math.abs(wrap(Math.atan2(dx, dz) - aim)) > Math.PI / 3 && d > 0.3) continue;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Ein Strahlschuss: nächstes getroffenes Ziel vor der Wand. */
export function shootRay<T>(map: WorldMap, ox: number, oz: number, a: number, range: number, targets: Target<T>[]): { hit: Target<T> | null; dist: number } {
  const wall = wallDistance(map, ox, oz, a, range);
  let hit: Target<T> | null = null, dist = wall;
  for (const t of targets) {
    const d = rayCircle(ox, oz, a, wall, t);
    if (d !== null && d < dist) { dist = d; hit = t; }
  }
  return { hit, dist };
}
