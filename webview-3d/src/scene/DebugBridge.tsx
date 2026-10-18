import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { Mesh, PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import type { FigureScreen, LampScreen } from '../debug.js';
import { registerSceneProbe } from '../debug.js';
import type { PracticalLightMeta } from '../worlds/assetMeta.js';
import type { LookDevPoses } from '../worlds/types.js';
import { pixelToWorld } from './coords.js';

type V3 = [number, number, number];
const M = 1 / 1.5; // spike look-dev poses are in metres; the scene is in tiles

/**
 * Registers the debug probe for tests and look-dev frames: the live mood mix, camera framing and
 * the screen position of the approval lamp. Renders nothing; the wide pose is the world's default.
 */
export function DebugBridge(props: {
  getOfficeState: () => OfficeState;
  mixRef: { current: number };
  /** Seat lamps in GLB metres, and the metres-to-tiles scale of the hall group. */
  practicals: PracticalLightMeta[];
  k: number;
  /** The world's default pose (tiles). */
  wide: { pos: V3; target: V3; fov: number };
  /** The world's other fixed look-dev poses (tiles); none means only wide and the lamp poses. */
  lookDev?: LookDevPoses;
  /** Hall centre line (tiles): lamps north of it look south into the court, the rest north. */
  centreZ: number;
}) {
  const live = useRef(props);
  live.current = props;
  const get = useThree((s) => s.get);

  useEffect(() => {
    let lastSeat: string | null = null;

    const approvalSeats = (): string[] => {
      const seats: string[] = [];
      for (const ch of live.current.getOfficeState().getCharacters()) {
        if (!ch.isSubagent && ch.bubbleType === 'permission' && ch.seatId) {
          lastSeat = ch.seatId;
          seats.push(ch.seatId);
        }
      }
      return seats;
    };
    const approvalSeat = (): string | null => approvalSeats()[0] ?? null;
    const lampOf = (seat: string): Vector3 | null => {
      const p = live.current.practicals.find((l) => l.seatUid === seat);
      return p ? new Vector3(...p.position).multiplyScalar(live.current.k) : null;
    };

    registerSceneProbe({
      mix: () => live.current.mixRef.current,
      lampScreens: () => {
        const { camera, size, invalidate } = get();
        invalidate();
        camera.updateMatrixWorld();
        const out: LampScreen[] = [];
        for (const seat of approvalSeats()) {
          const lamp = lampOf(seat);
          if (!lamp) continue;
          const inFront = lamp.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
          const p = lamp.project(camera);
          const x = ((p.x + 1) / 2) * size.width;
          const y = ((1 - p.y) / 2) * size.height;
          const inFrame = inFront && x >= 0 && x < size.width && y >= 0 && y < size.height;
          out.push({ seat, x, y, inFrame });
        }
        return out;
      },
      figureScreens: () => {
        const { camera, size, invalidate } = get();
        invalidate();
        camera.updateMatrixWorld();
        const out: FigureScreen[] = [];
        for (const ch of live.current.getOfficeState().getCharacters()) {
          if (ch.isGreeter) continue;
          const [wx, , wz] = pixelToWorld(ch.x, ch.y);
          const p = new Vector3(wx, ch.isSubagent ? 0.45 : 0.6, wz);
          const inFront = p.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
          p.project(camera);
          const x = ((p.x + 1) / 2) * size.width;
          const y = ((1 - p.y) / 2) * size.height;
          out.push({
            id: ch.id,
            isSubagent: ch.isSubagent,
            x,
            y,
            inFrame: inFront && x >= 0 && x < size.width && y >= 0 && y < size.height,
          });
        }
        return out;
      },
      lampScreen: function () {
        return this.lampScreens()[0] ?? null;
      },
      hideMatching: (pattern) => {
        const { scene, invalidate } = get();
        const re = pattern === null ? null : new RegExp(pattern, 'i');
        let n = 0;
        scene.traverse((o) => {
          if (!(o as Mesh).isMesh) return;
          const mats = Array.isArray((o as Mesh).material)
            ? (o as Mesh).material
            : [(o as Mesh).material];
          const names = [o.name, ...(mats as { name: string }[]).map((m) => m.name)];
          const hit = re !== null && names.some((x) => re.test(x));
          if (hit) n++;
          o.visible = !hit;
        });
        invalidate();
        return n;
      },
      project: (p) => {
        const { camera, size } = get();
        camera.updateMatrixWorld();
        const v = new Vector3(...p);
        if (v.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) return null;
        v.project(camera);
        return { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height };
      },
      setCameraPose: (pos, target, fov) => {
        const { camera, invalidate } = get();
        const ctl = get().controls as OrbitControlsImpl | null;
        if (!ctl) return false;
        camera.position.set(...pos);
        ctl.target.set(...target);
        (camera as PerspectiveCamera).fov = fov;
        (camera as PerspectiveCamera).updateProjectionMatrix();
        ctl.update();
        invalidate();
        return true;
      },
      setCamera: (name, seat) => {
        const { camera, invalidate } = get();
        const ctl = get().controls as OrbitControlsImpl | null;
        let pose: { pos: V3; target: V3; fov: number } | null;
        if (name === 'wide') pose = live.current.wide;
        else if (name === 'alcove') {
          const lamp = lampOf(seat ?? approvalSeat() ?? lastSeat ?? '');
          if (!lamp) return false;
          const sign = lamp.z < live.current.centreZ ? 1 : -1; // north alcoves look south into the court, south ones north
          pose = {
            pos: [lamp.x + 2.2 * M, lamp.y + 2.0 * M, lamp.z + sign * 6.8 * M],
            target: [lamp.x, lamp.y - 0.1 * M, lamp.z + sign * 0.75 * M],
            fov: 34,
          };
        } else if (name === 'chamber') {
          // the whole bay of a seat's alcove, seen through its arcade opening (the seat is the
          // west tile of its two-tile desk, so the bay is centred 0.75 m east of the lamp)
          const lamp = lampOf(seat ?? '');
          if (!lamp) return false;
          const sign = lamp.z < live.current.centreZ ? 1 : -1;
          const cx = lamp.x + 0.75 * M;
          pose = {
            pos: [cx, lamp.y + 2.4 * M, lamp.z + sign * 7.6 * M],
            target: [cx, lamp.y + 0.8 * M, lamp.z + sign * 0.2 * M],
            fov: 34,
          };
        } else pose = live.current.lookDev?.[name] ?? null;
        if (!pose || !ctl) return false;
        camera.position.set(...pose.pos);
        ctl.target.set(...pose.target);
        (camera as PerspectiveCamera).fov = pose.fov;
        (camera as PerspectiveCamera).updateProjectionMatrix();
        ctl.update();
        invalidate();
        return true;
      },
    });
    return () => registerSceneProbe(null);
  }, [get]);

  return null;
}
