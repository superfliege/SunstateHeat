// Verwaltet alle laufenden Minispiel-Runden (höchstens eine je Modus) und ist die einzige
// Schnittstelle zu WorldRoom – analog zu Races/TaxiHunt: frozen/locked/mayEnter/damageScale,
// Telefon-Liste, Anmeldung, Disconnect, HUD, Boden-Sync und Dev-Befehl /mg.
import type { PhoneQuest, QuestState } from '../../../shared/src/protocol';
import type { CarCollision } from '../../../shared/src/sim/car';
import { isDifficulty, isMinigame, MG_PREFIX, MINIGAMES, type DifficultyId, type MinigameId } from '../../../shared/src/minigames';
import { packFloor } from '../../../shared/src/world/arenaFloor';
import type { ServerPlayer, ServerVehicle } from '../entities/types';
import { MG_MARK, type Minigame, type MinigameHost, type MinigameOptions } from './Minigame';
import { Sumo } from './modes/Sumo';

type Factory = (h: MinigameHost, opts: MinigameOptions) => Minigame;
const FACTORIES: Record<MinigameId, Factory> = {
  sumo: (h, o) => new Sumo(h, o),
};

export class MinigameManager {
  private games = new Map<MinigameId, Minigame>();

  constructor(private h: MinigameHost) {}

  private gameOf(pid: number): Minigame | undefined {
    for (const g of this.games.values()) if (g.has(pid)) return g;
    return undefined;
  }

  has(pid: number) { return !!this.gameOf(pid); }
  /** Spielt gerade aktiv (nicht nur Warteliste/Lobby)? */
  playing(pid: number) { const g = this.gameOf(pid); return !!g && !!g.part(pid); }
  frozen(pid: number) { return !!this.gameOf(pid)?.frozen(pid); }
  locked(pid: number) { return !!this.gameOf(pid)?.locked(pid); }
  mayEnter(pid: number, v: ServerVehicle) { return v.race !== MG_MARK || v.raceOwner === pid; }
  isRequest(id: string) { return id.startsWith(MG_PREFIX) && isMinigame(id.slice(MG_PREFIX.length)); }

  private gameOfVehicle(v: ServerVehicle) {
    if (v.race !== MG_MARK) return undefined;
    for (const g of this.games.values()) if (g.partByVehicle(v.id)) return g;
    return undefined;
  }

  /** Schadensfaktor für Aufprall/Kollision eines Minispiel-Fahrzeugs. */
  damageScale(victim: ServerVehicle, other: ServerVehicle | null) {
    return this.gameOfVehicle(victim)?.damageScale(victim, other) ?? 1;
  }

  /** Nach dem Zusammenstoß zweier Fahrzeuge (WorldRoom.carCrash). */
  onCrash(a: ServerVehicle, b: ServerVehicle, col: CarCollision) {
    const g = this.gameOfVehicle(a);
    if (g && g === this.gameOfVehicle(b)) g.collide(a, b, col);
  }

  // ------------------------------------------------------------------ Telefon
  listing(p: ServerPlayer): PhoneQuest[] {
    const blocked = this.h.blocked(p) || (this.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    return (Object.keys(MINIGAMES) as MinigameId[]).map((id) => {
      const m = MINIGAMES[id], c = m.config, g = this.games.get(id);
      let title = `${m.icon} ${m.name}`;
      let reason = blocked;
      if (g?.phase === 'lobby') {
        title += ` – Anmeldung offen (${g.members.length}/${c.players.maxHumans}, noch ${Math.ceil(g.t)} s)`;
        if (!reason && g.members.length >= c.players.maxHumans) reason = 'Alle Plätze sind belegt.';
      } else if (g) title += ' – Runde läuft (Beitritt für die nächste Runde)';
      const [money, xp] = c.rewards[0] ?? [0, 0];
      return {
        id: MG_PREFIX + id, title,
        intro: [
          ...m.intro.map((text) => ({ who: 'Arenaleiter', text })),
          { who: 'Arenaleiter', text: `${c.players.min}–${c.players.max} Teilnehmer (bis zu ${c.players.maxHumans} Spieler, Rest NPCs) · ${Math.round(c.timeLimit / 60 * 10) / 10} Minuten.` },
        ],
        rewardText: `Sieg: $${money} · ${xp} XP`, coop: [1, c.players.maxHumans], ok: !reason, reason,
      };
    });
  }

  request(p: ServerPlayer, id: string) {
    const mode = id.slice(MG_PREFIX.length);
    if (!isMinigame(mode)) return;
    const why = this.h.blocked(p) || (this.has(p.id) ? 'Du bist bereits angemeldet.' : '');
    if (why) { this.h.notice(p, why, 'bad'); return; }
    const g = this.games.get(mode);
    if (g) { g.join(p); return; }
    this.start(mode, p, {});
  }

  private start(mode: MinigameId, first: ServerPlayer | null, opts: MinigameOptions): Minigame {
    const g = FACTORIES[mode](this.h, opts);
    this.games.set(mode, g);
    g.open(first);
    return g;
  }

  abandon(p: ServerPlayer) {
    const g = this.gameOf(p.id);
    if (!g) return false;
    g.leave(p.id, false);
    return true;
  }

  onPlayerLeave(pid: number) {
    this.gameOf(pid)?.leave(pid, true);
    for (const g of this.games.values()) g.watchers = g.watchers.filter((id) => id !== pid);
  }

  // ------------------------------------------------------------------ Ablauf
  update(dt: number) {
    for (const [mode, g] of this.games) {
      if (!g.update(dt)) continue;
      this.games.delete(mode);
      // Warteliste: nächste Runde direkt mit diesen Spielern öffnen
      const next = g.waiting.map((id) => this.h.players.get(id)).filter((p): p is ServerPlayer => !!p && !this.h.blocked(p));
      if (next.length) {
        const ng = this.start(mode, next[0], {});
        for (const p of next.slice(1)) ng.join(p);
      }
    }
  }

  view(p: ServerPlayer): QuestState | null {
    const g = this.gameOf(p.id) ?? [...this.games.values()].find((q) => q.watchers.includes(p.id));
    return g?.view(p) ?? null;
  }

  /** Arena-Böden als JSON-Text (für den Snapshot, Vergleich je Client). */
  floorsJson(): string {
    const list = this.h.map.floors.map(packFloor);
    return JSON.stringify(list);
  }

  // ------------------------------------------------------------------ Dev
  /**
   * /mg <modus> [anzahl] [leicht|normal|schwer]  – Debug-Runde nur mit NPCs (du schaust zu)
   * /mg <modus> mit [leicht|normal|schwer]        – sofort mit dir + NPCs starten
   * /mg stop                                       – alle Runden abbrechen
   */
  devCommand(p: ServerPlayer, args: string[], say: (t: string) => void) {
    const [mode, a1, a2] = args;
    if (mode === 'stop') {
      for (const g of this.games.values()) g.abort('Runde per Dev-Befehl abgebrochen.');
      say('Alle Minispiele abgebrochen.');
      return;
    }
    if (!mode || !isMinigame(mode)) { say(`/mg <${Object.keys(MINIGAMES).join('|')}> [anzahl|mit] [leicht|normal|schwer] · /mg stop`); return; }
    if (this.games.has(mode)) { say(`${MINIGAMES[mode].name} läuft schon – /mg stop zum Abbrechen.`); return; }
    const diff = [a1, a2].find((x) => x && isDifficulty(x)) as DifficultyId | undefined;
    if (a1 === 'mit') {
      const why = this.h.blocked(p) || (this.has(p.id) ? 'Du bist schon angemeldet.' : '');
      if (why) { say(why); return; }
      this.start(mode, p, { instant: true, difficulty: diff });
      say(`${MINIGAMES[mode].name}: Start mit NPCs${diff ? ` (${diff})` : ''}.`);
      return;
    }
    const n = Math.max(2, Math.min(16, Number(a1) || MINIGAMES[mode].config.players.max));
    const g = this.start(mode, null, { botsOnly: n, difficulty: diff });
    // Zuschauen: zu Fuß an den Zuschauerplatz
    if (!this.has(p.id)) {
      g.watchers.push(p.id);
      const s = g.arena.spectate;
      this.h.placeOnFoot(p, s.x, s.z, Math.atan2(g.arena.cx - s.x, g.arena.cz - s.z));
    }
    say(`${MINIGAMES[mode].name}: Debug-Runde mit ${n} NPCs${diff ? ` (${diff})` : ''} – du schaust vom Ufer aus zu.`);
  }
}
