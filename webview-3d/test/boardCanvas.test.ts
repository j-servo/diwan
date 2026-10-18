import { describe, expect, test } from 'vitest';

import { BOARD_H, BOARD_W, layoutBoardLines } from '../src/board/boardCanvas.js';

// One unit per character keeps wrapping arithmetic obvious.
const measure = (s: string) => s.length;
const opts = { maxWidth: 20, maxLinesPerEntry: 2, lineHeight: 10, top: 5, left: 3, maxLines: 6 };
const e = (text: string, tone: 'info' | 'approval' | 'done' = 'info') => ({ text, tone });

describe('layoutBoardLines', () => {
  test('short entries take one line each, stacked top-down with their tone', () => {
    const lines = layoutBoardLines([e('alpha'), e('beta', 'approval')], measure, opts);
    expect(lines).toEqual([
      { text: 'alpha', tone: 'info', x: 3, y: 5, entry: 0 },
      { text: 'beta', tone: 'approval', x: 3, y: 15, entry: 1 },
    ]);
  });

  test('long text wraps on word boundaries', () => {
    const lines = layoutBoardLines([e('one two three four')], measure, opts);
    expect(lines.map((l) => l.text)).toEqual(['one two three four']); // 18 fits
    const wrapped = layoutBoardLines([e('one two three four five')], measure, opts);
    expect(wrapped.map((l) => l.text)).toEqual(['one two three four', 'five']);
  });

  test('an entry clamps to two lines with an ellipsis, never exceeding maxWidth', () => {
    const lines = layoutBoardLines(
      [e('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj')],
      measure,
      opts,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1].text.endsWith('…')).toBe(true);
    for (const l of lines) expect(measure(l.text)).toBeLessThanOrEqual(opts.maxWidth);
  });

  test('a single unbreakable word longer than the line is truncated', () => {
    const lines = layoutBoardLines([e('x'.repeat(50))], measure, opts);
    expect(lines).toHaveLength(1);
    expect(measure(lines[0].text)).toBeLessThanOrEqual(opts.maxWidth);
    expect(lines[0].text.endsWith('…')).toBe(true);
  });

  test('stops adding entries once the line budget is spent', () => {
    const entries = Array.from({ length: 5 }, () => e('aaaa bbbb cccc dddd eeee ffff gggg hhhh'));
    const lines = layoutBoardLines(entries, measure, opts);
    expect(lines).toHaveLength(6);
    expect(new Set(lines.map((l) => l.entry))).toEqual(new Set([0, 1, 2]));
  });

  test('only the five newest entries are drawn', () => {
    const entries = Array.from({ length: 9 }, (_, i) => e(`n${i}`));
    const lines = layoutBoardLines(entries, measure, { ...opts, maxLines: 20 });
    expect(lines.map((l) => l.text)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
  });

  test('empty feed lays out nothing', () => {
    expect(layoutBoardLines([], measure, opts)).toEqual([]);
  });
});

test('canvas is 1024x512', () => {
  expect([BOARD_W, BOARD_H]).toEqual([1024, 512]);
});
