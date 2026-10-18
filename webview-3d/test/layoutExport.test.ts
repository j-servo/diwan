import { describe, expect, test } from 'vitest';

import { buildLayout } from '../scripts/export-layout.js';
import { houseOfWisdomGreybox } from '../src/worlds/houseOfWisdom/greybox.js';

const STEP = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] } as const;

describe('buildLayout(houseOfWisdomGreybox)', () => {
  const layout = buildLayout(houseOfWisdomGreybox);

  test('basic grid facts', () => {
    expect(layout.worldId).toBe('house-of-wisdom');
    expect(layout.tileMeters).toBe(1.5);
    expect(layout.cols).toBe(20);
    expect(layout.rows).toBe(14);
    expect(layout.tiles).toHaveLength(20 * 14);
    expect(layout.seats).toHaveLength(12);
    expect(layout.board).toBeNull(); // no in-world board for now (Yousef, 2026-10-15)
  });

  test('furniture carries catalog data', () => {
    const desk = layout.furniture.find((f) => f.type === 'hw_desk')!;
    expect(desk).toMatchObject({ footprintW: 2, footprintH: 1, category: 'desks', isDesk: true });
  });

  test('every seat is orthogonally next to a desk tile, in its facing direction', () => {
    const deskTiles = new Set<string>();
    for (const f of layout.furniture) {
      if (!f.isDesk) continue;
      for (let r = 0; r < f.footprintH; r++)
        for (let c = 0; c < f.footprintW; c++) deskTiles.add(`${f.col + c},${f.row + r}`);
    }
    for (const seat of layout.seats) {
      const [dc, dr] = STEP[seat.facing];
      expect(deskTiles.has(`${seat.col + dc},${seat.row + dr}`), seat.uid).toBe(true);
    }
  });
});
