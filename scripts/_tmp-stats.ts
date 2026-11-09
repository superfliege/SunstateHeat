// Temporäres Analyse-Skript: zählt Fahrzeug-Spawns und Straßenkanten der generierten Welt.
import { MAP_SEED } from '../shared/src/constants';
import { generateWorld } from '../shared/src/world/mapgen';

const map = generateWorld(MAP_SEED);
const byKind = new Map<number, number>();
for (const s of map.vehicleSpawns) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1);
console.log('vehicleSpawns gesamt:', map.vehicleSpawns.length);
console.log('nach Art:', [...byKind.entries()]);
console.log('edges:', map.edges.length, 'nodes:', map.nodes.length, 'lots:', map.lots.length);
const walkable = map.edges.filter((e) => e.sidewalk > 0 && e.len - e.trimA - e.trimB >= 8).length;
console.log('Gehweg-Kanten:', walkable, '=> Gehwege:', walkable * 2);
