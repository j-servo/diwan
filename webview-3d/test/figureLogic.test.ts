import { describe, expect, it } from 'vitest';

import {
  FIGURE_MAX_MPS,
  ROBE_OVERRIDES,
  TRIM_COLORS,
  followStep,
  figureNeedsFrame,
  WALK_MIN_MPS,
  stripTrackSuffix,
  stripLoaderSuffix,
  trimColor,
  walkTimeScale,
} from '../src/agents/figureLogic.js';

function hsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, l };
}

describe('loader name normalisation', () => {
  it('strips any numeric loader suffix, not just _1', () => {
    expect(stripLoaderSuffix('hips_1')).toBe('hips');
    expect(stripLoaderSuffix('prop_codex_12')).toBe('prop_codex');
    expect(stripLoaderSuffix('skirt0_lo')).toBe('skirt0_lo');
    expect(stripLoaderSuffix('hips')).toBe('hips');
  });
});

describe('stripTrackSuffix', () => {
  it('strips the suffix from the node part of a track name only', () => {
    expect(stripTrackSuffix('hips_1.quaternion')).toBe('hips.quaternion');
    expect(stripTrackSuffix('skirt0_lo_3.position')).toBe('skirt0_lo.position');
    expect(stripTrackSuffix('root.scale')).toBe('root.scale');
  });
});

describe('walkTimeScale', () => {
  it('is speed over the authored 0.8 m/s, clamped to [0.6, 1.6]', () => {
    expect(walkTimeScale(0.8)).toBeCloseTo(1);
    expect(walkTimeScale(1.1)).toBeCloseTo(1.375);
    expect(walkTimeScale(0)).toBe(0.6);
    expect(walkTimeScale(5)).toBe(1.6);
  });
});

describe('trim palette', () => {
  it('has six saturated hues, none in the cobalt band, all apart from each other', () => {
    expect(TRIM_COLORS).toHaveLength(6);
    for (const c of TRIM_COLORS) {
      const { h, s, l } = hsl(c);
      expect(s).toBeGreaterThan(0.6);
      expect(l).toBeGreaterThan(0.3);
      expect(l).toBeLessThan(0.65);
      const d = Math.abs(h - 226);
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(25); // cobalt (needs you) is hue 226
    }
    const hues = TRIM_COLORS.map((c) => hsl(c).h);
    for (let i = 0; i < hues.length; i++)
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i] - hues[j]);
        expect(Math.min(d, 360 - d)).toBeGreaterThan(20);
      }
  });
  it('wraps the palette index', () => {
    expect(trimColor(6)).toBe(TRIM_COLORS[0]);
    expect(trimColor(-1)).toBe(TRIM_COLORS[5]);
  });
});

describe('followStep', () => {
  it('caps travel speed and converges without overshoot', () => {
    let p: readonly [number, number] = [0, 0];
    const cap = FIGURE_MAX_MPS / 1.5;
    const next = followStep(p, [10, 0], 0.1, cap);
    expect(next[0]).toBeLessThanOrEqual(cap * 0.1 + 1e-9);
    for (let i = 0; i < 2000; i++) {
      p = followStep(p, [3, 2], 0.016, cap);
      expect(p[0]).toBeLessThanOrEqual(3 + 1e-9);
    }
    expect(p[0]).toBeCloseTo(3, 2);
    expect(p[1]).toBeCloseTo(2, 2);
  });
});

describe('followStep walk tail', () => {
  it('never drops below the slowest walk speed until it arrives', () => {
    const minUnits = WALK_MIN_MPS / 1.5;
    const next = followStep([0, 0], [0.05, 0], 0.016, FIGURE_MAX_MPS / 1.5);
    expect(next[0]).toBeGreaterThanOrEqual(minUnits * 0.016 - 1e-9);
    expect(next[0]).toBeLessThanOrEqual(0.05);
  });
});

describe('figureNeedsFrame', () => {
  const idle = { busy: false, accum: 0 };
  it('always asks for a frame while something visibly changes', () => {
    expect(figureNeedsFrame(true, 0, 0.016).invalidate).toBe(true);
  });
  it('throttles idle breathing to about 15 Hz', () => {
    let accum = idle.accum;
    let frames = 0;
    for (let i = 0; i < 60; i++) {
      const r = figureNeedsFrame(false, accum, 1 / 60);
      accum = r.accum;
      if (r.invalidate) frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(13);
    expect(frames).toBeLessThanOrEqual(16);
  });
});

describe('runtime robe colours obey the colour law', () => {
  const cobalt = hsl('#2f5bea').h;
  const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  it('overrides cover the two GLB materials baked in the cobalt family', () => {
    expect(Object.keys(ROBE_OVERRIDES).sort()).toEqual(['cloak', 'robe_apprentice']);
  });
  it('every override colour is a warm neutral (s < 0.35) or at least 40 deg from cobalt', () => {
    for (const [name, c] of Object.entries(ROBE_OVERRIDES))
      for (const hex of [c.base, c.sheen]) {
        const { h, s } = hsl(hex);
        expect(s < 0.35 || gap(h, cobalt) >= 40, `${name} ${hex}`).toBe(true);
        expect(s, `${name} ${hex}`).toBeLessThan(0.35);
      }
  });
  it('trims keep >= 40 deg from cobalt', () => {
    for (const hex of TRIM_COLORS) expect(gap(hsl(hex).h, cobalt), hex).toBeGreaterThanOrEqual(40);
  });
});
