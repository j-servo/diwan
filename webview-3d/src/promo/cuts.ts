import { PROMO_COPY } from './copy.js';
import { buildPromoTimeline } from './timelines.js';
import type { PromoCut, ShotKey, V3 } from './types.js';

/**
 * The shot lists. Positions are in tiles (1 tile = 1.5 m); the hall is 20 x 14 tiles with its
 * court centre at (10, 7). Tweak the numbers here: each segment is one world, rendered as its own
 * page and joined to the next by a crossfade (scripts/promo.mjs).
 */
const WIDE = { pos: [10, 20.1, 35.2] as V3, target: [10, 1, 7] as V3, fov: 22 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Keys on a circle around `centre`, azimuth measured from the south (+z) towards the east (+x). */
function orbit(opts: {
  centre: V3;
  radius: number;
  height: number;
  fov: number;
  focus: number;
  from: number;
  to: number;
  t0: number;
  t1: number;
  steps: number;
  portrait?: ShotKey['portrait'];
}): ShotKey[] {
  const keys: ShotKey[] = [];
  for (let i = 0; i <= opts.steps; i++) {
    const s = i / opts.steps;
    const a = rad(opts.from + (opts.to - opts.from) * s);
    keys.push({
      t: opts.t0 + (opts.t1 - opts.t0) * s,
      pos: [
        opts.centre[0] + opts.radius * Math.sin(a),
        opts.height,
        opts.centre[2] + opts.radius * Math.cos(a),
      ],
      target: opts.centre,
      fov: opts.fov,
      focus: opts.focus,
      ...(opts.portrait ? { portrait: opts.portrait } : {}),
    });
  }
  return keys;
}

// ---- House of Wisdom: 0-25 s (the last second is the crossfade into the House of Life)
const WISDOM_KEYS: ShotKey[] = [
  // 0-7 s: a slow push-in from the wide shot towards the courtyard
  { t: 0, ...WIDE, focus: 0.3, hold: true, portrait: { dolly: 1.6 } },
  ...orbit({
    // 7-14 s: an orbit around the turning armillary sphere, south-west to south-east
    centre: [10, 1.6, 7],
    radius: 7,
    height: 4.4,
    fov: 30,
    focus: 0.24,
    from: -38,
    to: 38,
    t0: 7,
    t1: 14,
    steps: 5,
    portrait: { dolly: 1.5 },
  }),
  // 14-21 s: ease onto the scholar whose lamp is lit (the approval), then a slow push-in
  {
    t: 21,
    pos: [10, 3.2, 12],
    target: [10, 1, 7],
    fov: 34,
    focus: 0.18,
    hold: true,
    alcove: { agent: 2, drop: 0.5 },
    portrait: { dolly: 1.15 },
  },
  {
    t: 25,
    pos: [10, 3.2, 12],
    target: [10, 1, 7],
    fov: 34,
    focus: 0.18,
    hold: true,
    alcove: { agent: 2, push: 0.92, drop: 0.5 },
    portrait: { dolly: 1.15 },
  },
];

// ---- House of Life: 36 s, shot from its own page load (script second 0 = composite second 24)
const LIFE_KEYS: ShotKey[] = [
  // 0-8 s: a crane down from high over the court to the pyramid's gold capstone
  {
    t: 0,
    pos: [11, 17, 17.5],
    target: [10, 0.6, 7.6],
    fov: 30,
    focus: 0.3,
    hold: true,
    portrait: { dolly: 1.5 },
  },
  {
    t: 8,
    pos: [7.2, 3.4, 11.8],
    target: [10, 2.2, 7],
    fov: 24,
    focus: 0.2,
    portrait: { dolly: 1.2 },
  },
  // 8-16 s: a lateral track along the Hathor facade, the glowing title in frame
  ...[3.2, 6.6, 10, 13.4, 16.8].map((x, i): ShotKey => ({
    t: 8 + (i + 1) * 1.6,
    pos: [x, 4.6, 12.2],
    target: [10 + (x - 10) * 0.35, 2.4, 3.3],
    fov: 26,
    focus: 0.24,
    portrait: { dolly: 1.5 },
  })),
  // 16-24 s: a low glide along the pool's south shore, past the lotus, scribes at work beyond
  {
    t: 18,
    pos: [4.6, 1.4, 12.8],
    target: [9, 0.5, 5.6],
    fov: 30,
    focus: 0.2,
    portrait: { dolly: 1.3 },
  },
  {
    t: 20.6,
    pos: [8.8, 1.35, 12.9],
    target: [12.5, 0.5, 5.8],
    fov: 30,
    focus: 0.2,
    portrait: { dolly: 1.3 },
  },
  {
    t: 23.2,
    pos: [13.2, 1.4, 12.8],
    target: [16.5, 0.5, 6],
    fov: 30,
    focus: 0.2,
    portrait: { dolly: 1.3 },
  },
  // 24-30 s: ease onto the amethyst approval; then pull back to the full court (dusk, end card)
  {
    t: 26,
    pos: [10, 3.2, 12],
    target: [10, 1, 7],
    fov: 34,
    focus: 0.22,
    alcove: { agent: 2, push: 1.7 },
    portrait: { dolly: 1.15 },
  },
  {
    t: 29.5,
    pos: [10, 3.2, 12],
    target: [10, 1, 7],
    fov: 34,
    focus: 0.18,
    hold: true,
    alcove: { agent: 2, drop: 0.5 },
    portrait: { dolly: 0.9 },
  },
  {
    t: 36,
    pos: [10, 17.5, 31],
    target: [10, 1, 7],
    fov: 22,
    focus: 0.3,
    hold: true,
    portrait: { dolly: 1.6 },
  },
];

export const CUTS: Record<string, PromoCut> = {
  main: {
    id: 'main',
    fps: 30,
    crossfadeSec: 1,
    segments: [
      {
        world: 'house-of-wisdom',
        durationSec: 25,
        keys: WISDOM_KEYS,
        mix: [[0, 0]],
        captions: [
          { text: PROMO_COPY.captions.scholar, from: 0.8, to: 6.2 },
          { text: PROMO_COPY.captions.needsYou, from: 15.2, to: 20.5 },
        ],
        timeline: buildPromoTimeline({
          endSec: 25,
          approval: { from: 14, to: 24.5 },
          apprentice: { from: 8.5, to: 16.5 },
        }),
      },
      {
        world: 'house-of-life',
        durationSec: 36,
        keys: LIFE_KEYS,
        // dusk crossfade over the last six seconds
        mix: [
          [0, 0],
          [30, 0],
          [36, 1],
        ],
        captions: [{ text: PROMO_COPY.captions.worlds, from: 1.6, to: 7.4 }],
        endCardFrom: 31.5,
        timeline: buildPromoTimeline({
          endSec: 36,
          approval: { from: 23.2, to: 32 },
          apprentice: { from: 5, to: 13 },
        }),
      },
    ],
  },
};
