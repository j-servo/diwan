import { describe, expect, it } from 'vitest';

import { FILL_MAX, FILL_MIN, figureFill } from '../src/agents/probeStore.js';

describe('figureFill', () => {
  it('never lets shade drop below the legibility floor', () => {
    const f = figureFill([0.001, 0.001, 0.001], 1);
    expect(f.envScale).toBe(FILL_MIN);
    expect(FILL_MIN).toBeGreaterThanOrEqual(0.85);
    expect(f.lift).toBeGreaterThan(0);
  });
  it('caps sunny cells so figures do not blow out, and drops the lift', () => {
    const f = figureFill([50, 50, 50], 1);
    expect(f.envScale).toBe(FILL_MAX);
    const shade = figureFill([0.01, 0.01, 0.01], 1);
    expect(f.lift).toBeLessThan(shade.lift);
  });
  it('tints the lift by the probe colour', () => {
    const f = figureFill([2, 1, 0.5], 1);
    expect(f.tint[0]).toBeGreaterThan(f.tint[2]);
  });
});
