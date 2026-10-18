import { describe, expect, it } from 'vitest';

import type { DirectorEvent, Shot } from '../src/camera/director.js';
import { INITIAL_SHOT, deriveEvents, nextShot } from '../src/camera/director.js';

const ev = (kind: DirectorEvent['kind'], agentId: number, at: number): DirectorEvent => ({
  kind,
  agentId,
  at,
});

describe('nextShot', () => {
  it('is wide with no events', () => {
    expect(nextShot([], 10, null).kind).toBe('wide');
  });
  it('ranks approval > delegate > done > join', () => {
    const events = [ev('join', 1, 9), ev('done', 2, 9), ev('delegate', 3, 9), ev('approval', 4, 9)];
    expect(nextShot(events, 10, null)).toMatchObject({
      kind: 'agent',
      agentId: 4,
      reason: 'approval',
    });
    expect(nextShot(events.slice(0, 3), 10, null)).toMatchObject({
      agentId: 3,
      reason: 'delegate',
    });
    expect(nextShot(events.slice(0, 2), 10, null)).toMatchObject({ agentId: 2, reason: 'done' });
  });
  it('prefers the newest among equal priority', () => {
    const s = nextShot([ev('done', 1, 5), ev('done', 2, 8)], 9, null);
    expect(s).toMatchObject({ agentId: 2 });
  });
  it('holds the current shot for 4 s even against a higher priority event', () => {
    const cur = nextShot([ev('join', 1, 10)], 10, null);
    const events = [ev('join', 1, 10), ev('approval', 2, 11)];
    expect(nextShot(events, 13.9, cur)).toBe(cur);
    expect(nextShot(events, 14, cur)).toMatchObject({ agentId: 2, reason: 'approval' });
  });
  it('keeps the same shot object (and its hold clock) while the target is unchanged', () => {
    const cur = nextShot([ev('join', 1, 10)], 10, null);
    expect(nextShot([ev('join', 1, 10)], 15, cur)).toBe(cur);
  });
  it('returns to wide after 8 s with no events', () => {
    const events = [ev('approval', 1, 10)];
    const cur = nextShot(events, 10, null);
    expect(nextShot(events, 17.9, cur).kind).toBe('agent');
    expect(nextShot(events, 18, cur).kind).toBe('wide');
  });
  it('seeds the initial wide shot so the first approval is not held back', () => {
    expect(nextShot([], 0, null)).toEqual({ kind: 'wide', since: -Infinity });
    expect(INITIAL_SHOT.since).toBe(-Infinity);
    const s = nextShot([ev('approval', 7, 0.5)], 0.5, INITIAL_SHOT);
    expect(s).toMatchObject({ kind: 'agent', agentId: 7, reason: 'approval' });
  });
  it('stays wide, same object, once wide', () => {
    const wide: Shot = { kind: 'wide', since: 0 };
    expect(nextShot([], 100, wide)).toBe(wide);
  });
});

describe('deriveEvents', () => {
  const ch = (id: number, o: Partial<Parameters<typeof deriveEvents>[1][number]> = {}) => ({
    id,
    isSubagent: false,
    parentAgentId: null,
    bubbleType: null as 'permission' | 'waiting' | null,
    ...o,
  });
  it('reports a join for a new agent and a delegate (on the parent) for a new subagent', () => {
    const a = deriveEvents(new Map(), [ch(1)], 3);
    expect(a.events).toEqual([{ kind: 'join', agentId: 1, at: 3 }]);
    const b = deriveEvents(a.next, [ch(1), ch(2, { isSubagent: true, parentAgentId: 1 })], 4);
    expect(b.events).toEqual([{ kind: 'delegate', agentId: 1, at: 4 }]);
  });
  it('reports approval and done only on the edge', () => {
    const a = deriveEvents(new Map(), [ch(1)], 0);
    const b = deriveEvents(a.next, [ch(1, { bubbleType: 'permission' })], 1);
    expect(b.events).toEqual([{ kind: 'approval', agentId: 1, at: 1 }]);
    const c = deriveEvents(b.next, [ch(1, { bubbleType: 'permission' })], 2);
    expect(c.events).toEqual([]);
    const d = deriveEvents(c.next, [ch(1, { bubbleType: 'waiting' })], 3);
    expect(d.events).toEqual([{ kind: 'done', agentId: 1, at: 3 }]);
  });
  it('forgets characters that left', () => {
    const a = deriveEvents(new Map(), [ch(1)], 0);
    const b = deriveEvents(a.next, [], 1);
    expect(b.next.size).toBe(0);
    expect(deriveEvents(b.next, [ch(1)], 2).events).toHaveLength(1);
  });
});
