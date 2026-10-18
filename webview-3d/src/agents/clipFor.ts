import type { VisualState } from '../grammar/visualState.js';

export type Clip =
  | 'idle'
  | 'walk'
  | 'sit_idle'
  | 'write'
  | 'read'
  | 'astrolabe'
  | 'scroll_search'
  | 'receive_letter'
  | 'gesture_beckon'
  | 'look_up';

export type Prop =
  'prop_reed_pen' | 'prop_codex' | 'prop_astrolabe' | 'prop_scroll' | 'prop_letter';

/**
 * Which clip (and held prop) a figure plays. Walking always wins. VisualState has no seat flag,
 * so "seated" is `pose === 'work'` unless the caller passes `seated` explicitly (Figure knows
 * whether the character stands on its seat tile when idle).
 */
export function clipFor(
  v: VisualState,
  seated: boolean = v.pose === 'work',
): { clip: Clip; prop: Prop | null } {
  if (v.pose === 'walk') return { clip: 'walk', prop: null };
  if (v.signal === 'waiting') return { clip: 'look_up', prop: null };
  // Approval: the scholar raises a hand to beckon the user (an existing clip).
  if (v.signal === 'permission') return { clip: 'gesture_beckon', prop: null };
  if (v.pose === 'work') {
    switch (v.toolKind) {
      case 'read':
        return { clip: 'read', prop: 'prop_codex' };
      case 'write':
        return { clip: 'write', prop: 'prop_reed_pen' };
      case 'run':
        return { clip: 'astrolabe', prop: 'prop_astrolabe' };
      case 'search':
        return { clip: 'scroll_search', prop: 'prop_scroll' };
      case 'web':
        return { clip: 'receive_letter', prop: 'prop_letter' };
      case 'delegate':
        return { clip: 'gesture_beckon', prop: null };
      default:
        return { clip: 'sit_idle', prop: null };
    }
  }
  return { clip: seated ? 'sit_idle' : 'idle', prop: null };
}
