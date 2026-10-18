import { evalSpline } from './spline.js';
import type { ShotKey, V3 } from './types.js';

const M = 1 / 1.5; // the look-dev poses are in metres; the scene is in tiles

/** A 4:5 frame is narrower than the hall's 16:9: unless a key says otherwise, back off this much. */
export const PORTRAIT_DOLLY = 1.4;

export interface Pose {
  pos: V3;
  target: V3;
  fov: number;
  focus: number;
}

/**
 * The approval-alcove framing of a seat lamp (tiles): the look-dev "alcove" pose of
 * scene/DebugBridge.tsx, so the promo and the stills agree. North alcoves look south into the
 * court, south ones look north.
 */
export function alcovePose(lamp: V3, centreZ: number): Pick<Pose, 'pos' | 'target' | 'fov'> {
  const sign = lamp[2] < centreZ ? 1 : -1;
  return {
    pos: [lamp[0] + 2.2 * M, lamp[1] + 2.0 * M, lamp[2] + sign * 6.8 * M],
    target: [lamp[0], lamp[1] - 0.1 * M, lamp[2] + sign * 0.75 * M],
    fov: 34,
  };
}

export interface RigContext {
  /** Width / height of the frame. */
  aspect: number;
  /** The lamp of this agent's seat (tiles), or null while the agent has no seat yet. */
  lampOf: (agent: number) => V3 | null;
  centreZ: number;
}

/** A key with its dynamic parts (the alcove) resolved and the 4:5 reframing applied. */
export function resolveKey(key: ShotKey, ctx: RigContext): Pose {
  let { pos, target, fov } = key;
  if (key.alcove) {
    const lamp = ctx.lampOf(key.alcove.agent);
    if (lamp) ({ pos, target, fov } = alcovePose(lamp, ctx.centreZ));
    const drop = key.alcove.drop ?? 0;
    if (drop) {
      pos = [pos[0], pos[1] - drop, pos[2]];
      target = [target[0], target[1] - drop, target[2]];
    }
    const push = key.alcove.push ?? 1;
    if (push !== 1) {
      pos = [
        target[0] + (pos[0] - target[0]) * push,
        target[1] + (pos[1] - target[1]) * push,
        target[2] + (pos[2] - target[2]) * push,
      ];
    }
  }
  if (ctx.aspect < 1) {
    const p = key.portrait;
    const dolly = p?.dolly ?? PORTRAIT_DOLLY;
    if (p?.target) target = p.target;
    pos = [
      target[0] + (pos[0] - target[0]) * dolly,
      target[1] + (pos[1] - target[1]) * dolly,
      target[2] + (pos[2] - target[2]) * dolly,
    ];
    fov = p?.fov ?? fov;
  }
  return { pos, target, fov, focus: key.focus };
}

/** The camera at segment time t (seconds), smooth through every key. */
export function cameraAt(keys: readonly ShotKey[], t: number, ctx: RigContext): Pose {
  const path = keys.map((k) => {
    const r = resolveKey(k, ctx);
    return {
      t: k.t,
      hold: k.hold === true || undefined,
      v: [...r.pos, ...r.target, r.fov, r.focus],
    };
  });
  const v = evalSpline(
    path.map((p) => (p.hold ? p : { t: p.t, v: p.v })),
    t,
  );
  return {
    pos: [v[0]!, v[1]!, v[2]!],
    target: [v[3]!, v[4]!, v[5]!],
    fov: v[6]!,
    focus: v[7]!,
  };
}

/** Golden (0) to dusk (1): smoothstep between the keys. */
export function mixAt(keys: ReadonlyArray<readonly [number, number]>, t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) {
      const s = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * s * s * (3 - 2 * s);
    }
  }
  return keys[keys.length - 1]![1];
}

/** Caption opacity at time t: a 0.6 s fade in and out inside [from, to]. */
export function fadeAt(t: number, from: number, to: number, fade = 0.6): number {
  if (t <= from || t >= to) return 0;
  return Math.min(1, (t - from) / fade, (to - t) / fade);
}
