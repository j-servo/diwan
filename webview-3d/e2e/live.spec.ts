import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// End to end through the real `diwan` server: a hook sequence POSTed to it must put a scholar
// in the 3D hall. HOME is a temp dir, so the real ~/.claude and ~/.diwan are never touched.
// The hall itself (dist/webview-3d) is built by the webServer step in playwright.config.ts.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

let home: string;
let child: ChildProcess | undefined;

test.afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child!.once('close', () => resolve());
      setTimeout(resolve, 3_000);
    });
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

test('live: hooks POSTed to a real diwan server show a scholar in the hall', async ({ page }) => {
  execFileSync('node', ['esbuild.js', '--diwan'], { cwd: repoRoot, stdio: 'ignore' });
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-e2e-'));
  const port = await freePort();
  child = spawn('node', ['dist/diwan.js', '--no-open', '--port', String(port)], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    stdio: 'ignore',
  });
  const serverJson = path.join(home, '.diwan', 'server.json');
  await expect.poll(() => fs.existsSync(serverJson), { timeout: 20_000 }).toBe(true);
  const { token } = JSON.parse(fs.readFileSync(serverJson, 'utf-8')) as { token: string };

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
  expect(await page.evaluate(() => window.__diwan?.snapshot().length)).toBe(0);

  const transcript = path.join(home, '.claude', 'projects', '-tmp-caravan', 's1.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  // The session's own title, as Claude Code writes it: the scholar's tag carries it, not the folder.
  fs.writeFileSync(transcript, JSON.stringify({ type: 'ai-title', aiTitle: 'Brain setup' }) + '\n');
  const common = {
    session_id: 'e2e-session-0001',
    transcript_path: transcript,
    cwd: '/tmp/caravan',
  };
  for (const event of [
    { ...common, hook_event_name: 'SessionStart', source: 'startup' },
    { ...common, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't1' },
    { ...common, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 't1' },
  ]) {
    const res = await fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(200);
  }

  await expect
    .poll(() => page.evaluate(() => window.__diwan?.snapshot().length ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
  await expect(page.locator('.agent-name')).toContainText('Brain setup', { timeout: 20_000 });
  await expect(page.locator('.agent-name')).not.toContainText('The ');

  // The fuller action crosses the wire beside the short status: the whole command, secrets masked.
  const command = 'npm run deploy:staging -- --region eu-west-1 --token=abcd1234efgh && echo done';
  const res = await fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ...common,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
    }),
  });
  expect(res.status).toBe(200);
  await expect
    .poll(
      () => {
        const start = frames
          .map((f) => JSON.parse(f) as Record<string, unknown>)
          .find((m) => m.type === 'agentToolStart' && m.toolName === 'Bash');
        return start ? { status: start.status, detail: start.detail } : null;
      },
      { timeout: 10_000 },
    )
    .toEqual({
      status: 'Running: npm run deploy:staging -- --re\u2026',
      detail:
        'npm run deploy:staging -- --region eu-west-1 --token=\u2022\u2022\u2022 && echo done',
    });
  expect(errors).toEqual([]);
});
