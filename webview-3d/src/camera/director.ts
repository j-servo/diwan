export interface DirectorEvent {
  at: number;
  kind: 'approval' | 'delegate' | 'done' | 'join';
  agentId: number;
}

/** `since` is the time (same clock as events and now) the shot began. */
export type Shot =
  | { kind: 'wide'; since: number }
  | { kind: 'agent'; agentId: number; reason: DirectorEvent['kind']; since: number };

/** The opening shot: held "since forever", so the first event is never delayed by the hold. */
export const INITIAL_SHOT: Shot = { kind: 'wide', since: -Infinity };

const PRIORITY: Record<DirectorEvent['kind'], number> = {
  approval: 4,
  delegate: 3,
  done: 2,
  join: 1,
};
const MIN_HOLD_SEC = 4;
const IDLE_WIDE_SEC = 8;

/** Picks the next shot: approval > delegate > done > join, hold 4 s, wide after 8 s of silence. */
export function nextShot(events: DirectorEvent[], now: number, current: Shot | null): Shot {
  if (current && now - current.since < MIN_HOLD_SEC) return current;

  let best: DirectorEvent | null = null;
  for (const e of events) {
    if (e.at > now || now - e.at >= IDLE_WIDE_SEC) continue;
    if (
      !best ||
      PRIORITY[e.kind] > PRIORITY[best.kind] ||
      (PRIORITY[e.kind] === PRIORITY[best.kind] && e.at > best.at)
    ) {
      best = e;
    }
  }

  if (!best) {
    if (!current) return INITIAL_SHOT;
    return current.kind === 'wide' ? current : { kind: 'wide', since: now };
  }
  if (
    current?.kind === 'agent' &&
    current.agentId === best.agentId &&
    current.reason === best.kind
  ) {
    return current;
  }
  return { kind: 'agent', agentId: best.agentId, reason: best.kind, since: now };
}

/** What the director remembers about one engine character between ticks. */
export interface CharSnap {
  permission: boolean;
  waiting: boolean;
}

export interface DirectorChar {
  id: number;
  isSubagent: boolean;
  parentAgentId: number | null;
  bubbleType: 'permission' | 'waiting' | null;
}

/** Edge-detects engine character changes into director events (join, delegate, approval, done). */
export function deriveEvents(
  prev: ReadonlyMap<number, CharSnap>,
  chars: readonly DirectorChar[],
  now: number,
): { events: DirectorEvent[]; next: Map<number, CharSnap> } {
  const events: DirectorEvent[] = [];
  const next = new Map<number, CharSnap>();
  for (const ch of chars) {
    const snap: CharSnap = {
      permission: ch.bubbleType === 'permission',
      waiting: ch.bubbleType === 'waiting',
    };
    next.set(ch.id, snap);
    const before = prev.get(ch.id);
    if (!before) {
      events.push(
        ch.isSubagent
          ? { kind: 'delegate', agentId: ch.parentAgentId ?? ch.id, at: now }
          : { kind: 'join', agentId: ch.id, at: now },
      );
    }
    if (snap.permission && !before?.permission) {
      events.push({ kind: 'approval', agentId: ch.id, at: now });
    }
    if (snap.waiting && !before?.waiting && !ch.isSubagent) {
      events.push({ kind: 'done', agentId: ch.id, at: now });
    }
  }
  return { events, next };
}
