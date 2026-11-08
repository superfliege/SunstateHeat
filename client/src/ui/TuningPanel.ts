// Live-Tuning-Panel (nur Dev-Modus, Taste F4): alle Handling-Werte des aktuellen Fahrzeugs und
// die Arcade-Hilfen zur Laufzeit ändern. Änderungen gehen an den Server (der sie für alle
// übernimmt, damit Prediction und Server gleich rechnen). "Als JSON exportieren" lädt die Werte
// herunter – zum Übertragen in shared/src/sim/handling.ts.
import GUI from 'lil-gui';
import { ASSISTS, HANDLING, invalidateHandling, type HandlingClass, type HandlingProfile } from '../../../shared/src/sim/handling';
import { CAMERA } from '../render/CameraRig';

type Num = Record<string, number>;

/** Bereiche der Regler [min, max, Schritt] */
const RANGES: Record<string, [number, number, number]> = {
  mass: [100, 12000, 10], length: [1.5, 9, 0.05], width: [0.5, 3, 0.05], height: [0.8, 4, 0.05],
  wheelbase: [1, 6, 0.05], track: [0.2, 2.6, 0.02], cgHeight: [0.2, 1.5, 0.01], cgForward: [-1, 1, 0.01], wheelRadius: [0.2, 0.7, 0.01],
  suspFreq: [0.5, 4, 0.05], suspDamping: [0.1, 1.2, 0.01], suspTravel: [0.05, 0.5, 0.01], antiRoll: [0, 1.5, 0.01],
  torque: [50, 3000, 5], redline: [1500, 12000, 50], idleRpm: [400, 2000, 10], gears: [4, 6, 1], topSpeed: [10, 90, 0.5],
  launch: [1.5, 6, 0.05], shiftTime: [0, 0.6, 0.01], drive: [0, 2, 1],
  brake: [0.2, 2, 0.01], brakeBias: [0.3, 0.9, 0.01],
  gripFront: [0.3, 2, 0.01], gripRear: [0.3, 2, 0.01], slipPeakFront: [2, 20, 0.1], slipPeakRear: [2, 20, 0.1], slipFalloff: [0.2, 1, 0.01],
  handbrakeGrip: [0.05, 1, 0.01], drift: [0, 1, 0.01],
  steerMax: [10, 50, 0.5], steerSpeedFalloff: [0, 0.2, 0.001], steerRate: [1, 12, 0.1],
  durability: [0.2, 5, 0.05], nitroForce: [0, 15000, 100], nitroTime: [0.5, 10, 0.1], sportExhaust: [0, 1, 1], cylinders: [1, 12, 1], upright: [0, 1, 1],
};
const GROUPS: [string, string[]][] = [
  ['Karosserie', ['mass', 'length', 'width', 'height', 'wheelbase', 'track', 'cgHeight', 'cgForward', 'wheelRadius']],
  ['Federung', ['suspFreq', 'suspDamping', 'suspTravel', 'antiRoll']],
  ['Antrieb', ['torque', 'redline', 'idleRpm', 'gears', 'topSpeed', 'launch', 'shiftTime', 'drive', 'nitroForce', 'nitroTime']],
  ['Reifen & Bremsen', ['gripFront', 'gripRear', 'slipPeakFront', 'slipPeakRear', 'slipFalloff', 'handbrakeGrip', 'drift', 'brake', 'brakeBias']],
  ['Lenkung', ['steerMax', 'steerSpeedFalloff', 'steerRate']],
  ['Sonstiges', ['durability', 'sportExhaust', 'cylinders', 'upright']],
];

export class TuningPanel {
  private gui: GUI | null = null;
  private cls: HandlingClass | null = null;
  private visible = false;

  constructor(private send: (cls: string, values: Num, assists?: Num) => void) {
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F4') return;
      e.preventDefault();
      this.visible = !this.visible;
      if (this.visible) this.build(); else this.destroy();
    });
  }

  /** Aktuelle Fahrzeugklasse (Panel baut sich bei Wechsel neu auf). */
  setClass(cls: HandlingClass | null) {
    if (cls === this.cls) return;
    this.cls = cls;
    if (this.visible) { this.destroy(); this.build(); }
  }

  private destroy() { this.gui?.destroy(); this.gui = null; }

  private build() {
    const gui = new GUI({ title: 'Fahr-Tuning (F4)', width: 320 });
    this.gui = gui;
    const cls = this.cls ?? 'sedan';
    const prof = HANDLING[cls] as unknown as Num;
    const pf = gui.addFolder(`Profil: ${(HANDLING[cls] as HandlingProfile).name}`);
    for (const [title, keys] of GROUPS) {
      const f = pf.addFolder(title);
      f.close();
      for (const k of keys) {
        const [min, max, step] = RANGES[k];
        f.add(prof, k, min, max, step).onChange((v: number) => { invalidateHandling(); this.send(cls, { [k]: v }); });
      }
    }
    pf.open();
    const af = gui.addFolder('Arcade-Hilfen (alle Fahrzeuge)');
    const assists = ASSISTS as unknown as Num;
    for (const k of Object.keys(assists)) {
      const v = assists[k];
      const max = v === 0 ? 1 : Math.abs(v) * 4;
      af.add(assists, k, 0, max, max / 200).onChange((nv: number) => { invalidateHandling(); this.send(cls, {}, { [k]: nv }); });
    }
    af.close();
    const cf = gui.addFolder('Kamera (lokal)');
    for (const k of Object.keys(CAMERA) as (keyof typeof CAMERA)[]) cf.add(CAMERA, k, 0, CAMERA[k] * 4 || 1, (CAMERA[k] * 4 || 1) / 200);
    cf.close();
    gui.add({ export: () => this.exportJson() }, 'export').name('Als JSON exportieren');
  }

  private exportJson() {
    const data = { handling: HANDLING, assists: ASSISTS, camera: CAMERA };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sunstate-handling-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    navigator.clipboard?.writeText(JSON.stringify(data, null, 2)).catch(() => {});
  }
}

/** Server-Echo eines Tunings übernehmen (andere Clients / Bestätigung). */
export function applyTune(cls: string, values: Num, assists?: Num) {
  const prof = (HANDLING as unknown as Record<string, Num>)[cls];
  if (prof) for (const [k, v] of Object.entries(values)) if (typeof prof[k] === 'number') prof[k] = v;
  const a = ASSISTS as unknown as Num;
  for (const [k, v] of Object.entries(assists ?? {})) if (typeof a[k] === 'number') a[k] = v;
  invalidateHandling();
}
