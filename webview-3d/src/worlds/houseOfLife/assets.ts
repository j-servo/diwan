import { parseWorldAssetMeta } from '../assetMeta.js';
import type { WorldAssets } from '../types.js';

// Runtime only (Vite's import.meta.glob): kept out of greybox.ts so the layout export script,
// which runs under tsx, can import the floor plan.
// Baked temple (temple.py, E2). Nothing matches until it is generated, and then the world has
// no `assets` and renders as the grey box.
const OUT = '../../../assets/worlds/house-of-life/out/';
const metaFiles = import.meta.glob('../../../assets/worlds/house-of-life/out/*.meta.json', {
  import: 'default',
});
const fileUrls = import.meta.glob(
  '../../../assets/worlds/house-of-life/out/*.{glb,ktx2,png,webp}',
  { query: '?url', import: 'default' },
);

async function loadTempleAssets(): Promise<WorldAssets> {
  const [metaKey] = Object.keys(metaFiles).sort();
  const meta = parseWorldAssetMeta(await metaFiles[metaKey]());
  const urls: Record<string, string> = {};
  for (const [key, load] of Object.entries(fileUrls)) {
    urls[key.slice(OUT.length)] = (await load()) as string;
  }
  const resolve = (file: string) => {
    const url = urls[file];
    if (!url) throw new Error(`House of Life: missing baked file ${file}`);
    return url;
  };
  return { ...meta, baseUrl: '', resolve };
}

/** The baked temple's loader, or undefined until the bake exists (the world then renders as the grey box). */
export const templeAssets: (() => Promise<WorldAssets>) | undefined =
  Object.keys(metaFiles).length > 0 ? loadTempleAssets : undefined;
