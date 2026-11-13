// Bildschirm-Steuerung für Handy/Tablet: Joystick links, Aktionstasten + Ziel-/Schussstick rechts,
// Menü-Tasten oben rechts. Schreibt in `Input` (Achsen, Tasten-Bits, Schuss, Zielpunkt) und ruft
// dessen Aktions-Callbacks auf – das Spiel selbst merkt keinen Unterschied zur Tastatur.
import { Btn } from '../../../shared/src/protocol';
import type { Input } from './Input';

const STICK_R = 56; // Radius des Joysticks in px
const AIM_R = 44;

/** Echtes Touch-Gerät (grober Zeiger)? Hybrid-Geräte schalten beim ersten Touch dynamisch um. */
export function isTouchDevice(): boolean {
  return window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches;
}

// ---------- Vollbild ----------
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}
/** Vollbild an/aus. Gibt false zurück, wenn der Browser es nicht kann (z. B. iPhone-Safari). */
export async function toggleFullscreen(): Promise<boolean> {
  const d = document as FsDoc, el = document.documentElement as FsEl;
  try {
    if (isFullscreen()) {
      await (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      try { screen.orientation?.unlock?.(); } catch { /* egal */ }
      return true;
    }
    const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
    if (!req) return false;
    await req();
    // Im Vollbild das Querformat erzwingen (Android/Chrome; iOS ignoriert das)
    try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'); } catch { /* nicht unterstützt */ }
    return true;
  } catch { return false; }
}

interface BtnDef { id: string; label: string; cls: string; mode?: 'foot' | 'veh'; hold?: number; tap?: (t: TouchControls) => void }

export class TouchControls {
  private root: HTMLElement;
  private stick = { id: -1, cx: 0, cy: 0 };
  private aim = { id: -1, cx: 0, cy: 0 };
  private held = new Set<string>();
  private lastDir = { x: 0, y: -1 };
  /** Wird gesetzt, sobald das erste Touch-Ereignis kam (oder das Gerät ein Touch-Gerät ist). */
  active = false;
  onFullscreenFail: () => void = () => {};

  private readonly defs: BtnDef[] = [
    { id: 'use', label: 'F', cls: 'use', tap: (t) => t.input.pressUse() },
    { id: 'act', label: 'E', cls: 'act', tap: (t) => { t.input.onInteract(); window.setTimeout(() => t.input.onInteractUp(), 120); } },
    { id: 'sprint', label: '»', cls: 'sprint', hold: Btn.SPRINT },
    { id: 'weapon', label: '⚔', cls: 'weapon', mode: 'foot', tap: (t) => t.input.onWeaponCycle(1) },
    { id: 'brake', label: '■', cls: 'brake', mode: 'veh', hold: Btn.BRAKE },
    { id: 'horn', label: '♪', cls: 'horn', mode: 'veh', hold: Btn.HORN },
    { id: 'map', label: '📱', cls: 'menu m-map', tap: (t) => t.input.onPhoneKey() },
    { id: 'inv', label: '🎒', cls: 'menu m-inv', tap: (t) => t.input.onInventory() },
    { id: 'log', label: '📜', cls: 'menu m-log', tap: (t) => t.input.onQuestLog() },
    { id: 'chat', label: '💬', cls: 'menu m-chat', tap: (t) => t.input.onChatKey() },
  ];

  constructor(private input: Input) {
    const root = document.createElement('div');
    root.id = 'touch';
    root.className = 'hidden';
    root.innerHTML = `
      <div class="tc-stick" id="tc-stick"><i></i></div>
      <div class="tc-aim" id="tc-aim"><i></i><span>🔫</span></div>`;
    for (const d of this.defs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tc-btn ${d.cls}`;
      b.dataset.id = d.id;
      if (d.mode) b.dataset.mode = d.mode;
      b.textContent = d.label;
      root.appendChild(b);
    }
    document.body.appendChild(root);
    this.root = root;

    // Menü ohne Kontextmenü/Lupe/Textauswahl
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.bindStick(root.querySelector('#tc-stick') as HTMLElement);
    this.bindAim(root.querySelector('#tc-aim') as HTMLElement);
    for (const b of root.querySelectorAll<HTMLElement>('.tc-btn')) this.bindButton(b, this.defs.find((d) => d.id === b.dataset.id)!);

    // Erste Berührung schaltet die Touch-Oberfläche ein (auch auf Hybrid-Geräten)
    window.addEventListener('touchstart', () => this.setActive(true), { passive: true, once: true });
    window.addEventListener('blur', () => this.releaseAll());
    if (isTouchDevice()) this.setActive(true);
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    document.body.classList.toggle('touch', on);
    if (!on) this.releaseAll();
    this.syncVisible();
  }

  private visible = false;
  /** Nur im Spiel anzeigen (nicht auf dem Login). */
  setShown(v: boolean) { this.visible = v; this.syncVisible(); }
  private syncVisible() { this.root.classList.toggle('hidden', !(this.active && this.visible)); }

  setVehicle(inVeh: boolean) { this.root.classList.toggle('in-veh', inVeh); }

  private air = false;
  /** Luftfahrzeug: Sprint-/Bremstaste werden zu Steigen (▲) / Sinken (▼). */
  setAir(on: boolean) {
    if (on === this.air) return;
    this.air = on;
    const sprint = this.root.querySelector<HTMLElement>('.tc-btn.sprint'), brake = this.root.querySelector<HTMLElement>('.tc-btn.brake');
    if (sprint) sprint.textContent = on ? '▲' : '»';
    if (brake) brake.textContent = on ? '▼' : '■';
  }

  /** Menü offen/Chat offen: Steuerung ausblenden, damit nichts versehentlich ausgelöst wird. */
  setBlocked(b: boolean) { this.root.classList.toggle('blocked', b); if (b) this.releaseAll(); }

  private releaseAll() {
    this.stick.id = -1; this.aim.id = -1; this.held.clear();
    const t = this.input.touch;
    t.ax = 0; t.ay = 0; t.buttons = 0;
    this.input.fire = false;
    this.root.querySelectorAll('.pressed').forEach((e) => e.classList.remove('pressed'));
    this.root.querySelectorAll<HTMLElement>('.tc-stick i, .tc-aim i').forEach((e) => { e.style.transform = ''; });
  }

  private bindStick(el: HTMLElement) {
    const knob = el.querySelector('i') as HTMLElement;
    const set = (e: PointerEvent) => {
      let dx = e.clientX - this.stick.cx, dy = e.clientY - this.stick.cy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const t = this.input.touch;
      let ax = dx / STICK_R, ay = -dy / STICK_R;
      const m = Math.hypot(ax, ay);
      if (m < 0.18) { ax = 0; ay = 0; } else if (m > 0.35) { this.lastDir.x = dx / (len || 1); this.lastDir.y = dy / (len || 1); }
      t.ax = ax; t.ay = ay;
    };
    el.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      this.stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      set(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) set(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = -1; knob.style.transform = '';
      this.input.touch.ax = 0; this.input.touch.ay = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Schussstick: gedrückt = Dauerfeuer, Ziehen = Zielrichtung (Bildschirmrichtung vom Spieler aus). */
  private bindAim(el: HTMLElement) {
    const knob = el.querySelector('i') as HTMLElement;
    const aimAt = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy);
      let ux = this.lastDir.x, uy = this.lastDir.y;
      if (len > 14) { ux = dx / len; uy = dy / len; }
      // Zielpunkt auf dem Bildschirm: Mitte (dort steht die Figur) + Richtung
      const R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
      this.input.mouseX = window.innerWidth / 2 + ux * R;
      this.input.mouseY = window.innerHeight / 2 + uy * R;
    };
    const set = (e: PointerEvent) => {
      let dx = e.clientX - this.aim.cx, dy = e.clientY - this.aim.cy;
      const len = Math.hypot(dx, dy);
      if (len > AIM_R) { dx = dx / len * AIM_R; dy = dy / len * AIM_R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      aimAt(dx, dy);
    };
    el.addEventListener('pointerdown', (e) => {
      if (this.aim.id !== -1) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const r = el.getBoundingClientRect();
      this.aim = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      el.classList.add('pressed');
      this.input.fire = true;
      set(e);
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.aim.id) set(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.aim.id) return;
      this.aim.id = -1; knob.style.transform = ''; el.classList.remove('pressed');
      this.input.fire = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private bindButton(el: HTMLElement, d: BtnDef) {
    let pid = -1;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== -1) return;
      pid = e.pointerId;
      el.setPointerCapture(pid);
      el.classList.add('pressed');
      if (d.hold) { this.held.add(d.id); this.input.touch.buttons |= d.hold; }
      d.tap?.(this);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pid) return;
      pid = -1;
      el.classList.remove('pressed');
      if (d.hold) { this.held.delete(d.id); this.input.touch.buttons &= ~d.hold; }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
