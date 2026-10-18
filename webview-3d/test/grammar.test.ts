import { describe, expect, test } from 'vitest';

import { createCharacter } from '../../webview-ui/src/office/engine/characters.js';
import { CharacterState } from '../../webview-ui/src/office/types.js';
import { bubbleStackLevels } from '../src/grammar/bubble.js';
import { agentTag, subagentTag } from '../src/grammar/label.js';
import { toolKind } from '../src/grammar/toolKind.js';
import {
  contextRatio,
  countCharacters,
  gaugeColor,
  toVisualState,
  visualSignature,
} from '../src/grammar/visualState.js';

describe('toolKind', () => {
  test.each([
    ['Read', 'read'],
    ['Write', 'write'],
    ['Edit', 'write'],
    ['MultiEdit', 'write'],
    ['Bash', 'run'],
    ['Grep', 'search'],
    ['Glob', 'search'],
    ['WebFetch', 'web'],
    ['WebSearch', 'web'],
    ['Task', 'delegate'],
    ['Agent', 'delegate'],
    ['mcp__notion__search', 'other'],
  ])('%s → %s', (name, kind) => {
    expect(toolKind(name)).toBe(kind);
  });

  test('no tool → null', () => {
    expect(toolKind(null)).toBeNull();
    expect(toolKind(undefined)).toBeNull();
    expect(toolKind('')).toBeNull();
  });
});

describe('toVisualState', () => {
  test('an active typing agent reading a file', () => {
    const ch = createCharacter(1, 0, null, null, 0);
    ch.state = CharacterState.TYPE;
    ch.isActive = true;
    ch.currentTool = 'Read';
    expect(toVisualState(ch)).toEqual({
      pose: 'work',
      toolKind: 'read',
      signal: null,
      isSubagent: false,
      effect: null,
      contextRatio: null,
    });
  });

  test('an inactive agent shows no tool even if one is remembered', () => {
    const ch = createCharacter(2, 0, null, null, 0);
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.currentTool = 'Bash';
    expect(toVisualState(ch).toolKind).toBeNull();
    expect(toVisualState(ch).pose).toBe('idle');
  });

  test('walking subagent awaiting permission, spawning', () => {
    const ch = createCharacter(-1, 0, null, null, 0);
    ch.state = CharacterState.WALK;
    ch.isSubagent = true;
    ch.bubbleType = 'permission';
    ch.matrixEffect = 'spawn';
    const v = toVisualState(ch);
    expect(v.pose).toBe('walk');
    expect(v.isSubagent).toBe(true);
    expect(v.signal).toBe('permission');
    expect(v.effect).toBe('spawn');
  });
});

describe('contextRatio', () => {
  test('ratio is clamped to [0, 1]', () => {
    expect(contextRatio({ contextTokens: 50_000, maxContextTokens: 200_000 })).toBe(0.25);
    expect(contextRatio({ contextTokens: 300_000, maxContextTokens: 200_000 })).toBe(1);
  });
  test('unknown window or no usage yet → null', () => {
    expect(contextRatio({ contextTokens: 10, maxContextTokens: 0 })).toBeNull();
    expect(contextRatio({ contextTokens: 0, maxContextTokens: 200_000 })).toBeNull();
  });
});

describe('visualSignature', () => {
  test('changes when the signal changes, ignores tiny context moves', () => {
    const base = {
      pose: 'work' as const,
      toolKind: 'read' as const,
      signal: null,
      isSubagent: false,
      effect: null,
      contextRatio: 0.5,
    };
    expect(visualSignature(base)).not.toBe(visualSignature({ ...base, signal: 'permission' }));
    expect(visualSignature(base)).toBe(visualSignature({ ...base, contextRatio: 0.51 }));
  });
});

describe('gaugeColor', () => {
  test('green, amber, red bands', () => {
    expect(gaugeColor(0.3)).toBe('#3da35d');
    expect(gaugeColor(0.7)).toBe('#e0a458');
    expect(gaugeColor(0.9)).toBe('#d64545');
  });
});

describe('countCharacters', () => {
  test('counts agents, subagents and approvals separately', () => {
    const a = createCharacter(1, 0, null, null, 0);
    const b = createCharacter(2, 0, null, null, 0);
    b.bubbleType = 'permission';
    const s = createCharacter(-1, 0, null, null, 0);
    s.isSubagent = true;
    s.parentAgentId = 2;
    s.bubbleType = 'permission'; // mirrors the parent's approval: not counted again
    expect(countCharacters([a, b, s])).toEqual({ agents: 2, subagents: 1, needsYou: 1 });
  });

  test('a background subagent approval counts when its parent has none', () => {
    const parent = createCharacter(1, 0, null, null, 0);
    const sub = createCharacter(-1, 0, null, null, 0);
    sub.isSubagent = true;
    sub.parentAgentId = 1;
    sub.bubbleType = 'permission';
    expect(countCharacters([parent, sub])).toEqual({ agents: 1, subagents: 1, needsYou: 1 });
  });

  test('parent and subagent both waiting count once; two subagents of one parent count once', () => {
    const parent = createCharacter(1, 0, null, null, 0);
    parent.bubbleType = 'permission';
    const mk = (id: number) => {
      const c = createCharacter(id, 0, null, null, 0);
      c.isSubagent = true;
      c.parentAgentId = 1;
      c.bubbleType = 'permission';
      return c;
    };
    expect(countCharacters([parent, mk(-1), mk(-2)]).needsYou).toBe(1);
    const lone = createCharacter(2, 0, null, null, 0);
    expect(countCharacters([lone, mk(-3), mk(-4)]).needsYou).toBe(1);
  });
});

describe('bubbleStackLevels', () => {
  test('bubbles within one tile stack in mount order; distant ones stay level 0', () => {
    const levels = bubbleStackLevels([
      { key: 'a', seq: 1, x: 5, z: 5 },
      { key: 'b', seq: 2, x: 5.6, z: 5 },
      { key: 'c', seq: 3, x: 5.2, z: 5.4 },
      { key: 'far', seq: 4, x: 12, z: 5 },
    ]);
    expect(levels.get('a')).toBe(0);
    expect(levels.get('b')).toBe(1);
    expect(levels.get('c')).toBe(2);
    expect(levels.get('far')).toBe(0);
  });

  test('exactly one tile apart still stacks; beyond does not', () => {
    const levels = bubbleStackLevels([
      { key: 'a', seq: 1, x: 0, z: 0 },
      { key: 'b', seq: 2, x: 1, z: 0 },
      { key: 'c', seq: 3, x: 0, z: 0.99 },
      { key: 'd', seq: 4, x: 0, z: -1.01 },
    ]);
    expect(levels.get('b')).toBe(1);
    expect(levels.get('c')).toBe(1); // within 1 tile of a only
    expect(levels.get('d')).toBe(0);
  });
});

describe('name tags', () => {
  test('agent: title primary, folder secondary when known', () => {
    expect(agentTag('Astronomer', 'ledger-api')).toEqual({
      name: 'Astronomer',
      detail: 'ledger-api',
    });
    expect(agentTag('Astronomer')).toEqual({ name: 'Astronomer', detail: null });
  });

  test('the session label is capped at 18 characters with an ellipsis', () => {
    expect(agentTag('Astronomer', 'brain setup').detail).toBe('brain setup');
    const long = agentTag('Astronomer', 'jservo-agent-office-extra').detail!;
    expect(long).toHaveLength(18);
    expect(long.endsWith('\u2026')).toBe(true);
    expect(agentTag('Astronomer', 'Brain setup session notes').detail).toBe('Brain setup\u2026');
  });

  test('subagent: "Yahya · apprentice"', () => {
    expect(subagentTag('Yahya', 'apprentice')).toEqual({
      name: 'Yahya · apprentice',
      detail: null,
    });
  });
});
