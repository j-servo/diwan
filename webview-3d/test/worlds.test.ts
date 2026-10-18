import { beforeAll, describe, expect, test } from 'vitest';

import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import { getCatalogEntry } from '../../webview-ui/src/office/layout/furnitureCatalog.js';
import { installWorldCatalog } from '../src/worlds/catalog.js';
import { houseOfWisdomGreybox } from '../src/worlds/houseOfWisdom/greybox.js';
import { activeWorld, getWorld } from '../src/worlds/registry.js';

beforeAll(() => {
  installWorldCatalog(houseOfWisdomGreybox);
});

function isConnected(tiles: Array<{ col: number; row: number }>): boolean {
  if (tiles.length === 0) return false;
  const all = new Set(tiles.map((t) => `${t.col},${t.row}`));
  const seen = new Set<string>([`${tiles[0].col},${tiles[0].row}`]);
  const queue = [tiles[0]];
  while (queue.length > 0) {
    const { col, row } = queue.shift()!;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const key = `${col + dc},${row + dr}`;
      if (all.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ col: col + dc, row: row + dr });
      }
    }
  }
  return seen.size === all.size;
}

describe('House of Wisdom grey box', () => {
  test('catalog is installed with desks and chairs', () => {
    expect(getCatalogEntry('hw_desk')?.isDesk).toBe(true);
    expect(getCatalogEntry('hw_seat')?.category).toBe('chairs');
  });

  test('floor plan has 12 seats, each next to one connected walkable area', () => {
    const os = new OfficeState(houseOfWisdomGreybox.floorPlan);
    expect(os.seats.size).toBe(12);
    const walkable = new Set(os.walkableTiles.map((t) => `${t.col},${t.row}`));
    // Upstream blocks chair tiles for everyone except the seat's owner
    // (withOwnSeatUnblocked), so a seat is reachable when a neighbour is walkable.
    for (const seat of os.seats.values()) {
      const neighbours = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([dc, dr]) => `${seat.seatCol + dc},${seat.seatRow + dr}`);
      expect(neighbours.some((key) => walkable.has(key))).toBe(true);
    }
    expect(isConnected(os.walkableTiles)).toBe(true);
  });

  test('more agents than seats: everyone appears, 12 are seated', () => {
    const os = new OfficeState(houseOfWisdomGreybox.floorPlan);
    for (let id = 1; id <= 14; id++) os.addAgent(id);
    const chars = [...os.characters.values()];
    expect(chars).toHaveLength(14);
    expect(chars.filter((c) => c.seatId !== null)).toHaveLength(12);
  });

  test('the in-world board is off for now; any board would hang inside the hall', () => {
    expect(houseOfWisdomGreybox.board).toBeNull();
    if (!houseOfWisdomGreybox.board) return;
    const [x, y, z] = houseOfWisdomGreybox.board.position;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(houseOfWisdomGreybox.floorPlan.cols);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
  });
});

describe('registry', () => {
  test('unknown or missing id falls back to the hero world', () => {
    expect(getWorld('nope').id).toBe('house-of-wisdom');
    expect(getWorld(null).id).toBe('house-of-wisdom');
    expect(activeWorld('?world=house-of-wisdom').id).toBe('house-of-wisdom');
    expect(activeWorld('').id).toBe('house-of-wisdom');
  });
});
