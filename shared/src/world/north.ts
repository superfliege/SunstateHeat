// Der Norden als Ganzes: Gebietsnamen für Population Tables, Verkehrsmischung und Atmosphäre
// (Stadt vs. Land mit Übergangszone) sowie Sprungziele für Dev-Befehle.
import { FARMS, farmAt } from './farms';
import { okeeBase, OKEE_PLACES, SUMMIT_PLATEAU, SWITCHBACK_START, RESERVOIR } from './okeePeak';
import { Zone } from './WorldMap';

/**
 * Ländliche Gebiete (Namen = Schlüssel der Population Tables). Städte/Viertel haben eigene Namen
 * (District.name); diese Gebiete gelten außerhalb der Viertel.
 *   'Okee Peak'      – am Berg (Wald, Fels, Camping, Steinbruch)
 *   'Okee Höfe'      – auf und um die Bauernhöfe
 *   'Dry Pine Land'  – Landstraßen und Felder im Hinterland
 *   'Feldwege'       – Schotter-/Feldwege (fast nur Landmaschinen)
 *   'Stadtrand'      – Übergangszone (Vorstadt, Gewerbe, Trailerpark): Stadt und Land überblenden
 */
export type RuralArea = 'Okee Peak' | 'Okee Höfe' | 'Dry Pine Land' | 'Feldwege' | 'Stadtrand';

/** Zonen, die als „Land“ gelten. */
export const RURAL_ZONES: ReadonlySet<number> = new Set([Zone.DryPine, Zone.Highlands, Zone.CaneRidge, Zone.PortSabal]);

/** Stadtrand: Gürtel zwischen Stadt (Port Coralia) und Land; Wert 0 (Stadt) … 1 (Land). */
export function ruralness(x: number, z: number, zoneAt: (x: number, z: number) => number): number {
  let land = 0, n = 0;
  for (const [dx, dz] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60], [110, 0], [-110, 0], [0, 110], [0, -110]]) {
    n++;
    if (RURAL_ZONES.has(zoneAt(x + dx, z + dz))) land++;
  }
  return land / n;
}

export function ruralArea(x: number, z: number, zoneAt: (x: number, z: number) => number, dirt = false): RuralArea | null {
  if (x > 360 && x < 1280 && z > 30 && z < 580 && okeeBase(x, z) > 6) return 'Okee Peak';
  if (farmAt(x, z)) return 'Okee Höfe';
  const r = ruralness(x, z, zoneAt);
  if (r <= 0.15) return null;
  if (r < 0.75) return 'Stadtrand';
  return dirt ? 'Feldwege' : 'Dry Pine Land';
}

/** Dev-Sprungziele im Norden (/tp gipfel …). */
export function northTarget(name: string): { name: string; x: number; z: number } | null {
  const n = name.toLowerCase();
  const P = OKEE_PLACES;
  const list: { keys: string[]; name: string; x: number; z: number }[] = [
    { keys: ['gipfel', 'okee', 'peak', 'summit'], name: 'Okee Peak – Gipfelplateau (Fernrohre: E)', x: SUMMIT_PLATEAU.x, z: SUMMIT_PLATEAU.z + 8 },
    { keys: ['switchback', 'serpentinen', 'bergfuss'], name: 'Switchback Road – Bergfuß', x: SWITCHBACK_START[0], z: SWITCHBACK_START[1] },
    { keys: ['stausee', 'reservoir', 'staumauer'], name: RESERVOIR.name, x: RESERVOIR.jetty[0][0] + 4, z: RESERVOIR.jetty[0][1] },
    { keys: ['steinbruch', 'quarry'], name: 'Steinbruch an der Ostflanke', x: P.quarry.x, z: P.quarry.z + 12 },
    { keys: ['camping', 'campingplatz', 'camp'], name: 'Pinecone Campground', x: P.campground.x, z: P.campground.z },
    { keys: ['ranger', 'wachturm'], name: 'Ranger-Station', x: P.ranger.x, z: P.ranger.z + 10 },
    { keys: ['truckstop', 'dustline'], name: 'Dustline Truckstop', x: P.truckstop.x, z: P.truckstop.z + 6 },
    { keys: ['holzplatz', 'holz'], name: 'Holzplatz (Timber Trail)', x: P.logYard.x, z: P.logYard.z },
    ...FARMS.map((f) => ({ keys: [f.id, f.name.toLowerCase(), f.name.toLowerCase().split(' ')[0]], name: f.name, x: f.x, z: f.z })),
  ];
  return list.find((t) => t.keys.some((k) => k === n || (n.length >= 4 && k.includes(n)))) ?? null;
}
