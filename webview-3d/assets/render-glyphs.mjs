#!/usr/bin/env node
// Renders the House of Wisdom's shaped Arabic lettering and the J. Servo logo to PNGs with
// headless Chromium. Blender's text objects cannot shape Arabic (letters come out disconnected
// or reversed); the browser's shaper (HarfBuzz) joins them correctly. No network.
//
//   node assets/render-glyphs.mjs
//
// Writes, under worlds/house-of-wisdom/src/ (committed, so the exact lettering is reviewable):
//   kufic_bayt_al_hikma.png      white ink on transparent, tight to the ink plus PAD
//   jservo-mark-flat.png         the J. Servo mark SVG, fitted and centred in a square 1472 px canvas,
//                                transparent (2x the 736 px it takes on the panel field)
// hall_dressing.py turns them into the inscription relief and the logo panel.
//
// The font is read from disk and loaded explicitly, so a missing font fails here instead of
// silently falling back to another typeface. It is Reem Kufi (SIL OFL 1.1, vendored with its
// licence in assets/fonts/); only the rendered pixels are baked into the hall. Every Arabic string is listed in
// docs/superpowers/arabic-strings.md.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const SRC = join(dirname(fileURLToPath(import.meta.url)), 'worlds', 'house-of-wisdom', 'src');

const KUFIC = {
  out: 'kufic_bayt_al_hikma.png',
  // Bayt al-Hikma, drawn out with kashida (tatweel, U+0640) in the manner of a wide Kufic
  // inscription: two in بيت (between ي and ت), four in الحكمة (between ك and م).
  text: 'بيــت الحكــــمة',
  font: join(dirname(fileURLToPath(import.meta.url)), 'fonts', 'ReemKufi-wght.ttf'),
  weight: 600, // SemiBold: strong enough to carry as relief at the default camera, counters of م and ة stay open
  px: 800,
};
const LOGO = { svg: 'jservo-mark-flat.svg', out: 'jservo-mark-flat.png', side: 1472 };
const PAD = 24; // px of clear border around the ink, so contours close inside the image

function pngFromDataUrl(url, path) {
  writeFileSync(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log(`wrote ${path}`);
}

if (!existsSync(KUFIC.font)) throw new Error(`font not found: ${KUFIC.font}`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="ar" dir="rtl"><body></body></html>');

  const kufic = await page.evaluate(
    async ({ text, fontB64, weight, px, pad }) => {
      const bytes = Uint8Array.from(atob(fontB64), (c) => c.charCodeAt(0));
      const face = new FontFace('ReemKufiFile', bytes.buffer, { weight: '400 700' });
      await face.load(); // rejects if the file is not a usable font
      document.fonts.add(face);
      const font = `${weight} ${px}px ReemKufiFile`;
      const probe = document.createElement('canvas').getContext('2d');
      probe.font = font;
      probe.direction = 'rtl';
      const m = probe.measureText(text);
      const c = document.createElement('canvas');
      c.width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + 2 * pad;
      c.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 2 * pad;
      const ctx = c.getContext('2d');
      ctx.font = font;
      ctx.direction = 'rtl';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
      return { url: c.toDataURL('image/png'), w: c.width, h: c.height, status: face.status };
    },
    {
      text: KUFIC.text,
      fontB64: readFileSync(KUFIC.font).toString('base64'),
      weight: KUFIC.weight,
      px: KUFIC.px,
      pad: PAD,
    },
  );
  if (kufic.status !== 'loaded') throw new Error(`Reem Kufi did not load (${kufic.status})`);
  pngFromDataUrl(kufic.url, join(SRC, KUFIC.out));
  console.log(`kufic ${kufic.w}x${kufic.h} px`);

  const logo = await page.evaluate(
    async ({ svg, side }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${svg}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = side;
      c.height = side;
      // the mark is near-square (800 x 795): fit it, centred, so the panel gets a true square
      const k = side / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      c.getContext('2d').drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      return { url: c.toDataURL('image/png'), w: side, h: side };
    },
    { svg: readFileSync(join(SRC, LOGO.svg)).toString('base64'), side: LOGO.side },
  );
  pngFromDataUrl(logo.url, join(SRC, LOGO.out));
  console.log(`logo ${logo.w}x${logo.h} px`);
} finally {
  await browser.close();
}
