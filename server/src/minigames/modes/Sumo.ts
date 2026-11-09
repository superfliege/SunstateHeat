// Sumo: kleine runde Plattform über dem Meer. Wer herunterfällt (Wasser), scheidet aus.
// Nach `shrink.after` Sekunden schrumpft die Plattform, damit Runden nicht ewig dauern.
// Kollisionen schieben stärker (pushBoost), Fahrzeugschaden ist aus (damageScale).
// NPCs: Gegner Richtung Rand rammen (bevorzugt solche, die schon nah am Rand stehen),
// selbst zur Mitte zurückstreben, AvoidHazard hoch gewichtet.
import { clamp } from '../../../../shared/src/math';
import { applyImpulse, type CarCollision } from '../../../../shared/src/sim/car';
import { derive } from '../../../../shared/src/sim/handling';
import type { MgHud, SumoConfig } from '../../../../shared/src/minigames';
import type { ServerVehicle } from '../../entities/types';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';

export class Sumo extends Minigame<SumoConfig> {
  private r0 = 0;

  constructor(h: MinigameHost, opts: MinigameOptions) { super(h, 'sumo', opts); }

  protected onStart() { this.r0 = this.arena.radius; }

  private get radius() { return this.arena.floor?.r ?? this.arena.radius; }

  protected tick(_dt: number) {
    const f = this.arena.floor, s = this.cfg.shrink;
    if (!f || !this.r0) return;
    const k = clamp((this.elapsed - s.after) / Math.max(1, s.duration), 0, 1);
    const r = this.r0 + (s.minRadius - this.r0) * k;
    if (Math.abs(r - f.r) > 0.02) f.r = r;
    if (k > 0 && this.elapsed - _dt < s.after) { this.log('⚠ Die Plattform schrumpft!'); this.say('Die Plattform schrumpft!', 'bad'); }
  }

  damageScale(victim: ServerVehicle, _other: ServerVehicle | null) {
    return victim.race === MG_MARK ? this.cfg.damageScale : 1;
  }

  /** Zusätzlicher Schub entlang der Stoßnormalen – Masse und Tempo werden spürbar. */
  protected onCollide(_a: Participant, _b: Participant, col: CarCollision, va: ServerVehicle, vb: ServerVehicle) {
    const extra = col.j * (this.cfg.pushBoost - 1);
    if (extra <= 0) return;
    const A = va.sim.car, B = vb.sim.car;
    applyImpulse(A, derive(va.sim.prof), A.x, A.y, A.z, -col.nx * extra, 0, -col.nz * extra, 0);
    applyImpulse(B, derive(vb.sim.prof), B.x, B.y, B.z, col.nx * extra, 0, col.nz * extra, 0);
  }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver) {
    const c = v.sim.car, cx = this.arena.cx, cz = this.arena.cz, R = this.radius;
    const myEdge = R - Math.hypot(c.x - cx, c.z - cz);
    // Ziel: nahe Gegner, bevorzugt die, die schon am Rand stehen
    let target: ServerVehicle | null = null, best = Infinity;
    for (const o of this.alive()) {
      if (o === p) continue;
      const ov = this.vehicle(o);
      if (!ov) continue;
      const oc = ov.sim.car;
      const d = Math.hypot(oc.x - c.x, oc.z - c.z);
      const theirEdge = R - Math.hypot(oc.x - cx, oc.z - cz);
      const score = d + theirEdge * 1.5;
      if (score < best) { best = score; target = ov; }
    }
    const danger = myEdge < 6;
    bot.begin(c, danger ? 8 : 13);
    if (target) {
      const t = target.sim.car;
      // Aggressiver, wenn ich sicher in der Mitte stehe
      bot.chaseTarget(t.x, t.z, t.vx, t.vz, danger ? 0.5 : 1.1, { pushX: t.x - cx, pushZ: t.z - cz, through: 4 });
    }
    bot.holdZone(cx, cz, R * 0.35, danger ? 1.6 : 0.5);
    bot.avoidHazard(this.arena, 2.2);
  }

  protected onTimeUp() {
    const cx = this.arena.cx, cz = this.arena.cz;
    const alive = this.alive();
    if (this.cfg.timeUp === 'tie' || alive.length <= 1) { super.onTimeUp(); return; }
    const dist = (p: Participant) => { const v = this.vehicle(p); return v ? Math.hypot(v.sim.car.x - cx, v.sim.car.z - cz) : 1e9; };
    const sorted = alive.map((p) => ({ p, d: dist(p) })).sort((a, b) => a.d - b.d);
    // Gruppen: weniger als 0,5 m Unterschied = Gleichstand
    const groups: Participant[][] = [];
    for (const s of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(dist(g[0]) - s.d) < 0.5) g.push(s.p); else groups.push([s.p]);
    }
    const win = groups[0];
    this.finish(groups, win.length > 1 ? 'Zeit abgelaufen – Gleichstand in der Mitte!' : `Zeit abgelaufen – ${win[0].name} steht der Mitte am nächsten!`);
  }

  protected hudInfo(): Pick<MgHud, 'info' | 'warn' | 'bar'> {
    const s = this.cfg.shrink;
    if (this.phase !== 'run' || !this.r0) return {};
    const left = s.after - this.elapsed;
    const size = clamp((this.radius - s.minRadius) / Math.max(0.1, this.r0 - s.minRadius), 0, 1);
    if (left > 0) return { info: `Plattform schrumpft in ${Math.ceil(left)} s`, warn: left < 6, bar: { label: 'Plattform', value: 1, warn: false } };
    return { info: `Plattform schrumpft! Radius ${this.radius.toFixed(1)} m`, warn: true, bar: { label: 'Plattform', value: size, warn: true } };
  }

  protected scoreText(p: Participant) { return p.score ? `${p.score} × runtergeschubst` : ''; }
}
