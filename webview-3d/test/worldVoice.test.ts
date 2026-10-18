import { describe, expect, test } from 'vitest';

import type { FeedEntry } from '../src/board/feed.js';
import { worldVoice } from '../src/board/worldVoice.js';

const entry = (text: string, tone: FeedEntry['tone'] = 'info'): FeedEntry => ({
  id: 1,
  at: 0,
  text,
  tone,
});

describe('worldVoice (House of Wisdom)', () => {
  const A = 'Astronomer';
  test.each([
    [`${A} needs your approval`, `${A} requests your seal`],
    [
      `Yahya (apprentice to ${A}) needs your approval`,
      `Yahya, apprentice to ${A}, requests your seal`,
    ],
    [`${A} joined`, `${A} takes a seat in the hall`],
    [`${A} delegated: audit page speed`, `${A} sends an apprentice: audit page speed`],
    [`Yahya (apprentice to ${A}) returned`, `Yahya, apprentice to ${A}, returns`],
    [`${A} can continue`, `${A} may proceed`],
    [`${A} is waiting for you`, `${A} awaits your word`],
    [`${A} finished`, `${A} completes the work`],
    [`${A} left`, `${A} departs the hall`],
    [`${A} delegated: rejoin joined`, `${A} sends an apprentice: rejoin joined`],
    [
      `${A} delegated: ask who needs your approval`,
      `${A} sends an apprentice: ask who needs your approval`,
    ],
    ['Geometer II joined', 'Geometer II takes a seat in the hall'],
  ])('%s', (plain, voiced) => {
    expect(worldVoice(entry(plain), 'house-of-wisdom')).toBe(voiced);
  });

  test('unrecognised text and other worlds keep the plain wording', () => {
    expect(worldVoice(entry('something else'), 'house-of-wisdom')).toBe('something else');
    expect(worldVoice(entry('x joined'), 'other-world')).toBe('x joined');
  });
});
