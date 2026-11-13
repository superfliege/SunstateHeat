# Fahrzeug-Minispiele

Gemeinsames Fundament für Fahrzeug-Minispiele. Jeder Modus läuft mit echten Spielern, nur mit NPCs
oder gemischt. Alle Werte stehen in `shared/src/minigames/config/<modus>.json`.

## Modi
| Modus (`/mg …`) | Arena | Kurz |
|---|---|---|
| `sumo` | Sumo-Plattform (1730, 968) | Runde Plattform über dem Meer, schrumpft; wer ins Wasser fällt, ist raus |
| `derby` | Crash-Bowl mit Bande (1740, 1090) | Alle gegen alle; Schaden je Zone (Front robust, Heck/Seite empfindlich); Schrott/Motorschaden = raus; Zeitablauf → meiste HP |
| `hotpotato` | Crash-Bowl | Bombe per Rammen weitergeben, Schutzzeit nach der Übergabe, Zünder wird je Runde kürzer |
| `fallout` | Kachel-Plattform (1740, 760) | Kacheln blinken und verschwinden (zufällig + nach dem Überfahren) – im Auto |
| `fallout_fuss` | Kachel-Plattform | dasselbe zu Fuß (NPCs als Fußgänger), Kacheln fallen nach dem Betreten |
| `drift` | Drift-Ring mit Bande (1740, 860) | Punkte für Winkel/Tempo/Dauer, Combo-Kette, Kontakt bricht ab; höchste Punktzahl gewinnt |
| `bombbus` | Innenstadt (Straßennetz) | Bus muss über Mindesttempo bleiben und überleben bzw. das Ziel erreichen; Jäger blockieren/sperren Straßen |

## Starten / Testen
- **Im Spiel:** Jeder Modus hat 2–5 eigene Arena-Telefone, über die Viertel verteilt (Anzahl: `phones` in der Modus-Config,
  Orte: `minigamePhones()` in `shared/src/questLocations.ts`, deterministisch). Je Modus steht eins nahe dem Spawn.
  Auf der großen Karte (K) sind sie als pinke Symbole mit Modus-Emoji markiert; Maus drüber (Touch: antippen) zeigt einen
  Tooltip mit Modus, Viertel, Beschreibung, Teilnehmern, Preisgeld und den anderen Standorten. F am Telefon meldet an.
  Spieler im Umkreis (`joinRange`) des Telefons können `lobbyTime` Sekunden lang beitreten; fehlende Plätze füllen NPCs auf.
  Nach der Runde kehrt jeder zu dem Telefon zurück, an dem er sich angemeldet hat.
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
| `server/src/minigames/BotDriver.ts` | NPC-Bausteine: `chaseTarget`, `flee`, `holdZone`, `avoidHazard`, `block`, dazu `seek`, `steerTo` (Spurführung), `driftStyle` (Context Steering) |
| `server/src/minigames/Arena.ts` | Laufzeit-Arena: Boden öffnen/schließen, Startplätze, Todeszonen, Gefahrenkarte für Bots |
| `server/src/minigames/MinigameManager.ts` | Schnittstelle zu `WorldRoom` (frozen/locked/mayEnter/damageScale/onCrash/view), Telefon, `/mg` |
| `server/src/minigames/RoadNav.ts` | Straßennetz-Wegfindung (Dijkstra-Wegweiser) und Straßenfolger für NPCs in der Stadt |
| `server/src/minigames/modes/*.ts` | Modi: `Sumo`, `Derby`, `HotPotato`, `Fallout` (Auto/zu Fuß), `Drift`, `BombBus` |
| `shared/src/minigames/drift.ts` | Drift-Wertung (gleiche Erkennung wie das Stunt-System, auch für Rennen nutzbar) |
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
oder `{"shape":"grid","y":3,"cell":4,"cols":12,"rows":12}`, mit `"wall": 3` bekommt er eine Bande.
Ohne `floor` spielt die Arena in der normalen Welt (z. B. `city` für Bomb Bus).
`lines` enthält feste Fahrlinien (Driftlinie der NPCs), `zones` benannte Kreise.

## NPC-Schwierigkeit
`config/bots.json`: `leicht`/`normal`/`schwer` mit Reaktionszeit, Zielfehler, Fehlerrate, Vorsicht.
`bots.mix` streut die Stufen; `/mg <modus> <anzahl> schwer` erzwingt eine Stufe.

## Bekannte Grenzen
- Bomb Bus: Der NPC-Busfahrer ist schwächer als die Jäger (enge Kurven in der Innenstadt mit Mindesttempo);
  Balance über `minSpeed`, `fuse`, `hunterHeadStart`, `blockerShare`, `clearTraffic` in `bombbus.json`.
- Drift: NPC-Punkte sind eine Rate je Stufe mit Streuung (laut Vorgabe), nicht aus ihrer echten Fahrt berechnet.
- Rennen und Catch the Taxi laufen noch auf ihren eigenen Klassen; die Basisklasse ist darauf ausgelegt,
  sie später umzustellen (Lobby, Countdown, Bot-Auffüllung, Ergebnis sind identisch aufgebaut).
