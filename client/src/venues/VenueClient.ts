// Club „Pink Static“ & Casino „Palm Royale“ auf dem Client: Tür-Interaktion mit Blende und Tür-Sound,
// Wechsel in die Teil-Szene (Außenwelt-Rendering pausiert, eigenes Licht-Setup, näherer Zoom,
// Puppenhaus-Wände), Menge (Instancing + Animationstextur), Sprechblasen, Effekte (Licht, Spotlight,
// Jackpot, Alarm, Nebel), Beschallung (drinnen voll, draußen/auf Toiletten gedämpft), Minispiel-Overlays,
// Außenbereiche (Schlange, Big Teo, Taxi, Springbrunnen, Valet, Derby-Terminals, Straßenparty).
import * as THREE from 'three';
import { BALANCE } from '../../../shared/src/balance';
import { GATORS } from '../../../shared/src/content/casino/derby';
import { CASINO_TABLES, INTERIORS, interiorFrame, interiorFloorH, spotNear, tableSeat, tileAt, toLocal, toWorld, venueExterior, zoneAt, type InteriorFrame, type InteriorId, type Spot } from '../../../shared/src/venues/interiors';
import { type VenueGame, type VenueServerMsg, type VNpcTuple } from '../../../shared/src/venues/net';
import type { ClientMsg } from '../../../shared/src/protocol';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { gamepads, type PadFrame } from '../input/Gamepad';
import type { Sfx } from '../audio/Sfx';
import type { CameraRig } from '../render/CameraRig';
import type { Sky } from '../render/Sky';
import { BubbleLayer } from './bubbles';
import { FigureList, lookForKind, type VenueFigure } from './figures';
import { VenueExterior3D } from './Exterior';
import { InteriorView } from './InteriorView';
import { DanceTrack, VenuePA } from './music';
import { DanceUi } from './ui/DanceUi';
import { VenueUi } from './ui/VenueUi';

export interface VenueGameHost {
  map: WorldMap;
  scene: THREE.Scene;
  sfx: Sfx;
  rig: CameraRig;
  sky: Sky;
  myId: number;
  send(m: ClientMsg): void;
  notice(text: string, kind: 'info' | 'good' | 'bad'): void;
  serverNow(): number;
  money(): number;
  setBlocked(b: boolean): void;
  /** Eigene Figur: Tanzschritt-Akzent */
  pulse(id: number, s: number): void;
  playerAnchor(id: number): THREE.Vector3 | null;
}

interface NpcRec { a: VNpcTuple; b: VNpcTuple; t: number; x: number; z: number; ang: number; moving: boolean }

const fmt = (n: number) => Math.floor(n).toLocaleString('de-DE');

export class VenueClient {
  inside: InteriorId | null = null;
  mask = 0;
  chips = 0;
  lockdown = false;
  readonly ui: VenueUi;
  readonly dance: DanceUi;
  readonly exterior: VenueExterior3D;
  private views = new Map<InteriorId, InteriorView>();
  private frames: Record<InteriorId, InteriorFrame | null>;
  /** Menge drinnen (normale NPC-Figuren, gezeichnet von EntityViews) */
  private inFigures = new FigureList();
  private npcs = new Map<number, NpcRec>();
  readonly bubbles = new BubbleLayer(7);
  private pa: VenuePA | null = null;
  private track: DanceTrack | null = null;
  private loop: { voice: { stop(fade?: number): void } } | null = null;
  private loopId = '';
  private fadeEl: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private music: Record<InteriorId, { on: boolean; song: string | null; t0: number }> = { club: { on: true, song: null, t0: 0 }, casino: { on: true, song: 'lounge', t0: 0 } };
  private street = false;
  private hint: string | null = null;
  private jackpot = 10_000;
  private derbyT = 0;
  private derbyView: Extract<VenueGame, { g: 'derby' }>['view'] | null = null;
  private bjChips = new Map<string, { x: number; z: number; amount: number }[]>();
  private t = 0;
  /** Vom Spiel: Hinweistext (E/F) */
  onHint: (text: string | null) => void = () => {};
  tipsOn = true;

  constructor(private h: VenueGameHost) {
    this.frames = { club: interiorFrame(h.map, 'club'), casino: interiorFrame(h.map, 'casino') };
    this.exterior = new VenueExterior3D(h.map);
    h.scene.add(this.exterior.group, this.bubbles.group);
    try { this.tipsOn = localStorage.getItem('sunstate.casinoTips') !== '0'; } catch { /* egal */ }
    this.ui = new VenueUi({
      send: (v) => h.send({ t: 'venue', v }),
      sound: (id, vol) => this.sound(id, vol),
      onOpen: (open) => h.setBlocked(open),
      money: () => h.money(),
      chips: () => this.chips,
      myId: () => h.myId,
      tips: () => this.tipsOn,
    });
    this.dance = new DanceUi(this.ui, {
      send: (v) => h.send({ t: 'venue', v }),
      sound: (id, vol) => this.sound(id, vol),
      serverNow: () => h.serverNow(),
      audioNow: () => h.sfx.engine?.ctx.currentTime ?? performance.now() / 1000,
      track: () => this.danceTrack(),
      pulse: (s) => h.pulse(h.myId, s),
      myId: () => h.myId,
      myTile: () => this.myTile(),
    });
    this.ui.extra = this.dance;
    this.fadeEl = Object.assign(document.createElement('div'), { id: 'venue-fade' });
    this.flashEl = Object.assign(document.createElement('div'), { id: 'venue-flash' });
    document.body.append(this.fadeEl, this.flashEl);
  }

  private danceTrack() {
    const e = this.h.sfx.engine;
    if (!e) return null;
    return (this.track ??= new DanceTrack(e));
  }
  private sound(id: string, vol = 1, pos?: { x: number; y: number; z: number }) { this.h.sfx.engine?.play(id, { pos, vol }); }

  private view(id: InteriorId): InteriorView | null {
    let v = this.views.get(id);
    if (!v) {
      const f = this.frames[id];
      if (!f) return null;
      v = new InteriorView(f);
      this.views.set(id, v);
      this.h.scene.add(v.group);
    }
    return v;
  }

  // ------------------------------------------------------------------ Nachrichten
  onMessage(m: VenueServerMsg) {
    switch (m.t) {
      case 'venue': this.onVenue(m); break;
      case 'vnpc': {
        for (const tup of m.n ?? []) {
          const r = this.npcs.get(tup[0]);
          if (r) { r.a = [...r.b] as VNpcTuple; r.a[1] = Math.round(r.x * 10); r.a[2] = Math.round(r.z * 10); r.b = tup; r.t = 0; }
          else this.npcs.set(tup[0], { a: tup, b: tup, t: 1, x: tup[1] / 10, z: tup[2] / 10, ang: tup[3] / 100, moving: false });
        }
        for (const id of m.g ?? []) this.npcs.delete(id);
        break;
      }
      case 'vsay': {
        const f = this.inside ? this.frames[this.inside] : null;
        if (m.who > 0 && f) {
          const id = m.who;
          this.bubbles.show(m.text, m.style, () => { const r = this.npcs.get(id); if (!r) return null; const w = toWorld(f, r.x, r.z); return tmpV.set(w.x, f.y + ((r.b[7] / 1000) | 0) / 10, w.z); });
        } else if (m.who < 0) {
          const id = -m.who;
          this.bubbles.show(m.text, m.style, () => this.h.playerAnchor(id));
        } else if (m.at) this.bubbles.show(m.text, m.style, null, new THREE.Vector3(m.at[0], m.at[1], m.at[2]));
        if (m.style === 'shout' && this.inside === 'club' && /BUUUH|BUH/.test(m.text)) this.sound('venue.boo', 0.8);
        break;
      }
      case 'vgame': this.onGame(m.s); break;
      case 'vfx': this.onFx(m); break;
      case 'vdlg': this.ui.dialog(m.d); this.sound('venue.chips', 0.3); break;
      case 'vstats': this.chips = m.s.chips; this.ui.statsState(m.s, m.board); break;
    }
  }

  private onVenue(m: Extract<VenueServerMsg, { t: 'venue' }>) {
    const was = this.inside;
    this.chips = m.chips; this.mask = m.mask; this.lockdown = m.lockdown;
    if (m.in === was) { if (this.ui.isOpen) this.ui.render(); return; }
    // Blende + Tür-Sound
    this.fadeEl.classList.add('on');
    this.sound('venue.door', 1);
    setTimeout(() => this.fadeEl.classList.remove('on'), 320);
    if (was) { this.views.get(was)?.show(false); this.ui.close(false); this.dance.close(); }
    this.npcs.clear();
    this.bubbles.clear();
    this.inside = m.in;
    if (m.in) {
      this.view(m.in)?.show(true);
      if (m.in === 'club' && m.music) { const [song, t0] = m.music.split('@'); this.music.club = { on: true, song, t0: Number(t0) }; }
      this.h.notice(m.in === 'club' ? 'Pink Static: F auf einer Leuchtkachel = Dance Floor Heat · Bar: E bei Vee · VIP-Empore oben rechts' : `Palm Royale: Kasse links (Chips 1:1), Automaten rechts, Tische in der Mitte, Gator Derby an der Wand · Jackpot ${fmt(this.jackpot)} $`, 'info');
    } else if (m.door === 'evac') this.h.notice('Feueralarm! Alle raus – die Party geht draußen weiter.', 'bad');
    else if (m.door === 'kick') this.h.notice('Rausgeworfen.', 'bad');
    this.inFigures.begin(); this.exterior.figures.begin();
    this.setLoop();
  }

  private onGame(s: VenueGame) {
    switch (s.g) {
      case 'slot': this.chips = s.chips; this.ui.slotState(s); break;
      case 'bj': {
        this.ui.bjState(s.view, s.me);
        const t = CASINO_TABLES.find((x) => x.id === s.view.id);
        if (t) this.bjChips.set(t.id, s.view.seats.filter((x) => x.pid && (x.bet || x.hands.length)).map((x) => { const p = tableSeat(t, x.seat); return { x: p.x + (t.x - p.x) * 0.45, z: p.z + (t.z - p.z) * 0.45, amount: x.hands.reduce((a, h) => a + h.bet, 0) || x.bet }; }));
        this.views.get('casino')?.setChips([...this.bjChips.values()].flat());
        break;
      }
      case 'ru': {
        const prev = (this as { ruSpin?: number }).ruSpin;
        if (s.view.phase === 'spin' && s.view.spin !== prev) { (this as { ruSpin?: number }).ruSpin = s.view.spin; this.views.get('casino')?.spinWheel(s.view.result); }
        this.ui.ruState(s.view);
        break;
      }
      case 'derby': this.derbyView = s.view; this.ui.derbyState(s.view, false); break;
      case 'dance': this.dance.session(s.s); break;
      case 'dj': if (s.on) this.dance.startDj(s.song, s.t0); else this.dance.stopDj(); break;
      case 'close': this.ui.close(false); break;
    }
  }

  private onFx(m: Extract<VenueServerMsg, { t: 'vfx' }>) {
    const v = this.inside ? this.views.get(this.inside) : null;
    switch (m.k) {
      case 'jackpotBoard': this.jackpot = m.v ?? this.jackpot; this.views.get('casino')?.setJackpot(this.jackpot); break;
      case 'jackpot': {
        this.views.get('casino')?.setEffects({ jackpot: true });
        this.views.get('casino')?.setJackpot(m.v ?? 0, true);
        this.sound('venue.jackpot'); this.sound('venue.coins'); this.sound('venue.cheer');
        this.flashEl.classList.add('on'); setTimeout(() => this.flashEl.classList.remove('on'), 1600);
        this.h.notice(`★ JACKPOT im Palm Royale: ${m.s || 'Ein Gast'} gewinnt ${fmt(m.v ?? 0)} $! ★`, 'good');
        break;
      }
      case 'spotlight': {
        const p = m.pid ? this.h.playerAnchor(m.pid) : null;
        const f = this.frames.club;
        if (p && f) { const l = toLocal(f, p.x, p.z); this.views.get('club')?.setEffects({ spot: { x: l.x, z: l.z, seconds: m.v ?? 8 } }); (this as { spotPid?: number }).spotPid = m.pid; }
        this.sound('venue.zap'); this.sound('venue.cheer', 0.8);
        break;
      }
      case 'crowd': break; // Kreis bilden: macht der Server mit den NPC-Positionen
      case 'trophy': {
        this.sound('venue.fanfare');
        if (m.pid) this.bubbles.show('🏆', 'symbol', () => this.h.playerAnchor(m.pid!));
        break;
      }
      case 'move': if (m.pid && m.pid !== this.h.myId) this.h.pulse(m.pid, m.v === 3 ? -1 : m.v === 0 ? 1 : 0.7); break;
      case 'confetti': this.sound('venue.cheer', 0.6); break;
      case 'music': {
        const id = this.inside ?? 'club';
        if (m.s && m.s.includes('@')) { const [song, t0] = m.s.split('@'); this.music.club = { on: m.on !== false, song, t0: Number(t0) }; }
        else this.music[id === 'casino' ? 'casino' : 'club'].on = m.on !== false;
        this.views.get('club')?.setEffects({ music: this.music.club.on });
        if (m.on === false && this.inside === 'club') this.sound('venue.boo', 0.7);
        break;
      }
      case 'lights': v?.setEffects({ lights: m.on !== false }); break;
      case 'fog': v?.setEffects({ fog: !!m.on }); break;
      case 'alarm': {
        if (m.s === 'street') { this.street = !!m.on; this.exterior.street = this.street; this.music.club.on = !m.on; }
        else v?.setEffects({ alarm: !!m.on });
        if (m.on) this.sound('venue.alarm');
        break;
      }
    }
  }

  // ------------------------------------------------------------------ Interaktion
  /** Lokale Position im aktuellen Innenraum. */
  private localPos(x: number, z: number) { const f = this.inside ? this.frames[this.inside] : null; return f ? toLocal(f, x, z) : null; }
  private myPos: { x: number; z: number; inVehicle: boolean } = { x: 0, z: 0, inVehicle: false };
  private myTile() { const l = this.localPos(this.myPos.x, this.myPos.z); return l && this.inside === 'club' ? tileAt(l.x, l.z) : -1; }

  private nearSpot(): Spot | null {
    const l = this.localPos(this.myPos.x, this.myPos.z);
    if (!l || !this.inside) return null;
    return spotNear(INTERIORS[this.inside], l.x, l.z, 0.3);
  }

  /** E gedrückt. true = verbraucht. */
  interact(): boolean {
    if (this.ui.isOpen) return true;
    const p = this.myPos;
    if (this.inside) {
      const s = this.nearSpot();
      if (!s) return true; // drinnen nichts anderes (keine Telefone/Fahrzeuge)
      return this.useSpot(s);
    }
    // Draußen: Türen, Valet, Derby-Terminals
    for (const id of ['club', 'casino'] as InteriorId[]) {
      const f = this.frames[id];
      if (!f) continue;
      if (!p.inVehicle && Math.hypot(p.x - f.door.x, p.z - f.door.z) < 3.8) { this.h.send({ t: 'venue', v: { a: 'enter', which: id } }); return true; }
    }
    const cf = this.frames.casino;
    if (cf) {
      const ex = venueExterior(cf);
      if (Math.hypot(p.x - ex.valet.x, p.z - ex.valet.z) < (p.inVehicle ? 9 : 3)) { this.h.send({ t: 'venue', v: { a: 'valet', op: p.inVehicle ? 'drop' : 'get' } }); return true; }
    }
    if (!p.inVehicle) for (const t of this.exterior.terminals) if (Math.hypot(p.x - t.x, p.z - t.z) < 3) { this.ui.openDerby(true); if (this.derbyView) this.ui.derbyState(this.derbyView, true); this.h.send({ t: 'venue', v: { a: 'derbyWatch' } }); return true; }
    return false;
  }

  /** F gedrückt (drinnen: Tanzkachel / Interaktion statt Ein-/Aussteigen). true = verbraucht. */
  use(): boolean {
    if (!this.inside) return false;
    if (this.ui.isOpen) return true;
    const s = this.nearSpot();
    if (s) this.useSpot(s, true);
    return true;
  }

  private useSpot(s: Spot, f = false): boolean {
    switch (s.kind) {
      case 'tile': {
        // Battle in der Nähe? Dann beitreten, sonst Auswahl öffnen
        const sess = this.dance.sess;
        void sess;
        this.h.send({ t: 'venue', v: { a: 'use', spot: s.id } });
        setTimeout(() => { if (!this.dance.active && !this.ui.isOpen) this.dance.openSetup(); }, 160);
        return true;
      }
      case 'cage': this.h.send({ t: 'venue', v: { a: 'use', spot: s.id } }); this.ui.openCage(); return true;
      case 'derby': this.ui.openDerby(false); this.h.send({ t: 'venue', v: { a: 'use', spot: s.id } }); return true;
      case 'exit': this.h.send({ t: 'venue', v: { a: 'exit' } }); return true;
      case 'backdoor': this.h.send({ t: 'venue', v: { a: 'exit', back: true } }); return true;
      default: this.h.send({ t: 'venue', v: { a: 'use', spot: s.id } }); void f; return true;
    }
  }

  pad(f: PadFrame) { return this.ui.pad(f); }

  // ------------------------------------------------------------------ Pro Bild
  /** Kamera/Licht/Musik/Menge aktualisieren. me = eigene Position. Rückgabe: Innenraum aktiv? */
  frame(dt: number, me: { x: number; z: number; inVehicle: boolean }, focus: THREE.Vector3, day: number, sunLight: THREE.Color) {
    this.t += dt;
    this.myPos = me;
    const now = this.h.serverNow();
    const id = this.inside;
    // Musik (PA) und Beat
    const eng = this.h.sfx.engine;
    if (eng && !this.pa) this.pa = new VenuePA(eng);
    const mc = this.music.club;
    let beat = -1;
    if (this.pa) {
      const want = id === 'casino' ? 'lounge' : mc.on && mc.song ? mc.song : null;
      const t0 = id === 'casino' ? (this.music.casino.t0 ||= now) : mc.t0;
      const clubF = this.frames.club;
      const dClub = clubF ? Math.hypot(me.x - clubF.door.x, me.z - clubF.door.z) : 999;
      if (id === 'casino') { this.pa.play('lounge', t0, now, true); this.pa.set(0.45, 6000); }
      else if (id === 'club' || (dClub < 110 && !this.street)) {
        this.pa.play(want, t0, now);
        let level = 1, cut = 20000;
        if (id === 'club') {
          const l = this.localPos(me.x, me.z)!;
          const z = INTERIORS.club.zones.find((x) => x.id === zoneAt(INTERIORS.club, l.x, l.z));
          if (z?.muffle) { cut = 2200 * (1 - z.muffle) + 300; level = 1 - z.muffle * 0.5; }
          if (this.dance.active) level = 0.08; // eigener Song im Tanzspiel
        } else { level = Math.max(0, 0.75 - dClub / 140); cut = 380 + Math.max(0, 40 - dClub) * 8; }
        this.pa.set(level, cut);
      } else { this.pa.set(0, 300); if (dClub > 140) this.pa.play(null, 0, now); }
      beat = id === 'club' || dClub < 110 ? this.pa.beat(now) : -1;
    }
    // Außenbereich (nur draußen sichtbar)
    if (!id) {
      this.exterior.update(dt, day, focus, beat, sunLight);
      this.hintOutside(me);
      this.bubbles.update(dt);
      return false;
    }
    // Innen: Licht-Setup (kein Tageslicht), Zoom, Puppenhaus, Menge
    const v = this.view(id)!;
    const f = this.frames[id]!;
    this.h.rig.extraZoom = 0.72;
    v.update(dt, beat, this.h.rig.camera.position);
    const sp = (this as { spotPid?: number }).spotPid;
    if (sp) { const a = this.h.playerAnchor(sp); if (a) { const l = toLocal(f, a.x, a.z); v.moveSpot(l.x, l.z); } }
    v.setMyTiles(this.dance.active ? [this.myTile()] : []);
    // Menge interpolieren (4 Hz Server-Takt)
    const c = this.inFigures;
    c.begin();
    this.exterior.figures.begin();
    for (const r of this.npcs.values()) {
      r.t = Math.min(1, r.t + dt * 4);
      const ax = r.a[1] / 10, az = r.a[2] / 10, bx = r.b[1] / 10, bz = r.b[2] / 10;
      r.x = ax + (bx - ax) * r.t; r.z = az + (bz - az) * r.t;
      r.moving = Math.hypot(bx - ax, bz - az) > 0.05 && r.t < 1;
      const want = r.b[3] / 100;
      let d = want - r.ang; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      r.ang += d * Math.min(1, dt * 8);
      const w = toWorld(f, r.x, r.z);
      const look = lookForKind(r.b[5], r.b[6], r.b[7]);
      // Höhe (Empore, Podest) kommt über EntityViews.groundOverride → groundAt
      c.add(r.b[0], w.x, w.z, r.ang + f.rot, r.moving ? 0 : r.b[4], look.role, look.shirt, look.scale);
    }
    this.bubbles.update(dt, 0.85);
    // Derby-Großbildschirm (10 Bilder/s)
    if (id === 'casino') { this.derbyT -= dt; if (this.derbyT <= 0) { this.derbyT = 0.1; drawDerby(v.derbyCanvas, this.derbyView, this.t); v.derbyDirty(); } }
    this.hintInside();
    return true;
  }

  /** Bodenhöhe drinnen (Empore, Podest) – für Figuren. */
  groundAt(x: number, z: number): number | null {
    const f = this.inside ? this.frames[this.inside] : null;
    if (!f) return null;
    const l = toLocal(f, x, z);
    if (Math.abs(l.x) > f.def.hw + 1 || Math.abs(l.z) > f.def.hd + 1) return null;
    return f.y + interiorFloorH(f.def, l.x, l.z);
  }

  /** Licht-Setup drinnen (statt Sonne/Tageslicht): warmes Oberlicht, dunkler Hintergrund, kein Nebel. */
  applyLighting(sky: Sky, scene: THREE.Scene) {
    const club = this.inside === 'club';
    sky.sun.color.setRGB(club ? 0.75 : 1.0, club ? 0.6 : 0.88, club ? 0.95 : 0.7);
    sky.sun.intensity = club ? 0.9 : 1.6;
    sky.sun.position.set(sky.sun.target.position.x + 6, sky.sun.target.position.y + 30, sky.sun.target.position.z + 12);
    sky.sun.castShadow = false;
    sky.ambient.color.setRGB(club ? 0.45 : 0.75, club ? 0.3 : 0.62, club ? 0.6 : 0.5);
    sky.ambient.groundColor.setRGB(0.12, 0.08, 0.16);
    sky.ambient.intensity = club ? 1.0 : 1.25;
    sky.fog.near = 400; sky.fog.far = 900;
    (scene.background as THREE.Color | null)?.setRGB?.(club ? 0.05 : 0.08, club ? 0.02 : 0.03, club ? 0.08 : 0.04);
  }

  get hintText() { return this.hint; }

  private setHint(t: string | null) { if (t !== this.hint) { this.hint = t; this.onHint(t); } }

  private hintOutside(me: { x: number; z: number; inVehicle: boolean }) {
    for (const id of ['club', 'casino'] as InteriorId[]) {
      const f = this.frames[id];
      if (f && !me.inVehicle && Math.hypot(me.x - f.door.x, me.z - f.door.z) < 3.8) { this.setHint(`E: ${INTERIORS[id].name} betreten`); return; }
    }
    const cf = this.frames.casino;
    if (cf) { const ex = venueExterior(cf); if (Math.hypot(me.x - ex.valet.x, me.z - ex.valet.z) < (me.inVehicle ? 9 : 3)) { this.setHint(me.inVehicle ? `E: Wagen beim Valet abgeben (Rico)` : `E: Wagen vom Valet holen (${BALANCE.casino.valetFee} $)`); return; } }
    for (const t of this.exterior.terminals) if (!me.inVehicle && Math.hypot(me.x - t.x, me.z - t.z) < 3) { this.setHint('E: Gator Derby – wetten'); return; }
    this.setHint(null);
  }

  private hintInside() {
    if (this.ui.isOpen) { this.setHint(null); return; }
    const s = this.nearSpot();
    if (!s) { this.setHint(null); return; }
    const lab: Partial<Record<Spot['kind'], string>> = {
      tile: 'F: Dance Floor Heat (Tanzen)', exit: this.lockdown ? 'Haupteingang von der Polizei abgeriegelt!' : 'E: Hinausgehen', backdoor: 'E: Hinterausgang',
      bar: 'E: Mit Vee reden (Gerüchte, Drinks)', dj: 'E: DJ-Pult', vipdesk: 'E: VIP-Karte', lounge: 'E: Hinsetzen',
      cage: 'E: Kasse (Chips 1:1)', slot: `E: ${s.label}`, bj: 'E: Blackjack spielen', roulette: 'E: Roulette spielen', derby: 'E: Gator Derby – Wettschalter',
      piano: 'E: Bar & Pianist', buffet: `E: Buffet (${BALANCE.casino.buffetPrice} $)`, ledger: 'E halten: Schreibtisch durchsuchen', boutique: 'E: Boutique',
    };
    this.setHint(lab[s.kind] ?? null);
  }

  private setLoop() {
    const e = this.h.sfx.engine;
    const want = this.inside === 'club' ? 'venue.crowd.club' : this.inside === 'casino' ? 'venue.slot_hall' : '';
    if (want === this.loopId) return;
    this.loop?.voice.stop(0.4); this.loop = null; this.loopId = want;
    if (e && want) this.loop = e.loop(want, null);
  }

  toggleTips() { this.tipsOn = !this.tipsOn; try { localStorage.setItem('sunstate.casinoTips', this.tipsOn ? '1' : '0'); } catch { /* egal */ } return this.tipsOn; }

  /** Spielerfilter: nur Spieler im selben Innenraum (bzw. draußen) zeigen. */
  sameSpace(interiorIdx: number) { const mine = this.inside === 'club' ? 1 : this.inside === 'casino' ? 2 : 0; return (interiorIdx ?? 0) === mine; }

  isInside() { return this.inside !== null; }

  /** Figuren dieses Bildes: drinnen die Menge, draußen Schlange, Türsteher, Portier, Valet, Partygäste. */
  get figures(): readonly VenueFigure[] { return this.inside ? this.inFigures.list : this.exterior.figures.list; }
  usesPad() { return gamepads.mode === 'pad'; }
}

const tmpV = new THREE.Vector3();

/** Großbildschirm / Overlay: Alligatorrennen zeichnen. */
export function drawDerby(cv: HTMLCanvasElement, v: Extract<VenueGame, { g: 'derby' }>['view'] | null, t: number) {
  const g = cv.getContext('2d');
  if (!g) return;
  const W = cv.width, H = cv.height;
  g.fillStyle = '#0e2a18'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7dff6a'; g.font = 'bold 22px Trebuchet MS'; g.textAlign = 'left';
  g.fillText(`🐊 GATOR DERBY${v ? ` · Rennen ${v.race}` : ''}`, 14, 28);
  if (!v) return;
  const lanes = GATORS.length, top = 46, lh = (H - top - 40) / lanes;
  const k = v.phase === 'run' ? Math.max(0, Math.min(1, 1 - v.t / 22)) : v.phase === 'result' ? 1 : 0;
  for (let i = 0; i < lanes; i++) {
    const y = top + i * lh;
    g.fillStyle = i % 2 ? '#13361f' : '#18402a'; g.fillRect(10, y, W - 20, lh - 2);
    let p = 0;
    if (v.script && v.phase !== 'bet') { const s = v.script[i], f = k * (s.length - 1), a = Math.floor(f); p = s[a] + (s[Math.min(s.length - 1, a + 1)] - s[a]) * (f - a); }
    const x = 30 + p * (W - 110);
    g.fillStyle = '#' + GATORS[i].color.toString(16).padStart(6, '0');
    g.beginPath(); g.ellipse(x, y + lh / 2, 22, lh * 0.28, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(x + 18, y + lh / 2 - 6); g.lineTo(x + 40 + Math.sin(t * 12 + i) * 3, y + lh / 2 - 2); g.lineTo(x + 18, y + lh / 2 + 6); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 13px Trebuchet MS'; g.fillText(`${GATORS[i].name}  ${v.odds[i].toFixed(1)}`, 14, y + 13);
  }
  g.fillStyle = '#ffd23a'; g.fillRect(W - 70, top, 4, lanes * lh);
  g.fillStyle = '#fff'; g.font = 'bold 15px Trebuchet MS';
  g.fillText(v.phase === 'bet' ? `Wetten offen – Start in ${Math.floor(v.t / 60)}:${String(v.t % 60).padStart(2, '0')}` : v.say ?? '', 14, H - 12);
}
