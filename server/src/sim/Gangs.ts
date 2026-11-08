// Gang-NPCs (Spec 10.4, 12): patrouillieren im Revier, verhalten sich abhängig vom Ruf des Spielers.
//   Erzfeind: greift auf Sicht an · Feindlich: greift bei Annäherung < 10 m an · Neutral: ignoriert, wehrt sich
//   Freundlich/Vertraut: hilft im Kampf gegen die Polizei.
// Quest-Gegner (hostile = true) greifen unabhängig vom Ruf an und können ein Ziel (Passant/Fahrzeug) angreifen.
import { GANGS, addRep, repStatus, worstRep, type GangId } from '../../../shared/src/gangs';
import { dist2 } from '../../../shared/src/math';
import { findFootSpot, stepPawn } from '../../../shared/src/sim/movement';
import { WEAPONS } from '../../../shared/src/weapons';
import { Zone, type WorldMap } from '../../../shared/src/world/WorldMap';
import type { ServerPlayer, ServerVehicle } from '../entities/types';
import { wallDistance } from './Combat';
import type { Ped, Pedestrians } from './Pedestrians';

export const ZONE_GANG: Record<number, GangId> = { [Zone.PortCoralia]: 'neon', [Zone.CoralKeys]: 'marlin', [Zone.GatorFlats]: 'mangrove', [Zone.DryPine]: 'dustline' };
/** Outfit-Farbe (Index in OUTFIT_COLORS) je Gang. */
export const GANG_OUTFIT: Record<GangId, number> = { neon: 0, marlin: 11, mangrove: 4, dustline: 7 };
const PISTOL_IDX = Object.keys(WEAPONS).indexOf('pistol');
const SPEED = 7.2;
const PATROL_SPEED = 1.6;
const SHOOT_RANGE = 22;

export interface GangHost {
  map: WorldMap;
  players: Map<number, ServerPlayer>;
  vehicles: Map<number, ServerVehicle>;
  peds: Pedestrians;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  hurtPlayer(p: ServerPlayer, dmg: number): void;
  hurtVehicle(v: ServerVehicle, dmg: number): void;
  emit(x: number, z: number, ev: (string | number)[]): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
}

export class Gangs {
  private spawnT = 0;
  constructor(private h: GangHost) {}

  /** Ein Gang-Mitglied wurde angegriffen: Ruf −5, die Gang in der Nähe wird feindlich (Spec 12.2). */
  provoke(victim: Ped, attacker: ServerPlayer) {
    const gang = victim.gang as GangId;
    if (!gang) return;
    if (!victim.provoked) {
      attacker.profile.reputation = addRep(attacker.profile.reputation, gang, -5);
      this.h.notice(attacker, `${GANGS[gang].name}: Ruf −5`, 'bad');
    }
    for (const o of this.h.peds.peds.values()) {
      if (o.gang === gang && dist2(o.x, o.z, victim.x, victim.z) < 35 * 35) { o.provoked = 20; o.provokedBy = attacker.id; }
    }
  }

  spawnPatrol(gang: GangId, x: number, z: number) {
    const ped = this.h.peds.spawnExt(x, z, { gang, color: GANG_OUTFIT[gang], hp: 50 });
    ped.home = { x, z };
    return ped;
  }

  update(dt: number, night: boolean) {
    this.spawnT -= dt;
    const players = [...this.h.players.values()].filter((p) => p.downT <= 0);
    // Nachschub: je Spieler im Revier ein paar Patrouillen (nachts mehr)
    if (this.spawnT <= 0) {
      this.spawnT = 1.5;
      for (const p of players) {
        const pos = this.h.positionOf(p);
        const gang = ZONE_GANG[this.h.map.zoneAt(pos.x, pos.z)];
        if (!gang) continue;
        let n = 0;
        for (const o of this.h.peds.peds.values()) if (o.gang === gang && !o.run && o.hp > 0 && dist2(o.x, o.z, pos.x, pos.z) < 140 * 140) n++;
        if (n >= (night ? 6 : 4)) continue;
        for (let t = 0; t < 8; t++) {
          const a = Math.random() * Math.PI * 2, r = 55 + Math.random() * 45;
          const spot = findFootSpot(this.h.map, pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 3);
          if (!spot || ZONE_GANG[this.h.map.zoneAt(spot.x, spot.z)] !== gang) continue;
          this.spawnPatrol(gang, spot.x, spot.z);
          break;
        }
      }
    }
    for (const g of this.h.peds.peds.values()) {
      if (!g.ext || !g.gang || g.hp <= 0) continue;
      // Patrouillen weit weg von allen Spielern entfernen
      if (!g.run && players.every((p) => { const q = this.h.positionOf(p); return dist2(q.x, q.z, g.x, g.z) > 175 * 175; })) { this.h.peds.peds.delete(g.id); continue; }
      if (g.rt > 0) continue;
      this.think(g, dt, players);
    }
  }

  private think(g: Ped, dt: number, players: ServerPlayer[]) {
    g.provoked = Math.max(0, g.provoked - dt);
    g.shotCd -= dt;
    const gang = g.gang as GangId;

    // 1) Spezielles Ziel (Quest): Passant oder Fahrzeug angreifen
    if (g.tgt.startsWith('ped:') || g.tgt.startsWith('veh:')) {
      const id = Number(g.tgt.slice(4));
      const tp = g.tgt.startsWith('ped:') ? this.h.peds.peds.get(id) : undefined;
      const tv = g.tgt.startsWith('veh:') ? this.h.vehicles.get(id) : undefined;
      const tx = tp?.x ?? tv?.sim.car.x, tz = tp?.z ?? tv?.sim.car.z;
      if (tx !== undefined && tz !== undefined && (tp ? tp.hp > 0 : !tv!.sim.dmg.wreck)) {
        this.engage(g, tx, tz, dt, () => { if (tp) tp.hp -= 2.5; else if (tv) this.h.hurtVehicle(tv, 6); });
        return;
      }
    }

    // 2) Spieler als Ziel: Aggression nach Ruf (schlechtester Ruf in der Nähe zählt, Spec 12.3)
    const near = players.map((p) => ({ p, pos: this.h.positionOf(p) })).filter((e) => dist2(e.pos.x, e.pos.z, g.x, g.z) < 90 * 90);
    if (near.length) {
      const rep = worstRep(near.map((e) => e.p.profile.reputation[gang] ?? 0));
      const status = repStatus(rep);
      let target: (typeof near)[number] | null = null, td = Infinity;
      for (const e of near) {
        const d = Math.hypot(e.pos.x - g.x, e.pos.z - g.z);
        const mine = repStatus(e.p.profile.reputation[gang] ?? 0);
        const aggressive = g.hostile || mine === 'archenemy' && d < 90 || mine === 'hostile' && d < 10 || (g.provoked > 0 && g.provokedBy === e.p.id);
        if (aggressive && d < td) { td = d; target = e; }
      }
      if (target) {
        this.engage(g, target.pos.x, target.pos.z, dt, () => this.hitPlayer(target!.p));
        return;
      }
      // Freundlich: gegen die Polizei helfen, wenn der Spieler gesucht wird
      if ((status === 'friendly' || status === 'trusted') && near.some((e) => e.p.wanted > 0)) {
        let cop: Ped | null = null, cd = 25 * 25;
        for (const c of this.h.peds.peds.values()) {
          if (!c.cop || c.hp <= 0) continue;
          const d = dist2(c.x, c.z, g.x, g.z);
          if (d < cd) { cd = d; cop = c; }
        }
        if (cop) { this.engage(g, cop.x, cop.z, dt, () => { cop!.hp -= 5; }); return; }
      }
    }

    // 3) Patrouille: im Umkreis des Heimatpunkts umherlaufen
    g.think -= dt;
    if (g.think <= 0) {
      g.think = 3 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2, r = Math.random() * 14;
      g.wx = g.home.x + Math.cos(a) * r; g.wz = g.home.z + Math.sin(a) * r;
    }
    const dx = g.wx - g.x, dz = g.wz - g.z, d = Math.hypot(dx, dz);
    if (d > 1.5) stepPawn(this.h.map, g, dx / d, -dz / d, 0, dt, PATROL_SPEED);
  }

  /** Auf einen Punkt zulaufen und aus mittlerer Entfernung schießen. */
  private engage(g: Ped, tx: number, tz: number, dt: number, fire: () => void) {
    const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz) || 1;
    if (d > 8) stepPawn(this.h.map, g, dx / d, -dz / d, 0, dt, SPEED);
    else g.a = Math.atan2(dx, dz);
    if (d < SHOOT_RANGE && g.shotCd <= 0) {
      g.shotCd = 1.1 + Math.random() * 0.7;
      if (wallDistance(this.h.map, g.x, g.z, Math.atan2(dx, dz), d) < d - 1) return;
      const miss = (Math.random() - 0.5) * 3;
      this.h.emit(g.x, g.z, ['shot', g.id, g.x, g.z, tx + miss, tz + miss, PISTOL_IDX]);
      if (Math.random() < 0.4) fire();
    }
  }

  private hitPlayer(p: ServerPlayer) { this.h.hurtPlayer(p, 6); }
}

