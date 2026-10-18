// Contract for the House of Life's figures-egypt.glb: the same nodes and clips as the House of
// Wisdom's, its garments as named materials, the amethyst colour law, the triangle budget, and the
// House of Wisdom's figures.glb untouched.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { type Document, type Node, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, test } from 'vitest';

import { applyCostume } from '../src/agents/figureLogic.js';
import { egyptCostume } from '../src/worlds/houseOfLife/costumes.js';
import { getWorld } from '../src/worlds/registry.js';

const url = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const EGYPT = url('../assets/worlds/house-of-life/out/figures/figures-egypt.glb');
const WISDOM = url('../assets/figures/out/figures.glb');
const WISDOM_META = url('../assets/figures/out/figures.meta.json');
// sha256 of the House of Wisdom's committed figures.glb: round B must never change it
const WISDOM_SHA256 = 'a9050965796a9fb834c9487eef638513718263d0f0b8dfb429a090709754221d';

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
];
const PROPS = ['prop_reed_pen', 'prop_codex', 'prop_astrolabe', 'prop_scroll', 'prop_letter'];
const GARMENTS = ['skin', 'kilt', 'belt', 'dress', 'shirt', 'sash', 'wig', 'wig_long', 'trim'];
const AMETHYST_HUE = 295;

const subtree = (n: Node): Node[] => [n, ...n.listChildren().flatMap(subtree)];

function hsl([r, g, b]: number[]): { h: number; s: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60;
  return { h, s };
}
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

let doc: Document;
let roots: Record<'scholar' | 'apprentice', Node>;

beforeAll(async () => {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  doc = await io.read(EGYPT);
  const top = doc.getRoot().getDefaultScene()!.listChildren();
  const find = (name: string) => top.find((n) => n.getName() === name)!;
  roots = { scholar: find('scholar'), apprentice: find('apprentice') };
});

const tris = (root: Node) =>
  subtree(root)
    .flatMap((n) => n.getMesh()?.listPrimitives() ?? [])
    .reduce(
      (t, p) => t + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3,
      0,
    );

describe('figures-egypt.glb', () => {
  test('the runtime contract: figure nodes, props under the hands, the candle, the 12 clips', () => {
    expect(roots.scholar).toBeDefined();
    expect(roots.apprentice).toBeDefined();
    for (const f of ['scholar', 'apprentice'] as const)
      for (const prop of PROPS) {
        const hits = subtree(roots[f]).filter((n) => n.getName() === prop);
        expect(hits, `${f}/${prop}`).toHaveLength(1);
        expect(['hand.R', 'hand.L']).toContain(hits[0].getParentNode()!.getName());
      }
    const candle = doc
      .getRoot()
      .getDefaultScene()!
      .listChildren()
      .find((n) => n.getName() === 'candle')!;
    expect(candle.listChildren().map((n) => n.getName())).toEqual(
      expect.arrayContaining(['candle_wax', 'candle_flame']),
    );
    const names = doc
      .getRoot()
      .listAnimations()
      .map((a) => a.getName());
    for (const c of CLIPS) expect(names, c).toContain(c);
  });

  test('every garment variant is a named material the runtime can switch', () => {
    const mats = doc
      .getRoot()
      .listMaterials()
      .map((m) => m.getName());
    for (const g of GARMENTS) expect(mats, g).toContain(g);
    const used = (root: Node) =>
      new Set(
        subtree(root)
          .flatMap((n) => n.getMesh()?.listPrimitives() ?? [])
          .map((p) => p.getMaterial()?.getName()),
      );
    for (const g of GARMENTS) expect(used(roots.scholar).has(g), `scholar/${g}`).toBe(true);
    // the pupil: kilt, belt, collar and the side-lock only
    for (const g of ['skin', 'kilt', 'belt', 'trim', 'hair'])
      expect(used(roots.apprentice).has(g), `pupil/${g}`).toBe(true);
  });

  test('colour law: nothing saturated in 255-335 degrees; the collar is 40+ from amethyst', () => {
    for (const m of doc.getRoot().listMaterials()) {
      const srgb = m.getBaseColorFactor().slice(0, 3).map(linearToSrgb);
      const { h, s } = hsl(srgb);
      if (s >= 0.2) expect(h < 255 || h > 335, `${m.getName()} hue ${h.toFixed(0)}`).toBe(true);
      if (m.getName() === 'trim') expect(Math.abs(h - AMETHYST_HUE)).toBeGreaterThan(40);
    }
  });

  test('triangles stay within the House of Wisdom figures budget', () => {
    const meta = JSON.parse(readFileSync(WISDOM_META, 'utf8')) as {
      figures: Record<string, { triangles: number }>;
    };
    expect(tris(roots.scholar)).toBeLessThanOrEqual(meta.figures.scholar.triangles);
    expect(tris(roots.apprentice)).toBeLessThanOrEqual(meta.figures.apprentice.triangles);
  });

  test('the House of Wisdom figures.glb is byte-identical', () => {
    expect(createHash('sha256').update(readFileSync(WISDOM)).digest('hex')).toBe(WISDOM_SHA256);
  });
});

describe('costumes', () => {
  test('priests are shaved, craft titles wear a short wig, three women wear dress and long wig', () => {
    for (const t of ['Lector', 'Astronomer', 'Timekeeper'])
      expect(egyptCostume(t, 0, false).wig).toBe('none');
    expect(egyptCostume('Lector', 0, false).sash).toBe(true);
    expect(egyptCostume('Architect', 0, false).wig).toBe('short');
    const women = ['Physician', 'Archivist', 'Herbalist'].map((t) => egyptCostume(t, 0, false));
    for (const w of women) expect(w).toMatchObject({ dress: true, wig: 'long' });
    expect(egyptCostume('Astronomer II', 0, false)).toEqual(egyptCostume('Astronomer', 0, false));
  });

  test('applyCostume switches materials by name and tints the skin', () => {
    let tint = '';
    const skin = { name: 'skin', visible: true, color: { set: (c: string) => (tint = c) } };
    const mk = (name: string) => ({ name, visible: true });
    const names = ['kilt', 'belt', 'dress', 'wig', 'wig_long', 'sash', 'shirt', 'trim'];
    const mats = names.map(mk);
    applyCostume([...mats, skin], egyptCostume('Physician', 0, false));
    const v = Object.fromEntries(mats.map((m) => [m.name, m.visible]));
    expect(v).toMatchObject({
      kilt: false,
      belt: false,
      dress: true,
      wig: false,
      wig_long: true,
      sash: false,
      shirt: false,
      trim: true,
    });
    expect(tint).toBe('#8e6038');
  });

  test('each world names its figures file; only the House of Life has a costume set', () => {
    expect(getWorld('house-of-wisdom').figures).toBeUndefined();
    expect(getWorld('house-of-life').figures).toBe('figures-egypt.glb');
    expect(getWorld('house-of-life').costume).toBe(egyptCostume);
    expect(getWorld('house-of-wisdom').costume).toBeUndefined();
  });
});
