// F3 → Audio-Tab: aktive Stimmen (Kategorie, Entfernung, Hörbarkeit, Verdeckung), Bus-Pegel,
// Hallzone, Zone/Lazy-Loading und Lautstärkeregler je Bus (werden gespeichert).
import type { Sfx } from '../audio/Sfx';
import { BUSES, type BusId } from '../audio/manifest';

const LABELS: Record<BusId | 'master', string> = {
  master: 'Master', sfx: 'Effekte', vehicles: 'Fahrzeuge', weapons: 'Waffen', voice: 'Stimmen', ambience: 'Ambience', music: 'Musik/Radio', ui: 'UI',
};

export class AudioDebug {
  readonly el: HTMLDivElement;
  private text: HTMLPreElement;
  private built = false;

  constructor(private sfx: Sfx) {
    this.el = document.createElement('div');
    this.el.id = 'audio-debug';
    this.el.className = 'hidden';
    this.text = document.createElement('pre');
    document.body.appendChild(this.el);
  }

  private build() {
    const e = this.sfx.engine;
    if (!e || this.built) return;
    this.built = true;
    const grid = document.createElement('div');
    grid.className = 'sliders';
    for (const id of ['master', ...BUSES] as const) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'range'; input.min = '0'; input.max = '1.5'; input.step = '0.05';
      const val = document.createElement('span');
      const get = () => (id === 'master' ? e.settings.master : e.settings.buses[id]);
      input.value = String(get());
      val.textContent = get().toFixed(2);
      input.addEventListener('input', () => {
        const v = Number(input.value);
        if (id === 'master') e.settings.master = v; else e.settings.buses[id] = v;
        val.textContent = v.toFixed(2);
        e.applySettings();
      });
      label.append(LABELS[id], input, val);
      grid.appendChild(label);
    }
    const hrtf = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = e.settings.hrtf;
    cb.addEventListener('change', () => { e.settings.hrtf = cb.checked; e.applySettings(); });
    hrtf.append(cb, ' HRTF (neue Stimmen, mehr CPU)');
    grid.appendChild(hrtf);
    this.el.append(grid, this.text);
  }

  update() {
    this.build();
    this.text.textContent = this.sfx.debugText();
  }
}
