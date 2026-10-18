import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';
import type { Vec3 } from '../scene/coords.js';
import { pixelToWorld } from '../scene/coords.js';
import { TILT_FOCUS_CLOSE, TILT_FOCUS_WIDE } from '../world/PostStack.tsx';
import type { DirectorEvent, Shot } from './director.js';
import { INITIAL_SHOT, deriveEvents, nextShot } from './director.js';
import type { CharSnap } from './director.js';
import { framingDistance, stepSpring, stepSpring3 } from './focus.js';

/** A figure is ~1.65 m tall = 1.1 tiles; a close-up frames it at this height on screen. */
export const FIGURE_HEIGHT_TILES = 1.1;
export const CLOSEUP_PX = 190;
/** World-space height the camera looks at on a figure (about chest height), in tiles. */
const FIGURE_LOOK_Y = 0.6;
const OMEGA_CAMERA = 5.5;
const OMEGA_FOCUS = 4;
const EVENT_KEEP_SEC = 10;
const FOLLOW_EPS = 0.02;
const SETTLED_EPS = 0.01;

interface Goal {
  key: string;
  target: Vec3;
  distance: number;
  focusArea: number;
  follow: boolean;
}

/**
 * Drives the OrbitControls target / distance and the tilt-shift band: glides to the clicked (or
 * directed) figure with critically damped springs, and back to the home pose. While nothing is
 * moving it does not touch the camera, so OrbitControls stays fully usable.
 */
export function CameraRig(props: {
  getOfficeState: () => OfficeState;
  /** The default wide pose: where the camera looks and how far away it sits (tiles). */
  home: { target: Vec3; distance: number };
  /** Vertical field of view in degrees (22: the miniature lens). */
  fov: number;
  /** Clicked figure, or null. Takes priority over the director. */
  focusId: number | null;
  director: boolean;
  /** Written here (tilt-shift band size), read by PostStack. */
  focusRef: { current: number };
  /** Called when the focused character no longer exists (so a reused id is not refocused). */
  onFocusLost: () => void;
}) {
  const { getOfficeState, home, fov, focusId, director, focusRef, onFocusLost } = props;
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const camera = useThree((s) => s.camera);
  const height = useThree((s) => s.size.height);
  const invalidate = useThree((s) => s.invalidate);

  const live = useRef({ focusId, director, home, fov, height, controls, camera });
  live.current = { focusId, director, home, fov, height, controls, camera };

  const onFocusLostRef = useRef(onFocusLost);
  onFocusLostRef.current = onFocusLost;
  const clock = useRef(0);
  const events = useRef<DirectorEvent[]>([]);
  const snaps = useRef<Map<number, CharSnap>>(new Map());
  const shot = useRef<Shot>(INITIAL_SHOT);
  const goalKey = useRef('');
  const driveDistance = useRef(false);
  const driveTarget = useRef(false);
  const spring = useRef({
    target: { value: [0, 0, 0] as Vec3, velocity: [0, 0, 0] as Vec3 },
    distance: { value: 0, velocity: 0 },
    focus: { value: TILT_FOCUS_WIDE, velocity: 0 },
  });

  useEffect(() => {
    if (!director) shot.current = INITIAL_SHOT;
  }, [director]);

  useEngineTick((dt) => {
    const L = live.current;
    clock.current += dt;
    const now = clock.current;

    // Director: engine character edges become events; nextShot picks the camera subject.
    const chars = getOfficeState().getCharacters();
    const derived = deriveEvents(snaps.current, chars, now);
    snaps.current = derived.next;
    events.current.push(...derived.events);
    events.current = events.current.filter((e) => now - e.at < EVENT_KEEP_SEC);
    if (L.director) shot.current = nextShot(events.current, now, shot.current);

    const subject =
      L.focusId ?? (L.director && shot.current.kind === 'agent' ? shot.current.agentId : null);
    const ch = subject === null ? undefined : getOfficeState().characters.get(subject);
    if (L.focusId !== null && !ch) onFocusLostRef.current();
    let goal: Goal;
    if (subject !== null && ch) {
      const [x, , z] = pixelToWorld(ch.x, ch.y);
      goal = {
        key: `agent:${subject}`,
        target: [x, FIGURE_LOOK_Y, z],
        distance: framingDistance(FIGURE_HEIGHT_TILES, CLOSEUP_PX, L.height, L.fov),
        focusArea: TILT_FOCUS_CLOSE,
        follow: true,
      };
    } else {
      goal = {
        key: 'wide',
        target: L.home.target,
        distance: L.home.distance,
        focusArea: TILT_FOCUS_WIDE,
        follow: false,
      };
    }

    const s = spring.current;
    const c = L.controls;
    if (!c) return;
    const cam = L.camera;

    if (goal.key !== goalKey.current) {
      if (goalKey.current === '') {
        // First tick: start from wherever the camera actually is, without moving it.
        s.target = { value: [c.target.x, c.target.y, c.target.z], velocity: [0, 0, 0] };
        s.distance = { value: cam.position.distanceTo(c.target), velocity: 0 };
      } else {
        // Keep the velocity when the goal changes mid-move, so a director cut does not jerk.
        driveDistance.current = true;
        driveTarget.current = true;
        s.target = { value: [c.target.x, c.target.y, c.target.z], velocity: s.target.velocity };
        s.distance = { value: cam.position.distanceTo(c.target), velocity: s.distance.velocity };
      }
      goalKey.current = goal.key;
    }

    let moved = false;
    const tErr = Math.hypot(
      goal.target[0] - c.target.x,
      goal.target[1] - c.target.y,
      goal.target[2] - c.target.z,
    );
    // Following a figure: a user pan snaps back by design; Escape or clicking away releases it.
    if (goal.follow && tErr > FOLLOW_EPS) driveTarget.current = true;

    if (driveTarget.current || driveDistance.current) {
      const before = c.target.clone();
      if (driveTarget.current) {
        s.target = stepSpring3(s.target, goal.target, dt, OMEGA_CAMERA);
        c.target.set(...s.target.value);
      }
      const delta = c.target.clone().sub(before);
      cam.position.add(delta);
      if (driveDistance.current) {
        s.distance = stepSpring(s.distance, goal.distance, dt, OMEGA_CAMERA);
        const dir = cam.position.clone().sub(c.target);
        if (dir.lengthSq() > 1e-9)
          cam.position.copy(c.target).addScaledVector(dir.normalize(), s.distance.value);
      }
      if (driveTarget.current && tErr < SETTLED_EPS && Math.hypot(...s.target.velocity) < 0.01) {
        driveTarget.current = false;
      }
      if (
        driveDistance.current &&
        Math.abs(s.distance.value - goal.distance) < SETTLED_EPS &&
        Math.abs(s.distance.velocity) < 0.01
      ) {
        driveDistance.current = false;
      }
      c.update();
      moved = true;
    }

    if (Math.abs(s.focus.value - goal.focusArea) > 1e-4 || Math.abs(s.focus.velocity) > 1e-4) {
      s.focus = stepSpring(s.focus, goal.focusArea, dt, OMEGA_FOCUS);
      focusRef.current = s.focus.value;
      moved = true;
    }
    if (moved) invalidate();
  });

  return null;
}
