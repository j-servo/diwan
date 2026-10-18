import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { PerspectiveCamera } from 'three';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineClock } from '../engine/EngineProvider.tsx';
import type { PracticalLightMeta } from '../worlds/assetMeta.js';
import { cameraAt, mixAt } from './rigMath.js';
import { setPromoTime } from './promoStore.js';
import { PREROLL_SEC } from './timelines.js';
import type { PromoSegment, V3 } from './types.js';

const SUBSTEPS = 2;

declare global {
  interface Window {
    __promo?: {
      fps: number;
      durationSec: number;
      /** Script seconds of the next frame (negative during the pre-roll). */
      time: () => number;
      /** Runs the pre-roll (the hall already at work when frame 0 is shot). Resolves when done. */
      begin: () => Promise<void>;
      /** Advances by one frame and renders it. */
      step: () => void;
      /** Moves to script time t by stepping (no seeking back), rendering only the last frame. */
      seek: (t: number) => void;
      pose: () => { pos: V3; target: V3; fov: number; focus: number; mix: number; t: number };
    };
  }
}

/**
 * The promo's camera, mood and clock. The page's engine clock never ticks on its own in promo
 * mode: the render script calls window.__promo.step() once per frame, which moves the demo
 * transport, the engine and the camera by exactly 1/fps and then draws one frame. The video is
 * therefore the same on a slow or a busy machine.
 */
export function PromoRig(props: {
  getOfficeState: () => OfficeState;
  segment: PromoSegment;
  fps: number;
  advanceTransport: (ms: number) => void;
  practicals: PracticalLightMeta[];
  k: number;
  centreZ: number;
  mixRef: { current: number };
  focusRef: { current: number };
}) {
  const clock = useEngineClock();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const advance = useThree((s) => s.advance);
  const size = useThree((s) => s.size);
  const live = useRef({ ...props, size });
  live.current = { ...props, size };
  const t = useRef(-PREROLL_SEC);
  const frame = useRef(0);

  useEffect(() => {
    const L = () => live.current;
    const lampOf = (agent: number): V3 | null => {
      const seat = L().getOfficeState().characters.get(agent)?.seatId;
      const p = seat ? L().practicals.find((l) => l.seatUid === seat) : undefined;
      return p ? [p.position[0] * L().k, p.position[1] * L().k, p.position[2] * L().k] : null;
    };
    const pose = () => {
      const { segment, size: sz, centreZ } = L();
      const time = Math.max(0, t.current);
      const cam = cameraAt(segment.keys, time, { aspect: sz.width / sz.height, lampOf, centreZ });
      return { ...cam, mix: mixAt(segment.mix, time), t: t.current };
    };
    const apply = () => {
      const p = pose();
      camera.position.set(...p.pos);
      camera.up.set(0, 1, 0);
      camera.lookAt(...p.target);
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      L().focusRef.current = p.focus;
      L().mixRef.current = p.mix;
      setPromoTime(t.current);
    };
    const tick = (render: boolean) => {
      const dt = 1 / L().fps;
      t.current += dt;
      L().advanceTransport((t.current + PREROLL_SEC) * 1000);
      apply();
      for (let i = 0; i < SUBSTEPS; i++) clock.step(dt / SUBSTEPS);
      apply();
      if (render) {
        frame.current += 1;
        advance(100 + frame.current * dt);
      }
    };
    window.__promo = {
      fps: L().fps,
      durationSec: L().segment.durationSec,
      time: () => t.current,
      begin: async () => {
        // the hall runs for PREROLL_SEC first; yield now and then so React mounts the figures
        const n = Math.round(PREROLL_SEC * L().fps);
        for (let i = 0; i < n; i++) {
          tick(i >= n - 6);
          if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        // t is now 0 minus one frame; the next step() is frame 0
        t.current = -1 / L().fps;
      },
      step: () => tick(true),
      seek: (target) => {
        while (t.current < target - 1e-6) tick(t.current + 1 / L().fps >= target - 1e-6);
      },
      pose,
    };
    return () => {
      window.__promo = undefined;
    };
  }, [clock, camera, advance]);

  return null;
}
