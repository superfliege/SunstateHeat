// Tastatur + optionales Gamepad. Liefert pro Simulationsschritt eine Achse (ax, ay)
// und Tasten-Bits, sowie einmalige Aktionen (Einsteigen, Chat, Karte).
import { Btn } from '../../../shared/src/protocol';

export interface InputSample { ax: number; ay: number; buttons: number }

const DEADZONE = 0.2;

export class Input {
  private keys = new Set<string>();
  private usePressed = false;
  private padUseWasDown = false;
  /** Wird gesetzt, solange das Chatfeld offen ist – dann keine Spielsteuerung. */
  blocked = false;
  onChatKey: () => void = () => {};
  onMapKey: () => void = () => {};
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
      if (e.code === 'KeyM' && !e.repeat) this.onMapKey();
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
    if (this.blocked) return { ax: 0, ay: 0, buttons: 0 };
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

    const pad = navigator.getGamepads?.()[0];
    if (pad) {
      const sx = pad.axes[0] ?? 0, sy = pad.axes[1] ?? 0;
      if (Math.abs(sx) > DEADZONE) ax = sx;
      if (!inVehicle && Math.abs(sy) > DEADZONE) ay = -sy;
      if (inVehicle) {
        const gas = pad.buttons[7]?.value ?? 0, rev = pad.buttons[6]?.value ?? 0;
        if (gas > 0.05 || rev > 0.05) ay = gas - rev;
        else if (Math.abs(sy) > DEADZONE) ay = -sy;
      }
      if (pad.buttons[1]?.pressed) buttons |= Btn.SPRINT; // B
      if (pad.buttons[2]?.pressed) buttons |= Btn.BRAKE; // X
      if (pad.buttons[3]?.pressed) buttons |= Btn.HORN; // Y
      if (inVehicle) {
        // Luftfahrzeuge: RB = steigen, LB = sinken, rechter Stick seitwärts (Helikopter)
        if (pad.buttons[5]?.pressed) buttons |= Btn.SPRINT;
        if (pad.buttons[4]?.pressed) buttons |= Btn.BRAKE;
        const rx = pad.axes[2] ?? 0;
        if (rx < -0.5) buttons |= Btn.STRAFE_L; else if (rx > 0.5) buttons |= Btn.STRAFE_R;
      }
      const useDown = !!pad.buttons[0]?.pressed; // A
      if (useDown && !this.padUseWasDown) this.usePressed = true;
      this.padUseWasDown = useDown;
    }
    return { ax, ay, buttons };
  }


  private rumbleUntil = 0;
  /**
   * Gamepad-Vibration (Gamepad Haptics API, falls vorhanden). strong/weak 0..1, ms Dauer.
   * Wird höchstens alle 90 ms neu angestoßen, damit Dauer-Rumpeln (Schlupf) nicht flackert.
   */
  rumble(strong: number, weak: number, ms: number) {
    const now = performance.now();
    if (now < this.rumbleUntil - 30 && strong < 0.5) return;
    const pad = navigator.getGamepads?.()[0] as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null | undefined;
    const act = pad?.vibrationActuator;
    if (!act?.playEffect) return;
    this.rumbleUntil = now + ms;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }
  /** War seit dem letzten Aufruf "E" gedrückt? */
  consumeUse(): boolean {
    const u = this.usePressed;
    this.usePressed = false;
    return u;
  }
}
