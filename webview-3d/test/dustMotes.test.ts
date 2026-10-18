import { expect, test } from 'vitest';

import { DEFAULT_DUST_MOTES, DUST_MOTE_SIZE, MAX_DUST_MOTES } from '../src/world/Atmosphere.tsx';

test('dust motes: half the old diameter (0.03), about 60% of the old count (240, cap 400)', () => {
  expect(DUST_MOTE_SIZE).toBe(0.03 / 2);
  expect(DEFAULT_DUST_MOTES).toBe(144);
  expect(MAX_DUST_MOTES).toBe(240);
});
