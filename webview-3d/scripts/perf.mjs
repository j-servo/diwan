// Frame-time benchmark for the baked hall: median and p95 per quality tier at 1440x900.
//
//   npm --workspace webview-3d run perf                      # build, serve, measure high + balanced
//   npm --workspace webview-3d run perf -- --url http://127.0.0.1:4173/   # an already-running build
//   options: --seconds 12 (sample length)  --tiers high,balanced  --json out.json
//            --card (click a scholar first, so the inspect card is open and the camera holds on it)
//
// The page runs the demo with `?bench=1`, which switches the canvas to frameloop="always" so every
// frame is rendered. Chromium is launched with the frame-rate limit and vsync off, otherwise
// requestAnimationFrame is capped at 16.7 ms and the numbers say nothing about the 8 ms budget.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const seconds = Number(opt('seconds', 12));
const tiers = opt('tiers', 'high,balanced').split(',');
const withCard = argv.includes('--card');
// --world <id> measures another world (default: the page's default, the House of Wisdom).
const world = opt('world', '');
const BUDGET_MS = 8;
const VIEWPORT = { width: 1440, height: 900 };

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not come up at ${url}`);
}

let server = null;
let baseUrl = opt('url', null);
if (baseUrl && !baseUrl.endsWith('/')) baseUrl += '/';
const stop = () => {
  server?.kill();
  server = null;
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stop();
    process.exit(130);
  });
}
process.on('exit', stop);

if (!baseUrl) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  baseUrl = 'http://127.0.0.1:4174/';
  // Spawn vite directly (not through npx) so kill() reaches the server itself.
  server = spawn(
    process.execPath,
    [
      path.join(
        path.dirname(createRequire(import.meta.url).resolve('vite/package.json')),
        'bin/vite.js',
      ),
      'preview',
      '--port',
      '4174',
      '--strictPort',
      '--host',
      '127.0.0.1',
    ],
    { cwd: root, stdio: 'ignore' },
  );
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : [];
const browser = await chromium.launch({
  args: [...gpuArgs, '--disable-frame-rate-limit', '--disable-gpu-vsync'],
});

const results = [];
try {
  if (server) await waitFor(baseUrl, 30_000);
  for (const tier of tiers) {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(
      `${baseUrl}?demo=1&bench=1&director=0&mood=golden&quality=${tier}${world ? `&world=${world}` : ''}`,
    );
    await page.waitForFunction(
      () => window.__diwan?.world().loaded && window.__diwan.world().figures >= 3,
      null,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(2000); // shader compiles, shadow maps, first probes
    if (withCard) {
      // Scholars walk to their desks at first: click each one in frame, a few times, until a card opens.
      let opened = false;
      for (let attempt = 0; attempt < 20 && !opened; attempt++) {
        const figures = await page.evaluate(
          () => window.__diwan?.figures?.().filter((f) => f.inFrame && !f.isSubagent) ?? [],
        );
        for (const f of figures) {
          await page.mouse.click(f.x, f.y);
          await page.waitForTimeout(300);
          if (await page.$('.inspect-card')) {
            opened = true;
            break;
          }
        }
        if (!opened) await page.waitForTimeout(500);
      }
      if (!opened) throw new Error('--card: could not open a card by clicking a scholar');
      await page.waitForTimeout(2500); // the camera glides in; the card ticks its clocks
    }
    const deltas = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          const out = [];
          let last = performance.now();
          const end = last + ms;
          const tick = (now) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
      seconds * 1000,
    );
    const sorted = deltas.slice(1).sort((a, b) => a - b);
    const median = pct(sorted, 50);
    const p95 = pct(sorted, 95);
    results.push({
      tier,
      card: withCard,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      frames: sorted.length,
      medianMs: +median.toFixed(2),
      p95Ms: +p95.toFixed(2),
      budgetMs: BUDGET_MS,
      withinBudget: p95 <= BUDGET_MS, // the budget is p95, not the median
    });
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}

console.log(JSON.stringify({ gpu: gpuArgs.length > 0 ? 'metal' : 'default', results }, null, 2));
console.log('\ntier       frames   median ms   p95 ms   budget');
for (const r of results) {
  console.log(
    `${r.tier.padEnd(10)} ${String(r.frames).padStart(6)}   ${r.medianMs.toFixed(2).padStart(9)}   ${r.p95Ms
      .toFixed(2)
      .padStart(6)}   ${r.withinBudget ? 'ok' : 'OVER'} (<= ${BUDGET_MS} ms)`,
  );
}
const jsonPath = opt('json', null);
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
