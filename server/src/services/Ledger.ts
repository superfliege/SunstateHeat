// Transaktionsprotokoll (Spec 14.6 / 20): jede Geldbewegung mit Grund, als JSON-Zeilen.
// Dazu eine einfache Anomalie-Erkennung (zu hohe Einnahmen pro Stunde).
import { appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BALANCE } from '../../../shared/src/balance';

const file = join(resolve(process.cwd(), process.env.DATA_DIR ?? 'data'), 'transactions.jsonl');
const earned = new Map<string, { since: number; sum: number; flagged: boolean }>();

export function logTransaction(profileKey: string, name: string, amount: number, reason: string) {
  if (!amount) return;
  const now = Date.now();
  void appendFile(file, `${JSON.stringify({ t: now, key: profileKey, name, amount, reason })}\n`).catch(() => { /* Ordner fehlt o. Ä. – Spiel soll nicht abbrechen */ });
  if (amount <= 0) return;
  let e = earned.get(profileKey);
  if (!e || now - e.since > 3_600_000) earned.set(profileKey, (e = { since: now, sum: 0, flagged: false }));
  e.sum += amount;
  if (!e.flagged && e.sum > BALANCE.economy.anomalyPerHour) {
    e.flagged = true;
    console.warn(`[anomalie] ${name} (${profileKey}) hat ${e.sum} $ in unter einer Stunde verdient – zur Prüfung markiert.`);
  }
}
