// Speed / Bomb Bus: Ein Teilnehmer fährt das Bombenfahrzeug durch die Stadt, alle anderen jagen es.
// Nach einer Schonfrist ist die Bombe scharf: Fällt das Tempo länger als `fuse` Sekunden unter
// `minSpeed`, explodiert der Bus. Bus gewinnt: Zeit überlebt oder Ziel erreicht. Jäger gewinnen:
// Bus explodiert, ist Schrott oder liegt im Wasser. Zerstörte/abgehängte Jäger kommen vor dem Bus
// neu ins Spiel. Bomben-Timer, Tempo und Sieg entscheidet nur der Server.
// NPC-Bus: Straßenfolger, der gerade, breite und leere Straßen (Richtung Ziel) bevorzugt.
// NPC-Jäger: ein Teil baut Straßensperren auf der vorausberechneten Route (nächster Knoten des
// Busses), der Rest verfolgt ihn über das Straßennetz; aus der Nähe: Block + Rammen.
import { dist2 } from '../../../../shared/src/math';
import type { QuestState } from '../../../../shared/src/protocol';
import { carInWater, type CarCollision } from '../../../../shared/src/sim/car';
import type { BombBusConfig } from '../../../../shared/src/minigames';
import type { Vec2 } from '../../../../shared/src/world/geometry';
import { Tile } from '../../../../shared/src/world/tiles';
import { RoadType, type RoadEdge } from '../../../../shared/src/world/WorldMap';
import { DRIVER_NPC, type ServerVehicle } from '../../entities/types';
import type { Spot } from '../Arena';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, type HudExtra, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';
import { RoadFollower, RoadNav } from '../RoadNav';

interface HunterAi { path: Vec2[]; plan: number; blocker: boolean; deadT: number; rams: number }

export class BombBus extends Minigame<BombBusConfig> {
  private bus: Participant | null = null;
  private goal: { x: number; z: number } | null = null;
  private slowT = 0;
  private nav: RoadNav;
  private follower: RoadFollower;
  private ai = new Map<number, HunterAi>();

  constructor(h: MinigameHost, opts: MinigameOptions) {
    super(h, 'bombbus', opts);
    this.nav = new RoadNav(h.map);
    this.follower = new RoadFollower(h.map);
  }

  // ------------------------------------------------------------------ Aufstellung
  /** Straßenpunkt im Ring [rmin, rmax] um (cx, cz), frei von Autos, Blick zu (fx, fz). */
  private roadSpot(cx: number, cz: number, rmin: number, rmax: number, fx: number, fz: number, taken: Spot[] = [], behind?: Spot): Spot | null {
    const map = this.h.map, cars = [...this.h.vehicles.values()];
    for (let t = 0; t < 300; t++) {
      const e = map.edges[Math.floor(Math.random() * map.edges.length)];
      if (!e || e.type === RoadType.Pier || e.pts.length < 2) continue;
      const i = Math.floor(Math.random() * (e.pts.length - 1));
      const [x, z] = e.pts[i], [nx, nz] = e.pts[i + 1];
      const d2 = dist2(x, z, cx, cz);
      if (d2 < rmin * rmin || d2 > rmax * rmax || map.tileAt(x, z) !== Tile.ROAD) continue;
      if (cars.some((v) => dist2(v.sim.car.x, v.sim.car.z, x, z) < 9 * 9) || taken.some((s) => dist2(s.x, s.z, x, z) < 14 * 14)) continue;
      // nur hinter dem Bus (Vorsprung für den Bus)
      if (behind && (x - behind.x) * Math.sin(behind.a) + (z - behind.z) * Math.cos(behind.a) > -10 && t < 250) continue;
      let a = Math.atan2(nx - x, nz - z);
      if (Math.cos(a - Math.atan2(fx - x, fz - z)) < 0) a += Math.PI;
      return { x, z, a };
    }
    return null;
  }

  protected spawnSpots(n: number): Spot[] {
    const map = this.h.map, cx = this.arena.cx, cz = this.arena.cz;
    // Bus: nächster Punkt einer Schnellstraße (sonst Hauptstraße) zur Arena-Mitte, entlang der Straße
    let bus: Spot = { x: cx, z: cz, a: 0 }, bd = Infinity;
    const hasHighway = map.edges.some((e) => e.type === RoadType.Highway && Math.hypot(e.pts[0][0] - cx, e.pts[0][1] - cz) < this.arena.def.bounds / 2);
    for (const e of map.edges) {
      if (e.type !== RoadType.Highway && (hasHighway || e.type !== RoadType.Main)) continue;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const [x, z] = e.pts[i], [nx, nz] = e.pts[i + 1];
        const d = dist2(x, z, cx, cz);
        if (d < bd && d > 12 * 12 && map.tileAt(x, z) === Tile.ROAD) { bd = d; bus = { x, z, a: Math.atan2(nx - x, nz - z) }; }
      }
    }
    const out: Spot[] = [bus];
    for (let k = 1; k < n; k++) {
      const s = this.roadSpot(bus.x, bus.z, 30, 90, bus.x, bus.z, out, bus)
        ?? { x: bus.x + Math.sin(k) * 40, z: bus.z + Math.cos(k) * 40, a: 0 };
      out.push(s);
    }
    return out;
  }

  protected vehicleFor(i: number) { return this.randomVariant(i === 0 ? [this.cfg.busVehicle] : this.cfg.hunterVehicles); }

  protected onSetup() {
    this.bus = this.parts[0] ?? null;
    if (this.bus) this.bus.role = 'bus';
    const hunters = this.parts.slice(1);
    hunters.forEach((p, i) => {
      p.role = 'hunter';
      this.ai.set(p.key, { path: [], plan: 0, blocker: i < hunters.length * this.cfg.blockerShare, deadT: 0, rams: 0 });
    });
    // Ziel: Straßenknoten in etwa goal.distance Metern vom Bus
    const g = this.cfg.goal, bv = this.bus && this.vehicle(this.bus);
    if (g.enabled && bv) {
      const bx = bv.sim.car.x, bz = bv.sim.car.z;
      const cand = this.h.map.nodes.filter((n) => {
        const d = Math.hypot(n.x - bx, n.z - bz);
        return d > g.distance * 0.8 && d < g.distance * 1.25 && Math.hypot(n.x - this.arena.cx, n.z - this.arena.cz) < this.arena.def.bounds;
      });
      const n = cand[Math.floor(Math.random() * cand.length)];
      if (n) this.goal = { x: n.x, z: n.z };
    }
    if (this.bus) {
      this.log(`🚌 ${this.bus.name} fährt den Bomben-Bus!`);
      this.tell(this.bus, `🚌 DU fährst den Bomben-Bus! Ab ${this.cfg.armAfter} s nie unter ${this.cfg.minSpeed} km/h fallen${this.goal ? ' – und ab zum Ziel!' : '!'}`, 'bad');
      for (const p of hunters) this.tell(p, `🚚 Stopp den Bus von ${this.bus.name}! Blockieren, ausbremsen, Straßen sperren.`, 'info');
    }
  }

  protected onStart() {
    const v = this.bus && this.vehicle(this.bus);
    if (v) this.follower.attach(v.sim.car);
  }

  /** Jäger stehen nach dem Start noch kurz. */
  frozen(pid: number) {
    if (super.frozen(pid)) return true;
    const p = this.part(pid);
    return !!p && p.role === 'hunter' && this.phase === 'run' && this.elapsed < this.cfg.hunterHeadStart;
  }

  // ------------------------------------------------------------------ Ablauf
  private busV() { return this.bus ? this.vehicle(this.bus) : undefined; }
  private kmh() { const v = this.busV(); return v ? Math.hypot(v.sim.car.vx, v.sim.car.vz) * 3.6 : 0; }

  private winBus(why: string) {
    const hunters = this.parts.filter((p) => p !== this.bus);
    this.finish([[this.bus!], hunters], `🚌 ${this.bus!.name} gewinnt – ${why}`);
  }
  private winHunters(why: string) {
    const hunters = this.parts.filter((p) => p !== this.bus);
    this.finish([hunters, this.bus ? [this.bus] : []], `🚚 Die Jäger gewinnen – ${why}`);
  }

  protected tick(dt: number) {
    this.nav.age(dt);
    const v = this.busV();
    if (!this.bus || !v) { this.winHunters('der Bus ist weg.'); return; }
    const c = v.sim.car, d = v.sim.dmg;
    if (d.wreck || d.burn > 0 || d.hp <= 0) { this.winHunters('der Bus ist Schrott!'); return; }
    if (carInWater(this.h.map, c) && c.y < 1) { this.winHunters('der Bus liegt im Wasser!'); return; }
    // Bombe: scharf nach der Schonfrist, unter dem Mindesttempo läuft der Zünder
    if (this.elapsed >= this.cfg.armAfter) {
      if (this.elapsed - dt < this.cfg.armAfter) { this.log('💣 Die Bombe ist scharf!'); this.say(`💣 Die Bombe ist scharf – Mindesttempo ${this.cfg.minSpeed} km/h!`, 'bad'); }
      if (this.kmh() < this.cfg.minSpeed) this.slowT += dt; else this.slowT = 0;
      if (this.slowT >= this.cfg.fuse) {
        this.h.explode(v);
        this.winHunters(`BOOM! Der Bus war zu langsam.`);
        return;
      }
    }
    if (this.goal && Math.hypot(c.x - this.goal.x, c.z - this.goal.z) < this.cfg.goal.radius) { this.winBus('Ziel erreicht!'); return; }
    this.respawnHunters(dt, c);
    this.clearAhead(c);
  }

  /** „Die Polizei hält die Strecke frei“: fahrender Verkehr weit vor dem Bus (außer Sicht) verschwindet. */
  private clearAhead(c: { x: number; z: number; vx: number; vz: number; a: number }) {
    const ct = this.cfg.clearTraffic;
    if (!ct.enabled) return;
    const sp = Math.hypot(c.vx, c.vz);
    const fx = sp > 2 ? c.vx / sp : Math.sin(c.a), fz = sp > 2 ? c.vz / sp : Math.cos(c.a);
    for (const v of [...this.h.vehicles.values()]) {
      if (v.driver !== DRIVER_NPC || v.race !== undefined || v.cop !== undefined || v.qrun) continue;
      const dx = v.sim.car.x - c.x, dz = v.sim.car.z - c.z;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along > ct.from && along < ct.to && lat < ct.width) this.h.removeVehicle(v.id);
    }
  }

  /** Zerstörte, versunkene, überschlagene oder abgehängte Jäger: neu vor dem Bus. */
  private respawnHunters(dt: number, bc: { x: number; z: number; vx: number; vz: number }) {
    for (const p of this.parts) {
      if (p === this.bus || !p.alive) continue;
      const ai = this.ai.get(p.key)!;
      const v = this.vehicle(p);
      const dead = !v || v.sim.dmg.wreck > 0 || v.sim.dmg.burn > 0 || (carInWater(this.h.map, v.sim.car) && v.sim.car.y < 1) || p.flipT > 4;
      const lost = !!v && !!p.bot && Math.hypot(v.sim.car.x - bc.x, v.sim.car.z - bc.z) > this.cfg.lostDistance;
      if (!dead && !lost) { ai.deadT = 0; continue; }
      if (dead && ai.deadT === 0) this.tell(p, `Fahrzeug weg – neues in ${this.cfg.hunterRespawn} s.`, 'bad');
      ai.deadT += dt;
      if (dead && ai.deadT < this.cfg.hunterRespawn) continue;
      const sp = Math.hypot(bc.vx, bc.vz) || 1;
      const ax = bc.x + (bc.vx / sp) * this.cfg.respawnAhead, az = bc.z + (bc.vz / sp) * this.cfg.respawnAhead;
      const spot = this.roadSpot(ax, az, 0, 60, bc.x, bc.z);
      if (!spot) continue;
      this.respawnVehicle(p, spot, this.randomVariant(this.cfg.hunterVehicles));
      ai.deadT = 0; ai.path = []; ai.plan = 0;
    }
  }

  /** Jäger scheiden nie aus (sie kommen neu ins Spiel); der Bus durch Wasser oder Aussteigen. */
  protected outReason(p: Participant, v: ServerVehicle | undefined): string {
    return p === this.bus ? super.outReason(p, v) : '';
  }

  protected checkWin() {
    if (this.bus && !this.bus.alive) this.winHunters(`${this.bus.name} ist raus.`);
  }

  protected onTimeUp() { if (this.bus) this.winBus(`${Math.round(this.cfg.timeLimit / 60 * 10) / 10} Minuten überlebt!`); }

  damageScale(victim: ServerVehicle, other: ServerVehicle | null) {
    const bv = this.busV();
    return bv && victim === bv && other?.race === MG_MARK ? this.cfg.busDamageScale : 1;
  }

  protected onCollide(a: Participant, b: Participant, col: CarCollision) {
    if (col.vn < 3 || (a !== this.bus && b !== this.bus)) return;
    const hunter = a === this.bus ? b : a;
    const ai = this.ai.get(hunter.key);
    if (ai) ai.rams++;
  }

  // ------------------------------------------------------------------ NPCs
  private traffic(e: RoadEdge): number {
    const [mx, mz] = e.pts[Math.floor(e.pts.length / 2)];
    let n = 0;
    for (const v of this.h.vehicles.values()) if (v.race === undefined && dist2(v.sim.car.x, v.sim.car.z, mx, mz) < 25 * 25) n++;
    return n;
  }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver, dt: number) {
    const c = v.sim.car;
    const speed = Math.hypot(c.vx, c.vz);
    if (p === this.bus) {
      // Straßenfolger: gerade, breite, leere Straßen, Richtung Ziel
      const A = this.cfg.busAI, nodes = this.h.map.nodes, g = this.goal;
      const look = this.follower.nodeDist < 25 ? 6 + speed * 0.3 : 10 + speed * 0.9;
      const target = this.follower.target(c, look, (e, from, _turn) => {
        let cost = this.traffic(e) * A.trafficCost - e.lanes * A.lanesBonus + (A.roadTypeCost[e.type] ?? 0);
        if (g) {
          const w = nodes[e.a === from ? e.b : e.a], f = nodes[from];
          cost += ((Math.hypot(w.x - g.x, w.z - g.z) - Math.hypot(f.x - g.x, f.z - g.z)) / Math.max(20, e.len)) * A.goalBonus;
        }
        // Scharfe Abbiegungen schafft der Bus mit Mindesttempo kaum → nur wenn es nicht anders geht
        if (_turn > 1.0) cost += A.sharpTurnCost;
        return cost * (A.turnCost / 40);
      });
      // Vor Kurven auf knapp über das Mindesttempo bremsen (nie darunter)
      const minV = this.cfg.minSpeed / 3.6 + 1.5, f = this.follower;
      const near = f.nodeDist < 25 + speed * 2.2;
      const want = near && f.turnAhead > 1.0 ? minV : near && f.turnAhead > 0.5 ? minV + 4 : 19;
      bot.begin(c, want);
      bot.steerTo(target[0], target[1]);
      // Verkehr voraus: ausweichen statt auffahren
      const fx = Math.sin(c.a), fz = Math.cos(c.a);
      for (const o of this.h.vehicles.values()) {
        if (o === v || (o.race !== undefined && o.race !== MG_MARK)) continue; // Verkehr, Jäger und Falschparker direkt voraus umfahren
        const dx = o.sim.car.x - c.x, dz = o.sim.car.z - c.z;
        const ahead = dx * fx + dz * fz;
        // Hindernis in der Spur: Ziel seitlich versetzen (an der Seite vorbei, auf der mehr Platz ist)
        const lat = dx * fz - dz * fx;
        if (ahead > 0 && ahead < 15 + speed * 1.6 && Math.abs(lat) < (o.home ? 2.2 : 3.5)) {
          const side = lat > 0 ? -1 : 1;
          bot.steerTo(target[0] + fz * side * 3.5, target[1] - fx * side * 3.5);
          break;
        }
      }
      bot.avoidHazard(this.arena, 0.6);
      return;
    }
    const ai = this.ai.get(p.key)!;
    const bv = this.busV();
    if (!bv || this.elapsed < this.cfg.hunterHeadStart) { bot.begin(c, 0); return; }
    const b = bv.sim.car;
    const d = Math.hypot(b.x - c.x, b.z - c.z);
    bot.begin(c, 30);
    if (d < 40) {
      // Nahkampf: vor den Bus setzen (Weg abschneiden) und rammen
      bot.block(b.x, b.z, b.vx, b.vz, 1.2, this.goal ?? undefined);
      bot.chaseTarget(b.x, b.z, b.vx, b.vz, 0.9, { through: 2 });
      bot.avoidHazard(this.arena, 0.5);
      return;
    }
    // Ziel-Knoten: Sperre auf der vorausberechneten Route oder Verfolgung
    let node: number;
    if (ai.blocker) {
      node = this.bus?.bot ? (this.follower.after >= 0 ? this.follower.after : this.follower.to) : this.nav.nearestNode(b.x + b.vx * 5, b.z + b.vz * 5);
      const n = this.h.map.nodes[node];
      if (n && Math.hypot(n.x - c.x, n.z - c.z) < 10) {
        // An der Sperre: stehen bleiben, solange der Bus herankommt
        const approaching = (n.x - b.x) * b.vx + (n.z - b.z) * b.vz > 0;
        if (approaching && Math.hypot(n.x - b.x, n.z - b.z) < 120) { bot.begin(c, 0); return; }
      }
    } else node = this.nav.nearestNode(b.x, b.z);
    ai.plan -= dt;
    if (ai.plan <= 0 || !ai.path.length) { ai.path = this.nav.path(c, node); ai.plan = 1.2 + Math.random() * 0.6; }
    RoadNav.advance(ai.path, c);
    if (ai.path.length) bot.steerTo(ai.path[0][0], ai.path[0][1]);
    else bot.chaseTarget(b.x, b.z, b.vx, b.vz, 1);
    bot.avoidHazard(this.arena, 0.6);
  }

  // ------------------------------------------------------------------ Anzeige
  protected hudInfo(me: Participant | undefined): HudExtra {
    if (this.phase !== 'run' || !this.bus) return {};
    const kmh = Math.round(this.kmh()), min = this.cfg.minSpeed;
    const armed = this.elapsed >= this.cfg.armAfter;
    const bar = { label: `${kmh} km/h (min ${min})`, value: Math.min(1, kmh / (min * 2)), warn: armed && kmh < min + this.cfg.warnMargin };
    const bv = this.busV();
    const toGoal = this.goal && bv ? ` · Ziel ${Math.round(Math.hypot(bv.sim.car.x - this.goal.x, bv.sim.car.z - this.goal.z))} m` : '';
    if (me === this.bus) {
      return {
        info: armed ? `💣 Scharf! Nie unter ${min} km/h${toGoal}` : `Bombe scharf in ${Math.ceil(this.cfg.armAfter - this.elapsed)} s${toGoal}`,
        warn: bar.warn, bar,
        alert: armed && this.slowT > 0 ? `ZU LANGSAM! BOOM in ${Math.max(0, this.cfg.fuse - this.slowT).toFixed(1)} s` : undefined,
      };
    }
    const ai = me ? this.ai.get(me.key) : undefined;
    const respawn = ai && ai.deadT > 0 ? ` · neues Fahrzeug in ${Math.max(0, Math.ceil(this.cfg.hunterRespawn - ai.deadT))} s` : '';
    return { info: `🚌 ${this.bus.name}: ${kmh} km/h${toGoal}${respawn}`, warn: bar.warn, bar };
  }

  protected targets(me: Participant | undefined): QuestState['targets'] {
    const out: QuestState['targets'] = [];
    const r = (n: number) => Math.round(n * 10) / 10;
    if (this.goal) out.push([r(this.goal.x), r(this.goal.z), this.cfg.goal.radius, 1]);
    const bv = this.busV();
    if (bv && me !== this.bus) out.push([r(bv.sim.car.x), r(bv.sim.car.z), 4, 5]);
    return out;
  }

  protected spectatePoint(): [number, number] {
    const v = this.busV();
    return v ? [v.sim.car.x, v.sim.car.z] : [this.arena.cx, this.arena.cz];
  }

  protected scoreText(p: Participant) {
    if (p === this.bus) return 'Bus';
    return `${this.ai.get(p.key)?.rams ?? 0} Rammstöße`;
  }
}
