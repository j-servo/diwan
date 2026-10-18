import { describe, expect, it } from 'vitest';

import { headingTowards, smoothPosition } from '../src/agents/pathSmoothing.js';

describe('smoothPosition', () => {
  it('converges without overshoot', () => {
    let p: [number, number] = [0, 0];
    for (let i = 0; i < 600; i++) {
      p = smoothPosition(p, [3, -2], 1 / 60, 8) as [number, number];
      expect(p[0]).toBeLessThanOrEqual(3);
      expect(p[1]).toBeGreaterThanOrEqual(-2);
    }
    expect(p[0]).toBeCloseTo(3, 3);
    expect(p[1]).toBeCloseTo(-2, 3);
  });
  it('clamps large dt and never overshoots', () => {
    const p = smoothPosition([0, 0], [1, 0], 100, 50);
    expect(p[0]).toBeLessThanOrEqual(1);
    expect(smoothPosition([0, 0], [1, 0], 100, 5)).toEqual(smoothPosition([0, 0], [1, 0], 0.1, 5));
  });
});

describe('headingTowards', () => {
  const lim = (540 * Math.PI) / 180;
  it('takes the shortest arc', () => {
    // target yaw -170deg, from +170deg: shortest is +20deg through 180
    const to: [number, number] = [
      Math.sin((-170 * Math.PI) / 180),
      Math.cos((-170 * Math.PI) / 180),
    ];
    expect(headingTowards([0, 0], to, (170 * Math.PI) / 180, 0.016)).toBeGreaterThan(
      (170 * Math.PI) / 180,
    );
  });
  it('is rate limited to 540 deg/s', () => {
    const y = headingTowards([0, 0], [-1, 0], 0, 0.05);
    expect(Math.abs(y)).toBeCloseTo(lim * 0.05, 6);
  });
  it('reaches the target and stays', () => {
    const y = headingTowards([0, 0], [1, 0], Math.PI / 2 - 0.01, 0.05);
    expect(y).toBeCloseTo(Math.PI / 2, 6);
  });
  it('keeps yaw when there is no direction', () => {
    expect(headingTowards([1, 1], [1, 1], 0.7, 0.05)).toBe(0.7);
  });
});
