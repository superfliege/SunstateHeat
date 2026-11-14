// Tastatur + optionales Gamepad. Liefert pro Simulationsschritt eine Achse (ax, ay)
// und Tasten-Bits, sowie einmalige Aktionen (Einsteigen, Chat, Karte).
import { Btn } from '../../../shared/src/protocol';
import { gamepads, P } from './Gamepad';

export interface InputSample { ax: number; ay: number; buttons: number }


export class Input {
  private keys = new Set<string>();
  private usePressed = false;
  /** Wird gesetzt, solange das Chatfeld offen ist – dann keine Spielsteuerung. */
  blocked = false;
  onChatKey: () => void = () => {};
  onMapKey: () => void = () => {};
  /** Handy (M): Warteräume für Minispiele, Rennen und Koop-Aufträge (#43). */
  onPhoneKey: () => void = () => {};
  onInteract: () => void = () => {};
  onInventory: () => void = () => {};
  onQuestLog: () => void = () => {};
  onInteractUp: () => void = () => {};
  onWeaponSlot: (slot: number) => void = () => {};
  onWeaponCycle: (dir: number) => void = () => {};
  /** Mausposition (Fensterkoordinaten) und linke Maustaste (Angriff). */
  mouseX = 0;
  mouseY = 0;
  fire = false;
  /** Controller: Schusstaste gehalten (RT zu Fuß, B im Fahrzeug). */
  padFire = false;
  /** Controller schießt ohne rechten Stick: geradeaus in Blickrichtung zielen. */
  aimFacing = false;
  /** Maus, Touch oder Controller schießen gerade. */
  get firing() { return !this.blocked && (this.fire || this.padFire); }
  /** Bildschirm-Steuerung (TouchControls) schreibt hierhin; wird in sample() mit Tastatur/Pad gemischt. */
  touch = { ax: 0, ay: 0, buttons: 0 };
  private lastTouchAt = -1e9;
  /** Kam die Maus-Nachricht von einer Berührung (Browser feuert sie nach Taps nach)? */
  private fromTouch() { return performance.now() - this.lastTouchAt < 900; }
  pressUse() { this.usePressed = true; }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (this.blocked) return;
      if (e.code === 'Enter') { e.preventDefault(); this.onChatKey(); return; }
      // F = ein-/aussteigen, E = Aktionen (reden, Telefone, Fernrohr, aufrichten …)
      if (e.code === 'KeyF' && !e.repeat) this.usePressed = true;
      if (e.code === 'KeyK' && !e.repeat) this.onMapKey();
      if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); this.onPhoneKey(); }
      // preventDefault markiert die Taste als verbraucht: das Fenster, das sie gerade geöffnet
      // hat, darf sie nicht im selben Ereignis gleich wieder schließen (Panels)
      if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); this.onInteract(); }
      if (e.code === 'KeyI' && !e.repeat) { e.preventDefault(); this.onInventory(); }
      if (e.code === 'KeyJ' && !e.repeat) { e.preventDefault(); this.onQuestLog(); }
      if (/^Digit[1-5]$/.test(e.code) && !e.repeat) this.onWeaponSlot(Number(e.code.slice(5)));
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('touchstart', () => { this.lastTouchAt = performance.now(); }, { passive: true, capture: true });
    window.addEventListener('touchend', () => { this.lastTouchAt = performance.now(); }, { passive: true, capture: true });
    window.addEventListener('mousemove', (e) => { if (this.fromTouch()) return; this.mouseX = e.clientX; this.mouseY = e.clientY; });
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.blocked || this.fromTouch() || (e.target as HTMLElement).tagName !== 'CANVAS') return;
      this.fire = true;
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.fire = false; });
    window.addEventListener('wheel', (e) => {
      if (this.blocked || (e.target as HTMLElement).tagName !== 'CANVAS') return;
      this.onWeaponCycle(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'KeyE') this.onInteractUp(); });
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; });
  }

  clear() { this.keys.clear(); }
  /** Taste gedrückt? (Fernrohr-Schwenk u. Ä.) */
  isDown(code: string) { return this.keys.has(code); }

  private down(...codes: string[]) { return codes.some((c) => this.keys.has(c)); }

  /** Aktuellen Eingabezustand lesen. `inVehicle` ändert die Gamepad-Belegung (Trigger = Gas). */
  sample(inVehicle: boolean): InputSample {
    if (this.blocked) { this.padFire = false; return { ax: 0, ay: 0, buttons: 0 }; }
    let ax = (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0);
    let ay = (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0);
    let buttons = this.touch.buttons;
    if (Math.abs(this.touch.ax) > Math.abs(ax)) ax = this.touch.ax;
    if (Math.abs(this.touch.ay) > Math.abs(ay)) ay = this.touch.ay;
    if (this.down('ShiftLeft', 'ShiftRight')) buttons |= Btn.SPRINT;
    if (this.down('Space')) buttons |= Btn.BRAKE;
    if (this.down('KeyH')) buttons |= Btn.HORN;
    // Helikopter: seitwärts (Q links, R rechts)
    if (this.down('KeyQ')) buttons |= Btn.STRAFE_L;
    if (this.down('KeyR')) buttons |= Btn.STRAFE_R;

    // Controller (Xbox/PS): Belegung siehe padGlyphs.ts → padLayout
    const f = gamepads.frame;
    this.padFire = false; this.aimFacing = false;
    if (gamepads.connected) {
      const d = f.down;
      if (f.lx) ax = f.lx;
      if (!inVehicle) {
        if (f.ly) ay = -f.ly;
        if (d[P.A] || d[P.L3]) buttons |= Btn.SPRINT;
        this.padFire = f.rt > 0.3;
      } else {
        if (f.rt > 0 || f.lt > 0) ay = f.rt - f.lt;
        else if (f.ly) ay = -f.ly;
        // RB/A = Nitro bzw. Steigen, LB = Handbremse bzw. Sinken, L3 = Hupe, B = Drive-by
        if (d[P.RB] || d[P.A]) buttons |= Btn.SPRINT;
        if (d[P.LB]) buttons |= Btn.BRAKE;
        if (d[P.L3]) buttons |= Btn.HORN;
        if (f.rx < -0.5) buttons |= Btn.STRAFE_L; else if (f.rx > 0.5) buttons |= Btn.STRAFE_R;
        this.padFire = d[P.B];
      }
      // Rechter Stick zielt in Bildschirmrichtung (die Figur steht in der Bildmitte), sonst geradeaus
      const m = Math.hypot(f.rx, f.ry);
      if (m > 0.3) {
        const R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
        this.mouseX = window.innerWidth / 2 + f.rx / m * R;
        this.mouseY = window.innerHeight / 2 + f.ry / m * R;
      } else if (this.padFire) this.aimFacing = true;
    }
    return { ax, ay, buttons };
  }


  private rumbleUntil = 0;
  /** Vibration an/aus (Handy → Einstellungen). */
  rumbleOn = true;
  /**
   * Gamepad-Vibration (Gamepad Haptics API, falls vorhanden). strong/weak 0..1, ms Dauer.
   * Wird höchstens alle 90 ms neu angestoßen, damit Dauer-Rumpeln (Schlupf) nicht flackert.
   */
  rumble(strong: number, weak: number, ms: number) {
    const now = performance.now();
    if (now < this.rumbleUntil - 30 && strong < 0.5) return;
    if (!this.rumbleOn) return;
    type Haptic = { playEffect?: (t: string, p: object) => Promise<unknown>; pulse?: (v: number, ms: number) => Promise<unknown> };
    const pad = gamepads.gamepad() as (Gamepad & { vibrationActuator?: Haptic; hapticActuators?: Haptic[] }) | null;
    if (!pad) return;
    const act = pad.vibrationActuator, alt = pad.hapticActuators?.[0];
    this.rumbleUntil = now + ms;
    // Chrome/Edge/Safari: dual-rumble (Xbox und DualSense), Firefox: hapticActuators.pulse
    if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    else alt?.pulse?.(Math.min(1, Math.max(strong, weak)), ms)?.catch(() => {});
  }
  /** War seit dem letzten Aufruf "E" gedrückt? */
  consumeUse(): boolean {
    const u = this.usePressed;
    this.usePressed = false;
    return u;
  }
}
