import { TILE_SIZE } from '../../../webview-ui/src/constants.js';
import { Direction } from '../../../webview-ui/src/office/types.js';

export type Vec3 = [number, number, number];

/** Engine pixels (tile centre = col*16+8) → world units (1 unit = 1 tile, Y up). */
export function pixelToWorld(x: number, y: number, height = 0): Vec3 {
  return [x / TILE_SIZE, height, y / TILE_SIZE];
}

export function footprintCenter(col: number, row: number, w: number, h: number): Vec3 {
  return [col + w / 2, 0, row + h / 2];
}

const ROTATION_BY_DIRECTION: Record<Direction, number> = {
  [Direction.DOWN]: 0,
  [Direction.RIGHT]: Math.PI / 2,
  [Direction.UP]: Math.PI,
  [Direction.LEFT]: -Math.PI / 2,
};

/** Models face +Z at rotation 0; screen "down" (row increasing) is +Z. */
export function directionToRotationY(dir: Direction): number {
  return ROTATION_BY_DIRECTION[dir];
}
