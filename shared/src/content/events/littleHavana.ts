// Straßenereignisse Little Havana Heights (E14–E18).
import { act, animal, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const LITTLE_HAVANA_EVENTS: StreetEventDef[] = [
  {
    id: 'E14', key: 'domino_escalation', title: 'Domino-Eskalation', district: 'little_havana', size: 'big',
    when: { parts: ['afternoon'] },
    weight: 9, cooldown: 150, needs: ['park', 'Bench'],
    roles: [
      npc('elder', 'retiree', 'Don Ernesto (Domino-Veteran)'), npc('rival', 'retiree', 'Mitspieler Tomás'),
      npc('bettors', 'local', 'Wettende Zuschauer', [3, 5]), prop('table', 'domino_table', 'Domino-Tisch'),
    ],
    phases: [
      phase('flip', [3, 4], { actions: [act('elder', 'Scold')], physics: [{ kind: 'tip_over', role: 'table' }, { kind: 'scatter_props', prop: 'domino_table', count: 28, radius: 2.5 }], lines: [sfx('table', "KRACH – KLACKERKLACKER")] }),
      phase('shouting', [22, 28], {
        actions: [act('elder', 'Scold'), act('rival', 'Scold'), act('bettors', 'Watch', 'gather', 'table')],
        lines: [shout('elder', "DU HAST DEN STEIN VERSTECKT!", 1), shout('rival', "Ich bin seit 40 Jahren ehrlich!", 6), say('bettors', "Fünf Dollar auf Ernesto!", 10), say('bettors', "Zehn auf Tomás, der hat den längeren Atem!", 14), shout('elder', "Der Doppel-Sechser war IN DEINEM ÄRMEL!", 19)],
      }),
      phase('coffee', [6, 8], { actions: [act('elder', 'Drink'), act('rival', 'Drink')], lines: [say('elder', "…Kaffee?"), say('rival', "Kaffee.", 2), say('bettors', "Jedes Mal. JEDES Mal.", 4)] }),
    ],
    interventions: [{ id: 'fix_table', label: 'Tisch wieder aufstellen', detect: { kind: 'interact', target: 'table', hold: 2 }, outcome: 'invited' }],
    outcomes: {
      invited: { label: 'Einladung zur nächsten Runde', xp: 20, regular: { id: 'lh_domino_elder', delta: 6 },
        lines: [say('elder', "Du! Du hast Manieren. Setz dich. Ich zeig dir, wie man verliert.")], followUp: 'Mini-Spiel Domino (optional)' },
      ignored: { label: 'Versöhnung bei Kaffee' },
    },
    rumor: { text: 'Im Domino-Park ist wieder ein Tisch geflogen. Ernesto schwört, Tomás hat geschummelt.', spread: 'district', heat: 0.2 },
  },
  {
    id: 'E15', key: 'rooster_escape', title: 'Hahn auf der Flucht', district: 'little_havana', size: 'small',
    when: { parts: ['morning'] },
    weight: 9, cooldown: 120, needs: ['road'],
    roles: [animal('fernando', 'rooster', 'Fernando, der Hahn'), npc('owner', 'retiree', 'Doña Pilar im Bademantel'), veh('cars', 'car', 'Bremsende Autos', [2, 3]), npc('driver', 'local', 'Autofahrer')],
    phases: [
      phase('chase', [20, 30], {
        actions: [act('fernando', undefined, 'flee'), act('owner', 'Scold', 'chase', 'fernando'), act('driver', 'Flinch')],
        lines: [shout('owner', "FERNANDO! KOMM SOFORT ZURÜCK!", 1), shout('fernando', "KIKERIKI!", 4), sfx('cars', "QUIIIETSCH!", 7), shout('driver', "Ist das ein Hahn?!", 9), shout('owner', "Er ist kein Hahn, er ist FAMILIE!", 16)],
        physics: [{ kind: 'bump_vehicles', roles: ['cars'] }],
      }),
      phase('escape', [3, 4], { lines: [say('owner', "Er kommt zum Abendessen wieder. Das tun sie immer.")] }),
    ],
    interventions: [{ id: 'catch', label: 'Hahn fangen (F halten, er weicht aus)', detect: { kind: 'catch', target: 'fernando', hold: 1.5, evasive: true }, phases: ['chase'], outcome: 'caught' }],
    outcomes: {
      caught: { label: 'Einladung zum Mittagessen', health: 'full', xp: 20, regular: { id: 'lh_pilar', delta: 8 },
        lines: [say('owner', "Mein Engel! Du kommst heute zum Essen. Keine Widerrede.")] },
      ignored: { label: 'Fernando entkommt (wieder)' },
    },
    rumor: { text: 'Fernando ist wieder ausgebrochen.', spread: 'district', heat: 0.2 },
  },
  {
    id: 'E16', key: 'street_party', title: 'Spontanes Straßenfest', district: 'little_havana', size: 'big',
    when: { parts: ['evening'], weekend: true, mood: { safety: { min: 45 } } },
    weight: 7, cooldown: 300, needs: ['road', 'Grill'],
    roles: [
      prop('speaker', 'speaker', 'Lautsprecher im Fenster'), npc('neighbors', 'local', 'Tanzende Nachbarn', [5, 8]),
      prop('grills', 'grill', 'Grills', [1, 2]), veh('cars', 'car', 'Stehender Verkehr', [2, 4]), npc('drivers', 'businessman', 'Autofahrer', [1, 2]), npc('grandma', 'retiree', 'Nachbarschafts-Oma'),
    ],
    phases: [
      phase('start', [6, 8], { actions: [act('neighbors', 'Dance', 'gather', 'speaker')], lines: [sfx('speaker', "♪ TRÖÖÖT ♪"), say('drivers', "Wer hat das Fest angemeldet?", 3), shout('grandma', "Das Fest hat SICH angemeldet!", 5)], physics: [{ kind: 'traffic_jam', radius: 30 }] }),
      phase('party', [40, 60], { actions: [act('neighbors', 'Dance'), act('grandma', 'Eat')], lines: [say('grandma', "Iss! Du bist zu dünn für ein Fest!", 6), think('drivers', "…Eigentlich hab ich keine Eile.", 18)] }),
      phase('join', [20, 30], { actions: [act('drivers', 'Dance', 'goto', 'neighbors')], lines: [shout('drivers', "Ach was soll's – MUSIK LAUTER!"), say('neighbors', "So muss das!", 5)] }),
    ],
    interventions: [
      { id: 'dance', label: 'Mittanzen (Emote)', detect: { kind: 'emote', radius: 10, emote: 'dance' }, outcome: 'danced' },
      { id: 'drive', label: 'Durchfahren', detect: { kind: 'drive_through', radius: 8, minSpeed: 4 }, outcome: 'booed' },
    ],
    outcomes: {
      danced: { label: 'XP und Essen gratis', xp: 40, health: 25, mood: { safety: 2 }, lines: [shout('grandma', "Endlich mal jemand mit Hüften!")] },
      booed: { label: 'Buhrufe', mood: { safety: -3 }, lines: [shout('neighbors', "BUUUH! Banause!")], rumor: '{player} ist mitten durchs Straßenfest in Little Havana gerast. Die Oma hat sich das Kennzeichen gemerkt.' },
      ignored: { label: 'Fest läuft bis spät' },
    },
    rumor: { text: 'Spontanes Straßenfest in Little Havana – sogar die Autofahrer haben mitgetanzt.', spread: 'zone', heat: 0.35 },
    radio: 'Verkehr: In Little Havana Heights steht der Verkehr – wegen guter Laune. Bitte Tanzschuhe mitnehmen.',
  },
  {
    id: 'E17', key: 'cafe_newspaper', title: 'Die Café-Zeitung', district: 'little_havana', size: 'small',
    when: { parts: ['morning'] },
    weight: 10, cooldown: 90, needs: ['cafe', 'CafeTable'],
    roles: [npc('marisol', 'vendor', 'Marisol, Café-Besitzerin (Stammgast)'), npc('guests', 'local', 'Café-Gäste', [2, 4])],
    phases: [
      phase('news', [20, 26], {
        actions: [act('marisol', 'Talk'), act('guests', 'Drink')],
        // {rumor1..3} werden zur Laufzeit aus den drei aktuellsten Gerüchten der Instanz befüllt.
        lines: [shout('marisol', "Hört zu, hört zu! {rumor1}! Ich sag's euch, das gibt Ärger!", 1), say('marisol', "Und: {rumor2}. Ich hab's gleich gewusst.", 8), say('marisol', "Und das Beste: {rumor3}!", 14)],
      }),
      phase('reply', [6, 8], { lines: [say('guests', "Woher weißt du das immer alles?"), say('marisol', "Ich hab Ohren, mein Schatz.", 3)] }),
    ],
    interventions: [{ id: 'listen', label: 'Zuhören bis zum Ende', detect: { kind: 'wait_out', radius: 8, stillFor: 15 }, outcome: 'listened' }],
    outcomes: {
      listened: { label: 'Marisol merkt sich den Spieler', regular: { id: 'lh_cafe_owner', delta: 2 }, lines: [say('marisol', "Du hörst gut zu. Komm morgen wieder, dann gibt's Kaffee aufs Haus.")] },
      ignored: { label: 'Nachrichten sind verkündet' },
    },
    rumor: { text: 'Marisol vom Café weiß schon wieder alles.', spread: 'district', heat: 0.05 },
  },
  {
    id: 'E18', key: 'parking_diplomacy', title: 'Parkplatz-Diplomatie', district: 'little_havana', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 120, needs: ['road', 'parking'],
    roles: [npc('neighborA', 'local', 'Nachbar Rigo'), npc('neighborB', 'local', 'Nachbarin Lupe'), prop('chairs', 'plastic_chair', 'Plastikstühle', [4, 10])],
    phases: [
      phase('claim', [8, 10], { actions: [act('neighborA', 'Scold'), act('neighborB', 'Scold')], lines: [shout('neighborA', "Der Stuhl war ZUERST da!"), shout('neighborB', "Mein Stuhl hat einen Stuhl mitgebracht!", 4)] }),
      phase('fortress', [16, 22], { actions: [act('neighborA', undefined, 'goto', 'chairs'), act('neighborB', undefined, 'goto', 'chairs')], lines: [say('neighborA', "Noch ein Stuhl. Und ein Sonnenschirm!", 3), say('neighborB', "Ich hab einen ganzen Schuppen voll, Rigo!", 9), think('neighborA', "Sie hat einen Schuppen… verdammt.", 14)] }),
      phase('stalemate', [4, 6], { actions: [act('neighborA', 'Sit'), act('neighborB', 'Sit')], lines: [say('neighborA', "…Kaffee?"), say('neighborB', "Nach dem Krieg.", 2)] }),
    ],
    interventions: [{ id: 'drive', label: 'Durch die Stuhl-Festung fahren', detect: { kind: 'drive_through', radius: 4, target: 'chairs' }, outcome: 'allied' }],
    outcomes: {
      allied: { label: 'Stühle fliegen, beide verbünden sich gegen den Spieler', mood: { safety: -1 }, hostile: true,
        lines: [shout('neighborA', "Hast du DAS gesehen, Lupe?!"), shout('neighborB', "Unsere STÜHLE! Gemeinsam, Rigo! Auf ihn!")],
        traces: [{ kind: 'scattered_chairs', minutes: 6 }] },
      ignored: { label: 'Patt mit Kaffee' },
    },
    rumor: { text: 'In Little Havana steht eine Festung aus Plastikstühlen. Um einen einzigen Parkplatz.', spread: 'district', heat: 0.2 },
  },
];
