/**
 * Diwan's Claude Code hook script, installed as ~/.diwan/hooks/claude-hook.js.
 *
 * Claude Code runs this for every installed event and, for PreToolUse and
 * PermissionRequest, lets hook OUTPUT steer its own decisions. So the contract is
 * absolute: print nothing, always exit 0, never hold Claude up. When Diwan is not
 * running (no server.json, a dead pid, no answer) the script gives up at once.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, SERVER_JSON_NAME } from '../../../core/src/constants.js';
import { DIWAN_BRAND } from '../brand.js';
import { DIWAN_HOOK_DEADLINE_MS } from '../constants.js';
import { isServerTarget } from '../serverConfig.js';

function done(): never {
  process.exit(0);
}

/** The running Diwan server's address, or null when there is none worth calling. */
function readTarget(): { port: number; pid: number; token: string } | null {
  try {
    const file = path.join(os.homedir(), DIWAN_BRAND.dirName, SERVER_JSON_NAME);
    const target = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!isServerTarget(target)) return null;
    process.kill(target.pid, 0); // throws when the pid is gone
    return target;
  } catch {
    return null;
  }
}

/**
 * Before the bearer token leaves this process, make sure the thing on the port is the Diwan that
 * wrote server.json: a recycled port may now belong to another program, and the token must never
 * reach it. The server proves it holds the token by answering HMAC(token, our fresh nonce); the
 * token itself is not sent until that matches. Any doubt: give up silently.
 */
function handshake(target: { port: number; pid: number; token: string }, then: () => void): void {
  const nonce = crypto.randomBytes(16).toString('hex');
  const req = http.get(
    { hostname: '127.0.0.1', port: target.port, path: `/api/health?nonce=${nonce}` },
    (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => {
        if (body.length < 4096) body += c;
      });
      res.on('end', () => {
        try {
          const health = JSON.parse(body) as { pid?: unknown; proof?: unknown };
          const expected = crypto
            .createHmac('sha256', target.token)
            .update(`diwan-health:${nonce}`)
            .digest('hex');
          const proof = typeof health.proof === 'string' ? health.proof : '';
          const same =
            proof.length === expected.length &&
            crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(expected));
          if (res.statusCode === 200 && same && health.pid === target.pid) return then();
        } catch {
          /* not our server */
        }
        done();
      });
    },
  );
  req.on('error', done);
}

function send(target: { port: number; token: string }, body: string): void {
  const req = http.request(
    {
      hostname: '127.0.0.1',
      port: target.port,
      path: `${HOOK_API_PREFIX}/claude`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${target.token}`,
      },
    },
    (res) => {
      res.resume();
      done();
    },
  );
  req.on('error', done);
  req.end(body);
}

function main(): void {
  setTimeout(done, DIWAN_HOOK_DEADLINE_MS);
  process.on('uncaughtException', done);
  process.stdin.on('error', done);

  const target = readTarget();
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => (input += chunk));
  process.stdin.on('end', () => {
    if (!target) return done();
    try {
      JSON.parse(input); // forward only well-formed payloads
      handshake(target, () => send(target, input));
    } catch {
      done();
    }
  });
}

main();
