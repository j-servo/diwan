import { parseWorldAssetMeta } from '../assetMeta.js';
import type { WorldAssets } from '../types.js';

// Runtime only (Vite's import.meta.glob): kept out of greybox.ts so the layout export script,
// which runs under tsx, can import the floor plan.
// Baked hall (Task 2 outputs). Nothing matches until they are generated, and then the world has
// no `assets` and renders as the grey box.
const OUT = '../../../assets/worlds/house-of-wisdom/out/';
const metaFiles = import.meta.glob('../../../assets/worlds/house-of-wisdom/out/*.meta.json', {
  import: 'default',
});
const fileUrls = import.meta.glob(
  '../../../assets/worlds/house-of-wisdom/out/*.{glb,ktx2,png,webp}',
  { query: '?url', import: 'default' },
);

async function loadHallAssets(): Promise<WorldAssets> {
  const [metaKey] = Object.keys(metaFiles).sort();
  const meta = parseWorldAssetMeta(await metaFiles[metaKey]());
  const urls: Record<string, string> = {};
  for (const [key, load] of Object.entries(fileUrls)) {
    urls[key.slice(OUT.length)] = (await load()) as string;
  }
  const resolve = (file: string) => {
    const url = urls[file];
    if (!url) throw new Error(`House of Wisdom: missing baked file ${file}`);
    return url;
  };
  return { ...meta, baseUrl: '', resolve };
}

/** The baked hall's loader, or undefined until the bake exists (the world then renders as the grey box). */
export const hallAssets: (() => Promise<WorldAssets>) | undefined =
  Object.keys(metaFiles).length > 0 ? loadHallAssets : undefined;
