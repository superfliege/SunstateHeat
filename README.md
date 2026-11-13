# Sunstate Heat – Prototyp (Meilenstein 1)

Browser-Multiplayer-Open-World im Top-Down-Stil, angesiedelt im fiktiven US-Bundesstaat **Palmara**.
Die meisten Grafiken werden im Code erzeugt (Low-Poly + Pixel-Texturen). Dazu kommen freie CC0-Modelle und -Sounds
von KayKit, Kenney und Quaternius (Kenney City Kits für Hochhäuser, Geschäfts-, Wohn- und Industriebauten, Car Kit,
Watercraft, Blaster Kit, Nature Kit, Impact-/Interface-Sounds; Quaternius Stylized Nature) – siehe [CREDITS.md](CREDITS.md).

## Starten

Voraussetzung: **Node.js 20 LTS oder neuer** (https://nodejs.org).

```bash
npm install
npm run dev
```

Danach öffnest du **http://localhost:5173**, gibst einen Namen ein und spielst.

Die externen Assets liegen bereits unter `client/public/assets/`. Fehlen sie, lädt `npm run assets` sie neu aus
GitHub-Repositories (feste Commits). Ohne sie läuft das Spiel trotzdem – dann mit prozeduralen Ersatzmodellen und ohne Sound.
`npm run dev` startet zwei Prozesse gleichzeitig: den Spielserver (Port 2567) und den Vite-Client (Port 5173).

### Freunde beitreten lassen

- **Gleiches WLAN/LAN:** Der Server zeigt beim Start `LAN-Adresse: 192.168.x.y`. Freunde öffnen
  `http://192.168.x.y:5173`. Eventuell musst du in der Windows-Firewall den Zugriff für Node.js erlauben.
- **Über das Internet:** Weil Vite die WebSocket-Verbindung (`/ws`) an den Server weiterleitet, reicht **ein** Port.
  - Variante A: Tunnel, z. B. `npx cloudflared tunnel --url http://localhost:5173` (oder ngrok). Dann den angezeigten
    `https://…`-Link teilen.
  - Variante B: Port 5173 im Router weiterleiten und die öffentliche IP teilen.
- **Produktionsmodus** (schneller, nur ein Prozess): `npm run build` und danach `npm start`. Das Spiel läuft dann auf
  **http://localhost:2567**; teilen kannst du entsprechend Port 2567.

## Steuerung

| Taste | Aktion |
|---|---|
| WASD / Pfeiltasten | Laufen bzw. Gas, Bremse/Rückwärts (S) und Lenken; in der Luft: W/S neigen, A/D drehen |
| Shift | Sprinten, im Auto Nitro (Sport- und Muscle-Cars); im Luftfahrzeug **Steigen** (Flugzeug: ab Abhebegeschwindigkeit abheben) |
| E | Ein- und aussteigen (auch NPC-Autos übernehmen); nach 3 s auf dem Dach: aufrichten |
| Leertaste | Handbremse (blockiert die Hinterräder -> Drift); im Luftfahrzeug **Sinken** bzw. Radbremse am Boden |
| Q / R | Helikopter: seitwärts links / rechts |
| H | Hupe |
| Enter | Chat öffnen und senden (Esc bricht ab) |
| M | Große Karte |
| F3 | Debug-Overlay mit Tabs (Tab-Taste wechselt): **Karte** (Straßengraph, Blöcke, Grundstücke, Viertel – Ziehen/Mausrad, C = Spieler, 1–6 = Ebenen) **Fahrzeug** (Tempo, Drehzahl, Gang, Federweg/Last/Schlupf je Rad, Kraftpfeile am Auto) und **NPC** (Dev: Archetyp, Absichtskette, Bedürfnisse, Smart Object, Reaktion, wahrgenommene Ereignisse als Kreise; Knöpfe zum Erzwingen von Tageszeit/Wetter) |
| F4 | Nur Dev-Modus: Live-Tuning-Panel (Handling-Werte, Arcade-Hilfen, Kamera; Export als JSON) |
| F7 | Bildschirmwackeln an/aus |
| F8 | Grafikqualität: Hoch / Mittel (Schatten 1024², Szene max. Pixel-Ratio 1,0 – Standard auf integrierter Grafik) / Niedrig (ohne Schatten, 75 % Render-Scale). Inhalte, Umrisslinien und Bloom bleiben in allen Stufen; dynamische Auflösung hält ~60 FPS. Auch per `?preset=mittel`. Details: `docs/performance-report.md` |
| F9 | Retro-Modus: Render-Scale 0,6 mit harter Pixel-Hochskalierung (auch per `?retro=1`) |
| Gamepad | Linker Stick, RT/LT = Gas/Rückwärts, A = Einsteigen, B = Sprint/Nitro, X = Handbremse, Y = Hupe; Vibration nach Schlupf und Aufprall; Luftfahrzeuge: RB/LB = Steigen/Sinken, rechter Stick = seitwärts |

**Dev-Chatbefehle** (nur `npm run dev`): `/test` (ins Testgelände), `/laden <sunmart|gas|ammo|paint>` (reihum vor die Läden), `/auto <kompakt|limousine|kombi|taxi|sport|muscle|suv|pickup|lkw|motorrad>`, `/rennen <1-3>` (zum Renntelefon), `/taxi` (zum Catch-the-Taxi-Telefon), `/reparieren`, `/feuer`, `/zeit <0-24>`, `/pop <morgen|mittag|nachmittag|abend|nacht|auto>` (Population Table erzwingen), `/wetter <klar|regen|hitze>`, `/ort <x> <z>`, `/tp <viertel|flughafen>`, `/fahndung <0-4>`, `/flug <sunbird|marlin|kolibri|pelikan>` (Luftfahrzeug neben dir, du sitzt am Steuer), `/tanken`, `/flotte` (Flughafen-Flotte zurücksetzen), `/hoehe` (Höhe, Stufe, Tempo, Tank).

**NPC-Lasttest:** `npx tsx scripts/npc-bench.ts [Sekunden] [morning|noon|afternoon|evening|night]` – 16 Spieler im Ocean Strip, misst Tick-Zeit, Bandbreite und zählt Szenarien/Ausgänge/Reaktionen/Barks (`PROF=1` zeigt die langsamsten Aufrufe).

**Straßenrennen** (`shared/src/races.ts`, `server/src/quests/Races.ts`): dreizehn beliebig oft wiederholbare Rennen (Downtown Dash, Brickell Hills Loop, Havana Heights Circuit und Ocean Strip Cruise mit je 2 Runden, alle übrigen als Sprints, z. B. Cane Ridge Rally, Northgate Freight Run, Port Sabal Dash und Raffinerie Rush), Start am 🏁-Renntelefon. Immer 5 Starter: bis zu 4 Spieler, den Rest füllen KI-Fahrer auf (gleiche Fahrphysik, leichtes Gummiband). Startet jemand und andere Spieler stehen im Umkreis von 60 m, bleibt die Anmeldung 15 s offen (am selben Telefon beitreten). Jeder bekommt ein ausgelostes Fahrzeug. Checkpoints erscheinen als Ringe wie bei GTA (aktueller Ring plus der nächste). Preisgeld und XP gibt es je nach Platz.

**Catch the Taxi** (`shared/src/taxiHunt.ts`, `server/src/quests/TaxiHunt.ts`): Spielmodus direkt am Spawn (🚕-Telefon, E drücken). Spieler im Umkreis von 70 m können 15 s lang beitreten (bis zu 13 Spieler). Einer wird per Los zum Taxi, alle anderen jagen es in LKWs; freie Plätze füllen KI-Trucker auf (12 Jäger, folgen dem Straßennetz). Das Taxi hat unendlich Nitro (Shift), 4 s Vorsprung und darf mit der Pistole aus dem Fenster schießen (Munition frei); Jäger dürfen nicht schießen, nur rammen (Rammstöße der LKWs setzen dem Taxi stärker zu). Überlebt das Taxi 2 Minuten, gewinnt der Taxifahrer; brennt es vorher, gewinnen die Jäger. Zerstörte LKWs kommen nach 3 s neu ins Spiel. Während der Runde gibt es keine Fahndung und keine Verletzungen, niemand kann aussteigen. Danach stehen alle wieder am Telefon.

**Minispiele** (`shared/src/minigames/`, `server/src/minigames/`, Details in `docs/minigames.md`): Arena-Modi, jeder an 2–5 über die Karte verteilten Arena-Telefonen (große Karte M: Symbole mit Tooltip), mit Spielern, NPCs oder gemischt; auch während eines laufenden Auftrags startbar (der Auftrag wird dann abgebrochen); alle Werte in JSON-Configs. Modi: **Sumo** (Plattform über dem Meer, schrumpft), **Destruction Derby** (Crash-Bowl, Zonenschaden), **Hot Potato** (Bombe per Rammen weitergeben), **Fallout** im Auto und zu Fuß (verschwindende Kacheln), **Drift-Wettbewerb** (Combo-Wertung), **Bomb Bus** (Mindesttempo in der Stadt, Jäger mit Straßensperren). Dev: `/mg <modus> [anzahl] [leicht|normal|schwer]` (nur NPCs, zuschauen), `/mg <modus> mit`, `/mg stop`.

## Was drin ist

- **Welt:** Halbinsel auf 2 × 2 km mit 7 Zonen und den Biomen Großstadt, Wüste, Ödland, Sumpf, Wald und Gebirge:
  **Pinecrest Highlands** (Gebirge mit Gipfel und Bergkamm, Wald, Ödland an der Nordküste), **Port Sabal**
  (Hafenstadt an Bucht und Fluss in der Wüste, Flugfeld), **Cane Ridge** (Zuckerrohrstadt am großen See, Raffinerie),
  **Dry Pine Country** (Wald, Waldsiedlung, Plantagen, Tankstelle, Trailerpark), **Port Coralia** (Downtown mit
  Hochhäusern, Strandinsel mit Art déco und Neon, Hafeninsel, Flughafen), **Gator Flats** (Sumpf, Kanäle,
  Mangroven, Airboat-Städtchen) und **Coral Keys** (Inselkette mit langen Brücken bis Sunset Key mit Flugfeld).
- **Fahren (Kernmechanik):** Raycast-Fahrzeugphysik im shared-Paket (Client und Server rechnen identisch, 60 Hz mit
  2 Unterschritten): vier Räder mit Federung, Dämpfung, Stabilisator und sichtbarem Ein-/Ausfedern, tiefer und leicht
  vorverlagerter Schwerpunkt, echte Massen (Kompakt 1.100 kg … Lkw 8.000 kg), Wanken und Nicken. Reifen mit
  Schlupfkurve je Achse, Gewichtsverlagerung und Untergrund-Grip, Drehmomentkurve, 4–6-Gang-Automatik mit
  Zugkraftunterbrechung, Front-/Heck-/Allradantrieb, Handbremsen-Drifts. Arcade-Hilfen und alle Handling-Profile
  stehen in **shared/src/sim/handling.ts** (Balancing-Datei).
- **Crashs und Schaden:** impulsbasierte Kollisionen mit Masse, Blechverformung um den Kontaktpunkt (Fahrgastzelle
  geschützt), abfallende Teile (Trümmer 30 s), splitternde Scheiben, kaputte Scheinwerfer, platzende Reifen
  (Nagelband), Motor- und Achsschaden, Rauch -> Feuer -> Comic-Explosion. Werkstätten (Tankstellen, Testgelände)
  reparieren alles. Motorradfahrer und Fußgänger fliegen bei harten Treffern im Comic-Stil davon.
- **Zerstörbare Umgebung:** Laternen, Hydranten, Mülltonnen, Bänke, Zeitungsautomaten, Kegel, Strandliegen; Palmen
  wackeln. Respawn nach 2 Minuten außerhalb der Sicht.
- **Juice:** Tempo-Kamera mit Shake und Hit-Stop, prozedurales Fahrzeug-Audio, Bremsspuren, Qualm, Staub, Spritzer,
  Funken, Brems-/Rückfahrlicht, Nitro mit FOV-Effekt. Boni für Drifts, Sprünge und Beinahe-Unfälle.
- **Testgelände** (Pinecrest Highlands, Dev: `/test`): Drift-Pad mit Slalom, Rundkurs, Rampen, Sand/Schotter/Schlamm,
  Nassfläche, Nagelband, Crash-Mauern und je ein Fahrzeug jeder Klasse.
- **Weitere Fahrzeuge:** Boot und Airboat mit eigenem Arcade-Modell; Autos und Motorrad sind prozedurale Modelle je Klasse.
- **Organische Weltgenerierung:** Küsten, Inseln, Kanäle und Sumpfgrenzen sind ausgefranste Polygone; Straßen sind
  Catmull-Rom-Splines (Highway, Hauptstraße, Nebenstraße, Schotterweg, Steg) mit Fahrbahnmarkierungen, Bordsteinen,
  abgerundeten Kreuzungen (auch schräg, 3–5 Arme) und Kreisverkehren. Jedes Viertel hat ein eigenes, gedrehtes Raster;
  Blöcke entstehen aus den Flächen zwischen den Straßen und werden in Grundstücke geteilt, Gebäude stehen mit der
  Front zur Straße. Vegetation per Poisson-Disk-Verteilung, welliges Gelände in Dry Pine Country.
- **NPCs:** Verkehr auf Fahrspuren des Spline-Graphen (Kreisverkehre, bremst vor Hindernissen) und Fußgänger auf den
  Gehwegen, die schnellen Autos ausweichen.
- **Multiplayer:** autoritativer Server, Client-Side-Prediction mit Reconciliation, Interpolation der anderen
  Entitäten, bis zu 16 Spieler pro Instanz. Ist eine Instanz voll, wird automatisch eine neue geöffnet.
- **Minimap** im DS-Stil, **Chat** und **Tag-Nacht-Zyklus** (8 Minuten) mit leuchtenden Fenstern und Neon bei Nacht.
- **Koop-Quest „Heiße Ware“:** Wer den gelben Marker am Hafenkai betritt, startet sie für alle. Jeder trägt ein
  Paket; das Team muss 2–5 Pakete (je nach Spielerzahl) in 5 Minuten zum Trailerpark bringen.

## Architektur

```
shared/src/            Von Client UND Server genutzt (gleiche Ergebnisse auf beiden Seiten)
  constants.ts         Kartengröße, Tick-Raten, Farben
  protocol.ts          Netzwerk-Nachrichten (kompakte Tupel)
  math.ts              Seeded RNG, Noise, Winkel-Helfer
  world/palmara.ts     Kartendatei: Küsten, Inseln, Flüsse, Viertel (Winkel, Blockgröße), Hauptachsen als Kontrollpunkte
  world/mapgen.ts      Ablauf der Generierung + Rasterung für Kollision, Chunk-Index, Spawns
  world/terrain.ts     Land/Wasser, Strände (Distanzfeld), Biome, Höhenfeld
  world/roads.ts       Spline-Straßengraph, Viertelraster, Planarisierung, Kreuzungsgeometrie, Fahrspuren
  world/city.ts        Blöcke (Flächen des Graphen), Grundstücke, Gebäude, Straßenrandbebauung
  world/vegetation.ts  Poisson-Disk-Vegetation (nur Client)
  world/WorldMap.ts    Datenmodell; tiles.ts = Untergrundtypen
  sim/                 Bewegung zu Fuß und Fahrzeugphysik (identisch für Prediction und Server)

server/src/
  index.ts             HTTP + WebSocket (/ws), liefert im Prod-Modus den gebauten Client aus
  rooms/RoomManager.ts Verteilt Spieler auf Instanzen (je max. 16)
  rooms/WorldRoom.ts   Autoritative Simulation: Eingaben, Kollisionen, Snapshots (20 Hz), Chat
  sim/Traffic.ts       NPC-Verkehr (Wegpunkte auf dem Straßengraph)
  sim/Pedestrians.ts   Fußgänger
  quests/              Quest-Schnittstelle + QuestSystem + DeliveryQuest
  services/PlayerStore Platzhalter für Accounts/Speicherstände (aktuell im Arbeitsspeicher)
  entities/types.ts    Server-Entitäten + Connection-Abstraktion

client/src/
  main.ts              Login -> Verbindung -> Spiel
  game/Game.ts         Spielschleife (fester Simulationsschritt, Senden, Rendern)
  game/EntityViews.ts  3D-Objekte für Spieler, Fahrzeuge, NPCs, Pakete, Marker
  net/                 WebSocket, Prediction/Reconciliation, Snapshot-Interpolation
  render/              Weltaufbau (wenige Draw-Calls), Modelle, Kamera, Himmel, Post-Processing, Partikel
  render/palette.ts    ZENTRALE Farbdatei: Master-Palette, Zonenstimmung, Tageszeit-Verlauf
  render/materials/    Toon-Shading + Umrisslinien (toon.ts), Materialbibliothek mit gemalten
                       Pixeltexturen (library.ts), Atlas, Gelände-, Oberflächen- und Wasser-Shader
  render/assets.ts     Lädt die Kit-Modelle (KayKit/Kenney) und gleicht sie an die Palette an
  render/quaternius.ts Findet und vereinheitlicht die Quaternius-Packs (Vegetation, Figuren)
  render/characters.ts Modulare, animierte Passanten (zonenspezifische Kleidung, Animations-LOD)
  preview.html         Render-Vorschau ohne Server (nur Dev): /preview.html?district=Ocean%20Strip&day=0.72
  audio/               Audio-Engine (Busse, 3D, Hall, Voice-Limit), Manifest, Fahrzeug-Audio, prozedurale Synthese
                       (Rohdateien: assets-src/audio/, Pipeline: npm run audio, siehe assets-src/audio/README.md)
  public/assets/       Externe CC0-Assets (siehe CREDITS.md)

scripts/fetch-assets.mjs  Lädt die CC0-Assets aus den offiziellen Repositories (npm run assets)
scripts/process-textures.ts  Macht aus CC0-Fototexturen Pixeltexturen in Zonenpalette (npm run textures,
                       Konfiguration: assets-src/textures/textures.json – Format siehe Kopf der Datei)
  input/Input.ts       Tastatur + Gamepad
  ui/                  Minimap, Chat, HUD
```

**Netcode in Kürze:** Der Client simuliert jede Eingabe sofort lokal in festen 1/60-s-Schritten und sendet sie
gebündelt (~30×/s) an den Server. Der Server wendet sie mit demselben Code an und schickt 20× pro Sekunde einen
Snapshot inklusive `ack` (letzte verarbeitete Eingabe). Der Client setzt sich auf den Serverzustand zurück, spielt
alle unbestätigten Eingaben erneut ab und glättet kleine Abweichungen weich aus. Andere Spieler und NPCs werden
etwa 110 ms in der Vergangenheit zwischen zwei Snapshots interpoliert.

**Transport:** Statt Colyseus kommt ein schlanker eigener Server auf Basis von `ws` zum Einsatz. Die Spiellogik
kennt nur die `Connection`-Schnittstelle, sodass sich der Transport später austauschen lässt.

**Koordinaten:** x = Osten, z = Süden (Norden ist auf dem Bildschirm oben). Für die Fahrtrichtung gilt
vorwärts = (sin a, cos a). Die Karte misst 2048 × 2048 m. Kollision und Untergrund liegen auf einem 2-m-Raster, das
aus denselben Vektordaten gerastert wird wie die Grafik; Chunks (64 m) indizieren Straßen, Gebäude und Grundstücke.

### Vorbereitet für später

- **Accounts und Speicherstände:** `PlayerStore` gegen eine Datenbank-Implementierung tauschen; `PlayerProfile`
  enthält bereits `money`, `reputation` (Gang-Ruf) und `inventory`.
- **Mehr Quests:** neue Klasse mit `Quest` implementieren und in `WorldRoom` per `quests.register(...)` anmelden.
- **Fahndungslevel:** als weiteres Feld am `ServerPlayer` und im Snapshot ergänzen.
- **Mehrere Server-Instanzen:** `RoomManager` erzeugt sie bereits automatisch; für mehrere Prozesse oder Rechner
  käme ein Matchmaker davor.

## Fortschritt M2 (Stand: Fundament)

Umgesetzt aus der Spec (Meilenstein 2):

- **Konten & Gäste** (Spec 19.3): Name + Passwort (min. 8 Zeichen) legt ein Konto an bzw. meldet an; ohne Passwort spielt man
  als Gast (lokale Gast-ID im Browser). Registrierung übernimmt den Gast-Fortschritt. Passwörter: scrypt (statt argon2id).
- **Speicherstände** (Spec 19.2): `data/players.json` (Umgebungsvariable `DATA_DIR`) – Geld, Bank, XP, Gesundheit, Rüstung,
  Ruf, Position. Autosave alle 2 min, beim Logout, nach Quest-Abschluss, bei Käufen > 1.000 $ und beim Herunterfahren.
  Transaktionsprotokoll in `data/transactions.jsonl` mit Anomalie-Warnung.
- **Gesundheit, Knockout, Respawn** (Spec 7.2/7.3): Unfälle, Überfahren und Explosionen verletzen; bei 0 HP 15 s ausgeknockt,
  danach Respawn mit 10 % Bargeldverlust (max. 1.000 $). Regeneration bis 30 HP.
- **XP & Stufen** (Spec 7.4): Quest-Belohnungen und Stunt-Boni; HUD links oben.
- **Daten für die nächsten Schritte:** `shared/src/balance.ts`, `gangs.ts`, `weapons.ts`, `items.ts`.

Dev-Chatbefehle zusätzlich: `/hurt [n]`, `/xp [n]`, `/geld [n]`.

**Noch offen (M2):** Läden/Inventar, Kampf mit Waffen, Fahndung + Polizei-KI, Gang-NPCs mit Ruf-Verhalten, datengetriebene
Quest-Engine (Q02–Q08), Gruppen/Wiederbeleben, 10 Fahrzeuge, Docker/Deployment. Danach M3.

### Kampf (M2, Schritt 2)

- **Steuerung:** linke Maustaste angreifen (Zielrichtung = Mauszeiger), **1–5** oder Mausrad Waffe wählen, `/pvp on|off`.
  Zu Fuß; Drive-by folgt später.
- **Server-autoritativ:** Feuerrate, Munition, Treffer (Strahl mit Streuung, Wandprüfung, Zielhilfe 15°, Nahkampf-Bogen,
  Flächenschaden für Molotow/Rakete). Passanten fliehen bei Schüssen, fallen bei 0 HP um und verschwinden (Beute 5–40 $).
- **PvP** standardmäßig aus; nur zwei PvP-aktive Spieler verletzen sich.
- Waffen und Munition werden im Profil gespeichert (ein Slot je Klasse). Bis die Läden fertig sind: `/waffe <id|alle>` (Dev).

### Läden, Fahndung, Polizei (M2, Schritt 3)

- **Läden** sind begehbar: Man geht durch die Tür hinein, Dach und obere Wände fahren weg (Cutaway) und geben den
  Blick auf die Einrichtung frei. Eingekauft wird im **Gespräch mit dem Verkäufer** hinter der Theke (davor stehen,
  F: Begrüßung, dann *Einkaufen* / *Was gibt's Neues?* / *Tschüss*, Tasten 1–3). *24/7 Sunmart* (Supermarkt: Kühlregale,
  Regalgänge, Kasse; Essen, Verbandskasten), *Gas & Go* (Tankstellen-Shop, ersetzt das massive Shop-Gebäude der
  Tankstelle; Snacks, Energydrinks), *Ammo & Ammo* (Glasvitrine, Gewehrwand; Waffen, Munition, Westen),
  *Paint & Pray* (Mechaniker an der Werkstatt, auch aus dem Auto ansprechbar; Reparatur, Umlackieren).
  Läden stehen an der Straße (Tür zur Fahrbahn, parallel zum Straßenverlauf); Wände, Theken und Regale blockieren
  zu Fuß als gedrehte Rechtecke (`map.furniture`, gemeinsame Simulation), für Fahrzeuge sind die Kacheln darunter massiv. Standorte und Einrichtung bestimmt
  die Weltgenerierung (`placeShops`/`STORE_FURNITURE` in `shared/src/shops.ts`), gezeichnet von
  `client/src/render/StoresView.ts`. Der Server prüft Abstand zum Verkäufer, Stufe (Waffen-Freischaltung), Geld und Rucksackplatz.
- **Inventar** (I): Waffen ausrüsten, Gegenstände benutzen (8 Rucksack-Slots).
- **Waffenmodelle** in der Hand, Schlag-Schwung und Rückstoß; **Fahrzeugschaden** durch Schüsse (Brand/Explosion bei 0 HP);
  **Drive-by** mit der Pistole (nicht nach hinten).
- **Fahndung 1–3** mit Zeuge-Prinzip (Polizist sofort, Passant in 30 m mit Sichtlinie nach 3 s), Streifen zu Fuß (ab Stufe 2
  mit Schüssen), Streifenwagen mit Lichtbalken, **Festnahme** (zu Fuß still stehen), **Abschütteln** (20/35/60 s ohne Kontakt),
  **Lackierwerkstatt** (250 $, nicht bei Sichtkontakt). Dev: `/fahndung <0-3>`.

### Gangs, Ruf, Quest-Engine (M2, Schritt 4)

- **Quest-Engine** (`server/src/quests/QuestEngine.ts`): Quests sind Daten (`shared/src/questData.ts`, Schema/Typen in
  `shared/src/quests.ts`, Orte in `questLocations.ts`). Alle 13 Zieltypen außer `photograph`/`chase` (chase = defeat).
  Koop: alle Spieler im Umkreis von 50 m beim Start nehmen teil, jeder bekommt die volle Belohnung. `validateQuests`
  prüft Referenzen (Orte, Telefone, Voraussetzungen).
- **Q01–Q08** als Daten, Auftragsgeber sind **Missionstelefone** (gelbe Markierung, **F**). **J** = Quest-Log, Zielmarkierungen
  in der Welt und auf der Minimap, Quest-Anzeige oben rechts. Dev-Modus ignoriert die Mindestspielerzahl bei Koop-Quests;
  `Neonnacht`/`Leuchtfeuer` gibt es nur nachts.
- **Gangs & Ruf:** Gang-NPCs patrouillieren in ihrem Revier (Port Coralia = Neon Syndicate, Coral Keys = Marlin Club,
  Gator Flats = Mangrove Kings, Dry Pine = Dustline Haulers). Verhalten nach Ruf: Erzfeind greift auf Sicht an, Feindlich
  unter 10 m, Neutral ignoriert (wehrt sich nach Angriff, Ruf −5), Freundlich/Vertraut hilft gegen die Polizei.
  Ruf-Übersicht im Inventar (**I**), Quests verändern den Ruf (Gang +, Rivale −).
- Quest-Fortschritt (erledigt, Abklingzeiten) und Ruf werden im Profil gespeichert.

### Lebendige Passanten (NPC-System, Schritte 1–2)
- **Population Tables** (`shared/src/npc/population.ts`): Dichte, Archetyp-Mischung und Szenario-Anteil je Viertel und Tageszeit (bisher Ocean Strip).
- **Smart Objects & Szenarien** (`shared/src/npc/scenarios.ts`, `shared/src/world/smartObjects.ts`): Bänke, Haltestellen, Taco-Stand, Geldautomat, Liegen, Club-Schlange, Café, Basketball, Türen …
- **Mini-Lebenszyklus** (`shared/src/npc/intents.ts`, `server/src/sim/NpcBrain.ts`): Absichtsketten aus 2–4 Schritten je Archetyp/Tageszeit, Bedürfnisse (Hunger, Langeweile, Müdigkeit, Ziel) als Utility, Wege über das Gehweg-Netz, Abgang durch Türen, zum Bus oder im geparkten Auto (das dann losfährt und außer Sicht zurückparkt).
- **Wahrnehmung & Reaktionen** (`shared/src/npc/reactions.ts`, `server/src/sim/Perception.ts`): Ereignisse mit Radius/Stärke (Hupe, Unfall, Schuss, Explosion, Schlägerei, Sirene, Sprint, Anrempeln, Auto auf dem Gehweg, Autodiebstahl); Reaktionen nach Mut: hinschauen, ausweichen, erschrecken, schimpfen, filmen, Polizei rufen (Zeugen-Meldung hängt am NPC – wird er vorher ausgeknockt, kommt sie nicht an), flüchten, Gruppenpanik, ducken, eingreifen; bei Fahndung zeigen Passanten auf den Spieler. Kurzzeitgedächtnis 60 s. Blickkontakt rechnet der Client.
- **Barks** (`shared/src/npc/barks.ts`): satirische Sprüche je Situation und Archetyp als DS-Sprechblasen; Abklingzeit pro NPC, max. 3 gleichzeitig je 30 m, Client zeigt höchstens 4.

### Flughafen & Luftfahrzeuge
- **Port Coralia International** (`shared/src/world/airport.ts`, Bahnen in `palmara.ts`): Nordbahn 09L/27R (245 m) und
  Südbahn 09R/27L (260 m) mit Mittellinie, Schwellen, Bahnnummern, Rand-/Schwellen-/Anflugbefeuerung (nachts leuchtend),
  Rollwege A1–A3, B1–B3 und W (gelbe Markierungen, Haltelinien, blaue Randfeuer), Vorfeld mit Parkpositionen P1–P4,
  Terminal (Glasfassade, Neon-Schriftzug, Palmen, warmes Licht), Tower mit Drehfeuer, zwei Hangars (Hangar 1 offen,
  Hangar 2 mit Dach-Helipad), Feuerwache, Tankstelle für Luftfahrzeuge, Helipad am Terminal, Zaun mit Schranke.
  Die Airport Road führt östlich um die Nordbahn zum Terminal-Parkplatz – NPC-Verkehr fährt nicht über die Bahnen
  (Autos dürfen aber drauf). Optik: `client/src/render/AirportBuilder.ts` (statisch), `AirportView.ts` (Schranke,
  Gepäckwagen, Deko-Zubringer, der alle ~5,5 min landet, parkt und startet – berechnet aus der Serverzeit).
- **Bahnwarnung:** Wer zu Fuß oder im Auto auf einer Bahn steht, während dort ein Flugzeug startet/landet, bekommt einen Hinweis.
- **Luftfahrzeuge** (`shared/src/sim/aircraft.json` – alle Balancing-Werte; Physik `shared/src/sim/aircraft.ts`):
  **Sunbird** (Propeller, 2 Sitze, Vorfeld P1), **Marlin** (Jet, 6 Sitze, nur von Landebahnen, Hangar 1),
  **Kolibri** (Helikopter, 2 Sitze, Terminal-Helipad), **Pelikan** (Transport-Helikopter, 6 Sitze, Hangar-2-Dach,
  Lasthaken vorbereitet). Höhenstufen Boden / Tief (Gebäude höher als die Flughöhe sind Hindernisse, Rotorschlag
  = Schaden) / Hoch (ab 95 m, keine Gebäudekollision); Luftfahrzeuge kollidieren nur auf gleicher Stufe.
  Flugzeuge: Mindestgeschwindigkeit zum Abheben (Startstrecke in der Config), Strömungsabriss, Landung zu steil/zu
  schnell = Schaden oder Absturz, Wasser = Absturz. Helikopter: Rotor läuft hoch, Schweben, Drehen auf der Stelle,
  seitwärts, Landung auf Dächern, Abwind (Staub/Gras/Gischt). Treibstoff (abschaltbar, Tankstelle am Vorfeld kostet Geld).
  Mitfahrer: E an einem Luftfahrzeug mit Pilot (Sitzplätze laut Config). Aussteigen nur am Boden bzw. knapp darüber.
  Freigabe nach Rang (abschaltbar, `rankGate`): Sunbird/Kolibri ab „Fahrer“, Marlin/Pelikan ab „Unternehmer“. Darunter darf man trotzdem fliegen – das gilt als Diebstahl und gibt sofort 3 Fahndungssterne.
  Respawn nach Zerstörung (90 s) oder weit weg abgestellt (240 s). Netz: Luftfahrzeuge sind bis 450 m sichtbar,
  jenseits der normalen Sichtweite seltener aktualisiert. Polizeihubschrauber ab Fahndungsstufe 4.
- **Testen:** `npm run air-test` (Flugphysik + Server ohne Browser), `/tp flughafen`, `/flug kolibri`,
  Render-Vorschau `preview.html?x=1040&z=1240&air=1` (alle Modelle, `&alt=40` in der Luft, `&deco=60` Deko-Flugzeug).
- **Platzhalter / benötigte Assets:** Modelle sind aus Grundformen gebaut (`client/src/render/AircraftModel.ts`).
  Gebraucht werden: glTF-Modelle Sunbird, Marlin, Kolibri, Pelikan, Polizeihubschrauber, Zubringer (getrennte
  Rotor-/Propeller-Teile); Sounds als Loops: Rotor-Chop leicht und schwer (Kolibri/Pelikan), Propellermotor (Sunbird),
  Jet-Triebwerk mit Anlassen/Leerlauf/Vollschub (Marlin), Rotor-Hochlauf und -Auslauf, Strömungsabriss-Warnton,
  Fahrwerk-Aufsetzen (weich/hart), Reifenquietschen bei der Landung, Absturz-Explosion groß, Tank-Pumpe,
  Funk-/Tower-Ansagen (optional). Bis dahin nutzen Luftfahrzeuge die vorhandenen Motor-Sets (Airboat-Propeller, Lkw, Sport).
