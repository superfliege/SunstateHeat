// Fraktions-Register: Gang-Profile (Spec 12) und Polizei.
import type { GangId } from '../gangs';
import { DUSTLINE_HAULERS } from './dustline';
import { MANGROVE_KINGS } from './mangrove';
import { MARLIN_CLUB } from './marlin';
import { NEON_SYNDICATE } from './neon';
import type { GangProfile, Relation } from './types';

export { POLICE } from './police';
export type { GangProfile, GangScenario, GangScenarioId, NamedNpc, PoliceProfile, Relation, RelationKind, TagStyle } from './types';

export const GANG_PROFILES: Record<GangId, GangProfile> = {
  neon: NEON_SYNDICATE,
  marlin: MARLIN_CLUB,
  mangrove: MANGROVE_KINGS,
  dustline: DUSTLINE_HAULERS,
};

/** Startbeziehung zweier Gangs (symmetrisch: Mittelwert beider Sichtweisen). */
export function gangRelation(a: GangId, b: GangId): Relation | null {
  if (a === b) return null;
  const ab = GANG_PROFILES[a].relations[b], ba = GANG_PROFILES[b].relations[a];
  if (!ab || !ba) return ab ?? ba ?? null;
  return { kind: ab.kind, value: Math.round((ab.value + ba.value) / 2), note: ab.note };
}
