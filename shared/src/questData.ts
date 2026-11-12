// Die acht Beispielquests (Spec 13.5) als Daten. Neue Quests: hier ergänzen – die Engine bleibt unverändert.
// Story-Missionen stehen in shared/story/missions.json; Briefings der Nebenjobs in shared/story/story.json.
import type { QuestDefinition } from './quests';
import { STORY_QUESTS, withStoryText } from './story';
import { NORTH_QUESTS } from './questsNorth';

const BASE_QUESTS: QuestDefinition[] = [
  {
    id: 'prolog_01_fresh_goods', title: 'Frische Ware',
    giver: { type: 'payphone', id: 'bus' }, minLevel: 1, coop: { min: 1, max: 4 }, repeatable: false,
    intro: [
      { who: 'Unbekannt', text: 'Du bist neu in Palmara? Gut. Ich brauche jemanden, der keine Fragen stellt.' },
      { who: 'Unbekannt', text: 'Vor dem Supermarkt steht ein Lieferwagen. Nimm ihn, fahr zum Hafen und dann zum Trailerpark. Schnell!' },
    ],
    stages: [
      { id: 'steal', description: 'Klau den Lieferwagen vor dem Supermarkt.', onStart: [{ do: 'spawnVehicle', tag: 'van', kind: 'car', variant: 7, at: 'supermarket' }], objectives: [{ type: 'enterVehicle', tag: 'van' }] },
      { id: 'harbor', description: 'Fahr den Wagen zum Hafen.', objectives: [{ type: 'goTo', at: 'harbor', radius: 14, vehicleTag: 'van' }] },
      { id: 'deliver', description: 'Bring den Wagen in 3:00 Minuten zum Trailerpark.', timeLimitSeconds: 180, objectives: [{ type: 'deliverVehicle', tag: 'van', at: 'trailerpark', radius: 16 }] },
    ],
    rewards: { money: 500, xp: 100 },
  },
  {
    id: 'neon_01_neon_night', title: 'Neonnacht', gang: 'neon',
    giver: { type: 'payphone', id: 'neon' }, minLevel: 2, coop: { min: 2, max: 4 }, repeatable: true, cooldownMinutes: 10, nightOnly: true,
    intro: [{ who: 'Neon Syndicate', text: 'Heute Nacht läuft was im Pink Static. Der Türsteher braucht Rückendeckung, und im Hinterhof liegt ein Geldkoffer.' }],
    stages: [
      { id: 'meet', description: 'Treffpunkt: Club „Pink Static“ – alle müssen da sein.', objectives: [{ type: 'groupAt', at: 'club', radius: 16 }] },
      {
        id: 'hold', description: 'Beschütze den Türsteher und hol den Geldkoffer aus dem Hinterhof.', timeLimitSeconds: 150,
        onStart: [
          { do: 'spawnNpc', tag: 'doorman', at: 'club', hp: 500 },
          { do: 'spawnEnemies', tag: 'attackers', gang: 'marlin', count: 4, at: 'club', radius: 38, target: 'doorman' },
          { do: 'spawnPickups', tag: 'case', at: 'clubBack', count: 1, radius: 4 },
        ],
        objectives: [{ type: 'protect', tag: 'doorman', seconds: 90 }, { type: 'collect', tag: 'case' }],
      },
      { id: 'deliver', description: 'Liefere den Koffer in Brickell Hills ab.', onStart: [{ do: 'setWanted', level: 2 }], objectives: [{ type: 'goTo', at: 'brickell', radius: 16 }] },
    ],
    rewards: { money: 1800, xp: 300, reputation: { gang: 'neon', gain: 12, rivalLoss: 6 } },
  },
  {
    id: 'marlin_01_bridge_day', title: 'Brückentag', gang: 'marlin',
    giver: { type: 'payphone', id: 'marlin' }, minLevel: 2, coop: { min: 1, max: 3 }, repeatable: true, cooldownMinutes: 10,
    intro: [{ who: 'Marlin Club', text: 'Im Hafen von Sunset Village liegt ein Schnellboot. Klau es und fahr den Parcours – die Küstenwache wird sauer.' }],
    stages: [
      { id: 'steal', description: 'Klau das Schnellboot in der Marina.', onStart: [{ do: 'spawnVehicle', tag: 'boat', kind: 'boat', at: 'marina', water: true }], objectives: [{ type: 'enterVehicle', tag: 'boat' }] },
      { id: 'race', description: 'Fahr durch alle Checkpoints (2:30 Min.).', timeLimitSeconds: 150, objectives: [{ type: 'race', points: 'marina', count: 4, vehicleTag: 'boat' }] },
      { id: 'escape', description: 'Häng die Küstenwache ab.', onStart: [{ do: 'setWanted', level: 2 }], objectives: [{ type: 'loseWanted' }] },
    ],
    rewards: { money: 1200, xp: 250, reputation: { gang: 'marlin', gain: 10, rivalLoss: 5 } },
  },
  {
    id: 'mangrove_01_swamp_whispers', title: 'Sumpfgeflüster', gang: 'mangrove',
    giver: { type: 'payphone', id: 'mangrove' }, minLevel: 3, coop: { min: 1, max: 4 }, repeatable: true, cooldownMinutes: 10,
    intro: [{ who: 'Mangrove Kings', text: 'Ein Dustline-Truck fährt Ersatzteile zu seinem Lager. Folge ihm unauffällig, dann holst du dir die Kisten.' }],
    stages: [
      { id: 'follow', description: 'Folge dem Truck unauffällig (nicht zu nah, nicht zu weit weg).', onStart: [{ do: 'tagTraffic', tag: 'truck', near: 'here' }], objectives: [{ type: 'follow', tag: 'truck', seconds: 40, minDist: 8, maxDist: 70 }] },
      { id: 'camp', description: 'Fahr zum Dustline-Lager.', objectives: [{ type: 'goTo', at: 'dustlineCamp', radius: 30 }] },
      {
        id: 'crates', description: 'Sammle die 5 Ersatzteilkisten – die Wachen greifen an!',
        onStart: [{ do: 'spawnPickups', tag: 'crates', at: 'dustlineCamp', count: 5, radius: 22 }, { do: 'spawnEnemies', tag: 'guards', gang: 'dustline', count: 3, at: 'dustlineCamp', radius: 30 }],
        objectives: [{ type: 'collect', tag: 'crates' }],
      },
      { id: 'house', description: 'Bring die Kisten zum Stelzenhaus der Mangrove Kings.', objectives: [{ type: 'goTo', at: 'stiltHouse', radius: 22 }] },
      { id: 'airboat', description: 'Nimm das Airboat am Steg und fahr die letzte Strecke über das Wasser.', onStart: [{ do: 'spawnVehicle', tag: 'airboat', kind: 'airboat', at: 'airboatStart', water: true }], objectives: [{ type: 'goTo', at: 'stiltFar', radius: 18, vehicleKind: 'airboat' }] },
    ],
    rewards: { money: 1400, xp: 280, reputation: { gang: 'mangrove', gain: 10, rivalLoss: 6 } },
  },
  {
    id: 'dustline_01_orange_express', title: 'Orangen-Express', gang: 'dustline',
    giver: { type: 'payphone', id: 'dustline' }, minLevel: 4, coop: { min: 2, max: 4 }, repeatable: true, cooldownMinutes: 10,
    intro: [{ who: 'Dustline Haulers', text: 'Ein Truck voller Orangen muss zum Hafen. Einer fährt, die anderen halten die Mangrove Kings auf Abstand.' }],
    stages: [
      { id: 'truck', description: 'Nimm den „Big Pine Rig“-Truck an der Plantage.', onStart: [{ do: 'spawnVehicle', tag: 'truck', kind: 'car', variant: 8, at: 'plantation' }], objectives: [{ type: 'enterVehicle', tag: 'truck' }] },
      {
        id: 'escort', description: 'Halte den Truck am Leben (mind. 40 % Zustand) – die Mangrove Kings greifen an.', timeLimitSeconds: 240,
        onStart: [{ do: 'spawnEnemies', tag: 'raiders', gang: 'mangrove', count: 5, at: 'plantation', radius: 45, target: 'truck' }],
        objectives: [{ type: 'protect', tag: 'truck', seconds: 60, minHealth: 0.4 }],
      },
      { id: 'harbor', description: 'Bring den Truck in den Hafen.', objectives: [{ type: 'deliverVehicle', tag: 'truck', at: 'harbor', radius: 26, minHealth: 0.4 }] },
    ],
    rewards: { money: 2000, xp: 350, reputation: { gang: 'dustline', gain: 12, rivalLoss: 6 } },
  },
  {
    id: 'marlin_02_beacon', title: 'Leuchtfeuer', gang: 'marlin',
    giver: { type: 'payphone', id: 'marlin' }, minLevel: 5, coop: { min: 2, max: 4 }, repeatable: true, cooldownMinutes: 10, nightOnly: true,
    intro: [{ who: 'Marlin Club', text: 'Heute Nacht kommt eine Lieferung. Das Leuchtfeuer muss brennen – und die Neon-Leute dürfen nicht stören.' }],
    stages: [
      { id: 'meet', description: 'Alle treffen sich nachts am Leuchtturm.', objectives: [{ type: 'groupAt', at: 'lighthouse', radius: 16 }] },
      {
        id: 'beacon', description: 'Einer bedient das Leuchtfeuer (F gedrückt halten, 60 s), die anderen wehren die Angreifer ab.', timeLimitSeconds: 200,
        onStart: [{ do: 'spawnEnemies', tag: 'raiders', gang: 'neon', count: 4, at: 'lighthouse', radius: 40 }],
        objectives: [{ type: 'interact', at: 'lighthouse', holdSeconds: 60 }, { type: 'defeat', tag: 'raiders' }],
      },
      { id: 'escort', description: 'Fahr das Schmugglerboot zur versteckten Bucht.', onStart: [{ do: 'spawnVehicle', tag: 'boat', kind: 'boat', at: 'marina', water: true, perPlayer: true }], objectives: [{ type: 'goTo', at: 'hiddenBay', radius: 20, vehicleKind: 'boat' }] },
    ],
    rewards: { money: 1900, xp: 320, reputation: { gang: 'marlin', gain: 12, rivalLoss: 6 } },
  },
  {
    id: 'indep_01_cool_down', title: 'Ruhig Blut',
    giver: { type: 'payphone', id: 'okeefield' }, minLevel: 1, coop: { min: 1, max: 1 }, repeatable: true, cooldownMinutes: 30,
    intro: [{ who: 'Anrufer', text: 'Sieht aus, als hättest du ein Händchen für Ärger. Beweis, dass du auch wieder aus dem Ärger rauskommst.' }],
    stages: [
      { id: 'survive', description: 'Überlebe 2:00 Minuten mit Fahndungsstufe 2.', onStart: [{ do: 'setWanted', level: 2 }], objectives: [{ type: 'survive', seconds: 120, keepWanted: 2 }] },
      { id: 'lose', description: 'Bring die Fahndung auf 0.', objectives: [{ type: 'loseWanted' }] },
    ],
    rewards: { money: 600, xp: 120 },
  },
  {
    id: 'indep_02_gator_grand_prix', title: 'Gator Grand Prix',
    giver: { type: 'payphone', id: 'gator' }, minLevel: 1, coop: { min: 1, max: 8 }, repeatable: true, cooldownMinutes: 5,
    intro: [{ who: 'Rennleiter', text: 'Airboat-Rennen durch Gator Flats: 12 Checkpoints. Wer zuerst ankommt, kassiert am meisten.' }],
    stages: [
      {
        id: 'race', description: 'Fahre durch alle 12 Checkpoints.', timeLimitSeconds: 420,
        onStart: [{ do: 'spawnVehicle', tag: 'airboat', kind: 'airboat', at: 'airboatStart', water: true, perPlayer: true }],
        objectives: [{ type: 'race', points: 'airboatStart', count: 12, vehicleTag: 'airboat' }],
      },
    ],
    rewards: { money: 0, xp: 250, byPlace: [1000, 600, 300] },
  },
];

/** Alle Quests: die Beispielquests (als Nebenjobs der Story-Figuren) und die Story-Missionen (shared/story). */
export const QUESTS: QuestDefinition[] = withStoryText([...BASE_QUESTS, ...NORTH_QUESTS, ...STORY_QUESTS]);

export const QUEST_BY_ID = new Map(QUESTS.map((q) => [q.id, q]));
