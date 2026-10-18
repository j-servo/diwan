// webview-3d/src/steer/steerStore.ts
import type { ServerMessage } from '../../../core/src/messages.js';

/** Steering state the server told us about. Empty (control false) in plain `diwan` and in the demo. */
export interface SteerAgentInfo {
  running: boolean;
  model: string;
  /** The effort level the session reports (the requested one until it does). */
  effort: string;
  tokensUsed: number;
  tokenCap: number;
  /** working | idle | answered ("Answer ready") | error. */
  turn: string;
  /** Counts answered turns; compared with the last one the user saw. */
  answerSeq: number;
  turnError?: string;
  /** Why it stopped, for the card: "token budget reached (512K of 500K)", "stopped", "error: ...". */
  stopped?: string;
}

/** One entry of a scholar's conversation. Untrusted text: render it safely. */
export interface SteerReply {
  seq: number;
  role: 'assistant' | 'user' | 'tool';
  text: string;
  at: number;
  truncated?: boolean;
}
export const REPLIES_KEPT = 200;

/** An answer the user has not looked at yet: the scholar's turn ended with one, and the card was not opened since. */
export function unseenAnswer(
  agent: Pick<SteerAgentInfo, 'turn' | 'answerSeq'> | undefined,
  seen: number | undefined,
): boolean {
  return agent?.turn === 'answered' && agent.answerSeq > (seen ?? 0);
}

/** The ids of scholars with an answer waiting, oldest id first. */
export function answersReady(
  agents: Readonly<Record<number, SteerAgentInfo>>,
  seen: Readonly<Record<number, number>>,
): number[] {
  return Object.keys(agents)
    .map(Number)
    .filter((id) => unseenAnswer(agents[id], seen[id]))
    .sort((a, b) => a - b);
}

/** "1 answer ready", "3 answers ready". */
export const answersReadyText = (n: number): string =>
  `${n} ${n === 1 ? 'answer' : 'answers'} ready`;

export interface SteerAskExtra {
  name: string;
  value: string;
  /** A red-flag setting, shown in a warm danger colour (never cobalt). */
  warn?: boolean;
}

export interface SteerAsk {
  requestId: string;
  tool: string;
  detail: string;
  truncated: boolean;
  /** Values masked in `detail`. */
  masked: number;
  /** Invisible or control characters were found and are shown as ⟦U+XXXX⟧. */
  hidden: boolean;
  /** Size of the whole command before any cut. */
  lines?: number;
  chars?: number;
  extras: readonly SteerAskExtra[];
  /** Client receive time. */
  at: number;
}

export interface SteerState {
  /** The server accepted our steerHello: controls may be shown. */
  control: boolean;
  projects: readonly { path: string; name: string }[];
  /** Launched (steerable) scholars by agent id. */
  agents: Readonly<Record<number, SteerAgentInfo>>;
  /** Pending requests per agent, oldest first. */
  asks: Readonly<Record<number, readonly SteerAsk[]>>;
  /** Each launched scholar's conversation, oldest first (control sockets only get these). */
  replies: Readonly<Record<number, readonly SteerReply[]>>;
  /** The newest refusal or failure of a control message, for a dialog or the card to show. */
  notice: { text: string; ref?: string; at: number } | null;
  /** Bumped when a launch is accepted (the dialog closes on it). */
  launchedRef: string | null;
}

export const EMPTY_STEER: SteerState = {
  control: false,
  projects: [],
  agents: {},
  asks: {},
  replies: {},
  notice: null,
  launchedRef: null,
};

function without<T>(rec: Readonly<Record<number, T>>, id: number): Record<number, T> {
  const { [id]: _gone, ...rest } = rec;
  return rest;
}

export function steerReducer(state: SteerState, msg: ServerMessage, now: number): SteerState {
  switch (msg.type) {
    case 'steerWelcome':
      return { ...state, control: true, projects: msg.projects };
    case 'steerAgent':
      return {
        ...state,
        agents: {
          ...state.agents,
          [msg.id]: {
            running: msg.running,
            model: msg.model,
            effort: msg.effort,
            tokensUsed: msg.tokensUsed,
            tokenCap: msg.tokenCap,
            turn: msg.turn,
            answerSeq: msg.answerSeq,
            ...(msg.turnError ? { turnError: msg.turnError } : {}),
            ...(msg.stopped ? { stopped: msg.stopped } : {}),
          },
        },
      };
    case 'steerReply': {
      const list = state.replies[msg.id] ?? [];
      if (list.length > 0 && list[list.length - 1].seq >= msg.seq) return state; // a repeat
      const entry: SteerReply = {
        seq: msg.seq,
        role: msg.role as SteerReply['role'],
        text: msg.text,
        at: msg.at,
        ...(msg.truncated ? { truncated: true } : {}),
      };
      const next = [...list, entry].slice(-REPLIES_KEPT);
      return { ...state, replies: { ...state.replies, [msg.id]: next } };
    }
    case 'steerApproval': {
      const queue = state.asks[msg.id] ?? [];
      const prior = queue.find((a) => a.requestId === msg.requestId);
      const ask: SteerAsk = {
        requestId: msg.requestId,
        tool: msg.tool,
        detail: msg.detail,
        truncated: msg.truncated === true,
        masked: msg.masked ?? 0,
        hidden: msg.hidden === true,
        lines: msg.lines,
        chars: msg.chars,
        extras: msg.extras ?? [],
        at: prior?.at ?? now,
      };
      if (prior) {
        // The full card for a control socket replaces a redacted copy that arrived first (late join).
        // Same content again changes nothing.
        if (JSON.stringify(prior) === JSON.stringify(ask)) return state;
        return {
          ...state,
          asks: { ...state.asks, [msg.id]: queue.map((a) => (a === prior ? ask : a)) },
        };
      }
      return { ...state, asks: { ...state.asks, [msg.id]: [...queue, ask] } };
    }
    case 'steerApprovalClear': {
      const queue = state.asks[msg.id];
      if (!queue) return state;
      const next = queue.filter((a) => a.requestId !== msg.requestId);
      if (next.length === queue.length) return state;
      return {
        ...state,
        asks: next.length > 0 ? { ...state.asks, [msg.id]: next } : without(state.asks, msg.id),
      };
    }
    case 'agentClosed':
      return state.agents[msg.id] || state.asks[msg.id] || state.replies[msg.id]
        ? {
            ...state,
            agents: without(state.agents, msg.id),
            asks: without(state.asks, msg.id),
            replies: without(state.replies, msg.id),
          }
        : state;
    case 'steerResult':
      if (msg.ok) return msg.ref ? { ...state, launchedRef: msg.ref, notice: null } : state;
      return { ...state, notice: { text: msg.error ?? 'Refused', ref: msg.ref, at: now } };
    default:
      return state;
  }
}
