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
import { FARMS, farmFences } from './farms';
import { OKEE_PLACES, RESERVOIR } from './okeePeak';

/**
 * Höfe und Berg als Smart-Object-Sammlungen: Futtertröge, Melkstand, Heuballen, Zaunstellen,
 * Feldreihen, Veranda, Werkbank, Gitarrenstuhl, Eierstand; am Berg Fernrohre, Lagerfeuer,
 * Angelplätze am Stausee. Viertelname = Gebiet der Population Table ('Okee Höfe' / 'Okee Peak').
 */
function ruralObjects(map: WorldMap, add: (kind: SmartKindId, x: number, z: number, rot: number, district: string, species?: string) => void) {
  const H = 'Okee Höfe', P = 'Okee Peak';
  // Weideplätze für Tiere (je Tierart): in Weiden/Ausläufen, Hofhunde und Hühner auf dem Hofplatz
  const ARCH: Record<string, string> = { cow: 'cow', dairy_cow: 'dairy_cow', horse: 'horse', chicken: 'chicken', goat: 'goat', dog: 'farm_dog', turkey: 'turkey' };
  for (const f of FARMS) for (const a of f.animals) {
    const sp = ARCH[a.kind];
    if (!sp) continue;
    const fl = a.field >= 0 ? f.fields[a.field] : null;
    const n = Math.max(1, Math.ceil(a.count / 6));
    for (let k = 0; k < n; k++) {
      const u = fl ? (k + 0.5) / n - 0.5 : 0;
      const x = fl ? fl.x + u * fl.hw * 1.4 : f.x + 4 + k * 3, z = fl ? fl.z : f.z + 5;
      add(SmartKind.Graze, x, z, k * 1.3, H, sp);
    }
  }
  // Wild am Berg: Hirsche und Wildtruthähne auf Lichtungen am Bergfuß
  for (const [x, z, sp] of [[780, 430, 'deer'], [860, 400, 'deer'], [990, 380, 'deer'], [700, 400, 'turkey'], [930, 420, 'turkey'], [620, 380, 'deer'], [1040, 420, 'turkey']] as [number, number, string][]) {
    add(SmartKind.Graze, x, z, 0, P, sp);
  }
  for (const f of FARMS) {
    for (const p of f.props) {
      const k: Partial<Record<string, SmartKindId>> = {
        trough: SmartKind.FeedTrough, feed_trough: SmartKind.FeedTrough, hay_round: SmartKind.HayStack, hay_square: SmartKind.HayStack,
        porch_swing: SmartKind.Porch, tool_bench: SmartKind.ToolBench, guitar_chair: SmartKind.GuitarChair, egg_stand: SmartKind.EggStand,
        farm_stand: SmartKind.EggStand, milk_cans: SmartKind.MilkStall,
      };
      const kind = k[p.k];
      if (kind !== undefined) add(kind, p.x, p.z, p.rot, H);
    }
    const milk = f.buildings.find((b) => b.k === 'milking' || b.k === 'stable');
    if (milk) add(SmartKind.MilkStall, milk.x, milk.z + milk.d / 2 + 1.5, milk.rot, H);
    // Feldarbeit: je Feld zwei Reihen-Plätze
    for (const fl of f.fields) {
      if (fl.k === 'arena' || fl.k === 'corral') continue;
      for (const t of [-0.4, 0.3]) add(SmartKind.FieldRow, fl.x + fl.hw * t, fl.z + fl.hd * 0.2, fl.rot, H);
    }
  }
  // Zaunstellen (Reparieren, Plaudern über den Zaun) – jede dritte Zaunseite
  farmFences().forEach((s, i) => {
    if (i % 3) return;
    const x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
    add(SmartKind.FenceSpot, x, z, Math.atan2(-(s.bz - s.az), s.bx - s.ax) + Math.PI / 2, H);
  });
  for (const [x, z, rot] of OKEE_PLACES.telescopes) add(SmartKind.Telescope, x, z, rot, P);
  const C = OKEE_PLACES.campground;
  for (const [lx, lz] of [[-16, 10], [-4, 14], [8, 10], [-20, -4], [14, -6], [0, 0]]) add(SmartKind.Campfire, C.x + lx + 3, C.z + lz + 1, 0, P);
  for (const [x, z, a] of RESERVOIR.fishSpots) add(SmartKind.FishSpot, x, z, a, P);
  add(SmartKind.CafeTable, OKEE_PLACES.cafe.x - 3, OKEE_PLACES.cafe.z + 6, OKEE_PLACES.cafe.rot, P);
  add(SmartKind.CafeTable, OKEE_PLACES.cafe.x + 3, OKEE_PLACES.cafe.z + 6, OKEE_PLACES.cafe.rot, P);
  add(SmartKind.Bench, OKEE_PLACES.summit.x - 6, OKEE_PLACES.summit.z + 4, Math.PI, P);
  void map;
}

/** species: nur diese Tierart (Archetyp-ID) nutzt das Objekt (Weideplätze). */
export interface SmartObject { id: number; kind: SmartKindId; x: number; z: number; rot: number; district: string; species?: string }

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
    // Türen: freie Hauswände in Abständen, durch die NPCs die Welt verlassen (Absichtskette, Schritt „exit“)
    const doors = wallCands.filter((c) => c.district === dName);
    for (const c of doors) {
      if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < (o.kind === SmartKind.Door ? 22 : 3.5))) continue;
      out.push({ id: out.length, kind: SmartKind.Door, x: c.x, z: c.z, rot: c.rot, district: dName });
    }
    // Props, die zugleich Smart Objects sind: Liegen (Strand), Mülltonnen, Zeitungsautomaten
    for (const p of generateProps(map)) {
      if (p.type !== PropType.Lounger && p.type !== PropType.Trash && p.type !== PropType.Newsbox) continue;
      if (!pointInPolygon(p.x, p.z, d.poly) && !nearEdge(map, d.poly, p.x, p.z)) continue;
      const kind = p.type === PropType.Lounger ? SmartKind.Lounger : p.type === PropType.Trash ? SmartKind.Trash : SmartKind.Newsbox;
      out.push({ id: out.length, kind, x: p.x, z: p.z, rot: p.rot, district: dName });
    }
  }
  ruralObjects(map, (kind, x, z, rot, d, species) => { if (add(kind, x, z, rot, d, 1.5) && species) out[out.length - 1].species = species; });
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
