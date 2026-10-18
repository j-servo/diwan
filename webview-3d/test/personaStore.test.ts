import { describe, expect, test } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { PersonaStore } from '../src/agents/personaStore.js';
import { houseOfWisdomGreybox } from '../src/worlds/houseOfWisdom/greybox.js';

const roster = houseOfWisdomGreybox.personas;
const make = () => new PersonaStore(roster);

describe('PersonaStore', () => {
  test('agentCreated assigns a stable title and keeps the folder', () => {
    const s = make();
    const view = s.handle({ type: 'agentCreated', id: 1, folderName: 'ledger-api' });
    const a = view.agent(1);
    expect(roster.titles).toContain(a.title);
    expect(a.folder).toBe('ledger-api');
    expect(s.handle({ type: 'agentToolPermission', id: 1 }).agent(1).title).toBe(a.title);
  });

  test('no folder: title only, still assigned', () => {
    const s = make();
    const a = s.handle({ type: 'agentCreated', id: 7 }).agent(7);
    expect(roster.titles).toContain(a.title);
    expect(a.folder).toBeUndefined();
  });

  test('simultaneous agents never share a title', () => {
    const s = make();
    const titles = new Set<string>();
    for (let id = 1; id <= 12; id++) {
      titles.add(s.handle({ type: 'agentCreated', id, folderName: 'same' }).agent(id).title);
    }
    expect(titles.size).toBe(12);
  });

  test('existingAgents assigns every listed agent with its folder', () => {
    const s = make();
    const view = s.handle({
      type: 'existingAgents',
      agents: [5, 6],
      agentMeta: {},
      folderNames: { '5': 'orchard-site' },
      externalAgents: {},
    } as ServerMessage);
    expect(view.agent(5).folder).toBe('orchard-site');
    expect(view.agent(6).title).not.toBe(view.agent(5).title);
  });

  test('agentClosed: the closing message still sees the title, then it is released', () => {
    const s = make();
    const title = s.handle({ type: 'agentCreated', id: 1, folderName: 'x' }).agent(1).title;
    const closing = s.handle({ type: 'agentClosed', id: 1 });
    expect(closing.agent(1).title).toBe(title);
    // a new agent with the same key gets the freed title back
    expect(s.handle({ type: 'agentCreated', id: 2, folderName: 'x' }).agent(2).title).toBe(title);
  });

  test('apprentices are named per parent tool and released on subagentClear', () => {
    const s = make();
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' });
    const v = s.handle({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 't1',
      toolId: 's1',
      toolName: 'Read',
      status: 'Reading',
    } as ServerMessage);
    const name = v.apprentice(1, 't1');
    expect(roster.apprentices).toContain(name);
    const v2 = s.handle({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 't2',
      toolId: 's2',
      toolName: 'Read',
      status: 'Reading',
    } as ServerMessage);
    expect(v2.apprentice(1, 't2')).not.toBe(name);
    expect(v2.apprentice(1, 't1')).toBe(name);
    const cleared = s.handle({ type: 'subagentClear', id: 1, parentToolId: 't1' });
    expect(cleared.apprentice(1, 't1')).toBe(name); // still named for its "returned" entry
    const after = s.handle({
      type: 'subagentToolStart',
      id: 1,
      parentToolId: 't3',
      toolId: 's3',
      toolName: 'Read',
      status: 'Reading',
    } as ServerMessage);
    expect(after.apprentice(1, 't3')).not.toBe(after.apprentice(1, 't2'));
  });

  test('agentClosed releases that agent apprentices', () => {
    const s = new PersonaStore({ ...roster, apprentices: ['Yahya'] });
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' });
    expect(s.apprentice(1, 't1')).toBe('Yahya');
    s.handle({ type: 'agentClosed', id: 1 });
    s.handle({ type: 'agentCreated', id: 2, folderName: 'x' });
    expect(s.apprentice(2, 't1')).toBe('Yahya');
  });

  test('render-time lookups never insert', () => {
    const s = make();
    const a = s.titleOf(3);
    expect(roster.titles).toContain(a.title);
    s.titleOf(4);
    // nothing was held, so a real agent with id 3's key still gets the base title
    expect(s.handle({ type: 'agentCreated', id: 9, folderName: 'k' }).agent(9).title).toBe(
      make().handle({ type: 'agentCreated', id: 9, folderName: 'k' }).agent(9).title,
    );
  });

  test('closed agent looked up at render, then same-folder agent gets the base title', () => {
    const s = make();
    const base = s.handle({ type: 'agentCreated', id: 1, folderName: 'x' }).agent(1).title;
    s.handle({ type: 'agentClosed', id: 1 });
    s.titleOf(1, 'x'); // the despawning figure re-renders
    expect(s.handle({ type: 'agentCreated', id: 1001, folderName: 'x' }).agent(1001).title).toBe(
      base,
    );
  });

  test('cleared apprentice looked up at render does not hold its name', () => {
    const s = new PersonaStore({ ...roster, apprentices: ['Yahya'] });
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' });
    s.handle({ type: 'subagentToolStart', id: 1, parentToolId: 't1' } as ServerMessage);
    s.handle({ type: 'subagentClear', id: 1, parentToolId: 't1' });
    s.apprenticeOf(1, 't1');
    s.handle({ type: 'subagentToolStart', id: 1, parentToolId: 't2' } as ServerMessage);
    expect(s.apprenticeOf(1, 't2')).toBe('Yahya');
  });

  test('late agentToolsClear after close does not re-add', () => {
    const s = make();
    const base = s.handle({ type: 'agentCreated', id: 1, folderName: 'x' }).agent(1).title;
    s.handle({ type: 'agentClosed', id: 1 });
    s.handle({ type: 'agentToolsClear', id: 1 } as ServerMessage);
    expect(s.handle({ type: 'agentCreated', id: 2, folderName: 'x' }).agent(2).title).toBe(base);
  });

  test('late subagent start for a closed agent does not insert a ghost apprentice', () => {
    const s = new PersonaStore({ ...roster, apprentices: ['Yahya'] });
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' });
    s.handle({ type: 'agentClosed', id: 1 });
    s.handle({ type: 'subagentToolStart', id: 1, parentToolId: 'tz' } as ServerMessage);
    s.handle({ type: 'subagentToolPermission', id: 1, parentToolId: 'ty' } as ServerMessage);
    s.handle({ type: 'agentCreated', id: 2, folderName: 'x' });
    s.handle({ type: 'subagentToolStart', id: 2, parentToolId: 'a' } as ServerMessage);
    expect(s.apprenticeOf(2, 'a')).toBe('Yahya'); // no ghost holds the only name
  });

  test('id and tool id reuse: a re-announced agent gets live apprentices again', () => {
    const s = new PersonaStore({ ...roster, apprentices: ['Yahya'] });
    const start = (id: number, t: string) =>
      s.handle({ type: 'subagentToolStart', id, parentToolId: t } as ServerMessage);
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' });
    start(1, 't6');
    s.handle({ type: 'subagentClear', id: 1, parentToolId: 't6' });
    s.handle({ type: 'agentClosed', id: 1 });
    s.handle({ type: 'agentCreated', id: 1, folderName: 'x' }); // same id, next loop
    start(1, 't6');
    expect(s.apprenticeOf(1, 't6')).toBe('Yahya');
    // it is genuinely held: another apprentice cannot share the name
    s.handle({ type: 'agentCreated', id: 2, folderName: 'y' });
    start(2, 'a');
    expect(s.apprenticeOf(2, 'a')).toBe('Yahya II');
  });
});
