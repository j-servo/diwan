import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../src/agents/pathSmoothing.js';
import {
  TRAIL_CAP,
  backlog,
  bfsRoute,
  catchUpBoost,
  newTrail,
  pushTile,
  walkQueue,
} from '../src/agents/trail.js';

// A 10x10 floor with a 4x4 pool at cols 3-6, rows 3-6.
const pool = (c: number, r: number) => c >= 3 && c <= 6 && r >= 3 && r <= 6;
const floor = (c: number, r: number) => c >= 0 && c < 10 && r >= 0 && r < 10 && !pool(c, r);

/** Runs a follower over the queue at a fixed rate, returning every visited position. */
function walk(start: Vec2, queue: Vec2[], speed = 1.5): Vec2[] {
  const out: Vec2[] = [start];
  let p = start;
  for (let i = 0; i < 4000 && queue.length; i++) {
    p = walkQueue(p, queue, 1 / 60, speed);
    out.push(p);
  }
  return out;
}

describe('pushTile', () => {
  it('queues the centre of each adjacent tile', () => {
    const t = newTrail(1, 1);
    expect(pushTile(t, 2, 1, floor)).toBe('ok');
    expect(pushTile(t, 2, 2, floor)).toBe('ok');
    expect(t.queue).toEqual([
      [2.5, 1.5],
      [2.5, 2.5],
    ]);
    pushTile(t, 2, 2, floor);
    expect(t.queue).toHaveLength(2);
  });

  it('an L-shaped route passes through the corner tile', () => {
    const t = newTrail(0, 0);
    for (const [c, r] of [
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2],
    ] as const)
      pushTile(t, c, r, floor);
    const seen = walk([0.5, 0.5], t.queue);
    expect(seen.some((p) => Math.hypot(p[0] - 2.5, p[1] - 0.5) < 1e-6)).toBe(true);
    // every sample lies inside the union of the queued cells (0..2 x 0, then 2 x 0..2)
    for (const [x, z] of seen) {
      const inRow0 = z >= 0 - 0.05 && z <= 1.05 && x >= -0.05 && x <= 3.05;
      const inCol2 = x >= 2 - 0.05 && x <= 3.05 && z >= -0.05 && z <= 3.05;
      expect(inRow0 || inCol2).toBe(true);
    }
  });

  it('a jump inserts the BFS route round the pool, never across it', () => {
    const t = newTrail(2, 4);
    expect(pushTile(t, 7, 4, floor)).toBe('ok');
    const seen = walk([2.5, 4.5], t.queue);
    for (const [x, z] of seen) expect(pool(Math.floor(x), Math.floor(z))).toBe(false);
    expect(seen[seen.length - 1]).toEqual([7.5, 4.5]);
  });

  it('dissolves when there is no route', () => {
    const t = newTrail(0, 0);
    const walled = (c: number, r: number) => floor(c, r) && c !== 5;
    expect(pushTile(t, 8, 8, walled)).toBe('dissolve');
    expect(t.queue).toEqual([]);
    expect(t.col).toBe(8);
    expect(t.row).toBe(8);
  });

  it('dissolves rather than walking a huge detour', () => {
    expect(bfsRoute([0, 0], [9, 9], floor, 5)).toBeNull();
    expect(bfsRoute([0, 0], [9, 9], floor)).not.toBeNull();
  });

  it('thins straight runs past the cap but keeps every corner', () => {
    const t = newTrail(0, 0);
    // a long run east, a corner, then south
    for (let c = 1; c <= 9; c++) pushTile(t, c, 0, floor);
    for (let r = 1; r <= 2; r++) pushTile(t, 9, r, floor);
    expect(t.queue.length).toBeLessThanOrEqual(TRAIL_CAP + 1);
    expect(t.queue.some((q) => q[0] === 9.5 && q[1] === 0.5)).toBe(true);
    expect(t.queue[t.queue.length - 1]).toEqual([9.5, 2.5]);
  });
});

describe('catchUpBoost and backlog', () => {
  it('is 1 when level, 2.5 at three tiles behind, capped at 4.1', () => {
    expect(catchUpBoost(0)).toBe(1);
    expect(catchUpBoost(1)).toBe(1);
    expect(catchUpBoost(3)).toBeCloseTo(2.5, 6);
    expect(catchUpBoost(4.5)).toBeCloseTo(4.1, 6);
    expect(catchUpBoost(40)).toBe(4.1);
    let prev = 1;
    for (let b = 0; b <= 10; b += 0.25) {
      expect(catchUpBoost(b)).toBeGreaterThanOrEqual(prev);
      prev = catchUpBoost(b);
    }
  });

  it('measures route length through the queue', () => {
    expect(
      backlog(
        [0.5, 0.5],
        [
          [2.5, 0.5],
          [2.5, 2.5],
        ],
        [2.5, 3.0],
      ),
    ).toBeCloseTo(4.5, 6);
  });
});

describe('walkQueue', () => {
  it('pops reached waypoints and never overshoots', () => {
    const q: Vec2[] = [
      [1, 0],
      [1, 1],
    ];
    const p = walkQueue([0, 0], q, 0.1, 100);
    expect(p).toEqual([1, 1]);
    expect(q).toEqual([]);
  });
});
