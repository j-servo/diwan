import { describe, expect, it } from 'vitest';

import { profileFor, qualityFromSearch, stepDown } from '../src/world/quality.js';

describe('quality tiers', () => {
  it('low disables every costly effect', () => {
    const p = profileFor('low');
    expect(p.tiltShift).toBe(false);
    expect(p.bloom).toBe(false);
    expect(p.atmosphere).toBe(false);
  });

  it('high enables everything and costs more than balanced', () => {
    const high = profileFor('high');
    const balanced = profileFor('balanced');
    expect(high.tiltShift && high.bloom && high.atmosphere).toBe(true);
    expect(high.shadowMapSize).toBeGreaterThan(balanced.shadowMapSize);
    expect(high.dpr[1]).toBeGreaterThanOrEqual(balanced.dpr[1]);
  });

  it('steps down high -> balanced -> low -> low', () => {
    expect(stepDown('high')).toBe('balanced');
    expect(stepDown('balanced')).toBe('low');
    expect(stepDown('low')).toBe('low');
  });
});

describe('qualityFromSearch', () => {
  it('pins a valid tier and defaults to high', () => {
    expect(qualityFromSearch('?quality=low')).toBe('low');
    expect(qualityFromSearch('?quality=ultra')).toBe('high');
    expect(qualityFromSearch('')).toBe('high');
  });
});
