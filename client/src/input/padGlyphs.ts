// Tastensymbole für Hinweise im Controller-Modus: Xbox (A/B/X/Y, LB/RB …) bzw. PlayStation (✕/○/□/△, L1/R1 …).
// `padHint` übersetzt die Tastatur-Hinweise des Spiels (<b>F</b>, <b>Shift</b> …) in Controller-Tasten.
import { P, type PadFamily } from './Gamepad';

const XBOX: Record<number, string> = {
  [P.A]: 'A', [P.B]: 'B', [P.X]: 'X', [P.Y]: 'Y', [P.LB]: 'LB', [P.RB]: 'RB', [P.LT]: 'LT', [P.RT]: 'RT',
  [P.VIEW]: '⧉ View', [P.MENU]: '☰ Menü', [P.L3]: 'L3', [P.R3]: 'R3', [P.UP]: '✚▲', [P.DOWN]: '✚▼', [P.LEFT]: '✚◀', [P.RIGHT]: '✚▶', [P.PAD]: 'Touchpad',
};
const PS: Record<number, string> = {
  ...XBOX, [P.A]: '✕', [P.B]: '○', [P.X]: '□', [P.Y]: '△', [P.LB]: 'L1', [P.RB]: 'R1', [P.LT]: 'L2', [P.RT]: 'R2', [P.VIEW]: 'Create', [P.MENU]: 'Options',
};
const FACE_CLS: Record<number, string> = { [P.A]: 'a', [P.B]: 'b', [P.X]: 'x', [P.Y]: 'y' };

/** HTML für eine Controller-Taste (farbiger Knopf bei A/B/X/Y). */
export function glyph(btn: number, fam: PadFamily): string {
  const label = (fam === 'ps' ? PS : XBOX)[btn] ?? '?';
  const face = FACE_CLS[btn];
  return `<b class="pg${face ? ' pg-face pg-' + face : ''}">${label}</b>`;
}
const stickG = (which: 'L' | 'R') => `<b class="pg">${which === 'L' ? 'L-Stick' : 'R-Stick'}</b>`;

/**
 * Tastatur-Hinweis → Controller-Hinweis. Ersetzt nur die eigenen <b>Taste</b>-Marken; Texte bleiben.
 * `veh` = im Fahrzeug (Shift/Leertaste liegen dort auf RB/LB).
 */
export function padHint(html: string, fam: PadFamily, veh: boolean): string {
  const g = (b: number) => glyph(b, fam);
  return html.replace(/<b>([^<]+)<\/b>/g, (all, key: string) => {
    switch (key.trim()) {
      case 'F': return g(P.Y);
      case 'E': return g(P.X);
      case 'Shift': return veh ? g(P.RB) : g(P.A);
      case 'Leertaste': return g(P.LB);
      case 'H': return g(P.L3);
      case 'M': return g(P.MENU);
      case 'K': return g(P.VIEW);
      case 'Enter': return g(P.LEFT);
      case 'W': return g(P.RT);
      case 'W/S': return `${g(P.RT)}/${g(P.LT)}`;
      case 'A/D': case 'WASD': return stickG('L');
      case 'Q/R': return stickG('R');
      default: return all;
    }
  });
}

/** Belegungsübersicht (Login-Bildschirm, Handy → Steuerung). */
export function padLayout(fam: PadFamily): { title: string; rows: [string, string][] }[] {
  const g = (b: number) => glyph(b, fam);
  return [
    { title: 'Zu Fuß', rows: [
      [stickG('L'), 'Bewegen'], [stickG('R'), 'Zielen'], [g(P.RT), 'Schießen / Schlagen'], [g(P.A) + ' / ' + g(P.L3), 'Sprinten'],
      [g(P.Y), 'Ein-/Aussteigen'], [g(P.X), 'Reden / Benutzen (halten möglich)'], [`${g(P.LB)} ${g(P.RB)}`, 'Waffe wechseln'],
    ] },
    { title: 'Fahrzeug', rows: [
      [g(P.RT) + ' / ' + g(P.LT), 'Gas / Bremse & Rückwärts'], [stickG('L'), 'Lenken'], [g(P.RB) + ' / ' + g(P.A), 'Nitro'],
      [g(P.LB), 'Handbremse'], [g(P.B), 'Drive-by schießen (R-Stick zielt)'], [g(P.L3), 'Hupe'], [g(P.X), 'Aufrichten / Reden'], [g(P.Y), 'Aussteigen'],
    ] },
    { title: 'Flugzeug & Heli', rows: [
      [g(P.RT) + ' / ' + g(P.LT), 'Schub'], [g(P.RB) + ' / ' + g(P.LB), 'Steigen / Sinken'], [stickG('R'), 'Heli seitwärts'],
    ] },
    { title: 'Menüs', rows: [
      [g(P.MENU), 'Handy (Warteräume, Einstellungen)'], [g(P.VIEW) + (fam === 'ps' ? ' / ' + g(P.PAD) : ''), 'Karte'], [g(P.UP), 'Quest-Log'],
      [g(P.DOWN), 'Inventar'], [g(P.LEFT), 'Chat'], [g(P.RIGHT), 'Nächste Waffe'],
      ['✚ / ' + stickG('L'), 'Auswählen'], [g(P.A), 'Bestätigen / Dialog weiter'], [g(P.B), 'Zurück / Schließen'], [stickG('R'), 'Blättern'],
    ] },
  ];
}
