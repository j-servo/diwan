import { describe, expect, test } from 'vitest';

import { createCharacter } from '../../webview-ui/src/office/engine/characters.js';
import type { Seat } from '../../webview-ui/src/office/types.js';
import { Direction } from '../../webview-ui/src/office/types.js';
import { lampPosition, litSeatIds } from '../src/grammar/workstation.js';

function agent(id: number, seatId: string | null, active: boolean, subagent = false) {
  const ch = createCharacter(id, 0, seatId, null, 0);
  ch.isActive = active;
  ch.isSubagent = subagent;
  return ch;
}

describe('litSeatIds', () => {
  test('lights the seats of active, seated, non-subagent characters', () => {
    expect([...litSeatIds([agent(1, 'a', true), agent(2, 'b', true)])].sort()).toEqual(['a', 'b']);
  });
  test('skips subagents, inactive agents and agents without a seat', () => {
    const lit = litSeatIds([
      agent(1, 'a', true, true),
      agent(2, 'b', false),
      agent(3, null, true),
      agent(4, 'c', true),
    ]);
    expect([...lit]).toEqual(['c']);
  });
});

describe('lampPosition', () => {
  const seat = (facingDir: Direction): Seat => ({
    uid: 's',
    seatCol: 4,
    seatRow: 6,
    facingDir,
    assigned: true,
  });
  test.each([
    [Direction.DOWN, [4.5, 0.75, 7.5]],
    [Direction.UP, [4.5, 0.75, 5.5]],
    [Direction.LEFT, [3.5, 0.75, 6.5]],
    [Direction.RIGHT, [5.5, 0.75, 6.5]],
  ])('direction %s puts the lamp on the desk tile in front', (dir, expected) => {
    expect(lampPosition(seat(dir))).toEqual(expected);
  });
});
