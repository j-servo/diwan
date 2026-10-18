import { MeshStandardMaterial, ShaderLib } from 'three';
import type { WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';

import { patchInkDissolve } from '../src/agents/inkDissolve.js';

function compile(m: MeshStandardMaterial) {
  const shader = {
    uniforms: {} as Record<string, { value: number }>,
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  };
  m.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, {} as WebGLRenderer);
  return shader;
}

describe('patchInkDissolve', () => {
  it('injects a noise discard driven by uInkProgress and an ink edge', () => {
    const m = new MeshStandardMaterial();
    patchInkDissolve(m);
    const { fragmentShader, vertexShader, uniforms } = compile(m);
    expect(fragmentShader).toContain('uniform float uInkProgress;');
    expect(fragmentShader).toContain('if (inkN > inkT) discard;');
    expect(fragmentShader).toContain('inkEdge');
    expect(vertexShader).toContain('vInkPos = transformed;');
    expect(uniforms['uInkProgress'].value).toBe(1);
    expect(m.customProgramCacheKey()).toBe('inkDissolve');
  });
  it('setProgress clamps to 0..1', () => {
    const m = new MeshStandardMaterial();
    const ink = patchInkDissolve(m);
    const { uniforms } = compile(m);
    ink.setProgress(0.4);
    expect(uniforms['uInkProgress'].value).toBe(0.4);
    ink.setProgress(5);
    expect(uniforms['uInkProgress'].value).toBe(1);
    ink.setProgress(-1);
    expect(uniforms['uInkProgress'].value).toBe(0);
  });
});
