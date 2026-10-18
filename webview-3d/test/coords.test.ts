import { expect, test } from 'vitest';

import { Direction } from '../../webview-ui/src/office/types.js';
import { directionToRotationY, footprintCenter, pixelToWorld } from '../src/scene/coords.js';

test('pixel tile centre maps to world tile centre', () => {
  expect(pixelToWorld(3 * 16 + 8, 5 * 16 + 8)).toEqual([3.5, 0, 5.5]);
  expect(pixelToWorld(8, 8, 2)).toEqual([0.5, 2, 0.5]);
});

test('footprint centre', () => {
  expect(footprintCenter(2, 1, 2, 1)).toEqual([3, 0, 1.5]);
});

test('facing directions map to Y rotations (model faces +Z at 0)', () => {
  expect(directionToRotationY(Direction.DOWN)).toBe(0);
  expect(directionToRotationY(Direction.RIGHT)).toBeCloseTo(Math.PI / 2);
  expect(directionToRotationY(Direction.UP)).toBeCloseTo(Math.PI);
  expect(directionToRotationY(Direction.LEFT)).toBeCloseTo(-Math.PI / 2);
});
