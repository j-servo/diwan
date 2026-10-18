// webview-3d/src/steer/steer.ts
import { useSyncExternalStore } from 'react';

import type { ClientMessage } from '../../../core/src/messages.js';
import { transport } from '../transport/index.js';
import type { SteerState } from './steerStore.js';
import { EMPTY_STEER, steerReducer } from './steerStore.js';

let state: SteerState = EMPTY_STEER;
const listeners = new Set<() => void>();

transport.onMessage((msg) => {
  const next = steerReducer(state, msg, Date.now());
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
});

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSteer(): SteerState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Send a control message. The transport drops it unless this page earned steering. */
export function steerSend(msg: Extract<ClientMessage, { type: `steer${string}` }>): void {
  transport.send(msg);
}
