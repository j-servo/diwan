import { WORLD_DEFINITIONS } from './definitions.js';
import { templeAssets } from './houseOfLife/assets.js';
import { hallAssets } from './houseOfWisdom/assets.js';
import type { WorldDefinition } from './types.js';

/** The first world is the default; each world's baked assets come from its own folder. */
const ASSETS: Record<string, WorldDefinition['assets']> = {
  'house-of-wisdom': hallAssets,
  'house-of-life': templeAssets,
};
export const WORLDS: readonly WorldDefinition[] = WORLD_DEFINITIONS.map((w) =>
  ASSETS[w.id] ? { ...w, assets: ASSETS[w.id] } : w,
);

/** The worlds the HUD offers: the listed ones, plus the current world if it is unlisted (a way back). */
export function switcherWorlds(current: WorldDefinition): readonly WorldDefinition[] {
  return WORLDS.filter((w) => w.listed !== false || w.id === current.id);
}

export function getWorld(id: string | null | undefined): WorldDefinition {
  return WORLDS.find((world) => world.id === id) ?? WORLDS[0];
}

const WORLD_KEY = 'diwan.world';

/** The last world the user chose (the switcher), when the URL names none. */
function rememberedWorld(): string | null {
  try {
    return window.localStorage.getItem(WORLD_KEY);
  } catch {
    return null;
  }
}

export function rememberWorld(id: string): void {
  try {
    window.localStorage.setItem(WORLD_KEY, id);
  } catch {
    // private window or blocked storage: the ?world= in the URL still carries the choice
  }
}

/**
 * World chosen by `?world=<id>`, else the one remembered from the switcher, else the hero world.
 * Unknown ids fall back to the hero world.
 */
export function activeWorld(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): WorldDefinition {
  const fromUrl = new URLSearchParams(search).get('world');
  if (fromUrl) return getWorld(fromUrl);
  const remembered = getWorld(typeof window === 'undefined' ? null : rememberedWorld());
  return remembered.listed === false ? WORLDS[0] : remembered;
}

/** `href` with `?world=<id>` set and every other parameter kept. */
export function worldHref(href: string, id: string): string {
  const url = new URL(href);
  url.searchParams.set('world', id);
  return url.toString();
}

/** The switcher: remember the choice, then reload into the world (one world per page load). */
export function switchWorld(id: string): void {
  rememberWorld(id);
  window.location.assign(worldHref(window.location.href, id));
}
