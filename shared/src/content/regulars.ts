// Benannte Stammgäste (Platzhalter-Register). Ausgearbeitet werden sie in Schritt 3 (Tagesablauf,
// Persönlichkeit, Beziehungen, Gedächtnis pro Account). Ereignisse referenzieren sie schon per ID.
import type { DistrictId } from '../world/districts/types';

export interface RegularStub { id: string; name: string; district: DistrictId; role: string }

export const REGULARS: RegularStub[] = [
  { id: 'lh_cafe_owner', name: 'Marisol', district: 'little_havana', role: 'Café-Besitzerin „La Ventanita Feliz“, weiß über alles Bescheid' },
  { id: 'lh_domino_elder', name: 'Don Ernesto', district: 'little_havana', role: 'Domino-Veteran, seit 40 Jahren „ehrlich“' },
  { id: 'lh_pilar', name: 'Doña Pilar', district: 'little_havana', role: 'Besitzerin von Fernando, dem Hahn' },
  { id: 'ok_rancher', name: 'Doris Whitlock', district: 'okeefield', role: 'Rancherin der Double R Ranch, fährt Aufsitzrasenmäher, redet mit Kühen netter als mit Menschen' },
  // Höfe zwischen Okeefield und Okee Peak (farms.ts)
  { id: 'ok_sunny_grove', name: 'Rosie Peck', district: 'okeefield', role: 'Orangenbäuerin von Sunny Grove Farm, Hofladen-Chefin („Das ist eine Orange, Schätzchen.“)' },
  { id: 'ok_henderson', name: 'Walt Henderson', district: 'okeefield', role: 'Milchbauer der Henderson Dairy, Gertrudes Vermieter' },
  { id: 'ok_cluck', name: 'Betty-Lou Cluckett', district: 'okeefield', role: 'Hühnerfarmerin von Cluck & Co., Eierstand mit Lebensweisheiten' },
  { id: 'ok_big_melon', name: 'Hank Mellow', district: 'okeefield', role: 'Gemüsebauer von Big Melon Acres, gibt jeder Melone einen Namen' },
  { id: 'ok_cane_creek', name: 'Earl Pritchard', district: 'okeefield', role: 'Müller der Cane Creek Mill, erzählt Gruselgeschichten über das Sumpfmonster' },
  // Okee Peak
  { id: 'ok_ranger', name: 'Ranger Marge Tolliver', district: 'okeefield', role: 'Rangerin am Okee Peak, zählt Hirsche und verwarnt Wanderer' },
  { id: 'ok_summit_cafe', name: 'Summit Sal', district: 'okeefield', role: 'Wirt des Gipfelcafés, hat das Missionstelefon direkt neben der Kuchentheke' },
  { id: 'ok_quarry', name: '„Boomer“ Briggs', district: 'okeefield', role: 'Sprengmeister im Steinbruch, liebt seine Sirene' },
  { id: 'ok_peak_hiker', name: 'Reginald Summit-Smythe', district: 'okeefield', role: 'Übermotivierter Gipfelstürmer „ohne Hilfsmittel“' },
];
export const REGULAR_IDS: ReadonlySet<string> = new Set(REGULARS.map((r) => r.id));
