import { expect, test } from 'vitest';

import { TILE_SIZE } from '../../webview-ui/src/constants.js';
import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';

test('upstream engine is importable from webview-3d', () => {
  expect(TILE_SIZE).toBe(16);
  const os = new OfficeState();
  expect(os.characters.size).toBe(0);
});
