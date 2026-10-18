/**
 * The House of Life's title 𓉐𓋹 breathes: a slow sine on its emissive intensity, never off.
 * Pure, so the engine clock (deterministic under `?frames`) drives it and a test can pin it.
 */
export const TITLE_GLOW_PERIOD_SEC = 4.6;
/** The dimmest the glow ever gets, as a share of its brightest, at dusk and at golden hour. */
export const TITLE_GLOW_FLOOR = { golden: 0.5, dusk: 0.35 };
/** Peak emissive intensity of the glyph map at golden hour and at dusk. */
export const TITLE_GLOW_PEAK = { golden: 1.1, dusk: 2.4 };
/** Peak opacity of the soft halo behind the signs. */
export const TITLE_HALO_PEAK = { golden: 0.35, dusk: 0.9 };

export interface TitleGlowLevel {
  /** 0..1 share of the peak: the breath. */
  level: number;
  /** Emissive intensity for the glyph map. */
  intensity: number;
  /** Opacity for the halo quad. */
  halo: number;
}

/**
 * @param t engine seconds
 * @param mix mood mix, 0 golden .. 1 dusk (subtler by day, stronger at dusk)
 * @param reduced prefers-reduced-motion: a steady glow at the breath's mean
 */
export function titleGlow(t: number, mix: number, reduced: boolean): TitleGlowLevel {
  const m = Math.min(1, Math.max(0, mix));
  const floor = TITLE_GLOW_FLOOR.golden + (TITLE_GLOW_FLOOR.dusk - TITLE_GLOW_FLOOR.golden) * m;
  const breath = 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / TITLE_GLOW_PERIOD_SEC - Math.PI / 2);
  const level = reduced ? (1 + floor) / 2 : floor + (1 - floor) * breath;
  const peak = TITLE_GLOW_PEAK.golden + (TITLE_GLOW_PEAK.dusk - TITLE_GLOW_PEAK.golden) * m;
  const halo = TITLE_HALO_PEAK.golden + (TITLE_HALO_PEAK.dusk - TITLE_HALO_PEAK.golden) * m;
  return { level, intensity: level * peak, halo: level * halo };
}

/**
 * Depth-fight guard for the title decal (Yousef, 2026-10-19: the title fragmented at some camera
 * angles). The title sits 6 mm proud of the lintel (the bake) and, at the orbit's 72 m limit, a
 * 24-bit depth buffer resolves about 2 mm: the lift alone is not enough, and it shrinks with the
 * viewing angle. A polygon offset is measured in depth-buffer units, so it holds at any distance.
 * Ordered lintel < title < halo.
 */
export const TITLE_POLYGON_OFFSET = { factor: -2, units: -4 };
export const HALO_POLYGON_OFFSET = { factor: -3, units: -8 };
