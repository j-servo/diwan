import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * Hue (deg) and saturation (HSV) of the most saturated cobalt-ish pixel in a (2r+1)^2 window of a
 * PNG: the lamp's core, not its blended halo. Falls back to the most saturated pixel of any hue.
 */
function windowHueSat(png: PNG, cx: number, cy: number, r: number) {
  let best = { hue: 0, sat: -1, val: 0, cobalt: false };
  for (let y = Math.max(0, cy - r); y <= Math.min(png.height - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(png.width - 1, cx + r); x++) {
      const i = (y * png.width + x) * 4;
      const [R, G, B] = [png.data[i] / 255, png.data[i + 1] / 255, png.data[i + 2] / 255];
      const max = Math.max(R, G, B);
      const d = max - Math.min(R, G, B);
      let h = 0;
      if (d > 0) {
        if (max === R) h = ((G - B) / d + 6) % 6;
        else if (max === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
      }
      const hue = h * 60;
      const sat = max === 0 ? 0 : d / max;
      const cobalt = hue >= 210 && hue <= 242;
      if (Number(cobalt) > Number(best.cobalt) || (cobalt === best.cobalt && sat > best.sat)) {
        best = { hue, sat, val: max, cobalt };
      }
    }
  }
  return best;
}

test('demo build renders the world and plays the agent grammar', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?demo=1&demoSpeed=1&director=0&mood=golden&frames=1');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // The baked hall loads and skinned figures stand in it.
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().figures ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);

  const snapshot = () => page.evaluate(() => window.__diwan?.snapshot() ?? []);
  await expect
    .poll(async () => (await snapshot()).length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);
  await expect
    .poll(async () => (await snapshot()).some((c) => c.isSubagent), { timeout: 20_000 })
    .toBe(true);
  await expect
    .poll(async () => (await snapshot()).some((c) => c.signal === 'permission'), {
      timeout: 20_000,
    })
    .toBe(true);

  // Speech bubbles with the three-dot busy indicator, and the message board.
  await expect(page.locator('.bubble-dots').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.board-panel')).toContainText('needs your approval', {
    timeout: 20_000,
  });

  // The on-screen panel carries the plain text.
  await expect(page.locator('.board-panel')).toContainText('joined', { timeout: 20_000 });

  // The House of Wisdom has no in-world board for now (world.board is null): nothing mounts, so
  // nothing is ever drawn or bound, however many feed lines arrive.
  expect(await page.evaluate(() => window.__diwan?.board())).toEqual({
    entries: [],
    version: 0,
    bound: false,
  });

  // Not blank: a rendered scene has many distinct colours.
  const png = PNG.sync.read(await canvas.screenshot());
  const colours = new Set<number>();
  for (let i = 0; i < png.data.length; i += 4 * 97) {
    colours.add((png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2]);
  }
  expect(colours.size).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('the approval lamp reads cobalt on screen after post', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/?demo=1&demoSpeed=1&director=0&mood=golden&frames=1');
  // DOM overlays (name tags, HUD) would sit on top of the lamp in the screenshot.
  await page.addStyleTag({ content: '.agent-tag, .hud, .board-panel { visibility: hidden; }' });
  const canvas = page.locator('canvas');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);

  // Which desk asks for approval is not fixed (the seats are dealt differently every run), and from
  // the wide shot a lamp is not always seen: one hangs behind a palm frond, another against the
  // bright back wall, where a fixed-pixel sample lands on foliage or cream (the old flake, about two
  // runs in three). So the test frames the asking lamp up close with the look-dev alcove pose,
  // waits for it to be lit (the scene reports it asking), then samples at its projected position.
  // The approval lasts 14-22 s of the demo loop (8 s at 1x).
  let result = 'probe broken: no in-frame approval lamp seen';
  await expect
    .poll(
      async () => {
        const asking = await page.evaluate(() => window.__diwan?.approvalLamps?.() ?? []);
        if (asking.length === 0) return result;
        const seat = asking[0].seat;
        const framed = await page.evaluate(
          (s) => window.__diwan?.camera?.('alcove', s) ?? false,
          seat,
        );
        if (!framed) return result;
        await page.waitForTimeout(300); // a few frames at the new pose
        const lamp = (await page.evaluate(() => window.__diwan?.approvalLamps?.() ?? [])).find(
          (l) => l.seat === seat,
        );
        if (!lamp) return result; // the approval ended meanwhile: wait for the next one
        if (!lamp.inFrame) {
          result = `lamp of ${seat} is out of frame at the alcove pose`;
          return result;
        }
        const shot = PNG.sync.read(await canvas.screenshot());
        const size = await page.evaluate(() => {
          const c = document.querySelector('canvas')!;
          return { width: c.clientWidth, height: c.clientHeight };
        });
        const scale = shot.width / size.width; // device pixels per CSS pixel
        const still = await page.evaluate(() => window.__diwan?.approvalLamps?.() ?? []);
        if (!still.some((l) => l.seat === seat)) return result; // not lit any more
        const px = windowHueSat(
          shot,
          Math.round(lamp.x * scale),
          Math.round(lamp.y * scale),
          Math.round(5 * scale),
        );
        // Saturation AND value: dark-blue noise (low value) must not pass the hue gate.
        console.log(
          `approval lamp ${seat}: hue ${px.hue.toFixed(0)} sat ${px.sat.toFixed(2)} val ${px.val.toFixed(2)}`,
        );
        result =
          px.cobalt && px.sat > 0.35 && px.val >= 0.5
            ? 'cobalt'
            : `lamp of ${seat} found but weak: hue ${px.hue.toFixed(0)} sat ${px.sat.toFixed(2)} val ${px.val.toFixed(2)}`;
        return result;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe('cobalt');
});
