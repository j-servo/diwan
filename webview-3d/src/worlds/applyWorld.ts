import { setActiveTrimColors } from '../agents/figureLogic.js';
import { setActiveSignal } from '../grammar/signal.js';
import { setActiveNouns } from './personas.js';
import type { WorldDefinition } from './types.js';

/**
 * Makes `world` the one this page shows: its signal colour (runtime and CSS), its robe trims and
 * the `data-world` hook that per-world CSS blocks key on. One world per page load; call once.
 */
export function applyWorld(world: WorldDefinition, root: HTMLElement = document.documentElement) {
  setActiveSignal(world.signal);
  setActiveTrimColors(world.trimColors);
  setActiveNouns(world.personas.nouns);
  root.dataset.world = world.id;
  root.style.setProperty('--needs-you', world.signal.color);
  root.style.setProperty('--needs-you-ink', world.signal.ink);
}
