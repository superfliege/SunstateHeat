// Dance Floor Heat: Songs + Beatmaps (Daten-Dateien je Song, siehe scripts/dance-beatmap.ts).
import type { BeatmapFile, Note } from './beatmap';
import { SONGS, SONG_BY_ID } from './songs';
import neon_nights from './neon_nights.json';
import static_shock from './static_shock.json';
import mango_tango from './mango_tango.json';
import glitter_ball from './glitter_ball.json';
import palm_cypher from './palm_cypher.json';
import ocean_house from './ocean_house.json';

export * from './beatmap';
export * from './songs';

const asMap = (j: { song: string; bpm: number; offset: number; easy: number[][]; medium: number[][]; hard: number[][] }): BeatmapFile =>
  ({ song: j.song, bpm: j.bpm, offset: j.offset, easy: j.easy as Note[], medium: j.medium as Note[], hard: j.hard as Note[] });

export const BEATMAPS: Record<string, BeatmapFile> = Object.fromEntries(
  [neon_nights, static_shock, mango_tango, glitter_ball, palm_cypher, ocean_house].map((j) => [j.song, asMap(j)]),
);

/** Freischaltbare Tanzstile (offene Welt: /tanz <stil>, Taste G). Erster Stil ist immer frei. */
export interface DanceStyle { id: string; name: string; act: string; unlock: string }
export const DANCE_STYLES: DanceStyle[] = [
  { id: 'wippen', name: 'Wippen', act: 'Dance', unlock: 'immer frei' },
  { id: 'roboter', name: 'Roboter', act: 'Dance2', unlock: 'Rang B in einem beliebigen Song' },
  { id: 'shuffle', name: 'Ocean-Shuffle', act: 'Dance3', unlock: 'Rang A auf Mittel' },
  { id: 'disco', name: 'Disco-Finger', act: 'Dance4', unlock: '50er-Combo' },
  { id: 'kreisel', name: 'Flamingo-Kreisel', act: 'Dance5', unlock: 'Dance-Battle gewinnen' },
  { id: 'pose', name: 'Spotlight-Pose', act: 'Pose', unlock: '3 Spotlights in einem Song' },
];
export const STYLE_BY_ID: Record<string, DanceStyle> = Object.fromEntries(DANCE_STYLES.map((s) => [s.id, s]));

export { SONGS, SONG_BY_ID };
