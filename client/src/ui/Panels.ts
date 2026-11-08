// Overlay-Fenster: Laden (F in der Nähe eines Ladens) und Inventar (I).
// Alle Daten kommen vom Server; Käufe und Benutzen werden dort geprüft, das Fenster zeigt nur an.
import type { ClientMsg, PhoneQuest, PlayerStats, QuestState } from '../../../shared/src/protocol';
import { GANGS, GANG_IDS, repStatus } from '../../../shared/src/gangs';
import { QUESTS } from '../../../shared/src/questData';
import { BACKPACK_SLOTS, ITEMS } from '../../../shared/src/items';
import { shopCatalog, SHOP_COLORS, type ShopDef } from '../../../shared/src/shops';
import { CARRY_SLOTS, WEAPONS, type WeaponId } from '../../../shared/src/weapons';

type Mode = { kind: 'shop'; shop: ShopDef } | { kind: 'inv' } | { kind: 'log' } | { kind: 'phone'; name: string; quests: PhoneQuest[] } | null;

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
  onOpenChange: (open: boolean) => void = () => {};

  constructor(private send: (m: ClientMsg) => void) {
    window.addEventListener('keydown', (e) => {
      if (!this.mode) return;
      if (e.code === 'Escape' || (e.code === 'KeyI' && this.mode.kind === 'inv') || (e.code === 'KeyJ' && this.mode.kind === 'log') || (e.code === 'KeyF' && this.mode.kind === 'phone') || (e.code === 'KeyF' && this.mode.kind === 'shop')) {
        e.preventDefault();
        this.close();
      }
    });
  }

  get isOpen() { return this.mode !== null; }

  openShop(shop: ShopDef) { this.setMode({ kind: 'shop', shop }); }
  openPhone(name: string, quests: PhoneQuest[]) { this.setMode({ kind: 'phone', name, quests }); }
  toggleLog() { if (this.mode?.kind === 'log') this.close(); else this.setMode({ kind: 'log' }); }
  setQuestLog(done: string[], cooldowns: Record<string, number>) { this.done = done; this.cooldowns = cooldowns; this.sig = ''; if (this.mode?.kind === 'log') this.render(); }
  toggleInventory() { if (this.mode?.kind === 'inv') this.close(); else this.setMode({ kind: 'inv' }); }

  close() { this.setMode(null); }

  private setMode(m: Mode) {
    const was = this.isOpen;
    this.mode = m;
    this.sig = '';
    this.root.classList.toggle('hidden', !m);
    if (!m) this.root.replaceChildren();
    else this.render();
    if (was !== this.isOpen) this.onOpenChange(this.isOpen);
  }

  /** Bei jedem Snapshot: neu zeichnen, wenn sich etwas Relevantes geändert hat. */
  update(stats: PlayerStats, cash: number, quest: QuestState | null = null) {
    this.stats = stats; this.cash = cash; this.quest = quest;
    if (!this.mode) return;
    const sig = JSON.stringify([cash, stats.level, stats.owned, stats.inv, stats.weapon, stats.ammo, stats.rep, quest?.id ?? '', quest?.stageIdx ?? -1, this.mode.kind === 'phone' ? 0 : 1]);
    if (sig !== this.sig) this.render();
  }

  private render() {
    const m = this.mode, s = this.stats;
    if (!m || !s) return;
    this.sig = JSON.stringify([this.cash, s.level, s.owned, s.inv, s.weapon, s.ammo, s.rep, this.quest?.id ?? '', this.quest?.stageIdx ?? -1, m.kind === 'phone' ? 0 : 1]);
    const box = el('div', 'pn-box');
    const head = el('div', 'pn-head');
    const title = el('h2', undefined, m.kind === 'shop' ? m.shop.name : m.kind === 'phone' ? m.name : m.kind === 'log' ? 'Quest-Log' : 'Inventar');
    if (m.kind === 'shop') box.style.borderColor = '#' + SHOP_COLORS[m.shop.type].toString(16).padStart(6, '0');
    const close = el('button', 'pn-close', '✕');
    close.onclick = () => this.close();
    head.append(title, el('span', 'pn-cash', `${money(this.cash)} · Stufe ${s.level}`), close);
    box.append(head);
    if (m.kind === 'shop') this.renderShop(box, m.shop, s);
    else if (m.kind === 'phone') this.renderPhone(box, m.quests);
    else if (m.kind === 'log') this.renderLog(box, s);
    else this.renderInventory(box, s);
    this.root.replaceChildren(box);
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
    box.append(list, el('p', 'pn-foot', 'Esc oder F zum Schließen'));
  }

  private renderPhone(box: HTMLElement, quests: PhoneQuest[]) {
    if (!quests.length) box.append(el('p', 'pn-foot', 'Hier klingelt nichts.'));
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
        d.append(el('b', undefined, line.who + ': '), document.createTextNode(line.text));
        wrap.append(d);
      }
      box.append(wrap);
    }
    box.append(el('p', 'pn-foot', 'Esc oder F zum Auflegen'));
  }

  private renderLog(box: HTMLElement, s: PlayerStats) {
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
      const row = el('div', 'pn-row');
      const info = el('div', 'pn-info');
      const gang = q.gang ? ` · ${GANGS[q.gang].name}` : '';
      info.append(el('b', undefined, q.title), el('small', undefined, `Stufe ${q.minLevel}${gang} · ${q.coop.min === q.coop.max ? q.coop.min : q.coop.min + '–' + q.coop.max} Spieler${q.nightOnly ? ' · nachts' : ''}`));
      const cd = this.cooldowns[q.id] ?? 0;
      const state = this.quest?.id === q.id ? 'Aktiv' : this.done.includes(q.id) && !q.repeatable ? 'Erledigt ✓' : cd > Date.now() ? `in ${Math.ceil((cd - Date.now()) / 60000)} Min.` : s.level < q.minLevel ? `ab Stufe ${q.minLevel}` : this.done.includes(q.id) ? 'Wiederholbar ✓' : 'Verfügbar';
      row.append(info, el('span', 'pn-state', state));
      list.append(row);
    }
    box.append(el('h3', undefined, 'Aufträge'), list, el('p', 'pn-foot', 'Telefone: gelbe Markierungen (F). Esc oder J zum Schließen'));
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
    if (!entries.length) il.append(el('p', 'pn-foot', 'Leer. Im 24/7 Sunmart gibt es Essen und Verbandskästen.'));
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
