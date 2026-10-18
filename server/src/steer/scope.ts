/**
 * The per-connection scope of a Diwan WebSocket. Every connection starts with {read}; it earns
 * {read, control} only in steer mode, with the per-run token (constant-time compare) and a
 * PRESENT, loopback Origin that names the hall's own port. A missing or foreign Origin is not
 * a browser on our page: it never gets control, whatever it knows.
 */
import * as crypto from 'crypto';

export interface Scope {
  read: true;
  control: boolean;
}

export const READ_ONLY_SCOPE: Scope = Object.freeze({ read: true, control: false });

/** A fresh 256-bit control token. Kept in memory only: never written to server.json or a log. */
export function newControlToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Constant-time compare of two strings (length-guarded; timingSafeEqual throws on a mismatch). */
export function tokensEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string' || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Is `origin` exactly the hall's own origin on `port`? Absent is NOT allowed here: a browser always
 * sends Origin on a WebSocket handshake, so a missing one is a script or a proxy.
 */
export function isControlOrigin(origin: string | undefined, port: number): boolean {
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

export interface ScopeRequest {
  steerMode: boolean;
  token: unknown;
  expectedToken: string;
  origin: string | undefined;
  port: number;
}

export function grantScope(req: ScopeRequest): Scope {
  if (
    req.steerMode &&
    isControlOrigin(req.origin, req.port) &&
    tokensEqual(req.token, req.expectedToken)
  ) {
    return { read: true, control: true };
  }
  return READ_ONLY_SCOPE;
}

/** At most `limit` events per rolling second; `hit()` is false once the connection floods. */
export class RateLimiter {
  private stamps: number[] = [];
  constructor(
    private readonly limit = 20,
    private readonly now: () => number = Date.now,
  ) {}
  hit(): boolean {
    const t = this.now();
    this.stamps = this.stamps.filter((s) => t - s < 1000);
    if (this.stamps.length >= this.limit) return false;
    this.stamps.push(t);
    return true;
  }
}
