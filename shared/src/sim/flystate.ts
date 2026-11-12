// Flugzustand eines Luftfahrzeugs (Teil von CarState, wird für die Reconciliation mit übertragen).
export interface FlyState {
  /** Drehzahl Rotor/Propeller/Triebwerk 0..1 (Hochlaufen beim Start). */
  rotor: number;
  /** Tankfüllung 0..1 */
  fuel: number;
  /** 1 = Strömungsabriss (Flugzeug zu langsam in der Luft) */
  stall: number;
  /** 1 = steht/rollt am Boden (bzw. auf einem Dach) */
  ground: number;
  /** Fluggeschwindigkeit vorwärts (Flugzeug, m/s) */
  spd: number;
  /** Querneigung / Nicken für die Optik (rad) */
  bank: number; pitch: number;
  // ---- Ereignisse des letzten Schritts (nicht übertragen; der Server wertet sie aus)
  /** Schaden wie ein Aufprall dieser Stärke (m/s), 0 = keiner */
  hit: number;
  /** 1 = Absturz (zerstört) */
  crash: number;
  /** Hinweis: 0 keiner, 1 Strömungsabriss, 2 nur von Landebahnen, 3 Tank leer */
  warn: number;
}

export const newFlyState = (): FlyState => ({ rotor: 0, fuel: 1, stall: 0, ground: 1, spd: 0, bank: 0, pitch: 0, hit: 0, crash: 0, warn: 0 });

const r4 = (v: number) => Math.round(v * 10000) / 10000;
export function packFly(f: FlyState): number[] {
  return [r4(f.rotor), r4(f.fuel), f.stall, f.ground, r4(f.spd), r4(f.bank), r4(f.pitch)];
}
export function unpackFly(a: number[], i: number, f: FlyState) {
  f.rotor = a[i]; f.fuel = a[i + 1]; f.stall = a[i + 2]; f.ground = a[i + 3]; f.spd = a[i + 4]; f.bank = a[i + 5]; f.pitch = a[i + 6];
}
