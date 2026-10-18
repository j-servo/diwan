import { describe, expect, it } from 'vitest';

import {
  defaultPose,
  figurePixelHeight,
  framingDistance,
  stepSpring,
  stepSpring3,
} from '../src/camera/focus.js';

describe('stepSpring', () => {
  it('converges without overshoot from rest', () => {
    let s = { value: 0, velocity: 0 };
    let prev = 0;
    for (let i = 0; i < 60 * 5; i++) {
      s = stepSpring(s, 10, 1 / 60, 6);
      expect(s.value).toBeGreaterThanOrEqual(prev);
      expect(s.value).toBeLessThanOrEqual(10 + 1e-9);
      prev = s.value;
    }
    expect(s.value).toBeCloseTo(10, 3);
    expect(Math.abs(s.velocity)).toBeLessThan(1e-2);
  });
  it('is frame-rate independent', () => {
    let a = { value: 0, velocity: 0 };
    let b = { value: 0, velocity: 0 };
    for (let i = 0; i < 60; i++) a = stepSpring(a, 1, 1 / 60, 5);
    for (let i = 0; i < 30; i++) b = stepSpring(b, 1, 1 / 30, 5);
    expect(a.value).toBeCloseTo(b.value, 6);
  });
  it('stays put at the target', () => {
    const s = stepSpring({ value: 3, velocity: 0 }, 3, 0.1, 5);
    expect(s).toEqual({ value: 3, velocity: 0 });
  });
  it('steps vectors per axis', () => {
    const s = stepSpring3({ value: [0, 0, 0], velocity: [0, 0, 0] }, [1, 2, 3], 1 / 60, 6);
    expect(s.value[2]).toBeGreaterThan(s.value[0]);
  });
});

describe('defaultPose', () => {
  it('centres on the given point with a finite focus distance', () => {
    const p = defaultPose([5, 0, 7], 20);
    expect(p.target).toEqual([5, 0, 7]);
    expect(p.focusDistance).toBe(20);
  });
});

describe('framing', () => {
  it('framingDistance gives the requested on-screen height at the 22 degree lens', () => {
    const d = framingDistance(1.1, 190, 900, 22);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(18);
    expect(figurePixelHeight(1.1, d, 900, 22)).toBeCloseTo(190, 6);
  });
  it('is nearer for taller on-screen targets', () => {
    expect(framingDistance(1.1, 220, 900, 22)).toBeLessThan(framingDistance(1.1, 160, 900, 22));
  });
});
