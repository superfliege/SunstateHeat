// HUD: Zone, Uhrzeit, Tempo, Quest-Panel, Hinweise und Einblendungen.
import type { PlayerStats, QuestState } from '../../../shared/src/protocol';
import { WEAPONS, type WeaponId } from '../../../shared/src/weapons';
import { ZONE_NAMES } from '../../../shared/src/world/WorldMap';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private zoneEl = $('hud-zone');
  private clockEl = $('hud-clock');
  private speedEl = $('hud-speed');
  private questEl = $('quest-panel');
  private hintEl = $('hint');
  private bannerEl = $('zone-banner');
  private toastsEl = $('toasts');
  private fpsEl = $('fps');
  private lastZone = -1;
  private lastQuestHtml = '';
  private lastHint: string | null = null;
  private frames = 0;
  private fpsTime = 0;
  private countEl: HTMLDivElement | null = null;
  private lastCount: number | undefined = undefined;

  /** Zone (mit Banner beim Wechsel) und, falls vorhanden, das Viertel davor. */
  setZone(zone: number, district: string | null = null) {
    const label = district && !district.startsWith(ZONE_NAMES[zone]) ? `${district.replace(/ \(.*\)$/, '')} · ${ZONE_NAMES[zone]}` : ZONE_NAMES[zone];
    if (this.zoneEl.textContent !== label) this.zoneEl.textContent = label;
    if (zone === this.lastZone) return;
    const first = this.lastZone === -1;
    this.lastZone = zone;
    if (first) return;
    // Großes Zonen-Banner beim Betreten einer neuen Zone (Animation neu starten)
    this.bannerEl.textContent = ZONE_NAMES[zone];
    this.bannerEl.classList.remove('hidden');
    this.bannerEl.style.animation = 'none';
    void this.bannerEl.offsetWidth;
    this.bannerEl.style.animation = '';
  }

  setClock(day: number) {
    const mins = Math.floor(day * 24 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    this.clockEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  setSpeed(speed: number | null) {
    this.speedEl.textContent = speed === null ? '' : `${Math.round(Math.abs(speed) * 3.6)} km/h`;
  }

  setHint(html: string | null) {
    if (html === this.lastHint) return;
    this.lastHint = html;
    this.hintEl.classList.toggle('hidden', !html);
    if (html) this.hintEl.innerHTML = html; // nur statische, eigene Texte
  }

  /** Großer Renn-Countdown in der Bildmitte (3, 2, 1, LOS!). */
  private setCountdown(n: number | undefined) {
    if (n === this.lastCount) return;
    this.lastCount = n;
    if (!this.countEl) {
      this.countEl = document.createElement('div');
      this.countEl.id = 'race-count';
      document.body.append(this.countEl);
    }
    const el = this.countEl;
    el.classList.toggle('hidden', n === undefined);
    if (n === undefined) return;
    el.textContent = n > 0 ? String(n) : 'LOS!';
    el.classList.toggle('go', n <= 0);
    // Animation neu starten
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }

  /** Auftrags-Anzeige: Titel, aktuelle Stufe, Fortschritt, Timer (bei Rennen zusätzlich Platz/Runde). */
  setQuestState(q: QuestState | null) {
    this.setCountdown(q?.count);
    const sig = q ? JSON.stringify([q.id, q.stage, q.prog, q.timer, q.race]) : '';
    if (sig === this.lastQuestHtml) return;
    this.lastQuestHtml = sig;
    this.questEl.classList.toggle('hidden', !q);
    if (!q) { this.questEl.replaceChildren(); return; }
    const h = document.createElement('h3');
    h.textContent = q.stageCount > 1 ? `${q.title} (${q.stageIdx + 1}/${q.stageCount})` : q.title;
    const els: HTMLElement[] = [h];
    if (q.race) {
      const r = document.createElement('div');
      r.className = 'race';
      const place = document.createElement('span');
      place.className = 'place';
      place.textContent = `${q.race.place}/${q.race.field}`;
      r.append(place);
      if (q.race.laps > 1) { const lap = document.createElement('span'); lap.textContent = `Runde ${q.race.lap}/${q.race.laps}`; r.append(lap); }
      els.push(r);
    }
    if (q.timer >= 0) {
      const t = document.createElement('div');
      t.className = 'timer';
      t.textContent = `${Math.floor(q.timer / 60)}:${String(q.timer % 60).padStart(2, '0')}`;
      els.push(t);
    }
    const s = document.createElement('div');
    s.textContent = q.stage;
    els.push(s);
    if (q.prog) { const p = document.createElement('div'); p.className = 'prog'; p.textContent = q.prog; els.push(p); }
    this.questEl.replaceChildren(...els);
  }

  /** Gesundheit, Rüstung, Stufe/XP und Knockout-Anzeige. */
  setStats(s: PlayerStats) {
    const hpEl = $('st-hp'), arEl = $('st-armor');
    hpEl.style.width = `${Math.min(100, s.hp)}%`;
    hpEl.className = s.hp <= 20 ? 'crit' : s.hp <= 45 ? 'low' : '';
    $('st-hp-n').textContent = String(s.hp);
    arEl.style.width = `${Math.min(100, s.armor)}%`;
    $('st-armor-n').textContent = String(s.armor);
    $('st-armor-row').classList.toggle('hidden', s.armor <= 0);
    $('st-level').textContent = `Lv ${s.level}`;
    $('st-xp').style.width = s.xpNeeded ? `${Math.min(100, (s.xp / s.xpNeeded) * 100)}%` : '100%';
    $('st-xp-n').textContent = s.xpNeeded ? `${s.xp}/${s.xpNeeded}` : 'MAX';
    $('wp-name').textContent = WEAPONS[s.weapon as WeaponId]?.name ?? s.weapon;
    $('wp-ammo').textContent = s.ammo < 0 ? '' : String(s.ammo);
    $('wp-pvp').classList.toggle('hidden', !s.pvp);
    const wl = $('hud-wanted');
    wl.classList.toggle('hidden', s.wanted <= 0);
    wl.classList.toggle('blink', s.wanted > 0);
    [...wl.children].forEach((c, i) => c.classList.toggle('on', i < s.wanted));
    $('arrest').classList.toggle('hidden', s.arrest <= 0.01);
    ($('arrest-bar') as HTMLElement).style.width = `${Math.round(s.arrest * 100)}%`;
    $('ko').classList.toggle('hidden', s.down <= 0);
    if (s.down > 0) $('ko-t').textContent = String(s.down);
  }

  toast(text: string, kind: 'info' | 'good' | 'bad') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toastsEl.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  tickFps(dt: number, drawCalls: number, resScale = 1) {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fpsEl.textContent = `${Math.round(this.frames / this.fpsTime)} FPS · ${drawCalls} Draw-Calls${resScale < 1 ? ` · Auflösung ${Math.round(resScale * 100)} %` : ''}`;
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
