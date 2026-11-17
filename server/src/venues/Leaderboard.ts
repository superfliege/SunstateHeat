// Globale Bestenliste „Dance Floor Heat“ (instanzübergreifend): Top 10 je Song und Schwierigkeit,
// als JSON-Datei in DATA_DIR (wie die Spielstände). Schreiben gedrosselt und asynchron.
import { mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class Leaderboard {
  private data: Record<string, [string, number][]> = {};
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string | null;

  constructor(persist = true) {
    if (!persist) { this.file = null; return; }
    const dir = resolve(process.cwd(), process.env.DATA_DIR ?? 'data');
    this.file = join(dir, 'dance-leaderboard.json');
    try { mkdirSync(dir, { recursive: true }); this.data = JSON.parse(readFileSync(this.file, 'utf8')); } catch { this.data = {}; }
  }

  submit(key: string, name: string, score: number) {
    const list = (this.data[key] ??= []);
    const old = list.find((e) => e[0] === name);
    if (old) { if (old[1] >= score) return; old[1] = score; } else list.push([name, score]);
    list.sort((a, b) => b[1] - a[1]);
    list.length = Math.min(list.length, 10);
    this.dirty = true;
    if (this.file && !this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 5000);
  }

  top(key: string): [string, number][] { return this.data[key] ?? []; }

  async flush() {
    if (!this.dirty || !this.file) return;
    this.dirty = false;
    await writeFile(this.file, JSON.stringify(this.data)).catch(() => { /* egal */ });
  }
}

/** Eine Instanz für den ganzen Server (alle Welt-Instanzen teilen die globale Liste). */
let shared: Leaderboard | null = null;
export const globalLeaderboard = () => (shared ??= new Leaderboard(process.env.NODE_ENV !== 'test'));
