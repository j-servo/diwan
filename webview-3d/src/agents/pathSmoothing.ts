export type Vec2 = readonly [number, number];

const MAX_DT = 0.1;
const MAX_TURN_RAD_PER_SEC = (540 * Math.PI) / 180;

/**
 * Critically damped follow (exponential approach): never overshoots the target.
 * `speed` is the response rate in 1/s (about 1/settling time). Large dt is clamped.
 */
export function smoothPosition(prev: Vec2, target: Vec2, dt: number, speed: number): Vec2 {
  const d = Math.min(Math.max(dt, 0), MAX_DT);
  const k = 1 - Math.exp(-Math.max(speed, 0) * d);
  return [prev[0] + (target[0] - prev[0]) * k, prev[1] + (target[1] - prev[1]) * k];
}

function wrapPi(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Yaw (radians, atan2(dx, dz)) turning the shortest way, at most 540 deg/s. */
export function headingTowards(from: Vec2, to: Vec2, currentYaw: number, dt: number): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  if (dx === 0 && dz === 0) return currentYaw;
  const diff = wrapPi(Math.atan2(dx, dz) - currentYaw);
  const maxStep = MAX_TURN_RAD_PER_SEC * Math.min(Math.max(dt, 0), MAX_DT);
  return currentYaw + Math.max(-maxStep, Math.min(maxStep, diff));
}
