import { describe, expect, test } from 'vitest';

import { BUBBLE_TEXT_MAX, bubbleContent, bubbleStyle, shortStatus } from '../src/grammar/bubble.js';
import { KIND_COLORS } from '../src/grammar/kindColors.js';
import type { ToolKind } from '../src/grammar/toolKind.js';
import type { VisualState } from '../src/grammar/visualState.js';

const base: VisualState = {
  pose: 'work',
  toolKind: 'read',
  signal: null,
  isSubagent: false,
  effect: null,
  contextRatio: null,
};

test('working: activity text with the three-dot busy indicator', () => {
  expect(bubbleContent(base, 'Reading src/app.ts')).toEqual({
    tone: 'working',
    text: 'Reading src/app.ts',
    showDots: true,
    toolKind: 'read',
  });
  expect(bubbleContent(base, null)).toEqual({
    tone: 'working',
    text: 'Working',
    showDots: true,
    toolKind: 'read',
  });
});

test('approval outranks work; waiting shows a calm done message', () => {
  expect(bubbleContent({ ...base, signal: 'permission' }, 'Running rm -rf build')).toEqual({
    tone: 'approval',
    text: 'Needs your approval',
    showDots: false,
  });
  expect(bubbleContent({ ...base, toolKind: null, signal: 'waiting' }, null)).toEqual({
    tone: 'waiting',
    text: 'Done, waiting for you',
    showDots: false,
  });
});

test('idle agents show no bubble', () => {
  expect(bubbleContent({ ...base, pose: 'idle', toolKind: null }, null)).toBeNull();
});

test.each(['read', 'write', 'run', 'search', 'web', 'delegate'] as ToolKind[])(
  'working bubble border colour comes from KIND_COLORS (%s)',
  (toolKind) => {
    const b = bubbleContent({ ...base, toolKind }, 'x')!;
    expect(bubbleStyle(b)).toEqual({ '--kind': KIND_COLORS[toolKind] });
  },
);

test('approval and waiting bubbles carry no tool colour', () => {
  expect(bubbleStyle(bubbleContent({ ...base, signal: 'permission' }, null)!)).toBeUndefined();
  expect(
    bubbleStyle(bubbleContent({ ...base, toolKind: null, signal: 'waiting' }, null)!),
  ).toBeUndefined();
});

describe('working bubble text', () => {
  test('short statuses pass through unchanged', () => {
    expect(shortStatus('Reading hall.py')).toBe('Reading hall.py');
    expect(shortStatus('Searching code')).toBe('Searching code');
  });

  test('long statuses are cut to the cap with an ellipsis', () => {
    const out = shortStatus('Running: python3 -c "import os; print(os.getcwd())"');
    expect(out).toHaveLength(BUBBLE_TEXT_MAX);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(out.startsWith('Running: python3')).toBe(true);
    expect(shortStatus('Searching "invoice number lookup"')).toHaveLength(BUBBLE_TEXT_MAX);
  });

  test('a multi-line heredoc shows only its first line', () => {
    expect(shortStatus('Running: cat <<EOF\nline two\nline three')).toBe(
      'Running: cat <<EOF\u2026',
    );
    expect(shortStatus('Running: \n echo hi')).toBe('Running:\u2026');
  });

  test('no trailing space before the ellipsis, and exactly the cap is kept whole', () => {
    expect(shortStatus('a'.repeat(BUBBLE_TEXT_MAX))).toBe('a'.repeat(BUBBLE_TEXT_MAX));
    expect(shortStatus('Running: python3 -c   import os, sys')).not.toMatch(/ \u2026$/);
  });

  test('the bubble carries the shortened text; empty falls back to Working', () => {
    expect(bubbleContent(base, 'Running: python3 -c "print(1)" && ls')!.text).toHaveLength(
      BUBBLE_TEXT_MAX,
    );
    expect(bubbleContent(base, '   ')!.text).toBe('Working');
  });
});
