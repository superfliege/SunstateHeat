// Stadt vs. Land: Fahrzeugmischung je Gebiet (Landstraße, Feldweg, Kleinstadt, Berg, Stadtrand)
// und Verkehrsdichte. Die Population Tables der Fußgänger stehen in population.ts.
// Mischung Landstraße (Vorgabe): ~30 % Pick-ups, 20 % Traktoren/Landmaschinen, 15 % Trucks,
// 10 % Wohnmobile, 10 % Quads/Geländewagen, 15 % normale Autos.
import { CAR_VARIANTS, pickCarVariant, variantByName } from '../sim/handling';
import type { RuralArea } from '../world/north';

type Mix = [string[], number][];

const PICKUPS = ['Rusty Ranch Pick-up', 'Hay Hauler', 'Ranch Hauler', 'Swamprunner'];
const TRACTORS = ['Dirt Buddy', 'Field King 400', 'Rusty Ol\' Red', 'Heuwagen', 'Pflug', 'Güllefass', 'Viehanhänger', 'Orangenkisten-Anhänger'];
const COMBINE = ['Harvest Titan'];
const TRUCKS = ['Milchtanklaster', 'Viehtransporter', 'Holztransporter', 'Dustline Rig', 'Citrus Express'];
const RVS = ['Wanderlust RV'];
const OFFROAD = ['Mule ATV', 'Ridge Runner Buggy', 'Everglade XT'];
const MOUNTAIN_TRUCKS = ['Holztransporter', 'Muldenkipper'];

/** Mischungen je Gebiet: [Variantennamen, Anteil]. NORMAL = Stadtpool ohne Lkw. */
const NORMAL = '*';
export const VEHICLE_MIX: Record<RuralArea | 'Kleinstadt', Mix> = {
  'Dry Pine Land': [[PICKUPS, 30], [TRACTORS, 18], [COMBINE, 2], [TRUCKS, 15], [RVS, 10], [OFFROAD, 10], [[NORMAL], 15]],
  'Feldwege': [[TRACTORS, 62], [COMBINE, 6], [PICKUPS, 20], [['Mule ATV'], 12]],
  'Okee Höfe': [[TRACTORS, 45], [PICKUPS, 35], [['Mule ATV'], 15], [['Lawn Boss'], 5]],
  'Okee Peak': [[PICKUPS, 25], [RVS, 20], [[NORMAL], 20], [MOUNTAIN_TRUCKS, 15], [OFFROAD, 12], [TRACTORS, 8]],
  // Okeefield-Orte (Cane Ridge, Port Sabal, Sunny Acres): mehr normale Autos
  'Kleinstadt': [[[NORMAL], 45], [PICKUPS, 25], [TRUCKS, 10], [TRACTORS, 10], [RVS, 5], [OFFROAD, 5]],
  // Übergangszone: halb Stadt, halb Land
  'Stadtrand': [[[NORMAL], 50], [PICKUPS, 20], [TRUCKS, 12], [RVS, 6], [TRACTORS, 6], [OFFROAD, 6]],
};

const cache = new Map<string, number>();
const idOf = (name: string) => { let v = cache.get(name); if (v === undefined) { v = variantByName(name); cache.set(name, v); } return v; };

/** Normales Auto aus dem Stadtpool (ohne Lkw/Einsatzfahrzeuge). */
function normalCar(r: number): number {
  for (let k = 0; k < 6; k++) {
    const v = pickCarVariant((r + k * 0.37) % 1);
    const c = CAR_VARIANTS[v].cls;
    if (c !== 'truck' && c !== 'police') return v;
  }
  return 1;
}

/** Fahrzeugvariante für ein Gebiet (null = Stadt). rnd liefert Zufallszahlen 0..1. */
export function pickAreaVariant(area: RuralArea | 'Kleinstadt' | null, rnd: () => number): number {
  if (!area) return pickCarVariant(rnd());
  const mix = VEHICLE_MIX[area];
  let total = 0;
  for (const [, w] of mix) total += w;
  let x = rnd() * total;
  for (const [names, w] of mix) {
    x -= w;
    if (x > 0) continue;
    const n = names[Math.floor(rnd() * names.length)];
    if (n === NORMAL) return normalCar(rnd());
    const id = idOf(n);
    return id >= 0 ? id : normalCar(rnd());
  }
  return normalCar(rnd());
}

/** Anteil des Verkehrs, der in einem Gebiet tatsächlich spawnt (Land: deutlich weniger). */
export const TRAFFIC_DENSITY: Record<RuralArea | 'Kleinstadt', number> = {
  'Dry Pine Land': 0.45, 'Feldwege': 0.25, 'Okee Höfe': 0.3, 'Okee Peak': 0.4, 'Kleinstadt': 0.8, 'Stadtrand': 0.8,
};

/** Okeefield-Orte (Viertelnamen) – für Kleinstadt-Mischung und Population. */
export const SMALLTOWN_DISTRICTS: ReadonlySet<string> = new Set(['Cane Ridge', 'Port Sabal', 'Sunny Acres']);
