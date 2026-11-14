// Controller-Navigation in Fenstern: Steuerkreuz/linker Stick bewegen einen Fokusrahmen räumlich über
// die sichtbaren Schaltflächen des obersten Fensters, A klickt, rechter Stick blättert. Funktioniert mit
// jedem Fenster, das seine Aktionen als <button> anbietet (Panels, Story-Entscheidungen, Login).
import { P, type PadFrame } from '../input/Gamepad';

const FOCUS = 'pad-focus';

export class PadNav {
  private root: HTMLElement | null = null;
  private cur: HTMLElement | null = null;
  private idx = 0;

  private items(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('button, [data-pad]'))
      .filter((b) => !(b as HTMLButtonElement).disabled && b.getClientRects().length > 0 && !b.closest('.hidden'));
  }

  /** Fokus entfernen (kein Fenster offen oder Modus gewechselt). */
  clear() {
    this.cur?.classList.remove(FOCUS);
    this.cur = null; this.root = null; this.idx = 0;
  }

  /**
   * Ein Bild Navigation im Fenster `root`. `skip` = Elemente, die nicht als erstes gewählt werden (✕-Knopf).
   * Gibt zurück, ob A eine Schaltfläche ausgelöst hat.
   */
  update(root: HTMLElement, f: PadFrame, scrollEl?: HTMLElement | null): boolean {
    if (root !== this.root) { this.clear(); this.root = root; }
    const list = this.items(root);
    if (!list.length) { this.cur?.classList.remove(FOCUS); this.cur = null; return false; }
    // Neu gezeichnetes Fenster: gleiche Position wieder wählen
    if (!this.cur || !this.cur.isConnected || !list.includes(this.cur)) {
      const first = list.findIndex((b) => !b.classList.contains('pn-close'));
      this.focus(list[this.cur ? Math.min(this.idx, list.length - 1) : Math.max(0, first)], list);
    }
    const dir = f.nav();
    if (dir) {
      const next = this.neighbor(list, this.cur!, dir);
      if (next) this.focus(next, list);
    }
    // Rechter Stick blättert lange Listen
    if (scrollEl && Math.abs(f.ry) > 0.1) scrollEl.scrollBy(0, f.ry * 18);
    if (f.pressed(P.A) && this.cur) { this.cur.click(); return true; }
    return false;
  }

  private focus(el: HTMLElement, list: HTMLElement[]) {
    if (this.cur !== el) { this.cur?.classList.remove(FOCUS); el.classList.add(FOCUS); }
    this.cur = el;
    this.idx = list.indexOf(el);
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** Räumlich nächste Schaltfläche in Richtung `dir`; am Rand oben/unten wird umgebrochen. */
  private neighbor(list: HTMLElement[], from: HTMLElement, dir: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
    const r = from.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const b of list) {
      if (b === from) continue;
      const q = b.getBoundingClientRect();
      const dx = q.left + q.width / 2 - cx, dy = q.top + q.height / 2 - cy;
      const along = dx * vx + dy * vy;
      if (along <= 4) continue;
      const across = Math.abs(dx * vy) + Math.abs(dy * vx);
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    if (best || vx) return best;
    // Umbrechen: von unten wieder nach oben und umgekehrt
    return vy > 0 ? list[0] : list[list.length - 1];
  }
}
