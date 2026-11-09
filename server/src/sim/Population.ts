// Population-Steuerung: hält um jeden Spieler so viele Passanten, wie die Population Table des
// Viertels für die aktuelle Tageszeit vorgibt (Dichte pro 100 m Gehweg, max. 40 pro Spieler-Umkreis),
// wählt Archetypen nach der Mischung und lässt einen Teil direkt in einem Szenario starten
// (Smart-Object-Aktion oder freies Szenario). Fern (> POP_RADIUS) existieren keine verwalteten NPCs.
import { ARCH_INDEX, archetypeOf } from '../../../shared/src/npc/archetypes';
import {
  DAY_PART_NAMES, MAX_PEDS_PER_PLAYER, POP_RADIUS, dayPartOf, hasPopTable, pickArchetype, popTable,
  type DayPart, type PopTable, type Weather,
} from '../../../shared/src/npc/population';
import {
  Act, SCENARIOS, SMART_KINDS, scenarioAllowed, slotWorld, type ScenarioDef, type ScenarioId,
} from '../../../shared/src/npc/scenarios';
import { dist2 } from '../../../shared/src/math';
import { generateSmartObjects, type SmartObject } from '../../../shared/src/world/smartObjects';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { Tile } from '../../../shared/src/world/tiles';
import type { NpcBrain } from './NpcBrain';
import type { Ped, Pedestrians, Walkway } from './Pedestrians';

const PASS_INTERVAL = 0.5;
const MAX_SPAWNS_PER_PASS = 3;
/** Mindestabstand zum nächsten Spieler beim Spawnen (Nähe = sichtbar, Ploppen vermeiden). */
const MIN_SPAWN_DIST = 38;
const DESPAWN_DIST = POP_RADIUS + 25;
/** Austausch nur jenseits dieser Entfernung zum nächsten Spieler (außer Sicht). */
const SWAP_DIST = 55;
/** Notbremse: so alt wird kein verwalteter NPC (Absichtskette hängt o. Ä.), außer Sicht. */
const MAX_AGE = 360;
/** Wer die Welt verlässt (Bus, kein Ausgang), verschwindet ab dieser Entfernung zum nächsten Spieler. */
const LEAVE_DIST = 45;

export interface PopStats {
  part: DayPart; weather: Weather; managed: number; scenario: number;
  byArch: Record<string, number>; byScenario: Record<string, number>;
}

export class Population {
  private objects: SmartObject[];
  /** Verwaltete Gehwege (Viertel mit Population Table) */
  private walkways: Walkway[];
  private acc = 0;
  /** Zähler: Neuspawns insgesamt / direkt im Szenario (Ziel 40–60 %). */
  spawnedAll = 0; spawnedScn = 0;
  /** Erzwungene Tageszeit/Wetter (Debug), sonst aus der Spielzeit. */
  forcePart: DayPart | null = null;
  weather: Weather = 'clear';
  constructor(private map: WorldMap, private peds: Pedestrians, private brain: NpcBrain, private day: () => number, private anchors: () => { x: number; z: number }[]) {
    this.objects = generateSmartObjects(map);
    this.walkways = peds.walkways.filter((w) => hasPopTable(w.district));
  }

  get part(): DayPart { return this.forcePart ?? dayPartOf(this.day()); }

  update(dt: number) {
    this.acc += dt;
    if (this.acc < PASS_INTERVAL) return;
    this.acc = 0;
    if (!this.walkways.length) return;
    const players = this.anchors();
    if (!players.length) { this.clear(); return; }
    const part = this.part;

    // Verwaltete NPCs außerhalb aller Umkreise entfernen
    let managed = 0;
    const tableAt = (p: Ped) => popTable(this.districtOf(p), part, this.weather);
    for (const p of this.peds.peds.values()) {
      if (!p.pop) continue;
      managed++;
      p.age += PASS_INTERVAL;
      const d2 = nearest2(players, p.x, p.z);
      if (d2 > DESPAWN_DIST * DESPAWN_DIST) { this.peds.peds.delete(p.id); continue; }
      // Wer die Welt verlässt (wartet auf den Bus, fand keinen Ausgang), ist weg, sobald niemand hinschaut
      const m = p.mind;
      if (m?.leaving && d2 > LEAVE_DIST * LEAVE_DIST && m.exitT <= 0) { this.peds.peds.delete(p.id); continue; }
      // Austausch nur außerhalb der Sicht (kein Verschwinden vor den Augen des Spielers): Archetyp passt
      // nicht mehr zur Tageszeit, oder die Absichtskette hängt (Notbremse)
      if (d2 > SWAP_DIST * SWAP_DIST && !p.scn && p.rt <= 0 && p.flee <= 0 && (!m || (!m.react && m.exitT <= 0))) {
        const t = tableAt(p);
        const fits = !!t && (t.mix[archetypeOf(p.arch).id] ?? 0) > 0;
        if (p.age > MAX_AGE || (!fits && p.age > 12)) this.peds.peds.delete(p.id);
      }
    }

    let spawned = 0;
    for (const pl of players) {
      const near: Ped[] = [];
      for (const p of this.peds.peds.values()) if (p.pop && dist2(p.x, p.z, pl.x, pl.z) < POP_RADIUS * POP_RADIUS) near.push(p);
      const target = Math.min(MAX_PEDS_PER_PLAYER, this.targetAround(pl, part));
      if (near.length > target + 3) {
        // Tageszeit-Wechsel o. Ä.: überzählige NPCs außerhalb des Nahbereichs verschwinden lassen
        const far = near.filter((p) => dist2(p.x, p.z, pl.x, pl.z) > 60 * 60 && !p.scn && !p.mind?.react && nearest2(players, p.x, p.z) > 60 * 60);
        for (let i = 0; i < 2 && i < far.length; i++) this.peds.peds.delete(far[i].id);
        continue;
      }
      for (let i = 0; i < MAX_SPAWNS_PER_PASS && near.length + spawned < target && spawned < MAX_SPAWNS_PER_PASS * players.length; i++) {
        const made = this.spawnOne(pl, players, part);
        if (made > 0) { spawned += made; near.length += 0; } else break;
      }
    }
  }

  /** Viertel, in dem der NPC gerade steht (über den nächsten verwalteten Gehweg). */
  private districtOf(p: Ped): string {
    return p.walk?.district ?? this.map.districtAt(p.x, p.z)?.name ?? this.nearestWalkDistrict(p.x, p.z);
  }
  private nearestWalkDistrict(x: number, z: number): string {
    let best = '', bd = Infinity;
    for (const w of this.walkways) { const m = w.pts[Math.floor(w.pts.length / 2)]; const d = dist2(m[0], m[1], x, z); if (d < bd) { bd = d; best = w.district; } }
    return best;
  }

  /** Alle verwalteten NPCs entfernen (z. B. kein Spieler online). */
  private clear() {
    for (const p of this.peds.peds.values()) if (p.pop) this.peds.peds.delete(p.id);
  }

  /** Zielanzahl um den Spieler: Σ Dichte × Gehweglänge im Umkreis / 100. */
  private targetAround(pl: { x: number; z: number }, part: DayPart): number {
    let sum = 0;
    for (const w of this.walkways) {
      const t = popTable(w.district, part, this.weather);
      if (!t) continue;
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1], b = w.pts[i];
        if (dist2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pl.x, pl.z) < POP_RADIUS * POP_RADIUS) sum += Math.hypot(b[0] - a[0], b[1] - a[1]) * t.density / 100;
      }
    }
    return Math.round(sum);
  }

  /** Spawnt einen NPC (oder eine Gruppe). Gibt die Anzahl zurück (0 = nichts gefunden). */
  private spawnOne(pl: { x: number; z: number }, players: { x: number; z: number }[], part: DayPart): number {
    // Zufälliger Gehwegpunkt im Ring MIN_SPAWN_DIST … POP_RADIUS um den Spieler
    for (let tries = 0; tries < 24; tries++) {
      const w = this.walkways[Math.floor(Math.random() * this.walkways.length)];
      const idx = Math.floor(Math.random() * w.pts.length);
      const q = w.pts[idx];
      const d2 = dist2(q[0], q[1], pl.x, pl.z);
      if (d2 > (POP_RADIUS - 6) ** 2 || d2 < MIN_SPAWN_DIST ** 2) continue;
      if (nearest2(players, q[0], q[1]) < MIN_SPAWN_DIST ** 2) continue;
      const table = popTable(w.district, part, this.weather);
      if (!table) continue;
      const arch = ARCH_INDEX[pickArchetype(table, Math.random())];
      if (Math.random() < table.scenarioShare) {
        const n = this.spawnScenario(pl, w, q, arch, part, table);
        if (n > 0) return n;
      }
      const p = this.peds.spawnManaged(q[0], q[1], w, arch);
      this.brain.initMind(p, part, false);
      this.spawnedAll++;
      return 1;
    }
    return 0;
  }

  // ------------------------------------------------------------------ Szenarien
  /** Wählt ein zum Archetyp passendes Szenario. Smart Objects in Spielernähe werden bevorzugt. */
  private spawnScenario(pl: { x: number; z: number }, w: Walkway, q: [number, number], arch: number, part: DayPart, table: PopTable): number {
    const def = archetypeOf(arch);
    const allowed = def.scenarios.map((id) => SCENARIOS[id]).filter((sc) => scenarioAllowed(sc, part));
    if (!allowed.length) return 0;
    // Zufällige Reihenfolge; ist an einem Objekt nichts frei, das nächste Szenario probieren
    const order = allowed.sort(() => Math.random() - 0.5);
    for (const pick of order) {
      const n = pick.where ? (this.spawnAtObject(pl, pick, arch, part) ? 1 : 0) : this.spawnFree(w, q, pick, arch, part, table);
      if (n > 0) { this.spawnedScn += n; this.spawnedAll += n; return n; }
    }
    return 0;
  }

  private spawnAtObject(pl: { x: number; z: number }, sc: ScenarioDef, arch: number, part: DayPart): boolean {
    // Kandidaten: freie Slots an passenden Objekten im Spawn-Ring
    const cands: { o: SmartObject; slot: number }[] = [];
    for (const o of this.objects) {
      const d2 = dist2(o.x, o.z, pl.x, pl.z);
      if (d2 > (POP_RADIUS - 6) ** 2 || d2 < (MIN_SPAWN_DIST - 10) ** 2) continue;
      for (const wh of sc.where!) {
        if (wh.kind !== o.kind) continue;
        for (const slot of wh.slots) if (this.brain.isFree(o.id, slot)) cands.push({ o, slot });
      }
    }
    if (!cands.length) return false;
    // Warteschlange: den ersten freien Platz (vorne) nehmen, sonst zufällig
    const c = sc.id === 'club_queue'
      ? cands.reduce((a, b) => (a.o.id === b.o.id ? (a.slot < b.slot ? a : b) : (Math.random() < 0.5 ? a : b)))
      : cands[Math.floor(Math.random() * cands.length)];
    const sw = slotWorld(c.o.x, c.o.z, c.o.rot, SMART_KINDS[c.o.kind].slots[c.slot]);
    const p = this.peds.spawnManaged(sw.x, sw.z, null, arch, sw.a);
    this.peds.startScenario(p, { id: sc.id, obj: c.o.id, slot: c.slot, dur: 0, t: rnd(sc.dur) }, sc.act, sw.x, sw.z, sw.a);
    this.brain.initMind(p, part, true);
    return true;
  }

  /** Freie Szenarien: Gespräch (2–4), Rauchen, Telefonieren, Fotos, Straßenmusik mit Zuschauern. */
  private spawnFree(w: Walkway, q: [number, number], sc: ScenarioDef, arch: number, part: DayPart, table: PopTable): number {
    // Blickrichtung: Fotos zum Wasser, sonst quer zum Gehweg
    const along = walkDir(w, q);
    const across = along + (w.side > 0 ? -1 : 1) * Math.PI / 2;
    const t = rnd(sc.dur);
    const mk = (x: number, z: number, a: number, a2: number, act: number, id: ScenarioId, dur: number) => {
      const p = this.peds.spawnManaged(x, z, null, a2, a);
      this.peds.startScenario(p, { id, obj: -1, slot: 0, dur, t: dur }, act, x, z, a);
      this.brain.initMind(p, part, true);
      return p;
    };
    if (sc.id === 'talk' || sc.id === 'busk') {
      const size = Math.max(sc.group![0], Math.min(sc.group![1], 2 + Math.floor(Math.random() * 3)));
      if (sc.id === 'busk') {
        // Musiker + 1–3 Zuschauer im Halbkreis
        mk(q[0], q[1], across + Math.PI, arch, Act.Busk, 'busk', t);
        const n = Math.max(1, size - 1);
        for (let i = 0; i < n; i++) {
          const ang = across + (i - (n - 1) / 2) * 0.7;
          const r = 2.4 + Math.random() * 0.6;
          const x = q[0] + Math.sin(ang) * r, z = q[1] + Math.cos(ang) * r;
          if (!this.walkable(x, z)) continue;
          mk(x, z, Math.atan2(q[0] - x, q[1] - z), ARCH_INDEX[pickArchetype(table, Math.random())], Act.Watch, 'busk_watch', t * (0.6 + Math.random() * 0.4));
        }
        return 1 + n;
      }
      // Gesprächskreis um die Mitte, alle schauen zur Mitte
      const cx = q[0], cz = q[1];
      const base = Math.random() * Math.PI * 2;
      let made = 0;
      for (let i = 0; i < size; i++) {
        const ang = base + (i / size) * Math.PI * 2;
        const r = size === 2 ? 0.8 : 1.0;
        const x = cx + Math.sin(ang) * r, z = cz + Math.cos(ang) * r;
        if (!this.walkable(x, z)) continue;
        mk(x, z, ang + Math.PI, i === 0 ? arch : ARCH_INDEX[pickArchetype(table, Math.random())], Act.Talk, 'talk', t);
        made++;
      }
      return made;
    }
    let face = across;
    if (sc.id === 'photo') face = this.towardWater(q[0], q[1], across);
    mk(q[0], q[1], face, arch, sc.act, sc.id, t);
    return 1;
  }

  private walkable(x: number, z: number): boolean {
    const t = this.map.tileAt(x, z);
    return t === Tile.SIDEWALK || t === Tile.PLAZA || t === Tile.SAND || t === Tile.GRASS;
  }

  /** Richtung (Blickwinkel) zum nächsten Wasser innerhalb von 80 m, sonst `fallback`. */
  private towardWater(x: number, z: number, fallback: number): number {
    for (let r = 6; r < 80; r += 6) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (this.map.tileAt(x + Math.sin(a) * r, z + Math.cos(a) * r) === Tile.WATER) return a;
      }
    }
    return fallback;
  }

  // ------------------------------------------------------------------ Debug
  stats(): PopStats {
    const byArch: Record<string, number> = {}, byScenario: Record<string, number> = {};
    let managed = 0, scenario = 0;
    for (const p of this.peds.peds.values()) {
      if (!p.pop) continue;
      managed++;
      const n = archetypeOf(p.arch).name;
      byArch[n] = (byArch[n] ?? 0) + 1;
      if (p.scn) { scenario++; byScenario[SCENARIOS[p.scn.id].name] = (byScenario[SCENARIOS[p.scn.id].name] ?? 0) + 1; }
    }
    return { part: this.part, weather: this.weather, managed, scenario, byArch, byScenario };
  }

  describe(): string {
    const s = this.stats();
    const arch = Object.entries(s.byArch).map(([k, v]) => `${k} ${v}`).join(', ');
    const sc = Object.entries(s.byScenario).map(([k, v]) => `${k} ${v}`).join(', ');
    return `${DAY_PART_NAMES[s.part]}${this.forcePart ? ' (erzwungen)' : ''}: ${s.managed} NPCs, ${s.scenario} im Szenario (${Math.round((s.scenario / Math.max(1, s.managed)) * 100)} %). ${arch}. Szenarien: ${sc || '–'}. Neuspawns direkt im Szenario: ${Math.round((this.spawnedScn / Math.max(1, this.spawnedAll)) * 100)} %`;
  }
}

function rnd(r: [number, number]): number { return r[0] + Math.random() * (r[1] - r[0]); }

function nearest2(list: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (const p of list) best = Math.min(best, dist2(p.x, p.z, x, z));
  return best;
}

/** Laufrichtung des Gehwegs am Punkt q als Blickwinkel (atan2(dx, dz)). */
function walkDir(w: Walkway, q: [number, number]): number {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < w.pts.length; i++) { const d = dist2(w.pts[i][0], w.pts[i][1], q[0], q[1]); if (d < bd) { bd = d; bi = i; } }
  const a = w.pts[Math.max(0, bi - 1)], b = w.pts[Math.min(w.pts.length - 1, bi + 1)];
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}
