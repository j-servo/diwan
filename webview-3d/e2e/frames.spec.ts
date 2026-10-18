import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Look-dev frames for docs/superpowers/m1. On demand only: `npm --workspace webview-3d run frames`.
// Camera poses come from window.__diwan.camera (src/scene/DebugBridge.tsx).
// DIWAN_WORLD=<id> shoots another world; DIWAN_FRAMES_OUT=<dir> writes somewhere else (the
// default is the committed House of Wisdom set).
const WORLD = process.env['DIWAN_WORLD'] ?? '';
const OUT =
  process.env['DIWAN_FRAMES_OUT'] ??
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../docs/superpowers/m1/img',
    WORLD && WORLD !== 'house-of-wisdom' ? WORLD : '.',
  );
const BASE = `/?demo=1&demoSpeed=1&director=0&frames=1${WORLD ? `&world=${WORLD}` : ''}`;
// The House of Life's look-dev stills (E2) go to docs/superpowers/world2/img/ instead.
const HOL = WORLD === 'house-of-life';
const HOL_OUT =
  process.env['DIWAN_FRAMES_OUT'] ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/superpowers/world2/img');
const HIDE_UI = '.agent-tag, .hud, .board-panel { visibility: hidden; }';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(240_000);

async function open(page: Page, mood: 'golden' | 'dusk') {
  await page.goto(`${BASE}&mood=${mood}`);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().figures ?? 0), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(3);
}

async function frame(
  page: Page,
  file: string,
  pose?: Parameters<NonNullable<Window['__diwan']>['camera']>,
  dir: string = OUT,
) {
  if (pose) {
    expect(await page.evaluate((p) => window.__diwan?.camera(...p), pose)).toBe(true);
  }
  await page.waitForTimeout(1500); // shadows, lightmap fade-in and the tilt-shift spring settle
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 90 });
}

// The House of Life's stills (A2): golden and dusk wide, the pyramid, the facade, the reliefs and
// the Architects' chamber, all with the Egyptian figures (round B's costumes).
test('House of Life look-dev stills @frames', async ({ page }) => {
  test.skip(!HOL, 'DIWAN_WORLD=house-of-life only');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const look = async (mood: 'golden' | 'dusk', figures: boolean) => {
    await page.goto(`${BASE}&mood=${mood}${figures ? '' : '&figures=0'}`);
    await expect
      .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__diwan?.world().figures ?? 0), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);
    await page.addStyleTag({ content: HIDE_UI });
  };
  // A2: every still with the Egyptian figures (demo mode)
  await look('golden', true);
  await frame(page, 'hol-1-golden-wide.jpg', ['wide'], HOL_OUT);
  await frame(page, 'hol-3-pyramid-close.jpg', ['pyramid'], HOL_OUT);
  await frame(page, 'hol-5-facade-close.jpg', ['facade'], HOL_OUT);
  await frame(page, 'hol-6-wall-close.jpg', ['wall'], HOL_OUT);
  await frame(page, 'hol-4-architects-chamber.jpg', ['architects'], HOL_OUT);
  // round C: the water close, the glowing title and an obelisk, for the controller's review
  const proc = path.join(HOL_OUT, 'process');
  await frame(page, 'c-water-1.jpg', ['water'], proc);
  await frame(page, 'hol-3b-title-golden.jpg', ['title'], proc);
  await frame(page, 'c-obelisk-wide.jpg', ['wide'], proc);
  await look('dusk', true);
  await frame(page, 'hol-2-dusk-wide.jpg', ['wide'], HOL_OUT);
  await frame(page, 'c-water-2.jpg', ['water'], proc);
  await frame(page, 'c-title-glow.jpg', ['title'], proc);
  await frame(page, 'hol-3c-pyramid-dusk.jpg', ['pyramid'], proc);
  expect(errors).toEqual([]);
});

test('look-dev frames @frames', async ({ page }) => {
  test.skip(HOL, 'the House of Life shoots its own stills');
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await open(page, 'golden');
  await page.addStyleTag({ content: HIDE_UI });

  await frame(page, 'frame-1-golden-wide.jpg', ['wide']);
  await frame(page, 'frame-4-gobo.jpg', ['gobo']);
  await frame(page, 'frame-5-materials.jpg', ['material']);
  await frame(page, 'frame-8-armillary.jpg', ['armillary']);

  // Alcove A/B: the same seat, in the approval (B) and then idle again (A).
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.approvalLamp() ?? null), { timeout: 40_000 })
    .not.toBeNull();
  const seat = (await page.evaluate(() => window.__diwan?.approvalLamp()))!.seat;
  await frame(page, 'frame-3-alcove-b-approval.jpg', ['alcove', seat]);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.approvalLamp() ?? null), { timeout: 40_000 })
    .toBeNull();
  await frame(page, 'frame-3-alcove-a-idle.jpg', ['alcove', seat]);

  // Idle life: scholars at points of interest, mid idle interlude (~62 s; timeline.ts beats).
  await page.goto(`${BASE}&mood=golden`);
  const t0 = Date.now();
  await page.addStyleTag({ content: HIDE_UI });
  await page.waitForTimeout(Math.max(0, 62_000 - (Date.now() - t0)));
  await page.screenshot({
    path: path.join(OUT, 'frame-7-idle-life.jpg'),
    type: 'jpeg',
    quality: 90,
  });

  // UI: bubbles and the compact apprentice tag, DOM overlays on. A fresh page,
  // because the demo is a loop: wait for the moment a working, an approval and a waiting bubble
  // plus an apprentice tag are all in the framed view (about 18 s in).
  await open(page, 'golden');
  expect(await page.evaluate(() => window.__diwan?.camera?.('ui'))).toBe(true);
  const inView = (sel: string) =>
    page.evaluate((q) => {
      return [...document.querySelectorAll(q)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left > 0 && r.right < innerWidth && r.top > 0 && r.bottom < innerHeight;
      }).length;
    }, sel);
  await expect
    .poll(
      async () =>
        (await inView('.bubble--approval')) >= 1 &&
        (await inView('.bubble--working')) >= 1 &&
        (await inView('.agent-tag--compact')) >= 1,
      { timeout: 60_000, intervals: [250] },
    )
    .toBe(true);
  await frame(page, 'frame-6-ui-bubbles.jpg');

  await open(page, 'dusk');
  await page.addStyleTag({ content: HIDE_UI });
  await frame(page, 'frame-2-dusk-wide.jpg', ['wide']);

  expect(errors).toEqual([]);
});
