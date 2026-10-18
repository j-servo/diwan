// Acceptance tests for the baked House of Wisdom hall (M1 Task 2). They read the committed,
// optimised outputs in assets/worlds/house-of-wisdom/out/ (run `npm run assets` to rebuild).
// The checks every world's hall must pass live in hallHarness.ts; this file configures them with
// the House of Wisdom's node names and holds the checks that name its own parts.
import { type Document, type Node as GltfNode } from '@gltf-transform/core';
import { beforeAll, describe, expect, test } from 'vitest';

import type { WorldAssetMeta } from '../src/worlds/assetMeta.js';
import { basisTranscoder, texelsNearHue } from './basisTranscoder.js';
import {
  type Box,
  exempt,
  frontFace,
  genericHallTests,
  hits,
  hueDistance,
  hueSat,
  layout,
  type MeshNode,
  selectWorld,
  T,
  tileRect,
  VOID,
  WALL,
  wallPlanes,
} from './hallHarness.js';

selectWorld('house-of-wisdom');

// Cobalt glaze #2f5bea (~226 deg) means "needs you": nothing new may sit within 25 deg of it.
const COBALT_HUE = 226;
const HUE_GUARD = 25;
// Materials added by Task 2b (dressing and walls); judged by their base colour factors.
const DRESSING_MATERIALS = ['logo_panel_mat', 'planter_mat', 'dado', 'frieze', 'samarra'];

describe('House of Wisdom hall asset', () => {
  const ctx = genericHallTests({
    worldId: 'house-of-wisdom',
    deskPrefix: 'desk_',
    seatExempt: ['floor', 'cushion'],
    walkExempt: ['floor'],
    maxTotalMB: 12,
    maxTriangles: 150_000,
    minWalkProbes: 150,
  });
  let meta: WorldAssetMeta;
  let doc: Document;
  let nodes: MeshNode[];
  beforeAll(() => {
    ({ meta, doc, nodes } = ctx());
  });

  // The in-world board is switchable (world.board, null for the House of Wisdom for now): with no
  // board in the layout, nothing of it is baked; with one, its Task 6 contract holds.
  test('no board in the layout: no notice_board node, frame or board lamps are baked', () => {
    if (layout.board) return;
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName());
    expect(names.filter((n) => /notice_|lamp_board/.test(n))).toEqual([]);
    expect(meta.practicals.filter((p) => p.id.startsWith('lamp_board'))).toEqual([]);
    expect(
      doc
        .getRoot()
        .listMaterials()
        .map((m) => m.getName()),
    ).not.toContain('notice_board_mat');
  });

  test.skipIf(!layout.board)(
    'the notice_board panel hangs at the layout board position (Task 6 contract)',
    () => {
      const board = nodes.find((n) => n.name === 'notice_board');
      expect(board).toBeDefined();
      const [bx, by, bz] = layout.board!.position.map((v) => v * T);
      const c = [0, 1, 2].map((i) => (board!.box.min[i] + board!.box.max[i]) / 2);
      expect(Math.abs(c[0] - bx)).toBeLessThan(0.15);
      expect(Math.abs(c[1] - by)).toBeLessThan(0.15);
      expect(Math.abs(c[2] - bz)).toBeLessThan(0.15);
      const node = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === 'notice_board')!;
      const prims = node.getMesh()!.listPrimitives();
      expect(prims).toHaveLength(1);
      expect(prims[0].getAttribute('TEXCOORD_0')).not.toBeNull();
    },
  );

  test.skipIf(!layout.board)(
    'notice_board owns its material, so Task 6 can swap the map without side effects',
    () => {
      const all = doc.getRoot().listNodes();
      const board = all.find((n) => n.getName() === 'notice_board')!;
      const mat = board.getMesh()!.listPrimitives()[0].getMaterial();
      expect(mat).not.toBeNull();
      for (const node of all) {
        const mesh = node.getMesh();
        if (node === board || !mesh) continue;
        for (const prim of mesh.listPrimitives())
          expect(prim.getMaterial(), node.getName()).not.toBe(mat);
      }
    },
  );

  test.skipIf(!layout.board)(
    'notice_board UV0 spans its face 0..1, upright and unmirrored from inside the hall',
    () => {
      const board = doc
        .getRoot()
        .listNodes()
        .find((n) => n.getName() === 'notice_board')!;
      const prim = board.getMesh()!.listPrimitives()[0];
      const pos = prim.getAttribute('POSITION')!;
      const uv = prim.getAttribute('TEXCOORD_0')!;
      const m = board.getWorldMatrix();
      const p = [0, 0, 0];
      const t = [0, 0];
      const front: { x: number; y: number; u: number; v: number }[] = [];
      let zMax = -Infinity;
      const verts: { x: number; y: number; z: number; u: number; v: number }[] = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        uv.getElement(i, t);
        const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
        const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
        const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
        verts.push({ x, y, z, u: t[0], v: t[1] });
        zMax = Math.max(zMax, z);
      }
      // the face looks south (+z), into the hall
      for (const v of verts) if (v.z > zMax - 1e-3) front.push(v);
      expect(front.length).toBeGreaterThanOrEqual(4);
      const westmost = front.reduce((a, b) => (b.x < a.x ? b : a));
      const eastmost = front.reduce((a, b) => (b.x > a.x ? b : a));
      const top = front.reduce((a, b) => (b.y > a.y ? b : a));
      const bottom = front.reduce((a, b) => (b.y < a.y ? b : a));
      // viewer faces north: west is on the left, so u grows eastwards; glTF v = 0 is the top
      expect(westmost.u).toBeCloseTo(0, 2);
      expect(eastmost.u).toBeCloseTo(1, 2);
      expect(top.v).toBeCloseTo(0, 2);
      expect(bottom.v).toBeCloseTo(1, 2);
    },
  );

  test('logo_panel hangs on an inner wall face, owns its material, inside the hall', () => {
    const panel = nodes.find((n) => n.name === 'logo_panel');
    expect(panel, 'logo_panel').toBeDefined();
    const b = panel!.box;
    expect(b.min[0]).toBeGreaterThanOrEqual(T - 1e-3);
    expect(b.max[0]).toBeLessThanOrEqual((layout.cols - 1) * T + 1e-3);
    expect(b.min[2]).toBeGreaterThanOrEqual(T - 1e-3);
    expect(b.max[2]).toBeLessThanOrEqual((layout.rows - 1) * T + 1e-3);
    // flat against one inner wall plane, above head height of anyone walking past
    const plane = wallPlanes().find(
      (w) => Math.abs((w.inward > 0 ? b.min[w.axis] : b.max[w.axis]) - w.at) < 0.05,
    );
    expect(plane, 'logo_panel touches no inner wall plane').toBeDefined();
    expect(b.max[plane!.axis] - b.min[plane!.axis]).toBeLessThan(0.1);
    expect(b.min[1]).toBeGreaterThan(1.8);
    const all = doc.getRoot().listNodes();
    const node = all.find((n) => n.getName() === 'logo_panel')!;
    const prims = node.getMesh()!.listPrimitives();
    expect(prims).toHaveLength(1);
    const mat = prims[0].getMaterial();
    expect(mat?.getName()).toBe('logo_panel_mat');
    for (const other of all) {
      const mesh = other.getMesh();
      if (other === node || !mesh) continue;
      for (const prim of mesh.listPrimitives())
        expect(prim.getMaterial(), other.getName()).not.toBe(mat);
    }
  });

  test('logo_panel UV0 spans its face 0..1, upright and unmirrored from inside the hall', () => {
    const node = doc
      .getRoot()
      .listNodes()
      .find((n) => n.getName() === 'logo_panel')!;
    const box = nodes.find((n) => n.name === 'logo_panel')!.box;
    const plane = wallPlanes().find(
      (w) => Math.abs((w.inward > 0 ? box.min[w.axis] : box.max[w.axis]) - w.at) < 0.05,
    )!;
    const front = frontFace(node, plane.axis, plane.inward);
    expect(front.length).toBeGreaterThanOrEqual(4);
    // a viewer facing the wall: right = forward x up, forward = -inward along the axis
    const fwd = [0, 0, 0];
    fwd[plane.axis] = -plane.inward;
    const right = [-fwd[2], 0, fwd[0]];
    const along = (v: { w: number[] }) => v.w[0] * right[0] + v.w[2] * right[2];
    const left = front.reduce((a, c) => (along(c) < along(a) ? c : a));
    const rightmost = front.reduce((a, c) => (along(c) > along(a) ? c : a));
    const top = front.reduce((a, c) => (c.w[1] > a.w[1] ? c : a));
    const bottom = front.reduce((a, c) => (c.w[1] < a.w[1] ? c : a));
    expect(left.u).toBeCloseTo(0, 2);
    expect(rightmost.u).toBeCloseTo(1, 2);
    expect(top.v).toBeCloseTo(0, 2); // glTF v = 0 is the image's top row
    expect(bottom.v).toBeCloseTo(1, 2);
  });

  test('no Task 2b material sits within 25 deg of the cobalt "needs you" hue', () => {
    const mats = doc.getRoot().listMaterials();
    for (const name of DRESSING_MATERIALS) {
      const mat = mats.find((m) => m.getName() === name);
      expect(mat, name).toBeDefined();
      const { hue, sat, val } = hueSat(mat!.getBaseColorFactor());
      if (sat < 0.12 || val < 0.1) continue; // achromatic factor (white on textured materials)
      expect(hueDistance(hue, COBALT_HUE), name).toBeGreaterThanOrEqual(HUE_GUARD);
    }
  });

  test('the two back palms remain; planters replace the two front palms on their tiles', () => {
    const palms = layout.furniture.filter((f) => f.type === 'hw_palm');
    const back = palms.filter((f) => f.row < layout.rows / 2);
    const front = palms.filter((f) => f.row >= layout.rows / 2);
    expect(back).toHaveLength(2);
    expect(front).toHaveLength(2);
    const canopies = nodes.filter((n) => n.name.startsWith('palm_'));
    expect(canopies.map((n) => n.name).sort()).toEqual(back.map((f) => `palm_${f.uid}`).sort());
    for (const c of canopies) expect(c.box.max[1], c.name).toBeGreaterThan(3.5);
    const planters = nodes.filter((n) => n.name.startsWith('planter_'));
    expect(planters.map((n) => n.name).sort()).toEqual(
      front.map((f) => `planter_${f.col}_${f.row}`).sort(),
    );
    for (const f of front) {
      const p = planters.find((n) => n.name === `planter_${f.col}_${f.row}`)!;
      const r = tileRect(f.col, f.row);
      // wholly inside its own (blocked) tile, so it cannot reach a walkable one
      expect(p.box.min[0], p.name).toBeGreaterThanOrEqual(r.x0);
      expect(p.box.max[0], p.name).toBeLessThanOrEqual(r.x1);
      expect(p.box.min[2], p.name).toBeGreaterThanOrEqual(r.z0);
      expect(p.box.max[2], p.name).toBeLessThanOrEqual(r.z1);
      expect(p.box.max[1], p.name).toBeGreaterThan(1.2);
    }
  });

  test('the palm material stays palm-only (palm sway), and planters never use it', () => {
    const all = doc.getRoot().listNodes();
    const matsOf = (n: GltfNode) =>
      n
        .getMesh()!
        .listPrimitives()
        .map((p) => p.getMaterial());
    const palmMat = all
      .filter((n) => n.getName().startsWith('palm_'))
      .flatMap(matsOf)
      .find((m) => m?.getName() === 'palm');
    expect(palmMat).toBeDefined();
    for (const node of all) {
      if (!node.getMesh() || node.getName().startsWith('palm_')) continue;
      expect(matsOf(node), node.getName()).not.toContain(palmMat);
    }
    for (const node of all.filter((n) => n.getName().startsWith('planter_')))
      expect(matsOf(node).map((m) => m?.getName())).toContain('planter_mat');
  });

  test('the fountain is gone: no fountain or water node, no water material', () => {
    const names = doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName().toLowerCase());
    expect(names.filter((n) => /fountain|water/.test(n))).toEqual([]);
    const mats = doc
      .getRoot()
      .listMaterials()
      .map((m) => m.getName());
    expect(mats).not.toContain('water');
  });

  test("the armillary's octagonal plinth stands where the fountain stood", () => {
    const f = layout.furniture.find((x) => x.type === 'hw_armillary')!;
    expect(f, 'hw_armillary').toBeDefined();
    expect(layout.furniture.some((x) => x.type === 'hw_fountain')).toBe(false);
    const plinth = nodes.find((n) => n.name === 'armillary_plinth')!;
    expect(plinth, 'armillary_plinth').toBeDefined();
    const b = plinth.box;
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo((f.col + f.footprintW / 2) * T, 2);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo((f.row + f.footprintH / 2) * T, 2);
    // flats face the axes: 3.6 m across, a little wider than its 2x2 tiles, low enough to see over
    expect(b.max[0] - b.min[0]).toBeCloseTo(3.6, 2);
    expect(b.max[2] - b.min[2]).toBeCloseTo(3.6, 2);
    expect(b.min[1]).toBeCloseTo(0, 3);
    expect(b.max[1]).toBeGreaterThan(0.4);
    expect(b.max[1]).toBeLessThan(0.6);
    // the paving runs on under it (the floor is one plane over the whole court)
    const floor = nodes.find((n) => n.name === 'floor_court')!;
    expect(floor.box.min[0]).toBeLessThan(b.min[0]);
    expect(floor.box.max[0]).toBeGreaterThan(b.max[0]);
  });

  test('the south arcade is gone: nothing stands on its line (0.3 to 3 m)', () => {
    // the south range's edge: the arcade stood on the tile line north of the south alcove seats
    const line =
      Math.min(...layout.seats.filter((s) => s.uid.startsWith('alcove-s-')).map((s) => s.row)) * T;
    const probe: Box = {
      min: [T + 0.1, 0.3, line - 0.35],
      max: [(layout.cols - 1) * T - 0.1, 3.0, line + 0.35],
    };
    const blockers = nodes
      .filter((n) => !exempt(n.name, ['floor']))
      .filter((n) => hits(n, probe))
      .map((n) => n.name);
    expect(blockers).toEqual([]);
  });

  test('the inscription sits in the pishtaq panel over the portal, facing the courtyard', () => {
    const k = nodes.find((n) => n.name === 'kufic_letters');
    expect(k).toBeDefined();
    const mid = (layout.cols * T) / 2;
    expect(Math.abs((k!.box.min[0] + k!.box.max[0]) / 2 - mid)).toBeLessThan(0.05);
    expect(k!.box.max[0] - k!.box.min[0]).toBeGreaterThan(2.5);
    expect(k!.box.min[1]).toBeGreaterThan(5.5);
    expect(k!.box.max[2] - k!.box.min[2]).toBeLessThan(0.06); // a relief, not a slab
  });

  // ---- the themed north chambers (Yousef, 2026-10-15) and the still palms ----
  // West to east as he listed them; alcove-n-16 stays the scholar's study.
  const THEMED = [
    ['alcove-n-2-seat', 'chemistry'],
    ['alcove-n-6-seat', 'cartography'],
    ['alcove-n-12-seat', 'biology'],
  ] as const;
  /** A north alcove bay: centred on its two-tile desk, from the back wall to the arcade. */
  const bayOf = (seatUid: string) => {
    const seat = layout.seats.find((s) => s.uid === seatUid)!;
    return { x0: (seat.col - 1) * T, x1: (seat.col + 3) * T, z0: T - 0.13, z1: 3 * T - 0.3 };
  };

  test('three north chambers are themed (chemistry, cartography, biology), n-16 stays the study', () => {
    for (const [seat, theme] of THEMED) {
      const node = nodes.find((n) => n.name === `chamber_${theme}`);
      expect(node, theme).toBeDefined();
      const bay = bayOf(seat);
      const b = node!.box;
      expect(b.min[0], `${theme} west`).toBeGreaterThanOrEqual(bay.x0);
      expect(b.max[0], `${theme} east`).toBeLessThanOrEqual(bay.x1);
      expect(b.min[2], `${theme} north`).toBeGreaterThanOrEqual(bay.z0);
      expect(b.max[2], `${theme} south`).toBeLessThanOrEqual(bay.z1);
      expect(b.max[1], `${theme} height`).toBeLessThan(3.8);
      // the chamber keeps its desk and its lamp
      expect(
        nodes.some((n) => n.name === `desk_${seat}`),
        seat,
      ).toBe(true);
      expect(
        meta.practicals.some((p) => p.seatUid === seat),
        seat,
      ).toBe(true);
    }
    const chambers = nodes.filter((n) => n.name.startsWith('chamber_')).map((n) => n.name);
    expect(chambers.sort()).toEqual(THEMED.map(([, t]) => `chamber_${t}`).sort());
    const study = bayOf('alcove-n-16-seat');
    for (const n of nodes.filter((x) => x.name.startsWith('chamber_')))
      expect(n.box.max[0] < study.x0 || n.box.min[0] > study.x1, n.name).toBe(true);
  });

  test('the chambers keep the walking tiles clear (0.35 m round each walkable centre)', () => {
    const furniture = new Set<string>();
    for (const f of layout.furniture)
      for (let r = 0; r < f.footprintH; r++)
        for (let c = 0; c < f.footprintW; c++) furniture.add(`${f.col + c},${f.row + r}`);
    const chambers = nodes.filter((n) => n.name.startsWith('chamber_'));
    for (let row = 1; row <= 3; row++) {
      for (let col = 0; col < layout.cols; col++) {
        const tile = layout.tiles[row * layout.cols + col];
        if (tile === WALL || tile === VOID || furniture.has(`${col},${row}`)) continue;
        const cx = (col + 0.5) * T;
        const cz = (row + 0.5) * T;
        const probe: Box = { min: [cx - 0.35, 0.1, cz - 0.35], max: [cx + 0.35, 1.8, cz + 0.35] };
        for (const n of chambers) expect(hits(n, probe), `${n.name} at ${col},${row}`).toBe(false);
      }
    }
  });

  test('the lamp niches stay clear: nothing of a chamber stands before its lamp (0.9-1.9 m)', () => {
    for (const [seat, theme] of THEMED) {
      const lamp = meta.practicals.find((p) => p.seatUid === seat)!;
      const [x, , z] = lamp.position;
      const probe: Box = { min: [x - 0.3, 0.9, z - 0.3], max: [x + 0.3, 1.9, z + 1.6] };
      expect(
        hits(
          nodes.find((n) => n.name === `chamber_${theme}`)!,
          probe,
        ),
        theme,
      ).toBe(false);
    }
  });

  test('budget: the chambers add at most 45k triangles; the wall art is one 2K atlas', () => {
    const tris = nodes
      .filter((n) => n.name.startsWith('chamber_'))
      .reduce((sum, n) => sum + n.tris.length, 0);
    expect(tris).toBeGreaterThan(3000);
    expect(tris).toBeLessThanOrEqual(45_000);
    const art = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'chamber_art');
    expect(art).toBeDefined();
    expect(art!.getBaseColorTexture()?.getMimeType()).toBe('image/ktx2');
    // only the chambers hang the art
    for (const node of doc.getRoot().listNodes()) {
      const mats =
        node
          .getMesh()
          ?.listPrimitives()
          .map((p) => p.getMaterial()) ?? [];
      if (mats.includes(art!)) expect(node.getName()).toMatch(/^chamber_/);
    }
  });

  test('colour law: no chamber art texel within 40 deg of cobalt; seas are not blue', async () => {
    const decode = await basisTranscoder();
    const art = doc
      .getRoot()
      .listMaterials()
      .find((m) => m.getName() === 'chamber_art')!;
    const { w, h, rgba } = decode(art.getBaseColorTexture()!.getImage()!);
    expect(Math.max(w, h)).toBeLessThanOrEqual(2048);
    expect(texelsNearHue(new Uint8Array([0x2f, 0x5b, 0xea, 255]), COBALT_HUE, 40)).toBe(1);
    expect(texelsNearHue(rgba, COBALT_HUE, 40)).toBe(0);
    for (const name of ['glass', 'ember']) {
      const mat = doc
        .getRoot()
        .listMaterials()
        .find((m) => m.getName() === name);
      expect(mat, name).toBeDefined();
      for (const f of [mat!.getBaseColorFactor(), [...mat!.getEmissiveFactor(), 1]]) {
        const { hue, sat, val } = hueSat(f);
        if (sat < 0.25 || val < 0.15) continue;
        expect(hueDistance(hue, COBALT_HUE), name).toBeGreaterThanOrEqual(40);
      }
    }
  });

  test('the palm meta names each back palm: trunk on its tile centre, crown above it', () => {
    const palms = meta.palms ?? [];
    const back = layout.furniture.filter((f) => f.type === 'hw_palm' && f.row < layout.rows / 2);
    expect(palms.map((p) => p.node).sort()).toEqual(back.map((f) => `palm_${f.uid}`).sort());
    for (const f of back) {
      const p = palms.find((x) => x.node === `palm_${f.uid}`)!;
      expect(p.base[0]).toBeCloseTo((f.col + 0.5) * T, 2);
      expect(p.base[2]).toBeCloseTo((f.row + 0.5) * T, 2);
      expect(p.crown[1]).toBeGreaterThan(4);
      expect(Math.hypot(p.crown[0] - p.base[0], p.crown[2] - p.base[2])).toBeLessThan(0.3);
      const node = nodes.find((n) => n.name === p.node)!;
      expect(node.box.max[1]).toBeGreaterThan(p.crown[1]);
    }
  });
});
