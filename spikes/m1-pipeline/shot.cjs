// THROWAWAY SPIKE SCRIPT (M1 pipeline spike, 2026-10-12).
// node spikes/m1-pipeline/shot.cjs <url> <out.png> <waitMs> [gpu|swiftshader] [dpr]
// Waits for window.__spike.done (or waitMs), screenshots at 1440x900, prints JSON.
const { chromium } = require('playwright');

(async () => {
  const [url, out, waitMs = '8000', gl = 'gpu', dpr = '1'] = process.argv.slice(2);
  const args =
    gl === 'gpu'
      ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
      : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  const browser = await chromium.launch({ args });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: Number(dpr),
  });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  const deadline = Date.now() + Number(waitMs);
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => Boolean(window.__spike && window.__spike.done));
    if (done) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(400);
  if (out !== '-') await page.screenshot({ path: out });
  const spike = await page.evaluate(() => window.__spike ?? null);
  console.log(JSON.stringify({ spike, errors: errors.slice(0, 12) }));
  await browser.close();
})();
