// Barks (Schritt 5): kurze Sprüche als Comic-Sprechblase über dem Kopf. Datengetrieben pro Situation
// und Archetyp ('*' = alle), mehrere Varianten, satirischer Ton (spec 1.5). Der Server wählt Situation
// und Variante (Abklingzeit pro NPC, globale Obergrenze); über das Netz geht nur ['bark', pedId, sit, var],
// den Text sucht der Client hier mit demselben Archetyp heraus.
import { archetypeOf, type ArchetypeId } from './archetypes';

export const BARK_SITS = [
  'bumped', 'near_miss', 'car_stolen', 'rain', 'heat', 'police', 'greet', 'night_alone',
  'scold', 'gunfire', 'film', 'call', 'fear', 'wanted', 'idle', 'crash', 'intervene', 'dodge',
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
};

/** Variantenliste für Situation + Archetyp (Archetyp-Sprüche zuerst, dann allgemeine). */
export function barkLines(sit: number, arch: number): string[] {
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
export const BARK_COOLDOWN: [number, number] = [12, 22];
export const BARK_MAX_NEAR = 3;
export const BARK_DURATION = 3.2;
