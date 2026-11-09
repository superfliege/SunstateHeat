// Prozedurale Szenario-Posen für NPCs (spec 10.1: „Details wie Kopfdrehung und Gestik berechnet jeder
// Client lokal“). Der Server schickt nur die Animations-ID `Act`; hier wird daraus über die Kenney-
// Basisanimation (Stehen/Sitzen) eine Pose: Arme zum Ohr (Telefon), Hand zum Mund (Rauchen/Essen),
// Gestik beim Gespräch, Tanzen, Angeln, Kamera, Gitarre … plus kleine Gegenstände in der Hand.
//
// Knochen werden in "Figurenraum" gedreht (x = links, y = oben, z = vorn), unabhängig von den Achsen des
// FBX-Skeletts: new = M⁻¹ · R · M · alt, M = Ausrichtung des Eltern-Knochens im Figurenraum.
import * as THREE from 'three';
import { Act } from '../../../shared/src/npc/scenarios';
import { box, cyl, ico, merge } from './geom';
import { toonVC } from './models';

type BoneName = 'hips' | 'spine' | 'chest' | 'neck' | 'head' | 'lArm' | 'lFore' | 'lHand' | 'rArm' | 'rFore' | 'rHand';
const BONE_RE: Record<BoneName, RegExp> = {
  hips: /^hips$/i, spine: /^spine$/i, chest: /^chest$/i, neck: /^neck$/i, head: /^head$/i,
  lArm: /^leftarm$/i, lFore: /^leftforearm$/i, lHand: /^lefthand$/i,
  rArm: /^rightarm$/i, rFore: /^rightforearm$/i, rHand: /^righthand$/i,
};

type PropId = 'phone' | 'cig' | 'camera' | 'taco' | 'cup' | 'paper' | 'rod' | 'guitar' | 'ball';
interface PropDef { geo: () => THREE.BufferGeometry; anchor: 'R' | 'L' | 'mid' | 'chest'; pos: [number, number, number]; rot: [number, number, number] }

const DARK = 0x23233a, WHITE = 0xf4f1e8, TACO = 0xf2c14e, GREEN = 0x4fd16b, RED = 0xe0453a, WOOD = 0x9a6a3a, ORANGE = 0xff8a2a;
const PROPS: Record<PropId, PropDef> = {
  phone: { geo: () => merge([box(0.09, 0.17, 0.03, 0, -0.085, 0, DARK), box(0.07, 0.14, 0.005, 0, -0.07, 0.016, 0x7ac8ff)]), anchor: 'R', pos: [-0.04, 0.02, 0.0], rot: [0, 0, 0] },
  cig: { geo: () => merge([box(0.025, 0.02, 0.16, 0, 0, 0, WHITE), box(0.026, 0.021, 0.03, 0, 0, 0.1, ORANGE)]), anchor: 'R', pos: [0, 0.05, 0.1], rot: [0, 0, 0] },
  camera: { geo: () => merge([box(0.2, 0.13, 0.1, 0, -0.065, 0, DARK), cyl(0.045, 0.045, 0.08, 8, 0, -0.065, 0.05, 0x8a8aa0)]), anchor: 'mid', pos: [0, 0.12, 0.12], rot: [Math.PI / 2, 0, 0] },
  taco: { geo: () => merge([box(0.2, 0.06, 0.12, 0, 0, 0, TACO), box(0.19, 0.05, 0.1, 0, 0.05, 0, GREEN)]), anchor: 'R', pos: [0, 0.04, 0.1], rot: [0.3, 0, 0] },
  cup: { geo: () => merge([cyl(0.075, 0.055, 0.17, 8, 0, 0, 0, RED), cyl(0.08, 0.08, 0.02, 8, 0, 0.17, 0, WHITE)]), anchor: 'R', pos: [0, -0.06, 0.08], rot: [0, 0, 0] },
  paper: { geo: () => merge([box(0.46, 0.012, 0.36, 0, 0, 0, 0xe8e4d8), box(0.44, 0.013, 0.01, 0, 0, 0, 0x6a6a7a)]), anchor: 'mid', pos: [0, 0.05, 0.22], rot: [-1.0, 0, 0] },
  rod: { geo: () => merge([box(0.03, 0.03, 2.4, 0, 0, 0, WOOD), box(0.01, 0.9, 0.01, 0, -0.9, 2.4, 0xe8e4d8), box(0.1, 0.1, 0.1, 0, -0.95, 2.4, RED)]), anchor: 'R', pos: [0, 0.0, 0.0], rot: [-0.7, 0, 0] },
  guitar: { geo: () => merge([box(0.46, 0.5, 0.12, 0, -0.25, 0, 0xc9732e), box(0.12, 0.12, 0.13, 0, -0.06, 0, DARK), box(0.07, 0.95, 0.06, 0, 0.2, 0, 0x6a3f20)]), anchor: 'chest', pos: [0.02, -0.25, 0.32], rot: [0.4, 0, 1.0] },
  ball: { geo: () => ico(0.19, 0, 0, 0, ORANGE), anchor: 'R', pos: [0, 0.14, 0.08], rot: [0, 0, 0] },
};
const ACT_PROP: Partial<Record<number, PropId>> = {
  [Act.Phone]: 'phone', [Act.Smoke]: 'cig', [Act.Photo]: 'camera', [Act.Eat]: 'taco', [Act.Drink]: 'cup',
  [Act.Read]: 'paper', [Act.Fish]: 'rod', [Act.Busk]: 'guitar', [Act.Hoop]: 'ball',
  [Act.Film]: 'phone', [Act.Call]: 'phone',
};

/** Acts, bei denen die Figur sitzt (Sitz-Clip). */
export const SEATED_ACTS = new Set<number>([Act.Sit, Act.Drink, Act.Cower]);
/** Acts ohne eigene Pose-Berechnung (normales Laufen/Stehen). */
const NO_POSE = new Set<number>([Act.None, Act.Jog, Act.Dog]);

const propGeo = new Map<PropId, THREE.BufferGeometry>();
const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Quaternion(), tmpR = new THREE.Quaternion(), tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();

/**
 * Rotation `x, y, z` (Euler YXZ im Figurenraum: x = links, y = oben, z = vorn) auf einen Knochen anwenden,
 * unabhängig von den Achsen des FBX-Skeletts. `inner` = Figurenraum. Nach jedem Mixer-Update aufrufen.
 */
export function rotBone(b: THREE.Bone, inner: THREE.Object3D, x: number, y: number, z: number) {
  if (!b.parent) return;
  // M = Ausrichtung des Eltern-Knochens relativ zum Figurenraum (inner)
  tmpM.identity();
  let n = 0;
  for (let o: THREE.Object3D | null = b.parent; o && o !== inner; o = o.parent) chain[n++] = o;
  for (let i = n - 1; i >= 0; i--) tmpM.multiply(chain[i].quaternion);
  tmpR.setFromEuler(tmpE.set(x, y, z, 'YXZ'));
  // new = M⁻¹ · R · M · old
  tmpQ.copy(tmpM).invert().multiply(tmpR).multiply(tmpM);
  b.quaternion.premultiply(tmpQ);
}
/** Wiederverwendetes Array für die Knochenkette (keine Allokation pro Aufruf). */
const chain: THREE.Object3D[] = [];

export class NpcActs {
  private bones: Partial<Record<BoneName, THREE.Bone>> = {};
  act = 0;
  private seed = 0;
  private t = 0;
  private prop: THREE.Mesh | null = null;
  private propId: PropId | null = null;
  /** Kopfdrehung (lokal berechnet): Ziel-Gierwinkel relativ zum Körper, Gewicht 0–1 (weich überblendet) */
  private lookYaw = 0;
  private lookW = 0;
  private lookWant = 0;
  private lookWantW = 0;
  private lookAnx = false;

  constructor(private skeletonRoot: THREE.Object3D, private inner: THREE.Group, private root: THREE.Group) {
    skeletonRoot.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      for (const k of Object.keys(BONE_RE) as BoneName[]) if (BONE_RE[k].test(o.name) && !this.bones[k]) this.bones[k] = o as THREE.Bone;
    });
  }

  /** Neue Animations-ID (vom Server). seed = pro NPC fester Wert für Phasenversatz. */
  setAct(act: number, seed: number) {
    this.seed = seed;
    if (act === this.act) return;
    this.act = act;
    // Basis-Transform der Figur je Act
    this.inner.rotation.set(0, 0, 0);
    const base = this.inner.userData.baseY as number;
    this.inner.position.set(0, base, 0);
    const lieOff = act === Act.Lie ? 1 : 0;
    if (lieOff) { this.inner.rotation.x = -1.42; this.inner.position.set(0, base + 0.42, -0.35); }
    else if (act === Act.Sit || act === Act.Drink) this.inner.position.set(0, base + SIT_DROP, SIT_BACK);
    else if (act === Act.Lean) { this.inner.rotation.x = -0.2; this.inner.position.set(0, base, -0.28); }
    else if (act === Act.Cower) this.inner.position.set(0, base + COWER_DROP, 0.1); // auf dem Boden hocken
    const want = ACT_PROP[act] ?? null;
    if (want !== this.propId) {
      if (this.prop) { this.root.remove(this.prop); this.prop = null; }
      this.propId = want;
      if (want) {
        let g = propGeo.get(want);
        if (!g) propGeo.set(want, (g = PROPS[want].geo()));
        this.prop = new THREE.Mesh(g, toonVC);
        this.prop.frustumCulled = false;
        this.root.add(this.prop);
      }
    }
  }

  /** Rotation `x, y, z` (Figurenraum) auf einen Knochen anwenden – nach jedem Mixer-Update aufrufen. */
  private rot(name: BoneName, x: number, y: number, z: number) {
    const b = this.bones[name];
    if (b) rotBone(b, this.inner, x, y, z);
  }

  /**
   * Kopf zu einem Ziel drehen (Blickkontakt, ängstliches Beobachten). yaw = Winkel relativ zur Blickrichtung
   * des Körpers, w = Gewicht (0 = geradeaus). anxious = leicht eingezogener Kopf.
   */
  setLook(yaw: number, w: number, anxious = false) { this.lookWant = yaw; this.lookWantW = w; this.lookAnx = anxious; }

  /** Kopfdrehung anwenden (nach mixer.update() und apply()). dt = vergangene Zeit seit dem letzten Aufruf. */
  applyLook(dt: number) {
    const k = Math.min(1, dt * 5);
    this.lookW += (this.lookWantW - this.lookW) * k;
    this.lookYaw += (this.lookWant - this.lookYaw) * Math.min(1, dt * 7);
    if (this.lookW < 0.02) return;
    const y = Math.max(-1.15, Math.min(1.15, this.lookYaw)) * this.lookW;
    this.rot('neck', 0, y * 0.35, 0);
    this.rot('head', this.lookAnx ? 0.18 * this.lookW : -0.04 * this.lookW, y * 0.65, 0);
  }

  /** Pose berechnen (nur für nahe NPCs aufrufen). Nach mixer.update(). */
  apply(dt: number) {
    this.t += dt;
    const a = this.act;
    if (NO_POSE.has(a)) return;
    const t = this.t + this.seed * 7.3;
    const s = Math.sin, c = Math.cos;
    switch (a) {
      case Act.Phone: // Hand ans Ohr, Kopf leicht geneigt, ab und zu Gestik mit der freien Hand
        this.rot('rArm', -0.35, 0, -0.55); this.rot('rFore', -2.3, 0, 0);
        this.rot('head', 0, 0.2 * s(t * 0.5), 0.12);
        this.rot('lArm', -0.2 - 0.25 * Math.max(0, s(t * 1.3)), 0, 0.2); this.rot('lFore', -0.5 - 0.5 * Math.max(0, s(t * 1.3)), 0, 0);
        break;
      case Act.Smoke: { // Zug: Hand zum Mund, dann wieder runter, Kopf zurück
        const drag = Math.max(0, s(t * 0.9)) ** 0.6;
        this.rot('rArm', -0.3 - 0.2 * drag, 0, -0.35); this.rot('rFore', -0.7 - 1.45 * drag, 0, 0);
        this.rot('head', -0.15 * drag, 0.25 * s(t * 0.3), 0);
        this.rot('lArm', -0.3, 0, 0.1); this.rot('lFore', -1.3, 0, 0);
        break;
      }
      case Act.Talk: { // Kopf wandert zwischen den Gesprächspartnern, Gestik mit beiden Händen
        const g = 0.5 + 0.5 * s(t * 0.8);
        this.rot('head', 0.06 * s(t * 2.1), 0.45 * s(t * 0.55 + 1), 0);
        this.rot('rArm', -0.5 - 0.35 * g, 0, -0.35); this.rot('rFore', -0.9 - 0.7 * s(t * 3.1) * g, 0, 0);
        this.rot('lArm', -0.35 - 0.3 * (1 - g), 0, 0.3); this.rot('lFore', -0.7 - 0.6 * s(t * 2.6 + 1) * (1 - g), 0, 0);
        break;
      }
      case Act.Photo: // Kamera vors Gesicht, Kopf leicht gekippt
        this.rot('rArm', -1.15, 0, -0.1); this.rot('rFore', -1.45, 0.4, 0);
        this.rot('lArm', -1.15, 0, 0.1); this.rot('lFore', -1.45, -0.4, 0);
        this.rot('head', 0.05, 0.12 * s(t * 0.4), 0.08 * s(t * 0.7));
        break;
      case Act.Eat: { // abbeißen: Hand zum Mund im Rhythmus
        const bite = Math.max(0, s(t * 1.2)) ** 0.7;
        this.rot('rArm', -0.4 - 0.3 * bite, 0, -0.3); this.rot('rFore', -0.9 - 1.1 * bite, 0, 0);
        this.rot('head', 0.12 * bite, 0.15 * s(t * 0.4), 0);
        break;
      }
      case Act.Drink: { // Tasse zum Mund
        const sip = Math.max(0, s(t * 0.5)) ** 2;
        this.rot('rArm', -0.5 - 0.2 * sip, 0, -0.2); this.rot('rFore', -1.0 - 0.9 * sip, 0, 0);
        this.rot('head', -0.12 * sip, 0.2 * s(t * 0.25), 0);
        break;
      }
      case Act.Fish: // Angel mit beiden Händen halten, aufs Wasser starren
        this.rot('rArm', -0.8, 0, -0.1); this.rot('rFore', -0.9, 0, 0);
        this.rot('lArm', -0.7, 0, 0.15); this.rot('lFore', -1.0, 0, 0);
        this.rot('head', 0.12, 0.08 * s(t * 0.3), 0);
        break;
      case Act.Dance: { // Hüfte schwingen, Arme abwechselnd hoch, Kopf wippt
        const b = t * 5.5;
        this.rot('hips', 0, 0.45 * s(b), 0.12 * s(b * 0.5));
        this.rot('chest', 0.05 * c(b * 2), -0.3 * s(b), 0);
        this.rot('rArm', -0.4, 0, -1.6 - 0.7 * Math.max(0, s(b))); this.rot('rFore', -1.3 + 0.6 * s(b), 0, 0);
        this.rot('lArm', -0.4, 0, 1.6 + 0.7 * Math.max(0, -s(b))); this.rot('lFore', -1.3 - 0.6 * s(b), 0, 0);
        this.rot('head', 0.12 * s(b * 2), 0.2 * s(b), 0);
        break;
      }
      case Act.Busk: { // Gitarre: Schlaghand wippt, andere Hand am Hals
        const st = s(t * 7);
        this.rot('rArm', -0.5, 0, -0.5); this.rot('rFore', -1.1 + 0.25 * st, 0, 0);
        this.rot('lArm', -1.0, 0, 0.35); this.rot('lFore', -1.0, 0, 0);
        this.rot('head', 0.2 + 0.05 * s(t * 3), 0.2 * s(t * 0.4), 0);
        break;
      }
      case Act.Watch: { // Zuhören, gelegentlich klatschen
        const clap = s(t * 0.35) > 0.7;
        const k = clap ? s(t * 14) : 0;
        this.rot('rArm', -0.7, 0, -0.2); this.rot('rFore', -1.5 - 0.2 * k, 0.5, 0);
        this.rot('lArm', -0.7, 0, 0.2); this.rot('lFore', -1.5 - 0.2 * k, -0.5, 0);
        this.rot('head', 0.05, 0.25 * s(t * 0.3), 0);
        break;
      }
      case Act.Search: // Oberkörper in die Tonne, Arme wühlen
        this.rot('spine', 0.55, 0, 0); this.rot('chest', 0.3, 0, 0);
        this.rot('rArm', -0.9 - 0.3 * s(t * 3), 0, -0.2); this.rot('rFore', -0.6, 0, 0);
        this.rot('lArm', -0.9 - 0.3 * s(t * 3 + 2), 0, 0.2); this.rot('lFore', -0.6, 0, 0);
        this.rot('head', 0.2, 0.3 * s(t * 0.8), 0);
        break;
      case Act.Read: // Zeitung vor der Brust, Kopf nach unten
        this.rot('rArm', -0.85, 0, -0.1); this.rot('rFore', -1.35, 0.3, 0);
        this.rot('lArm', -0.85, 0, 0.1); this.rot('lFore', -1.35, -0.3, 0);
        this.rot('head', 0.35, 0.1 * s(t * 0.3), 0);
        break;
      case Act.Atm: // leicht vorgebeugt, tippt
        this.rot('spine', 0.14, 0, 0);
        this.rot('rArm', -0.95, 0, -0.1); this.rot('rFore', -0.55 - 0.2 * Math.max(0, s(t * 4)), 0, 0);
        this.rot('lArm', -0.3, 0, 0.15); this.rot('lFore', -0.9, 0, 0);
        this.rot('head', 0.15, 0, 0);
        break;
      case Act.Wait: { // wartet: Blick nach links/rechts, ab und zu auf die Uhr
        const watch = Math.max(0, s(t * 0.22)) ** 3;
        this.rot('head', 0, 0.55 * s(t * 0.45), 0);
        this.rot('lArm', -0.5 * watch, 0, 0.1); this.rot('lFore', -1.9 * watch, 0, 0);
        this.rot('rArm', -0.1, 0, -0.1);
        break;
      }
      case Act.Hoop: { // Wurfzyklus: Ball auf Hüfthöhe, dann über den Kopf
        const sh = Math.max(0, s(t * 1.4));
        this.rot('rArm', -0.9 - 1.7 * sh, 0, -0.15); this.rot('rFore', -1.4 + 1.1 * sh, 0, 0);
        this.rot('lArm', -0.9 - 1.5 * sh, 0, 0.15); this.rot('lFore', -1.4 + 1.1 * sh, 0, 0);
        this.rot('head', -0.25 * sh, 0, 0);
        break;
      }
      case Act.Lean: // lässig: eine Hand in der Tasche, Kopf schaut herum
        this.rot('rArm', 0.1, 0, -0.25); this.rot('rFore', -1.4, 0.5, 0);
        this.rot('lArm', -0.2, 0, 0.15); this.rot('lFore', -0.4, 0, 0);
        this.rot('head', 0.05, 0.4 * s(t * 0.35), 0);
        break;
      case Act.Sit: // sitzend: Hände auf den Knien, Kopf schaut
        this.rot('lArm', -0.6, 0, 0.1); this.rot('lFore', -0.9, 0.3, 0);
        this.rot('rArm', -0.6, 0, -0.1); this.rot('rFore', -0.9, -0.3, 0);
        this.rot('head', 0.05, 0.4 * s(t * 0.3), 0);
        break;
      // ---------------------------------------------------------------- Reaktionen
      case Act.Look: // hinschauen: Hand über die Augen, Oberkörper leicht vor
        this.rot('spine', 0.06, 0, 0);
        this.rot('rArm', -0.5, 0, -0.75); this.rot('rFore', -2.2, 0, 0);
        this.rot('head', -0.08, 0.12 * s(t * 0.7), 0);
        break;
      case Act.Flinch: { // erschrecken: Arme schützend vors Gesicht, zurücklehnen, zittern
        const tr = 0.04 * s(t * 40);
        this.rot('spine', -0.2, 0, 0);
        this.rot('rArm', -1.25 + tr, 0, -0.45); this.rot('rFore', -1.7, 0, 0);
        this.rot('lArm', -1.25 - tr, 0, 0.45); this.rot('lFore', -1.7, 0, 0);
        this.rot('head', 0.25, 0, 0);
        break;
      }
      case Act.Scold: { // schimpfen: Faust schütteln, andere Hand in die Hüfte, vorgebeugt
        const sh = s(t * 11);
        this.rot('spine', 0.12, 0, 0);
        this.rot('rArm', -1.7 + 0.25 * sh, 0, -0.2); this.rot('rFore', -1.0 + 0.3 * sh, 0, 0);
        this.rot('lArm', 0.15, 0, 0.55); this.rot('lFore', -1.7, 0, 0);
        this.rot('head', 0.12 + 0.06 * s(t * 7), 0.15 * s(t * 3), 0);
        break;
      }
      case Act.Film: // Handy hochhalten und filmen
        this.rot('rArm', -1.55, 0, -0.1); this.rot('rFore', -0.75, 0, 0);
        this.rot('lArm', -0.3, 0, 0.15); this.rot('lFore', -1.0, 0, 0);
        this.rot('head', 0.0, 0.08 * s(t * 0.9), 0);
        break;
      case Act.Cower: // ducken: hocken, Arme über dem Kopf
        this.rot('spine', 0.6, 0, 0); this.rot('chest', 0.35, 0, 0);
        this.rot('rArm', -2.5, 0, -0.35); this.rot('rFore', -1.5, 0, 0);
        this.rot('lArm', -2.5, 0, 0.35); this.rot('lFore', -1.5, 0, 0);
        this.rot('head', 0.55, 0.05 * s(t * 30), 0);
        break;
      case Act.Point: // auf den Gesuchten zeigen, andere Hand am Mund
        this.rot('rArm', -1.5, 0, -0.05 + 0.04 * s(t * 6)); this.rot('rFore', -0.08, 0, 0);
        this.rot('lArm', -0.35, 0, 0.3); this.rot('lFore', -2.1, 0, 0);
        this.rot('head', -0.05, 0, 0);
        break;
      case Act.Call: { // Polizei rufen: Handy am Ohr, aufgeregte Gestik
        const g = Math.max(0, s(t * 3.2));
        this.rot('rArm', -0.35, 0, -0.55); this.rot('rFore', -2.3, 0, 0);
        this.rot('lArm', -0.6 - 0.6 * g, 0, 0.35); this.rot('lFore', -0.8 - 0.6 * g, 0, 0);
        this.rot('head', 0.05, 0.35 * s(t * 1.7), 0.1);
        break;
      }
      case Act.Panic: { // rennt mit hochgerissenen, rudernden Armen
        const f = s(t * 13);
        this.rot('rArm', -2.6 + 0.35 * f, 0, -0.35); this.rot('rFore', -0.4, 0, 0);
        this.rot('lArm', -2.6 - 0.35 * f, 0, 0.35); this.rot('lFore', -0.4, 0, 0);
        this.rot('head', -0.15, 0.2 * s(t * 5), 0);
        break;
      }
      case Act.Wave: // winken
        this.rot('rArm', -0.2, 0, -2.5); this.rot('rFore', 0, 0, -0.6 + 0.5 * s(t * 10));
        break;
      case Act.Enter: // Tür öffnen / Autotür greifen
        this.rot('rArm', -1.2, 0, -0.1); this.rot('rFore', -0.35, 0, 0);
        break;
      case Act.Lie: // liegend: Arme locker, Kopf ruht
        this.rot('rArm', 0.3, 0, -0.1); this.rot('lArm', 0.2, 0, 0.1);
        this.rot('head', 0, 0, 0);
        break;
    }
  }

  /** Gegenstand an die Hand/Brust setzen (jedes Bild, nachdem sich die Pose geändert hat). */
  syncProp() {
    if (!this.prop || !this.propId) return;
    const def = PROPS[this.propId];
    this.root.updateMatrixWorld(true);
    const pick = (k: 'rHand' | 'lHand' | 'chest', out: THREE.Vector3) => {
      const b = this.bones[k];
      return b ? this.root.worldToLocal(b.getWorldPosition(out)) : out.set(0, 1.2, 0.3);
    };
    if (def.anchor === 'R') pick('rHand', tmpV);
    else if (def.anchor === 'L') pick('lHand', tmpV);
    else if (def.anchor === 'mid') { pick('rHand', tmpV); pick('lHand', tmpV2); tmpV.add(tmpV2).multiplyScalar(0.5); }
    else pick('chest', tmpV);
    this.prop.position.set(tmpV.x + def.pos[0], tmpV.y + def.pos[1], tmpV.z + def.pos[2]);
    this.prop.rotation.set(def.rot[0], def.rot[1], def.rot[2]);
  }

  dispose() {
    if (this.prop) this.root.remove(this.prop);
  }
}

/** Sitzhöhe: wie weit die Figur beim Sitzen abgesenkt wird (m) und nach hinten (z), je nach Skelett-Pose abgestimmt. */
export const SIT_DROP = -0.5;
export const SIT_BACK = -0.05;
/** Ducken: Figur hockt (Sitz-Clip, tiefer abgesenkt). */
export const COWER_DROP = -0.78;
