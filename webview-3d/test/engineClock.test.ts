import { describe, expect, it, vi } from 'vitest';

import type { Character } from '../../webview-ui/src/office/types.js';
import { attachEngine, createEngineClock, engineSignature } from '../src/engine/engineClock.js';

function fakeTime() {
  let t = 0;
  let pending: (() => void) | null = null;
  let cancelled = 0;
  return {
    now: () => t,
    schedule: (cb: () => void) => {
      pending = cb;
      return () => {
        if (pending === cb) pending = null;
        cancelled++;
      };
    },
    /** advance time by ms and fire the pending scheduled callback */
    step(ms: number) {
      t += ms;
      const cb = pending;
      pending = null;
      cb?.();
    },
    get hasPending() {
      return pending !== null;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

const char = (over: Partial<Character> = {}): Character =>
  ({
    id: 1,
    x: 8,
    y: 8,
    dir: 0,
    state: 'idle',
    frame: 0,
    isActive: false,
    bubbleType: null,
    currentTool: null,
    isSubagent: false,
    matrixEffect: null,
    matrixEffectTimer: 0,
    contextTokens: 0,
    maxContextTokens: 0,
    isGreeter: false,
    ...over,
  }) as unknown as Character;

describe('createEngineClock', () => {
  it('clamps dt to maxDt and reports it in seconds', () => {
    const time = fakeTime();
    const clock = createEngineClock({ ...time, maxDt: 0.1 });
    const dts: number[] = [];
    clock.onTick((dt) => dts.push(dt));
    clock.start();
    time.step(16);
    time.step(5000); // hidden tab came back
    expect(dts[0]).toBeCloseTo(0.016, 5);
    expect(dts[1]).toBe(0.1);
  });

  it('ticks once per schedule and stops on stop()', () => {
    const time = fakeTime();
    const clock = createEngineClock({ ...time, maxDt: 0.1 });
    const cb = vi.fn();
    clock.onTick(cb);
    expect(clock.running).toBe(false);
    clock.start();
    expect(clock.running).toBe(true);
    time.step(16);
    time.step(16);
    expect(cb).toHaveBeenCalledTimes(2);
    clock.stop();
    expect(clock.running).toBe(false);
    expect(time.hasPending).toBe(false);
    time.step(16);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('start() twice does not double the tick rate; unsubscribe works', () => {
    const time = fakeTime();
    const clock = createEngineClock({ ...time, maxDt: 0.1 });
    const cb = vi.fn();
    const off = clock.onTick(cb);
    clock.start();
    clock.start();
    time.step(16);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    time.step(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('attachEngine', () => {
  it('updates the engine once per tick and invalidates only when the signature changes', () => {
    const time = fakeTime();
    const clock = createEngineClock({ ...time, maxDt: 0.1 });
    const chars = [char()];
    const update = vi.fn();
    const invalidate = vi.fn();
    attachEngine(clock, { update, getCharacters: () => chars }, invalidate, time.now);
    clock.start();

    time.step(16); // first tick: nothing known yet -> counts as a change
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.closeTo(0.016, 5));
    expect(invalidate).toHaveBeenCalledTimes(1);

    time.step(16); // unchanged
    expect(update).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);

    chars[0] = char({ x: 40 });
    time.step(16);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('records when the engine was last quiet', () => {
    const time = fakeTime();
    const clock = createEngineClock({ ...time, maxDt: 0.1 });
    const chars = [char()];
    const stats = attachEngine(
      clock,
      { update: () => {}, getCharacters: () => chars },
      () => {},
      time.now,
    );
    clock.start();
    time.step(16);
    time.step(16);
    expect(stats.lastQuietAt).toBe(32);
    chars[0] = char({ x: 99 });
    time.step(16);
    expect(stats.lastQuietAt).toBe(32);
  });
});

describe('engineSignature', () => {
  it('is stable for identical state and ignores sub-centimetre jitter', () => {
    const a = engineSignature([char({ x: 8, y: 8 })]);
    expect(engineSignature([char({ x: 8, y: 8 })])).toBe(a);
    // 1 tile = 1.5 m = 16 px, so 1 cm = 0.0107 px
    expect(engineSignature([char({ x: 8.003, y: 8 })])).toBe(a);
  });

  it('changes with position, visual state and membership', () => {
    const base = engineSignature([char()]);
    expect(engineSignature([char({ x: 12 })])).not.toBe(base);
    expect(engineSignature([char({ bubbleType: 'permission' })])).not.toBe(base);
    expect(engineSignature([char({ frame: 1 })])).not.toBe(base);
    expect(engineSignature([char(), char({ id: 2 })])).not.toBe(base);
  });
});
