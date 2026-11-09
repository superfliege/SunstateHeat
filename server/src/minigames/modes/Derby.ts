// Destruction Derby: geschlossene Bowl (Plattform mit Bande), alle gegen alle.
// Ausscheiden: Auto zerstört (0 HP / brennt / Wrack), Motor tot (Motorschaden ≥ engineDead)
// oder zu lange auf dem Dach. Zeitlimit: die meisten HP gewinnen.
// Schaden: Aufprall-Tempo × Zonenfaktor (Front robust, Heck/Seite empfindlich), Wände schwächer.
// NPCs: ChaseTarget auf nahe bzw. geschwächte Gegner; mit wenig HP Flee und nur noch
// Gelegenheitsangriffe auf schwächere Gegner in der Nähe.
import { toLocal } from '../../../../shared/src/sim/car';
import { Zone5 } from '../../../../shared/src/sim/damage';
import type { DerbyConfig } from '../../../../shared/src/minigames';
import type { ServerVehicle } from '../../entities/types';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, type HudExtra, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';

const tmp = [0, 0, 0];

export class Derby extends Minigame<DerbyConfig> {
  constructor(h: MinigameHost, opts: MinigameOptions) { super(h, 'derby', opts); }

  protected tick() {}

  private hp(p: Participant) { const v = this.vehicle(p); return v ? Math.max(0, v.sim.dmg.hp) : 0; }

  /** Zonenabhängiger Schaden: Kontaktpunkt im Fahrzeug bestimmt Front/Heck/Seite. */
  damageScale(victim: ServerVehicle, other: ServerVehicle | null, x: number, z: number) {
    if (victim.race !== MG_MARK || this.phase !== 'run') return this.phase === 'run' ? 1 : 0;
    const d = this.cfg.damage, c = victim.sim.car, pr = victim.sim.prof;
    if (!other) return d.scale * d.wall;
    toLocal(c, x, c.y, z, tmp); // x links, z vorne
    const fz = tmp[2] / (pr.length / 2), fx = tmp[0] / (pr.width / 2);
    const zone = Math.abs(fz) * 0.8 > Math.abs(fx) ? (fz > 0 ? d.front : d.rear) : d.side;
    return d.scale * zone;
  }

  protected outReason(p: Participant, v: ServerVehicle | undefined): string {
    if (v) {
      const dm = v.sim.dmg;
      if (dm.wreck || dm.burn > 0 || dm.hp <= 0) return 'wurde zu Schrott gefahren';
      if (dm.zones[Zone5.ENGINE] >= this.cfg.engineDead) return 'hat einen Motorschaden';
    }
    return super.outReason(p, v);
  }

  protected onTimeUp() {
    const gap = this.cfg.tieGap;
    const sorted = this.alive().sort((a, b) => this.hp(b) - this.hp(a));
    const groups: Participant[][] = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && this.hp(g[0]) - this.hp(p) < gap) g.push(p); else groups.push([p]);
    }
    const win = groups[0] ?? [];
    this.finish(groups, win.length > 1 ? 'Zeit abgelaufen – Gleichstand bei den HP!' : `Zeit abgelaufen – ${win[0]?.name ?? 'niemand'} hat die meisten HP!`);
  }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver) {
    const c = v.sim.car, ai = this.cfg.botAI;
    const mine = this.hp(p) / 1000;
    const weak = mine < ai.fleeBelow;
    let target: ServerVehicle | null = null, best = Infinity, threat: ServerVehicle | null = null, td = Infinity;
    for (const o of this.alive()) {
      if (o === p) continue;
      const ov = this.vehicle(o);
      if (!ov) continue;
      const d = Math.hypot(ov.sim.car.x - c.x, ov.sim.car.z - c.z);
      if (d < td) { td = d; threat = ov; }
      // nahe und geschwächte Gegner bevorzugen
      const score = d + (ov.sim.dmg.hp / 1000) * 25;
      if (score < best) { best = score; target = ov; }
    }
    bot.begin(c, weak ? 14 : 17);
    const cz = this.arena.zone('center');
    if (!weak && target) {
      const t = target.sim.car;
      bot.chaseTarget(t.x, t.z, t.vx, t.vz, 1.2, { through: 3 });
      bot.holdZone(cz.x, cz.z, this.arena.radius * 0.6, 0.3);
    } else {
      if (threat) bot.flee(threat.sim.car.x, threat.sim.car.z, 1.4, 30);
      // Gelegenheitsangriff: schwächerer Gegner ganz nah
      if (target && Math.hypot(target.sim.car.x - c.x, target.sim.car.z - c.z) < ai.opportunisticRange && target.sim.dmg.hp < this.hp(p)) {
        const t = target.sim.car;
        bot.chaseTarget(t.x, t.z, t.vx, t.vz, 0.9, { through: 2 });
      }
      bot.holdZone(cz.x, cz.z, this.arena.radius * 0.5, 0.4);
    }
    bot.avoidHazard(this.arena, 0.9);
  }

  protected hudInfo(me: Participant | undefined): HudExtra {
    if (this.phase !== 'run') return {};
    if (!me || !me.alive) {
      const top = this.alive().sort((a, b) => this.hp(b) - this.hp(a))[0];
      return top ? { info: `Stärkster: ${top.name} (${Math.round(this.hp(top) / 10)} %)` } : {};
    }
    const v = this.vehicle(me);
    const hp = this.hp(me) / 1000;
    const engine = v ? 1 - v.sim.dmg.zones[Zone5.ENGINE] : 0;
    return {
      info: `Motor ${Math.round(engine * 100)} % · ${me.score} Abschüsse`, warn: hp < 0.3 || engine < 0.3,
      bar: { label: 'Zustand', value: hp, warn: hp < 0.3 },
      alert: v && v.sim.dmg.burn > 0 ? 'DEIN AUTO BRENNT!' : undefined,
    };
  }

  protected scoreText(p: Participant) {
    const hp = Math.round(this.hp(p) / 10);
    return `${hp ? `${hp} % · ` : ''}${p.score} Abschüsse`;
  }
}
