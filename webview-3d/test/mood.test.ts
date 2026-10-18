import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceIdle,
  anyAgentActive,
  loadMoodSetting,
  moodFromSearch,
  moodLighting,
  saveMoodSetting,
  stepMix,
  targetMood,
} from '../src/world/mood.js';

describe('targetMood', () => {
  it('honours explicit settings', () => {
    expect(targetMood('golden', 999)).toBe('golden');
    expect(targetMood('dusk', 0)).toBe('dusk');
  });
  it('auto: golden while active, dusk after 20 s idle', () => {
    expect(targetMood('auto', 0)).toBe('golden');
    expect(targetMood('auto', 19.9)).toBe('golden');
    expect(targetMood('auto', 20)).toBe('dusk');
    expect(targetMood('auto', 120)).toBe('dusk');
  });
});

describe('stepMix', () => {
  function run(from: number, to: 0 | 1, seconds: number) {
    let m = from;
    const steps: number[] = [];
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const n = stepMix(m, to, 1 / 60);
      steps.push(n - m);
      m = n;
    }
    return { m, steps };
  }
  it('is monotonic towards dusk with small steps and arrives in about 4 s', () => {
    const { m, steps } = run(0, 1, 4.1);
    expect(m).toBe(1);
    expect(steps.every((s) => s >= 0)).toBe(true);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(0.05);
  });
  it('is monotonic back to golden', () => {
    const { m, steps } = run(1, 0, 4.1);
    expect(m).toBe(0);
    expect(steps.every((s) => s <= 0)).toBe(true);
  });
  it('is eased: slow at the ends, fast in the middle', () => {
    const { steps } = run(0, 1, 4);
    expect(steps[0]).toBeLessThan(steps[120]);
    expect(steps[239]).toBeLessThan(steps[120]);
  });
  it('is not done early and holds at the target', () => {
    expect(run(0, 1, 3).m).toBeLessThan(1);
    expect(stepMix(1, 1, 1 / 60)).toBe(1);
    expect(stepMix(0, 0, 1 / 60)).toBe(0);
  });
  it('survives a huge dt', () => {
    expect(stepMix(0.3, 1, 100)).toBe(1);
  });
});

describe('moodLighting', () => {
  it('golden endpoint', () => {
    const g = moodLighting(0);
    expect(g.sunIntensityScale).toBe(1);
    expect(g.practicalScale).toBeGreaterThan(0);
    expect(g.practicalScale).toBeLessThan(0.6); // a delta on the baked light, never the full meta value
    expect(g.lampGain).toBe(1);
    expect(g.exposure).toBe(1);
  });
  it('dusk endpoint: no sun, brighter practicals, shifted exposure', () => {
    const d = moodLighting(1);
    expect(d.sunIntensityScale).toBe(0);
    expect(d.practicalScale).toBeLessThanOrEqual(moodLighting(0).practicalScale); // dusk bake already holds the lamps
    expect(d.practicalScale).toBeGreaterThan(0);
    expect(d.lampGain).toBeGreaterThan(1);
    expect(d.exposure).not.toBe(1);
    expect(Math.abs(d.exposure - 1)).toBeLessThan(0.3);
  });
  it('clamps out-of-range input', () => {
    expect(moodLighting(-1)).toEqual(moodLighting(0));
    expect(moodLighting(2)).toEqual(moodLighting(1));
  });
});

describe('persistence', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
  });
  it('defaults to auto and round-trips', () => {
    expect(loadMoodSetting()).toBe('auto');
    saveMoodSetting('dusk');
    expect(loadMoodSetting()).toBe('dusk');
  });
  it('ignores garbage and a throwing store', () => {
    localStorage.setItem('diwan.mood', 'nonsense');
    expect(loadMoodSetting()).toBe('auto');
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadMoodSetting()).toBe('auto');
    expect(() => saveMoodSetting('golden')).not.toThrow();
  });
});

describe('idle detection', () => {
  it('counts only non-subagent, non-greeter agents', () => {
    expect(anyAgentActive([])).toBe(false);
    expect(anyAgentActive([{ isActive: true, isSubagent: true }])).toBe(false);
    expect(anyAgentActive([{ isActive: true, isSubagent: false, isGreeter: true }])).toBe(false);
    expect(
      anyAgentActive([
        { isActive: false, isSubagent: false },
        { isActive: true, isSubagent: false },
      ]),
    ).toBe(true);
  });
  it('advanceIdle accumulates while idle and resets as soon as one is active', () => {
    expect(advanceIdle(5, false, 0.5)).toBe(5.5);
    expect(advanceIdle(5, true, 0.5)).toBe(0);
  });
});

describe('moodFromSearch', () => {
  it('reads a valid ?mood and ignores the rest', () => {
    expect(moodFromSearch('?mood=dusk')).toBe('dusk');
    expect(moodFromSearch('?mood=night')).toBeNull();
    expect(moodFromSearch('')).toBeNull();
  });
});
