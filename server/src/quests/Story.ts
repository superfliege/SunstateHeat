// Hauptgeschichte auf dem Server: Story-Fortschritt pro Spieler (Intro, Rang, Entscheidungen, Wohnorte,
// Crew), Freischaltungen, Abschlussdialoge, Anrufe, Garage/Zuhause, Einkommen und Dev-Befehle.
// Alle Texte und Regeln kommen aus shared/story (JSON); hier wird nur ausgewertet.
import { addRep, type GangId } from '../../../shared/src/gangs';
import { dist2 } from '../../../shared/src/math';
import type { ServerMsg } from '../../../shared/src/protocol';
import { QUEST_BY_ID } from '../../../shared/src/questData';
import type { DialogueLine, QuestDefinition } from '../../../shared/src/quests';
import { CAR_VARIANTS } from '../../../shared/src/sim/handling';
import { snapRoad, type Point } from '../../../shared/src/story/places';
import {
  CREW_IDS, CREW_MISSION, MISSION_META, RACER_MISSION, RACER_RACE, RANKS, STORY, STORY_QUESTS,
  filterLines, fill, freshStory, homeUsable, meets, missionsBy, normalizeStory, rankIndex, rankOf, storyGate,
  unlockedMissions, visibleNpcs, type StoryMission, type StoryProgress,
} from '../../../shared/src/story';
import { VehicleKind } from '../../../shared/src/sim/vehicleDefs';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import type { ServerPlayer } from '../entities/types';

/** Wie nah man an einer Story-Figur bzw. einem Wohnort stehen muss (Server, großzügig wegen Latenz). */
const TALK_RANGE = 9;
const HOME_RANGE = 14;

export interface StoryHost {
  map: WorldMap;
  locations: Record<string, Point>;
  positionOf(p: ServerPlayer): { x: number; z: number; inVehicle: boolean };
  send(p: ServerPlayer, msg: ServerMsg): void;
  notice(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad'): void;
  addMoney(p: ServerPlayer, amount: number, reason: string): void;
  raiseWanted(p: ServerPlayer, level: number): void;
  persist(p: ServerPlayer): void;
  sendLog(p: ServerPlayer): void;
  /** Auftrag direkt starten (ohne Telefon), z. B. Mission 1 nach dem Intro. */
  startQuest(p: ServerPlayer, id: string): boolean;
  teleport(p: ServerPlayer, x: number, z: number): void;
  /** Garagenfahrzeug neben den Spieler stellen; Rückgabe: Fahrzeug-ID. */
  spawnVehicle(kind: number, variant: number, x: number, z: number, a: number): number | null;
  /** Fahrzeug entfernen, falls niemand drinsitzt. */
  removeIfFree(id: number): void;
}

const isStoryId = (id: string) => MISSION_META.has(id);

export class Story {
  private garage = new Map<number, number>();
  private incomeT = new Map<number, number>();

  constructor(private h: StoryHost) {}

  // ------------------------------------------------------------------ Zustand
  /** Beim Login: Spielstand auffüllen; neue Charaktere starten mit dem Intro-Geld. */
  init(p: ServerPlayer) {
    const pr = p.profile;
    pr.story = normalizeStory(pr.story);
    if (!pr.story.intro && pr.xp === 0 && !pr.questsDone.length && pr.playtimeSeconds < 60) pr.money = Math.min(pr.money, STORY.intro.startCash);
    this.refresh(p, false);
  }

  prog(p: Pick<ServerPlayer, 'profile'>): StoryProgress { return (p.profile.story ??= freshStory()); }

  /** Startpunkt beim Login bzw. nach dem K.O.: Busbahnhof (Intro) oder aktuelles Zuhause; null = Standard. */
  spawnPoint(p: Pick<ServerPlayer, 'profile'>): Point | null {
    const s = this.prog(p);
    if (!s.intro) return this.h.locations.busStation;
    if (s.home && homeUsable(s.home, s)) return this.h.locations[STORY.homes[s.home].at] ?? null;
    return null;
  }

  rank(p: ServerPlayer) { return this.prog(p).rank; }

  /** Freischaltungen neu berechnen, Anrufe auslösen und dem Client schicken. */
  private refresh(p: ServerPlayer, persist = true) {
    const s = this.prog(p), done = p.profile.questsDone;
    s.unlocked = unlockedMissions(s, done);
    // „Eine Crew“: komplett, sobald alle drei dabei sind
    if (CREW_IDS.every((c) => s.crew.includes(c)) && !done.includes(CREW_MISSION) && meets(MISSION_META.get(CREW_MISSION)!.when, s, done)) {
      this.markDone(p, CREW_MISSION);
      return;
    }
    // Anrufe für frisch freigeschaltete Missionen (einmalig)
    for (const id of s.unlocked) {
      const m = MISSION_META.get(id)!;
      if (m.call?.length && s.intro && !s.calls.includes(id) && !done.includes(id)) {
        s.calls.push(id);
        this.dialog(p, m.call, 'call');
        this.h.notice(p, `📞 ${STORY.characters[m.giver]?.short ?? m.giver} hat angerufen: „${QUEST_BY_ID.get(id)?.title ?? m.title ?? id}“ – annehmen im Quest-Log (J).`, 'info');
      }
    }
    this.send(p);
    if (persist) this.h.persist(p);
  }

  send(p: ServerPlayer) {
    const s = this.prog(p);
    this.h.send(p, { t: 'story', s: { ...s, done: p.profile.questsDone.filter(isStoryId) } });
  }

  dialog(p: ServerPlayer, lines: DialogueLine[] | undefined, kind: 'talk' | 'radio' | 'call', scene?: string) {
    const ls = filterLines(lines, this.prog(p));
    if (ls.length) this.h.send(p, { t: 'dialog', lines: ls, kind, scene });
  }

  // ------------------------------------------------------------------ Regeln für die Quest-Engine
  gate(p: ServerPlayer, def: QuestDefinition): string {
    return storyGate(def.id, this.prog(p), p.profile.questsDone);
  }

  /** Mitmachen dürfen alle, für die die Mission freigeschaltet ist – und Helfer, die sie schon kennen. */
  canJoin(p: ServerPlayer, def: QuestDefinition): boolean {
    if (!isStoryId(def.id)) return true;
    return p.profile.questsDone.includes(def.id) || !this.gate(p, def);
  }

  /** Auftrag erfolgreich beendet. Story-Folgen gibt es nur beim ersten Mal. */
  completed(p: ServerPlayer, def: QuestDefinition, firstTime: boolean) {
    const m = MISSION_META.get(def.id);
    if (!m || !firstTime) return;
    this.apply(p, m);
    this.refresh(p);
  }

  /** Virtuelle Mission (Rennsieg, Crew komplett) als erledigt markieren und ihre Folgen anwenden. */
  private markDone(p: ServerPlayer, id: string) {
    const m = MISSION_META.get(id);
    if (!m || p.profile.questsDone.includes(id)) return;
    p.profile.questsDone.push(id);
    this.h.notice(p, `Story: „${m.title ?? QUEST_BY_ID.get(id)?.title ?? id}“ erledigt!`, 'good');
    this.apply(p, m);
    this.h.sendLog(p);
    this.refresh(p);
  }

  /** Folgen einer Mission: Rang, Wohnorte, Ruf, Einkommen, Crew, Abschlussdialog, Zwischensequenz. */
  private apply(p: ServerPlayer, m: StoryMission, quiet = false) {
    const s = this.prog(p), e = m.effects ?? {};
    const T = STORY.texts;
    if (!quiet) this.dialog(p, m.outro, m.outroKind ?? 'talk');
    if (e.rank) {
      const r = rankIndex(e.rank);
      if (r > s.rank) {
        s.rank = r;
        if (!quiet) {
          this.h.send(p, { t: 'rankUp', rank: r });
          this.h.notice(p, `${T.rankUp}: ${rankOf(r).icon} ${rankOf(r).name}`, 'good');
        }
      }
    }
    for (const h of e.lockHomes ?? []) {
      if (!s.locked.includes(h)) s.locked.push(h);
      if (!quiet) this.h.notice(p, fill(T.homeLocked, { home: STORY.homes[h].name }), 'bad');
    }
    for (const h of e.unlockHomes ?? []) {
      s.locked = s.locked.filter((x) => x !== h);
      if (!s.homes.includes(h)) {
        s.homes.push(h);
        if (!quiet) this.h.notice(p, fill(T.homeUnlocked, { home: STORY.homes[h].name }), 'good');
      }
    }
    if (e.home && homeUsable(e.home, s)) s.home = e.home;
    if (s.home && !homeUsable(s.home, s)) s.home = s.homes.find((h) => homeUsable(h, s)) ?? null;
    if (e.income) s.income = true;
    for (const [g, d] of Object.entries(e.rep ?? {})) p.profile.reputation = addRep(p.profile.reputation, g as GangId, d as number);
    if (e.crew && !s.crew.includes(e.crew)) {
      s.crew.push(e.crew);
      if (!quiet) this.h.notice(p, fill(T.crewJoined, { name: STORY.characters[e.crew]?.name ?? e.crew }), 'good');
    }
    if (e.scene && !quiet) {
      const sc = STORY.scenes[e.scene];
      if (sc) this.dialog(p, sc.lines, 'talk', e.scene);
    }
  }

  // ------------------------------------------------------------------ Ereignisse
  /** Intro gesehen: Flag setzen und Mission 1 starten (Lous Cabrio steht bereit). */
  introDone(p: ServerPlayer) {
    const s = this.prog(p);
    if (s.intro) return;
    s.intro = true;
    this.refresh(p);
    if (!p.profile.questsDone.includes(STORY.intro.startMission)) this.h.startQuest(p, STORY.intro.startMission);
  }

  /** Straßenrennen beendet (Rennfahrerin: Sieg bei der Cane Ridge Rally). */
  raceFinished(p: ServerPlayer, raceId: string, place: number) {
    if (raceId !== RACER_RACE || place !== 1) return;
    if (this.prog(p).unlocked.includes(RACER_MISSION)) this.markDone(p, RACER_MISSION);
  }

  offerChoice(p: ServerPlayer, id: string) {
    const c = STORY.choices[id];
    if (!c) return;
    this.h.send(p, { t: 'choice', id, who: c.who, prompt: filterLines(c.prompt, this.prog(p)), options: c.options.map((o) => ({ id: o.id, label: o.label })) });
  }

  applyChoice(p: ServerPlayer, id: string, option: string): boolean {
    const c = STORY.choices[id], o = c?.options.find((x) => x.id === option);
    if (!c || !o) return false;
    const s = this.prog(p);
    s.choices[id] = option;
    s.style += o.style;
    if (o.money) this.h.addMoney(p, o.money, `choice:${id}`);
    if (o.wanted) this.h.raiseWanted(p, o.wanted);
    for (const [g, d] of Object.entries(o.rep ?? {})) p.profile.reputation = addRep(p.profile.reputation, g as GangId, d as number);
    this.dialog(p, o.reply, 'talk');
    this.send(p);
    this.h.persist(p);
    return true;
  }

  // ------------------------------------------------------------------ Figuren & Wohnorte
  /** Story-Figur in Reichweite (sichtbar für diesen Spieler). */
  npcNear(p: ServerPlayer, npcId: string) {
    const s = this.prog(p), me = this.h.positionOf(p);
    const n = visibleNpcs(s, p.profile.questsDone).find((x) => x.id === npcId);
    const at = n && this.h.locations[n.at];
    return n && at && dist2(at.x, at.z, me.x, me.z) <= TALK_RANGE * TALK_RANGE ? n : null;
  }

  /** Steht eine sichtbare Figur dieses Charakters in Reichweite? */
  characterNear(p: ServerPlayer, character: string): boolean {
    const s = this.prog(p), me = this.h.positionOf(p);
    return visibleNpcs(s, p.profile.questsDone).some((n) => {
      const at = this.h.locations[n.at];
      return n.character === character && at && dist2(at.x, at.z, me.x, me.z) <= TALK_RANGE * TALK_RANGE;
    });
  }

  /** Aufträge, die eine Figur anbietet: offene Hauptmissionen (freigeschaltet) und freigeschaltete Nebenjobs. */
  offersOf(p: ServerPlayer, character: string): QuestDefinition[] {
    const s = this.prog(p), done = p.profile.questsDone;
    return missionsBy(character)
      .filter((m) => s.unlocked.includes(m.id) || (m.kind === 'main' && !done.includes(m.id) && meets(m.when, s, done)))
      .map((m) => QUEST_BY_ID.get(m.id))
      .filter((q): q is QuestDefinition => !!q && q.giver.type !== 'phone');
  }

  /** Darf der Spieler diesen Auftrag von hier aus annehmen (Figur in der Nähe bzw. Anruf)? */
  acceptOk(p: ServerPlayer, def: QuestDefinition, nearPhone: boolean): boolean {
    if (def.giver.type === 'phone') return this.prog(p).unlocked.includes(def.id);
    const m = MISSION_META.get(def.id);
    if (def.giver.type === 'npc') return this.characterNear(p, def.giver.id);
    return nearPhone || (!!m && this.characterNear(p, m.giver));
  }

  lines(p: ServerPlayer, lines: DialogueLine[]) { return filterLines(lines, this.prog(p)); }

  private homeNear(p: ServerPlayer, id: string): boolean {
    const s = this.prog(p), h = STORY.homes[id], me = this.h.positionOf(p);
    const at = h && this.h.locations[h.at];
    return !!at && homeUsable(id, s) && dist2(at.x, at.z, me.x, me.z) <= HOME_RANGE * HOME_RANGE;
  }

  /** Garagenfahrzeug des Rangs (bzw. des letzten Rangs mit Fahrzeug) bereitstellen. */
  garageVehicle(p: ServerPlayer, homeId: string) {
    if (!this.homeNear(p, homeId)) { this.h.notice(p, 'Du musst an deinem Zuhause stehen.', 'bad'); return; }
    let r = this.prog(p).rank;
    while (r > 0 && !RANKS[r].vehicle) r--;
    const veh = RANKS[r].vehicle;
    if (!veh) { this.h.notice(p, STORY.texts.garageNone, 'info'); return; }
    const old = this.garage.get(p.id);
    if (old !== undefined) this.h.removeIfFree(old);
    const at = this.h.locations[STORY.homes[homeId].at];
    // Am Straßenrand vor dem Wohnort ausparken
    const rd = snapRoad(this.h.map, at.x, at.z), off = Math.max(0, rd.w / 2 - 2);
    const pose = { x: rd.x + Math.cos(rd.a) * off, z: rd.z - Math.sin(rd.a) * off, a: rd.a };
    const kind = veh.kind === 'bike' ? VehicleKind.Bike : VehicleKind.Car;
    const variant = kind === VehicleKind.Bike ? 0 : Math.max(0, CAR_VARIANTS.findIndex((v) => v.model === veh.model));
    const id = this.h.spawnVehicle(kind, variant, pose.x, pose.z, pose.a);
    if (id === null) { this.h.notice(p, 'Kein Platz zum Ausparken.', 'bad'); return; }
    this.garage.set(p.id, id);
    this.h.notice(p, fill(STORY.texts.garage, { vehicle: veh.name }), 'good');
  }

  setHome(p: ServerPlayer, homeId: string) {
    if (!this.homeNear(p, homeId)) { this.h.notice(p, 'Du musst an diesem Wohnort stehen.', 'bad'); return; }
    this.prog(p).home = homeId;
    this.h.notice(p, fill(STORY.texts.homeSet, { home: STORY.homes[homeId].name }), 'good');
    this.send(p);
    this.h.persist(p);
  }

  // ------------------------------------------------------------------ Tick & Aufräumen
  /** Dauerhaftes Einkommen (ab „Erste eigene Lieferung“), nur solange man online ist. */
  update(dt: number, players: Iterable<ServerPlayer>) {
    const inc = STORY.income;
    for (const p of players) {
      const s = p.profile.story;
      if (!s?.income) continue;
      const t = (this.incomeT.get(p.id) ?? 0) + dt;
      if (t < inc.intervalMinutes * 60) { this.incomeT.set(p.id, t); continue; }
      this.incomeT.set(p.id, 0);
      const amount = inc.amount * (s.rank >= RANKS.length - 1 ? inc.bossFactor : 1);
      this.h.addMoney(p, amount, 'story:income');
      this.h.notice(p, fill(inc.text, { amount }), 'good');
    }
  }

  onPlayerLeave(id: number) {
    const v = this.garage.get(id);
    if (v !== undefined) this.h.removeIfFree(v);
    this.garage.delete(id);
    this.incomeT.delete(id);
  }

  // ------------------------------------------------------------------ Dev-Befehle
  /**
   * /story info · reset · intro · rang <1-7|id> · skip · bis <nr> · tp <npc|wohnort|ort>
   * skip: aktiven Story-Auftrag bzw. die nächste Hauptmission sofort abschließen.
   * bis <nr>: alle Hauptmissionen vor Nummer nr (1–12) still als erledigt markieren (inkl. Folgen).
   */
  devCommand(p: ServerPlayer, args: string[], say: (t: string) => void, forceComplete: () => string | null) {
    const s = this.prog(p), done = p.profile.questsDone;
    const [sub, arg] = args;
    // „Eine Crew“ erledigt sich selbst, sobald alle drei angeworben sind – daher nicht direkt überspringen
    const mains = STORY.missions.filter((m) => m.kind === 'main' && m.id !== CREW_MISSION).sort((a, b) => a.order - b.order);
    if (sub === 'reset') {
      p.profile.story = freshStory();
      p.profile.questsDone = done.filter((id) => !isStoryId(id) || MISSION_META.get(id)!.kind === 'side');
      const bus = this.h.locations.busStation;
      this.h.teleport(p, bus.x, bus.z);
      this.h.sendLog(p);
      this.refresh(p);
      say('Story zurückgesetzt – das Intro startet.');
    } else if (sub === 'intro') {
      s.intro = false;
      const bus = this.h.locations.busStation;
      this.h.teleport(p, bus.x, bus.z);
      this.refresh(p);
      say('Intro wird erneut abgespielt.');
    } else if (sub === 'rang' || sub === 'rank') {
      const n = Number(arg);
      const r = Number.isFinite(n) && n >= 1 ? n - 1 : rankIndex(arg ?? '');
      if (r < 0 || r >= RANKS.length) { say('/story rang <1-7|' + RANKS.map((x) => x.id).join('|') + '>'); return; }
      s.rank = r; s.intro = true;
      this.h.send(p, { t: 'rankUp', rank: r });
      this.refresh(p);
    } else if (sub === 'skip') {
      const active = forceComplete();
      if (active) { say(`Auftrag „${active}“ abgeschlossen.`); return; }
      const m = mains.find((x) => !done.includes(x.id) && meets(x.when, s, done));
      if (!m) { say('Keine offene Hauptmission.'); return; }
      s.intro = true;
      if (!done.includes(m.id)) done.push(m.id);
      this.apply(p, m);
      this.h.sendLog(p);
      this.refresh(p);
      say(`Übersprungen: ${m.title ?? QUEST_BY_ID.get(m.id)?.title ?? m.id}`);
    } else if (sub === 'bis' || sub === 'to') {
      const nr = Number(arg);
      if (!Number.isFinite(nr) || nr < 1 || nr > 13) { say('/story bis <1-13> (13 = alles erledigt)'); return; }
      s.intro = true;
      for (const m of mains) {
        if (m.order >= nr || done.includes(m.id)) continue;
        done.push(m.id);
        this.apply(p, m, true);
      }
      this.h.sendLog(p);
      this.refresh(p);
      say(`Story bis Mission ${nr} vorgespult. Rang: ${rankOf(s.rank).name}.`);
    } else if (sub === 'tp') {
      const npc = STORY.npcs.find((n) => n.id === arg || n.character === arg);
      const key = npc?.at ?? (arg && STORY.homes[arg]?.at) ?? arg;
      const at = key ? this.h.locations[key] : undefined;
      if (!at) { say('/story tp <' + [...new Set(STORY.npcs.map((n) => n.character))].join('|') + '|' + Object.keys(STORY.homes).join('|') + '|<Ort>>'); return; }
      this.h.teleport(p, at.x + 2, at.z + 2);
      say(`Teleport: ${key}`);
    } else {
      const next = mains.find((x) => !done.includes(x.id) && meets(x.when, s, done));
      say(`Rang ${s.rank + 1}/${RANKS.length} ${rankOf(s.rank).name} · Intro ${s.intro ? 'ja' : 'nein'} · Zuhause ${s.home ?? '–'} · Crew ${s.crew.join(', ') || '–'} · Stil ${s.style} · nächste: ${next?.id ?? '–'} · Story-Missionen: ${STORY_QUESTS.length}`);
      say('/story info · reset · intro · rang <1-7> · skip · bis <1-13> · tp <figur|wohnort|ort>');
    }
  }
}
