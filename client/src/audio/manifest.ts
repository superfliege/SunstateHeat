// Sound-Manifest: EINZIGE Quelle für alle Sounds im Spiel.
//   - Laufzeit (SoundBank) liest daraus Bus, Lautstärke, Tonhöhen-/Pegelstreuung, 3D-Einstellungen,
//     Stimmen-Limits und den prozeduralen Ersatz (proc), falls (noch) keine Datei da ist.
//   - scripts/process-audio.ts verarbeitet die Rohdateien (files[].src, relativ zu assets-src/audio/)
//     nach client/public/audio/ und erzeugt aus den Lizenzangaben den Audio-Abschnitt in CREDITS.md.
// Reine Daten, kein DOM – wird auch vom Node-Skript importiert.
//
// Neue Rohdatei einbinden: Datei nach assets-src/audio/<quelle>/… legen, beim passenden Eintrag
// unten in files[] eintragen ({ src, license }), `npm run audio` ausführen. Fehlende Dateien
// sind kein Fehler: dann klingt der prozedurale Ersatz.

export type BusId = 'sfx' | 'vehicles' | 'weapons' | 'voice' | 'ambience' | 'music' | 'ui';
export const BUSES: BusId[] = ['sfx', 'vehicles', 'weapons', 'voice', 'ambience', 'music', 'ui'];

/** Lizenzquellen. redistributable = Rohdateien dürfen ins Repository (sonst per .gitignore draußen). */
export type LicenseId = 'kenney-cc0' | 'freesound-cc0' | 'oga-cc0' | 'freepd-cc0' | 'pixabay' | 'sonniss-gdc';
export const LICENSES: Record<LicenseId, { name: string; url: string; redistributable: boolean; note: string }> = {
  'kenney-cc0': { name: 'Kenney (CC0 1.0)', url: 'https://kenney.nl/assets', redistributable: true, note: 'Gemeinfrei, keine Namensnennung nötig.' },
  'freesound-cc0': { name: 'Freesound (nur CC0 1.0)', url: 'https://freesound.org', redistributable: true, note: 'Nur Dateien mit CC0-Lizenz verwenden; Urheber trotzdem nennen.' },
  'oga-cc0': { name: 'OpenGameArt (CC0 1.0)', url: 'https://opengameart.org', redistributable: true, note: 'Nur CC0-Einträge.' },
  'freepd-cc0': { name: 'FreePD (CC0 1.0)', url: 'https://freepd.com', redistributable: true, note: 'Gemeinfrei.' },
  'pixabay': { name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/', redistributable: false, note: 'Nutzung im Spiel erlaubt, Rohdateien nicht weiterverbreiten.' },
  'sonniss-gdc': { name: 'Sonniss GDC Game Audio Bundle (lizenzfrei)', url: 'https://sonniss.com/gameaudiogdc', redistributable: false, note: 'Lizenzfrei im Spiel nutzbar, Rohdateien nicht weiterverbreiten.' },
};

/** Ziel-Lautheit der Pipeline je Bus (LUFS). */
export const LOUDNESS: Record<BusId, number> = { sfx: -16, vehicles: -16, weapons: -16, voice: -16, ambience: -24, music: -18, ui: -16 };

/** Audio-Zonen für Lazy Loading (Viertel-Name bzw. Zonen-Name als Slug, siehe Environment.audioZone). */
export type AudioZone = 'ocean-strip' | 'downtown' | 'port-district' | 'port-coralia' | 'coral-keys' | 'gator-flats' | 'dry-pine-country'
  | 'pinecrest-highlands' | 'port-sabal' | 'cane-ridge';

export interface SoundFile {
  /** Rohdatei relativ zu assets-src/audio/ (wird verarbeitet). */
  src?: string;
  /** Fertige Datei relativ zu client/public/assets/ (z. B. Kenney-Packs, unverarbeitet benutzt). */
  asset?: string;
  license: LicenseId;
  author?: string;
  url?: string;
  /** Zuschnitt (s) */
  start?: number; dur?: number;
  /** Motor-Loops: Drehzahl der Aufnahme (für die Tonhöhe). */
  rpm?: number;
}

/** 3D-Einstellungen (PannerNode, Abstandsmodell "inverse"). */
export interface SpatialSpec { ref: number; max: number; rolloff: number; /** Hallanteil 0..1 */ wet: number }
export const SPATIAL = {
  vehicle: { ref: 7, max: 260, rolloff: 1.1, wet: 0.35 },
  impact: { ref: 6, max: 200, rolloff: 1.1, wet: 0.5 },
  weapon: { ref: 10, max: 450, rolloff: 0.9, wet: 0.7 },
  siren: { ref: 14, max: 600, rolloff: 0.85, wet: 0.5 },
  voice: { ref: 3, max: 45, rolloff: 1.4, wet: 0.3 },
  point: { ref: 3, max: 70, rolloff: 1.5, wet: 0.3 },
  step: { ref: 2, max: 30, rolloff: 1.6, wet: 0.25 },
} satisfies Record<string, SpatialSpec>;

export interface SoundDef {
  id: string;
  bus: BusId;
  /** oneshot = Effekt (Sprite-fähig), loop = gepufferter Loop, stream = großer Loop/Musik (MediaElement) */
  kind: 'oneshot' | 'loop' | 'stream';
  files: SoundFile[];
  /** Grundlautstärke in dB */
  vol?: number;
  /** Abspielrate (Tonhöhe) als Zufallsbereich */
  pitch?: [number, number];
  /** Pegelstreuung ± dB */
  volJitter?: number;
  /** 3D-Einstellungen; fehlt = 2D (UI, eigenes Fahrzeug, Musik) */
  spatial?: SpatialSpec;
  /** max. gleichzeitige Instanzen dieses Sounds */
  maxInst?: number;
  /** Priorität 0..1 beim Stimmen-Klau */
  priority?: number;
  /** Nur in diesen Zonen (+ Nachbarn) laden; fehlt = global beim Start */
  zones?: AudioZone[];
  /** Kurze Effekte in ein gemeinsames Sprite packen */
  sprite?: string;
  /** Prozeduraler Ersatz (Schlüssel in procedural.ts), solange keine Datei geladen ist */
  proc?: string;
  /** Stereo behalten (Musik/Ambience); sonst Mono für 3D */
  stereo?: boolean;
  /** Bei Loops: Überblendlänge der Naht (s) */
  loopXfade?: number;
}

// ------------------------------------------------------------------ Hilfen
const K_IMPACT = 'kenney/impact-sounds/';
const K_UI = 'kenney/interface-sounds/';
const kenney = (prefix: string, count: number, dir = K_IMPACT): SoundFile[] =>
  Array.from({ length: count }, (_, i) => ({ asset: `${dir}${prefix}_00${i}.ogg`, license: 'kenney-cc0' as const }));
const ka = (asset: string): SoundFile => ({ asset, license: 'kenney-cc0' });

/** Fahrzeug-Klangklassen (eigene Tabelle, damit z. B. Polizei wie ein V8 klingt). */
export const ENGINE_SETS = ['compact', 'sedan', 'sport', 'muscle', 'suv', 'truck', 'bike', 'boat', 'airboat'] as const;
export type EngineSet = (typeof ENGINE_SETS)[number];
export const ENGINE_LAYERS = ['idle', 'low', 'mid', 'high'] as const;
export type EngineLayer = (typeof ENGINE_LAYERS)[number];

/** Motor-Loops: pro Klasse 4 Drehzahl-Layer x Last/Schiebebetrieb. Dateien: files[].rpm angeben! */
const engineDefs: SoundDef[] = ENGINE_SETS.flatMap((set) =>
  ENGINE_LAYERS.flatMap((layer) => (['on', 'off'] as const).map((load): SoundDef => ({
    id: `veh.engine.${set}.${layer}.${load}`, bus: 'vehicles', kind: 'loop', files: [],
    proc: `eng:${set}:${layer}:${load}`, spatial: SPATIAL.vehicle, priority: 0.9, loopXfade: 0.08,
  }))));

// ------------------------------------------------------------------ Einträge
export const SOUNDS: SoundDef[] = [
  // ---------------- Fahrzeuge: Motor & Antrieb
  ...engineDefs,
  { id: 'veh.prop.airboat', bus: 'vehicles', kind: 'loop', files: [], proc: 'prop:airboat', spatial: SPATIAL.vehicle, priority: 0.9 },
  { id: 'veh.water.rush', bus: 'vehicles', kind: 'loop', files: [], proc: 'water:rush', spatial: SPATIAL.vehicle, priority: 0.6 },
  { id: 'veh.water.slap', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'water:slap', spatial: SPATIAL.impact, pitch: [0.85, 1.15], volJitter: 3, maxInst: 3, sprite: 'vehicle' },
  { id: 'veh.shift', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'shift', pitch: [0.9, 1.1], volJitter: 2, maxInst: 2, sprite: 'vehicle' },
  { id: 'veh.backfire', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'pop', spatial: SPATIAL.vehicle, pitch: [0.85, 1.2], volJitter: 3, maxInst: 4, sprite: 'vehicle' },
  { id: 'veh.turbo.bov', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'bov', spatial: SPATIAL.vehicle, pitch: [0.92, 1.08], maxInst: 2, sprite: 'vehicle' },
  { id: 'veh.airbrake', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'airbrake', spatial: SPATIAL.vehicle, pitch: [0.95, 1.05], maxInst: 2, sprite: 'vehicle' },
  { id: 'veh.nitro', bus: 'vehicles', kind: 'loop', files: [], proc: 'nitro', priority: 0.7 },
  // ---------------- Reifen & Untergrund
  { id: 'veh.tire.squeal', bus: 'vehicles', kind: 'loop', files: [{ asset: 'kenney/starter-kit-racing/audio/skid.ogg', license: 'kenney-cc0' }], proc: 'squeal', spatial: SPATIAL.vehicle, priority: 0.8 },
  { id: 'veh.roll.asphalt', bus: 'vehicles', kind: 'loop', files: [], proc: 'roll:asphalt', priority: 0.6 },
  { id: 'veh.roll.gravel', bus: 'vehicles', kind: 'loop', files: [], proc: 'roll:gravel', priority: 0.6 },
  { id: 'veh.roll.sand', bus: 'vehicles', kind: 'loop', files: [], proc: 'roll:sand', priority: 0.6 },
  { id: 'veh.roll.grass', bus: 'vehicles', kind: 'loop', files: [], proc: 'roll:grass', priority: 0.6 },
  { id: 'veh.roll.wet', bus: 'vehicles', kind: 'loop', files: [], proc: 'roll:wet', priority: 0.6 },
  { id: 'veh.tire.burst', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'burst', spatial: SPATIAL.impact, pitch: [0.9, 1.1], maxInst: 2, sprite: 'vehicle' },
  // ---------------- Federung / Karosserie
  { id: 'veh.curb', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'curb', pitch: [0.85, 1.15], volJitter: 3, maxInst: 3, sprite: 'vehicle' },
  { id: 'veh.land', bus: 'vehicles', kind: 'oneshot', files: [...kenney('impactSoft_heavy', 3)], proc: 'land', spatial: SPATIAL.impact, pitch: [0.7, 0.85], maxInst: 2 },
  { id: 'veh.rattle', bus: 'vehicles', kind: 'oneshot', files: [...kenney('impactPlate_heavy', 3)], proc: 'rattle', pitch: [1.3, 1.8], volJitter: 4, maxInst: 3 },
  // ---------------- Kollisionen (geschichtet: Aufprall + Blech + Glas + Trümmer)
  { id: 'veh.crash.thud', bus: 'vehicles', kind: 'oneshot', files: [ka('kenney/starter-kit-racing/audio/impact.ogg')], proc: 'hit:thud', spatial: SPATIAL.impact, pitch: [0.8, 1.1], maxInst: 4, priority: 0.8 },
  { id: 'veh.crash.metal', bus: 'vehicles', kind: 'oneshot', files: kenney('impactMetal_heavy', 5), proc: 'hit:metal', spatial: SPATIAL.impact, pitch: [0.85, 1.1], maxInst: 4, priority: 0.8 },
  { id: 'veh.crash.metalLight', bus: 'vehicles', kind: 'oneshot', files: kenney('impactMetal_light', 3), proc: 'hit:metal', spatial: SPATIAL.impact, pitch: [0.9, 1.15], maxInst: 4, priority: 0.6 },
  { id: 'veh.crash.crunch', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'hit:crunch', spatial: SPATIAL.impact, pitch: [0.85, 1.1], maxInst: 3, priority: 0.8, sprite: 'vehicle' },
  { id: 'veh.crash.glass', bus: 'vehicles', kind: 'oneshot', files: kenney('impactGlass_heavy', 3), proc: 'hit:glass', spatial: SPATIAL.impact, pitch: [0.9, 1.1], maxInst: 3, priority: 0.7 },
  { id: 'veh.crash.debris', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'hit:debris', spatial: SPATIAL.impact, pitch: [0.85, 1.2], maxInst: 3, priority: 0.5, sprite: 'vehicle' },
  { id: 'veh.crash.plastic', bus: 'vehicles', kind: 'oneshot', files: [...kenney('impactPlate_heavy', 3), ...kenney('impactSoft_heavy', 3)], proc: 'hit:thud', spatial: SPATIAL.impact, pitch: [0.9, 1.15], maxInst: 4, priority: 0.5 },
  { id: 'veh.scrape', bus: 'vehicles', kind: 'loop', files: [], proc: 'scrape', spatial: SPATIAL.impact, priority: 0.7 },
  { id: 'veh.sparks', bus: 'vehicles', kind: 'loop', files: [], proc: 'sparks', spatial: SPATIAL.impact, priority: 0.5 },
  // ---------------- Schaden
  { id: 'veh.dmg.hiss', bus: 'vehicles', kind: 'loop', files: [], proc: 'hiss', spatial: SPATIAL.point, priority: 0.5 },
  { id: 'veh.dmg.fire', bus: 'vehicles', kind: 'loop', files: [], proc: 'fire', spatial: SPATIAL.point, priority: 0.7 },
  { id: 'veh.dmg.sputter', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'sputter', spatial: SPATIAL.vehicle, pitch: [0.8, 1.2], volJitter: 3, maxInst: 3, sprite: 'vehicle' },
  { id: 'veh.explosion', bus: 'sfx', kind: 'oneshot', files: [], proc: 'boom', spatial: { ...SPATIAL.weapon, ref: 16 }, pitch: [0.85, 1.05], maxInst: 3, priority: 1 },
  { id: 'veh.explosion.debris', bus: 'sfx', kind: 'oneshot', files: [], proc: 'hit:debris', spatial: SPATIAL.impact, pitch: [0.7, 1], maxInst: 3, priority: 0.6 },
  { id: 'veh.splash', bus: 'vehicles', kind: 'oneshot', files: [], proc: 'water:splash', spatial: SPATIAL.impact, pitch: [0.85, 1.1], maxInst: 2, sprite: 'vehicle' },

  // ---------------- Figuren (vorerst Kenney-Schritte, Phase 2 erweitert)
  { id: 'foot.concrete', bus: 'sfx', kind: 'oneshot', files: kenney('footstep_concrete', 5), pitch: [0.9, 1.1], volJitter: 2, spatial: SPATIAL.step, maxInst: 6, priority: 0.3 },
  { id: 'foot.grass', bus: 'sfx', kind: 'oneshot', files: kenney('footstep_grass', 5), pitch: [0.9, 1.1], volJitter: 2, spatial: SPATIAL.step, maxInst: 6, priority: 0.3 },
  { id: 'foot.wood', bus: 'sfx', kind: 'oneshot', files: kenney('footstep_wood', 3), pitch: [0.9, 1.1], volJitter: 2, spatial: SPATIAL.step, maxInst: 6, priority: 0.3 },
  // ---------------- Kampf (Phase 3 baut die Schichten aus)
  { id: 'hit.punch', bus: 'weapons', kind: 'oneshot', files: [...kenney('impactPunch_heavy', 5), ...kenney('impactPunch_medium', 3)], pitch: [0.88, 1.12], volJitter: 2, spatial: SPATIAL.impact, maxInst: 4 },

  // ---------------- Ambience (Platzhalter bis Phase 2)
  { id: 'amb.bed.city', bus: 'ambience', kind: 'loop', files: [ka('kenney/starter-kit-city-builder/sounds/ambience.ogg')], stereo: true },

  // ---------------- UI (Kenney Interface Sounds)
  { id: 'ui.open', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}open_001.ogg`)] },
  { id: 'ui.close', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}close_001.ogg`)] },
  { id: 'ui.click', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}click_001.ogg`), ka(`${K_UI}click_002.ogg`)], pitch: [0.97, 1.03] },
  { id: 'ui.good', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}confirmation_001.ogg`), ka(`${K_UI}confirmation_002.ogg`)] },
  { id: 'ui.bad', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}error_004.ogg`)] },
  { id: 'ui.info', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}select_001.ogg`)] },
  { id: 'ui.money', bus: 'ui', kind: 'oneshot', files: [ka(`${K_UI}maximize_006.ogg`), ka(`${K_UI}pluck_001.ogg`)], pitch: [0.97, 1.05] },
  { id: 'ui.toggle', bus: 'ui', kind: 'oneshot', files: [ka('kenney/starter-kit-city-builder/sounds/toggle.ogg')] },
  { id: 'ui.notice', bus: 'ui', kind: 'oneshot', files: [ka('kenney/starter-kit-city-builder/sounds/placement-a.ogg')] },
];

export const SOUND_INDEX = new Map(SOUNDS.map((s) => [s.id, s]));
export const dbToGain = (db: number) => Math.pow(10, db / 20);
