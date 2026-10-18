import { houseOfLifeGreybox } from './houseOfLife/greybox.js';
import { houseOfWisdomGreybox } from './houseOfWisdom/greybox.js';
import type { WorldDefinition } from './types.js';

/**
 * Every world's logical definition, without baked assets (those come from Vite's import.meta.glob
 * in registry.ts), so the layout export script can read them under tsx.
 */
export const WORLD_DEFINITIONS: readonly WorldDefinition[] = [
  houseOfWisdomGreybox,
  houseOfLifeGreybox,
];
