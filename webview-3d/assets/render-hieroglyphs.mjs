#!/usr/bin/env node
// Renders the House of Life's one line of hieroglyphs, the title 𓉐𓋹 (pr-ꜥnḫ, "House of Life":
// O1 + S34, U+13250 U+132F9; Yousef approved it 2026-10-18), with headless Chromium from the
// vendored Noto Sans Egyptian Hieroglyphs (SIL OFL 1.1, assets/fonts/). No sign is drawn by hand:
// only the font's outlines are rasterised. No network.
//
//   node assets/render-hieroglyphs.mjs
//
// Writes worlds/house-of-life/src/title_pr_ankh.png (committed, so the exact signs are
// reviewable): white ink on transparent, tight to the ink plus PAD. The Noto signs face left, so
// the row reads left to right, the way it is set here. temple_textures.py carves it as sunk
// relief with a blue fill on the facade lintel.
//
// The font draws every sign as a thin double outline (an outer contour and a hollow inset one
// inside each stroke), so a plain fillText leaves hairlines: the house sign O1 reads as an empty
// box. A carver cuts the whole sign, so the thin hollow inside each stroke is filled (a
// morphological closing): nothing outside the font's own strokes is added, and the real openings
// stay open (the house's interior, through its doorway; the ankh's loop).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'worlds', 'house-of-life', 'src');
const FONT = join(HERE, 'fonts', 'NotoSansEgyptianHieroglyphs-Regular.ttf');
const TITLE = { text: '\u{13250}\u{132F9}', out: 'title_pr_ankh.png', px: 640, gap: 0.12, R: 28 };
// The pyramid's frieze (round E, Yousef 2026-10-18): ankh S34, djed R11, was S40 (life, stability,
// dominion), one tile of the repeating band. Only these three signs, no name, no other text.
const FRIEZE = {
  text: '\u{132F9}\u{132BD}\u{13300}',
  out: 'frieze_signs.png',
  px: 640,
  gap: 0.3,
  R: 34,
  signR: [34, 12, 34],
  fillHoles: [false, true, false],
  minFill: 1.1,
};
const PAD = 24;

if (!existsSync(FONT)) throw new Error(`font not found: ${FONT}`);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="egy"><body></body></html>');
  for (const job of [TITLE, FRIEZE]) {
    const r = await page.evaluate(
      async ({ text, fontB64, px, gap, pad, R, signR, fillHoles }) => {
        const bytes = Uint8Array.from(atob(fontB64), (c) => c.charCodeAt(0));
        const face = new FontFace('NotoHieroFile', bytes.buffer);
        await face.load(); // rejects if the file is not a usable font
        document.fonts.add(face);
        const font = `${px}px NotoHieroFile`;
        const probe = document.createElement('canvas').getContext('2d');
        probe.font = font;
        // one sign at a time, left to right, a small even gap between them (no quadrats: a row)
        const signs = [...text].map((s) => ({ s, m: probe.measureText(s) }));
        const widths = signs.map(({ m }) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
        const asc = Math.max(...signs.map(({ m }) => m.actualBoundingBoxAscent));
        const desc = Math.max(...signs.map(({ m }) => m.actualBoundingBoxDescent));
        const c = document.createElement('canvas');
        const g = Math.round(gap * px);
        c.width = Math.ceil(widths.reduce((a, b) => a + b, 0) + g * (signs.length - 1)) + 2 * pad;
        c.height = Math.ceil(asc + desc) + 2 * pad;
        const ctx = c.getContext('2d');
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#ffffff';
        let x = pad;
        signs.forEach(({ s, m }, i) => {
          ctx.fillText(s, x + m.actualBoundingBoxLeft, pad + asc);
          x += widths[i] + g;
        });
        // the font must have drawn real outlines: count inked pixels
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const px8 = img.data;
        const W = c.width;
        const H = c.height;
        let ink = 0;
        for (let i = 3; i < px8.length; i += 4) if (px8[i] > 128) ink++;
        // a morphological closing (square, radius R) fills every hollow narrower than 2R + 1 px, which
        // is the font's inset gap (up to ~55 px at this size), and leaves the real openings alone: the
        // house's interior (wide, and open through its doorway) and the ankh's loop
        const mask = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) mask[i] = px8[i * 4 + 3] > 128 ? 1 : 0;
        const slide = (src, horizontal, pick, R) => {
          const out = new Uint8Array(W * H);
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
              let v = pick === 'max' ? 0 : 1;
              for (let d = -R; d <= R; d++) {
                const xx = horizontal ? x + d : x;
                const yy = horizontal ? y : y + d;
                const t = xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : src[yy * W + xx];
                if (pick === 'max' ? t > v : t < v) v = t;
              }
              out[y * W + x] = v;
            }
          return out;
        };
        const closeWith = (r) =>
          slide(
            slide(slide(slide(mask, true, 'max', r), false, 'max', r), true, 'min', r),
            false,
            'min',
            r,
          );
        let closed = closeWith(R);
        if (signR) {
          // per-sign radii (the frieze's djed would lose its bars to the ankh's radius), and a sign
          // whose hollow shaft is fully enclosed gets it filled (flood from the sign's column band)
          let sx = pad;
          signs.forEach((_, i) => {
            const a = Math.max(0, Math.floor(sx - g / 2));
            const b = Math.min(W, Math.ceil(sx + widths[i] + g / 2));
            const c2 = closeWith(signR[i]);
            for (let y = 0; y < H; y++)
              for (let x = a; x < b; x++) closed[y * W + x] = c2[y * W + x];
            if (fillHoles && fillHoles[i]) {
              const seen = new Uint8Array(W * H);
              const stack = [];
              const push = (x, y) => {
                if (x < a || x >= b || y < 0 || y >= H) return;
                const k = y * W + x;
                if (seen[k] || closed[k] || mask[k]) return;
                seen[k] = 1;
                stack.push(k);
              };
              for (let y = 0; y < H; y++) {
                push(a, y);
                push(b - 1, y);
              }
              for (let x = a; x < b; x++) {
                push(x, 0);
                push(x, H - 1);
              }
              while (stack.length) {
                const k = stack.pop();
                const x = k % W;
                const y = (k - x) / W;
                push(x + 1, y);
                push(x - 1, y);
                push(x, y + 1);
                push(x, y - 1);
              }
              for (let y = 0; y < H; y++)
                for (let x = a; x < b; x++) if (!seen[y * W + x]) closed[y * W + x] = 1;
            }
            sx += widths[i] + g;
          });
        }
        let solid = 0;
        for (let i = 0; i < W * H; i++) {
          if (closed[i] || mask[i]) {
            px8[i * 4] = px8[i * 4 + 1] = px8[i * 4 + 2] = 255;
            px8[i * 4 + 3] = 255;
            solid++;
          }
        }
        ctx.putImageData(img, 0, 0);
        return { url: c.toDataURL('image/png'), w: W, h: H, ink, solid, status: face.status };
      },
      {
        text: job.text,
        fontB64: readFileSync(FONT).toString('base64'),
        px: job.px,
        gap: job.gap,
        pad: PAD,
        R: job.R,
        signR: job.signR,
        fillHoles: job.fillHoles,
      },
    );
    if (r.status !== 'loaded')
      throw new Error(`Noto Sans Egyptian Hieroglyphs did not load (${r.status})`);
    if (r.ink < 0.05 * r.w * r.h) throw new Error(`the title rendered almost no ink (${r.ink} px)`);
    if (r.solid < (job.minFill ?? 1.8) * r.ink || r.solid > 3.5 * r.ink)
      throw new Error(`the solid fill looks wrong (${r.solid} solid px from ${r.ink} outline px)`);
    writeFileSync(join(SRC, job.out), Buffer.from(r.url.slice(r.url.indexOf(',') + 1), 'base64'));
    console.log(
      `wrote ${join(SRC, job.out)} (${r.w}x${r.h} px, ${r.ink} outline px -> ${r.solid} solid)`,
    );
  }
} finally {
  await browser.close();
}
