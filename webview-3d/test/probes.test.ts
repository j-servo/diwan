import { describe, expect, it } from 'vitest';

import type { ProbeGrid } from '../src/agents/probes.js';
import { sampleProbe, shL0ToRadiance } from '../src/agents/probes.js';

// 2x2 grid, spacing 3 from origin (1.5, 1.5): sunny node (0,0) warm bright, rest shaded.
const grid: ProbeGrid = {
  origin: [1.5, 1.5],
  spacing: 3,
  nx: 2,
  nz: 2,
  data: new Float32Array([1, 0.8, 0.4, 0.2, 0.2, 0.3, 0.2, 0.2, 0.3, 0.2, 0.2, 0.3]),
};

describe('sampleProbe', () => {
  it('returns node values exactly at nodes', () => {
    expect(sampleProbe(grid, 1.5, 1.5)).toEqual([1, 0.8, 0.4].map((n) => Math.fround(n)));
  });
  it('a sunny cell and a shaded cell differ (Review Focus 2)', () => {
    const sunny = sampleProbe(grid, 1.5, 1.5);
    const shaded = sampleProbe(grid, 4.5, 4.5);
    expect(sunny[0]).toBeGreaterThan(shaded[0] * 3);
  });
  it('interpolates between nodes', () => {
    const mid = sampleProbe(grid, 3, 1.5);
    expect(mid[0]).toBeCloseTo((Math.fround(1) + Math.fround(0.2)) / 2, 5);
  });
  it('clamps outside the grid', () => {
    expect(sampleProbe(grid, -50, -50)).toEqual(sampleProbe(grid, 1.5, 1.5));
    expect(sampleProbe(grid, 99, 99)).toEqual(sampleProbe(grid, 4.5, 4.5));
  });
});

describe('shL0ToRadiance', () => {
  it("round-trips a known average radiance through three's SH normalisation", () => {
    const avgL = 0.7;
    const c0 = 4 * Math.PI * 0.282095 * avgL; // LightProbeGenerator: sum(L * Y0 * 4pi / totalWeight)
    expect(shL0ToRadiance(c0)).toBeCloseTo(avgL, 6);
  });
});
