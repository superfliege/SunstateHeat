// Beatmaps, Bewertung und Punkte für „Dance Floor Heat“ (Client spielt und bewertet lokal, der Server
// rechnet die Punkte aus den gemeldeten Bewertungen nach und plausibilisiert sie – siehe server/venues).
//
// Beatmap-Datei: shared/src/content/dance/<song>.json = { song, bpm, offset, easy, medium, hard }
// Note = [Beat, Spur, Art, Extra]:
//   Spur 0–3 = ← ↓ ↑ →, Art 0 = Tippen, 1 = Halten (Extra = Länge in Beats), 2 = Doppel (Extra = zweite Spur),
//   3 = „Move“-Stern (Leertaste, Spur egal)
import { songBeats, songEvents, songOffset, type SongDef } from './songs';

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
export type Note = [beat: number, lane: number, kind: number, extra: number];
export const NoteKind = { TAP: 0, HOLD: 1, DOUBLE: 2, STAR: 3 } as const;
export const LANE_ARROWS = ['←', '↓', '↑', '→'];

export interface BeatmapFile { song: string; bpm: number; offset: number; easy: Note[]; medium: Note[]; hard: Note[] }

/** Bewertung: 0 Perfekt, 1 Gut, 2 Okay, 3 Daneben. Fenster in ms (±). */
export const Grade = { PERFECT: 0, GOOD: 1, OKAY: 2, MISS: 3 } as const;
export const GRADE_LABEL = ['PERFEKT', 'GUT', 'OKAY', 'DANEBEN'];
export const WINDOWS_MS = [45, 90, 140];
export function gradeFor(deltaMs: number): number {
  const d = Math.abs(deltaMs);
  return d <= WINDOWS_MS[0] ? 0 : d <= WINDOWS_MS[1] ? 1 : d <= WINDOWS_MS[2] ? 2 : 3;
}

export const BASE_POINTS = [300, 200, 100, 0];
export const STAR_POINTS = 500;
export const HOLD_POINTS_PER_BEAT = 60;
export const HYPE_GAIN = [5, 3.5, 1.5, -8];
export const HYPE_STAR = 15;
/** Multiplikator aus der Combo: 1x, ab 10 → 2x, ab 25 → 3x, ab 50 → 4x. */
export const comboMult = (combo: number) => (combo >= 50 ? 4 : combo >= 25 ? 3 : combo >= 10 ? 2 : 1);

/** Laufender Punktestand – derselbe Code auf Client und Server. */
export interface ScoreState { score: number; combo: number; maxCombo: number; hype: number; spotlightUntil: number; counts: number[]; spotlights: number }
export const newScore = (): ScoreState => ({ score: 0, combo: 0, maxCombo: 0, hype: 0, spotlightUntil: -1, counts: [0, 0, 0, 0], spotlights: 0 });

/**
 * Eine bewertete Note einrechnen. t = Songzeit (s) der Note, held = gehaltene Beats (nur Halten).
 * Rückgabe: Punkte dieser Note und ob gerade ein Spotlight ausgelöst wurde.
 */
export function applyGrade(s: ScoreState, note: Note, grade: number, t: number, held: number, spotlightSec: number, spotlightMult: number): { pts: number; spotlight: boolean } {
  s.counts[grade]++;
  if (grade === Grade.MISS) { s.combo = 0; s.hype = Math.max(0, s.hype + HYPE_GAIN[3]); return { pts: 0, spotlight: false }; }
  s.combo++;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  let base = note[2] === NoteKind.STAR ? STAR_POINTS * (grade === 0 ? 1 : grade === 1 ? 0.7 : 0.4) : BASE_POINTS[grade];
  if (note[2] === NoteKind.DOUBLE) base *= 1.5;
  if (note[2] === NoteKind.HOLD) base += HOLD_POINTS_PER_BEAT * Math.max(0, Math.min(note[3], held));
  const inSpot = t < s.spotlightUntil;
  const pts = Math.round(base * comboMult(s.combo) * (inSpot ? spotlightMult : 1));
  s.score += pts;
  let spotlight = false;
  if (!inSpot) {
    s.hype = Math.min(100, s.hype + HYPE_GAIN[grade] + (note[2] === NoteKind.STAR ? HYPE_STAR : 0));
    if (s.hype >= 100) { s.hype = 0; s.spotlightUntil = t + spotlightSec; s.spotlights++; spotlight = true; }
  }
  return { pts, spotlight };
}

export const noteTime = (bm: { bpm: number; offset: number }, beat: number) => bm.offset + (beat * 60) / bm.bpm;

/** Höchstpunktzahl (alles Perfekt, Halten voll) – Grundlage für Rang und Plausibilisierung. */
export function maxScore(bm: BeatmapFile, diff: Difficulty, spotlightSec: number, spotlightMult: number): number {
  const s = newScore();
  for (const n of bm[diff]) applyGrade(s, n, 0, noteTime(bm, n[0]), n[2] === NoteKind.HOLD ? n[3] : 0, spotlightSec, spotlightMult);
  return s.score;
}

export type DanceRank = 'S' | 'A' | 'B' | 'C' | 'D';
export function rankFor(score: number, max: number): DanceRank {
  const r = max > 0 ? score / max : 0;
  return r >= 0.9 ? 'S' : r >= 0.75 ? 'A' : r >= 0.6 ? 'B' : r >= 0.4 ? 'C' : 'D';
}

// ------------------------------------------------------------------ Entwurf aus Onsets (Hilfsskript + Songs)
/** Onset: Zeit in Beats (ab erstem Schlag), Stärke 0–1, optional Länge (Beats) und Tonhöhe (für die Spurwahl). */
export interface Onset { beat: number; strength: number; len?: number; pitch?: number }

const DIFF_CFG: Record<Difficulty, { grid: number; minGap: number; thresh: number; holds: boolean; doubles: boolean; maxPerBeat: number }> = {
  easy: { grid: 1, minGap: 2, thresh: 0.6, holds: false, doubles: false, maxPerBeat: 1 },
  medium: { grid: 0.5, minGap: 0.5, thresh: 0.7, holds: true, doubles: true, maxPerBeat: 2 },
  hard: { grid: 0.25, minGap: 0.25, thresh: 0.33, holds: true, doubles: true, maxPerBeat: 4 },
};

/**
 * Beatmap-Entwurf aus Onsets: quantisieren, nach Schwierigkeit ausdünnen, Spuren über die Tonhöhe
 * (bzw. ein festes Muster) verteilen, lange Töne als Halten, starke Akzente als Doppel, Sterne am
 * Phrasenende (alle 8 Takte). Deterministisch – zum Nachbearbeiten von Hand gedacht.
 */
export function draftBeatmap(onsets: Onset[], totalBeats: number, diff: Difficulty): Note[] {
  const cfg = DIFF_CFG[diff];
  const slots = new Map<number, Onset>();
  for (const o of onsets) {
    if (o.beat < 0 || o.beat >= totalBeats - 0.5) continue;
    const q = Math.round(o.beat / cfg.grid) * cfg.grid;
    const prev = slots.get(q);
    if (!prev || o.strength > prev.strength) slots.set(q, { ...o, beat: q, len: Math.max(o.len ?? 0, prev?.len ?? 0) || o.len });
  }
  // Leichter Modus: jede Zählzeit mit irgendeinem Onset ist Kandidat, auf schwachen Stellen wird ausgedünnt
  const beats = [...slots.keys()].sort((a, b) => a - b);
  const notes: Note[] = [];
  let last = -99, lastLane = 1, lastPitch = 0;
  const PATTERN = [1, 2, 0, 3, 2, 1, 3, 0];
  let k = 0;
  for (const b of beats) {
    const o = slots.get(b)!;
    const onBeat = Math.abs(b - Math.round(b)) < 1e-6;
    const str = o.strength + (onBeat ? 0.15 : 0) + (b % 4 === 0 ? 0.1 : 0);
    if (str < cfg.thresh) continue;
    if (b - last < cfg.minGap - 1e-6) continue;
    // Phrasenende (letzter Schlag vor jedem 8. Takt): Stern
    const phraseEnd = (b + 1) % 32 === 0;
    let lane: number;
    if (o.pitch !== undefined) {
      const d = Math.sign(o.pitch - lastPitch);
      lane = d > 0 ? (lastLane + 1) % 4 : d < 0 ? (lastLane + 3) % 4 : PATTERN[k % PATTERN.length];
      lastPitch = o.pitch;
    } else lane = PATTERN[k % PATTERN.length];
    if (lane === lastLane && diff !== 'hard') lane = (lane + 2) % 4;
    k++;
    if (phraseEnd && diff !== 'easy' || (diff === 'easy' && (b + 1) % 64 === 0)) notes.push([b, 0, NoteKind.STAR, 0]);
    else if (cfg.holds && (o.len ?? 0) >= 1 && o.pitch !== undefined) notes.push([b, lane, NoteKind.HOLD, Math.min(4, Math.floor(o.len!))]);
    else if (cfg.doubles && b % 8 === 0 && str >= 1) notes.push([b, lane, NoteKind.DOUBLE, (lane + 2) % 4]);
    else notes.push([b, lane, NoteKind.TAP, 0]);
    lastLane = lane;
    // Halten: in der Zeit keine weiteren Noten
    const n = notes[notes.length - 1];
    last = n[2] === NoteKind.HOLD ? b + n[3] : b;
  }
  return notes;
}

/** Onsets direkt aus den Song-Daten (symbolische Onset-Erkennung). */
export function songOnsets(s: SongDef): Onset[] {
  const out: Onset[] = [];
  for (const e of songEvents(s)) {
    if (e.voice === 'pad') continue;
    const strength = e.voice === 'kick' ? 0.75 : e.voice === 'snare' || e.voice === 'clap' ? 0.7 : e.voice === 'lead' ? 0.8 : e.voice === 'bass' ? 0.5 : 0.25;
    out.push({ beat: e.beat, strength: strength * (0.6 + 0.4 * e.vel) + (e.voice === 'kick' && e.beat % 8 === 0 ? 0.4 : 0), len: e.voice === 'lead' ? e.len : undefined, pitch: e.voice === 'lead' ? e.midi : undefined });
  }
  return out;
}

export function draftForSong(s: SongDef): BeatmapFile {
  const on = songOnsets(s), total = songBeats(s);
  return { song: s.id, bpm: s.bpm, offset: Math.round(songOffset(s) * 1000) / 1000, easy: draftBeatmap(on, total, 'easy'), medium: draftBeatmap(on, total, 'medium'), hard: draftBeatmap(on, total, 'hard') };
}

/** Beatmap prüfen (Inhaltstest). */
export function validateBeatmap(bm: BeatmapFile, totalBeats: number): string[] {
  const err: string[] = [];
  for (const d of DIFFICULTIES) {
    const list = bm[d];
    if (!Array.isArray(list) || list.length < 20) { err.push(`${bm.song}/${d}: zu wenige Noten`); continue; }
    let prev = -1;
    for (const n of list) {
      if (n.length !== 4) err.push(`${bm.song}/${d}: Note ${JSON.stringify(n)} hat nicht 4 Werte`);
      if (n[0] < prev) err.push(`${bm.song}/${d}: Noten nicht sortiert bei Beat ${n[0]}`);
      if (n[0] < 0 || n[0] > totalBeats) err.push(`${bm.song}/${d}: Beat ${n[0]} außerhalb des Songs`);
      if (n[1] < 0 || n[1] > 3) err.push(`${bm.song}/${d}: Spur ${n[1]} ungültig`);
      if (n[2] < 0 || n[2] > 3) err.push(`${bm.song}/${d}: Art ${n[2]} ungültig`);
      prev = n[0];
    }
  }
  if (bm.easy.length >= bm.medium.length || bm.medium.length >= bm.hard.length) err.push(`${bm.song}: Schwierigkeitsstufen nicht aufsteigend dicht`);
  return err;
}
