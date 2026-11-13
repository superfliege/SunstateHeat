// Netzwerkprotokoll zwischen Client und Server (JSON über WebSocket).
// Entitäten werden als kompakte Tupel übertragen, um Bandbreite zu sparen.
// Fahrzeuge, Fußgänger und Props kommen als Delta: nur Einträge, die sich seit dem letzten
// Snapshot an DIESEN Client geändert haben (plus Listen der verschwundenen IDs).
import type { MgHud } from './minigames';
import type { DialogueLine } from './quests';
import type { StoryView } from './story';
import type { FloorNet } from './world/arenaFloor';

/** Bitmaske für Tasten in einem Eingabe-Kommando. */
export const Btn = {
  SPRINT: 1, // Shift: zu Fuß sprinten, im Auto Nitro
  BRAKE: 2, // Leertaste: Handbremse
  UNFLIP: 4, // E im überschlagenen Fahrzeug: aufrichten
  HORN: 8, // H: Hupe
  STRAFE_L: 16, // Q: Helikopter seitwärts links
  STRAFE_R: 32, // R: Helikopter seitwärts rechts
  /** Vom Server/der Prediction gesetzt: ein Pilot sitzt drin (Triebwerk/Rotor laufen). Nicht vom Client. */
  PILOT: 64,
} as const;
// Luftfahrzeuge: SPRINT (Shift) = Steigen, BRAKE (Leertaste) = Sinken bzw. Radbremse am Boden

/**
 * Ein Eingabe-Kommando = ein fester Simulationsschritt (SIM_DT).
 * ax: -1 (links) .. 1 (rechts), ay: -1 (unten/rückwärts) .. 1 (oben/Gas)
 */
export type InputCmd = [seq: number, ax: number, ay: number, buttons: number];

// ---------- Client -> Server ----------
export type ClientMsg =
  /** password: Konto anlegen bzw. anmelden; ohne Passwort = Gast (guestId = lokal gespeicherte Gast-ID). */
  | { t: 'join'; name: string; password?: string; guestId?: string }
  | { t: 'input'; cmds: InputCmd[] }
  | { t: 'use' } // E: ein-/aussteigen
  | { t: 'chat'; text: string }
  /** Angriff mit der gewählten Waffe; aim = Zielwinkel (vorwärts = (sin a, cos a)). */
  | { t: 'attack'; aim: number }
  /** Waffe wählen: slot 1–5 oder dir = nächste/vorherige. */
  | { t: 'weapon'; slot?: number; dir?: number }
  /** Kaufen: Laden-ID + Artikel-Schlüssel (siehe shared/shops.ts). */
  | { t: 'shop'; shop: string; item: string }
  | { t: 'useItem'; id: string }
  /** Missionstelefon benutzen (Liste der Aufträge anfordern) / Auftrag annehmen / abbrechen. */
  | { t: 'phone'; id: string }
  | { t: 'questAccept'; id: string }
  | { t: 'questAbandon' }
  /** Story: Intro fertig angesehen (startet Mission 1), Story-Figur ansprechen, laufendem Koop-Auftrag beitreten. */
  | { t: 'introDone' }
  | { t: 'talk'; npc: string }
  | { t: 'questJoin' }
  /** Entscheidung in einer Mission (Option-ID aus shared/story/story.json → choices). */
  | { t: 'choice'; id: string; option: string }
  /** Am Wohnort: Garagenfahrzeug holen bzw. als Zuhause (Spawnpunkt) wählen. */
  | { t: 'home'; do: 'garage' | 'set'; id: string }
  /** E gedrückt gehalten (Interaktion mit Haltedauer, z. B. Leuchtfeuer). */
  | { t: 'hold'; on: boolean }
  /** Nur Dev-Modus: Handling-Werte live ändern (Server übernimmt sie, damit die Prediction passt). */
  | { t: 'tune'; cls: string; values: Record<string, number>; assists?: Record<string, number> }
  /** Nur Dev-Modus: NPC-Debugdaten (F3 → NPC-Tab) an-/abbestellen. */
  | { t: 'npcDebug'; on: boolean }
  /** Handy (#43): offene Warteräume abfragen, einem beitreten, den eigenen Warteraum starten. */
  | { t: 'lobbies' }
  | { t: 'lobbyJoin'; kind: LobbyKind; id: string }
  | { t: 'lobbyStart' };

/** Warteraum-Art: Minispiel, Straßenrennen, Koop-Auftrag. */
export type LobbyKind = 'mg' | 'race' | 'quest';
/** Offener Warteraum (Handy-Liste). */
export interface LobbyInfo {
  kind: LobbyKind; id: string; title: string;
  /** Namen der Wartenden, Höchstzahl, Sekunden bis zum automatischen Start */
  members: string[]; max: number; t: number;
  /** Beitritt möglich (sonst Grund) */
  ok: boolean; reason: string;
  /** Bin ich schon drin? */
  mine: boolean;
}

// ---------- Server -> Client ----------
/** [id, name, x, z, angle, vehicleId (-1 = zu Fuß), outfitColor, carryingPackage 0/1, höhe (Ragdoll/Fallschirm), 0 / 1 = Ragdoll / 2 = Fallschirm, Waffenindex, Story-Rang] */
export type PlayerTuple = [number, string, number, number, number, number, number, number, number, number, number, number];
/**
 * Fahrzeug-Bewegung: [id, x, z, y, yaw, vx, vz, steer, flags, pitch, roll, vy, rpm/100]
 * flags: VehFlag
 */
export type VehicleTuple = [number, number, number, number, number, number, number, number, number, number, number, number, number];
/** Fahrzeug-Stammdaten (selten geändert): [id, kind, variant, color, driver (-1 frei, -2 NPC, sonst Spieler-ID)] */
export type VehicleInfoTuple = [number, number, number, number, number];
/**
 * [id, x, z, angle, outfitColor, Zustand (0 geht, 1 rennt, 2 schimpft, 3 Polizist), höhe, ragdoll 0/1, Archetyp (-1 keiner),
 *  Act (Animations-ID, siehe npc/scenarios), gemiedener Spieler (Kurzzeitgedächtnis, fehlt = keiner)]
 */
export type PedTuple = [number, number, number, number, number, number, number, number, number?, number?, number?];
/** Verschobenes Prop: [id, x, y, z, qx, qy, qz, qw, flags (1 ruht, 2 Wasserfontäne)] */
/** Aufsammelbarer Gegenstand: [id, x, z, 'money' | Waffen-ID, Betrag/Munition] */
export type PickupTuple = [number, number, number, string, number];
export type PropTuple = [number, number, number, number, number, number, number, number, number];

export const VehFlag = { BRAKE: 1, REVERSE: 2, HANDBRAKE: 4, BOOST: 8, HORN: 16, AIR: 32, STALL: 64 } as const;
/** Fahrer-ID eines Polizeiwagens in den Fahrzeug-Stammdaten. */
export const DRIVER_COP_ID = -3;

/**
 * Ereignisse eines Server-Ticks (nur im Umkreis des Clients):
 *  ['crash', vid, x, y, z, nx, nz, dv, otherVid]   Aufprall (Sound, Funken, Kamera)
 *  ['dent', vid, lx, ly, lz, dx, dy, dz, s]          Blechverformung (lokal, deterministisch nachgebildet)
 *  ['part', vid, part, state]                        Teil wackelt (1) / fällt ab (2)
 *  ['boom', vid, x, y, z]                            Comic-Explosion
 *  ['honk', vid] · ['shout', pedId] · ['eject', playerId] · ['repair', vid]
 *  ['bark', pedId, situation, variante]              Sprechblase (Text: shared/npc/barks.ts)
 *  ['tree', treeIndex, strength] · ['prop', propId, x, y, z, speed]
 */
export type GameEvent = (string | number)[];

export interface QuestView {
  id: string;
  title: string;
  phase: QuestPhase;
  timeLeft: number; // Sekunden
  delivered: number;
  total: number;
  start: [number, number];
  dest: [number, number];
  /** [id, x, z, carrierPlayerId (-1 = liegt am Boden)] */
  packages: [number, number, number, number][];
}
export type QuestPhase = 'idle' | 'active' | 'cooldown';

/** Eigene Werte (privat, nur an den Spieler selbst gesendet). */
export interface PlayerStats {
  hp: number;
  armor: number;
  bank: number;
  level: number;
  /** XP im aktuellen Level / benötigt bis zum nächsten (0 = Höchststufe). */
  xp: number;
  xpNeeded: number;
  /** Sekunden bis zum Respawn, solange ausgeknockt; 0 = bei Bewusstsein. */
  down: number;
  /** Gewählte Waffe, Munition (-1 = unbegrenzt) und besessene Waffen. */
  weapon: string;
  ammo: number;
  owned: string[];
  pvp: boolean;
  /** Rucksack: Gegenstand → Anzahl. */
  inv: Record<string, number>;
  /** Ruf je Gang (-100 … 100). */
  rep: Record<string, number>;
  /** Fahndungsstufe 0–3 und Festnahme-Fortschritt 0–1. */
  wanted: number;
  arrest: number;
}

/** Aktiver Auftrag des Spielers (privat). targets: [x, z, Radius, Art] – Art: 1 Ziel, 2 Checkpoint, 3 Sammelobjekt, 4 Schützling, 5 Gegner, 6 Fahrzeug, 7 Ziellinie (Rennen). */
export interface QuestState {
  id: string;
  title: string;
  stage: string;
  stageIdx: number;
  stageCount: number;
  prog: string;
  /** Restzeit in Sekunden, -1 = kein Zeitlimit */
  timer: number;
  targets: [number, number, number, number][];
  /** Rennen: Startaufstellung – Fahrzeug steht (Client sendet keine Fahreingaben). */
  freeze?: boolean;
  /** Rennen: Countdown-Anzeige (3, 2, 1, 0 = „LOS!“), fehlt = keine Anzeige. */
  count?: number;
  /** Rennen: Platz / Starter, Runde / Runden. */
  race?: { place: number; field: number; lap: number; laps: number };
  /** Catch the Taxi: eigene Rolle – Taxi (unendlich Nitro, darf schießen) oder Jäger (darf nicht schießen). */
  hunt?: 'taxi' | 'hunter';
  /** Fahrzeug-Minispiel (shared/minigames): verbleibende Spieler, Feed, Ergebnis … */
  mg?: MgHud;
  /** Warteraum (#43): wer wartet, Höchstzahl – jeder Teilnehmer kann mit E starten. */
  lobby?: { members: string[]; max: number };
}

export interface PhoneQuest {
  id: string;
  title: string;
  intro: { who: string; text: string }[];
  rewardText: string;
  coop: [number, number];
  ok: boolean;
  reason: string;
}

export interface SnapshotMsg {
  t: 'snap';
  time: number; // Server-Zeit in ms
  day: number; // Tageszeit 0..1 (0 = Mitternacht, 0.5 = Mittag)
  ack: number; // letzte verarbeitete Eingabe-Sequenz DIESES Clients
  /** Eigener Zustand: Fußgänger [x, z, a, h, vx, vy, vz, rt, Fallschirm 0/1], Fahrzeug (packCar) oder null, Geld. */
  me?: { pawn: number[]; veh: number[] | null; /** Mitfahrer in Luftfahrzeug (ID) */ ride?: number; money: number; stats: PlayerStats; quest: QuestState | null; join?: string };
  players: PlayerTuple[];
  /** Geänderte Fahrzeuge / Stammdaten / verschwundene IDs */
  v?: VehicleTuple[];
  vi?: VehicleInfoTuple[];
  vg?: number[];
  /** Schaden (packDamage) geänderter Fahrzeuge: [id, ...] */
  dmg?: number[][];
  /** Vollständige Beulen-Liste für neu sichtbare Fahrzeuge: [id, [lx, ly, lz, dx, dy, dz, s], ...] */
  dents?: [number, number[][]][];
  /** Fußgänger-Delta */
  p?: PedTuple[];
  pg?: number[];
  /** Props-Delta */
  pr?: PropTuple[];
  prg?: number[];
  /** Aufsammelbare Gegenstände (Delta) */
  pk?: PickupTuple[];
  pkg?: number[];
  ev?: GameEvent[];
  /** Arena-Böden der Minispiele – nur bei Änderung (leere Liste = keine Böden mehr). */
  af?: FloorNet[];
  quest: QuestView | null;
}

export type ServerMsg =
  | { t: 'welcome'; id: number; room: string; maxPlayers: number; dev: boolean }
  | SnapshotMsg
  | { t: 'chat'; from: string; text: string; color: number; system?: boolean }
  | { t: 'notice'; text: string; kind: 'info' | 'good' | 'bad' }
  /** Auftragsliste eines Telefons oder einer Story-Figur (npc gesetzt: Gespräch mit talk-Zeilen). */
  | { t: 'phone'; id: string; name: string; quests: PhoneQuest[]; npc?: string; talk?: DialogueLine[] }
  /** Story-Fortschritt (bei Login und jeder Änderung). */
  | { t: 'story'; s: StoryView }
  /** Dialog/Funkspruch/Anruf; scene: Zwischensequenz aus story.json (z. B. Balkon). */
  | { t: 'dialog'; lines: DialogueLine[]; kind: 'talk' | 'radio' | 'call'; scene?: string; title?: string }
  /** Neuer Rang (Banner). */
  | { t: 'rankUp'; rank: number }
  /** Entscheidung anbieten (Mission 3). */
  | { t: 'choice'; id: string; who: string; prompt: DialogueLine[]; options: { id: string; label: string }[] }
  | { t: 'questLog'; done: string[]; cooldowns: Record<string, number> }
  | { t: 'bonus'; kind: string; points: number; money: number; info: string; total: number }
  | { t: 'tune'; cls: string; values: Record<string, number>; assists?: Record<string, number> }
  /** Handy (#43): offene Warteräume */
  | { t: 'lobbies'; list: LobbyInfo[] }
  | { t: 'error'; text: string }
  /** Nur Dev-Modus: NPCs um den Spieler (F3 → NPC-Tab). */
  | { t: 'npcDebug'; peds: NpcDebugPed[]; events: [number, number, number, number, number][]; pop: string };

/** Debug-Ansicht eines NPCs: Archetyp, Absichtskette, Bedürfnisse, Smart Object, Reaktion, Wahrnehmung. */
export interface NpcDebugPed {
  id: number; x: number; z: number; arch: string; act: number;
  chain: string[]; step: number; needs: number[]; obj: string; react: string; goal: [number, number] | null;
  fear: number; lod: number; last: string; seen: string[];
}
