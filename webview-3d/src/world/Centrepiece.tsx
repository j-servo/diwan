import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Object3D } from 'three';
import { Mesh, MeshStandardMaterial, PMREMGenerator, Quaternion, Vector3 } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { useEngineTick } from '../engine/EngineProvider.tsx';
import type { CentrepieceMotion } from '../worlds/types.js';

/** A slow turn reads the same at 30 Hz: half the frames of a continuous 60 Hz redraw. */
const REDRAW_SEC = 1 / 30;
/** Blur of the room's reflection: soft enough for patina, still a highlight on polished brass. */
const ENV_SIGMA = 0.04;
const UP = new Vector3(0, 1, 0);

/**
 * The materials that take the room's reflection: every standard material, except the ones lit
 * by the hall's lightmap (a centrepiece baked with the hall: they keep the hall's environment),
 * unless they ask for a reflection of their own (`envScale` in the glTF extras: the water).
 */
function standardMaterials(root: Object3D): MeshStandardMaterial[] {
  const out = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m instanceof MeshStandardMaterial && (!m.lightMap || m.userData.envScale !== undefined))
        out.add(m);
  });
  return [...out];
}

/**
 * The world's animated centrepiece (the House of Wisdom's courtyard armillary sphere; its own GLB, in the hall's metre group). The baked hall lights
 * nothing that moves, so the brass reflects a PMREM of three's RoomEnvironment (no files), dimmed
 * with the mood: metal reads as metal, neither black nor chrome. The cage, sun and moon turn on
 * the engine clock (the world's CentrepieceMotion; the armillary's is src/world/armillary.ts); everything else stays as baked.
 */
export function Centrepiece(props: {
  root: Object3D;
  /** Named nodes to turn and how (from the world definition). */
  motion: CentrepieceMotion;
  /** Live mood mix, 0 golden .. 1 dusk. */
  moodRef: { current: number };
  exposure: number;
}) {
  const { root, motion, moodRef, exposure } = props;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const materials = useMemo(() => standardMaterials(root), [root]);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, ENV_SIGMA).texture;
    room.dispose();
    for (const m of materials) {
      m.envMap = env;
      m.needsUpdate = true;
    }
    invalidate();
    return () => {
      for (const m of materials) {
        m.envMap = null;
        m.needsUpdate = true;
      }
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, materials, invalidate]);

  const moving = useMemo(
    () =>
      motion.moving.flatMap((name) => {
        const node = root.getObjectByName(name);
        return node ? [{ name, node, rest: node.quaternion.clone() }] : [];
      }),
    [root, motion],
  );
  useEffect(() => {
    if (import.meta.env.DEV && moving.length !== motion.moving.length)
      console.warn('Centrepiece: a moving node is missing; did the bake change?');
  }, [moving, motion]);

  const time = useRef(0);
  const sinceDraw = useRef(0);
  const turn = useMemo(() => new Quaternion(), []);
  useEngineTick((dt) => {
    time.current += dt;
    const angles = motion.angles(time.current);
    for (const { name, node, rest } of moving)
      node.quaternion.copy(rest).multiply(turn.setFromAxisAngle(UP, angles[name]));
    const env = motion.envIntensity(moodRef.current) * exposure;
    // a material may reflect more of the room than the rest (glTF extras: the pool's water)
    for (const m of materials) m.envMapIntensity = env * ((m.userData.envScale as number) ?? 1);
    if (moving.length === 0) return; // a still centrepiece: nothing to redraw
    sinceDraw.current += dt;
    if (sinceDraw.current >= REDRAW_SEC) {
      sinceDraw.current = 0;
      invalidate();
    }
  });

  return <primitive object={root} />;
}
