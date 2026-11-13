// Quests im Norden (Höfe, Okee Peak) – gleiches Datenformat wie questData.ts. Orte: questLocations.ts
// (okeeSummit, hayField, hayBarn, doubleR, cattlePasture, newPaddock, quarry, okeefield, downhill1–8),
// Telefone: okee_summit (Gipfelcafé), okee_farm (Double R Ranch), okee_truckstop (Dustline).
import type { QuestDefinition } from './quests';
import { variantByName } from './sim/handling';

const V = (name: string) => variantByName(name);

export const NORTH_QUESTS: QuestDefinition[] = [
  {
    id: 'farm_01_hay_rush', title: 'Heuernte im Akkord',
    giver: { type: 'payphone', id: 'okee_farm' }, minLevel: 1, coop: { min: 1, max: 2 }, repeatable: true, cooldownMinutes: 8,
    intro: [
      { who: 'Walt Henderson', text: 'Regen ist angesagt, und mein Heu liegt noch draußen! Nimm den Heuwagen und sammel die Ballen ein.' },
      { who: 'Walt Henderson', text: 'Zu zweit geht’s schneller: einer fährt, einer lädt. Meine Kühe zählen auf euch. Ehrlich, die zählen mit.' },
    ],
    stages: [
      { id: 'tractor', description: 'Steig in den Heuwagen (Traktor mit Anhänger) auf der Henderson Dairy.', onStart: [{ do: 'spawnVehicle', tag: 'hauler', kind: 'car', variant: V('Heuwagen'), at: 'hayBarn' }], objectives: [{ type: 'enterVehicle', tag: 'hauler' }] },
      {
        id: 'bales', description: 'Sammle alle 8 Heuballen auf der Wiese ein (drüberfahren oder zu Fuß aufladen) – 4:00 Minuten.', timeLimitSeconds: 240,
        onStart: [{ do: 'spawnPickups', tag: 'bales', at: 'hayField', count: 8, radius: 20 }],
        objectives: [{ type: 'collect', tag: 'bales' }],
      },
      { id: 'barn', description: 'Bring den Heuwagen zur Scheune.', timeLimitSeconds: 120, objectives: [{ type: 'deliverVehicle', tag: 'hauler', at: 'hayBarn', radius: 12 }] },
    ],
    rewards: { money: 450, xp: 110 },
  },
  {
    id: 'peak_01_summit_courier', title: 'Gipfelkurier',
    giver: { type: 'payphone', id: 'okee_truckstop' }, minLevel: 2, coop: { min: 1, max: 1 }, repeatable: true, cooldownMinutes: 10,
    intro: [
      { who: 'Summit Sal', text: 'Hier oben ist der Kuchen alle, und die Wanderer werden unruhig. Ich hab drei Torten im Truckstop bestellt.' },
      { who: 'Summit Sal', text: 'Fahr sie die Switchback Road hoch. Und zwar so, dass die Sahne oben bleibt. Jede Delle sieht man der Torte an.' },
    ],
    stages: [
      { id: 'van', description: 'Nimm den Lieferwagen am Dustline-Truckstop.', onStart: [{ do: 'spawnVehicle', tag: 'cake', kind: 'car', variant: V('Parcel Runner'), at: 'okeeValley', pose: 'road' }], objectives: [{ type: 'enterVehicle', tag: 'cake' }] },
      {
        id: 'climb', description: 'Liefere die Torten zum Gipfelcafé – Ware darf nicht beschädigt werden (mind. 85 % Zustand), 5:00 Minuten.', timeLimitSeconds: 300,
        objectives: [{ type: 'deliverVehicle', tag: 'cake', at: 'okeeCafe', radius: 14, minHealth: 0.85 }],
      },
    ],
    rewards: { money: 700, xp: 160 },
  },
  {
    id: 'farm_02_cattle_drive', title: 'Rinder-Treiben',
    giver: { type: 'payphone', id: 'okee_farm' }, minLevel: 2, coop: { min: 2, max: 4 }, repeatable: true, cooldownMinutes: 12,
    intro: [
      { who: 'Doris Whitlock', text: 'Die Weide ist abgegrast. Die Herde muss rüber zur neuen Koppel bei Henderson. Quer über die Straße.' },
      { who: 'Doris Whitlock', text: 'Nehmt die Quads und den Pick-up. Nicht hetzen, drücken. Kühe sind wie Stadtleute: Wenn man sie hetzt, rennen sie in die falsche Richtung.' },
    ],
    stages: [
      {
        id: 'mount', description: 'Treffpunkt Double R Ranch – nehmt Quads oder den Pick-up.',
        onStart: [{ do: 'spawnVehicle', tag: 'quad', kind: 'car', variant: V('Mule ATV'), at: 'doubleR', perPlayer: true }],
        objectives: [{ type: 'groupAt', at: 'doubleR', radius: 18 }],
      },
      {
        id: 'drive', description: 'Treibt die Herde (12 Rinder) zur neuen Koppel – mit Fahrzeugen von hinten drücken. 6:00 Minuten.', timeLimitSeconds: 360,
        objectives: [{ type: 'herd', tag: 'cattle', from: 'cattlePasture', at: 'newPaddock', count: 12, radius: 16 }],
      },
    ],
    rewards: { money: 900, xp: 220 },
  },
  {
    id: 'dustline_02_wrong_tractor', title: 'Der falsche Traktor', gang: 'dustline',
    giver: { type: 'payphone', id: 'okee_truckstop' }, minLevel: 3, coop: { min: 1, max: 3 }, repeatable: true, cooldownMinutes: 10,
    intro: [
      { who: 'Dustline Haulers', text: 'Zehn-vier: Die Steinbruch-Jungs haben Big Rigs Oldtimer-Traktor „geborgt“. Rusty Ol’ Red. Sein Ein und Alles.' },
      { who: 'Dustline Haulers', text: 'Hol ihn zurück zum Truckstop. Die fahren Muldenkipper, also: nicht anhalten. Hammer runter.' },
    ],
    stages: [
      { id: 'quarry', description: 'Fahr zum Steinbruch an der Ostflanke des Okee Peak.', objectives: [{ type: 'goTo', at: 'quarry', radius: 30 }] },
      { id: 'steal', description: 'Schnapp dir den Oldtimer-Traktor.', onStart: [{ do: 'spawnVehicle', tag: 'red', kind: 'car', variant: V('Rusty Ol\' Red'), at: 'quarry' }], objectives: [{ type: 'enterVehicle', tag: 'red' }] },
      {
        id: 'escape', description: 'Bring „Rusty Ol’ Red“ zum Dustline-Truckstop – die Steinbrucharbeiter jagen dich mit Muldenkippern!',
        onStart: [
          { do: 'spawnVehicle', tag: 'dumper1', kind: 'car', variant: V('Muldenkipper'), at: 'quarry', chase: true },
          { do: 'spawnVehicle', tag: 'dumper2', kind: 'car', variant: V('Muldenkipper'), at: 'quarry', chase: true },
          { do: 'say', text: 'Steinbrucharbeiter: „HEY! Das ist UNSER geborgter Traktor!“' },
        ],
        objectives: [{ type: 'deliverVehicle', tag: 'red', at: 'okeeValley', radius: 18, minHealth: 0.25 }],
      },
    ],
    rewards: { money: 1300, xp: 260, reputation: { gang: 'dustline', gain: 10, rivalLoss: 4 } },
  },
  {
    id: 'peak_02_downhill_madness', title: 'Downhill-Wahnsinn',
    giver: { type: 'payphone', id: 'okee_summit' }, minLevel: 1, coop: { min: 1, max: 8 }, repeatable: true, cooldownMinutes: 5,
    intro: [
      { who: 'Rennleiter', text: 'Vom Gipfel bis nach Okeefield, jedes Fahrzeug erlaubt: Auto, Motorrad, Quad, Rasenmäher – Hauptsache, es rollt.' },
      { who: 'Rennleiter', text: 'Die Leitplanken sind nur Deko. Also, eigentlich nicht. Aber fahrt so, als wären sie es.' },
    ],
    stages: [
      { id: 'grid', description: 'Alle an den Start am Gipfelplateau (mit Fahrzeug).', objectives: [{ type: 'groupAt', at: 'okeeSummit', radius: 26 }] },
      {
        id: 'race', description: 'Downhill: Switchback Road hinunter, über den Parkway bis Okeefield (Cane Ridge).', timeLimitSeconds: 420,
        objectives: [{ type: 'race', points: ['downhill1', 'downhill2', 'downhill3', 'downhill4', 'downhill5', 'downhill6', 'downhill7', 'downhill8', 'switchbackFoot', 'okeefield'] }],
      },
    ],
    rewards: { money: 0, xp: 240, byPlace: [1200, 700, 400] },
  },
];
