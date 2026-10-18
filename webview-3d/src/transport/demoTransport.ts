// webview-3d/src/transport/demoTransport.ts
import { TRANSPORT_STATE_CONNECTED } from '../../../core/src/constants.js';
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport, TransportState } from '../../../core/src/transport.js';
import type { DemoTimeline } from '../demo/types.js';

export interface DemoOptions {
  loop: boolean;
  speed: number;
  /** No timers: the caller moves time with advanceTo() (the promo render steps frame by frame). */
  manual: boolean;
}

const LOOP_ID_STRIDE = 1000;

function withIdOffset(msg: ServerMessage, offset: number): ServerMessage {
  if (offset === 0) return msg;
  const id = (msg as { id?: unknown }).id;
  return typeof id === 'number' ? ({ ...msg, id: id + offset } as ServerMessage) : msg;
}

/** Plays a scripted timeline as if a server were sending it. No network. */
export class DemoTransport implements MessageTransport {
  readonly ready: Promise<void> = Promise.resolve();
  readonly state: TransportState = TRANSPORT_STATE_CONNECTED;
  private readonly timeline: DemoTimeline;
  private readonly options: DemoOptions;
  private readonly handlers = new Set<(message: ServerMessage) => void>();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private playing = false;
  private loopIndex = 0;
  private nextStep = 0;

  constructor(timeline: DemoTimeline, options: Partial<DemoOptions> = {}) {
    this.timeline = timeline;
    this.options = {
      loop: options.loop ?? true,
      speed: options.speed ?? 1,
      manual: options.manual ?? false,
    };
  }

  send(message: ClientMessage): void {
    if (message.type !== 'webviewReady') return;
    // Like the real server: every webviewReady gets the current state again.
    for (const msg of this.timeline.setup) this.emit(msg);
    if (this.playing) return;
    this.playing = true;
    if (!this.options.manual) this.playLoop();
  }

  /** Manual mode: sends every step due by `ms` since the start, once and in order. */
  advanceTo(ms: number): void {
    if (!this.playing) return;
    const { steps } = this.timeline;
    while (this.nextStep < steps.length && steps[this.nextStep]!.at <= ms) {
      this.emit(steps[this.nextStep++]!.msg);
    }
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  onStateChange(_handler: (state: TransportState) => void): () => void {
    return () => {};
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    this.handlers.clear();
    this.playing = false;
    this.loopIndex = 0;
  }

  private emit(message: ServerMessage): void {
    for (const handler of [...this.handlers]) handler(message);
  }

  private playLoop(): void {
    const { speed, loop } = this.options;
    // Agent ids differ per loop: the previous loop's agents may still be despawning, and the
    // engine ignores an agentCreated for an id it still holds (fast speeds, hidden tabs).
    const offset = this.loopIndex * LOOP_ID_STRIDE;
    this.loopIndex += 1;
    this.timers = this.timeline.steps.map((step) =>
      setTimeout(() => this.emit(withIdOffset(step.msg, offset)), step.at / speed),
    );
    if (loop) {
      this.timers.push(setTimeout(() => this.playLoop(), this.timeline.durationMs / speed));
    }
  }
}
