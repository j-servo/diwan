import type { TransportMode } from '../transport/mode.js';

export type EmptyHint = 'disconnected' | 'connected';

/** Live mode only waits this long with no agents before explaining the empty hall. */
export const EMPTY_HINT_AFTER_MS = 3000;

/**
 * Which "no agents yet" line to show, if any. Never in demo; hidden the moment an agent exists;
 * held back until the hall has been empty for a few seconds so a normal connect does not flash it.
 */
export function emptyHint(
  mode: TransportMode,
  connected: boolean,
  agentTotal: number,
  emptyForMs: number,
): EmptyHint | null {
  if (mode !== 'live' || agentTotal > 0 || emptyForMs <= EMPTY_HINT_AFTER_MS) return null;
  return connected ? 'connected' : 'disconnected';
}

/** The same page with the demo switched on; built with URLSearchParams, never string concatenation. */
export function demoHref(href: string): string {
  const url = new URL(href);
  url.searchParams.set('demo', '1');
  return url.toString();
}
