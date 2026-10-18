import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointLight } from 'three';
import { Color, SpotLight } from 'three';

import { buildProbeGrid } from '../agents/probes.js';
import { setProbeGrid } from '../agents/probeStore.js';
import { setNoticeBoardNode } from '../board/noticeBoardNode.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';
import type { WorldAssets, WorldRender } from '../worlds/types.js';
import { Centrepiece } from './Centrepiece.tsx';
import { PoolFx } from './PoolFx.tsx';
import { TitleGlow } from './TitleGlow.tsx';
import { DustMotes, LightShafts, PalmSway } from './Atmosphere.tsx';
import { hallAtmosphere } from './hallLayout.js';
import type { LoadedWorld } from './loadWorldAssets.js';
import { loadWorldAssets } from './loadWorldAssets.js';
import { moodLighting } from './mood.js';
import type { QualityProfile } from './quality.js';

/** The lightmaps carry the room's indirect light; the environment only lifts the figures (three r185 ignores envMapIntensity under scene.environment). */
const ENV_INTENSITY = 0.2;

/**
 * The baked hall: GLB + per-mood lightmaps on uv1, the gobo sun, practical lights and the
 * Lightformer environment live figures are lit by. Blender builds in metres; the group scales
 * to tiles (1 tile = tileMeters), so engine coordinates stay those of M0.
 */
export function WorldSkin(props: {
  assets: WorldAssets;
  /** The world's shadow names, light-source node and centrepiece motion. */
  render: WorldRender;
  profile: QualityProfile;
  /** Live mood mix, 0 = golden hour, 1 = dusk. Written by the mood driver, applied on engine ticks. */
  moodRef: { current: number };
  exposure?: number;
  /** Floor size in tiles, for the figure light-probe grid. */
  gridTiles: { cols: number; rows: number };
  onReady?: () => void;
}) {
  const { assets, render, profile, moodRef, exposure = 1, gridTiles, onReady } = props;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const [world, setWorld] = useState<LoadedWorld | null>(null);
  const k = 1 / assets.tileMeters;

  useEffect(() => {
    let alive = true;
    let loaded: LoadedWorld | null = null;
    loadWorldAssets(gl, assets, exposure, render.castsShadow)
      .then((w) => {
        if (!alive) return w.dispose();
        loaded = w;
        setNoticeBoardNode(w.root.getObjectByName('notice_board') ?? null);
        setWorld(w);
        onReady?.();
        invalidate();
      })
      .catch((e: unknown) => console.error('World assets failed; keeping the grey box.', e));
    return () => {
      alive = false;
      setNoticeBoardNode(null);
      loaded?.dispose();
    };
    // onReady is a one-shot notification; the load must not restart if its identity changes.
  }, [gl, assets, exposure, invalidate, render]);

  // Once the hall is in the scene (parented under the scaled group), probe it for figure ambient.
  useEffect(() => {
    if (!world) return;
    let alive = true;
    buildProbeGrid(gl, world.root, gridTiles.cols, gridTiles.rows, {
      tileMeters: assets.tileMeters,
    })
      .then((g) => {
        if (!alive) return;
        setProbeGrid(g);
        invalidate();
      })
      .catch((e: unknown) => console.error('Probe grid failed; figures keep flat ambient.', e));
    return () => {
      alive = false;
      setProbeGrid(null);
    };
  }, [world, gl, assets.tileMeters, gridTiles.cols, gridTiles.rows, invalidate]);

  const goldenSun = assets.moods.golden.sun;
  const duskSun = assets.moods.dusk.sun;
  const spot = useMemo(() => {
    if (!world) return null;
    const s = new SpotLight(
      new Color(...goldenSun.color),
      0,
      0,
      goldenSun.angle,
      goldenSun.penumbra,
      0,
    );
    s.position.set(...goldenSun.position);
    s.target.position.set(...goldenSun.target);
    s.map = world.gobo; // r185: works without castShadow (gotcha 8)
    s.castShadow = true;
    // Shadow camera units are world units (tiles), not the group's metres.
    s.shadow.camera.near = goldenSun.near * k;
    s.shadow.camera.far = goldenSun.far * k;
    s.shadow.bias = -0.0005;
    s.shadow.normalBias = 0.015 * k;
    return s;
  }, [world, goldenSun, k]);

  useEffect(() => {
    if (!spot) return;
    spot.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
    spot.shadow.map?.dispose();
    spot.shadow.map = null;
    invalidate();
  }, [spot, profile.shadowMapSize, invalidate]);

  // Mood: lightmap blend (shader uniform), the sun fading out towards a sun-less dusk, practicals
  // rising. Applied only when the mix moved, so a settled mood costs nothing per tick.
  const practicalLights = useRef<(PointLight | null)[]>([]);
  const applied = useRef(Number.NaN);
  const [shaftsOn, setShaftsOn] = useState(moodRef.current < 0.5);
  const applyMood = () => {
    const mix = moodRef.current;
    if (!world || !spot || mix === applied.current) return;
    applied.current = mix;
    const m = moodLighting(mix);
    world.setMood(mix);
    spot.intensity = goldenSun.intensity * m.sunIntensityScale * exposure;
    assets.practicals.forEach((p, i) => {
      const light = practicalLights.current[i];
      if (light) light.intensity = p.intensity * exposure * k * k * m.practicalScale;
    });
    setShaftsOn(mix < 0.5);
  };
  useEngineTick(applyMood);
  useEffect(() => {
    applied.current = Number.NaN; // a (re)loaded world starts from the current mix
    applyMood();
    invalidate();
    // applyMood closes over the refs and the values listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, spot, exposure, goldenSun, duskSun, invalidate]);

  const atmosphere = useMemo(
    () => (world ? hallAtmosphere(world.root, goldenSun, render.lightSourceNode) : null),
    [world, goldenSun, render],
  );

  if (!world || !spot) return null;
  return (
    <>
      <group scale={k}>
        <primitive object={world.root} />
        {world.armillary && render.centrepiece && (
          <Centrepiece
            root={world.armillary}
            motion={render.centrepiece}
            moodRef={moodRef}
            exposure={exposure}
          />
        )}
        {world.armillary && render.poolFx && (
          <PoolFx root={world.armillary} config={render.poolFx} moodRef={moodRef} />
        )}
        {render.titleGlow && (
          <TitleGlow root={world.root} node={render.titleGlow.node} moodRef={moodRef} />
        )}
        <primitive object={spot} />
        <primitive object={spot.target} />
        {assets.practicals.map((p, i) => (
          <pointLight
            key={p.id}
            ref={(l) => {
              practicalLights.current[i] = l;
            }}
            position={p.position}
            color={new Color(...p.color)}
            // Authored in metres: world falloff is measured in tiles inside the scaled group.
            intensity={p.intensity * exposure * k * k}
            distance={p.distance * k}
            decay={2}
          />
        ))}
        {atmosphere && (
          <>
            <LightShafts
              shafts={atmosphere.shafts}
              enabled={profile.atmosphere}
              mood={shaftsOn ? 0 : 1}
              moodRef={moodRef}
            />
            <DustMotes
              center={atmosphere.motes.center}
              size={atmosphere.motes.size}
              enabled={profile.atmosphere && shaftsOn}
              moodRef={moodRef}
            />
            <PalmSway root={world.root} palms={assets.palms} enabled={profile.atmosphere} />
          </>
        )}
      </group>
      <Environment resolution={64} frames={1} environmentIntensity={ENV_INTENSITY * exposure}>
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#ffe2bd"
          position={[0, 1.6, 7]}
          scale={[7, 3.5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.7}
          color="#ffc890"
          position={[0, -3, 1.5]}
          scale={[6, 6, 1]}
        />
      </Environment>
    </>
  );
}
