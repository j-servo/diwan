import { useSyncExternalStore } from 'react';

let time = -1;
const listeners = new Set<() => void>();

/** The promo's script time, for the caption layer (React reads it; the rig writes it per frame). */
export function setPromoTime(t: number): void {
  time = t;
  for (const l of listeners) l();
}

export function usePromoTime(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => time,
  );
}
