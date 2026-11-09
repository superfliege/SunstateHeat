// Fallout: Boden aus Kacheln, die nach und nach verschwinden – im Fahrzeug oder zu Fuß.
// Kachelzustand (fest → Vorwarnung/blinkt → weg) entscheidet nur der Server; die Clients
// bekommen den Boden über den Snapshot (Physik und Darstellung identisch).
//   random: zufällige Kacheln, immer schneller.  trail: Kacheln fallen, nachdem jemand drüber war.
// Wer auf einer fehlenden Kachel steht, fällt ins Wasser und scheidet aus.
// NPCs: Pfad (BFS) nur über feste Kacheln zur Mitte der größten zusammenhängenden Fläche,
// blinkende Kacheln werden verlassen bzw. gemieden.
import { FloorCell, floorCellCenter, floorCellIndex, type ArenaFloor } from '../../../../shared/src/world/arenaFloor';
import type { FalloutConfig, MinigameId } from '../../../../shared/src/minigames';
import type { ServerVehicle } from '../../entities/types';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, fmt, type HudExtra, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';

interface Nav { path: number[]; t: number; goal: number }

export class Fallout extends Minigame<FalloutConfig> {
  private warnAt: Float64Array = new Float64Array(0);
  private visitAt: Float64Array = new Float64Array(0);
  private nextDrop = 0;
  private outAt = new Map<number, number>();
  private nav = new Map<number, Nav>();
  /** Zählt Bodenänderungen. */
  private ver = 0;

  constructor(h: MinigameHost, mode: MinigameId, opts: MinigameOptions) { super(h, mode, opts); }

  private get f(): ArenaFloor | null { return this.arena.floor; }

  protected onSetup() {
    const n = this.f ? this.f.cells.length : 0;
    this.warnAt = new Float64Array(n).fill(-1);
    this.visitAt = new Float64Array(n).fill(-1);
  }

  protected onStart() { this.nextDrop = this.cfg.grace + this.cfg.random.interval; }

  private solidCount() { return this.f ? this.f.cells.filter((c) => c === FloorCell.SOLID).length : 0; }

  private warn(i: number) {
    const f = this.f!;
    if (f.cells[i] !== FloorCell.SOLID || this.solidCount() <= this.cfg.keepMin) return;
    f.cells[i] = FloorCell.WARN;
    this.warnAt[i] = this.elapsed + this.cfg.warnTime;
    this.ver++;
  }

  protected tick(dt: number) {
    const f = this.f;
    if (!f) return;
    // Vorwarnung abgelaufen → Kachel weg
    for (let i = 0; i < f.cells.length; i++) {
      if (f.cells[i] === FloorCell.WARN && this.elapsed >= this.warnAt[i]) { f.cells[i] = FloorCell.GONE; this.ver++; }
    }
    if (this.elapsed < this.cfg.grace) return;
    const v = this.cfg.variant;
    // Variante 2: Kacheln fallen, nachdem man darüber war
    if (v === 'trail' || v === 'mixed') {
      for (const p of this.alive()) {
        const q = this.pos(p);
        if (!q) continue;
        const i = floorCellIndex(f, q.x, q.z);
        if (i < 0 || f.cells[i] !== FloorCell.SOLID || this.visitAt[i] !== -1) continue;
        this.visitAt[i] = Math.random() < this.cfg.trail.chance ? this.elapsed : -2; // -2 = verschont
      }
      for (let i = 0; i < f.cells.length; i++) {
        if (this.visitAt[i] >= 0 && this.elapsed - this.visitAt[i] >= this.cfg.trail.delay) { this.visitAt[i] = -2; this.warn(i); }
      }
    }
    // Variante 1: zufällig, immer schneller
    if (v === 'random' || v === 'mixed') {
      this.nextDrop -= dt;
      if (this.nextDrop <= 0) {
        const r = this.cfg.random;
        this.nextDrop = Math.max(r.minInterval, r.interval - r.accel * (this.elapsed - this.cfg.grace));
        const solid = f.cells.map((c, i) => (c === FloorCell.SOLID ? i : -1)).filter((i) => i >= 0);
        for (let k = 0; k < r.batch && solid.length; k++) this.warn(solid.splice(Math.floor(Math.random() * solid.length), 1)[0]);
      }
    }
  }

  damageScale(victim: ServerVehicle) { return victim.race === MG_MARK ? this.cfg.damageScale : 1; }

  protected outReason(p: Participant, v: ServerVehicle | undefined): string {
    if (!this.onFoot) return super.outReason(p, v);
    const q = this.pos(p);
    if (!q) return 'ist verschwunden';
    return this.h.map.onFloor(q.x, q.z) ? '' : 'ist ins Wasser gefallen';
  }

  protected flushOut() {
    super.flushOut();
    for (const p of this.parts) if (!p.alive && !this.outAt.has(p.key)) this.outAt.set(p.key, this.elapsed);
  }

  // ------------------------------------------------------------------ Wegfindung der NPCs
  /** Sicher = fest und nicht schon zum Fallen vorgemerkt (Spur). */
  private safe(i: number) { return this.f!.cells[i] === FloorCell.SOLID && this.visitAt[i] < 0; }

  /** Größte zusammenhängende feste Fläche (Kachelindizes) und ihr Schwerpunkt; zwischengespeichert je Tick. */
  private compCache: { t: number; cells: number[]; cx: number; cz: number } = { t: -1, cells: [], cx: 0, cz: 0 };
  private largest() {
    const f = this.f!;
    if (this.compCache.t === this.elapsed) return this.compCache;
    const seen = new Uint8Array(f.cells.length);
    let best: number[] = [];
    for (let s = 0; s < f.cells.length; s++) {
      if (!this.safe(s) || seen[s]) continue;
      const comp = [s];
      seen[s] = 1;
      for (let k = 0; k < comp.length; k++) for (const n of this.neighbors(comp[k])) if (this.safe(n) && !seen[n]) { seen[n] = 1; comp.push(n); }
      if (comp.length > best.length) best = comp;
    }
    let cx = this.arena.cx, cz = this.arena.cz;
    if (best.length) {
      cx = 0; cz = 0;
      for (const i of best) { const [x, z] = floorCellCenter(f, i); cx += x; cz += z; }
      cx /= best.length; cz /= best.length;
    }
    this.compCache = { t: this.elapsed, cells: best, cx, cz };
    return this.compCache;
  }

  private neighbors(i: number): number[] {
    const f = this.f!, c = i % f.cols, r = Math.floor(i / f.cols), out: number[] = [];
    if (c > 0) out.push(i - 1);
    if (c < f.cols - 1) out.push(i + 1);
    if (r > 0) out.push(i - f.cols);
    if (r < f.rows - 1) out.push(i + f.cols);
    // Zu Fuß auch diagonal – aber nur, wenn beide angrenzenden Kacheln tragen (sonst schneidet
    // der Weg die Ecke einer fehlenden Kachel und man fällt)
    if (this.onFoot) {
      const ok = (a: number, b: number) => f.cells[a] !== FloorCell.GONE && f.cells[b] !== FloorCell.GONE;
      if (c > 0 && r > 0 && ok(i - 1, i - f.cols)) out.push(i - f.cols - 1);
      if (c < f.cols - 1 && r > 0 && ok(i + 1, i - f.cols)) out.push(i - f.cols + 1);
      if (c > 0 && r < f.rows - 1 && ok(i - 1, i + f.cols)) out.push(i + f.cols - 1);
      if (c < f.cols - 1 && r < f.rows - 1 && ok(i + 1, i + f.cols)) out.push(i + f.cols + 1);
    }
    return out;
  }

  /**
   * Eigenes Ziel je NPC: Kachel der größten Fläche nahe ihrem Schwerpunkt und nahe bei mir,
   * aber nicht dort, wo schon andere NPCs hinwollen (sonst stapeln sich alle auf einer Kachel).
   */
  private pickGoal(p: Participant, x: number, z: number, here: number): number {
    const f = this.f!, comp = this.largest();
    // Positionen der anderen (Gedränge meiden: wo andere stehen, fallen bald die Kacheln)
    const others: [number, number][] = [];
    if (this.onFoot) for (const o of this.alive()) { if (o === p) continue; const q = this.pos(o); if (q) others.push([q.x, q.z]); }
    let best = -1, bs = Infinity;
    for (const i of comp.cells) {
      if (i === here && this.visitAt[here] >= 0) continue;
      const [gx, gz] = floorCellCenter(f, i);
      let claimed = 0;
      for (const [k, n] of this.nav) if (k !== p.key && n.goal === i) claimed++;
      // Zu Fuß: lieber kurze Wege (jeder Schritt kostet Boden), im Auto: lieber zur Mitte
      const wc = this.onFoot ? 0.2 : 0.5, wm = this.onFoot ? 1 : 0.4;
      let crowd = 0;
      for (const [ox, oz] of others) if (Math.hypot(ox - gx, oz - gz) < 6) crowd++;
      const s = Math.hypot(gx - comp.cx, gz - comp.cz) * wc + Math.hypot(gx - x, gz - z) * wm + (claimed + crowd) * 6 + Math.random();
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }

  /** BFS vom eigenen Feld zum Ziel: zuerst nur sichere Kacheln, dann auch vorgemerkte, im Notfall über blinkende. */
  private plan(from: number, goal: number): number[] {
    const f = this.f!;
    if (from < 0 || goal < 0) return [];
    for (const level of [0, 1, 2]) {
      const prev = new Int32Array(f.cells.length).fill(-2);
      prev[from] = -1;
      const q = [from];
      for (let k = 0; k < q.length && prev[goal] === -2; k++) {
        for (const n of this.neighbors(q[k])) {
          const ok = level === 0 ? this.safe(n) : level === 1 ? f.cells[n] === FloorCell.SOLID : f.cells[n] !== FloorCell.GONE;
          if (prev[n] !== -2 || !ok) continue;
          prev[n] = q[k]; q.push(n);
        }
      }
      if (prev[goal] === -2) continue;
      const path: number[] = [];
      for (let u = goal; u !== from && u >= 0; u = prev[u]) path.unshift(u);
      return path;
    }
    // Ziel nicht erreichbar: irgendeine feste Nachbarkachel
    const n = this.neighbors(from).find((x) => this.safe(x)) ?? this.neighbors(from).find((x) => f.cells[x] === FloorCell.SOLID);
    return n !== undefined ? [n] : [];
  }

  /** Nächster Wegpunkt (Weltkoordinaten) für einen NPC. */
  private waypoint(p: Participant, x: number, z: number, dt: number, ahead: number): [number, number] | null {
    const f = this.f;
    if (!f) return null;
    const here = floorCellIndex(f, x, z);
    let nav = this.nav.get(p.key);
    if (!nav) { nav = { path: [], t: 0, goal: -1 }; this.nav.set(p.key, nav); }
    nav.t -= dt;
    // Neu planen: regelmäßig, wenn der Weg blockiert ist oder das eigene Feld fällt
    const blocked = nav.path.some((i) => f.cells[i] !== FloorCell.SOLID);
    // Eigenes Feld unsicher: blinkt schon oder ist vorgemerkt und gleich dran (Vorlaufzeit ausnutzen –
    // jeder Schritt auf ein neues Feld kostet im Spur-Modus eine Kachel)
    const pend = here >= 0 ? this.visitAt[here] : -1;
    const unsafeHere = here >= 0 && (f.cells[here] === FloorCell.WARN || (pend >= 0 && this.elapsed - pend > this.cfg.trail.delay - 0.4));
    // Zu Fuß stehen bleiben, solange das eigene Feld sicher ist (jede betretene Kachel kann fallen)
    if (this.onFoot && here >= 0 && !unsafeHere && !nav.path.length) { nav.goal = here; return floorCellCenter(f, here); }
    const periodic = nav.t <= 0 && !this.onFoot;
    if (periodic || blocked || (unsafeHere && !nav.path.length) || (nav.goal >= 0 && !this.safe(nav.goal) && nav.goal !== here)) {
      nav.goal = this.pickGoal(p, x, z, here);
      nav.path = this.plan(here, nav.goal);
      nav.t = (p.bot?.diff.reaction ?? 0.3) + 0.3 + Math.random() * 0.3;
    }
    while (nav.path.length && nav.path[0] === here) nav.path.shift();
    if (!nav.path.length) return here >= 0 ? floorCellCenter(f, here) : [this.arena.cx, this.arena.cz];
    return floorCellCenter(f, nav.path[Math.min(ahead, nav.path.length - 1)]);
  }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver, dt: number) {
    const c = v.sim.car;
    const wp = this.waypoint(p, c.x, c.z, dt, 1);
    bot.begin(c, 8);
    if (wp) bot.seek(wp[0], wp[1], 1.3);
    bot.avoidHazard(this.arena, 2.2);
  }

  protected botWalk(p: Participant, x: number, z: number, dt: number) {
    const wp = this.waypoint(p, x, z, dt, 0);
    if (!wp) return { dx: 0, dz: 0, run: false };
    const dx = wp[0] - x, dz = wp[1] - z, d = Math.hypot(dx, dz);
    // Schwierigkeit: NPCs zögern gelegentlich (leichte öfter)
    const diff = p.bot?.diff;
    if (diff && Math.random() < (diff.mistakeRate / 60) * 10 * dt) return { dx: 0, dz: 0, run: false };
    if (d < 0.6) return { dx: 0, dz: 0, run: false };
    const f = this.f!, here = floorCellIndex(f, x, z);
    return { dx: dx / d, dz: dz / d, run: here >= 0 && f.cells[here] === FloorCell.WARN };
  }

  protected hudInfo(me: Participant | undefined): HudExtra {
    const f = this.f;
    if (this.phase !== 'run' || !f) return {};
    const solid = f.cells.filter((c) => c !== FloorCell.GONE).length;
    const grace = this.cfg.grace - this.elapsed;
    const out: HudExtra = {
      info: grace > 0 ? `Platten fallen in ${Math.ceil(grace)} s` : `Platten: ${solid}/${f.cells.length}`,
      bar: { label: 'Boden', value: solid / f.cells.length, warn: solid < f.cells.length * 0.3 },
    };
    if (me?.alive) {
      const q = this.pos(me);
      const i = q ? floorCellIndex(f, q.x, q.z) : -1;
      if (i >= 0 && f.cells[i] === FloorCell.WARN) out.alert = '⚠ PLATTE FÄLLT!';
    }
    return out;
  }

  protected scoreText(p: Participant) {
    const t = this.outAt.get(p.key);
    return p.place === 1 ? 'oben geblieben' : t !== undefined ? `${fmt(t)} überlebt` : '';
  }
}
