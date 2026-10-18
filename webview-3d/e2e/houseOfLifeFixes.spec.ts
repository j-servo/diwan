// Round F (Yousef, 2026-10-19): the title no longer fragments at far camera angles, nothing flashes
// white as the camera moves, and scholars walk the whole lane round the pyramid.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

const M = 1 / 1.5; // poses are authored in metres; the scene is in tiles
type V3 = [number, number, number];

async function open(page: Page, mood: 'golden' | 'dusk') {
  // reduced motion holds the title's breathing glow steady, so only geometry can change a frame
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(
    `/?demo=1&demoSpeed=1&director=0&frames=1&world=house-of-life&mood=${mood}&figures=0`,
  );
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 40_000 })
    .toBe(true);
  await page.addStyleTag({ content: '.agent-tag, .hud, .board-panel { visibility: hidden; }' });
}

async function pose(page: Page, pos: V3, target: V3, fov: number) {
  const ok = await page.evaluate(
    ([p, t, f]) => window.__diwan!.cameraPose!(p as V3, t as V3, f as number),
    [pos.map((v) => v * M), target.map((v) => v * M), fov],
  );
  expect(ok).toBe(true);
  await page.waitForTimeout(300);
}

async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.screenshot({ type: 'png' }));
}

const luma = (p: PNG, i: number) =>
  0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;

test.use({ viewport: { width: 1440, height: 900 } });

// The title sits on the lintel in metres: x 14.1-15.9, y 3.30-4.40, z 4.976 (6 mm proud)
const TITLE: V3 = [15, 3.85, 4.976];

/** Mean luma change inside the title's box when the camera moves by a hair: depth fighting
 *  reshuffles which surface wins every pixel, a stable decal does not move. */
async function titleSpeckle(page: Page, pos: V3): Promise<number> {
  await pose(page, pos, TITLE, 12);
  const a = await shot(page);
  const corners = [
    [-0.8, -0.55],
    [0.8, -0.55],
    [0.8, 0.55],
    [-0.8, 0.55],
  ].map(([dx, dy]) => [TITLE[0] + dx!, TITLE[1] + dy!, TITLE[2]]);
  const projected = await page.evaluate(
    (cs) => cs.map((c) => window.__diwan!.project!(c!.map((v) => v / 1.5) as V3)),
    corners,
  );
  expect(projected.every(Boolean)).toBe(true);
  const xs = projected.map((q) => q!.x);
  const ys = projected.map((q) => q!.y);
  const [x0, x1] = [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs))];
  const [y0, y1] = [Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))];
  await pose(page, [pos[0] + 0.013, pos[1] + 0.004, pos[2] + 0.009], TITLE, 12);
  const b = await shot(page);
  let diff = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      diff += Math.abs(luma(a, i) - luma(b, i));
      n++;
    }
  return diff / n;
}

// Poses that z-fought before the fix, at the orbit's far limit and a little inside it
// (radius m, elevation deg, azimuth deg from the south): one per failing family
const TITLE_POSES: [number, number, number][] = [
  [72, 3, -60],
  [72, 3, -30],
  [72, 3, 30],
  [72, 25, 0],
  [72, 25, 30],
  [72, 25, -30],
  [60, 3, -30],
  [60, 25, 0],
];

for (const mood of ['golden', 'dusk'] as const) {
  test(`House of Life: the title never fragments, ${mood} (no depth fighting at any distance)`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await open(page, mood);
    const worst: string[] = [];
    for (const [r, el, az] of TITLE_POSES) {
      const e = (el * Math.PI) / 180;
      const a = (az * Math.PI) / 180;
      const pos: V3 = [
        TITLE[0] + r * Math.sin(a) * Math.cos(e),
        TITLE[1] + r * Math.sin(e),
        TITLE[2] + r * Math.cos(a) * Math.cos(e),
      ];
      const s = await titleSpeckle(page, pos);
      worst.push(`r${r} e${el} a${az}: ${s.toFixed(2)}`);
      expect(s, `r${r} e${el} a${az}`).toBeLessThan(TITLE_SPECKLE_MAX);
    }
    console.log(`title speckle, ${mood}:`, worst.join(' | '));
  });
}
// Mean luma change in the title box under a 1.6 cm camera nudge: a steady decal sits at ~0.1;
// before round F the same poses measured 1 to 11 (golden) and 0.5 to 4 (dusk).
const TITLE_SPECKLE_MAX = 0.5;

test('House of Life: nothing flashes white as the camera orbits (golden)', async ({ page }) => {
  test.setTimeout(240_000);
  await open(page, 'golden');
  const T: V3 = [15, 2.2, 12.0];
  const rings: [number, number][] = [
    [14, 2],
    [14, 7],
    [14, 11],
    [20, 14],
  ];
  const frames: { label: string; frac: number }[] = [];
  for (const [r, h] of rings)
    for (let az = 0; az < 360; az += 12) {
      const a = (az * Math.PI) / 180;
      await pose(page, [T[0] + r * Math.sin(a), h, T[2] + r * Math.cos(a)], T, 38);
      const p = await shot(page);
      let white = 0;
      for (let i = 0; i < p.data.length; i += 4) if (luma(p, i) > 245) white++;
      frames.push({ label: `r${r} h${h} a${az}`, frac: white / (p.width * p.height) });
    }
  const worst = [...frames].sort((a, b) => b.frac - a.frac).slice(0, 3);
  console.log('near-white fraction, worst frames:', JSON.stringify(worst));
  expect(worst[0]!.frac, worst[0]!.label).toBeLessThan(WHITE_MAX);
  // and no frame-to-frame jump: a flash is a sudden appearance
  let jump = 0;
  for (let i = 1; i < frames.length; i++)
    if (frames[i]!.label.split(' ')[0] === frames[i - 1]!.label.split(' ')[0])
      jump = Math.max(jump, Math.abs(frames[i]!.frac - frames[i - 1]!.frac));
  console.log('largest frame-to-frame change in the near-white fraction:', jump);
  expect(jump).toBeLessThan(WHITE_JUMP_MAX);
});
// Before round F the orbit reached 2.1% of the frame near-white (the caustics' unbounded peaks,
// blooming); now a handful of pixels at most.
const WHITE_MAX = 0.0001;
const WHITE_JUMP_MAX = 0.0001;

test('House of Life: a scholar walks the whole lane round the pyramid, and never into the pool', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // the director on (no director=0): its first circuit starts once it has run 30 s
  await page.goto('/?demo=1&demoSpeed=2&world=house-of-life');
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 60_000 })
    .toBe(true);
  const inPool = (c: number, r: number) => c >= 7 && c <= 12 && r >= 5 && r <= 10;
  const onLane = (c: number, r: number) => c >= 6 && c <= 13 && r >= 4 && r <= 11 && !inPool(c, r);
  const corners = ['6,4', '13,4', '13,11', '6,11'];
  const seen = new Map<number, Set<string>>();
  const hits: string[] = [];
  let circuit: number | null = null;
  for (let i = 0; i < 700 && circuit === null; i++) {
    for (const c of await page.evaluate(() => window.__diwan!.snapshot())) {
      if (inPool(c.col, c.row)) hits.push(`${c.id}@${c.col},${c.row}`);
      if (!onLane(c.col, c.row)) continue;
      const set = seen.get(c.id) ?? new Set<string>();
      set.add(`${c.col},${c.row}`);
      seen.set(c.id, set);
      // all four corners and nearly every one of the lane's 28 tiles: one scholar, all the way round
      if (corners.every((k) => set.has(k)) && set.size >= 26) circuit = c.id;
    }
    await page.waitForTimeout(250);
  }
  expect(hits).toEqual([]);
  expect(circuit, 'a scholar completed the circuit').not.toBeNull();
});
