// Straßenereignisse als Daten: Schema, Bau-Helfer und Validierung.
// Ein Ereignis hat Rollen (NPCs, Fahrzeuge, Tiere, Requisiten), einen Ablauf in Phasen mit
// Sprechblasen/Animationen/Physik-Aktionen, Eingreifoptionen mit Erkennungsbedingung und Ausgänge.
// Der Server entscheidet Start, Rollenbesetzung und Ausgang; Clients spielen Phasen synchron ab.
// Ton (spec 1.5): Comic-Gewalt ohne Blut, niemand stirbt, Humor aus Situationen – nie aus Herkunft,
// Ethnie, Religion, Behinderung oder Aussehen. Keine realen Personen oder Marken.
import type { ArchetypeId } from '../../npc/archetypes';
import { ARCHETYPES } from '../../npc/archetypes';
import type { DayPart } from '../../npc/population';
import { DAY_PARTS } from '../../npc/population';
import { Act } from '../../npc/scenarios';
import type { GangId } from '../../gangs';
import { GANG_IDS } from '../../gangs';
import type { DistrictId } from '../../world/districts/types';

/** Wetterlage für Ereignisbedingungen (erweitert die Population-Wetter um Wind und Nebel). */
export type EventWeather = 'clear' | 'sunny' | 'rain' | 'rain_start' | 'heat' | 'wind' | 'fog';
export const EVENT_WEATHER: readonly EventWeather[] = ['clear', 'sunny', 'rain', 'rain_start', 'heat', 'wind', 'fog'];

/** Benötigte Orte / Smart Objects in der Nähe des Startpunkts. */
export const EVENT_PLACES = [
  // Smart Objects (SmartKind)
  'Bench', 'BusStop', 'TacoStand', 'Atm', 'Lounger', 'FishSpot', 'Payphone', 'Wall', 'Trash', 'Newsbox', 'ClubDoor', 'CafeTable', 'Hoop', 'Grill', 'Door',
  // Orte (aus Kartendaten / Tiles / POI ableitbar)
  'beach', 'promenade', 'road', 'main_road', 'sidewalk', 'plaza', 'park', 'fountain', 'highrise', 'parking', 'gym',
  'lifeguard_tower', 'hotel', 'water_edge', 'pier', 'dock', 'crane', 'container_yard', 'bridge', 'golf', 'garden', 'hedge', 'villa',
  'motel', 'workshop', 'carwash', 'bus_station', 'highway', 'field', 'slope', 'main_street', 'stilt_hut', 'swamp_water',
  'marina', 'souvenir_shop', 'office_tower', 'power_box', 'gas_station', 'cafe', 'awning',
] as const;
export type EventPlace = (typeof EVENT_PLACES)[number];

export type ActName = keyof typeof Act;
export const ACT_NAME_LIST = Object.keys(Act) as ActName[];

/** Fahrzeug-, Tier- und Requisiten-Arten. */
export const VEHICLE_KINDS = [
  'car', 'convertible', 'sports', 'limo', 'taxi', 'pickup', 'truck', 'semi', 'van', 'food_truck', 'ice_cart', 'scooter', 'segway',
  'forklift', 'crane', 'yacht', 'boat', 'airboat', 'police_car', 'tow_truck', 'mower', 'gondola', 'firetruck',
] as const;
export const ANIMAL_KINDS = ['seagull', 'dog', 'poodle', 'rooster', 'iguana', 'gator', 'cow', 'goat', 'pelican', 'fish'] as const;
export const PROP_KINDS = [
  'fries', 'trash_can', 'reflector', 'metal_detector', 'bottle_cap', 'wallet', 'flamingo_shirt', 'briefcase', 'paper_sheet',
  'megaphone', 'crate', 'domino_table', 'plastic_chair', 'speaker', 'grill', 'container', 'rubber_duck', 'bowling_ball',
  'plush', 'pineapple', 'hat', 'hedge_trimmer', 'golf_ball', 'champagne_fountain', 'cake_tower', 'suitcase', 'clothes',
  'extinguisher', 'flashlight', 'cooler', 'ring', 'tin_foil_hat', 'camera', 'sausage', 'orange', 'orange_crate', 'flyer',
  'campaign_sign', 'umbrella', 'phone_light', 'fuse_box', 'treasure_map', 'shovel', 'fishing_rod', 'ice_cream', 'roller_skates',
  'water_bucket', 'bush', 'lemonade', 'neon_light', 'cone', 'tape', 'flowers', 'candles', 'buffet', 'rope', 'sandwich', 'dice',
] as const;
export type VehicleKind = (typeof VEHICLE_KINDS)[number];
export type AnimalKind = (typeof ANIMAL_KINDS)[number];
export type PropKind = (typeof PROP_KINDS)[number];

export type Role =
  | { id: string; kind: 'npc'; arch: ArchetypeId | 'gang_turf' | 'police'; label: string; count?: [number, number] }
  | { id: string; kind: 'vehicle'; vehicle: VehicleKind; label: string; count?: [number, number]; driver?: string }
  | { id: string; kind: 'animal'; animal: AnimalKind; label: string; count?: [number, number] }
  | { id: string; kind: 'prop'; prop: PropKind; label: string; count?: [number, number] };

/** Sprechblasen-Typen (siehe Gesprächssystem): Sprechen, Rufen (gezackt), Flüstern (gestrichelt),
 *  Denken (Wolke), Gang-Slang (Gangfarbe), Herz/Symbol, Geräusch (Comic-Lautmalerei). */
export type BubbleStyle = 'say' | 'shout' | 'whisper' | 'think' | 'gang' | 'symbol' | 'sfx';
export const BUBBLE_STYLES: readonly BubbleStyle[] = ['say', 'shout', 'whisper', 'think', 'gang', 'symbol', 'sfx'];
export interface Line { role: string; text: string; style: BubbleStyle; at?: number }

/** Bewegungsmuster einer Rolle während einer Phase (Server simuliert, Client interpoliert). */
export type MoveKind = 'idle' | 'circle' | 'flee' | 'chase' | 'goto' | 'follow' | 'wander' | 'dash' | 'swarm' | 'drift' | 'climb' | 'fall' | 'hide' | 'gather';
export const MOVE_KINDS: readonly MoveKind[] = ['idle', 'circle', 'flee', 'chase', 'goto', 'follow', 'wander', 'dash', 'swarm', 'drift', 'climb', 'fall', 'hide', 'gather'];
export interface Action { role: string; act?: ActName; move?: MoveKind; target?: string }

/** Physik-Effekte (clientseitig deterministisch aus Seed, Pickups serverseitig autoritativ). */
export type PhysicsKind =
  | 'spawn_pickups' | 'scatter_props' | 'knockback' | 'chain_collide' | 'tip_over' | 'splash' | 'projectiles'
  | 'paper_flurry' | 'bump_vehicles' | 'fire' | 'foam' | 'lights_out' | 'lights_on' | 'traffic_jam' | 'sway';
export const PHYSICS_KINDS: readonly PhysicsKind[] = [
  'spawn_pickups', 'scatter_props', 'knockback', 'chain_collide', 'tip_over', 'splash', 'projectiles',
  'paper_flurry', 'bump_vehicles', 'fire', 'foam', 'lights_out', 'lights_on', 'traffic_jam', 'sway',
];
export interface Physics {
  kind: PhysicsKind;
  /** Betroffene Rolle(n) bzw. Quelle. */
  role?: string;
  roles?: string[];
  prop?: PropKind;
  count?: number;
  radius?: number;
  /** Bodenhaftung der Pickups (1 = normal; Orangen rollen bei 0.2). */
  grip?: number;
  /** Schaden pro Treffer bei Projektilen / Dellen am Auto. */
  damage?: number;
  /** Lebensdauer in Sekunden. */
  life?: number;
}

export interface Phase {
  id: string;
  /** Dauer in Sekunden [min, max]. */
  dur: [number, number];
  actions?: Action[];
  lines?: Line[];
  physics?: Physics[];
  /** Folgephase (Standard: nächste in der Liste; 'end' beendet mit Ausgang 'ignored'). */
  next?: string;
}

/** Erkennung von Spieler-Eingriffen (Server prüft pro Tick die Spieler im Umkreis). */
export type Detect =
  | { kind: 'honk'; radius: number; vehicle?: VehicleKind; inFog?: boolean }
  | { kind: 'approach'; radius: number; target: string; onFoot?: boolean; running?: boolean }
  | { kind: 'emote'; radius: number; emote?: 'dance' | 'flex' | 'wave' | 'cheer' | 'any' }
  | { kind: 'block_path'; target: string; radius: number }
  | { kind: 'drive_through'; radius: number; target?: string; minSpeed?: number }
  | { kind: 'park_on'; radius: number; place: EventPlace }
  | { kind: 'interact'; target: string; hold?: number; minigame?: string }
  | { kind: 'catch'; target: string; hold: number; evasive: boolean }
  | { kind: 'collect'; prop: PropKind; count: number; deliverTo?: string }
  | { kind: 'deliver'; what: string; to: string; byVehicle?: boolean; dest?: EventPlace }
  | { kind: 'escort'; target: string; dest: EventPlace | 'district'; destDistrict?: DistrictId }
  | { kind: 'wait_out'; radius: number; stillFor?: number }
  | { kind: 'race'; vehicle?: VehicleKind; checkpoints: number; stake?: [number, number] }
  | { kind: 'pay'; amount: number; to: string }
  | { kind: 'talk'; count: number; prop?: PropKind }
  | { kind: 'board'; target: string; byVehicle?: VehicleKind }
  | { kind: 'climb'; target: EventPlace; then?: Detect }
  | { kind: 'use_item'; item: 'extinguisher' | 'firetruck'; target: string }
  | { kind: 'enter_area'; place: EventPlace; outfit?: 'formal' | 'any' };

/** Zusatzbedingung für eine Eingreifoption (Ruf, Outfit, Fahrzeug, Zufall). */
export interface Gate {
  rep?: { gang: GangId | 'event_gang'; min?: number; max?: number };
  outfit?: 'formal' | 'casual' | 'any';
  inVehicle?: boolean;
  onFoot?: boolean;
}

export interface Intervention {
  id: string;
  label: string;
  detect: Detect;
  gate?: Gate;
  /** In welchen Phasen möglich (leer = alle). */
  phases?: string[];
  outcome: string;
}

export type MoodAxis = 'safety' | 'wealth' | 'gang';
export type TraceKind =
  | 'police_tape' | 'wreck' | 'flowers' | 'graffiti' | 'repaired_window' | 'wanted_poster' | 'wet_footprints'
  | 'tipped_cart' | 'floating_ducks' | 'damaged_pier' | 'scattered_chairs' | 'paper_litter' | 'orange_peels'
  | 'foam_puddle' | 'campaign_posters' | 'holes' | 'tourists_with_cameras' | 'airboat_rental' | 'double_parked';
export const TRACE_KINDS: readonly TraceKind[] = [
  'police_tape', 'wreck', 'flowers', 'graffiti', 'repaired_window', 'wanted_poster', 'wet_footprints',
  'tipped_cart', 'floating_ducks', 'damaged_pier', 'scattered_chairs', 'paper_litter', 'orange_peels',
  'foam_puddle', 'campaign_posters', 'holes', 'tourists_with_cameras', 'airboat_rental', 'double_parked',
];

export interface Outcome {
  label: string;
  money?: number;
  xp?: number;
  /** Gesundheit: Zahl oder 'full'. */
  health?: number | 'full';
  items?: string[];
  /** Beziehung zu benanntem Stammgast (Stammgast-ID oder Rolle des Ereignisses). */
  regular?: { id: string; delta: number };
  mood?: Partial<Record<MoodAxis, number>>;
  rep?: { gang: GangId | 'event_gang'; delta: number }[];
  wanted?: number;
  fame?: number;
  /** Schaden am Spieler pro Treffer (z. B. Ananas). */
  damage?: number;
  /** Gerücht überschreibt die Standard-Vorlage. */
  rumor?: string;
  radio?: string;
  traces?: { kind: TraceKind; minutes: number }[];
  /** Dauerhafte Weltänderung in dieser Instanz (Flag für Welt-/Quest-Logik). */
  worldFlag?: string;
  /** Folge-Mini-Auftrag (Quest-ID oder Beschreibung). */
  followUp?: string;
  /** Abschlusszeilen nach diesem Ausgang. */
  lines?: Line[];
  /** Feindseligkeit der Rollen/ Gang danach. */
  hostile?: boolean;
}

export interface RumorTemplate {
  /** Text mit Platzhaltern: {player} (Name oder Beschreibung je nach Bekanntheit), {district}, {gang}. */
  text: string;
  /** Wie weit es sich verbreitet. */
  spread: 'district' | 'zone' | 'city';
  /** Gewicht für Radio/Schlagzeilen 0–1. */
  heat: number;
}

export interface EventConditions {
  parts?: DayPart[];
  weather?: EventWeather[];
  weekend?: boolean;
  /** Wochentag(e) 0 = Sonntag … 6 = Samstag. */
  weekdays?: number[];
  mood?: Partial<Record<MoodAxis, { min?: number; max?: number }>>;
  /** Mindest-Einfluss irgendeiner Gang (oder einer bestimmten) im Block. */
  gangInfluence?: { gang?: GangId; min: number };
  /** Spieler-Bekanntheit 0–100. */
  fame?: { min?: number; max?: number };
  /** Benötigt Stau / Verkehr. */
  traffic?: boolean;
}

export interface Variant { id: string; chance: number; label: string; note: string }

export interface StreetEventDef {
  id: string;
  key: string;
  title: string;
  district: DistrictId | 'anywhere';
  /** Großes Ereignis (max. 1 pro Spieler-Umkreis) oder kleines (max. 2). */
  size: 'big' | 'small';
  when: EventConditions;
  weight: number;
  /** Abklingzeit pro Instanz in Spielminuten. */
  cooldown: number;
  needs: EventPlace[];
  roles: Role[];
  phases: Phase[];
  interventions: Intervention[];
  outcomes: Record<string, Outcome>;
  rumor: RumorTemplate;
  radio?: string;
  variants?: Variant[];
}

// ------------------------------------------------------------------ Bau-Helfer (kompakte Daten)
export const say = (role: string, text: string, at?: number): Line => ({ role, text, style: 'say', at });
export const shout = (role: string, text: string, at?: number): Line => ({ role, text, style: 'shout', at });
export const whisper = (role: string, text: string, at?: number): Line => ({ role, text, style: 'whisper', at });
export const think = (role: string, text: string, at?: number): Line => ({ role, text, style: 'think', at });
export const gang = (role: string, text: string, at?: number): Line => ({ role, text, style: 'gang', at });
export const symbol = (role: string, text: string, at?: number): Line => ({ role, text, style: 'symbol', at });
export const sfx = (role: string, text: string, at?: number): Line => ({ role, text, style: 'sfx', at });
export const npc = (id: string, arch: ArchetypeId | 'gang_turf' | 'police', label: string, count?: [number, number]): Role =>
  ({ id, kind: 'npc', arch, label, count });
export const veh = (id: string, vehicle: VehicleKind, label: string, count?: [number, number], driver?: string): Role =>
  ({ id, kind: 'vehicle', vehicle, label, count, driver });
export const animal = (id: string, a: AnimalKind, label: string, count?: [number, number]): Role => ({ id, kind: 'animal', animal: a, label, count });
export const prop = (id: string, p: PropKind, label: string, count?: [number, number]): Role => ({ id, kind: 'prop', prop: p, label, count });
export const act = (role: string, a?: ActName, move?: MoveKind, target?: string): Action => ({ role, act: a, move, target });
export const phase = (id: string, dur: [number, number], body: Omit<Phase, 'id' | 'dur'> = {}): Phase => ({ id, dur, ...body });

/** Standard-Ausgang, wenn niemand eingreift. */
export const IGNORED = 'ignored';

// ------------------------------------------------------------------ Validierung
const ARCH_IDS = new Set<string>(ARCHETYPES.map((a) => a.id));
const PLACES = new Set<string>(EVENT_PLACES);

/** Prüft ein Ereignis gegen das Schema und alle internen Referenzen. Gibt Fehlermeldungen zurück. */
export function validateEvent(e: StreetEventDef, districtIds: readonly string[], regularIds: ReadonlySet<string> = new Set()): string[] {
  const err: string[] = [];
  const f = (m: string) => err.push(`${e.id} (${e.key}): ${m}`);
  if (!/^E\d{2}$/.test(e.id)) f('id muss die Form E01 haben');
  if (!/^[a-z0-9_]+$/.test(e.key)) f('key nur a-z, 0-9, _');
  if (!e.title.trim()) f('Titel fehlt');
  if (e.district !== 'anywhere' && !districtIds.includes(e.district)) f(`unbekanntes Viertel ${e.district}`);
  if (!(e.weight > 0)) f('weight muss > 0 sein');
  if (!(e.cooldown > 0)) f('cooldown muss > 0 sein');
  for (const p of e.when.parts ?? []) if (!DAY_PARTS.includes(p)) f(`unbekannte Tageszeit ${p}`);
  for (const w of e.when.weather ?? []) if (!EVENT_WEATHER.includes(w)) f(`unbekanntes Wetter ${w}`);
  for (const d of e.when.weekdays ?? []) if (d < 0 || d > 6) f(`Wochentag ${d} ungültig`);
  for (const [axis, r] of Object.entries(e.when.mood ?? {})) {
    if (r.min != null && (r.min < 0 || r.min > 100)) f(`mood.${axis}.min außerhalb 0–100`);
    if (r.max != null && (r.max < 0 || r.max > 100)) f(`mood.${axis}.max außerhalb 0–100`);
  }
  if (e.when.gangInfluence?.gang && !GANG_IDS.includes(e.when.gangInfluence.gang)) f('gangInfluence: unbekannte Gang');
  for (const n of e.needs) if (!PLACES.has(n)) f(`unbekannter Ort/Smart Object ${n}`);

  const roles = new Set<string>();
  for (const r of e.roles) {
    if (roles.has(r.id)) f(`Rolle ${r.id} doppelt`);
    roles.add(r.id);
    if (r.kind === 'npc' && r.arch !== 'gang_turf' && r.arch !== 'police' && !ARCH_IDS.has(r.arch)) f(`Rolle ${r.id}: unbekannter Archetyp ${r.arch}`);
    if (r.kind === 'vehicle' && !(VEHICLE_KINDS as readonly string[]).includes(r.vehicle)) f(`Rolle ${r.id}: unbekanntes Fahrzeug`);
    if (r.kind === 'vehicle' && r.driver && !e.roles.some((x) => x.id === r.driver)) f(`Rolle ${r.id}: Fahrer ${r.driver} fehlt`);
    if (r.kind === 'animal' && !(ANIMAL_KINDS as readonly string[]).includes(r.animal)) f(`Rolle ${r.id}: unbekanntes Tier`);
    if (r.kind === 'prop' && !(PROP_KINDS as readonly string[]).includes(r.prop)) f(`Rolle ${r.id}: unbekannte Requisite`);
    if (r.count && (r.count[0] < 1 || r.count[1] < r.count[0])) f(`Rolle ${r.id}: count ungültig`);
  }
  const hasRole = (id: string, where: string) => { if (!roles.has(id)) f(`${where}: unbekannte Rolle ${id}`); };
  const checkLine = (l: Line, where: string) => {
    hasRole(l.role, where);
    if (!BUBBLE_STYLES.includes(l.style)) f(`${where}: unbekannter Blasenstil ${l.style}`);
    if (!l.text.trim()) f(`${where}: leere Sprechblase`);
    if (l.text.length > 90) f(`${where}: Sprechblase zu lang (${l.text.length} > 90)`);
  };

  if (!e.phases.length) f('mindestens eine Phase nötig');
  const phases = new Set<string>();
  for (const p of e.phases) { if (phases.has(p.id)) f(`Phase ${p.id} doppelt`); phases.add(p.id); }
  let lines = 0;
  for (const p of e.phases) {
    const w = `Phase ${p.id}`;
    if (!(p.dur[0] > 0) || p.dur[1] < p.dur[0]) f(`${w}: Dauer ungültig`);
    if (p.next && p.next !== 'end' && !phases.has(p.next)) f(`${w}: Folgephase ${p.next} fehlt`);
    for (const a of p.actions ?? []) {
      hasRole(a.role, w);
      if (a.act && !ACT_NAME_LIST.includes(a.act)) f(`${w}: unbekannte Animation ${a.act}`);
      if (a.move && !MOVE_KINDS.includes(a.move)) f(`${w}: unbekannte Bewegung ${a.move}`);
      if (a.target) hasRole(a.target, `${w} Ziel`);
    }
    for (const l of p.lines ?? []) { checkLine(l, w); lines++; if (l.at != null && (l.at < 0 || l.at > p.dur[1])) f(`${w}: Zeitpunkt ${l.at}s außerhalb der Phase`); }
    for (const ph of p.physics ?? []) {
      if (!PHYSICS_KINDS.includes(ph.kind)) f(`${w}: unbekannte Physik ${ph.kind}`);
      if (ph.role) hasRole(ph.role, w);
      for (const r of ph.roles ?? []) hasRole(r, w);
      if (ph.prop && !(PROP_KINDS as readonly string[]).includes(ph.prop)) f(`${w}: unbekannte Requisite ${ph.prop}`);
    }
  }
  if (lines < 2) f('mindestens zwei Sprechblasen im Ablauf');

  const outcomes = new Set(Object.keys(e.outcomes));
  if (!outcomes.has(IGNORED)) f(`Ausgang „${IGNORED}“ fehlt`);
  const ivIds = new Set<string>();
  const checkDetect = (d: Detect, w: string) => {
    if ('target' in d && typeof d.target === 'string') {
      if (d.kind === 'climb') { if (!PLACES.has(d.target)) f(`${w}: unbekannter Ort ${d.target}`); }
      else hasRole(d.target, w);
    }
    if ('to' in d) hasRole(d.to, w);
    if (d.kind === 'deliver') hasRole(d.what, w);
    if ('radius' in d && !(d.radius > 0)) f(`${w}: Radius muss > 0 sein`);
    if ('place' in d && !PLACES.has(d.place)) f(`${w}: unbekannter Ort ${d.place}`);
    if ('dest' in d && d.dest && d.dest !== 'district' && !PLACES.has(d.dest)) f(`${w}: unbekanntes Ziel ${d.dest}`);
    if (d.kind === 'escort' && d.dest === 'district' && !districtIds.includes(d.destDistrict ?? '')) f(`${w}: Zielviertel fehlt`);
    if (d.kind === 'collect' && d.deliverTo) hasRole(d.deliverTo, w);
    if (d.kind === 'collect' && !(PROP_KINDS as readonly string[]).includes(d.prop)) f(`${w}: unbekannte Requisite ${d.prop}`);
    if (d.kind === 'climb' && d.then) checkDetect(d.then, w);
  };
  for (const iv of e.interventions) {
    const w = `Eingriff ${iv.id}`;
    if (ivIds.has(iv.id)) f(`${w} doppelt`);
    ivIds.add(iv.id);
    if (!outcomes.has(iv.outcome)) f(`${w}: Ausgang ${iv.outcome} fehlt`);
    for (const p of iv.phases ?? []) if (!phases.has(p)) f(`${w}: Phase ${p} fehlt`);
    if (iv.gate?.rep && iv.gate.rep.gang !== 'event_gang' && !GANG_IDS.includes(iv.gate.rep.gang)) f(`${w}: unbekannte Gang`);
    checkDetect(iv.detect, w);
  }
  for (const [id, o] of Object.entries(e.outcomes)) {
    const w = `Ausgang ${id}`;
    for (const r of o.rep ?? []) if (r.gang !== 'event_gang' && !GANG_IDS.includes(r.gang)) f(`${w}: unbekannte Gang ${r.gang}`);
    for (const t of o.traces ?? []) { if (!TRACE_KINDS.includes(t.kind)) f(`${w}: unbekannte Spur ${t.kind}`); if (!(t.minutes > 0)) f(`${w}: Spurdauer > 0`); }
    for (const l of o.lines ?? []) checkLine(l, w);
    if (o.regular && !roles.has(o.regular.id) && !regularIds.has(o.regular.id)) f(`${w}: unbekannter Stammgast/Rolle ${o.regular.id}`);
    if (o.regular && (o.regular.delta < -50 || o.regular.delta > 50)) f(`${w}: Beziehungsänderung außerhalb −50…50`);
    if (o.wanted != null && (o.wanted < 0 || o.wanted > 4)) f(`${w}: Fahndung 0–4`);
    if (o.money != null && o.money < 0) f(`${w}: Geld darf nicht negativ sein (Strafe über wanted/rep)`);
  }
  if (!e.rumor.text.trim()) f('Gerücht fehlt');
  if (e.rumor.heat < 0 || e.rumor.heat > 1) f('rumor.heat 0–1');
  let chance = 0;
  for (const v of e.variants ?? []) chance += v.chance;
  if (chance > 1) f('Varianten-Wahrscheinlichkeiten > 100 %');
  return err;
}
