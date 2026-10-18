import { readFileSync } from 'node:fs';

import { Color, SRGBColorSpace } from 'three';
import { describe, expect, it } from 'vitest';

import { BOARD_INK } from '../src/board/boardCanvas.js';
import { KIND_COLORS } from '../src/grammar/kindColors.js';
import { clashesWithSignal, setActiveSignal } from '../src/grammar/signal.js';
import { applyWorld } from '../src/worlds/applyWorld.js';
import { getWorld, WORLDS } from '../src/worlds/registry.js';
import type { WorldDefinition } from '../src/worlds/types.js';
import { lampColor } from '../src/world/AlcoveLamps.js';

const hsl = (hex: string) => new Color(hex).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
const gap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

const worldSignal = (w: WorldDefinition) => w.signal;

describe('"needs you" is one signal per world', () => {
  it('House of Wisdom keeps Abbasid cobalt (~226 deg), House of Life is amethyst (~295 deg)', () => {
    const how = hsl(getWorld('house-of-wisdom').signal.color);
    expect(how.h * 360).toBeGreaterThan(220);
    expect(how.h * 360).toBeLessThan(232);
    expect(how.s).toBeGreaterThan(0.7);
    expect(getWorld('house-of-wisdom').signal.color).toBe('#2f5bea');
    expect(getWorld('house-of-wisdom').signal.guardDeg).toBe(25);
    const hol = hsl(getWorld('house-of-life').signal.color);
    expect(getWorld('house-of-life').signal.color.toLowerCase()).toBe('#a21caf');
    expect(hol.h * 360).toBeGreaterThan(290);
    expect(hol.h * 360).toBeLessThan(300);
    expect(getWorld('house-of-life').signal.guardDeg).toBe(40);
  });
  it('every approval colour the runtime uses reads the active world signal', () => {
    for (const w of WORLDS) {
      setActiveSignal(w.signal);
      const lamp = lampColor('approval');
      const want = new Color(w.signal.color);
      expect(lamp[0]).toBeCloseTo(want.r, 6);
      expect(lamp[1]).toBeCloseTo(want.g, 6);
      expect(lamp[2]).toBeCloseTo(want.b, 6);
      expect(BOARD_INK.approval).toBe(w.signal.ink);
    }
    setActiveSignal(getWorld('house-of-wisdom').signal);
  });
  it('applyWorld sets the signal CSS variables and data-world on the root', () => {
    const style = new Map<string, string>();
    const root = {
      dataset: {} as Record<string, string>,
      style: { setProperty: (k: string, v: string) => style.set(k, v) },
    } as unknown as HTMLElement;
    for (const w of WORLDS) {
      applyWorld(w, root);
      expect(root.dataset.world).toBe(w.id);
      expect(style.get('--needs-you')).toBe(w.signal.color);
      expect(style.get('--needs-you-ink')).toBe(w.signal.ink);
    }
    applyWorld(getWorld('house-of-wisdom'), root);
  });
  it('the CSS defaults mirror the House of Wisdom signal and name no raw cobalt elsewhere', () => {
    const how = getWorld('house-of-wisdom').signal;
    expect(css).toContain(`--needs-you: ${how.color};`);
    expect(css).toContain(`--needs-you-ink: ${how.ink};`);
    expect(css).not.toContain('--glaze');
    expect(css.toLowerCase()).not.toContain('47, 183, 176'); // no leftover turquoise rgba
  });
  it('the approval bubble is an opaque signal fill with parchment ink, from variables only', () => {
    const rule = css.match(/\.bubble--approval \{[^}]*\}/)![0];
    expect(rule).toContain('background: var(--needs-you);');
    expect(rule).toContain('color: var(--parchment);');
    // Still the loudest element: at least 1.15x a working bubble.
    expect(Number(rule.match(/scale: ([\d.]+);/)![1])).toBeGreaterThanOrEqual(1.15);
    expect(rule).not.toMatch(/#[0-9a-f]{3,6}|rgba?\(/i);
    expect(css).not.toMatch(/47,\s*91,\s*234/); // no raw cobalt literal outside :root
  });
  it('the signal guard flags saturated colours in the band and spares greys', () => {
    const how = worldSignal(getWorld('house-of-wisdom'));
    const hol = worldSignal(getWorld('house-of-life'));
    expect(clashesWithSignal('#2f5bea', how)).toBe(true);
    expect(clashesWithSignal('#c84bd0', how)).toBe(false); // old Web magenta: fine for cobalt...
    expect(clashesWithSignal('#c84bd0', hol)).toBe(true); // ...but not for amethyst
    expect(clashesWithSignal('#8a2be2', hol)).toBe(true); // violet
    expect(clashesWithSignal('#adb5bd', hol)).toBe(false); // grey
    expect(clashesWithSignal('#6FD62A', hol)).toBe(false);
  });
});

describe("KIND_COLORS keep clear of every world's signal band", () => {
  const chromatic = Object.entries(KIND_COLORS).filter(([, hex]) => hsl(hex).s > 0.3);
  it('Web is lime #6FD62A in every world', () => {
    expect(KIND_COLORS.web).toBe('#6FD62A');
  });
  it.each(WORLDS.map((w) => [w.id, w] as const))(
    '%s: every chromatic kind is >= 40 deg from its signal',
    (_id, w) => {
      const signalHue = hsl(w.signal.color).h * 360;
      for (const [k, hex] of chromatic)
        expect(gap(hsl(hex).h * 360, signalHue), k).toBeGreaterThanOrEqual(40);
    },
  );
  it('every chromatic kind is >= 25 deg from every other', () => {
    for (const [ka, a] of chromatic)
      for (const [kb, b] of chromatic)
        if (ka < kb)
          expect(gap(hsl(a).h * 360, hsl(b).h * 360), `${ka}/${kb}`).toBeGreaterThanOrEqual(25);
  });
});
