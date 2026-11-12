// Fahr-HUD: Tacho (km/h), Gang, Drehzahl, Nitro, Fahrzeugzustand; Drift-Zähler mit
// Multiplikator, Bonus-Einblendungen (Drift, Sprung, Beinahe-Unfall) und Kontostand.

const $ = (id: string) => document.getElementById(id)!;

export interface DriveInfo {
  speed: number; gear: number; rpm: number; redline: number;
  nitro: number; hasNitro: boolean; hp: number; burning: boolean;
  /** Luftfahrzeug: Höhe über Grund (m), Steigrate (m/s), Höhenstufe 0–2, Tank 0..1 (null = aus), Strömungsabriss */
  air?: { alt: number; vs: number; level: number; fuel: number | null; stall: boolean };
}
const LEVELS = ['BODEN', 'TIEF', 'HOCH'];

export class DriveHud {
  private root = $('drive-hud');
  private speedEl = $('dh-speed');
  private gearEl = $('dh-gear');
  private rpmEl = $('dh-rpm') as HTMLDivElement;
  private nitroEl = $('dh-nitro') as HTMLDivElement;
  private nitroWrap = $('dh-nitro-wrap');
  private hpEl = $('dh-hp') as HTMLDivElement;
  private airEl = $('dh-air');
  private altEl = $('dh-alt');
  private vsEl = $('dh-vs');
  private levelEl = $('dh-level');
  private fuelWrap = $('dh-fuel-wrap');
  private fuelEl = $('dh-fuel') as HTMLDivElement;
  private stallEl = $('dh-stall');
  private driftEl = $('drift');
  private driftPts = $('drift-pts');
  private driftMul = $('drift-mul');
  private bonusEl = $('bonus');
  private moneyEl = $('hud-money');
  private lastMoney = -1;
  private visible = false;
  private driftShown = false;

  set(info: DriveInfo | null) {
    if (!info) { if (this.visible) { this.root.classList.add('hidden'); this.visible = false; } return; }
    if (!this.visible) { this.root.classList.remove('hidden'); this.visible = true; }
    this.speedEl.textContent = String(Math.round(Math.abs(info.speed) * 3.6));
    this.gearEl.textContent = info.gear < 0 ? 'R' : String(info.gear);
    const r = Math.min(1, info.rpm / info.redline);
    this.rpmEl.style.width = `${(r * 100).toFixed(1)}%`;
    this.rpmEl.classList.toggle('red', r > 0.9);
    this.nitroWrap.classList.toggle('hidden', !info.hasNitro);
    this.nitroEl.style.width = `${(info.nitro * 100).toFixed(1)}%`;
    const hp = Math.max(0, info.hp / 1000);
    this.hpEl.style.width = `${(hp * 100).toFixed(1)}%`;
    this.hpEl.className = hp < 0.15 || info.burning ? 'crit' : hp < 0.35 ? 'low' : hp < 0.6 ? 'mid' : '';
    const a = info.air;
    this.airEl.classList.toggle('hidden', !a);
    if (a) {
      this.altEl.textContent = String(Math.round(a.alt));
      this.vsEl.textContent = Math.abs(a.vs) < 0.3 ? '–' : `${a.vs > 0 ? '▲' : '▼'}${Math.abs(a.vs).toFixed(1)}`;
      this.levelEl.textContent = LEVELS[a.level] ?? '';
      this.levelEl.className = `l${a.level}`;
      this.fuelWrap.classList.toggle('hidden', a.fuel === null);
      if (a.fuel !== null) { this.fuelEl.style.width = `${(a.fuel * 100).toFixed(1)}%`; this.fuelEl.className = a.fuel < 0.15 ? 'low' : ''; }
      this.stallEl.classList.toggle('hidden', !a.stall);
      this.gearEl.textContent = a.level === 0 ? '⬤' : '✈';
    }
  }

  /** Laufender Drift (lokal vorhergesagt): Punkte + Multiplikator; null = kein Drift. */
  drift(points: number | null, mul: number) {
    if (points === null || points < 15) {
      if (this.driftShown) { this.driftEl.classList.add('hidden'); this.driftShown = false; }
      return;
    }
    if (!this.driftShown) { this.driftEl.classList.remove('hidden'); this.driftShown = true; }
    this.driftPts.textContent = String(Math.round(points));
    this.driftMul.textContent = `x${mul}`;
    this.driftMul.dataset.mul = String(mul);
  }

  /** Bonus-Einblendung (vom Server bestätigt, mit Geld). */
  bonus(kind: string, points: number, money: number, info: string) {
    const title = kind === 'drift' ? 'DRIFT' : kind === 'stunt' ? 'STUNT' : kind === 'near' ? 'KNAPP!' : 'DRIFT VERLOREN';
    const el = document.createElement('div');
    el.className = `bonus ${kind}`;
    const h = document.createElement('b');
    h.textContent = title;
    const p = document.createElement('span');
    p.textContent = kind === 'driftFail' ? 'Crash!' : `${points} Pkt${info ? ' · ' + info : ''}`;
    el.append(h, p);
    if (money > 0) {
      const m = document.createElement('i');
      m.textContent = `+$${money}`;
      el.append(m);
    }
    this.bonusEl.appendChild(el);
    while (this.bonusEl.children.length > 4) this.bonusEl.firstChild!.remove();
    setTimeout(() => el.remove(), 2600);
  }

  money(total: number) {
    if (total === this.lastMoney) return;
    const up = this.lastMoney >= 0 && total > this.lastMoney;
    this.lastMoney = total;
    this.moneyEl.textContent = `$${total.toLocaleString('de-DE')}`;
    if (up) { this.moneyEl.classList.remove('pop'); void this.moneyEl.offsetWidth; this.moneyEl.classList.add('pop'); }
  }
}
