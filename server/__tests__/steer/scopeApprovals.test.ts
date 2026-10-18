import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovalBridge,
  approvalDetail,
  approvalTimeoutMs,
  type Outcome,
  type PendingApproval,
} from '../../src/steer/approvals.js';
import {
  grantScope,
  isControlOrigin,
  newControlToken,
  RateLimiter,
  tokensEqual,
} from '../../src/steer/scope.js';
import { parseControl } from '../../src/steer/validate.js';

describe('scope gate', () => {
  const token = newControlToken();
  const base = { steerMode: true, token, expectedToken: token, port: 3200 };
  const ok = 'http://127.0.0.1:3200';

  it('the token is 256 random bits, fresh each time', () => {
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(newControlToken()).not.toBe(token);
  });

  it('grants control for the right token plus the right Origin', () => {
    expect(grantScope({ ...base, origin: ok })).toEqual({ read: true, control: true });
    expect(grantScope({ ...base, origin: 'http://localhost:3200' }).control).toBe(true);
  });

  it.each([
    ['no token', { token: undefined, origin: ok }],
    ['a wrong token', { token: 'x'.repeat(64), origin: ok }],
    ['a token of the wrong length', { token: 'abc', origin: ok }],
    ['a non-string token', { token: 12345, origin: ok }],
    ['a missing Origin', { origin: undefined }],
    ['an empty Origin', { origin: '' }],
    ['a foreign Origin', { origin: 'http://evil.example' }],
    ['a loopback Origin on another port', { origin: 'http://127.0.0.1:3201' }],
    ['https on our port', { origin: 'https://127.0.0.1:3200' }],
    ['a look-alike host', { origin: 'http://127.0.0.1:3200.evil.example' }],
    [
      'the Vite dev origin (L10: there is no dev flag any more)',
      { origin: 'http://127.0.0.1:5173' },
    ],
    ['a non-steer mode', { steerMode: false, origin: ok }],
  ])('stays read-only with %s', (_name, override) => {
    expect(grantScope({ ...base, ...override })).toEqual({ read: true, control: false });
  });

  it('never accepts the Vite dev origin', () => {
    expect(isControlOrigin('http://localhost:5173', 3200)).toBe(false);
    expect(isControlOrigin('http://127.0.0.1:5173', 3200)).toBe(false);
  });

  it('compares tokens in constant time without throwing on a length mismatch', () => {
    expect(tokensEqual('a', 'abc')).toBe(false);
    expect(tokensEqual(token, token)).toBe(true);
    expect(tokensEqual(token, '')).toBe(false);
    expect(tokensEqual('', '')).toBe(false);
  });

  it('rate-limits a connection to 20 control messages per second', () => {
    let t = 1000;
    const rl = new RateLimiter(20, () => t);
    for (let i = 0; i < 20; i++) expect(rl.hit()).toBe(true);
    expect(rl.hit()).toBe(false);
    t += 1001;
    expect(rl.hit()).toBe(true);
  });
});

describe('control message schemas', () => {
  const launch = {
    type: 'steerLaunch',
    project: '/p',
    task: 'do it',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    tokenBudget: 500_000,
  };
  it('accepts a good launch and the model list', () => {
    expect(parseControl(launch).ok).toBe(true);
    expect(parseControl({ ...launch, model: 'claude-haiku-5-5' }).ok).toBe(true);
    expect(parseControl({ ...launch, model: 'claude-opus-5-5' }).ok).toBe(true);
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'])
      expect(parseControl({ ...launch, effort }).ok).toBe(true);
    expect(parseControl({ ...launch, tokenBudget: 50_000 }).ok).toBe(true);
    expect(parseControl({ ...launch, tokenBudget: 10_000_000 }).ok).toBe(true);
  });
  it.each([
    ['empty task', { task: '  ' }],
    ['9,000-character task', { task: 'x'.repeat(9000) }],
    ['unknown model', { model: 'claude-fake' }],
    ['the old default model', { model: 'default' }],
    ['a missing model', { model: undefined }],
    ['fable', { model: 'claude-fable-5' }],
    ['unknown effort', { effort: 'ludicrous' }],
    ['a missing effort', { effort: undefined }],
    ['budget under the floor', { tokenBudget: 49_999 }],
    ['budget over the ceiling', { tokenBudget: 10_000_001 }],
    ['NaN budget', { tokenBudget: NaN }],
    ['string budget', { tokenBudget: '500K' }],
    ['a dollar budget', { budgetUsd: 2 }],
    ['an extra field', { permissionMode: 'bypassPermissions' }],
    ['a huge path', { project: '/'.repeat(5000) }],
  ])('refuses a launch with %s', (_n, override) => {
    expect(parseControl({ ...launch, ...override }).ok).toBe(false);
  });
  it('validates ids, requestIds and text', () => {
    expect(parseControl({ type: 'steerStop', id: 0 }).ok).toBe(false);
    expect(parseControl({ type: 'steerStop', id: 1.5 }).ok).toBe(false);
    expect(parseControl({ type: 'steerStop', id: '3' }).ok).toBe(false);
    expect(parseControl({ type: 'steerAnswer', requestId: 'r', allow: 'yes' }).ok).toBe(false);
    expect(parseControl({ type: 'steerFollowUp', id: 2, text: 'y'.repeat(8001) }).ok).toBe(false);
    expect(parseControl({ type: 'steerFollowUp', id: 2, text: 'hello' }).ok).toBe(true);
    expect(parseControl({ type: 'nope' }).ok).toBe(false);
  });
});

describe('canUseTool bridge', () => {
  let settled: Array<[PendingApproval, Outcome]>;
  let pending: PendingApproval[];
  let bridge: ApprovalBridge;

  beforeEach(() => {
    vi.useFakeTimers();
    settled = [];
    pending = [];
    bridge = new ApprovalBridge(
      { onPending: (p) => pending.push(p), onSettled: (p, o) => settled.push([p, o]) },
      1000,
    );
  });
  afterEach(() => vi.useRealTimers());

  it('approve allows, with the original input', async () => {
    const input = { command: 'ls' };
    const verdict = bridge.request('s1', 'Bash', input);
    expect(bridge.answer(pending[0].requestId, true)).toBe(true);
    await expect(verdict).resolves.toEqual({ behavior: 'allow', updatedInput: input });
  });

  it('deny denies with the agreed message', async () => {
    const verdict = bridge.request('s1', 'Bash', { command: 'rm x' });
    bridge.answer(pending[0].requestId, false);
    await expect(verdict).resolves.toEqual({ behavior: 'deny', message: 'Denied in Diwan' });
  });

  it('no answer in time is a deny, never an allow', async () => {
    const verdict = bridge.request('s1', 'Bash', { command: 'ls' });
    await vi.advanceTimersByTimeAsync(1001);
    await expect(verdict).resolves.toEqual({ behavior: 'deny', message: 'No answer from Diwan' });
    expect(settled[0][1]).toBe('timeout');
  });

  it('a stopped scholar and a shutdown deny everything pending', async () => {
    const a = bridge.request('s1', 'Bash', { command: 'a' });
    const b = bridge.request('s2', 'Bash', { command: 'b' });
    const c = bridge.request('s1', 'Edit', { file_path: 'c' });
    bridge.denyOwner('s1');
    await expect(a).resolves.toMatchObject({ behavior: 'deny' });
    await expect(c).resolves.toMatchObject({ behavior: 'deny' });
    expect(bridge.pending()).toHaveLength(1);
    bridge.denyAll('shutdown');
    await expect(b).resolves.toMatchObject({ behavior: 'deny' });
    expect(bridge.pending()).toHaveLength(0);
  });

  it('the SDK aborting the call (signal) denies', async () => {
    const ac = new AbortController();
    const verdict = bridge.request('s1', 'Bash', { command: 'a' }, ac.signal);
    ac.abort();
    await expect(verdict).resolves.toMatchObject({ behavior: 'deny' });
    const already = bridge.request('s1', 'Bash', { command: 'a' }, ac.signal);
    await expect(already).resolves.toMatchObject({ behavior: 'deny' });
    expect(pending).toHaveLength(1);
  });

  it('resolves exactly once: a second answer or a stale id is rejected', async () => {
    const verdict = bridge.request('s1', 'Bash', { command: 'ls' });
    const id = pending[0].requestId;
    expect(bridge.answer(id, false)).toBe(true);
    expect(bridge.answer(id, true)).toBe(false);
    expect(bridge.answer('not-a-request', true)).toBe(false);
    await expect(verdict).resolves.toMatchObject({ behavior: 'deny' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toHaveLength(1);
  });

  it('shows the whole multi-line command, redacted', () => {
    const cmd =
      'curl -H "Authorization: Bearer abcdef123456" x\nline2\nline3\nline4\nline5\nline6\nline7\nline8';
    const { detail, truncated } = approvalDetail('Bash', { command: cmd });
    expect(detail.split('\n')).toHaveLength(8);
    expect(detail).not.toContain('abcdef123456');
    expect(truncated).toBe(false);
  });

  it('flags a command longer than it can show', () => {
    const { detail, truncated } = approvalDetail('Bash', { command: 'x'.repeat(5000) });
    expect(truncated).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(4000);
  });

  it('reads the timeout from DIWAN_APPROVAL_TIMEOUT_MS and falls back to 15 minutes', () => {
    expect(approvalTimeoutMs({ DIWAN_APPROVAL_TIMEOUT_MS: '250' })).toBe(250);
    expect(approvalTimeoutMs({})).toBe(15 * 60_000);
    expect(approvalTimeoutMs({ DIWAN_APPROVAL_TIMEOUT_MS: 'soon' })).toBe(15 * 60_000);
    expect(approvalTimeoutMs({ DIWAN_APPROVAL_TIMEOUT_MS: '-5' })).toBe(15 * 60_000);
  });
});
