import { describe, expect, it, vi } from 'vitest';

import { InputQueue, type RunnerLaunch, SdkRunner } from '../../src/steer/runner.js';

/** A fake SDK: records query() params and lets the test feed messages. Nothing real starts. */
function fakeSdk() {
  const calls: Array<{ prompt: AsyncIterable<unknown>; options: Record<string, unknown> }> = [];
  const interrupt = vi.fn(async () => undefined);
  let push: (m: unknown) => void = () => {};
  let finish: () => void = () => {};
  let fail: (e: unknown) => void = () => {};
  const sdk = {
    query: (params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
      calls.push(params);
      const queue: unknown[] = [];
      let wake: (() => void) | null = null;
      let done = false;
      let error: unknown;
      push = (m) => {
        queue.push(m);
        wake?.();
      };
      finish = () => {
        done = true;
        wake?.();
      };
      fail = (e) => {
        error = e;
        wake?.();
      };
      const gen = {
        interrupt,
        async *[Symbol.asyncIterator]() {
          for (;;) {
            if (error) throw error;
            if (queue.length) yield queue.shift();
            else if (done) return;
            else await new Promise<void>((r) => (wake = r));
          }
        },
      };
      return gen;
    },
  };
  return {
    sdk,
    calls,
    interrupt,
    push: (m: unknown) => push(m),
    finish: () => finish(),
    fail: (e: unknown) => fail(e),
  };
}

function launchOpts(over: Partial<RunnerLaunch> = {}) {
  const onUsage = vi.fn();
  const onEffort = vi.fn();
  const onEnd = vi.fn();
  const canUseTool = vi.fn(async () => ({ behavior: 'deny' as const, message: 'x' }));
  const opts: RunnerLaunch = {
    sessionId: '11111111-2222-4333-8444-555555555555',
    cwd: '/work/a',
    task: 'write the readme',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    canUseTool,
    onUsage,
    onEffort,
    onEnd,
    ...over,
  };
  return { opts, onUsage, onEffort, onEnd, canUseTool };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('SdkRunner', () => {
  it('launches with exactly the agreed options and nothing else', async () => {
    const f = fakeSdk();
    const { opts } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    expect(f.calls).toHaveLength(1);
    const o = f.calls[0].options;
    expect(Object.keys(o).sort()).toEqual(
      [
        'abortController',
        'canUseTool',
        'cwd',
        'effort',
        'model',
        'permissionMode',
        'sessionId',
        'settingSources',
      ].sort(),
    );
    expect(o.cwd).toBe('/work/a');
    expect(o.model).toBe('claude-sonnet-5-5');
    expect(o.effort).toBe('high');
    expect('maxBudgetUsd' in o).toBe(false);
    expect(o.permissionMode).toBe('default');
    expect(o.settingSources).toEqual(['user', 'project', 'local']);
    expect(o.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    expect(o.abortController).toBeInstanceOf(AbortController);
    expect(typeof o.canUseTool).toBe('function');
    for (const forbidden of ['bypassPermissions', 'acceptEdits', 'dontAsk', 'auto']) {
      expect(JSON.stringify(o.permissionMode)).not.toContain(forbidden);
    }
  });

  it('streams the task first, then follow-ups, into the SAME query', async () => {
    const f = fakeSdk();
    const session = new SdkRunner(async () => f.sdk as never).start(launchOpts().opts);
    await tick();
    session.followUp('and add a license');
    const it = f.calls[0].prompt[Symbol.asyncIterator]();
    const first = (await it.next()).value as { message: { content: string } };
    const second = (await it.next()).value as { message: { content: string } };
    expect(first.message.content).toBe('write the readme');
    expect(second.message.content).toBe('and add a license');
    expect(f.calls).toHaveLength(1);
  });

  it('routes canUseTool to the bridge with the SDK abort signal', async () => {
    const f = fakeSdk();
    const { opts, canUseTool } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    const signal = new AbortController().signal;
    const verdict = await (f.calls[0].options.canUseTool as Function)(
      'Bash',
      { command: 'ls' },
      { signal },
    );
    expect(canUseTool).toHaveBeenCalledWith('Bash', { command: 'ls' }, signal, expect.any(Object));
    expect(verdict).toEqual({ behavior: 'deny', message: 'x' });
  });

  it('interrupt calls query.interrupt()', async () => {
    const f = fakeSdk();
    const session = new SdkRunner(async () => f.sdk as never).start(launchOpts().opts);
    await tick();
    await session.interrupt();
    expect(f.interrupt).toHaveBeenCalledTimes(1);
  });

  it('stop aborts the controller and ends once as closed', async () => {
    const f = fakeSdk();
    const { opts, onEnd } = launchOpts();
    const session = new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    session.stop();
    session.stop();
    expect((f.calls[0].options.abortController as AbortController).signal.aborted).toBe(true);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('closed', undefined);
  });

  const asst = (
    id: string | undefined,
    u: Record<string, number>,
    parent: string | null = null,
  ) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { id, usage: u },
  });

  it('counts input + cache creation + cache read + output, once per message id', async () => {
    const f = fakeSdk();
    const { opts, onUsage } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    const u = {
      input_tokens: 10,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 30,
      output_tokens: 40,
    };
    f.push(asst('m1', u));
    f.push(asst('m1', u)); // the same API message again: not counted twice
    f.push(asst('m1', { ...u, output_tokens: 90 })); // usage grew as the stream finished
    f.push(asst('m2', u));
    await tick();
    expect(onUsage.mock.calls.map((c) => c[0])).toEqual([100, 100, 150, 250]);
  });

  it('counts sub-agent (Task) messages', async () => {
    const f = fakeSdk();
    const { opts, onUsage } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    f.push(asst('m1', { input_tokens: 5, output_tokens: 5 }));
    f.push(asst('s1', { input_tokens: 100, output_tokens: 50 }, 'toolu_task'));
    await tick();
    expect(onUsage).toHaveBeenLastCalledWith(160);
  });

  it('reconciles to the result cumulative modelUsage, then keeps counting on top', async () => {
    const f = fakeSdk();
    const { opts, onUsage } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    f.push(asst('m1', { input_tokens: 100, output_tokens: 100 }));
    f.push({
      type: 'result',
      subtype: 'success',
      modelUsage: {
        a: {
          inputTokens: 150,
          outputTokens: 100,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 25,
        },
        b: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    });
    f.push(asst('m1', { input_tokens: 100, output_tokens: 100 })); // already counted
    f.push(asst('m2', { input_tokens: 10, output_tokens: 10 }));
    await tick();
    expect(onUsage.mock.calls.map((c) => c[0])).toEqual([200, 340, 340, 360]);
  });

  it('a session ending, even via an error result, is not a budget stop (the manager decides that)', async () => {
    const f = fakeSdk();
    const { opts, onEnd } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    f.push({ type: 'result', subtype: 'success', modelUsage: {} });
    await tick();
    expect(onEnd).not.toHaveBeenCalled();
    expect((f.calls[0].options.abortController as AbortController).signal.aborted).toBe(false);
  });

  it('reports the effort the session says it is actually on', async () => {
    const f = fakeSdk();
    const { opts, onEffort } = launchOpts({ effort: 'max' });
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    f.push({ type: 'system', subtype: 'init', effort: 'xhigh' });
    f.push({ type: 'system', subtype: 'init', effort: null });
    await tick();
    expect(onEffort).toHaveBeenCalledTimes(1);
    expect(onEffort).toHaveBeenCalledWith('xhigh');
  });

  it('hands over top-level text and tool calls, not sub-agent ones', async () => {
    const f = fakeSdk();
    const onText = vi.fn();
    const onTool = vi.fn();
    new SdkRunner(async () => f.sdk as never).start(launchOpts({ onText, onTool }).opts);
    await tick();
    const m = (parent: string | null, content: unknown[]) => ({
      type: 'assistant',
      parent_tool_use_id: parent,
      message: { id: 'a', usage: {}, content },
    });
    f.push(
      m(null, [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '## Done\n**all good**' },
        { type: 'text', text: '   ' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ]),
    );
    f.push(m('toolu_task', [{ type: 'text', text: 'sub-agent chatter' }]));
    await tick();
    expect(onText.mock.calls).toEqual([['## Done\n**all good**']]);
    expect(onTool.mock.calls).toEqual([['Bash', { command: 'ls' }]]);
  });

  it('reports how each turn ended', async () => {
    const f = fakeSdk();
    const onTurnEnd = vi.fn();
    new SdkRunner(async () => f.sdk as never).start(launchOpts({ onTurnEnd }).opts);
    await tick();
    f.push({ type: 'result', subtype: 'success', is_error: false, modelUsage: {} });
    f.push({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['boom'],
      modelUsage: {},
    });
    f.push({ type: 'result', subtype: 'error_max_turns', is_error: true, modelUsage: {} });
    await tick();
    expect(onTurnEnd.mock.calls.map((c) => c[0])).toEqual([
      { ok: true },
      { ok: false, error: 'boom' },
      { ok: false, error: 'error_max_turns' },
    ]);
  });

  it('turns a thrown error into an end with its message', async () => {
    const f = fakeSdk();
    const { opts, onEnd } = launchOpts();
    new SdkRunner(async () => f.sdk as never).start(opts);
    await tick();
    f.fail(new Error('not logged in'));
    await tick();
    expect(onEnd).toHaveBeenCalledWith('error', 'not logged in');
  });

  it('a failed SDK load is an error end, not a crash', async () => {
    const { opts, onEnd } = launchOpts();
    new SdkRunner(async () => {
      throw new Error('cannot load');
    }).start(opts);
    await tick();
    expect(onEnd).toHaveBeenCalledWith('error', 'cannot load');
  });
});

describe('InputQueue', () => {
  it('delivers in order, waits for pushes, ends when closed', async () => {
    const q = new InputQueue<number>();
    const it = q[Symbol.asyncIterator]();
    q.push(1);
    expect((await it.next()).value).toBe(1);
    const waiting = it.next();
    q.push(2);
    expect((await waiting).value).toBe(2);
    const last = it.next();
    q.close();
    expect((await last).done).toBe(true);
    q.push(3);
    expect((await it.next()).done).toBe(true);
  });
});
