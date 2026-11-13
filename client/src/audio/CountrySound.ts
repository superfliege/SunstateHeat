// Klang des Nordens (über die bestehende AudioEngine, Ambience-Bus, 3D wo es Sinn hat):
//   Loops     Grillen (abends/nachts), Wind (Felder/Kiefern, mit der Höhe lauter), Vögel (Berg, tagsüber),
//             Wasserfall am Stausee (3D)
//   Einzeln   Muhen und Kuhglocken an den Weiden, Hähne am Morgen, Hofhunde, Windrad-Quietschen,
//             Kirchenglocke in Okeefield am Sonntagmorgen, entfernte Trucks auf dem Highway,
//             Greifvogel-Schrei am Berg, Steinbruch-Sirene; Echo beim Hupen am Berg
//   Radio     Standardsender beim Einsteigen: auf dem Land Swamp Radio 101, in der Stadt Coral 88.1;
//             Stadtsender rauschen in Bergnähe (schwacher Empfang)
import { FARMS } from '../../../shared/src/world/farms';
import { RESERVOIR, OKEE_PLACES, okeeBase } from '../../../shared/src/world/okeePeak';
import { Zone, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { LoopHandle } from './AudioEngine';
import type { Sfx } from './Sfx';

type LoopId = 'amb.crickets' | 'amb.wind' | 'amb.birds' | 'amb.waterfall' | 'radio.swamp' | 'radio.coral' | 'radio.static';
const NORTH = new Set<number>([Zone.DryPine, Zone.Highlands, Zone.CaneRidge, Zone.PortSabal]);

export class CountrySound {
  private loops = new Map<LoopId, LoopHandle | null>();
  private cd: Record<string, number> = { moo: 3, bell: 2, rooster: 5, dog: 6, squeak: 4, church: 0, truck: 12, hawk: 9 };
  private wasInVehicle = false;
  /** aktueller Radiosender (null = aus) */
  station: 'swamp' | 'coral' | null = null;
  private churchRung = -1;
  private echoes: { t: number; x: number; y: number; z: number; vol: number }[] = [];

  constructor(private sfx: Sfx, private map: WorldMap) {}

  /** Hupe des eigenen Fahrzeugs (für das Echo am Berg). */
  honk(x: number, y: number, z: number) {
    if (okeeBase(x, z) < 15 && this.map.zoneAt(x, z) !== Zone.Highlands) return;
    // Echo von der Bergflanke: zwei leiser werdende Wiederholungen
    this.echoes.push({ t: 0.55, x: OKEE_PLACES.summit.x, y: y + 40, z: OKEE_PLACES.summit.z, vol: 0.35 }, { t: 1.15, x: OKEE_PLACES.summit.x, y: y + 60, z: OKEE_PLACES.summit.z, vol: 0.18 });
  }

  /** Neuer Sender beim Einsteigen (Toast-Text) oder null. */
  update(dt: number, x: number, y: number, z: number, inVehicle: boolean, day: number, night: number, wind: number, sunday: boolean): string | null {
    const e = this.sfx.engine;
    if (!e) return null;
    const zone = this.map.zoneAt(x, z);
    const north = NORTH.has(zone) && z < 1060;
    const h = ((day % 1) + 1) % 1 * 24;
    const hy = Math.max(0, y);
    // ---------------- Loops (Lautstärke weich nachführen)
    const want: Record<string, number> = {
      'amb.crickets': north ? Math.max(0, night * 0.9 + (h > 18 && h < 21 ? 0.4 : 0)) : 0,
      'amb.wind': north ? Math.min(1, 0.25 + wind * 0.25 + hy / 220) : 0,
      'amb.birds': north && night < 0.3 && zone === Zone.Highlands ? 0.6 : north && night < 0.3 ? 0.25 : 0,
      'amb.waterfall': Math.hypot(x - RESERVOIR.fall.x, z - RESERVOIR.fall.z) < 220 ? 1 : 0,
    };
    for (const [id, v] of Object.entries(want) as [LoopId, number][]) {
      let l = this.loops.get(id);
      if (v > 0.01 && !l) { l = e.loop(id, id === 'amb.waterfall' ? { x: RESERVOIR.fall.x, y: RESERVOIR.fall.top - 8, z: RESERVOIR.fall.z + 4 } : null); this.loops.set(id, l); }
      if (l) l.voice.setVolume(v, 0.6);
    }
    // ---------------- Einzelne Geräusche
    for (const k of Object.keys(this.cd)) this.cd[k] -= dt;
    if (north) {
      const farm = FARMS.find((f) => Math.hypot(f.x - x, f.z - z) < 140);
      if (farm) {
        const cows = farm.animals.some((a) => a.kind === 'cow' || a.kind === 'dairy_cow');
        const fl = farm.fields[0];
        if (cows && this.cd.moo <= 0) { this.sfx.at('amb.moo', { x: fl.x + (Math.random() - 0.5) * 20, y: 1, z: fl.z }, 0.8); this.cd.moo = 9 + Math.random() * 14; }
        if (cows && this.cd.bell <= 0) { this.sfx.at('amb.cowbell', { x: fl.x + (Math.random() - 0.5) * 30, y: 1, z: fl.z + (Math.random() - 0.5) * 20 }, 0.5); this.cd.bell = 2 + Math.random() * 6; }
        if (h > 5 && h < 8.5 && this.cd.rooster <= 0) { this.sfx.at('amb.rooster', { x: farm.x, y: 3, z: farm.z }, 0.9); this.cd.rooster = 25 + Math.random() * 30; }
        if (this.cd.dog <= 0) { this.sfx.at('amb.dog', { x: farm.x + 6, y: 1, z: farm.z + 6 }, 0.7); this.cd.dog = 18 + Math.random() * 30; }
        const pump = farm.props.find((p) => p.k === 'windpump');
        if (pump && this.cd.squeak <= 0) { this.sfx.at('amb.squeak', { x: pump.x, y: 9, z: pump.z }, 0.35 + wind * 0.15); this.cd.squeak = 3 + Math.random() * 4 / wind; }
      }
      if (this.cd.truck <= 0) { this.sfx.at('amb.truckhorn', null, 0.25); this.cd.truck = 40 + Math.random() * 60; }
      if (zone === Zone.Highlands && night < 0.3 && this.cd.hawk <= 0) { this.sfx.at('amb.hawk', null, 0.5); this.cd.hawk = 30 + Math.random() * 40; }
      // Kirchenglocke in Okeefield (Cane Ridge) am Sonntagmorgen um 9 und 10 Uhr: zwölf Schläge
      const hour = Math.floor(h);
      if (sunday && (hour === 9 || hour === 10) && this.churchRung !== hour) {
        this.churchRung = hour;
        for (let k = 0; k < 8; k++) setTimeout(() => this.sfx.at('amb.churchbell', { x: 1076, y: 12, z: 690 }, 0.9), k * 2200);
      }
    }
    // Echo
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const ec = this.echoes[i];
      ec.t -= dt;
      if (ec.t <= 0) { this.sfx.at('amb.truckhorn', { x: ec.x, y: ec.y, z: ec.z }, ec.vol); this.echoes.splice(i, 1); }
    }
    // ---------------- Radio
    let toast: string | null = null;
    if (inVehicle && !this.wasInVehicle) {
      this.station = north || this.map.zoneAt(x, z) === Zone.GatorFlats ? 'swamp' : 'coral';
      toast = this.station === 'swamp' ? '📻 Swamp Radio 101 – Bluesrock & Country aus dem Hinterland' : '📻 Coral 88.1 – Synthwave für die Küstenstraße';
    }
    if (!inVehicle) this.station = null;
    this.wasInVehicle = inVehicle;
    const mountain = okeeBase(x, z) > 20 || zone === Zone.Highlands;
    const radio: Record<string, number> = {
      'radio.swamp': this.station === 'swamp' ? 0.75 : 0,
      'radio.coral': this.station === 'coral' ? (mountain ? 0.45 : 0.75) : 0,
      // Stadtsender in Bergnähe: Rauschen (schwacher Empfang)
      'radio.static': this.station === 'coral' && (mountain || north) ? (mountain ? 0.5 : 0.18) : 0,
    };
    for (const [id, v] of Object.entries(radio) as [LoopId, number][]) {
      let l = this.loops.get(id);
      if (v > 0.01 && !l) { l = e.loop(id, null); this.loops.set(id, l); }
      if (l) l.voice.setVolume(v, 0.4);
    }
    return toast;
  }
}
