import { smoothPosition } from './pathSmoothing.js';
import type { Vec2 } from './pathSmoothing.js';

/** Authored in-place walk speed of the walk clip (figures.meta.json walk.speedMps). */
export const WALK_CLIP_MPS = 0.8;
/** Render-side travel cap; the engine itself moves characters at about 4.5 m/s. */
export const FIGURE_MAX_MPS = 1.1;
export const TILE_METERS = 1.5;
/** Slowest walk the clip can show without the feet sliding (timeScale floor 0.6). */
export const WALK_MIN_MPS = 0.6 * WALK_CLIP_MPS;

/** Walk clip speed so the feet stay planted at the given root speed (m/s). */
export function walkTimeScale(speedMps: number): number {
  return Math.min(1.6, Math.max(0.6, speedMps / WALK_CLIP_MPS));
}

/** three's loader suffixes duplicate node names with _<n>. */
export function stripLoaderSuffix(name: string): string {
  return name.replace(/_\d+$/, '');
}

/** "hips_1.quaternion" -> "hips.quaternion" (node names are sanitised, so the first dot splits). */
export function stripTrackSuffix(track: string): string {
  const dot = track.indexOf('.');
  return dot < 0
    ? stripLoaderSuffix(track)
    : stripLoaderSuffix(track.slice(0, dot)) + track.slice(dot);
}

/**
 * Six saturated robe-trim hues, clearly apart from stone, brass and cedar and at least 40 deg from
 * cobalt (cobalt glaze means "needs you"). The figure GLB's own bases are NOT safe: its cloak and
 * apprentice robe were baked in the cobalt family, so ROBE_OVERRIDES re-colours them at runtime.
 */
export const TRIM_COLORS = [
  '#d11a3a', // crimson
  '#0fa59b', // verdigris
  '#1fa24a', // emerald
  '#8a2be2', // violet
  '#e0289a', // magenta
  '#f0501c', // vermilion
] as const;

/**
 * Runtime base and sheen-tint colours for the GLB materials that were authored in the reserved
 * cobalt family (cloak ~233 deg, apprentice robe ~223 deg): undyed wool and dun, low saturation.
 * Materials keep their names; only the colours are replaced when a figure is built.
 */
export const ROBE_OVERRIDES: Record<string, { base: string; sheen: string }> = {
  cloak: { base: '#41382f', sheen: '#8c7e69' },
  robe_apprentice: { base: '#a89b84', sheen: '#d8cdb6' },
};

/** What a persona wears in a world whose figures GLB carries every garment as its own material. */
export interface Costume {
  /** Skin tone (sRGB hex). */
  skin: string;
  /** Head: shaved (neither wig), a short rounded wig or a long wig. */
  wig: 'none' | 'short' | 'long';
  /** A sheath dress instead of the kilt (the belt goes with the kilt). */
  dress: boolean;
  /** A light linen tunic over the bare chest. */
  shirt: boolean;
  /** The lector's diagonal sash. */
  sash: boolean;
}
export type CostumeFn = (persona: string, palette: number, subagent: boolean) => Costume;

interface CostumeMaterial {
  name: string;
  visible: boolean;
  color?: { set(c: string): unknown };
}

/** Shows the garments of `c` by material name and tints the skin; materials a GLB lacks are skipped. */
export function applyCostume(materials: readonly CostumeMaterial[], c: Costume): void {
  const show: Record<string, boolean> = {
    kilt: !c.dress,
    belt: !c.dress,
    dress: c.dress,
    shirt: c.shirt,
    sash: c.sash,
    wig: c.wig === 'short',
    wig_long: c.wig === 'long',
  };
  for (const m of materials) {
    if (m.name in show) m.visible = show[m.name];
    else if (m.name === 'skin') m.color?.set(c.skin);
  }
}

let activeTrims: readonly string[] = TRIM_COLORS;

/** The world's own trim palette (six hues clear of its signal); set once at startup. */
export function setActiveTrimColors(colors: readonly string[] | undefined): void {
  activeTrims = colors ?? TRIM_COLORS;
}

export function trimColor(palette: number, colors: readonly string[] = activeTrims): string {
  const n = colors.length;
  return colors[((palette % n) + n) % n];
}

/** Follows the engine target at up to `maxUnitsPerSec` (world units); never overshoots. */
export function followStep(prev: Vec2, target: Vec2, dt: number, maxUnitsPerSec: number): Vec2 {
  const d = Math.min(Math.max(dt, 0), 0.1);
  const s = smoothPosition(prev, target, d, 12);
  const dx = s[0] - prev[0];
  const dz = s[1] - prev[1];
  const len = Math.hypot(dx, dz);
  const max = maxUnitsPerSec * d;
  // Floor the speed so the walk tail never slows below what the clip can match.
  const toTarget = Math.hypot(target[0] - prev[0], target[1] - prev[1]);
  const want = Math.min(Math.max(len, (WALK_MIN_MPS / TILE_METERS) * d), max, toTarget);
  return toTarget === 0 ? [prev[0], prev[1]] : stepToward(prev, target, want, toTarget);
}

function stepToward(prev: Vec2, target: Vec2, step: number, dist: number): Vec2 {
  const k = step / dist;
  return [prev[0] + (target[0] - prev[0]) * k, prev[1] + (target[1] - prev[1]) * k];
}

const IDLE_FRAME_SEC = 1 / 15;

/**
 * Demand rendering: ask for a frame every tick while something visibly changes (walking,
 * catching up, one-shots, cross-fades, dissolves); otherwise only about 15 times a second.
 */
export function figureNeedsFrame(
  busy: boolean,
  accum: number,
  dt: number,
): { invalidate: boolean; accum: number } {
  if (busy) return { invalidate: true, accum: 0 };
  const a = accum + dt;
  return a >= IDLE_FRAME_SEC
    ? { invalidate: true, accum: a - IDLE_FRAME_SEC }
    : { invalidate: false, accum: a };
}
