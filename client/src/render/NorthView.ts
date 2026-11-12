// Bewegliches im Norden (je Art ein Draw-Call, nur nahe der Kamera aktiv):
//   - Stausee-Wasserfläche (eigene Höhe über dem Meeresspiegel) und Wasserfall mit Gischt
//   - Funkturm-Blinklicht am Gipfel (immer, nachts mit Glow -> Bloom)
//   - Pumpen-Windräder (drehen sich mit dem Wind), Wasserrad der Mühle
//   - Lagerfeuer am Campingplatz (abends/nachts flackernd), Rauch aus Mühlenschornstein und von der
//     Zuckerrohr-Ernte (Rauchsäule am Horizont), Staubwolke der Steinbruch-Sprengung
//   - Agrarflugzeug „Crop Hopper“ (Deko, nicht steuerbar): fliegt Bahnen über die Felder und sprüht Nebel
import * as THREE from 'three';
import { FARMS } from '../../../shared/src/world/farms';
import { OKEE_PLACES, RESERVOIR } from '../../../shared/src/world/okeePeak';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { U } from './materials/toon';

const SMOKE = 70, SPRAY = 50;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; src: number }

export class NorthView {
  readonly group = new THREE.Group();
  private blink: THREE.Mesh;
  private glow: THREE.Sprite;
  private rotors: THREE.Object3D[] = [];
  private fires: { mesh: THREE.Mesh; light: THREE.Sprite; phase: number }[] = [];
  private fall: THREE.Mesh;
  private fallTex: THREE.CanvasTexture;
  private smoke: THREE.InstancedMesh;
  private puffs: Puff[] = [];
  private plane: THREE.Group;
  private spray: THREE.InstancedMesh;
  private sprayP: Puff[] = [];
  private planeT = 0;
  /** Steinbruch-Sprengung: Restzeit der Staubwolke (s). */
  private blast = 0;
  private clouds: THREE.Mesh[] = [];
  private sources: { x: number; y: number; z: number; rate: number; color: number; acc: number; size: number }[] = [];

  constructor(private map: WorldMap) {
    this.group.name = 'north';
    // ---------------- Stausee
    const shape = new THREE.Shape(RESERVOIR.poly.map(([x, z]) => new THREE.Vector2(x, z)));
    const wg = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    const water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x3a9ec0, transparent: true, opacity: 0.86, emissive: 0x0a2a3a }));
    water.position.y = RESERVOIR.level;
    water.name = 'reservoir';
    this.group.add(water);

    // ---------------- Wasserfall (Überlauf an der Staumauer)
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 64;
    const cx = cv.getContext('2d')!;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 16; x++) { const v = 200 + Math.random() * 55; cx.fillStyle = `rgba(${v},${v + 5},255,${0.55 + Math.random() * 0.4})`; cx.fillRect(x, y, 1, 1 + Math.random() * 3); }
    this.fallTex = new THREE.CanvasTexture(cv);
    this.fallTex.wrapS = this.fallTex.wrapT = THREE.RepeatWrapping;
    this.fallTex.repeat.set(2, 3);
    const F = RESERVOIR.fall;
    const fallH = F.top - F.bottom;
    const fg = new THREE.PlaneGeometry(5, fallH);
    this.fall = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: this.fallTex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    const [ax, az] = RESERVOIR.dam.a, [bx, bz] = RESERVOIR.dam.b;
    this.fall.rotation.y = Math.atan2(bx - ax, bz - az) - Math.PI / 2;
    this.fall.position.set(F.x, F.bottom + fallH / 2, F.z + 3.5);
    this.group.add(this.fall);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 16).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x5ab8d8, transparent: true, opacity: 0.85, emissive: 0x0a2a3a }));
    pool.position.set(F.pool[0], F.bottom + 0.6, F.pool[1]);
    this.group.add(pool);

    // ---------------- Funkturm-Blinklicht
    const R = OKEE_PLACES.radioTower;
    const top = map.terrainHeight(R.x, R.z) + 36.2;
    this.blink = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
    this.blink.position.set(R.x, top, R.z);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xff3020, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.setScalar(6);
    this.glow.position.copy(this.blink.position);
    this.group.add(this.blink, this.glow);

    // ---------------- Windräder (Pumpen) und Wasserrad
    const bladeMat = new THREE.MeshLambertMaterial({ color: 0xd8d4c8 });
    for (const f of FARMS) for (const p of f.props) {
      if (p.k !== 'windpump') continue;
      const rotor = new THREE.Group();
      for (let k = 0; k < 12; k++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.35, 0.04), bladeMat);
        b.position.set(0, 0.75, 0); const arm = new THREE.Group(); arm.add(b); arm.rotation.z = (k / 12) * Math.PI * 2; rotor.add(arm);
      }
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 1.6), bladeMat); tail.position.set(0, 0, -1.2);
      const holder = new THREE.Group(); holder.add(rotor, tail);
      holder.position.set(p.x, map.terrainHeight(p.x, p.z) + 9.3, p.z);
      holder.rotation.y = 0.6;
      this.rotors.push(rotor);
      this.group.add(holder);
    }

    // ---------------- Lagerfeuer
    const C = OKEE_PLACES.campground;
    const fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) });
    for (const [lx, lz] of [[-16, 10], [-4, 14], [8, 10], [-20, -4], [14, -6], [0, 0]]) {
      const x = C.x + lx + 3, z = C.z + lz + 1, y = map.terrainHeight(x, z);
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 5), fireMat);
      mesh.position.set(x, y + 0.5, z);
      const light = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffa040, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      light.scale.setScalar(5); light.position.set(x, y + 0.9, z);
      this.fires.push({ mesh, light, phase: Math.random() * 10 });
      this.group.add(mesh, light);
    }

    // ---------------- Rauch (Mühlenschornstein, Zuckerrohr-Ernte, Farmhaus-Kamine, Steinbruch)
    const smokeMat = new THREE.MeshLambertMaterial({ color: 0xd8d0c8, transparent: true, opacity: 0.55, depthWrite: false });
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), smokeMat, SMOKE);
    this.smoke.frustumCulled = false;
    this.smoke.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE * 3).fill(1), 3);
    this.group.add(this.smoke);
    for (let i = 0; i < SMOKE; i++) this.puffs.push({ x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, src: -1 });
    const mill = FARMS.find((f) => f.id === 'cane_creek')!;
    const ch = mill.props.find((p) => p.k === 'chimney')!;
    this.sources.push({ x: ch.x + 3.5, y: map.terrainHeight(ch.x, ch.z) + 17, z: ch.z, rate: 1.2, color: 0x9a948c, acc: 0, size: 1.6 });
    // Ernte-Feuer im Zuckerrohrfeld (Rauchsäule am Horizont)
    const cane = mill.fields[0];
    this.sources.push({ x: cane.x + 6, y: map.terrainHeight(cane.x, cane.z) + 2, z: cane.z - 4, rate: 2.2, color: 0x6e6660, acc: 0, size: 2.6 });
    for (const f of FARMS) { const h = f.buildings.find((b) => b.k === 'house'); if (h) this.sources.push({ x: h.x + h.w * 0.3, y: map.terrainHeight(h.x, h.z) + h.h + 2.2, z: h.z - h.d * 0.2, rate: 0.25, color: 0xe8e4dc, acc: 0, size: 0.8 }); }

    // ---------------- Wolken, die den Gipfel streifen
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x404048 });
    for (let k = 0; k < 7; k++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), cloudMat);
      c.scale.set(22 + k * 3, 6 + (k % 3) * 2, 14 + (k % 2) * 6);
      c.userData = { r: 40 + k * 14, a: k * 0.9, y: 175 + (k % 4) * 12, s: 0.02 + (k % 3) * 0.008 };
      this.clouds.push(c);
      this.group.add(c);
    }

    // ---------------- Crop Hopper (Agrarflugzeug) + Sprühnebel
    this.plane = new THREE.Group();
    const yellow = new THREE.MeshLambertMaterial({ color: 0xffd23a }), dark = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 6), yellow);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.15, 1.6), yellow); wing.position.set(0, 0.2, 0.8);
    const tailW = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 0.9), yellow); tailW.position.set(0, 0.3, -2.7);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 1.0), yellow); fin.position.set(0, 0.9, -2.7);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 1.2), dark); cab.position.set(0, 0.8, 0.2);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.15, 0.06), dark); prop.position.set(0, 0, 3.05); prop.name = 'prop';
    const boom = new THREE.Mesh(new THREE.BoxGeometry(10, 0.06, 0.06), dark); boom.position.set(0, -0.2, 0.4);
    this.plane.add(body, wing, tailW, fin, cab, prop, boom);
    this.group.add(this.plane);
    this.spray = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xe8f4f0, transparent: true, opacity: 0.35, depthWrite: false }), SPRAY);
    this.spray.frustumCulled = false;
    this.group.add(this.spray);
    for (let i = 0; i < SPRAY; i++) this.sprayP.push({ x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, src: -1 });
  }

  /** Steinbruch-Sprengung (Ereignis E54): Staubwolke für ein paar Sekunden. */
  quarryBlast() { this.blast = 6; }

  update(dt: number, focus: THREE.Vector3) {
    const t = U.uTime.value, night = U.uNight.value, wind = U.uWind.value;
    // nur in der Nähe aktiv (Norden); fern: alles aus
    const near = focus.z < 980;
    this.group.visible = near;
    if (!near) return;
    // Funkturm: 1-Hz-Blinken, Glow nachts stärker
    const on = (t % 1.4) < 0.35;
    this.blink.visible = on;
    this.glow.visible = on;
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.35 + night * 0.65;
    // Wolken ziehen um den Gipfel (Wind)
    for (const c of this.clouds) {
      const u = c.userData as { r: number; a: number; y: number; s: number };
      u.a += dt * u.s * wind;
      c.position.set(OKEE_PLACES.radioTower.x + Math.cos(u.a) * u.r, u.y + Math.sin(t * 0.1 + u.r) * 4, OKEE_PLACES.radioTower.z + Math.sin(u.a) * u.r * 0.7);
    }
    // Wasserfall fließt
    this.fallTex.offset.y = (this.fallTex.offset.y + dt * 1.8) % 1;
    // Windräder
    for (const r of this.rotors) r.rotation.z -= dt * (1.2 + wind * 2.5);
    // Lagerfeuer: abends/nachts
    const evening = Math.max(night, 0);
    for (const f of this.fires) {
      const fl = 0.75 + Math.sin(t * 11 + f.phase) * 0.15 + Math.sin(t * 23 + f.phase * 3) * 0.1;
      f.mesh.visible = f.light.visible = evening > 0.15;
      f.mesh.scale.set(fl, fl * (0.9 + Math.sin(t * 7 + f.phase) * 0.2), fl);
      (f.light.material as THREE.SpriteMaterial).opacity = 0.4 * fl * evening;
    }
    // Rauch
    if (this.blast > 0) {
      this.blast -= dt;
      const Q = OKEE_PLACES.quarry;
      this.emit({ x: Q.x + (Math.random() - 0.5) * 30, y: this.map.terrainHeight(Q.x, Q.z) + 2, z: Q.z + (Math.random() - 0.5) * 30, rate: 0, color: 0xc8bca8, acc: 0, size: 3.5 }, 3);
    }
    for (let si = 0; si < this.sources.length; si++) {
      const s = this.sources[si];
      if (Math.abs(s.x - focus.x) > 600 || Math.abs(s.z - focus.z) > 600) continue;
      s.acc += dt * s.rate;
      while (s.acc >= 1) { s.acc -= 1; this.emit(s, 1); }
    }
    const col = new THREE.Color();
    for (let i = 0; i < SMOKE; i++) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) { this.smoke.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.x += (p.vx + wind * 0.8) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = 1 - p.life / p.max;
      const sc = p.size * (0.6 + k * 1.8);
      this.smoke.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.setScalar(sc)));
      void col;
    }
    this.smoke.instanceMatrix.needsUpdate = true;

    // Crop Hopper: Bahnen über Big Melon Acres / Sunny Grove (tagsüber)
    const day = U.uDay.value;
    this.plane.visible = day > 0.25;
    if (this.plane.visible) {
      this.planeT += dt;
      const fieldsA = FARMS.find((f) => f.id === 'big_melon')!, fieldsB = FARMS.find((f) => f.id === 'sunny_grove')!;
      const cycle = 60, ph = (this.planeT % cycle) / cycle;
      const tgt = Math.floor(this.planeT / cycle) % 2 ? fieldsA : fieldsB;
      const lane = Math.floor(ph * 6), u = (ph * 6) % 1;
      const dir = lane % 2 ? -1 : 1;
      const x = tgt.x - 90 + (dir > 0 ? u : 1 - u) * 180;
      const z = tgt.z + 10 + (lane - 3) * 9 + Math.sin(u * Math.PI) * 4;
      const turn = Math.min(u, 1 - u) < 0.08;
      const y = this.map.terrainHeight(x, z) + (turn ? 18 : 5.5);
      this.plane.position.set(x, y, z);
      this.plane.rotation.set(0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, turn ? 0.5 * dir : 0);
      (this.plane.getObjectByName('prop') as THREE.Mesh).rotation.z += dt * 40;
      if (!turn && Math.abs(x - tgt.x) < 70) {
        for (let n = 0; n < 2; n++) {
          const p = this.sprayP.find((q) => q.life <= 0);
          if (!p) break;
          Object.assign(p, { x: x + (Math.random() - 0.5) * 3, y: y - 0.4, z: z + (Math.random() - 0.5) * 8, vx: -dir * 2, vy: -1.2, vz: 0, life: 2.2, max: 2.2, size: 0.8 });
        }
      }
    }
    for (let i = 0; i < SPRAY; i++) {
      const p = this.sprayP[i];
      p.life -= dt;
      if (p.life <= 0) { this.spray.setMatrixAt(i, tmpM.makeScale(0, 0, 0)); continue; }
      p.x += p.vx * dt; p.y = Math.max(p.y + p.vy * dt, this.map.terrainHeight(p.x, p.z) + 0.5); p.z += p.vz * dt;
      this.spray.setMatrixAt(i, tmpM.compose(tmpP.set(p.x, p.y, p.z), tmpQ.identity(), tmpS.setScalar(p.size * (1 + (1 - p.life / p.max) * 2))));
    }
    this.spray.instanceMatrix.needsUpdate = true;
  }

  /** Position des Crop Hoppers (für Sound). */
  get planePos(): THREE.Vector3 | null { return this.plane.visible ? this.plane.position : null; }

  private emit(s: { x: number; y: number; z: number; color: number; size: number; rate?: number; acc?: number }, n: number) {
    for (let k = 0; k < n; k++) {
      const i = this.puffs.findIndex((q) => q.life <= 0);
      if (i < 0) return;
      const p = this.puffs[i];
      Object.assign(p, { x: s.x + (Math.random() - 0.5), y: s.y, z: s.z + (Math.random() - 0.5), vx: (Math.random() - 0.5) * 0.6, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 7 + Math.random() * 4, max: 11, size: s.size });
      this.smoke.setColorAt(i, new THREE.Color(s.color));
      if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
    }
  }
}
