// webview-3d/src/steer/token.ts

/** The meta tag the steer-mode server puts in index.html. */
export const STEER_META = 'diwan-steer';

/**
 * Read the control token from the page's meta tag, then remove the tag so it does not linger in
 * the DOM. The token goes to the server in the first WebSocket message and nowhere else: never
 * a URL, a log or localStorage.
 */
export function takeSteerToken(doc: Pick<Document, 'querySelector'> = document): string | null {
  const meta = doc.querySelector(`meta[name="${STEER_META}"]`);
  const token = meta?.getAttribute('content') ?? '';
  meta?.remove();
  return /^[0-9a-f]{64}$/.test(token) ? token : null;
}
