export type Quality = 'low' | 'balanced' | 'high';

export interface QualityProfile {
  dpr: [number, number];
  tiltShift: boolean;
  bloom: boolean;
  /** Light shafts and dust motes. */
  atmosphere: boolean;
  shadowMapSize: number;
}

const PROFILES: Record<Quality, QualityProfile> = {
  low: { dpr: [1, 1], tiltShift: false, bloom: false, atmosphere: false, shadowMapSize: 512 },
  balanced: {
    dpr: [1, 1.5],
    tiltShift: true,
    bloom: true,
    atmosphere: false,
    shadowMapSize: 1024,
  },
  high: { dpr: [1, 2], tiltShift: true, bloom: true, atmosphere: true, shadowMapSize: 2048 },
};

export function profileFor(q: Quality): QualityProfile {
  return PROFILES[q];
}

export function stepDown(q: Quality): Quality {
  return q === 'high' ? 'balanced' : 'low';
}

/** `?quality=low|balanced|high` pins the starting tier (for tests and screenshots), else high. */
export function qualityFromSearch(search: string): Quality {
  const v = new URLSearchParams(search).get('quality');
  return v === 'low' || v === 'balanced' || v === 'high' ? v : 'high';
}
