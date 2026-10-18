// three's vendored Basis transcoder, run in Node, for asset tests that read KTX2 textures back.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { expect } from 'vitest';

/** three's vendored Basis transcoder, run in Node: KTX2 (ETC1S/UASTC) -> RGBA8. */
export async function basisTranscoder() {
  const require = createRequire(import.meta.url);
  const file = require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js');
  const src = readFileSync(file, 'utf8');
  const factory = new Function('require', '__filename', '__dirname', `${src}\nreturn BASIS;`)(
    require,
    file,
    dirname(file),
  ) as (o: object) => Promise<Record<string, any>>;
  const basis = await factory({});
  basis.initializeBasis();
  const RGBA32 = 13;
  return (data: Uint8Array) => {
    const ktx = new basis.KTX2File(data);
    try {
      expect(ktx.isValid()).toBeTruthy();
      expect(ktx.startTranscoding()).toBeTruthy();
      const w = ktx.getWidth();
      const h = ktx.getHeight();
      const rgba = new Uint8Array(ktx.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
      expect(ktx.transcodeImage(rgba, 0, 0, 0, RGBA32, 0, -1, -1)).toBeTruthy();
      return { w, h, rgba };
    } finally {
      ktx.close();
      ktx.delete();
    }
  };
}

/**
 * Chromatic texels (s >= 0.25, v >= 0.15, as the bake's cobalt guard counts them) whose hue sits
 * within `guard` degrees of `hue`.
 */
export function texelsNearHue(rgba: Uint8Array, hue: number, guard: number): number {
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    if (max < 0.15 || d / max < 0.25) continue;
    let h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue)) < guard) n++;
  }
  return n;
}
