// Straßenereignisse Port District (E19–E22).
import { act, animal, gang, npc, phase, prop, say, sfx, shout, think, veh, whisper, type StreetEventDef } from './schema';

export const PORT_DISTRICT_EVENTS: StreetEventDef[] = [
  {
    id: 'E19', key: 'container_surprise', title: 'Container-Überraschung', district: 'port_district', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 7, cooldown: 240, needs: ['crane', 'container_yard', 'water_edge'],
    roles: [
      veh('crane', 'crane', 'Kran'), npc('operator', 'worker', 'Kranführer'), npc('worker', 'worker', 'Hafenarbeiter', [2, 3]),
      prop('container', 'container', 'Container'), prop('cargo', 'rubber_duck', 'Ladung', [40, 60]), npc('harbormaster', 'businessman', 'Hafenmeister'),
    ],
    phases: [
      phase('drop', [3, 4], { actions: [act('worker', 'Look')], lines: [sfx('container', "KRRRRAWUMM!")], physics: [{ kind: 'tip_over', role: 'container' }] }),
      phase('spill', [10, 14], {
        actions: [act('worker', 'Point'), act('operator', 'Wave')],
        physics: [{ kind: 'spawn_pickups', prop: 'rubber_duck', count: 40, radius: 18, life: 600 }, { kind: 'splash', role: 'cargo' }],
        lines: [shout('operator', "Das war der Wind!", 1), say('worker', "Steht auf den Papieren 'Ersatzteile'?", 5), say('worker', "Quietschende Ersatzteile…", 9)],
      }),
      phase('aftermath', [8, 10], { actions: [act('harbormaster', 'Scold')], lines: [shout('harbormaster', "Wer sammelt das ein? Ich zahle! Ein bisschen!")] }),
    ],
    interventions: [{ id: 'collect', label: '10 Teile einsammeln und zum Hafenmeister bringen', detect: { kind: 'collect', prop: 'rubber_duck', count: 10, deliverTo: 'harbormaster' }, outcome: 'collected' }],
    outcomes: {
      collected: { label: 'Hafenmeister zahlt', money: 100, xp: 25, lines: [say('harbormaster', "Zehn! Fehlen nur noch 490. Danke trotzdem.")] },
      ignored: { label: 'Ladung treibt im Hafenbecken', traces: [{ kind: 'floating_ducks', minutes: 10 }] },
    },
    variants: [
      { id: 'bowling', chance: 0.15, label: 'Bowlingkugeln', note: 'Ladung = bowling_ball, rollt bergab (grip 0.3, kleine Dellen).' },
      { id: 'plush', chance: 0.15, label: 'Kuscheltiere', note: 'Ladung = plush, treibt besonders lange.' },
      { id: 'pineapple', chance: 0.15, label: 'Ananas', note: 'Ladung = pineapple, Möwen interessieren sich.' },
    ],
    rumor: { text: 'Im Hafen ist ein Container mit 500 Gummienten aufgeplatzt. Die Enten sind jetzt Richtung Coral Keys unterwegs.', spread: 'city', heat: 0.55 },
    radio: 'Schifffahrtsmeldung: Gelbe Gummienten im Hafenbecken. Bitte nicht füttern, sie sind aus Plastik.',
  },
  {
    id: 'E20', key: 'smuggle_pineapples', title: 'Schmuggel-Pech', district: 'port_district', size: 'small',
    when: { parts: ['night'], gangInfluence: { min: 30 } },
    weight: 8, cooldown: 150, needs: ['container_yard'],
    roles: [npc('thugA', 'gang_turf', 'Gang-Mitglied A (Gang mit höchstem Einfluss)'), npc('thugB', 'gang_turf', 'Gang-Mitglied B'), prop('crate', 'crate', 'Kiste mit „der Ware“'), prop('pineapples', 'pineapple', 'Ananas', [6, 10])],
    phases: [
      phase('open', [6, 8], { actions: [act('thugA', 'Search'), act('thugB', 'Look')], lines: [whisper('thugB', "Leise… mach auf."), sfx('crate', "KNARZ", 4)] }),
      phase('reveal', [12, 16], {
        actions: [act('thugA', 'Look'), act('thugB', 'Scold')],
        lines: [say('thugA', "Das… sind Ananas.", 1), gang('thugB', "Der Boss hat gesagt ‚die goldene Ware‘!", 5), gang('thugA', "Ananas SIND golden, Idiot.", 9), think('thugB', "Wie erklär ich das dem Boss…", 12)],
      }),
    ],
    interventions: [
      { id: 'friendly', label: 'Mit positivem Ruf: eine Ananas nehmen', detect: { kind: 'approach', radius: 4, target: 'crate', onFoot: true }, gate: { rep: { gang: 'event_gang', min: 20 } }, outcome: 'gift' },
      { id: 'hostile', label: 'Mit negativem Ruf: Ananas fliegen', detect: { kind: 'approach', radius: 12, target: 'thugA' }, gate: { rep: { gang: 'event_gang', max: -10 } }, outcome: 'barrage' },
    ],
    outcomes: {
      gift: { label: 'Ananas zum Mitnehmen', health: 20, lines: [gang('thugA', "Nimm eine. Wir haben… viele.")] },
      barrage: { label: 'Ananas-Hagel', damage: 5, hostile: true, lines: [gang('thugB', "DER schon wieder! FEUER!")] },
      ignored: { label: 'Ratlosigkeit' },
    },
    rumor: { text: 'Im Hafen hat {gang} eine Lieferung „goldene Ware“ bekommen. Es waren Ananas.', spread: 'zone', heat: 0.45 },
  },
  {
    id: 'E21', key: 'forklift_race', title: 'Gabelstapler-Rennen', district: 'port_district', size: 'big',
    when: { parts: ['noon'] },
    weight: 7, cooldown: 240, needs: ['container_yard'],
    roles: [
      veh('forklifts', 'forklift', 'Rennstapler', [2, 3]), npc('racers', 'worker', 'Fahrer (u. a. Big Ray)', [2, 3]), npc('bettors', 'worker', 'Wettende Kollegen', [3, 5]),
      veh('spare', 'forklift', 'Freier Gabelstapler'), prop('sandwich', 'sandwich', 'Sandwiches (Wetteinsatz)', [5, 10]),
    ],
    phases: [
      phase('bets', [8, 10], { actions: [act('bettors', 'Wave', 'gather', 'racers')], lines: [shout('bettors', "Fünf Sandwiches auf Big Ray!"), say('racers', "Wer zuerst die Palette hat!", 4)] }),
      phase('race', [30, 45], { actions: [act('bettors', 'Watch')], lines: [shout('bettors', "SCHNELLER! Das sind 8 km/h!", 6), sfx('forklifts', "PIEP PIEP PIEP", 12), shout('bettors', "Ray, nicht rückwärts!", 20)] }),
      phase('finish', [5, 6], { lines: [shout('bettors', "BIG RAY!"), say('racers', "Zurück an die Arbeit, bevor der Vorarbeiter kommt.", 3)] }),
    ],
    interventions: [{ id: 'race', label: 'Freien Stapler nehmen und mitfahren', detect: { kind: 'race', vehicle: 'forklift', checkpoints: 6 }, phases: ['bets'], outcome: 'won' }],
    outcomes: {
      won: { label: 'Sieg', money: 250, xp: 60, rep: [{ gang: 'dustline', delta: 3 }], lines: [shout('bettors', "WER IST DAS?! Gebt ihm die Sandwiches!")] },
      ignored: { label: 'Big Ray gewinnt (wie immer)' },
    },
    rumor: { text: 'Beim Gabelstapler-Rennen im Hafen hat {player} Big Ray geschlagen. Die Sandwiches sind weg.', spread: 'zone', heat: 0.35 },
  },
  {
    id: 'E22', key: 'sailor_and_gull', title: 'Der Seemann und die Möwe', district: 'port_district', size: 'small',
    when: { parts: ['evening'] },
    weight: 8, cooldown: 150, needs: ['dock', 'crane'],
    roles: [npc('sailor', 'fisher', 'Alter Seemann'), animal('gerald', 'seagull', 'Gerald, die Möwe'), prop('hat', 'hat', 'Kapitänsmütze')],
    phases: [
      phase('argue', [10, 14], { actions: [act('sailor', 'Scold'), act('gerald', undefined, 'circle', 'sailor')], lines: [shout('sailor', "Nicht schon wieder, Gerald!"), say('sailor', "Ich seh dich! Ich seh deine kleinen Knopfaugen!", 6)] }),
      phase('theft', [8, 10], { actions: [act('gerald', undefined, 'flee'), act('sailor', 'Point')], lines: [sfx('gerald', "SCHNAPP!"), shout('sailor', "Diese Möwe hat mein Leben ruiniert!", 3)] }),
    ],
    interventions: [{ id: 'chase', label: 'Möwe zum Nest auf dem Kran verfolgen', detect: { kind: 'climb', target: 'crane', then: { kind: 'interact', target: 'hat', hold: 1 } }, phases: ['theft'], outcome: 'hat_back' }],
    outcomes: {
      hat_back: { label: 'Hut zurück, Seemann erzählt eine Geschichte', xp: 30, followUp: 'Hinweis auf Sammelobjekt (Flaschenpost am Leuchtfeuer)',
        lines: [say('sailor', "Du hast… meine Mütze! Setz dich, ich erzähl dir was."), say('sailor', "Damals, im Sturm von '71, hab ich am Leuchtfeuer eine Flaschenpost versteckt…")] },
      ignored: { label: 'Gerald behält den Hut (sein 14.)' },
    },
    rumor: { text: 'Gerald die Möwe hat schon wieder einem Seemann den Hut geklaut. Man munkelt, er hat ein ganzes Nest voller Mützen.', spread: 'district', heat: 0.2 },
  },
];
