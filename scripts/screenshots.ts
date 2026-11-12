// Screenshots per Playwright gegen Build + `vite preview` (Server im Dev-Modus). Aufruf: npx tsx scripts/screenshots.ts <shots.json> <ausgabeordner>
// shots.json: [{ name, cmds?: [Chat-Befehle], photo?: [x,y,z,lx,ly,lz,fov], wait?: ms }]
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const shots = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { name: string; cmds?: string[]; photo?: number[]; wait?: number; keys?: string[] }[];
const out = process.argv[3];
const procs: ChildProcess[] = [];
const run = (cmd: string, a: string[], env: Record<string, string> = {}) => { const p = spawn(cmd, a, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); p.stderr?.on('data', (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(s); }); procs.push(p); return p; };
process.on('exit', () => procs.forEach((p) => p.kill('SIGTERM')));
async function waitHttp(url: string) { for (let i = 0; i < 240; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /**/ } await new Promise((r) => setTimeout(r, 500)); } throw new Error('timeout ' + url); }
const data = mkdtempSync(join(tmpdir(), 'shot-'));
run('npx', ['tsx', 'server/src/index.ts'], { DATA_DIR: data, NODE_ENV: 'development', PORT: '2567' });
{
  const dist = mkdtempSync(join(tmpdir(), 'shot-dist-'));
  const b = run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir']);
  await new Promise((r) => b.on('exit', r));
  run('npx', ['vite', 'preview', '--outDir', dist, '--port', '5173', '--strictPort']);
}
await waitHttp('http://localhost:2567/'); await waitHttp('http://localhost:5173/');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
page.on('console', (m: { type(): string; text(): string }) => { if (!/GL Driver|ReadPixels/.test(m.text())) console.log('[console]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e: Error) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5173/?shot=1', { waitUntil: 'networkidle', timeout: 180000 });
await page.waitForTimeout(3000);
await page.fill('#login-name', 'Fotograf');
await page.evaluate(() => (document.getElementById('login-form') as HTMLFormElement).requestSubmit());
const t0 = Date.now();
const iv = setInterval(async () => { try { console.log('wait', Math.round((Date.now() - t0) / 1000), await page.evaluate(() => document.getElementById('login-status')?.textContent)); } catch { /**/ } }, 30000);
try { await page.waitForFunction(() => !!(globalThis as any).__game || !!(globalThis as any).__shotGame, null, { timeout: 240000 }); }
catch (e) { await page.screenshot({ path: join(out, '_fail.png') }); console.log('status:', await page.evaluate(() => document.getElementById('login-status')?.textContent)); throw e; }
await page.waitForTimeout(6000);
for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(400); }
clearInterval(iv);
const send = (text: string) => page.evaluate((t: string) => (globalThis as any).__game.net.send({ t: 'chat', text: t }), text);
// Story-Intro wegdrücken (wie der Benchmark)
const clearStory = async () => {
  for (let i = 0; i < 80; i++) {
    const busy = await page.evaluate(() => { const g = (globalThis as any).__game; if (g.storyUi.blocking) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); return g.storyBlock || g.storyUi.busy || g.storyUi.blocking; });
    if (!busy) return;
    await page.waitForTimeout(400);
  }
};
await clearStory();
for (const s of shots) {
  for (const c of s.cmds ?? []) { await send(c); await page.waitForTimeout(500); }
  await page.evaluate((p: number[] | undefined) => { const g = (globalThis as any).__game; if (p) g.photo(...p); else g.photo(); }, s.photo);
  await clearStory();
  for (const k of s.keys ?? []) await page.keyboard.press(k);
  await page.waitForTimeout(s.wait ?? 7000);
  await page.screenshot({ path: join(out, s.name + '.png') });
  console.log('shot', s.name);
}
await browser.close();
process.exit(0);
