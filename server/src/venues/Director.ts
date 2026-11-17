// Regisseur der Innenraum-Ereignisse (E57–E64, shared/content/events/venues.ts): wählt Ereignisse nach
// Gewicht und Abklingzeit, besetzt die Rollen mit NPCs der Menge (oder erzeugt Gäste), spielt die Phasen
// mit Sprechblasen, Bewegungen und Effekten ab, erkennt Spieler-Eingriffe und wendet den Ausgang an.
import type { GangId } from '../../../shared/src/gangs';
import { VENUE_EVENTS } from '../../../shared/src/content/events/venues';
import type { Detect, Line, Outcome, Phase, StreetEventDef } from '../../../shared/src/content/events/schema';
import { Act } from '../../../shared/src/npc/scenarios';
import { type InteriorId } from '../../../shared/src/venues/interiors';
import { VNpcKind } from '../../../shared/src/venues/net';
import type { ServerPlayer } from '../entities/types';
import type { Crowd, VNpc } from './Crowd';
import type { VenueHost } from './host';

/** Rollen → NPCs: fester Tag, Auswahl aus der Menge oder neu erzeugen (lokale Position). */
interface Bind { tag?: string; pick?: 'dancers' | 'gamblers' | 'guards' | 'all'; n?: number; at?: [number, number]; kind?: number; act?: number; style?: number; y?: number; anchor?: boolean }
const BIND: Record<string, Record<string, Bind>> = {
  dj_missing: { dj: { tag: 'dj' }, crowd: { pick: 'dancers', n: 14 }, vee: { tag: 'vee' }, deck: { anchor: true, at: [0, -10.2] } },
  gang_dance_battle: {
    neon: { at: [-3.5, -7.5], kind: VNpcKind.GANG, n: 4, style: 0 }, rivals: { at: [3.5, -7.5], kind: VNpcKind.GANG, n: 4, style: 1 },
    host: { at: [0, -7.6], kind: VNpcKind.GUEST, style: 8 }, crowd: { pick: 'dancers', n: 16 },
  },
  vip_drama: { influencer: { at: [7.6, 2.6], kind: VNpcKind.GUEST, style: 11 }, bouncer: { tag: 'mo' }, fans: { at: [6.6, 3.4], kind: VNpcKind.GUEST, n: 3, style: 5 } },
  fire_alarm: { fog: { anchor: true, at: [0, -9] }, crowd: { pick: 'all' }, dj: { tag: 'dj' }, fire: { anchor: true, at: [0, 14] } },
  lucky_granny: { oma: { tag: 'oma' }, crowd: { pick: 'gamblers', n: 7 }, buyer: { at: [0, 0], kind: VNpcKind.GUEST, style: 15 }, charm: { anchor: true } },
  system_player: { system: { tag: 'system' }, croupier: { tag: 'croupier:ru1' }, table: { pick: 'gamblers', n: 3 }, pad: { anchor: true } },
  vault_false_alarm: { guards: { pick: 'guards', n: 4 }, guests: { pick: 'gamblers', n: 12 }, manager: { at: [-12, 12], kind: VNpcKind.STAFF, style: 4 } },
  jackpot_hysteria: { winner: { pick: 'gamblers', n: 1 }, crowd: { pick: 'gamblers', n: 10 }, staff: { at: [6, 13], kind: VNpcKind.WAITER }, confetti: { anchor: true } },
};
/** Fokuspunkt je Ereignis (lokal) für Bewegungen/Erkennung, falls keine Rolle passt. */
const FOCUS: Record<string, [number, number]> = { dj_missing: [0, -8], gang_dance_battle: [0, -3], vip_drama: [9, 1], fire_alarm: [0, 0], lucky_granny: [12, 0], system_player: [-0.5, 3], vault_false_alarm: [-22, -4], jackpot_hysteria: [14, 4] };
const VAULT: [number, number] = [-23, -4];

interface RunRole { npcs: VNpc[]; temp: boolean; anchor?: [number, number] }
interface EventRun {
  def: StreetEventDef; phase: number; t: number; lineIdx: number; roles: Map<string, RunRole>;
  outcome: string | null; holdT: Map<number, number>; focus: [number, number];
}

export interface DirectorCtx {
  h: VenueHost;
  crowd: Crowd;
  inside(): ServerPlayer[];
  /** Lokale Position eines Spielers */
  local(p: ServerPlayer): { x: number; z: number };
  /** Sprechblase an NPC bzw. an einem lokalen Punkt (Anker/Requisite) */
  say(n: VNpc | null, text: string, style: Line['style'], at?: [number, number]): void;
  effect(kind: string, on: boolean): void;
  /** Act eines Spielers (Emote/Tanzen) */
  actOf(p: ServerPlayer): number;
  hasVip(p: ServerPlayer): boolean;
  rumor(text: string, p: ServerPlayer | null): void;
  heal(p: ServerPlayer): void;
  /** Läuft gerade ein Minispiel, das zu diesem Ereignis gehört (DJ-Pult, Gang-Battle)? Dann wartet die Phase. */
  holding(key: string): boolean;
}

export class Director {
  run: EventRun | null = null;
  private cool = new Map<string, number>();
  private nextT = 45 + Math.random() * 45;
  /** Signale aus Minispielen (DJ, Battle) für venue_game-Erkennung: [Spieler, Spiel, Seite] */
  private signals: { pid: number; game: string; side?: string }[] = [];

  constructor(readonly venue: InteriorId, private c: DirectorCtx) {}

  /** Laufendes Ereignis mit Schlüssel? */
  active(key: string) { return this.run?.def.key === key ? this.run : null; }
  phaseId() { return this.run ? this.run.def.phases[this.run.phase]?.id ?? '' : ''; }

  signal(pid: number, game: string, side?: string) { this.signals.push({ pid, game, side }); }

  /** Ereignis sofort starten (Dev, Jackpot-Hysterie). */
  start(key: string): boolean {
    const def = VENUE_EVENTS.find((e) => e.key === key && e.venue === this.venue);
    if (!def || this.run) return false;
    this.begin(def);
    return true;
  }

  update(dt: number) {
    if (this.run) { this.step(dt); return; }
    if (!this.c.inside().length) return;
    this.nextT -= dt;
    if (this.nextT > 0) return;
    this.nextT = 70 + Math.random() * 80;
    const now = Date.now();
    const cands = VENUE_EVENTS.filter((e) => e.venue === this.venue && e.key !== 'jackpot_hysteria' && (this.cool.get(e.key) ?? 0) < now);
    if (!cands.length) return;
    let r = Math.random() * cands.reduce((a, e) => a + e.weight, 0);
    for (const e of cands) { r -= e.weight; if (r <= 0) { this.begin(e); return; } }
  }

  private begin(def: StreetEventDef) {
    const roles = new Map<string, RunRole>();
    const binds = BIND[def.key] ?? {};
    const taken = new Set<number>();
    const focus = FOCUS[def.key] ?? [0, 0];
    for (const role of def.roles) {
      const b = binds[role.id] ?? {};
      const rr: RunRole = { npcs: [], temp: false };
      if (b.anchor || role.kind === 'prop' || role.kind === 'vehicle' || role.kind === 'animal') {
        rr.anchor = b.at ?? focus;
      } else if (b.tag) {
        const n = this.c.crowd.byTag(b.tag);
        if (n) rr.npcs.push(n);
      } else if (b.pick) {
        const pool = [...this.c.crowd.npcs.values()].filter((n) => !n.hidden && !n.busy && !taken.has(n.id) && (
          b.pick === 'all' ? n.kind !== VNpcKind.BOUNCER : b.pick === 'dancers' ? n.kind === VNpcKind.DANCER : b.pick === 'guards' ? n.kind === VNpcKind.GUARD : n.kind === VNpcKind.GAMBLER));
        pool.sort((a, z) => Math.hypot(a.x - focus[0], a.z - focus[1]) - Math.hypot(z.x - focus[0], z.z - focus[1]));
        rr.npcs.push(...pool.slice(0, b.n ?? pool.length));
      } else {
        const count = b.n ?? 1;
        const at = b.at ?? focus;
        for (let i = 0; i < count; i++) rr.npcs.push(this.c.crowd.add(b.kind ?? VNpcKind.GUEST, `ev:${def.key}:${role.id}`, at[0] + (i - (count - 1) / 2) * 0.9, at[1], Math.PI, Act.None, b.style ?? 0, b.y ?? 0));
        rr.temp = true;
      }
      for (const n of rr.npcs) { taken.add(n.id); n.busy = def.key; }
      roles.set(role.id, rr);
    }
    // Anker an NPC-Position (Requisiten: Glücksbringer, Notizblock, Konfetti)
    const firstNpc = [...roles.values()].find((r) => r.npcs.length)?.npcs[0];
    for (const [id, r] of roles) if (r.anchor && !binds[id]?.at && firstNpc) r.anchor = [firstNpc.x, firstNpc.z];
    const f = def.key === 'lucky_granny' || def.key === 'jackpot_hysteria' ? (roles.get(def.key === 'lucky_granny' ? 'oma' : 'winner')?.npcs[0]) : null;
    this.run = { def, phase: -1, t: 0, lineIdx: 0, roles, outcome: null, holdT: new Map(), focus: f ? [f.x, f.z] : focus };
    // Käufer stellt sich neben die Oma
    if (f && def.key === 'lucky_granny') { const buyer = roles.get('buyer')?.npcs[0]; if (buyer) { buyer.x = f.x + 1.4; buyer.z = f.z + 1.2; buyer.tx = buyer.x; buyer.tz = buyer.z; } }
    this.cool.set(def.key, Date.now() + def.cooldown * 1000);
    this.enterPhase(0);
  }

  private role(id: string) { return this.run?.roles.get(id); }
  private posOf(id: string): [number, number] {
    const r = this.role(id);
    if (!r) return this.run!.focus;
    if (r.npcs.length) return [r.npcs[0].x, r.npcs[0].z];
    return r.anchor ?? this.run!.focus;
  }

  private enterPhase(i: number) {
    const run = this.run!;
    const ph: Phase | undefined = run.def.phases[i];
    if (!ph) { this.end(run.outcome ?? 'ignored'); return; }
    run.phase = i; run.t = ph.dur[0] + Math.random() * (ph.dur[1] - ph.dur[0]); run.lineIdx = 0;
    (run as EventRun & { el: number }).el = 0;
    for (const a of ph.actions ?? []) {
      const r = this.role(a.role);
      if (!r) continue;
      const tgt = a.target ? this.posOf(a.target) : run.focus;
      r.npcs.forEach((n, k) => {
        const act = a.act ? (Act as Record<string, number>)[a.act] ?? Act.None : n.act;
        switch (a.move) {
          case 'flee': case 'hide': this.c.crowd.walk(n, (Math.random() - 0.5) * 6, this.c.crowd.def.hd - 2, 3.2, act); break;
          case 'goto': case 'dash': {
            const target = run.def.key === 'vault_false_alarm' && a.move === 'dash' ? VAULT : tgt;
            this.c.crowd.walk(n, target[0] + (k % 3 - 1) * 0.8, target[1] + 1.2 + Math.floor(k / 3) * 0.8, a.move === 'dash' ? 3.6 : 1.5, act);
            break;
          }
          case 'gather': case 'circle': case 'swarm': {
            const ang = (k / Math.max(1, r.npcs.length)) * Math.PI * 2;
            this.c.crowd.walk(n, tgt[0] + Math.sin(ang) * 2.8, tgt[1] + Math.cos(ang) * 2.8, 1.8, act);
            break;
          }
          default: n.act = act;
        }
      });
    }
    for (const p of ph.physics ?? []) this.physics(p.kind, true);
  }

  private physics(kind: string, on: boolean) {
    switch (kind) {
      case 'music_stop': this.c.effect('music', false); break;
      case 'music_start': this.c.effect('music', true); break;
      case 'fog': this.c.effect('fog', on); break;
      case 'alarm': this.c.effect('alarm', on); break;
      case 'lights_out': this.c.effect('lights', false); break;
      case 'lights_on': this.c.effect('lights', true); break;
      case 'confetti': this.c.effect('confetti', on); break;
      case 'evacuate': this.c.effect('evacuate', true); break;
    }
  }

  private step(dt: number) {
    const run = this.run!;
    const ph = run.def.phases[run.phase];
    const el = ((run as EventRun & { el: number }).el += dt);
    // Sprechblasen nach Zeitpunkt
    const lines = ph.lines ?? [];
    while (run.lineIdx < lines.length && (lines[run.lineIdx].at ?? run.lineIdx * 3) <= el) {
      this.line(lines[run.lineIdx]);
      run.lineIdx++;
    }
    // Eingriffe erkennen
    if (!run.outcome) for (const iv of run.def.interventions) {
      if (iv.phases?.length && !iv.phases.includes(ph.id)) continue;
      const who = this.detect(iv.detect, iv.gate);
      if (who) { this.apply(run.def.outcomes[iv.outcome], who, iv.outcome); run.outcome = iv.outcome; run.t = Math.min(run.t, 3); break; }
    }
    this.signals.length = 0;
    if (!run.outcome && this.c.holding(run.def.key)) return; // Minispiel läuft: Phase wartet
    run.t -= dt;
    if (run.t <= 0) {
      if (run.outcome && run.def.key !== 'fire_alarm') { this.end(run.outcome); return; }
      const next = ph.next === 'end' ? run.def.phases.length : ph.next ? run.def.phases.findIndex((p) => p.id === ph.next) : run.phase + 1;
      this.enterPhase(next);
    }
  }

  private line(l: Line) {
    const r = this.role(l.role);
    const n = r?.npcs.length ? r.npcs[Math.floor(Math.random() * Math.min(3, r.npcs.length))] : null;
    this.c.say(n, l.text, l.style, n ? undefined : r?.anchor ?? this.run!.focus);
  }

  /** Welcher Spieler erfüllt die Erkennung (oder null)? */
  private detect(d: Detect, gate?: { rep?: { gang: string; min?: number; max?: number }; onFoot?: boolean }): ServerPlayer | null {
    const ok = (p: ServerPlayer) => {
      if (!gate?.rep) return true;
      const g = gate.rep.gang === 'event_gang' ? 'neon' : gate.rep.gang;
      const rep = p.profile.reputation[g] ?? 0;
      if (gate.rep.min != null && rep < gate.rep.min && !(g === 'neon' && this.c.hasVip(p))) return false;
      if (gate.rep.max != null && rep > gate.rep.max) return false;
      return true;
    };
    const inside = this.c.inside().filter(ok);
    const dist = (p: ServerPlayer, at: [number, number]) => { const l = this.c.local(p); return Math.hypot(l.x - at[0], l.z - at[1]); };
    switch (d.kind) {
      case 'venue_game': {
        const s = this.signals.find((x) => x.game === d.game && (!d.side || x.side === d.side));
        return s ? this.c.h.players.get(s.pid) ?? null : null;
      }
      case 'approach': return inside.find((p) => dist(p, this.posOf(d.target)) < d.radius) ?? null;
      case 'emote': {
        const want = d.emote === 'cheer' ? [Act.Cheer, Act.Pose] : d.emote === 'dance' ? [Act.Dance, Act.Dance2, Act.Dance3, Act.Dance4, Act.Dance5] : d.emote === 'wave' ? [Act.Wave] : null;
        return inside.find((p) => dist(p, this.run!.focus) < d.radius + 4 && (want ? (want as number[]).includes(this.c.actOf(p)) : this.c.actOf(p) > 0)) ?? null;
      }
      case 'interact': {
        const at = this.run!.def.key === 'vault_false_alarm' ? VAULT : this.posOf(d.target);
        for (const p of inside) {
          const t = p.hold && dist(p, at) < 3 ? (this.run!.holdT.get(p.id) ?? 0) + 1 / 20 : 0;
          this.run!.holdT.set(p.id, t);
          if (t >= (d.hold ?? 1)) return p;
        }
        return null;
      }
      default: return null;
    }
  }

  private apply(o: Outcome | undefined, p: ServerPlayer, id: string) {
    if (!o) return;
    const h = this.c.h;
    if (o.money) h.addMoney(p, o.money, `venue:event:${this.run!.def.key}`);
    if (o.xp) h.grantXp(p, o.xp);
    if (o.health === 'full') this.c.heal(p);
    for (const it of o.items ?? []) h.addItem(p, it);
    for (const r of o.rep ?? []) h.addRep(p, (r.gang === 'event_gang' ? 'neon' : r.gang) as GangId, r.delta);
    if (this.run!.def.key === 'dj_missing' && id === 'saved_party') h.addItem(p, 'free_drink');
    h.notice(p, `${this.run!.def.title}: ${o.label}${o.money ? ` (+${o.money} $)` : ''}${o.xp ? ` (+${o.xp} XP)` : ''}`, 'good');
    for (const l of o.lines ?? []) setTimeout(() => this.run && this.line(l), 500);
    this.c.rumor(o.rumor ?? this.run!.def.rumor.text, p);
    const radio = o.radio ?? this.run!.def.radio;
    if (radio && this.run!.def.rumor.heat >= 0.5) h.radio(radio);
  }

  private end(outcome: string) {
    const run = this.run!;
    if (outcome === 'ignored') { const o = run.def.outcomes.ignored; if (o?.lines) for (const l of o.lines) this.line(l); }
    for (const r of run.roles.values()) for (const n of r.npcs) {
      n.busy = null;
      if (r.temp) this.c.crowd.remove(n);
      else this.c.crowd.walk(n, n.home.x, n.home.z, 1.4, n.home.act);
    }
    // Effekte zurücksetzen
    this.c.effect('music', true); this.c.effect('lights', true); this.c.effect('alarm', false); this.c.effect('fog', false); this.c.effect('evacuate', false);
    this.run = null;
  }

  /** Ereignis abbrechen (z. B. alle Spieler weg). */
  abort() { if (this.run) this.end('ignored'); }
}
