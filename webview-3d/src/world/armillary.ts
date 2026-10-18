/**
 * The courtyard armillary sphere's motion, geocentric as the Abbasid astronomers modelled it
 * (Ptolemy's Almagest was translated at the House of Wisdom). The bake fixes the frames
 * (assets/blender/armillary_spec.py): the polar axis rises 33.3 deg (Baghdad) above the north
 * horizon, the ecliptic leans 23.44 deg off the equator and the moon's ring 5.15 deg off the
 * ecliptic. At runtime only three nodes turn, each about its own local +Y:
 *   cage  the celestial sphere (equator, colures, tropics, zodiac belt): westward, the daily turn
 *   sun   along the ecliptic, eastward against the stars
 *   moon  along its own inclined ring, eastward and faster
 * The plinth, pedestal, meridian, horizon, polar axis and the central Earth stay still.
 */
export const ARMILLARY_MOTION = {
  cagePeriodSec: 100,
  sunPeriodSec: 300,
  moonPeriodSec: 40,
} as const;

export const ARMILLARY_MOVING = ['cage', 'sun', 'moon'] as const;
export type ArmillaryMovingNode = (typeof ARMILLARY_MOVING)[number];

const TURN = 2 * Math.PI;

/** Fraction of a turn, kept in [0, 1) so long sessions never lose float precision. */
const phase = (t: number, period: number) => (((t / period) % 1) + 1) % 1;

/** Angles (radians, about each node's local +Y, added to its rest pose) at engine time t (s). */
export function armillaryAngles(t: number): Record<ArmillaryMovingNode, number> {
  const { cagePeriodSec, sunPeriodSec, moonPeriodSec } = ARMILLARY_MOTION;
  return {
    cage: -phase(t, cagePeriodSec) * TURN || 0,
    sun: phase(t, sunPeriodSec) * TURN,
    moon: phase(t, moonPeriodSec) * TURN,
  };
}

/** The brass reflects a warm room: brighter in the golden hour, dimmer (never black) at dusk. */
const ENV_GOLDEN = 0.36;
const ENV_DUSK = 0.18;

export function armillaryEnvIntensity(mix: number): number {
  const m = Math.min(1, Math.max(0, mix));
  return ENV_GOLDEN + (ENV_DUSK - ENV_GOLDEN) * m;
}
