// Prozedurale Ragdoll-Pose für Figuren (Spieler und NPCs) nach einem Treffer/Unfall.
//
// Der Server simuliert nur den Comic-Flug des Körpers (Höhe, Restzeit). Die Glieder berechnet jeder
// Client lokal: gedämpfte Federn je Gelenk (unterdämpft = schlaksig/„floppy“), die je nach Phase
// verschiedenen Zielposen folgen:
//   Flug    – Arme rudern, Beine strampeln, Kopf nach hinten, Rücken überstreckt
//   Liegen  – schlaffe, je Figur leicht verschiedene Liegepose (Rücken- oder Bauchlage), Nachfedern
//             beim Aufprall (Impuls auf alle Gelenke)
//   Aufstehen – Hocke mit abstützenden Armen, danach weich zurück zur normalen Animation
// Die Ausrichtung des ganzen Körpers (Überschlag, flach liegen, aufrichten) macht EntityViews.
import * as THREE from 'three';
import { rotBone } from './npcActs';

/** Zustand für ein Bild (von EntityViews). */
export interface RagdollFrame {
  /** 1 = in der Luft, 0 = am Boden */
  air: number;
  /** Lage am Boden: 1 = Rückenlage, -1 = Bauchlage */
  side: number;
  /** Aufstehen: Fortschritt 0..1 (0 = liegt noch bzw. kein Aufstehen) */
  getup: number;
  /** Aufprall-Stärke in diesem Bild (0 = keiner), ca. 0..1 */
  impact: number;
  /** Drehrate des Körpers (rad/s) – schnellere Überschläge = wildere Glieder */
  spin: number;
}

type Joint = 'spine' | 'chest' | 'neck' | 'head' | 'lArm' | 'lFore' | 'rArm' | 'rFore' | 'lUp' | 'lLeg' | 'rUp' | 'rLeg';
const BONE_RE: Record<Joint, RegExp> = {
  spine: /^spine$/i, chest: /^chest$/i, neck: /^neck$/i, head: /^head$/i,
  lArm: /^leftarm$/i, lFore: /^leftforearm$/i, rArm: /^rightarm$/i, rFore: /^rightforearm$/i,
  lUp: /^leftupleg$/i, lLeg: /^leftleg$/i, rUp: /^rightupleg$/i, rLeg: /^rightleg$/i,
};
/** Reihenfolge beim Anwenden: Eltern vor Kindern (Rumpf, dann Glieder). */
const ORDER: Joint[] = ['spine', 'chest', 'neck', 'head', 'lArm', 'lFore', 'rArm', 'rFore', 'lUp', 'lLeg', 'rUp', 'rLeg'];
/** Kanäle je Gelenk: x (vor/zurück), y (Drehung), z (seitlich) im Figurenraum. */
const N = ORDER.length * 3;
const IX = (j: Joint) => ORDER.indexOf(j) * 3;

/** Federhärte und Dämpfungsgrad (ζ < 1 = schwingt nach). */
const K = 70, ZETA = 0.32;

export class RagdollPose {
  private bones: (THREE.Bone | undefined)[] = [];
  /** aktuelle Werte, Geschwindigkeiten, Ziele (je 3 Kanäle pro Gelenk) */
  private v = new Float32Array(N);
  private vel = new Float32Array(N);
  private tgt = new Float32Array(N);
  /** Gewicht der Ragdoll-Pose über der Basisanimation (0..1) */
  w = 0;
  private t = 0;
  /** Zufallswerte je Figur (Liegepose, Phasen der Ruderbewegungen) */
  private rnd: number[] = [];

  constructor(skeletonRoot: THREE.Object3D, private inner: THREE.Object3D, seed: number) {
    skeletonRoot.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      ORDER.forEach((j, i) => { if (!this.bones[i] && BONE_RE[j].test(o.name)) this.bones[i] = o as THREE.Bone; });
    });
    let h = (Math.imul(seed + 7, 2654435761) >>> 0) || 1;
    for (let i = 0; i < 16; i++) { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; this.rnd.push((h >>> 0) / 4294967296); }
  }

  /** Federn weiterrechnen (jedes Bild, billig). f = null: Ragdoll vorbei, Gewicht klingt ab. */
  update(f: RagdollFrame | null, dt: number) {
    dt = Math.min(dt, 0.05);
    const wantW = f ? (f.getup > 0 ? 1 - smooth(0.55, 1, f.getup) : 1) : 0;
    this.w += (wantW - this.w) * Math.min(1, dt * (f ? 14 : 6));
    if (!f && this.w < 0.01) { this.w = 0; this.v.fill(0); this.vel.fill(0); return; }
    this.t += dt;
    if (f) this.targets(f);
    else this.tgt.fill(0);
    // Aufprall: zufälliger Stoß auf alle Gelenke -> Glieder schlackern nach
    if (f && f.impact > 0.02) {
      for (let i = 0; i < N; i++) this.vel[i] += (Math.random() * 2 - 1) * 14 * f.impact;
    }
    // Wilder Überschlag = lockerere Gelenke (Flug), am Boden etwas straffer
    const k = f && f.air > 0.5 ? K * (0.7 + Math.min(0.6, f.spin / 20)) : K;
    const c = 2 * ZETA * Math.sqrt(k);
    // Halbimplizites Euler, in Teilschritten stabil auch bei Rucklern
    const steps = dt > 0.02 ? 2 : 1, h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < N; i++) {
        this.vel[i] += (k * (this.tgt[i] - this.v[i]) - c * this.vel[i]) * h;
        this.v[i] += this.vel[i] * h;
      }
    }
  }

  /** Zielpose je Phase setzen. */
  private targets(f: RagdollFrame) {
    const g = this.tgt, r = this.rnd, t = this.t, s = Math.sin;
    g.fill(0);
    const set = (j: Joint, x: number, y: number, z: number, w = 1) => {
      const o = IX(j);
      g[o] += x * w; g[o + 1] += y * w; g[o + 2] += z * w;
    };
    const air = f.air, ground = 1 - air;
    if (air > 0) {
      // Flug: Arme rudern gegenläufig, Beine strampeln, Kopf/Rücken nach hinten gerissen
      const om = 9 + r[0] * 5 + Math.min(6, f.spin * 0.3);
      set('rArm', -1.7 + 1.1 * s(t * om + r[1] * 6), 0, -1.0 - 0.5 * s(t * om * 0.7 + 1), air);
      set('lArm', -1.7 + 1.1 * s(t * om + r[1] * 6 + Math.PI), 0, 1.0 + 0.5 * s(t * om * 0.7 + 2.3), air);
      set('rFore', -0.6 - 0.5 * s(t * om * 1.3), 0, 0, air);
      set('lFore', -0.6 - 0.5 * s(t * om * 1.3 + 2), 0, 0, air);
      set('rUp', -0.5 + 0.7 * s(t * om * 0.8 + r[2] * 6), 0, -0.35, air);
      set('lUp', -0.5 + 0.7 * s(t * om * 0.8 + r[2] * 6 + Math.PI), 0, 0.35, air);
      set('rLeg', 0.9 + 0.6 * s(t * om * 0.8 + 1.4), 0, 0, air);
      set('lLeg', 0.9 + 0.6 * s(t * om * 0.8 + 1.4 + Math.PI), 0, 0, air);
      set('spine', -0.3, 0.15 * s(t * 5), 0.1 * s(t * 4), air);
      set('chest', -0.15, 0, 0, air);
      set('neck', -0.25, 0, 0, air);
      set('head', -0.35 + 0.15 * s(t * om), 0.3 * s(t * 3.1), 0, air);
    }
    if (ground > 0) {
      const lie = ground * (1 - smooth(0.05, 0.35, f.getup));
      const up = ground * smooth(0.05, 0.35, f.getup);
      if (lie > 0) {
        // Liegepose: schlaff, Gliedmaßen seitlich, ein Knie angewinkelt, Kopf zur Seite (je Figur anders)
        const k1 = r[3] < 0.5 ? 1 : -1; // welches Bein angewinkelt
        const head = (r[4] * 2 - 1) * 0.9;
        if (f.side > 0) { // Rückenlage
          set('rArm', -0.25 + r[5] * 0.4, 0, -1.0 - r[6] * 0.9, lie);
          set('lArm', -0.25 + r[7] * 0.4, 0, 1.0 + r[8] * 0.9, lie);
          set('rFore', -0.3 - r[9] * 1.1, 0, 0, lie);
          set('lFore', -0.3 - r[10] * 1.1, 0, 0, lie);
          set(k1 > 0 ? 'lUp' : 'rUp', -0.75, 0, 0.3 * k1, lie);
          set(k1 > 0 ? 'lLeg' : 'rLeg', 1.3, 0, 0, lie);
          set(k1 > 0 ? 'rUp' : 'lUp', -0.05, 0, -0.25 * k1, lie);
          set('head', 0.1, head, 0, lie);
        } else { // Bauchlage: ein Arm neben dem Kopf, Bein seitlich angezogen
          set('rArm', -2.6 - r[5] * 0.4, 0, -0.5, lie);
          set('rFore', -1.0 - r[9] * 0.6, 0, 0, lie);
          set('lArm', 0.2, 0, 0.6 + r[8] * 0.6, lie);
          set('lFore', -0.4, 0, 0, lie);
          set(k1 > 0 ? 'lUp' : 'rUp', -0.4, 0, 0.9 * k1, lie);
          set(k1 > 0 ? 'lLeg' : 'rLeg', 1.4, 0, 0, lie);
          set('head', -0.3, head > 0 ? 1.1 : -1.1, 0, lie);
        }
        // Ganz leichtes Atmen/Zucken, damit die Figur nicht wie eingefroren wirkt
        set('chest', 0.04 * s(t * 2.2), 0, 0, lie);
      }
      if (up > 0) {
        // Aufstehen: in die Hocke, Arme stützen ab, Oberkörper nach vorn, Kopf hoch
        const p = f.getup;
        const crouch = 1 - smooth(0.45, 0.95, p);
        set('lUp', -1.5 * crouch, 0, 0.15 * crouch, up);
        set('rUp', -1.2 * crouch, 0, -0.15 * crouch, up);
        set('lLeg', 1.9 * crouch, 0, 0, up);
        set('rLeg', 1.6 * crouch, 0, 0, up);
        set('spine', 0.55 * crouch, 0, 0, up);
        set('chest', 0.2 * crouch, 0, 0, up);
        set('rArm', -0.7 * crouch, 0, -0.35 * crouch, up);
        set('lArm', -0.7 * crouch, 0, 0.35 * crouch, up);
        set('rFore', -0.2, 0, 0, up);
        set('lFore', -0.2, 0, 0, up);
        set('head', -0.35 * crouch, 0, 0, up);
      }
    }
  }

  /** Pose auf das Skelett anwenden – direkt nach mixer.update() (sonst summieren sich die Drehungen). */
  apply() {
    const w = this.w;
    if (w <= 0.001) return;
    for (let i = 0; i < ORDER.length; i++) {
      const b = this.bones[i];
      if (!b) continue;
      const o = i * 3, x = this.v[o] * w, y = this.v[o + 1] * w, z = this.v[o + 2] * w;
      if (Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-3) continue;
      rotBone(b, this.inner, x, y, z);
    }
  }
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
