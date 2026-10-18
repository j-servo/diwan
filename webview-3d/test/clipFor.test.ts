import { describe, expect, it } from 'vitest';

import { clipFor } from '../src/agents/clipFor.js';
import type { VisualState } from '../src/grammar/visualState.js';
import type { ToolKind } from '../src/grammar/toolKind.js';

const v = (o: Partial<VisualState>): VisualState => ({
  pose: 'idle',
  toolKind: null,
  signal: null,
  isSubagent: false,
  effect: null,
  contextRatio: null,
  ...o,
});

describe('clipFor', () => {
  it.each<[ToolKind, string, string | null]>([
    ['read', 'read', 'prop_codex'],
    ['write', 'write', 'prop_reed_pen'],
    ['run', 'astrolabe', 'prop_astrolabe'],
    ['search', 'scroll_search', 'prop_scroll'],
    ['web', 'receive_letter', 'prop_letter'],
    ['delegate', 'gesture_beckon', null],
    ['other', 'sit_idle', null],
  ])('work + %s', (toolKind, clip, prop) => {
    expect(clipFor(v({ pose: 'work', toolKind }))).toEqual({ clip, prop });
  });

  it('work without a tool sits idle', () => {
    expect(clipFor(v({ pose: 'work' }))).toEqual({ clip: 'sit_idle', prop: null });
  });
  it('walk wins, even with a tool or signal', () => {
    expect(clipFor(v({ pose: 'walk', toolKind: 'read', signal: 'waiting' }))).toEqual({
      clip: 'walk',
      prop: null,
    });
  });
  it('waiting looks up', () => {
    expect(clipFor(v({ signal: 'waiting' }))).toEqual({ clip: 'look_up', prop: null });
  });
  it('permission beckons, even while working', () => {
    expect(clipFor(v({ pose: 'work', toolKind: 'read', signal: 'permission' }))).toEqual({
      clip: 'gesture_beckon',
      prop: null,
    });
  });
  it('idle standing vs seated', () => {
    expect(clipFor(v({}))).toEqual({ clip: 'idle', prop: null });
    expect(clipFor(v({}), true)).toEqual({ clip: 'sit_idle', prop: null });
  });
});
