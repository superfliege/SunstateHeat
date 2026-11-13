# Der Norden: Okee Peak, Höfe, Land vs. Stadt

Überblick über den Ausbau von Dry Pine Country und dem nördlichen Kartenrand. Alles ist
deterministisch (Client und Server erzeugen dieselbe Welt) und datengetrieben.

## 1. Okee Peak (`shared/src/world/okeePeak.ts`)

| Element | Umsetzung |
|---|---|
| Lage | Auf den ehemals braunen Ödland-Flächen und den unpassierbaren ROCK-Hügeln im Norden (x ≈ 380–1250, z ≈ 110–500). `HILLS` in `palmara.ts` ist leer – die Randberge sind im Massiv aufgegangen. |
| Form | Hauptgipfel ~210 m (Downtown-Türme enden bei ~150 m), Nebengipfel *West Knob* (128 m) und *Eagle Tooth* (142 m), Grat dazwischen. Großform aus Gipfel-Profilen mit Domain-Warp, darauf Rauschen proportional zur Höhe, Zacken (ridged noise) und Felsstufen in Rauschflecken. Nordseite fällt als Kliff ins Meer. |
| Untergrund | Neue Kacheln `GRAVEL`, `SCREE` (Geröll), `CLIFF` (Felswand), `RESERVOIR`, `CROP`, `PASTURE` (`tiles.ts`); Grip in `handling.ts surfaceGrip` (Geröll 0,42, Fels 0,28). Fahrzeuge rutschen auf Geröll den Hang hinunter. |
| Vegetation | Nach Höhe (`vegetation.ts`): Kiefernwald mit Weiden-Lichtungen < 48 m, lichter Mischwald (neuer Baum `Oak`) bis 100 m, Buschland bis 150 m, darüber Fels und trockenes Gras (Bodendecker in `WorldView.buildGroundCover`). |
| Switchback Road | Automatisch erzeugt: folgt den Höhenlinien mit fester Steigung, wechselt an den Grenzen des Südhangs per Haarnadel (R 9,5 m), oben Gipfelschleife um den Kegel. Höhenprofil max. 16,5 %, ins Gelände eingeschnitten (`terrain.ts carveMountain`: auf der Fahrbahn exakt das Profil, seitlich Hangschnitt/Damm). Leitplanken (optisch) und vier Aussichtsbuchten mit Münzfernrohr. |
| Weitere Wege | *Okee Notch Tunnel* (Abkürzung zur Staumauer, Felsdach über dem tiefen Einschnitt), *Dam Crest*, *Timber Trail* (Holzfällerweg), *Quarry Road*; Offroad-/Wanderpfade als Schotter (Scree Run, Eagle Trail, Pine Traverse, Ridge Path, Camp Loop); vier Sprungschanzen an Abhängen. |
| Orte | Gipfelplateau mit Fernrohren (E: Panorama über ganz Palmara), Funkturm mit Blinklicht, Gipfelcafé mit Missionstelefon; Ranger-Station mit Wachturm; Steinbruch (Bermen, Brecher, Förderbänder, Kiesberge, Muldenkipper); Okee Reservoir (eigene Wasserfläche auf 30 m, Staumauer, Wasserfall, Bootssteg, Angelplätze); Pinecone Campground (Zelte, Feuerstellen, Wohnmobile); Holzplatz; Dustline-Truckstop (Diner, Lkw-Tankstelle, Halle). |
| Atmosphäre | Wind nimmt mit der Höhe zu, Morgennebel in den Tälern (Stimmung `highlands`), Wolken streifen den Gipfel, nachts mehr Sterne, Funkturm blinkt. |
| Fern-LOD | `render/FarLod.ts`: grobes Höhenfeld (10 m) der ganzen Insel inkl. Berg-Silhouette + Gebäude-Quader, ein Draw-Call, nur sichtbar bei Panorama (Fernrohr/Fotokamera) oder großer Flughöhe. |

## 2. Höfe (`shared/src/world/farms.ts`)

| Hof | Art | Stammgast |
|---|---|---|
| Sunny Grove Farm | Orangen (Baumreihen, Saftpresse, Hofladen) | Rosie Peck |
| Double R Ranch | Rinder, Pferde, Pferch, Rodeo-Arena mit Tribünen | Doris Whitlock |
| Henderson Dairy | Milch (Melkstall, Silos, Milchtanklaster, Heuwiese) | Walt Henderson (Gertrude wohnt hier) |
| Cluck & Co. | Hühner (lange Ställe, Auslauf, Eierstand) | Betty-Lou Cluckett |
| Big Melon Acres | Melonen/Gemüse (Reihen, Vogelscheuchen, Beregnung, Erntewagen) | Hank Mellow |
| Cane Creek Mill | Zuckerrohr (durchfahrbar, verdeckt Sicht), Mühle mit Rauch, Ernte-Feuer | Earl Pritchard |

Gebäude als `BuildingStyle.Farm` (tag = Art), Felder/Weiden als Untergrund, Zäune (Holz/Stacheldraht)
als 3-m-Segmente per Instancing (umgefahrene Segmente kippen um und werden nach 8 min repariert),
Requisiten (Pumpen-Windräder, Wassertürme, Heuballen, Briefkästen, Tröge, Veranda-Schaukeln …).
Smart Objects je Hof (`smartObjects.ts ruralObjects`): Füttern, Melken, Heu laden, Zaun reparieren,
Ernten, Veranda, Gitarre, Werkbank, Eierstand – mit Tageszeiten (morgens Füttern/Melken, mittags
Feldarbeit, abends Veranda/Gitarre).

## 3. Landmaschinen (`sim/handling.ts`, Modelle `render/FarmVehicleModels.ts`)

Dirt Buddy, Field King 400, Rusty Ol' Red, Traktoren mit Heuwagen/Viehanhänger/Güllefass/Pflug/
Orangenkisten (Anhänger fest angekuppelt), Harvest Titan (5,6 m breit, 25 km/h, großer Wendekreis),
Rusty Ranch Pick-up, Hay Hauler, Mule ATV (kippt leicht), Ridge Runner Buggy, Milchtanklaster,
Viehtransporter, Holztransporter, Muldenkipper, Lawn Boss, Wanderlust RV, County Ranger, County Sheriff,
Dustline Rig. Neuer Profilwert `offroad` (Stollenreifen gleichen Grip-Verlust auf losem Boden aus).
Motorklang: neue prozedurale Sets `tractor`, `quad`, `mower`. Der Crop Hopper ist Deko (`NorthView`).

## 4. Bevölkerung Stadt vs. Land

- Gebiete (`world/north.ts ruralArea`): *Okee Peak*, *Okee Höfe*, *Dry Pine Land*, *Feldwege*,
  *Stadtrand* (Übergang), dazu die Okeefield-Orte Cane Ridge, Port Sabal, Sunny Acres.
- Population Tables (`npc/population.ts`) mit neuen Archetypen (Rancher, Erntehelfer, Melker, Tankwart,
  Trucker, Jäger, Wanderer, Kletterer, Camper, Ranger, Holzfäller, Steinbrucharbeiter,
  Kleinstadtbewohner, Kirchgänger am Sonntag) und Outfits (Hüte, Caps, Helme, Warnwesten, Rucksäcke,
  Latzhosen, Karohemden). Deutlich geringere Dichte, hoher Szenario-Anteil.
- Tiere sind Archetypen der Bevölkerung (gleiche Synchronisation, Reaktionen, Animations-LOD), erscheinen
  nur an Weideplätzen, fliehen vor Hupen und Fahrzeugen; Comic-Physik ohne Verletzungen und ohne Blut.
- Verkehr (`npc/countryside.ts`): Landstraße ~30 % Pick-ups, 20 % Landmaschinen, 15 % Trucks, 10 %
  Wohnmobile, 10 % Quads/Geländewagen, 15 % normale Autos; Feldwege fast nur Landmaschinen;
  Kleinstadt mehr normale Autos; deutlich weniger Verkehr. Langsame Fahrzeuge geben das Tempo vor –
  dahinter bilden sich Kolonnen.

## 5. Ereignisse, Fraktionen, Quests

- E49–E56 in `content/events/north.ts`; E39–E42 über `at` auf Höfe/Straßen verteilt.
- County Sheriff (`factions/police.ts county`, `Police.isRural`): höchstens ein Deputy zu Fuß, sucht
  1,6× länger, Pick-ups; ab Stufe 2 Straßensperren aus quergestellten Traktoren (`Countryside.ts`).
  Farmer rufen bei wiederholten Schäden (Zäune, Tiere) den Sheriff, die Hof-Stimmung sinkt.
- Dustline Haulers: Truckstop am Bergfuß als zweites Hauptquartier, Holz- und Kiesverkehr.
- Quests (`questsNorth.ts`): Heuernte im Akkord, Gipfelkurier, Rinder-Treiben (neuer Zieltyp `herd`),
  Der falsche Traktor (Verfolger per `spawnVehicle … chase`), Downhill-Wahnsinn.

## 6. Performance

- Felder, Zäune, Heuballen, Orangenbäume, Zuckerrohr: Instancing über `PlantField` (Culling je
  Instanz); Zuckerrohr/Gemüse sind Bodendecker (Wind nah, fern ausgeblendet).
- Tiere: 1 Geometrie je Gelenk, keine Umrisse, Gliedanimation nur < 70 m (Animations-LOD).
- `NorthView` und `CountrySound` laufen nur im Norden; `FarLod` nur im Panorama/bei großer Höhe.
- Benchmark-Route: neue Abschnitte `peak` (Gipfel bei Sonnenuntergang) und `fields` (Mähdrescher-Kolonne).
