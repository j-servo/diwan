import { expect, test } from 'vitest';

import type { OfficeLayout } from '../../webview-ui/src/office/types.js';
import { latestStatus } from '../src/grammar/label.js';
import { splitTiles } from '../src/scene/tiles.js';

test('latestStatus picks the newest unfinished tool', () => {
  expect(
    latestStatus([
      { toolId: 'a', status: 'Reading a.ts', done: true },
      { toolId: 'b', status: 'Editing a.ts', done: false },
      { toolId: 'c', status: 'Running npm test', done: true },
    ]),
  ).toBe('Editing a.ts');
  expect(latestStatus([])).toBeNull();
  expect(latestStatus(undefined)).toBeNull();
});

test('splitTiles separates walls from floor and skips void', () => {
  const layout = {
    version: 1,
    cols: 3,
    rows: 1,
    tiles: [0, 1, 255],
    furniture: [],
  } as OfficeLayout;
  expect(splitTiles(layout)).toEqual({ walls: [{ col: 0, row: 0 }], floor: [{ col: 1, row: 0 }] });
});
