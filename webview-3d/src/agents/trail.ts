import type { Vec2 } from './pathSmoothing.js';

/**
 * A figure walks the tiles its engine character walked, in order, instead of cutting straight to
 * the character's current position (which crosses the pool and the pyramid whenever the slower
 * figure falls behind). The queue holds tile centres in world units (1 unit = 1 tile).
 */
export interface Trail {
  queue: Vec2[];
  /** The last tile queued (or stood on): the next engine tile is compared with it. */
  col: number;
  row: number;
}

export type Walkable = (col: number, row: number) => boolean;

/** Beyond this many queued waypoints, collinear mid-run ones are dropped (never corners). */
export const TRAIL_CAP = 6;
/** Backlog (tiles of route still to walk) at which the catch-up boost reaches 2.5x. */
export const BOOST_FULL_AT = 3;
export const BOOST_MAX = 2.5;
/** Past the cap the boost keeps rising, to this ceiling (the engine walks at about 4.1x the figure's base pace) at BOOST_HARD_AT tiles of backlog. */
export const BOOST_CEILING = 4.1;
export const BOOST_HARD_AT = 4.5;
/** A longer detour than this is a teleport (seat snap, layout rebuild): dissolve instead. */
export const MAX_ROUTE_TILES = 24;

export function newTrail(col: number, row: number): Trail {
  return { queue: [], col, row };
}

export function tileCentre(col: number, row: number): Vec2 {
  return [col + 0.5, row + 0.5];
}

const STEPS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Shortest 4-connected route over walkable tiles: excludes `from`, includes `to`; null if none. */
export function bfsRoute(
  from: readonly [number, number],
  to: readonly [number, number],
  walkable: Walkable,
  maxTiles = MAX_ROUTE_TILES,
): [number, number][] | null {
  if (from[0] === to[0] && from[1] === to[1]) return [];
  if (!walkable(to[0], to[1])) return null;
  const key = (c: number, r: number) => `${c},${r}`;
  const prev = new Map<string, [number, number] | null>([[key(from[0], from[1]), null]]);
  let frontier: [number, number][] = [[from[0], from[1]]];
  for (let depth = 1; depth <= maxTiles && frontier.length; depth++) {
    const next: [number, number][] = [];
    for (const [c, r] of frontier) {
      for (const [dc, dr] of STEPS) {
        const nc = c + dc;
        const nr = r + dr;
        const k = key(nc, nr);
        if (prev.has(k) || !walkable(nc, nr)) continue;
        prev.set(k, [c, r]);
        if (nc === to[0] && nr === to[1]) {
          const out: [number, number][] = [];
          let cur: [number, number] | null = [nc, nr];
          while (cur && !(cur[0] === from[0] && cur[1] === from[1])) {
            out.push(cur);
            cur = prev.get(key(cur[0], cur[1])) ?? null;
          }
          return out.reverse();
        }
        next.push([nc, nr]);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The engine character is now on tile (col, row). Queues its centre (and, after a jump, the
 * walkable route from the last queued tile). 'dissolve' means no usable route: the caller
 * cross-fades to the new place instead of walking, and the queue is emptied.
 */
export function pushTile(
  trail: Trail,
  col: number,
  row: number,
  walkable: Walkable,
): 'ok' | 'dissolve' {
  if (col === trail.col && row === trail.row) return 'ok';
  const adjacent = Math.abs(col - trail.col) + Math.abs(row - trail.row) === 1;
  const route = adjacent
    ? [[col, row] as [number, number]]
    : bfsRoute([trail.col, trail.row], [col, row], walkable);
  trail.col = col;
  trail.row = row;
  if (!route) {
    trail.queue.length = 0;
    return 'dissolve';
  }
  for (const [c, r] of route) trail.queue.push(tileCentre(c, r));
  thin(trail.queue);
  return 'ok';
}

/** Drops collinear waypoints (oldest first) until the queue fits the cap; corners always stay. */
function thin(queue: Vec2[]): void {
  for (let i = 1; i < queue.length - 1 && queue.length > TRAIL_CAP;) {
    const a = queue[i - 1]!;
    const b = queue[i]!;
    const c = queue[i + 1]!;
    const straight = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) === 0;
    if (straight) queue.splice(i, 1);
    else i++;
  }
}

/** Tiles of route from `pos` through the queue to `target`. */
export function backlog(pos: Vec2, queue: readonly Vec2[], target: Vec2): number {
  let len = 0;
  let at = pos;
  for (const q of queue) {
    len += Math.hypot(q[0] - at[0], q[1] - at[1]);
    at = q;
  }
  return len + Math.hypot(target[0] - at[0], target[1] - at[1]);
}

/** Speed multiplier: 1 when level with the engine, 2.5x at 3 tiles behind, rising to the engine's own pace (4.1x) at 4.5. */
export function catchUpBoost(tilesBehind: number): number {
  if (tilesBehind <= 1) return 1;
  if (tilesBehind <= BOOST_FULL_AT) {
    const t = (tilesBehind - 1) / (BOOST_FULL_AT - 1);
    return 1 + (BOOST_MAX - 1) * t * t * (3 - 2 * t);
  }
  const t = Math.min(1, (tilesBehind - BOOST_FULL_AT) / (BOOST_HARD_AT - BOOST_FULL_AT));
  return BOOST_MAX + (BOOST_CEILING - BOOST_MAX) * t;
}

/**
 * Walks `pos` along the queue for `dt` seconds at `unitsPerSec` (tiles/s), popping each waypoint it
 * reaches. Returns the new position; an empty queue leaves it where it is (the caller finishes the
 * last leg to the engine's exact position).
 */
export function walkQueue(pos: Vec2, queue: Vec2[], dt: number, unitsPerSec: number): Vec2 {
  let budget = unitsPerSec * Math.min(Math.max(dt, 0), 0.1);
  let x = pos[0];
  let z = pos[1];
  while (queue.length && budget > 0) {
    const q = queue[0]!;
    const d = Math.hypot(q[0] - x, q[1] - z);
    if (d <= budget) {
      x = q[0];
      z = q[1];
      budget -= d;
      queue.shift();
    } else {
      x += ((q[0] - x) / d) * budget;
      z += ((q[1] - z) / d) * budget;
      budget = 0;
    }
  }
  return [x, z];
}
