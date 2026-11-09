// Viertel-DNA: Register aller Viertel und Zuordnung zu Karten-Vierteln/Zonen (palmara.ts).
import { BRICKELL_HILLS } from './brickellHills';
import { CORAL_KEYS } from './coralKeys';
import { DOWNTOWN } from './downtown';
import { GATOR_FLATS } from './gatorFlats';
import { LITTLE_HAVANA } from './littleHavana';
import { NORTHGATE } from './northgate';
import { OCEAN_STRIP } from './oceanStrip';
import { OKEEFIELD } from './okeefield';
import { PORT_DISTRICT } from './portDistrict';
import type { DistrictDNA, DistrictId } from './types';

export type { DistrictDNA, DistrictId, MoodValues, ResidentType } from './types';

export const DISTRICT_DNA: Record<DistrictId, DistrictDNA> = {
  ocean_strip: OCEAN_STRIP,
  downtown: DOWNTOWN,
  little_havana: LITTLE_HAVANA,
  port_district: PORT_DISTRICT,
  brickell_hills: BRICKELL_HILLS,
  northgate: NORTHGATE,
  coral_keys: CORAL_KEYS,
  gator_flats: GATOR_FLATS,
  okeefield: OKEEFIELD,
};
export const DISTRICT_IDS = Object.keys(DISTRICT_DNA) as DistrictId[];

/** DNA zu einem Karten-Viertel (DISTRICTS[].name) bzw. ersatzweise zur Zone (ZONE_NAMES). */
export function dnaFor(districtName: string | undefined, zoneName?: string): DistrictDNA | null {
  if (districtName) for (const d of DISTRICT_IDS) if (DISTRICT_DNA[d].mapDistricts.includes(districtName)) return DISTRICT_DNA[d];
  if (zoneName) for (const d of DISTRICT_IDS) if (DISTRICT_DNA[d].mapZones?.includes(zoneName)) return DISTRICT_DNA[d];
  return null;
}
