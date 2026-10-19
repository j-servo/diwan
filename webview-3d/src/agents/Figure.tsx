import { useThree } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { Group, Material, Mesh, Object3D } from 'three';
import { AnimationMixer, CanvasTexture, LoopOnce, LoopRepeat } from 'three';
import type { MeshPhysicalMaterial, MeshStandardMaterial } from 'three';
import type { AnimationAction } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { MATRIX_EFFECT_DURATION_SEC } from '../../../webview-ui/src/constants.js';
import { isWalkable } from '../../../webview-ui/src/office/layout/tileMap.js';
import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';
import { toVisualState } from '../grammar/visualState.js';
import { directionToRotationY, pixelToWorld } from '../scene/coords.js';
import type { Clip, Prop } from './clipFor.js';
import { clipFor } from './clipFor.js';
import {
  FIGURE_MAX_MPS,
  TILE_METERS,
  applyCostume,
  figureNeedsFrame,
  ROBE_OVERRIDES,
  followStep,
  stripLoaderSuffix,
  trimColor,
  walkTimeScale,
} from './figureLogic.js';
import { forgetFigurePosition, reportFigurePosition, trackFigure } from '../debug.js';
import { activeWorld } from '../worlds/registry.js';
import type { FigureAssets } from './loadFigures.js';
import { ambientActivityFor } from './idleDirectorStore.js';
import { patchInkDissolve } from './inkDissolve.js';
import { headingTowards } from './pathSmoothing.js';
import { backlog, catchUpBoost, newTrail, pushTile, walkQueue } from './trail.js';
import type { Trail } from './trail.js';
import { figureFill, getProbeGrid } from './probeStore.js';
import { sampleProbe } from './probes.js';

/** Linen garments (House of Life figures only; no House of Wisdom material has these names) and
 * the extra self-lift that keeps them reading white in the court's shade. */
const LINEN_MATERIALS = new Set(['kilt', 'dress', 'shirt', 'sash']);
const LINEN_LIFT = 0.07;

const K = 1 / TILE_METERS; // figures are authored in metres; the world is in tiles
const FADE = 0.25;
const SIT_DOWN_SEC = 1.8;
const STAND_UP_SEC = 1.6;
const ARRIVE = 0.03; // world units
const DISSOLVE_SEC = 0.25; // each half of a cross-fade when no walkable route exists
// Desk near edge is 0.3 m ahead of the cushion centre, top at 0.45 m (figures.meta.json seated).
const CANDLE_AT: [number, number, number] = [-0.5, 0.45, 0.6];
const WAX_BASE_Y = 0.024;
const WAX_HEIGHT = 0.11;

const PROP_NAMES: Prop[] = [
  'prop_reed_pen',
  'prop_codex',
  'prop_astrolabe',
  'prop_scroll',
  'prop_letter',
];

let blobTexture: CanvasTexture | null = null;
function getBlobTexture(): CanvasTexture {
  if (blobTexture) return blobTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  blobTexture = new CanvasTexture(c);
  return blobTexture;
}

interface Rig {
  root: Group;
  mixer: AnimationMixer;
  actions: Map<string, AnimationAction>;
  props: Map<string, Object3D>;
  trim: MeshStandardMaterial[];
  materials: MeshStandardMaterial[];
  dissolves: { setProgress(p: number): void }[];
  meshes: Mesh[];
  wax: Object3D | null;
  flame: Object3D | null;
  candle: Object3D | null;
}

function buildRig(assets: FigureAssets, subagent: boolean): Rig {
  const root = cloneSkinned(
    assets.scene.getObjectByName(subagent ? 'apprentice' : 'scholar')!,
  ) as Group;
  // Clips bind by node name: the loader suffixed whichever rig came second (the scholar, in
  // practice), so strip suffixes on every clone.
  root.traverse((o) => (o.name = stripLoaderSuffix(o.name)));
  const materials: MeshStandardMaterial[] = [];
  const trim: MeshStandardMaterial[] = [];
  const meshes: Mesh[] = [];
  const props = new Map<string, Object3D>();
  root.traverse((o) => {
    if (PROP_NAMES.includes(o.name as Prop)) {
      props.set(o.name, o);
      o.visible = false;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    const own = (mesh.material as Material).clone() as MeshStandardMaterial;
    mesh.material = own;
    materials.push(own);
    if (own.name === 'trim') trim.push(own);
    const robe = ROBE_OVERRIDES[own.name];
    if (robe) {
      own.color.set(robe.base);
      (own as MeshPhysicalMaterial).sheenColor?.set(robe.sheen);
    }
    mesh.receiveShadow = true;
    mesh.castShadow = true;
  });
  const dissolves = materials.map((m) => patchInkDissolve(m));
  const mixer = new AnimationMixer(root);
  const actions = new Map<string, AnimationAction>();
  for (const [name, c] of assets.clips) actions.set(name, mixer.clipAction(c));
  const candle = assets.scene.getObjectByName('candle')?.clone(true) ?? null;
  return {
    root,
    mixer,
    actions,
    props,
    trim,
    materials,
    dissolves,
    meshes,
    wax: candle?.getObjectByName('candle_wax') ?? null,
    flame: candle?.getObjectByName('candle_flame') ?? null,
    candle,
  };
}

interface Runtime {
  x: number;
  z: number;
  yaw: number;
  seated: boolean;
  lockUntil: number;
  clip: Clip | 'sit_down' | 'stand_up' | null;
  time: number;
  speed: number;
  init: boolean;
  fadeUntil: number;
  accum: number;
  trimKey: number;
  costumeKey: string;
  /** Engine tiles still to walk, in order. */
  trail: Trail | null;
  /** Cross-fade when the engine character jumped with no walkable route: out, snap, in. */
  fade: { t: number; to: [number, number] } | null;
}

/**
 * A robed scholar (agents) or apprentice (subagents) following one engine character. The
 * engine clock drives everything: render position chases the engine tile at a walking pace,
 * clips follow the visual grammar once the figure actually reaches its seat.
 */
export function Figure(props: {
  id: number;
  getOfficeState: () => OfficeState;
  assets: FigureAssets;
  isSubagent: boolean;
  /** The persona title ("Lector"); picks the garments in a world with costumes. */
  persona?: string;
  /** Overlays (bubble, beacon) follow the figure's position but not its yaw. */
  children?: (height: number) => ReactNode;
}) {
  const { id, getOfficeState, assets, isSubagent, persona } = props;
  const personaRef = useRef(persona);
  personaRef.current = persona;
  const invalidate = useThree((s) => s.invalidate);
  const scene = useThree((s) => s.scene);
  const rig = useMemo(() => buildRig(assets, isSubagent), [assets, isSubagent]);
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const blob = useRef<Mesh>(null);
  const rt = useRef<Runtime>({
    x: 0,
    z: 0,
    yaw: 0,
    seated: false,
    lockUntil: 0,
    clip: null,
    time: 0,
    speed: 0,
    init: false,
    fadeUntil: 0,
    accum: 0,
    trimKey: -1,
    costumeKey: '',
    trail: null,
    fade: null,
  });
  const height = isSubagent ? 1.3 : 1.5;

  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
      rig.materials.forEach((m) => m.dispose());
    },
    [rig],
  );

  useEffect(() => trackFigure(), []);
  useEffect(() => () => forgetFigurePosition(id), [id]);

  const play = (name: Clip | 'sit_down' | 'stand_up', once: boolean) => {
    const r = rt.current;
    if (r.clip === name) return;
    const next = rig.actions.get(name);
    if (!next) return;
    const prev = r.clip ? rig.actions.get(r.clip) : null;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    if (prev) next.crossFadeFrom(prev, FADE, false);
    next.play();
    r.clip = name;
    r.fadeUntil = r.time + FADE;
  };

  useEngineTick((rawDt) => {
    const os = getOfficeState();
    const ch = os.characters.get(id);
    const g = outer.current;
    if (!ch || !g) return;
    const r = rt.current;
    const dt = Math.min(rawDt, 0.1);
    r.time += dt;
    const [tx, , tz] = pixelToWorld(ch.x, ch.y);
    const v = toVisualState(ch);
    const seat = ch.seatId ? os.seats.get(ch.seatId) : undefined;
    const onSeat =
      !!seat && Math.hypot(tx - (seat.seatCol + 0.5), tz - (seat.seatRow + 0.5)) < 0.05;

    if (!r.init) {
      r.x = tx;
      r.z = tz;
      r.yaw = directionToRotationY(ch.dir);
      r.seated = onSeat;
    }

    // Walk the tiles the engine character walked, in order (never a straight line to where it is
    // now, which cuts across the pool); frozen while standing up from the cushion.
    if (!r.trail) r.trail = newTrail(ch.tileCol, ch.tileRow);
    const trail = r.trail;
    if (!r.fade && (ch.tileCol !== trail.col || ch.tileRow !== trail.row)) {
      const seatTiles = new Set<string>();
      for (const s of os.seats.values()) seatTiles.add(`${s.seatCol},${s.seatRow}`);
      const walkable = (c: number, rw: number) =>
        isWalkable(c, rw, os.tileMap, os.blockedTiles) || seatTiles.has(`${c},${rw}`);
      if (pushTile(trail, ch.tileCol, ch.tileRow, walkable) === 'dissolve') {
        r.fade = { t: 0, to: [tx, tz] };
      }
    }
    const locked = r.time < r.lockUntil;
    let stepLen = 0;
    if (r.fade) {
      // ink-dissolve out, snap to the engine, dissolve back in
      const f = r.fade;
      const before = f.t;
      f.t += dt;
      if (before < DISSOLVE_SEC && f.t >= DISSOLVE_SEC) {
        r.x = tx;
        r.z = tz;
        trail.queue.length = 0;
      }
      if (f.t >= 2 * DISSOLVE_SEC) r.fade = null;
    } else if (!locked) {
      let nx: number;
      let nz: number;
      if (trail.queue.length) {
        const behind = backlog([r.x, r.z], trail.queue, [tx, tz]);
        const speed = (FIGURE_MAX_MPS / TILE_METERS) * catchUpBoost(behind);
        [nx, nz] = walkQueue([r.x, r.z], trail.queue, dt, speed);
      } else {
        [nx, nz] = followStep([r.x, r.z], [tx, tz], dt, FIGURE_MAX_MPS / TILE_METERS);
      }
      stepLen = Math.hypot(nx - r.x, nz - r.z);
      if (stepLen > 1e-5) r.yaw = headingTowards([r.x, r.z], [nx, nz], r.yaw, dt);
      r.x = nx;
      r.z = nz;
    }
    const dist = Math.hypot(tx - r.x, tz - r.z);
    const arrived = dist < ARRIVE && !r.fade && trail.queue.length === 0;
    if (arrived && !locked) {
      r.x = tx;
      r.z = tz;
    }
    const instSpeed = dt > 0 ? (stepLen / dt) * TILE_METERS : 0;
    r.speed += (instSpeed - r.speed) * Math.min(1, dt * 10);

    const seated = arrived && onSeat;
    // Out at a point of interest (idle director): only while genuinely idle and standing there.
    const ambient =
      arrived && !seated && v.pose === 'idle' && v.signal === null && v.toolKind === null
        ? ambientActivityFor(id)
        : null;
    if (seated || ambient) {
      // Face the desk (or the shelf, water, board, partner), turning at the capped rate.
      const want =
        directionToRotationY(ambient ? ambient.facing : ch.dir) +
        (ambient && ambient.sway > 0 ? Math.sin(r.time * 0.7) * ambient.sway : 0);
      r.yaw = headingTowards([0, 0], [Math.sin(want), Math.cos(want)], r.yaw, dt);
    }
    if (!r.init) {
      r.init = true;
    } else if (seated && !r.seated) {
      play('sit_down', true);
      r.lockUntil = r.time + SIT_DOWN_SEC;
    } else if (!seated && r.seated) {
      play('stand_up', true);
      r.lockUntil = r.time + STAND_UP_SEC;
    }
    r.seated = seated;

    if (r.time >= r.lockUntil) {
      const desired = !arrived
        ? { clip: 'walk' as Clip, prop: null }
        : (ambient ?? clipFor(v, seated));
      play(desired.clip, false);
      for (const p of PROP_NAMES) {
        const n = rig.props.get(p);
        if (n) n.visible = p === desired.prop;
      }
    } else {
      rig.props.forEach((n) => (n.visible = false));
    }
    if (r.clip === 'walk') {
      const a = rig.actions.get('walk');
      if (a) a.timeScale = walkTimeScale(r.speed);
    }
    rig.mixer.update(dt);

    g.position.set(r.x, 0, r.z);
    reportFigurePosition(id, r.x, r.z);
    if (inner.current) inner.current.rotation.y = r.yaw;

    // Ink dissolve replaces M0's scale effect; the shadow pass cannot discard, so no shadow.
    const p = Math.min(1, ch.matrixEffectTimer / MATRIX_EFFECT_DURATION_SEC);
    const fadeVisible = r.fade
      ? Math.abs(r.fade.t - DISSOLVE_SEC) / DISSOLVE_SEC // 1 -> 0 -> 1
      : 1;
    const visible =
      (v.effect === 'spawn' ? p : v.effect === 'despawn' ? 1 - p : 1) * Math.min(1, fadeVisible);
    const dissolving = v.effect !== null || r.fade !== null;
    rig.dissolves.forEach((d) => d.setProgress(visible));
    for (const m of rig.meshes) m.castShadow = !dissolving;
    if (blob.current) {
      blob.current.visible = visible > 0.05;
      blob.current.scale.setScalar(visible);
    }

    // Candle gauge on the desk, only while seated.
    if (rig.candle) {
      const show = r.seated && r.time >= r.lockUntil && v.contextRatio !== null;
      rig.candle.visible = show;
      if (show && rig.wax && v.contextRatio !== null) {
        const s = Math.max(v.contextRatio, 0.04);
        rig.wax.scale.y = s;
        if (rig.flame) rig.flame.position.y = WAX_BASE_Y + WAX_HEIGHT * s;
      }
    }

    // Trim colour: a subagent wears its parent's. Only touched when the palette changes.
    const parent = ch.parentAgentId !== null ? os.characters.get(ch.parentAgentId) : undefined;
    const palette = (parent ?? ch).palette;
    if (palette !== r.trimKey) {
      r.trimKey = palette;
      rig.trim.forEach((m) => m.color.set(trimColor(palette)));
    }
    // Garments by persona (only in a world with a costume set): re-applied when either changes.
    const costume = activeWorld().costume;
    const costumeKey = `${personaRef.current ?? ''}|${palette}`;
    if (costume && costumeKey !== r.costumeKey) {
      r.costumeKey = costumeKey;
      applyCostume(rig.materials, costume(personaRef.current ?? '', palette, isSubagent));
    }

    // Ambient from the probe grid: scene environment scaled by local irradiance (floored so
    // shade stays readable), plus a small probe-tinted emissive lift in shade.
    const grid = getProbeGrid();
    const env = scene.environment;
    if (grid && env) {
      const fill = figureFill(sampleProbe(grid, r.x, r.z));
      for (const m of rig.materials) {
        if (!m.envMap) {
          m.envMap = env;
          m.needsUpdate = true;
        }
        m.envMapIntensity = 0.9 * fill.envScale;
        m.emissive.setRGB(fill.tint[0], fill.tint[1], fill.tint[2]);
        // white linen (the House of Life's kilts, dresses, shirts and sashes) stays white in shade
        m.emissiveIntensity = LINEN_MATERIALS.has(m.name) ? fill.lift + LINEN_LIFT : fill.lift;
      }
    }
    const busy =
      locked || !arrived || stepLen > 0 || dissolving || r.time < r.fadeUntil || r.time < 0.5;
    const frame = figureNeedsFrame(busy, r.accum, dt);
    r.accum = frame.accum;
    if (frame.invalidate) invalidate();
  });

  return (
    <group ref={outer}>
      <group ref={inner}>
        <group scale={K}>
          <primitive object={rig.root} />
          {rig.candle && (
            <group position={CANDLE_AT}>
              <primitive object={rig.candle} />
            </group>
          )}
        </group>
      </group>
      <mesh ref={blob} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={1}>
        <planeGeometry args={[0.8, 0.8]} />
        <meshBasicMaterial
          map={getBlobTexture()}
          transparent
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
      {props.children?.(height)}
    </group>
  );
}
