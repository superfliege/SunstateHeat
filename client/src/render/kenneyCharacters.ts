// Figuren aus Kenney "Animated Characters" (CC0, siehe CREDITS.md): ein Menschenmodell mit
// normalen Proportionen, viele Skins (Anzug, Casual, Sport, Skater, Farmer …) und Animationen
// (Stehen, Gehen, Rennen, Schlagen, Sitzen). Skins werden passend zum Viertel gewählt; Oberteil und
// Hose lassen sich auf der Textur umfärben (Spielerfarbe, Gangfarbe, Polizei-Uniform).
//
// Kenney-Skin-Layout (1024², Ursprung oben links): Kopf oben links, Oberteil inkl. Ärmel unten links
// (u 0–0,62, v 0,48–1), Hose unten rechts (u 0,61–1, v 0,75–1), Schuhe/Arme oben rechts.
// Fehlen die Dateien, liefert createKenneyCharacter null und das Spiel nimmt die anderen Figuren.
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { addOutline, computeOutlineNormals, LINE, toonMaterial, U } from './materials/toon';
import { setFigureBounds, type Style } from './characters';
import { Act } from '../../../shared/src/npc/scenarios';
import { NpcActs, SEATED_ACTS } from './npcActs';
import { RagdollPose, type RagdollFrame } from './ragdoll';

const DIR = 'assets/kenney/animated-characters/';

/** Skins je Rolle/Stil (Dateinamen ohne .png). */
const SKINS = {
  beach: ['athleteFemaleBlue', 'athleteFemaleYellow', 'athleteMaleGreen', 'athleteMaleRed', 'skaterFemaleA', 'skaterMaleA', 'casualFemaleA', 'casualMaleB'],
  business: ['businessMaleA', 'businessMaleB', 'businessMaleA', 'casualFemaleB'],
  outdoor: ['farmerA', 'farmerB', 'survivorFemaleA', 'survivorFemaleB', 'survivorMaleA', 'survivorMaleB', 'militaryMaleA'],
  casual: ['casualFemaleA', 'casualFemaleB', 'casualMaleA', 'casualMaleB', 'skaterFemaleA', 'skaterMaleA', 'athleteMaleRed', 'athleteFemaleBlue'],
  gang: ['criminalMaleA', 'survivorMaleA', 'survivorMaleB', 'skaterMaleA', 'casualMaleB'],
  // Anzug-Skin: weißes Hemd mit Krawatte -> blaues Uniformhemd, graue Hose -> dunkelblau
  cop: ['businessMaleA', 'businessMaleB'],
  player: ['casualMaleA', 'skaterMaleA', 'casualFemaleA', 'skaterFemaleA', 'criminalMaleA'],
} as const;
export type KenneyRole = Style | 'gang' | 'cop' | 'player';

const ALL_SKINS = [...new Set(Object.values(SKINS).flat())];
const CLIPS = { idle: 'idle', walk: 'walk', run: 'run', punch: 'punch', sit: 'racingIdle' } as const;
type ClipName = keyof typeof CLIPS;

const TARGET_HEIGHT = 1.8 * 1.25; // wie die übrigen Figuren: etwas größer, besser lesbar von oben
const TEX_SIZE = 256;
const HEAD_SCALE = 0.84;

let base: THREE.Object3D | null = null;
let baseHeight = 1;
let baseMinY = 0;
const clips: Partial<Record<ClipName, THREE.AnimationClip>> = {};
const skinImages = new Map<string, HTMLImageElement | ImageBitmap>();

// ------------------------------------------------------------------ Laden
export async function loadKenneyCharacters(onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const loader = new FBXLoader();
  const total = 1 + Object.keys(CLIPS).length + ALL_SKINS.length;
  let done = 0;
  const tick = () => onProgress?.(++done, total);
  try {
    const model = await loader.loadAsync(DIR + 'Models/characterMedium.fbx');
    tick();
    await Promise.all([
      ...(Object.entries(CLIPS) as [ClipName, string][]).map(async ([k, file]) => {
        try {
          const a = await loader.loadAsync(`${DIR}Animations/${file}.fbx`);
          // Die Dateien enthalten mehrere Clips (z. T. nur eine Pose) -> den längsten nehmen
          const clip = a.animations.reduce<THREE.AnimationClip | undefined>((best, c) => (!best || c.duration > best.duration ? c : best), undefined);
          if (clip) {
            clip.name = k;
            // Skalierungsspuren weglassen (alle 1) – so bleibt die Kopfgröße unten einstellbar
            clip.tracks = clip.tracks.filter((t) => !t.name.endsWith('.scale'));
            clips[k] = clip;
          }
        } catch (err) { console.warn(`[figuren] Animation ${file} fehlt`, err); }
        tick();
      }),
      ...ALL_SKINS.map(async (name) => {
        try {
          const img = await new THREE.ImageLoader().loadAsync(`${DIR}Skins/${name}.png`);
          skinImages.set(name, img);
        } catch { console.warn(`[figuren] Skin ${name} fehlt`); }
        tick();
      }),
    ]);
    if (!clips.idle || !clips.walk || !skinImages.size) return false;
    // Geometrie vorbereiten (geteilt von allen Klonen): Umrisslinien-Normalen, Maße
    model.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isMesh) { computeOutlineNormals(m.geometry); m.castShadow = false; }
    });
    model.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model);
    baseHeight = Math.max(0.01, bb.max.y - bb.min.y);
    baseMinY = bb.min.y;
    base = model;
    console.info(`[figuren] Kenney-Figuren: ${skinImages.size} Skins, ${Object.keys(clips).length} Animationen.`);
    return true;
  } catch (err) {
    console.warn('[figuren] Kenney Animated Characters nicht geladen – Ersatzfiguren.', err);
    return false;
  }
}

export function hasKenneyCharacters() { return base !== null; }

// ------------------------------------------------------------------ Skins umfärben
const texCache = new Map<string, THREE.Texture>();
const matCache = new Map<string, THREE.Material>();

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Bereich (Bildkoordinaten 0..1) umfärben: die häufigste Farbe darin gilt als Stofffarbe; alle
 * Pixel nahe daran (inkl. Schattierung) bekommen die Zielfarbe mit gleicher relativer Helligkeit.
 * Haut, Gürtel und Aufdrucke bleiben, weil sie farblich weit weg liegen.
 */
function recolorRegion(d: ImageData, u0: number, v0: number, u1: number, v1: number, target: number) {
  const W = d.width, H = d.height;
  const x0 = Math.floor(u0 * W), x1 = Math.ceil(u1 * W), y0 = Math.floor(v0 * H), y1 = Math.ceil(v1 * H);
  const counts = new Map<number, number>();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4;
    const k = ((d.data[o] >> 4) << 8) | ((d.data[o + 1] >> 4) << 4) | (d.data[o + 2] >> 4);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0, bn = 0;
  for (const [k, n] of counts) if (n > bn) { bn = n; best = k; }
  const br = ((best >> 8) & 15) * 16 + 8, bg = ((best >> 4) & 15) * 16 + 8, bb = (best & 15) * 16 + 8;
  const bl = Math.max(20, lum(br, bg, bb));
  const tr = (target >> 16) & 255, tg = (target >> 8) & 255, tb = target & 255;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4;
    const r = d.data[o], g = d.data[o + 1], b = d.data[o + 2];
    // Farbabstand nach Abzug der Helligkeit (Schattierung soll mitgehen)
    const l = lum(r, g, b), k = l / bl;
    const dist = Math.abs(r - br * k) + Math.abs(g - bg * k) + Math.abs(b - bb * k);
    if (dist > 70 || k < 0.45 || k > 1.6) continue;
    d.data[o] = Math.min(255, tr * k); d.data[o + 1] = Math.min(255, tg * k); d.data[o + 2] = Math.min(255, tb * k);
  }
}

function skinTexture(name: string, shirt?: number, pants?: number): THREE.Texture | null {
  const key = `${name}:${shirt ?? ''}:${pants ?? ''}`;
  let t = texCache.get(key);
  if (t) return t;
  const img = skinImages.get(name);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img as CanvasImageSource, 0, 0, TEX_SIZE, TEX_SIZE);
  if (shirt !== undefined || pants !== undefined) {
    const d = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    if (shirt !== undefined) recolorRegion(d, 0.0, 0.5, 0.61, 0.94, shirt);
    if (pants !== undefined) recolorRegion(d, 0.62, 0.76, 1.0, 1.0, pants);
    ctx.putImageData(d, 0, 0);
  }
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  texCache.set(key, t);
  return t;
}

function skinMaterial(name: string, shirt?: number, pants?: number): THREE.Material {
  const key = `${name}:${shirt ?? ''}:${pants ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = toonMaterial({ map: skinTexture(name, shirt, pants), nightTint: 0.35 });
    matCache.set(key, m);
  }
  return m;
}

// ------------------------------------------------------------------ Figur
const POLICE_SHIRT = 0x2c4fa8, POLICE_PANTS = 0x1e2433;

export class KenneyCharacter {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Partial<Record<ClipName, THREE.AnimationAction>> = {};
  private current: THREE.AnimationAction | undefined;
  private acc = 0;
  private frame = Math.floor(Math.random() * 8);
  private hull: THREE.Object3D | null = null;
  private attackT = 0;
  /** Szenario-Posen (NPCs): Animations-ID vom Server → Pose + Gegenstand */
  readonly acts: NpcActs;
  /** Ragdoll-Glieder (lokal berechnet, siehe ragdoll.ts) */
  private rag: RagdollPose;
  private ragFrame: RagdollFrame | null = null;

  constructor(material: THREE.Material, seed = 0) {
    const clone = SkeletonUtils.clone(base!);
    clone.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.material = material;
      this.hull = addOutline(m, LINE.character);
      if ((m as THREE.SkinnedMesh).isSkinnedMesh) setFigureBounds(m, this.hull);
      else { m.frustumCulled = false; this.hull.frustumCulled = false; }
    });
    // Kopf etwas kleiner: erwachsenere Proportionen als im Original (weniger "Spielzeug")
    clone.traverse((o) => { if ((o as THREE.Bone).isBone && /^head$/i.test(o.name)) o.scale.setScalar(HEAD_SCALE); });
    const s = TARGET_HEIGHT / baseHeight;
    const inner = new THREE.Group();
    inner.scale.setScalar(s);
    inner.position.y = -baseMinY * s;
    inner.userData.baseY = inner.position.y;
    inner.add(clone);
    this.root.add(inner);
    this.acts = new NpcActs(clone, inner, this.root);
    this.rag = new RagdollPose(clone, inner, seed);

    this.mixer = new THREE.AnimationMixer(clone);
    for (const k of Object.keys(CLIPS) as ClipName[]) {
      const clip = clips[k];
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (k === 'punch') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
      this.actions[k] = a;
    }
    // Zufälliger Startpunkt, damit Gruppen nicht im Gleichschritt laufen
    this.play(this.actions.idle, 0);
    this.mixer.update(Math.random() * 2);
  }

  private play(a: THREE.AnimationAction | undefined, fade = 0.2) {
    if (!a || a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = a;
  }

  /** Schlag-Animation (Fäuste/Nahkampf). */
  attack() {
    if (!this.actions.punch) return;
    this.attackT = Math.max(0.2, clips.punch!.duration * 0.9);
    this.play(this.actions.punch, 0.08);
  }

  /** Animations-ID (npc/scenarios Act) setzen; seed = fester Phasenversatz je NPC. */
  setAct(act: number, seed: number) { this.acts.setAct(act, seed); }

  /** Kopfdrehung (Blickkontakt): yaw relativ zum Körper, w = Gewicht. */
  setLook(yaw: number, w: number, anxious = false) { this.acts.setLook(yaw, w, anxious); }

  /** Ragdoll-Zustand für dieses Bild (null = keiner); vor animate() aufrufen. */
  ragdoll(f: RagdollFrame | null) { this.ragFrame = f; }

  /** speed in m/s; seated = sitzt (Motorrad/Boot); dist = Abstand zur Kamera (Animations-LOD). */
  animate(speed: number, dt: number, seated = false, dist = 0) {
    this.attackT = Math.max(0, this.attackT - dt);
    const act = this.acts.act;
    seated = seated || SEATED_ACTS.has(act);
    if (this.attackT <= 0) {
      const want = seated ? this.actions.sit ?? this.actions.idle
        : speed < 0.3 ? this.actions.idle : speed < 3.6 ? this.actions.walk : this.actions.run ?? this.actions.walk;
      this.play(want);
      if (this.current === this.actions.walk) this.current!.timeScale = Math.max(0.6, speed / 1.7);
      else if (this.current === this.actions.run) this.current!.timeScale = act === Act.Jog ? 0.62 : Math.max(0.7, speed / 5.5);
    }
    this.rag.update(this.ragFrame, dt);
    const ragOn = this.rag.w > 0;
    // LOD: nah jedes Bild, weiter weg jedes 2./4./8. Bild (Zeit wird aufgesammelt); eine Ragdoll-Figur in
    // Kamera-Nähe immer flüssig, damit die schlackernden Glieder nicht ruckeln
    const skip = dist < 45 || (ragOn && dist < 90) ? 1 : dist < 90 ? 2 : dist < 150 ? 4 : 8;
    this.acc += dt;
    if (++this.frame % skip === 0) {
      this.mixer.update(this.acc);
      // Szenario-Posen nur für Figuren in Kamera-Nähe (Detailstufe Nah/Mittel)
      if (act !== Act.None && dist < 70) this.acts.apply(this.acc);
      if (dist < 45) this.acts.applyLook(this.acc);
      if (ragOn) this.rag.apply();
      this.acc = 0;
      // Gegenstand nur nachführen, wenn sich die Pose geändert hat (hängt am root, bewegt sich also mit)
      if (act !== Act.None) this.acts.syncProp();
    }
    // Umriss nur in der Nähe – und nur, wenn Umrisslinien eingeschaltet sind (Grafikstufe „niedrig“)
    if (this.hull) this.hull.visible = dist < 140 && U.uOutlineScale.value > 0;
  }

  dispose() { this.acts.dispose(); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot()); }
}

/**
 * Neue Figur. role = Stil der Gegend bzw. 'player' / 'gang' / 'cop'; shirt färbt das Oberteil
 * (Spieler- oder Gangfarbe). Gleiche id -> gleicher Skin (alle Clients sehen dieselbe Figur).
 */
export function createKenneyCharacter(role: KenneyRole, id: number, shirt?: number, skins?: readonly string[]): KenneyCharacter | null {
  if (!base) return null;
  const list = (skins ?? SKINS[role]).filter((n) => skinImages.has(n));
  if (!list.length) return null;
  const h = (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;
  const name = list[Math.floor(h * list.length)];
  if (role === 'cop') return new KenneyCharacter(skinMaterial(name, POLICE_SHIRT, POLICE_PANTS), id);
  return new KenneyCharacter(skinMaterial(name, shirt), id);
}
