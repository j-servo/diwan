import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useId, useRef, useState } from 'react';
import { Vector3 } from 'three';
import type { Group } from 'three';

import type { Bubble, BubbleAnchor } from '../grammar/bubble.js';
import { bubbleStackLevels, bubbleStyle } from '../grammar/bubble.js';

/** Live bubbles by key, so neighbours can see each other without any shared parent state. */
const live = new Map<string, BubbleAnchor>();
let nextSeq = 1;
const scratch = new Vector3();
/**
 * Pixels one level lifts a bubble: the tallest bubble under it is an approval (one 12px line
 * plus 10 padding and 3 border, about 29, drawn at 1.3x) plus the 5px tail and a 4px gap.
 * `translate` leaves the name tag and column alone.
 */
const STACK_PX = 48;

/**
 * Parchment speech bubble pinned above an agent (spec §4). DOM, not WebGL, so text stays crisp
 * at any zoom. A bubble within one tile of an earlier one (a subagent beside its parent) lifts
 * above it instead of overlapping.
 */
export function SpeechBubble({
  bubble,
  name,
  detail = null,
  height = 2.05,
  compact = false,
  answerReady = false,
}: {
  bubble: Bubble | null;
  name: string;
  /** Session label after the name, in lighter weight (or the project folder). */
  detail?: string | null;
  /** Anchor height above the floor, in world units: above the head or turban. */
  height?: number;
  /** Apprentices: a smaller name tag. */
  compact?: boolean;
  /** A launched scholar's answer waits: a small parchment scroll above the tag until its card is opened. */
  answerReady?: boolean;
}) {
  const key = useId();
  const seq = useRef(0);
  if (seq.current === 0) seq.current = nextSeq++;
  const anchor = useRef<Group>(null);
  const [level, setLevel] = useState(0);
  const visible = bubble !== null;

  useEffect(() => () => void live.delete(key), [key]);
  useEffect(() => {
    if (!visible) live.delete(key);
  }, [visible, key]);

  useFrame(() => {
    if (!visible || !anchor.current) return;
    anchor.current.getWorldPosition(scratch);
    live.set(key, { key, seq: seq.current, x: scratch.x, z: scratch.z });
    const next = bubbleStackLevels([...live.values()]).get(key) ?? 0;
    setLevel((prev) => (prev === next ? prev : next));
  });

  return (
    <group ref={anchor}>
      <Html position={[0, height, 0]} center distanceFactor={11} zIndexRange={[20, 0]}>
        <div className={compact ? 'agent-tag agent-tag--compact' : 'agent-tag'}>
          {answerReady && <AnswerScroll />}
          {bubble && (
            <div
              className={`bubble bubble--${bubble.tone}`}
              role="status"
              style={{
                ...bubbleStyle(bubble),
                ...(level > 0 ? { translate: `0 ${-level * STACK_PX}px` } : {}),
              }}
            >
              <span className="bubble-text">{bubble.text}</span>
              {bubble.showDots && (
                <span className="bubble-dots" aria-label="working">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          )}
          <div className="agent-name">
            <span className="agent-title">{name}</span>
            {detail && <span className="agent-detail">{` \u00b7 ${detail}`}</span>}
          </div>
        </div>
      </Html>
    </group>
  );
}

/** A rolled parchment scroll, warm tan: the answer-ready marker. Never cobalt (that is "needs you"). */
function AnswerScroll() {
  return (
    <svg
      className="answer-scroll"
      role="img"
      aria-label="Answer ready"
      width="22"
      height="16"
      viewBox="0 0 22 16"
    >
      <rect
        x="3"
        y="2"
        width="16"
        height="12"
        rx="1"
        fill="#ead9ae"
        stroke="#7a5a30"
        strokeWidth="1"
      />
      <rect
        x="1"
        y="1"
        width="4"
        height="14"
        rx="2"
        fill="#d2b87a"
        stroke="#7a5a30"
        strokeWidth="1"
      />
      <rect
        x="17"
        y="1"
        width="4"
        height="14"
        rx="2"
        fill="#d2b87a"
        stroke="#7a5a30"
        strokeWidth="1"
      />
      <path d="M7 6h8M7 9h8M7 12h5" stroke="#7a5a30" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
