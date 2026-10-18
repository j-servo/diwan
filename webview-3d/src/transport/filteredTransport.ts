// webview-3d/src/transport/filteredTransport.ts
import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport, TransportState } from '../../../core/src/transport.js';
import type { OfficeLayout } from '../../../webview-ui/src/office/types.js';

// 2D art and the consent tour have no place in the 3D client. Dropping
// furnitureAssetsLoaded also keeps our world catalog from being replaced.
const DROPPED_INCOMING = new Set<string>([
  'furnitureAssetsLoaded',
  'characterSpritesLoaded',
  'petSpritesLoaded',
  'floorTilesLoaded',
  'wallTilesLoaded',
  'carpetTilesLoaded',
  'hooksConsentRequest',
]);

// Read-only client: never writes seats, layout, settings or hooks on the shared server.
const ALLOWED_OUTGOING = new Set<string>(['webviewReady']);

export function filterIncoming(msg: ServerMessage, floorPlan: OfficeLayout): ServerMessage | null {
  if (DROPPED_INCOMING.has(msg.type)) return null;
  if (msg.type === 'layoutLoaded') return { type: 'layoutLoaded', layout: floorPlan };
  if (msg.type === 'existingAgents') {
    const agentMeta = Object.fromEntries(
      Object.entries(msg.agentMeta).map(([id, meta]) => [
        id,
        { palette: meta.palette, hueShift: meta.hueShift },
      ]),
    );
    return { ...msg, agentMeta };
  }
  return msg;
}

/** `steer` = this page holds a control token (steer mode). Without it only webviewReady goes out. */
export function isAllowedOutgoing(msg: ClientMessage, steer = false): boolean {
  return ALLOWED_OUTGOING.has(msg.type) || (steer && msg.type.startsWith('steer'));
}

export class FilteredTransport implements MessageTransport {
  private readonly inner: MessageTransport;
  private readonly floorPlan: OfficeLayout;

  private readonly steer: boolean;

  constructor(inner: MessageTransport, floorPlan: OfficeLayout, steer = false) {
    this.inner = inner;
    this.floorPlan = floorPlan;
    this.steer = steer;
  }

  get ready(): Promise<void> {
    return this.inner.ready;
  }

  get state(): TransportState {
    return this.inner.state;
  }

  send(message: ClientMessage): void {
    if (isAllowedOutgoing(message, this.steer)) this.inner.send(message);
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    // Only the first layout per subscription: a later one would rebuild the engine layout
    // and snap every agent back to its seat (the demo re-sends setup on each webviewReady).
    let layoutSeen = false;
    return this.inner.onMessage((message) => {
      if (message.type === 'layoutLoaded') {
        if (layoutSeen) return;
        layoutSeen = true;
      }
      const filtered = filterIncoming(message, this.floorPlan);
      if (filtered) handler(filtered);
    });
  }

  onStateChange(handler: (state: TransportState) => void): () => void {
    return this.inner.onStateChange(handler);
  }

  dispose(): void {
    this.inner.dispose();
  }
}
