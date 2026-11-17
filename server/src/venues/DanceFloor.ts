// „Dance Floor Heat“ auf dem Server: Tanz-Sessions (Solo, Dance-Battle, Crew), Plausibilisierung der vom
// Client gemeldeten Treffer, Punkte (gleicher Code wie der Client: shared/content/dance/beatmap.ts),
// Spotlight, NPC-Gegner (Quest-Rivale, Gang-Crews), Belohnungen und Bestenlisten.
//
// Plausibilisierung: Bewertungen kommen vom Client (Timing ist nur dort messbar), aber
//  - nur für Noten, deren Zeitpunkt (Server-Uhr) schon erreicht ist (± Toleranz) – kein Vorspulen,
//  - streng aufsteigend, jede Note höchstens einmal, übersprungene Noten zählen als „Daneben“,
//  - Haltedauer höchstens die Notenlänge, Punkte rechnet der Server selbst nach.
import { BALANCE } from '../../../shared/src/balance';
import {
  applyGrade, BEATMAPS, DANCE_STYLES, DIFFICULTIES, maxScore, newScore, NoteKind, noteTime, rankFor, SONG_BY_ID, songSeconds,
  type DanceRank, type Difficulty, type ScoreState,
} from '../../../shared/src/content/dance';
import { Act } from '../../../shared/src/npc/scenarios';
import { tilesAdjacent } from '../../../shared/src/venues/interiors';
import type { DanceMode, DanceSessionView } from '../../../shared/src/venues/net';
import type { ServerPlayer } from '../entities/types';
import { vprof } from './Bank';
import type { VenueHost } from './host';
import type { Leaderboard } from './Leaderboard';

const B = BALANCE.club;
const LOBBY_SECONDS = 10, COUNT_SECONDS = 3, RESULT_SECONDS = 6;
/** Zeit-Toleranz für gemeldete Treffer: Note darf höchstens so viel „in der Zukunft“ liegen (Latenz + Fenster). */
const EARLY_TOLERANCE = 0.35;

interface Dancer {
  pid: number; name: string; tile: number; npc?: { target: number; side?: string };
  score: ScoreState; next: number; lastHit: number; rank?: DanceRank;
}
interface Session {
  id: number; song: string; diff: Difficulty; mode: DanceMode;
  phase: DanceSessionView['phase']; t: number; t0: number;
  dancers: Dancer[];
  crew: number; crewMax: number;
  winner?: number;
  /** Ereignis/Quest-Battle: Seite bzw. Quest-Rivale */
  side?: string; questFor?: number;
  max: number;
}

export interface DanceCtx {
  h: VenueHost;
  clubPlayers(): ServerPlayer[];
  /** Act des Spielers setzen (für Zuschauer sichtbar), Dauer in s (0 = bis auf Weiteres). */
  setAct(p: ServerPlayer, act: number, seconds: number): void;
  vfx(msg: { k: 'spotlight' | 'crowd' | 'trophy' | 'move'; pid?: number; on?: boolean; v?: number; s?: string }): void;
  /** Reaktion der Menge (NPC-Sprechblasen) */
  react(kind: 'hype' | 'cringe' | 'again' | 'win', pid: number): void;
  rumor(text: string): void;
  /** Session beendet (Quest/Ereignis-Auswertung): Spieler-ID → Rang, Sieger. */
  finished(s: { mode: DanceMode; side?: string; questFor?: number; results: { pid: number; rank: DanceRank; score: number; won: boolean }[] }): void;
}

let nextId = 1;

export class DanceFloor {
  private sessions: Session[] = [];
  private byPlayer = new Map<number, Session>();
  /** DJ-Aushilfe (E57): Spieler am Pult, Startzeit, Treffer */
  dj: { pid: number; t0: number; ok: number; miss: number; song: string } | null = null;

  constructor(private c: DanceCtx, private board: Leaderboard, private instBoard: Map<string, [string, number][]>) {}

  sessionOf(pid: number) { return this.byPlayer.get(pid) ?? null; }
  tileTaken(tile: number) { return this.sessions.some((s) => s.dancers.some((d) => d.tile === tile)); }

  /** Spieler startet auf seiner Kachel eine Session (Solo sofort, Battle/Crew mit Warteraum). */
  setup(p: ServerPlayer, tile: number, song: string, diff: Difficulty, mode: DanceMode, opts: { side?: string; questFor?: number; npc?: { name: string; frac: number; tile: number }[] } = {}): string {
    if (this.byPlayer.has(p.id)) return 'Du tanzt schon.';
    if (!SONG_BY_ID[song] || !BEATMAPS[song] || !DIFFICULTIES.includes(diff)) return 'Unbekannter Song.';
    if (!['solo', 'battle', 'crew'].includes(mode)) return 'Unbekannter Modus.';
    if (this.tileTaken(tile)) return 'Die Kachel ist besetzt.';
    const bm = BEATMAPS[song];
    const s: Session = {
      id: nextId++, song, diff, mode, phase: mode === 'solo' && !opts.npc ? 'count' : 'lobby', t: mode === 'solo' && !opts.npc ? COUNT_SECONDS : opts.npc ? 4 : LOBBY_SECONDS, t0: 0,
      dancers: [], crew: 0, crewMax: 0, side: opts.side, questFor: opts.questFor,
      max: maxScore(bm, diff, B.spotlightSeconds, B.spotlightMult),
    };
    s.dancers.push(this.mkDancer(p.id, p.name, tile));
    for (const n of opts.npc ?? []) s.dancers.push({ ...this.mkDancer(-(1000 + s.dancers.length), n.name, n.tile), npc: { target: n.frac, side: opts.side } });
    if (s.phase === 'count') s.t0 = Date.now() + COUNT_SECONDS * 1000;
    this.sessions.push(s);
    this.byPlayer.set(p.id, s);
    this.c.setAct(p, Act.Dance, 0);
    this.broadcast(s);
    return '';
  }

  private mkDancer(pid: number, name: string, tile: number): Dancer { return { pid, name, tile, score: newScore(), next: 0, lastHit: -1 }; }

  /** Spieler auf benachbarter Kachel tritt einer wartenden Battle/Crew-Session bei. */
  join(p: ServerPlayer, tile: number): string {
    if (this.byPlayer.has(p.id)) return 'Du tanzt schon.';
    const s = this.sessions.find((x) => x.phase === 'lobby' && x.mode !== 'solo' && !x.dancers.some((d) => d.npc) && x.dancers.some((d) => tilesAdjacent(d.tile, tile)));
    if (!s) return 'Hier wartet gerade kein Battle in deiner Nähe – stell dich auf eine Nachbarkachel.';
    if (s.dancers.length >= 4) return 'Das Battle ist voll (max. 4).';
    if (this.tileTaken(tile)) return 'Die Kachel ist besetzt.';
    s.dancers.push(this.mkDancer(p.id, p.name, tile));
    this.byPlayer.set(p.id, s);
    this.c.setAct(p, Act.Dance, 0);
    this.broadcast(s);
    return '';
  }

  /** Offene Lobby in der Nähe einer Kachel (für den Hinweis „F: Battle beitreten“). */
  lobbyNear(tile: number) { return this.sessions.find((x) => x.phase === 'lobby' && x.mode !== 'solo' && x.dancers.some((d) => tilesAdjacent(d.tile, tile))) ?? null; }

  go(p: ServerPlayer) {
    const s = this.byPlayer.get(p.id);
    if (s && s.phase === 'lobby' && s.dancers[0].pid === p.id) s.t = 0;
  }

  quit(p: ServerPlayer) {
    const s = this.byPlayer.get(p.id);
    if (!s) return;
    this.byPlayer.delete(p.id);
    s.dancers = s.dancers.filter((d) => d.pid !== p.id);
    this.c.setAct(p, 0, 0);
    if (!s.dancers.some((d) => d.pid > 0)) this.sessions = this.sessions.filter((x) => x !== s);
    this.c.h.send(p, { t: 'vgame', s: { g: 'dance', s: null } });
    this.broadcast(s);
  }

  /** Gemeldete Treffer verarbeiten. */
  hits(p: ServerPlayer, list: [number, number, number][]) {
    const s = this.byPlayer.get(p.id);
    if (!s || s.phase !== 'play' || !Array.isArray(list)) return;
    const d = s.dancers.find((x) => x.pid === p.id)!;
    const bm = BEATMAPS[s.song], notes = bm[s.diff];
    const songNow = (Date.now() - s.t0) / 1000;
    let last = -1, lastGrade = -1, spot = false;
    for (const h of list.slice(0, 64)) {
      if (!Array.isArray(h) || h.length < 3) continue;
      const [idx, grade, held] = h.map((v) => Math.floor(Number(v)));
      if (!(idx >= d.next && idx < notes.length && grade >= 0 && grade <= 3)) continue;
      const n = notes[idx];
      const nt = noteTime(bm, n[0]);
      if (nt > songNow + EARLY_TOLERANCE) break; // Note liegt noch in der Zukunft → unplausibel, Rest verwerfen
      // übersprungene Noten = Daneben
      for (let k = d.next; k < idx; k++) this.apply(s, d, k, 3, 0);
      const r = this.apply(s, d, idx, grade, n[2] === NoteKind.HOLD ? Math.max(0, Math.min(n[3], held)) : 0);
      spot ||= r.spotlight;
      last = idx; lastGrade = grade;
    }
    if (last < 0) return;
    // Darstellung: Tanzschritt / Stolpern / Pose; Zuschauer sehen den Treffer als Ereignis
    const n = notes[last];
    if (lastGrade === 3) this.c.setAct(p, Act.Stumble, 0.7);
    else if (n[2] === NoteKind.STAR) this.c.setAct(p, Act.Pose, 1.1);
    else this.c.setAct(p, this.styleAct(d.score.combo, n[0]), 0);
    this.c.vfx({ k: 'move', pid: p.id, v: lastGrade });
    if (spot) { this.c.vfx({ k: 'spotlight', pid: p.id, on: true, v: B.spotlightSeconds }); this.c.vfx({ k: 'crowd', pid: p.id, on: true, v: B.spotlightSeconds }); this.c.react('hype', p.id); }
    else if (lastGrade === 3 && d.score.counts[3] % 6 === 1) this.c.react('cringe', p.id);
    else if (d.score.combo > 0 && d.score.combo % 30 === 0) this.c.react('again', p.id);
  }

  private styleAct(combo: number, beat: number): number {
    if (combo >= 50) return Math.floor(beat / 16) % 2 ? Act.Dance5 : Act.Dance4;
    if (combo >= 25) return Math.floor(beat / 8) % 2 ? Act.Dance2 : Act.Dance4;
    if (combo >= 10) return Act.Dance3;
    return Act.Dance;
  }

  private apply(s: Session, d: Dancer, idx: number, grade: number, held: number) {
    const bm = BEATMAPS[s.song], n = bm[s.diff][idx];
    const r = applyGrade(d.score, n, grade, noteTime(bm, n[0]), held, B.spotlightSeconds, B.spotlightMult);
    d.next = idx + 1; d.lastHit = idx;
    if (s.mode === 'crew') {
      // Gruppen-Combo: steigt nur, wenn alle die Note getroffen haben (jeder Fehltritt setzt sie zurück)
      if (grade === 3) s.crew = 0;
      else if (s.dancers.every((x) => x.npc || x.next > idx)) { s.crew++; s.crewMax = Math.max(s.crewMax, s.crew); }
    }
    return r;
  }

  update(dt: number) {
    const now = Date.now();
    for (const s of [...this.sessions]) {
      s.t -= dt;
      if (s.phase === 'lobby' && s.t <= 0) { s.phase = 'count'; s.t = COUNT_SECONDS; s.t0 = now + COUNT_SECONDS * 1000; this.broadcast(s); }
      else if (s.phase === 'count' && now >= s.t0) { s.phase = 'play'; this.broadcast(s); }
      else if (s.phase === 'play') {
        const songNow = (now - s.t0) / 1000;
        const bm = BEATMAPS[s.song], notes = bm[s.diff];
        // NPC-Tänzer: treffen gemäß Zielquote
        for (const d of s.dancers) {
          if (!d.npc) continue;
          while (d.next < notes.length && noteTime(bm, notes[d.next][0]) <= songNow) {
            const r = Math.random();
            const f = d.npc.target;
            const grade = r < f * 0.75 ? 0 : r < f ? 1 : r < f + (1 - f) * 0.5 ? 2 : 3;
            this.apply(s, d, d.next, grade, notes[d.next][2] === NoteKind.HOLD ? notes[d.next][3] : 0);
          }
        }
        // Spieler, die nichts mehr melden (Verbindung, Tab im Hintergrund): verstrichene Noten = Daneben (2 s Puffer)
        for (const d of s.dancers) {
          if (d.npc) continue;
          while (d.next < notes.length && noteTime(bm, notes[d.next][0]) < songNow - 2) this.apply(s, d, d.next, 3, 0);
        }
        if ((this.tickT = (this.tickT + 1) % 5) === 0) this.broadcast(s);
        if (songNow > songSeconds(SONG_BY_ID[s.song]) + 1) this.finish(s);
      } else if (s.phase === 'result' && s.t <= 0) {
        for (const d of s.dancers) if (d.pid > 0) { this.byPlayer.delete(d.pid); const p = this.c.h.players.get(d.pid); if (p) { this.c.setAct(p, 0, 0); this.c.h.send(p, { t: 'vgame', s: { g: 'dance', s: null } }); } }
        this.sessions = this.sessions.filter((x) => x !== s);
        this.broadcastClosed(s);
      }
      // Spieler weg (verlassen/ausgeloggt): aus der Session nehmen
      for (const d of s.dancers) if (d.pid > 0 && !this.c.h.players.get(d.pid)?.interior) this.quitById(s, d.pid);
    }
    this.updateDj(now);
  }
  private tickT = 0;

  private quitById(s: Session, pid: number) {
    this.byPlayer.delete(pid);
    s.dancers = s.dancers.filter((d) => d.pid !== pid);
    if (!s.dancers.some((d) => d.pid > 0)) this.sessions = this.sessions.filter((x) => x !== s);
  }

  private finish(s: Session) {
    s.phase = 'result'; s.t = RESULT_SECONDS;
    const bm = BEATMAPS[s.song];
    // Restliche Noten = Daneben
    for (const d of s.dancers) while (d.next < bm[s.diff].length) this.apply(s, d, d.next, 3, 0);
    for (const d of s.dancers) d.rank = rankFor(d.score.score, s.max);
    const best = [...s.dancers].sort((a, b) => b.score.score - a.score.score)[0];
    if (s.dancers.length > 1 && s.mode === 'battle') s.winner = best.pid;
    const results: { pid: number; rank: DanceRank; score: number; won: boolean }[] = [];
    const diffF = s.diff === 'easy' ? 0.45 : s.diff === 'medium' ? 0.75 : 1;
    const crewF = s.mode === 'crew' ? 1 + Math.min(0.5, s.crewMax / 200) : 1;
    const key = `${s.song}:${s.diff}`;
    for (const d of s.dancers) {
      const won = s.mode === 'battle' && s.winner === d.pid;
      results.push({ pid: d.pid, rank: d.rank!, score: d.score.score, won });
      if (d.pid <= 0) continue;
      const p = this.c.h.players.get(d.pid);
      if (!p) continue;
      const v = vprof(p);
      const frac = Math.max(0, Math.min(1, d.score.score / Math.max(1, s.max)));
      const money = Math.round((B.danceMoneyMin + (B.danceMoneyMax - B.danceMoneyMin) * frac * diffF) * crewF + (won ? B.battleBonus * (s.dancers.length - 1) : 0));
      const xp = Math.round(B.danceXpMax * frac * (0.5 + diffF / 2));
      this.c.h.addMoney(p, money, `club:dance:${s.song}`);
      this.c.h.grantXp(p, xp);
      const parts = [`Rang ${d.rank}`, `${d.score.score.toLocaleString('de-DE')} Punkte`, `+${money} $`, `+${xp} XP`];
      // Ruf beim Neon Syndicate: +1 … +3, höchstens einmal pro Spieltag
      const day = this.c.h.dayIndex();
      if (v.danceDay !== day && frac > 0.3) {
        const rep = Math.max(1, Math.min(B.danceRepMax, Math.round(frac * B.danceRepMax)));
        v.danceDay = day;
        this.c.h.addRep(p, 'neon', rep);
        parts.push(`Neon Syndicate +${rep}`);
      }
      // Freischaltungen
      const unlock = (id: string) => { if (!v.styles.includes(id)) { v.styles.push(id); parts.push(`Neuer Tanzstil: ${DANCE_STYLES.find((x) => x.id === id)?.name}`); } };
      const ri = 'SABCD'.indexOf(d.rank!);
      if (ri <= 2) unlock('roboter');
      if (ri <= 1 && s.diff !== 'easy') unlock('shuffle');
      if (d.score.maxCombo >= 50) unlock('disco');
      if (won) unlock('kreisel');
      if (d.score.spotlights >= 3) unlock('pose');
      if (d.rank === 'S' && s.diff === 'hard' && !p.profile.inventory.outfit_disco && this.c.h.addItem(p, 'outfit_disco')) parts.push('Outfit-Belohnung: Glitzer-Outfit „Dance Floor Heat“!');
      // Bestenlisten
      if (d.score.score > (v.best[key] ?? 0)) { v.best[key] = d.score.score; parts.push('Neuer Bestwert!'); }
      this.addInst(key, p.name, d.score.score);
      this.board.submit(key, p.name, d.score.score);
      this.c.h.notice(p, `Dance Floor Heat: ${parts.join(' · ')}`, 'good');
      this.c.h.persist(p);
    }
    if (s.winner !== undefined && s.winner > 0) {
      const w = this.c.h.players.get(s.winner);
      this.c.vfx({ k: 'trophy', pid: s.winner });
      this.c.vfx({ k: 'spotlight', pid: s.winner, on: true, v: 6 });
      this.c.vfx({ k: 'crowd', pid: s.winner, on: true, v: 6 });
      this.c.react('win', s.winner);
      if (w) this.c.rumor(`Dance-Battle im Pink Static: ${w.name} hat ${s.dancers.length - 1} Gegner vom Floor getanzt.`);
    } else if (best && best.pid > 0 && best.rank === 'S') {
      const w = this.c.h.players.get(best.pid);
      if (w) this.c.rumor(`Im Pink Static hat jemand „${SONG_BY_ID[s.song].title}“ auf ${s.diff === 'hard' ? 'Schwer' : s.diff === 'medium' ? 'Mittel' : 'Leicht'} mit Rang S getanzt. Angeblich ${w.name}.`);
    }
    this.c.finished({ mode: s.mode, side: s.side, questFor: s.questFor, results });
    this.broadcast(s);
  }

  private addInst(key: string, name: string, score: number) {
    const list = this.instBoard.get(key) ?? [];
    const old = list.find((e) => e[0] === name);
    if (old) old[1] = Math.max(old[1], score); else list.push([name, score]);
    list.sort((a, b) => b[1] - a[1]); list.length = Math.min(list.length, 10);
    this.instBoard.set(key, list);
  }

  view(s: Session): DanceSessionView {
    return {
      id: s.id, song: s.song, diff: s.diff, mode: s.mode, phase: s.phase, t0: s.t0, t: Math.max(0, Math.round(s.t * 10) / 10),
      dancers: s.dancers.map((d) => ({ pid: d.pid, name: d.name, tile: d.tile, score: d.score.score, combo: d.score.combo, hype: Math.round(d.score.hype), spot: d.score.spotlightUntil, rank: d.rank })),
      crew: s.mode === 'crew' ? s.crew : undefined, winner: s.winner, side: s.side,
    };
  }

  /** Session an alle im Club (Teilnehmer und Zuschauer). */
  private broadcast(s: Session) {
    const view = this.view(s);
    for (const p of this.c.clubPlayers()) this.c.h.send(p, { t: 'vgame', s: { g: 'dance', s: view } });
  }
  private broadcastClosed(s: Session) {
    const view = { ...this.view(s), phase: 'result' as const, t: -1 };
    for (const p of this.c.clubPlayers()) if (!this.byPlayer.has(p.id)) this.c.h.send(p, { t: 'vgame', s: { g: 'dance', s: view } });
  }

  /** Neu im Club: laufende Sessions schicken (Zuschauer). */
  syncTo(p: ServerPlayer) { for (const s of this.sessions) this.c.h.send(p, { t: 'vgame', s: { g: 'dance', s: this.view(s) } }); }

  onLeave(p: ServerPlayer) { if (this.byPlayer.has(p.id)) this.quit(p); if (this.dj?.pid === p.id) this.dj = null; }

  // ------------------------------------------------------------------ DJ-Pult (E57)
  startDj(p: ServerPlayer, song: string): string {
    if (this.dj) return 'Am Pult steht schon jemand.';
    this.dj = { pid: p.id, t0: Date.now() + 2000, ok: 0, miss: 0, song };
    this.c.setAct(p, Act.DJ, 0);
    this.c.h.send(p, { t: 'vgame', s: { g: 'dj', on: true, song, t0: this.dj.t0 } });
    return '';
  }
  djHits(p: ServerPlayer, ok: number, miss: number, done: boolean): boolean | null {
    const d = this.dj;
    if (!d || d.pid !== p.id) return null;
    const song = SONG_BY_ID[d.song];
    // Höchstens ein Treffer pro Schlag seit Start (+2 Toleranz)
    const beats = Math.max(0, ((Date.now() - d.t0) / 1000) * (song.bpm / 60)) + 2;
    d.ok = Math.min(Math.floor(beats), d.ok + Math.max(0, Math.floor(ok)));
    d.miss += Math.max(0, Math.floor(miss));
    if (!done && Date.now() - d.t0 < songSeconds(song) * 1000 * 0.5) return null;
    const ratio = d.ok / Math.max(1, d.ok + d.miss);
    this.dj = null;
    this.c.setAct(p, 0, 0);
    this.c.h.send(p, { t: 'vgame', s: { g: 'dj', on: false, song: d.song, t0: 0 } });
    return ratio >= 0.6 && d.ok >= 24;
  }
  private updateDj(now: number) {
    const d = this.dj;
    if (!d) return;
    const p = this.c.h.players.get(d.pid);
    if (!p || p.interior?.id !== 'club' || now - d.t0 > songSeconds(SONG_BY_ID[d.song]) * 1000 + 15000) this.dj = null;
  }
}
