// Round H (Yousef, 2026-10-19): figures walk the engine's route, never a shortcut through the pool.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Rect = [number, number, number, number]; // x0, z0, x1, z1 in tiles
// the pool of Nun (cols 7-12, rows 5-10) and the armillary plinth (cols 9-10, rows 6-7)
const POOL: Rect = [7, 5, 13, 11];
const PLINTH: Rect = [9, 6, 11, 8];
const MARGIN = 0.2;
/** A figure may trail its engine character by about this many tiles (about 3.6 of route plus the engine's half-tile). */
const LAG_MAX = 5;
const WARM_UP_MS = 8_000;

interface Stats {
  samples: number;
  inRect: number;
  worstLag: number;
  worstLagAfterWarmUp: number;
  figures: number;
}

/** Samples every 100 ms inside the page, so the cadence does not depend on the test runner. */
async function sample(page: Page, ms: number, rect: Rect): Promise<Stats> {
  return page.evaluate(
    ([total, r, margin, warm]) =>
      new Promise<Stats>((resolve) => {
        const out: Stats = {
          samples: 0,
          inRect: 0,
          worstLag: 0,
          worstLagAfterWarmUp: 0,
          figures: 0,
        };
        const t0 = performance.now();
        const timer = setInterval(() => {
          const pos = window.__diwan!.figurePositions!();
          const snap = window.__diwan!.snapshot();
          const elapsed = performance.now() - t0;
          for (const c of snap) {
            const p = pos[c.id];
            if (!p) continue;
            out.samples++;
            out.figures = Math.max(out.figures, snap.length);
            if (
              p[0] > r[0] + margin &&
              p[0] < r[2] - margin &&
              p[1] > r[1] + margin &&
              p[1] < r[3] - margin
            )
              out.inRect++;
            const lag = Math.hypot(p[0] - (c.col + 0.5), p[1] - (c.row + 0.5));
            out.worstLag = Math.max(out.worstLag, lag);
            if (elapsed > warm) out.worstLagAfterWarmUp = Math.max(out.worstLagAfterWarmUp, lag);
          }
          if (elapsed >= total) {
            clearInterval(timer);
            resolve(out);
          }
        }, 100);
      }),
    [ms, rect, MARGIN, WARM_UP_MS] as const,
  );
}

async function loaded(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 60_000 })
    .toBe(true);
}

test.describe('figures follow the engine route', () => {
  test.setTimeout(180_000);

  for (const [world, rect] of [
    ['house-of-life', POOL],
    ['house-of-wisdom', PLINTH],
  ] as const) {
    test(`${world}: demo, no figure is ever drawn inside the centrepiece`, async ({ page }) => {
      // the director on, so scholars wander and circle; frames=1 exposes the probes
      await page.goto(`/?demo=1&demoSpeed=2&frames=1&world=${world}`);
      await loaded(page);
      const s = await sample(page, 60_000, rect);
      console.log(world, 'demo', JSON.stringify(s));
      expect(s.samples).toBeGreaterThan(300);
      expect(s.inRect).toBe(0);
      expect(s.worstLagAfterWarmUp).toBeLessThan(LAG_MAX);
    });
  }

  // End to end through the real diwan server, HOME a temp dir (the real ~/.claude and ~/.diwan stay untouched).
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  let home = '';
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

  test('house-of-life: live idle sessions, one joining mid-run, never inside the pool', async ({
    page,
  }) => {
    execFileSync('node', ['esbuild.js', '--diwan'], { cwd: repoRoot, stdio: 'ignore' });
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-e2e-'));
    const port = await new Promise<number>((resolve, reject) => {
      const s = net.createServer();
      s.once('error', reject);
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address() as net.AddressInfo;
        s.close(() => resolve(port));
      });
    });
    child = spawn('node', ['dist/diwan.js', '--no-open', '--port', String(port)], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home },
      stdio: 'ignore',
    });
    const serverJson = path.join(home, '.diwan', 'server.json');
    await expect.poll(() => fs.existsSync(serverJson), { timeout: 20_000 }).toBe(true);
    const { token } = JSON.parse(fs.readFileSync(serverJson, 'utf-8')) as { token: string };
    const start = async (n: number) => {
      const transcript = path.join(home, '.claude', 'projects', `-tmp-t${n}`, `s${n}.jsonl`);
      fs.mkdirSync(path.dirname(transcript), { recursive: true });
      fs.writeFileSync(
        transcript,
        JSON.stringify({ type: 'ai-title', aiTitle: `Idle ${n}` }) + '\n',
      );
      const common = {
        session_id: `trail-session-000${n}`,
        transcript_path: transcript,
        cwd: `/tmp/t${n}`,
      };
      // a short burst of work, then the session sits idle and its scholar wanders
      for (const event of [
        { ...common, hook_event_name: 'SessionStart', source: 'startup' },
        { ...common, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 't1' },
        { ...common, hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 't1' },
        { ...common, hook_event_name: 'Stop' },
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(event),
        });
        expect(res.status).toBe(200);
      }
    };
    await page.goto(`http://127.0.0.1:${port}/?frames=1&world=house-of-life`);
    await loaded(page);
    await start(1);
    await start(2);
    await start(3);
    const late = setTimeout(() => void start(4), 20_000);
    const s = await sample(page, 60_000, POOL);
    clearTimeout(late);
    console.log('house-of-life live', JSON.stringify(s));
    expect(s.figures).toBeGreaterThanOrEqual(3);
    expect(s.inRect).toBe(0);
    expect(s.worstLagAfterWarmUp).toBeLessThan(LAG_MAX);
  });
});
