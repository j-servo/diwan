import { describe, expect, it } from 'vitest';

import type { Character } from '../../webview-ui/src/office/types.js';
import {
  lampColor,
  lampEmissive,
  lampGlowOpacity,
  lampMoodGain,
  lampNeedsFrame,
  lampStateForSeat,
} from '../src/world/AlcoveLamps.js';

const ch = (o: Partial<Character>): Character =>
  ({ seatId: 's1', isActive: false, isSubagent: false, bubbleType: null, ...o }) as Character;

describe('lampStateForSeat', () => {
  it('is off with no occupant or an idle one', () => {
    expect(lampStateForSeat([], 's1')).toBe('off');
    expect(lampStateForSeat([ch({})], 's1')).toBe('off');
  });
  it('is active for an active occupant of that seat only', () => {
    expect(lampStateForSeat([ch({ isActive: true })], 's1')).toBe('active');
    expect(lampStateForSeat([ch({ isActive: true })], 's2')).toBe('off');
  });
  it('permission beats active', () => {
    expect(lampStateForSeat([ch({ isActive: true, bubbleType: 'permission' })], 's1')).toBe(
      'approval',
    );
  });
  it('ignores subagents', () => {
    expect(lampStateForSeat([ch({ isActive: true, isSubagent: true })], 's1')).toBe('off');
  });
});

const lum = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const bloomLum = (state: 'active' | 'approval', t: number) =>
  lampEmissive(state, t) * lum(lampColor(state));

describe('lampEmissive', () => {
  it('stays below the bloom threshold when off', () => {
    expect(lampEmissive('off', 0) * lum(lampColor('off'))).toBeLessThan(1);
  });
  it('keeps intensity x luminance >= 1.3 across the whole active flicker and approval pulse', () => {
    for (let t = 0; t < 6; t += 0.01) {
      expect(bloomLum('active', t)).toBeGreaterThanOrEqual(1.3);
      // approval: the core stays below clipping so it keeps its saturation
      expect(Math.max(...lampColor('approval')) * lampEmissive('approval', t)).toBeLessThanOrEqual(
        1.5,
      );
    }
  });
  it('only the approval state has a glow and light pools', () => {
    expect(lampGlowOpacity('active', 0)).toBe(0);
    expect(lampGlowOpacity('off', 0)).toBe(0);
    for (let t = 0; t < 3; t += 0.05) {
      expect(lampGlowOpacity('approval', t)).toBeGreaterThanOrEqual(0.6);
      expect(lampGlowOpacity('approval', t)).toBeLessThanOrEqual(0.85);
    }
  });
  it('approval pulses with a 1.2 s period', () => {
    expect(lampEmissive('approval', 0.3)).toBeCloseTo(lampEmissive('approval', 1.5), 6);
    expect(lampEmissive('approval', 0.3)).not.toBeCloseTo(lampEmissive('approval', 0.9), 2);
  });
});

describe('lampNeedsFrame', () => {
  it('requests a frame on the lit -> off transition', () => {
    expect(
      lampNeedsFrame({ state: 'active', intensity: 2.2 }, { state: 'off', intensity: 0.25 }),
    ).toBe(true);
  });
  it('requests a frame on the first sample and while lit values change', () => {
    expect(lampNeedsFrame(undefined, { state: 'off', intensity: 0.25 })).toBe(true);
    expect(
      lampNeedsFrame({ state: 'active', intensity: 2.2 }, { state: 'active', intensity: 2.3 }),
    ).toBe(true);
  });
  it('stays quiet for a steady off lamp', () => {
    expect(
      lampNeedsFrame({ state: 'off', intensity: 0.25 }, { state: 'off', intensity: 0.25 }),
    ).toBe(false);
  });
});

describe('lampMoodGain', () => {
  it('is 1 at golden and rises towards dusk, gently', () => {
    expect(lampMoodGain(0)).toBe(1);
    expect(lampMoodGain(1)).toBeGreaterThan(1.3);
    expect(lampMoodGain(1)).toBeLessThan(2);
    expect(lampMoodGain(0.5)).toBeGreaterThan(lampMoodGain(0.2));
  });
});
