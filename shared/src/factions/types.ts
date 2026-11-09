// Fraktions-Profile: Gangs als lebende Fraktionen (Philosophie, Hierarchie, Sprache, Präsenz,
// Alltag, Beziehungen) und die Polizei als eigene Fraktion. Gruppen werden über Lebensstil,
// Werte, Beruf und Haltung charakterisiert – nie über Herkunft, Ethnie oder Religion.
import type { GangId } from '../gangs';
import type { DistrictId } from '../world/districts/types';

export interface NamedNpc {
  id: string;
  name: string;
  /** Spitzname, unter dem ihn die Straße kennt. */
  nick?: string;
  role: string;
  personality: string;
  /** Marotte, an der man ihn erkennt (Animation/Requisite/Spruch). */
  quirk: string;
  look: string;
  /** Wo man ihn meist antrifft. */
  haunt: string;
  /** Signatur-Spruch. */
  catchphrase: string;
}

/** Beziehung zwischen zwei Fraktionen: −100 (Krieg) … +100 (Bündnis). */
export type RelationKind = 'feud' | 'rivalry' | 'shaky_peace' | 'business' | 'alliance';
export interface Relation { kind: RelationKind; value: number; note: string }

export type GangScenarioId =
  | 'hang_out' | 'dice' | 'cards' | 'deal' | 'protection' | 'recruit' | 'tune_car' | 'grill' | 'tag_wall' | 'patrol' | 'party';

export interface GangScenario {
  id: GangScenarioId;
  name: string;
  /** Wie die Gang das macht (Flavor, Requisiten). */
  flavor: string;
  /** Beispiel-Sprechblasen (Gang-Slang-Blasen in Gangfarbe). */
  lines: string[];
}

export interface TagStyle {
  /** Grundform des prozeduralen Tags. */
  shape: 'neon_script' | 'anchor_crest' | 'crown_glyph' | 'stencil_star';
  /** Kürzel, das gesprüht wird. */
  letters: string[];
  colors: number[];
  /** Kurzbeschreibung für Grafik/Generator. */
  desc: string;
}

export interface GangProfile {
  id: GangId;
  name: string;
  motto: string;
  selfImage: string;
  philosophy: string;
  /** Was sie verachten. */
  despise: string[];
  values: string[];
  turf: DistrictId[];
  /** Viertel, in denen sie mitmischen wollen. */
  ambitions: DistrictId[];
  hierarchy: {
    boss: NamedNpc;
    lieutenants: NamedNpc[];
    members: string;
    prospects: string;
    sympathizers: string;
  };
  slang: {
    greetings: string[];
    farewells: string[];
    /** Ausdruck → Bedeutung. */
    expressions: Record<string, string>;
    /** Spitznamen für Rivalen (alle anderen Gangs + Polizei). */
    rivalNicknames: Partial<Record<GangId | 'police', string[]>>;
    /** Spott über andere Viertel. */
    districtMockery: Partial<Record<DistrictId, string>>;
  };
  presence: {
    colors: number[];
    clothing: string;
    vehicles: string[];
    music: string;
    tag: TagStyle;
    /** Treffpunkte (Smart Objects, Viertel). */
    hangouts: { name: string; district: DistrictId; kind: string }[];
    patrol: string;
  };
  scenarios: GangScenario[];
  relations: Partial<Record<GangId | 'police', Relation>>;
  /** Wie die Gang auf den Spieler reagiert, nach Rufstufe (spec 12.2). */
  toPlayer: { archenemy: string[]; hostile: string[]; neutral: string[]; friendly: string[]; trusted: string[] };
  /** Fraktions-KI: Neigungen 0–1 für die Entscheidungen (siehe Fraktions-KI). */
  ai: { expand: number; provoke: number; business: number; bribe: number; retreat: number };
}

/** Polizei als Fraktion (Präsenz pro Viertel, mehr Streifen nach Vorfällen). */
export interface PoliceProfile {
  name: string;
  motto: string;
  selfImage: string;
  chief: NamedNpc;
  officers: NamedNpc[];
  expressions: string[];
  /** Startpräsenz pro Viertel 0–100. */
  presence: Partial<Record<DistrictId, number>>;
  relations: Partial<Record<GangId, Relation>>;
  sampleLines: string[];
}
