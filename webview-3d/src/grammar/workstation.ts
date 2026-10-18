import type { Character, Seat } from '../../../webview-ui/src/office/types.js';
import { Direction } from '../../../webview-ui/src/office/types.js';
import type { Vec3 } from '../scene/coords.js';

const LAMP_HEIGHT = 0.75;

const DELTA: Record<Direction, [number, number]> = {
  [Direction.DOWN]: [0, 1],
  [Direction.UP]: [0, -1],
  [Direction.LEFT]: [-1, 0],
  [Direction.RIGHT]: [1, 0],
};

/** Seats whose agent is actively working (spec §4: a workstation is lit while its agent is). */
export function litSeatIds(chars: Character[]): Set<string> {
  const lit = new Set<string>();
  for (const ch of chars) {
    if (!ch.isSubagent && ch.isActive && ch.seatId) lit.add(ch.seatId);
  }
  return lit;
}

/** Centre of the desk tile one step in front of the seat. */
export function lampPosition(seat: Seat): Vec3 {
  const [dx, dy] = DELTA[seat.facingDir];
  return [seat.seatCol + 0.5 + dx, LAMP_HEIGHT, seat.seatRow + 0.5 + dy];
}
