import { useSyncExternalStore } from 'react';
import type { Object3D } from 'three';

/**
 * The hall's `notice_board` node, published by WorldSkin and read by WorldBoard. A module-level
 * store rather than a React context because the two are siblings in the scene graph.
 */
let current: Object3D | null = null;
const listeners = new Set<() => void>();

export function setNoticeBoardNode(node: Object3D | null): void {
  if (node === current) return;
  current = node;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useNoticeBoardNode(): Object3D | null {
  return useSyncExternalStore(subscribe, () => current);
}
