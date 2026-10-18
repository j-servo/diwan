import { describe, expect, test } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import type { InspectState } from '../src/inspect/inspectModel.js';
import {
  durationText,
  inspectReducer,
  needsYouQueue,
  nextNeedsYou,
  peekText,
  recentRows,
  stateLine,
  subRecord,
} from '../src/inspect/inspectModel.js';

const run = (msgs: Array<[number, ServerMessage]>, from: InspectState = {}): InspectState =>
  msgs.reduce((s, [at, m]) => inspectReducer(s, m, at), from);

const created = (id: number, folder = 'orchard-site'): ServerMessage => ({
  type: 'agentCreated',
  id,
  folderName: folder,
});
const start = (
  id: number,
  toolId: string,
  status: string,
  detail?: string,
  extra: Partial<Extract<ServerMessage, { type: 'agentToolStart' }>> = {},
): ServerMessage => ({ type: 'agentToolStart', id, toolId, status, detail, ...extra });
const done = (id: number, toolId: string): ServerMessage => ({ type: 'agentToolDone', id, toolId });

describe('inspectReducer: agents', () => {
  test('agentCreated records the folder; agentLabel the full label', () => {
    const s = run([
      [0, created(1)],
      [5, { type: 'agentLabel', id: 1, label: 'a very long session label indeed' }],
    ]);
    expect(s[1].folder).toBe('orchard-site');
    expect(s[1].label).toBe('a very long session label indeed');
  });

  test('a tool start puts the agent to work and lists the tool with its detail', () => {
    const s = run([
      [0, created(1)],
      [1000, start(1, 't1', 'Running: npm test --', 'npm test -- invoices --reporter=dot')],
    ]);
    expect(s[1].phase).toBe('working');
    expect(s[1].since).toBe(1000);
    expect(s[1].tools).toEqual([
      expect.objectContaining({
        toolId: 't1',
        status: 'Running: npm test --',
        detail: 'npm test -- invoices --reporter=dot',
      }),
    ]);
  });

  test('a second start on the same tool updates it in place and keeps its start time', () => {
    const s = run([
      [0, created(1)],
      [1000, start(1, 't1', 'Using Foo')],
      [2000, start(1, 't1', 'Using Foo', 'more', { runInBackground: true })],
    ]);
    expect(s[1].tools).toHaveLength(1);
    expect(s[1].tools[0]).toMatchObject({ detail: 'more', at: 1000 });
  });

  test('finished tools go to recent, newest first, capped at five', () => {
    const msgs: Array<[number, ServerMessage]> = [[0, created(1)]];
    for (let i = 1; i <= 7; i++) {
      msgs.push([i * 1000, start(1, `t${i}`, `Reading f${i}`)], [i * 1000 + 500, done(1, `t${i}`)]);
    }
    const s = run(msgs);
    expect(s[1].tools).toEqual([]);
    expect(recentRows(s[1]).map((r) => r.toolId)).toEqual(['t7', 't6', 't5', 't4', 't3']);
  });

  test('waiting with awaitingInput is "asking"; plain waiting is idle; active is working', () => {
    let s = run([
      [0, created(1)],
      [1, { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true }],
    ]);
    expect(s[1].phase).toBe('asking');
    s = run([[10, { type: 'agentStatus', id: 1, status: 'waiting' }]], s);
    expect(s[1].phase).toBe('idle');
    expect(s[1].since).toBe(10);
    s = run([[20, { type: 'agentStatus', id: 1, status: 'waiting' }]], s);
    expect(s[1].since).toBe(10); // no change of state, the clock keeps counting
    s = run([[30, { type: 'agentStatus', id: 1, status: 'active' }]], s);
    expect(s[1].phase).toBe('working');
  });

  test('agentToolsClear drops live tools but keeps recent', () => {
    const s = run([
      [0, created(1)],
      [1, start(1, 't1', 'Reading a')],
      [2, done(1, 't1')],
      [3, start(1, 't2', 'Reading b')],
      [4, { type: 'agentToolsClear', id: 1 }],
    ]);
    expect(s[1].tools).toEqual([]);
    expect(recentRows(s[1])).toHaveLength(1);
  });

  test('closing an agent marks it left; later messages for it change nothing', () => {
    const s = run([
      [0, created(1)],
      [1, start(1, 't1', 'Reading a')],
      [100, { type: 'agentClosed', id: 1 }],
      [200, start(1, 't2', 'Reading b')],
    ]);
    expect(s[1].phase).toBe('left');
    expect(s[1].since).toBe(100);
    expect(s[1].tools).toEqual([]);
  });

  test('left agents are pruned a minute later, when the next message arrives', () => {
    const s = run([
      [0, created(1)],
      [100, { type: 'agentClosed', id: 1 }],
      [100 + 61_000, created(2)],
    ]);
    expect(s[1]).toBeUndefined();
    expect(s[2]).toBeDefined();
  });

  test('unrelated messages return the same object', () => {
    const s = run([[0, created(1)]]);
    expect(
      inspectReducer(
        s,
        { type: 'agentContextUsage', id: 1, contextTokens: 1, maxContextTokens: 2 },
        5,
      ),
    ).toBe(s);
  });
});

describe('inspectReducer: approvals', () => {
  test('agentToolPermission starts the approval clock; tool start with permissionActive keeps it', () => {
    let s = run([
      [0, created(1)],
      [1, start(1, 't1', 'Running: git push', 'git push origin main')],
      [500, { type: 'agentToolPermission', id: 1 }],
    ]);
    expect(s[1].approvalSince).toBe(500);
    s = run([[900, { type: 'agentToolPermission', id: 1 }]], s);
    expect(s[1].approvalSince).toBe(500);
  });

  test.each([
    ['agentToolPermissionClear', { type: 'agentToolPermissionClear', id: 1 } as ServerMessage],
    ['agentToolsClear', { type: 'agentToolsClear', id: 1 } as ServerMessage],
    ['waiting status', { type: 'agentStatus', id: 1, status: 'waiting' } as ServerMessage],
    ['a plain tool start', start(1, 't2', 'Reading a')],
  ])('%s clears the approval', (_name, msg) => {
    const s = run([
      [0, created(1)],
      [1, start(1, 't1', 'Running: git push')],
      [2, { type: 'agentToolPermission', id: 1 }],
      [3, msg],
    ]);
    expect(s[1].approvalSince).toBeNull();
  });

  test('a tool start that is itself permissionActive sets the approval', () => {
    const s = run([
      [0, created(1)],
      [7, start(1, 't1', 'Running: x', undefined, { permissionActive: true })],
    ]);
    expect(s[1].approvalSince).toBe(7);
  });

  test('needsYouQueue is oldest first and counts an agent once', () => {
    const s = run([
      [0, created(1)],
      [0, created(2)],
      [0, created(3)],
      [10, start(1, 't1', 'Running: a')],
      [20, start(2, 't2', 'Running: b')],
      [30, { type: 'agentToolPermission', id: 2 }],
      [40, { type: 'agentToolPermission', id: 1 }],
      [
        41,
        { type: 'subagentToolStart', id: 3, parentToolId: 'p', toolId: 's', status: 'Running: c' },
      ],
      [42, { type: 'subagentToolPermission', id: 3, parentToolId: 'p' }],
      [50, { type: 'subagentToolPermission', id: 2, parentToolId: 'q' }],
    ]);
    expect(needsYouQueue(s)).toEqual([
      { agentId: 2, since: 30 },
      { agentId: 1, since: 40 },
      { agentId: 3, since: 42 },
    ]);
  });
});

describe('nextNeedsYou', () => {
  const q = [
    { agentId: 2, since: 30 },
    { agentId: 1, since: 40 },
    { agentId: 3, since: 42 },
  ];
  test('starts at the oldest, then moves on and wraps', () => {
    expect(nextNeedsYou(q, null)).toBe(2);
    expect(nextNeedsYou(q, 7)).toBe(2); // the card shows someone who is not asking
    expect(nextNeedsYou(q, 2)).toBe(1);
    expect(nextNeedsYou(q, 1)).toBe(3);
    expect(nextNeedsYou(q, 3)).toBe(2);
  });
  test('nobody asking, nobody to show', () => {
    expect(nextNeedsYou([], 2)).toBeNull();
  });
});

describe('inspectReducer: apprentices', () => {
  const base: Array<[number, ServerMessage]> = [
    [0, created(1)],
    [
      1,
      start(1, 'p1', 'Subtask: audit page speed', 'audit page speed\nRun lighthouse.', {
        toolName: 'Agent',
      }),
    ],
  ];

  test('sub tools are tracked under the parent tool, with the parent task copied in', () => {
    const s = run([
      ...base,
      [
        2,
        {
          type: 'subagentToolStart',
          id: 1,
          parentToolId: 'p1',
          toolId: 's1',
          status: 'Reading lighthouse.json',
          detail: 'out/lighthouse.json',
        },
      ],
    ]);
    const sub = subRecord(s, 1, 'p1')!;
    expect(sub.task).toMatchObject({
      status: 'Subtask: audit page speed',
      detail: 'audit page speed\nRun lighthouse.',
    });
    expect(sub.tools[0]).toMatchObject({ toolId: 's1', detail: 'out/lighthouse.json' });
  });

  test("a finished sub tool moves to the sub's recent; subagentClear removes the apprentice", () => {
    let s = run([
      ...base,
      [
        2,
        { type: 'subagentToolStart', id: 1, parentToolId: 'p1', toolId: 's1', status: 'Reading a' },
      ],
      [3, { type: 'subagentToolDone', id: 1, parentToolId: 'p1', toolId: 's1' }],
    ]);
    expect(subRecord(s, 1, 'p1')!.tools).toEqual([]);
    expect(subRecord(s, 1, 'p1')!.recent).toHaveLength(1);
    s = run([[4, { type: 'subagentClear', id: 1, parentToolId: 'p1' }]], s);
    expect(subRecord(s, 1, 'p1')).toBeUndefined();
  });

  test('before the first sub tool, the apprentice resolves from the live parent tool', () => {
    const s = run(base);
    expect(subRecord(s, 1, 'p1')).toMatchObject({
      task: { detail: 'audit page speed\nRun lighthouse.' },
      tools: [],
    });
    expect(subRecord(s, 1, 'nope')).toBeUndefined();
  });

  test('an agentToolsClear leaves sub records of background spawns alone', () => {
    const s = run([
      ...base,
      [
        2,
        { type: 'subagentToolStart', id: 1, parentToolId: 'p1', toolId: 's1', status: 'Reading a' },
      ],
      [3, { type: 'agentToolsClear', id: 1 }],
    ]);
    expect(subRecord(s, 1, 'p1')).toBeDefined();
  });
});

describe('stateLine and helpers', () => {
  const at = (s: InspectState, id: number, now: number) => stateLine(s[id], now);

  test('working, waiting, finished, left', () => {
    let s = run([
      [0, created(1)],
      [1000, start(1, 't1', 'Reading a')],
    ]);
    expect(at(s, 1, 1000 + 3 * 60_000)).toBe('Working · 3 min');
    s = run([[2000, { type: 'agentToolPermission', id: 1 }]], s);
    expect(at(s, 1, 2000 + 40_000)).toBe('Waiting for you · 40 s');
    s = run([[3000, { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true }]], s);
    expect(at(s, 1, 3000 + 5000)).toBe('Waiting for you · 5 s');
    s = run([[4000, { type: 'agentStatus', id: 1, status: 'waiting' }]], s);
    expect(at(s, 1, 4000 + 2 * 60_000)).toBe('Finished its turn · idle 2 min');
    s = run([[5000, { type: 'agentClosed', id: 1 }]], s);
    expect(at(s, 1, 9000)).toBe('Left the hall');
  });

  test('a fresh arrival', () => {
    const s = run([[0, created(1)]]);
    expect(at(s, 1, 4000)).toBe('Arrived · 4 s');
  });

  test('durationText', () => {
    expect(durationText(0)).toBe('0 s');
    expect(durationText(59_999)).toBe('59 s');
    expect(durationText(60_000)).toBe('1 min');
    expect(durationText(119_000)).toBe('1 min');
    expect(durationText(3_600_000)).toBe('1 h');
    expect(durationText(5_400_000)).toBe('1 h 30 min');
    expect(durationText(-5)).toBe('0 s');
  });

  test('peekText joins title and status and cuts near 60 characters', () => {
    expect(peekText('Astronomer', 'Reading a.ts')).toBe('Astronomer · Reading a.ts');
    expect(peekText('Astronomer', null)).toBe('Astronomer');
    const long = peekText('Astronomer', 'Running: ' + 'x'.repeat(100));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
  });
});
