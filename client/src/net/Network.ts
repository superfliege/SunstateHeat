// WebSocket-Verbindung zum Spielserver.
// Die URL ergibt sich aus der Seite selbst (/ws). Im Dev-Modus leitet Vite das an Port 2567 weiter.
import { WS_PATH } from '../../../shared/src/constants';
import type { ClientMsg, ServerMsg } from '../../../shared/src/protocol';

type WelcomeMsg = Extract<ServerMsg, { t: 'welcome' }>;

export interface LoginInfo { name: string; password?: string; guestId?: string }

export class Network {
  private ws: WebSocket | null = null;
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(login: LoginInfo): Promise<WelcomeMsg> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${WS_PATH}`);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      let welcomed = false;
      let failure: string | null = null;
      ws.onopen = () => this.send({ t: 'join', ...login });
      ws.onerror = () => { if (!welcomed) reject(new Error('Server nicht erreichbar')); };
      ws.onclose = () => { if (welcomed) this.onClose(); else reject(new Error(failure ?? 'Verbindung abgelehnt')); };
      ws.onmessage = (ev) => {
        let msg: ServerMsg;
        try { msg = JSON.parse(ev.data as string); } catch { return; }
        if (!welcomed && msg.t === 'welcome') { welcomed = true; resolve(msg); return; }
        // Anmeldung abgelehnt (falsches Passwort, schon online …): Grund anzeigen, Verbindung beenden
        if (!welcomed && msg.t === 'error') { failure = msg.text; reject(new Error(msg.text)); ws.close(); return; }
        this.onMessage(msg);
      };
    });
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
