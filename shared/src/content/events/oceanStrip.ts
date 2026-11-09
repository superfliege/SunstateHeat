// Straßenereignisse Ocean Strip (E01–E07).
import { act, animal, npc, phase, prop, say, shout, symbol, sfx, think, veh, type StreetEventDef } from './schema';

export const OCEAN_STRIP_EVENTS: StreetEventDef[] = [
  {
    id: 'E01', key: 'seagull_heist', title: 'Möwen-Überfall', district: 'ocean_strip', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'], weather: ['clear', 'sunny', 'heat'] },
    weight: 10, cooldown: 90, needs: ['promenade', 'Trash'],
    roles: [
      npc('tourist', 'tourist', 'Tourist mit Riesenportion Pommes'),
      animal('gulls', 'seagull', 'Möwenschwarm', [5, 8]),
      npc('passerby', 'local', 'Passant'),
      prop('fries', 'fries', 'Chili-Cheese-Pommes'),
      prop('bin', 'trash_can', 'Mülleimer'),
    ],
    phases: [
      phase('approach', [4, 6], { actions: [act('tourist', 'Eat', 'wander'), act('gulls', undefined, 'swarm', 'tourist')], lines: [think('tourist', "Endlich. Die größte Portion der Insel.")] }),
      phase('attack', [10, 14], {
        actions: [act('tourist', 'Panic', 'circle'), act('gulls', undefined, 'chase', 'tourist'), act('passerby', 'Look')],
        lines: [shout('tourist', "NICHT DIE CHILI-CHEESE!", 1), shout('tourist', "Die haben ein System, ich sag's euch!", 6), say('passerby', "Jeden Tag dasselbe.", 9)],
        physics: [{ kind: 'scatter_props', prop: 'fries', count: 12, radius: 3, life: 30 }],
      }),
      phase('hide', [5, 7], { actions: [act('tourist', 'Cower', 'hide', 'bin'), act('gulls', 'Eat', 'gather', 'fries')], lines: [say('tourist', "Ich wohn jetzt hier drin.")] }),
    ],
    interventions: [
      { id: 'honk', label: 'Hupen verscheucht die Möwen', detect: { kind: 'honk', radius: 15 }, phases: ['attack'], outcome: 'saved' },
      { id: 'run', label: 'Hinrennen verscheucht die Möwen', detect: { kind: 'approach', radius: 3, target: 'gulls', onFoot: true, running: true }, phases: ['attack'], outcome: 'saved' },
    ],
    outcomes: {
      saved: { label: 'Möwen verscheucht', money: 40, health: 10, items: ['halbe Portion Pommes'], xp: 15,
        lines: [say('tourist', "Mein Held! Hier, die Hälfte. Die andere Hälfte gehört jetzt der Natur.")] },
      ignored: { label: 'Tourist im Mülleimer', traces: [{ kind: 'paper_litter', minutes: 5 }] },
    },
    rumor: { text: 'Am Ocean Strip haben Möwen einen Mann ausgeraubt.', spread: 'zone', heat: 0.35 },
    radio: 'Polizei rät: Pommes am Ocean Strip nur noch in Begleitung essen.',
  },
  {
    id: 'E02', key: 'posing_duel', title: 'Posing-Duell', district: 'ocean_strip', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 7, cooldown: 180, needs: ['beach', 'gym'],
    roles: [
      npc('flexA', 'jogger', 'Bodybuilder „Big Biceps“'),
      npc('flexB', 'jogger', 'Bodybuilder „Der Tempel“'),
      npc('crowd', 'beachgoer', 'Johlende Menge', [4, 8]),
    ],
    phases: [
      phase('warmup', [5, 6], { actions: [act('flexA', 'Wave'), act('flexB', 'Wave'), act('crowd', 'Watch', 'gather', 'flexA')], lines: [say('flexA', "Heute zeig ich dir, was Training heißt.")] }),
      phase('duel', [14, 18], {
        actions: [act('flexA', 'Dance'), act('flexB', 'Dance'), act('crowd', 'Watch')],
        lines: [shout('flexA', "Bizeps sagt Hallo!", 1), shout('flexB', "Mein Bizeps hat einen eigenen Fanclub!", 5), shout('crowd', "UUUH!", 8), say('flexA', "Das ist kein Muskel, das ist ein Lebensstil!", 11)],
      }),
      phase('verdict', [5, 6], { actions: [act('flexB', 'Cower', 'fall'), act('crowd', 'Wave')], lines: [shout('flexB', "Ich… gebe… auf! Sand, nimm mich!"), shout('crowd', "BRAVO!")] }),
    ],
    interventions: [
      { id: 'emote', label: 'Spieler posiert mit (Emote) – die Menge bewertet', detect: { kind: 'emote', radius: 10, emote: 'any' }, phases: ['duel'], outcome: 'won' },
    ],
    outcomes: {
      won: { label: 'Menge kürt den Spieler', xp: 60, fame: 2, lines: [shout('crowd', "NEUER CHAMPION!"), say('flexA', "Wer bist DU denn?! Wo trainierst du?!")] },
      ignored: { label: 'Verlierer wirft sich theatralisch in den Sand', lines: [say('flexB', "Ich komme wieder. Mit Waden.")] },
    },
    rumor: { text: 'Am Strandgym gab es ein Posing-Duell – {player} hat alle in den Schatten gestellt.', spread: 'district', heat: 0.25 },
  },
  {
    id: 'E03', key: 'roller_domino', title: 'Rollschuh-Domino', district: 'ocean_strip', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 150, needs: ['promenade', 'fountain'],
    roles: [
      npc('skater', 'beachgoer', 'Rollschuhfahrerin ohne Bremsen'),
      npc('icecream', 'vendor', 'Eisverkäufer'),
      veh('cart', 'ice_cart', 'Eiswagen'),
      npc('jogger', 'jogger', 'Jogger'),
      npc('dogowner', 'dogwalker', 'Hundebesitzer'),
      prop('ice', 'ice_cream', 'Eiskugeln', [3, 6]),
    ],
    phases: [
      phase('wobble', [3, 4], { actions: [act('skater', 'Panic', 'dash')], lines: [shout('skater', "AUSWEICHEN! Ich hab keine Bremsen, nur Träume!")] }),
      phase('chain', [8, 10], {
        actions: [act('skater', 'Panic', 'dash'), act('icecream', 'Flinch', 'fall'), act('jogger', 'Flinch', 'fall'), act('dogowner', 'Flinch', 'fall')],
        lines: [shout('icecream', "Mein Eis!", 2), shout('jogger', "Meine Bestzeit!", 5), shout('dogowner', "Bello, NICHT hinterher!", 7)],
        physics: [{ kind: 'chain_collide', roles: ['icecream', 'jogger', 'dogowner'] }, { kind: 'tip_over', role: 'cart' }, { kind: 'scatter_props', prop: 'ice_cream', count: 6, radius: 2 }],
      }),
      phase('fountain', [4, 5], { actions: [act('skater', 'Flinch', 'fall')], physics: [{ kind: 'splash', role: 'skater' }], lines: [sfx('skater', "PLATSCH!"), say('skater', "…Ich wollte eh baden.")] }),
    ],
    interventions: [
      { id: 'block', label: 'Spieler stellt sich in den Weg', detect: { kind: 'block_path', target: 'skater', radius: 1.5 }, phases: ['wobble', 'chain'], outcome: 'caught' },
    ],
    outcomes: {
      caught: { label: 'Rollschuhfahrerin prallt ab und bedankt sich', money: 30, xp: 20, lines: [say('skater', "Du bist wie eine Wand! Eine nette Wand! Danke!")] },
      ignored: { label: 'Kette endet im Brunnen', traces: [{ kind: 'wet_footprints', minutes: 5 }, { kind: 'tipped_cart', minutes: 5 }] },
    },
    rumor: { text: 'Eine Rollschuhfahrerin hat am Strip halb die Promenade abgeräumt.', spread: 'district', heat: 0.3 },
  },
  {
    id: 'E04', key: 'influencer_shoot', title: 'Influencer im Weg', district: 'ocean_strip', size: 'big',
    when: { parts: ['afternoon', 'evening'], traffic: true },
    weight: 8, cooldown: 180, needs: ['road', 'beach'],
    roles: [
      npc('influencer', 'partygoer', 'Influencerin'),
      npc('assistant', 'local', 'Assistent mit Reflektor'),
      prop('reflector', 'reflector', 'Reflektor'),
      veh('cars', 'car', 'Hupende Autos', [3, 5]),
      npc('driver', 'businessman', 'Genervter Autofahrer'),
    ],
    phases: [
      phase('shoot', [14, 20], {
        actions: [act('influencer', 'Photo'), act('assistant', 'Wait'), act('driver', 'Scold')],
        lines: [shout('influencer', "Noch EIN Take!", 1), say('influencer', "Das Licht ist gerade so authentisch!", 6), shout('driver', "Ich hab 'nen Job!", 9), say('assistant', "Sie hat 40.000 Follower, Sir.", 12)],
        physics: [{ kind: 'traffic_jam', radius: 40 }],
      }),
      phase('wrap', [4, 5], { actions: [act('influencer', 'Wave')], lines: [say('influencer', "Okay, das wird viral. Danke, Straße!")] }),
    ],
    interventions: [
      { id: 'drive_through', label: 'Spieler fährt durchs Bild', detect: { kind: 'drive_through', radius: 6, target: 'influencer' }, phases: ['shoot'], outcome: 'ruined' },
      { id: 'wait', label: 'Spieler wartet, bis sie fertig ist', detect: { kind: 'wait_out', radius: 20, stillFor: 10 }, phases: ['shoot'], outcome: 'photo' },
    ],
    outcomes: {
      ruined: { label: 'Content ruiniert – sie postet über den Spieler', fame: 3, lines: [shout('influencer', "Du hast meinen CONTENT ruiniert!")], rumor: 'Eine Influencerin hetzt online gegen {player}, der ihr Sonnenuntergangsfoto gecrasht hat.' },
      photo: { label: 'Foto mit dem Spieler', fame: 5, xp: 20, lines: [say('influencer', "Du warst so geduldig! Selfie! Hashtag #RealPalmara!")] },
      ignored: { label: 'Stau löst sich auf' },
    },
    rumor: { text: 'Am Ocean Strip stand der Verkehr still – wegen eines Sonnenuntergangsfotos.', spread: 'district', heat: 0.3 },
  },
  {
    id: 'E05', key: 'metal_detector_grandpa', title: 'Metalldetektor-Opa', district: 'ocean_strip', size: 'small',
    when: { parts: ['morning'] },
    weight: 9, cooldown: 120, needs: ['beach'],
    roles: [npc('grandpa', 'retiree', 'Rentner mit Metalldetektor'), prop('detector', 'metal_detector', 'Metalldetektor'), prop('find', 'bottle_cap', 'Fundstück'), npc('owner', 'tourist', 'Besitzer der Brieftasche (Hotel „Pink Flamingo“)')],
    phases: [
      phase('search', [8, 10], { actions: [act('grandpa', 'Search', 'wander')], lines: [sfx('detector', "piep… piep…", 1), sfx('detector', "PIEPPIEPPIEP!", 6)] }),
      phase('dig', [6, 8], { actions: [act('grandpa', 'Search')], lines: [shout('grandpa', "Diesmal ist es eine Dublone!")] }),
      phase('reveal', [4, 5], { actions: [act('grandpa', 'Look')], lines: [say('grandpa', "…ein Kronkorken. Schon wieder.")] }),
    ],
    interventions: [
      { id: 'return', label: 'Brieftasche zum Hotel „Pink Flamingo“ bringen', detect: { kind: 'deliver', what: 'find', to: 'owner', dest: 'hotel' }, outcome: 'returned' },
      { id: 'keep', label: 'Brieftasche behalten', detect: { kind: 'interact', target: 'find' }, outcome: 'kept' },
    ],
    outcomes: {
      returned: { label: 'Besitzer im Hotel zahlt Finderlohn', money: 200, xp: 30, mood: { safety: 2 } },
      kept: { label: 'Behalten', money: 120, mood: { safety: -2 }, rumor: 'Am Strip wurde eine gefundene Brieftasche einfach behalten. Typisch.' },
      ignored: { label: 'Kronkorken in die Sammlung' },
    },
    variants: [{ id: 'wallet', chance: 0.1, label: 'Brieftasche gefunden', note: 'Fundstück ist eine Brieftasche → Eingriffe „return“/„keep“ werden aktiv.' }],
    rumor: { text: 'Der Opa mit dem Metalldetektor hat wieder einen Kronkorken gefunden. Seine Sammlung hat jetzt 4.000 Stück.', spread: 'district', heat: 0.1 },
  },
  {
    id: 'E06', key: 'lost_groom', title: 'Verlorener Bräutigam', district: 'ocean_strip', size: 'big',
    when: { parts: ['night'] },
    weight: 7, cooldown: 240, needs: ['promenade', 'lifeguard_tower'],
    roles: [
      npc('party', 'partygoer', 'Junggesellenabschied in Flamingo-Hemden', [4, 6]),
      npc('groom', 'partygoer', 'Kevin, der Bräutigam (schläft)'),
      prop('shirt', 'flamingo_shirt', 'Flamingo-Hemden'),
    ],
    phases: [
      phase('search', [20, 30], {
        actions: [act('party', 'Look', 'wander'), act('groom', 'Lie', 'hide')],
        lines: [shout('party', "KEVIN? KEEEVIN!", 1), say('party', "Er hatte das Flamingokostüm an!", 7), shout('party', "Die Hochzeit ist in sechs Stunden!", 14), think('groom', "Zzzz… Flamingos…", 20)],
      }),
      phase('give_up', [5, 6], { actions: [act('party', 'Phone')], lines: [say('party', "Wer ruft die Braut an? …Nicht ich.")] }),
    ],
    interventions: [
      { id: 'deliver', label: 'Kevin per Auto zur Gruppe bringen', detect: { kind: 'deliver', what: 'groom', to: 'party', byVehicle: true }, outcome: 'rescued' },
    ],
    outcomes: {
      rescued: { label: 'Gruppe feiert den Spieler', money: 300, xp: 50, fame: 3, lines: [shout('party', "KEVIN!!! DU HELD!"), say('groom', "Wo bin ich? Warum bin ich ein Flamingo?")], rumor: 'Ein Held hat Kevin gerettet – {player} hat den Bräutigam rechtzeitig abgeliefert.' },
      ignored: { label: 'Kevin schläft im Rettungsturm weiter' },
    },
    rumor: { text: 'Ein Held hat Kevin gerettet.', spread: 'zone', heat: 0.4 },
    radio: 'Kurzmeldung: Bräutigam im Flamingokostüm rechtzeitig zur Hochzeit gefunden. Die Braut bittet um Fotos.',
  },
  {
    id: 'E07', key: 'bbq_sunscreen', title: 'Sonnencreme-Unfall', district: 'ocean_strip', size: 'small',
    when: { parts: ['noon'], weather: ['heat', 'sunny'] },
    weight: 6, cooldown: 120, needs: ['beach', 'water_edge'],
    roles: [npc('tourist', 'tourist', 'Knallroter Tourist'), animal('gulls', 'seagull', 'Interessierte Möwen', [2, 2])],
    phases: [
      phase('run', [8, 10], {
        actions: [act('tourist', 'Panic', 'dash'), act('gulls', undefined, 'follow', 'tourist')],
        lines: [shout('tourist', "AAAH! ES BRENNT UND RIECHT NACH RAUCHAROMA!", 1), shout('tourist', "Die Flaschen sahen gleich aus!", 5), symbol('gulls', "♥", 7)],
      }),
      phase('splash', [4, 5], { physics: [{ kind: 'splash', role: 'tourist' }], lines: [sfx('tourist', "ZISCH!"), say('tourist', "Ahh… mariniert, aber gerettet.")] }),
    ],
    interventions: [],
    outcomes: { ignored: { label: 'Tourist kühlt im Meer ab, Möwen bleiben verliebt' } },
    rumor: { text: 'Am Strand läuft ein Tourist rum, der nach Grillsoße riecht. Die Möwen lieben ihn.', spread: 'district', heat: 0.2 },
  },
];
