import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { CUTS } from '../src/promo/cuts.ts';
import { cameraAt } from '../src/promo/rigMath.ts';

// The promo mode (?promo=main, demo only): HUD hidden, the camera follows the script, captions
// fade in, and a live page never gets any of it. The video itself is rendered by `npm run promo`.
const MAIN = CUTS['main']!;
test.use({ viewport: { width: 960, height: 540 } });
test.setTimeout(180_000);

async function open(page: Page, world: string) {
  await page.goto(`/?demo=1&promo=main&world=${world}&frames=1&quality=balanced`);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded && !!window.__promo), {
      timeout: 60_000,
    })
    .toBe(true);
  await page.evaluate(() => window.__promo!.begin());
}

test('the promo hides the HUD and follows the script', async ({ page }) => {
  await open(page, 'house-of-wisdom');
  const seg = MAIN.segments[0]!;
  const ctx = { aspect: 960 / 540, lampOf: () => null, centreZ: 7 };

  await page.evaluate(() => window.__promo!.seek(5));
  const at5 = await page.evaluate(() => window.__promo!.pose());
  const want5 = cameraAt(seg.keys, 5, ctx);
  for (let i = 0; i < 3; i++) expect(at5.pos[i]).toBeCloseTo(want5.pos[i]!, 3);
  expect(at5.fov).toBeCloseTo(want5.fov, 3);
  await expect(page.locator('.promo-caption').first()).toHaveCSS('opacity', '1');
  expect(
    await page
      .locator('.hud')
      .isVisible()
      .catch(() => false),
  ).toBe(false);

  // 17 s: the second caption, and a scholar's lamp is asking for approval
  await page.evaluate(() => window.__promo!.seek(17));
  await expect(page.locator('.promo-caption').nth(1)).toHaveCSS('opacity', '1');
  await page.evaluate(() => window.__promo!.seek(20));
  const snap = await page.evaluate(() => window.__diwan!.snapshot());
  expect(snap.some((s) => s.signal === 'permission')).toBe(true);
  const lamps = await page.evaluate(() => window.__diwan!.approvalLamps!());
  expect(lamps.length).toBeGreaterThan(0);
  expect(lamps[0]!.inFrame).toBe(true);
});

test('the House of Life segment ends on the end card at dusk', async ({ page }) => {
  await open(page, 'house-of-life');
  await page.evaluate(() => window.__promo!.seek(35));
  const pose = await page.evaluate(() => window.__promo!.pose());
  expect(pose.mix).toBeGreaterThan(0.9);
  await expect(page.locator('.promo-card')).toHaveCSS('opacity', '1');
  await expect(page.locator('.promo-title')).toHaveText('Diwan');
});

test('a live page ignores ?promo', async ({ page }) => {
  await page.goto('/?demo=0&promo=main');
  await expect(page.locator('.hud')).toBeVisible();
  expect(await page.evaluate(() => !!window.__promo)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.classList.contains('promo'))).toBe(
    false,
  );
});
