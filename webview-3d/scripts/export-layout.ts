// Writes assets/worlds/<id>/layout.json: the floor plan is the single source of layout
// for both the renderer and the Blender bake. Run: npx tsx scripts/export-layout.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { layoutToSeats } from '../../webview-ui/src/office/layout/layoutSerializer.js';
import { getCatalogEntry } from '../../webview-ui/src/office/layout/furnitureCatalog.js';
import { Direction } from '../../webview-ui/src/office/types.js';
import { installWorldCatalog } from '../src/worlds/catalog.js';
import { WORLD_DEFINITIONS } from '../src/worlds/definitions.js';
import type { BoardPlacement, WorldDefinition } from '../src/worlds/types.js';

export const TILE_METERS = 1.5;

type Facing = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export interface LayoutManifest {
  worldId: string;
  tileMeters: number;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: Array<{
    uid: string;
    type: string;
    col: number;
    row: number;
    footprintW: number;
    footprintH: number;
    category: string;
    isDesk: boolean;
  }>;
  seats: Array<{ uid: string; col: number; row: number; facing: Facing }>;
  board: BoardPlacement | null;
}

const FACING_NAME: Record<number, Facing> = {
  [Direction.UP]: 'UP',
  [Direction.DOWN]: 'DOWN',
  [Direction.LEFT]: 'LEFT',
  [Direction.RIGHT]: 'RIGHT',
};

export function buildLayout(world: WorldDefinition): LayoutManifest {
  installWorldCatalog(world);
  const { floorPlan } = world;
  const furniture = floorPlan.furniture.map((item) => {
    const entry = getCatalogEntry(item.type);
    if (!entry) throw new Error(`Furniture "${item.uid}" has unknown type "${item.type}"`);
    return {
      uid: item.uid,
      type: item.type,
      col: item.col,
      row: item.row,
      footprintW: entry.footprintW,
      footprintH: entry.footprintH,
      category: entry.category,
      isDesk: entry.isDesk,
    };
  });
  const seats = [...layoutToSeats(floorPlan.furniture).values()].map((s) => ({
    uid: s.uid,
    col: s.seatCol,
    row: s.seatRow,
    facing: FACING_NAME[s.facingDir],
  }));
  return {
    worldId: world.id,
    tileMeters: TILE_METERS,
    cols: floorPlan.cols,
    rows: floorPlan.rows,
    tiles: [...floorPlan.tiles],
    furniture,
    seats,
    board: world.board,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // npx tsx scripts/export-layout.ts [world-id]  (default house-of-wisdom)
  const id = process.argv[2] ?? 'house-of-wisdom';
  const world = WORLD_DEFINITIONS.find((w) => w.id === id);
  if (!world)
    throw new Error(
      `unknown world "${id}"; known: ${WORLD_DEFINITIONS.map((w) => w.id).join(', ')}`,
    );
  const layout = buildLayout(world);
  const out = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'assets',
    'worlds',
    world.id,
    'layout.json',
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(layout, null, 2) + '\n');
  console.log(`wrote ${out} (${layout.seats.length} seats, ${layout.furniture.length} furniture)`);
}
