import { spawn } from 'child_process';
import { buildSync } from 'esbuild';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';

// Temp HOME for everything: the Diwan server, its state dir and the Claude settings file.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PIXEL_AGENTS_BRAND, setBrand } = await import('../src/brand.js');
const { updateSessionLabel } = await import('../src/sessionLabel.js');
const { brandConsole, findRunningDiwan, logSessionEvents, startDiwan } =
  await import('../src/diwan/diwan.js');
type DiwanHandle = Awaited<ReturnType<typeof startDiwan>>;

let outDir: string;
let HOOK_SCRIPT: string;
let distRoot: string;
let staticDir: string;
let handle: DiwanHandle | null;
let token: string;

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-server-build-'));
  HOOK_SCRIPT = path.join(outDir, 'claude-hook.js');
  buildSync({
    entryPoints: [path.join(__dirname, '../src/diwan/hook.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: HOOK_SCRIPT,
  });
});

afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

beforeEach(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-server-'));
  // An empty dist/ (no 2D sprite assets) and a stand-in for the webview-3d build.
  distRoot = path.join(tmpBase, 'dist');
  staticDir = path.join(distRoot, 'webview-3d');
  fs.mkdirSync(staticDir, { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Diwan</title>');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  handle = await startDiwan({ port: 0, distRoot, staticDir });
  token = JSON.parse(fs.readFileSync(serverJsonPath(), 'utf-8')).token as string;
});

afterEach(async () => {
  await handle?.stop();
  setBrand(PIXEL_AGENTS_BRAND);
  vi.restoreAllMocks();
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

const serverJsonPath = (): string => path.join(tmpBase, '.diwan', 'server.json');
const settingsPath = (): string => path.join(tmpBase, '.claude', 'settings.json');
const base = (): string => `http://127.0.0.1:${handle!.port}`;

type Msg = Record<string, unknown> & { type: string };

/** Open /ws, collect every message, send webviewReady like the 3D client does. */
async function openHall(query = ''): Promise<{ socket: WebSocket; messages: Msg[] }> {
  const messages: Msg[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${handle!.port}/ws${query}`);
  socket.on('message', (d) => messages.push(JSON.parse(d.toString()) as Msg));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'webviewReady' }));
  await waitFor(() => messages.some((m) => m.type === 'layoutLoaded'));
  return { socket, messages };
}

async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

async function postHook(event: Record<string, unknown>, auth = `Bearer ${token}`): Promise<number> {
  const res = await fetch(`${base()}/api/hooks/claude`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify(event),
  });
  return res.status;
}

describe('diwan server', () => {
  it('serves the hall (SPA) and health on 127.0.0.1', async () => {
    const page = await fetch(`${base()}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Diwan</title>');
    const health = await fetch(`${base()}/api/health`);
    expect(((await health.json()) as { status: string }).status).toBe('ok');
  });

  it('keeps its state in ~/.diwan, never ~/.pixel-agents', () => {
    const record = JSON.parse(fs.readFileSync(serverJsonPath(), 'utf-8'));
    expect(record).toMatchObject({ port: handle!.port, pid: process.pid, servesSpa: true });
    expect(typeof record.token).toBe('string');
    expect(fs.existsSync(path.join(tmpBase, '.pixel-agents'))).toBe(false);
  });

  it('is not reachable on a non-loopback address', async () => {
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!external) return; // no LAN interface on this machine: nothing to probe
    const code = await new Promise<string>((resolve) => {
      const s = net.connect({ host: external.address, port: handle!.port });
      s.once('connect', () => {
        s.destroy();
        resolve('connected');
      });
      s.once('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
    });
    expect(code).toBe('ECONNREFUSED');
  });

  it('accepts /ws, completes the handshake and never offers the hooks consent dialog', async () => {
    const { socket, messages } = await openHall(`?token=${token}`);
    await new Promise((r) => setTimeout(r, 300));
    socket.close();

    expect(messages.map((m) => m.type)).toEqual(
      expect.arrayContaining(['providerCapabilities', 'settingsLoaded', 'existingAgents']),
    );
    expect(messages.some((m) => m.type === 'hooksConsentRequest')).toBe(false);
  });

  it('rejects every settings-writing message, even from a client holding the server token', async () => {
    const { socket } = await openHall(`?token=${token}`);
    const attempts: Record<string, unknown>[] = [
      { type: 'setHooksEnabled', providerId: 'claude', enabled: true },
      { type: 'hooksConsentResponse', providerId: 'claude', choice: 'granted' },
      { type: 'setSoundEnabled', enabled: false },
      { type: 'setWatchAllSessions', enabled: false },
      { type: 'setAlwaysShowLabels', enabled: true },
      { type: 'saveLayout', layout: { version: 1, cols: 1, rows: 1, tiles: [], furniture: [] } },
      { type: 'saveAgentSeats', seats: { '1': { palette: 1 } } },
      { type: 'addExternalAssetDirectory', path: '/tmp/evil' },
      { type: 'saveAreaMappings', mappings: { a: ['b'] } },
      { type: 'closeAgent', id: 1 },
    ];
    for (const attempt of attempts) socket.send(JSON.stringify(attempt));
    await new Promise((r) => setTimeout(r, 400));
    socket.close();

    expect(fs.existsSync(settingsPath())).toBe(false);
    expect(fs.existsSync(path.join(tmpBase, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(tmpBase, '.diwan', 'config.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpBase, '.diwan', 'layout.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpBase, '.diwan', 'hooks'))).toBe(false);
  });

  it('a hook sequence over HTTP puts a scholar in the hall, for a project nobody tracked (watch-all)', async () => {
    const transcript = path.join(tmpBase, '.claude', 'projects', '-tmp-proj', 's1.jsonl');
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, '');
    const common = {
      session_id: 's1-aaaa-bbbb',
      transcript_path: transcript,
      cwd: '/tmp/proj',
    };
    const { socket, messages } = await openHall();

    expect(await postHook({ ...common, hook_event_name: 'SessionStart', source: 'startup' })).toBe(
      200,
    );
    expect(
      await postHook({
        ...common,
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_use_id: 'tu1',
        tool_input: { file_path: '/tmp/proj/a.ts' },
      }),
    ).toBe(200);
    await waitFor(() => messages.some((m) => m.type === 'agentToolStart'));
    expect(
      await postHook({
        ...common,
        hook_event_name: 'PostToolUse',
        tool_name: 'Read',
        tool_use_id: 'tu1',
      }),
    ).toBe(200);
    await waitFor(() => messages.some((m) => m.type === 'agentToolDone'));
    socket.close();

    const created = messages.find((m) => m.type === 'agentCreated');
    expect(created).toMatchObject({ folderName: 'proj' });
    const start = messages.find((m) => m.type === 'agentToolStart');
    expect(start).toMatchObject({ id: created!.id });
    expect(String(start!.status)).toMatch(/Read/);
  });

  it('refuses hook events without the bearer token', async () => {
    const event = { session_id: 's2', hook_event_name: 'SessionStart', cwd: '/tmp' };
    expect(await postHook(event, 'Bearer wrong')).toBe(401);
    expect(await postHook(event, '')).toBe(401);
  });

  it('the real hook script reaches the server (script -> server.json -> POST -> hall)', async () => {
    const { socket, messages } = await openHall();
    const common = { session_id: 's3-aaaa-bbbb', cwd: '/tmp/viahook' };
    for (const event of [
      { ...common, hook_event_name: 'SessionStart', source: 'startup' },
      { ...common, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'tu9' },
    ]) {
      const code = await new Promise<number | null>((resolve) => {
        const child = spawn('node', [HOOK_SCRIPT], {
          env: { ...process.env, HOME: tmpBase },
          stdio: ['pipe', 'ignore', 'ignore'],
        });
        child.on('close', resolve);
        child.stdin.end(JSON.stringify(event));
      });
      expect(code).toBe(0);
    }
    await waitFor(() => messages.some((m) => m.type === 'agentToolStart'));
    socket.close();
    expect(messages.find((m) => m.type === 'agentCreated')).toMatchObject({
      folderName: 'viahook',
    });
  });

  it('findRunningDiwan sees the live server and stop() removes the discovery file', async () => {
    expect(await findRunningDiwan()).toBe(handle!.port);

    await handle!.stop();
    handle = null;

    expect(fs.existsSync(serverJsonPath())).toBe(false);
    expect(await findRunningDiwan()).toBeNull();
  });
});

describe('findRunningDiwan', () => {
  it('ignores a server.json whose pid is dead', async () => {
    await handle!.stop();
    handle = null;
    fs.mkdirSync(path.dirname(serverJsonPath()), { recursive: true });
    fs.writeFileSync(
      serverJsonPath(),
      JSON.stringify({ port: 3200, pid: 2_147_483_000, token: 't' }),
    );
    expect(await findRunningDiwan()).toBeNull();
  });
});

describe('brandConsole', () => {
  const fakeConsole = () => {
    const lines: unknown[][] = [];
    return {
      lines,
      fake: {
        log: (...a: unknown[]) => void lines.push(['log', ...a]),
        info: (...a: unknown[]) => void lines.push(['info', ...a]),
        warn: (...a: unknown[]) => void lines.push(['warn', ...a]),
        error: (...a: unknown[]) => void lines.push(['error', ...a]),
      },
    };
  };

  it('verbose: shows runtime log lines as Diwan, leaves other lines alone', () => {
    const { lines, fake } = fakeConsole();
    brandConsole(fake, { verbose: true });
    fake.log('[Pixel Agents] Server: listening', 1);
    fake.error('[AssetLoader] ok');
    fake.warn({ not: 'a string' });
    expect(lines).toEqual([
      ['log', '[Diwan] Server: listening', 1],
      ['error', '[AssetLoader] ok'],
      ['warn', { not: 'a string' }],
    ]);
  });

  it('quiet by default: the runtime chatter is dropped; Diwan lines, warnings and errors stay', () => {
    const { lines, fake } = fakeConsole();
    brandConsole(fake);
    fake.log('[Pixel Agents] Agent 1 - Tool start: toolu_1 Read hall.py');
    fake.info('[Pixel Agents] Timer: permission timer set for Agent 1');
    fake.log('[AssetLoader] loaded 12 sprites');
    fake.log('\u{1F4E6} Found 25 furniture folders');
    fake.log('  \u2713 Loaded 38 / 38 assets');
    fake.log('[Diwan] brain setup joined');
    fake.log('Diwan \u00b7 House of Wisdom \u2192 http://127.0.0.1:3200/');
    fake.log('Press Ctrl-C to stop.');
    fake.warn('[Pixel Agents] could not read layout');
    fake.error('[Pixel Agents] boom');
    expect(lines).toEqual([
      ['log', '[Diwan] brain setup joined'],
      ['log', 'Diwan \u00b7 House of Wisdom \u2192 http://127.0.0.1:3200/'],
      ['log', 'Press Ctrl-C to stop.'],
      ['warn', '[Diwan] could not read layout'],
      ['error', '[Diwan] boom'],
    ]);
  });
});

describe('logSessionEvents', () => {
  const tick = () => new Promise((r) => setImmediate(r));
  const agent = (over: Record<string, unknown> = {}) =>
    ({ id: 1, isExternal: true, folderName: 'caravan', ...over }) as never;

  it('the joined line carries no secret from the first prompt', async () => {
    const store = new AgentStateStore();
    const said: string[] = [];
    const stop = logSessionEvents(store, (line) => said.push(line));
    const a = agent();
    store.set(1, a);
    updateSessionLabel(1, a, store, {
      type: 'user',
      message: {
        role: 'user',
        content: 'run GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 deploy',
      },
    });
    await tick();
    stop();
    expect(said).toEqual(['[Diwan] run deploy joined']);
  });

  it('names joins, leaves and approvals by session label, never by number', async () => {
    const store = new AgentStateStore();
    const said: string[] = [];
    const stop = logSessionEvents(store, (line) => said.push(line));

    const a = agent();
    store.set(1, a);
    (a as { sessionLabel?: string }).sessionLabel = 'brain setup'; // the seed lands right after adoption
    await tick();
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    store.broadcast({ type: 'agentToolPermission', id: 1 }); // the same request, once
    store.broadcast({ type: 'agentToolPermissionClear', id: 1 });
    store.broadcast({ type: 'subagentToolPermission', id: 1, parentToolId: 't', toolId: 's' });
    store.delete(1);

    expect(said).toEqual([
      '[Diwan] brain setup joined',
      '[Diwan] brain setup needs your approval',
      '[Diwan] brain setup needs your approval',
      '[Diwan] brain setup left',
    ]);
    expect(said.join('\n')).not.toMatch(/Agent \d/);
    stop();
  });

  it('says a launched scholar needs approval once per request, however often the lamp is re-asserted', async () => {
    const store = new AgentStateStore();
    const said: string[] = [];
    const stop = logSessionEvents(store, (line) => said.push(line));
    store.set(1, agent());
    await tick();
    const approvals = () => said.filter((l) => l.endsWith('needs your approval'));
    // The user's own hook announces first, then the bridge's steerApproval: still one line.
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    store.broadcast({ type: 'steerApproval', id: 1, requestId: 'r1', tool: 'Bash', detail: 'ls' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    store.broadcast({ type: 'steerApproval', id: 1, requestId: 'r1', tool: 'Bash', detail: 'ls' });
    // The transcript lags: tool starts clear the lamp, the re-assert fires again. Still one.
    store.broadcast({ type: 'agentToolStart', id: 1, toolId: 't', status: 'x' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(approvals()).toHaveLength(1);
    // Resolved; the next request is announced (bridge first this time), also once.
    store.broadcast({ type: 'steerApprovalClear', id: 1, requestId: 'r1', outcome: 'approved' });
    store.broadcast({ type: 'steerApproval', id: 1, requestId: 'r2', tool: 'Bash', detail: 'pwd' });
    store.broadcast({ type: 'agentToolPermission', id: 1 });
    expect(approvals()).toHaveLength(2);
    store.broadcast({ type: 'steerApprovalClear', id: 1, requestId: 'r2', outcome: 'denied' });
    store.broadcast({ type: 'steerApproval', id: 1, requestId: 'r3', tool: 'Bash', detail: 'id' });
    expect(approvals()).toHaveLength(3);
    stop();
  });

  it('follows a label that changes, falls back to the folder, and skips teammates', async () => {
    const store = new AgentStateStore();
    const said: string[] = [];
    logSessionEvents(store, (line) => said.push(line));

    store.set(1, agent());
    store.set(2, agent({ id: 2, leadAgentId: 1 }));
    await tick();
    store.broadcast({ type: 'agentLabel', id: 1, label: 'ledger audit' });
    store.delete(2);
    store.delete(1);

    expect(said).toEqual(['[Diwan] caravan joined', '[Diwan] ledger audit left']);
  });
});
