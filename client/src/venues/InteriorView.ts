// Darstellung der Innenräume (eigene Teil-Szene je Gebäude, liegt im Grundriss des Wahrzeichens):
//  - statische Einrichtung zusammengefasst (wenige Draw-Calls, Cel-Look über toonVC),
//  - Neon/Leuchtflächen unbeleuchtet und hell (Bloom aus PostFX), keine echten dynamischen Lichter,
//  - Club: Leuchtboden (Instancing, Shader pulsiert im Takt), Lichtkegel (Fake-Volumen, additiv), Laser
//    (Linien), Discokugel mit Lichtpunkten auf Boden und Wänden (Decal-Quads), flackernder Toilettengang,
//  - Casino: Teppich mit schrillem Muster (Shader), goldene Säulen, Kronleuchter, Automaten (Instancing,
//    blinkende Bildschirme), Tische mit Chipstapeln, Roulette-Kessel mit Kugel, Großbildschirm (Derby), Jackpot-Tafel,
//  - Puppenhaus-Ansicht: Außenwände zur Kamera werden ausgeblendet (nur ein Sockel bleibt).
import * as THREE from 'three';
import { CASINO_TABLES, DANCE_COLS, DANCE_ROWS, SLOT_MACHINES, TILE, TILE_X0, TILE_Z0, tableDealer, type InteriorDef, type InteriorFrame } from '../../../shared/src/venues/interiors';
import { WHEEL_ORDER, colorOf } from '../../../shared/src/content/casino/roulette';
import { box, cyl, ico, merge } from '../render/geom';
import { toonVC } from '../render/models';
import { textSign } from '../render/LandmarkBuilder';

const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false });
const glowMat = (color: number, opacity = 0.5) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });

interface Wall { full: THREE.Mesh; stub: THREE.Mesh; nx: number; nz: number; mx: number; mz: number }

/** Fake-Volumen-Lichtkegel: nach unten ausblendender, additiver Kegel. */
function coneMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uAlpha: { value: 0.32 } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vY; void main(){ gl_FragColor = vec4(uColor * uAlpha * pow(vY, 1.6), 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide, toneMapped: false,
  });
}

export class InteriorView {
  readonly group = new THREE.Group();
  private walls: Wall[] = [];
  private t = 0;
  // Club
  private tiles: THREE.InstancedMesh | null = null;
  private tileU = { uBeat: { value: 0 }, uTime: { value: 0 }, uOn: { value: 1 }, uSpot: { value: new THREE.Vector3(0, 0, -1) } };
  private tileMine: THREE.InstancedBufferAttribute | null = null;
  private cones: THREE.Mesh[] = [];
  private lasers: THREE.LineSegments | null = null;
  private ball: THREE.Mesh | null = null;
  private dots: THREE.InstancedMesh | null = null;
  private flicker: THREE.Mesh | null = null;
  private spot: THREE.Mesh | null = null;
  private fog: THREE.Mesh | null = null;
  // Casino
  private screens: THREE.InstancedMesh | null = null;
  private screenCol = new THREE.Color();
  private chandeliers: THREE.Mesh[] = [];
  private wheel: THREE.Group | null = null;
  private ballR: THREE.Mesh | null = null;
  private wheelSpin = { active: false, t: 0, result: 0, from: 0 };
  private chipStacks: THREE.InstancedMesh | null = null;
  readonly jackpotCanvas = document.createElement('canvas');
  private jackpotTex: THREE.CanvasTexture | null = null;
  readonly derbyCanvas = document.createElement('canvas');
  private derbyTex: THREE.CanvasTexture | null = null;
  private alarm = 0;
  private lightsOn = true;
  private music = true;
  private jackpotShow = 0;
  private spotUntil = 0;

  constructor(readonly f: InteriorFrame) {
    const def = f.def;
    this.group.name = `interior:${def.id}`;
    this.group.position.set(f.cx, f.y, f.cz);
    this.group.rotation.y = f.rot;
    this.buildShell(def);
    if (def.id === 'club') this.buildClub(def); else this.buildCasino(def);
    this.group.visible = false;
    // Statische Teile: Matrix einmal berechnen, dann nicht mehr jedes Bild (spart CPU)
    this.group.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = o === this.group || o.userData.anim === true; });
    this.group.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ Hülle (Boden, Wände)
  private buildShell(def: InteriorDef) {
    const W = def.hw * 2 + 0.8, D = def.hd * 2 + 0.8, H = def.height;
    const club = def.id === 'club';
    const wallCol = club ? 0x2a1840 : 0x7a1f2e, stubCol = club ? 0x3a2458 : 0x5a1420;
    const mk = (w: number, d: number, x: number, z: number, nx: number, nz: number) => {
      const full = new THREE.Mesh(merge([box(w, H, d, x, 0, z, wallCol), box(w + 0.02, 0.35, d + 0.02, x, H - 0.35, z, club ? 0xff3fa4 : 0xe8c35a), box(w + 0.02, 0.5, d + 0.02, x, 0, z, stubCol)]), toonVC);
      const stub = new THREE.Mesh(box(w, 0.6, d, x, 0, z, stubCol), toonVC);
      full.receiveShadow = true;
      this.group.add(full, stub);
      this.walls.push({ full, stub, nx, nz, mx: x, mz: z });
    };
    mk(W, 0.4, 0, -D / 2 + 0.2, 0, -1);
    mk(W, 0.4, 0, D / 2 - 0.2, 0, 1);
    mk(0.4, D, -W / 2 + 0.2, 0, -1, 0);
    mk(0.4, D, W / 2 - 0.2, 0, 1, 0);
    if (!club) {
      // Teppich mit schrillem Muster (Satire): Rauten, Palmen-Kringel, Gold auf Weinrot und Petrol
      const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec2 vP;
          void main(){
            vec2 p = vP * 0.55; vec2 g = fract(p) - 0.5; vec2 id = floor(p);
            float dia = step(abs(g.x) + abs(g.y), 0.36);
            float ring = smoothstep(0.03, 0.0, abs(length(g - vec2(0.0, 0.05)) - 0.22));
            float leaf = step(abs(g.x) * 2.2 + abs(g.y + 0.25), 0.18);
            vec3 base = mod(id.x + id.y, 2.0) < 1.0 ? vec3(0.42, 0.06, 0.12) : vec3(0.04, 0.26, 0.3);
            vec3 c = mix(base, vec3(0.86, 0.66, 0.2), dia * 0.75);
            c = mix(c, vec3(0.95, 0.3, 0.55), ring);
            c = mix(c, vec3(0.2, 0.75, 0.45), leaf * (1.0 - dia));
            gl_FragColor = vec4(c * 0.62, 1.0);
            #include <colorspace_fragment>
          }`,
      }));
      carpet.position.y = 0.02;
      carpet.receiveShadow = true;
      this.group.add(carpet);
    } else {
      const floor = new THREE.Mesh(box(W, 0.1, D, 0, -0.08, 0, 0x16101e), toonVC);
      floor.receiveShadow = true;
      this.group.add(floor);
    }
  }

  /** Statische Teile sammeln (ein Mesh je Material). */
  private parts: THREE.BufferGeometry[] = [];
  private neons: THREE.BufferGeometry[] = [];
  private flush() {
    if (this.parts.length) { const m = new THREE.Mesh(merge(this.parts), toonVC); m.castShadow = false; m.receiveShadow = true; m.name = 'interiorStatic'; this.group.add(m); }
    if (this.neons.length) { const m = new THREE.Mesh(merge(this.neons), neonMat); m.name = 'interiorNeon'; this.group.add(m); }
    this.parts = []; this.neons = [];
  }
  private sign(text: string, w: number, h: number, bg: string, fg: string, x: number, y: number, z: number, ry = 0) {
    const m = textSign(text, w, h, bg, fg);
    (m.material as THREE.MeshBasicMaterial).color.setScalar(1.25);
    m.position.set(x, y, z); m.rotation.y = ry;
    this.group.add(m);
    return m;
  }

  // ================================================================== Club „Pink Static“
  private buildClub(def: InteriorDef) {
    const P = this.parts, N = this.neons;
    // Leuchtboden: 6 x 5 Kacheln (Instancing + Shader)
    const tileGeo = new THREE.BoxGeometry(TILE - 0.08, 0.08, TILE - 0.08);
    const idx = new Float32Array(DANCE_COLS * DANCE_ROWS);
    for (let i = 0; i < idx.length; i++) idx[i] = i;
    tileGeo.setAttribute('tileIdx', new THREE.InstancedBufferAttribute(idx, 1));
    this.tileMine = new THREE.InstancedBufferAttribute(new Float32Array(idx.length), 1);
    this.tileMine.setUsage(THREE.DynamicDrawUsage);
    tileGeo.setAttribute('tileMine', this.tileMine);
    const tileMat = new THREE.ShaderMaterial({
      uniforms: this.tileU,
      vertexShader: `attribute float tileIdx; attribute float tileMine; varying float vI; varying float vMine; varying vec3 vW; void main(){ vI = tileIdx; vMine = tileMine; vec4 w = modelMatrix * instanceMatrix * vec4(position,1.0); vW = (instanceMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uBeat, uTime, uOn; uniform vec3 uSpot; varying float vI; varying float vMine; varying vec3 vW;
        vec3 pal(float k){ k = mod(k, 4.0); return k < 1.0 ? vec3(1.0,0.2,0.65) : k < 2.0 ? vec3(0.2,0.9,1.0) : k < 3.0 ? vec3(1.0,0.85,0.2) : vec3(0.6,0.3,1.0); }
        void main(){
          float c = mod(vI, ${DANCE_COLS}.0), r = floor(vI / ${DANCE_COLS}.0);
          float b = floor(uBeat);
          float pulse = exp(-fract(uBeat) * 3.5);
          float wave = step(0.5, fract((c + r + b) * 0.5));
          vec3 col = pal(c + r * 2.0 + b) * (0.35 + 0.65 * pulse * (0.5 + 0.5 * wave)) * uOn;
          float mine = vMine;
          col = mix(col, vec3(1.0, 0.95, 0.8) * (1.2 + 0.6 * pulse), mine * 0.55);
          float sp = uSpot.z > 0.0 ? smoothstep(2.6, 1.2, length(vW.xz - uSpot.xy)) : 0.0;
          col += vec3(1.0, 0.95, 0.7) * sp * 0.8;
          vec2 e = abs(fract(vW.xz / ${TILE}.0 + 0.5) - 0.5);
          col *= 0.75 + 0.25 * step(max(e.x, e.y), 0.44);
          gl_FragColor = vec4(col * 1.6 + 0.04, 1.0);
        }`,
      toneMapped: false,
    });
    this.tiles = new THREE.InstancedMesh(tileGeo, tileMat, DANCE_COLS * DANCE_ROWS);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < DANCE_COLS * DANCE_ROWS; i++) {
      const x = TILE_X0 + (i % DANCE_COLS) * TILE + TILE / 2, z = TILE_Z0 + Math.floor(i / DANCE_COLS) * TILE + TILE / 2;
      this.tiles.setMatrixAt(i, m4.makeTranslation(x, 0.02, z));
    }
    this.tiles.name = 'danceFloor';
    this.group.add(this.tiles);
    // Rand der Tanzfläche (Chrom) + Neonlinie
    P.push(box(DANCE_COLS * TILE + 0.6, 0.12, 0.3, 0, 0, TILE_Z0 - 0.15, 0xb8b8c8), box(DANCE_COLS * TILE + 0.6, 0.12, 0.3, 0, 0, TILE_Z0 + DANCE_ROWS * TILE + 0.15, 0xb8b8c8));
    N.push(box(DANCE_COLS * TILE + 0.6, 0.04, 0.08, 0, 0.12, TILE_Z0 + DANCE_ROWS * TILE + 0.15, 0xff3fa4));
    // DJ-Podest, Pult, Boxen
    P.push(box(6.8, 0.8, 2.4, 0, 0, -10.4, 0x221830), box(3.2, 1.1, 0.9, 0, 0.8, -9.7, 0x18121f));
    N.push(box(3.2, 0.06, 0.92, 0, 1.9, -9.7, 0x3af2ff), box(6.8, 0.06, 0.06, 0, 0.8, -9.2, 0xff3fa4));
    for (const x of [-4.6, 4.6]) { P.push(box(1.4, 3.2, 1.2, x, 0, -10.6, 0x15101c)); for (const y of [0.8, 2.2]) P.push(cyl(0.42, 0.42, 0.06, 12, x, y, -9.98, 0x3a3048)); }
    // „PINK STATIC“ Neon hinter dem DJ
    this.sign('PINK STATIC', 9, 1.5, '#1a0b22', '#ff3fa4', 0, 4.4, -11.55);
    N.push(box(10, 0.1, 0.1, 0, 5.3, -11.55, 0xff3fa4), box(10, 0.1, 0.1, 0, 3.5, -11.55, 0x3af2ff));
    // Bar mit Theke, Regal, Flaschen, Hockern
    P.push(box(0.8, 1.1, 12, -12.7, 0, 0, 0x3a2030), box(1.0, 0.08, 12.2, -12.7, 1.1, 0, 0x8a5a7a), box(0.5, 2.6, 12, -16.3, 0, 0, 0x2a1a24));
    for (let i = 0; i < 18; i++) N.push(cyl(0.06, 0.06, 0.32, 5, -16.15, 1.2 + (i % 3) * 0.6, -5 + Math.floor(i / 3) * 2, [0x7dff6a, 0xff3fa4, 0x3af2ff, 0xffd23a][i % 4]));
    N.push(box(0.06, 0.06, 12, -12.25, 0.95, 0, 0xff3fa4));
    for (let i = 0; i < 6; i++) P.push(cyl(0.22, 0.18, 0.75, 8, -11.6, 0, -5 + i * 2, 0x8a5a7a));
    this.sign('BAR', 2.6, 0.8, '#1a0b22', '#3af2ff', -16.0, 3.3, 0, Math.PI / 2);
    // Lounges (rechts vorn)
    P.push(box(4.8, 0.5, 0.8, 13.4, 0, 3.8, 0x5a2a6a), box(4.8, 0.9, 0.25, 13.4, 0, 4.15, 0x5a2a6a), box(0.8, 0.5, 4.6, 16.2, 0, 5.7, 0x5a2a6a));
    P.push(cyl(0.5, 0.5, 0.45, 10, 13.4, 0, 6.2, 0x2a1840));
    N.push(cyl(0.1, 0.1, 0.12, 6, 13.4, 0.45, 6.2, 0xffd23a));
    // VIP-Empore: Plattform (h 1,8), Treppe, goldenes Geländer, Sofas
    P.push(box(7.2, 1.8, 9.0, 13.0, 0, -7.1, 0x2d1a3d), box(1.8, 0.6, 1.0, 10.3, 0, -0.5, 0x2d1a3d), box(1.8, 1.2, 1.0, 10.3, 0, -1.5, 0x2d1a3d));
    P.push(box(0.12, 1.0, 9.0, 9.2, 1.8, -7.1, 0xe8c35a), box(5.4, 1.0, 0.12, 13.9, 1.8, -2.4, 0xe8c35a));
    P.push(box(3.6, 0.5, 0.9, 13.4, 1.8, -10.6, 0x8a1a4a), box(0.9, 0.5, 3.0, 15.9, 1.8, -8.0, 0x8a1a4a));
    N.push(box(7.2, 0.05, 0.05, 13.0, 1.8, -2.62, 0xff3fa4));
    this.sign('VIP', 2.4, 0.9, '#2a0d30', '#ffd23a', 13.0, 4.4, -11.55);
    // Samtkordel an der Treppe
    P.push(cyl(0.05, 0.05, 1.0, 6, 9.6, 0, 0.6, 0xe8c35a), cyl(0.05, 0.05, 1.0, 6, 11.0, 0, 0.6, 0xe8c35a), box(1.4, 0.08, 0.08, 10.3, 0.85, 0.6, 0xb0203a));
    // VIP-Schalter
    P.push(box(1.6, 1.1, 1.4, 8.2, 0, 0.5, 0x2a1840)); N.push(box(1.6, 0.06, 1.4, 8.2, 1.1, 0.5, 0xffd23a));
    // Toilettengang mit flackerndem Licht, Hinterausgang
    P.push(box(5.0, 3.2, 0.3, -14.1, 0, -8.0, 0x2a2430));
    this.flicker = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.3).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd8f0ff, toneMapped: false }));
    this.flicker.position.set(-14, 3.1, -10); this.flicker.userData.anim = true;
    this.group.add(this.flicker);
    this.sign('WC ⇄ EXIT', 2.8, 0.6, '#0e1a12', '#7dff6a', -13.6, 2.6, -7.8);
    N.push(box(0.1, 0.4, 1.0, -16.55, 2.3, -9.9, 0x7dff6a));
    P.push(box(0.15, 2.4, 1.4, -16.5, 0, -9.9, 0x4a4a5a));
    // Garderobe und Foyer
    P.push(box(2.0, 1.1, 2.0, -13.6, 0, 10.6, 0x3a2030), box(0.3, 3.0, 3.8, -4.2, 0, 9.9, 0x2a1840), box(0.3, 3.0, 3.8, 4.2, 0, 9.9, 0x2a1840));
    this.sign('GARDEROBE – WAFFEN BITTE HIER', 4.2, 0.5, '#1a0b22', '#ffd23a', -12.6, 2.4, 8.4);
    // Truss über der Tanzfläche
    P.push(box(14, 0.3, 0.3, 0, 6.2, -6.5, 0x6a6a7a), box(14, 0.3, 0.3, 0, 6.2, 4.5, 0x6a6a7a), box(0.3, 0.3, 11, -7, 6.2, -1, 0x6a6a7a), box(0.3, 0.3, 11, 7, 6.2, -1, 0x6a6a7a));
    this.flush();

    // Lichtkegel (Fake-Volumen) an der Truss
    const cols = [0xff3fa4, 0x3af2ff, 0xffd23a, 0x9a5aff].map((c) => new THREE.Color(c));
    for (let i = 0; i < 4; i++) {
      const g = new THREE.ConeGeometry(1.6, 5.6, 12, 1, true);
      g.translate(0, -3, 0);
      const cone = new THREE.Mesh(g, coneMaterial(cols[i]));
      cone.position.set(-6 + i * 4, 6.1, i % 2 ? 4.4 : -6.4);
      cone.userData.anim = true;
      cone.renderOrder = 5;
      this.cones.push(cone);
      this.group.add(cone);
    }
    // Laser: Linien vom DJ-Pult
    const lp = new Float32Array(12 * 6);
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.lasers = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x3aff8a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.lasers.frustumCulled = false;
    this.group.add(this.lasers);
    // Discokugel + Lichtpunkte
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshBasicMaterial({ color: 0x8a90a0, toneMapped: false }));
    this.ball.position.set(0, 5.6, -1); this.ball.userData.anim = true;
    this.group.add(this.ball);
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.14, 8), glowMat(0xfff4e0, 0.9), 64);
    this.dots.frustumCulled = false; this.dots.renderOrder = 6;
    this.group.add(this.dots);
    // Spotlight auf einen Spieler (Hype voll / Battle-Sieger)
    const sg = new THREE.ConeGeometry(1.6, 6.5, 20, 1, true); sg.translate(0, -3.25, 0);
    this.spot = new THREE.Mesh(sg, coneMaterial(new THREE.Color(1, 0.95, 0.75)));
    (this.spot.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.5;
    this.spot.visible = false; this.spot.userData.anim = true;
    this.group.add(this.spot);
    // Nebel (E60): halbtransparente Schicht über dem Boden
    this.fog = new THREE.Mesh(new THREE.PlaneGeometry(30, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xe8e0f0, transparent: true, opacity: 0, depthWrite: false }));
    this.fog.position.y = 1.2; this.fog.userData.anim = true; this.fog.visible = false;
    this.group.add(this.fog);
    void def;
  }

  // ================================================================== Casino „Palm Royale“
  private buildCasino(def: InteriorDef) {
    const P = this.parts, N = this.neons;
    // Goldene Säulen mit Kapitell
    for (const [x, z] of [[-18, 0], [-18, 8], [-4, -8], [-4, 10], [4, -8], [4, 10], [-18, -6]]) {
      P.push(cyl(0.42, 0.48, 8.2, 10, x, 0, z, 0xd8a83a), box(1.2, 0.4, 1.2, x, 8.2, z, 0xf0c860), box(1.1, 0.3, 1.1, x, 0, z, 0xb88a2a));
    }
    // Cage (Kasse) mit Gitter
    P.push(box(10.4, 1.1, 0.5, -19.4, 0, 10.4, 0x5a3a20), box(0.5, 1.1, 7, -14.4, 0, 14, 0x5a3a20));
    for (let i = 0; i < 26; i++) P.push(box(0.06, 2.0, 0.06, -24.2 + i * 0.4, 1.1, 10.4, 0xd8a83a));
    for (let i = 0; i < 18; i++) P.push(box(0.06, 2.0, 0.06, -14.4, 1.1, 10.6 + i * 0.38, 0xd8a83a));
    this.sign('CAGE · KASSE · CHIPS 1:1', 5.4, 0.7, '#3a0d18', '#ffd23a', -18.6, 3.4, 10.2);
    // Spielautomaten: Gehäuse + Bildschirme (Instancing)
    const bodyGeo = merge([box(1.0, 1.55, 0.7, 0, 0, 0, 0x3a2a5a), box(0.9, 0.12, 0.3, 0, 0.78, 0.38, 0x1a1428), box(1.0, 0.3, 0.72, 0, 1.55, 0, 0xd8a83a), cyl(0.04, 0.04, 0.5, 6, 0.55, 0.9, 0.1, 0xb0b0c0), ico(0.09, 0.55, 1.42, 0.1, 0xe0203a)]);
    const bodies = new THREE.InstancedMesh(bodyGeo, toonVC, SLOT_MACHINES.length);
    const scr = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.72, 0.5), new THREE.MeshBasicMaterial({ toneMapped: false }), SLOT_MACHINES.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    SLOT_MACHINES.forEach((m, i) => {
      q.setFromAxisAngle(up, m.a);
      bodies.setMatrixAt(i, m4.compose(v.set(m.x, 0, m.z), q, one));
      const fz = Math.cos(m.a), fx = Math.sin(m.a);
      scr.setMatrixAt(i, m4.compose(v.set(m.x + fx * 0.36, 1.1, m.z + fz * 0.36), q, one));
      scr.setColorAt(i, this.screenCol.setHex(m.v === 'classic' ? 0xff4fae : 0xffd23a));
    });
    bodies.name = 'slotBodies'; scr.name = 'slotScreens';
    this.screens = scr;
    this.group.add(bodies, scr);
    // Jackpot-Tafel über der Automatenhalle
    this.jackpotCanvas.width = 512; this.jackpotCanvas.height = 128;
    this.jackpotTex = new THREE.CanvasTexture(this.jackpotCanvas); this.jackpotTex.colorSpace = THREE.SRGBColorSpace;
    const jb = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshBasicMaterial({ map: this.jackpotTex, toneMapped: false, color: new THREE.Color(1.3, 1.3, 1.3) }));
    jb.position.set(15.5, 5.6, -6.8); jb.name = 'jackpotBoard';
    this.group.add(jb);
    P.push(box(9.4, 2.6, 0.3, 15.5, 4.4, -7.05, 0x2a1a10));
    this.setJackpot(10_000);
    // Tische: Blackjack (Halbmond), Roulette (Tableau + Kessel)
    for (const t of CASINO_TABLES) {
      if (t.kind === 'bj') {
        P.push(cyl(1.6, 1.6, 0.12, 20, t.x, 0.85, t.z, t.high ? 0x1a5a3a : 0x1d6b44), box(3.2, 0.85, 1.2, t.x, 0, t.z - 0.2, 0x4a2a1a), cyl(1.65, 1.65, 0.08, 20, t.x, 0.8, t.z, 0x6a3a1a));
        const d = tableDealer(t);
        P.push(box(0.6, 0.3, 0.4, d.x + 0.9, 0.97, d.z + 0.3, 0x2a2a3a)); // Schlitten
      } else {
        P.push(box(3.8, 0.85, 1.8, t.x, 0, t.z, 0x4a2a1a), box(3.6, 0.06, 1.6, t.x, 0.85, t.z, 0x1d6b44));
        // Kessel
        const wheel = new THREE.Group();
        const wg = merge([cyl(0.62, 0.66, 0.16, 37, 0, 0, 0, 0x5a3a1a), cyl(0.5, 0.5, 0.18, 37, 0, 0, 0, 0x2a1a10), cyl(0.12, 0.12, 0.3, 8, 0, 0, 0, 0xd8a83a)]);
        wheel.add(new THREE.Mesh(wg, toonVC));
        // Fächer (rot/schwarz/grün) als Ring
        const segs: THREE.BufferGeometry[] = [];
        WHEEL_ORDER.forEach((n, i) => {
          const a = (i / 37) * Math.PI * 2;
          const g = box(0.08, 0.02, 0.14, 0, 0.18, 0, colorOf(n) === 'red' ? 0xd0202a : colorOf(n) === 'green' ? 0x1aa050 : 0x16161c, a);
          g.translate(Math.sin(a) * 0.44, 0, Math.cos(a) * 0.44);
          segs.push(g);
        });
        wheel.add(new THREE.Mesh(merge(segs), toonVC));
        wheel.position.set(t.x + 1.3, 0.88, t.z);
        wheel.userData.anim = true;
        this.wheel = wheel;
        this.group.add(wheel);
        this.ballR = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
        this.ballR.userData.anim = true;
        this.group.add(this.ballR);
      }
    }
    // Chipstapel (Instancing, wachsen mit den Einsätzen am Blackjack-Tisch)
    this.chipStacks = new THREE.InstancedMesh(cyl(0.12, 0.12, 1, 10, 0, 0, 0, 0xffffff), new THREE.MeshToonMaterial({ color: 0xffffff }), 40);
    this.chipStacks.count = 0; this.chipStacks.frustumCulled = false;
    this.group.add(this.chipStacks);
    // Großbildschirm Gator Derby (linke Wand)
    this.derbyCanvas.width = 512; this.derbyCanvas.height = 288;
    this.derbyTex = new THREE.CanvasTexture(this.derbyCanvas); this.derbyTex.colorSpace = THREE.SRGBColorSpace;
    const scrM = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.5), new THREE.MeshBasicMaterial({ map: this.derbyTex, toneMapped: false }));
    scrM.position.set(-24.15, 4.2, 2); scrM.rotation.y = Math.PI / 2; scrM.name = 'derbyScreen';
    this.group.add(scrM);
    P.push(box(0.3, 5, 8.6, -24.35, 1.9, 2, 0x1a1428), box(1.6, 1.1, 8, -23.4, 0, 2, 0x3a2030));
    this.sign('GATOR DERBY · WETTEN', 5.2, 0.6, '#0e2a18', '#7dff6a', -22.6, 2.0, 2, Math.PI / 2);
    // Bar mit Lounge-Pianist, Flügel
    P.push(box(12, 1.1, 0.9, -18.4, 0, -12.8, 0x3a1a20), box(12.2, 0.08, 1.0, -18.4, 1.1, -12.8, 0xd8a83a), box(12, 2.8, 0.4, -18.4, 0, -17.3, 0x2a1418));
    for (let i = 0; i < 16; i++) N.push(cyl(0.06, 0.06, 0.32, 5, -23.5 + i * 0.7, 1.4 + (i % 2) * 0.7, -17.05, [0xffd23a, 0xff8a2a, 0x7dff6a, 0xe8f0ff][i % 4]));
    P.push(box(2.0, 0.95, 1.4, -14.6, 0, -11.4, 0x0e0e12), box(1.8, 0.05, 1.3, -14.6, 0.98, -11.4, 0x2a2a30), box(0.6, 0.5, 0.4, -14.6, 0, -10.2, 0x1a1a20));
    this.sign('LOUNGE · KEINE UHREN · KEINE FENSTER · KEINE SORGEN', 7.5, 0.55, '#2a0d18', '#e8c35a', -18.4, 3.4, -17.05);
    // Buffet
    P.push(box(12, 0.9, 1.6, -2, 0, -16.6, 0xf0e8d8));
    for (let i = 0; i < 10; i++) P.push(ico(0.25, -7 + i * 1.1, 1.05, -16.6, [0xff8a2a, 0x7dff6a, 0xffd23a, 0xe0453a, 0xf4f1e8][i % 5], 0.6));
    this.sign('BUFFET „ALL YOU CAN REGRET“', 5.4, 0.55, '#f0e8d8', '#7a1f2e', -2, 2.2, -17.3);
    // High-Roller-Raum: Wand mit Tür, Teppich dunkler, Hinterzimmer mit Schreibtisch
    P.push(box(6.0, 4.0, 0.4, 10.4, 0, -7.0, 0x4a0f1a), box(8.0, 4.0, 0.4, 20.6, 0, -7.0, 0x4a0f1a), box(3.2, 0.6, 0.4, 15.0, 3.4, -7.0, 0x4a0f1a));
    N.push(box(3.2, 0.08, 0.08, 15.0, 3.3, -6.78, 0xe8c35a));
    this.sign('HIGH ROLLER', 3.0, 0.5, '#1a0b10', '#e8c35a', 15.0, 3.65, -6.75);
    P.push(box(0.3, 3.0, 3.4, 19.75, 0, -15.9, 0x3a0d18), box(2.0, 0.8, 1.0, 22.6, 0, -16.2, 0x4a2a1a), box(0.5, 0.06, 0.4, 22.4, 0.8, -16.0, 0xf4f1e8));
    N.push(box(0.15, 0.15, 0.15, 23.2, 1.1, -16.4, 0x7dff6a));
    // Tresor-Tür (E63) an der linken Wand
    P.push(cyl(1.3, 1.3, 0.3, 18, 0, 0, 0, 0x8a8a96).rotateZ(Math.PI / 2).translate(-24.2, 1.6, -4), cyl(0.3, 0.3, 0.5, 8, 0, 0, 0, 0xd8a83a).rotateZ(Math.PI / 2).translate(-24.0, 1.6, -4));
    // Boutique, Eingang mit rotem Teppich
    P.push(box(2.4, 1.1, 4.4, 13.4, 0, 15.4, 0x4a2a1a), box(4, 0.03, 6, 0, 0.03, 15, 0xb0102a));
    this.sign('BOUTIQUE „ROYAL THREADS“', 4, 0.5, '#3a0d18', '#e8c35a', 13.6, 2.6, 13.2);
    this.flush();
    // Kronleuchter (unbeleuchtete Leuchtkörper + Schein)
    const chandMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.05, 1.05, 1.05), toneMapped: false });
    for (const [x, z] of [[-9, 2], [0, 2], [13, 4], [-9, -12], [15, -12], [0, 13]] as [number, number][]) {
      const c = new THREE.Mesh(merge([cyl(0.05, 0.05, 1.4, 4, x, 7.6, z, 0xd8a83a), ico(0.5, x, 7.4, z, 0xfff2c0, 0.7), ...[0, 1, 2, 3, 4, 5].map((k) => ico(0.15, x + Math.sin(k) * 0.8, 7.2, z + Math.cos(k) * 0.8, 0xfff8e0))]), chandMat);
      c.name = 'chandelier'; this.chandeliers.push(c); this.group.add(c);
    }
    void def;
  }

  // ------------------------------------------------------------------ Aktualisierung
  setJackpot(v: number, flash = false) {
    const g = this.jackpotCanvas.getContext('2d');
    if (!g || !this.jackpotTex) return;
    g.fillStyle = flash ? '#ffd23a' : '#1a0b10'; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = '#e8c35a'; g.lineWidth = 8; g.strokeRect(4, 4, 504, 120);
    g.fillStyle = flash ? '#1a0b10' : '#ff4fae'; g.font = 'bold 26px Trebuchet MS, sans-serif'; g.textAlign = 'center';
    g.fillText('★ PROGRESSIVER JACKPOT ★', 256, 38);
    g.fillStyle = flash ? '#7a1f2e' : '#ffd23a'; g.font = '900 56px Trebuchet MS, sans-serif';
    g.fillText(`${Math.floor(v).toLocaleString('de-DE')} $`, 256, 102);
    this.jackpotTex.needsUpdate = true;
  }
  derbyDirty() { if (this.derbyTex) this.derbyTex.needsUpdate = true; }

  /** Chipstapel je Sitz am Blackjack-Tisch (Einsätze). */
  setChips(stacks: { x: number; z: number; amount: number }[]) {
    const m = this.chipStacks;
    if (!m) return;
    const colors = [0xe0453a, 0x3a6bff, 0x2aa060, 0x1a1a24, 0xd8a83a];
    let n = 0;
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    for (const s of stacks) {
      let left = s.amount, k = 0;
      while (left > 0 && n < m.instanceMatrix.count && k < 4) {
        const v = left >= 1000 ? 1000 : left >= 100 ? 100 : left >= 25 ? 25 : 5;
        const count = Math.min(10, Math.floor(left / v));
        if (!count) break;
        left -= count * v;
        const h = count * 0.025;
        m.setMatrixAt(n, m4.makeScale(1, h, 1).setPosition(s.x + k * 0.26, 0.93, s.z));
        m.setColorAt(n, c.setHex(colors[[5, 25, 100, 1000].indexOf(v) + 1] ?? colors[0]));
        n++; k++;
      }
    }
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Roulette-Kessel: Wurf starten (Ergebnis steht schon fest), Kugel läuft spiralförmig aus. */
  spinWheel(result: number) { this.wheelSpin = { active: true, t: 0, result, from: Math.random() * Math.PI * 2 }; }

  setEffects(o: { lights?: boolean; music?: boolean; alarm?: boolean; fog?: boolean; jackpot?: boolean; spot?: { x: number; z: number; seconds: number } | null }) {
    if (o.lights !== undefined) this.lightsOn = o.lights;
    if (o.music !== undefined) this.music = o.music;
    if (o.alarm !== undefined) this.alarm = o.alarm ? 1 : 0;
    if (o.fog !== undefined && this.fog) { this.fog.visible = o.fog; }
    if (o.jackpot) this.jackpotShow = 6;
    if (o.spot !== undefined && this.spot) {
      if (o.spot) { this.spot.position.set(o.spot.x, 6.6, o.spot.z); this.spotUntil = this.t + o.spot.seconds; this.tileU.uSpot.value.set(o.spot.x, o.spot.z, 1); }
      else { this.spotUntil = 0; this.tileU.uSpot.value.z = -1; }
    }
  }
  /** Spotlight folgt dem Spieler (lokal). */
  moveSpot(x: number, z: number) { if (this.spot && this.t < this.spotUntil) { this.spot.position.x = x; this.spot.position.z = z; this.tileU.uSpot.value.set(x, z, 1); } }
  /** Eigene Tanzkachel(n) hervorheben. */
  setMyTiles(tiles: number[]) {
    const m = this.tileMine;
    if (!m) return;
    const key = tiles.join(',');
    if (key === this.mineKey) return;
    this.mineKey = key;
    (m.array as Float32Array).fill(0);
    for (const t of tiles) if (t >= 0 && t < m.count) m.setX(t, 1);
    m.needsUpdate = true;
  }
  private mineKey = '';

  /** Pro Bild: beat = Beat-Position der Musik (−1 ohne Musik), cam = Kameraposition (Welt). */
  update(dt: number, beat: number, cam: THREE.Vector3) {
    this.t += dt;
    const t = this.t;
    // Puppenhaus: Außenwände zwischen Kamera und Raum ausblenden
    const lc = this.group.worldToLocal(tmpV.copy(cam));
    for (const w of this.walls) {
      const out = (lc.x - w.mx) * w.nx + (lc.z - w.mz) * w.nz > 0;
      w.full.visible = !out; w.stub.visible = out;
    }
    const b = beat >= 0 && this.music ? beat : t * 0.5;
    const pulse = Math.exp(-((b % 1 + 1) % 1) * 3.5);
    const on = this.lightsOn ? 1 : 0.08;
    const alarmBlink = this.alarm ? (Math.sin(t * 12) > 0 ? 1 : 0.2) : 0;
    if (this.tiles) {
      this.tileU.uBeat.value = this.music ? b : 0; this.tileU.uTime.value = t;
      this.tileU.uOn.value = this.music ? on : 0.15;
      this.cones.forEach((c, i) => {
        c.visible = this.lightsOn && this.music;
        c.rotation.x = Math.sin(t * 0.7 + i) * 0.5; c.rotation.z = Math.cos(t * 0.55 + i * 1.7) * 0.5;
        (c.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (0.18 + 0.25 * pulse) * (alarmBlink ? 0.3 : 1);
        c.updateMatrix();
      });
      if (this.lasers) {
        this.lasers.visible = this.music && this.lightsOn && Math.floor(b / 16) % 2 === 1;
        const pa = this.lasers.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < 12; i++) {
          const a = -1.2 + (i / 11) * 2.4 + Math.sin(t * 1.3) * 0.5;
          pa.setXYZ(i * 2, 0, 2.2, -9.6);
          pa.setXYZ(i * 2 + 1, Math.sin(a) * 18, 0.6 + Math.sin(t * 2 + i) * 1.2, -9.6 + Math.cos(a) * 18);
        }
        pa.needsUpdate = true;
        (this.lasers.material as THREE.LineBasicMaterial).color.setHSL(((b / 8) % 1 + 1) % 1, 1, 0.55);
      }
      if (this.ball) { this.ball.rotation.y = t * 0.8; this.ball.updateMatrix(); }
      if (this.dots) {
        this.dots.visible = this.lightsOn;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
        for (let i = 0; i < 64; i++) {
          // Richtung vom Ball (gleichmäßig auf einer Kugel), dreht sich; Schnitt mit Boden bzw. Rückwand
          const yy = -0.95 + ((i * 0.618) % 1) * 0.9, r = Math.sqrt(1 - yy * yy), a = i * 2.39996 + t * 0.6;
          const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
          const tf = 5.55 / -yy; // zum Boden
          let x = dx * tf, z = -1 + dz * tf, y = 0.12;
          q.identity().setFromAxisAngle(tmpAx.set(1, 0, 0), -Math.PI / 2);
          if (z < -11.4) { const k = (-11.4 + 1) / dz; x = dx * k; y = 5.6 + yy * k; z = -11.4; q.identity(); }
          else if (Math.abs(x) > 16.4) { const k = Math.sign(dx) * 16.4 / dx; x = Math.sign(dx) * 16.4; y = 5.6 + yy * k; z = -1 + dz * k; q.setFromAxisAngle(tmpAx.set(0, 1, 0), -Math.sign(dx) * Math.PI / 2); }
          m4.compose(tmpV.set(x, Math.max(0.12, y), z), q, tmpS.setScalar(Math.max(0.6, Math.min(2.2, Math.hypot(x, z) / 6))));
          this.dots.setMatrixAt(i, m4);
        }
        this.dots.instanceMatrix.needsUpdate = true;
      }
      if (this.flicker) { const fl = Math.sin(t * 37) * Math.sin(t * 11.3) > 0.2 || Math.random() < 0.04 ? 0.15 : 1; (this.flicker.material as THREE.MeshBasicMaterial).color.setScalar(fl * 1.3); }
      if (this.spot) { this.spot.visible = this.t < this.spotUntil; if (this.spot.visible) this.spot.updateMatrix(); else this.tileU.uSpot.value.z = -1; }
      if (this.fog && this.fog.visible) { (this.fog.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.1 * Math.sin(t); this.fog.updateMatrix(); }
    }
    if (this.screens) {
      // Bildschirme blinken (Jackpot: alle synchron in Gold)
      if (this.jackpotShow > 0) this.jackpotShow -= dt;
      const n = SLOT_MACHINES.length;
      for (let i = 0; i < n; i++) {
        const m = SLOT_MACHINES[i];
        const k = this.jackpotShow > 0 ? (Math.sin(t * 14) > 0 ? 1.8 : 0.3) : 0.7 + 0.5 * Math.max(0, Math.sin(t * (1.3 + (i % 5) * 0.3) + i));
        this.screenCol.setHex(this.jackpotShow > 0 ? 0xffd23a : m.v === 'classic' ? [0xff4fae, 0x3af2ff, 0x7dff6a][i % 3] : 0xffd23a).multiplyScalar(k * on);
        this.screens.setColorAt(i, this.screenCol);
      }
      if (this.screens.instanceColor) this.screens.instanceColor.needsUpdate = true;
      if (this.chandeliers.length) (this.chandeliers[0].material as THREE.MeshBasicMaterial).color.setScalar(this.lightsOn ? (this.jackpotShow > 0 ? 1.2 + Math.sin(t * 20) * 0.5 : 1.05) : 0.25);
    }
    if (this.wheel && this.ballR) {
      const ws = this.wheelSpin;
      if (ws.active) ws.t += dt;
      const spinV = ws.active ? Math.max(0.4, 6 * (1 - ws.t / 6)) : 0.4;
      this.wheel.rotation.y += spinV * dt;
      this.wheel.updateMatrix();
      // Kugel: entgegen, verlangsamt, fällt nach innen und landet im Fach des Ergebnisses
      const k = Math.min(1, ws.t / 6);
      const slot = WHEEL_ORDER.indexOf(ws.result);
      const target = this.wheel.rotation.y + (slot / 37) * Math.PI * 2;
      const free = ws.from - ws.t * 9 * (1 - k * 0.6);
      const ang = ws.active ? (k < 0.85 ? free : target) : target;
      const rad = ws.active ? 0.6 - 0.16 * Math.min(1, k / 0.85) : 0.44;
      const wx = this.wheel.position.x, wz = this.wheel.position.z;
      this.ballR.position.set(wx + Math.sin(ang) * rad, 1.08 + (k < 0.85 && ws.active ? Math.abs(Math.sin(ws.t * 9)) * 0.02 : 0), wz + Math.cos(ang) * rad);
      this.ballR.updateMatrix();
      if (ws.active && ws.t > 8) ws.active = false;
    }
  }

  show(v: boolean) { this.group.visible = v; }

  dispose() {
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
    this.jackpotTex?.dispose(); this.derbyTex?.dispose();
  }
}
const tmpV = new THREE.Vector3(), tmpAx = new THREE.Vector3(), tmpS = new THREE.Vector3();
