// Tag-Nacht-Zyklus: Himmelsverlauf (3-stufig), tief stehende warme Sonne mit langen weichen
// Schatten, Umgebungslicht und Dunst in Zonenfarbe. Grundlage: palette.ts (SKY_KEYS, MOODS).
// day: 0 = Mitternacht, 0.25 = Sonnenaufgang, 0.5 = Mittag, 0.75 = Sonnenuntergang
import * as THREE from 'three';
import { U } from './materials/toon';
import { MOODS, SKY_KEYS, type Mood, type MoodId } from './palette';

const ca = new THREE.Color(), cb = new THREE.Color();
function mixHex(a: number, b: number, t: number, out: THREE.Color) {
  return out.copy(ca.setHex(a)).lerp(cb.setHex(b), t);
}

/** Schattenbereich um den Fokus (m) – deckt den sichtbaren Ausschnitt ab. */
const SHADOW_EXTENT = 110;
const sunDir = new THREE.Vector3();

export class Sky {
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  readonly ambient = new THREE.HemisphereLight(0xffffff, 0x404060, 1);
  readonly fog = new THREE.Fog(0x8ff2e0, 140, 420);
  readonly horizon = new THREE.Color();
  readonly mid = new THREE.Color();
  readonly top = new THREE.Color();
  /** Ungefähre Gesamthelligkeit (für unbeleuchtete Materialien wie Wasser). */
  readonly light = new THREE.Color();
  /** 0 = Tag, 1 = tiefe Nacht – für Neon, Fenster, Scheinwerfer. */
  night = 0;
  /** Aktuelle (weich überblendete) Zonenstimmung. */
  readonly mood: Mood = { ...MOODS.ocean, palette: [] };
  private moodTarget: MoodId = 'ocean';
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, shadows: boolean) {
    scene.add(this.sun, this.sun.target, this.ambient);
    scene.fog = this.fog;
    scene.background = this.horizon;
    this.setShadows(shadows);

    // Himmelskuppel: Verlauf Horizont -> Mitte -> Zenit, nachts Sterne
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uH: { value: this.horizon }, uM: { value: this.mid }, uT: { value: this.top }, uNight: U.uNight },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w; // immer ganz hinten
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uH; uniform vec3 uM; uniform vec3 uT; uniform float uNight;
        varying vec3 vDir;
        void main() {
          float y = max(vDir.y, 0.0);
          // gestufter Verlauf (gemalt, nicht glatt)
          float t = floor(y * 10.0) / 10.0;
          vec3 c = t < 0.35 ? mix(uH, uM, t / 0.35) : mix(uM, uT, (t - 0.35) / 0.65);
          vec2 g = floor(vDir.xz / max(vDir.y, 0.05) * 60.0);
          float star = step(0.997, fract(sin(dot(g, vec2(12.9898, 78.233))) * 43758.5453)) * step(0.2, y);
          c += vec3(star) * uNight * 0.8;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);
  }

  setShadows(on: boolean) {
    this.sun.castShadow = on;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.left = s.camera.bottom = -SHADOW_EXTENT;
    s.camera.right = s.camera.top = SHADOW_EXTENT;
    s.camera.near = 1; s.camera.far = 400;
    s.bias = -0.0006;
    s.normalBias = 0.06;
    s.radius = 3; // weiche Kanten (PCFSoft)
    s.camera.updateProjectionMatrix();
  }

  /** Zielstimmung (Zone/Viertel des Spielers); wird über einige Sekunden überblendet. */
  setMood(id: MoodId) { this.moodTarget = id; }

  update(day: number, focus: THREE.Vector3, dt = 0.016) {
    // Stimmung weich überblenden
    const m = this.mood, tgt = MOODS[this.moodTarget];
    const k = 1 - Math.exp(-dt * 0.8);
    const lerpN = (key: 'fogTint' | 'fogRange' | 'morningFog' | 'saturation' | 'warmth' | 'exposure' | 'neon') => { m[key] += (tgt[key] - m[key]) * k; };
    lerpN('fogTint'); lerpN('fogRange'); lerpN('morningFog'); lerpN('saturation'); lerpN('warmth'); lerpN('exposure'); lerpN('neon');
    m.fog = ca.setHex(m.fog).lerp(cb.setHex(tgt.fog), k).getHex();

    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= day) i++;
    const a = SKY_KEYS[i], b = SKY_KEYS[i + 1];
    const t = (day - a.t) / (b.t - a.t || 1);
    mixHex(a.horizon, b.horizon, t, this.horizon);
    mixHex(a.mid, b.mid, t, this.mid);
    mixHex(a.top, b.top, t, this.top);
    mixHex(a.sun, b.sun, t, this.sun.color);
    mixHex(a.ambSky, b.ambSky, t, this.ambient.color);
    mixHex(a.ambGround, b.ambGround, t, this.ambient.groundColor);
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
    this.ambient.intensity = a.ambI + (b.ambI - a.ambI) * t;
    const elev = THREE.MathUtils.degToRad(a.elev + (b.elev - a.elev) * t);

    // Sonne wandert von Ost nach West (nachts "Mondlicht" aus der Gegenrichtung)
    const ang = (day - 0.25) * Math.PI * 2;
    const height = Math.sin(ang);
    const az = height >= -0.05 ? ang : ang + Math.PI;
    const dir = sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), 0.35 * Math.cos(elev)).normalize();
    // Schattenkamera auf Texelraster einrasten -> kein Flimmern beim Fahren
    const snap = (SHADOW_EXTENT * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.position.set(fx, focus.y, fz).addScaledVector(dir, 180);
    this.sun.target.position.set(fx, focus.y, fz);
    this.dome.position.copy(focus);

    this.night = Math.min(1, Math.max(0, (0.15 - height) * 2.2));
    const dayF = Math.min(1, Math.max(0, height * 3));

    // Dunst: Horizontfarbe + Zonenfarbe; Morgennebel (Gator Flats) zwischen ca. 5 und 9 Uhr
    this.fog.color.copy(this.horizon).lerp(ca.setHex(m.fog), m.fogTint * (1 - this.night * 0.6));
    const morning = Math.max(0, 1 - Math.abs(day - 0.29) / 0.07) * m.morningFog;
    this.fog.near = 140 * m.fogRange * (1 - morning * 0.85);
    this.fog.far = 420 * m.fogRange * (1 - morning * 0.6);
    if (morning > 0.01) this.fog.color.lerp(ca.setHex(0xe8eee0), morning * 0.7);

    // Grobe Gesamthelligkeit für unbeleuchtete Materialien
    this.light.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.32)
      .add(ca.copy(this.ambient.color).multiplyScalar(this.ambient.intensity * 0.45));

    U.uNight.value = this.night;
    U.uDay.value = dayF;
    U.uSkyTop.value.copy(this.top);
    U.uSkyHorizon.value.copy(this.horizon);
  }
}
