const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/**
 * Gate for browser-reachable proxy hops. The Host must be loopback (defeats DNS
 * rebinding). An Origin, when present, must name that same host (defeats any
 * other website). A missing Origin is a non-browser local client.
 */
export function isAllowedLocalUpgrade(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (!host || !LOOPBACK_HOST.test(host)) return false;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
