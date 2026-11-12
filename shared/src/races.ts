// Straßenrennen: dreizehn feste, beliebig oft wiederholbare Rennen. Die Strecken werden
// deterministisch aus dem Straßengraph abgeleitet (Client und Server erhalten dieselben
// Punkte): ein Zufallsweg ohne Wiederholungen, der möglichst geradeaus weiterfährt.
// Am Ende hängt eine Auslaufstrecke, auf der KI-Fahrer nach dem Ziel ausrollen.
import { mulberry32 } from './math';
import { findFootSpot } from './sim/movement';
import type { Vec2 } from './world/geometry';
import { drivablePath } from './world/roads';
import { RoadType, type RoadEdge, type WorldMap } from './world/WorldMap';

export interface RaceDef {
  id: string;
  name: string;
  /** Viertel, in dessen Mitte der Start gesucht wird. */
  district: string;
  intro: string;
  /** Runden (Rundkurs); 1 = Sprint. Findet sich kein Rundkurs, wird ein Sprint daraus. */
  laps: number;
  /** Gesamtlänge Start → Ziel in Metern (ungefähr). */
  length: number;
  /** Erlaubte Straßentypen. */
  roads: number[];
  /** Grundtempo der KI (Anteil am Kurvengrenztempo). */
  skill: number;
  /** Preisgeld und XP je Platz (1.–5.). */
  prize: number[];
  xp: number[];
  seed: number;
}

/** Gesamtzahl Starter (Spieler + KI) und maximale Spielerzahl. */
export const RACE_FIELD = 5;
export const RACE_MAX_PLAYERS = 4;
export const CHECKPOINT_RADIUS = 11;

export const RACES: RaceDef[] = [
  {
    id: 'race_downtown', name: 'Downtown Dash', district: 'Downtown',
    intro: 'Rundkurs durch Downtown, 2 Runden. Enge Straßen, harte Kurven, null Regeln – du fährst, was dir zugelost wird.',
    laps: 2, length: 1800, roads: [RoadType.Main, RoadType.Side], skill: 0.9,
    prize: [1200, 700, 400, 200, 100], xp: [220, 160, 120, 80, 50], seed: 11,
  },
  {
    id: 'race_brickell', name: 'Brickell Hills Loop', district: 'Brickell Hills',
    intro: 'Zwei Runden durch die Villenhügel von Brickell. Lange Geraden, schnelle Kurven. Fahrzeug wird ausgelost.',
    laps: 2, length: 2000, roads: [RoadType.Highway, RoadType.Main, RoadType.Side], skill: 0.95,
    prize: [1600, 950, 550, 280, 120], xp: [280, 200, 150, 100, 60], seed: 23,
  },
  {
    id: 'race_cane', name: 'Cane Ridge Rally', district: 'Cane Ridge',
    intro: 'Sprint über Landstraße und Schotter rund um Cane Ridge. Wer hier bremst, verliert.',
    laps: 1, length: 1600, roads: [RoadType.Highway, RoadType.Main, RoadType.Side, RoadType.Dirt], skill: 1,
    prize: [2000, 1200, 700, 350, 150], xp: [340, 250, 180, 120, 70], seed: 37,
  },
  {
    id: 'race_northgate', name: 'Northgate Freight Run', district: 'Northgate',
    intro: 'Sprint durch das Industriegebiet von Northgate. Breite Lagerstraßen, wenig Platz zum Überholen.',
    laps: 1, length: 1500, roads: [RoadType.Main, RoadType.Side], skill: 0.9,
    prize: [1300, 780, 450, 220, 100], xp: [230, 170, 125, 85, 50], seed: 41,
  },
  {
    id: 'race_havana', name: 'Havana Heights Circuit', district: 'Little Havana Heights',
    intro: 'Zwei Runden durch die engen Gassen von Little Havana Heights. Kurz, schmutzig, laut.',
    laps: 2, length: 1500, roads: [RoadType.Main, RoadType.Side], skill: 0.92,
    prize: [1400, 840, 480, 240, 110], xp: [250, 180, 135, 90, 55], seed: 53,
  },
  {
    id: 'race_portdist', name: 'Port District Sprint', district: 'Port District',
    intro: 'Sprint durch das Hafenviertel, über Hauptstraßen und Nebenstrecken zwischen Containern und Kais.',
    laps: 1, length: 1700, roads: [RoadType.Highway, RoadType.Main, RoadType.Side], skill: 0.97,
    prize: [1700, 1000, 580, 290, 130], xp: [290, 210, 155, 105, 60], seed: 67,
  },
  {
    id: 'race_strip', name: 'Ocean Strip Cruise', district: 'Ocean Strip',
    intro: 'Zwei Runden an der Strandpromenade des Ocean Strip. Schnelle Geraden, Palmen links und rechts.',
    laps: 2, length: 1800, roads: [RoadType.Main, RoadType.Side], skill: 0.95,
    prize: [1800, 1080, 620, 310, 140], xp: [300, 220, 160, 110, 65], seed: 79,
  },
  {
    id: 'race_refinery', name: 'Raffinerie Rush', district: 'Raffinerie',
    intro: 'Langer Sprint rund um die Raffinerie, auch über Schotter. Staub, Hitze, keine Gnade.',
    laps: 1, length: 1900, roads: [RoadType.Highway, RoadType.Main, RoadType.Side, RoadType.Dirt], skill: 1,
    prize: [2200, 1320, 760, 380, 160], xp: [360, 260, 190, 125, 75], seed: 97,
  },
  {
    id: 'race_sabal', name: 'Port Sabal Dash', district: 'Port Sabal',
    intro: 'Kurzer Sprint durch Port Sabal an der Bucht. Enge Kurven zwischen Fischerhütten und Kai.',
    laps: 1, length: 900, roads: [RoadType.Highway, RoadType.Main, RoadType.Side], skill: 0.93,
    prize: [1100, 660, 380, 190, 90], xp: [200, 150, 110, 75, 45], seed: 5,
  },
  {
    id: 'race_slag', name: 'Raffinerie Backroads', district: 'Raffinerie',
    intro: 'Sprint über die Nebenwege der Raffinerie, zwischen Tanks und Rohrleitungen, auch über Schotter.',
    laps: 1, length: 1000, roads: [RoadType.Highway, RoadType.Main, RoadType.Side, RoadType.Dirt], skill: 0.97,
    prize: [1500, 900, 520, 260, 120], xp: [260, 190, 140, 95, 55], seed: 29,
  },
  {
    id: 'race_midtown', name: 'Midtown Sprint', district: 'Downtown',
    intro: 'Kurzer Sprint quer durch Downtown, ohne Runden – nur Gas und Nerven.',
    laps: 1, length: 1200, roads: [RoadType.Main, RoadType.Side], skill: 0.98,
    prize: [1650, 990, 570, 285, 130], xp: [275, 200, 148, 100, 58], seed: 201,
  },
  {
    id: 'race_havana2', name: 'Havana Backstreets', district: 'Little Havana Heights',
    intro: 'Sprint durch die Hinterhöfe von Little Havana Heights. Gassen, Kurven, Straßenmusik.',
    laps: 1, length: 1000, roads: [RoadType.Main, RoadType.Side], skill: 0.94,
    prize: [1350, 810, 470, 235, 110], xp: [240, 175, 130, 88, 52], seed: 201,
  },
  {
    id: 'race_strip2', name: 'Ocean Strip Sprint', district: 'Ocean Strip',
    intro: 'Sprint über die Promenade vom anderen Ende des Ocean Strip – kurz, schnell, Palmen im Augenwinkel.',
    laps: 1, length: 900, roads: [RoadType.Highway, RoadType.Main, RoadType.Side, RoadType.Dirt], skill: 0.96,
    prize: [1450, 870, 500, 250, 115], xp: [255, 185, 138, 92, 55], seed: 5,
  },
];
export const RACE_BY_ID = new Map(RACES.map((r) => [r.id, r]));

export interface RacePose { x: number; z: number; a: number }
export interface RaceTrack {
  def: RaceDef;
  /** Ideallinie (Straßenmitte) im 4-m-Raster und kumulierte Bogenlänge. */
  path: Vec2[];
  cum: number[];
  /** Bogenlänge der Ziellinie; danach folgt die Auslaufstrecke. */
  finish: number;
  laps: number;
  lapLen: number;
  /** Bogenlängen der Checkpoints (letzter = Ziel). */
  checkpoints: number[];
  /** Startaufstellung, vorderste Reihe zuerst. */
  grid: RacePose[];
  /** Renntelefon (Startpunkt) am Straßenrand. */
  phone: { x: number; z: number };
}

const START_LINE = 30;
const RUNOFF = 140;
const CP_SPACING = 55;

/** Punkt + Fahrtrichtung bei Bogenlänge s. */
export function trackPose(t: { path: Vec2[]; cum: number[] }, s: number): RacePose {
  const { path, cum } = t;
  const n = path.length;
  if (s <= 0) { const a = Math.atan2(path[1][0] - path[0][0], path[1][1] - path[0][1]); return { x: path[0][0], z: path[0][1], a }; }
  let i = 1;
  // binäre Suche
  let lo = 1, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < s) lo = m + 1; else hi = m; }
  i = Math.min(lo, n - 1);
  const p = path[i - 1], q = path[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const k = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  return { x: p[0] + (q[0] - p[0]) * k, z: p[1] + (q[1] - p[1]) * k, a: Math.atan2(q[0] - p[0], q[1] - p[1]) };
}

function resample(pts: Vec2[], step: number): { path: Vec2[]; cum: number[] } {
  const path: Vec2[] = [pts[0]];
  const cum = [0];
  let carry = 0, total = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d < 1e-6) continue;
    let t = step - carry;
    while (t <= d) {
      path.push([a[0] + (b[0] - a[0]) * (t / d), a[1] + (b[1] - a[1]) * (t / d)]);
      total += step; cum.push(total);
      t += step;
    }
    carry = d - (t - step);
  }
  return { path, cum };
}

interface Leg { e: RoadEdge; fwd: boolean }
interface Walk { legs: Leg[]; len: number; loop: boolean }

const usable = (e: RoadEdge) => e.len - e.trimA - e.trimB;
function dirOf(e: RoadEdge, fwd: boolean, end: boolean): Vec2 {
  const p = drivablePath(e, fwd);
  const m = p.length - 1;
  const [a, b] = end ? [p[Math.max(0, m - 3)], p[m]] : [p[0], p[Math.min(3, m)]];
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

/**
 * Tiefensuche mit Backtracking nach einem Weg ohne doppelte Knoten/Kanten.
 * loop = true: Rundkurs, der zum Startknoten zurückkehrt (Länge in [minL, maxL]).
 * loop = false: Sprint mit mindestens minL Metern.
 */
function search(map: WorldMap, start: number, def: RaceDef, rnd: () => number, loop: boolean, minL: number, maxL: number): Walk | null {
  const ok = (e: RoadEdge) => def.roads.includes(e.type) && usable(e) > 10;
  const seen = new Set<number>([start]);
  const legs: Leg[] = [];
  let budget = 6000;
  const rec = (node: number, len: number, dir: Vec2 | null): Walk | null => {
    if (--budget < 0) return null;
    if (!loop && len >= minL) return { legs: [...legs], len, loop };
    const cands: { e: RoadEdge; fwd: boolean; other: number; score: number }[] = [];
    for (const id of map.nodes[node].edges) {
      const e = map.edges[id];
      if (!ok(e)) continue;
      const fwd = e.a === node;
      const other = fwd ? e.b : e.a;
      if (legs.some((l) => l.e === e)) continue;
      const closing = loop && other === start && legs.length >= 3;
      if (seen.has(other) && !closing) continue;
      if (!legs.length && usable(e) < START_LINE + 8) continue; // Platz für die Startaufstellung
      const d0 = dirOf(e, fwd, false);
      const dot = dir ? d0[0] * dir[0] + d0[1] * dir[1] : 1;
      if (dot < -0.3 && !map.nodes[node].roundabout) continue; // keine Spitzkehren (im Kreisverkehr egal)
      cands.push({ e, fwd, other, score: dot * 0.6 + rnd() * 1.0 + (e.type <= RoadType.Main ? 0.2 : 0) });
    }
    cands.sort((a, b) => b.score - a.score);
    for (const c of cands) {
      const nl = len + usable(c.e);
      if (nl > maxL) continue;
      legs.push({ e: c.e, fwd: c.fwd });
      if (c.other === start) {
        // Rundkurs geschlossen: Länge passt und Übergang in die erste Kante ist keine Spitzkehre
        const din = dirOf(c.e, c.fwd, true), dst = dirOf(legs[0].e, legs[0].fwd, false);
        if (nl >= minL && din[0] * dst[0] + din[1] * dst[1] > -0.2) return { legs: [...legs], len: nl, loop };
        legs.pop();
        continue;
      }
      seen.add(c.other);
      const r = rec(c.other, nl, dirOf(c.e, c.fwd, true));
      if (r) return r;
      seen.delete(c.other);
      legs.pop();
    }
    return null;
  };
  return rec(start, 0, null);
}

function buildTrack(map: WorldMap, def: RaceDef): RaceTrack | null {
  const d = map.districts.find((q) => q.name === def.district);
  let cx = map.spawn.x, cz = map.spawn.z;
  if (d) { cx = 0; cz = 0; for (const p of d.poly) { cx += p[0]; cz += p[1]; } cx /= d.poly.length; cz /= d.poly.length; }
  const starts = map.nodes
    .filter((n) => !n.roundabout && n.edges.some((id) => def.roads.includes(map.edges[id].type)))
    .sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz))
    .filter((n, i) => i < 3 || Math.hypot(n.x - cx, n.z - cz) < 260)
    .slice(0, 10);
  const rnd = mulberry32(def.seed);
  let w: Walk | null = null;
  const lap = def.length / Math.max(1, def.laps);
  if (def.laps > 1) {
    for (const s of starts) { for (let t = 0; t < 6 && !w; t++) w = search(map, s.id, def, rnd, true, lap * 0.7, lap * 1.4); if (w) break; }
  }
  if (!w) for (const s of starts) { for (let t = 0; t < 6 && !w; t++) w = search(map, s.id, def, rnd, false, def.length + START_LINE + RUNOFF, Infinity); if (w) break; }
  if (!w) return null;

  const laps = w.loop ? def.laps : 1;
  const raw: Vec2[] = [];
  // Rundkurs: Runden + eine weitere Runde als Auslauf aneinanderhängen
  for (let k = 0; k < (w.loop ? laps + 1 : 1); k++) {
    for (const leg of w.legs) {
      const p = drivablePath(leg.e, leg.fwd);
      // Kreisverkehr am Übergang: außen herum statt quer über die Mittelinsel
      const node = map.nodes[leg.fwd ? leg.e.a : leg.e.b];
      if (node.roundabout && raw.length) raw.push(...roundaboutArc(node, raw[raw.length - 1], p[0]));
      raw.push(...p);
    }
  }
  const { path, cum } = resample(raw, 4);
  const total = cum[cum.length - 1];
  const lapLen = w.loop ? total / (laps + 1) : total;
  const finish = w.loop ? START_LINE + lapLen * laps : Math.min(total - RUNOFF * 0.6, START_LINE + def.length);
  const n = Math.max(3, Math.round((finish - START_LINE) / CP_SPACING));
  const checkpoints: number[] = [];
  for (let k = 1; k <= n; k++) checkpoints.push(START_LINE + ((finish - START_LINE) * k) / n);

  const first = w.legs[0].e;
  const side = Math.max(1.6, Math.min(2.4, first.width / 2 - 1.4));
  const t = { path, cum };
  // rechts = (-cos a, sin a) bei Blickrichtung (sin a, cos a); lat > 0 = rechts
  const slot = (s: number, lat: number): RacePose => {
    const p = trackPose(t, s);
    return { x: p.x - Math.cos(p.a) * lat, z: p.z + Math.sin(p.a) * lat, a: p.a };
  };
  const grid = [slot(24, side), slot(24, -side), slot(16, side), slot(16, -side), slot(8, 0)];
  const ph = trackPose(t, 14);
  const off = first.width / 2 + Math.max(1.5, first.sidewalk * 0.6);
  const want = { x: ph.x - Math.cos(ph.a) * off, z: ph.z + Math.sin(ph.a) * off };
  const spot = findFootSpot(map, want.x, want.z, 14) ?? want;
  return { def, path, cum, finish, laps, lapLen, checkpoints, grid, phone: { x: Math.round(spot.x * 10) / 10, z: Math.round(spot.z * 10) / 10 } };
}

/** Bogen durch den Kreisverkehr (gleicher Drehsinn wie die Verkehrs-KI: abnehmender Winkel in x/z). */
function roundaboutArc(n: { x: number; z: number; roundabout: number }, from: Vec2, to: Vec2): Vec2[] {
  const r = n.roundabout * 0.72;
  const a0 = Math.atan2(from[1] - n.z, from[0] - n.x);
  let a1 = Math.atan2(to[1] - n.z, to[0] - n.x);
  while (a1 > a0 - 0.3) a1 -= Math.PI * 2;
  const out: Vec2[] = [];
  for (let a = a0 - 0.25; a > a1 + 0.15; a -= 0.3) out.push([n.x + Math.cos(a) * r, n.z + Math.sin(a) * r]);
  return out;
}

const cache = new WeakMap<WorldMap, RaceTrack[]>();

/** Alle Rennstrecken der Karte (gecacht). */
export function raceTracks(map: WorldMap): RaceTrack[] {
  let t = cache.get(map);
  if (!t) {
    t = RACES.map((d) => buildTrack(map, d)).filter((x): x is RaceTrack => !!x);
    cache.set(map, t);
  }
  return t;
}
