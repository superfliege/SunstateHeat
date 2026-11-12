// Story-Oberfläche: Schwarzblende mit Titel, Dialogbox (Gespräch, Funk, Anruf), Entscheidungen,
// Rang-Banner sowie Rang-Abzeichen und „Nächstes Ziel“ im HUD. Texte kommen aus shared/story.
import type { DialogueLine } from '../../../shared/src/quests';
import { charOf, rankOf, STORY } from '../../../shared/src/story';

type Kind = 'talk' | 'radio' | 'call';
interface Job { lines: DialogueLine[]; kind: Kind; block: boolean; done: () => void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const KIND_ICON: Record<Kind, string> = { talk: '', radio: '📻 ', call: '📞 ' };

/** Name und Farbe eines Sprechers (Figuren-ID aus story.json oder freier Name). */
export function speaker(who: string): { name: string; color: string } {
  const c = charOf(who);
  return c ? { name: c.short, color: c.color } : { name: who, color: '#2af0e6' };
}

export class StoryUi {
  private fadeEl = el('div', 'st-fade hidden');
  private fadeText = el('div', 'st-fade-text');
  private dlg = el('div', 'st-dlg hidden');
  private banner = el('div', 'st-banner hidden');
  private queue: Job[] = [];
  private job: Job | null = null;
  private line = 0;
  /** Zeitpunkt (performance.now), zu dem ein nicht blockierender Dialog automatisch weiterläuft. */
  private autoAt = 0;
  private choiceFn: ((i: number) => void) | null = null;
  private choiceCount = 0;
  private rankEl = document.getElementById('hud-rank');
  private goalEl = document.getElementById('hud-goal');
  /** Eingabe sperren (blockierender Dialog/Entscheidung offen). */
  onBlockChange: (blocked: boolean) => void = () => {};
  private blocked = false;

  constructor() {
    this.fadeEl.append(this.fadeText);
    document.body.append(this.fadeEl, this.dlg, this.banner);
    this.dlg.addEventListener('click', () => { if (!this.choiceFn) this.next(); });
    window.addEventListener('keydown', (e) => {
      if (this.choiceFn && /^(Digit|Numpad)[1-9]$/.test(e.code)) {
        const i = Number(e.code.slice(-1)) - 1;
        if (i < this.choiceCount) { e.preventDefault(); e.stopPropagation(); this.choiceFn(i); }
        return;
      }
      if (!this.job || this.choiceFn) return;
      // Nicht blockierende Dialoge (Funk während der Fahrt) laufen von selbst weiter; Enter bleibt dem Chat
      if (!this.job.block) return;
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyF') { e.preventDefault(); e.stopPropagation(); this.next(); }
      else if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); this.skip(); }
    }, true);
  }

  get busy() { return !!this.job || !!this.choiceFn || this.queue.length > 0; }
  /** Blockierender Dialog bzw. Entscheidung offen (Eingabe gesperrt). */
  get blocking() { return this.blocked; }

  private setBlocked(b: boolean) {
    if (b === this.blocked) return;
    this.blocked = b;
    this.onBlockChange(b);
  }

  // ------------------------------------------------------------------ Schwarzblende
  /** Schwarzbild mit Text, nach `hold` Sekunden ausblenden. */
  fade(text: string, hold: number): Promise<void> {
    this.fadeText.textContent = text;
    this.fadeEl.classList.remove('hidden', 'out');
    return new Promise((res) => {
      window.setTimeout(() => {
        this.fadeEl.classList.add('out');
        window.setTimeout(() => { this.fadeEl.classList.add('hidden'); res(); }, 1200);
      }, hold * 1000);
    });
  }
  /** Kurz schwarz (Szenenwechsel). */
  blink(): Promise<void> { return this.fade('', 0.5); }

  // ------------------------------------------------------------------ Dialoge
  /**
   * Dialog einreihen. block = Eingabe gesperrt, weiter mit Leertaste/Enter/F/Klick, Esc überspringt;
   * sonst läuft er neben dem Spiel (automatisch weiter, Enter = sofort weiter).
   */
  say(lines: DialogueLine[], kind: Kind = 'talk', block = false): Promise<void> {
    if (!lines.length) return Promise.resolve();
    return new Promise((done) => {
      this.queue.push({ lines, kind, block, done });
      if (!this.job) this.startNext();
    });
  }

  private startNext() {
    this.job = this.queue.shift() ?? null;
    this.line = 0;
    if (!this.job) { this.dlg.classList.add('hidden'); this.setBlocked(false); return; }
    this.setBlocked(this.job.block);
    this.render();
  }

  private render() {
    const j = this.job!;
    const l = j.lines[this.line];
    const sp = speaker(l.who);
    this.dlg.className = `st-dlg ${j.kind}${j.block ? ' block' : ''}`;
    const who = el('b', 'st-who', KIND_ICON[j.kind] + sp.name);
    who.style.color = sp.color;
    this.dlg.style.borderColor = sp.color;
    const text = el('p', 'st-text', l.text);
    const foot = el('small', 'st-foot', j.block ? `${this.line + 1}/${j.lines.length} · Leertaste/Enter weiter · Esc überspringen` : `${this.line + 1}/${j.lines.length} · Klick = weiter`);
    this.dlg.replaceChildren(who, text, foot);
    this.autoAt = performance.now() + (3.2 + l.text.length * 0.045) * 1000;
  }

  private next() {
    if (!this.job) return;
    if (++this.line >= this.job.lines.length) { const d = this.job.done; this.job = null; d(); this.startNext(); return; }
    this.render();
  }

  private skip() {
    if (!this.job) return;
    const d = this.job.done;
    this.job = null;
    d();
    this.startNext();
  }

  /** Entscheidung: Prompt-Zeilen + Optionen (Tasten 1–9 oder Klick). Rückgabe: Index der Wahl, -1 = abgebrochen. */
  choose(who: string, prompt: DialogueLine[], options: string[]): Promise<number> {
    return this.say(prompt, 'talk', true).then(() => new Promise<number>((res) => {
      const sp = speaker(prompt[prompt.length - 1]?.who ?? who);
      this.dlg.className = 'st-dlg talk block';
      this.dlg.style.borderColor = sp.color;
      const head = el('b', 'st-who', sp.name);
      head.style.color = sp.color;
      const list = el('div', 'st-opts');
      const finish = (i: number) => {
        this.choiceFn = null;
        this.dlg.classList.add('hidden');
        this.setBlocked(this.queue.length > 0);
        if (this.queue.length && !this.job) this.startNext();
        res(i);
      };
      options.forEach((o, i) => {
        const b = el('button', 'st-opt');
        b.append(el('kbd', undefined, String(i + 1)), document.createTextNode(o));
        b.onclick = (e) => { e.stopPropagation(); finish(i); };
        list.append(b);
      });
      this.dlg.replaceChildren(head, el('p', 'st-text', prompt[prompt.length - 1]?.text ?? ''), list, el('small', 'st-foot', 'Tasten 1–' + options.length + ' oder klicken'));
      this.choiceFn = finish;
      this.choiceCount = options.length;
      this.setBlocked(true);
    }));
  }

  /** Echtzeit statt Spielzeit: läuft auch bei niedriger Bildrate im Lesetempo weiter. */
  update() {
    if (this.job && !this.job.block && !this.choiceFn && performance.now() >= this.autoAt) this.next();
  }

  // ------------------------------------------------------------------ Rang
  rankUp(rank: number) {
    const r = rankOf(rank);
    this.banner.replaceChildren(
      el('small', undefined, STORY.texts.rankUp.toUpperCase()),
      el('h2', undefined, `${r.icon} ${r.name}`),
      el('p', undefined, r.desc),
      ...r.perks.map((p) => el('div', 'st-perk', '✓ ' + p)),
    );
    this.banner.classList.remove('hidden', 'out');
    window.setTimeout(() => this.banner.classList.add('out'), 5200);
    window.setTimeout(() => this.banner.classList.add('hidden'), 6200);
  }

  /** HUD: Rang-Abzeichen und nächstes Story-Ziel. */
  setHud(rank: number, goal: string | null) {
    const r = rankOf(rank);
    if (this.rankEl) { this.rankEl.textContent = `${r.icon} ${r.name}`; this.rankEl.title = r.desc; }
    if (this.goalEl) {
      this.goalEl.classList.toggle('hidden', !goal);
      this.goalEl.replaceChildren(el('b', undefined, STORY.texts.nextGoal + ': '), document.createTextNode(goal ?? ''));
    }
  }
}
