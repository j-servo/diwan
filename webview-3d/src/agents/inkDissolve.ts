import type { MeshStandardMaterial } from 'three';

export const INK_PROGRESS = 'uInkProgress';

const NOISE = `
uniform float ${INK_PROGRESS};
varying vec3 vInkPos;
float inkHash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float inkNoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(inkHash(i), inkHash(i + vec3(1,0,0)), f.x), mix(inkHash(i + vec3(0,1,0)), inkHash(i + vec3(1,1,0)), f.x), f.y),
		mix(mix(inkHash(i + vec3(0,0,1)), inkHash(i + vec3(1,0,1)), f.x), mix(inkHash(i + vec3(0,1,1)), inkHash(i + vec3(1,1,1)), f.x), f.y),
		f.z);
}`;

const DISCARD = `
	float inkN = inkNoise(vInkPos * 6.0) * 0.5 + inkNoise(vInkPos * 14.0) * 0.5;
	float inkT = ${INK_PROGRESS} * 1.15;
	if (inkN > inkT) discard;
	float inkEdge = 1.0 - smoothstep(0.0, 0.06, inkT - inkN);
	#include <dithering_fragment>
	gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.03, 0.02, 0.05), inkEdge * step(${INK_PROGRESS}, 0.999));`;

/**
 * Discards fragments by a 3D noise threshold driven by one uniform
 * (0 hidden, 1 fully visible) and inks the edge dark. Object-space noise, so it sticks to the
 * mesh. Skinned meshes: vInkPos uses the skinned position (`transformed`).
 */
export function patchInkDissolve(material: MeshStandardMaterial): { setProgress(p: number): void } {
  const progress = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms[INK_PROGRESS] = progress;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInkPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInkPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <dithering_fragment>', DISCARD);
  };
  material.customProgramCacheKey = () => 'inkDissolve';
  material.needsUpdate = true;
  return {
    setProgress(p) {
      progress.value = Math.min(1, Math.max(0, p));
    },
  };
}
