// Ereignisse in den Innenräumen (E57–E64): Club „Pink Static“ und Casino „Palm Royale“ (shared/venues).
// Gleiches Format wie die Straßenereignisse; gestartet werden sie vom Innenraum-Regisseur auf dem Server
// (server/src/venues/VenueDirector.ts), der Phasen, Sprechblasen und Effekte im Innenraum abspielt.
// Ton (spec 1.5): Comic, niemand wird verletzt, Satire auf Clubkultur und Glücksspiel.
import { act, gang, npc, phase, prop, say, sfx, shout, symbol, think, whisper, type StreetEventDef } from './schema';

export const VENUE_EVENTS: StreetEventDef[] = [
  // ------------------------------------------------------------------ Club „Pink Static“
  {
    id: 'E57', key: 'dj_missing', title: 'DJ fällt aus', district: 'ocean_strip', size: 'big', venue: 'club',
    when: { parts: ['evening', 'night'] },
    weight: 6, cooldown: 90, needs: ['nightclub', 'dj_booth'],
    roles: [
      npc('dj', 'partygoer', 'DJ Lux'), npc('crowd', 'partygoer', 'Enttäuschte Tanzfläche', [10, 30]), npc('vee', 'local', 'Vee an der Bar'),
      prop('deck', 'dj_deck', 'Verwaistes DJ-Pult'),
    ],
    phases: [
      phase('leave', [4, 6], { actions: [act('dj', 'Wave', 'goto')], lines: [say('dj', 'Bin GANZ kurz weg. Nicht anfassen!', 0.5), think('dj', '…war das Ketchup in der Bowle?', 3)] }),
      phase('silence', [25, 40], {
        actions: [act('crowd', 'Scold')], physics: [{ kind: 'music_stop' }],
        lines: [sfx('deck', '♪ … krrrz … Stille.', 0.5), shout('crowd', 'BUUUH!', 3), shout('crowd', 'Hallo?! Wir hatten einen DROP vereinbart!', 9), say('vee', 'Kann irgendwer Knöpfe drücken? Irgendwer?', 15)],
      }),
      phase('back', [6, 8], { actions: [act('dj', 'DJ', 'goto', 'deck')], physics: [{ kind: 'music_start' }], lines: [say('dj', 'Was hab ich verpasst? …Warum guckt ihr so?')] }),
    ],
    interventions: [
      { id: 'take_over', label: 'Ans DJ-Pult und einen Song lang im Takt Effekte auslösen', detect: { kind: 'venue_game', game: 'dj' }, phases: ['silence', 'back'], outcome: 'saved_party' },
    ],
    outcomes: {
      saved_party: {
        label: 'Party gerettet: Menge feiert, Freigetränk von Vee', money: 300, xp: 80, health: 'full', regular: { id: 'os_vee', delta: 10 }, rep: [{ gang: 'neon', delta: 2 }],
        lines: [shout('crowd', 'DJ! DJ! DJ!'), say('vee', 'Geht aufs Haus. Und der Job, falls Lux nicht wiederkommt.')],
      },
      ignored: { label: 'Stille, bis DJ Lux zurück ist', mood: { safety: -1 } },
    },
    rumor: { text: 'Im Pink Static hat {player} spontan aufgelegt – angeblich besser als DJ Lux. Sag ihm das nicht.', spread: 'district', heat: 0.45 },
    radio: 'Nachtleben: Im Pink Static übernahm gestern ein Gast das DJ-Pult. Die Tanzfläche bestätigt: Es war laut.',
  },
  {
    id: 'E58', key: 'gang_dance_battle', title: 'Tanzwettbewerb der Gangs', district: 'ocean_strip', size: 'big', venue: 'club',
    when: { parts: ['evening', 'night'], gangInfluence: { gang: 'neon', min: 10 } },
    weight: 5, cooldown: 150, needs: ['nightclub', 'dance_floor'],
    roles: [
      npc('neon', 'gang_turf', 'Neon-Syndicate-Crew', [3, 4]), npc('rivals', 'partygoer', 'Rivalisierende Crew „Tide Breakers“ (Marlin Club)', [3, 4]),
      npc('host', 'partygoer', 'Ansagerin mit Megafon'), npc('crowd', 'partygoer', 'Publikum im Kreis', [12, 24]),
    ],
    phases: [
      phase('challenge', [8, 12], {
        actions: [act('neon', 'Point'), act('rivals', 'Scold'), act('crowd', 'Watch', 'gather', 'host')],
        lines: [shout('neon', 'Tide Breakers! Eure Moves sind so alt wie euer Yacht-Club!', 1), shout('rivals', 'Große Worte für Leute in Glitzerjacken.', 5), shout('host', 'DANCE-BATTLE! Wer tritt für wen an?', 9)],
      }),
      phase('battle', [45, 70], {
        actions: [act('neon', 'Dance4'), act('rivals', 'Dance2'), act('crowd', 'Cheer')],
        lines: [shout('crowd', 'OOOOH!', 6), say('host', 'Das war … ein Move. Glaube ich.', 20), shout('crowd', 'NOCHMAL! NOCHMAL!', 35)],
      }),
    ],
    interventions: [
      { id: 'for_neon', label: 'Für das Neon Syndicate antreten (Dance-Battle)', detect: { kind: 'venue_game', game: 'dance_battle', side: 'neon', minRank: 'B' }, phases: ['challenge', 'battle'], outcome: 'neon_wins' },
      { id: 'for_rivals', label: 'Für die Tide Breakers (Marlin Club) antreten', detect: { kind: 'venue_game', game: 'dance_battle', side: 'marlin', minRank: 'B' }, phases: ['challenge', 'battle'], outcome: 'rivals_win' },
    ],
    outcomes: {
      neon_wins: { label: 'Neon Syndicate gewinnt das Battle', money: 400, xp: 120, rep: [{ gang: 'neon', delta: 6 }, { gang: 'marlin', delta: -4 }], fame: 4,
        lines: [gang('neon', 'Das ist UNSER Floor. Merkt euch das Gesicht.'), shout('crowd', 'Der Typ hat MOVES!')] },
      rivals_win: { label: 'Tide Breakers gewinnen das Battle', money: 400, xp: 120, rep: [{ gang: 'marlin', delta: 6 }, { gang: 'neon', delta: -6 }], fame: 4, hostile: true,
        lines: [shout('rivals', 'Ahoi, Neon! Schöne Grüße vom Meer!'), gang('neon', 'Du tanzt hier nie wieder umsonst.')] },
      ignored: { label: 'Die Crews tanzen es unter sich aus', mood: { gang: 2 } },
    },
    rumor: { text: 'Dance-Battle im Pink Static: {player} hat für {gang} getanzt. Die Verlierer üben angeblich schon heimlich.', spread: 'zone', heat: 0.6 },
    radio: 'Szene-News: Im Pink Static entschied ein Dance-Battle über die Ehre zweier Crews. Verletzte: keine. Bandscheiben: einige.',
  },
  {
    id: 'E59', key: 'vip_drama', title: 'VIP-Drama', district: 'ocean_strip', size: 'small', venue: 'club',
    when: { parts: ['evening', 'night'] },
    weight: 7, cooldown: 60, needs: ['nightclub', 'vip_area'],
    roles: [npc('influencer', 'partygoer', 'Influencer mit Ringlicht'), npc('bouncer', 'local', 'Mo, Türsteherin am VIP-Aufgang (Big Teos Schwester)'), npc('fans', 'partygoer', 'Follower mit Handys', [2, 4])],
    phases: [
      phase('argue', [20, 30], {
        actions: [act('influencer', 'Scold', 'goto', 'bouncer'), act('fans', 'Film'), act('bouncer', 'Lean')],
        lines: [shout('influencer', 'Weißt du, wer ich BIN?', 1), say('bouncer', 'Ein Mensch ohne Armband.', 4), say('influencer', 'Ich hab 400.000 Follower!', 8), say('bouncer', 'Die können gern draußen warten. Alle.', 11), whisper('fans', 'Läuft das live? Bitte sag, dass das live läuft.', 16)],
      }),
      phase('exit', [6, 10], { actions: [act('influencer', 'Phone', 'goto')], lines: [say('influencer', 'Ich mach ein Video über diesen Laden. Ein BÖSES.')] }),
    ],
    interventions: [
      { id: 'vip_guest', label: 'Als VIP-Gast den Influencer mitnehmen (Ruf ≥ 60 oder VIP-Karte)', detect: { kind: 'approach', radius: 3, target: 'influencer', onFoot: true }, gate: { rep: { gang: 'neon', min: 60 } }, outcome: 'plus_one' },
      { id: 'back_mo', label: 'Mo den Rücken stärken (Daumen hoch: /jubeln)', detect: { kind: 'emote', radius: 5, emote: 'cheer' }, outcome: 'mo_backup' },
    ],
    outcomes: {
      plus_one: { label: 'Influencer kommt als dein Gast rein – und taggt dich', xp: 40, fame: 6, regular: { id: 'bouncer', delta: -3 },
        lines: [say('influencer', 'OMG, du bist ja voll wichtig!'), say('bouncer', 'Einmal. Ein einziges Mal.')] },
      mo_backup: { label: 'Mo nickt dir zu', xp: 20, regular: { id: 'bouncer', delta: 8 }, lines: [say('bouncer', 'Respekt. Du darfst ab jetzt die Schuhe anbehalten.')] },
      ignored: { label: 'Influencer zieht beleidigt ab' },
    },
    rumor: { text: 'Ein Influencer wollte ohne Liste in den VIP des Pink Static. Mo: unbeeindruckt.', spread: 'district', heat: 0.3 },
  },
  {
    id: 'E60', key: 'fire_alarm', title: 'Feueralarm', district: 'ocean_strip', size: 'big', venue: 'club',
    when: { parts: ['evening', 'night'] },
    weight: 3, cooldown: 240, needs: ['nightclub'],
    roles: [
      prop('fog', 'fog_machine', 'Übermotivierte Nebelmaschine'), npc('crowd', 'partygoer', 'Partygäste', [15, 40]), npc('dj', 'partygoer', 'DJ Lux mit mobiler Box'),
      npc('fire', 'worker', 'Feuerwehr (gelangweilt)', [2, 3]),
    ],
    phases: [
      phase('fog', [5, 8], { physics: [{ kind: 'fog', role: 'fog' }], lines: [sfx('fog', 'PFFFFFFSSSSHHH', 0.5), think('crowd', 'Ist das Absicht? Das sieht teuer aus.', 3)] }),
      phase('alarm', [6, 10], { physics: [{ kind: 'alarm' }, { kind: 'evacuate' }, { kind: 'music_stop' }], actions: [act('crowd', 'Panic', 'flee')], lines: [sfx('fog', 'BIMMEL BIMMEL BIMMEL', 0.3), shout('crowd', 'RAUS! Aber mit Stil!', 2)] }),
      phase('street_party', [40, 60], {
        actions: [act('crowd', 'Dance', 'gather', 'dj'), act('dj', 'DJ'), act('fire', 'Look', 'goto')],
        lines: [shout('dj', 'Wenn der Club brennt, tanzen wir eben DRAUSSEN!', 2), say('fire', 'Kein Feuer. Nur Nebel. Sehr viel Nebel.', 20), shout('crowd', 'FEUERWEHR! FEUERWEHR!', 28)],
      }),
      phase('all_clear', [6, 8], { physics: [{ kind: 'music_start' }], lines: [say('fire', 'Entwarnung. Und stellt das Ding leiser.')] }),
    ],
    interventions: [
      { id: 'dance_outside', label: 'Draußen mittanzen', detect: { kind: 'emote', radius: 12, emote: 'dance' }, phases: ['street_party'], outcome: 'street_vibes' },
    ],
    outcomes: {
      street_vibes: { label: 'Bester Feueralarm aller Zeiten', xp: 35, mood: { safety: 1 }, regular: { id: 'os_dj_lux', delta: 6 } },
      ignored: { label: 'Gäste gehen nach der Entwarnung wieder rein' },
    },
    rumor: { text: 'Feueralarm im Pink Static – die Party ging einfach auf der Straße weiter. Die Feuerwehr hat mitgewippt.', spread: 'zone', heat: 0.5 },
    radio: 'Einsatzbericht: Feueralarm am Ocean Strip. Ursache: Nebelmaschine auf Stufe „Weltuntergang“. Keine Verletzten, viele Selfies.',
  },
  // ------------------------------------------------------------------ Casino „Palm Royale“
  {
    id: 'E61', key: 'lucky_granny', title: 'Die Glücksbringer-Oma', district: 'ocean_strip', size: 'small', venue: 'casino',
    when: {},
    weight: 7, cooldown: 60, needs: ['casino', 'slot_hall'],
    roles: [npc('oma', 'retiree', 'Oma Dolores mit Glücksbringer'), npc('crowd', 'tourist', 'Schaulustige', [4, 9]), npc('buyer', 'businessman', 'Mann, der den Glücksbringer kaufen will'), prop('charm', 'lucky_charm', 'Kleine Dose „Glücksbringer“')],
    phases: [
      phase('streak', [15, 22], {
        actions: [act('oma', 'Slot'), act('crowd', 'Watch', 'gather', 'oma')],
        lines: [sfx('oma', 'KLING-KLING-KLING!', 1), sfx('oma', 'KLING-KLING-KLING!', 6), shout('crowd', 'DREI MAL HINTEREINANDER?!', 11)],
      }),
      phase('offer', [15, 25], {
        actions: [act('buyer', 'Talk', 'goto', 'oma'), act('oma', 'Talk')],
        lines: [say('buyer', 'Ich kaufe Ihnen das Ding ab. Sagen Sie einen Preis.', 1), say('oma', 'Das ist mein Mann. Also, seine Asche.', 5), say('oma', 'Nein, Scherz, es ist Badesalz.', 9), say('buyer', '…Ich nehme es trotzdem.', 13)],
      }),
    ],
    interventions: [
      { id: 'protect', label: 'Der Oma beistehen (Käufer abwimmeln)', detect: { kind: 'approach', radius: 2.5, target: 'buyer', onFoot: true }, phases: ['offer'], outcome: 'granny_grateful' },
    ],
    outcomes: {
      granny_grateful: { label: 'Oma Dolores schenkt dir ein Badesalz-Säckchen', xp: 30, items: ['lucky_salt'], lines: [say('oma', 'Für dich, Schätzchen. Wirkt aber nur dienstags.')] },
      ignored: { label: 'Der Käufer zahlt 300 $ für Badesalz' },
    },
    rumor: { text: 'Im Palm Royale hat eine Oma dreimal hintereinander gewonnen. Ihr Glücksbringer: Badesalz. Die Badesalz-Preise steigen.', spread: 'district', heat: 0.35 },
  },
  {
    id: 'E62', key: 'system_player', title: 'Der Systemspieler', district: 'ocean_strip', size: 'small', venue: 'casino',
    when: {},
    weight: 7, cooldown: 60, needs: ['casino', 'card_table'],
    roles: [npc('system', 'businessman', 'Systemspieler mit Notizblock'), npc('croupier', 'local', 'Croupière Margot'), npc('table', 'tourist', 'Mitspieler', [2, 4]), prop('pad', 'notepad', 'Notizblock voller Pfeile')],
    phases: [
      phase('lecture', [15, 20], {
        actions: [act('system', 'Talk'), act('table', 'Watch')],
        lines: [say('system', 'Mein System ist todsicher. Ich verdopple einfach, bis ich gewinne.', 1), say('table', 'Und wenn das Geld ausgeht?', 6), say('system', 'Dann hab ich statistisch VERLOREN, ganz einfach.', 10)],
      }),
      phase('spins', [20, 30], {
        actions: [act('croupier', 'Deal'), act('system', 'Scold')],
        lines: [shout('system', 'Statistisch MUSS jetzt Rot kommen!', 2), say('croupier', 'Schwarz.', 6), shout('system', 'ROT! JETZT!', 12), say('croupier', 'Schwarz.', 16), symbol('system', '📉', 20)],
      }),
    ],
    interventions: [
      { id: 'advice', label: 'Ihm den Hausvorteil erklären', detect: { kind: 'approach', radius: 2.5, target: 'system', onFoot: true }, outcome: 'enlightened' },
    ],
    outcomes: {
      enlightened: { label: 'Er zerreißt den Notizblock', xp: 25, lines: [say('system', 'Moment … das Haus gewinnt IMMER? Wer hat sich das ausgedacht?'), say('croupier', 'Die Bank dankt trotzdem.')] },
      ignored: { label: 'Er geht mit leeren Taschen und vollem Notizblock' },
    },
    rumor: { text: 'Ein Systemspieler im Palm Royale hat bewiesen, dass sein System funktioniert – für das Casino.', spread: 'district', heat: 0.3 },
  },
  {
    id: 'E63', key: 'vault_false_alarm', title: 'Falscher Alarm im Tresor', district: 'ocean_strip', size: 'big', venue: 'casino',
    when: {},
    weight: 4, cooldown: 180, needs: ['casino', 'vault'],
    roles: [npc('guards', 'worker', 'Sicherheitsleute', [3, 4]), npc('guests', 'tourist', 'Gäste', [8, 16]), npc('manager', 'businessman', 'Schichtleiter')],
    phases: [
      phase('alarm', [6, 8], { physics: [{ kind: 'alarm' }, { kind: 'lights_out' }], actions: [act('guards', undefined, 'dash'), act('guests', 'Panic', 'flee')], lines: [sfx('guards', 'WIIIUU WIIIUU', 0.3), shout('guards', 'Einbruch im Tresor! Alle Ausgänge sichern!', 1.5), shout('guests', 'Meine Chips! MEINE CHIPS!', 4)] }),
      phase('search', [15, 25], { actions: [act('guards', 'Search'), act('manager', 'Call')], lines: [whisper('guards', 'Da raschelt was im Lüftungsschacht …', 3), say('manager', 'Niemand verlässt das Gebäude! Außer durch den Ausgang!', 8)] }),
      phase('raccoon', [8, 12], { physics: [{ kind: 'lights_on' }], actions: [act('guards', 'Point'), act('guests', 'Look')], lines: [sfx('guards', '*Waschbär-Fauchen*', 1), say('manager', 'Ein … Waschbär. Mit einem Chip im Maul.', 4), say('guards', 'Sollen wir ihn festnehmen?', 7)] }),
    ],
    interventions: [
      { id: 'catch_raccoon', label: 'Den Waschbären einfangen (E halten im Lüftungsgang)', detect: { kind: 'interact', target: 'guards', hold: 2 }, phases: ['search'], outcome: 'hero' },
    ],
    outcomes: {
      hero: { label: 'Waschbär gefangen: Belohnung vom Schichtleiter', money: 500, xp: 60, lines: [say('manager', 'Er hatte 3 Chips und einen Kugelschreiber. Danke!')] },
      ignored: { label: 'Der Waschbär entkommt mit einem Chip', traces: [{ kind: 'paper_litter', minutes: 10 }] },
    },
    rumor: { text: 'Großalarm im Palm Royale – Täter: ein Waschbär. Er ist noch flüchtig. Und um 25 $ reicher.', spread: 'zone', heat: 0.55 },
    radio: 'Polizeimeldung: Einbruchsalarm im Palm Royale. Tatverdächtig ist ein Waschbär. Er gilt als bewaffnet mit Niedlichkeit.',
  },
  {
    id: 'E64', key: 'jackpot_hysteria', title: 'Jackpot-Hysterie', district: 'ocean_strip', size: 'big', venue: 'casino',
    when: {},
    weight: 2, cooldown: 300, needs: ['casino', 'slot_hall'],
    roles: [npc('winner', 'tourist', 'Glücklicher Gewinner'), npc('crowd', 'tourist', 'Jubelnde Menge', [8, 20]), npc('staff', 'worker', 'Casino-Personal mit Riesenscheck'), prop('confetti', 'confetti', 'Konfetti-Kanonen')],
    phases: [
      phase('jackpot', [8, 10], { physics: [{ kind: 'confetti', role: 'confetti' }, { kind: 'alarm' }], actions: [act('winner', 'Cheer'), act('crowd', 'Cheer', 'gather', 'winner')], lines: [sfx('winner', '★ JACKPOT ★ JACKPOT ★', 0.3), shout('winner', 'ICH HAB GEWONNEN! ICH! HAB!', 2), shout('crowd', 'WAHNSINN!', 5)] }),
      phase('faint', [10, 14], { actions: [act('winner', 'Faint'), act('crowd', 'Look'), act('staff', 'Talk', 'goto', 'winner')], lines: [sfx('winner', '*plumps*', 0.5), say('staff', 'Hat jemand Riechsalz? Oder einen zweiten Scheck?', 4)] }),
      phase('wake', [6, 8], { actions: [act('winner', 'Cheer')], lines: [say('winner', 'Bin ich im Fernsehen? Ist das die Kamera? Ich sehe GUT aus, oder?', 1)] }),
    ],
    interventions: [{ id: 'cheer', label: 'Mitjubeln', detect: { kind: 'emote', radius: 8, emote: 'cheer' }, outcome: 'party' }],
    outcomes: { party: { label: 'Der Gewinner spendiert eine Runde', xp: 20, health: 'full' }, ignored: { label: 'Der Gewinner wird mit Riesenscheck hinausbegleitet', traces: [{ kind: 'confetti_heap', minutes: 15 }] } },
    rumor: { text: 'Jackpot im Palm Royale! Der Gewinner ist vor Glück umgekippt – und wieder aufgewacht, als die Kamera kam.', spread: 'city', heat: 0.7 },
    radio: 'Glückwunsch aus dem Palm Royale: Der progressive Jackpot wurde geknackt. Der Gewinner war kurz ohnmächtig, aber gut frisiert.',
  },
];
