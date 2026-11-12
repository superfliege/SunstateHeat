// Client-Benchmark automatisch: startet Server (geseedet) + Vite, öffnet die Benchmark-Route in
// Chromium (Playwright), wartet auf das Ergebnis und schreibt es nach docs/bench/<label>.json.
//
//   npx tsx scripts/bench-client.ts [label] [--ablate] [--only=ocean,downtown] [--headed] [--dyn] [--dev] [--w=1920 --h=1080]
//
// Ohne echte GPU (Container/CI) rendert Chromium per SwiftShader (CPU): Absolute FPS/GPU-Zeiten sind
// dann NICHT mit dem T580 vergleichbar – Draw-Calls, Dreiecke, Shader-Programme, Speicher und die
// CPU-Aufteilung schon. Für echte Zahlen auf dem Laptop: `npm run dev` mit BENCH_SEED=1234 starten und
// im Chrome http://localhost:5173/?bench=1 öffnen (Ergebnis in der Konsole: BENCH_RESULT …).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// Playwright ist optional (nicht in package.json): npm i -D playwright && npx playwright install chromium
interface PwPage { on(ev: string, f: (x: { text(): string; type(): string; message: string }) => void): void; goto(u: string): Promise<unknown> }
interface PwBrowser { newPage(o: object): Promise<PwPage>; close(): Promise<void> }
let chromium: { launch(o: object): Promise<PwBrowser> };
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch {
  console.error('Playwright fehlt: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) ?? 'run';
const flag = (n: string) => args.includes('--' + n);
const opt = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];

const procs: ChildProcess[] = [];
const run = (cmd: string, a: string[], env: Record<string, string> = {}) => {
  const p = spawn(cmd, a, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr?.on('data', (d) => { const s = String(d); if (/error/i.test(s) && !/ECONNRESET|socket error|onStreamRead/.test(s)) process.stderr.write(s); });
  if (process.env.BENCH_LOG) p.stdout?.on('data', (d) => process.stdout.write(`[${cmd}] ${d}`));
  procs.push(p);
  return p;
};
const cleanup = () => { for (const p of procs) p.kill('SIGTERM'); };
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

async function waitHttp(url: string, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* noch nicht */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timeout: ' + url);
}

const data = mkdtempSync(join(tmpdir(), 'sunstate-bench-'));
run('npx', ['tsx', 'server/src/index.ts'], { BENCH_SEED: '1234', DATA_DIR: data, NODE_ENV: 'development' });
// Standard: Build-Schnappschuss + `vite preview` – so stören Code-Änderungen während des Laufs nicht
// (Vite-HMR würde die Seite neu laden). `--dev` nimmt den Dev-Server.
if (flag('dev')) run('npx', ['vite', '--port', '5173', '--strictPort']);
else {
  const out = mkdtempSync(join(tmpdir(), 'sunstate-bench-dist-'));
  const b = run('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir']);
  await new Promise((r) => b.on('exit', r));
  run('npx', ['vite', 'preview', '--outDir', out, '--port', '5173', '--strictPort']);
}
await waitHttp('http://localhost:2567/');
await waitHttp('http://localhost:5173/');

const browser = await chromium.launch({
  headless: !flag('headed'),
  args: [
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-precise-memory-info',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width: Number(opt('w') ?? 1920), height: Number(opt('h') ?? 1080) } });
let result: unknown = null;
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('BENCH_RESULT ')) result = JSON.parse(t.slice(13));
  else if (m.type() === 'error') console.error('[browser]', t);
});
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
const q = new URLSearchParams({ bench: '1' });
if (flag('ablate')) q.set('ablate', '1');
if (flag('dyn')) q.set('dyn', '1');
if (opt('only')) q.set('only', opt('only')!);
for (const k of ['gfx', 'preset']) if (opt(k)) q.set(k, opt(k)!);
console.log('Öffne', `http://localhost:5173/?${q}`);
await page.goto(`http://localhost:5173/?${q}`);
const t0 = Date.now();
let lastLog = 0;
while (!result && Date.now() - t0 < 20 * 60_000) {
  await new Promise((r) => setTimeout(r, 1000));
  if (Date.now() - lastLog > 15000) {
    lastLog = Date.now();
    const st = await (page as unknown as { evaluate(f: () => string): Promise<string> }).evaluate(() => [...document.querySelectorAll('div')].find((d) => d.textContent?.startsWith('BENCH'))?.textContent?.split('\n')[0] ?? document.getElementById('login-status')?.textContent ?? '?').catch(() => '(keine Antwort)');
    console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${st}`);
  }
}
await browser.close();
cleanup();
if (!result) { console.error('Kein Ergebnis (Timeout).'); process.exit(1); }

mkdirSync('docs/bench', { recursive: true });
const file = `docs/bench/${label}.json`;
writeFileSync(file, JSON.stringify(result, null, 2));
const R = result as { gl: { renderer: string; timerQuery: boolean }; sections: unknown[] };
console.log(`\n${file} · GPU: ${R.gl.renderer} · Timer-Query: ${R.gl.timerQuery}`);
console.log('| Abschnitt | FPS | 1%-Low | p99 ms | max ms | Draw-Calls Ø/max | Dreiecke Ø/max | Programme | CPU ms | GPU ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const s of R.sections as { name: string; fps: number; low1: number; p99ms: number; maxMs: number; calls: { avg: number; max: number }; tris: { avg: number; max: number }; programs: number; cpu: { total: number }; gpu: { total?: number } }[]) {
  console.log(`| ${s.name} | ${s.fps} | ${s.low1} | ${s.p99ms} | ${s.maxMs} | ${s.calls.avg}/${s.calls.max} | ${Math.round(s.tris.avg / 1000)}k/${Math.round(s.tris.max / 1000)}k | ${s.programs} | ${s.cpu.total} | ${s.gpu.total ?? '–'} |`);
}
process.exit(0);
