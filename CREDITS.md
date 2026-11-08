# Credits

Sunstate Heat verwendet neben prozedural erzeugten Modellen einige fertige 3D-Modelle und Sounds.
Alle externen Assets stehen unter **CC0 1.0 (gemeinfrei)**: https://creativecommons.org/publicdomain/zero/1.0/
Eine Namensnennung ist nicht verpflichtend – wir danken den Urhebern trotzdem gern.

Die Dateien liegen unter `client/public/assets/<quelle>/<kit>/` und werden mit `npm run assets`
aus den offiziellen Repositories geladen (feste Commits, siehe `scripts/fetch-assets.mjs`).

## KayKit – City Builder Bits 1.0

- **Urheber:** Kay Lousberg – https://www.kaylousberg.com
- **Quelle:** https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0
  (Commit `63976910ca04d16f0fc531b9c614244be8128713`), auch auf https://kaylousberg.itch.io
- **Lizenz:** CC0 1.0 – siehe `client/public/assets/kaykit/city-builder-bits/LICENSE.txt`
- **Ordner:** `client/public/assets/kaykit/city-builder-bits/`
- **Verwendet:** Stadthäuser A–H (Mittelbauten in den Städten), Autos Limousine / Kompakt / Kombi / Taxi
  (Verkehr und Spielerfahrzeuge), Straßenlaterne, Ampel, Hydrant, Bank, Müllcontainer, Müllsack, Busch.

## Kenney – Starter Kit City Builder

- **Urheber:** Kenney – https://kenney.nl
- **Quelle:** https://github.com/KenneyNL/Starter-Kit-City-Builder
  (Commit `4535092b740b378b700efd9df9e27a631815b84a`)
- **Lizenz:** Die enthaltenen Assets (3D-Modelle, Sounds) sind laut README des Repositories CC0.
  Der Godot-Code des Kits steht unter MIT und wird **nicht** verwendet.
- **Ordner:** `client/public/assets/kenney/starter-kit-city-builder/`
- **Verwendet:** Kleine Häuser a–d (Wohnhäuser), Sounds `ambience.ogg` (Umgebung), `toggle.ogg` (Chat),
  `placement-a.ogg` (Meldungen).

## Kenney – Starter Kit Racing

- **Urheber:** Kenney – https://kenney.nl
- **Quelle:** https://github.com/KenneyNL/Starter-Kit-Racing
  (Commit `2f2e5f2646dda89cb21d4e8539bab60c6e955dc8`)
- **Lizenz:** Die enthaltenen Assets (3D-Modelle, Sounds) sind laut README des Repositories CC0.
  Der Godot-Code des Kits steht unter MIT und wird **nicht** verwendet.
- **Ordner:** `client/public/assets/kenney/starter-kit-racing/`
- **Verwendet:** Motorrad, Pick-up-Trucks rot/gelb (Verkehr), Sounds `engine.ogg`, `engine-motorcycle.ogg`,
  `impact.ogg`, `skid.ogg`.

## Quaternius – Ultimate Modular Men Pack, Ultimate Modular Women Pack

- **Urheber:** Quaternius (Tomás Laulhé) – https://quaternius.com
- **Quelle:** https://quaternius.com bzw. https://quaternius.itch.io (manuell heruntergeladen)
- **Lizenz:** CC0 1.0
- **Ordner:** `client/public/assets/quaternius/<pack>/` (glTF/GLB; Unterordner beliebig)
- **Verwendet:** Passanten und Spielerfiguren. Körperteile verschiedener Figuren werden kombiniert,
  zonenspezifisch umgefärbt und zu einer Skinned-Geometrie verschmolzen; Animationen (Idle/Walk/Run) aus den Packs.

## Quaternius – Stylized Nature MegaKit, 150+ LowPoly Nature Models

- **Urheber:** Quaternius (Tomás Laulhé) – https://quaternius.com
- **Quelle:** https://quaternius.com bzw. https://quaternius.itch.io (manuell heruntergeladen)
- **Lizenz:** CC0 1.0
- **Ordner:** `client/public/assets/quaternius/<pack>/`
- **Verwendet:** Palmen, Laub- und Nadelbäume, knorrige Bäume (Sumpf), Büsche, Felsen, Gras, Farne, Blumen,
  Schilf, Seerosen, Kakteen – per Instancing, mit Wind-Animation im Vertex-Shader.

Ohne diese Packs nutzt das Spiel automatisch prozedurale Ersatzmodelle.

## Texturen

Alle Material-Texturen (Straßen, Fassaden, Dächer, Natur, Decals …) werden im Code gemalt
(`client/src/render/materials/library.ts`). Optional lassen sich CC0-Fototexturen einbinden, z. B. von
**Poly Haven** (https://polyhaven.com), **ambientCG** (https://ambientcg.com) oder **Kenney** (https://kenney.nl);
`scripts/process-textures.ts` verkleinert sie auf 64/128 px und quantisiert sie auf die Zonenpalette.
Jede so verwendete Quelle bitte hier mit Name, URL und Lizenz nachtragen.

## Anpassungen im Spiel

- Alle Modelle werden beim Laden zu einer Geometrie verschmolzen, ihre Texturfarben pro Dreieck als
  Vertex-Farben übernommen und an die Palmara-Palette angeglichen (`client/src/render/palette.ts`).
  Sie nutzen dieselben Toon-Materialien (Cel-Shading, Umrisslinien) und dieselbe Beleuchtung wie die
  prozeduralen Modelle. Texturen aus Kits werden auf max. 64–128 px verkleinert und palmaraisiert.
- Autos und Motorrad werden in die Lackfarben des Spiels umgefärbt; Fensterscheiben der Gebäude leuchten nachts.
- Erfundene Markennamen ergänzt das Spiel selbst; die Kit-Modelle sind markenfrei.

## Weiterhin prozedural

Figuren, Boote, Airboat, Bäume (Palmen, Kiefern, Mangroven, Zypressen, Orangenbäume), Art-déco-Hotels,
Hochhäuser, Lagerhallen, Container, Scheunen, Trailer, Stelzenhütten in Gator Flats, Neon, Boden, Wasser,
Brücken und Stege.
