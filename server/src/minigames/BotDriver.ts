// Wiederverwendbare NPC-Fahrer für Minispiele (Context Steering).
// Jeder Tick: Der Modus ruft die gewünschten Verhaltensbausteine mit Gewichten auf –
//   chaseTarget · flee · holdZone · avoidHazard · block
// Sie tragen „Interesse“ bzw. „Gefahr“ in 16 Himmelsrichtungen ein. drive() wählt die beste
// Richtung und erzeugt daraus Lenkung/Gas/Bremse – mit derselben Fahrphysik wie Spieler.
// Schwierigkeit (config/bots.json): Reaktionszeit (Entscheidungen nur alle n Sekunden),
// Zielungenauigkeit (zufälliger Winkelversatz) und Fehlerrate (kurzes Verlenken/Gaswegnehmen).
import { clamp, wrapAngle } from '../../../shared/src/math';
import { Btn } from '../../../shared/src/protocol';
import { upVector, type CarState } from '../../../shared/src/sim/car';
import type { BotDifficulty } from '../../../shared/src/minigames';
import type { Arena } from './Arena';

const N = 16;
const DIRS = Array.from({ length: N }, (_, i) => (i / N) * Math.PI * 2);
const DEG = Math.PI / 180;

export interface BotInput { ax: number; ay: number; buttons: number }

export class BotDriver {
  private interest = new Float32Array(N);
  private danger = new Float32Array(N);
  private car: CarState | null = null;
  private speedWant = 18;
  private ram = false;
  private ramDist = Infinity;
  private ramAngle = 0;
  /** Entfernung bis zur ersten tödlichen Stelle in Fahrtrichtung (avoidHazard) und Bremsweg. */
  private hazardDist = Infinity;
  private stopDist = 0;
  /** Drift-Assistent: in Kurven Handbremse antippen (Drift-Wettbewerb). */
  private drifty = false;
  /** Direktes Ziel (Straßenfahrt): überstimmt die Richtungswahl der Bausteine. */
  private direct: [number, number] | null = null;
  // Ausgabe (gehalten bis zur nächsten Entscheidung)
  private out: BotInput = { ax: 0, ay: 0, buttons: 0 };
  private decideT = 0;
  private aimOff = 0;
  private mistakeT = 0;
  private mistake: BotInput = { ax: 0, ay: 0, buttons: 0 };
  // Festfahren / Überschlag
  private stuck = 0;
  private reverse = 0;
  private revSteer = 0;
  private flipT = 0;
  /** Debug: zuletzt gewählte Richtung (Weltwinkel). */
  heading = 0;

  constructor(readonly diff: BotDifficulty) {
    this.decideT = Math.random() * diff.reaction;
  }

  /** Neuer Tick: Karten leeren, Fahrzeugzustand merken. */
  begin(c: CarState, speedWant = 18) {
    this.interest.fill(0);
    this.danger.fill(0);
    this.car = c;
    this.speedWant = speedWant;
    this.ram = false;
    this.ramDist = Infinity;
    this.hazardDist = Infinity;
    this.stopDist = 0;
    this.drifty = false;
    this.direct = null;
    return this;
  }

  private addInterest(angle: number, w: number, sharp = 1) {
    for (let i = 0; i < N; i++) {
      const k = Math.cos(wrapAngle(DIRS[i] - angle));
      if (k > 0) this.interest[i] += w * (sharp === 1 ? k : k ** sharp);
    }
  }

  /**
   * ChaseTarget: Ziel (vorausberechnete Position) verfolgen und rammen.
   * through: Meter, die hinter dem Ziel angepeilt werden (Rammen „durch“ das Ziel).
   */
  chaseTarget(tx: number, tz: number, tvx: number, tvz: number, w: number, opts: { through?: number; pushX?: number; pushZ?: number } = {}) {
    const c = this.car!;
    const speed = Math.hypot(c.vx, c.vz);
    const d = Math.hypot(tx - c.x, tz - c.z);
    const lead = clamp(d / Math.max(8, speed), 0, 1.2);
    let px = tx + tvx * lead, pz = tz + tvz * lead;
    // Schieberichtung: von dieser Seite aus anfahren (z. B. Richtung Rand)
    if (opts.pushX !== undefined && opts.pushZ !== undefined && d > 6) {
      const l = Math.hypot(opts.pushX, opts.pushZ) || 1;
      px -= (opts.pushX / l) * 3; pz -= (opts.pushZ / l) * 3;
    }
    if (opts.through) { const l = d || 1; px += ((tx - c.x) / l) * opts.through; pz += ((tz - c.z) / l) * opts.through; }
    const ang = Math.atan2(px - c.x, pz - c.z) + this.aimOff;
    this.addInterest(ang, w, 2);
    if (d < this.ramDist) { this.ram = true; this.ramDist = d; this.ramAngle = Math.atan2(tx - c.x, tz - c.z); }
  }

  /** Seek: einen Punkt anfahren (Wegpunkt, Zone, Straßensperre). */
  seek(x: number, z: number, w: number) {
    const c = this.car!;
    this.addInterest(Math.atan2(x - c.x, z - c.z), w, 2);
  }

  /**
   * SteerTo: Punkt direkt anpeilen (genaue Spurführung auf Straßen). Die Bausteine liefern dann
   * nur noch Bremsen bei Gefahr; Zielfehler und Fehlerrate wirken weiter.
   */
  steerTo(x: number, z: number) { this.direct = [x, z]; }

  /** Drift-Assistent für diesen Tick einschalten. */
  driftStyle() { this.drifty = true; }

  /** Wunschtempo nachträglich setzen (z. B. Vollbremsung an der Straßensperre). */
  setSpeed(v: number) { this.speedWant = v; }

  /** Flee: von einer Bedrohung wegfahren (stärker, je näher sie ist). */
  flee(tx: number, tz: number, w: number, range = 40) {
    const c = this.car!;
    const d = Math.hypot(tx - c.x, tz - c.z);
    if (d > range) return;
    const k = 1 - d / range;
    this.addInterest(Math.atan2(c.x - tx, c.z - tz), w * (0.3 + k));
    // direkt auf die Bedrohung zu ist gefährlich
    const toward = Math.atan2(tx - c.x, tz - c.z);
    for (let i = 0; i < N; i++) {
      const q = Math.cos(wrapAngle(DIRS[i] - toward));
      if (q > 0.5) this.danger[i] = Math.max(this.danger[i], w * k * (q - 0.5));
    }
  }

  /** HoldZone: in einem Kreis bleiben – zieht umso stärker zur Mitte, je weiter draußen. */
  holdZone(x: number, z: number, r: number, w: number) {
    const c = this.car!;
    const d = Math.hypot(x - c.x, z - c.z);
    const k = clamp(d / Math.max(1, r), 0, 2);
    if (k < 0.15) return;
    this.addInterest(Math.atan2(x - c.x, z - c.z), w * k);
  }

  /**
   * AvoidHazard: in jede Richtung vorausschauen (Abgrund, Wasser, fehlende/blinkende Platten).
   * Je schneller, desto weiter. Ein Rammziel davor schirmt ab (man fährt ja in das Ziel, nicht
   * in den Abgrund) – deshalb chaseTarget VOR avoidHazard aufrufen. Gefahr im Bremsweg → Bremsen.
   */
  avoidHazard(arena: Arena, w: number) {
    const c = this.car!;
    const speed = Math.hypot(c.vx, c.vz);
    const look = [2.5, 4 + speed * 0.3, 6 + speed * 0.55];
    const fall = [1, 0.75, 0.45];
    const cw = w * this.diff.caution;
    for (let i = 0; i < N; i++) {
      const sx = Math.sin(DIRS[i]), sz = Math.cos(DIRS[i]);
      const shield = this.ram && Math.cos(wrapAngle(DIRS[i] - this.ramAngle)) > 0.92 ? this.ramDist + 2.5 : Infinity;
      let h = 0;
      for (let k = 0; k < look.length; k++) {
        if (look[k] > shield) break;
        h = Math.max(h, arena.hazard(c.x + sx * look[k], c.z + sz * look[k]) * fall[k]);
      }
      this.danger[i] = Math.max(this.danger[i], cw * h);
    }
    // Erste tödliche Stelle in Bewegungsrichtung innerhalb des Bremswegs
    if (speed > 3) {
      const mx = c.vx / speed, mz = c.vz / speed;
      this.stopDist = ((speed * speed) / (2 * 8) + 2) * this.diff.caution;
      for (let s = 1.5; s <= this.stopDist; s += 1.5) {
        if (arena.hazard(c.x + mx * s, c.z + mz * s) >= 1) { this.hazardDist = s; break; }
      }
    }
  }

  /**
   * Block: sich vor das Ziel stellen bzw. seinen Weg abschneiden. Ohne goal wird der Punkt
   * vor dem Ziel in Fahrtrichtung angefahren, mit goal der Punkt zwischen Ziel und goal.
   */
  block(tx: number, tz: number, tvx: number, tvz: number, w: number, goal?: { x: number; z: number }) {
    const c = this.car!;
    let ix: number, iz: number;
    if (goal) {
      const k = 0.35;
      ix = tx + (goal.x - tx) * k; iz = tz + (goal.z - tz) * k;
    } else {
      const ts = Math.hypot(tvx, tvz);
      const ahead = clamp(ts * 1.4, 6, 30);
      ix = tx + (ts > 0.5 ? (tvx / ts) * ahead : 0); iz = tz + (ts > 0.5 ? (tvz / ts) * ahead : 0);
    }
    this.addInterest(Math.atan2(ix - c.x, iz - c.z) + this.aimOff, w, 2);
  }

  /** Beste Richtung wählen und für `steps` Physikschritte fahren. */
  drive(dt: number, step: (ax: number, ay: number, buttons: number) => void, steps: number) {
    const c = this.car!;
    const speed = Math.hypot(c.vx, c.vz);
    const fwd = c.vx * Math.sin(c.a) + c.vz * Math.cos(c.a);
    this.decideT -= dt;
    this.mistakeT -= dt;
    if (this.decideT <= 0) {
      this.decideT = this.diff.reaction * (0.7 + Math.random() * 0.6);
      this.aimOff = (Math.random() * 2 - 1) * this.diff.aimError * DEG;
      this.out = this.decide(c, speed, fwd);
      // Fehler: kurzes Verlenken oder Gaswegnehmen
      if (this.mistakeT <= 0 && Math.random() < (this.diff.mistakeRate / 60) * Math.max(dt, this.diff.reaction)) {
        this.mistakeT = this.diff.mistakeTime;
        this.mistake = Math.random() < 0.5 ? { ax: Math.random() < 0.5 ? -1 : 1, ay: this.out.ay, buttons: 0 } : { ax: this.out.ax, ay: 0, buttons: 0 };
      }
    }
    let { ax, ay, buttons } = this.mistakeT > 0 ? this.mistake : this.out;
    // Festgefahren: zurücksetzen (immer sofort, unabhängig von der Reaktionszeit)
    if (speed < 1.2 && ay > 0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.3 && this.reverse <= 0) { this.reverse = 0.9; this.stuck = 0; this.revSteer = Math.random() < 0.5 ? -1 : 1; }
    if (this.reverse > 0) { this.reverse -= dt; ay = -1; ax = this.revSteer; buttons = 0; }
    this.flipT = upVector(c)[1] < 0.4 ? this.flipT + dt : 0;
    if (this.flipT > 1.5) buttons |= Btn.UNFLIP;
    for (let k = 0; k < steps; k++) step(ax, ay, buttons);
  }

  private decide(c: CarState, speed: number, fwd: number): BotInput {
    // Beste Richtung: Interesse minus (doppelte) Gefahr, kleiner Bonus für die aktuelle Fahrtrichtung
    let best = -Infinity, bi = 0;
    for (let i = 0; i < N; i++) {
      const keep = 0.08 * Math.max(0, Math.cos(wrapAngle(DIRS[i] - c.a)));
      const s = this.interest[i] - this.danger[i] * 2 + keep;
      if (s > best) { best = s; bi = i; }
    }
    // Feinere Richtung: gewichtetes Mittel mit den Nachbarn
    const l = (bi + N - 1) % N, r = (bi + 1) % N;
    const sl = this.interest[l] - this.danger[l] * 2, sr = this.interest[r] - this.danger[r] * 2, sb = best;
    const den = sl - 2 * sb + sr;
    const off = den < -1e-6 ? clamp((0.5 * (sl - sr)) / den, -0.5, 0.5) : 0;
    const want = this.direct
      ? Math.atan2(this.direct[0] - c.x, this.direct[1] - c.z) + this.aimOff * 0.25
      : DIRS[bi] + off * ((Math.PI * 2) / N);
    this.heading = want;
    const diff = wrapAngle(want - c.a);
    let ax = clamp(-diff * 2.2, -1, 1);
    // Wunschtempo 0 = anhalten (Straßensperre, Startverzögerung)
    let ay = this.speedWant <= 0 ? (fwd > 0.5 ? -1 : 0) : speed < this.speedWant ? 1 : 0.2;
    let buttons = 0;
    // Ziel liegt hinter uns und vorne droht Gefahr: rückwärts herausdrehen
    if (this.speedWant <= 0) return { ax: 0, ay, buttons: speed < 1 ? Btn.BRAKE : 0 };
    if (Math.abs(diff) > 2.0 && this.danger[this.dirIndex(c.a)] > 0.4) {
      return { ax: clamp(diff * 2, -1, 1), ay: -1, buttons: 0 };
    }
    if (this.speedWant > 0 && speed > this.speedWant + 3) ay = -0.7; // deutlich zu schnell (Kurve voraus): bremsen
    if (Math.abs(diff) > 1.2 && speed > 9) ay = -0.5;
    if (Math.abs(diff) > 1.6 && speed > 5 && speed < 15) buttons = Btn.BRAKE; // Handbremswende
    // Drift: in der Kurve kurz die Handbremse ziehen und mit Gas halten, gegenlenken übernimmt die Physik
    if (this.drifty && Math.abs(diff) > 0.35 && speed > 11 && Math.random() < 0.5) { buttons = Btn.BRAKE; ay = 1; }
    // Gefahr im Bremsweg: bremsen (bei Rückwärtsfahrt nicht) – außer ein Rammziel liegt davor
    const shielded = this.ram && this.ramDist + 3 < this.hazardDist && Math.abs(wrapAngle(this.ramAngle - Math.atan2(c.vx, c.vz))) < 0.4;
    const brake = this.hazardDist < this.stopDist && fwd > 2 && !shielded;
    if (brake) { ay = -1; buttons = 0; }
    // Rammstoß: nah, ausgerichtet → Vollgas + Nitro (falls vorhanden)
    else if (this.ram && this.ramDist < 14 && Math.abs(diff) < 0.35) { ay = 1; buttons |= Btn.SPRINT; }
    return { ax, ay, buttons };
  }

  private dirIndex(a: number) {
    return ((Math.round((a / (Math.PI * 2)) * N) % N) + N) % N;
  }
}
