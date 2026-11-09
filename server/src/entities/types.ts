// Server-seitige Entitäten. Nur der Server kennt diese vollständigen Zustände;
// Clients bekommen kompakte Tupel (siehe shared/src/protocol.ts).
import type { ServerMsg } from '../../../shared/src/protocol';
import type { PawnState } from '../../../shared/src/sim/movement';
import type { StuntTracker } from '../../../shared/src/sim/stunts';
import type { SimVehicle } from '../../../shared/src/sim/vehicle';
import type { VehicleSpawn } from '../../../shared/src/world/WorldMap';
import type { PlayerProfile } from '../services/PlayerStore';

/** Abstrakte Verbindung – entkoppelt die Spiellogik vom Transport (ws, später evtl. Colyseus). */
export interface Connection {
  send(msg: ServerMsg): void;
  sendRaw(json: string): void;
  close(): void;
}

/** Was ein Client zuletzt von einer Entität bekommen hat (Delta-Übertragung). */
export interface ClientView {
  veh: Map<number, string>;
  info: Map<number, string>;
  dmg: Map<number, number>; // Schadens-Version
  peds: Map<number, string>;
  props: Map<number, string>;
  /** Zuletzt gesendete Arena-Böden (JSON, Minispiele). */
  floors: string;
}

export interface ServerPlayer {
  id: number;
  name: string;
  color: number; // Index in OUTFIT_COLORS
  conn: Connection;
  pawn: PawnState;
  vehicleId: number; // -1 = zu Fuß
  lastSeq: number; // zuletzt verarbeitete Eingabe
  cmdBudget: number; // Schutz gegen zu viele Eingaben (Speedhack)
  lastChatAt: number;
  profile: PlayerProfile; // vorbereitet für Accounts/Geld/Ruf
  view: ClientView;
  stunts: StuntTracker;
  /** Sekunden, die das Fahrzeug ruhig in einer Werkstatt steht. */
  repairT: number;
  /** Letzte Tasten (Hupe für die Anzeige). */
  buttons: number;
  /** Gesundheit/Rüstung (Spec 7.2); Gesamtwerte liegen zusätzlich im Profil für das Speichern. */
  health: number;
  armor: number;
  /** Sekunden seit dem letzten Schaden (für die Regeneration). */
  sinceHurt: number;
  /** > 0: ausgeknockt, Restzeit bis zum Respawn in Sekunden. */
  downT: number;
  /** > 0: unverwundbar (nach Respawn). */
  invuln: number;
  /** Sekunden bis zum nächsten automatischen Speichern. */
  saveT: number;
  weapon: string;
  /** Sekunden bis zum nächsten Angriff. */
  atkCd: number;
  /** PvP aktiv ("Heißblütig"-Modus, Spec 9.3). */
  pvp: boolean;
  noAmmoCd: number;
  /** F wird gehalten (Quest-Interaktion). */
  hold: boolean;
  /** Fahndung (0–4), Heat-Punkte (siehe Police.HEAT), Sekunden ohne Polizeikontakt, Festnahme-Fortschritt, verzögerte Zeugenmeldungen. */
  wanted: number;
  heat: number;
  searchT: number;
  arrestT: number;
  reports: { t: number; heat: number; /** Mindeststufe */ min: number; /** Zeuge (Ped-ID) */ by?: number }[];
  /** Stufe zuletzt gemeldet (für Aufstiegs-Hinweis). */
  level: number;
}

export const DRIVER_NONE = -1;
export const DRIVER_NPC = -2;
export const DRIVER_COP = -3;

export interface ServerVehicle {
  id: number;
  kind: number;
  color: number;
  sim: SimVehicle;
  driver: number; // DRIVER_NONE, DRIVER_NPC oder Spieler-ID
  home: VehicleSpawn | null; // Parkplatz zum Zurücksetzen (null = Verkehrsauto)
  idleTime: number;
  /** Sekunden ohne Fahrer, seit das Fahrzeug bewegt/beschädigt wurde (verwaiste Autos verschwinden). */
  orphanT?: number;
  /** Beulen [lx, ly, lz, dx, dy, dz, s] – Clients bilden die Verformung daraus nach. */
  dents: number[][];
  /** Zählt bei jeder Schadensänderung hoch (Delta-Übertragung). */
  dmgVer: number;
  /** Tasten des Fahrers (Hupe, Bremslicht kommt aus dem Physik-Zustand). */
  buttons: number;
  /** Polizeiwagen: Spieler-ID, den er verfolgt (sonst undefined). */
  cop?: number;
  /** Quest-Fahrzeug: Tag und Lauf-ID. */
  qtag?: string;
  qrun?: number;
  /** Rennwagen: Renn-ID und Besitzer (Spieler-ID, -1 = KI-Fahrer). */
  race?: number;
  raceOwner?: number;
  /** Kinematisch geführtes Verkehrsauto (true) oder freie Physik. */
  kinematic: boolean;
}
