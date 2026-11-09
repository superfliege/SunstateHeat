// Straßenereignisse Brickell Hills (E23–E26).
import { act, animal, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const BRICKELL_HILLS_EVENTS: StreetEventDef[] = [
  {
    id: 'E23', key: 'luxury_poodle', title: 'Entlaufener Luxus-Pudel', district: 'brickell_hills', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 150, needs: ['road', 'garden'],
    roles: [animal('fluffington', 'poodle', 'Monsieur Fluffington (Designermantel)'), npc('butler', 'businessman', 'Butler im Frack')],
    phases: [
      phase('chase', [25, 35], {
        actions: [act('fluffington', undefined, 'flee'), act('butler', 'Panic', 'chase', 'fluffington')],
        lines: [shout('butler', "Monsieur Fluffington! Bitte! Ihr Termin beim Pfotenpfleger!", 1), say('fluffington', "Wuff.", 6), say('butler', "Ich bin zu alt für Gärten…", 14), think('fluffington', "Freiheit… und ein Rosenbeet.", 20)],
      }),
      phase('give_up', [4, 5], { actions: [act('butler', 'Phone')], lines: [say('butler', "Madame? Wir haben ein… kleines Problem.")] }),
    ],
    interventions: [{ id: 'catch', label: 'Pudel fangen (flitzt durch Gärten)', detect: { kind: 'catch', target: 'fluffington', hold: 1.5, evasive: true }, phases: ['chase'], outcome: 'caught' }],
    outcomes: {
      caught: { label: 'Butler zahlt „im Namen der Herrschaften“', money: 1000, xp: 40,
        lines: [say('butler', "Im Namen der Herrschaften: Ihre Diskretion wird geschätzt. Und belohnt.")], rumor: 'Jemand hat Monsieur Fluffington gerettet – {player}, sagt man.' },
      ignored: { label: 'Pudel macht Gartenrundgang' },
    },
    rumor: { text: 'Jemand hat Monsieur Fluffington gerettet.', spread: 'zone', heat: 0.35 },
  },
  {
    id: 'E24', key: 'hedge_war', title: 'Der Heckenkrieg', district: 'brickell_hills', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 8, cooldown: 150, needs: ['hedge', 'villa'],
    roles: [npc('ownerA', 'businessman', 'Villenbesitzer Thornton'), npc('ownerB', 'retiree', 'Villenbesitzerin Vanderbelt'), npc('gardener', 'worker', 'Gärtner mit Heckenschere'), prop('hedge', 'hedge_trimmer', 'Heckenschere')],
    phases: [
      phase('feud', [18, 24], {
        actions: [act('ownerA', 'Phone'), act('ownerB', 'Phone'), act('gardener', 'Wait')],
        lines: [shout('ownerB', "Das ist MEIN Schatten!", 1), shout('ownerA', "Mein Anwalt hat einen Anwalt!", 5), say('ownerB', "Meiner hat ein Boot!", 9), say('gardener', "Ich werde stündlich bezahlt, ich hab Zeit.", 13)],
      }),
      phase('stalemate', [5, 6], { lines: [say('ownerA', "Bis Montag. Dann klagen wir. Über den Montag.")] }),
    ],
    interventions: [{ id: 'drive', label: 'Durch die Hecke fahren', detect: { kind: 'drive_through', radius: 3, target: 'hedge' }, outcome: 'police' }],
    outcomes: {
      police: { label: 'Beide verbünden sich und rufen die Polizei', wanted: 1, mood: { safety: -2 },
        lines: [shout('ownerA', "Margaret! Er hat UNSERE Hecke…"), shout('ownerB', "Ich rufe sofort an! Gemeinsam, Harold!")] },
      ignored: { label: 'Anwälte verdienen weiter' },
    },
    rumor: { text: 'In Brickell Hills tobt seit Wochen ein Heckenkrieg. Der Gärtner hat sich ein Boot gekauft.', spread: 'district', heat: 0.2 },
  },
  {
    id: 'E25', key: 'golf_hail', title: 'Golfball-Hagel', district: 'brickell_hills', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 7, cooldown: 150, needs: ['golf', 'road'],
    roles: [npc('golfer', 'retiree', 'Golfer Kevin'), npc('caddy', 'worker', 'Caddie'), veh('cars', 'car', 'Getroffene Autos', [2, 3]), npc('drivers', 'local', 'Schimpfende Fahrer', [1, 2]), prop('balls', 'golf_ball', 'Golfbälle', [6, 12])],
    phases: [
      phase('hail', [16, 22], {
        actions: [act('golfer', 'Hoop'), act('drivers', 'Scold')],
        lines: [shout('golfer', "FORE!", 1), shout('drivers', "Was heißt FORE?!", 4), shout('caddy', "Das heißt ‚Kopf runter‘, Kevin!", 7), sfx('cars', "PLONK! DONK!", 10)],
        physics: [{ kind: 'projectiles', prop: 'golf_ball', count: 8, damage: 3, radius: 25 }],
      }),
      phase('shrug', [4, 5], { lines: [say('golfer', "Die Straße ist technisch gesehen ein sehr langes Fairway.")] }),
    ],
    interventions: [{ id: 'confront', label: 'Golfer zur Rede stellen', detect: { kind: 'approach', radius: 3, target: 'golfer', onFoot: true }, outcome: 'hush' }],
    outcomes: {
      hush: { label: 'Schweigegeld', money: 300, lines: [say('golfer', "Hier. Dreihundert. Wir haben uns nie gesehen. Fore.")] },
      ignored: { label: 'Dellen in Autos' },
    },
    rumor: { text: 'In Brickell Hills regnet es Golfbälle. Die Versicherungen nennen es „Wetter“.', spread: 'district', heat: 0.25 },
  },
  {
    id: 'E26', key: 'garden_party_mishap', title: 'Gartenparty-Panne', district: 'brickell_hills', size: 'big',
    when: { parts: ['evening'] },
    weight: 6, cooldown: 240, needs: ['villa', 'garden'],
    roles: [
      prop('fountain', 'champagne_fountain', 'Champagnerbrunnen'), npc('waiter', 'worker', 'Kellner'), prop('cake', 'cake_tower', 'Tortenturm'),
      npc('host', 'businessman', 'Gastgeberin'), npc('guests', 'partygoer', 'Elegante Gäste', [4, 6]), prop('buffet', 'buffet', 'Buffet'),
    ],
    phases: [
      phase('overflow', [8, 10], { actions: [act('guests', 'Drink')], physics: [{ kind: 'foam', role: 'fountain', radius: 4 }], lines: [say('guests', "Ist das… Absicht?"), sfx('fountain', "BLUBB-BLUBB-SPRUDEL", 4)] }),
      phase('slip', [5, 6], { actions: [act('waiter', 'Flinch', 'fall')], physics: [{ kind: 'tip_over', role: 'cake' }], lines: [sfx('cake', "SPLOTSCH!"), shout('host', "Die Torte war ein KUNSTWERK!", 2)] }),
      phase('mingle', [20, 30], { actions: [act('guests', 'Talk')], lines: [say('guests', "Ich fand es expressiv."), say('guests', "Sehr postmodern. Torte auf Rasen.", 6)] }),
    ],
    interventions: [
      { id: 'sneak', label: 'Im passenden Outfit einschleichen (Buffet)', detect: { kind: 'enter_area', place: 'garden', outfit: 'formal' }, gate: { outfit: 'formal' }, outcome: 'feast' },
      { id: 'sneak_bad', label: 'Im falschen Outfit einschleichen', detect: { kind: 'enter_area', place: 'garden', outfit: 'any' }, gate: { outfit: 'casual' }, outcome: 'kicked' },
    ],
    outcomes: {
      feast: { label: 'Gratis-Essen', health: 'full', xp: 20, lines: [say('host', "Ah, Sie sind sicher von der Galerie! Kaviar?")] },
      kicked: { label: 'Rauswurf', lines: [shout('host', "Security! Da ist jemand in… KURZEN HOSEN!")] },
      ignored: { label: 'Party geht weiter, Torte bleibt Kunst' },
    },
    rumor: { text: 'Auf einer Gartenparty in Brickell Hills ist der Tortenturm umgefallen. Die Gäste nennen es Performance-Kunst.', spread: 'zone', heat: 0.3 },
  },
];
