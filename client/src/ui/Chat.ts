// Text-Chat: Enter öffnet das Eingabefeld, Enter sendet, Esc bricht ab.
// Texte werden ausschließlich über textContent eingefügt (kein HTML -> kein XSS).
import { OUTFIT_COLORS } from '../../../shared/src/constants';

const MAX_LINES = 8;
const FADE_AFTER_MS = 12000;

export class Chat {
  private root = document.getElementById('chat')!;
  private log = document.getElementById('chat-log')!;
  private input = document.getElementById('chat-input') as HTMLInputElement;
  onSend: (text: string) => void = () => {};
  onOpenChange: (open: boolean) => void = () => {};

  constructor() {
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.input.value.trim();
        if (text) this.onSend(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
    this.input.addEventListener('blur', () => this.close());
  }

  get isOpen() { return !this.input.classList.contains('hidden'); }

  open() {
    this.input.classList.remove('hidden');
    this.root.classList.add('open');
    this.input.value = '';
    this.input.focus();
    this.onOpenChange(true);
  }

  close() {
    if (!this.isOpen) return;
    this.input.classList.add('hidden');
    this.root.classList.remove('open');
    this.input.blur();
    this.onOpenChange(false);
  }

  add(from: string, text: string, color: number, system = false) {
    const line = document.createElement('div');
    line.className = 'chat-line' + (system ? ' system' : '');
    if (!system) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = from + ':';
      who.style.color = '#' + OUTFIT_COLORS[color % OUTFIT_COLORS.length].toString(16).padStart(6, '0');
      line.appendChild(who);
    }
    line.appendChild(document.createTextNode(text));
    this.log.appendChild(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild!.remove();
    setTimeout(() => line.classList.add('faded'), FADE_AFTER_MS);
  }
}
