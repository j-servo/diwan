/**
 * ~/.diwan/audit.jsonl: append-only, 0600. One line per launch, approve, deny, timeout-deny,
 * follow-up, interrupt, stop, budget-stop and auto-approve (WebSearch only). Everything is redacted; prompts are capped at 500
 * characters; the control token never appears (it is scrubbed even if something quoted it).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getBrand } from '../brand.js';
import { redactSecrets } from '../toolDetail.js';

export const AUDIT_FILE_NAME = 'audit.jsonl';
export const AUDIT_TEXT_MAX = 500;

export type AuditAction =
  | 'launch'
  | 'approve'
  | 'auto-approve'
  | 'deny'
  | 'timeout-deny'
  | 'stop-deny'
  | 'shutdown-deny'
  | 'hello-refused'
  | 'launch-refused'
  | 'follow-up'
  | 'interrupt'
  | 'stop'
  | 'budget-stop'
  | 'session-end';

export interface AuditEntry {
  action: AuditAction;
  label: string;
  project: string;
  tool?: string;
  detail?: string;
  /** sha256 of the exact tool input JSON (approve and deny entries). */
  inputSha256?: string;
  toolUseId?: string;
  /** launch: the exact model id and effort level requested. */
  model?: string;
  effort?: string;
  /** budget-stop: tokens processed so far and the cap. */
  tokensUsed?: number;
  tokenCap?: number;
}

export function auditPath(): string {
  return path.join(os.homedir(), getBrand().dirName, AUDIT_FILE_NAME);
}

export class AuditLog {
  /** `secrets` are scrubbed from every line (the control token). */
  constructor(private readonly secrets: readonly string[] = []) {}

  private clean(text: string | undefined): string | undefined {
    if (text === undefined) return undefined;
    let out = redactSecrets(text);
    for (const s of this.secrets) if (s) out = out.split(s).join('•••');
    return out.length > AUDIT_TEXT_MAX ? `${out.slice(0, AUDIT_TEXT_MAX - 1)}…` : out;
  }

  /** True when the line reached the file. An approve that cannot be recorded must not go ahead. */
  write(entry: AuditEntry): boolean {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      action: entry.action,
      label: this.clean(entry.label),
      project: this.clean(entry.project),
      ...(entry.tool !== undefined ? { tool: this.clean(entry.tool) } : {}),
      ...(entry.detail !== undefined ? { detail: this.clean(entry.detail) } : {}),
      ...(entry.inputSha256 ? { inputSha256: entry.inputSha256 } : {}),
      ...(entry.toolUseId ? { toolUseId: this.clean(entry.toolUseId) } : {}),
      ...(entry.model ? { model: this.clean(entry.model) } : {}),
      ...(entry.effort ? { effort: this.clean(entry.effort) } : {}),
      ...(entry.tokensUsed !== undefined ? { tokensUsed: entry.tokensUsed } : {}),
      ...(entry.tokenCap !== undefined ? { tokenCap: entry.tokenCap } : {}),
    });
    try {
      const file = auditPath();
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const fd = fs.openSync(file, 'a', 0o600);
      try {
        fs.fchmodSync(fd, 0o600);
        fs.writeSync(fd, `${line}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return true;
    } catch (err) {
      console.error('[Diwan] audit log write failed:', err instanceof Error ? err.message : err);
      return false;
    }
  }
}
