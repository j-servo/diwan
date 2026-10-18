// Contract test for the figurine asset (Task 4). Reads the committed, optimised GLB with
// @gltf-transform/core and checks everything the avatar runtime (Task 5) depends on.
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Document, type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, test } from 'vitest';

const GLB = fileURLToPath(new URL('../assets/figures/out/figures.glb', import.meta.url));
const META = fileURLToPath(new URL('../assets/figures/out/figures.meta.json', import.meta.url));

const FIGURES = ['scholar', 'apprentice'] as const;
const CLIPS = [
  'idle',
  'walk',
  'sit_idle',
  'write',
  'read',
  'astrolabe',
  'scroll_search',
  'receive_letter',
  'gesture_beckon',
  'look_up',
  'stand_up',
  'sit_down',
] as const;
const ONE_SHOT = new Set(['stand_up', 'sit_down']);
const PROPS = ['prop_reed_pen', 'prop_codex', 'prop_astrolabe', 'prop_scroll', 'prop_letter'];
const MAX_BYTES = 3_000_000;
const MAX_TRIS = 8000;

type Mat4 = number[];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function apply(m: Mat4, p: number[]): number[] {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

function subtree(node: Node): Node[] {
  return [node, ...node.listChildren().flatMap(subtree)];
}

function hueDeg([r, g, b]: number[]): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

let doc: Document;
let roots: Record<(typeof FIGURES)[number], Node>;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(GLB);
  const top = doc.getRoot().getDefaultScene()!.listChildren();
  const find = (name: string) => top.find((n) => n.getName() === name)!;
  roots = { scholar: find('scholar'), apprentice: find('apprentice') };
});

describe('figures.glb', () => {
  test('both figure root nodes are top-level scene nodes', () => {
    expect(roots.scholar).toBeDefined();
    expect(roots.apprentice).toBeDefined();
  });

  test('each figure has one skin, and both skins have the same bone names in the same order', () => {
    const joints = FIGURES.map((f) => {
      const skins = new Set(subtree(roots[f]).flatMap((n) => (n.getSkin() ? [n.getSkin()!] : [])));
      expect(skins.size, f).toBe(1);
      return [...skins][0].listJoints().map((j) => j.getName());
    });
    expect(joints[0]).toEqual(joints[1]);
    expect(joints[0]).toContain('hand.R');
    expect(joints[0]).toContain('hand.L');
    // Each figure's joints live under its own root, so SkeletonUtils.clone(root) carries them.
    for (const f of FIGURES) {
      const own = new Set(subtree(roots[f]));
      const skin = subtree(roots[f])
        .find((n) => n.getSkin())!
        .getSkin()!;
      for (const j of skin.listJoints()) expect(own.has(j), `${f}/${j.getName()}`).toBe(true);
    }
  });

  test('every clip exists with a positive duration', () => {
    const anims = new Map(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => [a.getName(), a]),
    );
    for (const clip of CLIPS) {
      const anim = anims.get(clip);
      expect(anim, clip).toBeDefined();
      const end = Math.max(...anim!.listSamplers().map((s) => s.getInput()!.getMax([])[0]));
      expect(end, clip).toBeGreaterThan(0);
    }
  });

  test('looping clips start and end on the same pose', () => {
    for (const anim of doc.getRoot().listAnimations()) {
      if (ONE_SHOT.has(anim.getName())) continue;
      for (const ch of anim.listChannels()) {
        const out = ch.getSampler()!.getOutput()!;
        const first = out.getElement(0, []);
        const last = out.getElement(out.getCount() - 1, []);
        // Quaternions q and -q are the same rotation.
        const sign =
          ch.getTargetPath() === 'rotation' && first.reduce((s, v, i) => s + v * last[i], 0) < 0
            ? -1
            : 1;
        const err = Math.max(...first.map((v, i) => Math.abs(v - sign * last[i])));
        expect(
          err,
          `${anim.getName()} ${ch.getTargetNode()!.getName()}.${ch.getTargetPath()}`,
        ).toBeLessThan(0.01);
      }
    }
  });

  test('walk is in place: no root motion, the runtime moves the root', () => {
    const walk = doc
      .getRoot()
      .listAnimations()
      .find((a) => a.getName() === 'walk')!;
    for (const ch of walk.listChannels()) {
      const name = ch.getTargetNode()!.getName();
      expect(FIGURES as readonly string[]).not.toContain(name);
      if (ch.getTargetPath() !== 'translation' || name !== 'hips') continue;
      const out = ch.getSampler()!.getOutput()!;
      // hips is a child of the root bone; glTF is Y-up, so X and Z are the ground plane.
      for (const axis of [0, 2]) {
        const vals = Array.from({ length: out.getCount() }, (_, i) => out.getElement(i, [])[axis]);
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThan(0.06);
      }
    }
  });

  test('a material named trim exists, is used by both figures and is not cobalt', () => {
    const trim = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'trim');
    expect(trim).toBeDefined();
    for (const f of FIGURES) {
      const used = subtree(roots[f])
        .flatMap((n) => n.getMesh()?.listPrimitives() ?? [])
        .some((p) => p.getMaterial() === trim);
      expect(used, f).toBe(true);
    }
    const hue = hueDeg(trim!.getBaseColorFactor().slice(0, 3));
    // Cobalt glaze #2f5bea sits at about 226 degrees; it is reserved for "needs you".
    expect(Math.abs(hue - 226)).toBeGreaterThan(25);
  });

  test('every prop is under a hand bone of each figure and hidden by default', () => {
    for (const f of FIGURES) {
      const nodes = subtree(roots[f]);
      for (const prop of PROPS) {
        const hits = nodes.filter((n) => n.getName() === prop);
        expect(hits, `${f}/${prop}`).toHaveLength(1);
        expect(['hand.R', 'hand.L'], `${f}/${prop}`).toContain(hits[0].getParentNode()!.getName());
        expect((hits[0].getExtras() as { hidden?: unknown }).hidden, `${f}/${prop}`).toBeTruthy();
      }
    }
  });

  test('the candle is its own node; candle_wax scales on Y from its base', () => {
    const candle = doc
      .getRoot()
      .getDefaultScene()!
      .listChildren()
      .find((n) => n.getName() === 'candle');
    expect(candle).toBeDefined();
    const wax = candle!.listChildren().find((n) => n.getName() === 'candle_wax');
    expect(wax?.getMesh()).toBeTruthy();
    // Optimisation must not fold quantisation into this node: unit scale, origin at the base.
    expect(wax!.getScale()).toEqual([1, 1, 1]);
    const pos = wax!.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!;
    expect(pos.getMin([])[1]).toBeCloseTo(0, 3);
    expect(pos.getMax([])[1]).toBeGreaterThan(0.05);
  });

  test('props keep unit scale (quantisation did not move their pivots)', () => {
    for (const f of FIGURES)
      for (const n of subtree(roots[f]))
        if (n.getName().startsWith('prop_'))
          expect(n.getScale(), `${f}/${n.getName()}`).toEqual([1, 1, 1]);
  });

  test('size and triangle budgets hold', () => {
    expect(statSync(GLB).size).toBeLessThanOrEqual(MAX_BYTES);
    for (const f of FIGURES) {
      let tris = 0;
      for (const n of subtree(roots[f]))
        for (const p of n.getMesh()?.listPrimitives() ?? [])
          tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3;
      expect(tris, f).toBeLessThanOrEqual(MAX_TRIS);
    }
  });

  test('bind pose survives optimisation and figures have the stated heights', () => {
    const heights: Record<string, number> = {};
    for (const f of FIGURES) {
      const meshNode = subtree(roots[f]).find((n) => n.getSkin())!;
      const skin = meshNode.getSkin()!;
      const ibms = skin.getInverseBindMatrices()!;
      const binds = skin
        .listJoints()
        .map((j, i) => mul(j.getWorldMatrix() as Mat4, ibms.getElement(i, []) as Mat4));
      // At rest every joint maps the mesh to the same place, or the skin is broken.
      for (const m of binds) for (let k = 0; k < 16; k++) expect(m[k]).toBeCloseTo(binds[0][k], 3);
      let lo = Infinity;
      let hi = -Infinity;
      for (const prim of meshNode.getMesh()!.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!;
        for (let i = 0; i < pos.getCount(); i++) {
          const y = apply(binds[0], pos.getElement(i, []))[1];
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      expect(lo, f).toBeGreaterThan(-0.02);
      expect(lo, f).toBeLessThan(0.05);
      heights[f] = hi;
    }
    expect(heights.scholar).toBeGreaterThan(1.6);
    expect(heights.scholar).toBeLessThan(1.72);
    expect(heights.apprentice / heights.scholar).toBeGreaterThan(0.8);
    expect(heights.apprentice / heights.scholar).toBeLessThan(0.9);
  });
});

describe('figures.meta.json', () => {
  const meta = JSON.parse(readFileSync(META, 'utf8')) as {
    fps: number;
    clips: Record<string, { duration: number; loop: boolean }>;
    walk: { speedMps: number; cycleSeconds: number; strideMeters: number };
    seated: { hipHeight: number; cushionHeight: number; deskHeight: number };
  };

  test('lists every clip with the GLB duration', () => {
    expect(meta.fps).toBeGreaterThanOrEqual(24);
    expect(meta.fps).toBeLessThanOrEqual(30);
    const anims = new Map(
      doc
        .getRoot()
        .listAnimations()
        .map((a) => [a.getName(), a]),
    );
    for (const clip of CLIPS) {
      const end = Math.max(
        ...anims
          .get(clip)!
          .listSamplers()
          .map((s) => s.getInput()!.getMax([])[0]),
      );
      expect(meta.clips[clip].duration, clip).toBeCloseTo(end, 2);
      expect(meta.clips[clip].loop, clip).toBe(!ONE_SHOT.has(clip));
    }
  });

  test('documents the walk speed and the seated hip height', () => {
    expect(meta.walk.speedMps).toBeGreaterThan(0.5);
    expect(meta.walk.speedMps * meta.walk.cycleSeconds).toBeCloseTo(meta.walk.strideMeters, 3);
    expect(meta.seated.cushionHeight).toBeCloseTo(0.15, 2);
    expect(meta.seated.deskHeight).toBeCloseTo(0.45, 2);
    expect(meta.seated.hipHeight).toBeGreaterThan(meta.seated.cushionHeight);
  });
});
