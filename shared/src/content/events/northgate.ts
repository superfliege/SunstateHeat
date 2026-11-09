// Straßenereignisse Northgate (E27–E30).
import { act, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const NORTHGATE_EVENTS: StreetEventDef[] = [
  {
    id: 'E27', key: 'motel_drama', title: 'Motel-Drama', district: 'northgate', size: 'big',
    when: { parts: ['night'] },
    weight: 7, cooldown: 240, needs: ['motel'],
    roles: [npc('wife', 'local', 'Darlene (2. Stock)'), npc('husband', 'local', 'Wade (unten, Airboat-Träumer)'), npc('neighbor', 'retiree', 'Genervter Nachbar'), prop('suitcase', 'suitcase', 'Koffer'), prop('clothes', 'clothes', 'Fliegende Klamotten', [4, 8])],
    phases: [
      phase('throw', [18, 24], {
        actions: [act('wife', 'Scold'), act('husband', 'Scold'), act('neighbor', 'Look')],
        physics: [{ kind: 'scatter_props', prop: 'clothes', count: 8, radius: 6 }, { kind: 'knockback', role: 'suitcase' }],
        lines: [shout('wife', "DU UND DEINE AIRBOAT-TRÄUME!", 1), shout('husband', "Eines Tages werden wir reich mit Sumpftouren!", 6), shout('neighbor', "Ich versuche zu SCHLAFEN!", 11), sfx('suitcase', "WUMMS!", 14)],
      }),
      phase('alone', [10, 14], { actions: [act('husband', 'Sit')], lines: [think('husband', "Vielleicht… fahr ich einfach los."), say('husband', "Hat jemand ein Auto? Und ein Herz?", 6)] }),
    ],
    interventions: [
      { id: 'bus', label: 'Koffer zum Busbahnhof bringen (Wade folgt)', detect: { kind: 'deliver', what: 'suitcase', to: 'husband', byVehicle: true, dest: 'bus_station' }, phases: ['alone'], outcome: 'bus' },
      { id: 'swamp', label: 'Mit Wade nach Gator Flats fahren', detect: { kind: 'escort', target: 'husband', dest: 'district', destDistrict: 'gator_flats' }, phases: ['alone'], outcome: 'airboat_dream' },
    ],
    outcomes: {
      bus: { label: 'Wade fährt zu seiner Schwester', money: 150, xp: 20 },
      airboat_dream: { label: 'Wade eröffnet später einen Airboat-Verleih', xp: 50, worldFlag: 'wade_airboat_rental', traces: [{ kind: 'airboat_rental', minutes: 999999 }],
        lines: [say('husband', "Hier. Genau hier. „Wade’s Wild Rides“. Du kriegst die erste Fahrt gratis!")], radio: 'Wirtschaft: In Gator Flats eröffnet ein neuer Airboat-Verleih. Der Gründer sagt, er habe „einfach daran geglaubt“.' },
      ignored: { label: 'Wade schläft im Auto' },
    },
    rumor: { text: 'Im Starlite Inn sind wieder Koffer geflogen. Diesmal ging es um Airboats.', spread: 'district', heat: 0.25 },
  },
  {
    id: 'E28', key: 'lemonade_firefight', title: 'Limonaden-Löschzug', district: 'northgate', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 150, needs: ['workshop'],
    roles: [npc('mechanic', 'worker', 'Mechaniker'), npc('customer', 'local', 'Kunde'), veh('car', 'car', 'Brennender Motor'), prop('lemonade', 'lemonade', 'Löschmittel (Limo, Kaffee, Eiswürfel)', [3, 3])],
    phases: [
      phase('fire', [4, 5], { physics: [{ kind: 'fire', role: 'car', radius: 2 }], lines: [sfx('car', "FUMP!"), shout('customer', "Ist das RAUCH?!", 2)] }),
      phase('panic', [16, 22], {
        actions: [act('mechanic', 'Panic', 'circle', 'car'), act('customer', 'Scold')],
        lines: [shout('mechanic', "Das ist NORMAL bei diesem Modell!", 1), say('customer', "Ich hab's nur zum Ölwechsel gebracht!", 6), shout('mechanic', "Limonade! Kaffee! EISWÜRFEL!", 10), sfx('lemonade', "ZISCH… PLÄTSCHER…", 14)],
      }),
      phase('out', [4, 5], { physics: [{ kind: 'foam', role: 'car' }], lines: [say('mechanic', "Siehste. Alles unter Kontrolle. Das macht 300 Dollar.")] }),
    ],
    interventions: [
      { id: 'extinguisher', label: 'Mit Feuerlöscher löschen', detect: { kind: 'use_item', item: 'extinguisher', target: 'car' }, phases: ['fire', 'panic'], outcome: 'repaired' },
      { id: 'firetruck', label: 'Mit dem Feuerwehrauto löschen', detect: { kind: 'use_item', item: 'firetruck', target: 'car' }, phases: ['fire', 'panic'], outcome: 'repaired' },
    ],
    outcomes: {
      repaired: { label: 'Kostenlose Reparatur für das eigene Auto', items: ['Gutschein: Gratis-Reparatur Bolt Brothers'], xp: 30, lines: [say('mechanic', "Du hast meine Werkstatt gerettet. Dein Auto repariere ich gratis. Ehrlich!")] },
      ignored: { label: 'Mit Limonade gelöscht (klebt)', traces: [{ kind: 'foam_puddle', minutes: 6 }] },
    },
    rumor: { text: 'Bei Bolt Brothers wurde ein Motorbrand mit Limonade gelöscht. Das Auto riecht jetzt nach Zitrone.', spread: 'district', heat: 0.25 },
  },
  {
    id: 'E29', key: 'night_race_meet', title: 'Nachtrennen-Treffpunkt', district: 'northgate', size: 'big',
    when: { parts: ['night'], weekend: true },
    weight: 7, cooldown: 300, needs: ['parking'],
    roles: [
      veh('tuners', 'sports', 'Getunte Autos mit Neonunterboden', [3, 5]), npc('racers', 'partygoer', 'Tuner', [3, 5]), npc('starter', 'partygoer', 'Starterin mit Taschenlampe'),
      prop('flashlight', 'flashlight', 'Taschenlampe'), veh('cops', 'police_car', 'Polizei (30 %)', [1, 2]),
    ],
    phases: [
      phase('rev', [20, 30], {
        actions: [act('racers', 'Lean'), act('starter', 'Wave')],
        lines: [sfx('tuners', "WRUMM WRUMMM!", 1), shout('racers', "Du da! Bist du schnell oder nur hübsch?", 5), say('racers', "Mein Auto hat mehr PS als dein Wortschatz.", 11), say('starter', "Einsatz auf den Tisch, Helden.", 18)],
      }),
      phase('race', [40, 60], { actions: [act('starter', 'Wave')], lines: [shout('starter', "3… 2… 1… LOS!"), sfx('tuners', "QUIIIETSCH!", 1)] }),
      phase('scatter', [10, 12], { actions: [act('racers', 'Panic', 'flee')], lines: [shout('starter', "BULLEN! ALLE WEG!"), sfx('cops', "WIUWIUWIU", 1)] }),
    ],
    interventions: [{ id: 'race', label: 'Anmelden: Rennen mit Einsatz', detect: { kind: 'race', checkpoints: 8, stake: [200, 2000] }, phases: ['rev'], outcome: 'raced' }],
    outcomes: {
      raced: { label: 'Rennen gefahren (Einsatz doppelt bei Sieg)', xp: 70, fame: 3, lines: [shout('racers', "Okay… du bist schnell UND hübsch.")] },
      busted: { label: 'Polizei taucht auf – alle fliehen', wanted: 1, traces: [{ kind: 'police_tape', minutes: 8 }] },
      ignored: { label: 'Treffen löst sich auf' },
    },
    variants: [{ id: 'raid', chance: 0.3, label: 'Polizei taucht auf', note: 'Phase scatter wird aktiv; Teilnehmer erhalten Ausgang busted (Fahndung 1).' }],
    rumor: { text: 'Auf dem Baumarktparkplatz in Northgate gab es wieder ein Nachtrennen. {player} soll mitgefahren sein.', spread: 'zone', heat: 0.5 },
    radio: 'Die PCP warnt: Illegale Nachtrennen in Northgate. Wenn Sie teilnehmen, dann bitte wenigstens mit Licht.',
  },
  {
    id: 'E30', key: 'carwash_convertible', title: 'Waschanlagen-Katastrophe', district: 'northgate', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 120, needs: ['carwash'],
    roles: [veh('cabrio', 'convertible', 'Cabrio mit offenem Dach', undefined, 'driver'), npc('driver', 'businessman', 'Fahrer'), npc('staff', 'worker', 'Mitarbeiter')],
    phases: [
      phase('wash', [10, 12], { physics: [{ kind: 'foam', role: 'cabrio', radius: 3 }], lines: [sfx('cabrio', "SCHRUBB-SCHRUBB-BLUBB"), think('staff', "Nein… nein, nein, nein…", 4)] }),
      phase('exit', [8, 10], {
        actions: [act('driver', 'Wave'), act('staff', 'Point')],
        lines: [say('driver', "Ich hab Premium gebucht. Das ist Premium.", 1), say('staff', "Wir… haben ein Schild.", 5)],
      }),
    ],
    interventions: [],
    outcomes: { ignored: { label: 'Schaumspur auf der Straße', traces: [{ kind: 'foam_puddle', minutes: 5 }] } },
    rumor: { text: 'In Northgate ist einer mit offenem Cabrio durch die Waschanlage gefahren. Er sagt, er fühlt sich „frisch“.', spread: 'district', heat: 0.2 },
  },
];
