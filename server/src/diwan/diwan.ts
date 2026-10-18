/**
 * Diwan's server: the existing runtime (hooks + transcript fallback + HTTP/WS) composed for
 * one job, showing every Claude Code session on this machine in the 3D hall.
 *
 * What differs from `npx pixel-agents` (cli.ts): state lives in ~/.diwan, the hall is
 * read-only (no client message can write settings, layout or hooks), it never installs
 * hooks itself (`diwan hooks install` is the only way in), and it watches ALL sessions.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { AgentRuntime } from '../agentRuntime.js';
import { AgentStateStore } from '../agentStateStore.js';
import { buildAssetCache } from '../assetReload.js';
import { DIWAN_BRAND, setBrand } from '../brand.js';
import { readConfig } from '../configPersistence.js';
import { SERVER_JSON_NAME } from '../constants.js';
import { FileStateAdapter } from '../fileStateAdapter.js';
import { claudeProvider } from '../providers/index.js';
import { PixelAgentsServer } from '../server.js';
import { isServerTarget } from '../serverConfig.js';
import { sessionLabelOf } from '../sessionLabel.js';
import { AuditLog } from '../steer/audit.js';
import { SteerManager } from '../steer/manager.js';
import { SdkRunner, type SteerRunner } from '../steer/runner.js';
import { newControlToken } from '../steer/scope.js';
import { terminalSafe } from '../terminalText.js';
import type { AgentState } from '../types.js';

/** How often the running server re-reads settings.json, so installing or removing hooks
 *  from another terminal switches the transcript fallback on or off without a restart. */
export const HOOKS_REFRESH_MS = 10_000;

/** What a quiet terminal keeps from console.log/info: Diwan's own lines (startup, sessions). The
 *  runtime's other output -- per-tool, timer, watcher and asset-loader lines -- is verbose-only. */
const QUIET_KEEPS = /^(\[Diwan\]|Diwan |Press Ctrl-C)/;

/**
 * The runtime still logs under its original name; show every line as Diwan's. Unless
 * `verbose`, its console.log/info chatter (per-tool, timer, watcher and asset lines) is
 * dropped: warnings and errors always show, and so do Diwan's own lines (startup, sessions).
 */
export function brandConsole(
  target: Pick<Console, 'log' | 'info' | 'warn' | 'error'> = console,
  options: { verbose?: boolean } = {},
) {
  const rewrite = (args: unknown[]): unknown[] =>
    typeof args[0] === 'string'
      ? [args[0].replace(/^\[Pixel Agents\]/, '[Diwan]'), ...args.slice(1)]
      : args;
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = target[level].bind(target);
    const chatty = level === 'log' || level === 'info';
    target[level] = (...args: unknown[]) => {
      if (chatty && !options.verbose && !QUIET_KEEPS.test(String(args[0]))) return;
      original(...rewrite(args));
    };
  }
}

/**
 * Say what the hall is doing, one line per event and always by session label ("brain setup"),
 * never "Agent 1": a session joined, left, or needs approval. Returns the unsubscribe.
 */
export function logSessionEvents(
  store: AgentStateStore,
  print: (line: string) => void = (line) => console.log(line),
): () => void {
  const names = new Map<number, string>();
  const pending = new Set<number>();
  // A launched scholar's request is announced by its steerApproval (one per requestId). The
  // hook / lamp re-assert path (agentToolPermission) repeats the same request: while a steer
  // request is open for that scholar it says nothing.
  const steerOpen = new Map<number, Set<string>>();
  const steerLogged = new Set<string>();
  const say = (name: string, what: string): void => print(terminalSafe(`[Diwan] ${name} ${what}`));
  const nameOf = (id: number): string => {
    const agent = store.get(id);
    if (agent) names.set(id, sessionLabelOf(agent));
    return names.get(id) ?? 'session';
  };
  // Teammates and background spawns are part of their lead's session, not sessions of their own.
  const isSession = (agent: AgentState): boolean =>
    agent.leadAgentId === undefined && !agent.spawnToolUseId;

  const onAdded = (id: number, agent: AgentState): void => {
    if (!isSession(agent)) return;
    // The transcript's label is read right after adoption; name the session once it has landed.
    setImmediate(() => {
      if (store.get(id) === agent) say(nameOf(id), 'joined');
    });
  };
  const onRemoved = (id: number): void => {
    pending.delete(id);
    steerOpen.delete(id);
    const name = names.get(id);
    names.delete(id);
    if (name !== undefined) say(name, 'left');
  };
  const onBroadcast = (msg: Record<string, unknown>): void => {
    const id = msg.id as number;
    switch (msg.type) {
      case 'agentLabel':
        if (names.has(id)) names.set(id, msg.label as string);
        break;
      case 'steerApproval': {
        const rid = String(msg.requestId);
        const open = steerOpen.get(id) ?? new Set<string>();
        open.add(rid);
        steerOpen.set(id, open);
        if (steerLogged.has(rid)) break;
        steerLogged.add(rid);
        // The user's own PermissionRequest hook may have said it a moment earlier: once.
        if (!pending.has(id)) say(nameOf(id), 'needs your approval');
        pending.add(id);
        break;
      }
      case 'steerApprovalClear': {
        const rid = String(msg.requestId);
        steerLogged.delete(rid);
        const open = steerOpen.get(id);
        open?.delete(rid);
        if (open?.size === 0) steerOpen.delete(id);
        pending.delete(id);
        break;
      }
      case 'agentToolPermission':
      case 'subagentToolPermission':
        if (steerOpen.has(id)) break;
        if (!pending.has(id)) {
          pending.add(id);
          say(nameOf(id), 'needs your approval');
        }
        break;
      case 'agentToolPermissionClear':
      case 'agentToolDone':
      case 'agentToolsClear':
      case 'agentStatus':
      case 'subagentToolDone':
      case 'subagentClear':
        pending.delete(id);
        break;
      case 'agentToolStart':
        if (!msg.permissionActive) pending.delete(id);
        break;
    }
  };

  store.on('agentAdded', onAdded);
  store.on('agentRemoved', onRemoved);
  store.on('broadcast', onBroadcast);
  return () => {
    store.off('agentAdded', onAdded);
    store.off('agentRemoved', onRemoved);
    store.off('broadcast', onBroadcast);
  };
}

export interface DiwanOptions {
  port: number;
  /** The package's dist/: bundled assets/ live here. */
  distRoot: string;
  /** The production build of webview-3d. */
  staticDir: string;
  /** `diwan --steer`: sessions launched from the hall can be steered. Off = the read-only hall. */
  steer?: boolean;
  /** Steer mode only: what launches sessions. Tests pass a fake; the real one is the Agent SDK. */
  runner?: SteerRunner;
}

export interface DiwanHandle {
  port: number;
  stop(): Promise<void>;
}

export async function startDiwan(options: DiwanOptions): Promise<DiwanHandle> {
  setBrand(DIWAN_BRAND);

  const assetCache = await buildAssetCache(options.distRoot, readConfig().externalAssetDirectories);
  const store = new AgentStateStore();
  store.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
  const runtime = new AgentRuntime(store, claudeProvider);
  const server = new PixelAgentsServer();
  server.onHookEvent((providerId, event) => runtime.handleHookEvent(providerId, event));

  // Steering is opt-in: without --steer there is no token, no control path and no SDK.
  let steer: SteerManager | undefined;
  let controlToken: string | undefined;
  if (options.steer) {
    controlToken = newControlToken();
    steer = new SteerManager({
      store,
      runtime,
      runner: options.runner ?? new SdkRunner(),
      audit: new AuditLog([controlToken]),
    });
  }

  const config = await server.start({
    store,
    runtime,
    embedded: false,
    host: '127.0.0.1',
    port: options.port,
    staticDir: options.staticDir,
    assetCache,
    readOnly: true,
    steer: steer && controlToken ? { manager: steer, controlToken } : undefined,
  });

  // A launched scholar that is still running is never retired for silence (it may sit on an approval).
  if (steer) runtime.silentRetireExempt = (agent) => steer.isRunning(agent);
  // Whole-machine dashboard: adopt every session, not just one project's.
  runtime.watchAllSessions.current = true;
  const syncHooks = async (): Promise<void> => {
    runtime.hooksEnabled.current = await claudeProvider.areHooksInstalled().catch(() => false);
  };
  await syncHooks();
  const hooksTimer = setInterval(() => void syncHooks(), HOOKS_REFRESH_MS);
  hooksTimer.unref();
  runtime.startExternalScanning(options.distRoot);
  runtime.startStaleCheck();
  runtime.startSilentRetire();
  const stopLogging = logSessionEvents(store);

  return {
    port: config.port,
    stop: () => {
      steer?.shutdown(); // denies anything pending and aborts launched sessions before the socket closes
      clearInterval(hooksTimer);
      stopLogging();
      runtime.dispose();
      return server.stop();
    },
  };
}

/** Whether the Diwan server on `port` was started with --steer (its /api/health says so). */
export async function runningDiwanIsSteer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => {
          try {
            resolve((JSON.parse(body) as { steer?: unknown }).steer === true);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * The port of a Diwan server already running on this machine, or null. server.json must
 * name a live pid AND the port must answer /api/health: a pid can be reused, a port can
 * be taken by something else.
 */
export async function findRunningDiwan(): Promise<number | null> {
  let port: number;
  try {
    const file = path.join(os.homedir(), DIWAN_BRAND.dirName, SERVER_JSON_NAME);
    const target = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!isServerTarget(target)) return null;
    process.kill(target.pid, 0);
    port = target.port;
  } catch {
    return null;
  }
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/api/health', timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? port : null);
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}
