export interface SpringState {
  value: number;
  velocity: number;
}
export interface Spring3 {
  value: [number, number, number];
  velocity: [number, number, number];
}
export interface CameraPose {
  target: [number, number, number];
  /** Tilt-shift focus distance from the camera. */
  focusDistance: number;
}

/** Exact critically damped spring step: no overshoot from rest, independent of frame rate. */
export function stepSpring(
  state: SpringState,
  target: number,
  dt: number,
  omega: number,
): SpringState {
  const d = state.value - target;
  const e = Math.exp(-omega * dt);
  const temp = (state.velocity + omega * d) * dt;
  return { value: target + (d + temp) * e, velocity: (state.velocity - omega * temp) * e };
}

export function stepSpring3(
  state: Spring3,
  target: readonly [number, number, number],
  dt: number,
  omega: number,
): Spring3 {
  const value: [number, number, number] = [0, 0, 0];
  const velocity: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const s = stepSpring(
      { value: state.value[i], velocity: state.velocity[i] },
      target[i],
      dt,
      omega,
    );
    value[i] = s.value;
    velocity[i] = s.velocity;
  }
  return { value, velocity };
}

/** The wide default pose: look at the hall centre, focus on it. */
export function defaultPose(
  center: readonly [number, number, number],
  focusDistance: number,
): CameraPose {
  return { target: [center[0], center[1], center[2]], focusDistance };
}

/** On-screen height in px of an object `height` world units tall, `distance` away, on-axis. */
export function figurePixelHeight(
  height: number,
  distance: number,
  viewportH: number,
  fovDeg: number,
): number {
  return (height * viewportH) / (2 * distance * Math.tan((fovDeg * Math.PI) / 360));
}

/** Camera distance that makes an object `height` tall appear `targetPx` tall on screen. */
export function framingDistance(
  height: number,
  targetPx: number,
  viewportH: number,
  fovDeg: number,
): number {
  return (height * viewportH) / (2 * targetPx * Math.tan((fovDeg * Math.PI) / 360));
}
