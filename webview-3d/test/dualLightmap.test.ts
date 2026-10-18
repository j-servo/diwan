import { DataTexture, MeshStandardMaterial, ShaderLib } from 'three';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';

import { lightmapMixUniformName, patchDualLightmap } from '../src/world/dualLightmap.js';

function compile(material: MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(
    shader as unknown as WebGLProgramParametersWithUniforms,
    {} as WebGLRenderer,
  );
  return shader;
}

describe('patchDualLightmap', () => {
  const golden = new DataTexture(new Uint8Array(4), 1, 1);
  const dusk = new DataTexture(new Uint8Array(4), 1, 1);

  it('names the mix uniform uLightmapMix', () => {
    expect(lightmapMixUniformName()).toBe('uLightmapMix');
  });

  it('samples the second lightmap and mixes both by the uniform', () => {
    const m = new MeshStandardMaterial();
    patchDualLightmap(m, golden, dusk, { golden: 3, dusk: 1.5 });
    const { fragmentShader, uniforms } = compile(m);
    expect(fragmentShader).toContain('uniform float uLightmapMix;');
    expect(fragmentShader).toContain('uniform sampler2D uLightMapDusk;');
    expect(fragmentShader).toContain('texture2D( uLightMapDusk, vLightMapUv )');
    expect(fragmentShader).toMatch(
      /mix\(\s*goldenIrradiance,\s*duskIrradiance,\s*uLightmapMix\s*\)/,
    );
    expect(fragmentShader).not.toContain('#include <lights_fragment_maps>');
    expect(uniforms['uLightmapMix'].value).toBe(0);
    expect(uniforms['uLightMapDusk'].value).toBe(dusk);
    expect(uniforms['uLightMapIntensityDusk'].value).toBe(1.5);
  });

  it('sets golden as the standard lightMap and keys the program cache', () => {
    const m = new MeshStandardMaterial();
    patchDualLightmap(m, golden, dusk, { golden: 3, dusk: 1.5 });
    expect(m.lightMap).toBe(golden);
    expect(m.lightMapIntensity).toBe(3);
    expect(m.customProgramCacheKey()).toContain('dualLightmap');
  });

  it('setMix drives the live uniform, clamped to 0..1', () => {
    const m = new MeshStandardMaterial();
    const handle = patchDualLightmap(m, golden, dusk, { golden: 3, dusk: 1.5 });
    const { uniforms } = compile(m);
    handle.setMix(0.4);
    expect(uniforms['uLightmapMix'].value).toBe(0.4);
    handle.setMix(7);
    expect(uniforms['uLightmapMix'].value).toBe(1);
  });
});
