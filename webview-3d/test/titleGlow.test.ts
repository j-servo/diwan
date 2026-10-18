import { describe, expect, test } from 'vitest';

import {
  CAUSTICS_MAX,
  WATER_CEILING,
  WATER_FRAG,
  WATER_FRESNEL_MAX,
  WATER_GLINT_GAIN,
  poolNumbers,
} from '../src/world/poolWater.js';
import {
  HALO_POLYGON_OFFSET,
  TITLE_GLOW_FLOOR,
  TITLE_GLOW_PERIOD_SEC,
  TITLE_POLYGON_OFFSET,
  titleGlow,
} from '../src/world/titleGlow.js';

describe('the title breathes', () => {
  const sample = (mix: number, reduced = false) =>
    Array.from({ length: 200 }, (_, i) =>
      titleGlow((i / 200) * TITLE_GLOW_PERIOD_SEC, mix, reduced),
    );

  test('a slow sine, 4-5 s a breath, never off', () => {
    expect(TITLE_GLOW_PERIOD_SEC).toBeGreaterThanOrEqual(4);
    expect(TITLE_GLOW_PERIOD_SEC).toBeLessThanOrEqual(5);
    for (const mix of [0, 0.5, 1]) {
      const levels = sample(mix).map((g) => g.level);
      expect(Math.min(...levels)).toBeGreaterThanOrEqual(0.35 - 1e-9);
      expect(Math.max(...levels)).toBeCloseTo(1, 2);
    }
    expect(Math.min(...sample(1).map((g) => g.level))).toBeCloseTo(TITLE_GLOW_FLOOR.dusk, 2);
  });

  test('smooth and periodic: no jumps, the same value one breath later', () => {
    const a = titleGlow(1.3, 0.4, false);
    const b = titleGlow(1.3 + TITLE_GLOW_PERIOD_SEC, 0.4, false);
    expect(b.intensity).toBeCloseTo(a.intensity, 9);
    const xs = sample(0.4).map((g) => g.level);
    for (let i = 1; i < xs.length; i++) expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(0.05);
  });

  test('stronger at dusk, subtler at golden hour', () => {
    const peak = (mix: number) => Math.max(...sample(mix).map((g) => g.intensity));
    expect(peak(1)).toBeGreaterThan(peak(0) * 2);
    const halo = (mix: number) => Math.max(...sample(mix).map((g) => g.halo));
    expect(halo(1)).toBeGreaterThan(halo(0) * 2);
  });

  test('prefers-reduced-motion: a steady glow, still lit', () => {
    const xs = sample(1, true);
    expect(new Set(xs.map((g) => g.intensity)).size).toBe(1);
    expect(xs[0].intensity).toBeGreaterThan(0);
    expect(titleGlow(0, 0, true).intensity).toBeCloseTo(titleGlow(2.2, 0, true).intensity, 9);
  });
});

describe('the pool numbers the bake writes', () => {
  test('are read whole or not at all', () => {
    const ok = {
      poolCx: 15,
      poolCz: 10.5,
      poolPlinth: 2.8,
      poolCoping: 3.85,
      poolWaterY: -0.16,
      poolSunX: 0.4,
      poolSunY: 0.85,
      poolSunZ: 0.3,
    };
    expect(poolNumbers(ok)?.sun).toEqual([0.4, 0.85, 0.3]);
    expect(poolNumbers({ ...ok, poolCx: undefined })).toBeNull();
    expect(poolNumbers({})).toBeNull();
  });
});

describe('round F: no depth fighting, no white flashes', () => {
  test('the title decal is ordered lintel < title < halo in depth-buffer units', () => {
    // polygon offset units are distance-independent: more negative = nearer the camera
    expect(TITLE_POLYGON_OFFSET.units).toBeLessThanOrEqual(-2);
    expect(TITLE_POLYGON_OFFSET.factor).toBeLessThan(0);
    expect(HALO_POLYGON_OFFSET.units).toBeLessThan(TITLE_POLYGON_OFFSET.units);
    expect(HALO_POLYGON_OFFSET.factor).toBeLessThan(TITLE_POLYGON_OFFSET.factor);
  });

  test('the water can never exceed the bloom threshold (1.0): capped Fresnel, soft glint, a ceiling', () => {
    expect(WATER_FRESNEL_MAX).toBeLessThanOrEqual(0.6);
    expect(WATER_GLINT_GAIN).toBeLessThanOrEqual(0.5);
    expect(WATER_CEILING).toBeLessThan(0.85); // < 245/255 after the sRGB curve, and clear of 1.0
    expect(WATER_FRAG).toContain(
      `min(0.07 + 0.93 * pow(1.0 - ndv, 3.0), ${WATER_FRESNEL_MAX.toFixed(2)})`,
    );
    expect(WATER_FRAG).toContain(`${WATER_CEILING.toFixed(2)} / max(`);
  });

  test('the caustics are capped per pixel, far below the bloom threshold (their near-singular peaks were the flash)', async () => {
    expect(CAUSTICS_MAX).toBeLessThanOrEqual(0.4);
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../src/world/poolWater.ts', import.meta.url), 'utf8'),
    );
    expect(src).toContain('min(caus * causMask * uCausGain, ${CAUSTICS_MAX.toFixed(2)})');
  });
});
