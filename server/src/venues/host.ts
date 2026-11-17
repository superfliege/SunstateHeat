// Schnittstelle der Innenräume (Club, Casino) zur Welt-Instanz (WorldRoom).
import type { GangId } from '../../../shared/src/gangs';
import type { ServerMsg } from '../../../shared/src/protocol';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { ServerPlayer, ServerVehicle } from '../entities/types';
import type { Ped } from '../sim/Pedestrians';

export interface VenueHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  /** Tageszeit 0..1 (0 = Mitternacht) und laufender Spieltag. */
  day(): number;
  dayIndex(): number;
  send(p: ServerPlayer, msg: ServerMsg): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  grantXp(p: ServerPlayer, xp: number): void;
  persist(p: ServerPlayer): void;
  addItem(p: ServerPlayer, id: string, count?: number): boolean;
  addRep(p: ServerPlayer, gang: GangId, delta: number): void;
  level(p: ServerPlayer): number;
  /** Festnahme (Polizei im Innenraum). */
  arrest(p: ServerPlayer): void;
  /** Radiomeldung an alle Spieler der Instanz. */
  radio(text: string): void;
  /** Look-Stil des Spielers (Story-Rang): 'player' (Strand), 'business', 'outdoor' (Arbeitskleidung) … */
  lookStyle(p: ServerPlayer): string;
  spawnCar(kind: number, variant: number, x: number, z: number, a: number, color: number): ServerVehicle;
  removeVehicle(id: number): void;
  /** Spieler zu Fuß an eine Stelle setzen (verlässt ggf. sein Fahrzeug). */
  placeOnFoot(p: ServerPlayer, x: number, z: number, a: number): void;
  /** Welt-NPC für Verfolgungen (Kartenzähler) */
  spawnPed(x: number, z: number, tag: string): Ped;
  movePed(ped: Ped, dx: number, dz: number, speed: number, dt: number): void;
  removePed(id: number): void;
  /** Spieler hat gerade einen Auftrag/ein Rennen/Minispiel (für Hinweise). */
  busy(p: ServerPlayer): boolean;
}
