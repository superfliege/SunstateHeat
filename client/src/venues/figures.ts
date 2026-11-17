// Figuren der Venues (Club, Casino, Außenbereiche): dieselben Kenney-Charaktere wie die Passanten
// (EntityViews.setVenueNpc), mit Szenario-Posen aus npcActs (Tanzstile, Jubeln, DJ, Croupier, Automat …).
// VenueClient/Exterior sammeln die Liste pro Bild, Game zeichnet sie zusammen mit den übrigen Figuren.
import type { KenneyRole } from '../render/kenneyCharacters';
import { VNpcKind } from '../../../shared/src/venues/net';

export interface VenueFigure {
  /** Eindeutige ID (Innenraum: Server-ID; Außenbereich: ab EXTERIOR_ID) */
  id: number;
  x: number; z: number; a: number;
  /** Animation (Act-ID) */
  act: number;
  role: KenneyRole;
  shirt?: number;
  scale: number;
}

export const EXTERIOR_ID = 1_000_000;

export class FigureList {
  readonly list: VenueFigure[] = [];
  begin() { this.list.length = 0; }
  add(id: number, x: number, z: number, a: number, act: number, role: KenneyRole, shirt?: number, scale = 1) {
    this.list.push({ id, x, z, a, act, role, shirt, scale });
  }
}

const GUEST_SHIRTS = [0xff3fa4, 0x3af2ff, 0xffd23a, 0x9a5aff, 0x7dff6a, 0xff8a2a, 0xffffff, 0xe0453a, 0x3a6bff, 0xf4f1e8];
const GUEST_STYLES: KenneyRole[] = ['casual', 'beach', 'casual', 'business', 'casual'];

/** Aussehen je NPC-Art (Server-Tupel): Rolle des Charakter-Assets und Oberteilfarbe. */
export function lookForKind(kind: number, seed: number, style: number): { role: KenneyRole; shirt?: number; scale: number } {
  const s = style % 1000;
  switch (kind) {
    case VNpcKind.COP: return { role: 'cop', scale: 1.02 };
    case VNpcKind.GUARD: return { role: 'business', shirt: 0x16161c, scale: 1.08 };
    case VNpcKind.BOUNCER: return { role: 'business', shirt: 0x111118, scale: 1.12 };
    case VNpcKind.CROUPIER: case VNpcKind.WAITER: return { role: 'business', shirt: 0xf4f1e8, scale: 1 };
    case VNpcKind.STAFF: return { role: 'business', shirt: 0x7a1f2e, scale: 1 };
    case VNpcKind.BARKEEP: return { role: 'casual', shirt: 0xff3fa4, scale: 1 };
    case VNpcKind.DJ: return { role: 'casual', shirt: 0x111118, scale: 1 };
    case VNpcKind.PIANIST: return { role: 'business', shirt: 0x111118, scale: 1 };
    case VNpcKind.GANG: return { role: 'gang', shirt: s === 1 ? 0x2ad4c9 : 0xff2fd0, scale: 1 };
    case VNpcKind.VIP: return { role: 'business', shirt: 0xe8c35a, scale: 1 };
    default: return { role: GUEST_STYLES[(seed + s) % GUEST_STYLES.length], shirt: GUEST_SHIRTS[(seed + s) % GUEST_SHIRTS.length], scale: 1 };
  }
}
