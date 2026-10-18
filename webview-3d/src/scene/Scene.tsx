import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import { PCFShadowMap, Sphere, Vector2, Vector3 } from 'three';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { reportWorldLoaded } from '../debug.js';
import { CUTS } from '../promo/cuts.js';
import { PromoRig } from '../promo/PromoRig.tsx';
import { promoCut } from '../promo/promoMode.js';
import { promoDemo, promoSegment } from '../transport/index.js';
import { CameraRig } from '../camera/CameraRig.tsx';
import { EngineProvider, useEngineStats, useEngineTick } from '../engine/EngineProvider.tsx';
import type { FeedEntry } from '../board/feed.js';
import { setHover } from '../inspect/hoverStore.js';
import type { AgentInfo } from '../grammar/label.js';
import { driveIdleAgents } from '../agents/idleDirectorStore.js';
import { AlcoveLamps, lampStateForSeat } from '../world/AlcoveLamps.tsx';
import type { MoodSetting } from '../world/mood.js';
import { advanceIdle, anyAgentActive, stepMix, targetMood } from '../world/mood.js';
import { PostStack, TILT_FOCUS_WIDE } from '../world/PostStack.tsx';
import type { Quality } from '../world/quality.js';
import { profileFor, qualityFromSearch, stepDown } from '../world/quality.js';
import { WorldSkin } from '../world/WorldSkin.tsx';
import type { WorldAssets, WorldDefinition } from '../worlds/types.js';
import { AgentAvatar } from './AgentAvatar.tsx';
import { DebugBridge } from './DebugBridge.tsx';
import { GreyboxWorld } from './GreyboxWorld.tsx';
import { pixelToWorld } from './coords.js';
import { Workstations } from './Workstations.tsx';
import { WorldBoard } from './WorldBoard.tsx';
import { useCharacterIds } from './useCharacterIds.js';

function Agents(props: {
  getOfficeState: () => OfficeState;
  infoFor: (id: number) => AgentInfo;
  onSelect: (id: number) => void;
  rootRef: { current: Group | null };
  visible: boolean;
}) {
  const ids = useCharacterIds(props.getOfficeState);
  return (
    <group ref={props.rootRef} visible={props.visible}>
      {ids.map((id) => (
        <group
          key={id}
          userData={{ figureId: id }}
          onClick={(e) => {
            e.stopPropagation();
            props.onSelect(id);
          }}
        >
          <AgentAvatar id={id} getOfficeState={props.getOfficeState} info={props.infoFor(id)} />
        </group>
      ))}
    </group>
  );
}

/** Hover pick: a figure's rough body, in tiles, used to skip the mesh raycast for everyone else. */
const PICK_RADIUS = 1.1;
const PICK_CENTRE_Y = 0.6;
/** The pointer is looked at no more often than this, and not at all while it is still. */
export const HOVER_THROTTLE_MS = 50;

/**
 * Pointer cursor and hover peek. Not R3F's own pointer events, which would raycast the skinned
 * figures on every pointer move: this looks at the pointer at most every 50 ms, and a cheap
 * sphere test goes first. Touch has no hover; the camera never moves from here.
 */
function HoverPicker(props: {
  rootRef: { current: Group | null };
  getOfficeState: () => OfficeState;
}) {
  const { rootRef, getOfficeState } = props;
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);

  useEffect(() => {
    const el = gl.domElement;
    const ndc = new Vector2();
    const sphere = new Sphere();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let at = { x: 0, y: 0 };

    const pick = () => {
      timer = null;
      last = performance.now();
      const root = rootRef.current;
      if (!root) return;
      const rect = el.getBoundingClientRect();
      ndc.set(
        ((at.x - rect.left) / rect.width) * 2 - 1,
        -((at.y - rect.top) / rect.height) * 2 + 1,
      );
      camera.updateMatrixWorld();
      raycaster.setFromCamera(ndc, camera);
      let best: { id: number; distance: number } | null = null;
      for (const group of root.children) {
        const id = group.userData['figureId'] as number | undefined;
        const ch = id === undefined ? undefined : getOfficeState().characters.get(id);
        if (id === undefined || !ch) continue;
        const [x, , z] = pixelToWorld(ch.x, ch.y);
        sphere.set(new Vector3(x, PICK_CENTRE_Y, z), PICK_RADIUS * (ch.isSubagent ? 0.75 : 1));
        if (!raycaster.ray.intersectsSphere(sphere)) continue;
        const hit = raycaster.intersectObject(group, true)[0];
        if (hit && (!best || hit.distance < best.distance)) best = { id, distance: hit.distance };
      }
      el.style.cursor = best ? 'pointer' : '';
      setHover(best ? { id: best.id, x: at.x, y: at.y } : null);
    };
    const clear = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      el.style.cursor = '';
      setHover(null);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (e.buttons !== 0) return clear(); // dragging the camera, not hovering
      at = { x: e.clientX, y: e.clientY };
      if (timer === null) {
        timer = setTimeout(pick, Math.max(0, HOVER_THROTTLE_MS - (performance.now() - last)));
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('pointerdown', clear);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', clear);
      el.removeEventListener('pointerdown', clear);
      clear();
    };
  }, [gl, camera, raycaster, rootRef, getOfficeState]);

  return null;
}

/**
 * Advances the golden/dusk mix on the engine clock: dusk after 20 s with no active agent (auto),
 * or as set. Writes the shared ref; the canvas is only invalidated while the mix is moving.
 */
function MoodDriver(props: {
  setting: MoodSetting;
  getOfficeState: () => OfficeState;
  mixRef: { current: number };
}) {
  const { setting, getOfficeState, mixRef } = props;
  const invalidate = useThree((s) => s.invalidate);
  const idle = useRef(0);
  useEngineTick((dt) => {
    idle.current = advanceIdle(idle.current, anyAgentActive(getOfficeState().getCharacters()), dt);
    const target = targetMood(setting, idle.current) === 'dusk' ? 1 : 0;
    const next = stepMix(mixRef.current, target, dt);
    if (next !== mixRef.current) {
      mixRef.current = next;
      invalidate();
    }
  });
  return null;
}

/** Sends idle scholars to the hall's points of interest on the engine clock. */
function IdleDirector(props: { getOfficeState: () => OfficeState; world: WorldDefinition }) {
  const { getOfficeState, world } = props;
  const invalidate = useThree((s) => s.invalidate);
  // Redraw every tick while anyone is out: the going->doing flip and the conversation turns
  // change nothing the engine signature sees, so they would otherwise draw late or never.
  useEngineTick((dt) => {
    if (driveIdleAgents(getOfficeState(), world.pointsOfInterest, Math.min(dt, 0.1))) invalidate();
  });
  return null;
}

/** Frames only exist while something changes, so a slow monitor window is only a signal when the scene was busy throughout. */
const BUSY_WINDOW_MS = 3000;

function QualityGovernor({ onDecline }: { onDecline: () => void }) {
  const stats = useEngineStats();
  return (
    <PerformanceMonitor
      onDecline={() => {
        if (performance.now() - stats.lastQuietAt > BUSY_WINDOW_MS) onDecline();
      }}
    />
  );
}

export function Scene(props: {
  getOfficeState: () => OfficeState;
  world: WorldDefinition;
  infoFor: (id: number) => AgentInfo;
  feed: FeedEntry[];
  mood: MoodSetting;
  director: boolean;
  /** The figure the camera holds on (and whose card is open), or null. */
  focusId: number | null;
  onSelect: (id: number) => void;
  /** Empty floor was clicked: close the card and release the camera. */
  onClear: () => void;
  /** The focused figure left the hall: release the camera (the card decides when it closes). */
  onFocusLost: () => void;
}) {
  const { world, focusId, onClear } = props;
  const { cols, rows } = world.floorPlan;
  const cx = cols / 2;
  const cz = rows / 2;

  const [assets, setAssets] = useState<WorldAssets | null>(null);
  const [skinReady, setSkinReady] = useState(false);
  const [quality, setQuality] = useState<Quality>(() => qualityFromSearch(window.location.search));
  const profile = profileFor(quality);
  const declineQuality = useCallback(() => setQuality(stepDown), []);
  // Mood mix (0 golden .. 1 dusk) and the tilt-shift band are shared mutable values: they change
  // every tick during a transition, which must not re-render React.
  const mixRef = useRef(props.mood === 'dusk' ? 1 : 0);
  const tiltRef = useRef(TILT_FOCUS_WIDE);
  const agentsRoot = useRef<Group>(null);

  useEffect(() => {
    let alive = true;
    world
      .assets?.()
      .then((a) => alive && setAssets(a))
      .catch((e: unknown) => console.error('World assets unavailable; using the grey box.', e));
    return () => {
      alive = false;
    };
  }, [world]);

  // The grey box keeps M0's camera and lights; a skinned world brings its own.
  useEffect(() => {
    reportWorldLoaded(skinReady);
  }, [skinReady]);

  // `?bench=1` renders every frame (perf.mjs measures frame time); normally frames are on demand.
  const bench = new URLSearchParams(window.location.search).has('bench');
  // `?figures=0` hides the figures (look-dev stills of a world whose costumes are not built yet);
  // they still run, so the HUD, the lamps and the frame-time load are those of a live room.
  const showFigures = new URLSearchParams(window.location.search).get('figures') !== '0';

  // ?promo=<cut> (demo only): scripted camera, manual clock, no controls (src/promo)
  const promo = promoCut !== null && promoSegment !== null && promoDemo !== null;

  const pose = world.camera ?? null;
  const position = pose?.position ?? [cx, 15, rows + 9];
  const target = pose?.target ?? [cx, 0, cz];

  return (
    <Canvas
      // Explicit type: the r3f default PCFSoftShadowMap is deprecated in three r185. PCFShadowMap
      // is the cheapest filtered type and, unlike VSM, has no light bleeding on the gobo sun
      // or on thin desk/lamp casters.
      shadows={{ type: PCFShadowMap }}
      frameloop={promo ? 'never' : bench ? 'always' : 'demand'}
      dpr={profile.dpr}
      gl={{ antialias: false }}
      camera={{ position, fov: pose?.fov ?? 45, near: 0.1, far: 200 }}
      className="scene"
      onPointerMissed={onClear}
    >
      <color attach="background" args={['#15120e']} />
      <EngineProvider getOfficeState={props.getOfficeState}>
        <IdleDirector getOfficeState={props.getOfficeState} world={world} />
        {!promo && (
          <MoodDriver setting={props.mood} getOfficeState={props.getOfficeState} mixRef={mixRef} />
        )}
        {!skinReady && (
          <>
            <hemisphereLight args={['#fff1d6', '#2b2318', 0.7]} />
            <directionalLight
              position={[cx + 8, 18, -4]}
              intensity={1.8}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-15}
              shadow-camera-right={15}
              shadow-camera-top={15}
              shadow-camera-bottom={-15}
            />
            <GreyboxWorld layout={world.floorPlan} />
          </>
        )}
        {assets && (
          <WorldSkin
            assets={assets}
            render={world.render}
            profile={profile}
            moodRef={mixRef}
            gridTiles={{ cols, rows }}
            onReady={() => setSkinReady(true)}
          />
        )}
        {skinReady && assets ? (
          <group scale={1 / assets.tileMeters}>
            <AlcoveLamps
              practicals={assets.practicals}
              moodRef={mixRef}
              // hidden figures (look-dev stills) leave their seats' lamps unlit, signal included
              lampStateFor={(uid) =>
                showFigures ? lampStateForSeat(props.getOfficeState().getCharacters(), uid) : 'off'
              }
            />
          </group>
        ) : (
          <Workstations getOfficeState={props.getOfficeState} />
        )}
        {skinReady && assets && (
          <DebugBridge
            getOfficeState={props.getOfficeState}
            mixRef={mixRef}
            practicals={assets.practicals}
            k={1 / assets.tileMeters}
            wide={{ pos: position, target, fov: pose?.fov ?? 45 }}
            lookDev={world.lookDev}
            centreZ={rows / 2}
          />
        )}
        {world.board && (
          <WorldBoard entries={props.feed} placement={world.board} worldId={world.id} />
        )}
        <Agents
          getOfficeState={props.getOfficeState}
          infoFor={props.infoFor}
          onSelect={props.onSelect}
          rootRef={agentsRoot}
          visible={showFigures}
        />
        <HoverPicker rootRef={agentsRoot} getOfficeState={props.getOfficeState} />
        {skinReady && <PostStack profile={profile} moodRef={mixRef} focusRef={tiltRef} />}
        {promo ? (
          skinReady &&
          assets &&
          promoSegment &&
          promoDemo && (
            <PromoRig
              getOfficeState={props.getOfficeState}
              segment={promoSegment}
              fps={CUTS[promoCut ?? '']?.fps ?? 30}
              advanceTransport={(ms) => promoDemo?.advanceTo(ms)}
              practicals={assets.practicals}
              k={1 / assets.tileMeters}
              centreZ={rows / 2}
              mixRef={mixRef}
              focusRef={tiltRef}
            />
          )
        ) : (
          <>
            <CameraRig
              getOfficeState={props.getOfficeState}
              home={{ target, distance: Math.hypot(...position.map((p, i) => p - target[i])) }}
              fov={pose?.fov ?? 45}
              focusId={focusId}
              onFocusLost={props.onFocusLost}
              director={props.director}
              focusRef={tiltRef}
            />
            <QualityGovernor onDecline={declineQuality} />
          </>
        )}
      </EngineProvider>
      {!promo && (
        <OrbitControls
          makeDefault
          target={target}
          maxPolarAngle={Math.PI / 2.3}
          minDistance={pose ? 8 : 6}
          maxDistance={pose ? 48 : 45}
          {...(pose ? { minAzimuthAngle: -0.7, maxAzimuthAngle: 0.7 } : {})}
          enableDamping
        />
      )}
    </Canvas>
  );
}
