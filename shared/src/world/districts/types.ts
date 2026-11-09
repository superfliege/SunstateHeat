// Viertel-DNA: datengetriebene Identität je Viertel (Lebensgefühl, Bewohner, Sinneseindrücke,
// Stimmungswerte). Gruppen werden ausschließlich über Lebensstil, Werte, Beruf und Haltung
// beschrieben – nie über Herkunft, Ethnie oder Religion. Alle Namen, Läden und Marken sind erfunden.
import type { ArchetypeId } from '../../npc/archetypes';
import type { DayPart } from '../../npc/population';
import type { GangId } from '../../gangs';

export type DistrictId =
  | 'ocean_strip' | 'downtown' | 'little_havana' | 'port_district' | 'brickell_hills'
  | 'northgate' | 'coral_keys' | 'gator_flats' | 'okeefield';

/** Bewohner-Typ des Viertels: baut auf einem Basis-Archetyp auf (Modell, Tempo, Szenarien),
 *  ergänzt um Viertel-Färbung (Beruf, Haltung, Kleidung) für Dialoge und Outfit. */
export interface ResidentType {
  id: string;
  name: string;
  /** Basis-Archetyp aus npc/archetypes.ts (Figur, Tempo, Szenarien). */
  base: ArchetypeId;
  /** Relative Gewichtung im Viertel. */
  weight: number;
  /** Haltung in einem Halbsatz – Grundlage für Dialogzeilen. */
  attitude: string;
}

/** Stimmungsachsen 0–100 (Startwert; Ereignisse und Spieleraktionen verschieben sie). */
export interface MoodValues { safety: number; wealth: number; gang: number }

export interface DistrictDNA {
  id: DistrictId;
  name: string;
  /** Viertel aus palmara.ts (DISTRICTS[].name) bzw. Zonen-Namen, die diese DNA tragen. */
  mapDistricts: string[];
  mapZones?: string[];
  /** Lebensphilosophie in einem Satz (Motto). */
  motto: string;
  /** Erläuterung des Mottos, ein bis zwei Sätze. */
  philosophy: string;
  /** 3–5 Werte. */
  values: string[];
  residents: ResidentType[];
  /** Typische Tätigkeiten (Szenarien / Smart Objects, teils geplant). */
  activities: string[];
  /** Lieblingsorte (benannt, erfunden). */
  hangouts: string[];
  /** Typische Sorgen. */
  worries: string[];
  /** Gesprächsstoff: Themen-Schlüssel (für Dialogbedingungen) → Beispiel. */
  topics: Record<string, string>;
  look: {
    graffiti: string;
    posters: string[];
    shops: string[];
    windowMusic: string;
    vehicles: string[];
    pets: string[];
    clothing: string;
    palette: number[];
  };
  sound: { ambience: string[]; music: string };
  /** Gang mit Heimrevier hier (falls vorhanden) und Gangs, die hier mitmischen. */
  homeGang?: GangId;
  contestedBy?: GangId[];
  mood: MoodValues;
  /** Regelmäßiges Viertel-Event (Kalender, siehe Spuren & Events). */
  calendar?: { name: string; days: string; part: DayPart; desc: string }[];
  /** Beispielzeilen in der Stimme des Viertels (Vorschau; das Dialogsystem bekommt eigene Dateien). */
  sampleLines: string[];
}
