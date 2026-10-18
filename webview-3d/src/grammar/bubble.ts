import { KIND_COLORS } from './kindColors.js';
import type { ToolKind } from './toolKind.js';
import type { VisualState } from './visualState.js';

export type BubbleTone = 'working' | 'approval' | 'waiting';

export interface Bubble {
  tone: BubbleTone;
  text: string;
  /** Animated three-dot busy indicator. */
  showDots: boolean;
  /** Working bubbles only: the activity, whose colour borders the bubble. */
  toolKind?: ToolKind;
}

/** Longest working-bubble text, ellipsis included: the verb and a short object, never a sentence. */
export const BUBBLE_TEXT_MAX = 24;

/** The one-line, capped form of a tool status: "Running: python3 -c…", "Reading hall.py". */
export function shortStatus(status: string): string {
  const [head, ...rest] = status.split(/\r?\n/);
  const first = head.replace(/\s+/g, ' ').trim();
  const more = rest.some((line) => line.trim() !== '');
  if (!more && first.length <= BUBBLE_TEXT_MAX) return first;
  if (!first) return '';
  return first.slice(0, BUBBLE_TEXT_MAX - 1).replace(/[\s\u2026]+$/, '') + '\u2026';
}

/** Inline style for a bubble: the tool-kind colour as `--kind` (CSS reads it; KIND_COLORS stays the single source). */
export function bubbleStyle(bubble: Bubble): Record<string, string> | undefined {
  return bubble.tone === 'working' && bubble.toolKind
    ? { '--kind': KIND_COLORS[bubble.toolKind] }
    : undefined;
}

/** What the speech bubble over an agent says (spec §4). Approval outranks everything. */
export function bubbleContent(v: VisualState, status: string | null): Bubble | null {
  if (v.signal === 'permission')
    return { tone: 'approval', text: 'Needs your approval', showDots: false };
  if (v.signal === 'waiting')
    return { tone: 'waiting', text: 'Done, waiting for you', showDots: false };
  if (v.toolKind !== null)
    return {
      tone: 'working',
      text: (status && shortStatus(status)) || 'Working',
      showDots: true,
      toolKind: v.toolKind,
    };
  return null;
}

export interface BubbleAnchor {
  key: string;
  /** Mount order: the earlier bubble (normally the parent's) keeps the lower slot. */
  seq: number;
  /** World position in tiles. */
  x: number;
  z: number;
}

/**
 * Stack level per bubble: one more than the bubbles with an earlier seq within `radius` tiles
 * (M0 design note: a subagent spawns beside its parent, so their bubbles would overlap).
 */
export function bubbleStackLevels(anchors: BubbleAnchor[], radius = 1): Map<string, number> {
  const levels = new Map<string, number>();
  for (const a of anchors) {
    let level = 0;
    for (const b of anchors) {
      if (b.seq < a.seq && Math.hypot(a.x - b.x, a.z - b.z) <= radius) level++;
    }
    levels.set(a.key, level);
  }
  return levels;
}
