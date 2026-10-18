import { spawn } from 'child_process';
import { buildSync } from 'esbuild';
import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DIWAN_HOOK_DEADLINE_MS } from '../src/constants.js';
import { healthProof } from '../src/httpServer.js';

// The script is built from source here, exactly as esbuild.js builds it, so this test needs
// no prior `npm run build:diwan`. It runs under a temp HOME and never reads the real one.
let outDir: string;
let HOOK_SCRIPT: string;
let tmpHome: string;

/** Generous: Node's own start-up is part of the measured time on a loaded machine. */
const FAST_MS = 600;

beforeAll(() => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-hook-build-'));
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

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-hook-home-'));
});

afterEach(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

function writeServerJson(port: number, pid = process.pid, token = 'tok'): void {
  const dir = path.join(tmpHome, '.diwan');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'server.json'),
    JSON.stringify({ port, pid, token, startedAt: Date.now(), servesSpa: true, protocol: 1 }),
  );
}

interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function runHook(stdin: string): Promise<HookRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [HOOK_SCRIPT], {
      env: { ...process.env, HOME: tmpHome },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }));
    child.stdin.end(stdin);
  });
}

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)),
  );
}

const PRE_TOOL_USE = JSON.stringify({
  session_id: 'abc12345-0000',
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path: '/tmp/x' },
  cwd: '/tmp/proj',
});

function expectSilentSuccess(run: HookRun): void {
  expect(run.code).toBe(0);
  expect(run.stdout).toBe('');
  expect(run.stderr).toBe('');
}

describe('diwan hook script', () => {
  it('gives up within the deadline when Diwan is not running (no server.json)', async () => {
    const run = await runHook(PRE_TOOL_USE);
    expectSilentSuccess(run);
    expect(run.ms).toBeLessThan(FAST_MS);
    expect(DIWAN_HOOK_DEADLINE_MS).toBeLessThanOrEqual(150);
  });

  it('ignores a server.json whose pid is dead', async () => {
    writeServerJson(65_000, 2_147_483_000);
    const run = await runHook(PRE_TOOL_USE);
    expectSilentSuccess(run);
    expect(run.ms).toBeLessThan(FAST_MS);
  });

  it('ignores a corrupt server.json', async () => {
    fs.mkdirSync(path.join(tmpHome, '.diwan'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.diwan', 'server.json'), '{ nope');
    expectSilentSuccess(await runHook(PRE_TOOL_USE));
  });

  it('gives up on a server that accepts the connection and never answers', async () => {
    const sockets: net.Socket[] = [];
    const hung = net.createServer((s) => sockets.push(s));
    writeServerJson(await listen(hung));

    const run = await runHook(PRE_TOOL_USE);

    sockets.forEach((s) => s.destroy());
    hung.close();
    expectSilentSuccess(run);
    expect(run.ms).toBeLessThan(FAST_MS);
  });

  it('exits quietly when the port is closed', async () => {
    const probe = net.createServer();
    const port = await listen(probe);
    probe.close();
    writeServerJson(port);
    expectSilentSuccess(await runHook(PRE_TOOL_USE));
  });

  /** A stand-in Diwan: answers the health handshake like the real one, records what it is sent. */
  function fakeDiwan(opts: { token: string; pid?: number; proof?: 'good' | 'bad' | 'none' }) {
    const seen: { url?: string; auth?: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        if (req.url?.startsWith('/api/health')) {
          const nonce = new URL(req.url, 'http://x').searchParams.get('nonce') ?? '';
          const mode = opts.proof ?? 'good';
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              status: 'ok',
              pid: opts.pid ?? process.pid,
              ...(mode === 'none'
                ? {}
                : { proof: mode === 'good' ? healthProof(opts.token, nonce) : 'f'.repeat(64) }),
            }),
          );
          return;
        }
        seen.push({ url: req.url, auth: req.headers.authorization, body });
        res.end('ok');
      });
    });
    return { server, seen };
  }

  it('POSTs the payload to /api/hooks/claude with the bearer token, after the health handshake', async () => {
    const { server, seen } = fakeDiwan({ token: 'secret-token' });
    writeServerJson(await listen(server), process.pid, 'secret-token');

    const run = await runHook(PRE_TOOL_USE);

    server.close();
    expectSilentSuccess(run);
    expect(seen).toEqual([
      { url: '/api/hooks/claude', auth: 'Bearer secret-token', body: PRE_TOOL_USE },
    ]);
    expect(run.ms).toBeLessThan(FAST_MS);
  });

  it.each([
    ['a stranger that cannot prove the token', { proof: 'none' as const }],
    ['a server with the wrong proof', { proof: 'bad' as const }],
    ['a server of the right token but another pid', { proof: 'good' as const, pid: 1 }],
  ])('LOW-5: never sends the bearer token to %s on a recycled port', async (_n, extra) => {
    const { server, seen } = fakeDiwan({ token: 'secret-token', ...extra });
    writeServerJson(await listen(server), process.pid, 'secret-token');

    const run = await runHook(PRE_TOOL_USE);

    server.close();
    expectSilentSuccess(run);
    expect(seen).toEqual([]);
  });

  it('LOW-5: a port that answers health with a non-Diwan body also gets nothing', async () => {
    const seen: string[] = [];
    const server = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization ?? ''}`);
      res.end('<html>some other app</html>');
    });
    writeServerJson(await listen(server), process.pid, 'secret-token');
    expectSilentSuccess(await runHook(PRE_TOOL_USE));
    server.close();
    expect(seen.every((l) => !l.includes('secret-token') && l.startsWith('GET /api/health'))).toBe(
      true,
    );
  });

  it('prints nothing even when the server answers with a decision-shaped body or an error', async () => {
    for (const [status, body] of [
      [200, '{"decision":"block","reason":"nope"}'],
      [500, 'boom'],
      [401, 'unauthorized'],
    ] as const) {
      const server = http.createServer((_req, res) => {
        res.statusCode = status;
        res.end(body);
      });
      writeServerJson(await listen(server));
      expectSilentSuccess(await runHook(PRE_TOOL_USE));
      server.close();
    }
  });

  it('forwards nothing for malformed or empty stdin, and still exits 0 silently', async () => {
    let hits = 0;
    const server = http.createServer((_req, res) => {
      hits++;
      res.end('ok');
    });
    writeServerJson(await listen(server));

    expectSilentSuccess(await runHook('not json'));
    expectSilentSuccess(await runHook(''));

    server.close();
    expect(hits).toBe(0);
  });
});
