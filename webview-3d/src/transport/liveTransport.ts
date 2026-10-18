// webview-3d/src/transport/liveTransport.ts
import type { MessageTransport, TransportState } from '../../../core/src/transport.js';
import { WebSocketTransport } from '../../../webview-ui/src/transport/webSocketTransport.js';

/** Same-host /ws. Never a token in the URL: steering (if the server offers it) is a steerHello message. */
export function liveSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}

/**
 * Upstream's socket never re-sends webviewReady after a reconnect, and a restarted server
 * numbers agents from 1 again, so a reconnect would leave stale agents on screen.
 */
export function shouldReloadOnStateChange(prev: TransportState, next: TransportState): boolean {
  return prev === 'reconnecting' && next === 'connected';
}

export function createLiveTransport(
  steerToken: string | null = null,
  location: Pick<Location, 'protocol' | 'host'> = window.location,
  reload: () => void = () => window.location.reload(),
): MessageTransport {
  const ws = new WebSocketTransport(liveSocketUrl(location));
  // Steer mode: the first message on the socket proves who we are. Queued before connect(), so it
  // goes out ahead of webviewReady. Plain `diwan` serves no meta tag, so nothing is sent.
  if (steerToken) ws.send({ type: 'steerHello', token: steerToken });
  let prev: TransportState = ws.state;
  ws.onStateChange((next) => {
    const again = shouldReloadOnStateChange(prev, next);
    prev = next;
    if (again) reload();
  });
  ws.connect();
  return ws;
}
