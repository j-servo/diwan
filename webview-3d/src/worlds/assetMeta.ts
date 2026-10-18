import type { Vec3 } from '../scene/coords.js';

/** Schema of every bake's `*.meta.json`. The bake writes it; the renderer reads it. */
export interface LightmapMeta {
  file: string;
  uv: 1;
  /** Already holds pi x M (spike gotcha 6). Multiply by exposure with lightMapIntensity(). */
  intensity: number;
  colorSpace: 'srgb';
}

export interface SunMeta {
  color: [number, number, number];
  intensity: number;
  position: Vec3;
  target: Vec3;
  angle: number;
  penumbra: number;
  near: number;
  far: number;
  size: number;
  gobo: string;
}

export interface PracticalLightMeta {
  id: string;
  position: Vec3;
  color: [number, number, number];
  intensity: number;
  distance: number;
  seatUid?: string;
}

/**
 * A baked palm's trunk, so the runtime can keep it still and move only the fronds (GLB metres):
 * the trunk rises from `base` and leans quadratically to `crown`, where the fronds spring.
 */
export interface PalmMeta {
  /** The palm's node name in the hall GLB (palm_<uid>). */
  node: string;
  base: Vec3;
  crown: Vec3;
}

export interface WorldAssetMeta {
  worldId: string;
  tileMeters: number;
  glb: string;
  /** The courtyard armillary sphere: its own GLB (moving named nodes, no lightmap). */
  armillary?: { glb: string };
  /**
   * Another world's centrepiece GLB (the House of Life's pyramid model in the pool of Nun): named
   * nodes, and meshes with uv1 take the hall's lightmaps.
   */
  centrepiece?: { glb: string };
  moods: {
    golden: { lightmap: LightmapMeta; sun: SunMeta };
    dusk: { lightmap: LightmapMeta; sun: SunMeta | null };
  };
  practicals: PracticalLightMeta[];
  /** Palms whose fronds sway at runtime (absent in older bakes: the palms then stand still). */
  palms?: PalmMeta[];
}

type Obj = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`Invalid world asset meta at ${path}: expected ${expected}`);
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'an object');
  return v as Obj;
}

function str(o: Obj, key: string, path: string): string {
  if (typeof o[key] !== 'string') fail(`${path}.${key}`, 'a string');
  return o[key];
}

function num(o: Obj, key: string, path: string): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${path}.${key}`, 'a finite number');
  return v;
}

function tuple3(o: Obj, key: string, path: string): [number, number, number] {
  const v = o[key];
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    v.some((n) => typeof n !== 'number' || !Number.isFinite(n))
  ) {
    fail(`${path}.${key}`, 'an array of 3 finite numbers');
  }
  return [v[0], v[1], v[2]];
}

function parseLightmap(v: unknown, path: string): LightmapMeta {
  const o = obj(v, path);
  if (o.uv !== 1) fail(`${path}.uv`, '1');
  if (o.colorSpace !== 'srgb') fail(`${path}.colorSpace`, '"srgb"');
  return {
    file: str(o, 'file', path),
    uv: 1,
    intensity: num(o, 'intensity', path),
    colorSpace: 'srgb',
  };
}

function parseSun(v: unknown, path: string): SunMeta {
  const o = obj(v, path);
  return {
    color: tuple3(o, 'color', path),
    intensity: num(o, 'intensity', path),
    position: tuple3(o, 'position', path),
    target: tuple3(o, 'target', path),
    angle: num(o, 'angle', path),
    penumbra: num(o, 'penumbra', path),
    near: num(o, 'near', path),
    far: num(o, 'far', path),
    size: num(o, 'size', path),
    gobo: str(o, 'gobo', path),
  };
}

function parsePractical(v: unknown, path: string): PracticalLightMeta {
  const o = obj(v, path);
  const out: PracticalLightMeta = {
    id: str(o, 'id', path),
    position: tuple3(o, 'position', path),
    color: tuple3(o, 'color', path),
    intensity: num(o, 'intensity', path),
    distance: num(o, 'distance', path),
  };
  if (o.seatUid !== undefined) out.seatUid = str(o, 'seatUid', path);
  return out;
}

function parsePalm(v: unknown, path: string): PalmMeta {
  const o = obj(v, path);
  return {
    node: str(o, 'node', path),
    base: tuple3(o, 'base', path),
    crown: tuple3(o, 'crown', path),
  };
}

/** Validates untrusted JSON; throws naming the exact path of the first bad field. */
export function parseWorldAssetMeta(json: unknown): WorldAssetMeta {
  const root = obj(json, 'meta');
  const moods = obj(root.moods, 'moods');
  const golden = obj(moods.golden, 'moods.golden');
  const dusk = obj(moods.dusk, 'moods.dusk');
  if (!Array.isArray(root.practicals)) fail('practicals', 'an array');
  const armillary =
    root.armillary === undefined
      ? {}
      : { armillary: { glb: str(obj(root.armillary, 'armillary'), 'glb', 'armillary') } };
  const centrepiece =
    root.centrepiece === undefined
      ? {}
      : {
          centrepiece: {
            glb: str(obj(root.centrepiece, 'centrepiece'), 'glb', 'centrepiece'),
          },
        };
  if (root.palms !== undefined && !Array.isArray(root.palms)) fail('palms', 'an array');
  const palms = Array.isArray(root.palms)
    ? { palms: root.palms.map((p, i) => parsePalm(p, `palms[${i}]`)) }
    : {};
  return {
    worldId: str(root, 'worldId', 'meta'),
    tileMeters: num(root, 'tileMeters', 'meta'),
    glb: str(root, 'glb', 'meta'),
    ...armillary,
    ...centrepiece,
    moods: {
      golden: {
        lightmap: parseLightmap(golden.lightmap, 'moods.golden.lightmap'),
        sun: parseSun(golden.sun, 'moods.golden.sun'),
      },
      dusk: {
        lightmap: parseLightmap(dusk.lightmap, 'moods.dusk.lightmap'),
        sun: dusk.sun === null ? null : parseSun(dusk.sun, 'moods.dusk.sun'),
      },
    },
    practicals: root.practicals.map((p, i) => parsePractical(p, `practicals[${i}]`)),
    ...palms,
  };
}

/** `intensity` already holds pi x M, so only the scene exposure remains. */
export function lightMapIntensity(meta: LightmapMeta, exposure: number): number {
  return meta.intensity * exposure;
}
