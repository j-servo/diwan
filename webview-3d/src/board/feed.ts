// webview-3d/src/board/feed.ts
import type { ServerMessage } from '../../../core/src/messages.js';
import type { PersonaView } from '../agents/personaStore.js';
import { toolKind } from '../grammar/toolKind.js';

export interface FeedEntry {
  id: number;
  at: number;
  text: string;
  tone: 'info' | 'approval' | 'done';
}

export interface FeedState {
  entries: FeedEntry[];
  nextId: number;
  /** Agents whose approval request is still open (ids). */
  pendingApproval: number[];
}

export const EMPTY_FEED: FeedState = { entries: [], nextId: 1, pendingApproval: [] };
export const FEED_LIMIT = 30;

const nameOf = (personas: PersonaView, id: number) => personas.agent(id).title;
/** "Yahya (apprentice to Astronomer)": plain text; world voices rewrite it. */
const apprenticeOf = (personas: PersonaView, id: number, parentToolId: string) =>
  `${personas.apprentice(id, parentToolId)} (${personas.nouns.subagent} to ${nameOf(personas, id)})`;

function push(state: FeedState, now: number, text: string, tone: FeedEntry['tone']): FeedState {
  if (state.entries[0]?.text === text) return state;
  const entry: FeedEntry = { id: state.nextId, at: now, text, tone };
  return {
    ...state,
    entries: [entry, ...state.entries].slice(0, FEED_LIMIT),
    nextId: state.nextId + 1,
  };
}

/** The id an approval-clearing message refers to, or null if the message does not clear one. */
function clearedApprovalId(msg: ServerMessage): number | null {
  switch (msg.type) {
    case 'agentToolPermissionClear':
    case 'agentToolDone':
    case 'agentToolsClear':
    case 'agentStatus':
    // A background subagent's approval is announced by subagentToolPermission alone, so its
    // own done/clear messages (id = the parent's) are what end it. (Accepted: a finished subagent
    // tool also clears the parent's own pending approval.)
    case 'subagentToolDone':
    case 'subagentClear':
      return msg.id;
    case 'agentToolStart':
      return msg.permissionActive ? null : msg.id;
    default:
      return null;
  }
}

/**
 * In hooks mode the server sends no explicit permission clear: the approval ends when the
 * agent's next tool event arrives. So any such event for a pending agent means "can continue".
 */
function resolveApproval(
  state: FeedState,
  msg: ServerMessage,
  now: number,
  personas: PersonaView,
): FeedState {
  const id = clearedApprovalId(msg);
  if (id === null || !state.pendingApproval.includes(id)) return state;
  const next = { ...state, pendingApproval: state.pendingApproval.filter((p) => p !== id) };
  return push(next, now, `${nameOf(personas, id)} can continue`, 'info');
}

/** Notable events only (spec §4): routine reads and edits stay off the board. */
export function feedReducer(
  prev: FeedState,
  msg: ServerMessage,
  now: number,
  personas: PersonaView,
): FeedState {
  const state = resolveApproval(prev, msg, now, personas);
  switch (msg.type) {
    case 'agentCreated':
      return push(state, now, `${nameOf(personas, msg.id)} joined`, 'info');
    case 'agentToolStart': {
      if (toolKind(msg.toolName) !== 'delegate') return state;
      const task = msg.status.startsWith('Subtask:')
        ? msg.status.slice('Subtask:'.length).trim()
        : msg.status;
      return push(state, now, `${nameOf(personas, msg.id)} delegated: ${task}`, 'info');
    }
    case 'agentToolPermission': {
      if (state.pendingApproval.includes(msg.id)) return state;
      const pending = { ...state, pendingApproval: [...state.pendingApproval, msg.id] };
      return push(pending, now, `${nameOf(personas, msg.id)} needs your approval`, 'approval');
    }
    case 'subagentToolPermission': {
      if (state.pendingApproval.includes(msg.id)) return state;
      const pending = { ...state, pendingApproval: [...state.pendingApproval, msg.id] };
      return push(
        pending,
        now,
        `${apprenticeOf(personas, msg.id, msg.parentToolId)} needs your approval`,
        'approval',
      );
    }
    case 'subagentClear':
      return push(
        state,
        now,
        `${apprenticeOf(personas, msg.id, msg.parentToolId)} returned`,
        'done',
      );
    case 'agentStatus':
      if (msg.status !== 'waiting') return state;
      return push(
        state,
        now,
        msg.awaitingInput
          ? `${nameOf(personas, msg.id)} is waiting for you`
          : `${nameOf(personas, msg.id)} finished`,
        'done',
      );
    case 'agentClosed': {
      const left = push(state, now, `${nameOf(personas, msg.id)} left`, 'info');
      return { ...left, pendingApproval: left.pendingApproval.filter((p) => p !== msg.id) };
    }
    default:
      return state;
  }
}
