// Inhaltsprüfung: Viertel-DNA, Gang-Profile und Straßenereignisse gegen Schema und Referenzen.
// Aufruf: npm test  (läuft auch in CI)
import { GANG_IDS } from '../shared/src/gangs';
import { ARCHETYPES } from '../shared/src/npc/archetypes';
import { STREET_EVENTS, validateAllEvents } from '../shared/src/content/events';
import { GANG_PROFILES, gangRelation } from '../shared/src/factions';
import { DISTRICT_DNA, DISTRICT_IDS } from '../shared/src/world/districts';
import { DISTRICTS } from '../shared/src/world/palmara';
import { ZONE_NAMES } from '../shared/src/world/WorldMap';

const errs: string[] = [];
const arch = new Set(ARCHETYPES.map((a) => a.id));
const mapNames = new Set(DISTRICTS.map((d) => d.name));
const zones = new Set(ZONE_NAMES);

// Viertel-DNA
const covered = new Set<string>();
for (const id of DISTRICT_IDS) {
  const d = DISTRICT_DNA[id];
  const f = (m: string) => errs.push(`Viertel ${id}: ${m}`);
  if (d.id !== id) f('id passt nicht zum Schlüssel');
  if (d.values.length < 3 || d.values.length > 5) f('3–5 Werte erwartet');
  if (!d.motto.trim() || !d.philosophy.trim()) f('Motto/Philosophie fehlt');
  for (const n of d.mapDistricts) { if (!mapNames.has(n)) f(`Karten-Viertel ${n} existiert nicht`); covered.add(n); }
  for (const z of d.mapZones ?? []) if (!zones.has(z)) f(`Zone ${z} existiert nicht`);
  if (!d.residents.length) f('keine Bewohner-Archetypen');
  for (const r of d.residents) { if (!arch.has(r.base)) f(`Bewohner ${r.id}: Basis-Archetyp ${r.base} fehlt`); if (!(r.weight > 0)) f(`Bewohner ${r.id}: Gewicht > 0`); }
  for (const [k, v] of Object.entries(d.mood)) if (v < 0 || v > 100) f(`Stimmung ${k} außerhalb 0–100`);
  if (d.homeGang && !GANG_IDS.includes(d.homeGang)) f('unbekannte Heim-Gang');
  for (const g of d.contestedBy ?? []) if (!GANG_IDS.includes(g)) f(`unbekannte Gang ${g}`);
  if (Object.keys(d.topics).length < 3) f('mindestens 3 Gesprächsthemen');
}
for (const n of mapNames) if (!covered.has(n)) errs.push(`Karten-Viertel „${n}“ hat keine DNA`);

// Gang-Profile
for (const g of GANG_IDS) {
  const p = GANG_PROFILES[g];
  const f = (m: string) => errs.push(`Gang ${g}: ${m}`);
  if (p.id !== g) f('id passt nicht');
  const lts = p.hierarchy.lieutenants.length;
  if (lts < 2 || lts > 3) f('2–3 Leutnants erwartet');
  for (const t of p.turf) if (!DISTRICT_DNA[t]) f(`Revier ${t} unbekannt`);
  for (const t of p.ambitions) if (!DISTRICT_DNA[t]) f(`Ambition ${t} unbekannt`);
  for (const o of GANG_IDS) if (o !== g && !p.slang.rivalNicknames[o]?.length) f(`kein Spitzname für ${o}`);
  for (const o of GANG_IDS) if (o !== g && !p.relations[o]) f(`keine Beziehung zu ${o}`);
  for (const o of GANG_IDS) if (o !== g && gangRelation(g, o) && GANG_PROFILES[o].relations[g]?.kind !== p.relations[o]?.kind) f(`Beziehungsart zu ${o} nicht symmetrisch`);
  for (const k of Object.keys(p.slang.districtMockery)) if (!DISTRICT_DNA[k as keyof typeof DISTRICT_DNA]) f(`Spott über unbekanntes Viertel ${k}`);
  for (const s of p.scenarios) if (!s.lines.length) f(`Szenario ${s.id} ohne Zeilen`);
  for (const [k, v] of Object.entries(p.ai)) if (v < 0 || v > 1) f(`KI-Neigung ${k} außerhalb 0–1`);
}

// Ereignisse
errs.push(...validateAllEvents());
for (let i = 1; i <= 45; i++) { const id = `E${String(i).padStart(2, '0')}`; if (!STREET_EVENTS.some((e) => e.id === id)) errs.push(`Ereignis ${id} fehlt`); }

const lines = STREET_EVENTS.reduce((n, e) => n + e.phases.reduce((m, p) => m + (p.lines?.length ?? 0), 0) + Object.values(e.outcomes).reduce((m, o) => m + (o.lines?.length ?? 0), 0), 0);
if (errs.length) {
  console.error(`✗ ${errs.length} Fehler in den Inhaltsdaten:`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}
console.log(`✓ Inhalte gültig: ${DISTRICT_IDS.length} Viertel, ${GANG_IDS.length} Gangs, ${STREET_EVENTS.length} Ereignisse, ${lines} Ereignis-Sprechblasen.`);
