// Spielmodus „Catch the Taxi“: Ein Spieler fährt ein Taxi mit unendlich Nitro und darf
// (Drive-by mit Pistole) schießen. Alle anderen jagen ihn in LKWs und dürfen NICHT schießen.
// Freie Plätze im Jägerfeld füllen KI-LKWs auf. Überlebt das Taxi die Zeit, gewinnt der
// Taxifahrer; wird es vorher zerstört (brennt / Wrack), gewinnen die Jäger.
// Danach landen alle wieder am Startpunkt (Telefon am Spawn).
import { CAR_VARIANTS, type HandlingProfile } from './sim/handling';

/** ID des Telefons/Modus (Telefon steht direkt am Spawn). */
export const TAXI_HUNT_ID = 'taxi_hunt';
export const TAXI_HUNT_NAME = 'Catch the Taxi';
/** Überlebenszeit für das Taxi in Sekunden. */
export const TAXI_HUNT_DURATION = 120;
/** Größe des Jägerfelds (Spieler + KI-Auffüllung). */
export const TAXI_HUNT_HUNTERS = 12;
/** Maximale Zahl menschlicher Spieler (1 Taxi + Jäger). */
export const TAXI_HUNT_MAX_PLAYERS = TAXI_HUNT_HUNTERS + 1;
/** Vorsprung des Taxis nach dem Countdown (Jäger stehen noch). */
export const TAXI_HUNT_HEAD_START = 4;
/** Belohnungen: Sieg Taxi / Sieg Jäger (je menschlichem Jäger), Trostpreis. */
export const TAXI_HUNT_REWARD = { taxi: { money: 2000, xp: 300 }, hunter: { money: 700, xp: 140 }, loss: { money: 0, xp: 40 } };

/** Fahrzeug-Varianten: das Taxi und die LKWs der Jäger. */
export const TAXI_VARIANT = Math.max(0, CAR_VARIANTS.findIndex((v) => v.model === 'car_taxi'));
export const HUNTER_VARIANTS = CAR_VARIANTS.map((v, i) => ({ v, i })).filter((x) => x.v.cls === 'truck').map((x) => x.i);

/** Nitro-Schub des Taxis (Limousinen haben normalerweise kein Nitro). */
const TAXI_NITRO_FORCE = 9000;
const boosted = new WeakMap<HandlingProfile, HandlingProfile>();
const isBoosted = new WeakSet<HandlingProfile>();
/** Fahrprofil des Taxis mit Nitro (Kopie, damit Client und Server dasselbe rechnen). */
export function taxiProfile(base: HandlingProfile): HandlingProfile {
  if (isBoosted.has(base)) return base;
  let p = boosted.get(base);
  if (!p) {
    p = { ...base, nitroForce: Math.max(base.nitroForce, TAXI_NITRO_FORCE) };
    boosted.set(base, p);
    isBoosted.add(p);
  }
  return p;
}
