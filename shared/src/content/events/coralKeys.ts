// Straßenereignisse Coral Keys (E31–E34).
import { act, animal, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const CORAL_KEYS_EVENTS: StreetEventDef[] = [
  {
    id: 'E31', key: 'iguana_jam', title: 'Leguan-Stau', district: 'coral_keys', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'], weather: ['heat', 'sunny'], traffic: true },
    weight: 7, cooldown: 240, needs: ['bridge'],
    roles: [animal('iguana', 'iguana', 'Großer Leguan'), veh('jam', 'car', 'Stau', [4, 8]), npc('drivers', 'local', 'Diskutierende Fahrer', [2, 3]), npc('accountant', 'businessman', 'Steuerberater'), veh('bridgecop', 'police_car', 'Brückenpolizei')],
    phases: [
      phase('bask', [30, 45], {
        actions: [act('iguana', 'Lie'), act('drivers', 'Talk', 'gather', 'iguana')],
        physics: [{ kind: 'traffic_jam', radius: 80 }],
        lines: [say('drivers', "Der ist geschützt, oder?", 2), shout('accountant', "Ich bin Steuerberater, keine Tierschutzbehörde!", 8), say('iguana', "…", 14), say('drivers', "Er hat mich angeguckt. Ich geh da nicht hin.", 20)],
      }),
      phase('leave', [5, 6], { actions: [act('iguana', undefined, 'wander')], lines: [think('iguana', "…Zu kalt hier. Weiter."), sfx('jam', "TUUT TUUT!", 3)] }),
    ],
    interventions: [
      { id: 'carry', label: 'Leguan behutsam zur Seite tragen', detect: { kind: 'interact', target: 'iguana', hold: 2.5 }, phases: ['bask'], outcome: 'carried' },
      { id: 'wrong_lane', label: 'Auf der Gegenspur vorbeifahren', detect: { kind: 'drive_through', radius: 12, minSpeed: 6 }, gate: { inVehicle: true }, phases: ['bask'], outcome: 'busted' },
    ],
    outcomes: {
      carried: { label: 'Alle hupen dankbar', xp: 40, mood: { safety: 2 }, lines: [sfx('jam', "TUUT TUUT TUUUT!"), say('accountant', "Sie haben gerade 40 Leute gerettet. Und einen Leguan.")] },
      busted: { label: 'Fahndung durch Brückenpolizei', wanted: 1, lines: [shout('drivers', "Der fährt auf der GEGENSPUR!")] },
      ignored: { label: 'Leguan geht von allein' },
    },
    rumor: { text: 'Ein Leguan hat die Seven Spans Bridge eine halbe Stunde lang lahmgelegt.', spread: 'city', heat: 0.5 },
    radio: 'Verkehr: Seven Spans Bridge – Stau wegen Leguan. Der Leguan hat keinen Kommentar abgegeben.',
  },
  {
    id: 'E32', key: 'fish_wins', title: 'Der Fisch gewinnt', district: 'coral_keys', size: 'small',
    when: { parts: ['morning'] },
    weight: 8, cooldown: 150, needs: ['pier', 'FishSpot'],
    roles: [npc('angler', 'fisher', 'Angler'), prop('rod', 'fishing_rod', 'Angel'), animal('bernhard', 'fish', 'Bernhard, der legendäre Fisch')],
    phases: [
      phase('bite', [6, 8], { actions: [act('angler', 'Fish')], lines: [shout('angler', "Das ist der Große! Der Legendäre!")] }),
      phase('struggle', [14, 18], { actions: [act('angler', 'Fish', 'drift', 'bernhard')], lines: [say('angler', "Er… zieht… mich…", 4), think('angler', "Nicht loslassen. Für die Ehre.", 10)] }),
      phase('splash', [5, 6], { actions: [act('angler', 'Flinch', 'fall')], physics: [{ kind: 'splash', role: 'angler' }], lines: [sfx('angler', "PLATSCH!"), shout('angler', "Ich komme wieder, Bernhard!", 3)] }),
    ],
    interventions: [{ id: 'pull', label: 'Mitziehen (E halten)', detect: { kind: 'interact', target: 'rod', hold: 4 }, phases: ['bite', 'struggle'], outcome: 'landed' }],
    outcomes: {
      landed: { label: 'Riesenfisch gefangen', money: 200, xp: 40, items: ['Foto mit Bernhard'], fame: 2,
        lines: [shout('angler', "BERNHARD! Nach zwanzig Jahren! …Jetzt lassen wir ihn wieder frei, oder? Er ist Familie.")],
        rumor: '{player} hat Bernhard gefangen, den legendären Fisch der Coral Keys!', radio: 'Sensation in den Coral Keys: Der legendäre Fisch Bernhard wurde gefangen – und wieder freigelassen. Er wirkte beleidigt.' },
      ignored: { label: 'Angler im Wasser' },
    },
    rumor: { text: 'Bernhard hat schon wieder einen Angler ins Wasser gezogen.', spread: 'zone', heat: 0.3 },
  },
  {
    id: 'E33', key: 'ghost_yacht', title: 'Geisteryacht', district: 'coral_keys', size: 'big',
    when: { parts: ['evening'] },
    weight: 6, cooldown: 300, needs: ['marina', 'pier'],
    roles: [veh('yacht', 'yacht', 'Marlin-Club-Yacht ohne Kapitän'), npc('guests', 'partygoer', 'Feiernde an Bord', [4, 6])],
    phases: [
      phase('drift', [30, 40], {
        actions: [act('guests', 'Dance'), act('yacht', undefined, 'drift')],
        lines: [say('guests', "Wer fährt eigentlich?", 4), say('guests', "Ich dachte DU!", 8), say('guests', "Ist das der Steg?", 16), shout('guests', "PROST!", 22)],
      }),
      phase('crash', [5, 6], { physics: [{ kind: 'knockback', role: 'yacht' }], lines: [sfx('yacht', "KRAAACH!"), say('guests', "…Wir sind angekommen!")] }),
    ],
    interventions: [{ id: 'board', label: 'Per Boot an Bord springen und das Steuer übernehmen', detect: { kind: 'board', target: 'yacht', byVehicle: 'boat' }, phases: ['drift'], outcome: 'steered' }],
    outcomes: {
      steered: { label: 'Yacht gerettet', money: 800, xp: 70, rep: [{ gang: 'marlin', delta: 8 }],
        lines: [say('guests', "Wer ist der neue Kapitän? Er ist fantastisch!")], rumor: '{player} hat eine führerlose Yacht des Marlin Club vor dem Steg gerettet. Der Commodore ist „äußerst angetan“.' },
      ignored: { label: 'Yacht kracht in den Steg', traces: [{ kind: 'damaged_pier', minutes: 48 }] },
    },
    rumor: { text: 'Eine Marlin-Club-Yacht ist ohne Kapitän in den Steg der Blue Hook gekracht. Die Party ging weiter.', spread: 'city', heat: 0.55 },
    radio: 'Hafenmeldung: Party-Yacht ohne Steuermann in der Marina Blue Hook. Die Gäste bemerkten den Aufprall nach eigenen Angaben „nicht wirklich“.',
  },
  {
    id: 'E34', key: 'treasure_tourist', title: 'Schatzkarten-Tourist', district: 'coral_keys', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 120, needs: ['garden', 'souvenir_shop'],
    roles: [npc('tourist', 'tourist', 'Tourist mit Schatzkarte'), prop('map', 'treasure_map', 'Schatzkarte aus dem Souvenirladen'), prop('shovel', 'shovel', 'Schaufel'), npc('resident', 'retiree', 'Empörter Anwohner')],
    phases: [
      phase('dig', [20, 28], {
        actions: [act('tourist', 'Search', 'wander'), act('resident', 'Scold')],
        lines: [shout('tourist', "X markiert die Stelle! Hier ist überall X!", 1), shout('resident', "Das ist mein Blumenbeet!", 7), say('tourist', "Dann ist der Schatz UNTER dem Blumenbeet!", 12)],
      }),
      phase('give_up', [4, 5], { lines: [say('tourist', "Okay. Neue Strategie: das Nachbarbeet.")] }),
    ],
    interventions: [{ id: 'buy', label: 'Karte für 50 $ „kaufen“', detect: { kind: 'pay', amount: 50, to: 'tourist' }, outcome: 'bought' }],
    outcomes: {
      bought: { label: 'Fast echte Karte – führt zu einem Sammelobjekt (Flamingo-Statue)', items: ['Schatzkarte (fast echt)'], followUp: 'Sammelobjekt: Flamingo-Statue', xp: 15,
        lines: [say('tourist', "Fünfzig?! Deal! Ich kauf mir eine neue, die ist bestimmt echter.")] },
      ignored: { label: 'Löcher in Vorgärten', traces: [{ kind: 'holes', minutes: 15 }] },
    },
    rumor: { text: 'Ein Tourist gräbt in den Keys alle Vorgärten um. Er sucht einen Schatz. Gefunden hat er einen Gartenzwerg.', spread: 'district', heat: 0.2 },
  },
];
