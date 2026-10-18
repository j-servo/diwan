import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import * as fs from 'fs';
import * as path from 'path';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import {
  DIWAN_WS_MAX_PAYLOAD,
  HOOK_API_PREFIX,
  MAX_HOOK_BODY_SIZE,
  WS_CLOSE_FORBIDDEN_ORIGIN,
  WS_CLOSE_POLICY_VIOLATION,
  WS_CLOSE_UNAUTHORIZED,
} from './constants.js';
import type { SteerManager } from './steer/manager.js';
import { grantScope, RateLimiter, READ_ONLY_SCOPE, type Scope } from './steer/scope.js';
import { CONTROL_TYPES } from './steer/validate.js';
import { terminalSafe } from './terminalText.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Diwan: the hall only watches. Every connection is unprivileged, only read-only client
   *  messages are honoured (clientMessageHandler), and request logging is off. */
  readOnly?: boolean;
  /** Diwan `--steer`: the control surface. Absent = the hall stays exactly read-only. */
  steer?: {
    manager: SteerManager;
    /** Per-run 256-bit control token: in memory and in the served page's meta tag only. */
    controlToken: string;
  };
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
/**
 * 'unsafe-eval' is the one concession: the Basis/KTX2 transcoder worker (emscripten) builds functions
 * with `new Function`, and a blob worker inherits the page's policy. Only same-origin script can run
 * either way; inline script and every other host stay blocked.
 * Headers on every Diwan response. The CSP is the minimum the hall needs: its own scripts and the
 * wasm/blob workers of the KTX2 and meshopt decoders, blob: fetches (GLTFLoader reads its embedded textures that way), its own styles (inline style attributes
 * included), data:/blob: images and textures, and connections to itself only (the /ws socket).
 */
export const DIWAN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' blob:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const DIWAN_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': DIWAN_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
};

export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded && !options.readOnly,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  // Diwan watches every session on the machine, so its feed must not reach a web page that
  // DNS-rebinds its own name to 127.0.0.1: such a page sends a matching Origin and Host
  // (isAllowedWebSocketOrigin passes it), but its Host is never a loopback name.
  if (options.readOnly) {
    app.addHook('onRequest', async (request, reply) => {
      if (!isLoopbackHost(request.headers.host)) {
        await reply.code(421).send({ error: 'misdirected request' });
      }
    });
  }
  await app.register(fastifyCors, { origin: !options.readOnly });
  await app.register(
    fastifyWebsocket,
    options.readOnly ? { options: { maxPayload: DIWAN_WS_MAX_PAYLOAD } } : {},
  );

  // Diwan (watch-only and steer): a page that can approve tool calls must not be framed by another
  // site, run injected script, or reach any other origin. Every response carries the full policy.
  if (options.steer || options.readOnly) {
    app.addHook('onRequest', async (_request, reply) => {
      for (const [name, value] of Object.entries(DIWAN_SECURITY_HEADERS)) reply.header(name, value);
    });
  }

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    const staticDir = options.staticDir;
    if (options.steer) {
      // index.html carries the control token, so it is served by hand, never by the static plugin.
      const page = (request: FastifyRequest, reply: FastifyReply) =>
        sendSteerIndex(staticDir, options.steer!.controlToken, request, reply);
      app.get('/', page);
      app.get('/index.html', page);
    }
    app.addHook('onRequest', async (request, reply) => {
      const pathname = request.url.split('?')[0];
      if (pathname.endsWith('/') && pathname !== '/' && !isSpaRoute(pathname)) {
        await reply.code(404).send({ error: 'not found' }); // a directory, not a page
      }
    });
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      ...(options.steer ? { index: false } : {}),
    });
    // HTML5 history fallback: serve index.html for unmatched PAGE routes. An unmatched API,
    // asset or file-like path is a plain 404, not the SPA (a typo must not look like a page).
    app.setNotFoundHandler((request, reply) => {
      if (!isSpaRoute(request.url)) {
        reply.code(404).send({ error: 'not found' });
        return;
      }
      if (options.steer)
        return sendSteerIndex(staticDir, options.steer.controlToken, request, reply);
      return reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app, options.token, options.steer !== undefined);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance, token: string, steer: boolean): void {
  app.get<{ Querystring: { nonce?: string } }>('/api/health', async (request) => {
    const nonce = request.query.nonce;
    return {
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      pid: process.pid,
      steer,
      // Proof of the token without revealing it: HMAC(token, nonce). The hook script sends a fresh
      // nonce before it sends its bearer token, so a stale pid on a recycled port (some other
      // server that cannot compute this) never receives the token.
      ...(typeof nonce === 'string' && nonce.length > 0 && nonce.length <= 128
        ? { proof: healthProof(token, nonce) }
        : {}),
    };
  });
}

/** What a server holding `token` answers to a health nonce. */
export function healthProof(token: string, nonce: string): string {
  return crypto.createHmac('sha256', token).update(`diwan-health:${nonce}`).digest('hex');
}

/** Whether an unmatched URL may fall back to the SPA: a page path, not /api, /assets or a file. */
export function isSpaRoute(url: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(url, 'http://localhost').pathname;
  } catch {
    return false;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return false;
  // A dot in the last segment (a file, or a dotfile such as /.env) is never a page.
  return !path.posix.basename(pathname).includes('.');
}

/** index.html with the control token as a meta tag: GET only, loopback Host only, never cached. */
function sendSteerIndex(
  staticDir: string,
  controlToken: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (request.method !== 'GET' || !isLoopbackHost(request.headers.host)) {
    return reply.code(421).send({ error: 'misdirected request' });
  }
  let html: string;
  try {
    html = fs.readFileSync(path.join(staticDir, 'index.html'), 'utf-8');
  } catch {
    return reply.code(404).send({ error: 'not found' });
  }
  const meta = `<meta name="diwan-steer" content="${controlToken}">`;
  html = html.includes('</head>') ? html.replace('</head>', `${meta}</head>`) : `${meta}${html}`;
  return reply
    .header('Cache-Control', 'no-store')
    .header('Content-Type', 'text/html; charset=utf-8')
    .send(html);
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      // Valid JSON need not be an object ("null", "[]", "42"): refuse before touching the runtime.
      if (event === null || typeof event !== 'object' || Array.isArray(event)) {
        reply.code(400).send({ error: 'body must be a JSON object' });
        return;
      }

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // CONNECTION gate. Embedded (VS Code) requires the Bearer token. Standalone
    // requires a same-origin handshake instead (isAllowedWebSocketOrigin), so a
    // non-browser local client with no Origin can still watch the office. What
    // may be DONE over an accepted connection is a separate question, decided
    // below.
    if (options.embedded) {
      if (!timingSafeStringEqual(request.headers.authorization ?? '', `Bearer ${options.token}`)) {
        socket.close(WS_CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }
    } else if (!isAllowedWebSocketOrigin(request.headers.origin, request.headers.host)) {
      socket.close(WS_CLOSE_FORBIDDEN_ORIGIN, 'forbidden origin');
      return;
    }

    // Both modes prove privilege with the SAME out-of-band secret, differently
    // carried: embedded sends the Bearer token it was handed in-process;
    // standalone sends the `?token=` the CLI printed in the local URL and the
    // SPA forwarded on this handshake. Nothing about a network POSITION is
    // consulted, because every position is reproducible by a forwarder.
    const privileged =
      !options.readOnly && (options.embedded || standaloneTokenValid(request.url, options.token));

    const { store } = options;

    // Diwan's per-connection scope: {read} until a steerHello earns {read, control}. The port is
    // the one this socket actually reached, so the Origin rule tracks --port with no config.
    let scope: Scope = READ_ONLY_SCOPE;
    const limiter = new RateLimiter(20);
    const localPort = request.socket.localPort ?? 0;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        steerable: options.steer?.manager.isSteerable(agent) || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      // A scholar's replies can carry anything its session read: control sockets only.
      if (message.type === 'steerReply' && !scope.control) return;
      // The feed carries the redacted approval text; a control socket gets the full card instead.
      safeSend(
        socket,
        scope.control && options.steer ? options.steer.manager.controlForm(message) : message,
      );
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (typeof msg.type === 'string' && msg.type.startsWith('steer')) {
          // Control traffic: never logged with its payload (a steerHello carries the token).
          if (!limiter.hit()) {
            console.warn('[Diwan] control flood on a socket: closing it');
            socket.close(WS_CLOSE_POLICY_VIOLATION, 'rate limit');
            return;
          }
          handleSteerMessage(msg);
          return;
        }
        if (!options.embedded && !options.readOnly && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
          privileged,
          readOnly: options.readOnly,
        });
        if (msg.type === 'webviewReady' && options.steer) {
          for (const m of options.steer.manager.snapshot(scope.control)) safeSend(socket, m);
        }
      } catch {
        // Malformed JSON, ignore
      }
    });

    function handleSteerMessage(msg: Record<string, unknown>): void {
      const steer = options.steer;
      // No steering here at all (plain `diwan`, or the other modes): the handshake is refused.
      if (!steer) {
        socket.close(WS_CLOSE_POLICY_VIOLATION, 'read-only');
        return;
      }
      if (msg.type === 'steerHello') {
        scope = grantScope({
          steerMode: true,
          token: msg.token,
          expectedToken: steer.controlToken,
          origin: request.headers.origin,
          port: localPort,
        });
        if (scope.control) {
          safeSend(socket, { type: 'steerWelcome', projects: steer.manager.projects() });
          // Approvals already pending reach this socket in their full form (replacing any redacted copy).
          for (const m of steer.manager.snapshot(true)) {
            if (m.type === 'steerApproval' || m.type === 'steerReply') safeSend(socket, m);
          }
        } else {
          // Stays read-only and stays connected: closing here would send the page into a
          // reconnect-and-reload loop. It simply never gets a welcome.
          console.warn('[Diwan] a steerHello was refused (token or Origin)');
          steer.manager.auditRefusal('hello-refused', 'token or Origin not accepted');
          safeSend(socket, { type: 'steerResult', ok: false, error: 'not authorised' });
        }
        return;
      }
      if (!scope.control || !CONTROL_TYPES.has(msg.type as string)) {
        console.warn(
          `[Diwan] refused a control message from a read-only socket: ${terminalSafe(String(msg.type).slice(0, 40))}`,
        );
        if (msg.type === 'steerLaunch') {
          steer.manager.auditRefusal(
            'launch-refused',
            'sent without control',
            typeof msg.project === 'string' ? msg.project : '',
          );
        }
        socket.close(WS_CLOSE_POLICY_VIOLATION, 'read-only');
        return;
      }
      steer.manager.handle(msg, (m) => safeSend(socket, m));
    }

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

/**
 * Standalone `/ws` CONNECTION gate: is this handshake same-origin?
 *
 * WebSocket connects are NOT subject to CORS, so without this any web page the
 * user happens to visit could open a socket to 127.0.0.1 and start talking.
 * Comparing Origin's host against the request's own Host header makes the check
 * same-origin by construction — it tracks whatever --host/--port the server was
 * bound to with zero configuration, and treats `localhost` and `127.0.0.1`
 * correctly (a browser derives both headers from the URL that loaded the SPA).
 *
 * A missing Origin still connects: non-browser local clients send none, and the
 * standalone server's read surface is deliberately open to whatever address it
 * was told to bind (`--host 0.0.0.0` exposes the SPA to the LAN by design).
 *
 * This gate is NOT sufficient for privileged actions and never was. Both header
 * values are attacker-supplied, so a DNS-rebound page (`evil.com` → 127.0.0.1)
 * sends `Origin: http://evil.com:PORT` AND `Host: evil.com:PORT` and passes
 * equality. See standaloneTokenValid for what actually guards consent.
 */
/** Whether a Host header names this machine's loopback (127.0.0.1, localhost, [::1]), any port. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    const name = new URL(`http://${host}`).hostname;
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
  } catch {
    return false;
  }
}

export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  host: string | undefined,
): boolean {
  if (origin === undefined || origin === '') return true;
  try {
    return new URL(origin).host === host;
  } catch {
    // An unparseable Origin is not a same-origin browser request.
    return false;
  }
}

/**
 * Whether this socket may send PRIVILEGED messages — the ones that reach
 * outside `~/.pixel-agents/`. Today that is `setHooksEnabled`, which grants
 * durable, machine-wide consent to modify `~/.claude/settings.json` and
 * installs (or removes) a 12-event hook set.
 *
 * The handshake must carry the server token in its `?token=` query. That token
 * is minted at startup (server.ts), printed by the CLI inside the LOCAL url it
 * emits to the operator's terminal, and forwarded by the SPA loaded from that
 * url (webview-ui/src/transport/index.ts). It is the Jupyter model.
 *
 * Why a secret rather than a network position: EVERY position is reproducible.
 * The predecessor of this function required a loopback peer address AND a
 * loopback `Host`, on the theory that only a real local browser satisfies both.
 * A dumb TCP forwarder bound to the LAN, piping bytes verbatim to 127.0.0.1,
 * presents the server exactly what the SPA presents — `remoteAddress` is
 * 127.0.0.1 because the forwarder terminated the hop there, and `Host` is
 * whatever the remote client typed. Reproduced against the real `dist/cli.js`:
 * a client on another machine acquired consent and a 12-event install. Peer
 * address and Host/Origin are all carried BY the channel a proxy speaks, so the
 * gate must ride something the channel never carries — an out-of-band secret
 * the operator's own URL delivers and the forwarded attacker never sees.
 *
 * A tokenless client is not locked out of Pixel Agents — it connects and
 * watches the office exactly as before (the connection gate,
 * isAllowedWebSocketOrigin, is separate and unchanged). It simply cannot
 * approve a change to a file in someone's home directory.
 */
function standaloneTokenValid(url: string | undefined, expected: string): boolean {
  // Defensive: an empty configured token would otherwise privilege every
  // handshake that omits the query (both sides compare equal as '').
  if (!expected) return false;
  let provided: string;
  try {
    // Parsed against a dummy base because `request.url` is path-relative. Read
    // from the raw url rather than a framework-parsed query so the gate does
    // not depend on @fastify/websocket populating one on the upgrade request.
    provided = new URL(url ?? '', 'http://localhost').searchParams.get('token') ?? '';
  } catch {
    return false;
  }
  return timingSafeStringEqual(provided, expected);
}

// ── Auth Helper ────────────────────────────────────────────────

/** Constant-time string compare, length-guarded (timingSafeEqual throws on a
 *  length mismatch). One implementation for all three token comparisons. */
function timingSafeStringEqual(actual: string, expected: string): boolean {
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!timingSafeStringEqual(request.headers.authorization ?? '', `Bearer ${expectedToken}`)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
