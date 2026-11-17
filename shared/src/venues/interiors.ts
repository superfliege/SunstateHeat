// Innenräume (begehbare Orte mit eigener Teil-Szene): Club „Pink Static“ und Casino „Palm Royale“.
// Ein Innenraum liegt im Grundriss seines Wahrzeichens (shared/world/landmarks.ts) und nutzt dessen
// Weltkoordinaten – so bleibt Interest-Management automatisch am Gebäude, und die Außenwelt-Simulation
// (Verkehr, Passanten, Polizei) läuft unverändert weiter. Die Kacheln des Gebäudes sind für die Außenwelt
// massiv; wer drinnen ist, bewegt sich stattdessen mit stepInteriorPawn gegen die Innenwände.
//
// Lokales Koordinatensystem je Gebäude: Mitte = (0, 0), +z = Front (Eingang, zur Straße),
// +x = rechts, wenn man von der Straße auf die Front schaut. Läuft auf Client (Prediction) und Server
// identisch – keine Zufälle, keine Zeit.
import { approachAngle } from '../math';
import { Btn } from '../protocol';
import { PAWN_RADIUS, SPRINT_SPEED, WALK_SPEED, type PawnState } from '../sim/movement';
import type { Landmark, LandmarkId } from '../world/landmarks';
import type { WorldMap } from '../world/WorldMap';

export type InteriorId = 'club' | 'casino';
export const INTERIOR_IDS: InteriorId[] = ['club', 'casino'];
/** Index für Netz-Tupel (0 = draußen). */
export const interiorIndex = (id: InteriorId | null | undefined) => (id ? INTERIOR_IDS.indexOf(id) + 1 : 0);
export const interiorByIndex = (i: number): InteriorId | null => (i > 0 ? INTERIOR_IDS[i - 1] ?? null : null);

/** Bereiche mit Zugangsbeschränkung (Bitmaske, vom Server je Spieler gesetzt). */
export const Gate = { VIP: 1, HIGHROLLER: 2, STAFF: 4, DJ: 8 } as const;

/** Rechteck im lokalen System [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number];

export type SpotKind =
  | 'exit' | 'backdoor' | 'tile' | 'bar' | 'dj' | 'vipdesk' | 'lounge'
  | 'cage' | 'slot' | 'bj' | 'roulette' | 'derby' | 'piano' | 'buffet' | 'ledger' | 'boutique';

/** Interaktionspunkt (E/F in Reichweite r). */
export interface Spot { id: string; kind: SpotKind; x: number; z: number; a: number; r: number; label: string; /** Index (Kachel, Automat, Tisch-Sitz …) */ n?: number; /** Automaten-/Tisch-Variante */ v?: string }

/** Erhöhte Fläche (Podest, Empore) mit Rampe: Höhe h; ramp = Rampenrechteck, steigt Richtung rampDir. */
export interface Floor { rect: Rect; h: number; ramp?: { rect: Rect; dir: 'x+' | 'x-' | 'z+' | 'z-' } }

export interface InteriorDef {
  id: InteriorId;
  name: string;
  /** Innenmaße (ohne Außenwände) – halbe Breite/Tiefe. */
  hw: number; hd: number;
  /** Raumhöhe (für die Darstellung). */
  height: number;
  /** Massive Teile (Wände, Theken, Tische, Automaten). */
  solids: Rect[];
  /** Gesperrte Bereiche: Durchgang nur mit passendem Gate-Bit. */
  gates: { rect: Rect; bit: number; label: string }[];
  floors: Floor[];
  spots: Spot[];
  /** Eintrittspunkt (lokal) und Blickrichtung nach dem Betreten. */
  entry: { x: number; z: number; a: number };
  /** Benannte Bereiche (Gerüchte, Quests, Sound-Zonen). */
  zones: { id: string; rect: Rect; muffle?: number }[];
}

// ------------------------------------------------------------------ Club „Pink Static“ (34 x 24 m)
/** Tanzfläche: 6 x 5 Kacheln à 2 m, links oben bei (TILE_X0, TILE_Z0). */
export const DANCE_COLS = 6, DANCE_ROWS = 5, TILE = 2, TILE_X0 = -6, TILE_Z0 = -6;
export const tileCenter = (n: number): [number, number] => [TILE_X0 + (n % DANCE_COLS) * TILE + TILE / 2, TILE_Z0 + Math.floor(n / DANCE_COLS) * TILE + TILE / 2];
export function tileAt(lx: number, lz: number): number {
  const c = Math.floor((lx - TILE_X0) / TILE), r = Math.floor((lz - TILE_Z0) / TILE);
  return c >= 0 && c < DANCE_COLS && r >= 0 && r < DANCE_ROWS ? r * DANCE_COLS + c : -1;
}
/** Benachbarte Kacheln (8er-Nachbarschaft) – für Dance-Battles. */
export function tilesAdjacent(a: number, b: number): boolean {
  const ac = a % DANCE_COLS, ar = Math.floor(a / DANCE_COLS), bc = b % DANCE_COLS, br = Math.floor(b / DANCE_COLS);
  return a !== b && Math.abs(ac - bc) <= 1 && Math.abs(ar - br) <= 1;
}

const CLUB: InteriorDef = (() => {
  const hw = 16.6, hd = 11.6;
  const spots: Spot[] = [
    { id: 'exit', kind: 'exit', x: 0, z: 10.8, a: Math.PI, r: 1.8, label: 'Club verlassen' },
    { id: 'backdoor', kind: 'backdoor', x: -16, z: -9.9, a: Math.PI / 2, r: 1.4, label: 'Hinterausgang zur Gasse' },
    { id: 'bar', kind: 'bar', x: -11.4, z: 0, a: -Math.PI / 2, r: 2.2, label: 'Mit Vee reden (Bar)' },
    { id: 'dj', kind: 'dj', x: 0, z: -8.2, a: Math.PI, r: 1.6, label: 'DJ-Pult' },
    { id: 'vipdesk', kind: 'vipdesk', x: 8.2, z: 0.6, a: 0, r: 1.6, label: 'VIP-Karte (5.000 $)' },
    { id: 'lounge', kind: 'lounge', x: 12.6, z: 5, a: Math.PI, r: 2, label: 'Lounge' },
  ];
  for (let n = 0; n < DANCE_COLS * DANCE_ROWS; n++) {
    const [x, z] = tileCenter(n);
    spots.push({ id: `tile${n}`, kind: 'tile', x, z, a: Math.PI, r: 0.95, label: 'Dance Floor Heat', n });
  }
  return {
    id: 'club', name: 'Pink Static', hw, hd, height: 7,
    solids: [
      [-13.1, -6, -12.3, 6], // Bartheke
      [-16.6, -8.2, -11.6, -7.8], // Wand Toilettengang
      [-3.4, -11.6, 3.4, -9.2], // DJ-Podest
      [9.0, -11.6, 9.4, -2.6], // Emporen-Brüstung links
      [11.2, -2.6, 16.6, -2.2], // Emporen-Brüstung vorn (Treppe bei x 9.4 … 11.2)
      [11.0, 3.4, 15.8, 4.2], [15.8, 3.4, 16.6, 8], // Lounge-Sofas
      [-16.6, 7.8, -4.2, 8.2], [4.2, 7.8, 16.6, 8.2], // Trennwand Foyer
      [-14.6, 9.6, -12.6, 11.6], // Garderobe
      [7.4, -0.2, 9.0, 1.2], // VIP-Kartenpult
    ],
    gates: [{ rect: [9.4, -2.9, 11.2, -1.9], bit: Gate.VIP, label: 'VIP-Bereich – nur mit Armband' }, { rect: [-3.6, -9.2, 3.6, -8.6], bit: Gate.DJ, label: 'Nur für den DJ' }],
    floors: [
      { rect: [9.4, -11.6, 16.6, -2.6], h: 1.8, ramp: { rect: [9.4, -2.6, 11.2, 0.4], dir: 'z-' } },
      { rect: [-3.4, -11.6, 3.4, -9.2], h: 0.8 },
    ],
    spots,
    entry: { x: 0, z: 9.6, a: Math.PI },
    zones: [
      { id: 'floor', rect: [-6.4, -6.4, 6.4, 4.4] },
      { id: 'bar', rect: [-16.6, -7.8, -9, 7.8] },
      { id: 'vip', rect: [9.4, -11.6, 16.6, -2.2] },
      { id: 'toilets', rect: [-16.6, -11.6, -11.6, -8.2], muffle: 0.75 },
      { id: 'foyer', rect: [-16.6, 8.2, 16.6, 11.6], muffle: 0.35 },
    ],
  };
})();

// ------------------------------------------------------------------ Casino „Palm Royale“ (50 x 36 m)
/** Automatenreihen: [z, x0, Anzahl, Blickrichtung (+1 = nach +z), Variante]. */
export const SLOT_ROWS: [number, number, number, 1 | -1, 'classic' | 'goldrush'][] = [
  [-1.4, 7.6, 12, 1, 'classic'], [-2.6, 7.6, 12, -1, 'classic'],
  [4.6, 7.6, 12, 1, 'classic'], [3.4, 7.6, 12, -1, 'goldrush'],
  [10.4, 7.6, 12, -1, 'goldrush'],
];
export const SLOT_PITCH = 1.35;
export interface SlotMachine { n: number; x: number; z: number; a: number; v: 'classic' | 'goldrush' }
export const SLOT_MACHINES: SlotMachine[] = (() => {
  const out: SlotMachine[] = [];
  for (const [z, x0, count, dir, v] of SLOT_ROWS) for (let i = 0; i < count; i++) out.push({ n: out.length, x: x0 + i * SLOT_PITCH, z, a: dir > 0 ? 0 : Math.PI, v });
  return out;
})();
/** Tische: Mitte, Typ, Plätze (lokale Sitzpositionen werden aus der Mitte abgeleitet). */
export interface TableDef { id: string; kind: 'bj' | 'roulette'; x: number; z: number; seats: number; high?: boolean; name: string }
export const CASINO_TABLES: TableDef[] = [
  { id: 'bj1', kind: 'bj', x: -10, z: 5.5, seats: 5, name: 'Blackjack „Sunset“ (10–500 $)' },
  { id: 'bj2', kind: 'bj', x: -10, z: -2, seats: 5, name: 'Blackjack „Coral“ (10–500 $)' },
  { id: 'ru1', kind: 'roulette', x: -0.5, z: 2, seats: 6, name: 'Ruleta Royale' },
  { id: 'bjhr', kind: 'bj', x: 16, z: -13, seats: 5, high: true, name: 'High-Roller-Blackjack (500–20.000 $)' },
];
/** Sitzplatz i eines Tisches (Halbkreis vor dem Croupier, Croupier steht bei -z). */
export function tableSeat(t: TableDef, i: number): { x: number; z: number; a: number } {
  const span = t.kind === 'roulette' ? 2.6 : 2.2;
  const ang = -0.95 + (1.9 * i) / Math.max(1, t.seats - 1);
  const x = t.x + Math.sin(ang) * span, z = t.z + Math.cos(ang) * span * 0.8 + 0.3;
  return { x, z, a: Math.atan2(t.x - x, t.z - 0.4 - z) };
}
export const tableDealer = (t: TableDef) => ({ x: t.x, z: t.z - 1.35, a: 0 });

const CASINO: InteriorDef = (() => {
  const hw = 24.6, hd = 17.6;
  const spots: Spot[] = [
    { id: 'exit', kind: 'exit', x: 0, z: 16.8, a: Math.PI, r: 2.2, label: 'Casino verlassen' },
    { id: 'backdoor', kind: 'backdoor', x: 24, z: 14, a: -Math.PI / 2, r: 1.4, label: 'Personalausgang' },
    { id: 'cage', kind: 'cage', x: -13.2, z: 13.4, a: -Math.PI / 2, r: 2.4, label: 'Kasse „Cage“ (Bargeld ↔ Chips)' },
    { id: 'derby', kind: 'derby', x: -21.6, z: 2, a: -Math.PI / 2, r: 3.2, label: 'Gator Derby – Wettschalter' },
    { id: 'piano', kind: 'piano', x: -14.5, z: -10.5, a: 0, r: 2.4, label: 'Bar & Lounge-Pianist' },
    { id: 'buffet', kind: 'buffet', x: -2, z: -14.4, a: Math.PI, r: 2.4, label: 'Buffet (25 $)' },
    { id: 'ledger', kind: 'ledger', x: 22.2, z: -15.2, a: Math.PI / 2, r: 1.4, label: 'Schreibtisch im Hinterzimmer' },
    { id: 'boutique', kind: 'boutique', x: 13.5, z: 14.8, a: Math.PI / 2, r: 1.8, label: 'Boutique' },
  ];
  for (const m of SLOT_MACHINES) spots.push({ id: `slot${m.n}`, kind: 'slot', x: m.x, z: m.z + (m.a === 0 ? 0.95 : -0.95), a: m.a + Math.PI, r: 0.75, label: m.v === 'classic' ? 'Lucky Flamingo Classic' : 'Lucky Flamingo Gold Rush', n: m.n, v: m.v });
  for (const t of CASINO_TABLES) for (let i = 0; i < t.seats; i++) {
    const s = tableSeat(t, i);
    spots.push({ id: `${t.id}:${i}`, kind: t.kind, x: s.x, z: s.z, a: s.a, r: 0.85, label: t.name, n: i, v: t.id });
  }
  const solids: Rect[] = [
    [-24.6, 10.2, -14.2, 10.6], [-14.6, 10.2, -14.2, 17.6], // Cage (Gitterkabine)
    [-24.6, -8.8, -12.2, -8.4], [-12.6, -17.6, -12.2, -12.4], // Bar-Rückraum, Theke
    [-24.6, -6, -22.8, 10], // Wettschalter / Großbildschirm-Wand
    [-8, -17.6, 4, -15.6], // Buffet
    [7.4, -7.2, 13.4, -6.8], [16.6, -7.2, 24.6, -6.8], // Wand High-Roller-Raum (Tür x 13.4 … 16.6)
    [19.6, -17.6, 19.9, -14.2], // Trennwand Hinterzimmer
    [-15.8, -12, -13.4, -10.8], // Flügel
    [12.2, 13.2, 14.6, 17.6], // Boutique-Tresen
  ];
  // Automaten (je 1 x 0,7 m) und Tische
  for (const m of SLOT_MACHINES) solids.push([m.x - 0.5, m.z - 0.35, m.x + 0.5, m.z + 0.35]);
  for (const t of CASINO_TABLES) solids.push(t.kind === 'bj' ? [t.x - 1.5, t.z - 0.8, t.x + 1.5, t.z + 0.8] : [t.x - 1.9, t.z - 0.9, t.x + 1.9, t.z + 0.9]);
  // Goldene Säulen
  for (const [x, z] of [[-18, 0], [-18, 8], [-4, -8], [-4, 10], [4, -8], [4, 10], [-18, -6]]) solids.push([x - 0.45, z - 0.45, x + 0.45, z + 0.45]);
  return {
    id: 'casino', name: 'Palm Royale', hw, hd, height: 9,
    solids,
    gates: [
      { rect: [13.4, -7.4, 16.6, -6.6], bit: Gate.HIGHROLLER, label: 'High-Roller-Raum – ab Stufe 15 und 50.000 $ in Chips' },
      { rect: [19.9, -14.2, 24.6, -13.6], bit: Gate.STAFF, label: 'Nur für Personal' },
    ],
    floors: [],
    spots,
    entry: { x: 0, z: 15.4, a: Math.PI },
    zones: [
      { id: 'lobby', rect: [-14.2, 11, 24.6, 17.6] },
      { id: 'slots', rect: [6, -4, 24.6, 12] },
      { id: 'tables', rect: [-14, -6, 5, 10] },
      { id: 'derby', rect: [-22.8, -6, -14, 10] },
      { id: 'bar', rect: [-24.6, -17.6, -12, -8.4], muffle: 0.3 },
      { id: 'highroller', rect: [7.4, -17.6, 24.6, -7.2], muffle: 0.4 },
      { id: 'office', rect: [19.9, -17.6, 24.6, -14.2], muffle: 0.6 },
    ],
  };
})();

export const INTERIORS: Record<InteriorId, InteriorDef> = { club: CLUB, casino: CASINO };

// ------------------------------------------------------------------ Gebäude ↔ Welt
/** Lage eines Innenraums in der Welt (aus dem Wahrzeichen). */
export interface InteriorFrame { def: InteriorDef; cx: number; cz: number; rot: number; cos: number; sin: number; y: number; door: { x: number; z: number; a: number }; back: { x: number; z: number; a: number } }

const frames = new WeakMap<WorldMap, Map<InteriorId, InteriorFrame>>();
export function interiorFrame(map: WorldMap, id: InteriorId): InteriorFrame | null {
  let m = frames.get(map);
  if (!m) {
    m = new Map();
    for (const iid of INTERIOR_IDS) {
      const lm = map.landmarks.find((l) => l.id === (iid as LandmarkId)) as Landmark | undefined;
      if (!lm) continue;
      const def = INTERIORS[iid];
      const cos = Math.cos(lm.rot), sin = Math.sin(lm.rot);
      const f: InteriorFrame = { def, cx: lm.x, cz: lm.z, rot: lm.rot, cos, sin, y: Math.max(0.05, map.terrainHeight(lm.door.x, lm.door.z)) + 0.15, door: lm.door, back: { x: 0, z: 0, a: 0 } };
      // Hinterausgang: neben der Seitenwand am backdoor-Spot nach draußen
      const bd = def.spots.find((s) => s.kind === 'backdoor')!;
      const side = Math.sign(bd.x) || -1;
      const out = toWorld(f, side * (lm.w / 2 + 1.8), bd.z);
      f.back = { x: out.x, z: out.z, a: lm.rot + side * Math.PI / 2 };
      m.set(iid, f);
    }
    frames.set(map, m);
  }
  return m.get(id) ?? null;
}

/** lokal → Welt */
export function toWorld(f: { cx: number; cz: number; cos: number; sin: number }, lx: number, lz: number) {
  return { x: f.cx + lx * f.cos + lz * f.sin, z: f.cz - lx * f.sin + lz * f.cos };
}
/** Welt → lokal */
export function toLocal(f: { cx: number; cz: number; cos: number; sin: number }, x: number, z: number) {
  const dx = x - f.cx, dz = z - f.cz;
  return { x: dx * f.cos - dz * f.sin, z: dx * f.sin + dz * f.cos };
}
/** Blickwinkel lokal → Welt (Vorwärts = (sin a, cos a)). */
export const angleToWorld = (f: InteriorFrame, a: number) => a + f.rot;

const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad;
export const rectContains = inRect;

/** Bodenhöhe im Innenraum (lokal, relativ zum Erdgeschoss). */
export function interiorFloorH(def: InteriorDef, lx: number, lz: number): number {
  for (const fl of def.floors) {
    if (fl.ramp && inRect(fl.ramp.rect, lx, lz)) {
      const [x0, z0, x1, z1] = fl.ramp.rect;
      const t = fl.ramp.dir === 'x+' ? (lx - x0) / (x1 - x0) : fl.ramp.dir === 'x-' ? (x1 - lx) / (x1 - x0) : fl.ramp.dir === 'z+' ? (lz - z0) / (z1 - z0) : (z1 - lz) / (z1 - z0);
      return fl.h * Math.max(0, Math.min(1, t));
    }
    if (inRect(fl.rect, lx, lz)) return fl.h;
  }
  return 0;
}

/** Welche Zone (id) liegt am lokalen Punkt? */
export function zoneAt(def: InteriorDef, lx: number, lz: number): string {
  for (const z of def.zones) if (inRect(z.rect, lx, lz)) return z.id;
  return 'main';
}

/** Frei begehbar (lokal)? Für NPC-Bewegung auf dem Server. */
export const localFree = (def: InteriorDef, x: number, z: number, r = PAWN_RADIUS, mask = 0xff) => !blockedLocal(def, x, z, r, mask);

function blockedLocal(def: InteriorDef, x: number, z: number, r: number, mask: number): boolean {
  if (x < -def.hw + r || x > def.hw - r || z < -def.hd + r || z > def.hd - r) return true;
  for (const s of def.solids) if (inRect(s, x, z, r)) return true;
  for (const g of def.gates) if (!(mask & g.bit) && inRect(g.rect, x, z, r)) return true;
  return false;
}

/** Freier Platz in der Nähe (lokal), z. B. nach dem Betreten oder beim Teleport. */
export function freeLocalSpot(def: InteriorDef, x: number, z: number, mask = 0): { x: number; z: number } {
  if (!blockedLocal(def, x, z, PAWN_RADIUS, mask)) return { x, z };
  for (let r = 0.5; r < 8; r += 0.5) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (!blockedLocal(def, nx, nz, PAWN_RADIUS, mask)) return { x: nx, z: nz };
  }
  return { x: def.entry.x, z: def.entry.z };
}

/**
 * Figur im Innenraum bewegen (Eingaben wie stepPawn: ax rechts, ay oben = Norden auf dem Bildschirm).
 * mask: freigeschaltete Bereiche (Gate). Rückgabe true = steckt fest.
 */
export function stepInteriorPawn(f: InteriorFrame, mask: number, p: PawnState, ax: number, ay: number, buttons: number, dt: number, speedOverride?: number): boolean {
  if (p.rt > 0) {
    // Comic-Stolpern/Ragdoll drinnen: nur abbremsen, keine Wände durchfliegen
    p.rt -= dt;
    p.vy -= 9.81 * 1.6 * dt; p.h = Math.max(0, p.h + p.vy * dt);
    const k = Math.max(0, 1 - 4 * dt); p.vx *= k; p.vz *= k;
    moveLocal(f, mask, p, p.vx * dt, p.vz * dt);
    if (p.rt <= 0) { p.rt = 0; p.h = 0; p.vx = p.vy = p.vz = 0; }
    return false;
  }
  p.pc = 0;
  let mx = ax, mz = -ay;
  const len = Math.hypot(mx, mz);
  if (len < 0.15) return false;
  if (len > 1) { mx /= len; mz /= len; }
  // Drinnen etwas gemütlicher (Gedränge): Sprint nur 75 %
  const speed = speedOverride ?? (buttons & Btn.SPRINT ? SPRINT_SPEED * 0.75 : WALK_SPEED * 0.85);
  const stuck = moveLocal(f, mask, p, mx * speed * dt, mz * speed * dt);
  p.a = approachAngle(p.a, Math.atan2(mx, mz), 14 * dt);
  return stuck;
}

function moveLocal(f: InteriorFrame, mask: number, p: { x: number; z: number }, dx: number, dz: number): boolean {
  const def = f.def;
  const l = toLocal(f, p.x, p.z);
  // Weltversatz in lokale Achsen drehen
  const ldx = dx * f.cos - dz * f.sin, ldz = dx * f.sin + dz * f.cos;
  let nx = l.x + ldx, nz = l.z + ldz, stuck = false;
  if (blockedLocal(def, l.x, l.z, PAWN_RADIUS, mask)) {
    // steckt fest (Teleport, Gate geschlossen): zum nächsten freien Platz
    const s = freeLocalSpot(def, l.x, l.z, mask); nx = s.x; nz = s.z;
  } else if (blockedLocal(def, nx, nz, PAWN_RADIUS, mask)) {
    if (!blockedLocal(def, nx, l.z, PAWN_RADIUS, mask)) nz = l.z;
    else if (!blockedLocal(def, l.x, nz, PAWN_RADIUS, mask)) nx = l.x;
    else { nx = l.x; nz = l.z; stuck = true; }
  }
  const w = toWorld(f, nx, nz);
  p.x = w.x; p.z = w.z;
  return stuck;
}

/** Nächster Interaktionspunkt (lokal) in Reichweite. */
export function spotNear(def: InteriorDef, lx: number, lz: number, extra = 0, filter?: (s: Spot) => boolean): Spot | null {
  let best: Spot | null = null, bd = Infinity;
  for (const s of def.spots) {
    if (filter && !filter(s)) continue;
    const d = Math.hypot(s.x - lx, s.z - lz);
    if (d < s.r + extra && d < bd) { bd = d; best = s; }
  }
  return best;
}
export const spotById = (def: InteriorDef, id: string) => def.spots.find((s) => s.id === id) ?? null;

/** Spielzeit-Stunde (0–24) aus der Tageszeit 0..1. */
export const hourOf = (day: number) => (day * 24) % 24;
/** Club offen 22–5 Uhr Spielzeit. */
export function clubOpen(day: number, from = 22, to = 5): boolean {
  const h = hourOf(day);
  return from > to ? h >= from || h < to : h >= from && h < to;
}

// ------------------------------------------------------------------ Außenbereich (Deko, Valet, Schlange)
/** Punkte vor dem Gebäude (Welt): Tür, Schlange/Kordel (Club), Valet-Stand, Limousinen-/Taxi-Plätze, Springbrunnen (Casino). */
export interface VenueExterior {
  door: { x: number; z: number; a: number };
  /** Türsteher-/Portier-Platz */
  host: { x: number; z: number; a: number };
  /** Schlange (Club): Startpunkt und Richtung (entlang der Fassade) */
  queue: { x: number; z: number; dx: number; dz: number };
  valet: { x: number; z: number; a: number };
  /** Abholplatz für das Valet-Auto (Blick zur Straße) */
  bay: { x: number; z: number; a: number };
  /** Abstellplätze für Deko-Fahrzeuge (Limousine, Sportwagen, Taxi) */
  cars: { x: number; z: number; a: number }[];
  fountain: { x: number; z: number } | null;
}

export function venueExterior(f: InteriorFrame): VenueExterior {
  const d = f.def;
  const fw = (lx: number, lz: number) => toWorld(f, lx, lz);
  const front = d.hd + 0.4; // Außenkante Front (Wand)
  const door = f.door;
  const host = fw(-2.2, front + 1.2);
  const q0 = fw(-3.6, front + 1.0), q1 = fw(-4.6, front + 1.0);
  const valet = fw(6, front + 1.6);
  const bay = fw(9, front + 4.2);
  const cars = [fw(-9, front + 4.6), fw(-14, front + 4.6), fw(13, front + 4.6)].map((p) => ({ ...p, a: f.rot + Math.PI / 2 }));
  return {
    door, host: { ...host, a: f.rot }, queue: { x: q0.x, z: q0.z, dx: q1.x - q0.x, dz: q1.z - q0.z },
    valet: { ...valet, a: f.rot }, bay: { ...bay, a: f.rot + Math.PI / 2 }, cars,
    fountain: f.def.id === 'casino' ? fw(-12, front + 2.6) : null,
  };
}
