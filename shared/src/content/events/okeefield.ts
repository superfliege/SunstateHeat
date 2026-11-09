// Straßenereignisse Dry Pine Country / Okeefield (E39–E42).
import { act, animal, gang, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const OKEEFIELD_EVENTS: StreetEventDef[] = [
  {
    id: 'E39', key: 'cow_breakout', title: 'Kuh-Ausbruch', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 240, needs: ['highway', 'field'],
    roles: [
      animal('cows', 'cow', 'Kuhherde', [5, 8]), npc('rancher', 'farmer', 'Doris, Ranch (Stammgast)'), veh('mower', 'mower', 'Aufsitzrasenmäher', undefined, 'rancher'),
      veh('semi', 'semi', 'Wartender Sattelschlepper', undefined, 'trucker'), npc('trucker', 'worker', 'Trucker'),
    ],
    phases: [
      phase('block', [30, 45], {
        actions: [act('cows', undefined, 'wander'), act('rancher', 'Wave', 'chase', 'cows'), act('trucker', 'Scold')],
        physics: [{ kind: 'traffic_jam', radius: 60 }],
        lines: [shout('rancher', "Hü! Hott! Bitte!", 1), shout('trucker', "Ich hab Termine, Doris!", 7), say('cows', "Muh.", 12), say('rancher', "Sie hören nicht auf mich, seit ich den Traktor verkauft hab.", 18)],
      }),
      phase('wander_off', [6, 8], { actions: [act('cows', undefined, 'goto', 'rancher')], lines: [say('rancher', "Na also. Wenn man lange genug wartet…")] }),
    ],
    interventions: [{ id: 'herd', label: 'Kühe vorsichtig mit dem Auto zurücktreiben (Kühe weichen Hupen aus)', detect: { kind: 'honk', radius: 12 }, gate: { inVehicle: true }, phases: ['block'], outcome: 'herded' }],
    outcomes: {
      herded: { label: '„Freund der Ranch“', money: 300, xp: 50, regular: { id: 'ok_rancher', delta: 10 },
        lines: [say('rancher', "Du hast ein Händchen für Kühe. Und für Hupen. Du bist jetzt Freund der Ranch.")] },
      ignored: { label: 'Kühe ziehen langsam weiter' },
    },
    rumor: { text: 'Doris’ Kühe haben wieder den Highway blockiert. Die Trucker haben mitgemuht.', spread: 'zone', heat: 0.3 },
  },
  {
    id: 'E40', key: 'orange_avalanche', title: 'Orangen-Lawine', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 7, cooldown: 240, needs: ['slope', 'road'],
    roles: [veh('truck', 'truck', 'Plantagen-Lastwagen', undefined, 'driver'), npc('driver', 'farmer', 'Fahrer der Plantage'), npc('gatherers', 'local', 'Sammelnde Passanten', [3, 5]), prop('oranges', 'orange', 'Orangen', [200, 400]), prop('crates', 'orange_crate', 'Orangenkisten', [10, 10])],
    phases: [
      phase('spill', [6, 8], {
        physics: [{ kind: 'spawn_pickups', prop: 'orange', count: 120, radius: 30, grip: 0.2, life: 300 }, { kind: 'spawn_pickups', prop: 'orange_crate', count: 10, radius: 20, life: 300 }],
        lines: [sfx('truck', "RUMPEL – KULLERKULLERKULLER"), shout('driver', "Das ist kein Unfall, das ist Ernte!", 3)],
      }),
      phase('harvest', [30, 45], { actions: [act('gatherers', 'Search', 'gather', 'oranges')], lines: [shout('gatherers', "Vitamine für alle!", 2), say('driver', "Bitte nicht alle! Ein paar brauch ich noch!", 12)] }),
    ],
    interventions: [{ id: 'help', label: '10 Kisten einsammeln und zum Fahrer bringen', detect: { kind: 'collect', prop: 'orange_crate', count: 10, deliverTo: 'driver' }, outcome: 'helped' }],
    outcomes: {
      helped: { label: 'Fahrer zahlt, Dustline zollt Respekt', money: 200, xp: 40, rep: [{ gang: 'dustline', delta: 3 }], lines: [gang('driver', "Zehn-vier, Kumpel! Das erzähl ich Big Rig.")] },
      ignored: { label: 'Orangenschalen überall', traces: [{ kind: 'orange_peels', minutes: 12 }] },
    },
    rumor: { text: 'Am Hang bei Okeefield sind tausende Orangen die Straße runtergerollt. Die Leute haben drei Tage lang Saft gemacht.', spread: 'city', heat: 0.45 },
    radio: 'Verkehrsmeldung Dry Pine: Glätte durch Orangen. Bitte fahren Sie vorsichtig und bringen Sie Tüten mit.',
  },
  {
    id: 'E41', key: 'goat_for_mayor', title: 'Ziege für Bürgermeisterin', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'], weekend: true },
    weight: 5, cooldown: 600, needs: ['main_street'],
    roles: [animal('gertrude', 'goat', 'Kandidatin Gertrude'), npc('manager', 'businessman', 'Wahlkampfmanager'), npc('fans', 'local', 'Leute mit Buttons', [4, 6]), prop('flyers', 'flyer', 'Wahlflyer', [5, 5]), prop('signs', 'campaign_sign', 'Wahlplakate')],
    phases: [
      phase('rally', [30, 40], {
        actions: [act('manager', 'Talk'), act('fans', 'Watch', 'gather', 'gertrude')],
        lines: [shout('manager', "Gertrude frisst Bürokratie zum Frühstück!", 1), shout('manager', "Sie hat mehr Rückgrat als der letzte Bürgermeister!", 8), say('gertrude', "Mäh.", 13), shout('fans', "GER-TRU-DE! GER-TRU-DE!", 18), think('gertrude', "…Das Plakat schmeckt gut.", 25)],
      }),
    ],
    interventions: [{ id: 'flyers', label: 'Flyer verteilen (5 NPCs ansprechen)', detect: { kind: 'talk', count: 5, prop: 'flyer' }, outcome: 'elected' }],
    outcomes: {
      elected: { label: 'Gertrude gewinnt am nächsten Spieltag', xp: 50, worldFlag: 'gertrude_mayor', traces: [{ kind: 'campaign_posters', minutes: 999999 }],
        lines: [say('manager', "Mit dir haben wir eine Chance! Eine echte Chance!")],
        radio: 'Wahlergebnis aus Okeefield: Die neue Bürgermeisterin ist eine Ziege namens Gertrude. Ihre erste Amtshandlung: Sie hat die Tagesordnung gefressen.' },
      ignored: { label: 'Wahlkampf geht weiter' },
    },
    rumor: { text: 'In Okeefield kandidiert eine Ziege als Bürgermeisterin. Sie liegt in den Umfragen vorn.', spread: 'city', heat: 0.5 },
  },
  {
    id: 'E42', key: 'trucker_honk_concert', title: 'Hupkonzert der Trucker', district: 'okeefield', size: 'small',
    when: { parts: ['evening'] },
    weight: 8, cooldown: 120, needs: ['highway'],
    roles: [veh('convoy', 'semi', 'Dustline-Konvoi', [3, 4]), npc('truckers', 'gang', 'Dustline Haulers', [3, 4]), npc('locals', 'local', 'Winkende Anwohner', [2, 4])],
    phases: [
      phase('concert', [16, 22], {
        actions: [act('locals', 'Wave')],
        lines: [sfx('convoy', "♪ TUUT-TUUT-TÖÖÖÖT ♪", 1), gang('truckers', "Für die Freiheit der Landstraße!", 5), say('locals', "Jeden Dienstag…", 10), sfx('convoy', "♪ TÖÖT-TÖÖT ♪", 14)],
      }),
    ],
    interventions: [{ id: 'honk', label: 'Mithupen', detect: { kind: 'honk', radius: 25 }, gate: { inVehicle: true }, outcome: 'respect' }],
    outcomes: {
      respect: { label: 'Trucker antworten mit Lichthupe', rep: [{ gang: 'dustline', delta: 2 }], xp: 10, lines: [gang('truckers', "Zehn-vier! Der hat Rhythmus!")] },
      ignored: { label: 'Konvoi zieht weiter' },
    },
    rumor: { text: 'Die Dustline Haulers haben auf der Route 41 wieder ein Hupkonzert gegeben.', spread: 'district', heat: 0.15 },
  },
];
