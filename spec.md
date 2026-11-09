Sunstate Heat – Spezifikation

Version 1.0 · Arbeitstitel „Sunstate Heat" Ein Browser-Multiplayer-Open-World-Action-Spiel im Low-Poly-Look klassischer Handheld-Spiele, inspiriert vom Gameplay von Top-Down-Crime-Games (GTA 2, GTA Chinatown Wars).

Inhaltsverzeichnis
Vision & Grundpfeiler
Rechtlicher Rahmen
Die Welt: Palmara
Grafik, Kamera & Atmosphäre
Audio
Steuerung
Spielfigur
Fahrzeuge
Kampf
NPCs
Fahndungssystem
Gangs & Ruf
Quests & Story
Wirtschaft
Inventar & Gegenstände
Multiplayer & Soziales
UI & HUD
Technische Architektur
Datenmodell & Persistenz
Sicherheit & Anti-Cheat
Performance-Budget
Projektstruktur
Deployment & Betrieb
Tests & Qualitätssicherung
Meilensteine & Abnahmekriterien
Nicht im Umfang & Risiken
Glossar
1. Vision & Grundpfeiler
1.1 Elevator Pitch

Sunstate Heat ist ein Open-World-Crime-Spiel im Browser. Bis zu 16 Spieler teilen sich eine sonnige, neonbeleuchtete Küstenwelt, die von Florida inspiriert ist: eine Metropole am Meer, eine Inselkette, ein Sumpfgebiet und ländliches Hinterland. Spieler nehmen Aufträge von Gangs an, klauen Autos, liefern sich Verfolgungsjagden mit der Polizei und erledigen Missionen allein oder gemeinsam mit Freunden. Kein Download, kein Launcher: Link öffnen und losspielen.

1.2 Grundpfeiler (Design Pillars)
Sofort spielbar: Vom Öffnen des Links bis zum ersten Autoklau unter 60 Sekunden.
Arcade-Chaos statt Simulation: Fahrzeuge, Kampf und Polizei sind überzeichnet, schnell und spaßig.
Gemeinsam mehr Spaß: Jedes Kernsystem (Quests, Fahndung, Fahrzeuge) funktioniert solo, wird aber im Koop besser.
Charmanter Handheld-Look: Low-Poly, kräftige Farben, gute Lesbarkeit auf jedem Laptop.
Kleine Welt, dichte Welt: Lieber eine kompakte Karte voller Details als eine riesige leere.
1.3 Zielgruppe
Spieler ab 16 Jahren, die klassische Top-Down-GTA-Teile oder Open-World-Action mögen.
Freundesgruppen, die spontan gemeinsam spielen wollen, ohne Installation.
1.4 Plattform
Desktop-Browser (Chrome, Firefox, Edge, Safari – jeweils aktuelle zwei Hauptversionen).
Tastatur + Maus als Standard, Gamepad optional.
Mobile ist nicht Ziel der Version 1.0, die UI soll aber skalierbar gebaut werden.
1.5 Altersfreigabe & Ton
Comic-Gewalt ohne Blut und ohne Gore. Besiegte Figuren fallen um und verschwinden.
Satirischer, augenzwinkernder Humor (Radiowerbung, Ladennamen, NPC-Sprüche).
Keine realen Personen, Marken oder Organisationen.
2. Rechtlicher Rahmen

Diese Regeln gelten für alle Meilensteine und haben Vorrang vor allen Design-Wünschen.

Sunstate Heat ist ein eigenständiges Spiel. Es werden keine Namen, Logos, Schriftzüge, Figuren, Karten, Missionen, Dialoge, Musik oder Assets von Rockstar Games oder der GTA-Reihe verwendet.
Keine Ortsnamen aus GTA-Spielen (z. B. kein „Leonida", „Vice City", „Los Santos", „Liberty City").
Die Karte wird eigenständig gestaltet. Inspiration kommt aus der realen Geografie und Atmosphäre Floridas, nicht aus der Karte eines anderen Spiels.
Keine realen Marken auf Fahrzeugen, Läden oder Werbetafeln. Alle Marken sind erfunden.
Alle Grafiken, Modelle, Sounds und Musik werden im Code prozedural erzeugt oder selbst erstellt. Externe Assets nur mit eindeutig freier Lizenz (CC0), mit Quellenangabe in CREDITS.md.
Spielmechaniken und Genre-Konventionen (Top-Down-Kamera, Autos klauen, Fahndungsstufen, Missionen über Telefone) sind nicht geschützt und dürfen frei verwendet werden; sie bekommen aber eigene Namen und eigene Gestaltung.
3. Die Welt: Palmara
3.1 Überblick

Palmara ist ein fiktiver Bundesstaat im Südosten der USA. Die spielbare Karte umfasst vier Zonen, die durch Highways, Brücken und Wasserwege verbunden sind.

                 ┌──────────────────────────────┐
                 │      DRY PINE COUNTRY        │
                 │  (Hinterland, Highways,      │
                 │   Plantagen, Trailerparks)   │
                 └───────┬──────────────┬───────┘
                         │ Highway 9    │ Route 41
          ┌──────────────┴───┐     ┌────┴────────────────┐
          │   GATOR FLATS    │─────│    PORT CORALIA     │
          │ (Sumpf, Wasser-  │     │ (Metropole, Strand, │
          │  wege, Airboats) │     │  Hafen, Downtown)   │
          └──────────────────┘     └────┬────────────────┘
                                        │ Seven Spans Bridge
                                 ┌──────┴──────────────┐
                                 │    CORAL KEYS       │
                                 │ (Inselkette, Brücken│
                                 │  Strände, Marinas)  │
                                 └─────────────────────┘
3.2 Größe & Maßstab
Gesamtfläche Version 1.0: ca. 2,5 × 2,5 km Spielwelt-Einheiten (1 Einheit = 1 Meter).
Durchquerung der Karte mit dem Auto: ca. 3–4 Minuten.
Die Welt ist in Chunks à 64 × 64 m unterteilt (Streaming, Interest Management, Kollision).
Kartenränder: offenes Meer (Süden, Osten), dichter Sumpf (Westen), unpassierbare Berge/Wälder (Norden). Unsichtbare Grenzen sind mit einem sichtbaren Grund versehen (z. B. Sturm auf dem Meer, der das Boot zurückdrückt).
3.3 Zone 1: Port Coralia (Metropole)

Die neonbeleuchtete Küstenstadt und das Herz der Karte.

Viertel	Beschreibung	Wichtige Orte
Ocean Strip	Art-déco-Strandpromenade, Palmen, Hotels in Pastellfarben	Strand, Hotel „Pink Flamingo", Rollschuhverleih
Downtown	Glas-Hochhäuser, Banken, breite Straßen	Polizeihauptquartier, Bank, Bürotürme
Little Havana Heights	Bunte Häuser, Cafés, Wandbilder	Café, Zigarrenladen, Domino-Park
Port District	Containerhafen, Kräne, Lagerhallen	Hafen, Werft, Schrottplatz
Brickell Hills	Reiche Villen am Wasser	Villen mit Bootsstegen, Golfplatz
Northgate	Industrie, Werkstätten, Motels	Werkstatt, Motel, Truckstop

Weitere Elemente: Hochbahn (dekorativ, ab M3 befahrbar), mehrere Zugbrücken, Flughafen-Rand im Norden (dekorativ).

3.4 Zone 2: Coral Keys (Inselkette)
5–7 Inseln, verbunden durch lange, flache Brücken; die längste ist die Seven Spans Bridge vom Festland.
Türkises Flachwasser, Sandstrände, Leuchtturm, Yachthäfen, Fischerdörfer, Strandbars.
Wichtige Orte: Marina „Blue Hook", Leuchtturm „Sandbar Light", Fischmarkt, Ferienhaussiedlung.
Bootsverkehr zwischen den Inseln, Schmuggel-Verstecke in Mangrovenbuchten.
3.5 Zone 3: Gator Flats (Sumpfgebiet)
Flache Wasserwege, Mangroven, Holzstege, Stelzenhütten, Schilf.
Fortbewegung vor allem per Airboat und Boot; wenige Schotterstraßen.
Alligatoren als harmlose bis leicht gefährliche Wildtiere (beißen bei Annäherung zu Fuß, machen Schaden, verfolgen nicht weit).
Wichtige Orte: Angelshop „Bait & Bullets", Airboat-Tour-Station, verlassene Konservenfabrik, versteckte Landepiste.
Nebel am Morgen, Glühwürmchen in der Nacht.
3.6 Zone 4: Dry Pine Country (Hinterland)
Lange, gerade Highways, Kiefernwälder, Orangenplantagen, Sumpfkiefern, Kleinstädte.
Wichtige Orte: Kleinstadt „Okeefield" mit Main Street, Tankstelle „Gas & Gator", Trailerpark „Sunny Acres", Orangenplantage, Rennstrecke auf Feldweg, Raketenstartrampen-Silhouette am Horizont (Deko).
Truckerverkehr, Motorradfahrer, Viehweiden.
3.7 Verbindungen
Von	Nach	Verbindung
Port Coralia	Coral Keys	Seven Spans Bridge, Fähre (M3)
Port Coralia	Dry Pine Country	Route 41 (Highway)
Port Coralia	Gator Flats	Causeway Road, Kanäle
Gator Flats	Dry Pine Country	Highway 9, Wasserwege
3.8 Tag-Nacht-Zyklus
Ein Spieltag dauert 48 Minuten Echtzeit (1 Spielstunde = 2 Minuten).
Zeit ist serverseitig und für alle Spieler einer Instanz gleich.
Nachts: Neonschilder, Straßenlaternen, Fahrzeugscheinwerfer, mehr Gang-Aktivität, weniger Passanten.
3.9 Wetter (ab M3)
Zustände: Sonnig, bewölkt, Regen, Gewitter, Nebel (vor allem Gator Flats morgens).
Wetter wirkt sich aus: Regen verringert Fahrzeuggrip um 15 %, Nebel verringert Sichtweite.
Wetter wechselt alle 15–30 Spielminuten, serverseitig gesteuert.
Seltenes Ereignis: tropischer Sturm (Wind schiebt Fahrzeuge leicht, hohe Wellen bei Booten).
4. Grafik, Kamera & Atmosphäre
4.1 Stil
Low-Poly-3D im Handheld-Look: einfache Geometrie, flache Schattierung oder sehr dezentes Cel-Shading.
Texturen: entweder einfarbige Flächen oder kleine Pixeltexturen (max. 64 × 64 px, Nearest-Neighbor-Filter).
Farbpalette: Sonnenuntergang (Pink, Orange, Violett), Meer (Türkis, Tiefblau), Neon (Magenta, Cyan, Gelb). Jede Zone hat eine eigene Grundpalette.
Optionaler Retro-Filter: leichte Auflösungsreduzierung (Render-Scale 0,5–0,75) mit hartem Hochskalieren.
4.2 Kamera
Geneigte Top-Down-Kamera, Neigung ca. 55°, folgt dem Spieler mit leichter Verzögerung (Lerp).
Zu Fuß: nahe Zoomstufe. Im Fahrzeug: zoomt abhängig von der Geschwindigkeit heraus und blickt leicht in Fahrtrichtung voraus.
Kamera dreht sich standardmäßig nicht mit (klassisch Norden = oben); optional per Einstellung drehbar.
Gebäude zwischen Kamera und Spieler werden transparent geschaltet oder abgeschnitten.
4.3 Figuren
Figuren aus 6–12 Grundformen (Kopf, Torso, Arme, Beine), 300–800 Dreiecke.
Einfache Skelett- oder prozedurale Animationen: Idle, Gehen, Rennen, Schlagen, Zielen, Einsteigen, Umfallen.
Spieler-Figuren unterscheiden sich durch Farben, Kopfbedeckung, Kleidung und Namensschild.
4.4 Gebäude & Umgebung
Gebäude aus prozeduralen Bausteinen (Quader mit Fensterreihen, Dächer, Vordächer, Neonschilder).
Vegetation per Instancing (Palmen, Kiefern, Mangroven, Schilf).
Wasser: animierte Fläche mit einfacher Vertex-Welle und Farbverlauf zur Tiefe.
4.5 Effekte
Partikel: Abgasrauch, Reifenqualm, Funken, Wasserspritzer, Explosionen (Comic-Stil).
Bildschirmwackeln bei Explosionen und Crashes (abschaltbar).
Keine blutigen Effekte.
## 4.6 Externe Assets

Abweichend von Abschnitt 2 dürfen fertige 3D-Modelle und Sounds verwendet werden, sofern sie unter **CC0** (gemeinfrei) stehen. Primäre Quelle ist **Kenney** (kenney.nl, auch auf kenney-assets.itch.io und opengameart.org). Alle Kits sind ohne Account und kostenlos herunterladbar, Lizenz CC0, Namensnennung freiwillig. Formate: glTF/GLB (für Three.js bevorzugt), FBX, OBJ.

### Geplante Kits
| Bereich | Kit | Verwendung |
|---|---|---|
| Straßen | City Kit (Roads) | Straßen, Kreuzungen, Brücken |
| Gebäude | City Kit (Commercial), (Suburban), (Industrial) | Downtown, Wohnviertel, Hafen/Northgate |
| Fahrzeuge | Car Kit (~45 Modelle inkl. Polizei, Krankenwagen, Feuerwehr, Lkw) | Verkehr, Spielerfahrzeuge |
| Boote | Watercraft Kit | Boote, Marina |
| Waffen | Blaster Kit | Waffenmodelle (ggf. umfärben) |
| Natur | Nature Kit | Bäume, Felsen, Pflanzen |
| Sounds | Kenney Audio-Packs (CC0) | UI-, Impact- und Fahrzeugsounds |

### Ergänzende Quellen (ebenfalls CC0)
- **Quaternius** (quaternius.com / quaternius.itch.io): Low-Poly-Autos, modulare Straßenteile, animierte Charaktere.
- **Poly Pizza** (poly.pizza): Suchmaschine für CC0-Low-Poly-Modelle, nützlich für Einzelteile wie Palmen, Alligatoren, Airboats.

### Regeln
- Nur Assets mit eindeutiger CC0-Lizenz; jede Quelle in `CREDITS.md` eintragen.
- Assets liegen unter `client/public/assets/<quelle>/<kit>/` und werden mit `npm run assets` (Skript `scripts/fetch-assets.mjs`, feste Commits) geladen.
- Einheitlicher Look: alle Modelle bekommen per Shader/Material die Palmara-Farbpalette und dieselbe Beleuchtung, damit Kits verschiedener Quellen zusammenpassen.
- Was in keinem Kit existiert (Art-déco-Hotels, Stelzenhütten, Mangroven, Airboat, Neonschilder), wird weiterhin prozedural im Code erzeugt.
- Erfundene Markennamen auf Fahrzeugen/Gebäuden werden im Spiel ergänzt; Kenney-Modelle sind markenfrei.

### Umsetzung
Alle Kits der Tabelle sind eingebunden (Quelle: Spiegel `series-ai/jam-ready-assets`, feste Commits, Details in `CREDITS.md`):
City Kit Commercial/Suburban/Industrial für Gebäude (umgefärbt in die Viertel-Farben), City Kit Roads für Laternen,
Baustellen und Autobahnschilder, Car Kit als zusätzliche Fahrzeugvarianten inkl. Polizei, Krankenwagen und Feuerwehr
(mit dem Schadensmodell der prozeduralen Autos), Watercraft für Boote, Airboat, Containerlager und Hafen-Deko,
Blaster Kit für Schusswaffen (auf Metall umgefärbt), Nature Kit + Quaternius Stylized Nature für Vegetation sowie
Kenney Impact/Interface Sounds. Die Straßen selbst bleiben prozedural, weil das Straßennetz nicht im Raster liegt.
5. Audio

Ziel: dichte, lebendige Klangwelt im Stil eines Open-World-Crime-Games mit Küsten- und Neon-Atmosphäre.
Sounds kommen aus CC0-/lizenzfreien Paketen (Kenney, Sonniss GDC, Freesound nur CC0, Pixabay, FreePD,
OpenGameArt CC0) und werden prozedural ergänzt (Web Audio API). Jeder Manifest-Eintrag hat einen prozeduralen
Ersatz, solange keine Datei vorliegt – das Spiel klingt also auch ohne Rohdateien vollständig.

5.1 Quellen & Asset-Pipeline
Rohdateien unter assets-src/audio/<quelle>/ (Sonniss/Pixabay per .gitignore draußen). `npm run audio`
(scripts/process-audio.ts, ffmpeg): sichten (--scan), zuschneiden, Stille entfernen, Lautheit normalisieren
(Effekte -16, Ambience -24, Musik -18 LUFS, Spitzen -1 dBFS), Mono für 3D-Effekte, Stereo für Musik/Ambience,
OGG/Opus + AAC-Fallback (Safari), kurze Effekte als Audio-Sprites, große Loops/Musik gestreamt.
Sound-Manifest client/src/audio/manifest.ts: Bus, Varianten, Lautstärke, Pitch-Bereich, Pegelstreuung,
3D-Einstellungen, Instanz-Limit, Priorität, Zonen, Lizenzquelle je Datei. CREDITS.md wird daraus erzeugt.
Lazy Loading: Einträge mit zones laden nur in der aktuellen und angrenzenden Zone.

5.2 Audio-Engine
Busse Effekte, Fahrzeuge, Waffen, Stimmen/Barks, Ambience, Musik/Radio, UI → Master mit Kompressor und
Limiter; Lautstärke je Bus einstellbar (gespeichert). 3D über PannerNode relativ zur Spielfigur (Blickrichtung
der Kamera), Abstandskurven je Kategorie, HRTF optional. Variation: zufällige Variante ohne direkte Wiederholung,
Pitch ±5–10 %, Pegel ±2 dB. Max. 32 Stimmen, Instanz-Limits je Sound, leise/unwichtige Stimmen fliegen zuerst.
Ducking von Radio/Ambience bei Explosionen, Dialogen, Missionsansagen. Hall je Umgebung (Gasse/Tunnel/Parkhaus
stark, Straße/Strand schwach, Sumpf weich), Tiefpass für verdeckte Quellen (Raycast durch Gebäudekacheln) und
unter Wasser, dezenter Doppler für vorbeifahrende Fahrzeuge und Sirenen. Start erst nach der ersten
Nutzeraktion mit sanftem Einblenden.

5.3 Fahrzeuge
Motor pro Klangklasse aus 4 Drehzahl-Layern (Leerlauf, niedrig, mittel, hoch) je Last- und Schiebebetrieb,
Crossfade nach Drehzahl, Pitch innerhalb des Layers. Gangwechsel, Auspuffknallen beim Gaswegnehmen
(Sportwagen, Muscle Cars, Motorrad), Turbo-Pfeifen + Blow-off, Druckluftbremse (Trucks), Nitro.
Reifen: Quietschen nach Schlupf, Abrollen je Untergrund (Asphalt, Schotter, Sand, Gras, nass). Federung:
Bordstein-Poltern, Landung nach Sprüngen. Kollisionen in 3 Stärken aus Aufprall + Blech + Glas + Trümmern,
Schleif-Loop und Funken. Schaden: Motorstottern, Klappern loser Teile, Zischen bei Rauch, Feuer, Explosion.
Airboat mit Propeller, Boote mit Wasserrauschen, Polizei-Sirenen (Wail, Yelp, Hi-Lo), Hupe je Klasse.
Optional: dumpfer Innenraumklang bei naher Kamera.

5.4 Waffen & Kampf
Schüsse geschichtet: Nahschicht (Knall), Mechanik, Hall je Umgebung, Fernschicht (dumpf ab 50 m) – comicartig
druckvoll, nicht blutig. Hülsen, Nachladen, leeres Magazin, Treffer auf Metall/Holz/Beton/Wasser, Nahkampf,
Explosionen mit Nachhall und Trümmerregen.

5.5 Ambience & Welt
Zonen-Ambience aus mehrschichtigen Loops mit Überblendung an Zonengrenzen: Ocean Strip (Brandung, Möwen,
Strandstimmen, Barmusik, Rollschuhe), Downtown (Verkehr, Stimmengewirr, Ampeln, Bauarbeiten; nachts Neonsummen,
Club-Bässe), Hafen (Kräne, Container, Schiffshörner), Coral Keys (ruhiges Wasser, Wind, Takelage, Fischerboote),
Gator Flats (Zikaden, Frösche, Vögel, Plätschern, Alligator; nachts Insekten), Dry Pine Country (Wind in Kiefern,
Grillen, ferne Trucks, Hunde). Tageszeit- und Wettervarianten (Regen auf Oberflächen, Donner mit Verzögerung
je Entfernung, Wind). Punktquellen (Klimaanlagen, Brunnen, Neonschilder, Ladenmusik, Straßenmusiker,
Missions-Telefonzellen, Hunde) und zufällige One-Shots (Autoalarm, ferne Sirene, Flugzeug, Lachen, Hupe).

5.6 Figuren & NPCs
Schritte je Untergrund (Asphalt, Holzsteg, Sand, Gras, Wasser, Metall) und Gangart, Kleidungsrascheln, Türen,
Fallen/Aufstehen. Barks als kurze Laute passend zur Sprechblase, Stimmvarianten per Pitch/Formantfilter.
Menschenmengen-Layer nach NPC-Dichte, Panik-Layer bei Schüssen.

5.7 Musik & Radio (M3)
Mindestens 4 erfundene Radiosender mit je 6–10 Tracks (CC0/Pixabay) und eigenen Jingles:
Coral 88.1 – Synthwave/Retro-Pop
Swamp Radio 101 – Bluesrock/Country-Stil
Palmara Talk 740 – Satire-Werbung und Ansagen (Text-Einblendungen, optional TTS)
Bass Coast FM – elektronische Beats
Sender laufen „live“ (Position aus der Server-Zeit, alle im Auto hören dasselbe). Senderwechsel mit R,
Bandpass + Rauschen beim Umschalten, außerhalb des Autos gedämpft. Prozedurale Jingles, Sender-IDs und
Werbespots zwischen den Tracks. Optional Spannungs-Loops nach Fahndungsstufe, Erfolgs-/Fehlschlag-Jingles.

5.8 UI
Kenney-UI-Sounds für Menüs, Inventar, Käufe, Geld ±, Fahndungsstufe, Quest-Updates, Handy, Chat –
kurz (< 200 ms) und einheitlich.

5.9 Netzwerk, Performance & Debug
Sounds werden lokal aus synchronisierten Zuständen abgeleitet (Drehzahl, Schlupf, Ereignisse), keine
Audiodaten übers Netz. Budget: initialer Audio-Download < 3 MB, Rest lazy/gestreamt; Audio-CPU < 5 % auf
einem Referenz-Laptop. Debug-Overlay F3 → Audio: aktive Stimmen (Kategorie, Entfernung, Pegel, Verdeckung),
Bus-Pegel, Hallzone, Zone, Lautstärkeregler. Sound-Browser im Dev-Modus (Manifest-Einträge anhören,
Lautstärke/Pitch live anpassen und exportieren).
6. Steuerung
6.1 Tastatur & Maus (Standard)
Aktion	Zu Fuß	Im Fahrzeug
Bewegen	WASD / Pfeiltasten	W/S = Gas/Bremse-Rückwärts, A/D = Lenken
Sprinten	Shift	–
Handbremse	–	Leertaste
Einsteigen / Aussteigen	E	E
Angreifen / Schießen	Linke Maustaste	Linke Maustaste (Drive-by, eingeschränkt)
Zielen	Maus	Maus
Waffe wechseln	Mausrad / 1–4	Mausrad
Springen / Ausweichen	Leertaste	–
Hupe	–	H
Radio wechseln	–	R
Interagieren (Telefon, Laden, Tür)	F	–
Chat	Enter	Enter
Karte	M	M
Inventar	I / Tab	I / Tab
Quest-Log	J	J
Gruppe	P	P
Menü / Pause-Overlay	Esc	Esc
6.2 Gamepad (optional)
Standard-Layout nach Gamepad-API: linker Stick Bewegung, RT Gas, LT Bremse, A Springen/Handbremse, Y Einsteigen, X Interagieren, RB Angreifen, D-Pad Waffe/Radio.
6.3 Einstellungen
Alle Tasten neu belegbar, Einstellungen lokal gespeichert.
Kamera-Rotation an/aus, Bildschirmwackeln an/aus, Retro-Filter an/aus, Render-Skalierung.
7. Spielfigur
7.1 Erstellung
Beim ersten Login: Name (3–16 Zeichen, eindeutig, Filter gegen Beleidigungen), Körperbau (3 Varianten), Hautton (8 Stufen), Startoutfit (4 Varianten).
Spielerfarbe für Namensschild und Minimap-Markierung frei wählbar.
7.2 Werte
Wert	Bereich	Beschreibung
Gesundheit	0–100	Regeneriert bis 30 automatisch, darüber nur durch Essen/Verbandskästen
Rüstung	0–100	Fängt 50 % des Schadens ab, kaufbar
Ausdauer	0–100	Für Sprinten, regeneriert im Gehen
Geld (Bargeld)	≥ 0	Wird bei „Tod" teilweise verloren
Bankguthaben	≥ 0	Sicher, nur per Geldautomat ein-/auszahlbar
7.3 Ausgeknockt („Tod") & Respawn
Bei 0 Gesundheit wird die Figur ausgeknockt.
Koop-Rettung: Gruppenmitglieder haben 15 Sekunden, um den Spieler wiederzubeleben (F gedrückt halten, 3 Sekunden).
Sonst Respawn im nächstgelegenen Krankenhaus der Zone. Kosten: 10 % des Bargelds (max. 1.000 $).
Bei Festnahme durch die Polizei: Respawn vor dem nächsten Polizeirevier, Verlust von 15 % Bargeld und illegalen Gegenständen.
7.4 Fortschritt
Spielerstufe (Level 1–50): Erfahrungspunkte (XP) aus Quests, Aktivitäten und Entdeckungen.
Stufen schalten frei: Waffenklassen in Läden, Fahrzeugkäufe, Immobilien, Quest-Reihen.
Keine Kampfwerte-Steigerung durch Level (faire Kämpfe zwischen Freunden), höchstens kleine Komfortboni (z. B. mehr Ausdauer bis +20 %).
8. Fahrzeuge
8.1 Fahrzeugklassen
Klasse	Beispiele (erfundene Namen)	Eigenschaften
Kompakt	„Bimini Bug", „Coralette"	Wendig, langsam, schwach
Limousine	„Palmara Cruiser", „Sedano"	Ausgewogen
Sportwagen	„Neon Vortex", „Stingrae GT"	Schnell, empfindlich
Muscle Car	„Gator V8", „Thunderbolt"	Starke Beschleunigung, driftet
SUV / Pick-up	„Swamprunner", „Ranch Hauler"	Robust, gut im Gelände
Transporter / Truck	„Citrus Express", „Big Pine Rig"	Langsam, stark, für Lieferquests
Motorrad	„Sunburst 600", „Dirt Viper"	Sehr schnell, Fahrer fällt bei Crash herunter
Polizei	„Interceptor", „Patrol SUV"	Nur bei Fahndung verfügbar, mit Sirene
Boot	„Keys Skiff", „Cigarette Racer"	Wasser
Airboat	„Marsh Glider"	Wasser und flacher Sumpf/Gras
Rettungsfahrzeuge (M3)	Krankenwagen, Feuerwehr	Für Nebenjobs
Fluggerät (nach 1.0)	–	Nicht im Umfang 1.0

Mindestumfang: M1 = 4 Fahrzeuge (Kompakt, Sportwagen, Motorrad, Airboat), M2 = 10, M3 = 18+.

8.2 Fahrphysik
Arcade-Modell: vereinfachtes Fahrzeugmodell mit Beschleunigung, Höchstgeschwindigkeit, Lenkrate, Grip, Driftfaktor, Masse.
Handbremse erzeugt kontrollierbare Drifts.
Untergrund beeinflusst Grip: Asphalt 1,0 / Sand 0,6 / Gras 0,7 / Schlamm 0,5 / nass ×0,85.
Boote: Auftrieb vereinfacht, Wellen beeinflussen leicht die Richtung. Airboats können bis 15 m auf flaches Land/Schilf gleiten.
Kollisionen: Fahrzeuge prallen ab, Impuls abhängig von Masse.
8.3 Schaden
Jedes Fahrzeug hat 0–1000 Fahrzeug-Lebenspunkte.
Sichtbarer Schaden in 3 Stufen (Beulen, Rauch, Feuer).
Bei 0: Fahrzeug brennt 5 Sekunden, dann Comic-Explosion (Flächenschaden in 6 m Radius).
Reparatur in Werkstätten oder durch das Werkzeugkasten-Item.
8.4 Fahrzeuge erhalten
Stehlen: Geparkte Fahrzeuge sind abgeschlossen (2 Sekunden Aufbrechen, kleines Fahndungsrisiko) oder offen. Fahrende NPC-Fahrzeuge: Fahrer wird herausgezogen (erhöht Fahndung).
Kaufen (M2/M3): Händler „Coralia Motors" (Stadt) und „Okeefield Used Cars" (Land), Bootshändler in der Marina.
Eigene Fahrzeuge: Gekaufte Fahrzeuge bleiben dauerhaft im Besitz, werden in Garagen gelagert und können per Handy-Menü an den nächstgelegenen Straßenrand bestellt werden (Kosten 100 $, Abklingzeit 60 Sekunden).
Gestohlene Fahrzeuge können in eine Garage gestellt werden, wenn der Spieler eine Garage besitzt (max. 2 gestohlene gleichzeitig).
8.5 Mitfahren
Fahrzeuge haben 1–4 Sitze. Gruppenmitglieder steigen mit E als Beifahrer ein.
Beifahrer können schießen (Drive-by mit Pistole/Maschinenpistole), Fahrer nur mit Pistole nach vorne/seitlich.
8.6 Werkstatt & Tuning
„Paint & Pray"-Lackierwerkstätten (eine pro Zone): Umlackieren (entfernt Fahndungsstufe bis 2), Reparatur.
Tuning (M3): Motor (3 Stufen), Bremsen (2), Reifen (Straße/Offroad), Panzerung (3), Nitro (1 Ladung, nachfüllbar), Farben, Felgen, Neon-Unterbodenbeleuchtung, Hupenton.
9. Kampf
9.1 Grundsätze
Kampf ist arcadehaft und comicartig. Kein Blut, keine Körperteile, keine Grausamkeit.
Zielsystem: Maus zeigt Zielrichtung, automatisches leichtes Einrasten auf Ziele im 15°-Kegel (abschaltbar).
9.2 Waffen
Slot	Waffe	Schaden	Feuerrate	Reichweite	Freischaltung
Nahkampf	Fäuste	8	schnell	1,5 m	Start
Nahkampf	Baseballschläger	18	mittel	2 m	Stufe 2
Nahkampf	Machete	22	mittel	2 m	Stufe 8
Pistole	Pistole	15	mittel	25 m	Stufe 3
Automatik	Maschinenpistole	9	hoch	20 m	Stufe 10
Schwer	Schrotflinte	40 (Streuung)	niedrig	10 m	Stufe 15
Schwer	Gewehr	25	mittel	40 m	Stufe 20
Wurf	Molotow-Cocktail (Comic-Feuer)	Flächenschaden	–	15 m Wurf	Stufe 12
Spezial	Raketenwerfer	150 Flächenschaden	sehr niedrig	50 m	Stufe 30, sehr teuer
Munition wird gekauft (Waffenladen „Ammo & Ammo") oder bei besiegten Gegnern gefunden.
Maximal 4 Waffen gleichzeitig (1 pro Slot).
9.3 PvP-Regeln
Standard: PvP aus zwischen Spielern (kein Schaden untereinander, Fahrzeuge schieben sich nur).
Spieler können PvP in den Einstellungen für sich aktivieren („Heißblütig"-Modus). Nur zwei PvP-aktivierte Spieler können sich gegenseitig verletzen.
Gruppenmitglieder können sich nie gegenseitig verletzen.
Spezielle PvP-Aktivitäten (M3): Gang-Revierkämpfe, Rennen mit Rammen, „Kopfgeld"-Modus.
10. NPCs
10.1 Passanten
Bewegen sich auf einem Wegpunkt-Netz für Gehwege, betreten/verlassen Gebäude (verschwinden in Türen).
Reaktionen: Ausweichen vor Fahrzeugen, Flucht bei Schüssen, gelegentliche Sprüche als Sprechblase.
Typen pro Zone: Touristen und Rollschuhfahrer (Ocean Strip), Geschäftsleute (Downtown), Angler (Coral Keys), Jäger und Airboat-Guides (Gator Flats), Farmer und Trucker (Dry Pine).
Dichte: abhängig von Tageszeit und Viertel, max. 40 aktive Passanten pro Spieler-Umkreis.
10.2 Verkehr
Fahrzeuge folgen einem Straßengraphen mit Spuren, Kreuzungen und Ampeln.
Halten an roten Ampeln, weichen Hindernissen aus, hupen bei Blockade.
Fahrstil-Varianten: vorsichtig, normal, aggressiv.
Bootsverkehr auf festgelegten Wasserrouten.
Dichte: max. 25 aktive Fahrzeuge pro Spieler-Umkreis.
10.3 Polizei
Siehe Fahndungssystem.
Organisation: Palmara Coastal Police (PCP), eigenes Wappen mit Pelikan.
10.4 Gang-Mitglieder
Patrouillieren in ihren Revieren in Gang-Farben.
Verhalten abhängig vom Ruf des Spielers (siehe Gangs & Ruf).
10.5 Wildtiere
Alligatoren (Gator Flats, Kanäle in der Stadt), Möwen und Pelikane (Deko), Flamingos (Deko).
Alligatoren beißen bei unter 3 m Abstand (20 Schaden), verfolgen max. 10 m.
10.6 Simulation
NPCs werden serverseitig simuliert, aber nur in Chunks mit Spielern in der Nähe (Radius 150 m). Außerhalb werden sie entfernt bzw. „eingefroren".
Clients interpolieren NPC-Positionen wie Spielerpositionen.
11. Fahndungssystem
11.1 Stufen

Angezeigt als Polizeimarken (nicht als Sterne).

Stufe	Auslöser (Beispiele)	Polizeireaktion
0	–	Keine
1	Heat ≥ 1: z. B. 2–3 getötete Passanten oder ~4 angefahrene (einzelnes Anrempeln reicht nicht)	1 Polizist zu Fuß, versucht Festnahme
2	Heat ≥ 3, Polizei angreifen	2 Polizisten + Streifenwagen, Schüsse
3	Heat ≥ 6, Polizisten ausschalten	4 Polizisten, 2 Streifenwagen, aggressive Rammversuche
4	Heat ≥ 10 (anhaltendes Chaos)	Zusätzlich 2 Panzer, die mit Raketen schießen
Heat-Punkte (nur mit Zeugen, siehe server/src/sim/Police.ts HEAT): Schlag 0,1 · Anfahren 0,25 · Passant ausgeschaltet 0,45 · Autodiebstahl 0,35 · Schuss 0,15 (max. alle 1,5 s) · Explosion 1,0. Ohne Fahndung baut sich Heat langsam ab.
11.2 Ablauf
Zeuge-Prinzip: Verbrechen erhöhen die Fahndung nur, wenn ein Polizist oder ein Passant mit Sichtlinie in 30 m Nähe es sieht (Passanten melden mit 3 Sekunden Verzögerung).
Suchradius: Die Polizei kennt die letzte bekannte Position. Auf der Minimap erscheint ein Suchkreis.
Abschütteln: Außerhalb des Suchkreises und außer Sichtweite der Polizei bleiben → nach 20 s (Stufe 1), 35 s (Stufe 2), 60 s (Stufe 3), 90 s (Stufe 4) sinkt die Stufe auf 0.
Verwaiste Fahrzeuge: Bewegte/beschädigte Autos ohne Fahrer verschwinden nach 3 Minuten (geparkte kehren auf ihren Parkplatz zurück), sofern kein Spieler direkt daneben steht.
Lackierwerkstatt: Senkt Stufe 1–2 sofort auf 0 (nicht bei Sichtkontakt). Kosten 250 $.
Bestechungs-Telefon (M3): Senkt Fahndung um 1 Stufe für 2.000 $, Abklingzeit 10 Minuten.
11.3 Koop-Regeln
Fahndung gilt pro Spieler.
Sitzen mehrere Spieler im selben Fahrzeug, verfolgt die Polizei das Fahrzeug mit der höchsten Stufe der Insassen.
Gruppenmitglieder ohne Fahndung, die Polizisten angreifen, erhalten selbst Fahndung.
11.4 Festnahme
Ab Stufe 1: Ist der Spieler zu Fuß, nahezu still und ein Polizist 3 Sekunden in Reichweite, wird er festgenommen (Fortschrittsbalken, durch Wegrennen abbrechbar).
Folgen siehe 7.3.
12. Gangs & Ruf
12.1 Die Gangs
Gang	Revier	Stil & Farbe	Spezialität
Neon Syndicate	Port Coralia (Downtown, Ocean Strip)	Weiße Anzüge, Magenta-Neon	Clubs, Geldwäsche, schnelle Autos
Marlin Club	Coral Keys	Segelkleidung, Türkis/Weiß	Schmuggel per Boot, Yachten
Mangrove Kings	Gator Flats	Tarnmuster, Olivgrün/Orange	Airboats, verborgene Lager
Dustline Haulers	Dry Pine Country	Trucker-Caps, Rostrot/Jeans	Lkw-Konvois, Ersatzteilhandel

Jede Gang hat einen Boss-NPC mit eigenem Charakter, ein Hauptquartier und 3–5 Missionstelefone im Revier.

12.2 Rufwerte
Ruf pro Gang: −100 bis +100, Start bei 0.
Quests für eine Gang: +5 bis +15 bei dieser Gang, −3 bis −10 bei der jeweiligen Rivalen-Gang.
Rivalitäten: Neon Syndicate ↔ Marlin Club, Mangrove Kings ↔ Dustline Haulers.
Gang-Mitglieder angreifen: −5 pro Angriff.
Ruf	Status	Verhalten der Gang
≤ −50	Erzfeind	Greift sofort an, Hinterhalte im Revier
−49 bis −10	Feindlich	Greift bei Annäherung < 10 m an
−9 bis +19	Neutral	Ignoriert, wehrt sich bei Angriff
+20 bis +59	Freundlich	Grüßt, hilft im Kampf gegen Polizei/Rivalen
≥ +60	Vertraut	Boss-Missionen, Rabatte in Gang-Läden, Gang-Fahrzeuge verfügbar
12.3 Koop & Ruf
Bei Koop-Quests erhalten alle beteiligten Spieler den Rufwert.
Gruppen mit widersprüchlichem Ruf: Gang reagiert auf das Gruppenmitglied mit dem schlechtesten Ruf in der Nähe.
12.4 Gang-Reviere (M3)
Jede Zone ist in 3–6 Revierblöcke unterteilt.
Gruppen mit Ruf ≥ +60 bei einer Gang können in Revierkämpfen Blöcke für diese Gang erobern (Wellen von Gegner-NPCs, max. 5 Minuten).
Revierbesitz ist pro Instanz, wird wöchentlich zurückgesetzt, bringt passives Einkommen in Höhe von 50 $ pro Block und Spielstunde für Beteiligte.
13. Quests & Story
13.1 Quest-Quellen
Missionstelefone (Payphones): Die zentrale Hommage an das Genre. Telefone klingeln, wenn ein Auftrag verfügbar ist (Symbol auf der Minimap). Spieler geht hin, drückt F, Auftraggeber spricht per Textbox.
Story-NPCs: Feste Figuren mit Questreihen.
Handy-Aufträge (M2): Nach Erreichen von Ruf +20 rufen Gangs den Spieler direkt an.
Nebenaktivitäten: Taxi, Lieferdienst, Abschleppdienst, Rennen, Airboat-Touren, Krankenwagen (M3).
Zufallsereignisse (M3): Überfall auf Geldtransporter, Panne eines Gang-Trucks, Flüchtiger auf der Straße.
13.2 Datengetriebenes Quest-System

Quests werden als Daten definiert (TypeScript-Objekte mit Schema-Validierung, z. B. Zod), nicht im Code verdrahtet.

Struktur einer Quest:

ts
interface QuestDefinition {
  id: string;                     // "neon_01_first_delivery"
  title: string;
  giver: { type: "payphone" | "npc" | "phone"; id: string };
  gang?: GangId;
  minLevel: number;
  requirements?: { reputation?: Partial<Record<GangId, number>>; questsCompleted?: string[] };
  coop: { min: number; max: number };     // z. B. { min: 1, max: 4 }
  repeatable: boolean;
  cooldownMinutes?: number;
  intro: DialogueLine[];
  stages: QuestStage[];                    // nacheinander
  rewards: { money: number; xp: number; reputation?: Partial<Record<GangId, number>>; items?: ItemGrant[] };
  failConditions?: FailCondition[];
}

interface QuestStage {
  id: string;
  description: string;                     // Anzeige im Quest-Log/HUD
  objectives: Objective[];                 // alle müssen erfüllt sein
  timeLimitSeconds?: number;
  onStart?: QuestAction[];                 // NPCs spawnen, Fahrzeug bereitstellen, Fahndung setzen
  onComplete?: QuestAction[];
}

Ziel-Typen (Objectives):

Typ	Beschreibung
goTo	Ort (Kreis/Bereich) erreichen, optional mit bestimmtem Fahrzeug
deliverItem	Gegenstand zum Zielort bringen (verliert man ihn, kann er aufgehoben werden)
deliverVehicle	Bestimmtes oder klassengleiches Fahrzeug zum Ziel bringen, optional mit Mindestzustand
follow	NPC-Fahrzeug unauffällig verfolgen (Abstand halten, zu nah/zu weit = Fehlschlag)
chase	NPC verfolgen und stoppen/ausschalten
defeat	Bestimmte Gegner-NPCs besiegen
protect	NPC/Fahrzeug eine Zeit lang schützen
collect	N Gegenstände in einem Gebiet einsammeln
survive	Zeitspanne überleben (z. B. mit Fahndungsstufe)
loseWanted	Fahndung auf 0 bringen
race	Checkpoints in Reihenfolge abfahren
photograph (M3)	Mit Handykamera Ziel ablichten
groupAt	Alle Gruppenmitglieder müssen gleichzeitig an einem Ort sein
interact	Mit Objekt/NPC interagieren (F gedrückt halten)

Fehlschlagbedingungen: Zeit abgelaufen, Ziel-NPC tot, Lieferfahrzeug zerstört, alle Gruppenmitglieder ausgeknockt, Spieler verlässt Questgebiet zu lange.

13.3 Koop-Quests
Quest-Startender lädt Gruppenmitglieder ein; wer innerhalb von 50 m vom Startpunkt ist, wird automatisch Teil der Quest.
Ziele können geteilt (einer erfüllt für alle) oder individuell (jeder muss) sein.
Belohnungen erhält jeder Teilnehmer voll (kein Aufteilen), solange er mindestens 50 % der Questzeit in Reichweite war.
Spezielle Koop-Ziele: ein Spieler fährt, ein anderer schießt; zwei Fahrzeuge müssen gleichzeitig ankommen; einer lenkt Polizei ab, während der andere liefert.
13.4 Story-Rahmen

Prämisse: Der Spieler ist frisch mit dem Bus in Port Coralia angekommen, pleite und mit einer Schuld bei einem mysteriösen Kredithai namens „Mister Sunday". Um die Schuld zu bezahlen, arbeitet der Spieler für die vier Gangs, deckt dabei auf, dass Mister Sunday die Gangs gegeneinander ausspielt, um ein Bauprojekt auf den Coral Keys durchzusetzen, und entscheidet am Ende, mit welcher Gang er gegen ihn vorgeht.

Aufbau:

Akt	Inhalt	Missionen
Prolog	Ankunft, erste Jobs, Tutorial	3
Akt 1	Je 3 Einstiegsmissionen pro Gang	12
Akt 2	Rivalitäten eskalieren, Spuren zu Mister Sunday	8
Akt 3	Wahl einer Verbündeten-Gang, Finale (4 Varianten-Enden)	5

Story-Missionen sind alle solo spielbar; Gruppenmitglieder können mitmachen (Fortschritt zählt für alle, die die Mission noch nicht abgeschlossen haben).

13.5 Beispielquests

Q01 – „Frische Ware" (Prolog, Tutorial, solo/koop 1–4)

Geber: Payphone am Busbahnhof Port Coralia.
Stufe 1: Klau einen Lieferwagen auf dem Parkplatz vor dem Supermarkt.
Stufe 2: Fahr zum Hafen, Lagerhalle 7.
Stufe 3: Bring das Paket innerhalb von 3:00 Minuten zum Trailerpark Sunny Acres.
Belohnung: 500 $, 100 XP.

Q02 – „Neonnacht" (Neon Syndicate, koop 2–4)

Nur nachts verfügbar.
Stufe 1: Fahrt gemeinsam zum Club „Pink Static".
Stufe 2: Ein Spieler bleibt am Eingang (protect Türsteher 2:00 Min. gegen Marlin-Club-Angreifer), die anderen holen den Geldkoffer aus dem Hinterhof.
Stufe 3: Liefert den Koffer an Brickell Hills, Fahndungsstufe 2 wird gesetzt.
Belohnung: 1.800 $, 300 XP, Neon +12, Marlin −6.

Q03 – „Brückentag" (Marlin Club, solo/koop 1–3)

Stufe 1: Klau das Schnellboot „Cigarette Racer" aus der Marina Blue Hook.
Stufe 2: Fahr unter allen Bögen der Seven Spans Bridge durch (Checkpoints, 2:30 Min.).
Stufe 3: Häng die Küstenwache ab (loseWanted).
Belohnung: 1.200 $, 250 XP, Marlin +10, Neon −5.

Q04 – „Sumpfgeflüster" (Mangrove Kings, solo/koop 1–4)

Stufe 1: Verfolge einen Dustline-Truck unauffällig bis zu seinem Lager (follow).
Stufe 2: Sammle 5 Ersatzteilkisten im Lager (collect), Wachen greifen an.
Stufe 3: Bring die Kisten per Airboat zum Stelzenhaus der Mangrove Kings.
Belohnung: 1.400 $, 280 XP, Mangrove +10, Dustline −6.

Q05 – „Orangen-Express" (Dustline Haulers, koop 2–4)

Stufe 1: Ein Spieler fährt den „Big Pine Rig"-Truck, die anderen eskortieren in eigenen Fahrzeugen.
Stufe 2: Mangrove Kings greifen mit Airboats und Pick-ups auf dem Highway 9 an (protect Truck, min. 40 % Zustand).
Stufe 3: Ankunft im Hafen Port Coralia.
Belohnung: 2.000 $, 350 XP, Dustline +12, Mangrove −6.

Q06 – „Leuchtfeuer" (Marlin Club, koop 2–4)

Stufe 1: Alle Gruppenmitglieder treffen sich nachts am Leuchtturm Sandbar Light (groupAt).
Stufe 2: Ein Spieler bedient das Leuchtfeuer (interact, 60 s halten), die anderen wehren Neon-Syndicate-Boote ab (defeat).
Stufe 3: Begleite das Schmugglerboot zur versteckten Bucht.
Belohnung: 1.900 $, 320 XP, Marlin +12, Neon −6.

Q07 – „Ruhig Blut" (unabhängig, solo, wiederholbar)

Payphone in Okeefield.
Stufe 1: Überlebe 2:00 Minuten mit Fahndungsstufe 2 im Dry Pine Country.
Stufe 2: Bring die Fahndung auf 0.
Belohnung: 600 $, 120 XP, Abklingzeit 30 Minuten.

Q08 – „Gator Grand Prix" (unabhängig, koop 1–8, Rennen)

Airboat-Rennen durch Gator Flats, 12 Checkpoints.
Belohnung nach Platz: 1.000 $ / 600 $ / 300 $ + XP.
13.6 Nebenaktivitäten
Aktivität	Zone	Ablauf	Belohnung
Taxi „Sunny Cabs"	Port Coralia	NPC-Fahrgäste zu Zielen bringen, Bonus für Geschwindigkeit	50–200 $ pro Fahrt
Lieferdienst „Grubhopper"	Port Coralia	Essen mit Motorrad liefern, Zeitlimit	40–150 $
Abschleppdienst	Dry Pine	Liegengebliebene Fahrzeuge zur Werkstatt bringen	100–300 $
Airboat-Touren	Gator Flats	Touristen-NPCs zu Sehenswürdigkeiten fahren, keine Kollisionen	80–250 $
Straßenrennen	alle	Payphone-Rennen, Wetteinsätze möglich	variabel
Krankenwagen (M3)	alle	Verletzte NPCs ins Krankenhaus	100–400 $
Sammelobjekte	alle	50 versteckte „Flamingo-Statuen"	XP, kosmetische Belohnungen
Sprungschanzen	alle	25 „Wahnsinnssprünge"	XP, Geld
14. Wirtschaft
14.1 Währung
Eine Währung: Dollar ($), unterteilt in Bargeld und Bankguthaben.
Startgeld: 200 $ Bargeld, 0 $ Bank.
Keine Echtgeld-Käufe in Version 1.0.
14.2 Einnahmequellen
Quests und Nebenaktivitäten (Hauptquelle).
Revier-Einkommen (M3).
Immobilien-Einkommen (M3).
Fahrzeuge an den Schrottplatz verkaufen (gestohlene: 10 % des Werts, max. 1 pro 5 Minuten).
Beute von besiegten Gegnern (kleine Beträge).
14.3 Ausgaben
Kategorie	Preisbereich
Essen / Verbandskasten	10–150 $
Rüstung	300–800 $
Waffen	500–25.000 $
Munition	20–500 $
Kleidung	50–5.000 $
Fahrzeuge	3.000–150.000 $
Tuning	500–40.000 $
Immobilien	20.000–500.000 $
Lackierung / Reparatur	100–500 $
Krankenhaus / Festnahme	prozentual (siehe 7.3)
14.4 Läden
Laden	Ware	Standorte
„24/7 Sunmart"	Essen, Verbandskasten, Getränke	alle Zonen
„Ammo & Ammo"	Waffen, Munition, Rüstung	Northgate, Okeefield, Marina
„Threads & Shades"	Kleidung, Hüte, Brillen	Ocean Strip, Little Havana, Okeefield
„Coralia Motors"	Neuwagen, Motorräder	Downtown
„Okeefield Used Cars"	Gebrauchtwagen, Pick-ups	Okeefield
„Blue Hook Marine"	Boote, Airboats	Marina, Gator Flats
„Paint & Pray"	Lackieren, Reparatur, Tuning	eine pro Zone
„Gas & Go"	Snacks, Getränke (Tankstellen-Shop)	an Tankstellen
Läden sind begehbar (Dach blendet beim Betreten aus); gekauft wird im Gespräch mit dem Verkäufer an der Theke.
Geldautomaten	Ein-/Auszahlen	15+ in der Welt
14.5 Immobilien (M3)
Typ	Funktion	Beispielpreise
Motelzimmer (Start, gemietet)	Respawn-Punkt, Kleiderschrank	kostenlos
Wohnung	Respawn, 2 Garagenplätze	20.000–60.000 $
Villa	Respawn, 6 Garagenplätze, Bootssteg	200.000–500.000 $
Geschäft (Bar, Werkstatt, Autowäsche)	Passives Einkommen 100–500 $/Spielstunde, max. Kassenstand 10.000 $	50.000–250.000 $
14.6 Wirtschaftliches Gleichgewicht
Zielwerte: Spieler auf Stufe 10 verdient ca. 8.000–12.000 $ pro Spielstunde, auf Stufe 30 ca. 25.000–35.000 $.
Alle Preise und Belohnungen stehen in einer zentralen Balancing-Datei (shared/balance.ts), damit sie ohne Codeänderung angepasst werden können.
Server protokolliert alle Transaktionen (für Balancing-Auswertung und Cheat-Erkennung).
15. Inventar & Gegenstände
15.1 Aufbau
Waffenslots: 4 (Nahkampf, Pistole, Automatik, Schwer) + 1 Wurfwaffen-Slot.
Rucksack: 8 Slots in M2, erweiterbar auf 16 (Rucksack-Upgrades im Kleidungsladen).
Stapelbare Gegenstände (max. Stapel je Typ definiert).
Quest-Gegenstände belegen keinen Rucksack-Slot (eigener Quest-Bereich).
15.2 Gegenstandstypen
Typ	Beispiele	Effekt
Verbrauchsgüter	Burger, Kubanisches Sandwich, Energydrink, Verbandskasten	Gesundheit/Ausdauer
Rüstung	Leichte Weste, Schwere Weste	Rüstungspunkte
Werkzeug	Werkzeugkasten, Brecheisen	Fahrzeug reparieren, schneller Autos aufbrechen
Wurfwaffen	Molotow, Rauchbombe (M3)	siehe Kampf
Handel	Gestohlener Schmuck, Ersatzteile	beim Hehler verkaufbar
Illegal	Schmuggelware (abstrakt: „Kiste mit unbekanntem Inhalt")	geht bei Festnahme verloren
Kosmetik	Kleidung, Hüte, Brillen	nur Aussehen
Quest	Pakete, Koffer, Schlüssel	questgebunden
15.3 Weitergeben & Handeln
Spieler können Gegenstände und Bargeld an Gruppenmitglieder in 5 m Reichweite geben (Bestätigung durch Empfänger).
Geldübergaben über 10.000 $ pro Stunde werden protokolliert und gedrosselt (Anti-Exploit).
Kein freier Marktplatz in Version 1.0.
16. Multiplayer & Soziales
16.1 Instanzen
Eine Welt-Instanz = eine vollständige Karte mit bis zu 16 Spielern.
Spieler wählen beim Beitreten: „Schnell beitreten" (Instanz mit den meisten Spielern, die noch Platz hat), „Freunden beitreten" oder „Private Instanz" (nur mit Einladungslink/Code).
Private Instanzen: Ersteller ist Host-Moderator (kann kicken, PvP für alle verbieten).
Spielerfortschritt ist instanzübergreifend (Account-gebunden), Weltzustand (Reviere, Tageszeit) ist instanzgebunden.
Leere Instanzen werden nach 5 Minuten heruntergefahren.
16.2 Gruppen (Party)
Max. 4 Spieler pro Gruppe (mehrere Gruppen pro Instanz möglich).
Einladen per Klick auf Spieler, per Spielerliste oder Chatbefehl /invite Name.
Gruppenvorteile: Markierung auf Minimap und Karte, Gruppenchat, Wegpunkt teilen, geteilter Quest-Fortschritt, Wiederbeleben, kein Friendly Fire.
Gruppen-Wegpunkt: Gruppenleiter setzt einen Wegpunkt, der für alle sichtbar ist.
16.3 Freunde
Freundesliste (Account-gebunden), Anfragen senden/annehmen.
Sichtbar: Online-Status, aktuelle Instanz, „Beitreten"-Knopf.
Einladungslinks: https://<domain>/join/<code> öffnet direkt die Instanz des Freundes.
16.4 Chat
Kanäle: Lokal (Nachrichten von Spielern im Umkreis von 50 m), Instanz (alle Spieler der Welt), Gruppe, Flüstern (/w Name).
Nachrichten erscheinen zusätzlich als kurze Sprechblase über der Spielfigur (Lokal/Gruppe).
Wortfilter (abschaltbar für sich selbst), Spieler stummschalten, melden.
Rate-Limit: max. 5 Nachrichten pro 5 Sekunden.
Chatbefehle: /invite, /kick (Gruppe), /w, /mute, /report, /pvp on|off, /help.
16.5 Emotes (M3)
Radialmenü (G): Winken, Tanzen, Daumen hoch, Achselzucken, Zeigen, Hinsetzen, Lachen.
16.6 Soziale Aktivitäten (M3)
Gruppen-Rennen mit Bestenlisten pro Strecke.
Kopfgeld-Modus: Spieler mit hoher Fahndungsstufe können freiwillig Kopfgeld auf sich setzen lassen; PvP-aktive Spieler können es einfordern.
Wöchentliche Bestenlisten (Geld verdient, Rennen gewonnen, Sammelobjekte).
17. UI & HUD
17.1 Stil
Retro-Handheld-Ästhetik: Pixel-Schrift für Überschriften (selbst erstellt oder freie Schrift), gut lesbare Schrift für Fließtext.
Abgerundete Panels mit dicken Rahmen in Zonen-Farben, leicht transparent.
„Zweiter Bildschirm"-Option: Minimap, Quest-Infos und Handy können in einem separaten Panel unten rechts angezeigt werden, angelehnt an einen zweiten Handheld-Bildschirm.
17.2 HUD-Elemente
Element	Position	Inhalt
Minimap	unten rechts	Spieler, Gruppenmitglieder, Quest-Ziele, Payphones, Läden, Polizei-Suchkreis; rotiert nicht (außer Kamera-Rotation aktiv)
Statusleiste	oben links	Gesundheit, Rüstung, Ausdauer
Geld	oben rechts	Bargeld, Änderungen als animierte +/−-Zahl
Fahndung	oben rechts unter Geld	0–4 Polizeimarken, blinkend während Suche
Waffe	unten links	Aktuelle Waffe, Munition
Quest-Ziel	oben Mitte	Aktuelles Ziel, Timer
Fahrzeug	unten Mitte (nur im Fahrzeug)	Fahrzeugname, Zustand, Tacho, Radiosender
Chat	links Mitte	Einblendung, verblasst nach 10 s
Benachrichtigungen	rechts Mitte	Gruppeneinladungen, Anrufe, Belohnungen
17.3 Menüs
Karte (M): Vollbildkarte mit Zoom, Legende, Filter, Wegpunkt per Klick.
Inventar (I): Waffenslots, Rucksack, Ausrüsten/Benutzen/Weitergeben.
Quest-Log (J): Aktive Quest, verfügbare Quests, abgeschlossene Quests, Story-Fortschritt.
Gang-Übersicht: Rufbalken pro Gang, Boss-Infos, Revierkarte (M3).
Handy (Taste T, M2): Kontakte (Gangs, Fahrzeug bestellen, Bestechung), Nachrichten, Kamera (M3), Einstellungen.
Gruppe (P): Mitglieder, Einladen, Verlassen, Wegpunkt.
Spielerliste (Tab gehalten): alle Spieler der Instanz mit Stufe, Gruppe, Ping.
Einstellungen: Grafik, Audio, Steuerung, Gameplay, Chat.
17.4 Onboarding
Startbildschirm: Logo, „Spielen", „Mit Freunden spielen", „Einstellungen".
Gäste-Modus in M1 (nur Name), Accounts ab M2. Gäste können ihren Fortschritt später in einen Account übernehmen.
Prolog-Quest als Tutorial mit kontextuellen Tastenhinweisen.
17.5 Barrierefreiheit
Farbenblind-Modi (3 Varianten) für Minimap und Gang-Farben.
Skalierbare UI (75–150 %).
Untertitel für alle Dialoge (Dialoge sind ohnehin Text).
Bildschirmwackeln, Blitzeffekte und Retro-Filter abschaltbar.
18. Technische Architektur
18.1 Technologie-Stack
Bereich	Technologie
Sprache	TypeScript (strict) für Client, Server und gemeinsamen Code
Client-Rendering	Three.js
Client-Build	Vite
UI	Leichtgewichtige DOM-UI (z. B. Preact oder Vanilla-TS-Komponenten) über dem Canvas
Audio	Web Audio API (optional Tone.js)
Server	Node.js (LTS) + Colyseus
Physik	Eigene vereinfachte 2,5D-Physik (Kollision auf der Ebene + Höhe), optional Rapier (WASM)
Datenbank	SQLite (Entwicklung) / PostgreSQL (Produktion) über ein ORM oder Query-Builder (z. B. Drizzle oder Kysely)
Validierung	Zod für Nachrichten, Quests, Konfiguration
Tests	Vitest (Unit/Integration), Playwright (E2E)
Monorepo	pnpm Workspaces
18.2 Architekturüberblick
┌──────────────── Browser (Client) ────────────────┐
│  Renderer (Three.js)  ·  UI  ·  Audio  ·  Input  │
│  Client-Prediction  ·  Interpolation             │
│  Zustand-Spiegel (Colyseus State)                │
└───────────────▲──────────────────┬───────────────┘
                │ State-Patches    │ Input-Nachrichten
                │ (WebSocket)      │ (WebSocket)
┌───────────────┴──────────────────▼───────────────┐
│                 Spielserver (Node.js)            │
│  Matchmaker / Lobby                              │
│  WorldRoom (1 pro Instanz, max. 16 Spieler)      │
│   ├─ Simulation (20 Hz): Bewegung, Fahrzeuge,    │
│   │   Kampf, NPCs, Polizei                       │
│   ├─ Quest-Engine                                │
│   ├─ Interest Management (Chunks)                │
│   └─ Persistenz-Service (asynchron)              │
└───────────────────────┬──────────────────────────┘
                        │
              ┌─────────▼──────────┐
              │  Datenbank         │
              │  (SQLite/Postgres) │
              └────────────────────┘
18.3 Netzwerkmodell
Autoritativer Server: Der Server entscheidet über Positionen, Schaden, Geld, Quests. Clients senden nur Eingaben.
Server-Tickrate: 20 Hz Simulation, State-Patches mit 20 Hz.
Client-Eingaben: bis zu 30 Hz, mit Sequenznummer und Zeitstempel.
Client-Side-Prediction für die eigene Figur und das eigene Fahrzeug, mit Reconciliation (Server-Zustand + erneutes Anwenden nicht bestätigter Eingaben).
Interpolation für alle anderen Entitäten mit 100 ms Puffer.
Lag-Kompensation für Treffer: Server prüft Treffer gegen Positionen zum Zeitpunkt der Eingabe (max. 200 ms zurück).
Interest Management: Clients erhalten nur Entitäten in einem Radius von ca. 150 m (bzw. umliegende Chunks). Gruppenmitglieder werden immer übertragen (für Minimap).
Bandbreitenziel: < 30 KB/s pro Client bei voller Instanz.
Ziel-Latenz: spielbar bis 150 ms Ping, optimal < 80 ms.
18.4 Nachrichten (Client → Server)
Nachricht	Inhalt
input	seq, Bewegungsvektor, Zielrichtung, Tasten-Bitmaske
interact	Zielentität/-objekt
enterVehicle / exitVehicle	Fahrzeug-ID, Sitz
chat	Kanal, Text
useItem / equip / giveItem	Slot, Ziel
questAccept / questAbandon	Quest-ID
party*	invite, accept, leave, kick, waypoint
shopBuy / shopSell	Laden-ID, Artikel, Menge
settings	PvP-Status etc.

Alle Nachrichten werden mit Zod validiert und rate-limitiert.

18.5 Server-Zustand (vereinfacht)
ts
class WorldState extends Schema {
  time: number;                       // Spielzeit in Minuten
  weather: string;
  players: MapSchema<PlayerState>;
  vehicles: MapSchema<VehicleState>;
  npcs: MapSchema<NpcState>;
  pickups: MapSchema<PickupState>;
  territories: MapSchema<TerritoryState>; // M3
}

class PlayerState extends Schema {
  id, name, color, x, y, z, rotation, animation,
  health, armor, vehicleId, seat, weapon, wanted,
  partyId, pvpEnabled, level
}

Private Daten (Inventar, Geld, Quest-Details) werden nicht im öffentlichen State, sondern per gezielter Nachricht nur an den jeweiligen Spieler gesendet.

18.6 Welt-Daten
Die Karte wird als Datendatei beschrieben (world/palmara.json oder TS-Module): Straßengraph, Gehweg-Graph, Wasserrouten, Zonen- und Viertelgrenzen, Gebäude-Grundrisse und -Höhen, Points of Interest, Payphones, Läden, Spawnpunkte.
Gebäude und Deko werden aus diesen Daten prozedural auf dem Client erzeugt (gleicher Seed → gleiche Welt).
Kollisionsdaten werden aus denselben Daten auf dem Server erzeugt.
Ein einfacher Karten-Editor (Debug-Overlay im Client, M2/M3) zum Platzieren von Payphones, Spawnpunkten und Quest-Orten mit Export als JSON.
18.7 Client-Architektur
Spielschleife: requestAnimationFrame, feste Logik-Schrittweite für Prediction (50 ms), Rendering interpoliert.
Entity-System: leichtgewichtiges ECS oder komponentenbasierte Klassen (Transform, Mesh, Animator, NetworkSync).
Chunk-Streaming: Nur Chunks im Umkreis werden gebaut; entfernte Chunks werden entsorgt (Geometrie wiederverwendet).
Asset-Erzeugung: Fahrzeug-, Figuren- und Gebäudegeneratoren mit Caching.
18.8 Server-Architektur
WorldRoom kapselt eine Instanz; Subsysteme als eigene Module mit klaren Schnittstellen: MovementSystem, VehicleSystem, CombatSystem, NpcSystem, TrafficSystem, PoliceSystem, QuestEngine, EconomyService, PartyService, ChatService.
Persistenz läuft asynchron und blockiert nie den Simulations-Tick.
Lobby-/Matchmaking-Raum für Instanzwahl, Freundesbeitritt und private Instanzen.
19. Datenmodell & Persistenz
19.1 Tabellen
Tabelle	Wichtige Felder
accounts	id, username (unique), password_hash, created_at, last_login, banned_until
characters	id, account_id, name, appearance (JSON), level, xp, health, armor, cash, bank, pos_x, pos_y, pos_z, zone, wanted (bei Logout auf 0), pvp_enabled, playtime_seconds
inventory_items	id, character_id, item_type, slot, quantity, data (JSON)
weapons	id, character_id, weapon_type, slot, ammo
reputation	character_id, gang_id, value
quest_progress	character_id, quest_id, status (available/active/completed/failed), stage, data (JSON), completed_at, cooldown_until
vehicles_owned	id, character_id, model, color, tuning (JSON), damage, garage_id, stolen (bool)
properties	id, character_id, property_id, purchased_at, cash_register
friends	account_id, friend_account_id, status, created_at
collectibles	character_id, collectible_id, found_at
transactions	id, character_id, amount, reason, created_at
reports	id, reporter_id, reported_id, reason, chat_excerpt, created_at
settings	account_id, data (JSON)
19.2 Speicherregeln
Automatisches Speichern alle 2 Minuten, beim Ausloggen, nach Quest-Abschluss, nach Käufen über 1.000 $.
Speichern geschieht transaktional (Geld + Inventar + Quest-Fortschritt gemeinsam).
Beim Verbindungsabbruch: Figur bleibt 30 Sekunden in der Welt (unverwundbar, ausgegraut), dann Speichern und Entfernen. Reconnect innerhalb dieser Zeit übernimmt die Figur nahtlos.
Migrationen versioniert (Migrations-Tool des ORM).
19.3 Accounts
Registrierung mit Benutzername + Passwort (min. 8 Zeichen), E-Mail optional (für Passwort-Reset ab M3).
Passwörter mit argon2id gehasht.
Sitzungen über signierte, HttpOnly-Cookies oder kurzlebige JWTs; WebSocket-Beitritt nur mit gültigem Token.
Gast-Accounts: lokal gespeicherte Gast-ID, in echten Account umwandelbar.
20. Sicherheit & Anti-Cheat
Server-Autorität: Geld, Inventar, Schaden, Quest-Fortschritt, Fahndung werden ausschließlich serverseitig berechnet.
Bewegungsprüfung: Server verwirft Positionen/Eingaben, die maximale Geschwindigkeiten überschreiten; wiederholte Verstöße führen zu Korrektur und Protokolleintrag.
Rate-Limits: für alle Nachrichtentypen (Chat, Interaktion, Käufe, Schüsse entsprechend Feuerrate).
Eingabevalidierung: alle Nachrichten per Zod-Schema, unbekannte Felder werden verworfen.
Transaktionsprotokoll: alle Geldbewegungen mit Grund; Anomalie-Erkennung (z. B. > 100.000 $ pro Stunde) markiert Accounts zur Prüfung.
Moderation: Melden-Funktion, Kick/Bann per Admin-Befehl (/admin kick|ban|tp|give, nur für Admin-Accounts), Wortfilter.
Web-Sicherheit: HTTPS/WSS in Produktion, CORS eingeschränkt, Secrets ausschließlich über Umgebungsvariablen, Abhängigkeiten regelmäßig per pnpm audit geprüft.
Datenschutz: minimale Datenerhebung, keine Weitergabe, Möglichkeit zur Account-Löschung (M3), Datenschutzhinweis auf der Startseite.
21. Performance-Budget
Kennzahl	Ziel
Bildrate	60 FPS auf Mittelklasse-Laptop mit integrierter Grafik (z. B. Intel Iris Xe) bei 1080p
Draw Calls	< 200 pro Frame
Dreiecke im Bild	< 300.000
Initialer Download	< 5 MB (gzip), keine großen Asset-Dateien
Zeit bis spielbar	< 10 s auf durchschnittlicher Verbindung
Arbeitsspeicher Client	< 500 MB
Server-Tick	< 15 ms pro Tick bei 16 Spielern und voller NPC-Last
Bandbreite	< 30 KB/s pro Client
Instanzen pro Server	mind. 4 volle Instanzen auf einem 2-vCPU/4-GB-Server

Techniken: Geometry-Instancing (Bäume, Laternen, Fenster), Texture-Atlas, gemeinsame Materialien, Level-of-Detail für entfernte Gebäude, Frustum Culling, Chunk-Streaming, Object-Pooling für Partikel und NPCs, Render-Scale-Option.

Ein integriertes Debug-Overlay (F3) zeigt FPS, Draw Calls, Ping, Tick-Zeit, Entitäten im Umkreis und Bandbreite.

22. Projektstruktur
sunstate-heat/
├─ package.json                 # pnpm Workspace-Root
├─ pnpm-workspace.yaml
├─ README.md
├─ CREDITS.md
├─ .env.example
├─ docs/
│  ├─ spec.md                   # dieses Dokument
│  ├─ architecture.md
│  └─ quests.md                 # Anleitung zum Schreiben neuer Quests
├─ packages/
│  ├─ shared/                   # gemeinsamer Code Client + Server
│  │  ├─ src/
│  │  │  ├─ balance.ts          # alle Zahlenwerte (Preise, Schaden, XP)
│  │  │  ├─ constants.ts
│  │  │  ├─ messages.ts         # Nachrichten-Schemas (Zod)
│  │  │  ├─ physics/            # gemeinsame Bewegungs-/Fahrzeuglogik (für Prediction)
│  │  │  ├─ items.ts
│  │  │  ├─ vehicles.ts         # Fahrzeugdefinitionen
│  │  │  ├─ weapons.ts
│  │  │  ├─ gangs.ts
│  │  │  └─ quests/             # Quest-Typen und -Schema
│  ├─ world/                    # Kartendaten
│  │  ├─ palmara.json
│  │  └─ src/                   # Kartenlader, Graphen, Chunk-Index
│  ├─ client/
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  └─ src/
│  │     ├─ main.ts
│  │     ├─ core/               # Game-Loop, Input, Einstellungen
│  │     ├─ net/                # Verbindung, Prediction, Interpolation
│  │     ├─ render/             # Szene, Kamera, Licht, Wasser, Tag/Nacht, Wetter
│  │     ├─ generators/         # prozedurale Gebäude, Fahrzeuge, Figuren, Vegetation
│  │     ├─ entities/
│  │     ├─ audio/              # Sounds, Radio
│  │     ├─ ui/                 # HUD, Menüs, Chat, Karte, Handy
│  │     └─ debug/              # Overlay, Karten-Editor
│  └─ server/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ rooms/              # LobbyRoom, WorldRoom
│     │  ├─ systems/            # Movement, Vehicle, Combat, Npc, Traffic, Police
│     │  ├─ quests/             # QuestEngine + Quest-Daten
│     │  ├─ services/           # Economy, Party, Chat, Persistence, Auth
│     │  ├─ db/                 # Schema, Migrationen
│     │  └─ admin/
│     └─ test/
└─ e2e/                         # Playwright-Tests
23. Deployment & Betrieb
23.1 Lokale Entwicklung
bash
pnpm install
cp .env.example .env
pnpm db:migrate
pnpm dev            # startet Client (Vite) und Server parallel
Client unter http://localhost:5173, Server unter ws://localhost:2567.
Freunde im selben Netzwerk können über die lokale IP beitreten; README erklärt das.
23.2 Produktion
Variante A (einfach): Ein Dienst wie Railway, Render oder Fly.io: Server-Container + verwaltete PostgreSQL-Datenbank, statischer Client auf demselben Dienst oder einem statischen Host (z. B. Cloudflare Pages, Netlify).
Variante B (günstig): Kleiner VPS (2 vCPU, 4 GB RAM) mit Docker Compose: Server, PostgreSQL, Reverse Proxy (Caddy) mit automatischem HTTPS.
Dockerfile und docker-compose.yml sind Teil des Repos.
Umgebungsvariablen: DATABASE_URL, SESSION_SECRET, PUBLIC_URL, MAX_INSTANCES, ADMIN_USERS, NODE_ENV.
23.3 Betrieb
Health-Check-Endpunkt /health.
Strukturierte Logs (JSON), Fehler-Logging für Client und Server.
Einfache Metriken: Spieler online, Instanzen, Tick-Zeit, Fehler.
Tägliches Datenbank-Backup.
Graceful Shutdown: Bei Neustart werden alle Spieler gespeichert und erhalten eine Vorwarnung im Chat (60 Sekunden).
24. Tests & Qualitätssicherung
24.1 Automatisierte Tests
Ebene	Inhalt	Werkzeug
Unit	Bewegungs-/Fahrzeugphysik, Schadensberechnung, Fahndungslogik, Ruf-Berechnung, Wirtschaft, Quest-Zielauswertung, Validierung	Vitest
Integration	WorldRoom mit simulierten Clients: Beitreten, Bewegen, Einsteigen, Quest abschließen, Geld erhalten, Speichern/Laden	Vitest + Colyseus-Testclient
Quest-Daten	Alle Quest-Definitionen werden gegen das Schema geprüft, Referenzen (Orte, NPCs, Items) müssen existieren	Vitest
Last	16 Bot-Clients pro Instanz, 4 Instanzen parallel, Tick-Zeit und Bandbreite messen	eigenes Bot-Skript
E2E	Startseite laden, Gast beitreten, bewegen, Chat senden	Playwright
24.2 Manuelle Testliste pro Meilenstein
Kurze Checkliste in docs/testing.md, was nach jedem Meilenstein von Hand zu prüfen ist (z. B. „Zwei Browserfenster öffnen, beide Spieler sehen sich, gemeinsam in ein Auto steigen").
24.3 Code-Qualität
TypeScript strict, ESLint, Prettier, CI-Pipeline (GitHub Actions) mit Lint, Typprüfung, Tests bei jedem Push.
25. Meilensteine & Abnahmekriterien
Meilenstein 1 – Spielbarer Koop-Prototyp

Inhalt

Monorepo, Build, Dev-Setup.
Verkleinerte Karte mit allen 4 Zonen angedeutet, prozedurale Gebäude, Wasser, Vegetation, Tag-Nacht-Zyklus.
Kamera nach Abschnitt 4.2.
Laufen, Sprinten, Einsteigen/Aussteigen; 4 Fahrzeuge (Kompakt, Sportwagen, Motorrad, Airboat).
Multiplayer mit bis zu 16 Spielern, Prediction und Interpolation.
Einfacher NPC-Verkehr und Passanten.
Minimap, Text-Chat (Lokal/Instanz), Gäste-Login mit Namen.
Eine Koop-Quest (Q01 „Frische Ware").

Abnahme

Zwei Browser können derselben Welt beitreten, sehen sich flüssig bewegen (bei 100 ms simuliertem Ping ohne sichtbares Ruckeln).
Spieler kann alle 4 Fahrzeugtypen benutzen, Airboat fährt auf Wasser und Sumpf.
Q01 lässt sich solo und zu zweit abschließen.
60 FPS auf Referenz-Laptop.
Meilenstein 2 – Fortschritt & lebendige Welt

Inhalt

Bestandsaufnahme und Bugfixing von M1.
Accounts, Login, Speicherstände (Abschnitt 19).
Geld, Inventar, Läden (Sunmart, Ammo & Ammo, Threads & Shades, Paint & Pray).
Kampf mit Nahkampf, Pistole, Maschinenpistole, Schrotflinte.
Fahndungssystem Stufen 1–3 mit Polizei-KI.
4 Gangs mit Ruf-System, Gang-NPCs mit rufabhängigem Verhalten.
Datengetriebene Quest-Engine mit allen Ziel-Typen außer photograph, Payphones, Quest-Log.
Beispielquests Q01–Q08.
Gruppen-System, Gruppenchat, Wiederbeleben.
10 Fahrzeuge, Fahrzeugschaden.
Spielerstufen und XP.
Deployment-Anleitung und Docker-Setup.

Abnahme

Nach Logout und Login sind Position, Geld, Inventar, Ruf und Quest-Fortschritt erhalten.
Alle 8 Beispielquests sind abschließbar; Koop-Quests geben allen Teilnehmern Belohnungen.
Fahndung steigt durch Verbrechen, Polizei verfolgt, Abschütteln und Lackierwerkstatt funktionieren.
Gang-Ruf ändert NPC-Verhalten sichtbar.
Spiel läuft online, Freunde können per Link beitreten.
Automatisierte Tests für Wirtschaft, Quests, Fahndung, Ruf grün.
Meilenstein 3 – Inhalte & Feinschliff (Version 1.0)

Inhalt

Vollständige Karte in Endgröße mit allen Vierteln und Orten aus Abschnitt 3.
Wetter-System, Fahndungsstufe 4.
Prozedurales Audio, 4 Radiosender.
Alle Waffen, 18+ Fahrzeuge, Tuning, Fahrzeugkauf und Garagen.
Immobilien und Geschäfte.
Vollständige Story (Prolog + 3 Akte, 28 Missionen, 4 Enden).
Alle Nebenaktivitäten, Sammelobjekte, Sprungschanzen, Zufallsereignisse.
Gang-Reviere und Revierkämpfe, Kopfgeld-Modus, Rennen mit Bestenlisten.
Freundesliste, private Instanzen, Einladungslinks, Emotes, Handy mit Kamera.
Barrierefreiheit, Einstellungen, Admin-Werkzeuge, Moderation.
Lasttests mit 4 × 16 Bots.

Abnahme

Story von Anfang bis zu jedem der 4 Enden durchspielbar.
Alle Performance-Ziele aus Abschnitt 21 erfüllt.
4 volle Instanzen stabil auf einem 2-vCPU-Server über 2 Stunden ohne Absturz oder Speicherleck.
Keine Rockstar-/GTA-Namen oder -Assets im Projekt (Prüfung per Suchskript gegen eine Liste verbotener Begriffe in CI).
Nach Version 1.0 (Ideen, nicht verbindlich)
Fluggeräte (Wasserflugzeug, Hubschrauber).
Weitere Zonen (z. B. eine Raumfahrt-Küste, Nachbarstaat).
Mobile-Steuerung mit Touch.
Saisonale Events (Hurrikan-Saison, Spring Break).
Clan-System über Gruppen hinaus.
26. Nicht im Umfang & Risiken
26.1 Nicht im Umfang von Version 1.0
Mehr als 16 Spieler pro Instanz, nahtlose Welt über mehrere Server.
Echtgeld-Käufe, Werbung.
Sprachchat.
Native Apps / Mobile-Steuerung.
Fluggeräte mit eigenem Gameplay.
Benutzergenerierte Inhalte (außer internem Karten-Editor).
26.2 Risiken & Gegenmaßnahmen
Risiko	Gegenmaßnahme
Umfang zu groß	Strikte Meilensteine, jeder Meilenstein ist für sich spielbar; Features aus M3 notfalls in spätere Versionen verschieben
Netzwerk-Ruckeln bei Fahrzeugen	Gemeinsame Physik in shared/ für exakte Prediction, früh mit simuliertem Ping testen
Server-Last durch NPCs	Interest Management, NPC-Simulation nur nahe Spielern, Lasttests ab M2
Performance auf schwachen Geräten	Performance-Budget von Anfang an, Render-Scale, Debug-Overlay
Rechtliche Probleme durch Nähe zu GTA	Abschnitt 2 strikt einhalten, CI-Prüfung auf verbotene Begriffe, eigene Kartengestaltung
Cheating	Server-Autorität, Validierung, Transaktionsprotokoll
Toxisches Verhalten	PvP standardmäßig aus, Wortfilter, Stummschalten, Melden, private Instanzen
27. Glossar
Begriff	Bedeutung
Instanz	Eine Kopie der Spielwelt mit bis zu 16 Spielern
Chunk	64 × 64 m großer Kartenabschnitt für Streaming und Netzwerk-Filterung
Payphone / Missionstelefon	Telefonzelle in der Welt, über die Aufträge angenommen werden
Fahndungsstufe	0–4 Polizeimarken, bestimmt Stärke der Polizeireaktion
Ruf	Wert −100 bis +100 pro Gang
Prediction	Client berechnet eigene Bewegung sofort voraus, statt auf den Server zu warten
Reconciliation	Abgleich der vorausberechneten Bewegung mit dem Server-Zustand
Interpolation	Weiche Darstellung anderer Entitäten zwischen zwei Server-Zuständen
Interest Management	Server sendet jedem Client nur Daten aus seiner Umgebung
Autoritativer Server	Server hat das letzte Wort über den Spielzustand
Gruppe / Party	Bis zu 4 Spieler, die gemeinsam spielen und Quests teilen