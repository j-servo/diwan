import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Crops of the House of Life's costumed figures at the default camera (round B look-check). On
// demand: `DIWAN_FRAMES=1 npx playwright test e2e/costumes.spec.ts`. Needs a built House of Life.
const OUT =
  process.env['DIWAN_FRAMES_OUT'] ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../docs/superpowers/world2/img/process',
  );

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
test.setTimeout(240_000);

test('House of Life costume crops @frames', async ({ page }) => {
  await page.goto('/?demo=1&demoSpeed=1&director=0&frames=1&world=house-of-life&mood=golden');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 60_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().figures ?? 0), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(8000); // sit down, settle, costumes applied
  const tags = await page.locator('.agent-tag').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { text: (e as HTMLElement).innerText, x: r.x + r.width / 2, y: r.y + r.height };
    }),
  );
  const figs = await page.evaluate(() => window.__diwan!.figures!());
  const snap = await page.evaluate(() => window.__diwan!.snapshot());
  fs.mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: '.agent-tag, .hud, .board-panel { visibility: hidden; }' });
  const shots: string[] = [];
  for (const f of figs.filter((s) => s.inFrame)) {
    const tag = tags.reduce((a, b) =>
      Math.hypot(a.x - f.x, a.y - f.y) < Math.hypot(b.x - f.x, b.y - f.y) ? a : b,
    );
    const pose = snap.find((c) => c.id === f.id)?.pose ?? '';
    const name = f.isSubagent ? 'pupil' : /lector/i.test(tag.text) ? 'lector' : `scribe-${pose}`;
    if (shots.includes(name)) continue;
    shots.push(name);
    await page.screenshot({
      path: path.join(OUT, `b-${name}.jpg`),
      type: 'jpeg',
      quality: 90,
      clip: { x: Math.max(0, f.x - 45), y: Math.max(0, f.y - 75), width: 90, height: 100 },
    });
  }
  console.log('crops', shots.join(','), JSON.stringify(tags.map((t) => t.text)));
});
