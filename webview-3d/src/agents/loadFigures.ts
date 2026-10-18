import { useEffect, useState } from 'react';
import type { AnimationClip, Object3D } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { stripTrackSuffix } from './figureLogic.js';
import { activeWorld } from '../worlds/registry.js';

/** Every figures GLB by file name: the shared one and each world's own (out/figures/figures-*.glb). */
const FIGURE_URLS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob(
      ['../../assets/figures/out/figures.glb', '../../assets/worlds/*/out/figures/figures-*.glb'],
      { query: '?url', import: 'default', eager: true },
    ) as Record<string, string>,
  ).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
);
export const DEFAULT_FIGURES = 'figures.glb';

export interface FigureAssets {
  scene: Object3D;
  clips: Map<string, AnimationClip>;
}

const cache = new Map<string, Promise<FigureAssets>>();

/** No CDN, no drei loaders: three's GLTFLoader + MeshoptDecoder, the file served by Vite. */
export function loadFigures(
  file: string = activeWorld().figures ?? DEFAULT_FIGURES,
): Promise<FigureAssets> {
  const url = FIGURE_URLS[file];
  if (!url) return Promise.reject(new Error(`Figures file not found: ${file}`));
  let promise = cache.get(url);
  if (promise) return promise;
  promise = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(url)
    .then((g) => {
      // The loader suffixed the second rig's node names, and the clips target those names.
      for (const c of g.animations) for (const t of c.tracks) t.name = stripTrackSuffix(t.name);
      return { scene: g.scene, clips: new Map(g.animations.map((c) => [c.name, c])) };
    });
  cache.set(url, promise);
  return promise;
}

/** undefined while loading, null if the file is unavailable (capsule fallback). */
export function useFigureAssets(): FigureAssets | null | undefined {
  const [assets, setAssets] = useState<FigureAssets | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    loadFigures()
      .then((a) => alive && setAssets(a))
      .catch((e: unknown) => {
        console.error('Figures unavailable; using capsules.', e);
        if (alive) setAssets(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return assets;
}
