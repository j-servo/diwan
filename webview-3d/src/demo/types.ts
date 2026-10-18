// webview-3d/src/demo/types.ts
import type { ServerMessage } from '../../../core/src/messages.js';

export interface DemoStep {
  /** Milliseconds from the start of the loop. */
  at: number;
  msg: ServerMessage;
}

export interface DemoTimeline {
  /** Sent on every webviewReady (capabilities, layout). */
  setup: ServerMessage[];
  /** Replayed every loop; must end with all agents closed. */
  steps: DemoStep[];
  durationMs: number;
}
