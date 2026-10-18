/**
 * What a launched scholar says and does, kept per scholar so the hall can show the conversation
 * (the task, each assistant reply, each follow-up, each tool step as one line). Sent to control
 * sockets only: a reply can carry anything the session read. Bounded: the last 200 entries or
 * 200 KB, and no single text over 20 KB.
 */
import { redactSecrets } from '../toolDetail.js';

export const REPLY_TEXT_MAX = 20 * 1024;
export const HISTORY_MAX_ENTRIES = 200;
export const HISTORY_MAX_BYTES = 200 * 1024;
export const TOOL_LINE_MAX = 160;

export type ReplyRole = 'assistant' | 'user' | 'tool';

export interface ReplyEntry {
  seq: number;
  role: ReplyRole;
  text: string;
  at: number;
  truncated?: true;
}

export class Conversation {
  private entries: ReplyEntry[] = [];
  private bytes = 0;
  private next = 1;

  add(role: ReplyRole, text: string, at = Date.now()): ReplyEntry {
    const cut = text.length > REPLY_TEXT_MAX;
    const entry: ReplyEntry = {
      seq: this.next++,
      role,
      text: cut ? `${text.slice(0, REPLY_TEXT_MAX)}\n[cut: longer than 20 KB]` : text,
      at,
      ...(cut ? { truncated: true as const } : {}),
    };
    this.entries.push(entry);
    this.bytes += entry.text.length;
    while (
      this.entries.length > 1 &&
      (this.entries.length > HISTORY_MAX_ENTRIES || this.bytes > HISTORY_MAX_BYTES)
    ) {
      this.bytes -= this.entries.shift()!.text.length;
    }
    return entry;
  }

  history(): readonly ReplyEntry[] {
    return this.entries;
  }
}

/** One safe line for a tool step: "Bash: npm test", "Read: src/a.ts". Secrets masked, controls dropped. */
export function toolStepLine(name: string, input: unknown): string {
  const rec = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const pick = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description'].find(
    (k) => typeof rec[k] === 'string' && (rec[k] as string).trim() !== '',
  );
  const arg = pick ? String(rec[pick]).split('\n')[0] : '';
  return safeLine(arg ? `${name}: ${arg}` : name);
}

/** Secrets masked, control characters dropped, capped: safe as a one-line entry. */
export function safeLine(text: string): string {
   
  const clean = redactSecrets(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
  return clean.length > TOOL_LINE_MAX ? `${clean.slice(0, TOOL_LINE_MAX - 1)}…` : clean;
}
