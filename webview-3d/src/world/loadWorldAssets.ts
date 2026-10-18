import type { Object3D, WebGLRenderer } from 'three';
import { Mesh, MeshStandardMaterial, NoColorSpace, Texture, TextureLoader } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import { lightMapIntensity } from '../worlds/assetMeta.js';
import type { WorldAssets } from '../worlds/types.js';
import { patchDualLightmap } from './dualLightmap.js';

export interface LoadedWorld {
  root: Object3D;
  /** The animated centrepiece (the courtyard armillary sphere: moving nodes, no lightmap), when the bake made one. */
  armillary: Object3D | null;
  /** One sun gobo per mood that has a sun (spike gotcha 8: linear data). */
  gobo: Texture;
  /** 0 = golden hour, 1 = dusk. */
  setMood(t: number): void;
  dispose(): void;
}

/** Only desks, lamps and figures cast (spike gotcha 9): walls and the grille are in the gobo. */
export const HOW_CASTS_SHADOW = /desk|lamp|cushion|figure|cedar|glaze|brass/i;
export function castsShadow(name: string, pattern: RegExp = HOW_CASTS_SHADOW): boolean {
  return pattern.test(name);
}

export async function loadWorldAssets(
  gl: WebGLRenderer,
  assets: WorldAssets,
  exposure: number,
  shadowNames: RegExp = HOW_CASTS_SHADOW,
): Promise<LoadedWorld> {
  // No setTranscoderPath: r185 resolves the Basis transcoder through import.meta.url, which
  // Vite serves and emits (spike gotcha 10). No CDN, no drei loaders (gotcha 12).
  const ktx2 = new KTX2Loader().detectSupport(gl);
  const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const { golden, dusk } = assets.moods;

  const sameLightmap = golden.lightmap.file === dusk.lightmap.file;
  const [gltf, goldenMap, duskMap, gobo, armillary] = await Promise.all([
    gltfLoader.loadAsync(assets.resolve(assets.glb)),
    ktx2.loadAsync(assets.resolve(golden.lightmap.file)),
    sameLightmap ? Promise.resolve(null) : ktx2.loadAsync(assets.resolve(dusk.lightmap.file)),
    new TextureLoader().loadAsync(assets.resolve(golden.sun.gobo)),
    assets.armillary || assets.centrepiece
      ? gltfLoader.loadAsync(assets.resolve((assets.armillary ?? assets.centrepiece)!.glb))
      : Promise.resolve(null),
  ]);
  // KTX2 is never flipped and carries its transfer function (gotcha 5): only the channel is ours.
  goldenMap.channel = 1;
  const duskTexture = duskMap ?? goldenMap;
  duskTexture.channel = 1;
  gobo.colorSpace = NoColorSpace;

  const intensity = {
    golden: lightMapIntensity(golden.lightmap, exposure),
    dusk: lightMapIntensity(dusk.lightmap, exposure),
  };
  const mixers: { setMix(t: number): void }[] = [];
  const patched = new Set<MeshStandardMaterial>();
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.castShadow = castsShadow([o.name, ...mats.map((m) => m.name)].join(' '), shadowNames);
    // The lightmap needs uv1 (TEXCOORD_1); a mesh without it keeps plain PBR.
    if (!o.geometry.getAttribute('uv1')) return;
    for (const m of mats) {
      if (!(m instanceof MeshStandardMaterial) || patched.has(m)) continue;
      patched.add(m);
      m.envMapIntensity = 0.12; // the lightmap already carries the room's indirect light
      mixers.push(patchDualLightmap(m, goldenMap, duskTexture, intensity));
    }
  });

  // The instrument's shadows are baked (its fixed parts) or absent (the moving cage): no live
  // shadow pass, and nothing of the hall lands on it. A centrepiece baked with the hall (the
  // House of Life's pyramid: its meshes carry uv1) takes the hall's lightmaps like the hall.
  armillary?.scene.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
    if (!(o instanceof Mesh) || !o.geometry.getAttribute('uv1')) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!(m instanceof MeshStandardMaterial) || patched.has(m)) continue;
      patched.add(m);
      m.envMapIntensity = 0.12;
      mixers.push(patchDualLightmap(m, goldenMap, duskTexture, intensity));
    }
  });

  return {
    root: gltf.scene,
    armillary: armillary?.scene ?? null,
    gobo,
    setMood: (t) => mixers.forEach((m) => m.setMix(t)),
    dispose() {
      ktx2.dispose();
      goldenMap.dispose();
      duskTexture.dispose();
      gobo.dispose();
    },
  };
}
