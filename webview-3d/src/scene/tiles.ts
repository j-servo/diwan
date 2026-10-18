import type { OfficeLayout } from '../../../webview-ui/src/office/types.js';
import { TileType } from '../../../webview-ui/src/office/types.js';

export interface TileCoord {
  col: number;
  row: number;
}

export function splitTiles(layout: OfficeLayout): { floor: TileCoord[]; walls: TileCoord[] } {
  const floor: TileCoord[] = [];
  const walls: TileCoord[] = [];
  layout.tiles.forEach((tile, index) => {
    const coord = { col: index % layout.cols, row: Math.floor(index / layout.cols) };
    if (tile === TileType.WALL) walls.push(coord);
    else if (tile !== TileType.VOID) floor.push(coord);
  });
  return { floor, walls };
}
