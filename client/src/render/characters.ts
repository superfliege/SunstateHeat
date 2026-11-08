// Figuren aus den Quaternius-Modular-Packs: Teile (Kopf, Haare, Oberkörper, Beine, Schuhe)
// verschiedener Dateien werden zufällig kombiniert, zonenspezifisch eingekleidet (Strand:
// Badekleidung/Hawaiihemden, Downtown: Anzüge, Sumpf/Land: Jagd- und Arbeitskleidung) und
// zu EINER Skinned-Geometrie mit Vertex-Farben verschmolzen (1 Draw-Call + 1 für die Umrisslinie).
// Animationen per AnimationMixer, entfernte Figuren mit reduzierter Animationsrate (LOD).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mulberry32 } from '../../../shared/src/math';
import { addOutline, computeOutlineNormals, LINE, toonMaterial } from './materials/toon';
import { palmaraize, type MoodId } from './palette';
import { characterFiles, type CharacterFile } from './quaternius';

export type Style = 'beach' | 'business' | 'outdoor' | 'casual';

export function styleForMood(mood: MoodId, rnd: number): Style {
  switch (mood) {
    case 'ocean': case 'keys': return rnd < 0.75 ? 'beach' : 'casual';
    case 'downtown': return rnd < 0.7 ? 'business' : 'casual';
    case 'havana': return rnd < 0.25 ? 'beach' : 'casual';
    case 'port': return rnd < 0.6 ? 'outdoor' : 'casual';
    case 'swamp': return rnd < 0.8 ? 'outdoor' : 'casual';
    default: return rnd < 0.55 ? 'outdoor' : 'casual';
  }
}

const STYLE_RE: Record<Style, RegExp> = {
  beach: /beach|swim|summer|hawaii|tourist|short|tank|bikini|sandal/,
  business: /suit|business|formal|office|tie|blazer|dress|elegant/,
  outdoor: /farmer|hunter|adventur|ranger|cowboy|worker|outdoor|hiker|fisher|camo|overall|vest/,
  casual: /casual|hoodie|punk|street|tshirt|jeans|sport/,
};

/** Kleidungsfarben je Stil (Hawaiihemden knallig, Anzüge gedeckt bzw. Pastell). */
const STYLE_COLORS: Record<Style, { top: number[]; bottom: number[]; shoes: number[] }> = {
  beach: {
    top: [0xff7eb0, 0x3fd8cc, 0xffe468, 0xff9f5a, 0x74d2f2, 0x6dff9c, 0xf7f0e4, 0xffc2d6],
    bottom: [0xf2dca8, 0x74d2f2, 0xf7f0e4, 0xff8577, 0x3fd8cc, 0xb4f0d8],
    shoes: [0xf7f0e4, 0xffc9a8, 0x9a7652],
  },
  business: {
    top: [0x2c2a40, 0x5e5a6e, 0x2a5f9e, 0xf2dca8, 0xffc2d6, 0xb3aab0],
    bottom: [0x2c2a40, 0x5e5a6e, 0x2a5f9e, 0xf2dca8, 0xb3aab0],
    shoes: [0x2c2a40, 0x6e4e32],
  },
  outdoor: {
    top: [0x356f45, 0x6e4e32, 0x9a7652, 0xb8c46a, 0xc0703f, 0xd4583f, 0xf2dca8],
    bottom: [0x5e5a6e, 0x6e4e32, 0x2a5f9e, 0x356f45, 0x9a7652],
    shoes: [0x6e4e32, 0x2c2a40, 0x9a7652],
  },
  casual: {
    top: [0xff4fae, 0x4ff2ff, 0xffb36b, 0x9a6bd8, 0x52b85a, 0xffe468, 0x2a5f9e, 0xf7f0e4, 0x2c2a40],
    bottom: [0x2a5f9e, 0x2c2a40, 0x5e5a6e, 0xf2dca8, 0x9a7652],
    shoes: [0xf7f0e4, 0x2c2a40, 0xd4583f],
  },
};
const SKIN = [0xf6cfa8, 0xe8b48a, 0xc68642, 0x8d5524, 0xf1c27d, 0x6e4430];
const HAIR = [0x2c1a10, 0x6e4e32, 0xf2dca8, 0x1a1a24, 0xc0703f, 0xb3aab0];

type Slot = 'head' | 'hair' | 'upper' | 'lower' | 'feet' | 'acc' | 'whole';
interface Part { id: number; file: CharacterFile; mesh: THREE.SkinnedMesh; slot: Slot; tags: string }

function slotOf(name: string): Slot | null {
  if (/hair|hat|cap|helmet|hood|beanie/.test(name)) return 'hair';
  if (/head|face|eye|brow|beard|mustache/.test(name)) return 'head';
  if (/feet|foot|shoe|boot|sock|sandal/.test(name)) return 'feet';
  if (/leg|lower|pant|short|skirt|trouser/.test(name)) return 'lower';
  if (/body|torso|upper|shirt|top|jacket|chest|arm|vest|coat|hand|outfit/.test(name)) return 'upper';
  return null;
}

type ColorRole = 'skin' | 'hair' | 'keep' | 'top' | 'bottom' | 'shoes' | 'accent';
function roleOf(matName: string, slot: Slot): ColorRole {
  const n = matName.toLowerCase();
  if (/skin/.test(n)) return 'skin';
  if (/hair|beard|brow/.test(n)) return 'hair';
  if (/eye|pupil|mouth|teeth|lash|lip|black|white/.test(n)) return 'keep';
  if (/shirt|top|jacket|torso|vest|coat|sweater|hoodie|upper/.test(n)) return 'top';
  if (/pant|short|jean|leg|skirt|trouser|lower/.test(n)) return 'bottom';
  if (/shoe|boot|feet|sole|sock/.test(n)) return 'shoes';
  if (/face|head/.test(n)) return 'skin';
  switch (slot) {
    case 'upper': return 'top';
    case 'lower': return 'bottom';
    case 'feet': return 'shoes';
    case 'hair': return 'hair';
    case 'head': return 'keep';
    default: return 'accent';
  }
}

interface Rig {
  file: CharacterFile;
  bones: string[];
  boneInverses: THREE.Matrix4[];
  clips: { idle?: THREE.AnimationClip; walk?: THREE.AnimationClip; run?: THREE.AnimationClip };
}

let rig: Rig | null = null;
let parts: Part[] = [];
let prepared = false;

function findClip(clips: THREE.AnimationClip[], re: RegExp, avoid = /carry|gun|shoot|sword|punch|death|hit/i) {
  return clips.find((c) => re.test(c.name) && !avoid.test(c.name)) ?? clips.find((c) => re.test(c.name));
}

/** Rig (Skelett + Animationen) und Teile aus den geladenen Figurendateien bestimmen. */
function prepare() {
  if (prepared) return;
  prepared = true;
  let id = 0;
  for (const file of characterFiles) {
    const anims = file.gltf.animations;
    const skinned: THREE.SkinnedMesh[] = [];
    file.gltf.scene.updateMatrixWorld(true);
    file.gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    if (!skinned.length) continue;
    if (!rig && anims.length && findClip(anims, /walk/i)) {
      const sk = skinned.reduce((a, b) => (b.skeleton.bones.length > a.skeleton.bones.length ? b : a)).skeleton;
      rig = {
        file,
        bones: sk.bones.map((b) => b.name),
        boneInverses: sk.boneInverses.map((m) => m.clone()),
        clips: { idle: findClip(anims, /idle/i), walk: findClip(anims, /walk/i), run: findClip(anims, /run/i) },
      };
    }
    const tags = `${file.path} ${file.name}`;
    for (const mesh of skinned) {
      const slot = skinned.length === 1 ? 'whole' : slotOf(mesh.name.toLowerCase()) ?? slotOf(file.name) ?? 'acc';
      parts.push({ id: id++, file, mesh, slot, tags: `${tags} ${mesh.name.toLowerCase()}` });
    }
  }
  if (!rig) { parts = []; return; }
  // nur Teile, deren Knochen im Rig vorkommen
  const names = new Set(rig.bones);
  parts = parts.filter((p) => p.mesh.skeleton.bones.every((b) => names.has(b.name)));
}

export function hasQuaterniusCharacters(): boolean {
  prepare();
  return !!rig && parts.length > 0;
}

// ------------------------------------------------------------------ Geometrie bauen
const geoCache = new Map<string, THREE.BufferGeometry>();
let sharedMat: THREE.MeshToonMaterial | null = null;
const tmpC = new THREE.Color();

function materialColor(mat: THREE.Material, uv: THREE.BufferAttribute | undefined, i: number): number {
  const s = mat as THREE.MeshStandardMaterial;
  let hex = s.color?.getHex(THREE.SRGBColorSpace) ?? 0xffffff;
  const img = s.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (img?.width && uv) {
    const px = pixelsOf(img);
    const u = uv.getX(i), v = uv.getY(i);
    const x = Math.min(px.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * px.width)));
    const y = Math.min(px.height - 1, Math.max(0, Math.floor((v - Math.floor(v)) * px.height)));
    const o = (y * px.width + x) * 4;
    const mul = (c: number, b: number) => Math.round((c * b) / 255);
    hex = (mul(px.data[o], (hex >> 16) & 255) << 16) | (mul(px.data[o + 1], (hex >> 8) & 255) << 8) | mul(px.data[o + 2], hex & 255);
  }
  return hex;
}
const pxCache = new Map<unknown, ImageData>();
function pixelsOf(img: CanvasImageSource & { width: number; height: number }): ImageData {
  let d = pxCache.get(img);
  if (!d) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0);
    d = ctx.getImageData(0, 0, c.width, c.height);
    pxCache.set(img, d);
  }
  return d;
}

interface Palette { skin: number; hair: number; top: number; bottom: number; shoes: number; accent: number }

function buildGeometry(sel: Part[], pal: Palette): THREE.BufferGeometry | null {
  const r = rig!;
  const index = new Map(r.bones.map((n, i) => [n, i]));
  const geos: THREE.BufferGeometry[] = [];
  for (const p of sel) {
    const src = p.mesh.geometry;
    const g = src.index ? src.toNonIndexed() : src.clone();
    const n = g.getAttribute('position').count;
    // in Bindungsraum vorrechnen -> zusammengeführtes Mesh nutzt bindMatrix = Identität
    g.applyMatrix4(p.mesh.bindMatrix);
    const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const newIdx = new Uint16Array(n * 4), newW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        const bone = p.mesh.skeleton.bones[si.getComponent(i, k)];
        newIdx[i * 4 + k] = bone ? index.get(bone.name) ?? 0 : 0;
        newW[i * 4 + k] = sw.getComponent(i, k);
      }
    }
    // Farben pro Vertex aus Material(-gruppen), dann nach Rolle umfärben
    const mats = Array.isArray(p.mesh.material) ? p.mesh.material : [p.mesh.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    const col = new Float32Array(n * 3);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    for (const grp of groups) {
      const mat = mats[grp.materialIndex ?? 0];
      const role = roleOf(mat.name ?? '', p.slot);
      for (let i = grp.start; i < Math.min(n, grp.start + grp.count); i++) {
        let hex: number;
        switch (role) {
          case 'skin': hex = pal.skin; break;
          case 'hair': hex = pal.hair; break;
          case 'top': hex = pal.top; break;
          case 'bottom': hex = pal.bottom; break;
          case 'shoes': hex = pal.shoes; break;
          default: hex = palmaraize(materialColor(mat, uv, i));
        }
        tmpC.setHex(hex);
        col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.getAttribute('position'));
    out.setAttribute('normal', g.getAttribute('normal') ?? (g.computeVertexNormals(), g.getAttribute('normal')));
    out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(newIdx, 4));
    out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(newW, 4));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geos.push(out);
  }
  const merged = mergeGeometries(geos, false);
  if (!merged) return null;
  computeOutlineNormals(merged);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function pick<T>(list: T[], rnd: () => number): T { return list[Math.floor(rnd() * list.length)]; }

/** Teile für einen Stil auswählen: modular (Kopf/Ober/Unter/Füße aus verschiedenen Dateien) oder ganze Figur. */
function choose(style: Style, rnd: () => number): Part[] {
  const re = STYLE_RE[style];
  const bySlot = (slot: Slot) => {
    const all = parts.filter((p) => p.slot === slot);
    const fit = all.filter((p) => re.test(p.tags));
    return fit.length && rnd() < 0.85 ? fit : all;
  };
  const uppers = bySlot('upper'), lowers = bySlot('lower');
  if (uppers.length && lowers.length) {
    const upper = pick(uppers, rnd);
    const lower = rnd() < 0.6 ? lowers.find((p) => p.file === upper.file) ?? pick(lowers, rnd) : pick(lowers, rnd);
    const sel = [upper, lower];
    const heads = bySlot('head');
    if (heads.length) sel.push(pick(heads, rnd));
    const feet = parts.filter((p) => p.slot === 'feet');
    const ownFeet = feet.find((p) => p.file === lower.file);
    if (ownFeet || feet.length) sel.push(ownFeet ?? pick(feet, rnd));
    const hair = bySlot('hair');
    if (hair.length && rnd() < 0.75) sel.push(pick(hair, rnd));
    // Zubehör der Oberteil-Datei (Krawatte, Gürtel …)
    for (const p of parts) if (p.slot === 'acc' && p.file === upper.file && rnd() < 0.5) sel.push(p);
    return sel;
  }
  const wholes = bySlot('whole');
  if (wholes.length) return [pick(wholes, rnd)];
  // Datei mit unbekannten Teilnamen: alles aus einer Datei nehmen
  const files = [...new Set(parts.map((p) => p.file))];
  const fitFiles = files.filter((f) => re.test(f.path));
  const f = pick(fitFiles.length ? fitFiles : files, rnd);
  return parts.filter((p) => p.file === f);
}

// ------------------------------------------------------------------ Figur mit Animation
const TARGET_HEIGHT = 1.8 * 1.25; // wie die prozeduralen Figuren: etwas größer, besser lesbar
/** Quaternius-Figuren schauen entlang +z; falls ein Pack anders exportiert ist, hier drehen. */
const FACING = 0;

export class AnimatedCharacter {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: { idle?: THREE.AnimationAction; walk?: THREE.AnimationAction; run?: THREE.AnimationAction } = {};
  private current: THREE.AnimationAction | undefined;
  private acc = 0;
  private frame = Math.floor(Math.random() * 8);
  private hull: THREE.Object3D | null = null;

  constructor(geometry: THREE.BufferGeometry) {
    const r = rig!;
    const inner = new THREE.Group();
    const rigClone = SkeletonUtils.clone(r.file.gltf.scene);
    const drop: THREE.Object3D[] = [];
    rigClone.traverse((o) => { if ((o as THREE.Mesh).isMesh) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    const boneByName = new Map<string, THREE.Bone>();
    rigClone.traverse((o) => { if ((o as THREE.Bone).isBone) boneByName.set(o.name, o as THREE.Bone); });
    const bones = r.bones.map((n) => boneByName.get(n) ?? new THREE.Bone());
    const mesh = new THREE.SkinnedMesh(geometry, sharedMat ??= toonMaterial({ vertexColors: true, nightTint: 0.35 }));
    mesh.frustumCulled = false; // Bounding-Box passt bei Animation nicht
    rigClone.add(mesh);
    mesh.bind(new THREE.Skeleton(bones, r.boneInverses), new THREE.Matrix4());
    this.hull = addOutline(mesh, LINE.character);
    this.hull.frustumCulled = false;

    const bb = geometry.boundingBox!;
    const s = TARGET_HEIGHT / Math.max(0.1, bb.max.y - bb.min.y);
    inner.scale.setScalar(s);
    inner.position.y = -bb.min.y * s;
    inner.rotation.y = FACING;
    inner.add(rigClone);
    this.root.add(inner);

    this.mixer = new THREE.AnimationMixer(rigClone);
    for (const k of ['idle', 'walk', 'run'] as const) {
      const clip = r.clips[k];
      if (clip) this.actions[k] = this.mixer.clipAction(clip);
    }
    this.play(this.actions.idle ?? this.actions.walk, 0);
  }

  private play(a: THREE.AnimationAction | undefined, fade = 0.2) {
    if (!a || a === this.current) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current?.fadeOut(fade);
    this.current = a;
  }

  /** speed in m/s; dist = Abstand zur Kamera (steuert die Animationsrate). */
  animate(speed: number, dt: number, seated = false, dist = 0) {
    const want = seated || speed < 0.3 ? this.actions.idle : speed < 3.6 ? this.actions.walk ?? this.actions.run : this.actions.run ?? this.actions.walk;
    this.play(want ?? this.actions.walk);
    if (this.current === this.actions.walk) this.current!.timeScale = Math.max(0.6, speed / 1.6);
    else if (this.current === this.actions.run) this.current!.timeScale = Math.max(0.7, speed / 5);
    // LOD: nah jedes Bild, weiter weg jedes 2./4./8. Bild (Zeit wird aufgesammelt)
    const skip = dist < 45 ? 1 : dist < 90 ? 2 : dist < 150 ? 4 : 8;
    this.acc += dt;
    if (++this.frame % skip === 0) { this.mixer.update(this.acc); this.acc = 0; }
    if (this.hull) this.hull.visible = dist < 140;
  }

  dispose() { this.mixer.stopAllAction(); }
}

/** Neue Figur im Stil der Gegend; shirt überschreibt die Oberteilfarbe (Spielerfarbe). */
export function createQuaterniusCharacter(style: Style, seed: number, shirt?: number): AnimatedCharacter | null {
  if (!hasQuaterniusCharacters()) return null;
  // begrenzte Zahl an Varianten je Stil -> Geometrien werden geteilt
  const variant = shirt === undefined ? seed % 12 : 100 + (shirt & 0xffffff) % 997 + (seed % 3) * 1000;
  const key = `${style}:${variant}`;
  let geo = geoCache.get(key);
  if (!geo) {
    const rnd = mulberry32(variant * 7919 + style.length * 104729);
    const c = STYLE_COLORS[style];
    const pal: Palette = {
      skin: pick(SKIN, rnd), hair: pick(HAIR, rnd), top: shirt ?? pick(c.top, rnd),
      bottom: pick(c.bottom, rnd), shoes: pick(c.shoes, rnd), accent: pick(c.top, rnd),
    };
    // Anzüge: Hose oft passend zum Sakko
    if (style === 'business' && rnd() < 0.6 && shirt === undefined) pal.bottom = pal.top;
    const sel = choose(style, rnd);
    geo = buildGeometry(sel, pal) ?? undefined;
    if (!geo) return null;
    geoCache.set(key, geo);
  }
  return new AnimatedCharacter(geo);
}
