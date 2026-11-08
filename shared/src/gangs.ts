// Gangs, Rivalitäten und Rufstufen (Spec 12).

export type GangId = 'neon' | 'marlin' | 'mangrove' | 'dustline';

export interface GangDef {
  id: GangId;
  name: string;
  zone: string;
  color: number;
  rival: GangId;
}

export const GANGS: Record<GangId, GangDef> = {
  neon: { id: 'neon', name: 'Neon Syndicate', zone: 'Port Coralia', color: 0xff2fd0, rival: 'marlin' },
  marlin: { id: 'marlin', name: 'Marlin Club', zone: 'Coral Keys', color: 0x2ad4c9, rival: 'neon' },
  mangrove: { id: 'mangrove', name: 'Mangrove Kings', zone: 'Gator Flats', color: 0x6b8e23, rival: 'dustline' },
  dustline: { id: 'dustline', name: 'Dustline Haulers', zone: 'Dry Pine Country', color: 0xb5532c, rival: 'mangrove' },
};
export const GANG_IDS = Object.keys(GANGS) as GangId[];

export const REP_MIN = -100;
export const REP_MAX = 100;
export const REP_ATTACK_MEMBER = -5;

export type RepStatus = 'archenemy' | 'hostile' | 'neutral' | 'friendly' | 'trusted';

export function repStatus(rep: number): RepStatus {
  if (rep <= -50) return 'archenemy';
  if (rep <= -10) return 'hostile';
  if (rep < 20) return 'neutral';
  if (rep < 60) return 'friendly';
  return 'trusted';
}

export const clampRep = (v: number) => Math.max(REP_MIN, Math.min(REP_MAX, Math.round(v)));

/** Wendet eine Rufänderung auf eine Gang an (gibt die neue Rufkarte zurück, mutiert nicht). */
export function addRep(rep: Partial<Record<GangId, number>>, gang: GangId, delta: number): Partial<Record<GangId, number>> {
  return { ...rep, [gang]: clampRep((rep[gang] ?? 0) + delta) };
}

/** Quest-Ruf: +delta bei der Gang, entsprechend negativ bei der Rivalen-Gang (Spec 12.2). */
export function questRep(rep: Partial<Record<GangId, number>>, gang: GangId, gain: number, rivalLoss: number) {
  return addRep(addRep(rep, gang, gain), GANGS[gang].rival, -Math.abs(rivalLoss));
}

/** Bei Gruppen mit gemischtem Ruf zählt das Mitglied mit dem schlechtesten Ruf (Spec 12.3). */
export function worstRep(reps: number[]): number {
  return reps.length ? Math.min(...reps) : 0;
}
