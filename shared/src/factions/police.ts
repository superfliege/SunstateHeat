import type { PoliceProfile } from './types';

export const POLICE: PoliceProfile = {
  name: 'Palmara Coastal Police (PCP)',
  motto: 'Wachsam wie der Pelikan.',
  selfImage: 'Unterbesetzt, überlastet, mit einem Wappen-Pelikan, der mehr Respekt bekommt als die Beamten.',
  chief: {
    id: 'police_chief', name: 'Captain Gloria Pelham', role: 'Revierleiterin Downtown',
    personality: 'Resolut, ironisch, seit 25 Jahren im Dienst und seit 24 Jahren müde. Will nur bis zur Pension keine Yacht mehr in einem Steg sehen.',
    quirk: 'Trinkt Kaffee aus einer Tasse mit der Aufschrift „Weltbeste Captain (laut mir)“.',
    look: 'Gebügelte Uniform, Lesebrille, Funkgerät mit Pelikan-Aufkleber.',
    haunt: 'Polizeihauptquartier Downtown', catchphrase: 'Ich habe zwei Wochen bis zum Urlaub. Machen Sie mir das nicht kaputt.',
  },
  officers: [
    {
      id: 'police_officer_dale', name: 'Officer Dale Brinkley', role: 'Streifenpolizist Ocean Strip',
      personality: 'Gutmütig, naiv, lässt sich von Touristen ständig nach dem Weg fragen und erklärt ihn falsch.',
      quirk: 'Fährt Segway, auch wenn es bergauf nicht funktioniert.',
      look: 'Kurze Uniformhose, Sonnenbrand im Nacken.',
      haunt: 'Promenade am Ocean Strip', catchphrase: 'Bitte weitergehen, hier gibt es nichts zu … oh, ein Delfin!',
    },
    {
      id: 'police_officer_reyes', name: 'Sergeant Nora Reyes', role: 'Verkehrsstaffel Route 41',
      personality: 'Gnadenlos korrekt, hat eine Radarpistole und benutzt sie wie ein Westernheld.',
      quirk: 'Pustet nach jeder Messung über die Radarpistole.',
      look: 'Motorradhelm unterm Arm, verspiegelte Brille.',
      haunt: 'Kreuzung Route 41 / Northgate', catchphrase: 'Sie waren schnell. Ich war schneller.',
    },
  ],
  expressions: ['Bitte weitergehen.', 'Haben Sie hier was gesehen? Nein? Gut, wir auch nicht.', 'Das gibt Papierkram. VIEL Papierkram.'],
  presence: { downtown: 70, ocean_strip: 55, brickell_hills: 65, little_havana: 40, port_district: 35, northgate: 30, coral_keys: 40, gator_flats: 15, okeefield: 25 },
  relations: {
    neon: { kind: 'business', value: 10, note: 'Offiziell Feinde; inoffiziell auffällig viele neue Dienstwagen in Weiß.' },
    marlin: { kind: 'business', value: 20, note: 'Ehrenmitgliedschaften und Gratis-Anlegeplätze für Führungskräfte.' },
    mangrove: { kind: 'rivalry', value: -40, note: 'Jede Razzia im Sumpf endet mit nassen Stiefeln und leeren Händen.' },
    dustline: { kind: 'rivalry', value: -20, note: 'Die Trucker funken jede Radarfalle durch.' },
  },
  sampleLines: [
    'Bitte zurücktreten, das ist ein Tatort. Oder eine Möwe. Wir prüfen das noch.',
    'Führerschein, Fahrzeugschein und eine gute Ausrede, bitte.',
    'Ich bin nicht langsam, ich bin gründlich.',
    'Wir haben Verstärkung angefordert. Die steht im Stau.',
  ],
};
