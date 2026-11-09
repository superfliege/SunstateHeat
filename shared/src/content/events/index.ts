// Register aller Straßenereignisse (E01–E45), nach Viertel in eigenen Dateien.
import { ANYWHERE_EVENTS } from './anywhere';
import { BRICKELL_HILLS_EVENTS } from './brickellHills';
import { CORAL_KEYS_EVENTS } from './coralKeys';
import { DOWNTOWN_EVENTS } from './downtown';
import { GATOR_FLATS_EVENTS } from './gatorFlats';
import { LITTLE_HAVANA_EVENTS } from './littleHavana';
import { NORTHGATE_EVENTS } from './northgate';
import { OCEAN_STRIP_EVENTS } from './oceanStrip';
import { OKEEFIELD_EVENTS } from './okeefield';
import { PORT_DISTRICT_EVENTS } from './portDistrict';
import { validateEvent, type StreetEventDef } from './schema';
import { DISTRICT_IDS } from '../../world/districts';
import { REGULAR_IDS } from '../regulars';

export * from './schema';

export const STREET_EVENTS: StreetEventDef[] = [
  ...OCEAN_STRIP_EVENTS, ...DOWNTOWN_EVENTS, ...LITTLE_HAVANA_EVENTS, ...PORT_DISTRICT_EVENTS, ...BRICKELL_HILLS_EVENTS,
  ...NORTHGATE_EVENTS, ...CORAL_KEYS_EVENTS, ...GATOR_FLATS_EVENTS, ...OKEEFIELD_EVENTS, ...ANYWHERE_EVENTS,
];
export const EVENT_BY_ID: Record<string, StreetEventDef> = Object.fromEntries(STREET_EVENTS.map((e) => [e.id, e]));
export const EVENT_BY_KEY: Record<string, StreetEventDef> = Object.fromEntries(STREET_EVENTS.map((e) => [e.key, e]));

/** Alle Ereignisse prüfen (Schema + Referenzen + Eindeutigkeit). Leeres Array = alles gut. */
export function validateAllEvents(): string[] {
  const errs: string[] = [];
  const ids = new Set<string>(), keys = new Set<string>();
  for (const e of STREET_EVENTS) {
    if (ids.has(e.id)) errs.push(`${e.id}: doppelte id`);
    if (keys.has(e.key)) errs.push(`${e.id}: doppelter key ${e.key}`);
    ids.add(e.id); keys.add(e.key);
    errs.push(...validateEvent(e, DISTRICT_IDS, REGULAR_IDS));
  }
  return errs;
}
