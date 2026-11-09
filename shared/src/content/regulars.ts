// Benannte Stammgäste (Platzhalter-Register). Ausgearbeitet werden sie in Schritt 3 (Tagesablauf,
// Persönlichkeit, Beziehungen, Gedächtnis pro Account). Ereignisse referenzieren sie schon per ID.
import type { DistrictId } from '../world/districts/types';

export interface RegularStub { id: string; name: string; district: DistrictId; role: string }

export const REGULARS: RegularStub[] = [
  { id: 'lh_cafe_owner', name: 'Marisol', district: 'little_havana', role: 'Café-Besitzerin „La Ventanita Feliz“, weiß über alles Bescheid' },
  { id: 'lh_domino_elder', name: 'Don Ernesto', district: 'little_havana', role: 'Domino-Veteran, seit 40 Jahren „ehrlich“' },
  { id: 'lh_pilar', name: 'Doña Pilar', district: 'little_havana', role: 'Besitzerin von Fernando, dem Hahn' },
  { id: 'ok_rancher', name: 'Doris Whitlock', district: 'okeefield', role: 'Rancherin mit Aufsitzrasenmäher' },
];
export const REGULAR_IDS: ReadonlySet<string> = new Set(REGULARS.map((r) => r.id));
