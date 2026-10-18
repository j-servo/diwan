import { useSyncExternalStore } from 'react';

/** The figure under the pointer, and where (CSS px from the window's top-left). */
export interface Hover {
  id: number;
  x: number;
  y: number;
}

let current: Hover | null = null;
const listeners = new Set<() => void>();

/** A tiny external store: hover changes at pointer speed and must not re-render the app. */
export function setHover(next: Hover | null): void {
  if (next === current) return;
  if (next && current && next.id === current.id && next.x === current.x && next.y === current.y)
    return;
  current = next;
  for (const l of listeners) l();
}

export function useHover(): Hover | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
