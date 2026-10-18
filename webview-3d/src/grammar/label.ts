import type { ToolActivity } from '../../../webview-ui/src/office/types.js';

export interface AgentInfo {
  /** The persona: "Astronomer" for agents, "Yahya · apprentice" for subagents. */
  name: string;
  /** Lighter text after the name on the same line: the session label, or the folder as a fallback. */
  detail: string | null;
  /** Newest unfinished tool status, e.g. "Reading src/app.ts". */
  status: string | null;
  /** A launched scholar's answer the user has not opened yet: the hall shows a scroll marker. */
  answerReady?: boolean;
}

export function latestStatus(list: ToolActivity[] | undefined): string | null {
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (!list[i].done) return list[i].status;
  }
  return null;
}

/** Longest session label on a name tag, ellipsis included. */
export const LABEL_MAX = 18;

/** Cut a label to the tag's width: whole when it fits, else cut at a word (or the cap) with an ellipsis. */
export function clipLabel(label: string, max = LABEL_MAX): string {
  if (label.length <= max) return label;
  const cut = label.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space >= 6 ? cut.slice(0, space) : cut).trimEnd() + '\u2026';
}

/** Name tag for an agent: its title, then the session label (or folder) in lighter weight. */
export function agentTag(title: string, label?: string): Pick<AgentInfo, 'name' | 'detail'> {
  return { name: title, detail: label ? clipLabel(label) : null };
}

/** Name tag for a subagent: "Yahya · apprentice". */
export function subagentTag(name: string, noun: string): Pick<AgentInfo, 'name' | 'detail'> {
  return { name: `${name} · ${noun}`, detail: null };
}
