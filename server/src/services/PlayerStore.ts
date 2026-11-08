// Dauerhafte Speicherstände und Konten (Spec 19).
// Umsetzung als JSON-Datei mit atomarem Schreiben (kein natives Modul nötig). Die Schnittstelle
// `PlayerStore` bleibt gleich, falls später SQLite/PostgreSQL eingesetzt wird.
// Passwörter werden mit scrypt gehasht (in Node eingebaut; die Spec nennt argon2id – austauschbar,
// sobald eine argon2-Abhängigkeit gewünscht ist).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BALANCE } from '../../../shared/src/balance';

export interface PlayerProfile {
  /** Schlüssel im Speicher: "acc:<name>" (Konto) oder "guest:<id>" (Gast). */
  key: string;
  name: string;
  money: number;
  bank: number;
  xp: number;
  health: number;
  armor: number;
  /** Ruf pro Gang (-100 … 100). */
  reputation: Record<string, number>;
  /** Rucksack: Gegenstand → Anzahl. */
  inventory: Record<string, number>;
  /** Abgeschlossene Quests und Abklingzeiten (Ende als Epoch-ms). */
  questsDone: string[];
  questCooldowns: Record<string, number>;
  /** Besessene Waffen mit Munition (Nahkampfwaffen: 0). Fäuste hat jeder. */
  weapons: Record<string, number>;
  /** Letzte Position (null = Standard-Spawn). */
  pos: { x: number; z: number } | null;
  playtimeSeconds: number;
  createdAt: number;
  lastLogin: number;
}

interface Account { name: string; salt: string; hash: string; key: string; createdAt: number }
interface Db { version: 1; accounts: Record<string, Account>; profiles: Record<string, PlayerProfile> }

export type AuthResult = { ok: true; profile: PlayerProfile; registered: boolean } | { ok: false; error: string };

export const MIN_PASSWORD = 8;

export interface PlayerStore {
  authenticate(name: string, password: string | undefined, guestId: string | undefined): Promise<AuthResult>;
  save(profile: PlayerProfile): void;
  flush(): Promise<void>;
}

function freshProfile(key: string, name: string): PlayerProfile {
  const now = Date.now();
  return {
    key, name,
    money: BALANCE.economy.startCash, bank: BALANCE.economy.startBank, xp: 0,
    health: BALANCE.player.maxHealth, armor: 0,
    reputation: {}, inventory: {}, questsDone: [], questCooldowns: {}, weapons: {}, pos: null,
    playtimeSeconds: 0, createdAt: now, lastLogin: now,
  };
}

const hashPassword = (pw: string, salt: string) => scryptSync(pw, salt, 32).toString('hex');
const guestKeyOf = (id: string) => `guest:${id.replace(/[^\w-]/g, '').slice(0, 40)}`;

export class FilePlayerStore implements PlayerStore {
  private db: Db = { version: 1, accounts: {}, profiles: {} };
  private readonly file: string;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  constructor(dir = process.env.DATA_DIR ?? 'data') {
    const base = resolve(process.cwd(), dir);
    if (!existsSync(base)) mkdirSync(base, { recursive: true });
    this.file = join(base, 'players.json');
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Db>;
        this.db = { version: 1, accounts: raw.accounts ?? {}, profiles: raw.profiles ?? {} };
      } catch (err) {
        console.error('[store] players.json unlesbar, starte leer:', (err as Error).message);
      }
    }
  }

  async authenticate(name: string, password: string | undefined, guestId: string | undefined): Promise<AuthResult> {
    const lower = name.toLowerCase();
    const acc = this.db.accounts[lower];
    const now = Date.now();

    if (password) {
      if (acc) {
        const given = Buffer.from(hashPassword(password, acc.salt), 'hex');
        const real = Buffer.from(acc.hash, 'hex');
        if (given.length !== real.length || !timingSafeEqual(given, real)) return { ok: false, error: 'Falsches Passwort.' };
        const profile = this.db.profiles[acc.key] ?? freshProfile(acc.key, acc.name);
        profile.lastLogin = now;
        this.db.profiles[acc.key] = profile;
        this.touch();
        return { ok: true, profile, registered: false };
      }
      if (password.length < MIN_PASSWORD) return { ok: false, error: `Das Passwort braucht mindestens ${MIN_PASSWORD} Zeichen.` };
      // Registrierung. Ein vorhandener Gast-Fortschritt wird in das Konto übernommen.
      const salt = randomBytes(16).toString('hex');
      const key = `acc:${lower}`;
      const guestKey = guestId ? guestKeyOf(guestId) : null;
      const guest = guestKey ? this.db.profiles[guestKey] : undefined;
      const profile: PlayerProfile = guest ? { ...guest, key, name } : freshProfile(key, name);
      profile.lastLogin = now;
      if (guestKey && guest) delete this.db.profiles[guestKey];
      this.db.accounts[lower] = { name, salt, hash: hashPassword(password, salt), key, createdAt: now };
      this.db.profiles[key] = profile;
      this.touch();
      return { ok: true, profile, registered: true };
    }

    if (acc) return { ok: false, error: 'Dieser Name gehört zu einem Konto – bitte Passwort eingeben.' };
    const key = guestKeyOf(guestId ?? `n-${lower}`);
    const profile = this.db.profiles[key] ?? freshProfile(key, name);
    profile.name = name;
    profile.lastLogin = now;
    this.db.profiles[key] = profile;
    this.touch();
    return { ok: true, profile, registered: false };
  }

  save(profile: PlayerProfile) {
    this.db.profiles[profile.key] = profile;
    this.touch();
  }

  private touch() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 1000);
  }

  /** Schreibt die Datei (atomar über Temp-Datei + Rename); Aufrufe werden hintereinander ausgeführt. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const tmp = `${this.file}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(this.db));
        await rename(tmp, this.file);
      } catch (err) {
        this.dirty = true;
        console.error('[store] Speichern fehlgeschlagen:', (err as Error).message);
      }
    });
    return this.writing;
  }
}
