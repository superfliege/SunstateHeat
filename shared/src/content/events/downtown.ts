// Straßenereignisse Downtown (E08–E13).
import { act, npc, phase, prop, say, sfx, shout, think, veh, whisper, type StreetEventDef } from './schema';

export const DOWNTOWN_EVENTS: StreetEventDef[] = [
  {
    id: 'E08', key: 'rooftop_meeting', title: 'Meeting auf dem Autodach', district: 'downtown', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'], traffic: true },
    weight: 9, cooldown: 120, needs: ['main_road'],
    roles: [npc('exec', 'businessman', 'Geschäftsmann im Videocall'), veh('car', 'limo', 'Firmenwagen im Stau'), veh('jam', 'car', 'Stau', [3, 6]), prop('bush', 'bush', 'Busch am Straßenrand')],
    phases: [
      phase('climb', [4, 5], { actions: [act('exec', 'Phone', 'climb', 'car')], lines: [think('exec', "Nur ein Balken Empfang… höher!")] }),
      phase('call', [14, 18], {
        actions: [act('exec', 'Phone')],
        lines: [shout('exec', "Ja, ich teile meinen Bildschirm! Nein, das ist der Himmel!", 1), shout('exec', "Können Sie mich jetzt hören?!", 7), say('exec', "Lassen Sie uns das offline nehmen. Ich BIN offline!", 12)],
        physics: [{ kind: 'traffic_jam', radius: 50 }],
      }),
      phase('done', [3, 4], { actions: [act('exec', 'Wave', 'fall')], lines: [say('exec', "Meeting beendet. Produktiv wie immer.")] }),
    ],
    interventions: [{ id: 'honk', label: 'Hupen', detect: { kind: 'honk', radius: 20 }, phases: ['call'], outcome: 'slip' }],
    outcomes: {
      slip: { label: 'Er rutscht theatralisch in einen Busch (unverletzt)', xp: 10,
        lines: [sfx('exec', "RUTSCH – KNIRSCH"), say('exec', "Ich bin okay! Der Busch hat das Meeting verlassen!")],
        rumor: 'Ein Banker ist in Downtown während eines Videocalls vom Autodach in eine Hecke gefallen. Der Call lief weiter.' },
      ignored: { label: 'Er klettert zurück ins Auto' },
    },
    rumor: { text: 'In Downtown halten Leute jetzt Meetings auf Autodächern. Besserer Empfang, sagen sie.', spread: 'district', heat: 0.2 },
  },
  {
    id: 'E09', key: 'briefcase_burst', title: 'Aktenkoffer-Explosion', district: 'downtown', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 9, cooldown: 120, needs: ['sidewalk', 'office_tower'],
    roles: [npc('banker', 'businessman', 'Banker'), prop('case', 'briefcase', 'Aktenkoffer'), prop('papers', 'paper_sheet', 'Wichtige Blätter', [5, 5])],
    phases: [
      phase('rage', [5, 6], { actions: [act('banker', 'Phone')], lines: [shout('banker', "VERKAUFEN! ALLES VERKAUFEN!")] }),
      phase('throw', [6, 8], {
        actions: [act('banker', 'Scold')], lines: [sfx('case', "KLACK – WUSCH!")],
        physics: [{ kind: 'paper_flurry', prop: 'paper_sheet', count: 5, radius: 12, life: 60 }, { kind: 'spawn_pickups', prop: 'paper_sheet', count: 5, radius: 12, life: 60 }],
      }),
      phase('realize', [8, 12], { actions: [act('banker', 'Look', 'wander')], lines: [say('banker', "Ach so, das war der Test-Account."), say('banker', "Hat jemand meine Quartalszahlen gesehen? Sie fliegen da.", 5)] }),
    ],
    interventions: [
      { id: 'collect', label: '5 Blätter einsammeln und zurückbringen', detect: { kind: 'collect', prop: 'paper_sheet', count: 5, deliverTo: 'banker' }, outcome: 'returned' },
      { id: 'keep', label: 'Blätter behalten', detect: { kind: 'collect', prop: 'paper_sheet', count: 5 }, outcome: 'insider' },
    ],
    outcomes: {
      returned: { label: 'Banker zahlt', money: 150, xp: 20, lines: [say('banker', "Sie haben gerade eine Abteilung gerettet. Na ja, einen Ordner.")] },
      insider: { label: 'Kleine Chance auf Insider-Tipp', items: ['Insider-Tipp (nächster Geldautomat zahlt einmalig Bonus, 25 %)'], xp: 10 },
      ignored: { label: 'Papiere bleiben liegen', traces: [{ kind: 'paper_litter', minutes: 8 }] },
    },
    rumor: { text: 'In Downtown hat ein Banker seine Quartalszahlen in den Wind geworfen.', spread: 'district', heat: 0.25 },
  },
  {
    id: 'E10', key: 'food_truck_war', title: 'Food-Truck-Krieg', district: 'downtown', size: 'big',
    when: { parts: ['noon'] },
    weight: 8, cooldown: 180, needs: ['parking', 'road'],
    roles: [
      veh('taco', 'food_truck', 'Taco-Truck „Crunch Time“', undefined, 'tacoman'), npc('tacoman', 'vendor', 'Taco-Verkäufer'),
      veh('smoothie', 'food_truck', 'Smoothie-Truck „Blend Me Up“', undefined, 'smoothielady'), npc('smoothielady', 'vendor', 'Smoothie-Verkäuferin'),
      npc('queue', 'businessman', 'Hungrige Büroleute', [3, 5]),
    ],
    phases: [
      phase('standoff', [6, 8], { actions: [act('queue', 'Watch')], lines: [shout('tacoman', "Der Platz gehört Crunch Time!"), shout('smoothielady', "Seit wann? Seit nie!", 3)] }),
      phase('ram', [12, 16], {
        actions: [act('tacoman', 'Scold'), act('smoothielady', 'Scold'), act('queue', 'Film')],
        lines: [shout('tacoman', "Unsere Tacos sind KNUSPRIGER als dein Lebenslauf!", 1), shout('smoothielady', "Mein Smoothie hat mehr Vitamine als deine Familie!", 6), say('queue', "Ich will einfach nur Mittag essen…", 10)],
        physics: [{ kind: 'bump_vehicles', roles: ['taco', 'smoothie'] }],
      }),
      phase('resolve', [5, 6], { lines: [say('smoothielady', "Fein. Zweite Reihe. Aber ich hupe beim Mixen!")] }),
    ],
    interventions: [{ id: 'park', label: 'Spieler parkt auf der Lücke', detect: { kind: 'park_on', radius: 4, place: 'parking' }, phases: ['standoff', 'ram'], outcome: 'blocked' }],
    outcomes: {
      blocked: { label: 'Beide empört, beide verkaufen zum halben Preis', items: ['Gutschein: Taco ½ Preis', 'Gutschein: Smoothie ½ Preis'], xp: 15,
        lines: [shout('tacoman', "UNERHÖRT! …Taco? Halber Preis."), shout('smoothielady', "FRECHHEIT! …Smoothie? Auch halber Preis.")] },
      ignored: { label: 'Verlierer parkt in zweiter Reihe', traces: [{ kind: 'double_parked', minutes: 10 }] },
    },
    rumor: { text: 'Food-Truck-Krieg in Downtown: Tacos gegen Smoothies, Opfer: ein Parkplatz.', spread: 'zone', heat: 0.35 },
    radio: 'Verkehrsmeldung: Bayfront Avenue zähflüssig wegen eines Streits zwischen zwei Imbisswagen. Wir empfehlen: Tacos UND Smoothie.',
  },
  {
    id: 'E11', key: 'scooter_herd', title: 'Scooter-Herde', district: 'downtown', size: 'small',
    when: { parts: ['morning'] },
    weight: 9, cooldown: 120, needs: ['sidewalk', 'fountain'],
    roles: [npc('suits', 'businessman', 'Anzugträger auf Leih-Scootern', [4, 6]), veh('scooters', 'scooter', 'Leih-Scooter', [4, 6]), npc('lost', 'businessman', 'Abbieger'), npc('passerby', 'local', 'Passant')],
    phases: [
      phase('rush', [8, 10], { actions: [act('suits', undefined, 'dash'), act('passerby', 'Flinch')], lines: [shout('suits', "Disruption, Baby!", 1), shout('passerby', "Das ist ein GEHweg!", 5)] }),
      phase('splash', [5, 6], { actions: [act('lost', 'Flinch', 'fall')], physics: [{ kind: 'splash', role: 'lost' }], lines: [sfx('lost', "PLATSCH!"), shout('lost', "Mein Anzug ist nicht wasserdicht!", 2)] }),
      phase('comment', [3, 4], { lines: [say('passerby', "Und das ist die Zukunft?")] }),
    ],
    interventions: [],
    outcomes: { ignored: { label: 'Anzugträger trocknet im Brunnen', traces: [{ kind: 'wet_footprints', minutes: 5 }] } },
    rumor: { text: 'Ein Start-up-Gründer ist mit seinem Scooter in den Brunnen am Sunbank Tower gefahren. Er nennt es „Pivot“.', spread: 'district', heat: 0.2 },
  },
  {
    id: 'E12', key: 'window_cleaner', title: 'Fensterputzer in Not', district: 'downtown', size: 'big',
    when: { parts: ['morning', 'noon', 'afternoon'], weather: ['wind', 'clear', 'sunny'] },
    weight: 5, cooldown: 300, needs: ['highrise'],
    roles: [npc('cleaner', 'worker', 'Fensterputzer'), veh('gondola', 'gondola', 'Schiefe Gondel'), npc('crowd', 'local', 'Filmende Menge', [4, 8]), npc('filmer', 'tourist', 'Filmender Passant')],
    phases: [
      phase('dangle', [30, 45], {
        actions: [act('cleaner', 'Panic'), act('crowd', 'Watch', 'gather', 'gondola'), act('filmer', 'Film')],
        lines: [shout('cleaner', "Ich hab NUR die Fenster geputzt!", 1), shout('crowd', "Halt durch!", 8), say('filmer', "Kann mal jemand halten, ich will das filmen.", 14), shout('cleaner', "Wenn ich runterfalle, kündige ich!", 24)],
        physics: [{ kind: 'sway', role: 'gondola' }],
      }),
      phase('rescue_team', [8, 10], { lines: [say('crowd', "Die Feuerwehr ist da! Endlich!"), say('cleaner', "Ich mach ab heute nur noch Erdgeschoss.", 5)] }),
    ],
    interventions: [{ id: 'crane', label: 'Aufs Dach und die Gondel am Kran hochziehen', detect: { kind: 'climb', target: 'highrise', then: { kind: 'interact', target: 'gondola', hold: 4 } }, phases: ['dangle'], outcome: 'rescued' }],
    outcomes: {
      rescued: { label: 'Spieler zieht die Gondel hoch', money: 500, xp: 80, fame: 5, mood: { safety: 8 },
        lines: [shout('crowd', "JAAAA!"), say('cleaner', "Ich hab dein Fenster geputzt, Mann. Gratis. Für immer.")],
        radio: 'Held auf dem Dach: {player} rettet Fensterputzer in Downtown. Der Mann möchte jetzt umschulen. Auf Keller.' },
      ignored: { label: 'Feuerwehr rettet ihn', traces: [{ kind: 'police_tape', minutes: 6 }] },
    },
    rumor: { text: 'In Downtown hing ein Fensterputzer 40 Stockwerke über der Straße – {player} hat ihn hochgezogen.', spread: 'city', heat: 0.7 },
    radio: 'Wind in Downtown: Fensterputzer-Gondel hängt schief. Bitte nicht drunter stehen und vor allem nicht filmen. Okay, filmen.',
  },
  {
    id: 'E13', key: 'efficiency_preacher', title: 'Der Straßenprediger der Effizienz', district: 'downtown', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 120, needs: ['plaza'],
    roles: [npc('preacher', 'homeless', 'Prediger mit Megafon'), prop('megaphone', 'megaphone', 'Megafon'), prop('box', 'crate', 'Kiste'), npc('clerk', 'local', 'Büroangestellter', [2, 3]), npc('boss', 'businessman', 'Chef')],
    phases: [
      phase('sermon', [16, 22], {
        actions: [act('preacher', 'Scold'), act('clerk', 'Watch')],
        lines: [shout('preacher', "Diese Mail hätte ein Meeting sein können! Nein, umgekehrt!", 1), shout('preacher', "Die Vier-Stunden-Woche ist nahe! Kehret um von euren Excel-Tabellen!", 7), whisper('clerk', "Er hat recht…", 11), shout('preacher', "Montagsmeetings sind eine Prüfung!", 15)],
      }),
      phase('break_up', [4, 5], { actions: [act('boss', 'Scold'), act('clerk', undefined, 'goto', 'boss')], lines: [shout('boss', "Zurück an die Arbeit!"), say('clerk', "…Amen.", 2)] }),
    ],
    interventions: [{ id: 'cheer', label: 'Spieler jubelt mit (Emote)', detect: { kind: 'emote', radius: 8, emote: 'cheer' }, phases: ['sermon'], outcome: 'convert' }],
    outcomes: {
      convert: { label: 'Prediger segnet den Spieler', xp: 10, lines: [say('preacher', "Du, mein Kind, nimmst heute frei. Im Namen der Effizienz!")] },
      ignored: { label: 'Predigt endet wie jedes Meeting: ohne Ergebnis' },
    },
    rumor: { text: 'Der Effizienz-Prediger am Sunbank Tower hat heute drei Büroleute zur Mittagspause bekehrt.', spread: 'district', heat: 0.15 },
  },
];
