// Außenbereiche der Venues (Teil der Außenwelt, wird mit ihr pausiert): Schlange vor dem Pink Static mit
// Türsteher Big Teo und Samtkordel, Limousine/Sportwagen am Bordstein, Taxi lässt Partygäste raus,
// Palm Royale mit Springbrunnen-Lichtshow, Portier und Valet-Stand (Rico), Derby-Terminals in Bars,
// und die Straßenparty bei Feueralarm (E60). Figuren über dieselbe instanzierte Menge wie drinnen.
import * as THREE from 'three';
import { clubOpen, interiorFrame, venueExterior, type InteriorFrame, type VenueExterior } from '../../../shared/src/venues/interiors';
import { derbyTerminals } from '../../../shared/src/questLocations';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { box, cyl, ico, merge } from '../render/geom';
import { toonVC } from '../render/models';
import { textSign } from '../render/LandmarkBuilder';
import { Anim, CrowdMesh } from './CrowdMesh';

const neon = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false });

function carGeo(kind: 'limo' | 'sports' | 'taxi'): THREE.BufferGeometry {
  const L = kind === 'limo' ? 7.2 : 4.4, col = kind === 'limo' ? 0x111118 : kind === 'sports' ? 0xe0203a : 0xffd23a;
  const parts = [
    box(1.9, 0.75, L, 0, 0.3, 0, col), box(1.7, 0.6, kind === 'limo' ? 4.6 : 2.2, 0, 1.05, kind === 'sports' ? -0.3 : 0, kind === 'limo' ? 0x1a1a24 : col),
    box(1.72, 0.45, kind === 'limo' ? 4.4 : 2.0, 0, 1.1, kind === 'sports' ? -0.3 : 0, 0x2a3a5a),
  ];
  for (const [x, z] of [[-0.95, L / 2 - 0.9], [0.95, L / 2 - 0.9], [-0.95, -L / 2 + 0.9], [0.95, -L / 2 + 0.9]]) parts.push(cyl(0.36, 0.36, 0.3, 10, 0, 0, 0, 0x16161c).rotateZ(Math.PI / 2).translate(x, 0.36, z));
  if (kind === 'taxi') parts.push(box(0.6, 0.25, 0.3, 0, 1.65, 0, 0xffffff));
  return merge(parts);
}

interface Walker { x: number; z: number; tx: number; tz: number; t: number; look: number }

export class VenueExterior3D {
  readonly group = new THREE.Group();
  readonly crowd = new CrowdMesh(70);
  private clubF: InteriorFrame | null;
  private casinoF: InteriorFrame | null;
  private clubEx: VenueExterior | null = null;
  private casinoEx: VenueExterior | null = null;
  private taxi: THREE.Mesh | null = null;
  private taxiT = 0;
  private walkers: Walker[] = [];
  private fountainJets: THREE.Mesh[] = [];
  private fountainMat = new THREE.MeshBasicMaterial({ color: 0x3af2ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  /** Feueralarm: Straßenparty vor dem Club */
  street = false;
  private t = 0;
  readonly terminals;

  constructor(map: WorldMap) {
    this.group.name = 'venueExterior';
    this.clubF = interiorFrame(map, 'club');
    this.casinoF = interiorFrame(map, 'casino');
    this.terminals = derbyTerminals(map);
    const parts: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
    const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, a: number) => g.rotateY(a).translate(x, y, z);
    if (this.clubF) {
      const ex = (this.clubEx = venueExterior(this.clubF));
      const y = this.clubF.y;
      // Samtkordel: Pfosten entlang der Schlange
      for (let i = 0; i < 6; i++) {
        const px = ex.queue.x + ex.queue.dx * i * 1.0 + Math.sin(this.clubF.rot) * 0.8, pz = ex.queue.z + ex.queue.dz * i * 1.0 + Math.cos(this.clubF.rot) * 0.8;
        parts.push(cyl(0.06, 0.08, 1.0, 8, px, y, pz, 0xe8c35a), ico(0.09, px, y + 1.05, pz, 0xe8c35a));
        if (i < 5) parts.push(at(box(0.07, 0.07, 1.0, 0, 0, 0, 0xb0102a), px + ex.queue.dx * 0.5, y + 0.82, pz + ex.queue.dz * 0.5, Math.atan2(ex.queue.dx, ex.queue.dz)));
      }
      // Limousine + Sportwagen am Bordstein
      parts.push(at(carGeo('limo'), ex.cars[0].x, y - 0.1, ex.cars[0].z, ex.cars[0].a));
      parts.push(at(carGeo('sports'), ex.cars[2].x, y - 0.1, ex.cars[2].z, ex.cars[2].a));
      this.taxi = new THREE.Mesh(carGeo('taxi'), toonVC);
      this.taxi.name = 'venueTaxi';
      this.group.add(this.taxi);
    }
    if (this.casinoF) {
      const ex = (this.casinoEx = venueExterior(this.casinoF));
      const y = this.casinoF.y;
      // Springbrunnen mit Lichtshow
      if (ex.fountain) {
        const f = ex.fountain;
        parts.push(cyl(3.2, 3.4, 0.6, 24, f.x, y, f.z, 0xf0e8d8), cyl(2.9, 2.9, 0.62, 24, f.x, y + 0.02, f.z, 0x3a8aaa), cyl(0.5, 0.7, 1.4, 12, f.x, y, f.z, 0xf0e8d8));
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2, r = i === 0 ? 0 : 1.9;
          const jet = new THREE.Mesh(new THREE.ConeGeometry(0.22, 3, 8, 1, true).translate(0, 1.5, 0), this.fountainMat);
          jet.position.set(f.x + Math.sin(a) * r, y + (i === 0 ? 1.4 : 0.6), f.z + Math.cos(a) * r);
          this.fountainJets.push(jet);
          this.group.add(jet);
        }
        // Palmen um den Brunnen
        for (const [dx, dz] of [[-5, 2], [5, 2], [-5, -2.5], [5, -2.5]]) {
          parts.push(cyl(0.18, 0.26, 5.5, 6, f.x + dx, y, f.z + dz, 0x8a6a4a));
          for (let k = 0; k < 6; k++) parts.push(at(box(0.5, 0.08, 2.4, 0, 0, 1.0, 0x2a8a3a, 0, -0.35), f.x + dx, y + 5.4, f.z + dz, (k / 6) * Math.PI * 2));
        }
      }
      // Valet-Stand
      parts.push(at(box(1.2, 1.1, 0.7, 0, 0, 0, 0x7a1f2e), ex.valet.x, y, ex.valet.z, ex.valet.a), at(box(1.4, 0.1, 0.9, 0, 1.1, 0, 0xe8c35a), ex.valet.x, y, ex.valet.z, ex.valet.a));
      const sign = textSign('VALET · RICO', 1.6, 0.4, '#7a1f2e', '#ffd23a');
      sign.position.set(ex.valet.x + Math.sin(ex.valet.a) * 0.37, y + 0.75, ex.valet.z + Math.cos(ex.valet.a) * 0.37); sign.rotation.y = ex.valet.a;
      this.group.add(sign);
      // Limousine vor dem Portikus
      parts.push(at(carGeo('limo'), ex.cars[1].x, y - 0.1, ex.cars[1].z, ex.cars[1].a));
    }
    // Derby-Terminals (Bars/Wettbüros)
    for (const t of this.terminals) {
      parts.push(box(0.9, 1.5, 0.6, t.x, 0, t.z, 0x1a3a22), box(1.2, 0.3, 0.8, t.x, 1.5, t.z, 0x2aa060));
      glow.push(box(0.7, 0.5, 0.05, t.x, 0.9, t.z + 0.31, 0x7dff6a));
      const s = textSign('🐊 GATOR DERBY', 1.6, 0.4, '#0e2a18', '#7dff6a');
      s.position.set(t.x, 2.1, t.z + 0.42);
      this.group.add(s);
    }
    if (parts.length) { const m = new THREE.Mesh(merge(parts), toonVC); m.name = 'venueExteriorStatic'; m.castShadow = true; this.group.add(m); }
    if (glow.length) this.group.add(new THREE.Mesh(merge(glow), neon));
    this.group.add(this.crowd.mesh);
    // Wartende Partygäste, die das Taxi bringt
    for (let i = 0; i < 2; i++) this.walkers.push({ x: 0, z: 0, tx: 0, tz: 0, t: -1, look: 40 + i });
  }

  /** Pro Bild (nur wenn die Außenwelt sichtbar ist). day = Tageszeit 0..1, near = Kamera nah genug. */
  update(dt: number, day: number, focus: THREE.Vector3, beat: number, light: THREE.Color) {
    this.t += dt;
    const t = this.t;
    const near = (f: InteriorFrame | null) => !!f && Math.hypot(f.cx - focus.x, f.cz - focus.z) < 160;
    const clubNear = near(this.clubF), casinoNear = near(this.casinoF);
    this.group.visible = clubNear || casinoNear || this.terminals.some((x) => Math.hypot(x.x - focus.x, x.z - focus.z) < 160);
    if (!this.group.visible) return;
    const c = this.crowd;
    c.uniforms.uAmbient.value.copy(light).multiplyScalar(0.55);
    c.begin();
    const night = clubOpen(day);
    if (this.clubF && this.clubEx && clubNear) {
      const ex = this.clubEx, y = this.clubF.y;
      // Big Teo (breit, schwarzes Shirt) und die Schlange
      c.add(ex.host.x, y, ex.host.z, ex.host.a + 0.4, Anim.LEAN, 7, { shirt: 0x111118, pants: 0x1a1a24, skin: 3 }, 1.18);
      const n = night ? 6 : 1;
      for (let i = 0; i < n; i++) c.add(ex.queue.x + ex.queue.dx * i * 0.95, y, ex.queue.z + ex.queue.dz * i * 0.95, Math.atan2(-ex.queue.dx, -ex.queue.dz), i % 3 === 0 ? Anim.PHONE : i % 3 === 1 ? Anim.TALK : Anim.IDLE, 11 + i, { shirt: [0xff3fa4, 0x3af2ff, 0xffd23a, 0x9a5aff, 0xffffff, 0x2aa060][i], pants: 0x22223a, skin: i });
      // Taxi bringt Partygäste (nachts, alle ~35 s)
      if (this.taxi) {
        const period = 35, k = (t % period) / period;
        const car = ex.cars[1];
        const along = { x: Math.cos(this.clubF.rot), z: -Math.sin(this.clubF.rot) };
        const off = k < 0.25 ? (1 - k / 0.25) * 30 : k < 0.55 ? 0 : -((k - 0.55) / 0.45) * 40;
        this.taxi.visible = night;
        this.taxi.position.set(car.x + along.x * off, y - 0.1, car.z + along.z * off);
        this.taxi.rotation.y = car.a + Math.PI;
        if (night && k > 0.25 && k < 0.3) for (const w of this.walkers) if (w.t < 0) { w.x = car.x; w.z = car.z; w.tx = ex.queue.x + ex.queue.dx * 6.5; w.tz = ex.queue.z + ex.queue.dz * 6.5; w.t = 0; }
        for (const [i, w] of this.walkers.entries()) {
          if (w.t < 0) continue;
          w.t += dt;
          const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
          if (d > 0.2) { w.x += (dx / d) * 1.4 * dt; w.z += (dz / d) * 1.4 * dt; }
          if (w.t > 20) w.t = -1;
          c.add(w.x + i * 0.6, y, w.z, Math.atan2(dx, dz), d > 0.2 ? Anim.WALK : Anim.TALK, w.look, { shirt: i ? 0xff8a2a : 0xe8f0ff, pants: 0x1a1a2a, skin: 2 + i });
        }
      }
      // Straßenparty (E60 Feueralarm): Gäste tanzen draußen weiter, DJ mit mobiler Box, Feuerwehrleute
      if (this.street) {
        const d = this.clubF.door, fx = Math.sin(d.a), fz = Math.cos(d.a), sx = fz, sz = -fx;
        // Band vor der Fassade (Gehweg/Vorplatz), der DJ mit mobiler Box in der Mitte
        for (let i = 0; i < 28; i++) {
          const along = ((i * 7) % 28) / 27 - 0.5, depth = 1.6 + (i % 3) * 1.1;
          const px = d.x + fx * depth + sx * along * 22, pz = d.z + fz * depth + sz * along * 22;
          c.add(px, y, pz, d.a + Math.PI + Math.sin(i) * 0.6, [Anim.DANCE, Anim.SHUFFLE, Anim.DISCO, Anim.ROBOT, Anim.CHEER][i % 5], 60 + i, { shirt: [0xff3fa4, 0x3af2ff, 0xffd23a, 0x9a5aff][i % 4], pants: 0x22223a, skin: i });
        }
        c.add(d.x + fx * 1.2, y, d.z + fz * 1.2, d.a, Anim.DJ, 5, { shirt: 0x111118, pants: 0x111118, skin: 1 });
        for (let i = 0; i < 2; i++) c.add(d.x + fx * 4 + sx * (6 + i), y, d.z + fz * 4 + sz * (6 + i), d.a, Anim.WATCH, 90 + i, { shirt: 0xd0202a, pants: 0x2a2a30, skin: 3 + i });
      }
    }
    if (this.casinoF && this.casinoEx && casinoNear) {
      const ex = this.casinoEx, y = this.casinoF.y;
      const d = this.casinoF.door, fx = Math.sin(d.a), fz = Math.cos(d.a);
      c.add(d.x + fx * 2.5 + fz * 2.2, y, d.z + fz * 2.5 - fx * 2.2, d.a, Anim.LEAN, 21, { shirt: 0x7a1f2e, pants: 0x111118, skin: 4 });
      c.add(ex.valet.x + Math.sin(ex.valet.a) * 0.9, y, ex.valet.z + Math.cos(ex.valet.a) * 0.9, ex.valet.a + Math.PI, Anim.IDLE, 22, { shirt: 0xf4f1e8, pants: 0x7a1f2e, skin: 2 });
      // Springbrunnen: Fontänen im Wechsel, Farbe läuft durch
      this.fountainJets.forEach((j, i) => { const h = 0.4 + 0.6 * Math.max(0, Math.sin(t * 1.6 + i * 0.9)); j.scale.set(1, h * (i === 0 ? 1.6 : 1), 1); });
      this.fountainMat.color.setHSL((t * 0.05) % 1, 0.9, 0.6);
    }
    c.end(t, beat);
  }
}
