import { expect, test } from '@playwright/test';

// The reload-based world switcher: House of Wisdom -> House of Life -> back. Both worlds are listed
// (Yousef, 2026-10-18: the House of Life is offered as a preview while its look-dev is reviewed).
const AMETHYST = 'rgb(162, 28, 175)';
const COBALT = 'rgb(47, 91, 234)';

test('the HUD switches worlds by reload and remembers the choice', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  // the House of Wisdom offers both worlds
  await page.goto('/?demo=1&demoSpeed=1&director=0&mood=golden&frames=1');
  await expect(page.locator('.hud-where')).toBeVisible();
  const picker = page.getByLabel('World');
  await expect(picker).toBeVisible();
  await expect(picker.locator('option')).toHaveText(['House of Wisdom', 'House of Life (preview)']);
  await expect(picker).toHaveValue('house-of-wisdom');
  expect(await page.evaluate(() => document.documentElement.dataset.world)).toBe('house-of-wisdom');

  // a real pointer must reach the control, not the canvas behind the HUD (selectOption skips
  // hit-testing); then choosing the House of Life reloads into it, other parameters kept
  await picker.click();
  await Promise.all([page.waitForURL(/world=house-of-life/), picker.selectOption('house-of-life')]);
  expect(page.url()).toContain('demo=1');
  expect(await page.evaluate(() => document.documentElement.dataset.world)).toBe('house-of-life');
  await expect(page.getByLabel('World')).toHaveValue('house-of-life');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);

  // scribes, not scholars; and they sit
  await expect(page.locator('.hud-counts')).toContainText(/scribe/);
  await expect(page.locator('.hud-counts')).not.toContainText(/scholar/);
  const snapshot = () => page.evaluate(() => window.__diwan?.snapshot() ?? []);
  await expect
    .poll(async () => (await snapshot()).length, { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);
  await expect
    .poll(async () => (await snapshot()).some((c) => c.pose === 'work' || c.pose === 'idle'), {
      timeout: 30_000,
    })
    .toBe(true);

  // an approval shows the amethyst signal, not cobalt: bubble fill and the CSS variable
  const bubble = page.locator('.bubble--approval').first();
  await expect(bubble).toBeVisible({ timeout: 60_000 });
  expect(await bubble.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(AMETHYST);
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--needs-you')
        .trim()
        .toLowerCase(),
    ),
  ).toBe('#a21caf');

  // back: a full reload into ?world=house-of-wisdom, other parameters kept, the switcher still there
  await page.getByLabel('World').click();
  await Promise.all([
    page.waitForURL(/world=house-of-wisdom/),
    page.getByLabel('World').selectOption('house-of-wisdom'),
  ]);
  expect(page.url()).toContain('demo=1');
  await expect(page.getByLabel('World')).toHaveValue('house-of-wisdom');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
  const wisdomBubble = page.locator('.bubble--approval').first();
  await expect(wisdomBubble).toBeVisible({ timeout: 60_000 });
  expect(await wisdomBubble.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(COBALT);

  expect(errors).toEqual([]);
});

test('an unknown ?world= falls back to the House of Wisdom', async ({ page }) => {
  await page.goto('/?demo=1&director=0&world=atlantis');
  expect(await page.evaluate(() => document.documentElement.dataset.world)).toBe('house-of-wisdom');
});

test('the remembered choice opens when the URL names no world', async ({ page }) => {
  await page.goto('/?demo=1&director=0');
  await page.evaluate(() => localStorage.setItem('diwan.world', 'house-of-life'));
  await page.goto('/?demo=1&director=0');
  expect(await page.evaluate(() => document.documentElement.dataset.world)).toBe('house-of-life');
  await expect(page.getByLabel('World')).toHaveValue('house-of-life');
  // an explicit ?world= still wins over the remembered one
  await page.goto('/?demo=1&director=0&world=house-of-wisdom');
  expect(await page.evaluate(() => document.documentElement.dataset.world)).toBe('house-of-wisdom');
});

test('House of Life: no figure ever steps onto the pool of Nun or the pyramid', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/?demo=1&demoSpeed=2&director=0&world=house-of-life');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 60_000 })
    .toBe(true);
  const blocked = await page.evaluate(() => window.__diwan!.blocked());
  // the pool's footprint (cols 7-12, rows 5-10) is all blocked furniture
  const inPool = (c: number, r: number) => c >= 7 && c <= 12 && r >= 5 && r <= 10;
  expect(
    blocked.filter((k) => inPool(...(k.split(',').map(Number) as [number, number]))),
  ).toHaveLength(36);
  const hits: string[] = [];
  for (let i = 0; i < 150; i++) {
    for (const c of await page.evaluate(() => window.__diwan!.snapshot()))
      if (inPool(c.col, c.row)) hits.push(`${c.id}@${c.col},${c.row}`);
    await page.waitForTimeout(200);
  }
  expect(hits).toEqual([]);
});

test('each world loads its own figures file', async ({ page }) => {
  const loaded: string[] = [];
  page.on('request', (r) => /figures[^/]*\.glb/.test(r.url()) && loaded.push(r.url()));
  await page.goto('/?demo=1&director=0&world=house-of-life');
  await expect.poll(() => loaded.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(loaded.every((u) => /figures-egypt[^/]*\.glb/.test(u))).toBe(true);

  loaded.length = 0;
  await page.goto('/?demo=1&director=0&world=house-of-wisdom');
  await expect.poll(() => loaded.length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(loaded.every((u) => !/egypt/.test(u) && /figures[^/]*\.glb/.test(u))).toBe(true);
});
