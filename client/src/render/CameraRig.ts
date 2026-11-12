// Geneigte Top-Down-Kamera im DS-Stil (~56°). Folgt dem Spieler mit etwas Trägheit,
// zoomt in Fahrzeugen je nach Tempo heraus und schaut in Bewegungsrichtung voraus.
// Dazu: Aufprall-Shake (proportional zur Stärke), leichtes Nachziehen bei harten Bremsungen
// und ein FOV-Kick beim Nitro.
import * as THREE from 'three';

const PITCH = THREE.MathUtils.degToRad(56);
const FOOT_DISTANCE = 30;
const VEHICLE_DISTANCE = 40;
const BASE_FOV = 42;

export const CAMERA = {
  /** Zusätzlicher Abstand je m/s (bis maxSpeedZoom) */
  zoomPerSpeed: 0.55, maxSpeedZoom: 38,
  /** Vorausblick (m je m/s, max) */
  lookAhead: 0.5, maxLook: 18,
  /** Trägheit der Verfolgung (1/s, kleiner = träger) */
  follow: 5, zoomFollow: 1.8,
  /** Shake: Abklingrate und maximale Auslenkung (m) */
  shakeDecay: 7, shakeMax: 1.6,
  /** Luftfahrzeuge: zusätzlicher Abstand je m Flughöhe (max) */
  zoomPerAltitude: 0.5, maxAltitudeZoom: 75,
  /** Bremsen: Kamera rutscht nach vorne (m je m/s² Verzögerung) */
  brakePull: 0.12,
  /** Abstands-Faktor (?camzoom=2 in der URL für Übersichts-Screenshots) */
  zoomMul: Math.min(4, Math.max(1, Number(new URLSearchParams(globalThis.location?.search ?? '').get('camzoom')) || 1)),
};

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private focus = new THREE.Vector3();
  private look = new THREE.Vector3();
  private distance = FOOT_DISTANCE;
  private initialized = false;
  private shake = 0;
  private shakeT = 0;
  private pull = 0;
  private lastSpeed = 0;
  private fovKick = 0;
  /** Abschaltbar (Barrierefreiheit, spec 17.5) */
  shakeEnabled = true;
  /** Flughöhe über Grund (Luftfahrzeuge): Kamera zoomt heraus */
  altitude = 0;
  /**
   * Panorama-/Fotokamera (Fernrohr am Gipfel, Silhouetten-Ansicht): feste Position und Blickpunkt,
   * weite Sichtweite. null = normale Top-Down-Kamera.
   */
  photo: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 3, 700);
  }

  get target() { return this.focus; }

  /** 1 = Fußgänger-Zoom, < 1 = weiter herausgezoomt (für die Linienstärke). */
  get zoom() { return FOOT_DISTANCE / this.distance; }

  /** Stoß: Stärke 0..1 (Aufprall) */
  kick(strength: number) {
    if (!this.shakeEnabled) return;
    this.shake = Math.min(1, Math.max(this.shake, strength));
  }

  /** vx/vz = Geschwindigkeit (Welt), nitro = FOV-Zuschlag in Grad */
  update(x: number, y: number, z: number, a: number, vx: number, vz: number, inVehicle: boolean, dt: number, nitro = 0) {
    const speed = Math.hypot(vx, vz);
    // Vorausblick: in Bewegungsrichtung (beim Driften schaut die Kamera dorthin, wohin das Auto rutscht)
    let lx = 0, lz = 0;
    if (inVehicle && speed > 1) {
      const k = Math.min(CAMERA.maxLook, speed * CAMERA.lookAhead) / speed;
      lx = vx * k; lz = vz * k;
    }
    this.look.x += (lx - this.look.x) * (1 - Math.exp(-2.5 * dt));
    this.look.z += (lz - this.look.z) * (1 - Math.exp(-2.5 * dt));
    // Bremsen: Kamera zieht kurz in Fahrtrichtung nach
    const decel = dt > 0 ? (this.lastSpeed - speed) / dt : 0;
    this.lastSpeed = speed;
    const wantPull = inVehicle && decel > 6 ? Math.min(3, (decel - 6) * CAMERA.brakePull) : 0;
    this.pull += (wantPull - this.pull) * (1 - Math.exp(-(wantPull > this.pull ? 6 : 2) * dt));
    const fx = Math.sin(a), fz = Math.cos(a);
    const tx = x + this.look.x + fx * this.pull, tz = z + this.look.z + fz * this.pull;
    const altZoom = Math.min(CAMERA.maxAltitudeZoom, this.altitude * CAMERA.zoomPerAltitude);
    const wantDist = (inVehicle ? VEHICLE_DISTANCE + Math.min(speed, CAMERA.maxSpeedZoom) * CAMERA.zoomPerSpeed + altZoom : FOOT_DISTANCE) * CAMERA.zoomMul;

    if (!this.initialized) {
      this.focus.set(tx, y, tz);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-CAMERA.follow * dt);
    this.focus.x += (tx - this.focus.x) * k;
    this.focus.y += (y - this.focus.y) * (1 - Math.exp(-3 * dt));
    this.focus.z += (tz - this.focus.z) * k;
    this.distance += (wantDist - this.distance) * (1 - Math.exp(-CAMERA.zoomFollow * dt));

    // Shake
    this.shake = Math.max(0, this.shake - this.shake * CAMERA.shakeDecay * dt - dt * 0.2);
    this.shakeT += dt;
    const s = this.shake * this.shake * CAMERA.shakeMax;
    const sx = (Math.sin(this.shakeT * 57) + Math.sin(this.shakeT * 31.7) * 0.5) * s;
    const sy = (Math.sin(this.shakeT * 49.3) * 0.6) * s;
    const sz = (Math.cos(this.shakeT * 43.1) + Math.sin(this.shakeT * 23.3) * 0.5) * s;

    // FOV-Kick (Nitro)
    this.fovKick += (nitro - this.fovKick) * (1 - Math.exp(-(nitro > this.fovKick ? 4 : 1.5) * dt));
    const fov = BASE_FOV + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // Kamera steht südlich (größeres z) und schaut nach Norden -> Norden ist "oben"
    this.camera.position.set(
      this.focus.x + sx,
      this.focus.y + Math.sin(PITCH) * this.distance + sy,
      this.focus.z + Math.cos(PITCH) * this.distance + sz,
    );
    this.camera.lookAt(this.focus.x + sx * 0.5, this.focus.y, this.focus.z + sz * 0.5);
    const far = this.photo ? 4200 : 700;
    if (this.photo) {
      this.camera.position.copy(this.photo.pos);
      this.camera.lookAt(this.photo.look);
      const f = this.photo.fov ?? BASE_FOV;
      if (Math.abs(this.camera.fov - f) > 0.01) this.camera.fov = f;
    }
    if (this.camera.far !== far) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
    else if (this.photo) this.camera.updateProjectionMatrix();
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
