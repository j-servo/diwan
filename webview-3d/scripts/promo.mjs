// Offline promo render: npm run promo -- --cut main --format landscape|portrait|both
//   [--no-build] [--keep] [--fast]            --fast = quarter-length smoke run
//   --preview 0:3,0:10,1:12  --format portrait   a contact sheet of those frames only (seg:second)
//
// Steps the page's engine clock frame by frame (src/promo/PromoRig.tsx, window.__promo), shoots each
// frame with Playwright and encodes H.264 (promo-encode.swift). The demo only; nothing live is read.
// Output: docs/superpowers/promo/diwan-<cut>-<format>.mp4 and ...-contact.jpg
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CUTS } from '../src/promo/cuts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.resolve(root, '../docs/superpowers/promo');
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1350] };

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? dflt : (args[i + 1] ?? true);
};
const cutId = opt('cut', 'main');
const formatArg = opt('format', 'landscape');
const formats = formatArg === 'both' ? ['landscape', 'portrait'] : [formatArg];
const cut = CUTS[cutId];
if (!cut) throw new Error(`unknown cut ${cutId}; known: ${Object.keys(CUTS).join(', ')}`);
for (const f of formats) if (!SIZES[f]) throw new Error(`unknown format ${f}`);
const fast = args.includes('--fast');
const preview = opt('preview', null);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-promo-'));
const tmpHome = path.join(tmp, 'home');
fs.mkdirSync(tmpHome);
const dist = path.join(tmp, 'dist');
const realBrowsers =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(os.homedir(), 'Library/Caches/ms-playwright');
const childEnv = { ...process.env, HOME: tmpHome };

function run(cmd, a, o = {}) {
  return execFileSync(cmd, a, { stdio: ['ignore', 'inherit', 'inherit'], ...o });
}

if (!args.includes('--no-build') || !fs.existsSync(dist)) {
  console.log('building the page ...');
  // a private build dir: the running diwan serves ../dist and must not be touched
  run('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir'], { cwd: root, env: childEnv });
}

const port = 4180 + Math.floor(Math.random() * 100);
const server = spawn(
  'npx',
  [
    'vite',
    'preview',
    '--outDir',
    dist,
    '--port',
    String(port),
    '--strictPort',
    '--host',
    '127.0.0.1',
  ],
  { cwd: root, env: childEnv, stdio: 'ignore' },
);
const base = `http://127.0.0.1:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 60) throw new Error('preview server did not start');
  await new Promise((r) => setTimeout(r, 500));
}

const gpuArgs =
  process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    : [];
process.env.PLAYWRIGHT_BROWSERS_PATH = realBrowsers;
const browser = await chromium.launch({ args: gpuArgs, env: childEnv });

async function openSegment(format, seg) {
  const [w, h] = SIZES[format];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}/?demo=1&promo=${cutId}&world=${seg.world}&quality=high&mood=golden`);
  await page.waitForFunction(() => window.__diwan?.world().loaded && window.__promo, null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__promo.begin());
  await page.waitForFunction(() => (window.__diwan?.world().figures ?? 0) >= 3, null, {
    timeout: 30_000,
  });
  // let React finish mounting figures, then settle shadows and lightmaps with a few frames
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  return { ctx, page, errors };
}

const settle = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function renderSegment(format, seg, index) {
  const dir = path.join(tmp, format, String(index));
  fs.mkdirSync(dir, { recursive: true });
  const { ctx, page, errors } = await openSegment(format, seg);
  const frames = Math.round((fast ? seg.durationSec / 4 : seg.durationSec) * cut.fps);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate(() => window.__promo.step());
    await settle(page);
    await page.screenshot({
      path: path.join(dir, `${String(i).padStart(5, '0')}.png`),
      type: 'png',
    });
    if (i % 60 === 59) {
      const s = (Date.now() - t0) / 1000;
      console.log(
        `${format} seg ${index} (${seg.world}) ${i + 1}/${frames}  ${(s / (i + 1)).toFixed(2)} s/frame`,
      );
    }
  }
  if (errors.length) console.warn('page errors:', [...new Set(errors)].slice(0, 5));
  await ctx.close();
  return { dir, frames };
}

// ffmpeg is x86_64-only on this Mac (no Rosetta), so the encode is a small AVFoundation tool
// (promo-encode.swift: H.264 High, BT.709, yuv420p, faststart, crossfade) and the sheets use OpenCV.
let encoder = null;
function encoderPath() {
  if (!encoder) {
    encoder = path.join(tmp, 'promo-encode');
    run('swiftc', ['-O', path.join(here, 'promo-encode.swift'), '-o', encoder]);
  }
  return encoder;
}

function encode(format, parts) {
  const mp4 = path.join(OUT, `diwan-${cutId}-${format}.mp4`);
  fs.mkdirSync(OUT, { recursive: true });
  const mbps = format === 'landscape' ? 14 : 12;
  run(encoderPath(), [
    mp4,
    String(cut.fps),
    String(mbps),
    String(cut.crossfadeSec),
    ...parts.map((p) => p.dir),
  ]);
  const total =
    parts.reduce((n, p) => n + p.frames, 0) -
    (parts.length - 1) * Math.round(cut.crossfadeSec * cut.fps);
  // six frames, evenly spread: a contact sheet for a quick look
  const pick = Array.from({ length: 6 }, (_, i) => Math.round(((i + 0.5) * total) / 6)).join(',');
  const w = format === 'landscape' ? 640 : 480;
  run('python3', [
    '-I',
    path.join(here, 'promo-sheet.py'),
    path.join(OUT, `diwan-${cutId}-${format}-contact.jpg`),
    '3',
    String(w),
    'video',
    mp4,
    pick,
  ]);
  console.log('wrote', mp4);
}

try {
  if (preview) {
    // seg:second pairs -> one sheet of low-cost stills for tuning the shots
    const picks = String(preview)
      .split(',')
      .map((s) => s.split(':').map(Number));
    const format = formats[0];
    const dir = path.join(tmp, 'preview');
    fs.mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const segIndex of [...new Set(picks.map((p) => p[0]))]) {
      const { ctx, page } = await openSegment(format, cut.segments[segIndex]);
      for (const [, sec] of picks.filter((p) => p[0] === segIndex).sort((a, b) => a[1] - b[1])) {
        await page.evaluate((t) => window.__promo.seek(t), sec);
        await settle(page);
        await page.screenshot({
          path: path.join(
            dir,
            `${String(picks.findIndex((p) => p[0] === segIndex && p[1] === sec)).padStart(3, '0')}.jpg`,
          ),
          type: 'jpeg',
          quality: 88,
        });
        n++;
      }
      await ctx.close();
    }
    const cols = format === 'landscape' ? 3 : 4;
    const w = format === 'landscape' ? 640 : 360;
    const sheet = path.join(OUT, `preview-${format}.jpg`);
    fs.mkdirSync(OUT, { recursive: true });
    const files = fs
      .readdirSync(dir)
      .sort()
      .map((f) => path.join(dir, f));
    run('python3', [
      '-I',
      path.join(here, 'promo-sheet.py'),
      sheet,
      String(cols),
      String(w),
      'images',
      ...files,
    ]);
    console.log('wrote', sheet);
  } else {
    for (const format of formats) {
      const parts = [];
      for (const [i, seg] of cut.segments.entries())
        parts.push(await renderSegment(format, seg, i));
      encode(format, parts);
    }
  }
} finally {
  await browser.close();
  server.kill();
  if (!args.includes('--keep')) fs.rmSync(tmp, { recursive: true, force: true });
}
