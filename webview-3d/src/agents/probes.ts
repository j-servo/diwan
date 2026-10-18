import type { Object3D, WebGLRenderer } from 'three';
import { CubeCamera, HalfFloatType, WebGLCubeRenderTarget } from 'three';
import { LightProbeGenerator } from 'three/examples/jsm/lights/LightProbeGenerator.js';

/** Coarse irradiance grid: `data` holds RGB per node, x fastest, then z, then y. */
export interface ProbeGrid {
  origin: readonly [number, number]; // world x, z of node (0, 0)
  spacing: number; // metres between nodes
  nx: number;
  nz: number;
  data: Float32Array; // nx * nz * 3
}

export function sampleProbe(grid: ProbeGrid, x: number, z: number): [number, number, number] {
  const fx = clamp((x - grid.origin[0]) / grid.spacing, 0, grid.nx - 1);
  const fz = clamp((z - grid.origin[1]) / grid.spacing, 0, grid.nz - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(x0 + 1, grid.nx - 1);
  const z1 = Math.min(z0 + 1, grid.nz - 1);
  const tx = fx - x0;
  const tz = fz - z0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (ix: number, iz: number) => grid.data[(iz * grid.nx + ix) * 3 + c];
    const a = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
    const b = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
    out[c] = a * (1 - tz) + b * tz;
  }
  return out;
}

/**
 * LightProbeGenerator normalises its SH sum by 4pi/totalWeight, so c0 = 4pi * 0.282095 * avgL.
 * Returns the cube map's average radiance (linear RGB channel) for that L0 coefficient.
 */
export function shL0ToRadiance(c: number): number {
  return c / (4 * Math.PI * 0.282095);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Renders `hall` from each grid node (one per 3x3 tiles, 1.2 m high) and projects the cubemap
 * to SH; the stored RGB is the cube map's average radiance (linear, via shL0ToRadiance).
 * `widthTiles`/`heightTiles` are the floor size; 1 tile = 1 world unit (the hall is scaled by
 * 1/tileMeters), so the metre `height` is converted with `tileMeters` (default 1.5).
 */
export async function buildProbeGrid(
  renderer: WebGLRenderer,
  hall: Object3D,
  widthTiles: number,
  heightTiles: number,
  opts: { tilesPerProbe?: number; height?: number; cubeSize?: number; tileMeters?: number } = {},
): Promise<ProbeGrid> {
  const step = opts.tilesPerProbe ?? 3;
  const height = (opts.height ?? 1.2) / (opts.tileMeters ?? 1.5); // metres -> world units
  const size = opts.cubeSize ?? 32;
  const nx = Math.max(1, Math.ceil(widthTiles / step));
  const nz = Math.max(1, Math.ceil(heightTiles / step));
  const grid: ProbeGrid = {
    origin: [step / 2, step / 2],
    spacing: step,
    nx,
    nz,
    data: new Float32Array(nx * nz * 3),
  };
  const target = new WebGLCubeRenderTarget(size, { type: HalfFloatType });
  const camera = new CubeCamera(0.05, 100, target);
  try {
    hall.updateMatrixWorld(true);
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        camera.position.set(grid.origin[0] + ix * step, height, grid.origin[1] + iz * step);
        camera.update(renderer, hall as never);
        const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, target);
        const sh = probe.sh.coefficients[0];
        const i = (iz * nx + ix) * 3;
        grid.data[i] = shL0ToRadiance(sh.x);
        grid.data[i + 1] = shL0ToRadiance(sh.y);
        grid.data[i + 2] = shL0ToRadiance(sh.z);
      }
    }
  } finally {
    target.dispose();
  }
  return grid;
}
