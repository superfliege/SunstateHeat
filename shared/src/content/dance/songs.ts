// Songs für „Dance Floor Heat“ und die Club-Beschallung. Wie das Radio (audio/procedural.ts) werden die
// Tracks prozedural aus diesen Daten erzeugt (selbst erstellt, keine Fremdmusik) – dadurch sitzen Beat und
// Beatmap exakt aufeinander. Echte Aufnahmen können später ergänzt werden: scripts/dance-beatmap.ts erzeugt
// aus einer Audiodatei (BPM + Onset-Erkennung) einen Beatmap-Entwurf.
//
// Notation (Schritte = 16tel):
//   Drums: 16 Zeichen je Takt, 'x' = Schlag, 'o' = leiser Schlag, '.' = Pause
//   Bass:  16 Zeichen je Takt, Ziffer/Buchstabe = Tonleiterstufe (0–9, a–e = 10–14), '-' = halten, '.' = Pause
//   Lead:  32 Zeichen je Phrase (2 Takte), gleiche Notation; Akkorde: Stufe je Takt (wiederholt)

export type Wave = 'saw' | 'square' | 'tri' | 'sine' | 'pluck';
export type Genre = 'Synthwave' | 'Elektro' | 'Latin-Elektro' | 'Disco' | 'Hip-Hop' | 'House';

export interface SectionDef {
  name: string;
  bars: number;
  drums: 'full' | 'half' | 'none';
  bass: boolean;
  lead: boolean;
  pad: boolean;
}

export interface SongDef {
  id: string;
  title: string;
  artist: string;
  genre: Genre;
  bpm: number;
  /** Grundton (MIDI) und Tonleiter (Halbtonschritte) */
  root: number;
  scale: number[];
  /** 0 … 0.33: Swing der Achtel/16tel */
  swing: number;
  kick: string; snare: string; hat: string; clap: string; perc: string;
  /** Bass-Takte (werden zyklisch wiederholt) */
  bass: string[];
  /** Lead-Phrasen (je 2 Takte, zyklisch) */
  lead: string[];
  /** Akkordstufen je Takt (zyklisch) */
  chords: number[];
  leadWave: Wave;
  padWave: Wave;
  bassWave: Wave;
  sections: SectionDef[];
  /** Farbe für Licht und UI */
  color: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXO = [0, 2, 4, 5, 7, 9, 10];

/** Standard-Aufbau (32 Takte): Intro, Strophe, Refrain, Break, Refrain. */
const STD: SectionDef[] = [
  { name: 'Intro', bars: 4, drums: 'half', bass: false, lead: false, pad: true },
  { name: 'Strophe', bars: 8, drums: 'full', bass: true, lead: false, pad: true },
  { name: 'Refrain', bars: 8, drums: 'full', bass: true, lead: true, pad: true },
  { name: 'Break', bars: 4, drums: 'none', bass: false, lead: true, pad: true },
  { name: 'Finale', bars: 8, drums: 'full', bass: true, lead: true, pad: true },
];

export const SONGS: SongDef[] = [
  {
    id: 'neon_nights', title: 'Neon Nights on Ocean Strip', artist: 'DJ Static Vee', genre: 'Synthwave', bpm: 100,
    root: 45, scale: MINOR, swing: 0,
    kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', clap: '................', perc: '..............o.',
    bass: ['0.0.0.0.0.0.0.0.', '5.5.5.5.5.5.5.5.', '3.3.3.3.3.3.3.3.', '4.4.4.4.6.6.6.6.'],
    lead: ['7---9---a---9-7-4-------2---4---', '7---9---a---c---a---9---7-------'],
    chords: [0, 5, 3, 4], leadWave: 'saw', padWave: 'saw', bassWave: 'saw', sections: STD, color: 0xff3fa4,
  },
  {
    id: 'static_shock', title: 'Static Shock', artist: 'Kilowatt Kid', genre: 'Elektro', bpm: 128,
    root: 41, scale: MINOR, swing: 0,
    kick: 'x...x...x...x...', snare: '................', hat: '..x...x...x...x.', clap: '....x.......x...', perc: 'o..o..o...o..o..',
    bass: ['0..0..0.0..0.3.2', '0..0..0.0..0.5.4'],
    lead: ['7.7.7.a.9.7.....7.7.7.c.a.9.....', '7.9.a.c.e.c.a.9.7.....5.4.......'],
    chords: [0, 0, 5, 4], leadWave: 'square', padWave: 'saw', bassWave: 'square', sections: STD, color: 0x3af2ff,
  },
  {
    id: 'mango_tango', title: 'Mango Tango Electrónico', artist: 'Los Flamingos Digitales', genre: 'Latin-Elektro', bpm: 112,
    root: 43, scale: DORIAN, swing: 0.08,
    kick: 'x..x..x.x..x..x.', snare: '...x..x....x..x.', hat: 'x.xxx.xxx.xxx.xx', clap: '......x.......x.', perc: 'x..o.x..o.x..o..',
    bass: ['0..0..4.0..0..4.', '3..3..5.3..3..6.'],
    lead: ['4.5.7...7.9.7...4.5.7.9.a...9.7.', '9.a.c...a.9.7...5.4.2.4.0.......'],
    chords: [0, 3, 0, 4], leadWave: 'pluck', padWave: 'tri', bassWave: 'sine', sections: STD, color: 0xffa13a,
  },
  {
    id: 'glitter_ball', title: 'Glitter Ball Revival', artist: 'The Velvet Sharks', genre: 'Disco', bpm: 118,
    root: 48, scale: MIXO, swing: 0,
    kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', clap: '....x.......x...', perc: 'x.xxx.xxx.xxx.xx',
    bass: ['0.7.0.7.0.7.0.7.', '3.a.3.a.3.a.3.a.', '4.b.4.b.4.b.4.b.', '5.c.4.b.2.9.1.8.'],
    lead: ['7-9-7-5-4---2---4-5-7-9-a-------', 'a-9-7-9-a---c---a-9-7-5-4-------'],
    chords: [0, 3, 4, 3], leadWave: 'square', padWave: 'saw', bassWave: 'pluck', sections: STD, color: 0xffd23a,
  },
  {
    id: 'palm_cypher', title: 'Palm Cypher', artist: 'MC Mangrove & Lil Pelican', genre: 'Hip-Hop', bpm: 92,
    root: 38, scale: MINOR, swing: 0.18,
    kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.xx', clap: '....x.......x...', perc: '.......o.......o',
    bass: ['0-----0...3-2...', '5-----5...4-3...'],
    lead: ['7...7.5.4...2...7...7.9.a.......', '4...5...7...5...4...2...0.......'],
    chords: [0, 5, 0, 4], leadWave: 'tri', padWave: 'sine', bassWave: 'sine', sections: STD, color: 0x7dff6a,
  },
  {
    id: 'ocean_house', title: 'Ocean House (Sunrise Edit)', artist: 'Coral Club Collective', genre: 'House', bpm: 124,
    root: 45, scale: MAJOR, swing: 0.04,
    kick: 'x...x...x...x...', snare: '................', hat: '..x...x...x...x.', clap: '....x.......x...', perc: '.x.x.x.x.x.x.x.x',
    bass: ['..0...0...0...0.', '..5...5...4...4.'],
    lead: ['9...9...7...9...b...9...7.......', '9...b...c...b...9...7...4.......'],
    chords: [0, 5, 3, 4], leadWave: 'pluck', padWave: 'tri', bassWave: 'saw', sections: STD, color: 0x5a8dff,
  },
];
export const SONG_BY_ID: Record<string, SongDef> = Object.fromEntries(SONGS.map((s) => [s.id, s]));

export const songBars = (s: SongDef) => s.sections.reduce((a, x) => a + x.bars, 0);
export const songBeats = (s: SongDef) => songBars(s) * 4;
/** Länge in Sekunden (inkl. 1 Takt Vorlauf vor dem ersten Schlag). */
export const songSeconds = (s: SongDef) => (songBeats(s) + 4) * 60 / s.bpm;
/** Zeit des ersten Schlags (1 Takt Vorlauf). */
export const songOffset = (s: SongDef) => 4 * 60 / s.bpm;

/** Abschnitt je Takt. */
export function sectionAt(s: SongDef, bar: number): SectionDef {
  let b = 0;
  for (const sec of s.sections) { if (bar < b + sec.bars) return sec; b += sec.bars; }
  return s.sections[s.sections.length - 1];
}
export const stepDegree = (ch: string): number | null => (ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch >= 'a' && ch <= 'e' ? ch.charCodeAt(0) - 87 : null);
/** Tonleiterstufe → MIDI-Note. */
export function degreeMidi(s: SongDef, deg: number, octave = 0): number {
  const n = s.scale.length;
  return s.root + 12 * (Math.floor(deg / n) + octave) + s.scale[((deg % n) + n) % n];
}

/** Ereignis für Synthese und Onset-Ableitung: Zeit in Beats, Stimme, Stärke, Tonhöhe, Länge (Beats). */
export interface SongEvent { beat: number; voice: 'kick' | 'snare' | 'hat' | 'clap' | 'perc' | 'bass' | 'lead' | 'pad'; vel: number; midi?: number; len?: number }

/** Alle Ereignisse eines Songs (Beat 0 = erster Schlag nach dem Vorlauf). */
export function songEvents(s: SongDef): SongEvent[] {
  const out: SongEvent[] = [];
  const bars = songBars(s);
  const swingAt = (step: number) => (step % 2 === 1 ? s.swing * 0.5 : 0);
  for (let bar = 0; bar < bars; bar++) {
    const sec = sectionAt(s, bar);
    const b0 = bar * 4;
    if (sec.drums !== 'none') {
      const half = sec.drums === 'half';
      const drum = (pat: string, voice: SongEvent['voice'], vel: number) => {
        for (let i = 0; i < 16; i++) {
          const ch = pat[i];
          if (ch !== 'x' && ch !== 'o') continue;
          if (half && voice !== 'kick' && voice !== 'hat') continue;
          out.push({ beat: b0 + (i + swingAt(i)) / 4, voice, vel: (ch === 'x' ? 1 : 0.5) * vel });
        }
      };
      drum(s.kick, 'kick', 1); drum(s.snare, 'snare', 0.9); drum(s.hat, 'hat', 0.5); drum(s.clap, 'clap', 0.8); drum(s.perc, 'perc', 0.45);
      // Crash auf dem ersten Schlag jedes Abschnitts
    }
    const chord = s.chords[bar % s.chords.length];
    if (sec.pad) for (const d of [0, 2, 4]) out.push({ beat: b0, voice: 'pad', vel: 0.35, midi: degreeMidi(s, chord + d, 1), len: 4 });
    if (sec.bass) {
      const pat = s.bass[bar % s.bass.length];
      for (let i = 0; i < 16; i++) {
        const deg = stepDegree(pat[i]);
        if (deg === null) continue;
        let len = 1; while (i + len < 16 && pat[i + len] === '-') len++;
        out.push({ beat: b0 + (i + swingAt(i)) / 4, voice: 'bass', vel: 0.8, midi: degreeMidi(s, deg, 0), len: len / 4 });
      }
    }
    if (sec.lead && bar % 2 === 0) {
      const phrase = s.lead[(bar / 2) % s.lead.length | 0];
      for (let i = 0; i < 32; i++) {
        const deg = stepDegree(phrase[i]);
        if (deg === null) continue;
        let len = 1; while (i + len < 32 && phrase[i + len] === '-') len++;
        out.push({ beat: b0 + (i + swingAt(i)) / 4, voice: 'lead', vel: 0.7, midi: degreeMidi(s, deg, 2), len: len / 4 });
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}
