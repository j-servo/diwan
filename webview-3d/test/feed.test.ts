// webview-3d/test/feed.test.ts
import { describe, expect, test } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { PersonaStore } from '../src/agents/personaStore.js';
import type { PersonaRoster } from '../src/worlds/personas.js';
import { EMPTY_FEED, FEED_LIMIT, feedReducer } from '../src/board/feed.js';

const ROSTER: PersonaRoster = {
  titles: ['Astronomer'],
  apprentices: ['Yahya'],
  nouns: { agent: 'scholar', agents: 'scholars', subagent: 'apprentice', subagents: 'apprentices' },
};
const A = 'Astronomer';
const SUB = 'Yahya (apprentice to Astronomer)';

const run = (msgs: ServerMessage[]) => {
  const store = new PersonaStore(ROSTER);
  return msgs.reduce((s, m, i) => feedReducer(s, m, 1000 + i, store.handle(m)), EMPTY_FEED);
};
const texts = (msgs: ServerMessage[]) => run(msgs).entries.map((e) => e.text);

describe('feedReducer', () => {
  test('joins, delegation, approval, finish and leave, newest first', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'ledger-api' },
        {
          type: 'agentToolStart',
          id: 1,
          toolId: 't1',
          toolName: 'Agent',
          status: 'Subtask: audit page speed',
        },
        { type: 'agentToolPermission', id: 1 },
        { type: 'agentToolPermissionClear', id: 1 },
        { type: 'subagentClear', id: 1, parentToolId: 't1' },
        { type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true },
        { type: 'agentClosed', id: 1 },
      ]),
    ).toEqual([
      `${A} left`,
      `${A} is waiting for you`,
      `${SUB} returned`,
      `${A} can continue`,
      `${A} needs your approval`,
      `${A} delegated: audit page speed`,
      `${A} joined`,
    ]);
  });

  test('hooks mode: the next tool event without permissionActive means can continue', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'agentToolPermission', id: 1 },
        { type: 'agentToolStart', id: 1, toolId: 'a', toolName: 'Read', status: 'Reading y.ts' },
        {
          type: 'agentToolStart',
          id: 1,
          toolId: 'b',
          toolName: 'Agent',
          status: 'Subtask: audit',
        },
      ]),
    ).toEqual([
      `${A} delegated: audit`,
      `${A} can continue`,
      `${A} needs your approval`,
      `${A} joined`,
    ]);
  });

  test('a tool start that still has permissionActive does not clear the approval', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'agentToolPermission', id: 1 },
        {
          type: 'agentToolStart',
          id: 1,
          toolId: 'a',
          toolName: 'Bash',
          status: 'Running ls',
          permissionActive: true,
        },
      ]),
    ).toEqual([`${A} needs your approval`, `${A} joined`]);
  });

  test('can continue comes before the clearing message own entry', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'agentToolPermission', id: 1 },
        { type: 'agentStatus', id: 1, status: 'waiting' },
      ]),
    ).toEqual([`${A} finished`, `${A} can continue`, `${A} needs your approval`, `${A} joined`]);
  });

  test('a subagent permission while the parent is pending adds no entry', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'agentToolPermission', id: 1 },
        { type: 'subagentToolPermission', id: 1, parentToolId: 't' },
      ]),
    ).toEqual([`${A} needs your approval`, `${A} joined`]);
  });

  test('a subagent permission alone is announced and can be cleared', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'subagentToolPermission', id: 1, parentToolId: 't' },
        { type: 'agentToolDone', id: 1, toolId: 't' },
      ]),
    ).toEqual([`${A} can continue`, `${SUB} needs your approval`, `${A} joined`]);
  });

  test('a clear for a non-pending id pushes nothing', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'agentToolPermissionClear', id: 1 },
        { type: 'agentToolDone', id: 1, toolId: 'a' },
        { type: 'agentToolsClear', id: 1 },
      ]),
    ).toEqual([`${A} joined`]);
  });

  test('agentClosed drops a pending approval without a can-continue entry', () => {
    const s = run([
      { type: 'agentCreated', id: 1, folderName: 'x' },
      { type: 'agentToolPermission', id: 1 },
      { type: 'agentClosed', id: 1 },
    ]);
    expect(s.entries.map((e) => e.text)).toEqual([
      `${A} left`,
      `${A} needs your approval`,
      `${A} joined`,
    ]);
    expect(s.pendingApproval).toEqual([]);
  });

  test('routine reads and edits stay off the board', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 2, folderName: 'caravan-bookings' },
        { type: 'agentToolStart', id: 2, toolId: 'a', toolName: 'Read', status: 'Reading x.ts' },
        { type: 'agentToolStart', id: 2, toolId: 'b', toolName: 'Edit', status: 'Editing x.ts' },
      ]),
    ).toEqual([`${A} joined`]);
  });

  test('tones mark approvals and completions', () => {
    const s = run([
      { type: 'agentCreated', id: 3 },
      { type: 'agentToolPermission', id: 3 },
      { type: 'agentStatus', id: 3, status: 'waiting' },
    ]);
    expect(s.entries.map((e) => e.tone)).toEqual(['done', 'info', 'approval', 'info']);
    expect(s.entries[3].text).toBe(`${A} joined`);
    expect(s.entries[0].text).toBe(`${A} finished`);
  });

  test('agents from existingAgents reconnect are named, not numbered', () => {
    expect(
      texts([
        {
          type: 'existingAgents',
          agents: [5],
          agentMeta: {},
          folderNames: { '5': 'orchard-site' },
          externalAgents: {},
        },
        { type: 'agentToolPermission', id: 5 },
      ]),
    ).toEqual([`${A} needs your approval`]);
  });

  test('an identical consecutive entry is not repeated', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 4, folderName: 'x' },
        { type: 'agentToolPermission', id: 4 },
        { type: 'agentToolPermission', id: 4 },
      ]),
    ).toEqual([`${A} needs your approval`, `${A} joined`]);
  });

  test('keeps at most FEED_LIMIT entries', () => {
    const many: ServerMessage[] = [];
    for (let id = 1; id <= FEED_LIMIT + 10; id++) many.push({ type: 'agentCreated', id });
    const s = run(many);
    expect(s.entries).toHaveLength(FEED_LIMIT);
    expect(s.entries[0].text).toMatch(/^Astronomer .+ joined$/);
  });

  test('a background subagent approval is cleared by subagentToolDone', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'subagentToolPermission', id: 1, parentToolId: 't' },
        { type: 'subagentToolDone', id: 1, parentToolId: 't', toolId: 's' },
      ]),
    ).toEqual([`${A} can continue`, `${SUB} needs your approval`, `${A} joined`]);
  });

  test('a background subagent approval is cleared by subagentClear, before the returned entry', () => {
    expect(
      texts([
        { type: 'agentCreated', id: 1, folderName: 'x' },
        { type: 'subagentToolPermission', id: 1, parentToolId: 't' },
        { type: 'subagentClear', id: 1, parentToolId: 't' },
      ]),
    ).toEqual([
      `${SUB} returned`,
      `${A} can continue`,
      `${SUB} needs your approval`,
      `${A} joined`,
    ]);
  });
});
