// Benannte Orte und Missionstelefone für Quests. Alles wird deterministisch aus der Karte
// abgeleitet (Client und Server erzeugen dieselben Punkte); Wasser-Orte per Suche.
import { mulberry32 } from './math';
import { raceTracks } from './races';
import { findFootSpot } from './sim/movement';
import { Tile } from './world/tiles';
import type { WorldMap } from './world/WorldMap';

export interface Point { x: number; z: number }
/** race = Renntelefon (Start eines Straßenrennens, siehe races.ts). */
export interface PhoneDef { id: string; name: string; x: number; z: number; race?: boolean }

const isWater = (t: number) => t === Tile.WATER || t === Tile.SWAMP;

function centroid(map: WorldMap, name: string): Point {
  const d = map.districts.find((q) => q.name === name);
  if (!d) return { x: map.spawn.x, z: map.spawn.z };
  let x = 0, z = 0;
  for (const p of d.poly) { x += p[0]; z += p[1]; }
  return { x: x / d.poly.length, z: z / d.poly.length };
}

/** Begehbarer Punkt in der Nähe. */
function foot(map: WorldMap, x: number, z: number): Point {
  return findFootSpot(map, x, z, 25) ?? { x, z };
}

/** Nächstes Wasser (Meer, Kanal, Sumpf) um (x, z) in einer Spirale. */
export function waterNear(map: WorldMap, x: number, z: number, maxR = 220): Point | null {
  for (let r = 0; r <= maxR; r += 4) {
    const steps = Math.max(1, Math.round(r / 3));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (isWater(map.tileAt(px, pz)) && freeWater(map, px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Wasserpunkt mit etwas Abstand zum Ufer (damit Boote nicht festsitzen). */
function freeWater(map: WorldMap, x: number, z: number): boolean {
  for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (!isWater(map.tileAt(x + dx, z + dz))) return false;
  return true;
}

/** Alle von (x, z) aus über Wasser erreichbaren Zellen (4-m-Raster, Radius begrenzt). */
export function waterReach(map: WorldMap, x: number, z: number, radius = 420): Point[] {
  const S = 4;
  const key = (cx: number, cz: number) => cz * 4096 + cx;
  const start = [Math.round(x / S), Math.round(z / S)];
  const seen = new Set<number>([key(start[0], start[1])]);
  const out: Point[] = [];
  const queue: number[][] = [start];
  for (let i = 0; i < queue.length; i++) {
    const [cx, cz] = queue[i];
    const px = cx * S, pz = cz * S;
    if (freeWater(map, px, pz)) out.push({ x: px, z: pz });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz, k = key(nx, nz);
      if (seen.has(k)) continue;
      seen.add(k);
      const wx = nx * S, wz = nz * S;
      if (Math.hypot(wx - x, wz - z) > radius || !isWater(map.tileAt(wx, wz))) continue;
      queue.push([nx, nz]);
    }
  }
  return out;
}

/** Rennstrecke über Wasser: n Kontrollpunkte, jeweils 45–110 m auseinander, alle vom Start erreichbar. */
export function racePoints(map: WorldMap, start: Point, n: number, seed = 7): Point[] {
  const reach = waterReach(map, start.x, start.z);
  const rnd = mulberry32(seed);
  const pts: Point[] = [];
  let last = start;
  for (let i = 0; i < n && reach.length; i++) {
    let best: Point | null = null, bestScore = -1;
    for (let t = 0; t < 40; t++) {
      const c = reach[Math.floor(rnd() * reach.length)];
      const d = Math.hypot(c.x - last.x, c.z - last.z);
      if (d < 45 || d > 110) continue;
      const far = Math.min(...pts.map((p) => Math.hypot(p.x - c.x, p.z - c.z)), 999);
      const score = far + rnd() * 20;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break;
    pts.push(best);
    last = best;
  }
  return pts;
}

/** Alle benannten Orte (Schlüssel -> Punkt). */
export function questLocations(map: WorldMap): Record<string, Point> {
  const sp = map.spawn;
  const ocean = centroid(map, 'Ocean Strip');
  const keys = centroid(map, 'Sunset Village');
  const mangrove = centroid(map, 'Mangrove Bend');
  const camp = centroid(map, 'Cane Ridge');
  const marina = waterNear(map, keys.x, keys.z) ?? keys;
  const bay = waterNear(map, keys.x + 120, keys.z - 80) ?? marina;
  const stiltDock = waterNear(map, mangrove.x, mangrove.z) ?? mangrove;
  const reach = waterReach(map, stiltDock.x, stiltDock.z, 160);
  let stiltFar = stiltDock, farD = 0;
  for (const p of reach) { const d = Math.hypot(p.x - stiltDock.x, p.z - stiltDock.z); if (d > farD && d < 130) { farD = d; stiltFar = p; } }
  const loc: Record<string, Point> = {
    busStation: foot(map, sp.x - 20, sp.z + 4),
    supermarket: foot(map, sp.x + 26, sp.z - 12),
    harbor: { x: map.questStart.x, z: map.questStart.z },
    trailerpark: { x: map.questDest.x, z: map.questDest.z },
    club: foot(map, ocean.x, ocean.z),
    clubBack: foot(map, ocean.x + 18, ocean.z + 12),
    brickell: foot(map, centroid(map, 'Brickell Hills').x, centroid(map, 'Brickell Hills').z),
    marina,
    lighthouse: foot(map, keys.x - 25, keys.z - 10),
    hiddenBay: bay,
    dustlineCamp: foot(map, camp.x, camp.z),
    stiltHouse: foot(map, mangrove.x, mangrove.z),
    stiltDock,
    plantation: foot(map, centroid(map, 'Sunny Acres').x + 40, centroid(map, 'Sunny Acres').z + 60),
    airboatStart: stiltDock,
    stiltFar,
  };
  return loc;
}

/** Missionstelefone (Payphones): Standorte nahe der jeweiligen Auftraggeber. */
export function payphones(map: WorldMap): PhoneDef[] {
  const loc = questLocations(map);
  const at = (id: string, name: string, p: Point, dx = 3, dz = 3): PhoneDef => {
    const s = foot(map, p.x + dx, p.z + dz);
    return { id, name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10 };
  };
  const dry = centroid(map, 'Sunny Acres');
  return [
    at('bus', 'Telefon am Busbahnhof', loc.busStation),
    at('neon', 'Telefon Ocean Strip', loc.club, -8, 4),
    at('marlin', 'Telefon Sunset Village', loc.lighthouse, 8, 6),
    at('mangrove', 'Telefon Mangrove Bend', loc.stiltHouse, 6, -4),
    at('dustline', 'Telefon Cane Ridge', loc.dustlineCamp, -10, 6),
    at('okeefield', 'Telefon Sunny Acres', dry, 12, -8),
    at('gator', 'Telefon Rennstrecke', loc.stiltHouse, -14, 10),
    ...raceTracks(map).map((t) => ({ id: t.def.id, name: `Straßenrennen: ${t.def.name}`, x: t.phone.x, z: t.phone.z, race: true })),
  ];
}
