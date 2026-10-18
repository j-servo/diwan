import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useEngineTick } from '../engine/EngineProvider.js';
import type { PalmMeta } from '../worlds/assetMeta.js';

/** Shared clock uniform that advances on engine ticks and wakes the demand-driven canvas. */
function useTimeUniform(active = true): { value: number } {
  const invalidate = useThree((s) => s.invalidate);
  const uTime = useRef({ value: 0 });
  const sinceDraw = useRef(0);
  useEngineTick((dt) => {
    if (!active) return;
    uTime.current.value += dt;
    // Slow ambient motion reads the same at 30 Hz: half the frames of a continuous 60 Hz redraw.
    sinceDraw.current += dt;
    if (sinceDraw.current >= 1 / 30) {
      sinceDraw.current = 0;
      invalidate();
    }
  });
  return uTime.current;
}

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}`;

// ---- Light shafts -------------------------------------------------------------------------

export interface ShaftSpec {
  position: [number, number, number];
  /** Euler rotation, radians. The cone's long axis is local Y. */
  rotation?: [number, number, number];
  length?: number;
  radius?: number;
}

export interface LightShaftsProps {
  shafts: ShaftSpec[];
  /** From the quality profile (QualityProfile.atmosphere). */
  enabled: boolean;
  /** Mood mix, 0 golden to 1 dusk. Shafts show only while below 0.5. */
  mood: number;
  color?: string;
  intensity?: number;
  /** Live mood mix; when given, the shafts fade out smoothly towards 0.5 instead of popping. */
  moodRef?: { current: number };
}

/** Warm additive cones with scrolling noise; fade along their length and toward the rim. */
export function LightShafts(props: LightShaftsProps) {
  const { shafts, enabled, mood, color = '#ffd9a0', intensity = 0.35, moodRef } = props;
  const visible = enabled && mood < 0.5;
  const uTime = useTimeUniform(visible);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uTime,
          uColor: { value: new THREE.Color(color) },
          uIntensity: { value: intensity },
          uFade: { value: 1 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          void main(){
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor; uniform float uIntensity; uniform float uFade;
          varying vec2 vUv; varying vec3 vN; varying vec3 vView;
          ${NOISE_GLSL}
          void main(){
            // v = 1 at the window end (narrow), 0 at the floor end: soft at both, brightest near the window
            float along = smoothstep(0.0, 0.55, vUv.y) * (1.0 - smoothstep(0.93, 1.0, vUv.y));
            float rim = pow(abs(dot(normalize(vN), normalize(vView))), 1.5);
            float n = vnoise(vec2(vUv.x * 6.0 + uTime * 0.05, vUv.y * 3.0 - uTime * 0.08));
            float a = along * rim * (0.55 + 0.45 * n) * uIntensity * uFade;
            // AdditiveBlending already multiplies by alpha (SRC_ALPHA, ONE)
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      }),
    // colour and intensity are applied below so the material is not rebuilt
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uTime],
  );
  useEffect(() => {
    (material.uniforms.uColor.value as THREE.Color).set(color);
    material.uniforms.uIntensity.value = intensity;
  }, [material, color, intensity]);
  useEffect(() => () => material.dispose(), [material]);
  useEngineTick(() => {
    if (moodRef) material.uniforms.uFade.value = Math.min(1, Math.max(0, 1 - moodRef.current * 2));
  });

  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [visible, invalidate]);

  if (!visible) return null;
  return (
    <group>
      {shafts.map((s, i) => {
        const length = s.length ?? 6;
        const radius = s.radius ?? 1.2;
        return (
          <mesh
            key={i}
            position={s.position}
            rotation={s.rotation}
            material={material}
            renderOrder={5}
          >
            {/* Open cone, wide end at the window: apex-up so the narrow end points along +Y */}
            <cylinderGeometry args={[radius * 0.4, radius, length, 24, 1, true]} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- Dust motes ---------------------------------------------------------------------------

/** Yousef found the motes dense near the sun rays: half the diameter, ~60% of the count. */
export const MAX_DUST_MOTES = 240;
export const DEFAULT_DUST_MOTES = 144;
export const DUST_MOTE_SIZE = 0.015;

export interface DustMotesProps {
  count?: number;
  /** Axis-aligned box the motes drift inside: [centre, size]. */
  center: [number, number, number];
  size: [number, number, number];
  enabled: boolean;
  color?: string;
  /** Live mood mix: motes fade out towards 0.5 like the shafts. */
  moodRef?: { current: number };
}

/** Faint drifting motes: one InstancedMesh, positions animated on the GPU. */
export function DustMotes(props: DustMotesProps) {
  const { center, size, enabled, color = '#fff1d0', moodRef } = props;
  const count = Math.min(
    MAX_DUST_MOTES,
    Math.max(0, Math.floor(props.count ?? DEFAULT_DUST_MOTES)),
  );
  const uTime = useTimeUniform(enabled);
  const mesh = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    const geo = new THREE.PlaneGeometry(DUST_MOTE_SIZE, DUST_MOTE_SIZE);
    const seeds = new Float32Array(count * 3);
    // deterministic scatter so the hall looks the same every load
    let s = 1337;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime,
        uCenter: { value: new THREE.Vector3() },
        uSize: { value: new THREE.Vector3() },
        uColor: { value: new THREE.Color() },
        uFade: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uSize;
        varying float vTw; varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 p = aSeed;
          p.x += sin(uTime * 0.05 + aSeed.y * 6.283) * 0.04 + uTime * 0.004 * (aSeed.z - 0.5);
          p.y += fract(uTime * 0.01 * (0.5 + aSeed.x)) ;
          p.z += cos(uTime * 0.04 + aSeed.x * 6.283) * 0.04;
          p = fract(p) - 0.5;
          vec3 world = uCenter + p * uSize;
          vTw = 0.4 + 0.6 * sin(uTime * (0.6 + aSeed.z) + aSeed.x * 40.0) * 0.5 + 0.3;
          // billboard in view space
          vec4 mv = viewMatrix * vec4(world, 1.0);
          mv.xy += position.xy;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uFade; varying float vTw; varying vec2 vUv;
        void main(){
          float disc = 1.0 - smoothstep(0.2, 0.5, length(vUv - 0.5));
          gl_FragColor = vec4(uColor, vTw * 0.3 * disc * uFade);
          #include <colorspace_fragment>
        }`,
    });
    return { geometry: geo, material: mat };
  }, [count, uTime]);

  useEffect(() => {
    (material.uniforms.uCenter.value as THREE.Vector3).set(...center);
    (material.uniforms.uSize.value as THREE.Vector3).set(...size);
    (material.uniforms.uColor.value as THREE.Color).set(color);
  }, [material, center, size, color]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useEngineTick(() => {
    if (moodRef) material.uniforms.uFade.value = Math.min(1, Math.max(0, 1 - moodRef.current * 2));
  });

  if (!enabled || count === 0) return null;
  // The shader positions every instance, so the bounding sphere cannot cull: disable culling.
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, count]}
      frustumCulled={false}
      renderOrder={6}
    />
  );
}

// ---- Palm sway ----------------------------------------------------------------------------
// The trunk stands still like a pillar; only the fronds breathe in the wind (Yousef, 2026-10-15).
// Each vertex is weighted by its distance from the trunk axis (from the bake's palm meta), not by
// its height: every trunk vertex weighs exactly 0, the frond tips 1.

const SWAY_FLAG = 'diwanPalmSway';
const SWAY_ATTR = 'diwanSway';

/** Within this distance of the trunk axis (m) nothing moves: the trunk is at most 0.21 m thick. */
export const PALM_STILL_RADIUS = 0.25;
/** Fronds reach their full sway this far from the axis (m); they are 1.4-2.5 m long. */
export const PALM_REACH = 2.2;
/** Peak horizontal sway at a frond tip (m): about a third of the old 8 cm crown sway. */
export const PALM_SWAY_AMPLITUDE = 0.03;
/** Two incommensurate periods (s), so the motion never reads as a loop. */
export const PALM_SWAY_PERIODS: readonly [number, number] = [4.7, 5.9];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sway weight of a point of a palm (GLB metres): 0 on and around the trunk axis, rising smoothly
 * to 1 at PALM_REACH. The axis leans quadratically from the base to the crown, as the bake built it.
 */
export function palmFrondWeight(p: readonly [number, number, number], palm: PalmMeta): number {
  const [bx, by, bz] = palm.base;
  const [cx, cy, cz] = palm.crown;
  const t = Math.min(1, Math.max(0, (p[1] - by) / (cy - by)));
  const ax = bx + (cx - bx) * t * t;
  const az = bz + (cz - bz) * t * t;
  return smoothstep(PALM_STILL_RADIUS, PALM_REACH, Math.hypot(p[0] - ax, p[2] - az));
}

/** A per-palm phase (rad), stable across loads: from the palm's base position. */
export const palmPhase = (palm: PalmMeta) =>
  (palm.base[0] * 0.7 + palm.base[2] * 1.3) % (2 * Math.PI);

export interface PalmSwayUniforms {
  time: { value: number };
  /** Peak sway at a frond tip, metres. */
  amplitude: { value: number };
}

/**
 * Patches a material so palm fronds sway in the vertex shader. The motion is read from the
 * geometry's `diwanSway` attribute (x: frond weight, y: phase, z: local units per metre), so a
 * mesh without it, or a trunk vertex (weight 0), never moves. Chains onto any existing
 * onBeforeCompile and customProgramCacheKey; returns a function that restores both.
 * Idempotent per material (a second call is a no-op).
 */
export function patchPalmSway(material: THREE.Material, u: PalmSwayUniforms): () => void {
  if (material.userData[SWAY_FLAG]) return () => {};
  material.userData[SWAY_FLAG] = true;
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  const [p1, p2] = PALM_SWAY_PERIODS;
  const w1 = ((2 * Math.PI) / p1).toFixed(5);
  const w2 = ((2 * Math.PI) / p2).toFixed(5);
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile.call(material, shader, renderer);
    shader.uniforms.uSwayTime = u.time;
    shader.uniforms.uSwayAmp = u.amplitude;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nattribute vec3 ${SWAY_ATTR};\nuniform float uSwayTime; uniform float uSwayAmp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float w = ${SWAY_ATTR}.x;
          float ph = ${SWAY_ATTR}.y;
          float gust = sin(uSwayTime * ${w1} + ph) * 0.65 + sin(uSwayTime * ${w2} + ph * 1.7 + 0.9) * 0.35;
          float a = uSwayAmp * ${SWAY_ATTR}.z * w;
          transformed.x += a * gust;
          transformed.z += a * 0.4 * sin(uSwayTime * ${w2} + ph + 2.1);
          transformed.y += a * w * 0.35 * (0.5 + 0.5 * gust); // the tips lift a little, then settle
        }`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|${SWAY_FLAG}`;
  material.needsUpdate = true;
  return () => {
    delete material.userData[SWAY_FLAG];
    material.onBeforeCompile = previousCompile;
    material.customProgramCacheKey = previousKey;
    material.needsUpdate = true;
  };
}

/**
 * Writes the `diwanSway` attribute of one palm mesh: each vertex's frond weight against the
 * nearest palm's trunk, that palm's phase, and the mesh's local units per metre (the optimiser
 * quantises positions, so local units are not metres). `toHall` maps the geometry to GLB metres.
 */
export function writePalmSway(
  geometry: THREE.BufferGeometry,
  toHall: THREE.Matrix4,
  palms: PalmMeta[],
): void {
  const pos = geometry.getAttribute('position');
  const perMetre = 1 / new THREE.Vector3().setFromMatrixColumn(toHall, 0).length();
  const data = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toHall);
    let palm = palms[0];
    let best = Infinity;
    for (const p of palms) {
      const d = Math.hypot(v.x - p.base[0], v.z - p.base[2]);
      if (d < best) [best, palm] = [d, p];
    }
    data[i * 3] = palmFrondWeight([v.x, v.y, v.z], palm);
    data[i * 3 + 1] = palmPhase(palm);
    data[i * 3 + 2] = perMetre;
  }
  geometry.setAttribute(SWAY_ATTR, new THREE.BufferAttribute(data, 3));
}

export interface PalmSwayProps {
  /** Loaded hall scene (GLB metres) to search. */
  root: THREE.Object3D | null;
  /** The bake's palms (hall meta); none means no sway. */
  palms: PalmMeta[] | undefined;
  enabled?: boolean;
  /** Peak sway at a frond tip, metres. */
  amplitude?: number;
}

/**
 * Sways the fronds of the baked palms on the engine clock (deterministic under ?frames); off,
 * and unpatched, when atmosphere is off. Only materials that the palm meshes alone use are
 * patched (the marble kerbs share theirs with the hall and stay put).
 */
export function PalmSway(props: PalmSwayProps) {
  const { root, palms, enabled = true, amplitude = PALM_SWAY_AMPLITUDE } = props;
  const active = enabled && root !== null && !!palms?.length;
  const uTime = useTimeUniform(active);
  const uniforms = useMemo<PalmSwayUniforms>(
    () => ({ time: uTime, amplitude: { value: amplitude } }),
    // amplitude is kept in sync below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uTime],
  );
  useEffect(() => {
    uniforms.amplitude.value = amplitude;
  }, [uniforms, amplitude]);

  useEffect(() => {
    if (!root || !enabled || !palms?.length) return;
    root.updateMatrixWorld(true);
    const toRoot = root.matrixWorld.clone().invert();
    const nodes = palms.map((p) => p.node);
    const swayMeshes = new Set<THREE.Mesh>();
    const outsiders = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let inPalm = false;
      for (let a: THREE.Object3D | null = m; a && a !== root; a = a.parent)
        if (nodes.some((n) => a!.name === n || a!.name.startsWith(`${n}_`))) inPalm = true;
      if (inPalm) swayMeshes.add(m);
      else
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) outsiders.add(mat);
    });
    const materials = new Set<THREE.Material>();
    for (const m of swayMeshes) {
      const own = (Array.isArray(m.material) ? m.material : [m.material]).filter(
        (mat) => !outsiders.has(mat),
      );
      if (own.length === 0) continue;
      own.forEach((mat) => materials.add(mat));
      writePalmSway(m.geometry, toRoot.clone().multiply(m.matrixWorld), palms);
    }
    if (import.meta.env.DEV && materials.size === 0) {
      console.warn('PalmSway: no palm-only material found; sway is off (did the bake change?)');
    }
    const undo = [...materials].map((mat) => patchPalmSway(mat, uniforms));
    return () => undo.forEach((fn) => fn());
  }, [root, palms, enabled, uniforms]);
  return null;
}
