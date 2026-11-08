// Verteilt Spieler auf Welt-Instanzen. Ist eine Instanz voll (16 Spieler),
// wird automatisch eine neue erstellt; leere Instanzen werden aufgeräumt.
import { MAP_SEED } from '../../../shared/src/constants';
import { generateWorld } from '../../../shared/src/world/mapgen';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { PlayerStore } from '../services/PlayerStore';
import { WorldRoom } from './WorldRoom';

export class RoomManager {
  private rooms: WorldRoom[] = [];
  private counter = 0;

  constructor(private readonly store: PlayerStore | null = null) {}
  // Die Karte ist unveränderlich und wird von allen Instanzen geteilt.
  private readonly map: WorldMap = generateWorld(MAP_SEED);

  findOrCreateRoom(): WorldRoom {
    const open = this.rooms.find((r) => !r.isFull);
    if (open) return open;
    const room = new WorldRoom(`palmara-${++this.counter}`, this.map, this.store);
    this.rooms.push(room);
    console.log(`[rooms] Neue Instanz ${room.id}`);
    return room;
  }

  /** Leere Instanzen schließen (außer der ersten, damit NPCs weiterlaufen). */
  cleanup() {
    this.rooms = this.rooms.filter((r, i) => {
      if (i > 0 && r.isEmpty) {
        r.dispose();
        console.log(`[rooms] Instanz ${r.id} geschlossen`);
        return false;
      }
      return true;
    });
  }

  /** Alle Spieler aller Instanzen speichern (Herunterfahren). */
  saveAll() { for (const r of this.rooms) r.saveAll(); }

  get stats() {
    return this.rooms.map((r) => ({ id: r.id, players: r.players.size }));
  }
}
