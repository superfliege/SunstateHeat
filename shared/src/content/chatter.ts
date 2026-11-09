// Anquatscher: Passanten, die auf den Spieler zukommen und ihn ungefragt volllabern (Straßenereignis
// „Anquatscher“, server/src/sim/scenes/street.ts). Monologe je Archetyp; dazu mischt der Server Sorgen,
// Gesprächsthemen und Sprüche aus der Viertel-DNA (shared/src/world/districts) ein.
// Ton (spec 1.5): Humor aus Situationen, nie aus Herkunft, Ethnie, Religion, Behinderung oder Aussehen.
import type { ArchetypeId } from '../npc/archetypes';

export interface Monologue {
  /** Für welche Archetypen (leer = alle). */
  arch?: ArchetypeId[];
  lines: string[];
}

/** Archetypen, die jemanden anquatschen (Gang-Mitglieder nicht – die haben Besseres zu tun). */
export const CHATTY_ARCHETYPES: ArchetypeId[] = [
  'tourist', 'businessman', 'jogger', 'beachgoer', 'partygoer', 'worker', 'retiree', 'vendor', 'homeless', 'local', 'dogwalker',
];

export const OPENERS = [
  'Ey, du! Ja, genau du!',
  'Hast du kurz Zeit? Dauert nur ’ne Sekunde.',
  'Entschuldigung! Hallo! Hier drüben!',
  'Psst. Komm mal her.',
  'Na endlich, ein normales Gesicht!',
  'Warte mal, kennen wir uns nicht?',
];

export const MONOLOGUES: Monologue[] = [
  { arch: ['tourist'], lines: ['Wo geht’s hier zum Strand?', 'Nein, zum ANDEREN Strand.', 'Der mit den Flamingos. Die sind doch echt, oder?', 'Plastik?! Ich hab 40 Fotos gemacht!'] },
  { arch: ['tourist'], lines: ['Kannst du ein Foto von mir machen?', 'Nicht so. Von unten. Nein, von oben.', 'Mit Sonnenuntergang. Jetzt.', '…Der ist erst in vier Stunden? Ich warte.'] },
  { arch: ['tourist'], lines: ['In meinem Reiseführer steht, hier ist es „pittoresk“.', 'Ich sehe drei Mülltonnen und einen Typen im Bademantel.', 'Ist DAS pittoresk?', 'Ich schreibe eine Rezension. Zwei Sterne.'] },
  { arch: ['businessman'], lines: ['Ich hab da ’ne Geschäftsidee für dich.', 'Palmen. Aber als Abo.', 'Jeden Monat eine neue Palme. Direkt vor die Haustür.', 'Investoren? Bisher meine Mutter. Bist du dabei?'] },
  { arch: ['businessman'], lines: ['Sorry, ich bin in einem Call.', '…Nein, nicht mit dir. Doch, mit dir.', 'Lass uns das offline nehmen.', 'Ich schick dir ein Memo. Hast du Fax?'] },
  { arch: ['businessman'], lines: ['Weißt du, was Erfolg ist?', 'Um 4 Uhr aufstehen. Eisbad. Smoothie aus Grünkohl.', 'Ich bin seit drei Jahren müde.', 'Aber PRODUKTIV müde.'] },
  { arch: ['jogger'], lines: ['Nicht stehen bleiben, ich bin im Intervall!', 'Ich hab heute schon 30.000 Schritte.', 'Die Uhr sagt, ich bin ein Gepard.', 'Okay, ich muss weiter. Mein Puls wird einsam.'] },
  { arch: ['jogger'], lines: ['Weißt du, was Laufen mit einem macht?', 'Man denkt klarer.', 'Ich weiß zum Beispiel nicht mehr, wo ich wohne.', 'Aber KLAR.'] },
  { arch: ['beachgoer'], lines: ['Hast du zufällig Sonnencreme?', 'Ich bin seit sechs Stunden am Strand.', 'Ohne.', 'Warum guckst du so? Ist es so schlimm?'] },
  { arch: ['partygoer'], lines: ['Wo ist die Party?', 'Ich war gerade noch auf einer.', 'Dann bin ich aufs Klo, und jetzt ist Dienstag.', 'Hast du mein Auto gesehen? Es ist… ein Auto.'] },
  { arch: ['partygoer'], lines: ['Ich kenn den Türsteher vom „Velvet Tide“.', 'Also, er hat mich mal angeguckt.', 'Das zählt doch, oder?', 'Komm mit, ich bring dich rein! …Wahrscheinlich.'] },
  { arch: ['worker'], lines: ['Siehst du das Loch da hinten?', 'Hab ich gegraben. Heute früh.', 'Jetzt soll ich es wieder zumachen.', 'Ich liebe meinen Job. Ehrlich. Fast.'] },
  { arch: ['retiree'], lines: ['Junger Mensch, früher war das hier alles Sumpf.', 'Und davor? Auch Sumpf.', 'Aber BESSERER Sumpf.', 'Heute gibt’s ja nicht mal mehr ordentliche Alligatoren.'] },
  { arch: ['retiree'], lines: ['Wissen Sie, wie spät es ist?', 'Halb vier? Dann hab ich das Frühbucher-Buffet verpasst.', 'Das war um elf.', 'Sagen Sie’s nicht meiner Frau.'] },
  { arch: ['retiree'], lines: ['Mein Enkel sagt, ich soll „online“ gehen.', 'Ich hab das Tablet jetzt als Schneidebrett.', 'Funktioniert prima.', 'Er ruft nicht mehr an. Komisch.'] },
  { arch: ['vendor'], lines: ['Sonnenbrille, Chef? Originale!', 'Marke „Solaro Deluxe“. Steht jedenfalls drauf. Mit Edding.', 'Für dich: Freundschaftspreis. Zwanzig.', 'Fünfzehn? Zehn? Okay, nimm sie einfach. Bitte.'] },
  { arch: ['vendor'], lines: ['Willst du eine Uhr kaufen?', 'Sie geht nach. Aber konsequent.', 'Das ist Charakter.', 'Bei mir gibt’s auch Kokosnüsse. Nur nicht hier.'] },
  { arch: ['homeless'], lines: ['Weißt du, was das Problem mit der Welt ist?', 'Alle rennen. Keiner läuft.', 'Ich laufe nicht mal. Ich sitze.', 'Ich bin der Einzige hier, der angekommen ist.'] },
  { arch: ['homeless'], lines: ['Hast du einen Dollar?', 'Nicht für mich. Für die Möwe.', 'Sie heißt Gerald. Er schuldet ihr was.', 'Lange Geschichte. Mit Pommes.'] },
  { arch: ['dogwalker'], lines: ['Darf ich vorstellen? Das ist Sir Wuffington.', 'Er mag dich nicht.', 'Er mag niemanden. Außer den Postboten.', 'Den mag er SEHR. Zum Fressen gern.'] },
  { lines: ['Hast du das gestern gesehen?', 'Da ist ein Typ mit einem Einkaufswagen über die Brücke gerast.', 'Mit Blaulicht dahinter!', 'Ich glaub, das warst du. Doch, das warst du.'] },
  { lines: ['Ich hab gehört, du bist neu hier.', 'Tipp von mir: Nie bei Grün über die Straße.', 'Da fahren die Raser erst richtig los.', 'Bei Rot auch nicht. Am besten gar nicht.'] },
  { lines: ['Bist du von der Zeitung?', 'Ich hab ein UFO gesehen. Über dem Hafen.', 'Es war rund. Und es hat geblinkt.', '…Kann auch ein Kran gewesen sein.'] },
  { lines: ['Darf ich dir eine Frage stellen?', 'Glaubst du, Leguane haben Gefühle?', 'Einer hat mich heute so angeguckt.', 'So… enttäuscht.'] },
  { lines: ['Ich hab eine Band gegründet.', 'Wir heißen „Die Sirenen von Palmara“.', 'Wir spielen nur Polizeisirenen nach.', 'Wir hatten schon drei Festnahmen. Erfolg!'] },
];

/** Abgang nach dem Monolog. */
export const FAREWELLS = [
  'Schön, dass wir geredet haben!',
  'Du bist ein guter Zuhörer. Fast so gut wie meine Topfpflanze.',
  'Okay, ich muss. Bis morgen, gleiche Stelle!',
  'Erzähl das keinem. Oder allen.',
  'War nett. Du redest nicht viel, oder?',
];

/** Spieler ist einfach weggelaufen / eingestiegen. */
export const BAILS = [
  'Ey! Ich war noch nicht fertig!',
  'Unhöflich!',
  'Dann eben nicht. Typisch.',
  'Ich rede einfach weiter. Mit mir.',
];

/** Vorlagen für Zeilen aus der Viertel-DNA: {worry}, {topic}. */
export const WORRY_LINES = ['Weißt du, was mich hier echt fertig macht? {worry}.', 'Und dann noch: {worry}. Jeden Tag!'];
export const TOPIC_LINES = ['Hast du schon gehört? {topic}', 'Alle reden nur noch über eins: {topic}'];
