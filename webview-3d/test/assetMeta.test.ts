import { describe, expect, test } from 'vitest';

import { lightMapIntensity, parseWorldAssetMeta } from '../src/worlds/assetMeta.js';

function validMeta() {
  const sun = {
    color: [1, 0.8, 0.6],
    intensity: 3.88,
    position: [1, 2, 3],
    target: [0, 0, 0],
    angle: 0.5,
    penumbra: 0.3,
    near: 0.1,
    far: 20,
    size: 1024,
    gobo: 'gobo_window.png',
  };
  const lightmap = { file: 'lm.ktx2', uv: 1, intensity: 3.14, colorSpace: 'srgb' };
  return {
    worldId: 'house-of-wisdom',
    tileMeters: 1.5,
    glb: 'hall.glb',
    moods: {
      golden: { lightmap, sun },
      dusk: { lightmap: { ...lightmap, file: 'lm_dusk.ktx2' }, sun: null },
    },
    practicals: [
      { id: 'lamp', position: [1, 1, 1], color: [0.18, 0.72, 0.69], intensity: 2, distance: 4 },
    ],
  };
}

describe('parseWorldAssetMeta', () => {
  test('accepts a full valid object', () => {
    const meta = parseWorldAssetMeta(validMeta());
    expect(meta.worldId).toBe('house-of-wisdom');
    expect(meta.moods.dusk.sun).toBeNull();
  });

  test('rejects a missing golden lightmap, naming the path', () => {
    const bad = validMeta() as Record<string, any>;
    delete bad.moods.golden.lightmap;
    expect(() => parseWorldAssetMeta(bad)).toThrow(/moods\.golden\.lightmap/);
  });

  test('rejects a non-numeric intensity, naming the path', () => {
    const bad = validMeta() as Record<string, any>;
    bad.moods.golden.lightmap.intensity = 'bright';
    expect(() => parseWorldAssetMeta(bad)).toThrow(/moods\.golden\.lightmap\.intensity/);
  });

  test('rejects a uv other than 1, naming the path', () => {
    const bad = validMeta() as Record<string, any>;
    bad.moods.dusk.lightmap.uv = 0;
    expect(() => parseWorldAssetMeta(bad)).toThrow(/moods\.dusk\.lightmap\.uv/);
  });

  test('the armillary entry is optional; when present it names its GLB', () => {
    expect(parseWorldAssetMeta(validMeta()).armillary).toBeUndefined();
    const meta = parseWorldAssetMeta({ ...validMeta(), armillary: { glb: 'armillary.glb' } });
    expect(meta.armillary).toEqual({ glb: 'armillary.glb' });
    expect(() => parseWorldAssetMeta({ ...validMeta(), armillary: { glb: 3 } })).toThrow(
      /armillary\.glb/,
    );
  });

  test('rejects an ill-typed practical, naming the index', () => {
    const bad = validMeta() as Record<string, any>;
    bad.practicals[0].position = [1, 2];
    expect(() => parseWorldAssetMeta(bad)).toThrow(/practicals\[0\]\.position/);
  });
});

describe('lightMapIntensity', () => {
  test('multiplies the stored pi*M intensity by exposure', () => {
    expect(
      lightMapIntensity({ file: 'a', uv: 1, intensity: 3, colorSpace: 'srgb' }, 0.5),
    ).toBeCloseTo(1.5);
  });
});
