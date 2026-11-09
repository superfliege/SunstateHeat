// Exakte Gebäude-Kollision: Gebäude sind gedrehte Rechtecke (BuildingDef). Das 2-m-Kachelraster
// bildet sie nur treppenförmig ab – an schrägen Fassaden blieben Autos an Rasterkanten hängen oder
// steckten sichtbar in der Wand, Figuren rutschten ruckelnd entlang. Hier werden die Rechtecke
// selbst als Kollisionskörper (OBB) in einem räumlichen Raster abgelegt.
//
// Kacheln, die vollständig von solchen Rechtecken erzeugt wurden, sind als "exakt" markiert:
// Kachel-Kollision überspringt sie, stattdessen gilt das echte Rechteck. Alles andere (Läden mit
// Innenraum, Teststrecken-Mauern, Fels, Wasser, Kartenrand) bleibt bei der Kachel-Kollision.
// Läuft identisch auf Client (Prediction) und Server – nur von der Karte abhängig.
import { CELL, GRID_SIZE } from '../constants';
import { orientedRect, rasterizePolygon } from './geometry';
import { Tile } from './tiles';
import { BuildingStyle, type WorldMap } from './WorldMap';

/** Gedrehtes Rechteck: Mitte, halbe Ausdehnung, lokale x-Achse = (c, -s), lokale z-Achse = (s, c). */
export interface Box { x: number; z: number; hw: number; hd: number; c: number; s: number; r: number }

const BUCKET = 16; // m je Rasterfeld der Suchstruktur
const BN = Math.ceil((GRID_SIZE * CELL) / BUCKET);

interface Index { boxes: Box[]; buckets: (number[] | undefined)[]; exact: Uint8Array; mark: Uint32Array }
const cache = new WeakMap<WorldMap, Index>();

function build(map: WorldMap): Index {
  const boxes: Box[] = [];
  const buckets: (number[] | undefined)[] = new Array(BN * BN);
  const exact = new Uint8Array(GRID_SIZE * GRID_SIZE);
  const cells: number[] = [];
  for (const b of map.buildings) {
    if (b.style === BuildingStyle.Store) continue; // Läden: begehbar, eigene Wände (furniture)
    cells.length = 0;
    let solid = 0;
    rasterizePolygon(orientedRect(b.x, b.z, b.w / 2, b.d / 2, b.rot), CELL, GRID_SIZE, (x, z) => {
      const i = z * GRID_SIZE + x;
      cells.push(i);
      if (map.tiles[i] === Tile.BUILDING && !map.storeTiles.has(i)) solid++;
    });
    // Gebäude, das später (Tankstellen-Umbau) aus dem Raster genommen wurde: ignorieren
    if (!cells.length || solid < cells.length * 0.8) continue;
    const box: Box = { x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, c: Math.cos(b.rot), s: Math.sin(b.rot), r: Math.hypot(b.w, b.d) / 2 };
    const id = boxes.push(box) - 1;
    for (const i of cells) if (map.tiles[i] === Tile.BUILDING && !map.storeTiles.has(i)) exact[i] = 1;
    const x0 = Math.max(0, Math.floor((b.x - box.r) / BUCKET)), x1 = Math.min(BN - 1, Math.floor((b.x + box.r) / BUCKET));
    const z0 = Math.max(0, Math.floor((b.z - box.r) / BUCKET)), z1 = Math.min(BN - 1, Math.floor((b.z + box.r) / BUCKET));
    for (let bz = z0; bz <= z1; bz++) for (let bx = x0; bx <= x1; bx++) (buckets[bz * BN + bx] ??= []).push(id);
  }
  return { boxes, buckets, exact, mark: new Uint32Array(boxes.length) };
}

function index(map: WorldMap): Index {
  let ix = cache.get(map);
  if (!ix) cache.set(map, (ix = build(map)));
  return ix;
}

/** Index (neu) aufbauen – nach dem Erzeugen/Ändern der Karte, damit es nicht im ersten Spiel-Tick passiert. */
export function prepareCollision(map: WorldMap) { cache.set(map, build(map)); }

/** Wird die Kachel (Zellkoordinaten) exakt über ein Gebäude-Rechteck abgebildet? */
export function exactCell(map: WorldMap, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= GRID_SIZE || cz >= GRID_SIZE) return false;
  return index(map).exact[cz * GRID_SIZE + cx] === 1;
}

let stamp = 0;
/**
 * Gebäude-Rechtecke, die einen Kreis (x, z, r) berühren könnten (Breitphase). out wird geleert.
 * Ohne Duplikate (ein Rechteck kann in mehreren Rasterfeldern liegen).
 */
export function boxesNear(map: WorldMap, x: number, z: number, r: number, out: Box[]): Box[] {
  out.length = 0;
  const ix = index(map);
  if (!ix.boxes.length) return out;
  stamp = (stamp + 1) >>> 0 || 1;
  const x0 = Math.max(0, Math.floor((x - r) / BUCKET)), x1 = Math.min(BN - 1, Math.floor((x + r) / BUCKET));
  const z0 = Math.max(0, Math.floor((z - r) / BUCKET)), z1 = Math.min(BN - 1, Math.floor((z + r) / BUCKET));
  for (let bz = z0; bz <= z1; bz++) {
    for (let bx = x0; bx <= x1; bx++) {
      const list = ix.buckets[bz * BN + bx];
      if (!list) continue;
      for (const id of list) {
        if (ix.mark[id] === stamp) continue;
        ix.mark[id] = stamp;
        const b = ix.boxes[id];
        const dx = b.x - x, dz = b.z - z, rr = b.r + r;
        if (dx * dx + dz * dz <= rr * rr) out.push(b);
      }
    }
  }
  return out;
}

/**
 * Kreis gegen Rechteck. Rückgabe in out: [nx, nz, Tiefe] mit der Normale vom Rechteck zum Kreis,
 * oder false ohne Überschneidung.
 */
export function circleBox(b: Box, x: number, z: number, r: number, out: number[]): boolean {
  const dx = x - b.x, dz = z - b.z;
  const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
  const qx = Math.max(-b.hw, Math.min(b.hw, lx)), qz = Math.max(-b.hd, Math.min(b.hd, lz));
  let ex = lx - qx, ez = lz - qz;
  const d2 = ex * ex + ez * ez;
  let depth: number;
  if (d2 > 1e-12) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    ex /= d; ez /= d; depth = r - d;
  } else {
    // Mittelpunkt im Rechteck: über die nächste Seite hinaus
    const px = b.hw - Math.abs(lx), pz = b.hd - Math.abs(lz);
    if (px < pz) { ex = lx < 0 ? -1 : 1; ez = 0; depth = px + r; } else { ex = 0; ez = lz < 0 ? -1 : 1; depth = pz + r; }
  }
  // lokal -> Welt: x-Achse (c, -s), z-Achse (s, c)
  out[0] = ex * b.c + ez * b.s;
  out[1] = -ex * b.s + ez * b.c;
  out[2] = depth;
  return true;
}

const nearTmp: Box[] = [];
const hitTmp = [0, 0, 0];
/** Überschneidet ein Kreis ein Gebäude-Rechteck? */
export function circleHitsBuildings(map: WorldMap, x: number, z: number, r: number): boolean {
  for (const b of boxesNear(map, x, z, r, nearTmp)) if (circleBox(b, x, z, r, hitTmp)) return true;
  return false;
}

/**
 * Kreis aus allen Gebäude-Rechtecken herausschieben (wenige Iterationen, für Ecken).
 * Schreibt die korrigierte Position nach p; Rückgabe = ob es eine Korrektur gab.
 */
export function pushOutOfBuildings(map: WorldMap, p: { x: number; z: number }, r: number): boolean {
  let moved = false;
  for (let it = 0; it < 3; it++) {
    let any = false;
    for (const b of boxesNear(map, p.x, p.z, r, nearTmp)) {
      if (!circleBox(b, p.x, p.z, r, hitTmp)) continue;
      p.x += hitTmp[0] * (hitTmp[2] + 1e-3); p.z += hitTmp[1] * (hitTmp[2] + 1e-3);
      any = moved = true;
    }
    if (!any) break;
  }
  return moved;
}
