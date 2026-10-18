// Acceptance tests for the courtyard armillary sphere (assets/blender/armillary.py), read from the
// committed, optimised outputs in assets/worlds/house-of-wisdom/out/ (`npm run assets` rebuilds).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Document, type Node as GltfNode, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { beforeAll, describe, expect, test } from 'vitest';

import type { LayoutManifest } from '../scripts/export-layout.js';
import { houseOfWisdomGreybox as world } from '../src/worlds/houseOfWisdom/greybox.js';
import { parseWorldAssetMeta } from '../src/worlds/assetMeta.js';
import { basisTranscoder } from './basisTranscoder.js';

const WORLD = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'worlds',
  'house-of-wisdom',
);
const OUT = join(WORLD, 'out');
const layout = JSON.parse(readFileSync(join(WORLD, 'layout.json'), 'utf8')) as LayoutManifest;
const T = layout.tileMeters;
const DEG = Math.PI / 180;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const angleDeg = (a: V3, b: V3) => Math.acos(Math.min(1, Math.abs(dot(norm(a), norm(b))))) / DEG;

/** World-space direction of a node's local +Y, and its world origin. */
function frame(node: GltfNode): { y: V3; origin: V3 } {
  const m = node.getWorldMatrix();
  return { y: norm([m[4], m[5], m[6]]), origin: [m[12], m[13], m[14]] };
}

/** Every vertex (world space) of a node's own mesh and its unnamed mesh children. */
function points(node: GltfNode): V3[] {
  const out: V3[] = [];
  const visit = (n: GltfNode, own: boolean) => {
    const mesh = n.getMesh();
    if (mesh) {
      const m = n.getWorldMatrix();
      const p = [0, 0, 0];
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')!;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, p);
          out.push(
            [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]) as V3,
          );
        }
      }
    }
    // the optimiser parks a non-leaf node's mesh on an unnamed child; named children are parts
    for (const c of n.listChildren()) if (own && c.getName() === '') visit(c, false);
  };
  visit(node, true);
  return out;
}

function trisOf(doc: Document): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives())
      n += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')!.getCount()) / 3;
  return n;
}

// Cobalt glaze #2f5bea (~226 deg) means "needs you"; the bake's own guard (patterns.py
// cobalt_clash) counts chromatic texels (s >= 0.25, v >= 0.15) within 25 deg of it.
const COBALT_HUE = 226;
const HUE_GUARD = 25;
function cobaltTexels(rgba: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (max < 0.15 || d / max < 0.25) continue;
    let h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    const dist = Math.min(Math.abs(h - COBALT_HUE), 360 - Math.abs(h - COBALT_HUE));
    if (dist < HUE_GUARD) n++;
  }
  return n;
}

describe('the courtyard armillary sphere', () => {
  let doc: Document;
  let hall: Document;
  const node = (name: string) =>
    doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === name)!;
  const footprint = layout.furniture.find((f) => f.type === 'hw_armillary')!;
  const centre = {
    x: (footprint.col + footprint.footprintW / 2) * T,
    z: (footprint.row + footprint.footprintH / 2) * T,
  };

  beforeAll(async () => {
    const meta = parseWorldAssetMeta(JSON.parse(readFileSync(join(OUT, 'hall.meta.json'), 'utf8')));
    expect(meta.armillary?.glb).toBe('armillary.glb');
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    doc = await io.read(join(OUT, meta.armillary!.glb));
    hall = await io.read(join(OUT, meta.glb));
  }, 60_000);

  test('every part is a named node; the moving ones are pivots at the sphere centre', () => {
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName());
    for (const n of [
      'armillary',
      'pedestal',
      'meridian',
      'horizon',
      'polar_axis',
      'earth',
      'cage',
      'cage_rings',
      'ecliptic',
      'sun',
      'sun_bead',
      'moon_orbit',
      'moon',
      'moon_bead',
    ])
      expect(names, n).toContain(n);
    const c = frame(node('polar_axis')).origin;
    for (const pivot of ['cage', 'sun', 'moon']) {
      expect(node(pivot).getMesh(), pivot).toBeNull();
      const o = frame(node(pivot)).origin;
      expect(Math.hypot(...sub(o, c)), pivot).toBeLessThan(1e-4);
    }
    expect(node('sun').getParentNode()?.getName()).toBe('ecliptic');
    expect(node('moon').getParentNode()?.getName()).toBe('moon_orbit');
    expect(node('earth').getParentNode()?.getName()).toBe('polar_axis'); // the Earth stays still
  });

  test('it stands where the fountain stood, centred on its plinth in the hall', () => {
    const root = frame(node('armillary')).origin;
    expect(root[0]).toBeCloseTo(centre.x, 3);
    expect(root[2]).toBeCloseTo(centre.z, 3);
    const plinth = hall
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'armillary_plinth')!;
    expect(plinth, 'armillary_plinth').toBeDefined();
    const top = Math.max(...points(plinth).map((p) => p[1]));
    expect(root[1]).toBeCloseTo(top, 3);
    // the pedestal stands on the plinth top
    expect(Math.min(...points(node('pedestal')).map((p) => p[1]))).toBeCloseTo(top, 2);
  });

  test("the polar axis rises 33.3 deg (Baghdad's latitude) above the north horizon", () => {
    const { y } = frame(node('polar_axis'));
    expect(Math.asin(y[1]) / DEG).toBeCloseTo(33.3, 2);
    expect(y[2]).toBeLessThan(0); // north is -z
    expect(Math.abs(y[0])).toBeLessThan(1e-6);
    // the cage turns about it: at rest its own axis is the polar axis
    expect(angleDeg(frame(node('cage')).y, y)).toBeLessThan(1e-3);
  });

  test('the ecliptic leans 23.4 deg off the equator, the moon 5.15 deg off the ecliptic', () => {
    const equator = frame(node('cage')).y;
    const ecliptic = frame(node('ecliptic')).y;
    expect(angleDeg(equator, ecliptic)).toBeCloseTo(23.44, 1);
    expect(angleDeg(ecliptic, frame(node('moon_orbit')).y)).toBeCloseTo(5.15, 1);
    // the sun runs in the ecliptic plane, the moon in its own ring's plane
    const c = frame(node('polar_axis')).origin;
    const off = (bead: string, axis: V3) => {
      const ps = points(node(bead));
      const mid = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length) as V3;
      return { plane: Math.abs(dot(sub(mid, c), axis)), r: Math.hypot(...sub(mid, c)) };
    };
    const sun = off('sun_bead', ecliptic);
    expect(sun.plane).toBeLessThan(0.01);
    expect(sun.r).toBeGreaterThan(0.9);
    const moon = off('moon_bead', frame(node('moon_orbit')).y);
    expect(moon.plane).toBeLessThan(0.01);
    expect(moon.r).toBeLessThan(sun.r);
  });

  test('no turn can make a part collide: moving parts keep to shells inside the fixed rings', () => {
    // Every moving node turns about an axis through the sphere centre, so each vertex keeps its
    // distance from the centre: radial shells that do not overlap can never meet.
    const c = frame(node('polar_axis')).origin;
    const radii = (...names: string[]) =>
      names.flatMap((n) => points(node(n))).map((p) => Math.hypot(...sub(p, c)));
    const fixedInner = Math.min(...radii('meridian', 'horizon'));
    const cage = radii('cage_rings', 'ecliptic');
    const sun = radii('sun_bead');
    expect(Math.max(...cage, ...sun, ...radii('moon_orbit', 'moon_bead'))).toBeLessThan(fixedInner);
    expect(fixedInner - Math.max(...cage)).toBeGreaterThan(0.01); // the cage runs 2 cm clear
    // the sun rides inside the cage (its ring's struts reach the axis, not the rings)
    const belt = radii('cage_rings').concat(
      points(node('ecliptic'))
        .map((p) => Math.hypot(...sub(p, c)))
        .filter((r) => r > 1.2),
    );
    expect(Math.max(...sun)).toBeLessThan(Math.min(...belt));
  });

  test('the Earth sits at the centre of the sphere', () => {
    const ps = points(node('earth'));
    const mid = [0, 1, 2].map((k) => ps.reduce((s, p) => s + p[k], 0) / ps.length) as V3;
    expect(Math.hypot(...sub(mid, frame(node('polar_axis')).origin))).toBeLessThan(0.01);
  });

  test('budget: at most 60k triangles and two texture sets of at most 1.5K', () => {
    expect(trisOf(doc)).toBeLessThanOrEqual(60_000);
    const mats = doc
      .getRoot()
      .listMaterials()
      .map((m) => m.getName())
      .sort();
    expect(mats).toEqual(['armillary_brass', 'armillary_globe']);
    for (const t of doc.getRoot().listTextures()) {
      expect(t.getMimeType(), t.getName()).toBe('image/ktx2');
      for (const side of t.getSize()!) expect(side, t.getName()).toBeLessThanOrEqual(1536);
    }
  });

  test('colour law: no base-colour texel sits within 25 deg of the cobalt "needs you" hue', async () => {
    // the detector itself: the cobalt glaze is caught, brass is not
    expect(cobaltTexels(new Uint8Array([0x2f, 0x5b, 0xea, 255, 204, 160, 88, 255]))).toBe(1);
    const decode = await basisTranscoder();
    const bases = doc
      .getRoot()
      .listMaterials()
      .map((m) => m.getBaseColorTexture()!);
    expect(bases).toHaveLength(2);
    for (const tex of bases) {
      const { w, h, rgba } = decode(tex.getImage()!);
      expect(w * h, tex.getName()).toBeGreaterThan(1000);
      let sum = 0;
      for (let i = 0; i < rgba.length; i += 4) sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
      expect(sum / (w * h * 3), `${tex.getName()} decoded, not blank`).toBeGreaterThan(15);
      expect(cobaltTexels(rgba), tex.getName()).toBe(0);
    }
  }, 60_000);

  test('nothing of it stands at a walkable tile centre (0.1 to 1.8 m)', () => {
    const all = doc
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh())
      .flatMap((n) => points(n));
    const blocked = new Set<string>();
    for (const f of layout.furniture)
      for (let r = 0; r < f.footprintH; r++)
        for (let c = 0; c < f.footprintW; c++) blocked.add(`${f.col + c},${f.row + r}`);
    for (let row = 1; row < layout.rows - 1; row++) {
      for (let col = 1; col < layout.cols - 1; col++) {
        if (blocked.has(`${col},${row}`)) continue;
        const [cx, cz] = [(col + 0.5) * T, (row + 0.5) * T];
        const hit = all.some(
          (p) => Math.abs(p[0] - cx) < 0.1 && Math.abs(p[2] - cz) < 0.1 && p[1] > 0.1 && p[1] < 1.8,
        );
        expect(hit, `tile ${col},${row}`).toBe(false);
      }
    }
  });

  test('a scholar at each of its points of interest has room to stand and look up', () => {
    const all = doc
      .getRoot()
      .listNodes()
      .filter((n) => n.getMesh())
      .flatMap((n) => points(n));
    const spots = world.pointsOfInterest.filter((p) => p.kind === 'armillary');
    expect(spots).toHaveLength(4);
    for (const s of spots) {
      const [cx, cz] = [(s.col + 0.5) * T, (s.row + 0.5) * T];
      // a standing figure: 0.3 m about the tile centre, up to just over head height
      const near = all.filter(
        (p) => Math.hypot(p[0] - cx, p[2] - cz) < 0.3 && p[1] > 0 && p[1] < 1.9,
      );
      expect(near.length, s.id).toBe(0);
    }
  });
});
