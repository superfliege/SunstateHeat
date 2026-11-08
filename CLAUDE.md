# Sunstate Heat – Hinweise für Claude

Browser-Multiplayer-Open-World (Three.js-Client, Node/WebSocket-Server, gemeinsame Simulation). Projektsprache: **Deutsch** (Code-Kommentare, UI, Commits).

## Effizient arbeiten
- **Große Dateien nicht ganz lesen**, sondern per Grep/Offset: `spec.md` (985 Zeilen, Game-Design), `README.md`, `server/src/rooms/WorldRoom.ts` (~1300), `client/src/render/WorldView.ts` (~1100), `client/src/game/Game.ts` (~1000), `shared/src/sim/car.ts` (~860).
- `spec.md`: Kapitel stehen als Zeilen wie `8.2 Fahrphysik` → `grep -n "^8\.2 " spec.md`, dann gezielt lesen.
- `scripts/_tmp-*.ts` sind veraltete Debug-Skripte (vom Typecheck ausgeschlossen) – ignorieren.
- `client/public/assets/` sind Dritt-Assets (glTF/OGG, siehe `CREDITS.md`) – nicht durchsuchen.

## Struktur
- `shared/src/` – Code für Client **und** Server: `protocol.ts` (Nachrichten), `constants.ts`, `balance.ts`, `sim/` (Fahrzeugphysik; Handling-Werte in `sim/handling.ts`), `world/` (prozedurale Weltgenerierung, `palmara.ts`, `mapgen.ts`, `roads.ts`, `city.ts`).
- `server/src/` – `index.ts` (HTTP + WS `/ws`, liefert in Prod `dist/client` aus), `rooms/WorldRoom.ts` (Spiel-Loop, Dev-Befehle), `sim/Traffic.ts`, `quests/`, `services/PlayerStore.ts` (JSON-Dateien in `DATA_DIR`, Standard `data/`).
- `client/src/` – `game/Game.ts` (Hauptschleife), `render/` (Three.js-Aufbau), `net/Network.ts`, `ui/`, `audio/`, `input/`.

## Befehle
- `npm run dev` – Server (2567) + Vite (5173, proxyt `/ws`)
- `npm run typecheck` – muss grün sein (CI prüft das)
- `npm run build` – Client nach `dist/client`
- Prod lokal testen: `NODE_ENV=production node --import tsx server/src/index.ts`
- Dev-Modus (Chatbefehle `/test`, `/auto` …) ist an, außer `NODE_ENV=production` oder `npm start` (`DEV` in `WorldRoom.ts`).
