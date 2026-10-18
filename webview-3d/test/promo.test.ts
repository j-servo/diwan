import { describe, expect, test } from 'vitest';

import { CUTS } from '../src/promo/cuts.js';
import { PROMO_COPY } from '../src/promo/copy.js';
import { resolvePromo, seededRandom } from '../src/promo/promoMode.js';
import { cameraAt, fadeAt, mixAt } from '../src/promo/rigMath.js';
import { evalSpline } from '../src/promo/spline.js';
import { PREROLL_SEC } from '../src/promo/timelines.js';
import { DemoTransport } from '../src/transport/demoTransport.js';
import type { ServerMessage } from '../../core/src/messages.js';

const ctx = { aspect: 16 / 9, lampOf: () => [10, 1, 3] as [number, number, number], centreZ: 7 };

describe('spline', () => {
  const keys = [
    { t: 0, v: [0], hold: true },
    { t: 2, v: [4] },
    { t: 4, v: [10] },
    { t: 6, v: [10], hold: true },
  ];
  test('passes through every key and clamps outside', () => {
    for (const k of keys) expect(evalSpline(keys, k.t)[0]).toBeCloseTo(k.v[0]!, 9);
    expect(evalSpline(keys, -3)[0]).toBe(0);
    expect(evalSpline(keys, 99)[0]).toBe(10);
  });
  test('eased: slow at rest keys, velocity continuous through the middle', () => {
    const v = (t: number) =>
      (evalSpline(keys, t + 1e-4)[0]! - evalSpline(keys, t - 1e-4)[0]!) / 2e-4;
    expect(Math.abs(v(0.001))).toBeLessThan(0.05);
    expect(Math.abs(v(5.999))).toBeLessThan(0.05);
    expect(Math.abs(v(2 - 1e-3) - v(2 + 1e-3))).toBeLessThan(0.01);
  });
});

describe('camera', () => {
  test('is deterministic and portrait backs the camera off', () => {
    const seg = CUTS['main']!.segments[1]!;
    const a = cameraAt(seg.keys, 5, ctx);
    expect(cameraAt(seg.keys, 5, ctx)).toEqual(a);
    const p = cameraAt(seg.keys, 5, { ...ctx, aspect: 0.8 });
    const d = (c: typeof a) => Math.hypot(...c.pos.map((x, i) => x - c.target[i]!));
    expect(d(p)).toBeGreaterThan(d(a));
  });
  test('the alcove key frames the lamp of the agent', () => {
    const seg = CUTS['main']!.segments[0]!;
    const c = cameraAt(seg.keys, 21, ctx);
    expect(c.target[0]).toBeCloseTo(10, 3);
    expect(c.fov).toBeCloseTo(34, 3);
  });
  test('mix and fades', () => {
    expect(
      mixAt(
        [
          [0, 0],
          [30, 0],
          [36, 1],
        ],
        33,
      ),
    ).toBeCloseTo(0.5, 5);
    expect(
      mixAt(
        [
          [0, 0],
          [30, 0],
          [36, 1],
        ],
        40,
      ),
    ).toBe(1);
    expect(fadeAt(0.3, 0, 5)).toBeCloseTo(0.5);
    expect(fadeAt(2.5, 0, 5)).toBe(1);
    expect(fadeAt(9, 0, 5)).toBe(0);
  });
});

describe('promo mode', () => {
  test('demo only: a promo URL never takes over a live page', () => {
    expect(resolvePromo('?demo=1&promo=main', undefined)).toBe('main');
    expect(resolvePromo('?promo=main', undefined)).toBeNull();
    expect(resolvePromo('?demo=0&promo=main', '1')).toBeNull();
    expect(resolvePromo('?demo=1&promo=nope', undefined)).toBeNull();
  });
  test('seeded random repeats', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('promo timelines', () => {
  const main = CUTS['main']!;
  const DENYLIST = /diar|manasik|paytabs|qwirva|jservo|aghrba|newedition|troveo|ra3d/i;
  const strings = (v: unknown): string[] =>
    typeof v === 'string'
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(strings)
        : v && typeof v === 'object'
          ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)])
          : [];

  test('no private name in a timeline or in the copy', () => {
    for (const seg of main.segments) {
      const all = strings(seg.timeline);
      expect(all.length).toBeGreaterThan(20);
      expect(all.filter((s) => DENYLIST.test(s))).toEqual([]);
    }
    expect(strings(PROMO_COPY).filter((s) => DENYLIST.test(s))).toEqual([]);
  });
  test('segments add up to 60 s with the crossfade, keys are sorted', () => {
    const total = main.segments.reduce((n, s) => n + s.durationSec, 0) - main.crossfadeSec;
    expect(total).toBe(60);
    for (const s of main.segments) {
      const ts = s.keys.map((k) => k.t);
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
      expect(Math.max(...ts)).toBe(s.durationSec);
    }
  });
  test('approval is up for the whole approval moment of each world', () => {
    const win: Array<[number, number]> = [
      [14.8, 21],
      [24, 30],
    ];
    main.segments.forEach((seg, i) => {
      const req = seg.timeline.steps.find((s) => s.msg.type === 'agentToolPermission')!;
      const clear = seg.timeline.steps.find(
        (s) => s.msg.type === 'agentToolDone' && (s.msg as { toolId: string }).toolId === 'pa',
      )!;
      expect(req.at / 1000 - PREROLL_SEC).toBeLessThanOrEqual(win[i]![0] + 0.1);
      expect(clear.at / 1000 - PREROLL_SEC).toBeGreaterThanOrEqual(win[i]![1]);
    });
  });
  test('manual DemoTransport sends steps only when advanced, once, in order', () => {
    const seg = main.segments[0]!;
    const t = new DemoTransport(seg.timeline, { loop: false, manual: true });
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    t.send({ type: 'webviewReady' });
    const setup = got.length;
    expect(setup).toBe(seg.timeline.setup.length);
    t.advanceTo(1000);
    const n = got.length - setup;
    t.advanceTo(1000);
    expect(got.length - setup).toBe(n);
    t.advanceTo(1e9);
    expect(got.length - setup).toBe(seg.timeline.steps.length);
  });
});
