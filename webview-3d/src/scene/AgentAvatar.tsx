import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Group, Mesh } from 'three';

import { MATRIX_EFFECT_DURATION_SEC } from '../../../webview-ui/src/constants.js';
import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';
import { bubbleContent } from '../grammar/bubble.js';
import { KIND_COLORS } from '../grammar/kindColors.js';
import { activeSignal } from '../grammar/signal.js';
import type { AgentInfo } from '../grammar/label.js';
import type { VisualState } from '../grammar/visualState.js';
import { gaugeColor, toVisualState, visualSignature } from '../grammar/visualState.js';
import { Figure } from '../agents/Figure.tsx';
import { trimColor } from '../agents/figureLogic.js';
import { useFigureAssets } from '../agents/loadFigures.js';
import { directionToRotationY, pixelToWorld } from './coords.js';
import { SpeechBubble } from './SpeechBubble.tsx';

const BODY_Y = 0.47;

/** Grey-box fallback only (figures failed to load); the real hall signals approval with its lamp. */
function PermissionBeacon({ y }: { y: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock, invalidate }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 6) * 0.2);
    invalidate(); // the pulse is continuous while the beacon exists (frameloop="demand")
  });
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <sphereGeometry args={[0.16, 24, 16]} />
      <meshStandardMaterial
        color={activeSignal().color}
        emissive={activeSignal().color}
        emissiveIntensity={4}
      />
    </mesh>
  );
}

function ContextGauge({ ratio }: { ratio: number }) {
  const height = Math.max(ratio * 0.9, 0.02);
  return (
    <mesh position={[0.38, height / 2, 0]}>
      <boxGeometry args={[0.06, height, 0.06]} />
      <meshStandardMaterial
        color={gaugeColor(ratio)}
        emissive={gaugeColor(ratio)}
        emissiveIntensity={0.4}
      />
    </mesh>
  );
}

export function AgentAvatar(props: {
  id: number;
  getOfficeState: () => OfficeState;
  info: AgentInfo;
}) {
  const { id, getOfficeState, info } = props;
  const figures = useFigureAssets();
  const isSubagent = useMemo(
    () => getOfficeState().characters.get(id)?.isSubagent ?? false,
    [getOfficeState, id],
  );
  const group = useRef<Group>(null);
  const body = useRef<Mesh>(null);
  const [visual, setVisual] = useState<VisualState | null>(null);
  const signatureRef = useRef('');
  const color = useMemo(() => {
    const palette = getOfficeState().characters.get(id)?.palette ?? 0;
    return trimColor(palette);
  }, [getOfficeState, id]);

  // Render-time pose: runs on every drawn frame, which the engine clock requests on change.
  useFrame(({ clock }) => {
    const ch = getOfficeState().characters.get(id);
    const g = group.current;
    if (!ch || !g) return;
    const [x, , z] = pixelToWorld(ch.x, ch.y);
    g.position.set(x, 0, z);
    g.rotation.y = directionToRotationY(ch.dir);
    const v = toVisualState(ch);
    const t = clock.elapsedTime;
    const bob =
      v.pose === 'walk'
        ? Math.abs(Math.sin(t * 10)) * 0.08
        : v.pose === 'work'
          ? Math.sin(t * 6) * 0.02
          : 0;
    if (body.current) body.current.position.y = BODY_Y + bob;
    const progress = Math.min(1, ch.matrixEffectTimer / MATRIX_EFFECT_DURATION_SEC);
    const effectScale = v.effect === 'spawn' ? progress : v.effect === 'despawn' ? 1 - progress : 1;
    g.scale.setScalar(Math.max((v.isSubagent ? 0.75 : 1) * effectScale, 0.001));
  });

  // React state (badges, bubble) follows the engine clock, not the render loop.
  useEngineTick(() => {
    const ch = getOfficeState().characters.get(id);
    if (!ch) return;
    const v = toVisualState(ch);
    const signature = visualSignature(v);
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setVisual(v);
    }
  });

  const bubble = (height: number) => (
    <>
      <SpeechBubble
        bubble={visual ? bubbleContent(visual, info.status) : null}
        name={info.name}
        detail={info.detail}
        height={height}
        compact={isSubagent}
        answerReady={info.answerReady}
      />
    </>
  );
  if (figures) {
    return (
      <Figure
        id={id}
        getOfficeState={getOfficeState}
        assets={figures}
        isSubagent={isSubagent}
        persona={info.name}
      >
        {bubble}
      </Figure>
    );
  }
  if (figures === undefined) return null; // still loading: no capsule flash

  return (
    <group ref={group}>
      <mesh ref={body} position={[0, BODY_Y, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.5, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      {/* Facing marker */}
      <mesh position={[0, BODY_Y + 0.15, 0.2]}>
        <boxGeometry args={[0.1, 0.06, 0.08]} />
        <meshStandardMaterial color="#1b1712" />
      </mesh>
      {visual?.toolKind && (
        <mesh position={[0, 1.35, 0]}>
          <boxGeometry args={[0.18, 0.18, 0.18]} />
          <meshStandardMaterial
            color={KIND_COLORS[visual.toolKind]}
            emissive={KIND_COLORS[visual.toolKind]}
            emissiveIntensity={0.6}
          />
        </mesh>
      )}
      {visual?.signal === 'permission' && <PermissionBeacon y={1.7} />}
      {visual?.signal === 'waiting' && (
        <mesh position={[0, 1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.18, 0.03, 8, 24]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.5} />
        </mesh>
      )}
      {visual?.contextRatio != null && <ContextGauge ratio={visual.contextRatio} />}
      <SpeechBubble
        bubble={visual ? bubbleContent(visual, info.status) : null}
        name={info.name}
        detail={info.detail}
        compact={isSubagent}
        answerReady={info.answerReady}
      />
    </group>
  );
}
