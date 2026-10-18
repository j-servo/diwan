import type { Character } from '../../../webview-ui/src/office/types.js';
import { CharacterState } from '../../../webview-ui/src/office/types.js';
import type { ToolKind } from './toolKind.js';
import { toolKind } from './toolKind.js';

export type Pose = 'walk' | 'work' | 'idle';

export interface VisualState {
  pose: Pose;
  toolKind: ToolKind | null;
  signal: 'permission' | 'waiting' | null;
  isSubagent: boolean;
  effect: 'spawn' | 'despawn' | null;
  contextRatio: number | null;
}

export function contextRatio(
  ch: Pick<Character, 'contextTokens' | 'maxContextTokens'>,
): number | null {
  // Zero usage is "no news" upstream (contextUsage.ts): no gauge until real data arrives.
  if (!ch.maxContextTokens || ch.maxContextTokens <= 0 || ch.contextTokens <= 0) return null;
  return Math.min(1, Math.max(0, ch.contextTokens / ch.maxContextTokens));
}

/** Maps engine state to what every world must show (spec §4). */
export function toVisualState(ch: Character): VisualState {
  const pose: Pose =
    ch.state === CharacterState.WALK ? 'walk' : ch.state === CharacterState.TYPE ? 'work' : 'idle';
  return {
    pose,
    toolKind: ch.isActive ? toolKind(ch.currentTool) : null,
    signal: ch.bubbleType,
    isSubagent: ch.isSubagent,
    effect: ch.matrixEffect,
    contextRatio: contextRatio(ch),
  };
}

/** Stable key: React state only updates when something visible changes. */
export function visualSignature(v: VisualState): string {
  const gauge = v.contextRatio === null ? '-' : String(Math.round(v.contextRatio * 20));
  return [v.pose, v.toolKind ?? '-', v.signal ?? '-', v.isSubagent, v.effect ?? '-', gauge].join(
    '|',
  );
}

export function gaugeColor(ratio: number): string {
  if (ratio < 0.6) return '#3da35d';
  if (ratio < 0.85) return '#e0a458';
  return '#d64545';
}

export function countCharacters(chars: Character[]): {
  agents: number;
  subagents: number;
  needsYou: number;
} {
  let agents = 0;
  let subagents = 0;
  // One approval per agent: its own, or (background-subagent path) a subagent's when the parent
  // shows none. Orphaned subagents are keyed by their own id.
  const needing = new Set<number>();
  for (const ch of chars) {
    if (ch.isGreeter) continue;
    if (ch.isSubagent) subagents++;
    else agents++;
    if (ch.bubbleType === 'permission') {
      needing.add(ch.isSubagent ? (ch.parentAgentId ?? ch.id) : ch.id);
    }
  }
  return { agents, subagents, needsYou: needing.size };
}
