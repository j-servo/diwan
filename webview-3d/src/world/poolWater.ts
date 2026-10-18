import type { MeshStandardMaterial, WebGLProgramParametersWithUniforms } from 'three';
import { Color, ShaderMaterial, Vector3, Vector4 } from 'three';

/**
 * The pool of Nun's water and the light it throws: one runtime shader on the water sheet (no
 * planar or real-time mirror, so no second scene pass) and a caustics patch for the pool's stone.
 * Everything is a function of the engine clock, so it is deterministic under `?frames`.
 *
 * The water is still, deep and green-teal: a Nile green deepest by the plinth, lighter and clearer
 * over the shelf by the coping (hue about 155-190 deg, nowhere near the amethyst band). Its
 * surface is two procedural normal layers drifting in different directions, a Fresnel mix of the
 * room's warm sky and walls, a sun glint by day and the lamps' warm glints at dusk, and a soft
 * contact darkening where it meets the plinth and the coping.
 */

/** Pool numbers the bake writes on the water material's glTF extras (temple.py). */
export interface PoolNumbers {
  cx: number;
  cz: number;
  plinth: number;
  coping: number;
  waterY: number;
  /** Unit vector from the pool towards the sun. */
  sun: [number, number, number];
}

export function poolNumbers(userData: Record<string, unknown>): PoolNumbers | null {
  const n = (k: string) => (typeof userData[k] === 'number' ? (userData[k] as number) : NaN);
  const out = {
    cx: n('poolCx'),
    cz: n('poolCz'),
    plinth: n('poolPlinth'),
    coping: n('poolCoping'),
    waterY: n('poolWaterY'),
    sun: [n('poolSunX'), n('poolSunY'), n('poolSunZ')] as [number, number, number],
  };
  return Object.values(out).flat().some(Number.isNaN) ? null : out;
}

/** The mood's two palettes; the shader mixes them by the mood mix. */
const GOLDEN = {
  gain: 1.0,
  zenith: '#7fb0d8',
  horizon: '#f6dcb0',
  wall: '#b8905f',
};
const DUSK = {
  gain: 0.13,
  zenith: '#10264a',
  horizon: '#2a3552',
  wall: '#3a2a22',
};
/** Water body colours (sRGB): Nile green-teal, deep by the plinth, clear and light on the shelf. */
const DEEP = '#0a4f48';
const SHALLOW = '#43a690';
/** At dusk the water goes a deep blue-teal (still well clear of the amethyst band). */
const DEEP_DUSK = '#0a4048';
const SHALLOW_DUSK = '#1f6a72';
const SUN = '#fff0d2';

/**
 * Round F (Yousef, 2026-10-19: bright white flashes as the camera moves). Measured: the only
 * near-white pixels in a 360-degree orbit were the water, where the Fresnel mix reached 1.0 at
 * grazing angles (the near-white sky) and the sun glint added 1.6x white on top: well above the
 * bloom threshold of 1.0, so a streak bloomed across the pool. The surface stays a surface:
 * a capped Fresnel, a gentler glint, and a soft ceiling below the bloom threshold.
 */
export const WATER_FRESNEL_MAX = 0.55;
export const WATER_GLINT_GAIN = 0.45;
export const WATER_LAMP_GAIN = 0.55;
/** The brightest any channel of the water may be (linear, before post): clear of the bloom. */
export const WATER_CEILING = 0.78;
/**
 * The root cause of the flashes (attribution: hiding the plinth or the casing, or zeroing the
 * caustics gain, took the near-white pixels from 9100 to 0 in the worst frame; the water, casing,
 * gold and lamps did nothing). The caustic function has near-singular peaks (1/length terms to the
 * 8th power): unbounded HDR light on the plinth, which the bloom turned into a white streak. Capped
 * per pixel, well under the bloom threshold.
 */
export const CAUSTICS_MAX = 0.3;

export interface WaterUniforms {
  [uniform: string]: { value: unknown };
  uTime: { value: number };
  uMood: { value: number };
  uGain: { value: number };
  uCam: { value: Vector3 };
  uSunDir: { value: Vector3 };
  uPool: { value: Vector4 };
  uDeep: { value: Color };
  uShallow: { value: Color };
  uZenith: { value: Color };
  uHorizon: { value: Color };
  uWall: { value: Color };
  uSunColor: { value: Color };
  uLamp: { value: Vector3[] };
}

const VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform float uMood;
uniform float uGain;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec4 uPool; // centre x, centre z, plinth half-width, coping half-width
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uWall;
uniform vec3 uSunColor;
uniform vec3 uLamp[2];
varying vec3 vPos;

float h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec2 grad(vec2 p) {
  float e = 0.12;
  float a = vn(p);
  return vec2(vn(p + vec2(e, 0.0)) - a, vn(p + vec2(0.0, e)) - a) / e;
}

void main() {
  // two normal layers drifting in different directions, small amplitude
  vec2 pA = vPos.xz * 1.35 + vec2(uTime * 0.07, uTime * 0.03);
  vec2 pB = vPos.xz * 3.1 + vec2(-uTime * 0.05, uTime * 0.09);
  vec2 g = grad(pA) * 0.07 + grad(pB) * 0.035;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

  vec3 v = normalize(uCam - vPos);
  float ndv = max(dot(n, v), 0.0);
  float fresnel = min(0.07 + 0.93 * pow(1.0 - ndv, 3.0), ${WATER_FRESNEL_MAX.toFixed(2)});
  vec3 r = reflect(-v, n);
  vec3 skyHi = mix(uHorizon, uZenith, smoothstep(0.1, 0.9, r.y));
  vec3 sky = mix(uWall, skyHi, smoothstep(0.05, 0.4, r.y));

  // depth: deep by the plinth, shallow and clear over the shelf by the coping
  float d = max(abs(vPos.x - uPool.x), abs(vPos.z - uPool.y));
  float shallow = smoothstep(uPool.z + 0.08, uPool.w - 0.2, d);
  vec3 body = mix(uDeep, uShallow, shallow) * uGain * (0.78 + 0.44 * vn(pA * 1.1 + 3.0) * vn(pB * 0.6));
  vec3 col = mix(body, sky * uGain, fresnel);

  // the sun's glint by day, the lamps' warm glints at dusk
  vec3 hs = normalize(uSunDir + v);
  float glint = pow(max(dot(n, hs), 0.0), 38.0);
  col += uSunColor * glint * ${WATER_GLINT_GAIN.toFixed(2)} * (1.0 - uMood);
  float lamps = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 toLamp = uLamp[i] - vPos;
    vec3 hl = normalize(normalize(toLamp) + v);
    lamps += pow(max(dot(n, hl), 0.0), 28.0) / (1.0 + 0.05 * dot(toLamp, toLamp));
  }
  col += vec3(1.0, 0.62, 0.3) * lamps * ${WATER_LAMP_GAIN.toFixed(2)} * uMood;

  // soft contact darkening where the water meets the plinth and the coping
  float contact = smoothstep(0.0, 0.22, d - uPool.z) * smoothstep(0.0, 0.16, uPool.w - d);
  col *= mix(0.5, 1.0, contact);

  // a ceiling on the brightest channel (hue kept): water never blows out or blooms
  col *= ${WATER_CEILING.toFixed(2)} / max(${WATER_CEILING.toFixed(2)}, max(col.r, max(col.g, col.b)));

  float alpha = mix(0.94, 0.5, shallow);
  alpha = clamp(mix(alpha, 1.0, fresnel * 0.7) + glint * 0.4 + lamps * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createWaterMaterial(
  pool: PoolNumbers,
  lamps: readonly (readonly [number, number, number])[],
): { material: ShaderMaterial; uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uMood: { value: 0 },
    uGain: { value: 1 },
    uCam: { value: new Vector3() },
    uSunDir: { value: new Vector3(...pool.sun).normalize() },
    uPool: { value: new Vector4(pool.cx, pool.cz, pool.plinth, pool.coping) },
    uDeep: { value: new Color(DEEP) },
    uShallow: { value: new Color(SHALLOW) },
    uZenith: { value: new Color(GOLDEN.zenith) },
    uHorizon: { value: new Color(GOLDEN.horizon) },
    uWall: { value: new Color(GOLDEN.wall) },
    uSunColor: { value: new Color(SUN) },
    uLamp: { value: lamps.slice(0, 2).map((l) => new Vector3(...l)) },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
  });
  material.name = 'pool_water_shader';
  return { material, uniforms };
}

const _a = new Color();
const _b = new Color();

/** Sets the water's mood-dependent uniforms for a mood mix (0 golden .. 1 dusk). */
export function applyWaterMood(u: WaterUniforms, mix: number): void {
  u.uMood.value = mix;
  u.uGain.value = GOLDEN.gain + (DUSK.gain - GOLDEN.gain) * mix;
  u.uDeep.value.copy(_a.set(DEEP)).lerp(_b.set(DEEP_DUSK), mix);
  u.uShallow.value.copy(_a.set(SHALLOW)).lerp(_b.set(SHALLOW_DUSK), mix);
  for (const [uniform, key] of [
    [u.uZenith, 'zenith'],
    [u.uHorizon, 'horizon'],
    [u.uWall, 'wall'],
  ] as const) {
    uniform.value.copy(_a.set(GOLDEN[key])).lerp(_b.set(DUSK[key]), mix);
  }
}

export interface CausticsUniforms {
  uCausTime: { value: number };
  uCausWaterY: { value: number };
  uCausColor: { value: Color };
  uCausGain: { value: number };
}

export function createCausticsUniforms(waterY: number): CausticsUniforms {
  return {
    uCausTime: { value: 0 },
    uCausWaterY: { value: waterY },
    uCausColor: { value: new Color(1, 0.93, 0.72) },
    uCausGain: { value: 0.9 },
  };
}

/** Caustics light: warm and bright by day, dim and cool at dusk. */
export function applyCausticsMood(u: CausticsUniforms, mix: number): void {
  u.uCausColor.value.setRGB(1 - 0.5 * mix, 0.93 - 0.08 * mix, 0.72 + 0.1 * mix);
  u.uCausGain.value = 0.9 - 0.55 * mix;
}

const CAUSTICS_FRAG_PARS = /* glsl */ `
uniform float uCausTime;
uniform float uCausWaterY;
uniform vec3 uCausColor;
uniform float uCausGain;
varying vec3 vCausPos;
float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  float inten = 0.006;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;

const CAUSTICS_FRAG = /* glsl */ `
  float causDepth = uCausWaterY - vCausPos.y;
  float causMask = smoothstep(-0.02, 0.03, causDepth) / (1.0 + causDepth * 2.2);
  float caus = caustic(vCausPos.xz * 1.7 + vec2(vCausPos.y * 0.9), uCausTime * 0.45);
  totalEmissiveRadiance += uCausColor * min(caus * causMask * uCausGain, ${CAUSTICS_MAX.toFixed(2)});
`;

/**
 * Adds animated caustics to a stone material of the pool: light dancing on the basin floor, the
 * plinth's submerged courses and the coping's inner face, below the water line only. Composes
 * with whatever onBeforeCompile the material already has (the dual lightmap). Returns an undo.
 */
export function addCaustics(m: MeshStandardMaterial, u: CausticsUniforms): () => void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(m, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCausPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CAUSTICS_FRAG_PARS}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n${CAUSTICS_FRAG}`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}|caustics`;
  m.needsUpdate = true;
  return () => {
    m.onBeforeCompile = prev;
    m.customProgramCacheKey = prevKey;
    m.needsUpdate = true;
  };
}
