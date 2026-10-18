import type { ProbeGrid } from './probes.js';

let grid: ProbeGrid | null = null;
let meanLuminance = 1;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Set by WorldSkin once the hall has loaded; figures read it per tick (null = flat ambient). */
export function setProbeGrid(g: ProbeGrid | null): void {
  grid = g;
  meanLuminance = 1;
  if (g) {
    let sum = 0;
    const n = g.data.length / 3;
    for (let i = 0; i < n; i++) sum += lum(g.data[i * 3], g.data[i * 3 + 1], g.data[i * 3 + 2]);
    meanLuminance = Math.max(sum / n, 1e-4);
  }
}

export function getProbeGrid(): ProbeGrid | null {
  return grid;
}

export const FILL_MIN = 0.85;
export const FILL_MAX = 1.4;
const LIFT_MAX = 0.06;
const LIFT_MIN = 0.02; // sun still lifts the near-black cloak a little

/**
 * Per-figure fill from a sampled probe colour: an env-map scale kept within [FILL_MIN, FILL_MAX]
 * (shade never drops below readable, sun never blows out), plus a probe-tinted emissive lift
 * that only matters in shade.
 */
export function figureFill(
  rgb: readonly [number, number, number],
  mean: number = meanLuminance,
): { envScale: number; tint: [number, number, number]; lift: number } {
  const l = lum(rgb[0], rgb[1], rgb[2]);
  const ratio = l / Math.max(mean, 1e-4);
  const tint: [number, number, number] =
    l > 1e-6 ? [rgb[0] / l, rgb[1] / l, rgb[2] / l] : [1, 1, 1];
  return {
    envScale: Math.min(FILL_MAX, Math.max(FILL_MIN, ratio)),
    tint,
    lift: LIFT_MIN + (LIFT_MAX - LIFT_MIN) * Math.min(1, Math.max(0, (1.2 - ratio) / 1.2)),
  };
}
