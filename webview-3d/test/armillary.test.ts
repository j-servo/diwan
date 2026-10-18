import { describe, expect, test } from 'vitest';

import {
  ARMILLARY_MOTION,
  ARMILLARY_MOVING,
  armillaryAngles,
  armillaryEnvIntensity,
} from '../src/world/armillary.js';

const TURN = 2 * Math.PI;

describe('armillary motion (geocentric)', () => {
  test('everything starts at rest and moves only the cage, the sun and the moon', () => {
    expect([...ARMILLARY_MOVING]).toEqual(['cage', 'sun', 'moon']);
    expect(armillaryAngles(0)).toEqual({ cage: 0, sun: 0, moon: 0 });
  });

  test('the cage turns westward (negative about the north pole) once per 90 to 120 s', () => {
    const p = ARMILLARY_MOTION.cagePeriodSec;
    expect(p).toBeGreaterThanOrEqual(90);
    expect(p).toBeLessThanOrEqual(120);
    expect(armillaryAngles(p / 4).cage).toBeCloseTo(-TURN / 4, 9);
    expect(armillaryAngles(p / 4 + p).cage).toBeCloseTo(-TURN / 4, 9);
  });

  test('the sun runs eastward along the ecliptic, the moon eastward and faster', () => {
    const { sunPeriodSec, moonPeriodSec, cagePeriodSec } = ARMILLARY_MOTION;
    expect(sunPeriodSec).toBeGreaterThan(cagePeriodSec);
    expect(moonPeriodSec).toBeLessThan(sunPeriodSec);
    const a = armillaryAngles(10);
    expect(a.sun).toBeCloseTo((10 / sunPeriodSec) * TURN, 9);
    expect(a.moon).toBeCloseTo((10 / moonPeriodSec) * TURN, 9);
    expect(a.moon).toBeGreaterThan(a.sun);
  });

  test('smooth and continuous: small steps move every part a little, and it is deterministic', () => {
    for (let t = 0; t < 400; t += 7.3) {
      const a = armillaryAngles(t);
      const b = armillaryAngles(t + 1 / 60);
      for (const k of ARMILLARY_MOVING) {
        // angles wrap at a full turn; compare on the circle
        const d = Math.atan2(Math.sin(b[k] - a[k]), Math.cos(b[k] - a[k]));
        expect(Math.abs(d)).toBeGreaterThan(0);
        expect(Math.abs(d)).toBeLessThan(0.01);
      }
      expect(armillaryAngles(t)).toEqual(a);
    }
  });

  test('angles stay bounded however long the hall runs', () => {
    const a = armillaryAngles(1e7);
    for (const k of ARMILLARY_MOVING) expect(Math.abs(a[k])).toBeLessThanOrEqual(TURN);
  });

  test('the brass environment dims from golden to dusk, never to black', () => {
    const golden = armillaryEnvIntensity(0);
    const dusk = armillaryEnvIntensity(1);
    expect(golden).toBeGreaterThan(dusk);
    expect(dusk).toBeGreaterThan(0.1);
    expect(golden).toBeLessThanOrEqual(0.6); // a modest room: brass, not chrome
    expect(armillaryEnvIntensity(0.5)).toBeCloseTo((golden + dusk) / 2, 9);
    expect(armillaryEnvIntensity(-1)).toBe(golden);
    expect(armillaryEnvIntensity(2)).toBe(dusk);
  });
});
