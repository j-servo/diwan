/**
 * The reserved "needs you" colour is per world, one signal each, and nothing else in that world
 * (kind colours, robe trims, bakes) may be a saturated colour near its hue:
 *   House of Wisdom  Abbasid cobalt glaze (tin-glaze, Basra, 9th century), ~226 deg, guard 25 deg
 *   House of Life    amethyst #A21CAF, ~295 deg, guard 40 deg (255-335 deg is off limits)
 * The world definition holds its Signal; the page sets it once at startup (setActiveSignal), and
 * lamps, board ink, beacons and the CSS variables (--needs-you) all read or mirror that one value.
 */
export interface Signal {
  color: string;
  /** The same hue, darkened for text on the world's paper. */
  ink: string;
  /** Saturated colours within this many degrees of the hue are forbidden in the world. */
  guardDeg: number;
}

export const HOUSE_OF_WISDOM_SIGNAL: Signal = { color: '#2f5bea', ink: '#1d40b0', guardDeg: 25 };
export const HOUSE_OF_LIFE_SIGNAL: Signal = { color: '#A21CAF', ink: '#7a1385', guardDeg: 40 };

let active: Signal = HOUSE_OF_WISDOM_SIGNAL;

/** The signal of the world this page shows (the House of Wisdom until the page says otherwise). */
export function activeSignal(): Signal {
  return active;
}

export function setActiveSignal(signal: Signal): void {
  active = signal;
}

/** Hue (degrees, 0-360) and HSL saturation of a #rrggbb colour. */
export function hexHueSat(hex: string): { hue: number; sat: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { hue: 0, sat: 0 };
  const l = (max + min) / 2;
  const sat = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat };
}

/** Smallest angle between two hues (degrees). */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

/** Saturation above which a colour counts as chromatic for the colour law. */
export const SATURATED = 0.35;

/** The colour law: is this colour saturated and inside the signal's guard band? */
export function clashesWithSignal(
  hex: string,
  signal: Signal,
  guardDeg = signal.guardDeg,
): boolean {
  const { hue, sat } = hexHueSat(hex);
  return sat >= SATURATED && hueGap(hue, hexHueSat(signal.color).hue) < guardDeg;
}
