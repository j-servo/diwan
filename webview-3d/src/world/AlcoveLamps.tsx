import { useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type {
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SpriteMaterial,
} from 'three';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  LatheGeometry,
  Vector2,
} from 'three';

import type { Character } from '../../../webview-ui/src/office/types.js';
import { activeSignal } from '../grammar/signal.js';
import { useEngineTick } from '../engine/EngineProvider.js';
import type { PracticalLightMeta } from '../worlds/assetMeta.js';
import { moodLighting } from './mood.js';

export type LampState = 'off' | 'active' | 'approval';

export const APPROVAL_PULSE_SEC = 1.2;

/** The lamp state for one seat: approval beats active beats off. Subagents never own a seat lamp. */
export function lampStateForSeat(chars: Character[], seatUid: string): LampState {
  let state: LampState = 'off';
  for (const ch of chars) {
    if (ch.isSubagent || ch.seatId !== seatUid) continue;
    if (ch.bubbleType === 'permission') return 'approval';
    if (ch.isActive) state = 'active';
  }
  return state;
}

const WARM: [number, number, number] = [1.0, 0.62, 0.28];
/** The active world's signal colour in linear RGB. */
function signalRgb(): [number, number, number] {
  const c = new Color(activeSignal().color);
  return [c.r, c.g, c.b];
}
const POOL_PROPS = {
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
  opacity: 0,
  polygonOffset: true,
  polygonOffsetFactor: -2,
} as const;
const DIM = 0.25; // below bloom threshold 1.0

/** Emissive colour per state (off keeps the warm hue, just dim). */
export function lampColor(state: LampState): [number, number, number] {
  return state === 'approval' ? signalRgb() : WARM;
}

/**
 * Emissive intensity per state at time t (seconds). Lit states keep intensity x luminance(colour)
 * at or above 1.3 for the whole cycle, so bloom (threshold 1.0) never drops out mid-pulse.
 */
export function lampEmissive(state: LampState, t: number, phase = 0): number {
  if (state === 'off') return DIM;
  if (state === 'active') {
    const flicker = 0.06 * Math.sin(t * 9 + phase) + 0.04 * Math.sin(t * 23 + phase * 2);
    return 2.2 * (1 + flicker);
  }
  const pulse = 0.5 + 0.5 * Math.sin((t / APPROVAL_PULSE_SEC) * Math.PI * 2);
  // The core stays well under 1.0 in its blue (halo bloom adds on top) channel: any hotter and Khronos Neutral + bloom whiten it
  // to lavender. The glow comes from the halo ring (below), not from the core.
  return 0.6 + 0.25 * pulse;
}

/**
 * Opacity of the cobalt glow around an approval lamp (a soft additive sprite) and of the two light
 * pools it throws on the back wall and the rug. Zero (hidden) in every other state. The glass core
 * keeps its saturation; the glow and the pools are what make approval read from the wide shot.
 */
export function lampGlowOpacity(state: LampState, t: number): number {
  if (state !== 'approval') return 0;
  const pulse = 0.5 + 0.5 * Math.sin((t / APPROVAL_PULSE_SEC) * Math.PI * 2);
  return 0.6 + 0.25 * pulse;
}

/** Lamps glow brighter as the hall darkens (40% of the practical lights' rise, so bloom stays calm). */
export function lampMoodGain(mix: number): number {
  return moodLighting(mix).lampGain;
}

export interface LampSample {
  state: LampState;
  intensity: number;
}

/** A frame is needed whenever a lamp's state or emissive changed (including lit -> off). */
export function lampNeedsFrame(prev: LampSample | undefined, next: LampSample): boolean {
  return !prev || prev.state !== next.state || prev.intensity !== next.intensity;
}

// A tin-glazed glass mosque lamp (profile r, y around the flame), hung from a short brass chain.
const LAMP_PROFILE = [
  [0.001, -0.1],
  [0.016, -0.098],
  [0.022, -0.082],
  [0.012, -0.068],
  [0.05, -0.05],
  [0.074, -0.012],
  [0.078, 0.02],
  [0.064, 0.05],
  [0.044, 0.07],
  [0.052, 0.096],
].map(([r, y]) => new Vector2(r, y));
const CHAIN_LEN = 0.22;

let lampGeometry: LatheGeometry | null = null;
let chainGeometry: CylinderGeometry | null = null;
let softTexture: CanvasTexture | null = null;

/** A white radial falloff, tinted per use by the material colour. */
function getSoftTexture(): CanvasTexture {
  if (softTexture) return softTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softTexture = new CanvasTexture(c);
  return softTexture;
}

/** Fresnel on the glass: the rim glows hotter than the face, like a lit lamp glass. */
function addFresnel(m: Material): void {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      float lampFresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
      totalEmissiveRadiance *= 0.75 + 0.5 * lampFresnel;`,
    );
  };
  m.customProgramCacheKey = () => 'alcove-lamp-fresnel';
}

/** North alcoves hang their lamp in a niche in the wall behind the desk; the south ones face north. */
function wallSide(z: number): { sign: number; wallZ: number } {
  return z < 10.5 ? { sign: 1, wallZ: z + 0.05 } : { sign: -1, wallZ: z - 0.12 };
}

export function AlcoveLamps(props: {
  practicals: PracticalLightMeta[];
  lampStateFor: (seatUid: string) => LampState;
  /** Live mood mix; omitted means golden. */
  moodRef?: { current: number };
}) {
  const { practicals, lampStateFor, moodRef } = props;
  const invalidate = useThree((s) => s.invalidate);
  const lamps = useMemo(() => practicals.filter((p) => p.seatUid !== undefined), [practicals]);
  const mats = useRef<(MeshStandardMaterial | null)[]>([]);
  const glows = useRef<(Mesh | null)[]>([]);
  const glowMats = useRef<(SpriteMaterial | null)[]>([]);
  const pools = useRef<(Mesh | null)[][]>([]);
  const poolMats = useRef<(MeshBasicMaterial | null)[][]>([]);
  const time = useRef(0);
  const last = useRef<(LampSample | undefined)[]>([]);
  lampGeometry ??= new LatheGeometry(LAMP_PROFILE, 20);
  chainGeometry ??= new CylinderGeometry(0.005, 0.005, CHAIN_LEN, 5);
  const soft = getSoftTexture();

  useEngineTick((dt) => {
    time.current += dt;
    let changed = false;
    lamps.forEach((p, i) => {
      const m = mats.current[i];
      if (!m || p.seatUid === undefined) return;
      const state = lampStateFor(p.seatUid);
      const gain = lampMoodGain(moodRef?.current ?? 0);
      const base = lampColor(state);
      const intensity = lampEmissive(state, time.current, i) * gain;
      m.emissive.setRGB(base[0], base[1], base[2]);
      m.emissiveIntensity = intensity;
      // Dark glass under approval: the sun-lit diffuse would add warm red/green and wash the cobalt out.
      m.color.set(state === 'approval' ? '#000000' : '#2a1a10');
      const glow = lampGlowOpacity(state, time.current);
      const gm = glowMats.current[i];
      if (gm) {
        gm.opacity = glow * Math.min(1, gain);
        if (glows.current[i]) glows.current[i]!.visible = glow > 0;
      }
      poolMats.current[i]?.forEach((pm, k) => {
        if (!pm) return;
        pm.opacity = glow * 0.75 * Math.min(1, gain);
        const pool = pools.current[i]?.[k];
        if (pool) pool.visible = glow > 0;
      });
      const next = { state, intensity: intensity + glow };
      if (lampNeedsFrame(last.current[i], next)) changed = true;
      last.current[i] = next;
    });
    if (changed) invalidate();
  });

  return (
    <group>
      {lamps.map((p, i) => {
        const alcove = p.id.includes('alcove');
        const { sign, wallZ } = wallSide(p.position[2]);
        const [x, , z] = p.position;
        pools.current[i] ??= [];
        poolMats.current[i] ??= [];
        return (
          <group key={p.id}>
            <group position={p.position}>
              <mesh geometry={lampGeometry!}>
                <meshStandardMaterial
                  ref={(m) => {
                    if (m && mats.current[i] !== m) addFresnel(m);
                    mats.current[i] = m;
                  }}
                  side={DoubleSide}
                  color="#2a1a10"
                  emissive={`rgb(${WARM.map((c) => Math.round(c * 255)).join(',')})`}
                  emissiveIntensity={DIM}
                />
              </mesh>
              {/* chain and bracket */}
              <mesh geometry={chainGeometry!} position={[0, 0.1 + CHAIN_LEN / 2, 0]}>
                <meshStandardMaterial color="#6b5226" roughness={0.5} metalness={0.6} />
              </mesh>
              <mesh position={[0, 0.1 + CHAIN_LEN, 0]}>
                <boxGeometry args={[0.035, 0.012, 0.035]} />
                <meshStandardMaterial color="#6b5226" roughness={0.5} metalness={0.6} />
              </mesh>
              {/* soft cobalt glow, approval only */}
              <sprite
                scale={[0.9, 0.9, 1]}
                visible={false}
                ref={(r) => {
                  glows.current[i] = r as unknown as Mesh | null;
                }}
              >
                <spriteMaterial
                  ref={(m) => {
                    glowMats.current[i] = m;
                  }}
                  map={soft}
                  color={activeSignal().color}
                  blending={AdditiveBlending}
                  transparent
                  depthWrite={false}
                  opacity={0}
                />
              </sprite>
            </group>
            {/* light pools thrown by an approval lamp: the back wall (alcoves) and the floor in front */}
            {alcove && (
              <mesh
                position={[x, 0.62, wallZ + sign * 0.02]}
                rotation={[0, sign > 0 ? 0 : Math.PI, 0]}
                renderOrder={2}
                visible={false}
                ref={(r) => {
                  pools.current[i][0] = r;
                }}
              >
                <planeGeometry args={[2.1, 1.7]} />
                <meshBasicMaterial
                  ref={(m) => {
                    poolMats.current[i][0] = m;
                  }}
                  {...POOL_PROPS}
                  color={activeSignal().color}
                  map={soft}
                />
              </mesh>
            )}
            <mesh
              position={[x, 0.03, alcove ? z + sign * 1.5 : z]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={2}
              visible={false}
              ref={(r) => {
                pools.current[i][1] = r;
              }}
            >
              <planeGeometry args={[alcove ? 3.2 : 2.4, alcove ? 3.2 : 2.4]} />
              <meshBasicMaterial
                ref={(m) => {
                  poolMats.current[i][1] = m;
                }}
                {...POOL_PROPS}
                color={activeSignal().color}
                map={soft}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
