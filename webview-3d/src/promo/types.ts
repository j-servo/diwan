import type { DemoTimeline } from '../demo/types.js';

export type V3 = [number, number, number];

/**
 * One camera key (tiles, the scene's unit). The path is a smooth spline through the keys
 * (spline.ts), so a shot is a few keys, not a start and an end.
 */
export interface ShotKey {
  /** Seconds into the segment. */
  t: number;
  pos: V3;
  target: V3;
  fov: number;
  /** Tilt-shift band size (smaller = a tighter sharp band; 0.3 wide, 0.18 close). */
  focus: number;
  /** Arrive and leave at rest. */
  hold?: boolean;
  /**
   * The approval-alcove framing of this agent's seat, from its lamp (the same view as the
   * look-dev "alcove" pose); pos/target/fov are then only the fallback before the agent exists.
   * `push` moves the camera that fraction of the way in (0.94 = 6% closer); `drop` lowers the
   * whole view by that many tiles, so the scholar sits higher in the frame.
   */
  alcove?: { agent: number; push?: number; drop?: number };
  /** 4:5 reframing: dolly the camera out along its view line, and/or widen the lens. */
  portrait?: { dolly?: number; fov?: number; target?: V3 };
}

export interface Caption {
  text: string;
  /** Seconds into the segment. */
  from: number;
  to: number;
}

/** One world's part of a cut: rendered as its own page load, joined by a crossfade. */
export interface PromoSegment {
  world: string;
  durationSec: number;
  keys: ShotKey[];
  /** Golden (0) to dusk (1) mix keys, [t, mix]; smoothstep between neighbours. */
  mix: Array<[number, number]>;
  captions: Caption[];
  /** The end card fades in at this second and stays. */
  endCardFrom?: number;
  /** Script time 0 is when frame 0 is shot; the demo has already been running for PREROLL_SEC. */
  timeline: DemoTimeline;
}

export interface PromoCut {
  id: string;
  fps: number;
  crossfadeSec: number;
  segments: PromoSegment[];
}
