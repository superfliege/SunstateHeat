// Story-Rauchtest ohne Browser: echter WorldRoom mit simulierten Spielern.
// Prüft Intro → Mission 1, Entscheidungen (Mission 3), Koop-Beitritt (Mission 5), Verrat (Mission 6),
// Konvoi (Mission 11) und den kompletten Durchlauf bis „Boss“.  Aufruf: npm run story-test (~1–2 min)
import { MAP_SEED } from '../shared/src/constants';
import type { ServerMsg } from '../shared/src/protocol';
import { questLocations } from '../shared/src/questLocations';
import { newPawn } from '../shared/src/sim/movement';
import { rankIndex } from '../shared/src/story';
import { generateWorld } from '../shared/src/world/mapgen';
import { WorldRoom } from '../server/src/rooms/WorldRoom';
import type { ServerPlayer } from '../server/src/entities/types';

const map = generateWorld(MAP_SEED);
const L = questLocations(map);
const room = new WorldRoom('story-test', map);
type View = { title: string; stage: string; prog: string } | null;
const R = room as unknown as {
  tick(d: number): void; dispose?(): void;
  quests: { view(p: unknown): View };
  vehicles: Map<number, { qtag?: string; driver: number; sim: { dmg: { hp: number; wreck: number } } }>;
};
let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++; };

const mk = (name: string) => {
  const msgs: ServerMsg[] = [];
  const conn = { send: (m: ServerMsg) => msgs.push(m), close: () => {}, sendRaw: () => {} };
  const fresh = { key: 'guest:' + name, name, money: 200, bank: 0, xp: 0, health: 100, armor: 0, reputation: {}, inventory: {}, questsDone: [], questCooldowns: {}, weapons: {}, pos: null, playtimeSeconds: 0, createdAt: 0, lastLogin: 0 };
  return { p: room.addPlayer(conn as never, name, fresh as never), msgs };
};
const run = (s: number) => { for (let i = 0; i < s * 20; i++) R.tick(1 / 20); };
const chat = (p: ServerPlayer, t: string) => { p.lastChatAt = 0; room.handleMessage(p, { t: 'chat', text: t }); };
const put = (p: ServerPlayer, at: { x: number; z: number }) => { p.pawn = newPawn(at.x, at.z, 0); };
const last = <T extends ServerMsg['t']>(msgs: ServerMsg[], t: T) => [...msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
const story = (p: ServerPlayer) => p.profile.story!;

// --- Intro (zwei neue Spieler gleichzeitig)
const A = mk('A'), B = mk('B');
check(A.p.profile.money === 12, 'Neuer Charakter startet mit 12 Dollar');
check(!story(A.p).intro && last(A.msgs, 'story')?.s.intro === false, 'Intro steht noch aus');
room.handleMessage(A.p, { t: 'introDone' }); room.handleMessage(B.p, { t: 'introDone' });
run(0.3);
check(R.quests.view(A.p)?.title === 'Ohne Kratzer' && R.quests.view(B.p)?.title === 'Ohne Kratzer', 'Mission 1 startet für beide getrennt');
check([...R.vehicles.values()].filter((v) => v.qtag === 'cabrio').length === 2, 'Jeder bekommt ein eigenes Cabrio');
room.handleMessage(A.p, { t: 'introDone' });
check(story(A.p).intro, 'Intro-Flag gesetzt (läuft nur einmal)');
chat(A.p, '/story skip'); run(0.2);
check(story(A.p).rank === rankIndex('laufbursche') && story(A.p).home === 'lou_sofa', 'Mission 1: Rang Laufbursche, Lous Sofa als Zuhause');
room.handleMessage(B.p, { t: 'questAbandon' });

// --- Mission 3: Entscheidungen
chat(A.p, '/story bis 3');
put(A.p, L.carWash); run(0.2);
room.handleMessage(A.p, { t: 'talk', npc: 'lou_wash' });
check(!!last(A.msgs, 'phone')?.quests.some((q) => q.id === 'story_03_offene_rechnungen' && q.ok), 'Lou bietet „Offene Rechnungen“ an');
room.handleMessage(A.p, { t: 'questAccept', id: 'story_03_offene_rechnungen' }); run(0.3);
for (const [loc, id, opt] of [['debtor1', 'debt_ramon', 'hard'], ['debtor2', 'debt_chad', 'smooth'], ['debtor3', 'debt_kimberly', 'smooth']] as const) {
  put(A.p, L[loc]); run(0.3);
  check(last(A.msgs, 'choice')?.id === id, `Entscheidung ${id} angeboten`);
  room.handleMessage(A.p, { t: 'choice', id, option: opt }); run(0.3);
}
put(A.p, L.carWash); run(0.5);
check(A.p.profile.questsDone.includes('story_03_offene_rechnungen') && story(A.p).style === 1 && story(A.p).choices.debt_ramon === 'hard', 'Mission 3 erledigt, Entscheidungen gespeichert');

// --- Mission 5: Koop-Beitritt
chat(A.p, '/story bis 5');
put(A.p, L.club); run(0.2);
room.handleMessage(A.p, { t: 'questAccept', id: 'story_05_party' }); run(1.5);
put(B.p, { x: L.club.x + 10, z: L.club.z }); run(0.3);
room.handleMessage(B.p, { t: 'questJoin' }); run(0.2);
check(!R.quests.view(B.p), 'Spieler ohne Freischaltung kann nicht beitreten');
chat(B.p, '/story bis 5'); run(0.2);
room.handleMessage(B.p, { t: 'questJoin' }); run(0.2);
check(R.quests.view(B.p)?.title === 'Party im Club', 'Freigeschalteter Spieler tritt dem Koop-Auftrag bei');
chat(A.p, '/story skip'); run(0.3);
check(story(A.p).rank === rankIndex('vertrauter') && story(B.p).rank === rankIndex('vertrauter'), 'Beide werden Vertrauter (Apartment)');

// --- Mission 6: Verrat (nur erzählerisch: Inventar und Waffen bleiben)
const weaponsBefore = JSON.stringify(A.p.profile.weapons), moneyBefore = A.p.profile.money;
chat(A.p, '/story skip'); run(0.2);
check(story(A.p).rank === rankIndex('ausgestossener') && story(A.p).locked.includes('apartment') && story(A.p).home === 'campfire', 'Mission 6: Ausgestoßener, Apartment gesperrt');
check(JSON.stringify(A.p.profile.weapons) === weaponsBefore && A.p.profile.money >= moneyBefore, 'Verrat entfernt keine Gegenstände/Geld');

// --- Mission 11: Konvoi
chat(A.p, '/story bis 11');
put(A.p, L.convoyStart);
room.handleMessage(A.p, { t: 'questAccept', id: 'story_11_konvoi' }); run(1.5);
const truck = [...R.vehicles.values()].find((v) => v.qtag === 'armored');
check(!!truck && truck.driver === -2, 'Geldtransporter fährt (NPC-Fahrer)');
if (truck) { truck.sim.dmg.hp = 0; truck.sim.dmg.wreck = 1; }
run(0.5);
check(/Geldsäcke/.test(R.quests.view(A.p)?.stage ?? ''), 'Transporter zerstört → Beute-Stufe');
room.handleMessage(A.p, { t: 'questAbandon' });

// --- Rest bis zum Ende
chat(A.p, '/story bis 13'); run(0.2);
check(story(A.p).rank === rankIndex('boss') && story(A.p).home === 'villa' && story(A.p).crew.length === 3, 'Finale: Boss, Villa, komplette Crew');

console.log(fails ? `\n${fails} Prüfung(en) fehlgeschlagen.` : '\nAlle Story-Prüfungen bestanden.');
process.exit(fails ? 1 : 0);
