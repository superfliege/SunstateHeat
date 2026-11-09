// Eine Welt-Instanz mit bis zu 16 Spielern. Der Server ist autoritativ:
// Er wendet die Eingaben der Clients mit derselben Simulation an, die der Client
// für seine Vorhersage nutzt, und verschickt 20x pro Sekunde einen Snapshot.
//
// Fahrzeuge: Raycast-Physik (shared/sim/car.ts) mit echten Massen. Der Server entscheidet
// über Kollisionen zwischen Fahrzeugen, Schaden, Explosionen und zerstörbare Props und
// schickt Ereignisse (Crash, Beule, Teil, Explosion …), die die Clients nachbilden.
// Snapshots sind Deltas mit Interest-Management (Umkreis um den Spieler).
import {
  DAY_LENGTH_MS, ENTER_RADIUS, MAX_CHAT_LENGTH, MAX_PLAYERS_PER_ROOM, NPC_DENSITY, OUTFIT_COLORS, SERVER_TICK_HZ, SIM_DT,
} from '../../../shared/src/constants';
import { clamp, dist2, mulberry32, r2, r3 } from '../../../shared/src/math';
import { Btn, VehFlag, type ClientMsg, type GameEvent, type InputCmd, type PlayerStats, type PlayerTuple, type ServerMsg } from '../../../shared/src/protocol';
import {
  applyImpulse, boxCircle, carInWater, clearStepOut, collideCars, dirToLocal, newStepOut, packCar, pitchRoll, placeCar, toLocal, toWorld,
  type CarCollision, type Impact,
} from '../../../shared/src/sim/car';
import { applyImpact, burstTire, BURN_TIME, EXPLOSION_RADIUS, packDamage, resetDamage } from '../../../shared/src/sim/damage';
import { ASSISTS, CAR_VARIANTS, derive, HANDLING, invalidateHandling, pickCarVariant, TANK_VARIANT, variantInfo } from '../../../shared/src/sim/handling';
import { carBody, findFootSpot, findSwimSpot, footFree, knockPawn, newPawn, stepPawn, PAWN_RADIUS } from '../../../shared/src/sim/movement';
import type { Box } from '../../../shared/src/world/collision';
import { carVsProps, createPropBody, PROP_RESPAWN, PROP_RESPAWN_RANGE, stepPropBody, type PropBody, type PropHit } from '../../../shared/src/sim/props';
import { checkNearMiss, newStuntTracker, updateStunts, type BonusEvent } from '../../../shared/src/sim/stunts';
import { createSimVehicle, defaultVariant, stepSimVehicle } from '../../../shared/src/sim/vehicle';
import { VehicleKind, isWaterVehicle } from '../../../shared/src/sim/vehicleDefs';
import { centroid } from '../../../shared/src/world/geometry';
import { generateProps, TRACK_SPAWN } from '../../../shared/src/world/features';
import type { WorldMap } from '../../../shared/src/world/WorldMap';
import { DRIVER_COP, DRIVER_NONE, DRIVER_NPC, type ClientView, type Connection, type ServerPlayer, type ServerVehicle } from '../entities/types';
import { QuestEngine } from '../quests/QuestEngine';
import { Races } from '../quests/Races';
import { TaxiHunt } from '../quests/TaxiHunt';
import { TAXI_HUNT_ID } from '../../../shared/src/taxiHunt';
import { Gangs, GANG_OUTFIT } from '../sim/Gangs';
import { payphones, questLocations, type PhoneDef } from '../../../shared/src/questLocations';
import { QUEST_BY_ID } from '../../../shared/src/questData';
import { GANG_IDS, type GangId } from '../../../shared/src/gangs';
import { ITEMS, BACKPACK_SLOTS } from '../../../shared/src/items';
import { generateShops, shopCatalog, storeToWorld, MECHANIC_RANGE, RESPRAY_PRICE, SHOP_SERVER_RANGE, type ShopDef } from '../../../shared/src/shops';
import { HEAT, HEAT_LEVELS, MAX_WANTED, Police } from '../sim/Police';
import { CARRY_SLOTS, WEAPONS, type WeaponId } from '../../../shared/src/weapons';
import { aimAssist, dirOf, meleeTarget, shootRay, wallDistance, type Target } from '../sim/Combat';

/** Was ein Treffer erwischen kann. */
interface HitRef { ped?: Ped; player?: ServerPlayer; veh?: ServerVehicle }
import { BALANCE, levelFromXp } from '../../../shared/src/balance';
import { logTransaction } from '../services/Ledger';
import type { PlayerProfile, PlayerStore } from '../services/PlayerStore';
import { Pedestrians, type Ped } from '../sim/Pedestrians';
import { Population } from '../sim/Population';
import { NpcBrain } from '../sim/NpcBrain';
import { Perception } from '../sim/Perception';
import { NpcEv } from '../../../shared/src/npc/reactions';
import { DAY_PARTS, DAY_PART_NAMES, type DayPart, type Weather } from '../../../shared/src/npc/population';
import { Traffic } from '../sim/Traffic';

const CMD_BUDGET_MAX = 24;
const CMD_REFILL_PER_TICK = (1 / SIM_DT / SERVER_TICK_HZ) * 1.15; // 15 % Toleranz für Jitter
const PARKED_RESET_TIME = 60;
const ABANDONED_DESPAWN_TIME = 45;
/** Verwaiste Fahrzeuge (ohne Fahrer) verschwinden nach dieser Zeit, auch wenn Spieler in der Nähe sind. */
const ORPHAN_TIME = 180;
/** … außer ein Spieler steht direkt daneben (sonst verschwindet das Auto vor seiner Nase). */
const ORPHAN_KEEP_RANGE = 12;
const ROCKET_RADIUS = 7;
const ROCKET_IDX = Object.keys(WEAPONS).indexOf('rocket');
/** Interest-Management: Radius, in dem ein Client Fahrzeuge/Fußgänger/Props bekommt. */
const INTEREST = 170;
const DENT_MAX = 48;
/** Fußgänger nur im kleineren Umkreis (sie sind zahlreich und bewegen sich ständig). */
const PED_INTEREST = 110;
const r1 = (v: number) => Math.round(v * 10) / 10;
const GRID = 16;
const weaponNames = Object.keys(WEAPONS);
/** Automatisches Speichern alle 2 Minuten (Spec 19.2). */
const SAVE_INTERVAL = 120;
/** Ab diesem Aufprall-Tempoverlust (m/s) verletzt ein Unfall den Fahrer. */
const CRASH_HURT_DV = 9;
/** Dev-Modus: Live-Tuning erlaubt (nicht im Produktionsstart `npm start`). */
export const DEV = process.env.NODE_ENV !== 'production' && process.env.npm_lifecycle_event !== 'start';

interface PosEvent { x: number; z: number; ev: GameEvent; vid: number }

export class WorldRoom {
  readonly players = new Map<number, ServerPlayer>();
  readonly vehicles = new Map<number, ServerVehicle>();
  private nextId = 1;
  private startedAt = Date.now();
  private readonly traffic: Traffic;
  private readonly peds: Pedestrians;
  private readonly pop: Population;
  private readonly brain: NpcBrain;
  private readonly perception: Perception;
  /** Spieler, die den NPC-Debug-Tab offen haben (nur Dev) */
  private npcDebug = new Set<number>();
  private npcDebugT = 0;
  private readonly quests: QuestEngine;
  private readonly gangs: Gangs;
  private readonly phones: PhoneDef[];
  private readonly police: Police;
  private readonly races: Races;
  private readonly hunt: TaxiHunt;
  private readonly shops: ShopDef[];
  private timer: NodeJS.Timeout;
  private props = new Map<number, PropBody>();
  private propDefs: ReturnType<typeof generateProps>;
  private events: PosEvent[] = [];
  private out = newStepOut();
  private propHits: PropHit[] = [];
  private col: CarCollision = { j: 0, dvA: 0, dvB: 0, x: 0, y: 0, z: 0, nx: 0, nz: 0, vn: 0 };
  private grid = new Map<number, ServerVehicle[]>();
  private bonus: BonusEvent[] = [];
  private treeCd = new Map<number, number>();
  private tupleCache = new Map<number, string>();
  private infoCache = new Map<number, string>();

  constructor(readonly id: string, readonly map: WorldMap, private readonly store: PlayerStore | null = null) {
    this.propDefs = generateProps(map);
    const rnd = mulberry32(4711);
    const placed: { x: number; z: number; a: number; l: number; w: number }[] = [];
    for (const sp of map.vehicleSpawns) {
      let variant = sp.variant ?? defaultVariant(sp.kind, pickCarVariant(rnd()));
      // Am Straßenrand keine Lkw (zu lang für die Parklücken)
      if (sp.variant === undefined && variantInfo(variant).cls === 'truck') variant = 1;
      const sim = createSimVehicle(map, sp.kind, variant, sp.x, sp.z, sp.a);
      // Parklücken, die sich mit einem schon geparkten Fahrzeug überschneiden, bleiben leer
      const l = sim.prof.length, w = sim.prof.width;
      const fx = Math.sin(sp.a), fz = Math.cos(sp.a);
      const overlap = placed.some((o) => {
        const dx = o.x - sp.x, dz = o.z - sp.z;
        if (dx * dx + dz * dz > 100) return false;
        const along = Math.abs(dx * fx + dz * fz), side = Math.abs(dx * fz - dz * fx);
        const par = Math.abs(Math.cos(o.a - sp.a));
        const ol = o.l * par + o.w * (1 - par), ow = o.w * par + o.l * (1 - par);
        return along < (l + ol) / 2 + 0.3 && side < (w + ow) / 2 + 0.15;
      });
      if (overlap) continue;
      placed.push({ x: sp.x, z: sp.z, a: sp.a, l, w });
      sim.car.sleep = 1; // geparkt: schläft bis zur ersten Berührung
      const id = this.allocId();
      this.vehicles.set(id, {
        id, kind: sp.kind, color: sp.color, sim,
        driver: DRIVER_NONE, home: sp, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false,
      });
    }
    this.peds = new Pedestrians(map, () => this.allocId());
    const playerPos = () => [...this.players.values()].map((p) => this.positionOf(p));
    this.brain = new NpcBrain({
      map, peds: this.peds, vehicles: this.vehicles,
      part: () => this.pop.part,
      player: (id) => { const p = this.players.get(id); if (!p) return null; const q = this.positionOf(p); return { x: q.x, z: q.z, veh: q.inVehicle }; },
      players: playerPos,
      bark: (p, sit) => this.perception.bark(p, sit),
      departCar: (v) => { if (!this.traffic.adopt(v)) v.driver = DRIVER_NONE; },
    });
    this.peds.brain = this.brain;
    this.peds.avoid = (ped, dx, dz) => this.avoidVehicles(ped, dx, dz);
    this.pop = new Population(map, this.peds, this.brain, () => this.dayPhase(), playerPos);
    this.perception = new Perception({
      map, peds: this.peds, vehicles: this.vehicles, players: this.players,
      positionOf: (p) => this.positionOf(p),
      emit: (x, z, ev) => this.emit(x, z, ev),
      part: () => this.pop.part, weather: () => this.pop.weather, isNight: () => this.isNight(),
    }, this.brain);
    this.traffic = new Traffic({
      map, vehicles: this.vehicles,
      allocId: () => this.allocId(),
      playerPositions: () => [...this.players.values()].map((p) => this.positionOf(p)),
      pawnPositions: () => [
        ...[...this.players.values()].filter((p) => p.vehicleId < 0).map((p) => p.pawn),
        ...this.peds.peds.values(),
      ],
      stepPhysics: (v, ax, ay, buttons) => this.physicsStep(v, ax, ay, buttons, null),
      driverOut: (v, angry) => this.npcDriverOut(v, angry),
      event: (ev) => { const v = this.vehicles.get(ev[1] as number); if (v) this.emit(v.sim.car.x, v.sim.car.z, ev, v.id); },
    }, Math.round(24 * NPC_DENSITY));
    this.shops = generateShops(map);
    this.police = new Police({
      map, players: this.players, vehicles: this.vehicles, peds: this.peds,
      allocId: () => this.allocId(),
      positionOf: (p) => this.positionOf(p),
      hurtPlayer: (p, dmg) => this.hurtPlayer(p, dmg),
      stepCar: (v, ax, ay) => { const n = Math.round(1 / SERVER_TICK_HZ / SIM_DT); for (let k = 0; k < n; k++) this.physicsStep(v, ax, ay, 0, null); },
      createCopCar: (x, z, a, target, tank) => this.createCopCar(x, z, a, target, tank),
      rocket: (id, x0, z0, x1, z1) => this.tankRocket(id, x0, z0, x1, z1),
      emit: (x, z, ev) => this.emit(x, z, ev),
      notice: (p, text, kind) => p.conn.send({ t: 'notice', text, kind }),
      arrest: (p) => this.arrest(p),
      witness: (ped, p, x, z) => this.perception.onWitness(ped, p, x, z),
      exempt: (p) => this.hunt?.role(p.id) != null,
    });
    this.phones = payphones(map);
    this.gangs = new Gangs({
      map, players: this.players, vehicles: this.vehicles, peds: this.peds,
      positionOf: (p) => this.positionOf(p),
      hurtPlayer: (p, dmg) => this.hurtPlayer(p, dmg),
      hurtVehicle: (v, dmg) => this.damageVehicle(v, dmg),
      emit: (x, z, ev) => this.emit(x, z, ev),
      notice: (p, text, kind) => p.conn.send({ t: 'notice', text, kind }),
    });
    this.quests = new QuestEngine({
      players: this.players, vehicles: this.vehicles, peds: this.peds, map,
      locations: questLocations(map), soloOk: DEV, seed: 4242,
      positionOf: (p) => this.positionOf(p),
      isNight: () => this.isNight(),
      notice: (p, text, kind) => p.conn.send({ t: 'notice', text, kind }),
      spawnVehicle: (kind, variant, x, z, a) => {
        const sim = createSimVehicle(map, kind, variant, x, z, a);
        const id = this.allocId();
        const v: ServerVehicle = { id, kind, color: Math.floor(Math.random() * 10), sim, driver: DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false };
        this.vehicles.set(id, v);
        return v;
      },
      removeVehicle: (id) => { this.vehicles.delete(id); },
      spawnEnemy: (gang, x, z, o) => this.peds.spawnExt(x, z, { gang, color: GANG_OUTFIT[gang as GangId], hp: 50, hostile: true, tag: o.tag, run: o.run, tgt: o.tgt }),
      spawnNpc: (x, z, o) => this.peds.spawnExt(x, z, { gang: '', color: 5, hp: o.hp, tag: o.tag, run: o.run }),
      nearestTraffic: (x, z, maxR) => {
        let best: ServerVehicle | null = null, bd = maxR * maxR;
        for (const v of this.vehicles.values()) {
          if (v.driver !== DRIVER_NPC || v.qrun || v.race !== undefined) continue;
          const d = dist2(v.sim.car.x, v.sim.car.z, x, z);
          if (d < bd) { bd = d; best = v; }
        }
        return best;
      },
      addMoney: (p, amount, reason) => this.addMoney(p, amount, reason),
      grantXp: (p, xp) => this.grantXp(p, xp),
      persist: (p) => this.persist(p),
      raiseWanted: (p, level) => this.police.raise(p, level),
      sendLog: (p) => this.sendQuestLog(p),
    });
    this.races = new Races({
      map, players: this.players, vehicles: this.vehicles,
      positionOf: (p) => this.positionOf(p),
      notice: (p, text, kind) => p.conn.send({ t: 'notice', text, kind }),
      chat: (p, text) => p.conn.send({ t: 'chat', from: 'Rennleiter', text, color: 8, system: true }),
      blocked: (p) => {
        if (p.downT > 0) return 'Du bist ausgeknockt.';
        if (this.quests.isActive(p.id)) return 'Erst den aktiven Auftrag beenden.';
        if (this.hunt.has(p.id)) return 'Du spielst gerade Catch the Taxi.';
        if (p.wanted > 0) return 'Nicht mit der Polizei im Nacken!';
        return '';
      },
      spawnCar: (variant, x, z, a, ai) => {
        const sim = createSimVehicle(map, VehicleKind.Car, variant, x, z, a);
        const id = this.allocId();
        const v: ServerVehicle = {
          id, kind: VehicleKind.Car, color: Math.floor(Math.random() * 10), sim,
          driver: ai ? DRIVER_NPC : DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false,
        };
        this.vehicles.set(id, v);
        return v;
      },
      seat: (p, v) => this.seatPlayer(p, v),
      clearArea: (x, z, r, keep) => this.clearArea(x, z, r, keep),
      removeVehicle: (id) => { const v = this.vehicles.get(id); if (v && v.driver < 0) this.vehicles.delete(id); },
      stepAi: (v, ax, ay, buttons) => { v.buttons = buttons & Btn.HORN; this.physicsStep(v, ax, ay, buttons, null); },
      addMoney: (p, amount, reason) => this.addMoney(p, amount, reason),
      grantXp: (p, xp) => this.grantXp(p, xp),
      persist: (p) => this.persist(p),
    });
    const huntPhone = this.phones.find((ph) => ph.taxi) ?? { x: map.spawn.x, z: map.spawn.z };
    this.hunt = new TaxiHunt({
      map, players: this.players, vehicles: this.vehicles,
      start: { x: huntPhone.x, z: huntPhone.z },
      positionOf: (p) => this.positionOf(p),
      notice: (p, text, kind) => p.conn.send({ t: 'notice', text, kind }),
      chat: (p, text) => p.conn.send({ t: 'chat', from: 'Dispatcher', text, color: 8, system: true }),
      blocked: (p) => {
        if (p.downT > 0) return 'Du bist ausgeknockt.';
        if (this.quests.isActive(p.id)) return 'Erst den aktiven Auftrag beenden.';
        if (this.races.has(p.id)) return 'Du bist für ein Rennen angemeldet.';
        if (p.wanted > 0) return 'Nicht mit der Polizei im Nacken!';
        return '';
      },
      spawnCar: (variant, x, z, a, ai, color) => {
        const sim = createSimVehicle(map, VehicleKind.Car, variant, x, z, a);
        const id = this.allocId();
        const v: ServerVehicle = {
          id, kind: VehicleKind.Car, color, sim,
          driver: ai ? DRIVER_NPC : DRIVER_NONE, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false,
        };
        this.vehicles.set(id, v);
        return v;
      },
      seat: (p, v) => this.seatPlayer(p, v),
      placeOnFoot: (p, x, z, a) => {
        const old = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
        if (old && old.driver === p.id) { old.driver = DRIVER_NONE; old.buttons = 0; old.idleTime = 0; }
        p.vehicleId = -1;
        p.pawn = newPawn(x, z, a);
      },
      clearArea: (x, z, r, keep) => this.clearArea(x, z, r, keep),
      removeVehicle: (id) => {
        const v = this.vehicles.get(id);
        if (!v) return;
        if (v.driver >= 0) { const p = this.players.get(v.driver); if (p && p.vehicleId === id) { p.vehicleId = -1; p.pawn = newPawn(v.sim.car.x, v.sim.car.z, v.sim.car.a); } }
        this.vehicles.delete(id);
      },
      stepAi: (v, ax, ay, buttons) => { v.buttons = buttons & Btn.HORN; this.physicsStep(v, ax, ay, buttons, null); },
      addMoney: (p, amount, reason) => this.addMoney(p, amount, reason),
      grantXp: (p, xp) => this.grantXp(p, xp),
      persist: (p) => this.persist(p),
    });
    this.timer = setInterval(() => this.tick(1 / SERVER_TICK_HZ), 1000 / SERVER_TICK_HZ);
  }

  /** Spieler in ein Fahrzeug setzen (verlässt ein evtl. aktuelles Fahrzeug). */
  private seatPlayer(p: ServerPlayer, v: ServerVehicle) {
    const old = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    if (old && old !== v) { old.driver = DRIVER_NONE; old.buttons = 0; old.idleTime = 0; }
    v.driver = p.id; v.idleTime = 0; v.sim.car.sleep = 0;
    p.vehicleId = v.id;
    p.pawn.x = v.sim.car.x; p.pawn.z = v.sim.car.z; p.pawn.a = v.sim.car.a;
    p.stunts = newStuntTracker();
  }

  /** Verkehr/freie Fahrzeuge im Umkreis entfernen (Startaufstellung freiräumen). */
  private clearArea(x: number, z: number, r: number, keep: Set<number>) {
    for (const v of [...this.vehicles.values()]) {
      if (keep.has(v.id) || v.driver >= 0 || v.cop !== undefined || v.race !== undefined || v.qrun) continue;
      if (dist2(v.sim.car.x, v.sim.car.z, x, z) > r * r) continue;
      if (v.home) { placeCar(this.map, v.sim.car, v.sim.prof, v.home.x, v.home.z, v.home.a); v.sim.car.sleep = 1; } // geparkt: zurück auf den Parkplatz
      else this.vehicles.delete(v.id);
    }
  }

  get isFull() { return this.players.size >= MAX_PLAYERS_PER_ROOM; }
  get isEmpty() { return this.players.size === 0; }

  allocId() { return this.nextId++; }

  positionOf(p: ServerPlayer) {
    const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    return v ? { x: v.sim.car.x, z: v.sim.car.z, inVehicle: true } : { x: p.pawn.x, z: p.pawn.z, inVehicle: false };
  }

  private emit(x: number, z: number, ev: GameEvent, vid = -1) {
    this.events.push({ x, z, ev, vid });
    this.perception?.fromGameEvent(x, z, ev);
  }

  // ------------------------------------------------------------------ Spieler kommen & gehen
  addPlayer(conn: Connection, requestedName: string, profile: PlayerProfile): ServerPlayer {
    // Namen eindeutig machen
    let name = requestedName;
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${requestedName}${n}`;
    // Erste freie Outfit-Farbe
    const used = new Set([...this.players.values()].map((p) => p.color));
    let color = 0;
    while (used.has(color) && color < OUTFIT_COLORS.length - 1) color++;

    const ang = Math.random() * Math.PI * 2;
    // Letzte Position wiederherstellen (falls begehbar), sonst Standard-Spawn
    let start = { x: this.map.spawn.x + Math.cos(ang) * 6, z: this.map.spawn.z + Math.sin(ang) * 6 };
    if (profile.pos) start = findFootSpot(this.map, profile.pos.x, profile.pos.z, 8) ?? start;
    profile.weapons ??= {};
    profile.questsDone ??= [];
    profile.questCooldowns ??= {};
    // Startausrüstung: neue (und bisher unbewaffnete) Spieler bekommen eine Pistole zum Testen
    if (Object.keys(profile.weapons).length === 0) profile.weapons.pistol = 48;
    if (!profile.inventory || Array.isArray(profile.inventory)) profile.inventory = {};
    const view: ClientView = { veh: new Map(), info: new Map(), dmg: new Map(), peds: new Map(), props: new Map() };
    const player: ServerPlayer = {
      id: this.allocId(), name, color, conn,
      pawn: newPawn(start.x, start.z, Math.PI),
      vehicleId: -1, lastSeq: 0, cmdBudget: CMD_BUDGET_MAX, lastChatAt: 0, profile,
      view, stunts: newStuntTracker(), repairT: 0, buttons: 0,
      health: profile.health > 0 ? Math.min(profile.health, BALANCE.player.maxHealth) : BALANCE.player.maxHealth,
      armor: Math.min(profile.armor, BALANCE.player.maxArmor),
      weapon: 'pistol' in profile.weapons ? 'pistol' : 'fists', hold: false, atkCd: 0, pvp: false, noAmmoCd: 0, wanted: 0, heat: 0, searchT: 0, arrestT: 0, reports: [],
      sinceHurt: 99, downT: 0, invuln: BALANCE.player.spawnProtection, saveT: SAVE_INTERVAL,
      level: levelFromXp(profile.xp).level,
    };
    this.players.set(player.id, player);
    conn.send({ t: 'welcome', id: player.id, room: this.id, maxPlayers: MAX_PLAYERS_PER_ROOM, dev: DEV });
    this.systemChat(`${name} ist in Palmara angekommen.`);
    this.sendQuestLog(player);
    return player;
  }

  /** Schreibt den Laufzeitzustand ins Profil und übergibt es dem Speicher (asynchron, blockiert den Tick nie). */
  persist(p: ServerPlayer) {
    const pr = p.profile;
    pr.health = p.downT > 0 ? BALANCE.player.maxHealth : Math.max(1, Math.round(p.health));
    pr.armor = Math.round(p.armor);
    const pos = this.positionOf(p);
    pr.pos = { x: r2(pos.x), z: r2(pos.z) };
    this.store?.save(pr);
  }

  removePlayer(player: ServerPlayer) {
    if (!this.players.has(player.id)) return;
    this.persist(player);
    const v = this.vehicles.get(player.vehicleId);
    if (v) { v.driver = DRIVER_NONE; v.buttons = 0; }
    this.quests.onPlayerLeave(player.id);
    this.races.onPlayerLeave(player.id);
    this.hunt.onPlayerLeave(player.id);
    this.players.delete(player.id);
    this.systemChat(`${player.name} hat das Spiel verlassen.`);
  }

  // ------------------------------------------------------------------ Nachrichten
  handleMessage(player: ServerPlayer, msg: ClientMsg) {
    switch (msg.t) {
      case 'input': if (Array.isArray(msg.cmds)) this.applyInputs(player, msg.cmds); break;
      case 'use': this.toggleVehicle(player); break;
      case 'chat': this.chat(player, msg.text); break;
      case 'attack': if (typeof msg.aim === 'number' && Number.isFinite(msg.aim)) this.attack(player, msg.aim); break;
      case 'weapon': this.equip(player, msg.slot, msg.dir); break;
      case 'hold': player.hold = !!msg.on; break;
      case 'phone': if (typeof msg.id === 'string') this.openPhone(player, msg.id); break;
      case 'questAccept': if (typeof msg.id === 'string') this.acceptQuest(player, msg.id); break;
      case 'questAbandon': if (!this.races.abandon(player) && !this.hunt.abandon(player)) this.quests.abandon(player); break;
      case 'shop': if (typeof msg.shop === 'string' && typeof msg.item === 'string') this.buy(player, msg.shop, msg.item); break;
      case 'useItem': if (typeof msg.id === 'string') this.useItem(player, msg.id); break;
      case 'tune': if (DEV) this.tune(msg); break;
      case 'npcDebug': if (DEV) { if (msg.on) this.npcDebug.add(player.id); else this.npcDebug.delete(player.id); } break;
    }
  }

  /** Dev: Handling-Werte live übernehmen und an alle Clients verteilen (Prediction bleibt synchron). */
  private tune(msg: Extract<ClientMsg, { t: 'tune' }>) {
    const prof = (HANDLING as unknown as Record<string, Record<string, number>>)[msg.cls];
    if (prof) for (const [k, v] of Object.entries(msg.values ?? {})) if (typeof prof[k] === 'number' && Number.isFinite(v)) prof[k] = v;
    const a = ASSISTS as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(msg.assists ?? {})) if (typeof a[k] === 'number' && Number.isFinite(v)) a[k] = v;
    invalidateHandling();
    this.broadcast(msg as unknown as ServerMsg);
  }

  /** Fahrzeuge in der Nähe einer Figur als feste Körper (Figuren laufen nicht mehr hindurch). */
  private bodiesNear(x: number, z: number): Box[] {
    const out = this.bodyTmp;
    let n = 0;
    for (const v of this.nearVehicles(x, z)) {
      if (isWaterVehicle(v.kind)) continue;
      const c = v.sim.car;
      if ((c.x - x) ** 2 + (c.z - z) ** 2 > 12 * 12) continue;
      out[n] = carBody(c.x, c.z, c.a, v.sim.prof.width, v.sim.prof.length, out[n]);
      n++;
    }
    out.length = n;
    return out;
  }
  private bodyTmp: Box[] = [];

  private applyInputs(p: ServerPlayer, cmds: InputCmd[]) {
    const bodies = p.vehicleId < 0 ? this.bodiesNear(p.pawn.x, p.pawn.z) : undefined;
    for (const c of cmds.slice(0, 40)) {
      if (!Array.isArray(c) || c.length < 4) continue;
      const [seq, ax, ay, buttons] = c;
      if (typeof seq !== 'number' || seq <= p.lastSeq) continue;
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || typeof buttons !== 'number') continue;
      if (p.cmdBudget < 1) break; // zu viele Eingaben -> verwerfen
      p.cmdBudget -= 1;
      const cx = clamp(ax, -1, 1), cy = clamp(ay, -1, 1);
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      p.buttons = buttons;
      if (p.downT > 0) { p.lastSeq = seq; continue; } // ausgeknockt: Eingaben werden ignoriert
      if (v && (this.races.frozen(p.id) || this.hunt.frozen(p.id))) { this.physicsStep(v, 0, 0, Btn.BRAKE, p); p.lastSeq = seq; continue; } // Startaufstellung
      if (v && this.hunt.nitro(p.id)) v.sim.car.nitro = 1; // Catch the Taxi: unendlich Nitro
      if (v) {
        v.buttons = buttons;
        this.physicsStep(v, cx, cy, buttons, p);
      } else stepPawn(this.map, p.pawn, cx, cy, buttons, SIM_DT, undefined, bodies, true);
      p.lastSeq = seq;
    }
  }

  /** E-Taste: aussteigen, oder ins nächste freie Fahrzeug einsteigen. */
  private toggleVehicle(p: ServerPlayer) {
    if (p.downT > 0) return;
    const current = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    if (current && (this.races.frozen(p.id) || this.hunt.locked(p.id))) return; // Startaufstellung / Catch the Taxi: sitzen bleiben
    if (current) {
      const s = current.sim.car;
      const fx = Math.sin(s.a), fz = Math.cos(s.a);
      const rx = -fz, rz = fx;
      const side = current.sim.prof.width / 2 + 1.2, end = current.sim.prof.length / 2 + 1.2;
      // Bevorzugt links (Fahrerseite), dann rechts, hinten, vorne, dann irgendwo in der Nähe
      const candidates = [[-rx * side, -rz * side], [rx * side, rz * side], [-fx * end, -fz * end], [fx * end, fz * end]];
      let spot: { x: number; z: number } | null = null;
      for (const [dx, dz] of candidates) {
        const c = findFootSpot(this.map, s.x + dx, s.z + dz, 0);
        if (c) { spot = c; break; }
      }
      spot ??= findFootSpot(this.map, s.x, s.z, 9);
      // Versunkenes Auto: im Wasser aussteigen und schwimmen
      if (carInWater(this.map, s)) spot = findSwimSpot(this.map, s.x, s.z, 3) ?? spot;
      if (!spot) {
        p.conn.send({ t: 'notice', text: 'Hier kannst du nicht aussteigen – fahr näher ans Ufer.', kind: 'bad' });
        return;
      }
      current.driver = DRIVER_NONE;
      current.idleTime = 0;
      current.buttons = 0;
      p.vehicleId = -1;
      p.pawn = newPawn(spot.x, spot.z, s.a);
      return;
    }
    if (p.pawn.rt > 0) return; // liegt gerade am Boden

    // Einsteigen: nächstes Fahrzeug, das nicht von einem anderen Spieler gefahren wird
    let best: ServerVehicle | null = null;
    let bestD = Infinity;
    for (const v of this.vehicles.values()) {
      if (v.driver >= 0 || v.driver === DRIVER_COP || v.sim.dmg.wreck || !this.races.mayEnter(p.id, v) || !this.hunt.mayEnter(p.id, v)) continue;
      const reach = ENTER_RADIUS + v.sim.prof.length / 2.4;
      const d = dist2(v.sim.car.x, v.sim.car.z, p.pawn.x, p.pawn.z);
      if (d < reach * reach && d < bestD) { best = v; bestD = d; }
    }
    if (!best) return;
    if (best.driver === DRIVER_NPC) {
      // Verkehrsauto übernehmen: Fahrer springt raus und rennt weg
      this.traffic.release(best.id);
      const s = best.sim.car;
      const spot = findFootSpot(this.map, s.x + Math.cos(s.a) * 2.6, s.z - Math.sin(s.a) * 2.6, 6);
      if (spot) this.perception.bark(this.peds.spawnFleeing(spot.x, spot.z), 'car_stolen');
    }
    // Autodiebstahl: Fahrer herausziehen bzw. geparktes Auto knacken (nur mit Zeugen ein Verbrechen)
    if (best.home || best.driver === DRIVER_NPC) {
      this.perception.event(NpcEv.Theft, best.sim.car.x, best.sim.car.z, p.id);
      this.police.crime(p, HEAT.theft, best.sim.car.x, best.sim.car.z);
    }
    best.driver = p.id;
    best.idleTime = 0;
    best.kinematic = false;
    best.sim.car.sleep = 0;
    p.vehicleId = best.id;
    p.stunts = newStuntTracker();
  }

  private chat(p: ServerPlayer, raw: unknown) {
    if (typeof raw !== 'string') return;
    const now = Date.now();
    if (now - p.lastChatAt < 700) return; // Spam-Schutz
    // Steuerzeichen entfernen, kürzen
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_CHAT_LENGTH);
    if (!text) return;
    p.lastChatAt = now;
    if (/^\/pvp(\s|$)/i.test(text)) {
      const on = /\bon\b/i.test(text);
      p.pvp = on;
      p.conn.send({ t: 'notice', text: on ? 'Heißblütig-Modus AN: Du kannst von anderen PvP-Spielern verletzt werden.' : 'Heißblütig-Modus aus.', kind: 'info' });
      return;
    }
    if (DEV && text.startsWith('/')) { this.devCommand(p, text); return; }
    this.broadcast({ t: 'chat', from: p.name, text, color: p.color });
  }

  /** Dev-Befehle zum Testen/Tunen: /test, /laden <typ>, /auto <klasse>, /reparieren, /feuer */
  private devShopIdx = -1;
  private devCommand(p: ServerPlayer, text: string) {
    const [cmd, arg] = text.slice(1).toLowerCase().split(/\s+/);
    const say = (t: string) => p.conn.send({ t: 'notice', text: t, kind: 'info' });
    const current = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    if (cmd === 'test') {
      const { x, z, a } = TRACK_SPAWN;
      if (current) { placeCar(this.map, current.sim.car, current.sim.prof, x, z, a); current.dmgVer++; }
      else p.pawn = newPawn(x, z, a);
      say('Willkommen im Testgelände: Drift-Pad, Slalom, Rampen, Untergründe, Crash-Wände. Werkstatt in der Ecke.');
    } else if (cmd === 'auto' || cmd === 'car') {
      const names: Record<string, number> = {
        kompakt: 0, compact: 0, limousine: 1, sedan: 1, kombi: 2, taxi: 3, sport: 4, muscle: 5, suv: 6, pickup: 7, truck: 8, lkw: 8, bike: 100, motorrad: 100, polizei: 1,
        coupe: 10, gt: 10, hornet: 11, jeep: 12, luxus: 13, van: 14, lieferwagen: 15, muellwagen: 16, kipper: 17, krankenwagen: 18, feuerwehr: 19, cab: 20, racer: 21,
      };
      const variant = arg && arg in names ? names[arg] : Math.floor(Math.random() * CAR_VARIANTS.length);
      const kind = variant === 100 ? VehicleKind.Bike : VehicleKind.Car;
      const pos = this.positionOf(p);
      if (current) { current.driver = DRIVER_NONE; current.buttons = 0; }
      const a = current ? current.sim.car.a : p.pawn.a;
      const x = pos.x + Math.sin(a) * (current ? 8 : 3), z = pos.z + Math.cos(a) * (current ? 8 : 3);
      const id = this.allocId();
      const sim = createSimVehicle(this.map, kind, variant, x, z, a);
      this.vehicles.set(id, { id, kind, color: Math.floor(Math.random() * 10), sim, driver: p.id, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false });
      p.vehicleId = id;
      p.stunts = newStuntTracker();
      say(`${sim.prof.name} bereitgestellt.`);
    } else if (cmd === 'waffe' || cmd === 'weapon') {
      const ids = arg === 'alle' || arg === 'all' ? (Object.keys(WEAPONS) as WeaponId[]) : arg && arg in WEAPONS ? [arg as WeaponId] : [];
      if (!ids.length) say('/waffe <' + Object.keys(WEAPONS).join('|') + '|alle>');
      for (const id of ids) this.giveWeapon(p, id, WEAPONS[id].ammoPack * 3);
    } else if (cmd === 'fahndung' || cmd === 'wanted') {
      const lvl = Math.max(0, Math.min(MAX_WANTED, Number(arg) || 0));
      this.police.clear(p);
      if (lvl > 0) this.police.raise(p, lvl);
    } else if (cmd === 'rennen' || cmd === 'race') {
      // Zum Renntelefon teleportieren (1–3)
      const list = this.phones.filter((ph) => ph.race);
      const ph = list[Math.max(0, Math.min(list.length - 1, (Number(arg) || 1) - 1))];
      if (!ph || this.races.has(p.id)) return;
      if (current) { current.driver = DRIVER_NONE; current.buttons = 0; p.vehicleId = -1; }
      p.pawn = newPawn(ph.x, ph.z, 0);
      say(`${ph.name} – F drücken zum Starten.`);
    } else if (cmd === 'taxi') {
      // Zum Catch-the-Taxi-Telefon am Spawn
      const ph = this.phones.find((q) => q.taxi);
      if (!ph || this.hunt.has(p.id)) return;
      if (current) { current.driver = DRIVER_NONE; current.buttons = 0; p.vehicleId = -1; }
      p.pawn = newPawn(ph.x, ph.z, 0);
      say(`${ph.name} – F drücken zum Starten.`);
    } else if (cmd === 'hurt') {
      this.hurtPlayer(p, Number(arg) || 30);
    } else if (cmd === 'xp') {
      this.grantXp(p, Number(arg) || 100);
    } else if (cmd === 'geld' || cmd === 'cash') {
      this.addMoney(p, Number(arg) || 1000, 'dev');
    } else if ((cmd === 'reparieren' || cmd === 'repair') && current) {
      this.repair(current);
    } else if (cmd === 'laden' || cmd === 'shop') {
      // Zum nächsten Laden des Typs (wiederholt aufrufen = reihum): vor die Tür bzw. zum Mechaniker
      const list = this.shops.filter((s) => !arg || s.type === arg);
      if (!list.length) { say('/laden <sunmart|gas|ammo|paint>'); return; }
      const s = list[(this.devShopIdx = (this.devShopIdx + 1) % list.length)];
      const [x, z] = s.building ? storeToWorld(s, 0, 6.5) : [s.keeper.x + Math.sin(s.keeper.a) * 4, s.keeper.z + Math.cos(s.keeper.a) * 4];
      const a = Math.atan2(s.x - x, s.z - z);
      if (current) { placeCar(this.map, current.sim.car, current.sim.prof, x, z, a); current.dmgVer++; }
      else p.pawn = newPawn(x, z, a);
      say(`${s.name} (${s.keeper.name})`);
    } else if (cmd === 'tp') {
      // Zu einem Viertel teleportieren: /tp havana (Teil des Namens), ohne Argument = Liste
      const rest = text.slice(1).toLowerCase().split(/\s+/).slice(1).join(' ');
      const d = rest ? this.map.districts.find((dd) => dd.name.toLowerCase().includes(rest)) : undefined;
      if (!d) { say('/tp <' + this.map.districts.map((dd) => dd.name).join('|') + '>'); return; }
      const [cx, cz] = centroid(d.poly);
      // nächster Punkt auf einer Straße, damit man nicht in einem Gebäude landet
      let bx = cx, bz = cz, bd = Infinity;
      for (const e of this.map.edges) for (const q of e.pts) {
        const dd = Math.hypot(q[0] - cx, q[1] - cz);
        if (dd < bd) { bd = dd; bx = q[0]; bz = q[1]; }
      }
      if (current) { placeCar(this.map, current.sim.car, current.sim.prof, bx, bz, 0); current.dmgVer++; }
      else p.pawn = newPawn(bx, bz, 0);
      say(d.name);
    } else if (cmd === 'ort' || cmd === 'pos') {
      // Auf Koordinaten teleportieren: /ort <x> <z> (ohne Argument: aktuelle Position)
      const [px, pz] = text.slice(1).split(/\s+/).slice(1).map(Number);
      if (!Number.isFinite(px) || !Number.isFinite(pz)) { say(`Position: ${Math.round(this.positionOf(p).x)} ${Math.round(this.positionOf(p).z)}`); return; }
      if (current) { placeCar(this.map, current.sim.car, current.sim.prof, px, pz, 0); current.dmgVer++; }
      else p.pawn = newPawn(px, pz, 0);
      say(`Ort ${px} ${pz}`);
    } else if (cmd === 'zeit' || cmd === 'time') {
      // Tageszeit setzen: /zeit 14 (Stunde 0–24)
      const h = Number(arg);
      if (!Number.isFinite(h)) { say('/zeit <0-24>'); return; }
      const want = ((h / 24) % 1 + 1) % 1;
      this.startedAt = Date.now() - ((want - 0.35 + 1) % 1) * DAY_LENGTH_MS;
      say(`Uhrzeit: ${Math.floor(h)}:00`);
    } else if (cmd === 'pop') {
      // Population Tables prüfen: /pop morgen|mittag|nachmittag|abend|nacht erzwingt den Abschnitt, /pop auto = Spielzeit
      const names: Record<string, DayPart> = { morgen: 'morning', mittag: 'noon', nachmittag: 'afternoon', abend: 'evening', nacht: 'night' };
      const a = (arg ?? '').toLowerCase();
      if (a === 'auto') this.pop.forcePart = null;
      else if (a in names) this.pop.forcePart = names[a];
      else if (a) { say('/pop <' + DAY_PARTS.map((d) => DAY_PART_NAMES[d].toLowerCase()).join('|') + '|auto>'); return; }
      say(this.pop.describe());
    } else if (cmd === 'wetter' || cmd === 'weather') {
      // Wetter erzwingen (Population Tables / Barks): /wetter klar|regen|hitze
      const names: Record<string, Weather> = { klar: 'clear', regen: 'rain', hitze: 'heat', clear: 'clear', rain: 'rain', heat: 'heat' };
      if (!arg || !(arg in names)) { say('/wetter <klar|regen|hitze>'); return; }
      this.pop.weather = names[arg];
      say(`Wetter: ${arg}`);
    } else if ((cmd === 'feuer' || cmd === 'fire') && current) {
      current.sim.dmg.hp = 0; current.sim.dmg.burn = 0.001; current.dmgVer++;
    } else {
      say('Dev-Befehle: /test · /laden <sunmart|gas|ammo|paint> · /auto <kompakt|limousine|kombi|taxi|sport|muscle|suv|pickup|lkw|coupe|hornet|jeep|luxus|van|lieferwagen|muellwagen|kipper|krankenwagen|feuerwehr|cab|racer|motorrad> · /rennen <1-3> · /reparieren · /feuer · /zeit <0-24> · /ort <x> <z> · /pop <tageszeit|auto> · /wetter <klar|regen|hitze> · /tp <viertel>');
    }
  }

  private systemChat(text: string) {
    this.broadcast({ t: 'chat', from: '', text, color: 8, system: true });
  }

  broadcast(msg: Parameters<Connection['send']>[0]) {
    const json = JSON.stringify(msg);
    for (const p of this.players.values()) p.conn.sendRaw(json);
  }

  // ------------------------------------------------------------------ Physik
  /** Räumliches Raster der Fahrzeuge (pro Tick neu). */
  private rebuildGrid() {
    this.grid.clear();
    for (const v of this.vehicles.values()) {
      const k = Math.floor(v.sim.car.z / GRID) * 4096 + Math.floor(v.sim.car.x / GRID);
      let l = this.grid.get(k);
      if (!l) this.grid.set(k, (l = []));
      l.push(v);
    }
  }
  private *nearVehicles(x: number, z: number) {
    const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const l = this.grid.get((cz + dz) * 4096 + cx + dx);
      if (l) yield* l;
    }
  }

  /**
   * Ein fester Physik-Schritt eines Fahrzeugs (Spieler-Eingabe, KI oder ausrollen) inklusive
   * Kollisionen mit Fahrzeugen und Props, Schaden und Boni.
   */
  private physicsStep(v: ServerVehicle, ax: number, ay: number, buttons: number, driver: ServerPlayer | null) {
    const out = this.out;
    clearStepOut(out);
    const car = v.sim.car;
    stepSimVehicle(this.map, v.sim, ax, ay, buttons, SIM_DT, out);
    const water = isWaterVehicle(v.kind);
    if (!water) {
      // Props
      carVsProps(this.map, car, v.sim.prof, (id) => this.props.has(id), this.propHits, out);
      for (const h of this.propHits) {
        const b = createPropBody(h.prop, h);
        this.props.set(b.id, b);
        this.emit(h.prop.x, h.prop.z, ['prop', h.prop.id, r2(h.prop.x), r2(h.prop.y), r2(h.prop.z), r2(h.speed)]);
      }
      // Bäume wackeln
      for (const [tree, s] of out.trees) {
        if ((this.treeCd.get(tree) ?? 0) > 0) continue;
        this.treeCd.set(tree, 0.6);
        this.emit(car.x, car.z, ['tree', tree, r2(Math.min(1, s / 8))]);
      }
    }
    // Nagelbänder: Reifen über dem Band platzen
    if (!water && this.map.spikes.length) this.checkSpikes(v);
    // Fahrzeuge
    for (const o of this.nearVehicles(car.x, car.z)) {
      if (o === v || isWaterVehicle(o.kind) !== water) continue;
      if (v.kinematic && o.kinematic) continue; // kinematischer Verkehr regelt sich selbst
      if (!collideCars(car, v.sim.prof, o.sim.car, o.sim.prof, true, this.col)) continue;
      this.carCrash(v, o, this.col);
    }
    // Welt-Aufprall (Wand, Baum, Boden)
    if (out.impact.dv > 2.5) this.worldImpact(v, out.impact);
    // Boni (nur Spieler)
    if (driver && !water) {
      this.bonus.length = 0;
      updateStunts(driver.stunts, car, SIM_DT, out.impact.dv, this.bonus);
      const others: [number, number, number, number, number, number, number, number][] = [];
      for (const o of this.nearVehicles(car.x, car.z)) {
        if (o === v) continue;
        const c = o.sim.car;
        others.push([o.id, c.x, c.z, c.vx, c.vz, o.sim.prof.width / 2, o.sim.prof.length / 2, c.a]);
      }
      checkNearMiss(driver.stunts, car, v.sim.prof.width / 2, others, SIM_DT, this.bonus);
      for (const b of this.bonus) this.payBonus(driver, b);
    }
  }

  private checkSpikes(v: ServerVehicle) {
    const c = v.sim.car, d = v.sim.dmg;
    const near = this.map.spikes.some((r) => c.x > r[0] - 6 && c.x < r[2] + 6 && c.z > r[1] - 6 && c.z < r[3] + 6);
    if (!near) return;
    const wheels = derive(v.sim.prof).wheels;
    for (let i = 0; i < 4; i++) {
      if (d.tires & (1 << i) || !(c.ground & (1 << i))) continue;
      const w = toWorld(c, wheels[i][0], -v.sim.prof.cgHeight, wheels[i][1]);
      if (!this.map.spikes.some((r) => w[0] >= r[0] && w[0] <= r[2] && w[2] >= r[1] && w[2] <= r[3])) continue;
      burstTire(d, i);
      v.dmgVer++;
      this.emit(w[0], w[2], ['tire', v.id, i, r2(w[0]), r2(w[1]), r2(w[2])], v.id);
    }
  }

  private payBonus(p: ServerPlayer, b: BonusEvent) {
    this.addMoney(p, b.money, `bonus:${b.kind}`);
    this.grantXp(p, b.kind === 'stunt' ? BALANCE.xp.stunt : b.kind === 'drift' ? BALANCE.xp.drift : b.kind === 'near' ? BALANCE.xp.nearMiss : 0);
    p.conn.send({ t: 'bonus', kind: b.kind, points: b.points, money: b.money, info: b.info, total: p.profile.money });
  }

  /** Zwei Fahrzeuge sind zusammengestoßen (Impuls ist schon angewendet). */
  private carCrash(a: ServerVehicle, b: ServerVehicle, col: CarCollision) {
    if (col.j <= 0) return;
    if (a.driver === DRIVER_NPC) this.traffic.onHit(a.id, col.dvA);
    if (b.driver === DRIVER_NPC) this.traffic.onHit(b.id, col.dvB);
    a.sim.car.sleep = 0; b.sim.car.sleep = 0;
    if (col.vn > 2.5) this.emit(col.x, col.z, ['crash', a.id, r2(col.x), r2(col.y), r2(col.z), r2(col.nx), r2(col.nz), r2(col.vn), b.id], a.id);
    // Beulen: A wird entlang -n eingedrückt, B entlang +n
    // Catch the Taxi: Rammstöße der Jäger-LKWs setzen dem Taxi stärker zu
    this.hurt(a, col.x, col.y, col.z, -col.nx, 0, -col.nz, col.dvA * this.hunt.ramScale(a, b));
    this.hurt(b, col.x, col.y, col.z, col.nx, 0, col.nz, col.dvB * this.hunt.ramScale(b, a));
  }

  private worldImpact(v: ServerVehicle, imp: Impact) {
    if (v.driver === DRIVER_NPC && imp.dv > 4) this.traffic.onHit(v.id, imp.dv);
    if (imp.dv > 3) this.emit(imp.x, imp.z, ['crash', v.id, r2(imp.x), r2(imp.y), r2(imp.z), r2(imp.nx), r2(imp.nz), r2(imp.dv), -1 - imp.kind], v.id);
    // Hindernis drückt entgegen der Normale in die Karosserie
    if (imp.kind !== 1 || imp.dv > 6) this.hurt(v, imp.x, imp.y, imp.z, -imp.nx, -imp.ny, -imp.nz, imp.kind === 1 ? imp.dv * 0.5 : imp.dv);
  }

  /** Schaden + Beule an einem Weltpunkt; dir = Richtung, in die das Blech gedrückt wird. */
  private hurt(v: ServerVehicle, x: number, y: number, z: number, dx: number, dy: number, dz: number, dv: number) {
    if (dv < ASSISTS.damageThreshold || isWaterVehicle(v.kind)) return;
    const car = v.sim.car, dmg = v.sim.dmg;
    const l = toLocal(car, x, y, z), d = dirToLocal(car, dx, dy, dz);
    const wasBurning = dmg.burn > 0;
    // damage.ts: x rechts, z vorne (lokal ist +x links)
    const changes = applyImpact(dmg, v.sim.prof, -l[0], l[2], dv);
    for (const ch of changes) this.emit(car.x, car.z, ['part', v.id, ch.part, ch.state], v.id);
    const s = Math.min(1, Math.max(0.05, (dv - ASSISTS.damageThreshold) / 14 / Math.sqrt(v.sim.prof.durability)));
    if (v.dents.length < DENT_MAX) {
      const dent = [r2(l[0]), r2(l[1]), r2(l[2]), r2(d[0]), r2(d[1]), r2(d[2]), r3(s)];
      v.dents.push(dent);
      this.emit(car.x, car.z, ['dent', v.id, ...dent], v.id);
    }
    v.dmgVer++;
    if (!wasBurning && dmg.burn > 0) v.dmgVer++;
    // Motorrad: Fahrer fliegt bei hartem Crash herunter
    if (v.kind === VehicleKind.Bike && dv > 8 && v.driver >= 0) {
      const p = this.players.get(v.driver);
      if (p) this.eject(p, v, 1.3);
    }
    // Harte Unfälle verletzen den Fahrer (Rüstung fängt die Hälfte ab)
    if (v.driver >= 0 && dv > CRASH_HURT_DV) {
      const p = this.players.get(v.driver);
      if (p) this.hurtPlayer(p, (dv - CRASH_HURT_DV) * 2.2);
    }
  }

  // ------------------------------------------------------------------ Gesundheit, Geld, XP
  /** Schaden an einem Spieler: Rüstung fängt 50 % ab; bei 0 Gesundheit wird er ausgeknockt (Spec 7.2/7.3). */
  hurtPlayer(p: ServerPlayer, amount: number) {
    if (amount <= 0 || p.downT > 0 || p.invuln > 0) return;
    const absorbed = Math.min(p.armor, amount * BALANCE.player.armorAbsorb);
    p.armor -= absorbed;
    p.health -= amount - absorbed;
    p.sinceHurt = 0;
    if (p.health <= 0) this.knockOut(p);
  }

  private knockOut(p: ServerPlayer) {
    p.health = 0;
    p.downT = BALANCE.player.reviveWindow;
    const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    if (v) this.eject(p, v, 0.3);
    p.pawn.rt = Math.max(p.pawn.rt, 1); // liegt am Boden (wird solange gehalten, wie er ausgeknockt ist)
    p.conn.send({ t: 'notice', text: 'Du wurdest ausgeknockt!', kind: 'bad' });
  }

  /** Respawn im Krankenhaus (derzeit der Standard-Spawn): kostet 10 % des Bargelds, max. 1.000 $; setzt die Fahndung zurück. */
  private respawn(p: ServerPlayer) {
    const cost = Math.min(BALANCE.player.respawnCostMax, Math.floor(p.profile.money * BALANCE.player.respawnCostShare));
    if (cost > 0) this.addMoney(p, -cost, 'respawn');
    const ang = Math.random() * Math.PI * 2;
    const spot = findFootSpot(this.map, this.map.spawn.x + Math.cos(ang) * 5, this.map.spawn.z + Math.sin(ang) * 5, 10) ?? this.map.spawn;
    p.pawn = newPawn(spot.x, spot.z, Math.PI);
    p.downT = 0;
    p.health = BALANCE.player.maxHealth;
    p.armor = 0;
    this.police.clear(p); // Fahndungslevel zurücksetzen
    p.invuln = BALANCE.player.spawnProtection;
    p.conn.send({ t: 'notice', text: cost > 0 ? `Im Krankenhaus aufgewacht. Behandlung: −$${cost}` : 'Im Krankenhaus aufgewacht.', kind: 'info' });
    this.persist(p);
  }

  /** Geld ändern (nie unter 0) und im Transaktionsprotokoll vermerken. */
  addMoney(p: ServerPlayer, amount: number, reason: string) {
    const before = p.profile.money;
    p.profile.money = Math.max(0, before + Math.round(amount));
    const real = p.profile.money - before;
    if (real) logTransaction(p.profile.key, p.profile.name, real, reason);
    if (real > 1000 || real < -1000) this.persist(p); // Käufe über 1.000 $ speichern sofort
  }

  grantXp(p: ServerPlayer, amount: number) {
    if (amount <= 0) return;
    p.profile.xp += amount;
    const lvl = levelFromXp(p.profile.xp).level;
    if (lvl > p.level) {
      p.level = lvl;
      p.conn.send({ t: 'notice', text: `Stufe ${lvl} erreicht!`, kind: 'good' });
    }
  }

  /** Pro Tick: Regeneration, Knockout-Zähler, Respawn, Autosave. */
  private updatePlayers(dt: number) {
    const B = BALANCE.player;
    for (const p of this.players.values()) {
      p.invuln = Math.max(0, p.invuln - dt);
      p.atkCd = Math.max(0, p.atkCd - dt);
      p.noAmmoCd = Math.max(0, p.noAmmoCd - dt);
      if (p.downT > 0) {
        p.pawn.rt = Math.max(p.pawn.rt, 1);
        p.downT -= dt;
        if (p.downT <= 0) this.respawn(p);
      } else {
        p.sinceHurt += dt;
        if (p.health < B.regenCap && p.sinceHurt > B.regenDelay) p.health = Math.min(B.regenCap, p.health + B.regenPerSecond * dt);
      }
      p.saveT -= dt;
      if (p.saveT <= 0) { p.saveT = SAVE_INTERVAL; this.persist(p); }
    }
  }

  // ------------------------------------------------------------------ Aufträge
  /** Tagesphase 0–1 (0 = Mitternacht, 0,5 = Mittag). */
  private dayPhase(): number { return (((Date.now() - this.startedAt) / DAY_LENGTH_MS) + 0.35) % 1; }

  private isNight(): boolean {
    const day = this.dayPhase();
    return day < 0.27 || day > 0.78;
  }

  private damageVehicle(v: ServerVehicle, dmg: number) {
    const d = v.sim.dmg;
    d.hp = Math.max(0, d.hp - dmg);
    if (d.hp <= 0 && !d.burn) d.burn = 0.0001;
    v.dmgVer++;
  }

  sendQuestLog(p: ServerPlayer) {
    p.conn.send({ t: 'questLog', done: p.profile.questsDone, cooldowns: p.profile.questCooldowns });
  }

  private phoneNear(p: ServerPlayer, id?: string): PhoneDef | undefined {
    const pos = this.positionOf(p);
    return this.phones.find((ph) => (!id || ph.id === id) && dist2(ph.x, ph.z, pos.x, pos.z) <= 10 * 10);
  }

  private openPhone(p: ServerPlayer, id: string) {
    const ph = this.phoneNear(p, id);
    if (!ph || p.downT > 0) return;
    const quests = ph.taxi ? this.hunt.listing(p) : ph.race ? this.races.listing(p, ph.id) : this.quests.listing(p, ph.id, levelFromXp(p.profile.xp).level);
    p.conn.send({ t: 'phone', id: ph.id, name: ph.name, quests });
  }

  private acceptQuest(p: ServerPlayer, id: string) {
    if (id === TAXI_HUNT_ID) {
      if (!this.phoneNear(p, id)) { p.conn.send({ t: 'notice', text: 'Du musst am 🚕 Telefon stehen.', kind: 'bad' }); return; }
      this.hunt.request(p);
      return;
    }
    if (this.races.isTrack(id)) {
      if (!this.phoneNear(p, id)) { p.conn.send({ t: 'notice', text: 'Du musst am Renntelefon stehen.', kind: 'bad' }); return; }
      this.races.request(p, id);
      return;
    }
    const def = QUEST_BY_ID.get(id);
    if (!def || p.downT > 0) return;
    if (this.races.has(p.id)) { p.conn.send({ t: 'notice', text: 'Du bist gerade für ein Rennen angemeldet.', kind: 'bad' }); return; }
    if (this.hunt.has(p.id)) { p.conn.send({ t: 'notice', text: 'Du spielst gerade Catch the Taxi.', kind: 'bad' }); return; }
    if (!this.phoneNear(p, def.giver.id)) { p.conn.send({ t: 'notice', text: 'Du musst am Missionstelefon stehen.', kind: 'bad' }); return; }
    this.quests.start(p, def, levelFromXp(p.profile.xp).level);
  }

  // ------------------------------------------------------------------ Polizei, Festnahme, Läden
  /** Streifenwagen für die Verfolgung erzeugen (Limousine, helle Lackierung). */
  private createCopCar(x: number, z: number, a: number, target: number, tank = false): ServerVehicle | null {
    const sim = createSimVehicle(this.map, VehicleKind.Car, tank ? TANK_VARIANT : 1, x, z, a);
    const id = this.allocId();
    const v: ServerVehicle = { id, kind: VehicleKind.Car, color: tank ? 6 : 3, sim, driver: DRIVER_COP, home: null, idleTime: 0, dents: [], dmgVer: 0, buttons: 0, kinematic: false, cop: target };
    this.vehicles.set(id, v);
    return v;
  }

  /** Panzerrakete (Fahndungsstufe 4): fliegt bis zum Ziel oder zur ersten Wand und explodiert. */
  private tankRocket(shooter: number, x0: number, z0: number, x1: number, z1: number) {
    const d = Math.hypot(x1 - x0, z1 - z0) || 1;
    const a = Math.atan2(x1 - x0, z1 - z0);
    const dist = Math.min(d, wallDistance(this.map, x0, z0, a, d));
    const [dx, dz] = dirOf(a);
    const ex = x0 + dx * dist, ez = z0 + dz * dist;
    this.emit(x0, z0, ['shot', shooter, r2(x0), r2(z0), r2(ex), r2(ez), ROCKET_IDX]);
    this.blast(ex, ez, ROCKET_RADIUS);
  }

  /** Explosion ohne Verursacher-Spieler (kein Verbrechen): Flächenschaden an Fahrzeugen, Spielern, Passanten. */
  private blast(x: number, z: number, R: number) {
    this.emit(x, z, ['boom', -1, r2(x), r2(this.map.surfaceY(x, z) + 0.5), r2(z)]);
    this.peds.scare(x, z, 40);
    for (const o of [...this.nearVehicles(x, z)]) {
      if (o.sim.variant === TANK_VARIANT || isWaterVehicle(o.kind)) continue;
      const oc = o.sim.car;
      const dx = oc.x - x, dz = oc.z - z, dist = Math.hypot(dx, dz);
      if (dist > R) continue;
      const k = 1 - dist / R;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      if (o.driver === DRIVER_NPC) this.traffic.onHit(o.id, 12 * k + 4);
      oc.sleep = 0;
      applyImpulse(oc, derive(o.sim.prof), oc.x - nx * 0.5, oc.y - 0.4, oc.z - nz * 0.5, nx * o.sim.prof.mass * 8 * k, o.sim.prof.mass * 7 * k, nz * o.sim.prof.mass * 8 * k);
      this.hurt(o, oc.x - nx * o.sim.prof.width / 2, oc.y, oc.z - nz * o.sim.prof.width / 2, nx, 0, nz, 14 * k + 6);
      const dm = o.sim.dmg;
      dm.hp = Math.max(0, dm.hp - 550 * k);
      if (dm.hp <= 0 && !dm.burn && !dm.wreck) dm.burn = 0.0001;
      o.dmgVer++;
      if (o.driver >= 0) { const p = this.players.get(o.driver); if (p) this.hurtPlayer(p, 12 * k); }
    }
    for (const p of this.players.values()) {
      if (p.vehicleId >= 0 || p.downT > 0) continue;
      const dx = p.pawn.x - x, dz = p.pawn.z - z, dist = Math.hypot(dx, dz);
      if (dist >= R) continue;
      const k = 1 - dist / R;
      knockPawn(p.pawn, (dx / (dist || 1)) * 9 * k, (dz / (dist || 1)) * 9 * k, 7, 2);
      this.hurtPlayer(p, 75 * k);
    }
    for (const ped of this.peds.peds.values()) {
      const dx = ped.x - x, dz = ped.z - z, dist = Math.hypot(dx, dz);
      if (dist < R) this.peds.knock(ped, (dx / (dist || 1)) * 9 * (1 - dist / R), (dz / (dist || 1)) * 9 * (1 - dist / R), 7);
    }
  }

  /** Festnahme (Spec 7.3): 15 % Bargeld und illegale Gegenstände weg, Respawn beim Revier (= Spawn). */
  private arrest(p: ServerPlayer) {
    const cost = Math.floor(p.profile.money * BALANCE.player.arrestCostShare);
    if (cost > 0) this.addMoney(p, -cost, 'arrest');
    for (const id of Object.keys(p.profile.inventory)) if (ITEMS[id]?.kind === 'illegal') delete p.profile.inventory[id];
    this.police.clear(p);
    const ang = Math.random() * Math.PI * 2;
    const spot = findFootSpot(this.map, this.map.spawn.x + Math.cos(ang) * 5, this.map.spawn.z + Math.sin(ang) * 5, 10) ?? this.map.spawn;
    p.pawn = newPawn(spot.x, spot.z, Math.PI);
    p.invuln = BALANCE.player.spawnProtection;
    p.conn.send({ t: 'notice', text: `Festgenommen! Du verlierst ${cost} $ und illegale Ware.`, kind: 'bad' });
    this.persist(p);
  }

  private backpackUsed(p: ServerPlayer): number {
    let n = 0;
    for (const [id, c] of Object.entries(p.profile.inventory)) n += Math.ceil(c / (ITEMS[id]?.stack ?? 1));
    return n;
  }

  addItem(p: ServerPlayer, id: string, count = 1): boolean {
    const def = ITEMS[id];
    if (!def) return false;
    const inv = p.profile.inventory;
    const before = inv[id] ?? 0;
    inv[id] = before + count;
    if (this.backpackUsed(p) > BACKPACK_SLOTS) { if (before) inv[id] = before; else delete inv[id]; return false; }
    return true;
  }

  private useItem(p: ServerPlayer, id: string) {
    const def = ITEMS[id], inv = p.profile.inventory;
    if (!def || (inv[id] ?? 0) <= 0 || p.downT > 0) return;
    if (def.kind === 'consumable') {
      if (def.heal) p.health = Math.min(BALANCE.player.maxHealth, p.health + def.heal);
    } else if (def.kind === 'armor') {
      p.armor = Math.max(p.armor, def.armor ?? 0);
    } else return;
    if (--inv[id] <= 0) delete inv[id];
    p.conn.send({ t: 'notice', text: `${def.name} benutzt.`, kind: 'good' });
  }

  /** Einkauf im Laden. Alles wird serverseitig geprüft (Entfernung, Stufe, Geld, Platz). */
  private buy(p: ServerPlayer, shopId: string, key: string) {
    const bad = (text: string) => p.conn.send({ t: 'notice', text, kind: 'bad' });
    const shop = this.shops.find((s) => s.id === shopId);
    if (!shop || p.downT > 0) return;
    const pos = this.positionOf(p);
    // Gekauft wird beim Verkäufer (Mechaniker auch aus dem Fahrzeug); etwas Spielraum für Latenz
    const range = shop.type === 'paint' ? MECHANIC_RANGE + 4 : SHOP_SERVER_RANGE;
    if (dist2(pos.x, pos.z, shop.keeper.x, shop.keeper.z) > range ** 2) return bad(`${shop.keeper.name} kann dich von da aus nicht hören – geh näher ran.`);
    const entry = shopCatalog(shop.type).find((i) => i.key === key);
    if (!entry) return;
    if (levelFromXp(p.profile.xp).level < entry.minLevel) return bad(`${entry.name} gibt es erst ab Stufe ${entry.minLevel}.`);
    if (p.profile.money < entry.price) return bad('Nicht genug Geld.');
    const [kind, arg] = key.split(':');
    let done = false;
    if (kind === 'w' && arg in WEAPONS) {
      if (arg in p.profile.weapons) return bad('Die Waffe besitzt du schon – kauf Munition.');
      this.addMoney(p, -entry.price, `shop:${key}`);
      this.giveWeapon(p, arg as WeaponId, WEAPONS[arg as WeaponId].ammoPack);
      done = true;
    } else if (kind === 'a' && arg in WEAPONS) {
      const w = WEAPONS[arg as WeaponId];
      if (!(arg in p.profile.weapons)) return bad('Du besitzt diese Waffe nicht.');
      if ((p.profile.weapons[arg] ?? 0) >= w.ammoPack * 6) return bad('Mehr Munition kannst du nicht tragen.');
      this.addMoney(p, -entry.price, `shop:${key}`);
      p.profile.weapons[arg] += w.ammoPack;
      done = true;
    } else if (kind === 'i') {
      if (!this.addItem(p, arg)) return bad('Dein Rucksack ist voll.');
      this.addMoney(p, -entry.price, `shop:${key}`);
      done = true;
    } else if (key === 'repair') {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (!v) return bad('Du brauchst ein Fahrzeug in der Nähe.');
      this.addMoney(p, -entry.price, 'shop:repair');
      this.repair(v);
      done = true;
    } else if (key === 'respray') {
      if (p.wanted === 0) return bad('Du wirst nicht gesucht.');
      if (p.wanted > 2) return bad('Ab Stufe 3 hilft kein Lack mehr.');
      if (this.police.copInSight(p)) return bad('Nicht bei Sichtkontakt zur Polizei!');
      this.addMoney(p, -RESPRAY_PRICE, 'shop:respray');
      this.police.clear(p);
      done = true;
    }
    if (done) p.conn.send({ t: 'notice', text: `${entry.name} gekauft (−$${entry.price}).`, kind: 'good' });
  }

  // ------------------------------------------------------------------ Waffen & Kampf
  ownedWeapons(p: ServerPlayer): WeaponId[] {
    return (Object.keys(WEAPONS) as WeaponId[]).filter((id) => id === 'fists' || id in p.profile.weapons);
  }

  /** Waffe ins Inventar legen (ein Slot je Klasse: eine alte Waffe derselben Klasse wird ersetzt). */
  giveWeapon(p: ServerPlayer, id: WeaponId, ammo: number) {
    const def = WEAPONS[id];
    if (id === 'fists') return;
    for (const other of this.ownedWeapons(p)) {
      if (other !== id && WEAPONS[other].slot === def.slot && other !== 'fists') delete p.profile.weapons[other];
    }
    p.profile.weapons[id] = (p.profile.weapons[id] ?? 0) + ammo;
    p.weapon = id;
    p.conn.send({ t: 'notice', text: `${def.name} erhalten${def.ammoPack ? ` (${p.profile.weapons[id]} Schuss)` : ''}.`, kind: 'good' });
  }

  private equip(p: ServerPlayer, slot?: number, dir?: number) {
    const owned = this.ownedWeapons(p);
    let next: WeaponId | undefined;
    if (typeof slot === 'number' && slot >= 1 && slot <= CARRY_SLOTS.length) {
      next = owned.find((id) => WEAPONS[id].slot === CARRY_SLOTS[slot - 1]);
    } else if (typeof dir === 'number' && dir) {
      const i = owned.indexOf(p.weapon as WeaponId);
      next = owned[(i + (dir > 0 ? 1 : -1) + owned.length) % owned.length];
    }
    if (next) p.weapon = next;
  }

  /** Zielpunkte für Treffer: Passanten und (bei beidseitigem PvP) andere Spieler. */
  private targetsFor(p: ServerPlayer): Target<HitRef>[] {
    const list: Target<HitRef>[] = [];
    const pos0 = this.positionOf(p);
    for (const v of this.vehicles.values()) {
      if (v.id === p.vehicleId || v.sim.dmg.wreck) continue;
      const c = v.sim.car;
      if (dist2(c.x, c.z, pos0.x, pos0.z) > 50 * 50) continue;
      list.push({ x: c.x, z: c.z, r: 1.4, ref: { veh: v } });
    }
    for (const ped of this.peds.peds.values()) if (ped.hp > 0 && ped.rt <= 0) list.push({ x: ped.x, z: ped.z, r: 0.55, ref: { ped } });
    for (const o of this.players.values()) {
      if (o === p || !o.pvp || !p.pvp || o.downT > 0 || o.invuln > 0) continue;
      const pos = this.positionOf(o);
      list.push({ x: pos.x, z: pos.z, r: pos.inVehicle ? 1.2 : 0.55, ref: { player: o } });
    }
    return list;
  }

  private applyHit(p: ServerPlayer, t: Target<HitRef>, dmg: number, fromX: number, fromZ: number) {
    const d = Math.hypot(t.x - fromX, t.z - fromZ) || 1;
    const dx = (t.x - fromX) / d, dz = (t.z - fromZ) / d;
    if (t.ref.ped) {
      const ped = t.ref.ped;
      const defeated = this.peds.hit(ped, dmg, dx, dz);
      this.emit(t.x, t.z, ['hit', r2(t.x), r2(t.z), 0]);
      this.blood(t.x, t.z, Math.min(1, dmg / 40) + (defeated ? 0.5 : 0), dx, dz, 0);
      if (ped.gang) this.gangs.provoke(ped, p);
      if (!ped.cop && !ped.gang) this.perception.event(NpcEv.Fight, ped.x, ped.z, p.id);
      if (ped.cop) this.police.raise(p, defeated ? 3 : 2, defeated ? HEAT.copKill : HEAT.copHit); // Polizisten angreifen: sofort bekannt
      else this.police.crime(p, defeated ? HEAT.kill : HEAT.punch, ped.x, ped.z);
      if (defeated && !ped.cop) this.addMoney(p, 5 + Math.floor(Math.random() * 36), 'loot');
    } else if (t.ref.veh) {
      const v = t.ref.veh, d = v.sim.dmg;
      d.hp = Math.max(0, d.hp - dmg * 5);
      if (d.hp <= 0 && !d.burn) d.burn = 0.0001;
      v.dmgVer++; v.sim.car.sleep = 0;
      this.emit(t.x, t.z, ['hit', r2(t.x), r2(t.z), 2]);
      if (v.driver === DRIVER_NPC) this.traffic.onShot(v.id);
      if (v.cop !== undefined) this.police.raise(p, 2, HEAT.copHit * 0.3);
    } else if (t.ref.player) {
      this.hurtPlayer(t.ref.player, dmg);
      this.emit(t.x, t.z, ['hit', r2(t.x), r2(t.z), 1]);
      this.blood(t.x, t.z, Math.min(1, dmg / 40), dx, dz, 0);
    }
  }

  /** Angriff mit der gewählten Waffe. Der Server prüft Feuerrate, Munition und trifft selbst. */
  private attack(p: ServerPlayer, aimRaw: number) {
    if (p.downT > 0 || p.atkCd > 0 || p.pawn.rt > 0) return;
    // Catch the Taxi: Jäger dürfen nicht schießen, das Taxi schießt mit Pistole (Munition frei)
    const huntRole = this.hunt.role(p.id);
    if (huntRole === 'hunter') {
      if (p.noAmmoCd <= 0) { p.noAmmoCd = 1.5; p.conn.send({ t: 'notice', text: 'Jäger dürfen nicht schießen – ramm das Taxi!', kind: 'bad' }); }
      return;
    }
    const freeAmmo = huntRole === 'taxi';
    let id = (freeAmmo ? 'pistol' : p.weapon) as WeaponId;
    if (!(id in WEAPONS) || (id !== 'fists' && !freeAmmo && !(id in p.profile.weapons))) id = p.weapon = 'fists';
    const def = WEAPONS[id];
    // Drive-by (Spec 8.5): Fahrer nur mit Pistole, nach vorne oder zur Seite
    const car = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
    if (p.vehicleId >= 0) {
      if (!car || def.slot !== 'pistol') return;
      const diff = Math.atan2(Math.sin(aimRaw - car.sim.car.a), Math.cos(aimRaw - car.sim.car.a));
      if (Math.abs(diff) > 1.95) { p.noAmmoCd <= 0 && p.conn.send({ t: 'notice', text: 'Nach hinten kannst du nicht schießen.', kind: 'info' }); p.noAmmoCd = 1.5; return; }
    }
    if (!freeAmmo && def.ammoPack > 0 && (p.profile.weapons[id] ?? 0) <= 0) {
      if (p.noAmmoCd <= 0) { p.noAmmoCd = 1.5; p.conn.send({ t: 'notice', text: `Keine Munition für ${def.name}.`, kind: 'bad' }); }
      return;
    }
    p.atkCd = def.cooldown * 0.9;
    if (!freeAmmo && def.ammoPack > 0) p.profile.weapons[id] -= 1;
    const ox = car ? car.sim.car.x : p.pawn.x, oz = car ? car.sim.car.z : p.pawn.z;
    const targets = this.targetsFor(p);
    let aim = aimRaw;
    if (!car) p.pawn.a = aim;
    const wid = Object.keys(WEAPONS).indexOf(id);

    if (def.slot === 'melee') {
      const t = meleeTarget(ox, oz, aim, def.range, targets);
      this.emit(ox, oz, ['swing', p.id, r2(aim), wid, r2(ox), r2(oz)]);
      if (t) this.applyHit(p, t, def.damage, ox, oz);
      return;
    }
    this.peds.scare(ox, oz, 30);
    this.perception.event(NpcEv.Shot, ox, oz, p.id);
    this.police.gunfire(p, ox, oz); // Schusswaffe in der Öffentlichkeit
    aim = aimAssist(ox, oz, aim, def.range, targets);
    if (def.area > 0) {
      // Wurf/Rakete: landet am Ziel in Reichweite bzw. an der ersten Wand, Flächenschaden mit Abfall
      const dist = wallDistance(this.map, ox, oz, aim, def.range);
      const [dx, dz] = dirOf(aim);
      const ex = ox + dx * dist, ez = oz + dz * dist;
      this.emit(ox, oz, ['shot', p.id, r2(ox), r2(oz), r2(ex), r2(ez), wid]);
      this.emit(ex, ez, ['boom', -1, r2(ex), r2(this.map.surfaceY(ex, ez) + 0.5), r2(ez)]);
      this.peds.scare(ex, ez, 40);
      this.police.crime(p, HEAT.explosion, ex, ez); // Explosion
      for (const t of targets) {
        const d = Math.hypot(t.x - ex, t.z - ez);
        if (d <= def.area) this.applyHit(p, t, def.damage * (1 - 0.6 * d / def.area), ex, ez);
      }
      if (Math.hypot(ox - ex, oz - ez) < def.area) this.hurtPlayer(p, def.damage * 0.3); // Eigenbeschuss
      return;
    }
    for (let k = 0; k < def.pellets; k++) {
      const a = aim + (Math.random() - 0.5) * 2 * def.spread;
      const r = shootRay(this.map, ox, oz, a, def.range, targets);
      const [dx, dz] = dirOf(a);
      this.emit(ox, oz, ['shot', p.id, r2(ox), r2(oz), r2(ox + dx * r.dist), r2(oz + dz * r.dist), wid]);
      if (r.hit) this.applyHit(p, r.hit, def.damage / (def.pellets > 1 ? def.pellets * 0.6 : 1), ox, oz);
    }
  }

  private statsOf(p: ServerPlayer): PlayerStats {
    const lv = levelFromXp(p.profile.xp);
    return {
      hp: Math.max(0, Math.ceil(p.health)), armor: Math.ceil(p.armor), bank: p.profile.bank,
      level: lv.level, xp: lv.into, xpNeeded: lv.needed, down: Math.max(0, Math.ceil(p.downT)),
      weapon: p.weapon, ammo: WEAPONS[p.weapon as WeaponId]?.ammoPack ? (p.profile.weapons[p.weapon] ?? 0) : -1,
      owned: this.ownedWeapons(p), pvp: p.pvp,
      inv: p.profile.inventory, rep: p.profile.reputation, wanted: p.wanted, arrest: Math.min(1, p.arrestT / 3),
    };
  }

  /** Alle Spieler dieser Instanz speichern (z. B. beim Herunterfahren). */
  saveAll() { for (const p of this.players.values()) this.persist(p); }

  /** Spieler aus dem Fahrzeug schleudern (Comic-Ragdoll). */
  private eject(p: ServerPlayer, v: ServerVehicle, power: number) {
    const c = v.sim.car;
    v.driver = DRIVER_NONE; v.buttons = 0;
    p.vehicleId = -1;
    const spot = (carInWater(this.map, c) ? findSwimSpot(this.map, c.x, c.z, 4) : findFootSpot(this.map, c.x, c.z, 6)) ?? { x: c.x, z: c.z };
    p.pawn = newPawn(spot.x, spot.z, c.a);
    knockPawn(p.pawn, c.vx * 0.8 * power, c.vz * 0.8 * power, 4 + Math.hypot(c.vx, c.vz) * 0.15, 1.9);
    this.emit(c.x, c.z, ['eject', p.id], v.id);
  }

  // ------------------------------------------------------------------ Aus dem Auto ziehen
  private noticeTo(p: ServerPlayer, text: string, kind: 'info' | 'good' | 'bad') { p.conn.send({ t: 'notice', text, kind }); }
  private pullT = new Map<number, number>();
  private pullCd = new Map<number, number>();
  private sinkNote = new Map<number, number>();

  /**
   * Polizisten und wütende Passanten laufen zum stehenden/langsamen Auto des Spielers und zerren
   * den Fahrer heraus (nach ~1,1 s am Fahrzeug). Wer schnell fährt, kann nicht herausgezogen werden.
   */
  private updatePullOut(dt: number) {
    for (const [k, t] of this.pullCd) { if (t - dt <= 0) this.pullCd.delete(k); else this.pullCd.set(k, t - dt); }
    for (const p of this.players.values()) {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (!v || p.downT > 0 || isWaterVehicle(v.kind) || v.sim.variant === TANK_VARIANT || this.pullCd.has(p.id)) { this.pullT.delete(p.id); continue; }
      if (this.races.frozen(p.id) || this.hunt.locked(p.id)) { this.pullT.delete(p.id); continue; }
      const c = v.sim.car, speed = Math.hypot(c.vx, c.vz);
      const reach = v.sim.prof.width / 2 + 1.7;
      let puller: Ped | null = null, bestD = Infinity;
      for (const ped of this.peds.peds.values()) {
        if (ped.rt > 0 || ped.hp <= 0 || !(ped.cop === p.id || ped.angry > 0)) continue;
        const d = Math.hypot(ped.x - c.x, ped.z - c.z);
        if (d > 14 || d >= bestD) continue;
        puller = ped; bestD = d;
      }
      if (!puller || speed > 4.5) { this.pullT.delete(p.id); continue; }
      const angryOnly = puller.cop !== p.id;
      if (angryOnly) { puller.angry = Math.max(puller.angry, 2); puller.wait = 1; puller.ttl = Math.max(puller.ttl, 8); }
      const dx = c.x - puller.x, dz = c.z - puller.z;
      if (bestD > reach) {
        // hinlaufen (Polizisten laufen schon selbst, wütende Passanten übernehmen wir hier)
        if (angryOnly) stepPawn(this.map, puller, dx / bestD, -dz / bestD, 0, dt, 5.5);
        this.pullT.delete(p.id);
        continue;
      }
      puller.a = Math.atan2(dx, dz);
      const t = (this.pullT.get(p.id) ?? 0) + dt;
      if (t < 1.1) { this.pullT.set(p.id, t); continue; }
      this.pullT.delete(p.id);
      this.pullCd.set(p.id, 4);
      this.pullOut(p, v, puller, angryOnly);
    }
  }

  private pullOut(p: ServerPlayer, v: ServerVehicle, puller: Ped, angry: boolean) {
    const c = v.sim.car;
    v.driver = DRIVER_NONE; v.buttons = 0; v.idleTime = 0;
    p.vehicleId = -1;
    const spot = (carInWater(this.map, c) ? findSwimSpot(this.map, c.x, c.z, 4) : findFootSpot(this.map, puller.x, puller.z, 4)) ?? { x: c.x, z: c.z };
    p.pawn = newPawn(spot.x, spot.z, c.a);
    const dx = spot.x - c.x, dz = spot.z - c.z, d = Math.hypot(dx, dz) || 1;
    knockPawn(p.pawn, (dx / d) * 3.2, (dz / d) * 3.2, 3, 1.1);
    this.emit(c.x, c.z, ['eject', p.id], v.id);
    if (angry) {
      this.hurtPlayer(p, 6);
      puller.angry = 0; puller.wait = 0;
      puller.flee = 3; puller.fdx = -dx / d; puller.fdz = -dz / d;
      this.perception.bark(puller, 'scold');
      this.noticeTo(p, 'Ein wütender Passant hat dich aus dem Auto gezerrt!', 'bad');
    }
  }

  /** Versunkene Autos: Hinweis an den Fahrer (Motor ist aus, aussteigen und schwimmen). */
  private updateSinking(dt: number) {
    for (const [k, t] of this.sinkNote) { if (t - dt <= 0) this.sinkNote.delete(k); else this.sinkNote.set(k, t - dt); }
    for (const p of this.players.values()) {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (!v || isWaterVehicle(v.kind) || !carInWater(this.map, v.sim.car) || this.sinkNote.has(p.id)) continue;
      this.sinkNote.set(p.id, 12);
      this.noticeTo(p, 'Dein Auto säuft ab! Steig aus (E) und schwimm ans Ufer.', 'info');
    }
  }

  /** NPC-Fahrer steigt aus (wütend = bleibt kurz schimpfend stehen). */
  private npcDriverOut(v: ServerVehicle, angry: boolean) {
    const c = v.sim.car;
    v.driver = DRIVER_NONE; v.home = null; v.idleTime = 0; v.kinematic = false; v.buttons = 0;
    const side = v.sim.prof.width / 2 + 1;
    const spot = findFootSpot(this.map, c.x + Math.cos(c.a) * side, c.z - Math.sin(c.a) * side, 6);
    if (!spot) return;
    if (angry) {
      // zum nächsten Spieler schauen
      let lx = c.x, lz = c.z, best = Infinity;
      for (const p of this.players.values()) {
        const pos = this.positionOf(p);
        const d = dist2(pos.x, pos.z, c.x, c.z);
        if (d < best) { best = d; lx = pos.x; lz = pos.z; }
      }
      const ped = this.peds.spawnAngry(spot.x, spot.z, lx, lz);
      this.emit(spot.x, spot.z, ['shout', ped.id]);
      this.perception.bark(ped, 'scold');
    } else {
      this.peds.spawnFleeing(spot.x, spot.z);
    }
  }

  // ------------------------------------------------------------------ Simulation
  private tick(dt: number) {
    this.clock += dt;
    for (const p of this.players.values()) p.cmdBudget = Math.min(CMD_BUDGET_MAX, p.cmdBudget + CMD_REFILL_PER_TICK);
    for (const [k, t] of this.treeCd) { if (t - dt <= 0) this.treeCd.delete(k); else this.treeCd.set(k, t - dt); }
    this.rebuildGrid();

    const fast: [number, number, number, number][] = [];
    for (const p of this.players.values()) {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (v && Math.hypot(v.sim.car.vx, v.sim.car.vz) > 10) fast.push([v.sim.car.x, v.sim.car.z, v.sim.car.vx, v.sim.car.vz]);
    }
    this.traffic.update(dt, fast);
    // Freie Fahrzeuge (ohne Fahrer) rollen aus, fallen, werden geschoben – bis sie einschlafen
    const steps = Math.round(dt / SIM_DT);
    for (const v of this.vehicles.values()) {
      if (v.driver !== DRIVER_NONE) continue;
      if (v.sim.car.sleep > 0.6 && !isWaterVehicle(v.kind)) continue;
      if (isWaterVehicle(v.kind) && Math.abs(v.sim.car.s) < 0.01) continue;
      for (let k = 0; k < steps; k++) this.physicsStep(v, 0, 0, 0, null);
    }
    this.hitPawns();
    // Fahrer "sitzen" im Fahrzeug: Fußposition mitführen (fürs Aussteigen & die Anzeige)
    for (const p of this.players.values()) {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (v) { p.pawn.x = v.sim.car.x; p.pawn.z = v.sim.car.z; p.pawn.a = v.sim.car.a; }
    }
    this.pop.update(dt);
    this.perception.update(dt);
    if (this.npcDebug.size && (this.npcDebugT -= dt) <= 0) {
      this.npcDebugT = 0.5;
      for (const id of this.npcDebug) {
        const p = this.players.get(id);
        if (!p) { this.npcDebug.delete(id); continue; }
        const pos = this.positionOf(p);
        p.conn.send({ t: 'npcDebug', ...this.perception.debugView(pos.x, pos.z), pop: this.pop.describe() });
      }
    }
    this.peds.update(dt, [...this.vehicles.values()].map((v) => ({ x: v.sim.car.x, z: v.sim.car.z, speed: v.sim.car.s, vx: v.sim.car.vx, vz: v.sim.car.vz })));
    this.updateProps(dt);
    this.updateFire(dt);
    this.updateWorkshops(dt);
    this.updatePlayers(dt);
    this.hunt.update(dt);
    this.police.update(dt);
    this.updatePullOut(dt);
    this.updateSinking(dt);
    this.quests.update(dt);
    this.races.update(dt);
    this.gangs.update(dt, this.isNight());
    this.maintainVehicles(dt);
    this.sendSnapshots();
    this.events.length = 0;
  }

  /** Fahrzeuge gegen Fußgänger/Spieler zu Fuß: schnell = wegschleudern, langsam = wegschieben. */
  private hitPawns() {
    const pawns: { pawn: { x: number; z: number; h: number; rt: number; vx: number; vz: number; vy: number }; ped?: Ped; player?: ServerPlayer }[] = [
      ...[...this.players.values()].filter((p) => p.vehicleId < 0 && p.downT <= 0).map((p) => ({ pawn: p.pawn, player: p })),
      ...[...this.peds.peds.values()].map((p) => ({ pawn: p, ped: p })),
    ];
    for (const { pawn, ped, player } of pawns) {
      if (pawn.h > 1.2) continue;
      for (const v of this.nearVehicles(pawn.x, pawn.z)) {
        const c = v.sim.car;
        const hit = boxCircle(c, v.sim.prof, pawn.x, pawn.z, PAWN_RADIUS);
        if (!hit) continue;
        const speed = Math.hypot(c.vx, c.vz);
        if (speed > 4 && pawn.rt <= 0) {
          const up = 3 + speed * 0.18;
          const k = Math.min(1.1, 0.7 + speed * 0.01);
          if (ped) {
            this.peds.knock(ped, c.vx * k - hit[0] * 2, c.vz * k - hit[1] * 2, up);
            const dp = v.driver >= 0 ? this.players.get(v.driver) : undefined;
            if (ped.cop) ped.hp -= speed * 3;
            // Polizisten umfahren = Angriff; Passanten zählen erst bei echtem Tempo (kein Anrempeln)
            if (dp && ped.gang) this.gangs.provoke(ped, dp); // Gang angefahren: die ganze Gruppe wird wütend
            if (dp && ped.cop) this.police.raise(dp, 2, HEAT.copHit);
            else if (dp && speed > 6) this.police.crime(dp, HEAT.runover, ped.x, ped.z);
          }
          else {
            knockPawn(pawn as never, c.vx * k - hit[0] * 2, c.vz * k - hit[1] * 2, up, 1.7);
            if (player) this.hurtPlayer(player, speed * 1.6);
          }
          // Auto verliert etwas Schwung
          const d = derive(v.sim.prof);
          applyImpulse(c, d, hit[3], c.y, hit[4], hit[0] * 80 * speed, 0, hit[1] * 80 * speed);
          this.emit(pawn.x, pawn.z, ['crash', v.id, r2(pawn.x), r2(c.y), r2(pawn.z), r2(hit[0]), r2(hit[1]), r2(Math.min(speed, 6)), -6], v.id);
          this.blood(pawn.x, pawn.z, Math.min(1.5, speed / 14), c.vx / (speed || 1), c.vz / (speed || 1), 1);
        } else if (pawn.rt > 0 && pawn.h < 0.5 && speed > 2.5) {
          // Liegende Figur wird überfahren: Blut (gedrosselt je Figur), Auto holpert leicht
          const last = this.runOver.get(pawn) ?? -1;
          if (this.clock - last > 0.35) {
            this.runOver.set(pawn, this.clock);
            this.blood(pawn.x, pawn.z, Math.min(1.2, 0.4 + speed / 20), c.vx / speed, c.vz / speed, 2);
            if (c.ground) c.vy += Math.min(1.2, speed * 0.05);
          }
        } else if (pawn.rt <= 0) {
          // Langsam: Figur sanft aus der Fahrzeugbox schieben (statt Sprung auf einen freien Platz)
          const nx = pawn.x - hit[0] * (hit[2] + 0.02), nz = pawn.z - hit[1] * (hit[2] + 0.02);
          if (footFree(this.map, nx, nz)) { pawn.x = nx; pawn.z = nz; }
          else {
            const spot = findFootSpot(this.map, nx, nz, 3);
            if (spot) { pawn.x = spot.x; pawn.z = spot.z; }
          }
        }
      }
    }
    this.separatePawns();
  }

  /**
   * Fußgänger weichen stehenden Fahrzeugen aus (z. B. auf dem Gehweg abgestellte Autos), statt sich
   * daran festzulaufen: um die Seite herum, die frei ist – meist also über die Straße.
   */
  private avoidVehicles(ped: Ped, dx: number, dz: number): [number, number] | null {
    const px = ped.x + dx * 1.5, pz = ped.z + dz * 1.5;
    for (const v of this.nearVehicles(px, pz)) {
      const c = v.sim.car;
      if (Math.hypot(c.vx, c.vz) > 2 || v.kind === VehicleKind.Boat) continue;
      const prof = v.sim.prof;
      if (!boxCircle(c, prof, px, pz, PAWN_RADIUS + 0.3) && !boxCircle(c, prof, ped.x + dx * 0.7, ped.z + dz * 0.7, PAWN_RADIUS + 0.2)) continue;
      // Umgehungspunkte links/rechts des Autos (quer zur Laufrichtung)
      const off = Math.hypot(prof.length, prof.width) / 2 + 0.9;
      const side = Math.sign((ped.x - c.x) * -dz + (ped.z - c.z) * dx) || 1;
      for (const s of [side, -side]) {
        const tx = c.x - dz * s * off, tz = c.z + dx * s * off;
        if (!footFree(this.map, tx, tz)) continue;
        const ex = tx - ped.x, ez = tz - ped.z, el = Math.hypot(ex, ez);
        if (el < 0.3) return [dx, dz];
        // etwas Vorwärtsdrang behalten, damit der Bogen flüssig wirkt
        const mx = ex / el + dx * 0.35, mz = ez / el + dz * 0.35, ml = Math.hypot(mx, mz) || 1;
        return [mx / ml, mz / ml];
      }
    }
    return null;
  }

  /** Blutspritzer: kind 0 = Treffer (Waffe/Schlag), 1 = angefahren, 2 = überfahren. */
  private blood(x: number, z: number, amount: number, dx: number, dz: number, kind: number) {
    this.emit(x, z, ['blood', r2(x), r2(z), r2(amount), r2(dx), r2(dz), kind]);
  }
  private runOver = new WeakMap<object, number>();
  private clock = 0;

  /**
   * Figuren gehen nicht mehr durcheinander hindurch: überlappende Fußgänger/Spieler (zu Fuß, stehend)
   * weich auseinanderschieben. Spieler haben Vorrang (ihre Position sagt der Client voraus),
   * Fußgänger weichen aus. Räumliches Raster (2 m), damit es bei vielen NPCs billig bleibt.
   */
  private separatePawns() {
    type P = { x: number; z: number; rt: number; h: number };
    const items: { p: P; player: boolean }[] = [];
    for (const pl of this.players.values()) if (pl.vehicleId < 0 && pl.pawn.rt <= 0) items.push({ p: pl.pawn, player: true });
    // Fußgänger in einer Szene (Bank, Gespräch, Café …) stehen bewusst eng: nicht verschieben
    for (const ped of this.peds.peds.values()) if (ped.rt <= 0 && ped.hp > 0 && !ped.act && !ped.scn) items.push({ p: ped, player: false });
    if (items.length < 2) return;
    const cell = new Map<number, number[]>();
    const key = (x: number, z: number) => Math.floor(z / 2) * 8192 + Math.floor(x / 2);
    items.forEach((it, i) => { const k = key(it.p.x, it.p.z); const l = cell.get(k); if (l) l.push(i); else cell.set(k, [i]); });
    const min = PAWN_RADIUS * 1.9;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const cx = Math.floor(a.p.x / 2), cz = Math.floor(a.p.z / 2);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const l = cell.get((cz + dz) * 8192 + cx + dx);
        if (!l) continue;
        for (const j of l) {
          if (j <= i) continue;
          const b = items[j];
          let ex = b.p.x - a.p.x, ez = b.p.z - a.p.z;
          const d2 = ex * ex + ez * ez;
          if (d2 >= min * min) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-4) { ex = Math.cos(i * 2.39996); ez = Math.sin(i * 2.39996); d = 1; } else { ex /= d; ez /= d; }
          const push = (min - Math.min(d, min)) * 0.5; // weich: halbe Überlappung je Tick
          const wa = a.player && !b.player ? 0 : b.player && !a.player ? 1 : 0.5;
          const move = (p: P, s: number) => {
            const nx = p.x + ex * push * s * 2, nz = p.z + ez * push * s * 2;
            if (footFree(this.map, nx, nz)) { p.x = nx; p.z = nz; }
          };
          if (wa > 0) move(a.p, -wa);
          if (wa < 1) move(b.p, 1 - wa);
        }
      }
    }
  }

  /** Getroffene Props bewegen; Respawn nach 2 Minuten ohne Zuschauer. */
  private updateProps(dt: number) {
    if (!this.props.size) return;
    const viewers = [...this.players.values()].map((p) => this.positionOf(p));
    const sub = 3, h = dt / sub;
    for (const [id, b] of this.props) {
      for (let k = 0; k < sub; k++) stepPropBody(this.map, b, h);
      const seen = viewers.some((p) => dist2(p.x, p.z, b.x, b.z) < PROP_RESPAWN_RANGE ** 2);
      const def = this.propDefs[id];
      const homeSeen = viewers.some((p) => dist2(p.x, p.z, def.x, def.z) < PROP_RESPAWN_RANGE ** 2);
      b.unseen = seen || homeSeen ? 0 : b.unseen + dt;
      if (b.unseen > PROP_RESPAWN) this.props.delete(id);
    }
  }

  /** Brand -> nach 5 s Comic-Explosion (Flächenschaden 6 m). */
  private updateFire(dt: number) {
    for (const v of this.vehicles.values()) {
      const d = v.sim.dmg;
      if (d.wreck || d.burn <= 0) continue;
      d.burn += dt;
      if (d.burn >= BURN_TIME) this.explode(v);
    }
  }

  private explode(v: ServerVehicle) {
    const c = v.sim.car, d = v.sim.dmg;
    d.wreck = 1; d.hp = 0; d.burn = 0;
    v.dmgVer++;
    this.emit(c.x, c.z, ['boom', v.id, r2(c.x), r2(c.y), r2(c.z)], v.id);
    // das Wrack selbst hüpft
    const dv = derive(v.sim.prof);
    applyImpulse(c, dv, c.x + 0.4, c.y - 0.3, c.z + 0.2, 0, v.sim.prof.mass * 6, 0);
    if (v.driver >= 0) { const p = this.players.get(v.driver); if (p) this.eject(p, v, 0.5); }
    if (v.driver === DRIVER_NPC) this.npcDriverOut(v, false);
    const R = EXPLOSION_RADIUS;
    for (const o of this.nearVehicles(c.x, c.z)) {
      if (o === v) continue;
      const oc = o.sim.car;
      const dx = oc.x - c.x, dz = oc.z - c.z, dist = Math.hypot(dx, dz);
      if (dist > R) continue;
      const k = 1 - dist / R;
      const nx = dx / (dist || 1), nz = dz / (dist || 1);
      if (o.driver === DRIVER_NPC) this.traffic.onHit(o.id, 12 * k + 4);
      applyImpulse(oc, derive(o.sim.prof), oc.x - nx * 0.5, oc.y - 0.4, oc.z - nz * 0.5, nx * o.sim.prof.mass * 9 * k, o.sim.prof.mass * 6 * k, nz * o.sim.prof.mass * 9 * k);
      this.hurt(o, oc.x - nx * o.sim.prof.width / 2, oc.y, oc.z - nz * o.sim.prof.width / 2, nx, 0, nz, 12 * k + 4);
    }
    for (const p of this.players.values()) {
      if (p.vehicleId >= 0) continue;
      const dx = p.pawn.x - c.x, dz = p.pawn.z - c.z, dist = Math.hypot(dx, dz);
      if (dist < R) {
        knockPawn(p.pawn, (dx / (dist || 1)) * 9 * (1 - dist / R), (dz / (dist || 1)) * 9 * (1 - dist / R), 7, 2);
        this.hurtPlayer(p, 70 * (1 - dist / R));
      }
    }
    for (const ped of this.peds.peds.values()) {
      const dx = ped.x - c.x, dz = ped.z - c.z, dist = Math.hypot(dx, dz);
      if (dist < R) this.peds.knock(ped, (dx / (dist || 1)) * 9 * (1 - dist / R), (dz / (dist || 1)) * 9 * (1 - dist / R), 7);
    }
  }

  /** Werkstätten: Fahrzeug 1 s ruhig hinstellen = Reparatur (setzt Blech und Teile zurück). */
  private updateWorkshops(dt: number) {
    for (const p of this.players.values()) {
      const v = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      if (!v) { p.repairT = 0; continue; }
      const c = v.sim.car;
      const ws = this.map.workshops.find((w) => dist2(w.x, w.z, c.x, c.z) < w.r * w.r);
      if (!ws) { p.repairT = 0; continue; }
      const d = v.sim.dmg;
      const damaged = d.hp < 1000 || d.parts || d.glass || d.lights || d.tires || v.dents.length || d.wreck;
      if (!damaged || Math.abs(c.s) > 2 || p.repairT < 0) continue;
      p.repairT += dt;
      if (p.repairT > 1) {
        this.repair(v);
        p.repairT = -1;
        p.conn.send({ t: 'notice', text: 'Werkstatt: Fahrzeug repariert – wie neu!', kind: 'good' });
      }
    }
  }

  private repair(v: ServerVehicle) {
    resetDamage(v.sim.dmg);
    v.dents = [];
    v.dmgVer++;
    this.emit(v.sim.car.x, v.sim.car.z, ['repair', v.id], v.id);
  }

  /** Geparkte Fahrzeuge zurücksetzen, verlassene Verkehrsautos entfernen. */
  private maintainVehicles(dt: number) {
    const players = [...this.players.values()].map((p) => this.positionOf(p));
    const nobodyNear = (x: number, z: number, r: number) => players.every((p) => dist2(p.x, p.z, x, z) > r * r);
    for (const v of this.vehicles.values()) {
      if (v.driver !== DRIVER_NONE) { v.idleTime = 0; v.orphanT = 0; continue; }
      const s = v.sim.car;
      // Verwaist (bewegt/beschädigt, ohne Fahrer): nach 3 Minuten weg – auch wenn Spieler in der Gegend sind
      const displaced = !v.home || dist2(s.x, s.z, v.home.x, v.home.z) > 10 * 10 || v.dmgVer > 0;
      v.orphanT = displaced && v.race === undefined ? (v.orphanT ?? 0) + dt : 0;
      if (v.orphanT > ORPHAN_TIME && nobodyNear(s.x, s.z, ORPHAN_KEEP_RANGE)) {
        v.orphanT = 0;
        if (!v.home) { this.vehicles.delete(v.id); continue; }
        this.resetParked(v);
        continue;
      }
      if (v.home) {
        const moved = dist2(s.x, s.z, v.home.x, v.home.z) > 10 * 10 || v.dmgVer > 0;
        if (!moved || !nobodyNear(s.x, s.z, 60)) { v.idleTime = 0; continue; }
        v.idleTime += dt;
        if (v.idleTime > PARKED_RESET_TIME && nobodyNear(v.home.x, v.home.z, 60)) this.resetParked(v);
      } else {
        if (!nobodyNear(s.x, s.z, 80)) { v.idleTime = 0; continue; }
        v.idleTime += dt;
        if (v.idleTime > ABANDONED_DESPAWN_TIME) this.vehicles.delete(v.id);
      }
    }
  }

  /** Geparktes Auto repariert zurück auf seinen Parkplatz stellen. */
  private resetParked(v: ServerVehicle) {
    const s = v.sim.car, h = v.home!;
    placeCar(this.map, s, v.sim.prof, h.x, h.z, h.a);
    resetDamage(v.sim.dmg);
    v.dents = [];
    v.dmgVer = 0;
    v.idleTime = 0;
    v.orphanT = 0;
    // Clients, die das Fahrzeug kennen, sollen es neu aufbauen
    for (const p of this.players.values()) p.view.dmg.delete(v.id);
    this.emit(s.x, s.z, ['repair', v.id], v.id);
  }

  // ------------------------------------------------------------------ Snapshots
  private vehicleTuple(v: ServerVehicle): string {
    let s = this.tupleCache.get(v.id);
    if (s) return s;
    const c = v.sim.car;
    let flags = 0;
    if (c.brk > 0.1) flags |= VehFlag.BRAKE;
    if (c.rev) flags |= VehFlag.REVERSE;
    if (c.hb) flags |= VehFlag.HANDBRAKE;
    if (c.boost) flags |= VehFlag.BOOST;
    if (v.buttons & Btn.HORN) flags |= VehFlag.HORN;
    const [pitch, roll] = c.ground === 15 && v.kinematic ? [0, 0] : pitchRoll(c);
    s = JSON.stringify([v.id, r2(c.x), r2(c.z), r2(c.y), r3(c.a), Math.round(c.vx * 10) / 10, Math.round(c.vz * 10) / 10,
      r2(c.steer), flags, r3(pitch), r3(roll), Math.round(c.vy * 10) / 10, Math.round(c.rpm / 100)]);
    this.tupleCache.set(v.id, s);
    return s;
  }
  private infoTuple(v: ServerVehicle): string {
    let s = this.infoCache.get(v.id);
    if (!s) { s = JSON.stringify([v.id, v.kind, v.sim.variant, v.color, v.driver]); this.infoCache.set(v.id, s); }
    return s;
  }

  private sendSnapshots() {
    this.tupleCache.clear();
    this.infoCache.clear();
    if (this.players.size === 0) return;
    const players: PlayerTuple[] = [...this.players.values()].map((p) => [
      p.id, p.name, r2(p.pawn.x), r2(p.pawn.z), r3(p.pawn.a), p.vehicleId, p.color, this.quests.isCarrying(p.id) ? 1 : 0,
      r2(p.pawn.h), p.pawn.rt > 0 ? 1 : 0, p.vehicleId >= 0 || p.downT > 0 ? 0 : Math.max(0, weaponNames.indexOf(p.weapon)),
    ]);
    const common = `"time":${Date.now()},"day":${r3((((Date.now() - this.startedAt) / DAY_LENGTH_MS) + 0.35) % 1)},"players":${JSON.stringify(players)},"quest":null`;
    const R2 = INTEREST * INTEREST;
    const pedStr = new Map<number, string>();
    for (const ped of this.peds.peds.values()) {
      const tup: (number | string)[] = [ped.id, r1(ped.x), r1(ped.z), r2(ped.a), ped.color, ped.cop ? 3 : ped.gang ? 4 + Math.max(0, GANG_IDS.indexOf(ped.gang as GangId)) : this.peds.isRunning(ped) ? 1 : ped.angry > 0 ? 2 : 0, r1(ped.h), ped.rt > 0 ? 1 : 0, ped.arch, ped.act];
      // Kurzzeitgedächtnis: Spieler, den der NPC ängstlich im Blick behält (Kopfdrehung rechnet der Client)
      if (ped.mind?.fear) tup.push(ped.mind.fear.pid);
      pedStr.set(ped.id, JSON.stringify(tup));
    }
    const propStr = new Map<number, string>();
    for (const b of this.props.values()) {
      propStr.set(b.id, JSON.stringify([b.id, r2(b.x), r2(b.y), r2(b.z), r3(b.qx), r3(b.qy), r3(b.qz), r3(b.qw), (b.rest ? 1 : 0) | (b.spray > 0 ? 2 : 0)]));
    }

    for (const p of this.players.values()) {
      const pos = this.positionOf(p);
      const view = p.view;
      const near = (x: number, z: number) => dist2(x, z, pos.x, pos.z) < R2;
      const nearPed = (x: number, z: number) => dist2(x, z, pos.x, pos.z) < PED_INTEREST * PED_INTEREST;
      const parts: string[] = [];
      // Fahrzeuge
      const v: string[] = [], vi: string[] = [], vg: number[] = [], dmg: string[] = [], dents: string[] = [];
      for (const veh of this.vehicles.values()) {
        const c = veh.sim.car;
        if (!near(c.x, c.z) && veh.id !== p.vehicleId) continue;
        const known = view.veh.has(veh.id);
        const t = this.vehicleTuple(veh);
        if (view.veh.get(veh.id) !== t) { v.push(t); view.veh.set(veh.id, t); }
        const it = this.infoTuple(veh);
        if (view.info.get(veh.id) !== it) { vi.push(it); view.info.set(veh.id, it); }
        if ((view.dmg.get(veh.id) ?? 0) !== veh.dmgVer) {
          dmg.push(JSON.stringify([veh.id, ...packDamage(veh.sim.dmg)]));
          view.dmg.set(veh.id, veh.dmgVer);
        }
        if (!known && veh.dents.length) dents.push(JSON.stringify([veh.id, veh.dents]));
      }
      for (const id of view.veh.keys()) {
        const veh = this.vehicles.get(id);
        if (!veh || (!near(veh.sim.car.x, veh.sim.car.z) && veh.id !== p.vehicleId)) {
          vg.push(id); view.veh.delete(id); view.info.delete(id); view.dmg.delete(id);
        }
      }
      if (v.length) parts.push(`"v":[${v.join(',')}]`);
      if (vi.length) parts.push(`"vi":[${vi.join(',')}]`);
      if (vg.length) parts.push(`"vg":${JSON.stringify(vg)}`);
      if (dmg.length) parts.push(`"dmg":[${dmg.join(',')}]`);
      if (dents.length) parts.push(`"dents":[${dents.join(',')}]`);
      // Fußgänger
      const pd: string[] = [], pg: number[] = [];
      for (const ped of this.peds.peds.values()) {
        if (!nearPed(ped.x, ped.z)) continue;
        const t = pedStr.get(ped.id)!;
        if (view.peds.get(ped.id) !== t) { pd.push(t); view.peds.set(ped.id, t); }
      }
      for (const id of view.peds.keys()) {
        const ped = this.peds.peds.get(id);
        if (!ped || !nearPed(ped.x, ped.z)) { pg.push(id); view.peds.delete(id); }
      }
      if (pd.length) parts.push(`"p":[${pd.join(',')}]`);
      if (pg.length) parts.push(`"pg":${JSON.stringify(pg)}`);
      // Props
      const pr: string[] = [], prg: number[] = [];
      for (const b of this.props.values()) {
        if (!near(b.x, b.z)) continue;
        const t = propStr.get(b.id)!;
        if (view.props.get(b.id) !== t) { pr.push(t); view.props.set(b.id, t); }
      }
      for (const id of view.props.keys()) {
        const b = this.props.get(id);
        if (!b || !near(b.x, b.z)) { prg.push(id); view.props.delete(id); }
      }
      if (pr.length) parts.push(`"pr":[${pr.join(',')}]`);
      if (prg.length) parts.push(`"prg":${JSON.stringify(prg)}`);
      // Ereignisse im Umkreis
      const ev = this.events.filter((e) => e.vid === p.vehicleId && e.vid >= 0 || dist2(e.x, e.z, pos.x, pos.z) < (INTEREST + 20) ** 2).map((e) => e.ev);
      if (ev.length) parts.push(`"ev":${JSON.stringify(ev)}`);
      // Eigener Zustand
      const myV = p.vehicleId >= 0 ? this.vehicles.get(p.vehicleId) : undefined;
      const pw = p.pawn;
      const me = { pawn: [r3(pw.x), r3(pw.z), r3(pw.a), r3(pw.h), r3(pw.vx), r3(pw.vy), r3(pw.vz), r3(pw.rt)], veh: myV ? packCar(myV.sim.car) : null, money: p.profile.money, stats: this.statsOf(p), quest: this.quests.view(p) ?? this.races.view(p) ?? this.hunt.view(p) };
      parts.push(`"me":${JSON.stringify(me)}`);
      p.conn.sendRaw(`{"t":"snap","ack":${p.lastSeq},${common},${parts.join(',')}}`);
    }
  }

  dispose() {
    clearInterval(this.timer);
  }
}

