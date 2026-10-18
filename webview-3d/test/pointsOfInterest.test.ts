import { beforeAll, describe, expect, test } from 'vitest';

import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { Direction } from '../../webview-ui/src/office/types.js';
import { ambientActivityFor, driveIdleAgents } from '../src/agents/idleDirectorStore.js';
import { installWorldCatalog } from '../src/worlds/catalog.js';
import { houseOfWisdomGreybox as world } from '../src/worlds/houseOfWisdom/greybox.js';

beforeAll(() => installWorldCatalog(world));

const FACINGS: number[] = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT];

describe('House of Wisdom points of interest', () => {
  test('every point (and conversation partner tile) is walkable with a valid facing', () => {
    const os = new OfficeState(world.floorPlan);
    const walkable = new Set(os.walkableTiles.map((t) => `${t.col},${t.row}`));
    const ids = new Set<string>();
    expect(world.pointsOfInterest.length).toBeGreaterThan(10);
    for (const p of world.pointsOfInterest) {
      expect(ids.has(p.id), `duplicate ${p.id}`).toBe(false);
      ids.add(p.id);
      expect(walkable.has(`${p.col},${p.row}`), `${p.id} walkable`).toBe(true);
      expect(FACINGS).toContain(p.facing);
      if (p.kind === 'converse') {
        expect(p.partner, `${p.id} partner`).toBeDefined();
        const q = p.partner!;
        expect(walkable.has(`${q.col},${q.row}`), `${p.id} partner walkable`).toBe(true);
        expect(FACINGS).toContain(q.facing);
        expect(Math.abs(q.col - p.col) + Math.abs(q.row - p.row)).toBe(1);
        // they face each other
        const dc = q.col - p.col;
        const dr = q.row - p.row;
        const want =
          dc === 1
            ? Direction.RIGHT
            : dc === -1
              ? Direction.LEFT
              : dr === 1
                ? Direction.DOWN
                : Direction.UP;
        expect(p.facing).toBe(want);
      }
    }
  });

  test('every point belongs to a spot; the armillary is one spot of four tiles', () => {
    const groups = new Map<string, number>();
    for (const p of world.pointsOfInterest) {
      expect(p.group).toBeTruthy();
      groups.set(p.group, (groups.get(p.group) ?? 0) + 1);
    }
    expect(groups.get('armillary')).toBe(4);
    expect(groups.size).toBeLessThan(world.pointsOfInterest.length);
  });

  test('the armillary spot rings its plinth: each tile touches the footprint and faces it', () => {
    const f = world.floorPlan.furniture.find((x) => x.type === 'hw_armillary')!;
    expect(f).toBeDefined();
    expect(world.floorPlan.furniture.some((x) => x.type === 'hw_fountain')).toBe(false);
    const pts = world.pointsOfInterest.filter((p) => p.kind === 'armillary');
    expect(pts).toHaveLength(4);
    const step = {
      [Direction.UP]: [0, -1],
      [Direction.DOWN]: [0, 1],
      [Direction.LEFT]: [-1, 0],
      [Direction.RIGHT]: [1, 0],
    } as Record<number, [number, number]>;
    for (const p of pts) {
      const [dc, dr] = step[p.facing];
      const c = p.col + dc;
      const r = p.row + dr;
      expect(c >= f.col && c < f.col + 2 && r >= f.row && r < f.row + 2, p.id).toBe(true);
    }
  });

  test('the two planters stand on their row out by the scroll racks, never on a shelf face', () => {
    const shelves = world.floorPlan.furniture.filter((x) => x.type === 'hw_shelf');
    const front = world.floorPlan.furniture.filter(
      (x) => x.type === 'hw_palm' && x.row >= world.floorPlan.rows / 2,
    );
    expect(front.map((x) => [x.col, x.row])).toEqual([
      [3, 9],
      [16, 9],
    ]);
    // shelf faces: the tile in front of each shelf tile (cols 2 and 17), where browsers stand
    const faces = new Set(
      shelves.flatMap((s) =>
        [0, 1].map((dr) => `${s.col < world.floorPlan.cols / 2 ? 2 : 17},${s.row + dr}`),
      ),
    );
    for (const p of front) {
      expect(faces.has(`${p.col},${p.row}`), `${p.col},${p.row}`).toBe(false);
      const reach = shelves
        .filter((s) => p.row >= s.row && p.row < s.row + 2)
        .map((s) => Math.abs(p.col - s.col));
      expect(Math.min(...reach), 'beside its scroll rack').toBe(2);
      // each planter has its admirer's tile right below it, and no point stands on the jar
      const admirer = world.pointsOfInterest.find(
        (q) => q.kind === 'planter' && q.col === p.col && q.row === p.row + 1,
      );
      expect(admirer?.facing).toBe(Direction.UP);
      expect(world.pointsOfInterest.some((q) => q.col === p.col && q.row === p.row)).toBe(false);
    }
  });

  test('every kind is represented (no board kind while the world has no board)', () => {
    const kinds = new Set(world.pointsOfInterest.map((p) => p.kind));
    expect(kinds).toEqual(
      new Set([
        'shelf',
        'scrolls',
        'armillary',
        ...(world.board ? ['board' as const] : []),
        'planter',
        'converse',
      ]),
    );
  });
});

describe('driving a real OfficeState', () => {
  test('an idle scholar goes out, and returns to its seat the moment it is active', () => {
    const os = new OfficeState(world.floorPlan);
    os.addAgent(1);
    os.setAgentActive(1, false);
    const ch = os.characters.get(1)!;
    const poiTiles = new Set(
      world.pointsOfInterest.flatMap((p) => [
        `${p.col},${p.row}`,
        p.partner ? `${p.partner.col},${p.partner.row}` : '',
      ]),
    );
    let out = false;
    let activity = false;
    for (let t = 0; t < 90; t += 0.05) {
      driveIdleAgents(os, world.pointsOfInterest, 0.05);
      os.update(0.05);
      if (poiTiles.has(`${ch.tileCol},${ch.tileRow}`)) out = true;
      if (ambientActivityFor(1)) activity = true;
    }
    expect(out).toBe(true);
    expect(activity).toBe(true);
    os.setAgentActive(1, true);
    for (let t = 0; t < 30; t += 0.05) {
      driveIdleAgents(os, world.pointsOfInterest, 0.05);
      os.update(0.05);
    }
    const seat = os.seats.get(ch.seatId!)!;
    expect([ch.tileCol, ch.tileRow]).toEqual([seat.seatCol, seat.seatRow]);
    expect(ambientActivityFor(1)).toBeNull();
  });

  test('a scholar showing "Done, waiting for you" never leaves; it goes out once the bubble is gone', () => {
    const os = new OfficeState(world.floorPlan);
    os.addAgent(7);
    os.setAgentActive(7, false);
    const ch = os.characters.get(7)!;
    const seat = os.seats.get(ch.seatId!)!;
    for (let t = 0; t < 30; t += 0.05) {
      ch.bubbleType = 'waiting';
      ch.bubbleTimer = 1e9;
      driveIdleAgents(os, world.pointsOfInterest, 0.05);
      os.update(0.05);
      expect([ch.tileCol, ch.tileRow]).toEqual([seat.seatCol, seat.seatRow]);
    }
    ch.bubbleType = null;
    let busy = false;
    for (let t = 0; t < 12; t += 0.05) {
      busy = driveIdleAgents(os, world.pointsOfInterest, 0.05) || busy;
      os.update(0.05);
    }
    expect(busy).toBe(true);
    expect([ch.tileCol, ch.tileRow]).not.toEqual([seat.seatCol, seat.seatRow]);
  });
});
