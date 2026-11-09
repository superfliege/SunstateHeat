import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Der Client liegt in /client. Im Dev-Modus leitet Vite die WebSocket-Verbindung
// (/ws) an den Spielserver auf Port 2567 weiter. So müssen Freunde nur EINEN Port
// (5173) erreichen können.

const ASSETS = join(__dirname, 'client', 'public', 'assets');

/** Alle glTF/GLB-Dateien unter assets/quaternius und assets/kenney/nature-kit (rekursiv), relativ zu assets/. */
function scanModels(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(gltf|glb)$/i.test(e)) out.push(relative(ASSETS, p).split('\\').join('/'));
    }
  };
  walk(join(ASSETS, 'quaternius'));
  walk(join(ASSETS, 'kenney', 'nature-kit'));
  return out.sort();
}

/**
 * Liefert assets/manifest.json (Liste der Pflanzen-/Figurenmodelle) – im Dev-Server live,
 * beim Build als Datei. So reicht es, die Packs in den Ordner zu kopieren.
 */
function assetManifest(): Plugin {
  const json = () => JSON.stringify({ files: scanModels() });
  return {
    name: 'sunstate-asset-manifest',
    configureServer(server) {
      server.middlewares.use('/assets/manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(json());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'assets/manifest.json', source: json() });
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [assetManifest()],
  server: {
    host: true, // auch im LAN erreichbar
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:2567', ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
