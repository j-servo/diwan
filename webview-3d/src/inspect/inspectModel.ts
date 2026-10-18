import type { ServerMessage } from '../../../core/src/messages.js';

/** How many finished actions the card remembers per agent (and per apprentice). */
export const RECENT_MAX = 5;
/** A departed agent's record lingers this long (the card shows "Left the hall"), then is dropped. */
export const LEFT_KEEP_MS = 60_000;
/** Longest peek line near the pointer, ellipsis included. */
export const PEEK_MAX = 60;

const ELLIPSIS = '…';
const DOT = '·';

export interface ToolRow {
  toolId: string;
  status: string;
  detail?: string;
  toolName?: string;
  /** Set once the apprentice this tool spawned has been dismissed (subagentClear). */
  spawnCleared?: boolean;
  /** Client receive time of the first start message. */
  at: number;
}
export interface DoneRow extends ToolRow {
  doneAt: number;
}

export type Phase = 'arrived' | 'working' | 'asking' | 'idle' | 'left';

export interface SubRecord {
  parentToolId: string;
  /** The spawning tool as the parent reported it: the apprentice's task. */
  task: { status: string; detail?: string } | null;
  tools: ToolRow[];
  recent: DoneRow[];
  /** When the current work/idle stretch began. */
  since: number;
  approvalSince: number | null;
}

export interface AgentRecord {
  id: number;
  folder?: string;
  label?: string;
  phase: Phase;
  /** Client receive time of the last change of phase. */
  since: number;
  tools: ToolRow[];
  recent: DoneRow[];
  approvalSince: number | null;
  subs: Readonly<Record<string, SubRecord>>;
}

/** Everything the inspect card shows, by agent id. Client-side only: built from server messages. */
export type InspectState = Readonly<Record<number, AgentRecord>>;

const blankAgent = (id: number, now: number): AgentRecord => ({
  id,
  phase: 'arrived',
  since: now,
  tools: [],
  recent: [],
  approvalSince: null,
  subs: {},
});

const blankSub = (parentToolId: string, task: SubRecord['task'], now: number): SubRecord => ({
  parentToolId,
  task,
  tools: [],
  recent: [],
  since: now,
  approvalSince: null,
});

const taskOf = (agent: AgentRecord, parentToolId: string): SubRecord['task'] => {
  const row = agent.tools.find((t) => t.toolId === parentToolId);
  return row && !row.spawnCleared ? { status: row.status, detail: row.detail } : null;
};

function upsertTool(tools: ToolRow[], row: Omit<ToolRow, 'at'>, now: number): ToolRow[] {
  const i = tools.findIndex((t) => t.toolId === row.toolId);
  if (i < 0) return [...tools, { ...row, at: now }];
  const next = tools.slice();
  next[i] = { ...tools[i], ...row, detail: row.detail ?? tools[i].detail, at: tools[i].at };
  return next;
}

/** Moves a finished tool out of `tools` into `recent` (newest first, capped). */
function finishTool(
  tools: ToolRow[],
  recent: DoneRow[],
  toolId: string,
  now: number,
): { tools: ToolRow[]; recent: DoneRow[] } | null {
  const row = tools.find((t) => t.toolId === toolId);
  if (!row) return null;
  return {
    tools: tools.filter((t) => t !== row),
    recent: [{ ...row, doneAt: now }, ...recent].slice(0, RECENT_MAX),
  };
}

function prune(state: InspectState, now: number): InspectState {
  let next: Record<number, AgentRecord> | null = null;
  for (const rec of Object.values(state)) {
    if (rec.phase === 'left' && now - rec.since > LEFT_KEEP_MS) {
      next ??= { ...state };
      delete next[rec.id];
    }
  }
  return next ?? state;
}

const clearSubApprovals = (subs: AgentRecord['subs']): AgentRecord['subs'] => {
  if (!Object.values(subs).some((s) => s.approvalSince !== null)) return subs;
  return Object.fromEntries(
    Object.entries(subs).map(([k, s]) => [
      k,
      s.approvalSince === null ? s : { ...s, approvalSince: null },
    ]),
  );
};

/**
 * Folds one server message into the card data. Pure: `now` is the client's receive time, so
 * every clock on the card counts from when this hall saw the change.
 */
export function inspectReducer(prev: InspectState, msg: ServerMessage, now: number): InspectState {
  const state = prune(prev, now);
  const base = state;
  const put = (rec: AgentRecord): InspectState => ({ ...state, [rec.id]: rec });
  const live = (id: number): AgentRecord | undefined => {
    const rec = state[id];
    return rec && rec.phase !== 'left' ? rec : undefined;
  };
  /** The agent's record, a fresh one for an id not seen yet, or null for one that has left. */
  const ensure = (id: number): AgentRecord | null =>
    state[id]?.phase === 'left' ? null : (state[id] ?? blankAgent(id, now));
  const phased = (rec: AgentRecord, phase: Phase): AgentRecord =>
    rec.phase === phase ? rec : { ...rec, phase, since: now };

  switch (msg.type) {
    case 'agentCreated': {
      const rec = live(msg.id);
      if (rec)
        return msg.folderName && rec.folder !== msg.folderName
          ? put({ ...rec, folder: msg.folderName })
          : base;
      return put({ ...blankAgent(msg.id, now), folder: msg.folderName });
    }
    case 'agentLabel': {
      const rec = ensure(msg.id);
      if (!rec) return base;
      return rec.label === msg.label && state[msg.id] === rec
        ? base
        : put({ ...rec, label: msg.label });
    }
    case 'agentClosed': {
      const rec = state[msg.id];
      if (!rec || rec.phase === 'left') return base;
      return put({ ...rec, phase: 'left', since: now, tools: [], approvalSince: null, subs: {} });
    }
    case 'agentStatus': {
      const rec = live(msg.id);
      if (!rec) return base;
      if (msg.status === 'active') return put(phased(rec, 'working'));
      return put({
        ...phased(rec, msg.awaitingInput ? 'asking' : 'idle'),
        approvalSince: null,
        subs: clearSubApprovals(rec.subs),
      });
    }
    case 'agentToolStart': {
      const rec = ensure(msg.id);
      if (!rec) return base;
      const tools = upsertTool(
        rec.tools,
        { toolId: msg.toolId, status: msg.status, detail: msg.detail, toolName: msg.toolName },
        now,
      );
      const approvalSince = msg.permissionActive ? (rec.approvalSince ?? now) : null;
      return put({
        ...phased(rec, 'working'),
        tools,
        approvalSince,
        subs: msg.permissionActive ? rec.subs : clearSubApprovals(rec.subs),
      });
    }
    case 'agentToolDone': {
      const rec = live(msg.id);
      const moved = rec && finishTool(rec.tools, rec.recent, msg.toolId, now);
      return rec && moved ? put({ ...rec, ...moved }) : base;
    }
    case 'agentToolsClear': {
      const rec = live(msg.id);
      if (!rec) return base;
      return put({ ...rec, tools: [], approvalSince: null, subs: clearSubApprovals(rec.subs) });
    }
    case 'agentToolPermission': {
      const rec = live(msg.id);
      if (!rec) return base;
      return rec.approvalSince !== null ? base : put({ ...rec, approvalSince: now });
    }
    case 'agentToolPermissionClear': {
      const rec = live(msg.id);
      if (!rec) return base;
      return put({ ...rec, approvalSince: null, subs: clearSubApprovals(rec.subs) });
    }
    case 'subagentToolStart': {
      const rec = ensure(msg.id);
      if (!rec) return base;
      const sub =
        rec.subs[msg.parentToolId] ??
        blankSub(msg.parentToolId, taskOf(rec, msg.parentToolId), now);
      const tools = upsertTool(
        sub.tools,
        { toolId: msg.toolId, status: msg.status, detail: msg.detail },
        now,
      );
      const next: SubRecord = {
        ...sub,
        task: sub.task ?? taskOf(rec, msg.parentToolId),
        tools,
        since: sub.tools.length === 0 ? now : sub.since,
      };
      return put({ ...rec, subs: { ...rec.subs, [msg.parentToolId]: next } });
    }
    case 'subagentToolDone': {
      const rec = live(msg.id);
      const sub = rec?.subs[msg.parentToolId];
      const moved = sub && finishTool(sub.tools, sub.recent, msg.toolId, now);
      if (!rec || !sub || !moved) return base;
      const next: SubRecord = {
        ...sub,
        ...moved,
        since: moved.tools.length === 0 ? now : sub.since,
      };
      return put({ ...rec, subs: { ...rec.subs, [msg.parentToolId]: next } });
    }
    case 'subagentClear': {
      const rec = live(msg.id);
      if (!rec) return base;
      if (!(msg.parentToolId in rec.subs) && !rec.tools.some((t) => t.toolId === msg.parentToolId))
        return base;
      const { [msg.parentToolId]: _gone, ...subs } = rec.subs;
      const tools = rec.tools.map((t) =>
        t.toolId === msg.parentToolId ? { ...t, spawnCleared: true } : t,
      );
      return put({ ...rec, subs, tools });
    }
    case 'subagentToolPermission': {
      const rec = live(msg.id);
      if (!rec) return base;
      const sub =
        rec.subs[msg.parentToolId] ??
        blankSub(msg.parentToolId, taskOf(rec, msg.parentToolId), now);
      if (sub.approvalSince !== null) return base;
      return put({
        ...rec,
        subs: { ...rec.subs, [msg.parentToolId]: { ...sub, approvalSince: now } },
      });
    }
    default:
      return base;
  }
}

// ---- selectors ----------------------------------------------------------------------------

/**
 * An apprentice by its spawning tool. Before its first tool arrives there is no record yet, but the
 * parent's live spawning tool is enough to describe it; once both are gone it has left.
 */
export function subRecord(
  state: InspectState,
  parentId: number,
  parentToolId: string,
): SubRecord | undefined {
  const rec = state[parentId];
  if (!rec || rec.phase === 'left') return undefined;
  const sub = rec.subs[parentToolId];
  if (sub) return sub;
  const task = taskOf(rec, parentToolId);
  return task ? { ...blankSub(parentToolId, task, rec.since) } : undefined;
}

export const recentRows = (rec: Pick<AgentRecord, 'recent'>): DoneRow[] => rec.recent;

export interface NeedsYou {
  agentId: number;
  since: number;
}

/** Scholars waiting on an approval, oldest first. One entry per agent: its own, else its oldest apprentice's. */
export function needsYouQueue(state: InspectState): NeedsYou[] {
  const out: NeedsYou[] = [];
  for (const rec of Object.values(state)) {
    if (rec.phase === 'left') continue;
    let since = rec.approvalSince;
    if (since === null) {
      for (const sub of Object.values(rec.subs)) {
        if (sub.approvalSince !== null && (since === null || sub.approvalSince < since)) {
          since = sub.approvalSince;
        }
      }
    }
    if (since !== null) out.push({ agentId: rec.id, since });
  }
  return out.sort((a, b) => a.since - b.since || a.agentId - b.agentId);
}

/**
 * Which scholar the HUD's "needs you" button shows next: the oldest approval first, then each
 * click moves on to the following one, wrapping round. `current` is the scholar now on the card.
 */
export function nextNeedsYou(queue: readonly NeedsYou[], current: number | null): number | null {
  if (queue.length === 0) return null;
  const at = queue.findIndex((q) => q.agentId === current);
  return queue[(at + 1) % queue.length].agentId;
}

/** The tool an approval is about: the newest one still running. */
export function approvalTool(tools: readonly ToolRow[]): ToolRow | undefined {
  return tools[tools.length - 1];
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function stateLine(rec: AgentRecord, now: number): string {
  if (rec.phase === 'left') return 'Left the hall';
  if (rec.approvalSince !== null)
    return `Waiting for you ${DOT} ${durationText(now - rec.approvalSince)}`;
  const age = durationText(now - rec.since);
  switch (rec.phase) {
    case 'working':
      return `Working ${DOT} ${age}`;
    case 'asking':
      return `Waiting for you ${DOT} ${age}`;
    case 'idle':
      return `Finished its turn ${DOT} idle ${age}`;
    default:
      return `Arrived ${DOT} ${age}`;
  }
}

export function subStateLine(sub: SubRecord, now: number): string {
  if (sub.approvalSince !== null)
    return `Waiting for you ${DOT} ${durationText(now - sub.approvalSince)}`;
  const age = durationText(now - sub.since);
  return sub.tools.length > 0 ? `Working ${DOT} ${age}` : `Between tasks ${DOT} ${age}`;
}

/** "12 s ago". */
export const agoText = (ms: number): string => `${durationText(ms)} ago`;

/** The one-line hover peek: title and current status, cut at PEEK_MAX with an ellipsis. */
export function peekText(title: string, status: string | null): string {
  const line = status ? `${title} ${DOT} ${status}` : title;
  return line.length <= PEEK_MAX ? line : line.slice(0, PEEK_MAX - 1).trimEnd() + ELLIPSIS;
}
