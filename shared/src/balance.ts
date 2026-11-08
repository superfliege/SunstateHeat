// Zentrale Balancing-Datei (Spec 14.6): alle Zahlenwerte für Wirtschaft, Fortschritt und Tod.
// Änderungen hier wirken auf Client und Server, ohne Logik anzufassen.

export const BALANCE = {
  economy: {
    startCash: 200,
    startBank: 0,
    /** Geldübergaben über diesem Betrag pro Stunde werden protokolliert/gedrosselt. */
    giveLimitPerHour: 10_000,
    /** Gestohlenes Fahrzeug beim Schrottplatz: Anteil des Werts, Abklingzeit in Sekunden. */
    scrapShare: 0.1,
    scrapCooldown: 300,
    /** Anomalie-Erkennung: mehr Einnahmen pro Stunde markiert den Account. */
    anomalyPerHour: 100_000,
  },
  player: {
    maxHealth: 100,
    /** Gesundheit regeneriert automatisch bis zu diesem Wert. */
    regenCap: 30,
    regenPerSecond: 2,
    /** Sekunden ohne Schaden, bevor die Regeneration einsetzt. */
    regenDelay: 5,
    maxArmor: 100,
    armorAbsorb: 0.5,
    /** Sekunden, in denen Gruppenmitglieder wiederbeleben können. */
    reviveWindow: 15,
    reviveHold: 3,
    /** Respawn-Kosten: Anteil des Bargelds, begrenzt. */
    respawnCostShare: 0.1,
    respawnCostMax: 1_000,
    /** Festnahme: Anteil des Bargelds, der verloren geht. */
    arrestCostShare: 0.15,
    /** Unverwundbar nach dem Respawn (Sekunden). */
    spawnProtection: 3,
  },
  progress: {
    maxLevel: 50,
    /** XP für den Aufstieg von Stufe n auf n+1: base * n^exp. */
    xpBase: 100,
    xpExp: 1.5,
    /** Komfortbonus: Ausdauer bis +20 % bei Stufe 50 (keine Kampfwerte, Spec 7.4). */
    maxStaminaBonus: 0.2,
  },
  /** XP-Belohnungen für kleine Aktivitäten. */
  xp: {
    stunt: 2,
    drift: 1,
    nearMiss: 1,
  },
} as const;

/** XP, die benötigt werden, um von `level` auf `level + 1` aufzusteigen. */
export function xpForNextLevel(level: number): number {
  const p = BALANCE.progress;
  return Math.round(p.xpBase * Math.pow(Math.max(1, level), p.xpExp));
}

/** Gesamt-XP → { level, xpIntoLevel, xpNeeded }. */
export function levelFromXp(totalXp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let left = Math.max(0, Math.floor(totalXp));
  while (level < BALANCE.progress.maxLevel) {
    const need = xpForNextLevel(level);
    if (left < need) return { level, into: left, needed: need };
    left -= need;
    level++;
  }
  return { level, into: 0, needed: 0 };
}

/** Komfortbonus auf die Ausdauer (Faktor ≥ 1). */
export function staminaBonus(level: number): number {
  return 1 + BALANCE.progress.maxStaminaBonus * ((Math.min(level, BALANCE.progress.maxLevel) - 1) / (BALANCE.progress.maxLevel - 1));
}
