# Audio-Rohdateien

Hier liegen die unbearbeiteten Sound-Pakete, je Quelle ein Ordner:

| Ordner | Quelle | Lizenz | im Git? |
|---|---|---|---|
| `kenney/` | Kenney Audio (Impact, Interface, UI, Digital Audio, Music Jingles) | CC0 | ja |
| `freesound/` | Freesound – **nur CC0** (Link im Manifest unter `url` angeben) | CC0 | ja |
| `freepd/` | FreePD | CC0 | ja |
| `oga/` | OpenGameArt – nur CC0 (Synthwave usw.) | CC0 | ja |
| `sonniss/` | Sonniss GDC Game Audio Bundles | lizenzfrei, nicht weiterverbreiten | **nein** (`.gitignore`) |
| `pixabay/` | Pixabay Sounds/Music | Pixabay-Lizenz, nicht weiterverbreiten | **nein** (`.gitignore`) |

Ablauf:

1. Paket in den passenden Ordner entpacken (Unterordner sind egal).
2. `npm run audio -- --scan` → `_scan.md` listet alle Dateien mit Dauer/Kanälen (mit `--loudness` auch LUFS)
   und schlägt passende Manifest-Einträge vor.
3. In `client/src/audio/manifest.ts` beim Eintrag `files: [{ src: 'sonniss/…/datei.wav', license: 'sonniss-gdc' }]`
   ergänzen (Motor-Loops zusätzlich `rpm`, Zuschnitt optional mit `start`/`dur`).
4. `npm run audio` → spielfertige OGG/Opus + AAC-Dateien in `client/public/audio/` (werden committet),
   `index.json` und der Audio-Abschnitt in `CREDITS.md`.

Benötigt `ffmpeg` (mit libopus) im PATH.
