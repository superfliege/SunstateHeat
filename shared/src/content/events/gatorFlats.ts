// Straßenereignisse Gator Flats (E35–E38).
import { act, animal, gang, npc, phase, prop, say, sfx, shout, symbol, think, veh, type StreetEventDef } from './schema';

export const GATOR_FLATS_EVENTS: StreetEventDef[] = [
  {
    id: 'E35', key: 'cooler_theft', title: 'Kühlbox-Diebstahl', district: 'gator_flats', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 9, cooldown: 120, needs: ['swamp_water'],
    roles: [animal('gator', 'gator', 'Alligator'), prop('cooler', 'cooler', 'Picknick-Kühlbox'), npc('dad', 'local', 'Vater'), npc('mom', 'local', 'Mutter'), npc('kid', 'tourist', 'Kind')],
    phases: [
      phase('snatch', [6, 8], { actions: [act('gator', undefined, 'goto', 'cooler'), act('dad', 'Flinch')], lines: [sfx('gator', "SCHNAPP!"), shout('kid', "Der Alligator hat das PICKNICK!", 3)] }),
      phase('debate', [18, 24], {
        actions: [act('gator', undefined, 'drift'), act('dad', 'Point'), act('mom', 'Scold')],
        lines: [shout('mom', "Da waren die guten Sandwiches drin!", 1), say('dad', "Dann geh DU sie holen!", 5), symbol('gator', "🥪 ♥", 9), say('kid', "Er sieht glücklich aus.", 13)],
      }),
    ],
    interventions: [{ id: 'honk', label: 'Mit dem Airboat hupen', detect: { kind: 'honk', radius: 15, vehicle: 'airboat' }, phases: ['debate'], outcome: 'dropped' }],
    outcomes: {
      dropped: { label: 'Kühlbox treibt – Sandwiches und Geld', money: 50, health: 25, items: ['Sumpf-Sandwiches'], lines: [say('mom', "Unser Held! Nimm ein Sandwich. Das mit den Zahnabdrücken ist meins.")] },
      ignored: { label: 'Der Alligator picknickt' },
    },
    rumor: { text: 'In Gator Flats hat ein Alligator eine Kühlbox geklaut. Er soll Thunfisch bevorzugen.', spread: 'zone', heat: 0.25 },
  },
  {
    id: 'E36', key: 'airboat_wedding', title: 'Airboat-Hochzeit', district: 'gator_flats', size: 'big',
    when: { parts: ['afternoon'] },
    weight: 6, cooldown: 300, needs: ['swamp_water', 'pier'],
    roles: [
      veh('boats', 'airboat', 'Zwei zusammengebundene Airboats', [2, 2]), npc('bride', 'local', 'Braut'), npc('groom', 'local', 'Bräutigam'),
      npc('pastor', 'fisher', 'Pfarrer im Watanzug'), npc('guests', 'local', 'Hochzeitsgäste', [3, 5]), prop('ring', 'ring', 'Trauring'), animal('gator', 'gator', 'Alligator in der Nähe'),
    ],
    phases: [
      phase('vows', [12, 16], { actions: [act('guests', 'Watch')], lines: [say('pastor', "Liebe Gemeinde, liebe Mücken…"), say('groom', "Willst du…", 8)] }),
      phase('drop', [6, 8], { physics: [{ kind: 'splash', role: 'ring' }], lines: [sfx('ring', "pling"), shout('bride', "…NEIN!", 2)] }),
      phase('stare', [16, 22], {
        actions: [act('guests', 'Look', undefined, 'gator')],
        lines: [say('pastor', "Wer holt den Ring, möge jetzt sprechen.", 1), think('gator', "…", 6), say('groom', "Ich hab nein gesagt zum RING, nicht zu dir, Schatz!", 11)],
      }),
    ],
    interventions: [{ id: 'dive', label: 'Vom Steg nach dem Ring tauchen (Mini-Spiel)', detect: { kind: 'interact', target: 'ring', hold: 3, minigame: 'dive' }, phases: ['stare'], outcome: 'honored' }],
    outcomes: {
      honored: { label: 'Ehrengast', health: 'full', xp: 60, rep: [{ gang: 'mangrove', delta: 5 }], items: ['Stück Hochzeitstorte'],
        lines: [shout('guests', "EHRENGAST! EHRENGAST!"), say('pastor', "Kraft meines Watanzugs erkläre ich euch zu Mann und Frau!")] },
      ignored: { label: 'Hochzeit mit Ersatzring aus Angelschnur' },
    },
    rumor: { text: 'Bei einer Airboat-Hochzeit in Gator Flats fiel der Ring ins Wasser – {player} ist danach getaucht.', spread: 'zone', heat: 0.45 },
  },
  {
    id: 'E37', key: 'swamp_monster_hunter', title: 'Sumpfmonster-Jäger', district: 'gator_flats', size: 'small',
    when: { parts: ['night'], weather: ['fog'] },
    weight: 7, cooldown: 180, needs: ['swamp_water'],
    roles: [npc('hunter', 'homeless', 'Verschwörungsfan mit Alufolienhut'), prop('flashlight', 'flashlight', 'Taschenlampe'), prop('camera', 'camera', 'Kamera'), prop('hat', 'tin_foil_hat', 'Alufolienhut')],
    phases: [
      phase('search', [24, 32], {
        actions: [act('hunter', 'Film', 'wander')],
        lines: [shout('hunter', "Ich weiß, dass du da bist, Gator-Man!", 1), say('hunter', "Die Regierung leugnet alles!", 8), think('hunter', "Wenn ich ihn filme, glaubt mir endlich jemand.", 16)],
      }),
      phase('leave', [4, 5], { lines: [say('hunter', "Morgen. Morgen krieg ich dich.")] }),
    ],
    interventions: [{ id: 'scare', label: 'Im Nebel hupen', detect: { kind: 'honk', radius: 25, inFog: true }, phases: ['search'], outcome: 'scared' }],
    outcomes: {
      scared: { label: 'Er rennt schreiend weg – Gerücht in der ganzen Stadt', xp: 20, traces: [{ kind: 'tourists_with_cameras', minutes: 48 }],
        lines: [shout('hunter', "ER IST ECHT! ER HAT GEBRÜLLT! WIE EINE HUPE!")], rumor: 'Sumpfmonster in Gator Flats gesichtet!',
        radio: 'Mystery-Ecke: Augenzeuge meldet Sumpfmonster „Gator-Man“ in Gator Flats. Es soll wie eine Autohupe klingen.' },
      ignored: { label: 'Kein Monster heute' },
    },
    rumor: { text: 'Der Typ mit dem Alufolienhut sucht wieder das Sumpfmonster.', spread: 'district', heat: 0.15 },
  },
  {
    id: 'E38', key: 'kings_bbq', title: 'Grillabend der Mangrove Kings', district: 'gator_flats', size: 'big',
    when: { parts: ['evening'] },
    weight: 7, cooldown: 240, needs: ['stilt_hut', 'Grill'],
    roles: [npc('jeb', 'gang', 'Old Jeb (Grillmeister)'), npc('kings', 'gang', 'Mangrove Kings', [3, 5]), prop('grill', 'grill', 'Grill'), prop('sausages', 'sausage', 'Würstchen', [6, 10]), prop('speaker', 'speaker', 'Banjo-Musik')],
    phases: [
      phase('grill', [30, 45], {
        actions: [act('jeb', 'Talk'), act('kings', 'Eat', 'gather', 'grill')],
        lines: [gang('jeb', "…und dann hab ich ihm in die Augen geschaut, und ER hat geblinzelt.", 2), gang('kings', "Letzte Woche war's noch ein kleiner.", 9), gang('jeb', "Er ist gewachsen! Vor Angst!", 15), gang('kings', "Für Mama!", 22)],
      }),
    ],
    interventions: [
      { id: 'invited', label: 'Mit Ruf ≥ +20: Einladung', detect: { kind: 'approach', radius: 8, target: 'grill', onFoot: true }, gate: { rep: { gang: 'mangrove', min: 20 } }, outcome: 'feast' },
      { id: 'hostile', label: 'Mit Ruf ≤ −10: Würstchen-Beschuss', detect: { kind: 'approach', radius: 15, target: 'jeb' }, gate: { rep: { gang: 'mangrove', max: -10 } }, outcome: 'pelted' },
    ],
    outcomes: {
      feast: { label: 'Volle Gesundheit und Quest-Tipp', health: 'full', xp: 30, followUp: 'Tipp: Mama Gator sucht jemanden für eine Kanal-Lieferung',
        lines: [gang('jeb', "Setz dich, Kaulquappe! Nimm zwei. Und hör zu, Mama hat da was für dich…")] },
      pelted: { label: 'Würstchen fliegen, Gang wird feindlich', damage: 2, hostile: true, lines: [gang('kings', "STÄDTER! WÜRSTCHEN, FEUER!")] },
      ignored: { label: 'Grillabend bis spät' },
    },
    rumor: { text: 'Bei den Mangrove Kings wird gegrillt. Old Jebs Alligator ist inzwischen sieben Meter lang.', spread: 'district', heat: 0.2 },
  },
];
