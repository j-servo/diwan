// Round F (Yousef, 2026-10-19: "agents to walk around the whole pyramid square"): the House of
// Life's pool has an unbroken walking lane all round it, scholars can walk it, and the director's
// circuit goes round it once, pausing to look up at the pyramid.
import { beforeAll, describe, expect, test } from 'vitest';

import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { Direction } from '../../webview-ui/src/office/types.js';
import {
  CIRCUIT_COOLDOWN_SEC,
  CIRCUIT_FIRST_AT_SEC,
  CIRCUIT_LOOK_SEC,
  activityFor,
  createDirector,
  stepDirector,
} from '../src/agents/idleDirector.js';
import type { AgentView, Command } from '../src/agents/idleDirector.js';
import { installWorldCatalog } from '../src/worlds/catalog.js';
import { houseOfLifeGreybox as world } from '../src/worlds/houseOfLife/greybox.js';

beforeAll(() => installWorldCatalog(world));

/** The pool's blocked footprint (the layout's `pool` furniture, 6 x 6). */
const POOL = { c0: 7, c1: 12, r0: 5, r1: 10 };
const key = (c: number, r: number) => `${c},${r}`;

/** The lane: every tile touching the pool footprint, corners included (Chebyshev distance 1). */
function lane(): [number, number][] {
  const out: [number, number][] = [];
  for (let r = POOL.r0 - 1; r <= POOL.r1 + 1; r++)
    for (let c = POOL.c0 - 1; c <= POOL.c1 + 1; c++) {
      const inside = c >= POOL.c0 && c <= POOL.c1 && r >= POOL.r0 && r <= POOL.r1;
      if (!inside) out.push([c, r]);
    }
  return out;
}

describe('the lane round the pool of Nun', () => {
  const os = () => new OfficeState(world.floorPlan);
  const walkable = () => new Set(os().walkableTiles.map((t) => key(t.col, t.row)));

  test('the pool is blocked on exactly its 36 tiles, and nothing of the court sits on its lane', () => {
    const w = walkable();
    for (let r = POOL.r0; r <= POOL.r1; r++)
      for (let c = POOL.c0; c <= POOL.c1; c++) expect(w.has(key(c, r)), key(c, r)).toBe(false);
    const ring = lane();
    expect(ring).toHaveLength(28); // 8 x 8 - 6 x 6
    for (const [c, r] of ring) expect(w.has(key(c, r)), `lane tile ${key(c, r)}`).toBe(true);
  });

  test('from any lane tile every other is reachable along the lane (a ring, not a spur)', () => {
    const ring = lane();
    const inRing = new Set(ring.map(([c, r]) => key(c, r)));
    for (const [sc, sr] of ring) {
      const seen = new Set([key(sc, sr)]);
      const queue: [number, number][] = [[sc, sr]];
      while (queue.length) {
        const [c, r] = queue.shift()!;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = key(c + dc, r + dr);
          if (inRing.has(k) && !seen.has(k)) {
            seen.add(k);
            queue.push([c + dc, r + dr]);
          }
        }
      }
      expect(seen.size, `from ${key(sc, sr)}`).toBe(ring.length);
    }
  });

  test('two tiles wide on the east and west sides where the court allows (cols 5-6 and 13-14, rows 5-9)', () => {
    const w = walkable();
    for (let r = POOL.r0; r <= POOL.r1 - 1; r++)
      for (const c of [5, 6, 13, 14]) expect(w.has(key(c, r)), key(c, r)).toBe(true);
  });

  test('the seats are all still there and none stands on the lane', () => {
    const seats = world.floorPlan.furniture.filter((f) => f.type === 'hl_seat');
    expect(seats).toHaveLength(12);
    const ring = new Set(lane().map(([c, r]) => key(c, r)));
    for (const s of seats) expect(ring.has(key(s.col, s.row)), s.uid).toBe(false);
  });
});

describe("the director's circuit of the pyramid", () => {
  const poi = world.pointsOfInterest.find((p) => p.kind === 'circuit')!;

  test('is one point of interest with corner stops on the lane, reached in a straight run each', () => {
    expect(poi).toBeDefined();
    const route = poi.route!;
    const ring = new Set(lane().map(([c, r]) => key(c, r)));
    for (const s of route) expect(ring.has(key(s.col, s.row)), key(s.col, s.row)).toBe(true);
    for (let i = 0; i < route.length; i++) {
      const a = route[i]!;
      const b = route[(i + 1) % route.length]!;
      expect(a.col === b.col || a.row === b.row, `${i}: a straight run`).toBe(true);
    }
    // all four corners of the lane
    const corners = [
      [POOL.c0 - 1, POOL.r0 - 1],
      [POOL.c1 + 1, POOL.r0 - 1],
      [POOL.c1 + 1, POOL.r1 + 1],
      [POOL.c0 - 1, POOL.r1 + 1],
    ];
    for (const [c, r] of corners)
      expect(
        route.some((s) => s.col === c && s.row === r),
        key(c!, r!),
      ).toBe(true);
    // once or twice a pause to look up
    const looks = route.filter((s) => s.look).length;
    expect(looks).toBeGreaterThanOrEqual(1);
    expect(looks).toBeLessThanOrEqual(2);
  });

  /** Simulate scholars: a walk command makes the view walk for 1 s, then stand on the target. */
  function simulate(
    ids: number[],
    secs: number,
    start: { col: number; row: number },
    pois = world.pointsOfInterest,
  ) {
    const d = createDirector();
    const pos = new Map(ids.map((id) => [id, { ...start }]));
    const walking = new Map<number, { col: number; row: number; left: number }>();
    const log: { t: number; id: number; col: number; row: number }[] = [];
    const looks: { id: number; from: number; to: number; facing: number }[] = [];
    let openLook: { id: number; from: number; facing: number } | null = null;
    let maxCircling = 0;
    const circuitStarts: number[] = [];
    let wasCircling = new Set<number>();
    for (let t = 0; t < secs; t += 0.5) {
      const views: AgentView[] = ids.map((id) => {
        const w = walking.get(id);
        if (w) {
          w.left -= 0.5;
          if (w.left <= 0) {
            pos.set(id, { col: w.col, row: w.row });
            walking.delete(id);
          }
        }
        const p = pos.get(id)!;
        return { id, eligible: true, walking: walking.has(id), col: p.col, row: p.row };
      });
      const cmds: Command[] = stepDirector(d, pois, views, 0.5);
      for (const c of cmds) {
        if (c.type === 'walk') {
          walking.set(c.id, { col: c.col!, row: c.row!, left: 1 });
          log.push({ t, id: c.id, col: c.col!, row: c.row! });
        } else walking.delete(c.id);
      }
      const nowCircling = new Set(
        [...d.plans.entries()].filter(([, p]) => p.phase === 'circling').map(([id]) => id),
      );
      maxCircling = Math.max(maxCircling, nowCircling.size);
      for (const id of nowCircling) if (!wasCircling.has(id)) circuitStarts.push(t);
      wasCircling = nowCircling;
      for (const id of ids) {
        const a = activityFor(d, id);
        const plan = d.plans.get(id);
        if (plan?.phase === 'circling' && a?.clip === 'look_up') {
          openLook ??= { id, from: t, facing: a.facing };
        } else if (openLook && openLook.id === id) {
          looks.push({ ...openLook, to: t });
          openLook = null;
        }
      }
    }
    return { d, log, looks, maxCircling, circuitStarts };
  }

  test('one scholar goes all the way round: the corners in order, back to where it began, pausing to look up', () => {
    const { log, looks } = simulate([1], 90, { col: 6, row: 4 }, [poi]);
    const route = poi.route!;
    const walks = log.filter((w) => w.t >= CIRCUIT_FIRST_AT_SEC - 1).map((w) => key(w.col, w.row));
    // starting on the first stop: the circuit visits the other seven, then closes on the first
    const want = [...route.slice(1), route[0]!].map((s) => key(s.col, s.row));
    expect(walks.slice(0, want.length)).toEqual(want);
    expect(looks).toHaveLength(route.filter((s) => s.look).length);
    for (const l of looks) {
      expect(l.to - l.from).toBeGreaterThanOrEqual(CIRCUIT_LOOK_SEC - 0.5);
      expect([Direction.DOWN, Direction.UP]).toContain(l.facing);
    }
  });

  test('it is occasional: only one scholar circles at a time, and a cooldown separates circuits', () => {
    const { maxCircling, circuitStarts } = simulate([1, 2, 3, 4], 400, { col: 6, row: 4 });
    expect(maxCircling).toBe(1);
    expect(circuitStarts.length).toBeGreaterThanOrEqual(2);
    expect(circuitStarts[0]).toBeGreaterThanOrEqual(CIRCUIT_FIRST_AT_SEC - 1);
    for (let i = 1; i < circuitStarts.length; i++)
      expect(circuitStarts[i]! - circuitStarts[i - 1]!).toBeGreaterThanOrEqual(
        CIRCUIT_COOLDOWN_SEC,
      );
  });

  test('no circuit before the director has run a while, and none in a world without one', () => {
    const early = simulate([1], CIRCUIT_FIRST_AT_SEC - 2, { col: 6, row: 4 });
    expect(early.circuitStarts).toEqual([]);
    const d = createDirector();
    const pois = world.pointsOfInterest.filter((p) => p.kind !== 'circuit');
    let walks = 0;
    for (let t = 0; t < 200; t += 0.5)
      walks += stepDirector(
        d,
        pois,
        [{ id: 1, eligible: true, walking: false, col: 6, row: 4 }],
        0.5,
      ).length;
    expect([...d.plans.values()].some((p) => p.phase === 'circling')).toBe(false);
    expect(walks).toBeGreaterThan(0);
  });
});
