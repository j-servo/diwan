import * as fs from 'fs';

import type { AgentStateStore } from './agentStateStore.js';
import { SESSION_LABEL_MAX, SESSION_LABEL_SEED_BYTES } from './constants.js';
import { redactSecrets } from './toolDetail.js';
import type { AgentState } from './types.js';

/**
 * A short human label for an agent's session, so the hall and the terminal can say
 * "brain setup" instead of "Agent 3".
 *
 * Where it comes from, best first: a name the session was given (Claude Code writes an
 * `agent-name` record for `--name` / `/rename`), the session's own generated title (an
 * `ai-title` record), then the first words of the first prompt. The folder name is the
 * client's fallback until one of these exists.
 */

/** The label's width cap: whole when it fits, else cut at a word (or the cap) with an ellipsis. */
export function clipSessionLabel(text: string, max = SESSION_LABEL_MAX): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space >= 6 ? cut.slice(0, space) : cut).trimEnd() + '\u2026';
}

/** The first three or four words of a prompt that fit the cap; one over-long word is clipped. */
/** A long run of key characters with a digit in it reads as a pasted key; long plain words and names stay. */
const isKeyLike = (w: string) => /[A-Za-z0-9_-]{16,}/.test(w) && /\d/.test(w);

export function promptLabel(prompt: string, maxWords = 4): string {
  // The label is shown in the hall and printed to the terminal: no secret may ride in it.
  const words = redactSecrets(prompt)
    .split(/\s+/)
    .filter((w) => w && !w.includes('=') && !w.includes('•••') && !isKeyLike(w));
  let label = '';
  for (const word of words.slice(0, maxWords)) {
    const next = label ? `${label} ${word}` : word;
    if (next.length > SESSION_LABEL_MAX) break;
    label = next;
  }
  return label || clipSessionLabel(words[0] ?? '');
}

/** The text of a record if it is a person's prompt; tool results, meta and wrappers are not. */
export function userPromptText(record: unknown): string | undefined {
  const r = record as {
    type?: string;
    isMeta?: boolean;
    isSidechain?: boolean;
    message?: { content?: unknown };
  } | null;
  if (r?.type !== 'user' || r.isMeta || r.isSidechain) return undefined;
  const content = r.message?.content;
  let text: string | undefined;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content) && !content.some((b) => b?.type === 'tool_result')) {
    text = content.find((b) => b?.type === 'text' && typeof b.text === 'string')?.text;
  }
  text = text?.trim();
  // `<command-name>`, `<system-reminder>`, `<task-notification>`: harness text, not a prompt.
  return text && !text.startsWith('<') ? text : undefined;
}

function titleField(record: unknown, type: string, field: string): string | undefined {
  const r = record as Record<string, unknown> | null;
  if (r?.type !== type || typeof r[field] !== 'string') return undefined;
  return clipSessionLabel(r[field]) || undefined;
}

/** The label the sources imply right now. */
function resolve(agent: AgentState): string | undefined {
  const s = agent.labelSources;
  return s?.name ?? s?.aiTitle ?? (s?.prompt ? promptLabel(s.prompt) : undefined) ?? undefined;
}

/** Fold one record in. Returns true when it changed a source. */
function absorb(agent: AgentState, record: unknown): boolean {
  const sources = (agent.labelSources ??= {});
  const name = titleField(record, 'agent-name', 'agentName');
  if (name && name !== sources.name) {
    sources.name = name;
    return true;
  }
  const aiTitle = titleField(record, 'ai-title', 'aiTitle');
  if (aiTitle && aiTitle !== sources.aiTitle) {
    sources.aiTitle = aiTitle;
    return true;
  }
  if (!sources.prompt) {
    const prompt = userPromptText(record);
    if (prompt) {
      sources.prompt = prompt;
      return true;
    }
  }
  return false;
}

function publish(agentId: number, agent: AgentState, agents: AgentStateStore): void {
  const label = resolve(agent);
  if (!label || label === agent.sessionLabel) return;
  agent.sessionLabel = label;
  agents.broadcast({ type: 'agentLabel', id: agentId, label });
}

/** Fold one freshly-read transcript record into the agent's session label. */
export function updateSessionLabel(
  agentId: number,
  agent: AgentState,
  agents: AgentStateStore,
  record: unknown,
): void {
  if (absorb(agent, record)) publish(agentId, agent, agents);
}

/** What to call this session in the terminal: its label, else its folder. */
export function sessionLabelOf(agent: Pick<AgentState, 'sessionLabel' | 'folderName'>): string {
  return agent.sessionLabel ?? agent.folderName ?? 'session';
}

function readChunk(file: string, start: number, length: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Label an agent from its transcript when watching starts. Sessions are adopted mid-way with
 * the read offset at end-of-file, so streaming alone would never see the first prompt or the
 * title: read the head (the first prompt) and then the tail (the newest title, which Claude
 * Code re-appends as the session goes on). A new file (/clear) starts from scratch.
 */
export function seedSessionLabel(agentId: number, agents: AgentStateStore): void {
  const agent = agents.get(agentId);
  if (!agent?.jsonlFile) return;
  agent.labelSources = {};
  try {
    const size = fs.statSync(agent.jsonlFile).size;
    if (size <= 0) return;
    const headLen = Math.min(size, SESSION_LABEL_SEED_BYTES);
    const tailStart = Math.max(headLen, size - SESSION_LABEL_SEED_BYTES);
    const chunks = [readChunk(agent.jsonlFile, 0, headLen)];
    if (tailStart < size) {
      // A mid-file start lands inside a record; drop that fragment.
      const tail = readChunk(agent.jsonlFile, tailStart, size - tailStart);
      chunks.push(tail.slice(tail.indexOf('\n') + 1));
    }
    for (const chunk of chunks) {
      for (const line of chunk.split('\n')) {
        if (!line) continue;
        try {
          absorb(agent, JSON.parse(line));
        } catch {
          // a record cut by the chunk edge, or not JSON
        }
      }
    }
  } catch {
    return; // unreadable transcript: the stream labels it when it can
  }
  publish(agentId, agent, agents);
}
