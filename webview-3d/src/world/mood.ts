export type MoodSetting = 'golden' | 'dusk' | 'auto';

const STORAGE_KEY = 'diwan.mood';
const AUTO_DUSK_AFTER_SEC = 20;

/** auto: dusk after 20 s with no active agent, golden as soon as one is active. */
export function targetMood(setting: MoodSetting, allIdleForSec: number): 'golden' | 'dusk' {
  if (setting !== 'auto') return setting;
  return allIdleForSec >= AUTO_DUSK_AFTER_SEC ? 'dusk' : 'golden';
}

/** Inverse of smoothstep on [0,1]. */
function unsmooth(x: number): number {
  return 0.5 - Math.sin(Math.asin(1 - 2 * x) / 3);
}

/**
 * Advances the golden(0) to dusk(1) mix. Smoothstep-eased: progress moves linearly in time and
 * the returned mix is smoothstep(progress), so it is monotonic and lands on target in durationSec.
 */
export function stepMix(current: number, target: 0 | 1, dt: number, durationSec = 4): number {
  const c = Math.min(1, Math.max(0, current));
  if (c === target) return target;
  const p = unsmooth(c); // progress 0..1 along the golden to dusk curve
  const dp = dt / durationSec;
  const np = target === 1 ? Math.min(1, p + dp) : Math.max(0, p - dp);
  return np * np * (3 - 2 * np);
}

export interface ActivityChar {
  isActive: boolean;
  isSubagent: boolean;
  isGreeter?: boolean;
}

/** True when any real (non-subagent, non-greeter) agent is working. */
export function anyAgentActive(chars: readonly ActivityChar[]): boolean {
  return chars.some((c) => c.isActive && !c.isSubagent && !c.isGreeter);
}

/** Seconds since an agent was last active: reset to 0 on activity, else accumulate. */
export function advanceIdle(idleSec: number, active: boolean, dt: number): number {
  return active ? 0 : idleSec + dt;
}

const PRACTICAL_GOLDEN = 0.4;
const PRACTICAL_DUSK = 0.3;

export interface MoodLighting {
  sunIntensityScale: number;
  /** Live point lights are a delta on the baked lightmaps (which already hold the lamp light), not the full meta intensity. */
  practicalScale: number;
  /** Emissive gain of the lamp glow spheres: brighter as the hall darkens. */
  lampGain: number;
  exposure: number;
}

/** Lighting multipliers for a mix in [0,1] (0 golden, 1 dusk). */
export function moodLighting(mix: number): MoodLighting {
  const m = Math.min(1, Math.max(0, mix));
  return {
    sunIntensityScale: 1 - m,
    practicalScale: PRACTICAL_GOLDEN + (PRACTICAL_DUSK - PRACTICAL_GOLDEN) * m,
    lampGain: 1 + 0.4 * m,
    exposure: 1 - 0.12 * m,
  };
}

/** `?mood=golden|dusk|auto` (a one-off override that is not persisted), else null. */
export function moodFromSearch(search: string): MoodSetting | null {
  const v = new URLSearchParams(search).get('mood');
  return v === 'golden' || v === 'dusk' || v === 'auto' ? v : null;
}

export function loadMoodSetting(): MoodSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'golden' || v === 'dusk' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveMoodSetting(setting: MoodSetting): void {
  try {
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    /* storage blocked: the setting simply does not persist */
  }
}
