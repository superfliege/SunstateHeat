// Akustische Umgebung aus der Kachelkarte: Hallzone am Hörer, grobe Verdeckung (Raycast durch
// Gebäudekacheln) und Audio-Zonen fürs Lazy Loading. Alles billig (wenige Kachel-Abfragen).
import { Tile } from '../../../shared/src/world/tiles';
import { Zone, ZONE_NAMES, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { EnvName } from './AudioEngine';

const slug = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const solid = (t: number) => t === Tile.BUILDING || t === Tile.ROCK;

export class AudioEnvironment {
  constructor(private map: WorldMap) {}

  /** Hallzone am Hörer: Gebäude ringsum (8 Strahlen bis 16 m), Wasser/Sand, Sumpf. */
  reverbAt(x: number, z: number): EnvName {
    let hits = 0, near = 0, sum = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      for (let d = 2; d <= 16; d += 2) {
        if (solid(this.map.tileAt(x + dx * d, z + dz * d))) { hits++; sum += d; if (d <= 8) near++; break; }
      }
    }
    if (this.map.tileAt(x, z) === Tile.BRIDGE) {
      // unter/auf langen Brücken: offen, aber etwas Reflexion vom Wasser
      return 'street';
    }
    if (hits >= 6 && near >= 4) return 'alley';
    if (hits >= 3 || (hits >= 2 && sum / hits < 8)) return 'street';
    let wet = 0, swamp = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const t = this.map.tileAt(x + Math.cos(a) * 18, z + Math.sin(a) * 18);
      if (t === Tile.WATER || t === Tile.SAND) wet++;
      if (t === Tile.SWAMP) swamp++;
    }
    if (swamp >= 2 || this.map.zoneAt(x, z) === Zone.GatorFlats) return 'swamp';
    if (wet >= 3) return 'beach';
    return 'open';
  }

  /** Verdeckung 0..1: Gebäudekacheln auf der Linie Quelle → Hörer (Schritt 3 m, max. 120 m geprüft). */
  occlusion(sx: number, sz: number, lx: number, lz: number): number {
    const dx = lx - sx, dz = lz - sz, d = Math.hypot(dx, dz);
    if (d < 6) return 0;
    const steps = Math.min(40, Math.floor((d - 4) / 3));
    let n = 0;
    for (let i = 1; i <= steps; i++) {
      const t = (2 + i * 3) / d;
      if (solid(this.map.tileAt(sx + dx * t, sz + dz * t))) { n++; if (n >= 4) break; }
    }
    return Math.min(1, n / 3);
  }

  /** Audio-Zone (Viertel-Slug, sonst Zonen-Slug), z. B. "ocean-strip", "gator-flats". */
  zoneAt(x: number, z: number): string {
    const d = this.map.districtAt(x, z);
    return d ? slug(d.name) : slug(ZONE_NAMES[this.map.zoneAt(x, z)] ?? '');
  }

  /** Aktuelle Zone + Nachbarn (Stichproben im Umkreis von 150 m) fürs Lazy Loading. */
  zonesNear(x: number, z: number): string[] {
    const out = new Set<string>([this.zoneAt(x, z), slug(ZONE_NAMES[this.map.zoneAt(x, z)] ?? '')]);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      out.add(this.zoneAt(x + Math.cos(a) * 150, z + Math.sin(a) * 150));
    }
    return [...out].filter(Boolean);
  }
}
