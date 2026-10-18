import type { ServerMessage } from '../../../core/src/messages.js';

/** Session labels by agent id, as the server reports them (see server/src/sessionLabel.ts). */
export type AgentLabels = Readonly<Record<number, string>>;

export function labelsReducer(prev: AgentLabels, msg: ServerMessage): AgentLabels {
  if (msg.type === 'agentLabel') {
    return prev[msg.id] === msg.label ? prev : { ...prev, [msg.id]: msg.label };
  }
  if (msg.type === 'agentClosed' && msg.id in prev) {
    const { [msg.id]: _closed, ...rest } = prev;
    return rest;
  }
  return prev;
}
