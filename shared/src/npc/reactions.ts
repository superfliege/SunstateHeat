// Wahrnehmung & Reaktionen (Schritt 4): Aktionen erzeugen Ereignisse mit Radius und Stärke. NPCs im
// Radius reagieren je nach Archetyp-Mut, Abstand und Zufall: hinschauen, ausweichen, erschrecken,
// schimpfen, filmen, Polizei rufen, flüchten, ducken – mutige greifen ein. Die Entscheidung trifft der
// Server (sie kann die Fahndung beeinflussen); der Client bekommt nur Act-ID + Bark.

export const NpcEv = {
  Honk: 0, Sprint: 1, Bump: 2, Siren: 3, Crash: 4, Sidewalk: 5, Theft: 6, Fight: 7, Shot: 8, Explosion: 9,
} as const;
export type NpcEvId = (typeof NpcEv)[keyof typeof NpcEv];

export interface NpcEvDef {
  name: string;
  /** Wahrnehmungsradius in m */
  r: number;
  /** Stärke 0–1 (im Zentrum) */
  s: number;
  /** Ist es ein Verbrechen des Verursachers (Zeugen können die Polizei rufen)? */
  crime?: boolean;
  /** Brauchen NPCs Sichtlinie (sonst reicht Hören)? */
  sight?: boolean;
}

export const NPC_EVENTS: Record<NpcEvId, NpcEvDef> = {
  [NpcEv.Honk]: { name: 'Hupe', r: 14, s: 0.18 },
  [NpcEv.Sprint]: { name: 'Sprintet vorbei', r: 3.2, s: 0.14, sight: true },
  [NpcEv.Bump]: { name: 'Angerempelt', r: 1.4, s: 0.3 },
  [NpcEv.Siren]: { name: 'Sirene', r: 30, s: 0.3 },
  [NpcEv.Crash]: { name: 'Unfall', r: 30, s: 0.5, sight: true },
  [NpcEv.Sidewalk]: { name: 'Auto auf dem Gehweg', r: 13, s: 0.75, sight: true },
  [NpcEv.Theft]: { name: 'Autodiebstahl', r: 24, s: 0.55, crime: true, sight: true },
  [NpcEv.Fight]: { name: 'Schlägerei', r: 20, s: 0.62, crime: true, sight: true },
  [NpcEv.Shot]: { name: 'Schuss', r: 48, s: 1 },
  [NpcEv.Explosion]: { name: 'Explosion', r: 65, s: 1 },
};

/** Reaktionsarten (Server-Zustand eines NPCs). */
export type ReactionId = 'look' | 'dodge' | 'flinch' | 'scold' | 'film' | 'call' | 'flee' | 'panic' | 'cower' | 'intervene' | 'point' | 'stumble';
export const REACTION_NAMES: Record<ReactionId, string> = {
  look: 'schaut hin', dodge: 'weicht aus', flinch: 'erschrickt', scold: 'schimpft', film: 'filmt', call: 'ruft Polizei',
  flee: 'flüchtet', panic: 'Panik', cower: 'duckt sich', intervene: 'greift ein', point: 'zeigt auf Spieler', stumble: 'stolpert',
};

/**
 * Reaktion wählen. i = wahrgenommene Intensität (0–1, nach Abstand), c = Mut (0–1), r = Zufall [0,1).
 * Gibt die Reaktion und ihre Dauer (s) zurück. Neigungen je Archetyp: `filmer` (Touristen, Partygänger).
 */
export function chooseReaction(ev: NpcEvId, i: number, c: number, r: number, filmer: boolean, dist: number): [ReactionId, number] | null {
  switch (ev) {
    case NpcEv.Bump: return [c > 0.45 && r < 0.6 ? 'scold' : 'stumble', 1.6];
    case NpcEv.Sprint: return r < 0.55 ? ['dodge', 0.8] : r < 0.8 ? ['look', 1.5] : null;
    case NpcEv.Honk: return r < 0.5 ? ['look', 1.4] : c > 0.55 && r < 0.65 ? ['scold', 2] : null;
    case NpcEv.Siren: return r < 0.45 ? ['look', 2.2] : filmer && r < 0.55 ? ['film', 5] : null;
    case NpcEv.Crash:
      if (i > 0.75 && c < 0.45) return ['flinch', 1.2];
      if (filmer && c > 0.3 && r < 0.4) return ['film', 6 + r * 6];
      if (c > 0.55 && r < 0.6) return ['scold', 2.2];
      return ['look', 2.5];
    case NpcEv.Sidewalk:
      if (dist < 6) return c > 0.75 && r < 0.3 ? ['scold', 2] : ['flee', 2.2];
      return c < 0.4 ? ['flinch', 1] : r < 0.5 ? ['scold', 2.2] : ['look', 1.6];
    case NpcEv.Theft:
    case NpcEv.Fight:
      if (c > 0.75 && dist < 14 && r < 0.45) return ['intervene', 4];
      if (c < 0.35 && dist < 8) return r < 0.5 ? ['cower', 3 + r * 3] : ['flee', 3];
      if (r < 0.4) return ['call', 3.5];
      if (filmer && r < 0.75) return ['film', 6 + r * 6];
      return ['scold', 2.2];
    case NpcEv.Shot:
    case NpcEv.Explosion:
      // Gaffer: weit genug weg, mutig und mit Handy → filmen (Satire); Ängstliche ducken sich
      if (filmer && dist > 26 && c > 0.5 && r < 0.3) return ['film', 6 + r * 5];
      if (c < 0.35 && i > 0.5 && r < 0.4) return ['cower', 4 + r * 3];
      if (dist > 30 && r < 0.25) return ['call', 3.5];
      return [i > 0.6 ? 'panic' : 'flee', 4 + r * 2];
  }
  return null;
}

/** Wie lange sich ein NPC den Verursacher merkt (s) – schaut ängstlich, hält Abstand. */
export const FEAR_MEMORY = 60;
