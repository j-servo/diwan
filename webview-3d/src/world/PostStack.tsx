import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, TiltShift, ToneMapping } from '@react-three/postprocessing';
import type { TiltShiftEffect } from 'postprocessing';
import { BlendFunction, Effect, KernelSize, ToneMappingMode } from 'postprocessing';
import type { JSX } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Uniform } from 'three';

import { useEngineTick } from '../engine/EngineProvider.tsx';
import { moodLighting } from './mood.js';
import type { QualityProfile } from './quality.js';

/** Multiplies linear colour before tone mapping: the mood's exposure (the composer owns tone mapping). */
class ExposureEffect extends Effect {
  constructor() {
    super(
      'ExposureEffect',
      /* glsl */ `uniform float uExposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
      }`,
      { blendFunction: BlendFunction.SRC, uniforms: new Map([['uExposure', new Uniform(1)]]) },
    );
  }
  set exposure(v: number) {
    this.uniforms.get('uExposure')!.value = v;
  }
}

/** Tilt-shift band size in the wide shot and in a close-up (smaller = a tighter sharp band). */
export const TILT_FOCUS_WIDE = 0.3;
export const TILT_FOCUS_CLOSE = 0.18;

/**
 * EffectComposer forces gl.toneMapping off while mounted (spike gotcha 14), so ToneMapping is
 * always present. NEUTRAL keeps the cobalt "needs you" lamp cobalt (gotcha 15). Bloom
 * threshold 1.0 means only emissives bloom (gotcha 16). <TiltShift>, not <TiltShift2> (gotcha 13).
 * The camera rig writes `focusRef.current` (the tilt-shift band size); the mood mix sets exposure.
 */
export function PostStack({
  profile,
  moodRef,
  focusRef,
}: {
  profile: QualityProfile;
  moodRef: { current: number };
  focusRef: { current: number };
}) {
  const invalidate = useThree((s) => s.invalidate);
  const exposure = useMemo(() => new ExposureEffect(), []);
  const tilt = useRef<TiltShiftEffect>(null);
  const last = useRef({ exposure: Number.NaN, focus: Number.NaN });

  const sync = () => {
    const e = moodLighting(moodRef.current).exposure;
    if (e !== last.current.exposure) {
      last.current.exposure = e;
      exposure.exposure = e;
    }
    const f = focusRef.current;
    if (tilt.current && f !== last.current.focus) {
      last.current.focus = f;
      tilt.current.focusArea = f;
    }
  };
  useEngineTick(sync);
  useEffect(() => {
    last.current = { exposure: Number.NaN, focus: Number.NaN };
    sync();
    invalidate();
    // sync only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exposure, profile.tiltShift, invalidate]);
  useEffect(() => () => exposure.dispose(), [exposure]);

  const effects: JSX.Element[] = [];
  if (profile.bloom) {
    effects.push(
      <Bloom
        key="bloom"
        mipmapBlur
        luminanceThreshold={1.0}
        luminanceSmoothing={0.1}
        intensity={0.75}
        radius={0.62}
      />,
    );
  }
  if (profile.tiltShift) {
    effects.push(
      <TiltShift
        key="tilt"
        ref={tilt}
        offset={0.02}
        focusArea={TILT_FOCUS_WIDE}
        feather={0.22}
        kernelSize={KernelSize.SMALL}
      />,
    );
  }
  effects.push(<primitive key="exposure" object={exposure} />);
  effects.push(<ToneMapping key="tone" mode={ToneMappingMode.NEUTRAL} />);
  return <EffectComposer multisampling={4}>{effects}</EffectComposer>;
}
