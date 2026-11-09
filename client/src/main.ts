// Einstiegspunkt: Login-Bildschirm -> Verbindung -> Spiel starten.
import { Sfx } from './audio/Sfx';
import { Game } from './game/Game';
import { Network } from './net/Network';
import { loadAssets } from './render/assets';
import { loadTextureOverrides } from './render/materials/atlas';
import { loadQuaternius } from './render/quaternius';
import { loadKenneyCharacters } from './render/kenneyCharacters';

const loginEl = document.getElementById('login')!;
const form = document.getElementById('login-form') as HTMLFormElement;
const nameInput = document.getElementById('login-name') as HTMLInputElement;
const passInput = document.getElementById('login-pass') as HTMLInputElement;

/** Lokale Gast-ID: damit ein Gast beim nächsten Besuch seinen Fortschritt wiederfindet (und später ein Konto übernehmen kann). */
function guestId(): string {
  try {
    let id = localStorage.getItem('sunstate.guest');
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/[^w-]/g, '');
      localStorage.setItem('sunstate.guest', id);
    }
    return id;
  } catch { return ''; }
}
const status = document.getElementById('login-status')!;

// Modelle schon laden, während der Spieler seinen Namen tippt: Kit-Modelle, Quaternius-Packs
// (falls vorhanden) und verarbeitete Texturen (falls scripts/process-textures.ts gelaufen ist)
const progress = { kit: [0, 0], q: [0, 0], c: [0, 0] };
const showProgress = () => {
  const done = progress.kit[0] + progress.q[0] + progress.c[0], total = progress.kit[1] + progress.q[1] + progress.c[1];
  if (status.dataset.busy) status.textContent = `Lade Modelle … ${done}/${total}`;
};
const assets = Promise.all([
  loadAssets((d, t) => { progress.kit = [d, t]; showProgress(); }),
  loadQuaternius((d, t) => { progress.q = [d, t]; showProgress(); }),
  loadKenneyCharacters((d, t) => { progress.c = [d, t]; showProgress(); }),
  loadTextureOverrides(),
]);
const sfx = new Sfx();
// Dev: Audio in der Browser-Konsole testen, z. B. sfx.car.explosion({x:0,y:0,z:0}) oder sfx.engine.voices
if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) (globalThis as { sfx?: Sfx }).sfx = sfx;

// Zuletzt benutzten Namen vorschlagen (falls der Browser localStorage erlaubt)
try { nameInput.value = localStorage.getItem('sunstate.name') ?? ''; } catch { /* egal */ }
nameInput.focus();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) { status.textContent = 'Bitte gib einen Namen ein.'; return; }
  try { localStorage.setItem('sunstate.name', name); } catch { /* egal */ }
  sfx.init(); // Audio darf erst nach einer Nutzeraktion starten

  status.dataset.busy = '1';
  status.textContent = 'Lade Modelle …';
  await assets;
  status.textContent = 'Verbinde …';
  const net = new Network();
  try {
    const welcome = await net.connect({ name, password: passInput.value || undefined, guestId: guestId() || undefined });
    loginEl.classList.add('hidden');
    nameInput.blur();
    const game = new Game(net, welcome.id, sfx, welcome.dev);
    game.start();
  } catch (err) {
    delete status.dataset.busy;
    const m = (err as Error).message;
    status.textContent = m === 'Server nicht erreichbar' || m === 'Verbindung abgelehnt' ? `${m}. Läuft der Server (npm run dev)?` : m;
  }
});
