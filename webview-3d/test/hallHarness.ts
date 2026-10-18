// Shared harness for the baked-hall acceptance tests: the geometry helpers and the checks that
// hold for ANY world's hall (meta, deliverables, size, lightmap UVs, triangle budget, seats,
// lamps, desks, walkable clearance). A world's own test file calls selectWorld(dir), then
// genericHallTests(config) and adds its node-name specific tests beside them.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Document, type Node as GltfNode, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, expect, test } from 'vitest';

import type { LayoutManifest } from '../scripts/export-layout.js';
import { parseWorldAssetMeta, type WorldAssetMeta } from '../src/worlds/assetMeta.js';

export const MB = 1e6;

/** The world under test: set by selectWorld (module state; vitest isolates modules per file). */
export let WORLD = '';
export let OUT = '';
export let layout: LayoutManifest;
export let T = 1.5;

export function selectWorld(worldDirName: string): void {
  WORLD = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'worlds', worldDirName);
  OUT = join(WORLD, 'out');
  layout = JSON.parse(readFileSync(join(WORLD, 'layout.json'), 'utf8')) as LayoutManifest;
  T = layout.tileMeters;
}

export const WALL = 0;
export const VOID = 255;

export type Box = { min: [number, number, number]; max: [number, number, number] };
export type Tri = [number, number, number, number, number, number, number, number, number];
export interface MeshNode {
  name: string;
  tris: Tri[];
  box: Box;
}

export function tileRect(col: number, row: number, inset = 0) {
  return {
    x0: col * T + inset,
    x1: (col + 1) * T - inset,
    z0: row * T + inset,
    z1: (row + 1) * T - inset,
  };
}

// Triangle vs axis-aligned box: separating-axis test (Akenine-Moller).
export function triBoxOverlap(t: Tri, b: Box): boolean {
  const c = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
  const h = [0, 1, 2].map((i) => (b.max[i] - b.min[i]) / 2);
  const v = [0, 1, 2].map((k) => [t[k * 3] - c[0], t[k * 3 + 1] - c[1], t[k * 3 + 2] - c[2]]);
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(v[0][i], v[1][i], v[2][i]);
    const hi = Math.max(v[0][i], v[1][i], v[2][i]);
    if (lo > h[i] || hi < -h[i]) return false;
  }
  const e = [0, 1, 2].map((k) => v[(k + 1) % 3].map((x, i) => x - v[k][i]));
  const cross = (a: number[], d: number[]) => [
    a[1] * d[2] - a[2] * d[1],
    a[2] * d[0] - a[0] * d[2],
    a[0] * d[1] - a[1] * d[0],
  ];
  const dot = (a: number[], d: number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
  const axes = [cross(e[0], e[1])];
  for (const edge of e) {
    for (const unit of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
      axes.push(cross(unit, edge));
  }
  for (const a of axes) {
    if (Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]) < 1e-12) continue;
    const p = v.map((x) => dot(x, a));
    const r = h[0] * Math.abs(a[0]) + h[1] * Math.abs(a[1]) + h[2] * Math.abs(a[2]);
    if (Math.min(...p) > r || Math.max(...p) < -r) return false;
  }
  return true;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return [0, 1, 2].every((i) => a.min[i] <= b.max[i] && a.max[i] >= b.min[i]);
}

export function hits(node: MeshNode, probe: Box): boolean {
  if (!boxesOverlap(node.box, probe)) return false;
  return node.tris.some((t) => {
    const tb: Box = {
      min: [Math.min(t[0], t[3], t[6]), Math.min(t[1], t[4], t[7]), Math.min(t[2], t[5], t[8])],
      max: [Math.max(t[0], t[3], t[6]), Math.max(t[1], t[4], t[7]), Math.max(t[2], t[5], t[8])],
    };
    return boxesOverlap(tb, probe) && triBoxOverlap(t, probe);
  });
}

export function worldTriangles(node: GltfNode): Tri[] {
  const mesh = node.getMesh();
  if (!mesh) return [];
  const m = node.getWorldMatrix();
  const tris: Tri[] = [];
  const p = [0, 0, 0];
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue;
    const pos = prim.getAttribute('POSITION')!;
    const world: number[] = [];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      world.push(
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
      );
    }
    const idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let k = 0; k + 2 < n; k += 3) {
      const t: number[] = [];
      for (let j = 0; j < 3; j++) {
        const vi = idx ? idx.getScalar(k + j) : k + j;
        t.push(world[vi * 3], world[vi * 3 + 1], world[vi * 3 + 2]);
      }
      tris.push(t as Tri);
    }
  }
  return tris;
}

export function boundsOf(tris: Tri[]): Box {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) {
    for (let k = 0; k < 9; k++) {
      min[k % 3] = Math.min(min[k % 3], t[k]);
      max[k % 3] = Math.max(max[k % 3], t[k]);
    }
  }
  return { min, max };
}

export const exempt = (name: string, prefixes: string[]) =>
  prefixes.some((p) => name.startsWith(p));

export const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** HSV hue (deg) and saturation of a linear RGB factor, judged in sRGB like the #2f5bea rule. */
export function hueSat(linear: number[]): { hue: number; sat: number; val: number } {
  const [r, g, b] = linear.slice(0, 3).map(toSrgb);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { hue: h * 60, sat: max === 0 ? 0 : d / max, val: max };
}

export const hueDistance = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** Inner wall planes of the hall (metres): every wall face looks into the courtyard. */
export function wallPlanes() {
  return [
    { axis: 0, at: T, inward: 1 },
    { axis: 0, at: (layout.cols - 1) * T, inward: -1 },
    { axis: 2, at: T, inward: 1 },
    { axis: 2, at: (layout.rows - 1) * T, inward: -1 },
  ] as const;
}

/**
 * The face of a wall panel that looks into the hall (normal along `axis` * `inward`), with each
 * vertex's world position and UV0. Used to check a texture reads upright and unmirrored.
 */
export function frontFace(node: GltfNode, axis: 0 | 2, inward: 1 | -1) {
  const prim = node.getMesh()!.listPrimitives()[0];
  const pos = prim.getAttribute('POSITION')!;
  const uv = prim.getAttribute('TEXCOORD_0')!;
  const m = node.getWorldMatrix();
  const p = [0, 0, 0];
  const t = [0, 0];
  const verts: { w: number[]; u: number; v: number }[] = [];
  for (let i = 0; i < pos.getCount(); i++) {
    pos.getElement(i, p);
    uv.getElement(i, t);
    const w = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
    verts.push({ w, u: t[0], v: t[1] });
  }
  const depth = (v: { w: number[] }) => v.w[axis] * inward;
  const front = Math.max(...verts.map(depth));
  return verts.filter((v) => depth(v) > front - 1e-3);
}

/** What differs between worlds in the generic checks. */
export interface HallConfig {
  worldId: string;
  /** Seat desk nodes are named `${deskPrefix}${seat.uid}`. */
  deskPrefix: string;
  /** Node-name prefixes allowed inside a seat tile (the floor and the seat itself). */
  seatExempt: string[];
  /** Node-name prefixes allowed at a walkable tile centre. */
  walkExempt: string[];
  maxTotalMB: number;
  maxTriangles: number;
  minWalkProbes: number;
}

export interface HallContext {
  meta: WorldAssetMeta;
  doc: Document;
  nodes: MeshNode[];
}

/** Loads the hall GLB and registers the generic checks; the returned getter has the context. */
export function genericHallTests(cfg: HallConfig): () => HallContext {
  const ctx = {} as HallContext;
  beforeAll(async () => {
    const meta = parseWorldAssetMeta(JSON.parse(readFileSync(join(OUT, 'hall.meta.json'), 'utf8')));
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(join(OUT, meta.glb));
    const nodes: MeshNode[] = [];
    for (const node of doc.getRoot().listNodes()) {
      const tris = worldTriangles(node);
      if (tris.length > 0) nodes.push({ name: node.getName(), tris, box: boundsOf(tris) });
    }
    Object.assign(ctx, { meta, doc, nodes });
  }, 60_000);

  test('the meta parses, names this world and carries both moods', () => {
    expect(ctx.meta.worldId).toBe(cfg.worldId);
    expect(ctx.meta.tileMeters).toBe(T);
    expect(ctx.meta.moods.golden.lightmap.file).not.toBe(ctx.meta.moods.dusk.lightmap.file);
    expect(ctx.meta.moods.golden.sun.intensity).toBeGreaterThan(0);
    expect(ctx.meta.moods.golden.sun.penumbra).toBeGreaterThan(0);
    expect(ctx.meta.moods.dusk.sun).toBeNull();
    expect(ctx.meta.moods.golden.lightmap.intensity).toBeGreaterThan(0);
    expect(ctx.meta.moods.dusk.lightmap.intensity).toBeGreaterThan(0);
  });

  test('out/ holds exactly the deliverables the meta names', () => {
    const files = readdirSync(OUT).filter((f) => statSync(join(OUT, f)).isFile());
    const named = [
      'hall.meta.json',
      ctx.meta.glb,
      ctx.meta.moods.golden.lightmap.file,
      ctx.meta.moods.dusk.lightmap.file,
      ctx.meta.moods.golden.sun.gobo,
      ...(ctx.meta.armillary ? [ctx.meta.armillary.glb] : []),
      ...(ctx.meta.centrepiece ? [ctx.meta.centrepiece.glb] : []),
    ];
    expect([...files].sort()).toEqual([...new Set(named)].sort());
  });

  test('the committed outputs total at most ${cfg.maxTotalMB} MB', () => {
    const files = readdirSync(OUT).filter((f) => statSync(join(OUT, f)).isFile());
    const total = files.reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0);
    expect(total / MB).toBeLessThanOrEqual(cfg.maxTotalMB);
  });

  test('every primitive carries the lightmap UV set (TEXCOORD_1)', () => {
    const prims = ctx.doc
      .getRoot()
      .listMeshes()
      .flatMap((m) => m.listPrimitives());
    expect(prims.length).toBeGreaterThan(0);
    for (const prim of prims) expect(prim.getAttribute('TEXCOORD_1')).not.toBeNull();
  });

  test(`the hall is at most ${cfg.maxTriangles} triangles`, () => {
    const total = ctx.nodes.reduce((sum, n) => sum + n.tris.length, 0);
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThanOrEqual(cfg.maxTriangles);
  });

  test('every seat has a practical lamp, and the seat ids are real', () => {
    const seatIds = layout.seats.map((s) => s.uid).sort();
    const lampSeats = ctx.meta.practicals
      .filter((p) => p.seatUid !== undefined)
      .map((p) => p.seatUid)
      .sort();
    expect(lampSeats).toEqual(seatIds);
    for (const p of ctx.meta.practicals) expect(p.intensity).toBeGreaterThan(0);
  });

  test('each seat has a desk node over the desk tile it faces', () => {
    const step = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] } as const;
    for (const seat of layout.seats) {
      const desk = ctx.nodes.find((n) => n.name === `${cfg.deskPrefix}${seat.uid}`);
      expect(desk, `${cfg.deskPrefix}${seat.uid}`).toBeDefined();
      const [dc, dr] = step[seat.facing];
      const r = tileRect(seat.col + dc, seat.row + dr);
      const b = desk!.box;
      expect(b.min[0] < r.x1 && b.max[0] > r.x0, `${seat.uid} x`).toBe(true);
      expect(b.min[2] < r.z1 && b.max[2] > r.z0, `${seat.uid} z`).toBe(true);
    }
  });

  test('nothing but floor and cushions stands in a seat tile (0 to 1.6 m)', () => {
    for (const seat of layout.seats) {
      const r = tileRect(seat.col, seat.row, 0.1);
      const column: Box = { min: [r.x0, 0, r.z0], max: [r.x1, 1.6, r.z1] };
      const blockers = ctx.nodes
        .filter((n) => !exempt(n.name, cfg.seatExempt))
        .filter((n) => hits(n, column))
        .map((n) => n.name);
      expect(blockers, seat.uid).toEqual([]);
    }
  });

  test('nothing but the floor stands at a walkable tile centre (0.1 to 1.8 m)', () => {
    const furniture = new Set<string>();
    for (const f of layout.furniture)
      for (let r = 0; r < f.footprintH; r++)
        for (let c = 0; c < f.footprintW; c++) furniture.add(`${f.col + c},${f.row + r}`);
    let probes = 0;
    for (let row = 0; row < layout.rows; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const tile = layout.tiles[row * layout.cols + col];
        if (tile === WALL || tile === VOID || furniture.has(`${col},${row}`)) continue;
        const cx = (col + 0.5) * T;
        const cz = (row + 0.5) * T;
        const probe: Box = { min: [cx - 0.1, 0.1, cz - 0.1], max: [cx + 0.1, 1.8, cz + 0.1] };
        const blockers = ctx.nodes
          .filter((n) => !exempt(n.name, cfg.walkExempt))
          .filter((n) => hits(n, probe))
          .map((n) => n.name);
        expect(blockers, `tile ${col},${row}`).toEqual([]);
        probes++;
      }
    }
    expect(probes).toBeGreaterThan(cfg.minWalkProbes);
  });

  return () => ctx;
}
