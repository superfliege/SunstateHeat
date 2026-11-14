// Controller-Anbindung (Xbox One S / Series S|X, PS5 DualSense, PS4 DualShock und andere Pads mit
// „standard“-Belegung der Gamepad-API). Liest jedes Bild alle Pads, merkt sich das zuletzt benutzte,
// liefert Achsen mit runder Totzone, Tasten-Flanken (gedrückt/losgelassen) mit Wiederholung für die
// Menü-Navigation und den Eingabemodus (Tastatur/Maus, Touch, Controller) für Hinweise und Touch-Tasten.

/** Tastennummern der Standard-Belegung (Xbox-Namen; PS: A=✕, B=○, X=□, Y=△, LB=L1 …). */
export const P = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16, PAD: 17,
} as const;
const N_BTN = 18;

export type InputMode = 'kbd' | 'touch' | 'pad';
export type PadFamily = 'xbox' | 'ps' | 'generic';

const STICK_DZ = 0.16; // runde Totzone der Sticks (Xbox-/PS5-Sticks driften leicht)
const TRIGGER_DZ = 0.06;
const REPEAT_DELAY = 380, REPEAT_EVERY = 110; // ms, Menü-Navigation bei gehaltenem Steuerkreuz/Stick

/** Stick mit runder Totzone, danach auf 0..1 umskaliert (feines Lenken direkt hinter der Totzone). */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < STICK_DZ) return [0, 0];
  const k = Math.min(1, (m - STICK_DZ) / (1 - STICK_DZ)) / m;
  return [x * k, y * k];
}

export function padFamily(id: string): PadFamily {
  if (/054c|dualsense|dualshock|playstation|wireless controller|ps[345]/i.test(id)) return 'ps';
  if (/xbox|045e|xinput|microsoft/i.test(id)) return 'xbox';
  return 'generic';
}

export class PadFrame {
  /** Sticks nach Totzone: lx/ly, rx/ry (y nach unten positiv wie in der API). */
  lx = 0; ly = 0; rx = 0; ry = 0;
  /** Trigger 0..1 */
  lt = 0; rt = 0;
  down = new Array<boolean>(N_BTN).fill(false);
  /** Taste physisch gedrückt (auch wenn geschluckt). */
  private rawDown = new Array<boolean>(N_BTN).fill(false);
  /** Von einem Menü verbrauchte Tasten: zählen erst nach dem Loslassen wieder. */
  private swallowed = new Array<boolean>(N_BTN).fill(false);
  private prev = new Array<boolean>(N_BTN).fill(false);
  private heldSince = new Array<number>(N_BTN).fill(0);
  private lastRepeat = new Array<number>(N_BTN).fill(0);
  private rep = new Array<boolean>(N_BTN).fill(false);
  /** Linker Stick als Steuerkreuz (Menüs): virtuelle Tasten UP/DOWN/LEFT/RIGHT. */
  private stickDir = { up: false, down: false, left: false, right: false };

  update(pad: Gamepad, now: number) {
    const std = pad.mapping === 'standard';
    [this.lx, this.ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    [this.rx, this.ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
    const b = (i: number) => pad.buttons[i];
    this.lt = Math.max(0, (b(P.LT)?.value ?? 0) - TRIGGER_DZ) / (1 - TRIGGER_DZ);
    this.rt = Math.max(0, (b(P.RT)?.value ?? 0) - TRIGGER_DZ) / (1 - TRIGGER_DZ);
    // Nicht-Standard (z. B. Firefox unter Linux): Steuerkreuz oft als Achsen 6/7
    let dUp = !!b(P.UP)?.pressed, dDown = !!b(P.DOWN)?.pressed, dLeft = !!b(P.LEFT)?.pressed, dRight = !!b(P.RIGHT)?.pressed;
    if (!std && pad.axes.length >= 8) {
      const hx = pad.axes[6] ?? 0, hy = pad.axes[7] ?? 0;
      dLeft ||= hx < -0.5; dRight ||= hx > 0.5; dUp ||= hy < -0.5; dDown ||= hy > 0.5;
    }
    // Stick als Steuerkreuz mit Hysterese
    const s = this.stickDir, ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    s.up = ay < (s.up ? -0.4 : -0.6); s.down = ay > (s.down ? 0.4 : 0.6);
    s.left = ax < (s.left ? -0.4 : -0.6); s.right = ax > (s.right ? 0.4 : 0.6);
    for (let i = 0; i < N_BTN; i++) {
      this.prev[i] = this.down[i];
      let d = i === P.LT ? this.lt > 0.4 : i === P.RT ? this.rt > 0.4 : !!b(i)?.pressed;
      if (i === P.UP) d = dUp; else if (i === P.DOWN) d = dDown; else if (i === P.LEFT) d = dLeft; else if (i === P.RIGHT) d = dRight;
      this.rawDown[i] = d;
      if (this.swallowed[i] && !d) this.swallowed[i] = false;
      if (this.swallowed[i]) d = false;
      this.down[i] = d;
      this.rep[i] = false;
      if (d && !this.prev[i]) { this.heldSince[i] = now; this.lastRepeat[i] = now; }
      else if (d && now - this.heldSince[i] > REPEAT_DELAY && now - this.lastRepeat[i] > REPEAT_EVERY) { this.rep[i] = true; this.lastRepeat[i] = now; }
    }
    if (this.swallowed[P.LT]) this.lt = 0;
    if (this.swallowed[P.RT]) this.rt = 0;
    this.navStick(now);
  }

  /** Alle gerade gehaltenen Tasten verbrauchen (ein Menü hat sie benutzt). */
  swallow() {
    for (let i = 0; i < N_BTN; i++) if (this.rawDown[i]) { this.swallowed[i] = true; this.down[i] = false; this.prev[i] = false; }
    this.lt = this.swallowed[P.LT] ? 0 : this.lt; this.rt = this.swallowed[P.RT] ? 0 : this.rt;
  }
  /** Physisch gedrückt, unabhängig vom Schlucken. */
  raw(i: number) { return this.rawDown[i]; }

  private navPrev = { up: false, down: false, left: false, right: false };
  private navSince = 0; private navLast = 0;
  private navFire: '' | 'up' | 'down' | 'left' | 'right' = '';
  private navStick(now: number) {
    this.navFire = '';
    const s = this.stickDir, p = this.navPrev;
    const dir = s.up ? 'up' : s.down ? 'down' : s.left ? 'left' : s.right ? 'right' : '';
    const pd = p.up ? 'up' : p.down ? 'down' : p.left ? 'left' : p.right ? 'right' : '';
    if (dir && dir !== pd) { this.navFire = dir; this.navSince = now; this.navLast = now; }
    else if (dir && now - this.navSince > REPEAT_DELAY && now - this.navLast > REPEAT_EVERY) { this.navFire = dir; this.navLast = now; }
    Object.assign(p, s);
  }

  /** Gerade gedrückt (Flanke). */
  pressed(i: number) { return this.down[i] && !this.prev[i]; }
  released(i: number) { return !this.down[i] && this.prev[i]; }
  /** Gedrückt oder automatisch wiederholt (gehalten). */
  repeat(i: number) { return this.pressed(i) || this.rep[i]; }
  /** Menü-Richtung aus Steuerkreuz oder linkem Stick (mit Wiederholung). */
  nav(): '' | 'up' | 'down' | 'left' | 'right' {
    if (this.repeat(P.UP)) return 'up';
    if (this.repeat(P.DOWN)) return 'down';
    if (this.repeat(P.LEFT)) return 'left';
    if (this.repeat(P.RIGHT)) return 'right';
    return this.navFire;
  }
  /** Irgendeine Eingabe am Pad (für den Wechsel in den Controller-Modus)? */
  get active() {
    return this.down.some((d, i) => d && i !== P.HOME) || Math.hypot(this.lx, this.ly) > 0.35 || Math.hypot(this.rx, this.ry) > 0.35;
  }
  reset() { this.down.fill(false); this.prev.fill(false); this.rawDown.fill(false); this.swallowed.fill(false); this.lx = this.ly = this.rx = this.ry = this.lt = this.rt = 0; }
}

type Handler = (f: PadFrame) => void;

class GamepadManager {
  readonly frame = new PadFrame();
  /** Index des zuletzt benutzten Pads (-1 = keins). */
  private index = -1;
  family: PadFamily = 'xbox';
  mode: InputMode = 'kbd';
  private modeListeners: ((m: InputMode) => void)[] = [];
  private handler: Handler | null = null;
  private started = false;
  private lastMouse = { x: -1, y: -1 };

  /** Ein Pad ist verbunden (und wurde benutzt)? */
  get connected() { return this.index >= 0; }

  start(initial: InputMode) {
    if (this.started) return;
    this.started = true;
    this.mode = initial;
    this.applyBody();
    window.addEventListener('gamepadconnected', (e) => {
      // Ein Pad wird oft erst nach dem ersten Tastendruck gemeldet – dann direkt übernehmen
      this.index = e.gamepad.index;
      this.family = padFamily(e.gamepad.id);
      this.setMode('pad');
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.index) return;
      this.index = -1; this.frame.reset();
      if (this.mode === 'pad') this.setMode(matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'kbd');
    });
    // Tastatur/Maus/Touch holen den Modus zurück
    window.addEventListener('keydown', (e) => { if (!e.isTrusted) return; this.setMode('kbd'); }, true);
    window.addEventListener('mousedown', () => { if (this.mode !== 'touch') this.setMode('kbd'); }, true);
    window.addEventListener('mousemove', (e) => {
      const d = Math.abs(e.clientX - this.lastMouse.x) + Math.abs(e.clientY - this.lastMouse.y);
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (d > 8 && d < 400 && this.mode === 'pad') this.setMode('kbd');
    }, { passive: true });
    window.addEventListener('touchstart', () => this.setMode('touch'), { passive: true, capture: true });
    const loop = () => { this.poll(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  /** Wer die Tasten-Flanken bekommt (Login-Bildschirm bzw. Spiel). */
  setHandler(h: Handler | null) { this.handler = h; }

  onModeChange(fn: (m: InputMode) => void) { this.modeListeners.push(fn); fn(this.mode); }

  setMode(m: InputMode) {
    if (m === this.mode) return;
    this.mode = m;
    this.applyBody();
    for (const fn of this.modeListeners) fn(m);
  }

  private applyBody() {
    const b = document.body;
    b.classList.toggle('pad', this.mode === 'pad');
    b.classList.toggle('pad-ps', this.family === 'ps');
  }

  /** Aktuelles Pad-Objekt (für Vibration). */
  gamepad(): Gamepad | null {
    if (this.index < 0) return null;
    return navigator.getGamepads?.()[this.index] ?? null;
  }

  private poll() {
    const pads = navigator.getGamepads?.();
    if (!pads) return;
    const now = performance.now();
    // Zuletzt benutztes Pad finden: wechselt, sobald an einem anderen gedrückt wird
    for (const p of pads) {
      if (!p || !p.connected || p.index === this.index) continue;
      if (p.buttons.some((b, i) => b.pressed && i !== P.LT && i !== P.RT) || Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > 0.6) {
        this.index = p.index;
        this.family = padFamily(p.id);
        this.frame.reset();
        this.applyBody();
      }
    }
    const pad = this.index >= 0 ? pads[this.index] : null;
    if (!pad || !pad.connected) return;
    this.frame.update(pad, now);
    if (this.frame.active && this.mode !== 'pad') this.setMode('pad');
    this.handler?.(this.frame);
  }
}

/** Einziger Controller-Manager des Clients. */
export const gamepads = new GamepadManager();
