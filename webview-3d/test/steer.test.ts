import { describe, expect, it, vi } from 'vitest';

import type { ClientMessage, ServerMessage } from '../../core/src/messages.js';
import * as fs from 'fs';
import * as path from 'path';

import { MODEL_CHOICES, TOKEN_BUDGET_DEFAULT } from '../../core/src/steerChoices.js';
import { budgetOf } from '../src/steer/NewScholarDialog.js';
import {
  approveArmed,
  askSize,
  askWarnings,
  modelLine,
  stickToBottom,
  tokenBar,
  tokenLine,
  turnLine,
} from '../src/steer/SteerCard.js';
import {
  answersReady,
  answersReadyText,
  EMPTY_STEER,
  steerReducer,
  unseenAnswer,
} from '../src/steer/steerStore.js';
import { takeSteerToken } from '../src/steer/token.js';
import { FilteredTransport, isAllowedOutgoing } from '../src/transport/filteredTransport.js';
import { createLiveTransport } from '../src/transport/liveTransport.js';

const TOKEN = 'ab'.repeat(32);
const AGENT = {
  model: 'claude-sonnet-5-5',
  effort: 'high',
  tokensUsed: 0,
  tokenCap: 500000,
  turn: 'working',
  answerSeq: 0,
};

function fakeDoc(content: string | null) {
  let removed = false;
  return {
    doc: {
      querySelector: () =>
        content === null || removed
          ? null
          : { getAttribute: () => content, remove: () => void (removed = true) },
    } as unknown as Document,
    wasRemoved: () => removed,
  };
}

describe('the steer token on the page', () => {
  it('is read from the meta tag, then removed from the DOM', () => {
    const f = fakeDoc(TOKEN);
    expect(takeSteerToken(f.doc)).toBe(TOKEN);
    expect(f.wasRemoved()).toBe(true);
    expect(takeSteerToken(f.doc)).toBeNull();
  });
  it('is absent in plain diwan, and anything malformed is ignored', () => {
    expect(takeSteerToken(fakeDoc(null).doc)).toBeNull();
    expect(takeSteerToken(fakeDoc('short').doc)).toBeNull();
    expect(takeSteerToken(fakeDoc('zz'.repeat(32)).doc)).toBeNull();
  });
});

describe('steer transport rules', () => {
  const launch = {
    type: 'steerLaunch',
    project: '/p',
    task: 't',
    model: 'claude-sonnet-5-5',
    effort: 'high',
    tokenBudget: 500000,
  } as ClientMessage;
  it('read-only pages can send only webviewReady', () => {
    expect(isAllowedOutgoing({ type: 'webviewReady' } as ClientMessage)).toBe(true);
    expect(isAllowedOutgoing(launch)).toBe(false);
    expect(isAllowedOutgoing({ type: 'steerStop', id: 1 } as ClientMessage)).toBe(false);
  });
  it('a steer page can also send steer messages, and still nothing else', () => {
    expect(isAllowedOutgoing(launch, true)).toBe(true);
    expect(isAllowedOutgoing({ type: 'saveLayout' } as unknown as ClientMessage, true)).toBe(false);
    expect(isAllowedOutgoing({ type: 'setHooksEnabled' } as unknown as ClientMessage, true)).toBe(
      false,
    );
  });
  it('the filtered transport enforces it', () => {
    const sent: ClientMessage[] = [];
    const inner = {
      send: (m: ClientMessage) => sent.push(m),
      onMessage: () => () => {},
      onStateChange: () => () => {},
      dispose: () => {},
      ready: Promise.resolve(),
      state: 'connected',
    } as never;
    const plan = {} as never;
    new FilteredTransport(inner, plan, false).send(launch);
    expect(sent).toEqual([]);
    new FilteredTransport(inner, plan, true).send(launch);
    expect(sent).toEqual([launch]);
  });
  it('steerHello is the first message on the socket, ahead of webviewReady, and never in the URL', async () => {
    const frames: string[] = [];
    const urls: string[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor(url: string) {
        urls.push(url);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(d: string) {
        frames.push(d);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWs);
    try {
      const t = createLiveTransport(TOKEN, { protocol: 'http:', host: '127.0.0.1:3200' }, () => {});
      t.send({ type: 'webviewReady' });
      await t.ready;
      expect(JSON.parse(frames[0])).toEqual({ type: 'steerHello', token: TOKEN });
      expect(JSON.parse(frames[1])).toEqual({ type: 'webviewReady' });
      expect(urls[0]).toBe('ws://127.0.0.1:3200/ws');
      t.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('plain diwan sends no hello', async () => {
    const frames: string[] = [];
    class FakeWs {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      constructor() {
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(d: string) {
        frames.push(d);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeWs);
    try {
      const t = createLiveTransport(null, { protocol: 'http:', host: 'h:1' }, () => {});
      t.send({ type: 'webviewReady' });
      await t.ready;
      expect(frames.map((f) => JSON.parse(f).type)).toEqual(['webviewReady']);
      t.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('steerReducer', () => {
  const at = 1000;
  const run = (msgs: unknown[]) =>
    msgs.reduce<typeof EMPTY_STEER>((s, m) => steerReducer(s, m as ServerMessage, at), EMPTY_STEER);

  it('starts without control', () => {
    expect(EMPTY_STEER.control).toBe(false);
  });
  it('welcome grants controls and lists projects', () => {
    const s = run([{ type: 'steerWelcome', projects: [{ path: '/p', name: 'p' }] }]);
    expect(s.control).toBe(true);
    expect(s.projects).toEqual([{ path: '/p', name: 'p' }]);
  });
  it('tracks a launched scholar, its spend and why it stopped', () => {
    let s = run([
      { type: 'steerAgent', id: 3, steerable: true, running: true, ...AGENT, tokensUsed: 4000 },
    ]);
    expect(s.agents[3]).toEqual({ running: true, ...AGENT, tokensUsed: 4000 });
    s = steerReducer(
      s,
      {
        type: 'steerAgent',
        id: 3,
        steerable: true,
        running: false,
        ...AGENT,
        tokensUsed: 512000,
        stopped: 'token budget reached (512K of 500K)',
      },
      at,
    );
    expect(s.agents[3]).toMatchObject({
      running: false,
      stopped: 'token budget reached (512K of 500K)',
    });
  });
  it('queues requests oldest first, ignores duplicates, clears by id', () => {
    const ask = (requestId: string) => ({
      type: 'steerApproval',
      id: 3,
      requestId,
      tool: 'Bash',
      detail: 'ls',
    });
    let s = run([ask('a'), ask('b'), ask('a')]);
    expect(s.asks[3].map((a) => a.requestId)).toEqual(['a', 'b']);
    s = steerReducer(
      s,
      { type: 'steerApprovalClear', id: 3, requestId: 'a', outcome: 'approved' },
      at,
    );
    expect(s.asks[3].map((a) => a.requestId)).toEqual(['b']);
    s = steerReducer(
      s,
      { type: 'steerApprovalClear', id: 3, requestId: 'b', outcome: 'timeout' },
      at,
    );
    expect(s.asks[3]).toBeUndefined();
    expect(
      steerReducer(
        s,
        { type: 'steerApprovalClear', id: 3, requestId: 'zz', outcome: 'denied' },
        at,
      ),
    ).toBe(s);
  });
  it('a scholar that leaves takes its state with it', () => {
    const s = run([
      { type: 'steerAgent', id: 3, steerable: true, running: true, ...AGENT },
      { type: 'steerApproval', id: 3, requestId: 'a', tool: 'Bash', detail: 'ls' },
      { type: 'agentClosed', id: 3 },
    ]);
    expect(s.agents[3]).toBeUndefined();
    expect(s.asks[3]).toBeUndefined();
  });
  it('keeps a refusal for the dialog and marks an accepted launch', () => {
    let s = run([{ type: 'steerResult', ok: false, ref: 'r1', error: 'not a registered project' }]);
    expect(s.notice).toMatchObject({ text: 'not a registered project', ref: 'r1' });
    s = steerReducer(s, { type: 'steerResult', ok: true, ref: 'r2' }, at);
    expect(s.launchedRef).toBe('r2');
    expect(s.notice).toBeNull();
  });
  it('ignores everything else', () => {
    const s = run([{ type: 'agentToolStart', id: 1 }]);
    expect(s).toBe(EMPTY_STEER);
  });
});

describe('the launch form rules', () => {
  it('offers exactly the three exact models, no Default and no Fable', () => {
    expect(MODEL_CHOICES.map((m) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ]);
  });
  it('parses the token budget field: 500K, 1.5M, plain digits, and the 50K-10M range', () => {
    expect(TOKEN_BUDGET_DEFAULT).toBe(500_000);
    expect(budgetOf('500K')).toBe(500_000);
    expect(budgetOf('1.5M')).toBe(1_500_000);
    expect(budgetOf('250000')).toBe(250_000);
    expect(budgetOf('49K')).toBeNull();
    expect(budgetOf('10.1M')).toBeNull();
    expect(budgetOf('$2')).toBeNull();
    expect(budgetOf('')).toBeNull();
  });
});

describe('the scholar card tokens (format, bar, colour law)', () => {
  const a = { model: 'claude-sonnet-5-5', effort: 'high', tokensUsed: 182_300, tokenCap: 500_000 };
  it('formats the model line and the token line', () => {
    expect(modelLine(a)).toBe('Sonnet 5.5 · high');
    expect(modelLine({ ...a, effort: 'xhigh' })).toBe('Sonnet 5.5 · extra high');
    expect(tokenLine(a)).toBe('182K of 500K tokens');
  });
  it('turns amber past 80 percent', () => {
    expect(tokenBar(a)).toEqual({ pct: 36, warn: false });
    expect(tokenBar({ ...a, tokensUsed: 400_000 }).warn).toBe(false);
    expect(tokenBar({ ...a, tokensUsed: 400_001 }).warn).toBe(true);
    expect(tokenBar({ ...a, tokensUsed: 900_000 }).pct).toBe(100);
  });
  it('the bar colours are warm, never within 25 degrees of the cobalt 226', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf-8');
    const rules = css.match(/\.ic-bar[^{]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThanOrEqual(3);
    for (const hex of rules.join('\n').match(/#[0-9a-f]{6}/gi) ?? []) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      expect(sat < 0.35 || Math.abs(h - 226) > 25).toBe(true);
    }
  });
  it('the launch dialog and card source carry no dollar wording', () => {
    for (const f of ['NewScholarDialog.tsx', 'SteerCard.tsx', 'steerStore.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '../src/steer', f), 'utf-8');
      expect(src).not.toMatch(/USD|Usd|\busd\b|dollar|\$\d|>est\.</);
    }
  });
});

describe('the approval card model (H1, M1, L3)', () => {
  const at = 5;
  const full = {
    type: 'steerApproval' as const,
    id: 3,
    requestId: 'a',
    tool: 'Bash',
    detail: 'ls ⟦U+202E⟧',
    hidden: true,
    masked: 2,
    truncated: true,
    lines: 4,
    chars: 90,
    extras: [{ name: 'dangerouslyDisableSandbox', value: 'true', warn: true }],
  };
  it('keeps the card fields', () => {
    const s = steerReducer(EMPTY_STEER, full, at);
    expect(s.asks[3][0]).toMatchObject({ hidden: true, masked: 2, lines: 4, chars: 90 });
    expect(s.asks[3][0].extras).toEqual(full.extras);
  });
  it('defaults them for a redacted feed copy', () => {
    const s = steerReducer(
      EMPTY_STEER,
      {
        ...full,
        hidden: undefined,
        masked: undefined,
        lines: undefined,
        chars: undefined,
        extras: undefined,
        truncated: undefined,
      },
      at,
    );
    expect(s.asks[3][0]).toMatchObject({ hidden: false, masked: 0, truncated: false, extras: [] });
  });
  it('the full card replaces a redacted copy that arrived first, keeping its place and time', () => {
    let s = steerReducer(
      EMPTY_STEER,
      { type: 'steerApproval', id: 3, requestId: 'a', tool: 'Bash', detail: 'x' },
      10,
    );
    s = steerReducer(
      s,
      { type: 'steerApproval', id: 3, requestId: 'b', tool: 'Bash', detail: 'y' },
      11,
    );
    const upgraded = steerReducer(s, full, 99);
    expect(upgraded.asks[3].map((a) => a.requestId)).toEqual(['a', 'b']);
    expect(upgraded.asks[3][0]).toMatchObject({ hidden: true, at: 10 });
    expect(steerReducer(upgraded, full, 100)).toBe(upgraded);
  });
  it('warnings come in order: hidden, masked, truncated; plus the size line', () => {
    const ask = steerReducer(EMPTY_STEER, full, at).asks[3][0];
    const w = askWarnings(ask);
    expect(w).toHaveLength(3);
    expect(w[0]).toMatch(/Hidden characters/);
    expect(w[1]).toBe('2 values masked');
    expect(w[2]).toMatch(/Only the start/);
    expect(askSize(ask)).toBe('4 lines · 90 characters');
    expect(askWarnings({ ...ask, hidden: false, masked: 1, truncated: false })).toEqual([
      '1 value masked',
    ]);
  });
  it('Approve needs the guard AND the end of the command in view', () => {
    expect(approveArmed(true, true)).toBe(true);
    expect(approveArmed(true, false)).toBe(false);
    expect(approveArmed(false, true)).toBe(false);
  });
});

const reply = (id: number, seq: number, role: string, text: string) =>
  ({ type: 'steerReply', id, seq, role, text, at: 1 }) as ServerMessage;

const at = 1000;
const run = (msgs: unknown[]) =>
  msgs.reduce<typeof EMPTY_STEER>((s, m) => steerReducer(s, m as ServerMessage, at), EMPTY_STEER);

describe('replies in the store', () => {
  it('keeps them in order, ignores a repeat, caps at 200, and drops them with the scholar', () => {
    let s = run([reply(3, 1, 'user', 'task'), reply(3, 2, 'assistant', 'hi')]);
    expect(s.replies[3].map((r) => r.text)).toEqual(['task', 'hi']);
    expect(steerReducer(s, reply(3, 2, 'assistant', 'hi'), at)).toBe(s); // a late client's repeat
    for (let i = 3; i < 260; i++) s = steerReducer(s, reply(3, i, 'tool', `step ${i}`), at);
    expect(s.replies[3]).toHaveLength(200);
    expect(s.replies[3].at(-1)!.seq).toBe(259);
    expect(
      steerReducer(s, { type: 'agentClosed', id: 3 } as ServerMessage, at).replies[3],
    ).toBeUndefined();
  });
  it('keeps each scholar apart', () => {
    const s = run([reply(1, 1, 'user', 'a'), reply(2, 1, 'user', 'b')]);
    expect(s.replies[1][0].text).toBe('a');
    expect(s.replies[2][0].text).toBe('b');
  });
});

describe('Answer ready', () => {
  const agent = (turn: string, answerSeq: number) => ({ ...AGENT, running: true, turn, answerSeq });
  it('an answered turn is unseen until the user has looked at that answer', () => {
    expect(unseenAnswer(agent('answered', 1), undefined)).toBe(true);
    expect(unseenAnswer(agent('answered', 1), 1)).toBe(false);
    expect(unseenAnswer(agent('answered', 2), 1)).toBe(true); // a newer answer after a look
    expect(unseenAnswer(agent('working', 1), undefined)).toBe(false);
    expect(unseenAnswer(agent('error', 0), undefined)).toBe(false);
    expect(unseenAnswer(undefined, undefined)).toBe(false);
  });
  it('counts the scholars with an answer waiting, and says it in the HUD', () => {
    const agents = { 1: agent('answered', 1), 2: agent('working', 0), 3: agent('answered', 2) };
    expect(answersReady(agents, {})).toEqual([1, 3]);
    expect(answersReady(agents, { 1: 1 })).toEqual([3]);
    expect(answersReadyText(1)).toBe('1 answer ready');
    expect(answersReadyText(2)).toBe('2 answers ready');
  });
  it('the card state line reads Answer ready, or says the turn failed', () => {
    expect(turnLine({ turn: 'answered' })).toBe('Answer ready');
    expect(turnLine({ turn: 'working' })).toBeNull();
    expect(turnLine({ turn: 'error', turnError: 'max turns' })).toBe(
      'The last turn ended with an error: max turns',
    );
    expect(turnLine({ turn: 'answered', stopped: 'stopped' })).toBeNull();
  });
  it('the conversation follows the newest entry unless the reader scrolled up', () => {
    expect(stickToBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1000 })).toBe(true);
    expect(stickToBottom({ scrollTop: 100, clientHeight: 300, scrollHeight: 1000 })).toBe(false);
  });
  it('the marker, the card line and the HUD count use warm colours, never cobalt', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/index.css'), 'utf-8');
    const marker = fs.readFileSync(
      path.resolve(__dirname, '../src/scene/SpeechBubble.tsx'),
      'utf-8',
    );
    const rules = (
      css.match(
        /\.(answer-scroll|hud-answer|ic-turn|ic-convo|ic-msg|ic-who|ic-step)[^{]*\{[^}]*\}/g,
      ) ?? []
    ).join('\n');
    const svg = marker.slice(marker.indexOf('function AnswerScroll'));
    const hexes = [...rules.matchAll(/#[0-9a-f]{6}/gi), ...svg.matchAll(/#[0-9a-f]{6}/gi)].map(
      (m) => m[0],
    );
    expect(hexes.length).toBeGreaterThan(5);
    for (const hex of hexes) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const l = (max + min) / 2;
      const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
      let h = 0;
      if (d) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = (h * 60 + 360) % 360;
      }
      expect(sat < 0.35 || Math.abs(h - 226) > 25).toBe(true);
    }
  });
});
