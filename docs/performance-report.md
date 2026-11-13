# Performance-Bericht: Zielgerät ThinkPad T580 (Intel UHD 620 / opt. MX150)

Ziel: flüssig spielbar auf dem Referenz-Laptop, **ohne Inhalte zu streichen**. Alle Viertel, NPC-Dichten,
Fahrzeuge, Ereignisse, Gangs, Sprechblasen, Sounds und Effekte bleiben – optimiert wurde nur, *wie*
gerechnet und gezeichnet wird.

Stand: siehe Git-Historie. Rohdaten aller Läufe: `docs/bench/*.json`.

---

## 1. Messwerkzeuge (neu)

| Werkzeug | Wo | Wofür |
|---|---|---|
| Frame-Profiler | `client/src/perf/Profiler.ts` | CPU-Zeit je Bereich (Simulation, Netz-Decoding, Figuren/Animation, Welt, Effekte, Kamera/Licht, UI/Sprechblasen, Minimap, Audio, Rendering-Vorbereitung); GPU-Zeit je Pass über `EXT_disjoint_timer_query_webgl2` (Schatten, Szene, Bloom, Abschluss, Overlay). Mit `?prof=1` zusätzlich `performance.measure()`-Spuren für das Chrome-DevTools-Performance-Profil. |
| Draw-Call-Zähler | `CallCounter` in `Profiler.ts` | Draw Calls und Dreiecke je Kategorie (Pass × Szenengruppe × Mesh-Art), z. B. `shadow:entities:mesh`. |
| Benchmark-Route | `client/src/perf/Bench.ts`, `?bench=1` | Automatische 3-Minuten-Fahrt (Autopilot im Sportwagen) durch 5 Abschnitte, fester Seed für Client und Server (`Math.random`), Story-Intro wird übersprungen. |
| Runner | `npx tsx scripts/bench-client.ts <label> [--ablate]` | Startet Server (`BENCH_SEED`) + Build-Schnappschuss + Chromium, schreibt `docs/bench/<label>.json` und eine Tabelle. `--ablate`: am Abschnittsende Umrisse/Schatten/Bloom/Wasser/Figuren/Vegetation/Beschriftungen einzeln abschalten (Kostenzerlegung). |
| Server-Tick | `npx tsx scripts/server-bench.ts [s] [Spieler]`, Dev-Befehl `/perf` | Tick-Zeit Ø/p99/max und Aufteilung je Teilsystem, inkl. Aufschlüsselung des längsten Ticks. |
| Shader-Hänger | Dev-Konsole `[gfx] … Shader-Programm(e) nach dem Aufwärmen kompiliert` | Meldet jedes Programm, das erst beim Spielen kompiliert wird. |

**Abschnitte der Route** (je ~32 s Fahrt + 4 s Einschwingen; Hänger beim Einschwingen werden extra gezählt):

1. Ocean Strip · Sonnenuntergang (17:48)
2. Downtown · Nacht (23 Uhr), Regen, laufende Verfolgungsjagd (Fahndung 2: Streifenwagen, Sirenen, Polizisten zu Fuß)
3. Port District · Mittag
4. Gator Flats · Morgendunst (6:18 – der Zonen-Morgennebel ist dann am dichtesten)
5. Highway (Route 41) Richtung Okeefield · Nachmittag, Hitze

> Hinweis: Ein clientseitiger Regen-/Nebel-*Effekt* existiert im Spiel nicht – „Regen“ ist ein
> Server-Wetter (Population, Barks), „Nebel“ ist der Morgendunst der Zonenstimmung (Gator Flats).
> Die Straßenereignisse aus `shared/src/content/events` sind definiert, laufen aber zur Laufzeit noch
> nicht; als „laufendes Ereignis“ dient deshalb eine Verfolgungsjagd mit Polizei.

### Auf dem T580 selbst messen (empfohlen!)

```
BENCH_SEED=1234 npm run dev
```
Dann in Chrome (nicht im Inkognito-Fenster, Fenster maximiert, 1080p): `http://localhost:5173/?bench=1`
– optional `&preset=mittel`, `&dyn=1` (mit dynamischer Auflösung), `&ablate=1`. Nach ~3 Minuten steht
oben links die Tabelle, das vollständige Ergebnis liegt in der Konsole (`BENCH_RESULT {…}`) und in
`window.__benchResult`. Unter Windows: Chrome in *Einstellungen → System → Anzeige → Grafik* auf
„Hohe Leistung“ stellen, damit die MX150 benutzt wird (siehe Abschnitt 6).

## 2. Messumgebung dieses Berichts und ihre Grenzen

Gemessen wurde in einem Cloud-Container **ohne GPU**: Chromium rendert dort per SwiftShader (Software,
CPU), 640×360. Folgen:

- **Hardware-unabhängig und direkt übertragbar:** Draw Calls, Dreiecke (je Pass/Kategorie), Zahl der
  Shader-Programme, Texturen/Geometrien, GPU-Speicher-Schätzung, JS-Heap, Ablations-Deltas.
- **Nur relativ aussagekräftig:** GPU-Zeit je Pass (SwiftShader rastert auf der CPU; das *Verhältnis*
  der Passes und Vorher/Nachher-Verhältnisse stimmen grob, absolute ms nicht).
- **Nicht übertragbar:** FPS, 1 %-Low, Bildzeiten (SwiftShader schafft ~1–3 Bilder/s). Die Zielwerte
  60 FPS / ≥ 45 FPS / Spitzen < 33 ms müssen auf dem T580 mit `?bench=1` nachgemessen werden.

## 3. Ausgangslage (Baseline, Originalcode + Messwerkzeuge)

`docs/bench/baseline.json`

| Abschnitt | Draw Calls Ø/max | Dreiecke Ø/max | Programme | GPU (SwiftShader) Schatten / Szene / Bloom+Post |
|---|---|---|---|---|
| Ocean Strip | 321 / 351 | 402k / 429k | 62 | 124 / 347 / 60 ms |
| Downtown (Nacht, Verfolgung) | 331 / 369 | 767k / 816k | 78 | 105 / 269 / 42 ms |
| Port District | 352 / 385 | 1.025k / 1.227k | 81 | 156 / 308 / 46 ms |
| Gator Flats (Dunst) | 334 / 376 | **4.482k / 4.962k** | 81 | 602 / 567 / 40 ms |
| Highway | 388 / 460 | **3.134k / 4.533k** | 83 | 540 / 404 / 38 ms |

Ziel war < 150 Draw Calls und < 250k Dreiecke – überall deutlich verfehlt.
GPU-Speicher (Schätzung) ~150–160 MB, JS-Heap 225–265 MB ohne stetiges Wachstum (beides im Ziel).

**Ablation (Baseline, Delta beim Abschalten):** Schatten −150 Draw Calls / −45…60 % Dreiecke;
Vegetation in Gator Flats −175 Calls / **−4,3 Mio. Dreiecke**, auf dem Highway −300 Calls / −4,8 Mio.;
Umrisse −30…90 Calls / −20 % Dreiecke; Figuren −65…110 Calls; Wasser, Beschriftungen ≈ 0.

**Wichtigste Einsicht:** Die Kamera hat eine feste Neigung (56°) und feste Blickrichtung; sichtbar ist
nur ein Bodenstreifen von etwa 120 × 60 m (bei Fahrt). Gezeichnet wurden aber ganze 128-m-Chunks samt
aller Bäume, Props in 256-m-Regionen und im Schattenpass alles in ±110 m – ein Vielfaches des Sichtbaren.

## 4. Die 10 größten Kostenpunkte (nach Einfluss) und Maßnahmen

| # | Kostenpunkt (gemessen) | Maßnahme | Status |
|---|---|---|---|
| 1 | **Vegetation ohne Culling pro Instanz**: bis 4,4 Mio. Dreiecke/Bild, Palmenmodelle mit 7.212 Dreiecken, jeweils 3× (Farbe, Umrisshülle, Schattenpass); ~2.800 InstancedMeshes (je Chunk × Variante). | `PlantField`: eine InstancedMesh je Variante für die ganze Welt, pro Bild nur Instanzen im Kamera-Frustum oder mit Schatten im Bild, nicht hinter dem Dunst. Schatten-LOD für schwere Modelle (M8). | ✅ M1, M8 |
| 2 | **Schattenpass zu groß**: fester Bereich ±110 m (zu Fuß ~2,5× größer als nötig), 2048² PCF-Soft, alle Chunks/Props/Autos darin; ~45 % der Draw Calls, bis 50 % der GPU-Zeit. | Schattenbereich folgt dem sichtbaren Ausschnitt (`shadowExtentFor`: 46–110 m je Kameraabstand, in 8-m-Stufen); Preset *Mittel* 1024² (gleiche oder bessere Texeldichte als vorher). | ✅ M2 |
| 3 | **Post-Processing-Bandbreite**: 5 Vollbild-Passes in voller Auflösung (Szene, NaN-Wächter, Bloom-Mischung, Farbkorrektur, Ausgabe; HalfFloat) + UnrealBloom (Helligkeitspass + 10 Blur-Passes + Kompositum). Auf integrierten GPUs ist Speicherbandbreite der Engpass. | Eigene Kette: Szene → Bloom (Helligkeitsauszug inkl. NaN-Wächter in halber Auflösung, 5 Mips Dual-Filter) → **ein** Abschluss-Pass (Hochskalieren + Schärfen, Bloom, Farbkorrektur, Vignette, sRGB). Namen/Sprechblasen danach in voller Auflösung (immer scharf). | ✅ M3 |
| 4 | **Chunks hinter dem Dunst**: Sichtweite fest 450 m, auch wenn der Morgennebel (Gator Flats) bei ~170 m endet. | Chunk-Grenze = min(450 m, Dunst-Ende + Reserve). | ✅ M4 |
| 5 | **Straßenmöbel je 256-m-Region instanziert**: ganze Regionen in Haupt-, Umriss- und Schattenpass (30–55 Calls). | Gleiches Culling wie Vegetation (`ViewCull`), eine InstancedMesh je Typ. | ✅ M5 |
| 6 | **Fahrzeuge im Schattenpass**: 17–40 Calls – auch Autos hinter der Kamera warfen Schatten. | `cullVehicleShadows`: nur Autos, deren Schatten ins Bild fallen kann. | ✅ M6 |
| 7 | **Auflösung**: Render-Auflösung = Bildschirm × min(dpr, 1,5) × 0,9; dynamische Auflösung reagierte erst unter 48 FPS und nur über FPS. | Presets Hoch/Mittel/Niedrig, Pixel-Ratio der Szene in *Mittel* auf 1,0 gedeckelt; Leinwand/HUD/Beschriftungen in voller Auflösung; dynamische Auflösung regelt über die gemessene GPU-Zeit auf ~13 ms (Untergrenze 65 %). | ✅ mit M3 |
| 8 | **Shader-Kompilierung beim Spielen**: nach dem Aufwärmen kamen noch Programme dazu (Hänger beim Betreten neuer Zonen). | Pflanzen/Props werden beim Aufwärmen einmal gezeigt (sonst durch das neue Culling unsichtbar → später kompiliert); Dev-Warnung für jedes späte Programm (mit Verursacher); Zähler `progNew` im Benchmark. | ✅ mit M1/M5 |
| 9 | **Server-Tick 12,5 ms Ø, Spitzen bis 127 ms** (16 Spieler, 450 NPCs, 550 Fahrzeuge): Fußgänger-Ausweichen O(n²), Gefahrenprüfung NPC × alle Fahrzeuge, viele Wegwerf-Objekte je Tick (GC-Spitzen). | Raster für Fußgänger, nur schnelle Fahrzeuge als Gefahr, keine Zwischen-Arrays/Generatoren im heißen Pfad, Fußgänger-Tupel nur bei Bedarf. | ✅ M9 |
| 10 | **Umrisslinien (Inverted Hull)** verdoppeln die Geometrie: 10–25 % der Dreiecke und Draw Calls. | Gemessen und bewertet (siehe 5.5): Hülle bleibt (Look), ihre Kosten sinken automatisch mit M1/M5/M8 (Hüllen nur für sichtbare Instanzen bzw. Gebäudeviertel). | ✅ bewertet |
| + | Räder aller Fahrzeuge und die Einrichtung aller Läden wurden nie gecullt (je 30–90k Dreiecke); Gebäude ganzer 128-m-Chunks. | Räder nur für sichtbare Fahrzeuge, Einrichtung je Laden, Gebäude in 64-m-Vierteln. | ✅ M7, M8 |

## 5. Ergebnisse nach den Maßnahmen

### 5.1 Nach M1–M4 (Vegetation, Schatten, Post-Kette + Auflösung/Presets, Dunst) — `docs/bench/m1-m4.json`

| Abschnitt | Draw Calls Ø/max | Dreiecke Ø/max | Programme | GPU (SwiftShader) gesamt |
|---|---|---|---|---|
| Ocean Strip | 321 → **208** / 251 | 402k → **291k** / 316k | 62 → 53 | 531 → 293 ms (−45 %) |
| Downtown | 331 → **247** / 294 | 767k → **630k** / 676k | 78 → 67 | 416 → 345 ms (−17 %) |
| Port District | 352 → **191** / 206 | 1.025k → **545k** / 593k | 81 → 69 | 511 → 314 ms (−39 %) |
| Gator Flats | 334 → **181** / 201 | 4.482k → **328k** / 354k | 81 → 70 | 1.208 → 253 ms (−79 %) |
| Highway | 388 → **171** / 201 | 3.134k → **545k** / 723k | 83 → 72 | 982 → 261 ms (−73 %) |

Schattenpass (SwiftShader): 105–602 ms → 42–58 ms. Vergleichsbilder an identischer Kameraposition:
`docs/bench/vorher-gator.png` / `docs/bench/nachher-gator-m1-m4.png` – inhaltlich gleich (alle Bäume,
Props, Schatten, Sprechblasen), 303 → 180 Draw Calls, 3,63 Mio. → 0,29 Mio. Dreiecke.

### 5.2 Nach M5–M6 (Props, Fahrzeugschatten) — `docs/bench/m5-m6.json`

| Abschnitt | Draw Calls Ø/max | Dreiecke Ø/max |
|---|---|---|
| Ocean Strip | 208 → **170** / 198 | 291k → **204k** / 222k |
| Downtown | 247 → **160** / 182 | 630k → **464k** / 505k |
| Port District | 191 → **137** / 178 | 545k → **456k** / 525k |
| Gator Flats | 181 → **120** / 140 | 328k → **272k** / 301k |
| Highway | 171 → **128** / 166 | 545k → **333k** / 448k |

Die neue Dreiecks-Aufschlüsselung je Kategorie zeigte zwei weitere Ausreißer:
- **Räder:** eine globale InstancedMesh mit den Rädern *aller* bekannten Fahrzeuge (auch außerhalb des
  Bildes) – 30–90k Dreiecke inkl. Schatten und Umriss.
- **Ladeneinrichtung:** alle Läden der Welt in *einem* Mesh → nie gecullt, in jedem Bild ~39k Dreiecke
  (Farbe + Umriss + Schatten), auch in Gator Flats und auf dem Highway.

### 5.3 Nach M7 (Räder- und Laden-Culling, Culling-Rand) — `docs/bench/m7.json`

| Abschnitt | Draw Calls Ø/max | Dreiecke Ø/max | neu kompilierte Shader |
|---|---|---|---|
| Ocean Strip | 170 → **158** / 178 | 204k → **126k** / 142k | 0 |
| Downtown | 160 → **138** / 182 | 464k → **307k** / 330k | 0 |
| Port District | 137 → **132** / 180 | 456k → **317k** / 378k | 1 |
| Gator Flats | 120 → 134 / 160 | 272k → **226k** / 267k | 1 |
| Highway | 128 → 149 / 182 | 333k → 522k / 918k | 0 |

Die Autopilot-Fahrt ist nicht bildgenau deterministisch (Bildrate beeinflusst die Strecke), daher
schwanken Highway/Gator zwischen Läufen. Auf dem Highway dominieren jetzt Palmen: die Modelle haben
bis zu **7.212 Dreiecke** und erscheinen in Farbe, Umriss *und* Schattenpass (zusammen ~400k).

### 5.4 Nach M8 (Gebäude in 64-m-Vierteln, Schatten-LOD für schwere Pflanzen) — `docs/bench/m8.json`

- Gebäude eines Chunks werden in vier 64-m-Viertel geteilt (Umrissnormalen vorher am Ganzen berechnet,
  damit an den Schnittkanten keine Linienlücken entstehen) – ein halb sichtbarer Chunk zeichnet nicht
  mehr alle Gebäude samt Umriss und Schatten.
- **Vegetations-LOD für den Schatten:** Modelle über 1.500 Dreiecke werfen ihren Schatten über einen
  vereinfachten Stellvertreter (Vertex-Clustering 0,3 m, nur auf der Render-Ebene `SHADOW_ONLY_LAYER`
  sichtbar, die nur im Schattenpass aktiv ist). Pflanzenschatten waren schon vorher statisch (kein Wind
  im Tiefenmaterial) – das sichtbare Modell, sein Umriss und sein Wind bleiben unverändert.

| Abschnitt | Draw Calls Ø/max | Dreiecke Ø/max | neu kompilierte Shader |
|---|---|---|---|
| Ocean Strip | 158 → **156** / 193 | 126k → **107k** / 134k | 0 |
| Downtown | 138 → 191 / 229 | 307k → **216k** / 255k | 1 |
| Port District | 132 → **142** / 183 | 317k → **208k** / 284k | 0 |
| Gator Flats | 134 → **121** / 149 | 226k → **170k** / 380k | 1 |
| Highway | 149 → 157 / 205 | 522k → **323k** / 554k | 0 |

Die Viertel-Teilung kostet in Downtown ~11 Draw Calls (Gebäude, Umriss, Schatten je Viertel), spart dort
aber ~125k Dreiecke (Gebäude Farbe + Umriss + Schatten 201k → 77k) – bewusst getauscht. Der Rest der
Draw-Call-Differenz in Downtown ist Streckenvarianz (die Fahrt kam an mehr Läden vorbei).

**Vergleichsbilder an identischer Kameraposition** (Vorschau-Seite, deterministisch, Software-GPU):

| Szene | Vorher | Nachher | Draw Calls | Dreiecke |
|---|---|---|---|---|
| Gator Flats, Mittag | `vorher-gator.png` | `nachher-gator-m1-m4.png` | 303 → 180 | 3,63 M → 0,29 M |
| Collins Causeway (Palmen), Nachmittag | `vorher-palmen.png` | `nachher-palmen.png` | 357 → 210 | 459k → 239k |
| Downtown, Nacht | `vorher-downtown-nacht.png` | `nachher-downtown-nacht.png` | 286 → 208 | 619k → 337k |

Inhaltlich identisch (alle Bäume, Props, Fahrzeuge, Figuren, Schatten). Unterschiede: Der Bloom ist
minimal enger (Dual-Filter statt Gauß-Kaskade); die nachts vom Bloom überstrahlte Schimpf-Sprechblase ist
jetzt lesbar, weil Beschriftungen nach der Nachbearbeitung gezeichnet werden.

### 5.5 Umrisslinien: Inverted Hull vs. Post-Process-Kanten

Gemessen (Ablation nach M1–M4): Hüllen kosten noch 25–40 Draw Calls und ~25 % der Dreiecke, aber
kaum Pixel (Rückseiten, schmaler Saum). Eine Kantenerkennung als Nachbearbeitung bräuchte einen
Tiefen-(+Normalen-)Puffer und einen weiteren Vollbild-Pass – auf der UHD 620 bei 1080p×0,9 etwa
0,5–1 ms reine Bandbreite – und verändert den Look: Die Hüllen haben je Objektklasse eigene Stärken
(Figuren, Fahrzeuge, Gebäude, Bäume), wackeln mit dem Wind, respektieren das Durchsicht-Dithering
und zeichnen keine Linien an Bordsteinen/Geländestufen. Entscheidung: **Hülle behalten**, Kosten über
das Culling senken (Hüllen gibt es nur noch für sichtbare Instanzen). Bei Bedarf wäre der nächste
Schritt, Hüllen ab ~60 m Entfernung wegzulassen (dort sind sie ohnehin < 1 px).

### 5.6 Nicht umgesetzt (bewusst)

- **Impostors/Billboard-LOD für Bäume:** Durch das Culling sind ferne Bäume gar nicht mehr im Bild
  (die feste Kamera sieht nur ~120 m); Impostors brächten erst bei Luftfahrzeugen in großer Höhe etwas.
  Umgesetzt ist stattdessen die Schatten-LOD; eine sichtbare Mittelstufe für Palmen siehe 5.9.
- **Ein einzelnes spät kompiliertes Basis-Material** (0–1 je Abschnitt) ließ sich keinem Szenenobjekt
  zuordnen (vermutlich ein kurzlebiges Effekt-Objekt); einmalig pro Sitzung, die Dev-Warnung meldet es.
- **Occlusion Culling Downtown:** Bei 56° Neigung verdecken Hochhäuser kaum ganze Blöcke; der sichtbare
  Bereich ist bereits klein. Aufwand ≫ Nutzen.
- **Gebäude-LOD 3 Stufen / Fahrzeug-LOD:** Alles im Bild ist nah (≤ ~120 m); kein messbarer Gewinn.
  Schadensverformung erzeugt schon heute nur bei beschädigten Autos eigene Geometrie.

### 5.7 Gesamtbilanz Baseline → M8

| Abschnitt | Draw Calls Ø | Dreiecke Ø | GPU-Zeit (SwiftShader, relativ) | davon Schatten |
|---|---|---|---|---|
| Ocean Strip | 321 → 156 (−51 %) | 402k → 107k (−73 %) | 531 → 233 ms (−56 %) | 124 → 21 ms |
| Downtown (Nacht, Regen, Verfolgung) | 331 → 191 (−42 %) | 767k → 216k (−72 %) | 416 → 268 ms (−36 %) | 105 → 25 ms |
| Port District | 352 → 142 (−60 %) | 1.025k → 208k (−80 %) | 511 → 228 ms (−55 %) | 156 → 26 ms |
| Gator Flats (Dunst) | 334 → 121 (−64 %) | 4.482k → 170k (−96 %) | 1.208 → 231 ms (−81 %) | 602 → 20 ms |
| Highway | 388 → 157 (−60 %) | 3.134k → 323k (−90 %) | 982 → 234 ms (−76 %) | 540 → 26 ms |

Draw Calls enthalten 11 Vollbild-Quads der Nachbearbeitung (Bloom-Mips + Abschluss).
Weitere Werte nach M8: Shader-Programme 53–73 (Baseline 62–83), neu kompiliert während der Fahrt
0–1 je Abschnitt; GPU-Speicher (Schätzung) 147–161 MB; JS-Heap im Lauf 234–258 MB ohne Wachstum
(direkt nach dem Weltaufbau kurz ~480 MB, wird vom GC freigegeben); JS-Arbeit je Bild ohne
Render-Übergabe (Figuren/Animation 1,4–5,8 ms, Netz 2–5 ms, Welt/Culling 0,2–0,7 ms, Rest < 0,6 ms –
unter SwiftShader-Last gemessen, auf dem Laptop eher weniger).

### 5.8 Stand gegenüber den Zielwerten

| Ziel | Stand | Bewertung |
|---|---|---|
| Draw Calls < 150 | Ø 121–191 (inkl. 11 Post-Quads), max 149–229 | Gator/Port erreicht, Ocean/Highway knapp darüber, Downtown 191 – nächster Hebel: Figuren (2 Calls je Figur) und Läden (siehe 5.9) |
| Dreiecke < 250.000 | Ø 107k–323k, max 134k–554k | Vier von fünf Abschnitten im Mittel erreicht; Highway liegt durch 7.200-Dreiecks-Palmen darüber |
| GPU-Speicher < 600 MB | ~150–160 MB (Schätzung) | ✅ |
| JS-Heap < 400 MB ohne Wachstum | 234–258 MB im Lauf, kein Wachstum | ✅ (Spitze direkt nach dem Laden ~480 MB, transient) |
| Server-Tick < 10 ms (16 Spieler) | Ø 7,9–8,5 ms, p99 ~18 ms | ✅ im Mittel; einzelne Ticks bis ~25 ms (Budget 50 ms) |
| 60 FPS „Mittel“ 1080p, nie < 45, Spitzen < 33 ms | **hier nicht messbar** (keine GPU) | Auf dem T580 mit `?bench=1` nachmessen; die dynamische Auflösung regelt jetzt auf ~13 ms GPU-Zeit (Untergrenze 65 %) |

### 5.9 Nächste Schritte, falls der T580 die 60 FPS noch nicht hält

1. **Palmen-Modelle:** Die vier Palmen-Varianten haben 2.352–7.212 Dreiecke. Eine sichtbare
   Mittel-LOD-Stufe (vereinfachtes Modell ab ~50 m, Übergang per Dithering) oder schlankere Modelle
   würden den Highway unter 250k bringen. Schatten-LOD ist bereits umgesetzt.
2. **Figuren:** 2 Draw Calls je Figur (Skinned Mesh + Umrisshülle). Die Hülle könnte im selben Draw Call
   als zweite Geometriegruppe gezeichnet werden, oder entfernte Figuren (> 60 m) per Instancing mit
   vorgebackenen Animationen (VAT) – größerer Umbau.
3. **Läden:** Je Laden 5–7 Meshes (Fassade, Umriss, Neon, Schild, Pfosten, Einrichtung, Einrichtungs-
   Neon) – zusammenführen auf 2–3.
4. **Fahrzeuge:** Karosserie + Lichter als ein Mesh (Lichter über ein Vertex-Attribut im selben Shader)
   spart 1 Call je sichtbarem Auto.

## 6. Server (Ziel: Tick < 10 ms bei 16 Spielern)

`npx tsx scripts/server-bench.ts 60` – 16 Spieler verteilt auf die fünf Benchmark-Viertel, die Hälfte
fährt Auto, nachts, Regen, eine Verfolgungsjagd; ~450 NPCs, ~550 Fahrzeuge (geparkt + Verkehr).
Gleiche Maschine (Cloud-Container, Node 22), ohne parallele Last:

| | Ø | p50 | p99 | max |
|---|---|---|---|---|
| Vorher (Originalcode) | 9,26 ms | 8,72 ms | 21,5 ms | 35,1 ms |
| Nachher (2 Läufe) | 7,9–8,5 ms | 7,1–7,8 ms | 18,3–18,9 ms | 23,4–24,8 ms |

Aufteilung nachher (Ø je Tick): Snapshots 2,2 · Fußgänger 1,8 · Verkehr 1,8 · Fahrzeug↔Fußgänger 0,65 ·
Quests/Story/Gangs 0,45 · Polizei/Minispiele 0,43 · Physik 0,25 · Rest < 0,1 ms.

Maßnahmen (Verhalten unverändert):
- Fußgänger weichen einander über ein 2-m-Raster aus statt über alle NPCs (vorher O(n²), ~200.000
  Paarprüfungen je Tick).
- Als Gefahr für Fußgänger zählen nur Fahrzeuge ab 5 m/s – genau das, was Fußgänger und NPC-Gehirn
  ohnehin prüfen; vorher wurde für alle ~550 Fahrzeuge je Tick ein Objekt gebaut und von jedem NPC
  durchlaufen.
- Fahrzeug-gegen-Fußgänger-Test ohne Zwischen-Arrays und Generatoren (weniger GC-Spitzen).
- Snapshot-Tupel der NPCs nur noch für NPCs in der Nähe eines Spielers.
- Messung: `/perf` (Dev-Chat) zeigt Ø, max und die Aufteilung des längsten Ticks.

Getestet ohne Effekt: `--max-semi-space-size=64` (V8-GC) – keine messbare Verbesserung, daher nicht empfohlen.

## 7. Tipps zu Hardware, Browser und Server

**Laptop (wirken direkt auf die FPS):**
1. **Zweiter RAM-Riegel (Dual-Channel).** Viele T580 wurden mit *einem* 8-GB-Modul ausgeliefert. Die
   UHD 620 nutzt den Arbeitsspeicher als Grafikspeicher – mit nur einem Riegel halbiert sich die
   Bandbreite. Ein zweites, gleiches DDR4-2400-SO-DIMM bringt typischerweise 30–50 % mehr Grafikleistung.
   Prüfen: Task-Manager → Leistung → Arbeitsspeicher → „Verwendete Steckplätze: 1 von 2“.
2. **MX150 benutzen (falls verbaut):** Windows *Einstellungen → System → Anzeige → Grafik* → Chrome →
   „Hohe Leistung“; zusätzlich NVIDIA-Systemsteuerung → *3D-Einstellungen → Programmeinstellungen* →
   chrome.exe → „Hochleistungs-NVIDIA-Prozessor“. Das Spiel fordert per `powerPreference:
   "high-performance"` bereits die schnelle GPU an; ob sie aktiv ist, zeigt `chrome://gpu`
   (GL_RENDERER) oder `window.__benchResult.gl.renderer`. Die MX150 ist etwa 2–3× so schnell wie die UHD 620.
3. **Netzteil anstecken, Energiemodus „Beste Leistung“** (Windows + Lenovo Vantage). Im Akkubetrieb
   taktet die iGPU deutlich herunter.
4. **Treiber aktualisieren** (Intel-Grafik DCH-Treiber, NVIDIA), Chrome aktuell halten, Hardware-
   beschleunigung an (`chrome://settings/system`).
5. **Vollbild (Taste V)** und andere Tabs/Videos schließen – der Browser-Compositor kostet sonst mit.
6. Lüfter/Kühlkörper entstauben: thermisches Drosseln ist beim T580 nach ein paar Jahren häufig.
7. Grafikstufe: **F8** schaltet Hoch → Mittel → Niedrig (Inhalte und Cel-Look bleiben in allen
   Stufen). Auf der UHD 620 startet das Spiel automatisch in *Mittel*.

**Server (wirkt NICHT auf die FPS des Laptops)** – die Bildrate hängt allein vom Client ab. Ein
stärkerer Server senkt nur Tick-Zeit und Latenz:
1. Node.js läuft single-threaded → **hohe Single-Core-Leistung** zählt, nicht viele Kerne. Für 16
   Spieler reichen 2 *dedizierte* vCPUs mit aktueller CPU (z. B. „CPU-optimiert“/„dedicated“-Tarife).
   Billige *Shared*-vCPUs haben „Steal Time“ → unregelmäßige Tick-Spitzen (Ruckeln aller Spieler).
2. **Upload-Bandbreite:** ~3,7 KB je Spieler und Tick bei 20 Hz ≈ 75 KB/s je Spieler → 16 Spieler
   ≈ 1,2 MB/s ≈ **10 Mbit/s Upload**. Von zu Hause über DSL/Kabel mit 10–40 Mbit/s Upload ist das knapp;
   ein VPS im Rechenzentrum (Deutschland, für niedrige Latenz) ist für mehr als ~6 Spieler besser.
3. In Produktion starten (`npm start` bzw. `NODE_ENV=production`), Node 22 LTS.
4. Den Server *nicht* auf demselben Laptop laufen lassen, auf dem gespielt wird – er nimmt dem Spiel
   einen CPU-Kern weg (Physik, NPCs ~8 ms je 50 ms).

## 7. Ausbau Norden (Okee Peak, Höfe) – Messungen

Gleiche Maschine (Cloud-Container, Node 22, ohne GPU):

| Messung | Vorher | Nachher | Bemerkung |
|---|---|---|---|
| Server-Tick (`server-bench.ts`, 16 Spieler) | Ø 7,9–8,5 ms, p99 ~18 ms | Ø 8,7 ms, p50 8,2 ms, p99 21 ms, max 49 ms (Einzelspitze „pawns“, GC) | Ziel < 10 ms im Mittel weiter erfüllt; Verkehr 1,8 ms unverändert (Land: weniger Spawns) |
| Weltgenerierung (`generateWorld`) | ~0,9 s | ~1,3 s | Berg-Höhenfeld + Straßen-Einschnitt; einmal beim Start (Client und Server) |
| Snapshots | 4,0 KB je Spieler/Tick | 4,0 KB | Tiere laufen über das Passanten-System (keine neuen Nachrichtentypen außer Zaun/Sprengung) |

Kostenbegrenzung im Client:
- Felder, Zäune, Heuballen, Orangenbaum-Reihen, Zuckerrohr: Instancing über `PlantField` (Culling je Instanz);
  Zuckerrohr/Gemüse als Bodendecker (Wind nah, jenseits der Bodendecker-Distanz gar nicht gezeichnet).
- Hof- und Berggebäude schreiben in die bestehenden Chunk-Geometrien (keine zusätzlichen Draw-Calls je Gebäude).
- Tiere: eine Geometrie je Gelenk, ohne Umrisse, Gliedanimation nur < 70 m (Animations-LOD wie Passanten).
- `NorthView` (Wasser, Rauch, Wolken, Crop Hopper) nur aktiv, wenn der Fokus im Norden liegt.
- `FarLod` (Insel + Berg-Silhouette, 1 Draw-Call je Teil) nur im Panorama (Fernrohr) oder ab 140 m Flughöhe.
- Benchmark-Route: neue Abschnitte `peak` (Okee Peak Gipfel bei Sonnenuntergang) und `fields`
  (Felder mit Mähdrescher-Kolonne via `/kolonne`). Die Browser-Messung auf dem T580 (Preset „Mittel“)
  steht noch aus – im Container rendert Chromium per SwiftShader (~10 FPS), Zahlen dort nicht vergleichbar.
