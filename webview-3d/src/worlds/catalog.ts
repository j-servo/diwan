import { buildDynamicCatalog } from '../../../webview-ui/src/office/layout/furnitureCatalog.js';
import type { SpriteData } from '../../../webview-ui/src/office/types.js';
import type { WorldDefinition } from './types.js';

// The upstream catalog requires a sprite per entry; the 3D renderer never draws it.
const PLACEHOLDER_SPRITE: SpriteData = [['#000000']];

/** Installs the world's furniture types as upstream's active catalog (module-global). */
export function installWorldCatalog(world: WorldDefinition): void {
  const sprites = Object.fromEntries(world.catalog.map((entry) => [entry.id, PLACEHOLDER_SPRITE]));
  if (!buildDynamicCatalog({ catalog: world.catalog, sprites })) {
    throw new Error(`World "${world.id}" has an empty furniture catalog`);
  }
}
