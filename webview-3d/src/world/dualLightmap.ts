import type { MeshStandardMaterial, Texture } from 'three';
import { ShaderChunk } from 'three';

const MIX = 'uLightmapMix';

export function lightmapMixUniformName(): string {
  return MIX;
}

// Source line in three's lights_fragment_maps chunk (r185), replaced below.
const GOLDEN_LINE = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;';

/**
 * three supports one lightMap per material. Golden stays the standard lightMap (uv1, with
 * lightMapIntensity); dusk is a second sampler on the same UVs, blended by one uniform.
 */
export function patchDualLightmap(
  material: MeshStandardMaterial,
  golden: Texture,
  dusk: Texture,
  intensity: { golden: number; dusk: number },
): { setMix(t: number): void } {
  const mix = { value: 0 };
  material.lightMap = golden;
  material.lightMapIntensity = intensity.golden;

  const chunk = ShaderChunk.lights_fragment_maps;
  if (!chunk.includes(GOLDEN_LINE)) throw new Error('three lights_fragment_maps chunk changed');
  const blended = chunk.replace(
    GOLDEN_LINE,
    `vec3 goldenIrradiance = lightMapTexel.rgb * lightMapIntensity;
		vec3 duskIrradiance = texture2D( uLightMapDusk, vLightMapUv ).rgb * uLightMapIntensityDusk;
		vec3 lightMapIrradiance = mix( goldenIrradiance, duskIrradiance, ${MIX} );`,
  );

  material.onBeforeCompile = (shader) => {
    shader.uniforms[MIX] = mix;
    shader.uniforms['uLightMapDusk'] = { value: dusk };
    shader.uniforms['uLightMapIntensityDusk'] = { value: intensity.dusk };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lightmap_pars_fragment>',
        `#include <lightmap_pars_fragment>
		uniform float ${MIX};
		uniform sampler2D uLightMapDusk;
		uniform float uLightMapIntensityDusk;`,
      )
      .replace('#include <lights_fragment_maps>', blended);
  };
  material.customProgramCacheKey = () => 'dualLightmap';
  material.needsUpdate = true;

  return {
    setMix(t) {
      mix.value = Math.min(1, Math.max(0, t));
    },
  };
}
