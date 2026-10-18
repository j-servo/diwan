import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Object3D } from 'three';
import { AdditiveBlending, Color, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';

import { useEngineTick } from '../engine/EngineProvider.tsx';
import { prefersReducedMotion } from './reducedMotion.js';
import { HALO_POLYGON_OFFSET, TITLE_POLYGON_OFFSET, titleGlow } from './titleGlow.js';

/** The halo floats this far in front of the lintel's face, metres. */
const HALO_LIFT = 0.012;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The halo is the glyph map itself, read from its blurry mip levels: a soft glow hugging the
// signs (no second texture, no post-processing pass), added over the lintel.
const HALO_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
uniform float opacity;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(map, vUv, 4.5).rgb * 0.4
    + texture2D(map, vUv + vec2(0.012, 0.0), 3.5).rgb * 0.15
    + texture2D(map, vUv - vec2(0.012, 0.0), 3.5).rgb * 0.15
    + texture2D(map, vUv + vec2(0.0, 0.02), 3.5).rgb * 0.15
    + texture2D(map, vUv - vec2(0.0, 0.02), 3.5).rgb * 0.15;
  gl_FragColor = vec4(a * tint * opacity, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The House of Life's title glows royal blue and breathes (Yousef, 2026-10-18): the glyph map is
 * the title node's emissive texture, its intensity a slow sine on the engine clock, stronger at
 * dusk. A soft additive quad behind the signs is the halo (no post-processing pass). With
 * prefers-reduced-motion it holds a steady glow.
 */
export function TitleGlow(props: { root: Object3D; node: string; moodRef: { current: number } }) {
  const { root, node, moodRef } = props;
  const invalidate = useThree((s) => s.invalidate);
  const mesh = useMemo(() => {
    const o = root.getObjectByName(node);
    return o instanceof Mesh && o.material instanceof MeshStandardMaterial ? o : null;
  }, [root, node]);
  const halo = useRef<ShaderMaterial | null>(null);

  useEffect(() => {
    if (!mesh) return;
    const mat = mesh.material as MeshStandardMaterial;
    mat.emissive = new Color(1, 1, 1);
    // a decal: pulled towards the camera in depth-buffer units, so it never fights the lintel
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = TITLE_POLYGON_OFFSET.factor;
    mat.polygonOffsetUnits = TITLE_POLYGON_OFFSET.units;
    mat.needsUpdate = true;
    const map = mat.emissiveMap;
    if (!map) return;
    const material = new ShaderMaterial({
      uniforms: { map: { value: map }, tint: { value: new Color(1, 1, 1) }, opacity: { value: 0 } },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: true, // the columns and the lintel's cornice still hide it
      depthWrite: false, // additive light never occludes anything
      polygonOffset: true,
      polygonOffsetFactor: HALO_POLYGON_OFFSET.factor,
      polygonOffsetUnits: HALO_POLYGON_OFFSET.units,
    });
    // the same quad as the title, a hair in front of it
    const quad = new Mesh(mesh.geometry, material);
    quad.name = 'facade_title_halo';
    quad.position.set(0, 0, HALO_LIFT);
    quad.renderOrder = 5;
    quad.raycast = () => undefined;
    mesh.add(quad);
    halo.current = material;
    invalidate();
    return () => {
      mesh.remove(quad);
      material.dispose();
      halo.current = null;
    };
  }, [mesh, invalidate]);

  const time = useRef(0);
  const sinceDraw = useRef(0);
  useEngineTick((dt) => {
    if (!mesh) return;
    time.current += dt;
    const reduced = prefersReducedMotion();
    const g = titleGlow(time.current, moodRef.current, reduced);
    (mesh.material as MeshStandardMaterial).emissiveIntensity = g.intensity;
    if (halo.current) halo.current.uniforms.opacity!.value = g.halo;
    // a steady glow needs no frames of its own; a breath is slow enough for 20 Hz
    if (reduced) return;
    sinceDraw.current += dt;
    if (sinceDraw.current >= 1 / 20) {
      sinceDraw.current = 0;
      invalidate();
    }
  });
  return null;
}
