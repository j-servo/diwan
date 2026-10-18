import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Object3D, ShaderMaterial } from 'three';
import { Mesh, MeshStandardMaterial } from 'three';

import { useEngineTick } from '../engine/EngineProvider.tsx';
import type { PoolFxConfig } from '../worlds/types.js';
import {
  addCaustics,
  applyCausticsMood,
  applyWaterMood,
  createCausticsUniforms,
  createWaterMaterial,
  poolNumbers,
  type WaterUniforms,
} from './poolWater.js';
import { prefersReducedMotion } from './reducedMotion.js';

/** The pool is slow water: 30 Hz reads the same as 60 and halves the redraws. */
const REDRAW_SEC = 1 / 30;
/** The lilies rise and fall a hand's breadth of a millimetre-scale swell, metres. */
const BOB_Y = 0.007;
const BOB_DRIFT = 0.006;

function materialsOf(root: Object3D): MeshStandardMaterial[] {
  const out = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m instanceof MeshStandardMaterial) out.add(m);
  });
  return [...out];
}

/**
 * The pool of Nun's life, on the engine clock (so deterministic under `?frames`): the water shader,
 * caustics on the pool's stone, the lilies' slow bobbing and the gold pyramidion's dusk glow.
 * Runs on the centrepiece GLB (the pyramid, its pool, water, lilies and reeds).
 */
export function PoolFx(props: {
  root: Object3D;
  config: PoolFxConfig;
  moodRef: { current: number };
}) {
  const { root, config, moodRef } = props;
  const invalidate = useThree((s) => s.invalidate);
  const water = useRef<{ uniforms: WaterUniforms; mesh: Mesh } | null>(null);
  const caustics = useMemo(() => createCausticsUniforms(-0.16), []);

  // the water sheet becomes a shader of its own
  useEffect(() => {
    const mesh = root.getObjectByName(config.waterNode);
    if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) return;
    const original = mesh.material;
    const pool = poolNumbers(original.userData);
    if (!pool) {
      console.warn('PoolFx: the water material lacks its pool numbers; keeping the baked water.');
      return;
    }
    caustics.uCausWaterY.value = pool.waterY;
    const { material, uniforms } = createWaterMaterial(pool, config.lamps);
    mesh.material = material as ShaderMaterial;
    mesh.onBeforeRender = (_r, _s, camera) => {
      uniforms.uCam.value.copy(camera.position);
      mesh.worldToLocal(uniforms.uCam.value);
    };
    mesh.renderOrder = 2;
    water.current = { uniforms, mesh };
    invalidate();
    return () => {
      mesh.material = original;
      mesh.onBeforeRender = () => undefined;
      material.dispose();
      water.current = null;
    };
  }, [root, config, caustics, invalidate]);

  // caustics on the pool's stone (below the water line only)
  useEffect(() => {
    const undo = materialsOf(root)
      .filter((m) => config.causticMaterials.includes(m.name))
      .map((m) => addCaustics(m, caustics));
    invalidate();
    return () => undo.forEach((u) => u());
  }, [root, config, caustics, invalidate]);

  const lilies = useMemo(
    () =>
      collect(root, config.lilyPrefix).map((node, i) => ({
        node,
        y: node.position.y,
        x: node.position.x,
        z: node.position.z,
        phase: i * 1.9 + 0.7,
      })),
    [root, config.lilyPrefix],
  );
  const glowing = useMemo(
    () => materialsOf(root).filter((m) => typeof m.userData.duskGlow === 'number'),
    [root],
  );

  const time = useRef(0);
  const sinceDraw = useRef(0);
  useEngineTick((dt) => {
    time.current += dt;
    const t = time.current;
    const mix = moodRef.current;
    const w = water.current;
    if (w) {
      w.uniforms.uTime.value = t;
      applyWaterMood(w.uniforms, mix);
    }
    caustics.uCausTime.value = t;
    applyCausticsMood(caustics, mix);
    const amp = prefersReducedMotion() ? 0 : 1;
    for (const l of lilies) {
      l.node.position.y = l.y + amp * BOB_Y * Math.sin(t * 0.9 + l.phase);
      l.node.position.x = l.x + amp * BOB_DRIFT * Math.sin(t * 0.37 + l.phase * 1.3);
      l.node.position.z = l.z + amp * BOB_DRIFT * Math.cos(t * 0.31 + l.phase);
    }
    // the gold pyramidion glows softly towards dusk
    for (const m of glowing) m.emissiveIntensity = 1 + (m.userData.duskGlow as number) * mix;
    sinceDraw.current += dt;
    if (sinceDraw.current >= REDRAW_SEC) {
      sinceDraw.current = 0;
      invalidate();
    }
  });
  return null;
}

function collect(root: Object3D, prefix: string): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((o) => {
    if (o.name.startsWith(prefix)) out.push(o);
  });
  return out;
}
