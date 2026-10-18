import { describe, expect, test } from 'vitest';

import { Direction } from '../../webview-ui/src/office/types.js';
import {
  IDLE_BEFORE_SEC,
  activityDuration,
  activityFor,
  createDirector,
  directorBusy,
  failTarget,
  stepDirector,
} from '../src/agents/idleDirector.js';
import type { AgentView } from '../src/agents/idleDirector.js';
import type { PointOfInterest } from '../src/worlds/types.js';

const shelf: PointOfInterest = {
  id: 'shelf',
  group: 'shelf',
  kind: 'shelf',
  col: 2,
  row: 4,
  facing: Direction.LEFT,
};
const armillary: PointOfInterest = {
  id: 'armillary',
  group: 'armillary',
  kind: 'armillary',
  col: 8,
  row: 6,
  facing: Direction.RIGHT,
};
const chat: PointOfInterest = {
  id: 'chat',
  group: 'chat',
  kind: 'converse',
  col: 9,
  row: 4,
  facing: Direction.RIGHT,
  partner: { col: 10, row: 4, facing: Direction.LEFT },
};

const view = (id: number, o: Partial<AgentView> = {}): AgentView => ({
  id,
  eligible: true,
  walking: false,
  col: 0,
  row: 0,
  ...o,
});

/** Run the director for `secs` seconds in 0.5 s steps; arrivals are simulated by the caller. */
function run(
  d: ReturnType<typeof createDirector>,
  pois: PointOfInterest[],
  views: () => AgentView[],
  secs: number,
) {
  const out: ReturnType<typeof stepDirector> = [];
  for (let t = 0; t < secs; t += 0.5) out.push(...stepDirector(d, pois, views(), 0.5));
  return out;
}

describe('eligibility', () => {
  test('nothing happens before 6 s of idleness', () => {
    const d = createDirector();
    const cmds = run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC - 1);
    expect(cmds).toEqual([]);
  });
  test('after 6 s an idle main agent is sent to a point of interest', () => {
    const d = createDirector();
    const cmds = run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC + 1);
    expect(cmds).toEqual([{ type: 'walk', id: 1, col: 2, row: 4 }]);
  });
  test('an ineligible agent (active, signalled, subagent) never gets a command and resets the clock', () => {
    const d = createDirector();
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC - 1);
    run(d, [shelf], () => [view(1, { eligible: false })], 1);
    expect(run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC - 1)).toEqual([]);
  });
  test('a walking agent does not accumulate idle time', () => {
    const d = createDirector();
    expect(run(d, [shelf], () => [view(1, { walking: true })], 20)).toEqual([]);
  });
});

describe('capacity', () => {
  test('at most one per tile by default: the second agent takes the other point', () => {
    const d = createDirector();
    const cmds = run(d, [shelf, armillary], () => [view(1), view(2)], IDLE_BEFORE_SEC + 1);
    const walks = cmds.filter((c) => c.type === 'walk');
    expect(walks).toHaveLength(2);
    expect(new Set(walks.map((w) => `${w.col},${w.row}`)).size).toBe(2);
  });
  test('with one single-capacity point the second agent has to wait', () => {
    const d = createDirector();
    const cmds = run(d, [shelf], () => [view(1), view(2)], IDLE_BEFORE_SEC + 1);
    expect(cmds.filter((c) => c.type === 'walk')).toHaveLength(1);
  });
  test('capacity 2 admits two, never three', () => {
    const d = createDirector();
    const two = { ...shelf, capacity: 2 };
    const cmds = run(d, [two], () => [view(1), view(2), view(3)], IDLE_BEFORE_SEC + 1);
    expect(cmds.filter((c) => c.type === 'walk')).toHaveLength(2);
  });
});

describe('spots (groups)', () => {
  const at = (id: string, col: number): PointOfInterest => ({
    id,
    group: 'armillary',
    kind: 'armillary',
    col,
    row: 6,
    facing: Direction.RIGHT,
  });
  test('four tiles at one spot still admit only two scholars', () => {
    const d = createDirector();
    const pois = [at('f1', 8), at('f2', 9), at('f3', 10), at('f4', 11)];
    const cmds = run(d, pois, () => [view(1), view(2), view(3), view(4)], IDLE_BEFORE_SEC + 1);
    expect(cmds.filter((c) => c.type === 'walk')).toHaveLength(2);
  });
});

describe('abort', () => {
  test('becoming ineligible mid-activity sends the agent back to its seat and frees the point', () => {
    const d = createDirector();
    let ag = [view(1)];
    run(d, [shelf], () => ag, IDLE_BEFORE_SEC + 1);
    ag = [view(1, { walking: true })];
    run(d, [shelf], () => ag, 1);
    ag = [view(1, { eligible: false, walking: true })];
    const cmds = stepDirector(d, [shelf], ag, 0.5);
    expect(cmds).toEqual([{ type: 'seat', id: 1 }]);
    expect(activityFor(d, 1)).toBeNull();
    // the point is free again for someone else
    const again = run(d, [shelf], () => [view(2)], IDLE_BEFORE_SEC + 1);
    expect(again.some((c) => c.type === 'walk' && c.id === 2)).toBe(true);
  });
  test('an arrived agent that goes active is also sent back', () => {
    const d = createDirector();
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC + 1);
    run(d, [shelf], () => [view(1, { col: 2, row: 4 })], 1);
    expect(activityFor(d, 1)).not.toBeNull();
    expect(stepDirector(d, [shelf], [view(1, { eligible: false, col: 2, row: 4 })], 0.5)).toEqual([
      { type: 'seat', id: 1 },
    ]);
    expect(activityFor(d, 1)).toBeNull();
  });
  test('a failed walk releases the point and backs off', () => {
    const d = createDirector();
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC + 1);
    failTarget(d, 1);
    expect(run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC)).toEqual([]);
  });
});

describe('activity', () => {
  test('arrival starts the activity with the point facing; it lasts 8 to 20 s then moves on', () => {
    const d = createDirector();
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC + 1);
    run(d, [shelf], () => [view(1, { col: 2, row: 4 })], 1);
    const a = activityFor(d, 1)!;
    expect(a.clip).toBe('read');
    expect(a.prop).toBe('prop_codex');
    expect(a.facing).toBe(Direction.LEFT);
    const cmds = run(d, [shelf], () => [view(1, { col: 2, row: 4 })], 21);
    expect(cmds).toContainEqual({ type: 'seat', id: 1 }); // nowhere else to go
  });
  test('kinds map to the planned clips', () => {
    const at = (poi: PointOfInterest) => {
      const d = createDirector();
      run(d, [poi], () => [view(1)], IDLE_BEFORE_SEC + 1);
      run(d, [poi], () => [view(1, { col: poi.col, row: poi.row })], 1);
      return activityFor(d, 1)!;
    };
    expect(at({ ...shelf, kind: 'scrolls' })).toMatchObject({
      clip: 'scroll_search',
      prop: 'prop_scroll',
    });
    // scholars gather round the armillary and look up at it, following its turn
    expect(at(armillary)).toMatchObject({ clip: 'look_up', prop: null });
    expect(at(armillary).sway).toBeGreaterThan(0);
    expect(at({ ...shelf, kind: 'board' })).toMatchObject({ clip: 'look_up' });
    expect(at({ ...shelf, kind: 'planter' })).toMatchObject({ clip: 'idle' });
  });
  test('durations are deterministic per agent and step, within 8 to 20 s', () => {
    for (let id = 1; id < 30; id++) {
      for (let step = 0; step < 5; step++) {
        const x = activityDuration(id, step);
        expect(x).toBe(activityDuration(id, step));
        expect(x).toBeGreaterThanOrEqual(8);
        expect(x).toBeLessThanOrEqual(20);
      }
    }
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => activityDuration(i, 0)));
    expect(distinct.size).toBeGreaterThan(5);
  });
  test('every third activity ends with a return to the seat', () => {
    const d = createDirector();
    const pois = [shelf, armillary];
    let pos = { col: 0, row: 0 };
    let seats = 0;
    let walks = 0;
    for (let t = 0; t < 300; t += 0.5) {
      for (const c of stepDirector(d, pois, [view(1, pos)], 0.5)) {
        if (c.type === 'walk') {
          walks++;
          pos = { col: c.col!, row: c.row! }; // teleport: arrival is not under test
        } else {
          seats++;
          pos = { col: 0, row: 0 };
        }
      }
    }
    expect(seats).toBeGreaterThan(3);
    expect(walks).toBeGreaterThanOrEqual(seats * 2);
  });
});

describe('conversation', () => {
  const both = () => [view(1), view(2)];
  test('two ready idle agents are paired on adjacent tiles facing each other', () => {
    const d = createDirector();
    const cmds = run(d, [chat], both, IDLE_BEFORE_SEC + 1);
    const walks = cmds.filter((c) => c.type === 'walk');
    expect(walks).toHaveLength(2);
    expect(walks.map((w) => `${w.col},${w.row}`).sort()).toEqual(['10,4', '9,4']);
    const at = (id: number) => (id === walks[0].id ? walks[0] : walks[1]);
    run(
      d,
      [chat],
      () => [
        view(1, { col: at(1).col, row: at(1).row }),
        view(2, { col: at(2).col, row: at(2).row }),
      ],
      1,
    );
    const a = activityFor(d, 1)!;
    const b = activityFor(d, 2)!;
    expect(new Set([a.facing, b.facing])).toEqual(new Set([Direction.RIGHT, Direction.LEFT]));
  });
  test('they alternate speaking and listening', () => {
    const d = createDirector();
    const cmds = run(d, [chat], both, IDLE_BEFORE_SEC + 1);
    const w = cmds.filter((c) => c.type === 'walk');
    const views = () => w.map((c) => view(c.id, { col: c.col, row: c.row }));
    run(d, [chat], views, 1);
    const seen = new Set<string>();
    for (let t = 0; t < 8; t += 0.5) {
      stepDirector(d, [chat], views(), 0.5);
      const a = activityFor(d, 1)!;
      const b = activityFor(d, 2)!;
      if (a.clip === 'gesture_beckon') expect(b.clip).toBe('idle');
      if (b.clip === 'gesture_beckon') expect(a.clip).toBe('idle');
      seen.add(a.clip);
    }
    expect(seen).toEqual(new Set(['gesture_beckon', 'idle']));
  });
  test('a lone agent is never sent to a conversation', () => {
    const d = createDirector();
    expect(run(d, [chat], () => [view(1)], 30)).toEqual([]);
  });
  test('when one speaker is called away the other leaves too', () => {
    const d = createDirector();
    const cmds = run(d, [chat], both, IDLE_BEFORE_SEC + 1);
    const w = cmds.filter((c) => c.type === 'walk');
    const at = (id: number) => w.find((c) => c.id === id)!;
    const ready = (id: number) => view(id, { col: at(id).col, row: at(id).row });
    run(d, [chat], () => [ready(1), ready(2)], 1);
    const out = stepDirector(d, [chat], [view(1, { eligible: false }), ready(2)], 0.5);
    expect(out).toContainEqual({ type: 'seat', id: 1 });
    const next = stepDirector(d, [chat], [view(1, { eligible: false }), ready(2)], 0.5);
    expect([...out, ...next].some((c) => c.id === 2)).toBe(true);
  });
});

describe('directorBusy', () => {
  test('false while everyone waits; true while going, doing, and in a conversation', () => {
    const d = createDirector();
    expect(directorBusy(d)).toBe(false);
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC - 1);
    expect(directorBusy(d)).toBe(false);
    run(d, [shelf], () => [view(1)], 2); // sent out: going
    expect(directorBusy(d)).toBe(true);
    run(d, [shelf], () => [view(1, { col: 2, row: 4 })], 1); // arrived: doing
    expect(activityFor(d, 1)).not.toBeNull();
    expect(directorBusy(d)).toBe(true);

    const c = createDirector();
    const pair = [view(1), view(2)];
    run(c, [chat], () => pair, IDLE_BEFORE_SEC + 1);
    expect(directorBusy(c)).toBe(true);
  });
  test('false again once the scholar is back and waiting', () => {
    const d = createDirector();
    run(d, [shelf], () => [view(1)], IDLE_BEFORE_SEC + 1);
    stepDirector(d, [shelf], [view(1, { eligible: false })], 0.5);
    expect(directorBusy(d)).toBe(false);
  });
});
