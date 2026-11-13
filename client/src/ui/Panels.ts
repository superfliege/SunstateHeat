// Overlay-Fenster: Gespräch mit Verkäufern (F vor der Theke), Inventar (I), Quest-Log (J), Telefon.
// Alle Daten kommen vom Server; Käufe und Benutzen werden dort geprüft, das Fenster zeigt nur an.
import type { ClientMsg, LobbyInfo, PhoneQuest, PlayerStats, QuestState } from '../../../shared/src/protocol';
import { GANGS, GANG_IDS, repStatus } from '../../../shared/src/gangs';
import { QUESTS } from '../../../shared/src/questData';
import { BACKPACK_SLOTS, ITEMS } from '../../../shared/src/items';
import { shopCatalog, SHOP_COLORS, type ShopDef, type ShopType } from '../../../shared/src/shops';
import { CARRY_SLOTS, WEAPONS, type WeaponId } from '../../../shared/src/weapons';
import type { DialogueLine } from '../../../shared/src/quests';
import { charOf, CREW_IDS, MISSION_META, missionTitle, RANKS, rankOf, STORY, styleName, type StoryView } from '../../../shared/src/story';
import { speaker } from './StoryUi';

type TalkStep = 'hello' | 'buy';
type Mode = { kind: 'talk'; shop: ShopDef; step: TalkStep; line: string } | { kind: 'inv' } | { kind: 'log' } | { kind: 'phone'; name: string; quests: PhoneQuest[]; talk?: DialogueLine[]; color?: string }
  | { kind: 'handy'; list: LobbyInfo[] | null } | null;

// ------------------------------------------------------------------ Gesprächszeilen
const GREET: Record<ShopType, string[]> = {
  sunmart: ['Willkommen im Sunmart! Rund um die Uhr, rund um den Block.', 'Hey, Schatz. Brauchst du was gegen den Hunger?', 'Unsere Burger sind so frisch wie die Zeitung von gestern. Also ziemlich frisch.'],
  gas: ['Willkommen bei Gas & Go. Sprit ist draußen, Snacks sind hier drin.', 'Lange Fahrt gehabt? Der Kaffee ist frisch – na ja, frisch genug.', 'Kein Bargeld in der Kasse, nur damit das klar ist. Was brauchst du?'],
  ammo: ['Ammo & Ammo. Wir stellen keine Fragen – du auch nicht.', 'Schau dich um. Anfassen nur mit Waffenschein. War ein Witz, wir haben keinen.', 'Na, Ärger in der Nachbarschaft? Da bist du hier richtig.'],
  paint: ['Paint & Pray! Neue Farbe, neues Leben – die Cops erkennen dich nicht wieder.', 'Kratzer? Beulen? Fahndung? Ich mach das weg.', 'Fahr ruhig ran, ich beiß nicht. Nur die Lackierpistole.'],
};
const ASK: Record<ShopType, string[]> = {
  sunmart: ['Was darf\'s sein?', 'Greif zu, alles heute im Angebot. Also wie immer.'],
  gas: ['Was darf\'s sein?', 'Nimm dir, was du brauchst – bezahlt wird hier vorne.'],
  ammo: ['Hier ist die Ware. Bar, kein Anschreiben.', 'Such dir was aus. Munition gibt\'s nur zu Waffen, die du hast.'],
  paint: ['Was soll\'s sein – Reparatur oder neue Farbe?', 'Stell die Karre hier ab, dann legen wir los.'],
};
const THANKS: Record<ShopType, string[]> = {
  sunmart: ['Gute Wahl! Noch was?', 'Danke, beehr uns bald wieder.', 'Tüte brauchst du keine, oder?'],
  gas: ['Danke dir. Gute Fahrt!', 'Gern. Noch was für unterwegs?'],
  ammo: ['Viel Spaß damit. Und du hast es nicht von mir.', 'Gute Wahl. Ziel nicht auf mich.'],
  paint: ['Wie neu! Na ja, fast.', 'Fertig. Und jetzt fahr vorsichtig – oder wenigstens schnell.'],
};
const BYE = ['Bis dann!', 'Pass auf dich auf.', 'Komm wieder!'];
const GOSSIP = [
  'Die Telefonzellen klingeln öfter, als man denkt. Geh ruhig mal ran.',
  'Wenn dir die Cops im Nacken sitzen: Paint & Pray an der Werkstatt lackiert dich um.',
  'Schutzwesten gibt\'s bei Ammo & Ammo. Glaub mir, die brauchst du.',
  'Nachts drehen die Gangs ihre Runden. Halt dich von deren Vierteln fern, wenn sie dich nicht mögen.',
  'Am Renntelefon gibt\'s Straßenrennen. Mein Cousin hat da seine Karre verloren. Und seinen Stolz.',
  'Ein Verbandskasten im Rucksack hat schon so manchem das Leben gerettet.',
  'Draußen vor der Stadt gibt\'s ein Testgelände mit Rampen. Die Jungs da sind völlig verrückt.',
  'An der Werkstatt einfach kurz anhalten – dann wird die Karre geflickt.',
];
const pickLine = (list: string[]) => list[Math.floor(Math.random() * list.length)];

const STATUS_TEXT: Record<string, string> = { archenemy: 'Erzfeind', hostile: 'Feindlich', neutral: 'Neutral', friendly: 'Freundlich', trusted: 'Vertraut' };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const money = (n: number) => `$${n.toLocaleString('de-DE')}`;

export class Panels {
  private root = document.getElementById('panel')!;
  private mode: Mode = null;
  private sig = '';
  private stats: PlayerStats | null = null;
  private cash = 0;
  private done: string[] = [];
  private cooldowns: Record<string, number> = {};
  private quest: QuestState | null = null;
  private story: StoryView | null = null;
  private goal: string | null = null;
  /** Gesprächsoptionen der aktuellen Ansicht (Tasten 1–9). */
  private options: (() => void)[] = [];
  onOpenChange: (open: boolean) => void = () => {};
  /** Handy: große Karte öffnen */
  onMap: () => void = () => {};
  private poll = 0;
  /** Gespräch beendet (für den Abschiedsgruß des Verkäufers). */
  onTalkEnd: (shop: ShopDef, line: string) => void = () => {};

  constructor(private send: (m: ClientMsg) => void) {
    window.addEventListener('keydown', (e) => {
      if (!this.mode || e.defaultPrevented || e.repeat) return;
      const m = this.mode;
      if (e.code === 'Escape' || (e.code === 'KeyI' && m.kind === 'inv') || (e.code === 'KeyJ' && m.kind === 'log') || (e.code === 'KeyM' && m.kind === 'handy') || (e.code === 'KeyE' && (m.kind === 'phone' || m.kind === 'talk'))) {
        e.preventDefault();
        this.close();
      } else if (m.kind === 'talk' && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
        e.preventDefault();
        this.options[Number(e.code.slice(-1)) - 1]?.();
      } else if (m.kind === 'talk' && m.step === 'buy' && e.code === 'Backspace') {
        e.preventDefault();
        this.talk('hello', pickLine(GREET[m.shop.type]));
      }
    });
  }

  get isOpen() { return this.mode !== null; }

  /** Gespräch mit dem Verkäufer beginnen (Begrüßung, dann Einkaufen / Plaudern / Tschüss). */
  openTalk(shop: ShopDef) { this.setMode({ kind: 'talk', shop, step: 'hello', line: pickLine(GREET[shop.type]) }); }
  /** Gerade im Gespräch mit diesem Laden? */
  talkingTo(): ShopDef | null { return this.mode?.kind === 'talk' ? this.mode.shop : null; }

  private talk(step: TalkStep, line: string) {
    if (this.mode?.kind !== 'talk') return;
    this.mode = { ...this.mode, step, line };
    this.render();
  }
  /** Telefon oder Story-Figur (talk = Gesprächszeile, color = Farbe der Figur). */
  openPhone(name: string, quests: PhoneQuest[], talk?: DialogueLine[], color?: string) { this.setMode({ kind: 'phone', name, quests, talk, color }); }
  setStory(s: StoryView, goal: string | null) { this.story = s; this.goal = goal; this.sig = ''; if (this.mode?.kind === 'log') this.render(); }
  toggleLog() { if (this.mode?.kind === 'log') this.close(); else this.setMode({ kind: 'log' }); }
  setQuestLog(done: string[], cooldowns: Record<string, number>) { this.done = done; this.cooldowns = cooldowns; this.sig = ''; if (this.mode?.kind === 'log') this.render(); }
  toggleInventory() { if (this.mode?.kind === 'inv') this.close(); else this.setMode({ kind: 'inv' }); }
  /** Handy (M): offene Warteräume, Beitreten von überall (#43). */
  toggleHandy() { if (this.mode?.kind === 'handy') this.close(); else { this.setMode({ kind: 'handy', list: null }); this.send({ t: 'lobbies' }); } }
  setLobbies(list: LobbyInfo[]) { if (this.mode?.kind === 'handy') { this.mode.list = list; this.render(); } }

  close() { this.setMode(null); }

  private setMode(m: Mode) {
    const was = this.isOpen;
    if (this.mode?.kind === 'talk' && m?.kind !== 'talk') this.onTalkEnd(this.mode.shop, pickLine(BYE));
    this.mode = m;
    this.sig = '';
    // Handy: Warteräume regelmäßig aktualisieren, solange es offen ist
    window.clearInterval(this.poll);
    if (m?.kind === 'handy') this.poll = window.setInterval(() => this.send({ t: 'lobbies' }), 1500);
    this.root.classList.toggle('hidden', !m);
    if (!m) this.root.replaceChildren();
    else this.render();
    if (was !== this.isOpen) this.onOpenChange(this.isOpen);
  }

  /** Bei jedem Snapshot: neu zeichnen, wenn sich etwas Relevantes geändert hat. */
  update(stats: PlayerStats, cash: number, quest: QuestState | null = null) {
    // Bezahlt? Dann bedankt sich der Verkäufer
    if (this.mode?.kind === 'talk' && this.mode.step === 'buy' && cash < this.cash) this.mode.line = pickLine(THANKS[this.mode.shop.type]);
    this.stats = stats; this.cash = cash; this.quest = quest;
    if (!this.mode) return;
    if (this.signature() !== this.sig) this.render();
  }

  private signature(): string {
    const s = this.stats!, m = this.mode;
    return JSON.stringify([this.cash, s.level, s.owned, s.inv, s.weapon, s.ammo, s.rep, this.quest?.id ?? '', this.quest?.stageIdx ?? -1, m?.kind === 'phone' ? 0 : 1, m?.kind === 'talk' ? m.step + m.line : '']);
  }

  private render() {
    const m = this.mode, s = this.stats;
    if (!m || !s) return;
    this.sig = this.signature();
    this.options = [];
    const box = el('div', 'pn-box');
    const head = el('div', 'pn-head');
    const title = el('h2', undefined, m.kind === 'talk' ? m.shop.name : m.kind === 'phone' ? m.name : m.kind === 'log' ? 'Quest-Log' : m.kind === 'handy' ? '📱 Handy' : 'Inventar');
    if (m.kind === 'talk') box.style.borderColor = '#' + SHOP_COLORS[m.shop.type].toString(16).padStart(6, '0');
    const close = el('button', 'pn-close', '✕');
    close.onclick = () => this.close();
    head.append(title, el('span', 'pn-cash', `${money(this.cash)} · Stufe ${s.level}`), close);
    box.append(head);
    if (m.kind === 'talk') this.renderTalk(box, m.shop, m.step, m.line, s);
    else if (m.kind === 'phone') { if (m.color) box.style.borderColor = m.color; this.renderPhone(box, m.quests, m.talk, m.color); }
    else if (m.kind === 'log') this.renderLog(box, s);
    else if (m.kind === 'handy') this.renderHandy(box, m.list);
    else this.renderInventory(box, s);
    this.root.replaceChildren(box);
  }

  /** Gespräch: Sprechblase des Verkäufers, darunter Antworten (1–9) bzw. das Sortiment. */
  private renderTalk(box: HTMLElement, shop: ShopDef, step: TalkStep, line: string, s: PlayerStats) {
    const color = '#' + SHOP_COLORS[shop.type].toString(16).padStart(6, '0');
    const npc = el('div', 'pn-npc');
    npc.style.borderColor = color;
    const who = el('b', undefined, shop.keeper.name);
    who.style.color = color;
    npc.append(who, el('span', undefined, `„${line}“`));
    box.append(npc);
    const opts = el('div', 'pn-opts');
    const option = (text: string, fn: () => void) => {
      const n = this.options.push(fn);
      const b = el('button', 'pn-opt');
      b.append(el('kbd', undefined, String(n)), document.createTextNode(text));
      b.onclick = fn;
      opts.append(b);
    };
    if (step === 'hello') {
      option(shop.type === 'paint' ? 'Kannst du meine Karre machen?' : shop.type === 'ammo' ? 'Zeig mal, was du hast.' : 'Ich will was kaufen.', () => this.talk('buy', pickLine(ASK[shop.type])));
      option('Was gibt\'s Neues?', () => this.talk('hello', pickLine(GOSSIP)));
      option('Tschüss.', () => this.close());
      box.append(opts, el('p', 'pn-foot', '1–3 oder klicken · Esc oder E zum Gehen'));
      return;
    }
    this.renderShop(box, shop, s);
    option('Das war\'s erst mal.', () => this.talk('hello', pickLine(['Sonst noch was?', 'Kann ich sonst noch helfen?'])));
    option('Tschüss.', () => this.close());
    box.append(opts, el('p', 'pn-foot', 'Rücktaste = zurück · Esc oder E zum Gehen'));
  }

  private renderShop(box: HTMLElement, shop: ShopDef, s: PlayerStats) {
    const list = el('div', 'pn-list');
    for (const it of shopCatalog(shop.type)) {
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      info.append(el('b', undefined, it.name), el('small', undefined, it.desc));
      const [kind, arg] = it.key.split(':');
      const ownsWeapon = kind === 'w' && s.owned.includes(arg);
      const needsWeapon = kind === 'a' && !s.owned.includes(arg);
      const locked = s.level < it.minLevel;
      const btn = el('button', 'pn-buy', locked ? `Stufe ${it.minLevel}` : ownsWeapon ? 'Besitzt' : money(it.price));
      btn.disabled = locked || ownsWeapon || needsWeapon || this.cash < it.price;
      btn.onclick = () => this.send({ t: 'shop', shop: shop.id, item: it.key });
      row.append(info, btn);
      list.append(row);
    }
    box.append(list);
  }

  /** Handy: offene Warteräume (Minispiele, Rennen, Koop-Aufträge) mit Beitreten/Starten, Karte. */
  private renderHandy(box: HTMLElement, list: LobbyInfo[] | null) {
    const tools = el('div', 'pn-row');
    const map = el('button', 'pn-buy', '🗺️ Karte (K)');
    map.onclick = () => { this.close(); this.onMap(); };
    tools.append(el('div', 'pn-info', ''), map);
    box.append(el('h3', undefined, 'Warteräume'));
    if (!list) box.append(el('p', 'pn-foot', 'Verbinde …'));
    else if (!list.length) box.append(el('p', 'pn-foot', 'Gerade wartet niemand. Starte selbst ein Minispiel, Rennen oder einen Koop-Auftrag an einem Telefon – dann können andere hier beitreten.'));
    for (const l of list ?? []) {
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      const kind = l.kind === 'mg' ? 'Minispiel' : l.kind === 'race' ? 'Straßenrennen' : 'Koop-Auftrag';
      info.append(el('b', undefined, l.title), el('small', undefined, `${kind} · ${l.members.join(', ') || '–'} (${l.members.length}/${l.max}) · Start in ${l.t} s`));
      let btn: HTMLButtonElement;
      if (l.mine) {
        btn = el('button', 'pn-buy', '▶ Jetzt starten');
        btn.onclick = () => { this.send({ t: 'lobbyStart' }); this.close(); };
      } else {
        btn = el('button', 'pn-buy', l.ok ? 'Beitreten' : l.reason || 'Nicht möglich');
        btn.disabled = !l.ok;
        btn.onclick = () => this.send({ t: 'lobbyJoin', kind: l.kind, id: l.id });
      }
      row.append(info, btn);
      box.append(row);
    }
    box.append(tools);
    box.append(el('p', 'pn-foot', 'Im Warteraum: E = Runde starten · Esc oder M zum Schließen'));
  }

  private renderPhone(box: HTMLElement, quests: PhoneQuest[], talk?: DialogueLine[], color?: string) {
    for (const l of talk ?? []) {
      const npc = el('div', 'pn-npc');
      if (color) npc.style.borderColor = color;
      const who = el('b', undefined, speaker(l.who).name);
      who.style.color = speaker(l.who).color;
      npc.append(who, el('span', undefined, `„${l.text}“`));
      box.append(npc);
    }
    if (!quests.length) box.append(el('p', 'pn-foot', talk ? 'Gerade kein Auftrag.' : 'Hier klingelt nichts.'));
    for (const q of quests) {
      const wrap = el('div', 'pn-row');
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'stretch';
      const top = el('div', 'pn-head');
      const info = el('div', 'pn-info');
      info.append(el('b', undefined, q.title), el('small', undefined, `${q.rewardText} · ${q.coop[0] === q.coop[1] ? q.coop[0] : q.coop[0] + '–' + q.coop[1]} Spieler`));
      const btn = el('button', 'pn-buy', q.ok ? 'Annehmen' : q.reason || 'Nicht verfügbar');
      btn.disabled = !q.ok;
      btn.onclick = () => { this.send({ t: 'questAccept', id: q.id }); this.close(); };
      top.append(info, btn);
      wrap.append(top);
      for (const line of q.intro) {
        const d = el('div', 'pn-dlg');
        const who = el('b', undefined, speaker(line.who).name + ': ');
        who.style.color = speaker(line.who).color;
        d.append(who, document.createTextNode(line.text));
        wrap.append(d);
      }
      box.append(wrap);
    }
    box.append(el('p', 'pn-foot', 'Esc oder E zum Auflegen'));
  }

  /** Story-Abschnitt im Quest-Log: Rang, Ruf, Zuhause, Crew, Ziel, Hauptmissionen, Anrufe. */
  private renderStory(box: HTMLElement) {
    const st = this.story;
    if (!st) return;
    const r = rankOf(st.rank);
    box.append(el('h3', undefined, `Story · ${r.icon} ${r.name} (Rang ${st.rank + 1}/${RANKS.length})`));
    const info = el('div', 'pn-row');
    const txt = el('div', 'pn-info');
    const home = st.home ? STORY.homes[st.home]?.name : '–';
    const crew = CREW_IDS.filter((c) => st.crew.includes(c)).map((c) => charOf(c)?.short ?? c).join(', ') || '–';
    txt.append(el('b', undefined, r.desc), el('small', undefined, `Ruf: ${styleName(st.style)} · Zuhause: ${home} · Crew: ${crew}`));
    if (this.goal) txt.append(el('small', 'pn-goal', `➜ ${this.goal}`));
    info.append(txt);
    box.append(info);
    const list = el('div', 'pn-list');
    const mains = STORY.missions.filter((m) => m.kind === 'main').sort((a, b) => a.order - b.order);
    for (const m of mains) {
      const done = st.done.includes(m.id), open = st.unlocked.includes(m.id);
      if (!done && !open) continue; // Zukünftige Missionen bleiben geheim
      const row = el('div', 'pn-row');
      const i = el('div', 'pn-info');
      const giver = charOf(m.giver);
      i.append(el('b', undefined, `${m.act === 1 ? 'Akt 1' : 'Akt 2'} · ${missionTitle(m.id)}`), el('small', undefined, done ? `${giver?.short ?? ''} · erledigt` : m.hint));
      row.append(i);
      const def = QUESTS.find((q) => q.id === m.id);
      if (!done && def?.giver.type === 'phone' && this.quest?.id !== m.id) {
        const btn = el('button', 'pn-buy', '📞 Annehmen');
        btn.onclick = () => { this.send({ t: 'questAccept', id: m.id }); this.close(); };
        row.append(btn);
      } else row.append(el('span', 'pn-state', done ? 'Erledigt ✓' : this.quest?.id === m.id ? 'Aktiv' : 'Offen'));
      list.append(row);
    }
    box.append(list);
  }

  private renderLog(box: HTMLElement, s: PlayerStats) {
    this.renderStory(box);
    if (this.quest) {
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      info.append(el('b', undefined, `Aktiv: ${this.quest.title} (${this.quest.stageIdx + 1}/${this.quest.stageCount})`), el('small', undefined, this.quest.stage));
      const btn = el('button', 'pn-buy', 'Abbrechen');
      btn.onclick = () => { this.send({ t: 'questAbandon' }); };
      row.append(info, btn);
      box.append(row);
    }
    const list = el('div', 'pn-list');
    for (const q of QUESTS) {
      const meta = MISSION_META.get(q.id);
      if (meta?.kind === 'main') continue; // Hauptmissionen stehen oben im Story-Abschnitt
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      const gang = (meta ? ` · Nebenjob von ${charOf(meta.giver)?.short ?? meta.giver}` : '') + (q.gang ? ` · ${GANGS[q.gang].name}` : '');
      info.append(el('b', undefined, q.title), el('small', undefined, `Stufe ${q.minLevel}${gang} · ${q.coop.min === q.coop.max ? q.coop.min : q.coop.min + '–' + q.coop.max} Spieler${q.nightOnly ? ' · nachts' : ''}`));
      const cd = this.cooldowns[q.id] ?? 0;
      const locked = !!meta && !!this.story && !this.story.unlocked.includes(q.id) && !this.done.includes(q.id);
      const state = this.quest?.id === q.id ? 'Aktiv' : this.done.includes(q.id) && !q.repeatable ? 'Erledigt ✓' : locked ? '🔒 Story' : cd > Date.now() ? `in ${Math.ceil((cd - Date.now()) / 60000)} Min.` : s.level < q.minLevel ? `ab Stufe ${q.minLevel}` : this.done.includes(q.id) ? 'Wiederholbar ✓' : 'Verfügbar';
      row.append(info, el('span', 'pn-state', state));
      list.append(row);
    }
    box.append(el('h3', undefined, 'Nebenjobs & Aufträge'), list, el('p', 'pn-foot', 'Story-Figuren: ❗/💬-Markierungen (E) · Telefone: gelbe Markierungen (E) · Esc oder J zum Schließen'));
  }

  private renderInventory(box: HTMLElement, s: PlayerStats) {
    box.append(el('h3', undefined, 'Gang-Ruf'));
    for (const g of GANG_IDS) {
      const v = s.rep?.[g] ?? 0;
      const row = el('div', 'pn-rep');
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.background = '#' + GANGS[g].color.toString(16).padStart(6, '0');
      fill.style.left = v >= 0 ? '50%' : `${50 + v / 2}%`;
      fill.style.width = `${Math.abs(v) / 2}%`;
      bar.append(fill);
      row.append(el('span', undefined, GANGS[g].name), bar, el('small', undefined, `${v} · ${STATUS_TEXT[repStatus(v)]}`));
      box.append(row);
    }
    box.append(el('h3', undefined, 'Waffen (1–5 oder Mausrad)'));
    const wl = el('div', 'pn-list');
    for (const id of s.owned as WeaponId[]) {
      const w = WEAPONS[id];
      if (!w) continue;
      const row = el('div', 'pn-row');
      const ammo = w.ammoPack ? ` · ${id === s.weapon ? s.ammo : '–'} Schuss` : '';
      const info = el('div', 'pn-info');
      info.append(el('b', undefined, w.name), el('small', undefined, `Schaden ${w.damage}${ammo}`));
      const btn = el('button', 'pn-buy', id === s.weapon ? 'Gewählt' : 'Ausrüsten');
      btn.disabled = id === s.weapon;
      btn.onclick = () => this.send({ t: 'weapon', slot: CARRY_SLOTS.indexOf(w.slot) + 1 });
      row.append(info, btn);
      wl.append(row);
    }
    box.append(wl);
    let used = 0;
    for (const [id, c] of Object.entries(s.inv)) used += Math.ceil(c / (ITEMS[id]?.stack ?? 1));
    box.append(el('h3', undefined, `Rucksack (${used}/${BACKPACK_SLOTS})`));
    const il = el('div', 'pn-list');
    const entries = Object.entries(s.inv).filter(([, c]) => c > 0);
    if (!entries.length) il.append(el('p', 'pn-foot', 'Leer. Im 24/7 Sunmart (und bei Gas & Go) gibt es Essen, im Sunmart auch Verbandskästen.'));
    for (const [id, c] of entries) {
      const def = ITEMS[id];
      if (!def) continue;
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      info.append(el('b', undefined, `${def.name} ×${c}`), el('small', undefined, def.heal ? `+${def.heal} Gesundheit` : def.armor ? `Rüstung ${def.armor}` : ''));
      row.append(info);
      if (def.kind === 'consumable' || def.kind === 'armor') {
        const btn = el('button', 'pn-buy', 'Benutzen');
        btn.onclick = () => this.send({ t: 'useItem', id });
        row.append(btn);
      }
      il.append(row);
    }
    box.append(il, el('p', 'pn-foot', 'Esc oder I zum Schließen'));
  }
}
