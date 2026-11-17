// „Dance Floor Heat“ – Rhythmusspiel im DS-Stil: Pfeile (← ↓ ↑ →) und Sondersymbole laufen auf einer Leiste
// unten auf die Trefferzone zu. Bewertung lokal nach Audio-Uhr (Perfekt ±45 ms, Gut ±90 ms, Okay ±140 ms),
// Combo, Multiplikator, Hype-Meter → Spotlight. Halten (lange Note), Doppel (zwei Tasten), „Move“-Stern
// (Leertaste). Treffer gehen paketweise an den Server, der die Punkte nachrechnet und plausibilisiert.
// Dazu: Song-/Schwierigkeits-/Modus-Auswahl, Latenz-Kalibrierung (Klopf-Test) und das DJ-Pult (E57).
import {
  applyGrade, BEATMAPS, comboMult, DIFF_LABEL, DIFFICULTIES, gradeFor, GRADE_LABEL, LANE_ARROWS, maxScore, newScore, NoteKind, noteTime, rankFor,
  SONGS, SONG_BY_ID, songSeconds, WINDOWS_MS, type Difficulty, type Note, type ScoreState,
} from '../../../../shared/src/content/dance';
import { BALANCE } from '../../../../shared/src/balance';
import { DANCE_MODE_LABEL, type DanceMode, type DanceSessionView, type VenueAction } from '../../../../shared/src/venues/net';
import { P, type PadFrame } from '../../input/Gamepad';
import type { DanceTrack } from '../music';
import type { VenueUi } from './VenueUi';

const B = BALANCE.club;
const LANE_KEYS: Record<string, number> = { ArrowLeft: 0, KeyA: 0, ArrowDown: 1, KeyS: 1, ArrowUp: 2, KeyW: 2, ArrowRight: 3, KeyD: 3 };
const LANE_PAD = [P.LEFT, P.DOWN, P.UP, P.RIGHT];
const LANE_COL = ['#ff3fa4', '#3af2ff', '#7dff6a', '#ffd23a'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const OFFSET_KEY = 'sunstate.danceOffset';

export interface DanceHost {
  send(v: VenueAction): void;
  sound(id: string, vol?: number): void;
  /** Server-Zeit (ms) jetzt */
  serverNow(): number;
  audioNow(): number;
  track(): DanceTrack | null;
  /** Lokale Figur: Tanzschritt-Akzent / Stolpern */
  pulse(strength: number): void;
  myId(): number;
  /** Kachel unter dem Spieler (-1 = keine) */
  myTile(): number;
}

interface NoteState { judged: boolean; grade: number; holding: boolean; held: number; firstKey: number; firstT: number }

export class DanceUi {
  private phase: 'setup' | 'calib' | 'lobby' | 'play' | 'result' | 'dj' = 'setup';
  private song = SONGS[0].id;
  private diff: Difficulty = 'easy';
  private mode: DanceMode = 'solo';
  sess: DanceSessionView | null = null;
  private notes: Note[] = [];
  private st: NoteState[] = [];
  private score: ScoreState = newScore();
  private judge = { text: '', t: 0, col: '#fff' };
  private outbox: [number, number, number][] = [];
  private sendT = 0;
  private canvas: HTMLCanvasElement | null = null;
  private audioStart = 0;
  private started = false;
  private next = 0;
  private offset = 0;
  private calib: { clicks: number[]; taps: number[]; t0: number } | null = null;
  private dj: { t0: number; audio0: number; bpm: number; ok: number; miss: number; lastBeat: number; sent: number; flash: number } | null = null;
  private raf = 0;
  private keysDown = new Set<number>();
  private result: { rank: string; score: number; max: number } | null = null;

  constructor(private ui: VenueUi, private h: DanceHost) {
    try { this.offset = Number(localStorage.getItem(OFFSET_KEY) ?? 0) || 0; } catch { /* egal */ }
  }

  get active() { return this.phase === 'play' || this.phase === 'lobby' || this.phase === 'dj'; }

  /** F auf einer Kachel: Auswahl öffnen. */
  openSetup() { this.phase = 'setup'; this.ui.open('dance'); }

  /** Server-Stand einer Session (alle im Club bekommen sie). */
  session(s: DanceSessionView | null) {
    const mine = s?.dancers.some((d) => d.pid === this.h.myId());
    if (!s) { if (this.phase === 'play' || this.phase === 'lobby') this.stopSong(); this.sess = null; if (this.ui.mode === 'dance' && this.phase !== 'result' && this.phase !== 'setup') this.ui.close(false); return; }
    if (!mine) return;
    this.sess = s;
    if (s.phase === 'lobby' || s.phase === 'count') {
      if (this.phase !== 'lobby') { this.phase = 'lobby'; this.prepare(s); }
      if (s.phase === 'count' && !this.started) this.startSong(s);
      if (this.ui.mode !== 'dance') this.ui.open('dance');
    } else if (s.phase === 'play') {
      if (!this.started) { this.prepare(s); this.startSong(s); }
      this.phase = 'play';
      if (this.ui.mode !== 'dance') this.ui.open('dance');
    } else if (s.phase === 'result' && this.phase === 'play') {
      this.flush();
      const me = s.dancers.find((d) => d.pid === this.h.myId());
      const bm = BEATMAPS[s.song];
      this.result = { rank: me?.rank ?? rankFor(this.score.score, 1), score: me?.score ?? this.score.score, max: maxScore(bm, s.diff, B.spotlightSeconds, B.spotlightMult) };
      this.phase = 'result';
      this.stopSong();
      if (s.winner === this.h.myId()) this.h.sound('venue.fanfare');
    }
    this.ui.render();
  }

  private prepare(s: DanceSessionView) {
    this.song = s.song; this.diff = s.diff; this.mode = s.mode;
    this.notes = BEATMAPS[s.song][s.diff];
    this.st = this.notes.map(() => ({ judged: false, grade: -1, holding: false, held: 0, firstKey: -1, firstT: 0 }));
    this.score = newScore(); this.next = 0; this.outbox = []; this.started = false; this.result = null;
  }

  private startSong(s: DanceSessionView) {
    const tr = this.h.track();
    if (!tr) return;
    this.started = true;
    // Songzeit 0 = Server-t0 → in Audio-Zeit umrechnen
    this.audioStart = this.h.audioNow() + (s.t0 - this.h.serverNow()) / 1000;
    void tr.start(SONG_BY_ID[s.song], this.audioStart);
    cancelAnimationFrame(this.raf);
    const loop = () => { this.tick(); if (this.phase === 'play' || this.phase === 'lobby' || this.phase === 'dj') this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  private stopSong() { this.h.track()?.stop(); this.started = false; cancelAnimationFrame(this.raf); }

  /** Songzeit mit Latenzausgleich (s). */
  private songT() { return this.h.audioNow() - this.audioStart - this.offset / 1000; }

  // ------------------------------------------------------------------ Spiellogik
  private tick() {
    const t = this.songT();
    if (this.phase === 'dj') { this.tickDj(); this.draw(); return; }
    if (this.phase === 'play' || this.phase === 'lobby') {
      const bm = BEATMAPS[this.song];
      // Verpasste Noten
      for (let i = this.next; i < this.notes.length; i++) {
        const n = this.notes[i], s = this.st[i];
        const nt = noteTime(bm, n[0]);
        if (nt > t) break;
        if (s.judged) { if (i === this.next) this.next++; continue; }
        if ((t - nt) * 1000 > WINDOWS_MS[2]) this.grade(i, 3, 0);
      }
      // Halten: gehaltene Dauer mitzählen, Ende auswerten
      for (let i = Math.max(0, this.next - 8); i < Math.min(this.notes.length, this.next + 8); i++) {
        const s = this.st[i], n = this.notes[i];
        if (!s.holding) continue;
        const end = noteTime(bm, n[0] + n[3]);
        s.held = Math.max(0, Math.min(n[3], ((t - noteTime(bm, n[0])) * bm.bpm) / 60));
        if (!this.keysDown.has(n[1]) || t >= end) { s.holding = false; this.outbox.push([i, s.grade, Math.round(s.held * 4) / 4]); }
      }
      this.sendT -= 1 / 60;
      if (this.sendT <= 0) { this.sendT = 0.2; this.flush(); }
    }
    this.draw();
  }

  private flush() { if (this.outbox.length) { this.h.send({ a: 'dance', op: 'hits', h: this.outbox.splice(0) }); } }

  private grade(i: number, g: number, held: number) {
    const s = this.st[i];
    if (s.judged) return;
    s.judged = true; s.grade = g;
    const n = this.notes[i], bm = BEATMAPS[this.song];
    const r = applyGrade(this.score, n, g, noteTime(bm, n[0]), held, B.spotlightSeconds, B.spotlightMult);
    if (n[2] === NoteKind.HOLD && g < 3) { s.holding = true; s.held = 0; }
    else this.outbox.push([i, g, held]);
    this.judge = { text: n[2] === NoteKind.STAR && g < 3 ? '★ MOVE! ★' : GRADE_LABEL[g], t: 0.6, col: ['#ffd23a', '#7dff6a', '#3af2ff', '#ff6a6a'][g] };
    if (g < 3) this.h.pulse(g === 0 ? 1 : 0.7); else { this.h.pulse(-1); this.h.sound('venue.boo', 0.15); }
    if (r.spotlight) this.h.sound('venue.zap');
    while (this.next < this.notes.length && this.st[this.next].judged) this.next++;
  }

  /** Tastendruck in Spur lane (4 = Leertaste/Stern). */
  private press(lane: number) {
    if (this.phase === 'dj') { this.djTap(); return; }
    if (this.phase === 'calib') { this.calibTap(); return; }
    if (this.phase !== 'play') return;
    if (lane < 4) this.keysDown.add(lane);
    const t = this.songT(), bm = BEATMAPS[this.song];
    const win = WINDOWS_MS[2] / 1000;
    for (let i = this.next; i < this.notes.length; i++) {
      const n = this.notes[i], s = this.st[i];
      const nt = noteTime(bm, n[0]);
      if (nt - t > win) break;
      if (s.judged) continue;
      const d = (t - nt) * 1000;
      if (Math.abs(d) > WINDOWS_MS[2]) continue;
      if (n[2] === NoteKind.STAR) { if (lane === 4) { this.grade(i, gradeFor(d), 0); return; } continue; }
      if (n[2] === NoteKind.DOUBLE) {
        if (lane !== n[1] && lane !== n[3]) continue;
        if (s.firstKey < 0) { s.firstKey = lane; s.firstT = d; return; }
        if (s.firstKey !== lane) { this.grade(i, gradeFor(Math.max(Math.abs(d), Math.abs(s.firstT))), 0); return; }
        continue;
      }
      if (n[1] === lane) { this.grade(i, gradeFor(d), 0); return; }
    }
  }
  private release(lane: number) { this.keysDown.delete(lane); }

  // ------------------------------------------------------------------ Kalibrierung (Klopf-Test)
  private startCalib() {
    const tr = this.h.track();
    if (!tr) return;
    this.phase = 'calib';
    const t0 = this.h.audioNow() + 0.8, spb = 60 / 100;
    const clicks = Array.from({ length: 10 }, (_, i) => t0 + i * spb);
    clicks.forEach((c, i) => tr.click(c, i % 4 === 0));
    this.calib = { clicks, taps: [], t0 };
    this.ui.render();
    cancelAnimationFrame(this.raf);
    const loop = () => { this.ui.render(); if (this.phase === 'calib') this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  private calibTap() {
    const c = this.calib; if (!c) return;
    const t = this.h.audioNow();
    const nearest = c.clicks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
    if (Math.abs(nearest - t) < 0.35) c.taps.push((t - nearest) * 1000);
    if (c.taps.length >= 8 || t > c.clicks[c.clicks.length - 1] + 0.6) {
      const sorted = [...c.taps].sort((a, b) => a - b);
      const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      this.offset = Math.round(Math.max(-250, Math.min(250, med)));
      try { localStorage.setItem(OFFSET_KEY, String(this.offset)); } catch { /* egal */ }
      this.phase = 'setup'; this.calib = null; this.ui.render();
    }
  }

  // ------------------------------------------------------------------ DJ-Pult (E57)
  startDj(songId: string, t0: number) {
    const song = SONG_BY_ID[songId], tr = this.h.track();
    if (!song || !tr) return;
    this.phase = 'dj';
    const audio0 = this.h.audioNow() + (t0 - this.h.serverNow()) / 1000;
    void tr.start(song, audio0);
    this.audioStart = audio0;
    this.dj = { t0, audio0, bpm: song.bpm, ok: 0, miss: 0, lastBeat: -1, sent: 0, flash: 0 };
    this.ui.open('dj');
    cancelAnimationFrame(this.raf);
    const loop = () => { this.tick(); if (this.phase === 'dj') this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stopDj() { if (this.phase === 'dj') { this.phase = 'setup'; this.dj = null; this.stopSong(); if (this.ui.mode === 'dj') this.ui.close(false); } }
  private djBeat() { const d = this.dj!; return ((this.songT() - 4 * 60 / d.bpm) * d.bpm) / 60; }
  private djTap() {
    const d = this.dj; if (!d) return;
    const b = this.djBeat(), near = Math.round(b);
    const ms = Math.abs(b - near) * (60 / d.bpm) * 1000;
    if (near > d.lastBeat && ms < 120 && near >= 0) { d.ok++; d.lastBeat = near; d.flash = 1; this.h.sound('venue.zap', 0.5); this.judge = { text: ms < 60 ? 'DROP!' : 'Nice!', t: 0.4, col: '#ffd23a' }; }
    else { d.miss++; this.judge = { text: 'Daneben', t: 0.4, col: '#ff6a6a' }; }
  }
  private tickDj() {
    const d = this.dj!;
    d.flash = Math.max(0, d.flash - 1 / 30);
    const beats = this.djBeat();
    if (beats > 48 || this.songT() > songSeconds(SONG_BY_ID[this.song] ?? SONGS[0])) {
      this.h.send({ a: 'dj', ok: d.ok - d.sent, miss: d.miss, done: true });
      this.stopDj();
      return;
    }
    if (Math.floor(beats) % 8 === 7 && d.ok > d.sent) { this.h.send({ a: 'dj', ok: d.ok - d.sent, miss: 0 }); d.sent = d.ok; d.miss = 0; }
  }

  // ------------------------------------------------------------------ Darstellung
  render() {
    const s = this.sess;
    if (this.phase === 'setup') {
      const tile = this.h.myTile();
      const songs = SONGS.map((x) => `<div class="item ${x.id === this.song ? 'sel' : ''}" data-song="${x.id}"><b>${esc(x.title)}</b><br><span class="muted">${esc(x.artist)} · ${x.genre} · ${x.bpm} BPM · ${Math.round(songSeconds(x))} s</span></div>`).join('');
      this.ui.frame('<b>Dance Floor Heat</b><span class="muted">Pink Static · Kachel ' + (tile >= 0 ? tile + 1 : '–') + '</span><span class="sp"></span>',
        `<div class="list">${songs}</div>
         <div class="row">Schwierigkeit: ${DIFFICULTIES.map((d) => `<button data-diff="${d}" class="${d === this.diff ? 'sel' : 'dim'}">${DIFF_LABEL[d]}</button>`).join('')}</div>
         <div class="row">Modus: ${(['solo', 'battle', 'crew'] as DanceMode[]).map((m) => `<button data-mode="${m}" class="${m === this.mode ? 'sel' : 'dim'}">${DANCE_MODE_LABEL[m]}</button>`).join('')}
           <span class="muted">${this.mode === 'battle' ? 'Mitspieler auf Nachbarkacheln drücken F zum Beitreten (2–4).' : this.mode === 'crew' ? 'Gruppen-Combo steigt nur, wenn alle treffen.' : ''}</span></div>
         <div class="row muted">Steuerung: ← ↓ ↑ → oder WASD (Gamepad: Steuerkreuz) · ★ = Leertaste (Gamepad: A) · Halten = Taste gedrückt lassen · Doppel = zwei Tasten gleichzeitig · Latenz-Ausgleich: ${this.offset} ms</div>`,
        `<button data-dance="go" ${tile < 0 ? 'disabled' : ''}>Los!</button><button class="alt" data-dance="calib">Latenz kalibrieren</button><span class="sp"></span><button class="pink" data-dance="close">Aufhören</button>`);
      return;
    }
    if (this.phase === 'calib') {
      const c = this.calib!;
      this.ui.frame('<b>Kalibrierung</b>', `<div class="say">Drück die Leertaste (Gamepad: A) genau auf jeden Klick. ${c.taps.length}/8</div><div class="muted">Gemessen wird der Versatz zwischen Ton und deinem Tastendruck – er wird bei allen Songs ausgeglichen.</div>`, '<button class="pink" data-dance="calibstop">Abbrechen</button>');
      return;
    }
    if (this.phase === 'result' && this.result) {
      const r = this.result, me = s?.dancers.find((d) => d.pid === this.h.myId());
      const others = s ? s.dancers.filter((d) => d.pid !== this.h.myId()).map((d) => `${esc(d.name)}: ${d.score.toLocaleString('de-DE')} (${d.rank ?? '–'})`).join(' · ') : '';
      this.ui.frame(`<b>Ergebnis · ${esc(SONG_BY_ID[this.song].title)}</b><span class="muted">${DIFF_LABEL[this.diff]} · ${DANCE_MODE_LABEL[this.mode]}</span>`,
        `<div class="v-rank">${r.rank}</div><div class="row" style="justify-content:center"><b>${r.score.toLocaleString('de-DE')}</b> / ${r.max.toLocaleString('de-DE')} Punkte · Max-Combo ${this.score.maxCombo} · ${this.score.counts.map((n, i) => `${GRADE_LABEL[i]} ${n}`).join(' · ')}</div>
         ${s?.winner !== undefined ? `<div class="row" style="justify-content:center">${s.winner === this.h.myId() ? '🏆 Du gewinnst das Battle!' : `🏆 Sieger: ${esc(s.dancers.find((d) => d.pid === s.winner)?.name ?? '?')}`}</div>` : ''}
         ${others ? `<div class="row muted">${others}</div>` : ''}${me && s?.crew !== undefined ? `<div class="row muted">Crew-Combo: ${s.crew}</div>` : ''}`,
        '<button data-dance="again">Nochmal</button><span class="sp"></span><button class="pink" data-dance="close">Aufhören</button>');
      return;
    }
    if (this.phase === 'lobby' && s && s.phase === 'lobby') {
      const host = s.dancers[0]?.pid === this.h.myId();
      this.ui.frame(`<b>${DANCE_MODE_LABEL[s.mode]}</b><span class="muted">${esc(SONG_BY_ID[s.song].title)} · ${DIFF_LABEL[s.diff]}</span>`,
        `<div class="say">Warte auf Mitspieler auf den Nachbarkacheln (F) … ${Math.ceil(s.t)} s</div><div class="row">${s.dancers.map((d) => `<span class="chips">${esc(d.name)}</span>`).join('')}</div>`,
        `${host ? '<button data-dance="start">Jetzt starten</button>' : ''}<span class="sp"></span><button class="pink" data-dance="close">Aussteigen</button>`);
      this.canvas = null;
      return;
    }
    // Spiel / Countdown / DJ: Leiste als Canvas
    if (!this.canvas || !this.ui.bodyEl.contains(this.canvas)) {
      const head = this.phase === 'dj' ? '<b>DJ-Pult · Party retten!</b><span class="muted">Leertaste/Pfeile im Takt (Gamepad: A)</span>' : `<b>${esc(SONG_BY_ID[this.song].title)}</b><span class="muted">${DIFF_LABEL[this.diff]} · ${DANCE_MODE_LABEL[this.mode]}</span>`;
      this.ui.frame(`${head}<span class="sp"></span>`, '<canvas class="lane" width="740" height="220"></canvas>', '<span class="muted">Esc / B: aufhören</span><span class="sp"></span><button class="pink" data-dance="close">Aufhören</button>');
      this.canvas = this.ui.bodyEl.querySelector('canvas');
    }
    this.draw();
  }

  private draw() {
    const cv = this.canvas;
    if (!cv || (this.phase !== 'play' && this.phase !== 'lobby' && this.phase !== 'dj')) return;
    const g = cv.getContext('2d')!;
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const t = this.songT();
    const hitX = 70, laneY = (l: number) => 34 + l * 34, speed = this.diff === 'hard' ? 330 : this.diff === 'medium' ? 270 : 220; // px/s
    this.judge.t = Math.max(0, this.judge.t - 1 / 60);
    if (this.phase === 'dj') {
      const d = this.dj!;
      const b = this.djBeat();
      g.fillStyle = `rgba(255,63,164,${0.15 + d.flash * 0.6})`; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffd23a'; g.lineWidth = 4; g.beginPath(); g.arc(hitX, 100, 26, 0, Math.PI * 2); g.stroke();
      for (let k = Math.ceil(b); k < b + 6; k++) { const x = hitX + (k - b) * 110; g.fillStyle = k % 4 === 0 ? '#ff3fa4' : '#3af2ff'; g.beginPath(); g.arc(x, 100, 18, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#fff'; g.font = 'bold 18px Trebuchet MS'; g.fillText(`Treffer ${d.ok} · Daneben ${d.miss}`, 20, 190);
    } else {
      const bm = BEATMAPS[this.song];
      // Spuren + Trefferzone
      for (let l = 0; l < 4; l++) {
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, laneY(l) - 14, W, 28);
        g.strokeStyle = this.keysDown.has(l) ? '#fff' : LANE_COL[l]; g.lineWidth = 3;
        g.strokeRect(hitX - 16, laneY(l) - 14, 32, 28);
        g.fillStyle = LANE_COL[l]; g.font = 'bold 20px Trebuchet MS'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(LANE_ARROWS[l], hitX, laneY(l) + 1);
      }
      for (let i = Math.max(0, this.next - 4); i < this.notes.length; i++) {
        const n = this.notes[i], s = this.st[i];
        const x = hitX + (noteTime(bm, n[0]) - t) * speed;
        if (x > W + 40) break;
        if (s.judged && !s.holding && x < hitX) continue;
        const draw = (lane: number) => {
          if (n[2] === NoteKind.HOLD) { const x2 = hitX + (noteTime(bm, n[0] + n[3]) - t) * speed; g.fillStyle = LANE_COL[lane] + '88'; g.fillRect(Math.max(hitX, x), laneY(lane) - 7, Math.max(0, x2 - Math.max(hitX, x)), 14); }
          g.fillStyle = s.judged && !s.holding ? '#555' : LANE_COL[lane]; g.beginPath(); g.roundRect(x - 15, laneY(lane) - 13, 30, 26, 7); g.fill();
          g.fillStyle = '#1a1030'; g.font = 'bold 20px Trebuchet MS'; g.fillText(LANE_ARROWS[lane], x, laneY(lane) + 1);
        };
        if (n[2] === NoteKind.STAR) { g.fillStyle = '#ffd23a'; g.font = '900 34px Trebuchet MS'; g.fillText('★', x, 85); continue; }
        draw(n[1]);
        if (n[2] === NoteKind.DOUBLE) { draw(n[3]); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, laneY(n[1])); g.lineTo(x, laneY(n[3])); g.stroke(); }
      }
      // Countdown
      if (t < 0) { g.fillStyle = '#ffd23a'; g.font = '900 60px Trebuchet MS'; g.fillText(String(Math.ceil(-t)), W / 2, 90); }
      // Anzeige: Punkte, Combo, Multiplikator, Hype, Spotlight, Gegner
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = 'bold 16px Trebuchet MS';
      g.fillText(`${this.score.score.toLocaleString('de-DE')} Punkte · Combo ${this.score.combo} · x${comboMult(this.score.combo)}`, 12, 182);
      const spot = t < this.score.spotlightUntil;
      g.fillStyle = '#2a1840'; g.fillRect(12, 192, 300, 12);
      g.fillStyle = spot ? '#fff4c0' : '#ff3fa4'; g.fillRect(12, 192, spot ? 300 * ((this.score.spotlightUntil - t) / B.spotlightSeconds) : 3 * this.score.hype, 12);
      g.fillStyle = '#ffd23a'; g.fillText(spot ? '★ SPOTLIGHT x2 ★' : 'HYPE', 318, 203);
      const s = this.sess;
      if (s && s.dancers.length > 1) {
        g.textAlign = 'right';
        s.dancers.forEach((d, k) => { g.fillStyle = d.pid === this.h.myId() ? '#ffd23a' : '#ddd'; g.fillText(`${d.name}: ${d.score.toLocaleString('de-DE')}`, W - 12, 182 + k * 0 - (s.dancers.length - 1 - k) * 18); });
        if (s.crew !== undefined) { g.fillStyle = '#7dff6a'; g.fillText(`Crew-Combo ${s.crew}`, W - 12, 210); }
      }
    }
    if (this.judge.t > 0) { g.textAlign = 'center'; g.fillStyle = this.judge.col; g.font = `900 ${26 + this.judge.t * 10}px Trebuchet MS`; g.fillText(this.judge.text, W / 2, 26); }
  }

  // ------------------------------------------------------------------ Eingaben
  onClick(t: HTMLElement) {
    const d = t.dataset;
    if (d.song) { this.song = d.song; this.ui.render(); return true; }
    if (d.diff) { this.diff = d.diff as Difficulty; this.ui.render(); return true; }
    if (d.mode) { this.mode = d.mode as DanceMode; this.ui.render(); return true; }
    switch (d.dance) {
      case 'go': this.h.send({ a: 'dance', op: 'setup', song: this.song, diff: this.diff, mode: this.mode }); return true;
      case 'calib': this.startCalib(); return true;
      case 'calibstop': this.phase = 'setup'; this.calib = null; this.ui.render(); return true;
      case 'start': this.h.send({ a: 'dance', op: 'go' }); return true;
      case 'again': this.phase = 'setup'; this.ui.render(); return true;
      case 'close': this.ui.close(); return true;
    }
    return false;
  }

  key(e: KeyboardEvent): boolean {
    const lane = e.code === 'Space' ? 4 : LANE_KEYS[e.code];
    if (e.code === 'Escape') { this.ui.close(); return true; }
    if (lane === undefined) return false;
    if (this.phase === 'setup' || this.phase === 'result') {
      if (e.code === 'Space' && e.type === 'keydown') this.onClick(this.phase === 'setup' ? Object.assign(document.createElement('b'), { dataset: { dance: 'go' } }) : Object.assign(document.createElement('b'), { dataset: { dance: 'again' } }));
      return true;
    }
    if (e.type === 'keydown' && !e.repeat) this.press(lane);
    return true;
  }
  keyUp(e: KeyboardEvent) { const lane = LANE_KEYS[e.code]; if (lane !== undefined) this.release(lane); }

  pad(f: PadFrame): boolean {
    if (this.phase === 'play' || this.phase === 'dj' || this.phase === 'calib') {
      LANE_PAD.forEach((b, l) => { if (f.pressed(b)) this.press(l); if (f.released(b)) this.release(l); });
      if (f.pressed(P.A) || f.pressed(P.X)) this.press(4);
      if (f.pressed(P.B)) { this.ui.close(); f.swallow(); }
      return true;
    }
    return false; // Auswahl: normale Overlay-Navigation
  }

  close() {
    if (this.phase === 'play' || this.phase === 'lobby') { this.flush(); this.h.send({ a: 'dance', op: 'quit' }); this.stopSong(); }
    if (this.phase === 'dj' && this.dj) { this.h.send({ a: 'dj', ok: this.dj.ok - this.dj.sent, miss: this.dj.miss, done: true }); this.stopDj(); }
    this.phase = 'setup'; this.sess = null; this.canvas = null;
    cancelAnimationFrame(this.raf);
  }
}
