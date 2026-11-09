// Einstiegspunkt des Spielservers.
// - WebSocket-Endpunkt unter /ws
// - liefert im Produktionsmodus (nach `npm run build`) auch den Client aus dist/client aus
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_NAME_LENGTH, SERVER_PORT, WS_PATH } from '../../shared/src/constants';
import type { ClientMsg, ServerMsg } from '../../shared/src/protocol';
import type { Connection, ServerPlayer } from './entities/types';
import { RoomManager } from './rooms/RoomManager';
import type { WorldRoom } from './rooms/WorldRoom';
import { FilePlayerStore } from './services/PlayerStore';

const CLIENT_DIR = resolve(process.cwd(), 'dist/client');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.ogg': 'audio/ogg',
};

/** Gut komprimierbare Typen (Modelle, Skripte …) – Bilder und OGG sind schon komprimiert. */
const GZIP = new Set(['.html', '.js', '.css', '.svg', '.json', '.gltf', '.glb', '.bin', '.fbx']);
/** gzip-Ergebnis je Datei (Pfad -> [mtime, Daten]); die Assets ändern sich zur Laufzeit nicht. */
const gzCache = new Map<string, [number, Buffer]>();
function gzipped(file: string): Buffer {
  const mtime = statSync(file).mtimeMs;
  const hit = gzCache.get(file);
  if (hit && hit[0] === mtime) return hit[1];
  const data = gzipSync(readFileSync(file), { level: 9 });
  gzCache.set(file, [mtime, data]);
  return data;
}

// ---------------------------------------------------------------- HTTP (statische Dateien)
const http = createServer((req, res) => {
  if (!existsSync(CLIENT_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Sunstate Heat Server läuft. Im Dev-Modus den Client unter http://localhost:5173 öffnen.');
    return;
  }
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(CLIENT_DIR, urlPath));
  if (!file.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end(); return; } // Path-Traversal-Schutz
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  // Kit-Modelle (GLB) schrumpfen mit gzip auf etwa ein Viertel
  if (GZIP.has(extname(file)) && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    const body = gzipped(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Content-Length': body.length, Vary: 'Accept-Encoding' });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(file).pipe(res);
});

// ---------------------------------------------------------------- WebSocket
const store = new FilePlayerStore();
const rooms = new RoomManager(store);
/** Profile, die gerade online sind (ein Konto/Gast kann nur einmal gleichzeitig spielen). */
const online = new Set<string>();
// permessage-deflate: JSON-Snapshots schrumpfen damit auf etwa ein Viertel
const wss = new WebSocketServer({ server: http, path: WS_PATH, maxPayload: 16 * 1024, perMessageDeflate: { threshold: 256, zlibDeflateOptions: { level: 3 } } });

function wrap(ws: WebSocket): Connection {
  return {
    send: (msg: ServerMsg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
    sendRaw: (json: string) => { if (ws.readyState === ws.OPEN) ws.send(json); },
    close: () => ws.close(),
  };
}

function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  const clean = s.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || `Gast${Math.floor(Math.random() * 900 + 100)}`;
}

wss.on('connection', (ws) => {
  const conn = wrap(ws);
  let room: WorldRoom | null = null;
  let player: ServerPlayer | null = null;
  let joining = false;
  let profileKey: string | null = null;
  // Wer sich nicht innerhalb von 15 s anmeldet, fliegt raus
  const joinTimeout = setTimeout(() => { if (!player) ws.close(); }, 15000);

  ws.on('message', async (data) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (!player) {
      if (msg.t !== 'join' || joining) return;
      joining = true;
      const name = sanitizeName(msg.name);
      const password = typeof msg.password === 'string' && msg.password ? msg.password.slice(0, 128) : undefined;
      const guestId = typeof msg.guestId === 'string' ? msg.guestId : undefined;
      const auth = await store.authenticate(name, password, guestId);
      if (ws.readyState !== ws.OPEN) return;
      if (!auth.ok) { conn.send({ t: 'error', text: auth.error }); joining = false; return; }
      if (online.has(auth.profile.key)) {
        conn.send({ t: 'error', text: 'Dieser Spieler ist bereits online.' });
        joining = false;
        return;
      }
      online.add(auth.profile.key);
      profileKey = auth.profile.key;
      room = rooms.findOrCreateRoom();
      player = room.addPlayer(conn, auth.profile.name, auth.profile);
      clearTimeout(joinTimeout);
      console.log(`[join] ${player.name} -> ${room.id} (${room.players.size} Spieler)`);
      return;
    }
    room?.handleMessage(player, msg);
  });

  ws.on('close', () => {
    clearTimeout(joinTimeout);
    if (profileKey) online.delete(profileKey);
    if (room && player) {
      room.removePlayer(player);
      console.log(`[leave] ${player.name}`);
      rooms.cleanup();
    }
  });
});

http.listen(SERVER_PORT, () => {
  console.log(`\n  Sunstate Heat Server läuft auf Port ${SERVER_PORT}`);
  for (const list of Object.values(networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) console.log(`  LAN-Adresse: ${addr.address}`);
    }
  }
  console.log('');
});

// Beim Herunterfahren alle Spieler speichern (Spec 23.3)
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('[shutdown] speichere Spieler …');
  rooms.saveAll();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
