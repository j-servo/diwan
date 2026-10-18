// Acceptance tests for the baked House of Life temple (E2 look-dev). They read the committed,
// optimised outputs in assets/worlds/house-of-life/out/ (rebuild: DIWAN_WORLD=house-of-life
// npm run assets). The checks every world's hall must pass run through hallHarness.ts; this file
// adds the temple's own: the pyramid model's GLB, the colour law at amethyst's 40 degrees, the
// font-rendered title, no House of Wisdom node names, and the occlusion gate at the default camera.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, test } from 'vitest';

import { getWorld } from '../src/worlds/registry.js';
import { basisTranscoder, texelsNearHue } from './basisTranscoder.js';
import {
  type Box,
  boundsOf,
  genericHallTests,
  hueDistance,
  hueSat,
  layout,
  type MeshNode,
  OUT,
  selectWorld,
  T,
  type Tri,
  WORLD,
  worldTriangles,
} from './hallHarness.js';

selectWorld('house-of-life');

// Amethyst #A21CAF (~295 deg) means "needs you" here: nothing saturated within 40 deg of it.
const AMETHYST_HUE = 295;
const HUE_GUARD = 40;
const HOW_OUT = join(WORLD, '..', 'house-of-wisdom', 'out');

async function readGlb(path: string): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.read(path);
}

function meshNodes(doc: Document): MeshNode[] {
  const nodes: MeshNode[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const tris = worldTriangles(node);
    if (tris.length > 0) nodes.push({ name: node.getName(), tris, box: boundsOf(tris) });
  }
  return nodes;
}

/** Hue (deg), saturation and value of an sRGB texel (0..1 per channel). */
function rgbHsv(r: number, g: number, b: number): { hue: number; sat: number; val: number } {
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

// ---------------------------------------------------------------- the occlusion gate
type V3 = [number, number, number];

/** Moller-Trumbore: distance along the unit ray to the triangle, or Infinity. */
function rayTri(o: V3, d: V3, t: Tri): number {
  const e1 = [t[3] - t[0], t[4] - t[1], t[5] - t[2]];
  const e2 = [t[6] - t[0], t[7] - t[1], t[8] - t[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const s = [o[0] - t[0], o[1] - t[1], o[2] - t[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return Infinity;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return dist > 0 ? dist : Infinity;
}

/** Slab test: does the segment o + d * [0, len] touch the box? */
function rayBox(o: V3, d: V3, len: number, b: Box): boolean {
  let t0 = 0;
  let t1 = len;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-12) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return false;
      continue;
    }
    let a = (b.min[i] - o[i]) / d[i];
    let c = (b.max[i] - o[i]) / d[i];
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return false;
  }
  return true;
}

/** Head-and-shoulders of a figure seated cross-legged on the seat's mat (metres). */
const HEAD_SHOULDERS = { halfWidth: 0.22, y0: 0.62, y1: 1.05, n: 5 };

/**
 * The fraction of a seated figure's head-and-shoulders, seen from the camera, that no triangle
 * of `nodes` hides: a 5 x 5 grid over the silhouette, one ray per point towards the camera.
 */
function visibleFraction(cam: V3, seat: { col: number; row: number }, nodes: MeshNode[]): number {
  const cx = (seat.col + 0.5) * T;
  const cz = (seat.row + 0.5) * T;
  const { halfWidth, y0, y1, n } = HEAD_SHOULDERS;
  let seen = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p: V3 = [
        cx - halfWidth + (2 * halfWidth * i) / (n - 1),
        y0 + ((y1 - y0) * j) / (n - 1),
        cz,
      ];
      const d: V3 = [cam[0] - p[0], cam[1] - p[1], cam[2] - p[2]];
      const len = Math.hypot(...d);
      const u: V3 = [d[0] / len, d[1] / len, d[2] / len];
      const hidden = nodes.some(
        (node) =>
          rayBox(p, u, len, node.box) && node.tris.some((t) => rayTri(p, u, t) < len - 1e-3),
      );
      if (!hidden) seen++;
    }
  }
  return seen / (n * n);
}

describe('House of Life temple asset', () => {
  const ctx = genericHallTests({
    worldId: 'house-of-life',
    deskPrefix: 'table_',
    seatExempt: ['temple_floor', 'reed_mats'],
    walkExempt: ['temple_floor'],
    maxTotalMB: 12,
    maxTriangles: 100_000,
    // A2's court dressing (offering tables, lamp stands, papyrus, jars) blocks ten more tiles
    minWalkProbes: 90,
  });
  let doc: Document;
  let nodes: MeshNode[];
  let pyramid: Document;
  let pyramidNodes: MeshNode[];
  beforeAll(async () => {
    ({ doc, nodes } = ctx());
    pyramid = await readGlb(join(OUT, 'pyramid.glb'));
    pyramidNodes = meshNodes(pyramid);
  }, 60_000);

  test('the pyramid and its pool are their own GLB, named for the runtime, lit by the hall lightmaps (uv1)', () => {
    expect(ctx().meta.centrepiece?.glb).toBe('pyramid.glb');
    const names = pyramidNodes.map((n) => n.name).sort();
    expect(names).toEqual(
      [
        'pool_basin',
        'pool_papyrus_e',
        'pool_papyrus_w',
        'pool_water',
        'pyramid_capstone',
        'pyramid_casing',
        'pyramid_plinth',
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `lotus_${i}`),
      ].sort(),
    );
    for (const mesh of pyramid.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives())
        expect(prim.getAttribute('TEXCOORD_1'), mesh.getName()).not.toBeNull();
    // the whole pyramid: no interior, no sarcophagus, no lamps, no procession route
    const meta = JSON.parse(readFileSync(join(OUT, 'hall.meta.json'), 'utf8'));
    expect(meta.centrepiece.procession).toBeUndefined();
    expect(names.filter((n) => /flame|sarcophagus|lamp/.test(n))).toEqual([]);
    const materials = pyramid
      .getRoot()
      .listMaterials()
      .map((m) => m.getName());
    for (const gone of ['interior', 'gallery', 'king', 'section', 'core'])
      expect(materials).not.toContain(gone);
  });

  test('the pyramid: a complete 5.5 m square at 51.8 deg to a true apex under a gold pyramidion', () => {
    const casing = pyramidNodes.find((n) => n.name === 'pyramid_casing')!;
    const cap = pyramidNodes.find((n) => n.name === 'pyramid_capstone')!;
    const { min, max } = casing.box;
    expect(max[0] - min[0]).toBeCloseTo(5.5, 1);
    // all four faces: the same width both ways, nothing sliced off
    expect(max[2] - min[2]).toBeCloseTo(5.5, 1);
    expect((min[2] + max[2]) / 2).toBeCloseTo(12, 2); // rows 5-10: a lane all round (round F)
    expect((min[0] + max[0]) / 2).toBeCloseTo(15, 2);
    // four sloping faces only: no cut, no chamber. Each face is three courses (plain, the frieze's
    // band, plain), two triangles apiece (round E)
    expect(casing.tris.length).toBe(24);
    expect(cap.tris.length).toBe(4);
    // the casing ends under the gold; the pyramidion carries the point (3.5 m = 146.6 m at 1:42)
    const apex = cap.box.max[1] - min[1];
    expect(apex).toBeGreaterThan(3.45);
    expect(apex).toBeLessThan(3.56);
    expect(max[1]).toBeLessThan(cap.box.max[1] - 0.3);
    // a point, not a platform: the cap's highest vertices coincide
    const top = cap.tris.flatMap((t) =>
      [0, 1, 2].map((k) => [t[k * 3], t[k * 3 + 1], t[k * 3 + 2]]),
    );
    const crest = top.filter(([, y]) => y > cap.box.max[1] - 1e-3);
    expect(Math.max(...crest.map((c) => c[0])) - Math.min(...crest.map((c) => c[0]))).toBeLessThan(
      0.01,
    );
    expect(Math.max(...crest.map((c) => c[2])) - Math.min(...crest.map((c) => c[2]))).toBeLessThan(
      0.01,
    );
    // the slope: rise over run from the base edge to the apex
    expect((Math.atan(apex / ((max[0] - min[0]) / 2)) * 180) / Math.PI).toBeCloseTo(51.84, 0);
    const water = pyramidNodes.find((n) => n.name === 'pool_water')!;
    expect(water.box.max[1]).toBeLessThan(0); // one step down
    expect(water.box.max[0] - water.box.min[0]).toBeGreaterThan(7);
    const basin = pyramidNodes.find((n) => n.name === 'pool_basin')!;
    expect(basin.box.max[0] - basin.box.min[0]).toBeCloseTo(8.4, 1);
  });

  test('the pool and everything in it stays inside the blocked footprint (cols 7-12, rows 5-10)', () => {
    // x 10.5-19.5 m, z 7.5-16.5 m: lilies, reeds, steps, water and coping all inside it
    for (const n of pyramidNodes) {
      expect(n.box.min[0], n.name).toBeGreaterThanOrEqual(7 * T - 1e-6);
      expect(n.box.max[0], n.name).toBeLessThanOrEqual(13 * T + 1e-6);
      expect(n.box.min[2], n.name).toBeGreaterThanOrEqual(5 * T - 1e-6);
      expect(n.box.max[2], n.name).toBeLessThanOrEqual(11 * T + 1e-6);
    }
    // and the visible pool covers its blocked tiles to within a coping's width: no tile looks walkable
    const basin = pyramidNodes.find((n) => n.name === 'pool_basin')!;
    expect(7 * T + 0.5).toBeGreaterThan(basin.box.min[0]);
    expect(13 * T - 0.5).toBeLessThan(basin.box.max[0]);
    expect(5 * T + 0.5).toBeGreaterThan(basin.box.min[2]);
    expect(11 * T - 0.5).toBeLessThan(basin.box.max[2]);
  });

  test('the water: a material for the runtime shader, with the pool numbers and a green-teal base', () => {
    const water = pyramid
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'water')!;
    const extras = water.getExtras() as Record<string, number>;
    for (const k of ['poolCx', 'poolCz', 'poolPlinth', 'poolCoping', 'poolWaterY'])
      expect(typeof extras[k], k).toBe('number');
    expect(extras.poolCx).toBeCloseTo(15, 2);
    expect(extras.poolWaterY).toBeLessThan(0);
    const sun = Math.hypot(extras.poolSunX, extras.poolSunY, extras.poolSunZ);
    expect(sun).toBeCloseTo(1, 3);
    expect(extras.poolSunY).toBeGreaterThan(0.5); // a high sun
    const { hue } = hueSat(water.getBaseColorFactor());
    expect(hue).toBeGreaterThan(150);
    expect(hue).toBeLessThan(200);
  });

  test('the gold is gold: the pyramidion and the obelisk tips use one electrum material', () => {
    for (const d of [doc, pyramid]) {
      const gold = d
        .getRoot()
        .listMaterials()
        .find((m) => m.getName() === 'gold')!;
      expect(gold).toBeDefined();
      const { hue, sat, val } = hueSat(gold.getBaseColorFactor());
      expect(hue).toBeGreaterThan(36);
      expect(hue).toBeLessThan(52);
      expect(sat).toBeGreaterThan(0.6);
      expect(val).toBeGreaterThan(0.7);
      expect(gold.getMetallicFactor()).toBeGreaterThan(0.6); // it reads as metal, not as paint
    }
  });

  test('the frieze: ankh, djed, was (U+132F9 U+132BD U+13300) from the font, on a band of each face', async () => {
    // the sequence is stated once in pyramid_spec.py and once in the renderer, and nothing else
    const script = readFileSync(join(WORLD, '..', '..', 'render-hieroglyphs.mjs'), 'utf8');
    const spec = readFileSync(join(WORLD, '..', '..', 'blender', 'pyramid_spec.py'), 'utf8');
    const frieze = /const FRIEZE = \{\s*text: '([^']+)'/.exec(script)![1];
    const points = [...frieze.matchAll(/\\u\{([0-9A-Fa-f]+)\}/g)].map((m) => m[1].toUpperCase());
    expect(frieze.replace(/\\u\{[0-9A-Fa-f]+\}/g, '')).toBe(''); // no other character, no king's name
    expect(points).toEqual(['132F9', '132BD', '13300']);
    expect(/FRIEZE_SIGNS = \(0x132F9, 0x132BD, 0x13300\)/.test(spec)).toBe(true);
    expect(script).toContain('NotoSansEgyptianHieroglyphs-Regular.ttf');
    // the rendered row holds exactly those three solid signs, left to right
    const png = PNG.sync.read(readFileSync(join(WORLD, 'src', 'frieze_signs.png')));
    const cols: boolean[] = new Array(png.width).fill(false);
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++)
        if (png.data[(y * png.width + x) * 4 + 3] > 128) cols[x] = true;
    const runs = cols.filter((c, i) => c && !cols[i - 1]).length;
    expect(runs).toBe(3);

    // the casing's three courses: the band is its own material, 14% of the height up, four faces
    const node = pyramid
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'pyramid_casing')!;
    const prims = node.getMesh()!.listPrimitives();
    const band = prims.filter((p) => p.getMaterial()!.getName() === 'frieze');
    expect(band.length).toBe(1);
    const ys: number[] = [];
    let bandTris = 0;
    const pos = band[0].getAttribute('POSITION')!;
    const m = node.getWorldMatrix();
    const v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      ys.push(m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]);
    }
    bandTris = band[0].getIndices()!.getCount() / 3;
    expect(bandTris).toBe(8); // four faces, one quad each
    const base = Math.min(...casingBase());
    const rel = (y: number) => (y - base) / 3.5;
    expect(rel(Math.min(...ys))).toBeGreaterThan(0.07);
    expect(rel(Math.max(...ys))).toBeLessThan(0.21);
    expect((rel(Math.min(...ys)) + rel(Math.max(...ys))) / 2).toBeCloseTo(0.14, 2);
    expect(Math.max(...ys) - base).toBeLessThan(1.0); // low, nowhere near the gold (3.08 m)

    // the carved texture: 21 signs, ankh djed was repeating, a djed in the middle
    const mat = band[0].getMaterial()!;
    expect(mat.getNormalTexture()).not.toBeNull();
    const decode = await basisTranscoder();
    const { w, h, rgba } = decode(mat.getBaseColorTexture()!.getImage()!);
    expect([w, h]).toEqual([4096, 344]);
    const gold = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return (rgba[i] - rgba[i + 2]) / 255 > 0.24; // the pale gold wash; the limestone is ~0.09
    };
    const y0 = Math.round(h * 0.24); // between the two rules
    const y1 = Math.round(h * 0.76);
    const sign: boolean[] = new Array(w).fill(false);
    for (let x = 0; x < w; x++) for (let y = y0; y < y1; y++) if (gold(x, y)) sign[x] = true;
    const groups: [number, number][] = [];
    for (let x = 0; x < w; x++)
      if (sign[x]) {
        const last = groups[groups.length - 1];
        if (last && x - last[1] <= 6) last[1] = x;
        else groups.push([x, x]);
      }
    expect(groups.length).toBe(21);
    const kind = groups.map(([a, b]) => {
      // a djed flares to a broad foot, an ankh ends in a narrow stem
      let top = h;
      let bot = 0;
      for (let y = 0; y < h; y++)
        for (let x = a; x <= b; x++)
          if (gold(x, y)) {
            top = Math.min(top, y);
            bot = Math.max(bot, y);
          }
      const rowAt = (y: number) => {
        let n = 0;
        for (let x = a; x <= b; x++) if (gold(x, y)) n++;
        return n;
      };
      const foot = rowAt(top + Math.round((bot - top) * 0.92)) / (b - a + 1);
      return b - a < 32 ? 'was' : foot > 0.6 ? 'djed' : 'ankh';
    });
    const want = Array.from({ length: 21 }, (_, i) => ['ankh', 'djed', 'was'][i % 3]);
    expect(kind).toEqual(want);
    expect(kind[10]).toBe('djed');

    // colour law and the casing stays white: the band is mostly plain limestone, the wash a few %
    expect(texelsNearHue(rgba, AMETHYST_HUE, HUE_GUARD)).toBe(0);
    let sumV = 0;
    let washed = 0;
    for (let i = 0; i < w * h; i++) {
      sumV += Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]) / 255;
      if ((rgba[i * 4] - rgba[i * 4 + 2]) / 255 > 0.24) washed++;
    }
    expect(sumV / (w * h)).toBeGreaterThan(0.75);
    expect(washed / (w * h)).toBeLessThan(0.1);
    const lime = pyramid
      .getRoot()
      .listMaterials()
      .find((x) => x.getName() === 'limestone')!;
    const L = decode(lime.getBaseColorTexture()!.getImage()!);
    let lv = 0;
    for (let i = 0; i < L.w * L.h; i++)
      lv += Math.max(L.rgba[i * 4], L.rgba[i * 4 + 1], L.rgba[i * 4 + 2]) / 255;
    expect(lv / (L.w * L.h)).toBeGreaterThan(0.8);

    function casingBase(): number[] {
      const all = prims.flatMap((p) => {
        const a = p.getAttribute('POSITION')!;
        const out: number[] = [];
        const e = [0, 0, 0];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, e);
          out.push(m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13]);
        }
        return out;
      });
      return [Math.min(...all)];
    }
  });

  test('the pyramid gleams: the casing and the gold take the room, the gold glows towards dusk', () => {
    const get = (n: string) =>
      pyramid
        .getRoot()
        .listMaterials()
        .find((m) => m.getName() === n)!;
    expect((get('gold').getExtras() as Record<string, number>).envScale).toBeGreaterThan(3);
    expect((get('gold').getExtras() as Record<string, number>).duskGlow).toBeGreaterThan(1);
    expect(
      (get('limestone').getExtras() as Record<string, number>).envScale,
    ).toBeGreaterThanOrEqual(1);
    expect(get('limestone').getRoughnessFactor()).toBeLessThan(0.6); // satin Tura, not matte
  });

  test('the facade: six 7 m Hathor columns, four screen walls at ~0.42 of them, the colonnades', () => {
    const cols = [0, 1, 2, 3, 4, 5].map((i) => nodes.find((n) => n.name === `hathor_${i}`)!);
    for (const c of cols) expect(c.box.max[1] - c.box.min[1]).toBeCloseTo(7.0, 1);
    for (const side of ['w', 'e'])
      expect(nodes.find((n) => n.name === `hathor_${side}`)!.box.max[1]).toBeCloseTo(4.4, 1);
    const screens = [0, 1, 2, 3].map((i) => nodes.find((n) => n.name === `screen_${i}`)!);
    for (const s of screens) expect((s.box.max[1] - s.box.min[1]) / 7.0).toBeCloseTo(0.42, 2);
    expect(nodes.find((n) => n.name === 'facade_door')).toBeDefined();
    expect(nodes.find((n) => n.name === 'facade_cornice')).toBeDefined();
  });

  test('the title 𓉐𓋹 sits on the lintel under the winged disc, rendered from the font', async () => {
    const script = readFileSync(join(WORLD, '..', '..', 'render-hieroglyphs.mjs'), 'utf8');
    expect(script).toContain("'\\u{13250}\\u{132F9}'");
    expect(existsSync(join(WORLD, 'src', 'title_pr_ankh.png'))).toBe(true);
    const title = nodes.find((n) => n.name === 'facade_title')!;
    expect(title).toBeDefined();
    const door = nodes.find((n) => n.name === 'facade_door')!;
    expect(title.box.min[1]).toBeGreaterThan(3); // above the doorway, under the door's cornice
    expect(title.box.max[1]).toBeLessThan(door.box.max[1]);
    expect(title.box.max[1] - title.box.min[1]).toBeGreaterThan(1.0); // a tall lintel
    const mat = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'title')!;
    const decode = await basisTranscoder();
    const { rgba } = decode(mat.getBaseColorTexture()!.getImage()!);
    // the blue fill of the sunk signs: Egyptian blue (~220 deg), 75% of the lintel's height
    const blue = texelsNearHue(rgba, 220, 15) / (rgba.length / 4);
    expect(blue).toBeGreaterThan(0.07);
    expect(blue).toBeLessThan(0.25);
  });

  test('the title glows: its own node, an emissive map of the glyphs in a luminous royal blue', async () => {
    const title = nodes.find((n) => n.name === 'facade_title')!;
    expect(title).toBeDefined();
    const mat = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'title')!;
    const factor = mat.getEmissiveFactor();
    expect(Math.max(...factor)).toBeGreaterThan(0.5); // the emissive is on
    const tex = mat.getEmissiveTexture();
    expect(tex).not.toBeNull();
    // the glyph map stays a lossless PNG: ETC1S would smear a thin bright sign into its black
    const rgba = PNG.sync.read(Buffer.from(tex!.getImage()!)).data;
    const n = rgba.length / 4;
    let lit = 0;
    let blueLit = 0;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]];
      if (Math.max(r, g, b) < 120) continue; // the stone around the glyphs stays dark
      lit++;
      const { hue, sat } = rgbHsv(r / 255, g / 255, b / 255);
      if (hue > 200 && hue < 235 && sat > 0.4) blueLit++;
    }
    // the glyphs only: a few percent of the lintel, all of it royal blue (hue ~215), not the amethyst band
    expect(lit / n).toBeGreaterThan(0.04);
    expect(lit / n).toBeLessThan(0.3);
    expect(blueLit / lit).toBeGreaterThan(0.9);
  });

  test('the title glyphs are solid: O1 a thick-walled house with its doorway, the ankh filled', () => {
    const png = PNG.sync.read(readFileSync(join(WORLD, 'src', 'title_pr_ankh.png')));
    const { width: W, height: H, data } = png;
    const ink = (x: number, y: number) => data[(y * W + x) * 4 + 3] > 128;
    let total = 0;
    const cols: boolean[] = new Array(W).fill(false);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (ink(x, y)) {
          total++;
          cols[x] = true;
        }
    // a filled pair of signs covers about a quarter of its sheet; hairline outlines about a tenth
    expect(total / (W * H)).toBeGreaterThan(0.2);
    expect(total / (W * H)).toBeLessThan(0.32);
    // O1 is the left sign: the first run of inked columns (the gap to the ankh is ~12% of the height)
    const x0 = cols.indexOf(true);
    let x1 = x0;
    while (x1 < W && (cols[x1] || cols.slice(x1, x1 + 40).some(Boolean))) x1++;
    let y0 = H;
    let y1 = 0;
    for (let y = 0; y < H; y++)
      for (let x = x0; x < x1; x++)
        if (ink(x, y)) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
    const w = x1 - x0;
    const h = y1 - y0;
    let house = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x < x1; x++) if (ink(x, y)) house++;
    // the house plan's walls are solid: (outer C minus the room) is 35% of its box, never the ~12%
    // of a hollow outline
    expect(house / (w * h)).toBeGreaterThan(0.3);
    expect(house / (w * h)).toBeLessThan(0.42);
    expect(ink(x0 + Math.round(w * 0.04), y0 + Math.round(h * 0.5))).toBe(true); // west wall
    expect(ink(x0 + Math.round(w * 0.5), y0 + Math.round(h * 0.04))).toBe(true); // north wall
    expect(ink(x0 + Math.round(w * 0.5), y0 + Math.round(h * 0.5))).toBe(false); // the room, empty
    expect(ink(x0 + Math.round(w * 0.5), y1 - Math.round(h * 0.04))).toBe(false); // the doorway
  });

  test('the obelisks: limestone, gold-tipped, about 6 m, 1:10, on the planters tiles (3,9), (16,9)', async () => {
    for (const [col, row] of [
      [3, 9],
      [16, 9],
    ]) {
      const o = nodes.find((n) => n.name === `obelisk_${col}_${row}`)!;
      expect(o.box.max[1]).toBeGreaterThan(5.9);
      expect(o.box.max[1]).toBeLessThan(6.4);
      expect((o.box.min[0] + o.box.max[0]) / 2).toBeCloseTo((col + 0.5) * T, 1);
      expect((o.box.min[2] + o.box.max[2]) / 2).toBeCloseTo((row + 0.5) * T, 1);
      // the shaft above the pedestal (0.3 m): base about a tenth of its height, a gentle taper
      const cx = (o.box.min[0] + o.box.max[0]) / 2;
      const verts = o.tris.flatMap((t) => [0, 1, 2].map((k) => [t[k * 3], t[k * 3 + 1]]));
      const width = (y: number, reach: number) => {
        const xs = verts
          .filter(([x, v]) => Math.abs(v - y) < 0.004 && Math.abs(x - cx) < reach)
          .map(([x]) => x);
        return Math.max(...xs) - Math.min(...xs);
      };
      const shaft = 5.3;
      const base = width(0.3, 0.35); // the shaft's foot, above the 0.3 m pedestal
      const top = width(0.3 + shaft, 0.3);
      expect(base).toBeGreaterThan(0.5);
      expect(base).toBeLessThan(0.58);
      expect(shaft / base).toBeGreaterThan(9);
      expect(shaft / base).toBeLessThan(11); // base : height about 1 : 10
      expect(top / base).toBeGreaterThan(0.6); // a gentle taper
      expect(top / base).toBeLessThan(0.8);
    }
    const mat = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'obelisk')!;
    const decode = await basisTranscoder();
    const { rgba } = decode(mat.getBaseColorTexture()!.getImage()!);
    // fine limestone: a pale warm hue, low saturation, high value, a faint mottle and no speckle;
    // the sunk signs are a dark ochre
    let pale = 0;
    let dark = 0;
    let speckle = 0;
    let sumV = 0;
    const n = rgba.length / 4;
    for (let i = 0; i < n; i++) {
      const { hue, sat, val } = rgbHsv(
        rgba[i * 4] / 255,
        rgba[i * 4 + 1] / 255,
        rgba[i * 4 + 2] / 255,
      );
      sumV += val;
      if (hue > 20 && hue < 55 && sat < 0.35 && val > 0.6) pale++;
      if (val < 0.62) dark++;
      if (val < 0.2) speckle++;
    }
    expect(pale / n).toBeGreaterThan(0.75);
    expect(sumV / n).toBeGreaterThan(0.7);
    expect(dark / n).toBeGreaterThan(0.004); // the carved signs read
    expect(dark / n).toBeLessThan(0.15);
    expect(speckle / n).toBeLessThan(0.001); // no black mineral speckle
    // warmer and duller than the pyramid's satin white Tura
    expect(mat.getRoughnessFactor()).toBeGreaterThan(0.5);
    const tura = pyramid
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'limestone')!;
    expect(mat.getRoughnessFactor()).toBeGreaterThan(tura.getRoughnessFactor() + 0.1);
  });

  test("no star bands on the walls: the enclosure walls' band under the kheker is plain ashlar", async () => {
    const mat = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'wall')!;
    const decode = await basisTranscoder();
    const { w, h, rgba } = decode(mat.getBaseColorTexture()!.getImage()!);
    // the elevation is 6.2 m high: the old star band sat between 5.06 and 5.5 m
    const r0 = Math.round(((6.2 - 5.45) / 6.2) * h);
    const r1 = Math.round(((6.2 - 5.12) / 6.2) * h);
    const band = rgba.slice(r0 * w * 4, r1 * w * 4);
    expect(texelsNearHue(band, 220, 25) / (band.length / 4)).toBeLessThan(0.002);
  });

  test("the Architects' chamber is dressed: the papyrus section on its back wall, its tools", () => {
    const seat = layout.seats.find((s) => s.uid === 'alcove-n-4-seat')!;
    expect(seat).toBeDefined();
    const paper = nodes.find((n) => n.name === 'architects_papyrus')!;
    expect(paper.box.min[2]).toBeLessThan(T + 0.05); // on the north wall
    expect(paper.box.min[0]).toBeGreaterThan(4.5);
    expect(paper.box.max[0]).toBeLessThan(7.5);
    expect(nodes.find((n) => n.name === 'architects_props')).toBeDefined();
  });

  test('every lamp practical has its oil lamp node; two more light the door', () => {
    const names = new Set(nodes.map((n) => n.name));
    for (const p of ctx().meta.practicals) expect(names.has(p.id), p.id).toBe(true);
    expect(ctx().meta.practicals.filter((p) => p.seatUid === undefined)).toHaveLength(2);
  });

  test('no node is named like a House of Wisdom node', async () => {
    const how = new Set<string>();
    for (const file of ['hall.glb', 'armillary.glb'])
      for (const n of (await readGlb(join(HOW_OUT, file))).getRoot().listNodes())
        how.add(n.getName());
    expect(how.size).toBeGreaterThan(20);
    const ours = [...doc.getRoot().listNodes(), ...pyramid.getRoot().listNodes()].map((n) =>
      n.getName(),
    );
    expect(ours.filter((n) => how.has(n))).toEqual([]);
  }, 60_000);

  test('colour law: no saturated texel or factor within 40 deg of amethyst, in any texture', async () => {
    const decode = await basisTranscoder();
    expect(texelsNearHue(new Uint8Array([0xa2, 0x1c, 0xaf, 255]), AMETHYST_HUE, HUE_GUARD)).toBe(1);
    const checked: string[] = [];
    for (const d of [doc, pyramid]) {
      for (const mat of d.getRoot().listMaterials()) {
        for (const f of [mat.getBaseColorFactor(), [...mat.getEmissiveFactor(), 1]]) {
          const { hue, sat, val } = hueSat(f);
          if (sat < 0.25 || val < 0.15) continue;
          expect(hueDistance(hue, AMETHYST_HUE), mat.getName()).toBeGreaterThanOrEqual(HUE_GUARD);
        }
        const tex = mat.getBaseColorTexture();
        if (!tex) continue;
        const { rgba } = decode(tex.getImage()!);
        expect(texelsNearHue(rgba, AMETHYST_HUE, HUE_GUARD), mat.getName()).toBe(0);
        checked.push(mat.getName());
      }
    }
    for (const m of ['screen', 'column', 'title', 'wall', 'papyrus', 'granite', 'props'])
      expect(checked).toContain(m);
    // The two lightmaps too: lamp light meeting the dusk sky must not tint the walls violet. The
    // bake greys every such texel before encoding; what ETC1S then makes of a few dark gutter
    // blocks where two islands meet (one texel in 3,000 or fewer, all dark) is tolerated, and
    // nothing bright may sit in the band.
    for (const file of ['lightmap_golden.ktx2', 'lightmap_dusk.ktx2']) {
      const { rgba } = decode(new Uint8Array(readFileSync(join(OUT, file))));
      const bright = rgba.map((c, i) =>
        i % 4 === 3 ||
        Math.max(rgba[i - (i % 4)], rgba[i - (i % 4) + 1], rgba[i - (i % 4) + 2]) >= 102
          ? c
          : 0,
      );
      expect(texelsNearHue(rgba, AMETHYST_HUE, HUE_GUARD) / (rgba.length / 4), file).toBeLessThan(
        3e-4,
      );
      expect(texelsNearHue(bright, AMETHYST_HUE, HUE_GUARD), `${file} (v >= 0.4)`).toBe(0);
    }
  });

  test('round F: the title is a decal lifted 6 mm proud of the lintel (it z-fought at 2 mm)', () => {
    const title = nodes.find((n) => n.name === 'facade_title')!;
    const door = nodes.find((n) => n.name === 'facade_door')!;
    // the door's lintel face is the nearest plane behind the title: the door's front-most
    // vertical faces sit at z = 4.65 + 0.32 (the lintel's half-depth)
    const lintelFront = 4.65 + 0.32;
    const z = title.box.min[2];
    expect(title.box.max[2] - title.box.min[2]).toBeLessThan(1e-6); // a flat quad
    expect(z - lintelFront).toBeGreaterThanOrEqual(0.005);
    expect(z - lintelFront).toBeLessThan(0.02);
    expect(door.box.max[2]).toBeGreaterThan(z); // the cornice above still stands proud of it
  });

  test('round F: the casing is a satin, the gold a warm gleam: neither can blow out', async () => {
    const mats = new Map(
      pyramid
        .getRoot()
        .listMaterials()
        .map((m) => [m.getName(), m] as const),
    );
    const env = (n: string) => (mats.get(n)!.getExtras() as Record<string, number>).envScale;
    for (const n of ['limestone', 'frieze']) {
      expect(mats.get(n)!.getRoughnessFactor(), n).toBeGreaterThanOrEqual(0.45);
      expect(env(n), n).toBeLessThanOrEqual(1.2);
    }
    expect(mats.get('gold')!.getRoughnessFactor()).toBeGreaterThanOrEqual(0.25);
    expect(env('gold')).toBeLessThanOrEqual(4.5);
    expect(env('gold')).toBeGreaterThan(1.5); // still reads as gold
  });

  describe('the occlusion gate at the default camera', () => {
    const cam = getWorld('house-of-life').camera!.position.map((v) => v * T) as V3;
    test('the pyramid and the pool hide no part of any seated head and shoulders', () => {
      const centre = pyramidNodes;
      const report: Record<string, number> = {};
      for (const seat of layout.seats) report[seat.uid] = visibleFraction(cam, seat, centre);
      console.log('visible fraction, pyramid and pool only:', JSON.stringify(report));
      for (const [uid, f] of Object.entries(report)) expect(f, uid).toBe(1);
    });
    test('the ray test sees occluders: from outside the north wall, it hides the seats', () => {
      const behind: V3 = [15, 2.5, -6];
      const all = [...pyramidNodes, ...nodes];
      const seat = layout.seats.find((s) => s.uid === 'court-3-seat-a')!;
      expect(visibleFraction(behind, seat, all)).toBe(0);
      // and the pyramid alone hides a seat right behind it from a low eye
      const low: V3 = [15, 1.0, 30];
      const centre = pyramidNodes;
      expect(visibleFraction(low, { col: 9, row: 3 }, centre)).toBeLessThan(0.5);
    });
    test('with the whole temple in the way, every seat still shows most of its head and shoulders', () => {
      const all = [...pyramidNodes, ...nodes];
      const report: Record<string, number> = {};
      for (const seat of layout.seats) report[seat.uid] = visibleFraction(cam, seat, all);
      console.log('visible fraction, the whole temple:', JSON.stringify(report));
      for (const [uid, f] of Object.entries(report)) expect(f, uid).toBeGreaterThanOrEqual(0.6);
    });
  });
});
