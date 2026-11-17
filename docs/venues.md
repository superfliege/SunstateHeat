# Club „Pink Static“ & Casino „Palm Royale“ (Innenräume, Minispiele)

Zwei begehbare Orte am Ocean Strip mit eigener Teil-Szene: der Nachtclub des Neon Syndicate mit dem
Tanz-Minispiel **Dance Floor Heat** und das Hotel-Casino mit Automaten, Blackjack, Roulette und Gator Derby.

> **Grundregel Casino:** Gespielt wird ausschließlich mit Spielgeld ($). Keine Echtgeld-Käufe, keine
> kaufbaren Chips, keine Lootboxen, keine Umwandlung von Spielgeld in echtes Geld. Chips sind Spielgeld
> 1:1, nicht zwischen Spielern übertragbar und jederzeit an der Kasse auszahlbar.

## Dateien

| Bereich | Datei |
|---|---|
| Grundrisse, Kollision, Gates, Interaktionspunkte, Außenbereich | `shared/src/venues/interiors.ts` |
| Netz-Nachrichten (Client ↔ Server) | `shared/src/venues/net.ts`, eingebunden in `shared/src/protocol.ts` |
| Wahrzeichen (Bauplatz) | `shared/src/world/landmarks.ts` (`club`, `casino`) |
| Balancing (Einlass, Belohnungen, Limits, Tischlimits, Jackpot) | `shared/src/balance.ts` → `BALANCE.club`, `BALANCE.casino` |
| Automaten (Symbole, Gewichte, Gewinntabelle, exakte RTP) | `shared/src/content/casino/slots.ts` |
| Blackjack / Roulette / Gator Derby (Regeln, Ansichten) | `shared/src/content/casino/{blackjack,roulette,derby}.ts` |
| Songs, Beatmaps, Bewertung | `shared/src/content/dance/` (`songs.ts`, `beatmap.ts`, `<song>.json`) |
| Ereignisse E57–E64 | `shared/src/content/events/venues.ts` |
| Quests | `shared/src/questData.ts` (`neon_02_dance_for_your_life`, `marlin_03_card_counter`), Story: `shared/src/story/missions.json` + `story.json` (`story_side_jackpot_coup`) |
| Server | `server/src/venues/` – `Venues.ts` (Tür, Gates, Polizei, Valet, Emotes, Quests, Sync), `Crowd.ts` (Menge), `Director.ts` (Ereignisse), `DanceFloor.ts`, `Casino.ts`, `Bank.ts` (Chips, Limits, Bilanz), `Leaderboard.ts` |
| Client | `client/src/venues/` – `VenueClient.ts`, `InteriorView.ts`, `figures.ts` (Menge mit dem normalen NPC-Asset), `Exterior.ts`, `bubbles.ts`, `music.ts`, `ui/VenueUi.ts`, `ui/DanceUi.ts`, `ui/style.ts` |
| Fassaden | `client/src/render/LandmarkBuilder.ts` (`club`, `casino`) |
| Sounds | `client/src/audio/manifest.ts` (`venue.*`), Erzeugung `client/src/audio/procedural.ts` (`venue:*`) |
| Tests | `npm run venue-test` (Server-Rauchtest), `npm test` (Inhalte inkl. Beatmaps, RTP, Plätze) |

## Innenraum-System

- **Teil-Szene im Grundriss:** Ein Innenraum liegt im Grundriss seines Wahrzeichens und nutzt dessen
  Weltkoordinaten (lokales System: +z = Front/Eingang). Damit sind Spieler drinnen für Interest-Management,
  Quests und Polizei automatisch „im Gebäude“; Verkehr, Passanten und Polizei draußen laufen unverändert.
- **Geteilt pro Welt-Instanz:** Alle Spieler im selben Gebäude sehen sich und dieselbe Menge. Spieler
  draußen sehen niemanden drinnen und umgekehrt (`PlayerTuple[12]` = Innenraum).
- **Bewegung:** `stepInteriorPawn` (Client-Vorhersage und Server identisch) gegen Innenwände, Theken,
  Tische, Automaten. **Gates** (Bitmaske vom Server): VIP-Empore, High-Roller-Raum, Personalbereich.
- **Tür:** E an der Tür → Prüfung auf dem Server → Blende (Fade) + Tür-Sound. Hinterausgang (Gasse bzw.
  Personalausgang) führt auf die Seite des Gebäudes.
- **Darstellung:** gleiche geneigte Kamera mit näherem Zoom (`CameraRig.extraZoom`), Außenwände zur Kamera
  werden ausgeblendet (Puppenhaus, nur ein Sockel bleibt). Außenwelt-Rendering wird pausiert (Gruppen
  unsichtbar, keine Updates), eigenes Licht-Setup statt Tageslicht. Der Server schickt drinnen keine
  Außenwelt-Entitäten.
- **Fahndung:** Polizisten betreten den Innenraum (je Fahndungsstufe einer, max. 3) und nehmen fest.
  **Ab Stufe 2 wird das Gebäude abgeriegelt:** kein Einlass, Haupteingang zu – nur der Hinterausgang.
- Waffen bleiben an der Garderobe (drinnen kein Angriff).

## Club „Pink Static“ (Ocean Strip)

- **Außen:** Art-déco-Fassade mit pinker Neonschrift, Vordach mit Glühbirnen, roter Teppich, Samtkordel,
  Schlange, Türsteher Big Teo, Limousine und Sportwagen, ein Taxi lässt nachts Partygäste raus.
- **Einlass** nachts 22–5 Uhr Spielzeit (`BALANCE.club.openFrom/openTo`). Wer drin ist, darf nach 5 Uhr
  bleiben (eine Spielnacht dauert nur ~2,3 min Echtzeit). Big Teo prüft das Outfit: Strand- (Rang-Look
  „player“) und Arbeitskleidung („outdoor“) → „Nicht mit den Schuhen.“ Passendes Outfit (Look „business“
  oder angezogenes Outfit-Item) oder Ruf ≥ +20 beim Neon Syndicate → Einlass, sonst 200 $ „Eintritt“.
- **Innen:** Tanzfläche (6×5 Leuchtkacheln, pulsieren im Takt), DJ-Pult auf Podest, Lichtkegel
  (Fake-Volumen), Laser, Discokugel mit Lichtpunkten auf Boden/Wänden, Bar mit Vee (Gerüchte, Drinks),
  Lounges, VIP-Empore (Ruf ≥ +60 oder VIP-Karte 5.000 $ am VIP-Schalter), Toilettengang mit flackerndem
  Licht, Hinterausgang zur Gasse, Garderobe.
- **NPCs** (Server `Crowd.ts`): 40 Tänzer (Stile im Takt), Bargäste, Gruppen mit Sprechblasen über die
  laute Musik („WAS?!“ / „ICH SAGTE: SCHÖNE SCHUHE!“), Selfie-Fans, Neon-Syndicate-Mitglieder auf der Empore,
  Vee, DJ Lux, Türsteherin Mo.
- **Sound:** Club-Song über den Musik-Bus, drinnen voll; auf Toiletten/im Foyer und draußen per Tiefpass
  und Pegel gedämpft (bis ~110 m um die Tür).

### Dance Floor Heat

- **Start:** auf eine freie Kachel stellen, **F** → Song, Schwierigkeit (Leicht/Mittel/Schwer), Modus
  (Solo, Dance-Battle, Crew) wählen.
- **Steuerung:** ← ↓ ↑ → oder WASD (Gamepad: Steuerkreuz), ★ „Move“-Stern = Leertaste (Gamepad A).
  Halten = Taste gedrückt lassen, Doppel = zwei Tasten gleichzeitig.
- **Bewertung** lokal nach Audio-Uhr: Perfekt ±45 ms, Gut ±90 ms, Okay ±140 ms, sonst Daneben. Combo,
  Multiplikator (x2 ab 10, x3 ab 25, x4 ab 50), Hype-Meter → **Spotlight** (Licht auf den Spieler, NPCs
  bilden einen Kreis und jubeln, Punkte x2 für 8 s).
- **Figur:** jede Note ein Tanzschritt (Akzent), Combos schalten aufwendigere Moves frei, Fehltritt =
  Stolpern, Stern = Pose. Zuschauer sehen die Tänze anderer Spieler live.
- **Multiplayer:** Dance-Battle (2–4 Spieler auf Nachbarkacheln, gleicher Song, Punkte live, Sieger:
  Spotlight + Pokal), Crew (Gruppen-Combo steigt nur, wenn alle treffen).
- **Plausibilisierung (Server):** Treffer nur für Noten, deren Zeitpunkt nach Server-Uhr erreicht ist
  (+0,35 s Toleranz), streng aufsteigend, übersprungene Noten = Daneben, Halten ≤ Notenlänge; die
  Punkte rechnet der Server mit demselben Code nach (`applyGrade`), nie über dem Maximum.
- **Belohnungen** (`BALANCE.club`): 50–800 $ nach Punkten und Schwierigkeit, XP, Neon-Ruf +1…+3 (max.
  1x pro Spieltag), freischaltbare **Tanzstile** (Emotes in der offenen Welt: **G** bzw. `/tanz <stil>`,
  `/jubeln`, `/winken`), Glitzer-Outfit bei Rang S auf Schwer.
- **Bestenlisten** je Song und Schwierigkeit – pro Instanz (Speicher) und global (`DATA_DIR/dance-leaderboard.json`),
  im Handy unter Einstellungen → „Casino-Bilanz“ (gemeinsames Statistik-Fenster).
- **Kalibrierung:** „Latenz kalibrieren“ (Klopf-Test auf 8 Klicks, Median, gespeichert im Browser).

#### Songs & Beatmaps

Sechs Tracks (Synthwave, Elektro, Latin-Elektro, Disco, Hip-Hop, House) werden wie das Radio prozedural
aus Songdaten erzeugt (`songs.ts` → `client/src/venues/music.ts`) – selbst erstellt, keine Fremdmusik, und
Beat und Noten liegen exakt aufeinander. Beatmaps liegen als Daten in `shared/src/content/dance/<song>.json`
(je `easy`, `medium`, `hard`; Note = `[Beat, Spur 0–3, Art 0 Tippen/1 Halten/2 Doppel/3 Stern, Extra]`).

Hilfsskript für Entwürfe (zum Nachbearbeiten):

```bash
npm run dance-beatmap -- --song neon_nights --force
```

```bash
npm run dance-beatmap -- --audio assets-src/audio/mein_track.ogg --id mein_track --bpm 120
```

Bei einer Audiodatei dekodiert ffmpeg, Onsets kommen aus dem Spektral-Fluss, BPM per Autokorrelation
(falls nicht angegeben), die Phase aus dem besten Raster-Treffer. Vorhandene Dateien werden nur mit
`--force` überschrieben.

### Club-Ereignisse

| ID | Ereignis | Ablauf / Eingreifen |
|---|---|---|
| E57 | DJ fällt aus | Musik bricht ab, Buhrufe. **E am DJ-Pult**: einen Song lang im Takt Effekte auslösen → Menge feiert, Gage + Freigetränk von Vee. |
| E58 | Tanzwettbewerb der Gangs | Neon Syndicate fordert die „Tide Breakers“ (Marlin Club) heraus. Battle starten auf der linken (Neon) bzw. rechten Hälfte (Marlin) der Tanzfläche → Sieg mit Rang ≥ B ändert den Ruf wie bei Quests. |
| E59 | VIP-Drama | Influencer gegen Türsteherin Mo („Weißt du, wer ich BIN?“ / „Ein Mensch ohne Armband.“). Mit VIP-Status als Gast mitnehmen oder Mo mit `/jubeln` den Rücken stärken. |
| E60 | Feueralarm | Nebelmaschine, Alarm, alle raus: Straßenparty vor dem Club bis zur Entwarnung (Einlass gesperrt). |

## Casino „Palm Royale“ (Ocean Strip / Übergang Downtown)

- **Außen:** Art-déco-Hotelbau mit goldener Kuppel, Säulenportikus, Springbrunnen mit Lichtshow, Palmen,
  Portier, **Valet-Parking** (im Auto am Stand **E**: Rico parkt; zu Fuß **E**: abholen für 40 $, frisch
  gewaschen und repariert). 24 Stunden offen. In Badehose (Rang 0 ohne Outfit) nur mit Leih-Sakko (50 $).
- **Innen:** Kasse „Cage“ (Bargeld ↔ Chips 1:1), Automatenhalle (60 Automaten, Instancing, blinkende
  Bildschirme, Jackpot-Tafel), Tischbereich (2 Blackjack-Tische, Roulette), High-Roller-Raum (ab Stufe 15
  und 50.000 $ Chips; High-Roller-Blackjack 500–20.000 $, Marlin Club, Hinterzimmer), Bar mit
  Lounge-Pianist, Buffet, Boutique (Abendgarderobe öffnet auch beim Club die Tür), Tresor-Tür.
  Schriller Teppich, goldene Säulen, Kronleuchter, keine Fenster, keine Uhren.
- **NPCs:** Glücksbringer-Oma, Systemspieler mit Notizblock, Junggesellenabschied, nervöser Tourist,
  High-Roller mit Sonnenbrille, Croupiers, Kellner mit Tabletts, Sicherheitsleute (im High-Roller-Raum mit
  Sichtkegel), Marlin-Club-Mitglieder.

### Spiele

| Spiel | Regeln | Hausvorteil |
|---|---|---|
| **Lucky Flamingo Slots** | 3 Walzen, Einsatz 10/50/100/500 $, Walzen stoppen von links nach rechts, Spannung bei zwei gleichen. Zwei Varianten: *Classic* (Trefferquote 33 %, viele kleine Gewinne) und *Gold Rush* (4 %, große Dreierreihen). Progressiver Jackpot je Instanz (Start 10.000 $, +2 % jedes Einsatzes) ab 100 $ Einsatz, sonst fester Muschel-Gewinn. Jackpot: Lichtshow, Sirene, Jubel, Radiomeldung. | RTP 93,0 % / 93,8 % (inkl. Jackpot-Topf-Anteil), exakt per Aufzählung berechnet und im Test geprüft |
| **21 (Blackjack)** | 6 Decks, Dealer steht ab 17 (auch Soft 17), Blackjack 3:2, Karte/Stehen/Verdoppeln/Teilen (einmal), Versicherung bei Ass, Mischen nach 75 %. Bis 5 Plätze (Spieler + NPCs), Züge nacheinander mit 15 s (dann „Stehen“). Croupière Margot kommentiert. Tipp-Anzeige der Grundstrategie (Einstellungen: aus). | ~0,5 % bei Grundstrategie |
| **Ruleta Royale** | Europäisch (eine Null), Zahl, Farbe, Gerade/Ungerade, Dutzend, Kolonne, Hoch/Tief; 20 s Setzphase, Kugel-Animation im Kessel, Ergebnis vorab vom Server. Bis 6 Spieler + NPC-Einsätze. | 2,7 % |
| **Gator Derby** | 6 Alligatoren mit Namen, Eigenschaften und Form, Quoten nach Form. Rennen alle 5 Minuten (Echtzeit, `BALANCE.casino.derbyInterval`), Wetten am Schalter im Casino (Chips) oder an Terminals in Gator Flats/Okeefield (Bargeld). Großbildschirm mit Kommentator. | 12 % |
| Poker (Texas Hold'em) | **noch nicht umgesetzt** – laut Auftrag „optional, später“, nach den anderen Spielen. | – |

### Casino-Ereignisse

| ID | Ereignis |
|---|---|
| E61 | Die Glücksbringer-Oma gewinnt dreimal hintereinander; ein Mann will ihren „Glücksbringer“ kaufen (Badesalz). |
| E62 | Der Systemspieler erklärt sein „todsicheres System“ und verliert („Statistisch MUSS jetzt Rot kommen!“ – „Schwarz.“). |
| E63 | Falscher Alarm im Tresor: Wachen rennen los, Gäste flüchten, am Ende ein Waschbär im Lüftungsschacht (E halten an der Tresor-Tür). |
| E64 | Jackpot-Hysterie: knackt ein NPC den Jackpot – Konfetti, Jubel, Ohnmacht, Aufwachen, als die Kamera kommt. |

## Wirtschaft & Schutz der Balance

- Alle Zahlen in `BALANCE.casino` / `BALANCE.club`. Der Hausvorteil zieht langfristig Geld aus der Wirtschaft.
- **Limits pro Spieler** (gleitende Stunde): max. 50.000 $ Nettoverlust und 100.000 $ Nettogewinn – danach
  nimmt das Casino keine Einsätze mehr an (`server/src/venues/Bank.ts`).
- **Anti-Exploit:** Zufall nur auf dem Server mit `crypto.randomInt`; Walzen, Karten (Schlitten), Kugel und
  Rennausgang werden erst nach dem Einsatz bestimmt. Chips nicht übertragbar. Alle Chip-Bewegungen
  (Kauf, Einsatz, Auszahlung) stehen im Transaktionsprotokoll (`data/transactions.jsonl`, Präfix `chips:`).
- **Bilanz** (gewonnen/verloren/netto, Runden, Jackpots, laufende Stunde) und **Konto-Sperre** („Casino-Spiele
  für mein Konto deaktivieren“): Handy → Einstellungen → „Casino-Bilanz & Konto-Sperre“. Gesperrt bleibt
  das Auszahlen erlaubt.

## Quests

| Quest | Auftraggeber | Ablauf |
|---|---|---|
| Tanz um dein Leben | Neon Syndicate (Telefon Ocean Strip, nachts) | Club betreten → Kai „Glitch“ Moreno auf der Tanzfläche herausfordern (E) → Dance-Battle gewinnen → USB-Stick abliefern |
| Kartenzähler | Marlin Club (Telefon Palm Royale) | Casino betreten → Kartenzähler am Tisch „Sunset“ beobachten (nah, aber nicht zu nah – Misstrauen) → er flieht durch den Personalausgang → draußen einholen |
| Der Jackpot-Coup | Carla (Story Akt 2, nach „Eine Crew“) | Casino betreten → mit Personal-Armband in den High-Roller-Raum schleichen (Sichtkegel der Wachen meiden), im Hinterzimmer Mister Sundays Bücher fotografieren (E halten) → raus zur Gasse |

Neuer Zieltyp `venue` im Quest-Schema (`shared/src/quests.ts`), ausgewertet von `Venues.questGoal`.

## Gerüchte

Jackpots, Dance-Battle-Sieger, Rang-S-Läufe und Ereignisse landen im Gerüchte-Register der Instanz.
Vee (Club-Bar) und Barkeeper Lucien (Casino) erzählen die neuesten. Jackpots gehen zusätzlich als
Radiomeldung an alle Spieler.

## Auf der Karte finden

Club (💃) und Casino (🎰) sind auf der Minimap und der großen Karte markiert (auch am Rand der Minimap,
wenn sie außer Sicht sind). Große Karte (**K**): oben die **Suche** („casino“, „nachtclub“, „tanzen“, „derby“ …,
Enter = erster Treffer), **Zoom** per Mausrad, Doppelklick oder ＋/－, **Ziehen** zum Verschieben, ◎ = zu mir,
⤢ = ganze Karte. Ein Treffer bzw. Klick auf einen Marker setzt einen **Wegpunkt** mit GPS-Route
(„✖ Ziel“ löscht ihn; erreicht = automatisch weg). Auch im Handy: Einstellungen → „Ort auf der Karte suchen“.

## Steuerung

| | Tastatur | Gamepad |
|---|---|---|
| Tür, Interaktion | E | X |
| Tanzkachel | F | Y |
| Minispiel bedienen | Maus / Pfeile, Leertaste, Esc | Steuerkreuz wählt, A bestätigt, B schließt |
| Tanzen | ← ↓ ↑ → / WASD, Leertaste | Steuerkreuz, A |
| Blackjack | H Karte, S Stehen, D Verdoppeln, P Teilen, Leertaste Setzen | Steuerkreuz + A |
| Emote | G (Tanzen an/aus), `/tanz <stil>`, `/jubeln`, `/winken` | – |

## Performance

- Die Menge (drinnen und vor Club/Casino) nutzt **dasselbe Charakter-Asset wie die Passanten** (Kenney-Figuren,
  `EntityViews.setVenueNpc`) mit Szenario-Posen aus `render/npcActs.ts` (Tanzstile, Jubeln, DJ, Croupier,
  Automat …) und deren Animations-LOD. Das kostet mehr Draw-Calls als die frühere Instanz-Menge
  (Club ~170 statt ~40, Casino ~80 statt ~35), bleibt aber im Rahmen der Außen-Abschnitte (156–191).
- Automaten per Instancing (Gehäuse + Bildschirme, Farbe je Instanz), Tanzfläche per Instancing + Shader.
- Lichtshow nur mit Emissive, additiven Fake-Volumen, Linien, Decal-Quads und Bloom – **keine dynamischen
  Lichter**. Statische Einrichtung zu wenigen Meshes zusammengefasst, Matrizen eingefroren.
- Außenwelt-Rendering im Innenraum pausiert; der Server schickt dort keine Außenwelt-Entitäten.
- Benchmark-Route: Abschnitte **„Club zur Hauptzeit“** (40 tanzende NPCs + 8 Tänzer als Stellvertreter für
  Spieler) und **„Casino-Automatenhalle“** (`/club voll`, `/casino voll`), siehe `docs/performance-report.md`.

## Dev-Befehle

`/club`, `/casino` (zur Tür), `/club rein` · `/club voll` (Einlass ohne Prüfung, `voll` = Benchmark-Menge),
`/club offen` (Öffnungszeiten aus), `/event E57 … E64`, `/chips <n>`, `/jackpot`, `/derby` (Rennen sofort),
`/vtp <platz>` (drinnen zu einem Platz springen, z. B. `tile14`, `slot5`, `bj1:2`, `ru1:0`, `cage`, `ledger`).

## Entscheidungen (wo der Auftrag offen war)

- **Gator Derby „alle 5 Spielminuten“:** Eine Spielminute dauert hier nur 1/3 s (Tag = 8 min). Das Rennen
  läuft deshalb alle 5 **Echtzeit**-Minuten; Wert in `BALANCE.casino.derbyInterval`.
- **Club-Öffnungszeit:** Einlass 22–5 Uhr Spielzeit wie gefordert; drin darf man bleiben.
- **Outfit:** Es gibt (noch) kein Kleidungssystem – maßgeblich ist der Rang-Look der Story plus
  Outfit-Gegenstände (Abendgarderobe aus der Casino-Boutique, Glitzer-Outfit als Tanz-Belohnung; „benutzen“
  = an-/ausziehen). Rang 0 gilt als Badehose.
- **8 Spieler im Benchmark:** Ein Benchmark-Client kann keine echten Mitspieler erzeugen; `/club voll`
  setzt 8 zusätzliche Tänzer als Stellvertreter.
- **Songs:** Die „bestehenden lizenzfreien Musikquellen“ sind im Projekt prozedural (keine Audiodateien
  vorhanden) – die sechs Tracks werden genauso erzeugt. Echte CC0-Aufnahmen lassen sich später per
  Beatmap-Skript einbinden.
- **Poker** ist bewusst nicht umgesetzt (optional/später laut Auftrag).
