// Smart Objects in der Welt: Bänke, Haltestellen, Imbiss, Geldautomaten, Club-Eingänge, Café-Tische …
// Platziert werden sie deterministisch aus den Kartendaten (Gehwege je Viertel, Strand, Props) –
// Client und Server erzeugen dieselbe Liste. Handplatzierte Objekte stehen in SMART_OBJECT_OVERRIDES.
// Phase 1: nur Ocean Strip (siehe POP_TABLES); andere Viertel folgen mit ihren Population Tables.
import { MAP_SEED } from '../constants';
import { mulberry32 } from '../math';
import { SMART_KINDS, SmartKind, slotWorld, type SmartKindId } from '../npc/scenarios';
import { generateProps, PropType } from './features';
import { pointAt, pointInPolygon } from './geometry';
import { Tile } from './tiles';
import type { WorldMap } from './WorldMap';

export interface SmartObject { id: number; kind: SmartKindId; x: number; z: number; rot: number; district: string }

/** Handplatzierte Objekte (überschreiben nichts, ergänzen nur). Beispiel: { kind: SmartKind.Grill, x: 1200, z: 900, rot: 0, district: 'Trailerpark' } */
export const SMART_OBJECT_OVERRIDES: Omit<SmartObject, 'id'>[] = [];

/** Viertel, in denen Objekte generiert werden. */
const DISTRICTS = ['Ocean Strip'];

const cache = new WeakMap<WorldMap, SmartObject[]>();

export function generateSmartObjects(map: WorldMap): SmartObject[] {
  const hit = cache.get(map);
  if (hit) return hit;
  const out: SmartObject[] = [];
  const rnd = mulberry32(MAP_SEED + 777);
  const add = (kind: SmartKindId, x: number, z: number, rot: number, district: string, minGap = 5) => {
    for (const o of out) if (Math.abs(o.x - x) < minGap && Math.abs(o.z - z) < minGap && Math.hypot(o.x - x, o.z - z) < minGap) return false;
    out.push({ id: out.length, kind, x, z, rot, district });
    return true;
  };
  const free = (t: number) => t === Tile.SAND || t === Tile.GRASS;
  const stand = (t: number) => t === Tile.SIDEWALK || t === Tile.PLAZA || t === Tile.GRASS;
  let clubs = 0, fishers = 0, hoops = 0;
  const wallCands: { x: number; z: number; rot: number; district: string }[] = [];

  for (const dName of DISTRICTS) {
    const d = map.districts.find((x) => x.name === dName);
    if (!d) continue;
    for (const e of map.edges) {
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      if (e.sidewalk <= 0 || !pointInPolygon(mid[0], mid[1], d.poly)) continue;
      const hw = e.width / 2;
      let lastStop = -999;
      for (let s = e.trimA + 6; s < e.len - e.trimB - 6; s += 14) {
        const p = pointAt(e.pts, e.cum, s);
        for (const side of [-1, 1]) {
          // Querrichtung weg von der Fahrbahn auf Seite `side`: n = side * (-dz, dx)
          const nx = -p.dz * side, nz = p.dx * side;
          const offOuter = hw + e.sidewalk - 0.55;
          const x = p.x + nx * offOuter, z = p.z + nz * offOuter;
          if (!stand(map.tileAt(x, z))) continue;
          // Hauswand: erstes Gebäude-Tile hinter dem Gehweg (Vorgarten/Plaza dazwischen)
          let wallK = -1;
          for (let k = 1; k < 16; k += 0.5) {
            const t = map.tileAt(x + nx * k, z + nz * k);
            if (t === Tile.BUILDING) { wallK = k; break; }
            if (!stand(t) && t !== Tile.GRASS) break;
          }
          const wall = wallK > 0;
          const wx = x + nx * (wallK - 0.9), wz = z + nz * (wallK - 0.9); // Standort direkt vor der Wand
          const open = !wall && free(map.tileAt(x + nx * 2.2, z + nz * 2.2));
          const toStreet = Math.atan2(-nx, -nz); // Vorderseite zur Straße
          const toOpen = Math.atan2(nx, nz);
          const r = rnd();
          if (wall) {
            wallCands.push({ x: wx, z: wz, rot: toStreet, district: dName });
            if (r < 0.2) add(SmartKind.Wall, wx, wz, toStreet, dName, 8);
            else if (r < 0.27) add(SmartKind.Atm, wx, wz, toStreet, dName, 12);
            else if (r < 0.34) add(SmartKind.TacoStand, wx - nx * 0.2, wz - nz * 0.2, toStreet, dName, 20);
            else if (r < 0.44) {
              // Café: zwei Tische mit je zwei Stühlen nebeneinander
              const ax = -nz, az = nx;
              const a = add(SmartKind.CafeTable, wx - nx * 0.2, wz - nz * 0.2, toStreet + Math.PI / 2, dName, 3);
              if (a) add(SmartKind.CafeTable, wx - nx * 0.2 + ax * 2.8, wz - nz * 0.2 + az * 2.8, toStreet + Math.PI / 2, dName, 2);
            } else if (r < 0.48) add(SmartKind.Payphone, wx, wz, toStreet, dName, 15);
            else if (r < 0.52 && clubs < 2 && s > 20) { if (add(SmartKind.ClubDoor, wx, wz, toStreet, dName, 25)) clubs++; }
          } else if (open) {
            if (r < 0.2) add(SmartKind.Bench, x, z, toOpen, dName, 7); // Bank mit Blick aufs Meer
            else if (r < 0.28 && hoops < 1 && e.palms) {
              const hx = x + nx * 7, hz = z + nz * 7;
              if (free(map.tileAt(hx, hz)) && add(SmartKind.Hoop, hx, hz, toStreet, dName, 20)) hoops++;
            }
          } else if (e.palms && r < 0.1) add(SmartKind.Bench, x, z, toStreet, dName, 7);
          // Bushaltestellen alle ~120 m an der Straße
          if (s - lastStop > 110 && e.type <= 2 && r > 0.8 && stand(map.tileAt(p.x + nx * (hw + 1.4), p.z + nz * (hw + 1.4)))) {
            if (add(SmartKind.BusStop, p.x + nx * (hw + 1.5), p.z + nz * (hw + 1.5), toStreet, dName, 25)) lastStop = s;
          }
          // Angelplatz: am Wasser (Strand-/Uferseite)
          if (fishers < 4 && e.palms && r > 0.6 && r < 0.72 && side === 1) {
            for (let k = 2; k < 110; k += 2) {
              const fx = p.x + nx * (hw + e.sidewalk + k), fz = p.z + nz * (hw + e.sidewalk + k);
              const t = map.tileAt(fx, fz);
              if (t === Tile.WATER) {
                const bx = fx - nx * 2.2, bz = fz - nz * 2.2;
                if (map.tileAt(bx, bz) !== Tile.WATER && add(SmartKind.FishSpot, bx, bz, toOpen, dName, 60)) fishers++;
                break;
              }
              if (t === Tile.BUILDING) break;
            }
          }
        }
      }
    }
    // Mindestausstattung: Imbiss-Stände, Geldautomaten und Club-Eingänge an freien Hauswänden
    for (const [kind, want, gap] of [[SmartKind.ClubDoor, 2, 40], [SmartKind.TacoStand, 3, 40], [SmartKind.Atm, 2, 30]] as [SmartKindId, number, number][]) {
      let have = out.filter((o) => o.kind === kind).length;
      const order = wallCands.filter((c) => c.district === dName).sort(() => rnd() - 0.5);
      for (const c of order) {
        if (have >= want) break;
        if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 7)) continue;
        if (out.some((o) => o.kind === kind && Math.hypot(o.x - c.x, o.z - c.z) < gap)) continue;
        out.push({ id: out.length, kind, x: c.x, z: c.z, rot: c.rot, district: dName });
        have++;
      }
    }
    // Props, die zugleich Smart Objects sind: Liegen (Strand), Mülltonnen, Zeitungsautomaten
    for (const p of generateProps(map)) {
      if (p.type !== PropType.Lounger && p.type !== PropType.Trash && p.type !== PropType.Newsbox) continue;
      if (!pointInPolygon(p.x, p.z, d.poly) && !nearEdge(map, d.poly, p.x, p.z)) continue;
      const kind = p.type === PropType.Lounger ? SmartKind.Lounger : p.type === PropType.Trash ? SmartKind.Trash : SmartKind.Newsbox;
      out.push({ id: out.length, kind, x: p.x, z: p.z, rot: p.rot, district: dName });
    }
  }
  for (const o of SMART_OBJECT_OVERRIDES) out.push({ ...o, id: out.length });
  cache.set(map, out);
  return out;
}

/** Liegt der Punkt höchstens 40 m neben einer Straße des Polygons (Strand am Ocean Drive)? */
function nearEdge(map: WorldMap, poly: [number, number][], x: number, z: number): boolean {
  for (const e of map.edges) {
    const mid = e.pts[Math.floor(e.pts.length / 2)];
    if (!pointInPolygon(mid[0], mid[1], poly)) continue;
    for (let i = 0; i < e.pts.length; i += 4) if (Math.abs(e.pts[i][0] - x) < 40 && Math.abs(e.pts[i][1] - z) < 40) return true;
  }
  return false;
}

/** Zähler für Debug/Logs: Objekte je Art. */
export function countByKind(list: SmartObject[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const o of list) c[SMART_KINDS[o.kind].name] = (c[SMART_KINDS[o.kind].name] ?? 0) + 1;
  return c;
}
export { slotWorld };
