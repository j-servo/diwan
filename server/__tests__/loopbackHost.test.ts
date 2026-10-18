import * as http from 'http';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { HttpServerHandle } from '../src/httpServer.js';
import { createHttpServer, isLoopbackHost } from '../src/httpServer.js';

describe('isLoopbackHost', () => {
  it('accepts loopback names with or without a port', () => {
    for (const h of ['127.0.0.1:3200', 'localhost:3200', '[::1]:3200', '127.0.0.1', 'LOCALHOST:1'])
      expect(isLoopbackHost(h), h).toBe(true);
  });
  it('rejects every other name, including rebinding look-alikes', () => {
    for (const h of [
      undefined,
      '',
      'evil.com:3200',
      '127.0.0.1.evil.com',
      'localhost.evil.com:3200',
      '192.168.1.5:3200',
      '0.0.0.0:3200',
    ])
      expect(isLoopbackHost(h), String(h)).toBe(false);
  });
});

/** GET with an explicit Host header (fetch cannot set one). */
function get(port: number, host: string, path = '/api/health'): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ hostname: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });
}

describe('read-only (Diwan) server refuses non-loopback Host headers', () => {
  let handle: HttpServerHandle | undefined;
  afterEach(async () => {
    await handle?.app.close();
    handle = undefined;
  });

  it('serves loopback hosts and answers a DNS-rebound name with 421', async () => {
    handle = await createHttpServer({
      embedded: false,
      readOnly: true,
      token: 't',
      store: new AgentStateStore(),
    });
    expect(await get(handle.port, `127.0.0.1:${handle.port}`)).toBe(200);
    expect(await get(handle.port, `localhost:${handle.port}`)).toBe(200);
    expect(await get(handle.port, `evil.com:${handle.port}`)).toBe(421);
    expect(await get(handle.port, `evil.com:${handle.port}`, '/ws')).toBe(421);
  });

  it('leaves the non-Diwan server as it was', async () => {
    handle = await createHttpServer({ embedded: false, token: 't', store: new AgentStateStore() });
    expect(await get(handle.port, `evil.com:${handle.port}`)).toBe(200);
  });
});
