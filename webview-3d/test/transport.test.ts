// webview-3d/test/transport.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { ClientMessage, ServerMessage } from '../../core/src/messages.js';
import type { MessageTransport, TransportState } from '../../core/src/transport.js';
import { OfficeState } from '../../webview-ui/src/office/engine/officeState.js';
import type { OfficeLayout } from '../../webview-ui/src/office/types.js';
import type { DemoTimeline } from '../src/demo/types.js';
import { DEMO_TIMELINE } from '../src/demo/timeline.js';
import { DemoTransport } from '../src/transport/demoTransport.js';
import {
  FilteredTransport,
  filterIncoming,
  isAllowedOutgoing,
} from '../src/transport/filteredTransport.js';
import { liveSocketUrl, shouldReloadOnStateChange } from '../src/transport/liveTransport.js';
import { resolveDemoSpeed, resolveDirector, resolveMode } from '../src/transport/mode.js';
import { shouldRedirect } from '../vite/redirectUpstreamTransport.js';

const PLAN = { version: 1, cols: 2, rows: 2, tiles: [1, 1, 1, 1], furniture: [] } as OfficeLayout;

describe('mode', () => {
  test('?demo selects demo, ?demo=0 forces live, env flag is the default', () => {
    expect(resolveMode('?demo=1', undefined)).toBe('demo');
    expect(resolveMode('?demo', undefined)).toBe('demo');
    expect(resolveMode('?demo=0', '1')).toBe('live');
    expect(resolveMode('', '1')).toBe('demo');
    expect(resolveMode('', undefined)).toBe('live');
  });
  test('demo speed is positive and capped at 20', () => {
    expect(resolveDemoSpeed('?demoSpeed=4')).toBe(4);
    expect(resolveDemoSpeed('?demoSpeed=-2')).toBe(1);
    expect(resolveDemoSpeed('?demoSpeed=abc')).toBe(1);
    expect(resolveDemoSpeed('?demoSpeed=100')).toBe(20);
    expect(resolveDemoSpeed('')).toBe(1);
  });
});

describe('DemoTransport', () => {
  const timeline: DemoTimeline = {
    setup: [{ type: 'providerCapabilities', readingTools: ['Read'], subagentToolNames: ['Agent'] }],
    steps: [
      { at: 100, msg: { type: 'agentCreated', id: 1 } },
      { at: 300, msg: { type: 'agentClosed', id: 1 } },
    ],
    durationMs: 500,
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('setup on webviewReady, steps on schedule, loop replays once per loop', () => {
    const t = new DemoTransport(timeline, { loop: true, speed: 1 });
    const got: string[] = [];
    t.onMessage((m) => got.push(m.type));
    t.send({ type: 'webviewReady' } as ClientMessage);
    expect(got).toEqual(['providerCapabilities']);
    vi.advanceTimersByTime(100);
    expect(got).toEqual(['providerCapabilities', 'agentCreated']);
    vi.advanceTimersByTime(400); // t=500: loop restarts
    vi.advanceTimersByTime(100); // t=600: second agentCreated
    expect(got.filter((x) => x === 'agentCreated')).toHaveLength(2);
    t.dispose();
  });

  test('each loop offsets agent ids so a still-despawning id is never reused', () => {
    const t = new DemoTransport(timeline, { loop: true, speed: 1 });
    const ids: number[] = [];
    t.onMessage((m) => {
      if (m.type === 'agentCreated') ids.push(m.id);
    });
    t.send({ type: 'webviewReady' } as ClientMessage);
    vi.advanceTimersByTime(700); // loop 0 and loop 1 creates
    vi.advanceTimersByTime(500); // loop 2 create
    expect(ids).toEqual([1, 1001, 2001]);
    t.dispose();
  });

  test('real OfficeState keeps every agent of loop 2 at speed 20 without update ticks', () => {
    const os = new OfficeState();
    const t = new DemoTransport(DEMO_TIMELINE, { loop: true, speed: 20 });
    const created: number[][] = [[], []];
    let loop = 0;
    t.onMessage((m) => {
      if (m.type === 'agentCreated') {
        os.addAgent(m.id);
        created[loop]?.push(m.id);
      } else if (m.type === 'agentClosed') {
        os.removeAgent(m.id);
      }
    });
    t.send({ type: 'webviewReady' } as ClientMessage);
    vi.advanceTimersByTime(DEMO_TIMELINE.durationMs / 20 - 1); // all of loop 0
    loop = 1;
    vi.advanceTimersByTime(500); // loop 1 creates (last at 450 ms) fire while loop 0 agents still despawn
    expect(created[1]).toHaveLength(3);
    for (const id of created[1]!) {
      expect(os.characters.has(id)).toBe(true);
      expect(os.characters.get(id)?.matrixEffect).not.toBe('despawn');
    }
    t.dispose();
  });

  test('a repeated webviewReady (React StrictMode) re-sends setup but never doubles the loop', () => {
    const t = new DemoTransport(timeline, { loop: false, speed: 1 });
    const got: string[] = [];
    t.onMessage((m) => got.push(m.type));
    t.send({ type: 'webviewReady' } as ClientMessage);
    t.send({ type: 'webviewReady' } as ClientMessage);
    vi.advanceTimersByTime(1000);
    expect(got.filter((x) => x === 'providerCapabilities')).toHaveLength(2);
    expect(got.filter((x) => x === 'agentCreated')).toHaveLength(1);
  });

  test('speed 2 halves the schedule; dispose stops playback', () => {
    const t = new DemoTransport(timeline, { loop: true, speed: 2 });
    const got: string[] = [];
    t.onMessage((m) => got.push(m.type));
    t.send({ type: 'webviewReady' } as ClientMessage);
    vi.advanceTimersByTime(50);
    expect(got).toContain('agentCreated');
    t.dispose();
    vi.advanceTimersByTime(10_000);
    expect(got.filter((x) => x === 'agentCreated')).toHaveLength(1);
  });
});

describe('filterIncoming', () => {
  test('layoutLoaded always carries our world floor plan', () => {
    const out = filterIncoming({ type: 'layoutLoaded', layout: { version: 1, cols: 99 } }, PLAN);
    expect(out).toEqual({ type: 'layoutLoaded', layout: PLAN });
  });
  test('sprite and furniture messages are dropped so our catalog survives', () => {
    for (const type of [
      'furnitureAssetsLoaded',
      'characterSpritesLoaded',
      'petSpritesLoaded',
      'floorTilesLoaded',
      'wallTilesLoaded',
      'carpetTilesLoaded',
      'hooksConsentRequest',
    ]) {
      expect(filterIncoming({ type } as ServerMessage, PLAN)).toBeNull();
    }
  });
  test('existingAgents loses foreign seat ids but keeps palette', () => {
    const out = filterIncoming(
      {
        type: 'existingAgents',
        agents: [1],
        agentMeta: { '1': { palette: 2, hueShift: 30, seatId: 'their-chair' } },
        folderNames: {},
        externalAgents: {},
      },
      PLAN,
    );
    expect(out).toMatchObject({ agentMeta: { '1': { palette: 2, hueShift: 30 } } });
    expect((out as { agentMeta: Record<string, object> }).agentMeta['1']).not.toHaveProperty(
      'seatId',
    );
  });
  test('agent activity passes through untouched', () => {
    const msg: ServerMessage = { type: 'agentToolPermission', id: 3 };
    expect(filterIncoming(msg, PLAN)).toBe(msg);
  });
});

describe('outgoing', () => {
  test('only webviewReady leaves the client', () => {
    expect(isAllowedOutgoing({ type: 'webviewReady' } as ClientMessage)).toBe(true);
    expect(
      isAllowedOutgoing({ type: 'saveAgentSeats', seats: {} } as unknown as ClientMessage),
    ).toBe(false);
    expect(isAllowedOutgoing({ type: 'setHooksEnabled' } as unknown as ClientMessage)).toBe(false);
  });
});

describe('FilteredTransport', () => {
  function fakeInner() {
    let handler: ((m: ServerMessage) => void) | null = null;
    let stateHandler: ((s: TransportState) => void) | null = null;
    const sent: ClientMessage[] = [];
    const inner: MessageTransport = {
      ready: Promise.resolve(),
      state: 'connecting',
      send: (m) => sent.push(m),
      onMessage: (h) => ((handler = h), () => (handler = null)),
      onStateChange: (h) => ((stateHandler = h), () => (stateHandler = null)),
      dispose: () => {},
    };
    return {
      inner,
      sent,
      push: (m: ServerMessage) => handler?.(m),
      setState: (s: TransportState) => stateHandler?.(s),
    };
  }

  test('only the first layoutLoaded per subscription is forwarded', () => {
    const f = fakeInner();
    const t = new FilteredTransport(f.inner, PLAN);
    const first: ServerMessage[] = [];
    t.onMessage((m) => first.push(m));
    f.push({ type: 'layoutLoaded', layout: null });
    f.push({ type: 'layoutLoaded', layout: null });
    expect(first).toHaveLength(1);
    // fakeInner keeps one handler, so a re-subscription replaces the first one.
    const second: ServerMessage[] = [];
    t.onMessage((m) => second.push(m));
    f.push({ type: 'layoutLoaded', layout: null });
    f.push({ type: 'layoutLoaded', layout: null });
    expect(second).toHaveLength(1);
  });

  test('filters both directions and forwards connection state', () => {
    const f = fakeInner();
    const t = new FilteredTransport(f.inner, PLAN);
    const got: ServerMessage[] = [];
    const states: TransportState[] = [];
    t.onMessage((m) => got.push(m));
    t.onStateChange((s) => states.push(s));
    f.push({ type: 'furnitureAssetsLoaded' } as ServerMessage);
    f.push({ type: 'agentCreated', id: 7 });
    t.send({ type: 'webviewReady' } as ClientMessage);
    t.send({ type: 'saveAgentSeats', seats: {} } as unknown as ClientMessage);
    f.setState('disconnected');
    expect(got).toEqual([{ type: 'agentCreated', id: 7 }]);
    expect(f.sent).toEqual([{ type: 'webviewReady' }]);
    expect(states).toEqual(['disconnected']);
    expect(t.state).toBe('connecting');
  });
});

describe('live socket url', () => {
  test('same host, /ws path, never forwards a token', () => {
    expect(liveSocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
    expect(liveSocketUrl({ protocol: 'https:', host: 'diwan.example' })).toBe(
      'wss://diwan.example/ws',
    );
  });
});

describe('live reconnect', () => {
  test('reloads only when a lost connection comes back', () => {
    const states: TransportState[] = ['connecting', 'connected', 'reconnecting', 'disconnected'];
    for (const prev of states) {
      for (const next of states) {
        expect(shouldReloadOnStateChange(prev, next)).toBe(
          prev === 'reconnecting' && next === 'connected',
        );
      }
    }
  });
});

describe('upstream transport redirect', () => {
  test('redirects only the upstream transport module', () => {
    const upstream = '/repo/webview-ui/src/transport/index.ts';
    expect(shouldRedirect('/repo/webview-ui/src/transport/index.ts', upstream)).toBe(true);
    expect(shouldRedirect('/repo/webview-ui/src/transport/index.ts?v=1', upstream)).toBe(true);
    expect(shouldRedirect('/repo/webview-ui/src/transport/webSocketTransport.ts', upstream)).toBe(
      false,
    );
    expect(shouldRedirect(null, upstream)).toBe(false);
  });
});

describe('resolveDirector', () => {
  test('is on in demo, off in live, and overridable', () => {
    expect(resolveDirector('', 'demo')).toBe(true);
    expect(resolveDirector('', 'live')).toBe(false);
    expect(resolveDirector('?director=0', 'demo')).toBe(false);
    expect(resolveDirector('?director=1', 'live')).toBe(true);
  });
});
