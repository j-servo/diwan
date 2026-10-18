import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { createHttpServer, type HttpServerHandle } from '../src/httpServer.js';

describe('POST /api/hooks body shape', () => {
  let handle: HttpServerHandle | undefined;
  afterEach(async () => {
    await handle?.app.close();
    handle = undefined;
  });

  const post = async (body: string) => {
    const onHookEvent = vi.fn();
    handle = await createHttpServer({
      embedded: true,
      token: 'tok',
      store: new AgentStateStore(),
      onHookEvent,
    });
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/hooks/claude',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      payload: body,
    });
    return { res, onHookEvent };
  };

  it.each(['null', '[]', '"x"', '42', 'true'])(
    'answers 400 to a non-object body (%s)',
    async (b) => {
      const { res, onHookEvent } = await post(b);
      expect(res.statusCode).toBe(400);
      expect(onHookEvent).not.toHaveBeenCalled();
    },
  );

  it('still accepts an object body', async () => {
    const { res, onHookEvent } = await post(
      JSON.stringify({ session_id: 's', hook_event_name: 'Stop' }),
    );
    expect(res.statusCode).toBe(200);
    expect(onHookEvent).toHaveBeenCalledTimes(1);
  });
});
