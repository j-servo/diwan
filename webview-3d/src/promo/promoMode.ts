import { resolveMode } from '../transport/mode.js';
import { CUTS } from './cuts.js';

/**
 * `?promo=<cut>` (demo mode only): a scripted camera, hidden overlays and a manual clock for the
 * offline video render (scripts/promo.mjs). Live mode never gets it: a promo URL without the demo
 * transport is ignored, so a live page can never be taken over.
 */
export function resolvePromo(search: string, envDemo: string | undefined): string | null {
  const cut = new URLSearchParams(search).get('promo');
  if (!cut || !(cut in CUTS)) return null;
  return resolveMode(search, envDemo) === 'demo' ? cut : null;
}

/** A small seeded generator (mulberry32): the promo's walkers and spawns repeat frame for frame. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const promoCut: string | null =
  typeof window === 'undefined'
    ? null
    : resolvePromo(window.location.search, import.meta.env.VITE_DIWAN_DEMO);

if (promoCut) {
  // Deterministic spawns and wandering: the landscape and portrait renders show the same hall.
  const seed = Number(new URLSearchParams(window.location.search).get('seed') ?? 7);
  Math.random = seededRandom(Number.isFinite(seed) ? seed : 7);
  document.documentElement.classList.add('promo');
}
