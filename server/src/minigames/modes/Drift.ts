// Drift-Wettbewerb: Punkte für Drifts in der Drift-Zone (Winkel, Tempo, Dauer, Combo-Kette).
// Wand- oder Fahrzeugkontakt löscht den laufenden Drift und setzt die Combo zurück.
// Zeitlimit, höchste Punktzahl gewinnt. Wertung: shared/minigames/drift.ts (gleiche Erkennung wie
// das Stunt-System, damit auch Rennen sie nutzen können).
// NPCs: fahren die feste Driftlinie der Arena mit Drift-Assistent; ihre Punkte sind eine je Stufe
// festgelegte Rate mit zufälliger Streuung (sie sollen nicht perfekt sein, aber mithalten).
import { BOT_DIFFICULTIES, type DifficultyId, type DriftConfig } from '../../../../shared/src/minigames';
import { breakDrift, endDrift, newDriftMeter, stepDrift, type DriftMeter } from '../../../../shared/src/minigames/drift';
import type { ServerVehicle } from '../../entities/types';
import type { Spot } from '../Arena';
import type { BotDriver } from '../BotDriver';
import { MG_MARK, Minigame, type HudExtra, type MinigameHost, type MinigameOptions, type Participant } from '../Minigame';

export class Drift extends Minigame<DriftConfig> {
  private meters = new Map<number, DriftMeter>();
  private botPts = new Map<number, { pts: number; noise: number; t: number }>();

  constructor(h: MinigameHost, opts: MinigameOptions) { super(h, 'drift', opts); }

  private line(): [number, number][] {
    const rel = this.arena.def.lines?.[this.cfg.line] ?? [];
    return rel.map(([x, z]) => [this.arena.cx + x, this.arena.cz + z]);
  }

  /** Startplätze gleichmäßig auf der Driftlinie, Blick in Fahrtrichtung. */
  protected spawnSpots(n: number): Spot[] {
    const L = this.line();
    if (L.length < 2) return super.spawnSpots(n);
    const out: Spot[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.floor((i * L.length) / n), [x, z] = L[k], [nx, nz] = L[(k + 1) % L.length];
      out.push({ x, z, a: Math.atan2(nx - x, nz - z) });
    }
    return out;
  }

  private points(p: Participant) { return p.bot ? Math.round(this.botPts.get(p.key)?.pts ?? 0) : this.meter(p).total; }
  private meter(p: Participant) { let m = this.meters.get(p.key); if (!m) { m = newDriftMeter(); this.meters.set(p.key, m); } return m; }

  private inZone(x: number, z: number) {
    const zn = this.arena.zone(this.cfg.zone);
    return Math.hypot(x - zn.x, z - zn.z) <= zn.r;
  }

  protected tick(dt: number) {
    for (const p of this.alive()) {
      const v = this.vehicle(p);
      if (!v) continue;
      const c = v.sim.car;
      if (p.bot) {
        // NPC: Punkte nach Stufe mit Streuung (alle paar Sekunden neu ausgewürfelt)
        let b = this.botPts.get(p.key);
        if (!b) { b = { pts: 0, noise: 1, t: 0 }; this.botPts.set(p.key, b); }
        b.t -= dt;
        if (b.t <= 0) { b.t = 3 + Math.random() * 3; b.noise = 1 + (Math.random() * 2 - 1) * this.cfg.botSpread; }
        const id = (Object.keys(BOT_DIFFICULTIES) as DifficultyId[]).find((k) => BOT_DIFFICULTIES[k] === p.bot!.diff) ?? 'normal';
        if (Math.hypot(c.vx, c.vz) > 6 && this.inZone(c.x, c.z)) b.pts += this.cfg.botRate[id] * b.noise * dt;
        continue;
      }
      const m = this.meter(p);
      const pts = stepDrift(m, c, dt, this.inZone(c.x, c.z), this.cfg);
      if (pts >= 150) this.tell(p, `Drift +${pts}${m.mult > 1 ? ` (×${m.mult})` : ''}`, 'good');
      if (pts >= 1500) this.log(`🌀 ${p.name}: Monster-Drift +${pts}`);
    }
  }

  private contact(p: Participant) {
    if (p.bot) return;
    const m = this.meter(p);
    const lost = Math.round(m.cur * m.mult);
    if (breakDrift(m) && lost > 50) this.tell(p, `Kontakt! Drift verloren (−${lost})`, 'bad');
  }

  protected onCollide(a: Participant, b: Participant, col: { vn: number }) {
    if (col.vn < this.cfg.contactDv) return;
    this.contact(a); this.contact(b);
  }

  protected onImpact(p: Participant, _v: ServerVehicle, dv: number) {
    if (dv >= this.cfg.contactDv) this.contact(p);
  }

  damageScale(victim: ServerVehicle) { return victim.race === MG_MARK ? this.cfg.damageScale : 1; }

  protected botThink(p: Participant, v: ServerVehicle, bot: BotDriver) {
    const c = v.sim.car, L = this.line();
    bot.begin(c, 15);
    if (L.length) {
      let k = 0, bd = Infinity;
      for (let i = 0; i < L.length; i++) { const d = Math.hypot(L[i][0] - c.x, L[i][1] - c.z); if (d < bd) { bd = d; k = i; } }
      const speed = Math.hypot(c.vx, c.vz);
      const [tx, tz] = L[(k + 2 + Math.floor(speed / 10)) % L.length];
      bot.seek(tx, tz, 1.4);
      bot.driftStyle();
    }
    bot.avoidHazard(this.arena, 0.8);
  }

  protected checkWin() {
    if (!this.alive().length) this.finish([], 'Niemand mehr auf dem Ring.');
  }

  protected onTimeUp() {
    for (const p of this.parts) if (!p.bot) endDrift(this.meter(p)); // laufender Drift zählt noch
    const sorted = this.alive().sort((a, b) => this.points(b) - this.points(a));
    const groups: Participant[][] = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && this.points(g[0]) === this.points(p)) g.push(p); else groups.push([p]);
    }
    const w = groups[0] ?? [];
    this.finish(groups, w.length > 1 ? `Gleichstand mit ${this.points(w[0])} Punkten!` : `${w[0]?.name ?? 'Niemand'} gewinnt mit ${this.points(w[0]).toLocaleString('de-DE')} Punkten!`);
  }

  private rank(me: Participant) {
    const mine = this.points(me);
    return 1 + this.parts.filter((q) => q !== me && this.points(q) > mine).length;
  }

  protected hudInfo(me: Participant | undefined): HudExtra {
    if (this.phase !== 'run') return {};
    if (!me || !me.alive || me.bot) {
      const lead = [...this.parts].sort((a, b) => this.points(b) - this.points(a))[0];
      return lead ? { info: `Führend: ${lead.name} (${this.points(lead).toLocaleString('de-DE')})` } : {};
    }
    const m = this.meter(me), r = this.cfg;
    const head = `Platz ${this.rank(me)} · ${m.total.toLocaleString('de-DE')} P`;
    if (m.active) return { info: `${head} · Drift ${Math.round(m.cur)} ×${m.mult}`, bar: { label: `Combo ×${m.mult}`, value: 1, warn: false } };
    if (m.mult > 1) return { info: `${head} · Combo ×${m.mult} – weiter!`, warn: true, bar: { label: `Combo ×${m.mult}`, value: Math.max(0, 1 - m.sinceEnd / r.chainWindow), warn: true } };
    return { info: `${head} · Drifte in der Zone!` };
  }

  protected scoreText(p: Participant) {
    const best = p.bot ? '' : ` · bester ${this.meter(p).best.toLocaleString('de-DE')}`;
    return `${this.points(p).toLocaleString('de-DE')} P${best}`;
  }
}
