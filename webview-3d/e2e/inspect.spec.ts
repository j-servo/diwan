import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const DEMO = '/?demo=1&demoSpeed=1&director=0&mood=golden&frames=1';

async function openHall(page: Page) {
  await page.goto(DEMO);
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().figures ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);
}

/** Click scholars (not apprentices) in turn until one card shows a working line with its detail. */
async function clickWorkingScholar(page: Page) {
  const card = page.locator('.inspect-card');
  await expect
    .poll(
      async () => {
        const figures = (await page.evaluate(() => window.__diwan?.figures?.() ?? [])).filter(
          (f) => f.inFrame && !f.isSubagent,
        );
        for (const f of figures) {
          await page.mouse.click(f.x, f.y);
          await page.waitForTimeout(250);
          if (await card.locator('.ic-now .ic-detail').count()) return true;
        }
        return false;
      },
      { timeout: 30_000, intervals: [200] },
    )
    .toBe(true);
}

test('click a scholar: the card names it and shows what it is doing; Esc closes it', async ({
  page,
}) => {
  await openHall(page);
  await clickWorkingScholar(page);
  const card = page.locator('.inspect-card');
  await expect(card).toHaveAttribute('role', 'region');
  await expect(card).toHaveAttribute('aria-label', /details$/);
  await expect(card.locator('h2')).not.toBeEmpty();
  await expect(card.locator('.ic-state')).toContainText(/Working|Arrived|Waiting|Finished/);
  const detail = await card.locator('.ic-now .ic-detail').first().innerText();
  expect(detail.length).toBeGreaterThan(5);
  // focus lands on the close button; the board gives way to the card
  await expect(card.locator('.ic-close')).toBeFocused();
  await expect(page.locator('.board-panel')).toBeHidden();

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await expect(page.locator('.board-panel')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
});

test('the close button and empty floor also close the card', async ({ page }) => {
  await openHall(page);
  await clickWorkingScholar(page);
  const card = page.locator('.inspect-card');
  await card.locator('.ic-close').click();
  await expect(card).toHaveCount(0);

  await clickWorkingScholar(page);
  // the top-left corner of the window is empty floor-or-wall with no figure
  await page.mouse.click(4, 400);
  await expect(card).toHaveCount(0);
});

test('"needs you" in the HUD opens the card of the scholar asking, in cobalt and in words', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openHall(page);
  const button = page.getByRole('button', { name: 'Show the next scholar who needs you' });
  // the first approval lasts from 14 to 22 s of the loop
  await expect(button).toBeVisible({ timeout: 40_000 });
  await button.click();

  const card = page.locator('.inspect-card');
  const needs = card.locator('.ic-needs');
  await expect(needs).toBeVisible();
  await expect(needs).toContainText('Needs you');
  await expect(needs).toContainText('Wants to run:');
  await expect(needs).toContainText('npm run db:migrate');
  await expect(needs).toContainText('Answer it in your terminal');
  await expect(card.locator('.ic-state')).toContainText('Waiting for you');

  // colour law: cobalt only inside the approval block
  const stray = await card.evaluate((root) => {
    const near = (c: string) => {
      const m = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
      if (m.length < 3 || (m.length > 3 && m[3] === 0)) return false;
      const [r, g, b] = m;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === 0 || (max - min) / max < 0.35) return false;
      let h = 0;
      const d = max - min;
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      return Math.abs(h * 60 - 226) <= 25;
    };
    const bad: string[] = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.ic-needs')) continue;
      const s = getComputedStyle(el);
      for (const prop of [
        'color',
        'backgroundColor',
        'borderTopColor',
        'borderLeftColor',
      ] as const) {
        if (near(s[prop])) bad.push(`${el.tagName}.${el.className} ${prop}=${s[prop]}`);
      }
    }
    return bad;
  });
  expect(stray).toEqual([]);
  expect(await needs.evaluate((el) => getComputedStyle(el).borderLeftColor)).toBe(
    'rgb(47, 91, 234)',
  );

  // cleared once the scholar moves on: the block goes, the card stays
  await expect(needs).toHaveCount(0, { timeout: 20_000 });
});

test('hovering a scholar shows a one-line peek and a pointer; nothing opens, nothing moves', async ({
  page,
}) => {
  await openHall(page);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__diwan?.figures?.() ?? [])).some((f) => f.inFrame),
      { timeout: 20_000 },
    )
    .toBe(true);
  const target = (await page.evaluate(() => window.__diwan?.figures?.() ?? [])).find(
    (f) => f.inFrame,
  )!;
  const peek = page.locator('.peek');
  await expect
    .poll(
      async () => {
        const f = (await page.evaluate(() => window.__diwan?.figures?.() ?? [])).find(
          (g) => g.id === target.id,
        )!;
        await page.mouse.move(f.x - 3, f.y - 3);
        await page.mouse.move(f.x, f.y);
        await page.waitForTimeout(120);
        return peek.count();
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  expect((await peek.innerText()).length).toBeLessThanOrEqual(60);
  expect(await page.evaluate(() => document.querySelector('canvas')!.style.cursor)).toBe('pointer');
  await expect(page.locator('.inspect-card')).toHaveCount(0);

  await page.mouse.move(4, 400);
  await page.mouse.move(6, 402);
  await expect(peek).toHaveCount(0);
});
