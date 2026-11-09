// Hot Potato / Bombenauto: Ein zufälliger Teilnehmer startet mit der Bombe (sichtbarer Countdown).
// Rammen überträgt sie; der Abgebende ist kurz geschützt (passImmunity), damit sie nicht sofort
// zurückwandert. Zünder abgelaufen → Träger explodiert und scheidet aus, kurze Pause, neue
// Runde mit neuem zufälligen Träger. Sieger: letzter Überlebender.
// NPCs: mit Bombe ChaseTarget auf den nächsten (nicht geschützten) Gegner, ohne Bombe Flee vom Träger.
import type { CarCollision } from '../../../../shared/src/sim/car';
import type { HotPotatoConfig } from '../../../../shared/src/minigames';
import type { QuestState } from '../../../../shared/src/protocol';
import type { ServerVehicle } from '../../entities/types';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, type HudExtra, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';

export class HotPotato extends Minigame<HotPotatoConfig> {
  /** Träger (Participant.key), -1 = niemand (Pause zwischen den Runden). */
  private holder = -1;
  private fuse = 0;
  private fuseMax = 1;
  private round = 0;
  private pauseT = 0;
  /** Bis wann jemand geschützt ist (Spielzeit). */
  private immune = new Map<number, number>();
  private passes = new Map<number, number>();
  private blockUntil = 0;

  constructor(h: MinigameHost, opts: MinigameOptions) { super(h, 'hotpotato', opts); }

  private get holderPart() { return this.parts.find((p) => p.key === this.holder && p.alive); }

  protected onStart() { this.newRound(); }

  private newRound() {
    const alive = this.alive();
    if (alive.length < 2) return;
    const f = this.cfg.fuse;
    this.fuseMax = this.fuse = Math.max(f.min, f.start + f.step * this.round);
    this.round++;
    const p = alive[Math.floor(Math.random() * alive.length)];
    this.holder = p.key;
    this.immune.clear();
    this.log(`💣 Runde ${this.round}: ${p.name} hat die Bombe (${Math.round(this.fuse)} s)!`);
    this.tell(p, 'DU HAST DIE BOMBE! Ramm jemanden, um sie loszuwerden!', 'bad');
  }

  protected tick(dt: number) {
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.newRound();
      return;
    }
    const h = this.holderPart;
    if (!h) {
      // Träger ist anders ausgeschieden (Sturz, Disconnect …): neue Runde
      if (this.holder >= 0) { this.holder = -1; this.pauseT = this.cfg.roundPause; }
      return;
    }
    this.fuse -= dt;
    if (this.fuse > 0) return;
    const v = this.vehicle(h);
    if (v) this.h.explode(v);
    this.eliminate(h, 'ist mit der Bombe explodiert');
    this.holder = -1;
    this.pauseT = this.cfg.roundPause;
  }

  damageScale(victim: ServerVehicle) { return victim.race === MG_MARK ? this.cfg.damageScale : 1; }

  /** Rammen gibt die Bombe weiter (nicht an Geschützte, nicht zweimal im selben Moment). */
  protected onCollide(a: Participant, b: Participant, col: CarCollision) {
    if (this.holder < 0 || col.vn < this.cfg.passMinSpeed || this.elapsed < this.blockUntil) return;
    const from = a.key === this.holder ? a : b.key === this.holder ? b : null;
    if (!from) return;
    const to = from === a ? b : a;
    if ((this.immune.get(to.key) ?? 0) > this.elapsed) return;
    this.holder = to.key;
    this.immune.set(from.key, this.elapsed + this.cfg.passImmunity);
    this.blockUntil = this.elapsed + 0.3;
    this.passes.set(from.key, (this.passes.get(from.key) ?? 0) + 1);
    this.log(`💣 ${from.name} → ${to.name}`);
    this.tell(to, 'DU HAST DIE BOMBE!', 'bad');
    this.tell(from, `Bombe an ${to.name} weitergegeben!`, 'good');
  }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver) {
    const c = v.sim.car;
    const cz = this.arena.zone('center');
    const h = this.holderPart;
    if (h === p) {
      // Bombe: nächsten nicht geschützten Gegner rammen
      let best: ServerVehicle | null = null, bd = Infinity;
      for (const o of this.alive()) {
        if (o === p || (this.immune.get(o.key) ?? 0) > this.elapsed) continue;
        const ov = this.vehicle(o);
        if (!ov) continue;
        const d = Math.hypot(ov.sim.car.x - c.x, ov.sim.car.z - c.z);
        if (d < bd) { bd = d; best = ov; }
      }
      bot.begin(c, 19);
      if (best) bot.chaseTarget(best.sim.car.x, best.sim.car.z, best.sim.car.vx, best.sim.car.vz, 1.5, { through: 3 });
      bot.avoidHazard(this.arena, 0.8);
      return;
    }
    bot.begin(c, 16);
    const hv = h ? this.vehicle(h) : undefined;
    if (hv) bot.flee(hv.sim.car.x, hv.sim.car.z, 1.6, 35);
    bot.holdZone(cz.x, cz.z, this.arena.radius * 0.55, 0.5);
    bot.avoidHazard(this.arena, 1.0);
  }

  protected hudInfo(me: Participant | undefined): HudExtra {
    if (this.phase !== 'run') return {};
    const h = this.holderPart;
    if (!h) return { info: this.pauseT > 0 ? `Neue Bombe in ${Math.ceil(this.pauseT)} s …` : '' };
    const bar = { label: '💣 Zünder', value: this.fuse / this.fuseMax, warn: this.fuse < 5 };
    if (me === h) return { info: 'Ramm jemanden!', warn: true, bar, alert: `💣 DU HAST DIE BOMBE! ${this.fuse.toFixed(1)} s` };
    const imm = me ? (this.immune.get(me.key) ?? 0) - this.elapsed : 0;
    return { info: `💣 ${h.name}: ${Math.ceil(this.fuse)} s${imm > 0 ? ` · du bist geschützt (${imm.toFixed(1)} s)` : ''}`, warn: this.fuse < 5, bar };
  }

  /** Ring über dem Bombenauto für alle. */
  protected targets(me: Participant | undefined): QuestState['targets'] {
    const h = this.holderPart;
    const v = h && h !== me ? this.vehicle(h) : undefined;
    return v ? [[Math.round(v.sim.car.x * 10) / 10, Math.round(v.sim.car.z * 10) / 10, 4, 5]] : [];
  }

  protected spectatePoint(): [number, number] {
    const h = this.holderPart, v = h && this.vehicle(h);
    return v ? [v.sim.car.x, v.sim.car.z] : [this.arena.cx, this.arena.cz];
  }

  protected scoreText(p: Participant) { const n = this.passes.get(p.key) ?? 0; return `${n} × weitergegeben`; }
}
