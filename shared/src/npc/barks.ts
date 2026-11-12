// Barks (Schritt 5): kurze Sprüche als Comic-Sprechblase über dem Kopf. Datengetrieben pro Situation
// und Archetyp ('*' = alle), mehrere Varianten, satirischer Ton (spec 1.5). Der Server wählt Situation
// und Variante (Abklingzeit pro NPC, globale Obergrenze); über das Netz geht nur ['bark', pedId, sit, var],
// den Text sucht der Client hier mit demselben Archetyp heraus.
import { archetypeOf, type ArchetypeId } from './archetypes';

export const BARK_SITS = [
  'bumped', 'near_miss', 'car_stolen', 'rain', 'heat', 'police', 'greet', 'night_alone',
  'scold', 'gunfire', 'film', 'call', 'fear', 'wanted', 'idle', 'crash', 'intervene', 'dodge',
  // Tätigkeiten (Bark passend zu dem, was der NPC gerade tut) und Gang-Sprüche
  'act_phone', 'act_talk', 'act_eat', 'act_smoke', 'act_dance', 'act_fish', 'act_read', 'act_drink', 'act_wait', 'act_atm', 'act_photo', 'act_sit', 'act_busk', 'act_jog', 'gang',
] as const;
export type BarkSit = (typeof BARK_SITS)[number];
export const BARK_INDEX = Object.fromEntries(BARK_SITS.map((s, i) => [s, i])) as Record<BarkSit, number>;

type Lines = Partial<Record<ArchetypeId | '*', string[]>>;
export const BARKS: Record<BarkSit, Lines> = {
  bumped: {
    '*': ['Hey, pass doch auf!', 'Autsch! Augen auf!', 'Geht\'s noch?!', 'Der Gehweg ist breit genug!', 'Entschuldigung angenommen. Nicht.'],
    businessman: ['Wissen Sie, was dieser Anzug gekostet hat?', 'Mein Anwalt hört davon!'],
    tourist: ['Is this how Palmara says hello?', 'Steht das im Reiseführer?'],
    retiree: ['Zu meiner Zeit hat man sich entschuldigt!', 'Mein Hüftgelenk!'],
    jogger: ['Ich bin im Flow, Mann!', 'Meine Bestzeit!'],
    homeless: ['Ich wohn hier, Kumpel.'],
  },
  near_miss: {
    '*': ['Bist du blind?!', 'Das ist ein GEHweg!', 'Fast hätte es mich erwischt!', 'Rowdy!', 'Ich hab dein Kennzeichen!'],
    tourist: ['Mein Urlaub ist noch nicht vorbei!', 'Ist das hier Rechtsverkehr?!'],
    retiree: ['Ich ruf meinen Enkel an, der ist Anwalt!'],
    partygoer: ['Wow, voll der Adrenalinkick!'],
  },
  car_stolen: {
    '*': ['MEIN AUTO!', 'Das ist noch nicht abbezahlt!', 'Haltet den Dieb!', 'Die Versicherung glaubt mir das nie!'],
    businessman: ['Das ist ein Firmenwagen!'],
  },
  rain: { '*': ['Und das im Sunshine State…', 'Mein Haar!', 'Wo ist ein Vordach?', 'Der Wetterbericht lügt schon wieder.'] },
  heat: {
    '*': ['Heiß heute, was?', 'Ich schmelze…', 'Hat jemand Sonnencreme?', 'Wer hat die Sonne so hochgedreht?'],
    tourist: ['Ist das normal, diese Hitze?', 'Ich hätte nach Norden fliegen sollen.'],
    beachgoer: ['Perfektes Strandwetter!', 'Noch zwei Stunden, dann bin ich knusprig.'],
    jogger: ['Nur noch zehn Kilometer…'],
  },
  police: {
    '*': ['Oh, die Polizei.', 'Bloß nicht hinschauen…', 'Ich hab nichts gemacht!'],
    homeless: ['Die schon wieder.'],
    gang: ['Bullen! Locker bleiben.'],
    retiree: ['Endlich mal Polizei hier!'],
  },
  greet: {
    '*': ['Hi!', 'Schöner Tag, was?', 'Hallo!', 'Na, alles klar?'],
    tourist: ['Hello! Äh… Hallo!', 'Weißt du, wo der Strand ist?'],
    businessman: ['Keine Zeit, keine Zeit.', 'Kaufen Sie Aktien!'],
    vendor: ['Sonnenbrillen! Fast echt!', 'Tacos, Tacos, frische Tacos!'],
    retiree: ['Tag, junger Mensch.'],
    homeless: ['Haste mal nen Dollar?', 'Schönen Tag noch, Chef.'],
    dogwalker: ['Der beißt nicht. Meistens.', 'Er will nur spielen!'],
    jogger: ['Morgen!', 'Puh… hi!'],
    partygoer: ['Party heute?', 'Kommst du mit in den Club?'],
  },
  night_alone: { '*': ['Ist da wer?', 'Schnell nach Hause…', 'Hier ist es nachts unheimlich.', 'Nicht umdrehen, nicht umdrehen…'], partygoer: ['Wo sind die anderen hin?'] },
  scold: {
    '*': ['Unverschämtheit!', 'Was soll das?!', 'Benimm dich!', 'So was gehört verboten!', 'Typisch!'],
    retiree: ['Ich schreibe einen Leserbrief!', 'Früher gab\'s so was nicht!'],
    gang: ['Willst du Ärger?!', 'Pass auf, wo du hinfährst!'],
  },
  gunfire: { '*': ['Schüsse!', 'Runter!', 'Hilfe!', 'Lauft!', 'Nicht schon wieder!'], tourist: ['Das stand nicht im Prospekt!'], retiree: ['Mein Herz!'] },
  film: { '*': ['Das geht viral!', 'Das stell ich online!', 'Läuft die Kamera?', 'Hashtag Palmara!'], tourist: ['Das glaubt mir zu Hause keiner!'] },
  call: { '*': ['Hallo, Polizei?!', 'Ja, ich seh ihn genau!', 'Kommen Sie schnell!', 'Notruf? Es ist schon wieder passiert!'] },
  fear: { '*': ['Bleib weg von mir!', 'Der schon wieder…', 'Ich hab nichts gesehen!', 'Bitte nicht!'] },
  wanted: { '*': ['Da ist er! Den sucht die Polizei!', 'Das ist der aus den Nachrichten!', 'Hierher, Officer!', 'Der da war\'s!'] },
  idle: {
    '*': ['Wo hab ich nur mein Auto geparkt?', 'Was für ein Tag.', 'Die Mieten hier, unfassbar.', 'Noch ein Smoothie und ich platze.', 'Ich sollte echt mal Sport machen.'],
    businessman: ['Ja, verkaufen! Alles verkaufen!', 'Ich bin im Meeting. Am Strand.', 'Synergien, Baby!'],
    tourist: ['Wo ist hier das Hotel?', 'Noch ein Selfie!', 'Ist das ein echter Flamingo?'],
    beachgoer: ['Wellen sind heute top.', 'Noch fünf Minuten…', 'Ich hab Sand überall.'],
    partygoer: ['Der DJ ist der Wahnsinn!', 'Noch einen Drink!', 'Wer hat meine Jacke?'],
    retiree: ['Früher war hier alles Sumpf.', 'Die Möwen werden auch immer frecher.'],
    homeless: ['Ein Königreich für ein Sandwich.', 'Alles meins hier.'],
    vendor: ['Sonnenbrillen! Zwei für zehn!', 'Echte Designer-Ware! Ehrlich!'],
    jogger: ['Puls 180, Stimmung 100!', 'Nur noch eine Runde…'],
    dogwalker: ['Aus! Pfui! Nein!', 'Guter Junge!'],
    worker: ['Feierabend, endlich.', 'Wer hat den Bauplan verlegt?'],
    fisher: ['Heute beißen sie nicht.', 'Der war SO groß!'],
  },
  crash: { '*': ['Oh! Das hat gekracht!', 'Uff, Blechschaden!', 'Fahren lernt man hier wohl nicht.', 'Hat jemand die Nummer?'] },
  intervene: { '*': ['Hey! Lass das!', 'Hör sofort auf!', 'Ich hab schon die Polizei gerufen!', 'Nicht mit mir!'], gang: ['Das ist unser Revier!'] },
  dodge: { '*': ['Hoppla!', 'Wow, langsam!', 'Huch!'] },
  act_phone: { '*': ['Ja, ich bin gleich da!', 'Nein, DU hast aufgelegt!', 'Kannst du mich hören? Hallo?', 'Der Empfang hier ist furchtbar.', 'Ich ruf dich zurück!'], businessman: ['Wir telefonieren später, ich bin im Termin.'] },
  act_talk: { '*': ['Und dann sagt er zu mir…', 'Nein, echt jetzt?!', 'Das glaub ich dir nicht!', 'Haha, genau das meine ich!', 'Hast du das gehört?'] },
  act_eat: { '*': ['Mmh, die Tacos sind der Hammer!', 'Zu scharf. Mehr davon!', 'Noch eine Portion bitte.', 'Das tropft überall hin…'] },
  act_smoke: { '*': ['Nur eine, dann hör ich auf.', 'Die Pause muss sein.', 'Hat jemand Feuer?'] },
  act_dance: { '*': ['Yeah! Das ist mein Song!', 'Lauter!', 'Wuhuu!', 'Ich fühl den Beat!'], partygoer: ['Die Nacht ist jung!'] },
  act_fish: { '*': ['Komm schon, beiß an…', 'Da zuckt was!', 'Heute wird\'s ein Fang.', 'Psst, du verscheuchst sie!'], fisher: ['Der Große kommt gleich, ich spür\'s.'] },
  act_read: { '*': ['Interessant…', 'Schon wieder Politik.', 'Die Sportseite zuerst.', 'Das wird alles teurer.'] },
  act_drink: { '*': ['Ahh, genau das brauchte ich.', 'Auf dein Wohl!', 'Der Eistee ist Gold wert.'] },
  act_wait: { '*': ['Wo bleibt der Bus?', 'Der Fahrplan ist ein Märchen.', 'Zehn Minuten Verspätung. Wie immer.', 'Ich warte schon ewig.'] },
  act_atm: { '*': ['Wie viel?! Gestern war da noch mehr.', 'Bitte, bitte, spuck Geld aus.', 'Die Gebühren sind ein Witz.'] },
  act_photo: { '*': ['Warte, nochmal! Lächeln!', 'Das gibt ein tolles Bild.', 'Noch einen Schritt nach links!', 'Ist die Sonne zu grell?'] },
  act_sit: { '*': ['Ahh, endlich sitzen.', 'Schön hier in der Sonne.', 'Meine Füße…'] },
  act_busk: { '*': ['Danke fürs Zuhören!', 'Noch ein Lied!', 'Trinkgeld hilft der Kunst!'] },
  act_jog: { '*': ['Puh, noch ein Kilometer…', 'Fast geschafft!', 'Schneller, schneller!'] },
  gang: {
    '*': ['Das ist unser Block.', 'Was guckst du?', 'Wir haben hier das Sagen.', 'Verschwinde, wenn du Ärger meidest.', 'Jeder zahlt hier seinen Zoll.', 'Behalt die Straße im Auge.'],
  },
};

/** Welche Bark-Situation passt zu einer Tätigkeit (Act-ID aus npc/scenarios)? */
export const ACT_BARK: Record<number, BarkSit> = {
  1: 'act_sit', 4: 'act_phone', 5: 'act_smoke', 6: 'act_talk', 7: 'act_photo', 8: 'act_eat', 9: 'act_fish', 10: 'act_dance',
  11: 'act_busk', 14: 'act_read', 15: 'act_atm', 16: 'act_wait', 18: 'act_jog', 20: 'act_drink',
};

/** Variantenliste für Situation + Archetyp (Archetyp-Sprüche zuerst, dann allgemeine). */
/** Tierlaute statt Sprüchen (jede Situation). */
const ANIMAL_SOUNDS: Record<string, string[]> = {
  cow: ['Muh.', 'MUUUH!', 'Muh?', '…Muh.'], dairy_cow: ['Muuuh.', 'Muh!', '*kaut*'], horse: ['Wiiiehhh!', 'Pfrrr.', '*schnaubt*'],
  chicken: ['Gack!', 'GAGAGAGACK!', 'Pok pok.'], goat: ['Mäh.', 'MÄÄÄH!', '*kaut auf einem Plakat*'], dog: ['Wuff!', 'WUFF WUFF!', '*wedelt*'],
  deer: ['*hebt den Kopf*', '*springt*'], turkey: ['Kollerkoller!', 'Gobble!'],
};
/** Kurze Land-Sprüche (Begrüßen, Leerlauf) der Archetypen im Norden. */
const COUNTRY: Partial<Record<BarkSit, Lines>> = {
  greet: {
    rancher: ['Howdy!', 'Schöner Tag für Kühe.', 'Na, verirrt aus der Stadt?'], farmhand: ['Moin. Nicht auf die Melonen treten.'],
    trucker: ['Zehn-vier, Partner.'], hiker: ['Noch 900 Höhenmeter! Woo!'], ranger: ['Bitte auf den Wegen bleiben.'],
    townsfolk: ['Du bist nicht von hier, oder?', 'Grüß deine Mutter!'], churchgoer: ['Gesegneten Sonntag!'],
  },
  near_miss: {
    rancher: ['Langsam, das hier ist keine Rennstrecke!', 'Meine Kühe fahren vorsichtiger!'], farmhand: ['Die Stadt ist DA lang!'],
    quarry_worker: ['Hier wird gesprengt, nicht gerast!'], camper: ['Ey! Die Marshmallows!'],
  },
  idle: {
    rancher: ['Regen wär schön.', 'Der Zaun hält. Hoffentlich.'], milker: ['Bessie gibt heute extra viel.'], lumberjack: ['Holz hacken ist Meditation.'],
    camper: ['Hört ihr das? …War bestimmt nur ein Waschbär.'], climber: ['Kein Seil, kein Problem. Doch, Seil.'],
  },
};

export function barkLines(sit: number, arch: number): string[] {
  const a = arch >= 0 ? archetypeOf(arch) : null;
  if (a?.animal) return ANIMAL_SOUNDS[a.animal] ?? ['…'];
  const c = a ? COUNTRY[BARK_SITS[sit]]?.[a.id] : undefined;
  if (c?.length) return c;
  const t = BARKS[BARK_SITS[sit]];
  if (!t) return [];
  const own = arch >= 0 ? t[archetypeOf(arch).id] ?? [] : [];
  return own.length ? [...own, ...(t['*'] ?? [])] : t['*'] ?? [];
}

export function barkText(sit: number, arch: number, variant: number): string {
  const l = barkLines(sit, arch);
  return l.length ? l[variant % l.length] : '';
}

/** Abklingzeit pro NPC (s) und globale Obergrenze gleichzeitiger Barks pro Spieler-Umkreis (30 m). */
export const BARK_COOLDOWN: [number, number] = [9, 17];
export const BARK_MAX_NEAR = 5;
export const BARK_DURATION = 3.2;
