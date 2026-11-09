// Straßenereignisse „überall“ – Wetter & Stadt (E43–E45).
import { act, npc, phase, prop, say, sfx, shout, think, veh, type StreetEventDef } from './schema';

export const ANYWHERE_EVENTS: StreetEventDef[] = [
  {
    id: 'E43', key: 'rain_panic', title: 'Regen-Panik', district: 'anywhere', size: 'small',
    when: { weather: ['rain_start'] },
    weight: 12, cooldown: 60, needs: ['sidewalk', 'awning'],
    roles: [npc('crowd', 'local', 'Flüchtende Passanten', [5, 8]), npc('dancer', 'partygoer', 'Tänzer im Regen'), prop('awning', 'umbrella', 'Markise / Bushaltestelle')],
    phases: [
      phase('rush', [6, 8], { actions: [act('crowd', 'Panic', 'gather', 'awning')], lines: [shout('crowd', "Es war doch eben noch Sonne!"), say('crowd', "Florida halt.", 4)] }),
      phase('squeeze', [16, 22], {
        actions: [act('crowd', 'Wait'), act('dancer', 'Dance', 'wander')],
        lines: [say('dancer', "Endlich ist die Straße frei!", 2), think('crowd', "Warum hab ich keinen Schirm…", 9), say('crowd', "Ihr Ellbogen ist in meiner Tasche.", 14)],
      }),
    ],
    interventions: [{ id: 'dance', label: 'Mit dem Tänzer im Regen tanzen (Emote)', detect: { kind: 'emote', radius: 6, emote: 'dance' }, outcome: 'duet' }],
    outcomes: {
      duet: { label: 'Regentanz-Duett', xp: 20, fame: 1, lines: [say('dancer', "Endlich jemand mit Stil!"), say('crowd', "…Die sind verrückt. Ich film das.", 3)] },
      ignored: { label: 'Alle warten, bis es aufhört' },
    },
    rumor: { text: 'Bei {district} hat einer im Regen getanzt, während alle anderen unter einer Markise gestapelt standen.', spread: 'district', heat: 0.1 },
  },
  {
    id: 'E44', key: 'blackout', title: 'Stromausfall', district: 'anywhere', size: 'big',
    when: { parts: ['night'] },
    weight: 2, cooldown: 600, needs: ['main_road', 'power_box'],
    roles: [npc('crowd', 'local', 'Leute mit Handylampen', [4, 8]), npc('shopkeeper', 'vendor', 'Ladenbesitzerin'), prop('box', 'fuse_box', 'Verteilerkasten'), veh('cars', 'car', 'Chaos an der Kreuzung', [3, 5]), prop('lights', 'phone_light', 'Handylampen', [4, 8])],
    phases: [
      phase('out', [4, 5], { physics: [{ kind: 'lights_out', radius: 60 }], lines: [sfx('box', "KZZT – PFFF"), shout('crowd', "Wer hat das Licht ausgemacht?!", 2)] }),
      phase('chaos', [40, 60], {
        actions: [act('crowd', 'Phone', 'wander')],
        physics: [{ kind: 'traffic_jam', radius: 40 }],
        lines: [say('shopkeeper', "Mein Laden ist gerade ROMANTISCH geworden.", 3), shout('crowd', "Die Ampel blinkt gelb! Wer hat Vorfahrt?!", 12), say('crowd', "Ich. Nein, ich. Wir beide?", 20)],
      }),
      phase('restore', [5, 6], { physics: [{ kind: 'lights_on', radius: 60 }], lines: [say('crowd', "Ah. Da ist es wieder.")] }),
    ],
    interventions: [{ id: 'repair', label: 'Verteilerkasten reparieren', detect: { kind: 'interact', target: 'box', hold: 5 }, phases: ['chaos'], outcome: 'fixed' }],
    outcomes: {
      fixed: { label: 'Licht geht mit Jubel wieder an', xp: 60, mood: { safety: 6 }, fame: 2, lines: [shout('crowd', "JAAAA! LICHT!"), say('shopkeeper', "Schade eigentlich. Aber danke!")] },
      ignored: { label: 'Stadtwerke reparieren irgendwann' },
    },
    rumor: { text: 'Stromausfall in {district}! Die Kreuzung war eine Stunde lang ein Abenteuerspielplatz.', spread: 'zone', heat: 0.5 },
    radio: 'Die Stadtwerke Palmara melden einen Stromausfall in {district}. Ursache laut Pressestelle: „Kabel“.',
  },
  {
    // Hinweis: Die Beschreibung in der Aufgabe brach bei „Steh…“ ab – Rest im Sinne des Tons ergänzt.
    id: 'E45', key: 'slowest_chase', title: 'Die Langsamste Verfolgung', district: 'anywhere', size: 'small',
    when: { parts: ['morning', 'noon', 'afternoon'] },
    weight: 7, cooldown: 150, needs: ['sidewalk'],
    roles: [
      npc('thief', 'local', 'Taschendieb auf Leih-Scooter'), veh('scooter', 'scooter', 'Leih-Scooter', undefined, 'thief'),
      npc('cop', 'police', 'Polizist auf Segway'), veh('segway', 'segway', 'Segway', undefined, 'cop'), npc('victim', 'tourist', 'Bestohlene Touristin'), npc('passerby', 'retiree', 'Überholender Rentner'),
    ],
    phases: [
      phase('chase', [24, 32], {
        actions: [act('thief', undefined, 'flee'), act('cop', undefined, 'chase', 'thief'), act('victim', 'Point'), act('passerby', undefined, 'follow', 'cop')],
        lines: [shout('cop', "Stehen bleiben! …Bitte?", 1), shout('thief', "Ich fahre schon Vollgas! Das IST Vollgas!", 6), shout('victim', "Meine Tasche!", 10), say('passerby', "Darf ich mal vorbei? Ich hab einen Arzttermin.", 16), think('cop', "Akku 12 %. Bitte nicht jetzt.", 22)],
      }),
      phase('battery', [5, 6], { lines: [sfx('scooter', "PIEP – Akku leer"), say('thief', "…Okay. Ich ergebe mich. Aus Erschöpfung.", 2)] }),
    ],
    interventions: [{ id: 'stop', label: 'Den Dieb zu Fuß einholen und stoppen', detect: { kind: 'block_path', target: 'thief', radius: 1.5 }, phases: ['chase'], outcome: 'caught' }],
    outcomes: {
      caught: { label: 'Tasche zurück, Polizist bedankt sich', money: 80, xp: 30, mood: { safety: 2 }, lines: [say('cop', "Danke, Bürger! Ich hätte ihn gleich gehabt. In etwa 40 Minuten.")] },
      ignored: { label: 'Akku entscheidet die Verfolgung' },
    },
    rumor: { text: 'Die langsamste Verfolgungsjagd Palmaras: Scooter gegen Segway, gewonnen hat ein Rentner zu Fuß.', spread: 'zone', heat: 0.35 },
    radio: 'Polizeibericht: Verfolgungsjagd mit 9 km/h erfolgreich beendet. Der Akku des Verdächtigen hat gestanden.',
  },
];
