// Menge im Innenraum: Partygänger, Glücksspieler, Personal. Einfache Server-Simulation in lokalen
// Koordinaten (Wegpunkte, Anstellen, Tanzen, Reaktionen) – übertragen als kompakte Tupel an die Spieler im
// selben Innenraum (Delta, 4 Hz). Darstellung beim Client per Instancing + Animationstextur (VenueCrowd).
import { Act } from '../../../shared/src/npc/scenarios';
import {
  CASINO_TABLES, DANCE_COLS, DANCE_ROWS, INTERIORS, localFree, SLOT_MACHINES, tableDealer, tableSeat, tileCenter,
  type InteriorId,
} from '../../../shared/src/venues/interiors';
import { VNpcKind, type VNpcTuple } from '../../../shared/src/venues/net';

export interface VNpc {
  id: number; kind: number; x: number; z: number; a: number; act: number; seed: number; style: number;
  /** Fester Name/Rolle (vee, dj, oma, croupier:bj1 …) */
  tag: string;
  /** Ruheplatz/Grundverhalten */
  home: { x: number; z: number; a: number; act: number };
  /** Ziel (lokal) und Tempo; arrive: Act bei Ankunft */
  tx: number; tz: number; speed: number; arrive: number;
  /** Restzeit des aktuellen Verhaltens */
  t: number;
  /** Versteckt (z. B. evakuiert) */
  hidden: boolean;
  /** Ereignis/Quest hält den NPC fest (Verhalten nicht überschreiben) */
  busy: string | null;
  /** Wegpunkte (Patrouille) */
  route?: [number, number][];
  ri?: number;
  /** Höhe (Empore) */
  y: number;
}

let nid = 1;
const rnd = Math.random;
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const DANCES = [Act.Dance, Act.Dance2, Act.Dance3, Act.Dance4, Act.Dance];

export const CLUB_BARKS = {
  talk: [['WAS?!', 'ICH SAGTE: SCHÖNE SCHUHE!'], ['Kennst du den DJ?', 'WAS?!'], ['Noch einen Drink?', 'ICH HÖRE NUR BASS!'], ['Ist das dein Song?', 'JEDER SONG IST MEIN SONG!'], ['Wo ist Kevin?', 'KEVIN IST IMMER WEG!']],
  selfie: ['Erst ein Selfie, dann tanzen!', 'Moment, das Licht ist gerade PERFEKT.', '#PinkStatic #KeinFilter #DochFilter'],
  dance: ['Wuhuuu!', 'DROP IT!', 'Das ist MEIN Song!', 'Ich spür den Bass in den Zähnen!'],
  vip: ['Wir sind das Syndikat. Wir tanzen nicht – wir lassen tanzen.', 'Der Champagner ist warm. Typisch Dienstag.', 'Sag dem DJ, er soll den Song nochmal spielen. Und nochmal.'],
  bar: ['Einen „Static Shock“, bitte. Ohne Strom.', 'Vee, du bist die Beste!', 'Ist das hier Mineralwasser? Warum leuchtet es?'],
  toilet: ['*flacker* … *flacker* …', 'Hallo? Ist hier noch wer? Das Licht macht mir Angst.'],
  hype: ['Der Typ hat MOVES!', 'Wer IST das?!', 'Spotlight! SPOTLIGHT!', 'Ich will so tanzen können!'],
  cringe: ['Ich kann nicht hinsehen…', 'Autsch. Das war der Knöchel.', 'Mutig. Sehr mutig.'],
  again: ['Mach das nochmal!', 'ZUGABE!', 'Noch ein Song! Noch ein Song!'],
  win: ['CHAMPION!', 'Der Pokal! Er hat einen POKAL!', 'Das geht in die Geschichtsbücher. Oder auf Insta.'],
};
export const CASINO_BARKS = {
  slot: ['Nur noch ein Dreh!', 'Ich spüre es – die Sieben kommt!', 'Komm schon, Muschel… komm zu Mama.', 'Wer braucht schon Rente?'],
  oma: ['Mein Glücksbringer sagt: noch einmal.', 'Früher hatten Automaten noch Hebel UND Würde.', 'Pssst, Schätzchen – der Dritte von links ist heiß.'],
  system: ['Statistisch gesehen bin ich dran.', 'Mein System ist todsicher. Ich hab es aufgeschrieben.', 'Rot kam viermal. Also MUSS jetzt Rot kommen. Oder?'],
  bachelor: ['JUNGGESELLENABSCHIED!!!', 'Kevin heiratet! Kevin hat ALLES verspielt! Kevin ist glücklich!', 'Noch eine Runde für den Bräutigam!'],
  tourist: ['Ist das hier… normal, dass keine Uhren hängen?', 'Wo ist der Ausgang? Wo sind die Fenster? Welcher Tag ist heute?', 'Ich wollte nur aufs Klo und hab 200 $ verloren.'],
  highroller: ['Ich setze… alles. Außer die Sonnenbrille.', 'Geld ist nur bedrucktes Papier. Mit meinem Gesicht drauf, irgendwann.', 'Bringen Sie mir einen Kaviar-Toast. Und einen Würfel.'],
  waiter: ['Champagner? Wasser? Würde?', 'Vorsicht, heißer Toast!', 'Das Buffet ist offen. Die Krabben sind… mutig.'],
  croupier: ['Die Bank dankt.', 'Mutige Entscheidung, Sir.', 'Bitte setzen. Oder gehen. Hauptsache, Sie entscheiden sich.'],
  pianist: ['♪ Für Elise, aber mit Bass ♪', '♪ Jemand wünschte sich „Freebird“. Nein. ♪'],
  guard: ['Kein Zutritt.', 'Ich sehe alles. Außer die Waschbären.', 'Bitte gehen Sie weiter. Langsam. Mit Stil.'],
  marlin: ['Mister Sunday mag keine Überraschungen.', 'Die Zahlen stimmen. Sie stimmen immer.', 'Der Jackpot heute Abend ist… vorgesehen.'],
};

export class Crowd {
  readonly npcs = new Map<number, VNpc>();
  readonly def;
  private barkT = 4;
  /** Zuletzt gesendetes Tupel je Spieler und NPC (Delta) */
  private sent = new Map<number, Map<number, string>>();

  constructor(readonly id: InteriorId, private say: (n: VNpc, text: string, style?: 'say' | 'shout' | 'think' | 'gang') => void) {
    this.def = INTERIORS[id];
    if (id === 'club') this.fillClub(); else this.fillCasino();
  }

  add(kind: number, tag: string, x: number, z: number, a: number, act: number, style = 0, y = 0): VNpc {
    const n: VNpc = { id: nid++, kind, x, z, a, act, seed: Math.floor(rnd() * 1000), style, tag, home: { x, z, a, act }, tx: x, tz: z, speed: 0, arrive: act, t: 2 + rnd() * 6, hidden: false, busy: null, y };
    this.npcs.set(n.id, n);
    return n;
  }
  byTag(tag: string) { for (const n of this.npcs.values()) if (n.tag === tag) return n; return null; }
  ofKind(kind: number) { return [...this.npcs.values()].filter((n) => n.kind === kind && !n.hidden); }
  remove(n: VNpc) { this.npcs.delete(n.id); }

  // ------------------------------------------------------------------ Club
  private fillClub() {
    // Tänzer auf und um die Tanzfläche (Kachelgitter), Stil je NPC
    for (let i = 0; i < 40; i++) {
      const p = this.danceSpot();
      this.add(VNpcKind.DANCER, 'dancer', p.x, p.z, rnd() * 6.28, pick(DANCES), i % 6);
    }
    for (let i = 0; i < 8; i++) this.add(VNpcKind.GUEST, i < 2 ? 'selfie' : 'bar', -11.2 + rnd() * 0.6, -5 + i * 1.4, -Math.PI / 2, i < 2 ? Act.Photo : pick([Act.Drink, Act.Talk, Act.Lean]), 6 + (i % 4));
    for (let i = 0; i < 4; i++) this.add(VNpcKind.GUEST, 'lounge', 11.6 + i * 1.1, 5.2, Math.PI, Act.Sit, 3 + i);
    for (let i = 0; i < 4; i++) this.add(VNpcKind.GANG, 'vip', 11 + i * 1.5, -8 + (i % 2) * 2.4, i % 2 ? Math.PI : 0, pick([Act.Lean, Act.Talk, Act.Drink]), 0, 1.8);
    for (let i = 0; i < 3; i++) this.add(VNpcKind.GUEST, 'talker', -7.5 + i * 0.9, 6.2, i * 2, Act.Talk, 7 + i);
    this.add(VNpcKind.GUEST, 'toilet', -14, -10, 0, Act.Phone, 9);
    this.add(VNpcKind.BARKEEP, 'vee', -14.4, 0, Math.PI / 2, Act.Talk, 0);
    this.add(VNpcKind.DJ, 'dj', 0, -10.3, 0, Act.DJ, 0, 0.8);
    this.add(VNpcKind.BOUNCER, 'mo', 9.6, 0.9, 0, Act.Lean, 0);
    this.add(VNpcKind.STAFF, 'coat', -13.6, 10.6, 0, Act.Wait, 1);
  }

  /** Freier Tanzplatz: zwischen den Kacheln, nicht auf Kacheln mit Spielern. */
  danceSpot(avoid: number[] = []): { x: number; z: number } {
    for (let k = 0; k < 20; k++) {
      const x = -7 + rnd() * 14, z = -6.6 + rnd() * 11.6;
      if (avoid.some((t) => { const c = tileCenter(t); return Math.abs(c[0] - x) < 1.3 && Math.abs(c[1] - z) < 1.3; })) continue;
      if (localFree(this.def, x, z, 0.35)) return { x, z };
    }
    return { x: rnd() * 4 - 2, z: 6 };
  }

  // ------------------------------------------------------------------ Casino
  private fillCasino() {
    const used = new Set<number>();
    for (let i = 0; i < 20; i++) {
      let m = Math.floor(rnd() * SLOT_MACHINES.length);
      while (used.has(m)) m = (m + 7) % SLOT_MACHINES.length;
      used.add(m);
      const sm = SLOT_MACHINES[m];
      const z = sm.z + (sm.a === 0 ? 0.95 : -0.95);
      this.add(VNpcKind.GAMBLER, i === 0 ? 'oma' : i === 1 ? 'tourist' : `slot${m}`, sm.x, z, sm.a + Math.PI, Act.Slot, i === 0 ? 20 : 10 + (i % 8));
    }
    for (const t of CASINO_TABLES) {
      const d = tableDealer(t);
      this.add(VNpcKind.CROUPIER, `croupier:${t.id}`, d.x, d.z, d.a, Act.Deal, 0);
      if (t.kind === 'roulette') {
        const s = tableSeat(t, t.seats - 1);
        this.add(VNpcKind.GAMBLER, 'system', s.x + 0.6, s.z + 0.8, s.a, Act.Read, 21);
      }
      for (let i = 0; i < (t.high ? 1 : 2); i++) {
        const s = tableSeat(t, i * 2 + 1);
        this.add(VNpcKind.GAMBLER, `watch:${t.id}`, s.x + (rnd() - 0.5), s.z + 1.0, s.a, Act.Watch, 10 + i);
      }
    }
    // Junggesellenabschied (zieht als Gruppe herum)
    for (let i = 0; i < 4; i++) this.add(VNpcKind.GAMBLER, 'bachelor', -2 + i * 0.8, 12.5, Math.PI, Act.Cheer, 22);
    // High-Roller-Raum: Sonnenbrille, Marlin Club
    this.add(VNpcKind.VIP, 'highroller', 16, -11.2, Math.PI, Act.Watch, 23);
    for (let i = 0; i < 3; i++) this.add(VNpcKind.GANG, 'marlin', 10 + i * 1.6, -15.6, 0, pick([Act.Talk, Act.Lean, Act.Drink]), 1);
    // Personal
    this.add(VNpcKind.STAFF, 'cashier', -16.6, 13.8, Math.PI / 2, Act.Atm, 2);
    this.add(VNpcKind.BARKEEP, 'barkeep', -18, -15.4, 0, Act.Talk, 1);
    this.add(VNpcKind.PIANIST, 'pianist', -14.6, -10.2, Math.PI, Act.Busk, 0);
    this.add(VNpcKind.STAFF, 'boutique', 13.4, 16.6, -Math.PI / 2, Act.Wait, 3);
    for (let i = 0; i < 5; i++) this.add(VNpcKind.GUEST, 'bar', -22 + i * 1.6, -11.6, Math.PI, pick([Act.Drink, Act.Talk]), 12 + i);
    for (let i = 0; i < 3; i++) this.add(VNpcKind.GUEST, 'buffet', -6 + i * 3, -14.6, Math.PI, Act.Eat, 14 + i);
    for (let i = 0; i < 3; i++) {
      const w = this.add(VNpcKind.WAITER, 'waiter', -4 + i * 6, 8, 0, Act.None, 0);
      w.route = [[-4, 8], [5, 8], [5, -4], [-6, -4], [-12, 9], [6, 13]]; w.ri = i * 2;
    }
    // Sicherheit: Eingang, Kasse, Patrouille im High-Roller-Raum (Sichtkegel → style 1)
    this.add(VNpcKind.GUARD, 'guard_door', -3, 15.8, Math.PI, Act.Wait, 0);
    this.add(VNpcKind.GUARD, 'guard_door', 3, 15.8, Math.PI, Act.Wait, 0);
    this.add(VNpcKind.GUARD, 'guard_cage', -13.4, 9.4, 0, Act.Lean, 0);
    const g1 = this.add(VNpcKind.GUARD, 'guard_hr', 10, -9, 0, Act.None, 1);
    g1.route = [[9, -9], [18.6, -9], [18.6, -16.6], [9, -16.6]]; g1.ri = 0;
    const g2 = this.add(VNpcKind.GUARD, 'guard_hr', 18.6, -16.6, 0, Act.None, 1);
    g2.route = [[18.6, -12], [12, -12], [12, -16.6], [18.6, -16.6]]; g2.ri = 1;
  }

  // ------------------------------------------------------------------ Takt
  update(dt: number, ctx: { music: boolean; spotlight: { x: number; z: number; until: number } | null; occupied: number[]; playersLocal: { x: number; z: number }[] }) {
    const now = Date.now();
    for (const n of this.npcs.values()) {
      if (n.hidden) continue;
      // Laufen zum Ziel
      const dx = n.tx - n.x, dz = n.tz - n.z, d = Math.hypot(dx, dz);
      if (n.speed > 0 && d > 0.15) {
        const step = Math.min(d, n.speed * dt);
        const nx = n.x + (dx / d) * step, nz = n.z + (dz / d) * step;
        if (localFree(this.def, nx, nz, 0.3)) { n.x = nx; n.z = nz; }
        else if (localFree(this.def, nx, n.z, 0.3)) n.x = nx;
        else if (localFree(this.def, n.x, nz, 0.3)) n.z = nz;
        else { n.tx = n.x; n.tz = n.z; } // festgefahren: hier bleiben
        n.a = Math.atan2(dx, dz);
        n.act = Act.None;
        if (d - step < 0.15) { n.speed = 0; n.act = n.arrive; }
        continue;
      }
      if (n.busy) continue;
      n.t -= dt;
      // Patrouille / Kellner
      if (n.route) {
        if (n.t <= 0 || n.speed === 0) {
          n.ri = ((n.ri ?? 0) + 1) % n.route.length;
          const [x, z] = n.route[n.ri];
          this.walk(n, x, z, n.kind === VNpcKind.GUARD ? 1.3 : 1.6, n.kind === VNpcKind.GUARD ? Act.Look : Act.Wait);
          n.t = 2 + rnd() * 3;
        }
        continue;
      }
      if (n.kind === VNpcKind.DANCER) {
        // Ohne Musik: rumstehen/schimpfen; mit Spotlight: Kreis um den Spieler
        if (!ctx.music) { if (n.act !== Act.Scold && n.act !== Act.Look) n.act = rnd() < 0.5 ? Act.Scold : Act.Look; continue; }
        if (ctx.spotlight && ctx.spotlight.until > now) {
          const sx = ctx.spotlight.x, sz = ctx.spotlight.z, dd = Math.hypot(n.x - sx, n.z - sz);
          if (dd < 7) {
            if (Math.abs(dd - 2.6) > 0.5 && n.speed === 0) {
              const ang = Math.atan2(n.x - sx, n.z - sz);
              this.walk(n, sx + Math.sin(ang) * 2.6, sz + Math.cos(ang) * 2.6, 2.2, Act.Cheer);
            } else { n.act = Act.Cheer; n.a = Math.atan2(sx - n.x, sz - n.z); }
            continue;
          }
        }
        if ((n.act === Act.Cheer || n.act === Act.Scold || n.act === Act.Look || n.act === Act.None) && n.speed === 0) n.act = pick(DANCES);
        // Spieler auf einer Kachel: Platz machen
        if (ctx.occupied.some((t) => { const c = tileCenter(t); return Math.abs(c[0] - n.x) < 1.1 && Math.abs(c[1] - n.z) < 1.1; })) {
          const p = this.danceSpot(ctx.occupied); this.walk(n, p.x, p.z, 1.6, pick(DANCES));
        } else if (n.t <= 0) {
          n.t = 8 + rnd() * 14;
          if (rnd() < 0.3) { const p = this.danceSpot(ctx.occupied); this.walk(n, p.x, p.z, 1.2, pick(DANCES)); }
          else n.act = pick(DANCES);
        }
        continue;
      }
      if (n.t <= 0) {
        n.t = 6 + rnd() * 10;
        // Grundverhalten: an den Ruheplatz zurück
        if (Math.hypot(n.x - n.home.x, n.z - n.home.z) > 0.4) this.walk(n, n.home.x, n.home.z, 1.3, n.home.act);
        else if (n.tag === 'bachelor') { const p = pick([[-2, 12.5], [2, 6], [8, 13], [-8, 12]] as [number, number][]); this.walk(n, p[0] + rnd(), p[1] + rnd(), 1.5, Act.Cheer); }
        else n.a = n.home.a;
      }
    }
    // Umgebungs-Sprechblasen
    this.barkT -= dt;
    if (this.barkT <= 0) { this.barkT = 2.5 + rnd() * 3.5; this.ambientBark(ctx.music); }
  }

  walk(n: VNpc, x: number, z: number, speed: number, arrive: number) { n.tx = x; n.tz = z; n.speed = speed; n.arrive = arrive; }

  private ambientBark(music: boolean) {
    const list = [...this.npcs.values()].filter((n) => !n.hidden && !n.busy);
    if (!list.length) return;
    if (this.id === 'club') {
      const r = rnd();
      if (r < 0.35) {
        const talkers = list.filter((n) => n.act === Act.Talk || n.tag === 'talker' || n.tag === 'bar');
        if (talkers.length >= 2) {
          const [a, b] = [pick(talkers), pick(talkers)];
          const pair = pick(CLUB_BARKS.talk);
          this.say(a, pair[0], 'shout');
          setTimeout(() => { if (this.npcs.has(b.id)) this.say(b, pair[1], 'shout'); }, 1500);
        }
      } else if (r < 0.5) { const n = list.find((x) => x.tag === 'selfie'); if (n) this.say(n, pick(CLUB_BARKS.selfie)); }
      else if (r < 0.65 && music) { const n = pick(list.filter((x) => x.kind === VNpcKind.DANCER)); if (n) this.say(n, pick(CLUB_BARKS.dance), 'shout'); }
      else if (r < 0.78) { const n = pick(list.filter((x) => x.tag === 'vip')); if (n) this.say(n, pick(CLUB_BARKS.vip), 'gang'); }
      else if (r < 0.9) { const n = pick(list.filter((x) => x.tag === 'bar')); if (n) this.say(n, pick(CLUB_BARKS.bar)); }
      else { const n = list.find((x) => x.tag === 'toilet'); if (n) this.say(n, pick(CLUB_BARKS.toilet), 'think'); }
      return;
    }
    const r = rnd();
    const by = (tag: string) => list.filter((x) => x.tag === tag || x.tag.startsWith(tag));
    const tryS = (tag: string, lines: string[], style: 'say' | 'shout' | 'think' | 'gang' = 'say') => { const c = by(tag); if (c.length) { this.say(pick(c), pick(lines), style); return true; } return false; };
    if (r < 0.22) tryS('slot', CASINO_BARKS.slot);
    else if (r < 0.32) tryS('oma', CASINO_BARKS.oma);
    else if (r < 0.42) tryS('system', CASINO_BARKS.system, 'think');
    else if (r < 0.52) tryS('bachelor', CASINO_BARKS.bachelor, 'shout');
    else if (r < 0.6) tryS('tourist', CASINO_BARKS.tourist, 'think');
    else if (r < 0.68) tryS('highroller', CASINO_BARKS.highroller);
    else if (r < 0.76) tryS('waiter', CASINO_BARKS.waiter);
    else if (r < 0.84) tryS('croupier', CASINO_BARKS.croupier);
    else if (r < 0.9) tryS('pianist', CASINO_BARKS.pianist);
    else if (r < 0.95) tryS('marlin', CASINO_BARKS.marlin, 'gang');
    else tryS('guard', CASINO_BARKS.guard);
  }

  tuple(n: VNpc): VNpcTuple {
    return [n.id, Math.round(n.x * 10), Math.round(n.z * 10), Math.round(n.a * 100), n.act, n.kind, n.seed, n.style + (n.y > 0 ? 1000 * Math.round(n.y * 10) : 0)];
  }

  /** Delta für einen Spieler (null = nichts geändert). */
  delta(pid: number): { n?: VNpcTuple[]; g?: number[] } | null {
    let seen = this.sent.get(pid);
    if (!seen) this.sent.set(pid, (seen = new Map()));
    const n: VNpcTuple[] = [], g: number[] = [];
    for (const npc of this.npcs.values()) {
      if (npc.hidden) continue;
      const t = this.tuple(npc), key = t.join(',');
      if (seen.get(npc.id) !== key) { n.push(t); seen.set(npc.id, key); }
    }
    for (const id of seen.keys()) { const npc = this.npcs.get(id); if (!npc || npc.hidden) { g.push(id); seen.delete(id); } }
    return n.length || g.length ? { n: n.length ? n : undefined, g: g.length ? g : undefined } : null;
  }
  forget(pid: number) { this.sent.delete(pid); }

  /** Anzahl Kacheln (für Statistik/Debug) */
  static readonly TILES = DANCE_COLS * DANCE_ROWS;
}
