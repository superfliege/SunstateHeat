// Straßenereignisse im Norden: Höfe, Landstraßen und Okee Peak (E49–E56).
// Ton (spec 1.5): Comic, niemand wird verletzt, Humor aus Situationen (Stadt trifft Land).
import { act, animal, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const NORTH_EVENTS: StreetEventDef[] = [
  {
    id: 'E49', key: 'combine_convoy', title: 'Mähdrescher-Kolonne', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'], traffic: true },
    weight: 7, cooldown: 180, needs: ['country_road'], at: ['big_melon', 'Pinecrest Parkway', 'Sabal–Cane Road', 'Okee Trail'],
    roles: [
      veh('combine', 'combine', 'Mähdrescher „Harvest Titan“', undefined, 'farmer'), npc('farmer', 'farmhand', 'Hank Mellow am Steuer'),
      veh('sportscar', 'sports', 'Sportwagen aus Downtown', undefined, 'citydriver'), npc('citydriver', 'businessman', 'Gestresster Städter'),
      veh('queue', 'car', 'Wartende Kolonne', [4, 9]),
    ],
    phases: [
      phase('crawl', [40, 70], {
        actions: [act('combine', undefined, 'drift'), act('queue', undefined, 'follow', 'combine'), act('citydriver', 'Scold')],
        physics: [{ kind: 'traffic_jam', role: 'combine', radius: 80 }],
        lines: [
          sfx('combine', 'BRRRMMM … KLACK … BRRRMMM', 1), shout('citydriver', 'Ich hab ein MEETING in Downtown!', 6),
          say('farmer', 'Die Ernte hat auch eins.', 11), think('citydriver', '…Gibt es hier ein Taxi? Einen Helikopter?', 22),
          sfx('queue', '♪ TÖÖT ♪', 30), say('farmer', 'Hupen macht ihn nicht schneller. Hab ich probiert.', 36),
        ],
      }),
      phase('turn_off', [8, 12], { actions: [act('combine', undefined, 'goto'), act('farmer', 'Wave')], lines: [say('farmer', 'Schönen Tag noch, Leute! Die Melonen danken euch.')] }),
    ],
    interventions: [
      { id: 'overtake', label: 'Riskant überholen (Gegenverkehr) – Bonus-XP', detect: { kind: 'drive_through', radius: 14, target: 'combine', minSpeed: 18 }, gate: { inVehicle: true }, phases: ['crawl'], outcome: 'daredevil' },
      { id: 'redirect', label: 'Aussteigen und die Kolonne über den Feldweg umleiten (winken)', detect: { kind: 'emote', radius: 12, emote: 'wave' }, gate: { onFoot: true }, phases: ['crawl'], outcome: 'redirected' },
    ],
    outcomes: {
      daredevil: { label: 'Waghalsiges Überholmanöver', xp: 60, fame: 3, lines: [shout('citydriver', 'Warte! Nimm mich mit!'), say('farmer', 'Der hat ein Meeting mit dem Graben, wetten?')] },
      redirected: { label: 'Kolonne fließt über den Feldweg ab', xp: 45, mood: { safety: 3 }, regular: { id: 'ok_big_melon', delta: 8 },
        lines: [say('farmer', 'Du hättest Verkehrspolizist werden sollen. Oder Schäfer.')], traces: [{ kind: 'tire_tracks', minutes: 20 }] },
      ignored: { label: 'Kolonne kriecht weiter' },
    },
    rumor: { text: 'Auf der Landstraße stand ein Sportwagen eine halbe Stunde hinter einem Mähdrescher. Der Fahrer hat angeblich geweint.', spread: 'zone', heat: 0.35 },
    radio: 'Verkehr Dry Pine: Zähflüssig hinter einem Mähdrescher. Geschätzte Wartezeit: eine Erntesaison.',
  },
  {
    id: 'E50', key: 'tractor_pulling', title: 'Traktor-Pulling', district: 'okeefield', size: 'big',
    when: { parts: ['noon', 'afternoon'], weekend: true, weekdays: [0, 6] },
    weight: 6, cooldown: 600, needs: ['rodeo_arena'], at: ['double_r'],
    roles: [
      veh('tractors', 'tractor', 'Teilnehmer-Traktoren', [3, 4], 'pullers'), npc('pullers', 'rancher', 'Farmer am Steuer', [3, 4]),
      npc('crowd', 'townsfolk', 'Publikum auf Heuballen', [6, 10]), npc('host', 'rancher', 'Doris Whitlock mit Megafon'),
      prop('sled', 'sled', 'Bremsschlitten'), prop('bales', 'hay_bale', 'Heuballen-Tribüne', [6, 8]), prop('trophy', 'trophy', 'Pokal'),
    ],
    phases: [
      phase('intro', [10, 14], { actions: [act('crowd', 'Watch', 'gather', 'host'), act('host', 'Talk')], lines: [shout('host', 'Willkommen zum Double-R-Traktor-Pulling!', 1), shout('host', 'Wer zieht den Schlitten am weitesten? Wetten bei Betty-Lou!', 6)] }),
      phase('pull', [40, 60], {
        actions: [act('tractors', undefined, 'dash'), act('crowd', 'Wave')],
        physics: [{ kind: 'sway', role: 'sled' }],
        lines: [sfx('tractors', 'RRRÖÖÖHHH – PUFF PUFF', 2), shout('crowd', 'ZIEH! ZIEH! ZIEH!', 8), say('pullers', 'Mein Opa hat mit dem Ding den Mond gezogen.', 20), shout('host', 'Neuer Rekord: 62 Meter und eine Rauchwolke!', 34)],
      }),
    ],
    interventions: [
      { id: 'compete', label: 'Mit einem Traktor teilnehmen (Mini-Wettbewerb: Schlitten am weitesten ziehen)', detect: { kind: 'race', vehicle: 'tractor', checkpoints: 1, stake: [0, 0] }, gate: { inVehicle: true }, phases: ['intro', 'pull'], outcome: 'champion' },
      { id: 'cheer', label: 'Mitjubeln', detect: { kind: 'emote', radius: 15, emote: 'cheer' }, outcome: 'fan' },
    ],
    outcomes: {
      champion: { label: 'Pulling-Champion: Pokal (Garagen-Deko) + Preisgeld', money: 650, xp: 120, items: ['deco_tractor_trophy'], fame: 5, regular: { id: 'ok_rancher', delta: 12 },
        lines: [shout('host', 'Der Pokal geht an die Person mit dem dicksten Diesel!'), say('crowd', 'Erzähl das bloß nicht den Stadtleuten.')] },
      fan: { label: 'Gute Stimmung', xp: 15, mood: { safety: 2 } },
      ignored: { label: 'Pulling geht ohne dich weiter' },
    },
    rumor: { text: 'Beim Traktor-Pulling auf der Double R hat {player} den Bremsschlitten fast bis nach Okeefield gezogen.', spread: 'zone', heat: 0.4 },
    radio: 'Sport aus dem Hinterland: Beim Traktor-Pulling der Double R Ranch fiel ein neuer Rekord – und zwei Auspuffrohre.',
  },
  {
    id: 'E51', key: 'runaway_horses', title: 'Ausgebüxte Pferde', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon', 'evening'] },
    weight: 6, cooldown: 300, needs: ['highway', 'pasture'], at: ['double_r', 'Pinecrest Parkway', 'Route 41'],
    roles: [
      animal('horses', 'horse', 'Drei Pferde', [3, 3]), npc('rider', 'rancher', 'Rancher zu Pferd'), veh('traffic', 'car', 'Bremsende Autos', [2, 4]),
    ],
    phases: [
      phase('stampede', [30, 50], {
        actions: [act('horses', undefined, 'flee'), act('rider', 'Wave', 'chase', 'horses')],
        physics: [{ kind: 'traffic_jam', radius: 50 }],
        lines: [shout('rider', 'Das Gatter war ZU, ich schwör\'s!', 1), sfx('horses', 'GALOPP-GALOPP-GALOPP', 5), shout('rider', 'Butterblume! Komm zurück! Wir können über alles reden!', 15), think('horses', 'Freiheit riecht nach Asphalt.', 25)],
      }),
    ],
    interventions: [
      { id: 'herd', label: 'Pferde mit dem Fahrzeug zurück zur Weide treiben (hupen, Weg abschneiden)', detect: { kind: 'escort', target: 'horses', dest: 'pasture' }, gate: { inVehicle: true }, outcome: 'herded' },
    ],
    outcomes: {
      herded: { label: 'Pferde zurück – der Rancher schenkt dir einen alten Pick-up', xp: 90, items: ['vehicle:Rusty Ranch Pick-up'], regular: { id: 'ok_rancher', delta: 15 },
        lines: [say('rider', 'Nimm den alten Pick-up. Er springt an, wenn er Lust hat. Wie die Pferde.')] },
      ignored: { label: 'Pferde grasen am Mittelstreifen', traces: [{ kind: 'hay_scattered', minutes: 15 }] },
    },
    rumor: { text: 'Drei Pferde haben auf dem Highway den Verkehr aufgehalten. Eins hatte angeblich einen Strohhut auf.', spread: 'city', heat: 0.4 },
    radio: 'Achtung Autofahrer: Auf dem Highway Richtung Okeefield sind Pferde unterwegs. Bitte nicht hupen, die sind empfindlich.',
  },
  {
    id: 'E52', key: 'city_slicker_mud', title: 'Städter im Matsch', district: 'okeefield', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'], weather: ['rain', 'clear'] },
    weight: 7, cooldown: 240, needs: ['dirt_road', 'field'], at: ['big_melon', 'sunny_grove', 'Okee Trail'],
    roles: [
      veh('sportscar', 'sports', 'Festgefahrener Sportwagen', undefined, 'suit'), npc('suit', 'businessman', 'Fahrer im Designeranzug'),
      veh('tractor', 'tractor', 'Traktor', undefined, 'farmer'), npc('farmer', 'farmhand', 'Farmer'),
    ],
    phases: [
      phase('stuck', [40, 70], {
        actions: [act('suit', 'Phone'), act('farmer', 'Point')],
        lines: [shout('suit', 'Das Navi hat gesagt, das ist eine Abkürzung!', 1), say('farmer', 'Das Navi kennt den Matsch nicht.', 6), sfx('farmer', 'HAHAHAHA – HUST – HAHAHA', 10), think('suit', 'Diese Schuhe waren italienisch.', 22)],
      }),
    ],
    interventions: [
      { id: 'tow', label: 'Mit Traktor oder Pick-up rausziehen (anfahren, Seil, langsam ziehen)', detect: { kind: 'interact', target: 'sportscar', hold: 4 }, gate: { inVehicle: true }, outcome: 'towed' },
    ],
    outcomes: {
      towed: { label: '500 $ und eine Visitenkarte (Kontakt für eine Stadt-Quest)', money: 500, xp: 50, items: ['business_card_downtown'], followUp: 'Stadt-Kontakt: „Der Mann im Anzug“ meldet sich aus Downtown',
        lines: [say('suit', 'Sie haben mir das Leben gerettet. Und die Felgen. Hier, meine Karte.'), say('farmer', 'Grüß das Navi von mir.')], traces: [{ kind: 'mud_splatter', minutes: 10 }] },
      ignored: { label: 'Der Farmer zieht ihn irgendwann raus – nach dem Mittagessen', traces: [{ kind: 'tire_tracks', minutes: 25 }] },
    },
    rumor: { text: 'Ein Sportwagen aus Downtown steckt bis zu den Türgriffen im Feldweg. Die Farmer verkaufen schon Eintrittskarten.', spread: 'zone', heat: 0.3 },
  },
  {
    id: 'E53', key: 'summit_purist', title: 'Gipfelstürmer', district: 'okeefield', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 6, cooldown: 300, needs: ['mountain_road'], at: ['switchback', 'Switchback Road', 'summit'],
    roles: [npc('hiker', 'climber', 'Reginald mit kompletter Expeditionsausrüstung'), prop('gear', 'expedition_gear', 'Sauerstoffflasche, Eispickel, Fahnenmast')],
    phases: [
      phase('lecture', [40, 60], {
        actions: [act('hiker', 'Talk', 'climb')],
        lines: [shout('hiker', 'Ich besteige den Gipfel OHNE Hilfsmittel!', 1), shout('hiker', 'Das ist Betrug!', 9), say('hiker', 'Ich brauche keinen Sauerstoff!', 18), think('hiker', '(auf 900 m) …vielleicht ein bisschen Sauerstoff.', 30)],
      }),
    ],
    interventions: [
      { id: 'lift', label: 'Mitfahrt anbieten (er lehnt empört ab …)', detect: { kind: 'approach', radius: 6, target: 'hiker' }, gate: { inVehicle: true }, outcome: 'stowaway' },
    ],
    outcomes: {
      stowaway: { label: 'Easter Egg: Am Gipfel steigt er heimlich aus deinem Kofferraum', xp: 40, fame: 1, worldFlag: 'reginald_stowaway',
        lines: [shout('hiker', 'NIEMALS! Ich bin Purist!'), say('hiker', '(später, am Gipfel, aus dem Kofferraum) …Das bleibt unter uns, verstanden?')] },
      ignored: { label: 'Reginald stapft weiter (er kommt bei Sonnenuntergang an)' },
    },
    rumor: { text: 'Ein Wanderer behauptet, er habe den Okee Peak ohne Hilfsmittel bestiegen. Am Gipfel roch er nach Kofferraum.', spread: 'zone', heat: 0.25 },
  },
  {
    id: 'E54', key: 'quarry_blast', title: 'Steinbruch-Sprengung', district: 'okeefield', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 6, cooldown: 200, needs: ['quarry'], at: ['quarry'],
    roles: [npc('workers', 'quarry_worker', 'Steinbrucharbeiter', [3, 5]), npc('boomer', 'quarry_worker', '„Boomer“ Briggs'), prop('siren', 'siren', 'Sirene'), animal('birds', 'hawk', 'Aufschreckende Vögel', [4, 6])],
    phases: [
      phase('warning', [10, 14], { actions: [act('workers', 'Panic', 'hide'), act('boomer', 'Point')], lines: [sfx('siren', 'UUUUIIIIUUUUU', 1), shout('boomer', 'FEUER FREI IN DREI … ZWEI …', 6), shout('workers', 'IN DECKUNG!', 4)] }),
      phase('blast', [12, 18], {
        actions: [act('birds', undefined, 'flee'), act('workers', 'Cower')],
        physics: [{ kind: 'scatter_props', prop: 'gravel', count: 40, radius: 30 }, { kind: 'knockback', radius: 35 }],
        lines: [sfx('boomer', 'KA-WUMMMMM!', 0), say('boomer', 'Wunderschön. Wie Feuerwerk, nur ehrlicher.', 6)],
      }),
    ],
    interventions: [
      { id: 'too_close', label: 'Zu nah dran: Comic-Staubwolke, Kamera-Wackeln, Arbeiter schimpfen', detect: { kind: 'enter_area', place: 'quarry' }, phases: ['warning', 'blast'], outcome: 'dusted' },
    ],
    outcomes: {
      dusted: { label: 'Von oben bis unten eingestaubt', xp: 10, traces: [{ kind: 'dust_layer', minutes: 8 }], regular: { id: 'ok_quarry', delta: -5 },
        lines: [shout('workers', 'Hast du die Sirene nicht gehört?!'), say('boomer', 'Jetzt siehst du aus wie ein echter Steinbrucharbeiter.')] },
      ignored: { label: 'Staub legt sich, Kiesberge wachsen' },
    },
    rumor: { text: 'Im Steinbruch am Okee Peak hat es wieder gerummst. In Okeefield sind drei Kuchen eingesunken.', spread: 'zone', heat: 0.2 },
  },
  {
    id: 'E55', key: 'farm_shop_rush', title: 'Hofladen-Ansturm', district: 'okeefield', size: 'small',
    when: { parts: ['noon', 'afternoon'] },
    weight: 7, cooldown: 240, needs: ['farm_shop'], at: ['sunny_grove'],
    roles: [veh('bus', 'tour_bus', 'Reisebus aus der Stadt', undefined, 'guide'), npc('guide', 'local', 'Reiseleiterin'), npc('tourists', 'tourist', 'Touristen', [8, 12]), npc('rosie', 'farmer', 'Rosie Peck'), prop('juice', 'juice_cup', 'Orangensaft', [10, 14])],
    phases: [
      phase('rush', [40, 60], {
        actions: [act('tourists', 'Photo', 'swarm', 'rosie'), act('rosie', 'Talk')],
        lines: [shout('tourists', 'Ist das BIO?', 2), say('rosie', 'Das ist eine Orange, Schätzchen.', 6), shout('tourists', 'Gibt es den auch mit Hafermilch?', 15), think('rosie', 'Ich brauche eine größere Saftpresse.', 26)],
      }),
    ],
    interventions: [
      { id: 'help_press', label: 'An der Saftpresse aushelfen (halten)', detect: { kind: 'interact', target: 'rosie', hold: 6 }, gate: { onFoot: true }, outcome: 'juiced' },
    ],
    outcomes: {
      juiced: { label: 'Saftpresse heißgelaufen, Kasse voll', money: 150, xp: 35, health: 'full', regular: { id: 'ok_sunny_grove', delta: 10 },
        lines: [say('rosie', 'Du hast Saft im Blut. Wortwörtlich, wisch dir mal das Kinn ab.')] },
      ignored: { label: 'Bus fährt ab, Saft ist alle', traces: [{ kind: 'tourists_with_cameras', minutes: 12 }] },
    },
    rumor: { text: 'Am Hofladen von Sunny Grove haben Touristen aus der Stadt alle Orangen leergekauft und nach WLAN gefragt.', spread: 'zone', heat: 0.25 },
  },
  {
    id: 'E56', key: 'campfire_stories', title: 'Lagerfeuer-Geschichten', district: 'okeefield', size: 'small',
    when: { parts: ['evening', 'night'] },
    weight: 8, cooldown: 180, needs: ['campground'], at: ['campground'],
    roles: [npc('campers', 'camper', 'Camper', [3, 5]), npc('earl', 'farmer', 'Earl Pritchard (erzählt)'), animal('raccoon', 'raccoon', 'Waschbär'), prop('marsh', 'marshmallow', 'Marshmallows', [6, 6])],
    phases: [
      phase('story', [40, 60], {
        actions: [act('campers', 'Sit'), act('earl', 'Talk')],
        lines: [
          whisperLine('earl', 'Draußen in Gator Flats … lebt das SUMPFMONSTER.', 1), shout('campers', 'IIIIH!', 7),
          say('earl', 'Es frisst nur Touristen mit Socken in Sandalen.', 14), think('raccoon', '(heimlich) Marshmallows. Meine.', 20),
          shout('campers', 'Hey! Der Waschbär klaut die Marshmallows!', 28),
        ],
      }),
      phase('raccoon', [8, 12], { actions: [act('raccoon', undefined, 'flee'), act('campers', 'Point')], lines: [sfx('raccoon', 'KNISTER-KNISTER-WEG', 1), say('earl', 'Das war das Monster. Ganz sicher.', 5)] }),
    ],
    interventions: [
      { id: 'sit_down', label: 'Dazusetzen und zuhören (Gerücht mit Hinweis auf ein Sammelobjekt)', detect: { kind: 'interact', target: 'earl', hold: 3 }, gate: { onFoot: true }, phases: ['story'], outcome: 'rumor_hint' },
    ],
    outcomes: {
      rumor_hint: { label: 'Gerücht: Hinweis auf ein Sammelobjekt im Sumpf', xp: 25, regular: { id: 'ok_cane_creek', delta: 6 },
        rumor: 'Earl sagt, am alten Airboat-Anleger in Gator Flats liegt etwas Glänzendes unter dem dritten Steg. Das Monster bewacht es. Angeblich.',
        lines: [say('earl', 'Und wer dem Monster nicht glaubt, soll unter dem dritten Steg nachsehen …')] },
      ignored: { label: 'Geschichten verhallen, Waschbär satt' },
    },
    rumor: { text: 'Am Lagerfeuer im Pinecone Campground erzählt man sich wieder vom Sumpfmonster aus Gator Flats.', spread: 'zone', heat: 0.3 },
  },
];

function whisperLine(role: string, text: string, at?: number) { return { role, text, style: 'whisper' as const, at }; }
