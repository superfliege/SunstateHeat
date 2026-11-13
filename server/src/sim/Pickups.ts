// Aufsammelbare Gegenstände am Boden (#35, #36): Geld und Waffen, die besiegte NPCs fallen lassen.
// Spieler sammeln sie zu Fuß durch Drüberlaufen ein. Übertragung als Delta im Snapshot (pk/pkg).
import type { Ped } from './Pedestrians';
import type { ServerPlayer } from '../entities/types';
import type { WeaponId } from '../../../shared/src/weapons';
import type { PickupTuple } from '../../../shared/src/protocol';

export interface Pickup {
  id: number;
  x: number; z: number;
  /** 'money' oder eine Waffen-ID */
  kind: 'money' | WeaponId;
  /** Geldbetrag bzw. Munition */
  amount: number;
  /** Restlebensdauer (s) */
  ttl: number;
  /** Kurze Sperre nach dem Fallenlassen (Leiche fällt noch) */
  delay: number;
}

const PICKUP_TTL = 90;
const PICKUP_RADIUS = 1.4;
const MAX_PICKUPS = 200;

export interface PickupHost {
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  giveWeapon(p: ServerPlayer, id: WeaponId, ammo: number): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  /** Steht der Spieler zu Fuß an (x, z)? (null = im Fahrzeug / außer Gefecht) */
  footPos(p: ServerPlayer): { x: number; z: number } | null;
}

export class Pickups {
  readonly items = new Map<number, Pickup>();
  private nextId = 1;
  /** NPCs, deren Beute schon gefallen ist */
  private dropped = new WeakSet<Ped>();

  constructor(private h: PickupHost) {}

  /** Beute eines gerade besiegten NPCs (einmal pro NPC). */
  dropFor(ped: Ped) {
    if (this.dropped.has(ped)) return;
    this.dropped.add(ped);
    const armed = ped.cop > 0 || !!ped.gang || ped.hostile;
    // Geld: Passanten wenig, Gangmitglieder mehr; Polizisten haben keine Brieftasche dabei
    if (ped.cop <= 0) {
      const money = ped.gang ? 20 + Math.floor(Math.random() * 61) : 5 + Math.floor(Math.random() * 36);
      this.add(ped.x + (Math.random() - 0.5) * 0.8, ped.z + (Math.random() - 0.5) * 0.8, 'money', money);
    }
    // Waffe: wer bewaffnet war, lässt sie fallen
    if (armed) {
      const r = Math.random();
      const kind: WeaponId = ped.cop > 0 ? (r < 0.25 ? 'shotgun' : 'pistol') : r < 0.2 ? 'smg' : r < 0.35 ? 'bat' : 'pistol';
      const ammo = kind === 'pistol' ? 12 : kind === 'smg' ? 30 : kind === 'shotgun' ? 6 : 0;
      this.add(ped.x + (Math.random() - 0.5) * 1.2, ped.z + (Math.random() - 0.5) * 1.2, kind, ammo);
    }
  }

  add(x: number, z: number, kind: Pickup['kind'], amount: number) {
    if (this.items.size >= MAX_PICKUPS) {
      // ältesten Gegenstand verwerfen
      let oldest: Pickup | null = null;
      for (const it of this.items.values()) if (!oldest || it.ttl < oldest.ttl) oldest = it;
      if (oldest) this.items.delete(oldest.id);
    }
    const id = this.nextId++;
    this.items.set(id, { id, x, z, kind, amount, ttl: PICKUP_TTL, delay: 0.8 });
  }

  update(dt: number, players: Iterable<ServerPlayer>) {
    for (const it of this.items.values()) {
      it.ttl -= dt;
      it.delay -= dt;
      if (it.ttl <= 0) this.items.delete(it.id);
    }
    for (const p of players) {
      const pos = this.h.footPos(p);
      if (!pos) continue;
      for (const it of this.items.values()) {
        if (it.delay > 0) continue;
        const dx = it.x - pos.x, dz = it.z - pos.z;
        if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;
        this.items.delete(it.id);
        if (it.kind === 'money') {
          this.h.addMoney(p, it.amount, 'loot');
          this.h.notice(p, `+$${it.amount} aufgesammelt.`, 'good');
        } else this.h.giveWeapon(p, it.kind, it.amount);
      }
    }
  }

  tuple(it: Pickup): PickupTuple {
    return [it.id, Math.round(it.x * 100) / 100, Math.round(it.z * 100) / 100, it.kind, it.amount];
  }
}
