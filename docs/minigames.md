# Fahrzeug-Minispiele

Gemeinsames Fundament für Arena-Modi (Sumo, später Destruction Derby, Bomb Bus, Hot Potato,
Drift, Fallout). Jeder Modus läuft mit echten Spielern, nur mit NPCs oder gemischt.

## Starten / Testen
- **Im Spiel:** 🏟-Telefon „Minispiele – Arena-Telefon“ direkt am Spawn (neben dem 🚕-Telefon), F drücken, Modus wählen.
  Spieler im Umkreis (`joinRange`) können `lobbyTime` Sekunden lang beitreten; fehlende Plätze füllen NPCs auf.
- **Dev-Befehle (Chat, nur Dev-Modus):**
  - `/mg sumo [anzahl] [leicht|normal|schwer]` – Debug-Runde **nur mit NPCs**, du schaust vom Ufer aus zu (Kamera auf die Arena).
  - `/mg sumo mit [leicht|normal|schwer]` – sofort mit dir + NPCs starten (ohne Anmeldephase).
  - `/mg stop` – alle laufenden Runden abbrechen.
- Abbrechen als Spieler: wie bei Aufträgen (Quest abbrechen) – ein NPC übernimmt dein Fahrzeug (`onLeave`).

## Aufbau
| Datei | Aufgabe |
|---|---|
| `shared/src/minigames/index.ts` | Typen, Registry (`MINIGAMES`), HUD-Format `MgHud` |
| `shared/src/minigames/arenas.json` | Arenen als Daten: Mitte, Boden, Grenzen, Todeszonen, Startplätze, Zuschauerplatz, Zonen |
| `shared/src/minigames/config/<modus>.json` | Alle Werte pro Modus (Zeiten, Teilnehmer, Schaden, Belohnungen …) |
| `shared/src/minigames/config/bots.json` | NPC-Schwierigkeitsstufen (Reaktionszeit, Zielfehler, Fehlerrate, Vorsicht) und Namen |
| `shared/src/world/arenaFloor.ts` | Dynamische Arena-Böden (Scheibe/Kacheln); `WorldMap.floors` überlagert `tileAt`/`surfaceY` |
| `server/src/minigames/Minigame.ts` | Basisklasse: Lobby, Bot-Auffüllung, Countdown, Tick, Eliminierung, Sieg, Zeitlimit, Ergebnis, Aufräumen |
| `server/src/minigames/BotDriver.ts` | NPC-Bausteine: `chaseTarget`, `flee`, `holdZone`, `avoidHazard`, `block` (Context Steering) |
| `server/src/minigames/Arena.ts` | Laufzeit-Arena: Boden öffnen/schließen, Startplätze, Todeszonen, Gefahrenkarte für Bots |
| `server/src/minigames/MinigameManager.ts` | Schnittstelle zu `WorldRoom` (frozen/locked/mayEnter/damageScale/onCrash/view), Telefon, `/mg` |
| `server/src/minigames/modes/Sumo.ts` | Modus Sumo |
| `client/src/render/ArenaView.ts` | Darstellung der Böden (Plattform mit Rot-Weiß-Rand/Leuchtring, Kacheln mit Blinken) |
| `client/src/ui/Hud.ts` | Minispiel-HUD im Quest-Panel, Eliminierungs-Feed, Ergebnis-Bildschirm |

### Synchronisation (Server-autoritativ)
- Eliminierungen, Timer, Punkte, Plattformzustand entscheidet nur der Server.
- Eigener Zustand + HUD: `snap.me.quest` (`QuestState` mit `freeze`, `count`, `timer`, `mg`).
- Arena-Böden: `snap.af` (nur bei Änderung je Client). Der Client übernimmt sie in seine `WorldMap`,
  damit Fahrphysik-Prediction und Rendering exakt dieselbe Plattform kennen – wer runterfährt, fällt wirklich.
- Effekte: normale Events (`crash`, `boom`, …).

### Ablauf einer Runde
`lobby` → `grid` (Countdown, Autos eingefroren) → `run` → `end` (Ergebnis-Bildschirm, Belohnung) → alle zurück ans Telefon.
Eliminierungen werden je Tick gesammelt: Wer im selben Tick ausscheidet, teilt sich den Platz; scheiden alle
gleichzeitig aus, ist es ein Unentschieden. Der letzte Rammer innerhalb von 4 s bekommt den „Abschuss“ im Feed.

### Randfälle
- **Disconnect / Abbrechen:** `onLeave: "bot"` → NPC übernimmt, `"eliminate"` → scheidet aus.
- **Letzter echter Spieler weg:** Runde wird abgebrochen (`abortWithoutHumans`), außer bei `/mg`-Debugrunden.
- **Beitritt während der Runde:** Warteliste; nach Rundenende öffnet automatisch die nächste Runde mit diesen Spielern.
- **Zeitlimit:** Modus entscheidet (`onTimeUp`), Sumo: am nächsten an der Mitte (oder `timeUp: "tie"`).

## Neuen Modus hinzufügen
1. `config/<modus>.json` anlegen, in `shared/src/minigames/index.ts` in `MINIGAMES` eintragen (+ `MinigameId`).
2. Klasse `extends Minigame<Config>` in `server/src/minigames/modes/` mit mindestens `tick()` und `botThink()`;
   optional `outReason`, `checkWin`, `onTimeUp`, `damageScale`, `onCollide`, `hudInfo`, `scoreText`.
3. In `MinigameManager` unter `FACTORIES` eintragen. Telefon, HUD, `/mg <modus>` funktionieren dann automatisch.

## Neue Arena hinzufügen (ohne Code)
Eintrag in `arenas.json` und im Modus-Config `"arena": "<id>"` setzen. Koordinaten in Weltmetern;
Plattformen über Wasser eignen sich besonders (Sturz = Wasser). Boden: `{"shape":"disc","y":3.2,"r":24}`
oder `{"shape":"grid","y":3,"cell":4,"cols":12,"rows":12}`.
