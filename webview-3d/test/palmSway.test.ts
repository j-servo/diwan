import * as THREE from 'three';
import { describe, expect, test } from 'vitest';

import {
  PALM_REACH,
  PALM_STILL_RADIUS,
  PALM_SWAY_AMPLITUDE,
  PALM_SWAY_PERIODS,
  palmFrondWeight,
  writePalmSway,
} from '../src/world/Atmosphere.tsx';
import type { PalmMeta } from '../src/worlds/assetMeta.js';

// A leaning palm as the bake builds it: trunk from y 0.15 to the crown at 4.6 m, leaning 0.18 m.
const palm: PalmMeta = {
  node: 'palm_palm-8-4',
  base: [12.75, 0.15, 6.75],
  crown: [12.93, 4.6, 6.7],
};

describe('palm sway: the trunk is a still pillar, only the fronds move', () => {
  test('a vertex on the trunk axis gets weight 0, at the foot, mid-trunk and at the crown', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const y = 0.15 + t * (4.6 - 0.15);
      const x = 12.75 + 0.18 * t * t;
      const z = 6.75 - 0.05 * t * t;
      expect(palmFrondWeight([x, y, z], palm), `t=${t}`).toBe(0);
    }
  });

  test('every trunk vertex (radius up to 0.21 m round the leaning axis) weighs exactly 0', () => {
    for (const t of [0, 0.3, 0.6, 1]) {
      for (let k = 0; k < 7; k++) {
        const a = (2 * Math.PI * k) / 7;
        const y = 0.15 + t * (4.6 - 0.15);
        const p: [number, number, number] = [
          12.75 + 0.18 * t * t + 0.208 * Math.cos(a),
          y,
          6.75 - 0.05 * t * t + 0.208 * Math.sin(a),
        ];
        expect(palmFrondWeight(p, palm)).toBe(0);
      }
    }
    expect(PALM_STILL_RADIUS).toBeGreaterThan(0.208);
  });

  test('frond tips get the full weight, the frond grows smoothly from the crown', () => {
    expect(palmFrondWeight([12.93 + PALM_REACH, 4.0, 6.7], palm)).toBeCloseTo(1, 6);
    const ws = [0.3, 0.8, 1.4, 2.0].map((d) => palmFrondWeight([12.93 - d, 4.4, 6.7], palm));
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeGreaterThan(ws[i - 1]);
  });

  test('subtle and slow: ~a third of the old crown sway, two incommensurate 4-6 s periods', () => {
    expect(PALM_SWAY_AMPLITUDE).toBeLessThanOrEqual(0.08 / 3 + 0.005);
    for (const p of PALM_SWAY_PERIODS) {
      expect(p).toBeGreaterThanOrEqual(4);
      expect(p).toBeLessThanOrEqual(6);
    }
    const [a, b] = PALM_SWAY_PERIODS;
    for (let n = 1; n <= 12; n++) expect(Math.abs(((b / a) * n) % 1)).toBeGreaterThan(0.01);
  });

  test('writePalmSway weighs a quantised mesh in metres: trunk 0, tip 1, units per metre', () => {
    // local units of 2.5 m, as the optimiser's quantisation leaves the palm nodes
    const s = 2.5;
    const toHall = new THREE.Matrix4().makeScale(s, s, s).setPosition(12.8, 2.5, 6.7);
    const local = (p: number[]) => [(p[0] - 12.8) / s, (p[1] - 2.5) / s, (p[2] - 6.7) / s];
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...local([12.75, 0.15, 6.75]), ...local([12.93, 4.6, 6.7]), ...local([15.2, 4.0, 6.7])],
        3,
      ),
    );
    writePalmSway(g, toHall, [palm]);
    const a = g.getAttribute('diwanSway');
    expect(a.getX(0)).toBe(0);
    expect(a.getX(1)).toBe(0);
    expect(a.getX(2)).toBeCloseTo(1, 4);
    expect(a.getZ(0)).toBeCloseTo(1 / s, 6);
  });
});
