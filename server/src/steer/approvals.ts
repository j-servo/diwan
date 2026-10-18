/**
 * The canUseTool bridge. Every request from a launched session becomes a pending approval shown
 * in the hall. It is allowed ONLY by an explicit Approve; any other end (Deny, no answer in 15
 * minutes, the scholar stopped, the server shutting down, the SDK aborting the call) is a deny.
 * A request resolves exactly once: a second answer or a stale id is rejected.
 */
import * as crypto from 'crypto';

import { redactSecrets, RULES } from '../toolDetail.js';

export const APPROVAL_TIMEOUT_DEFAULT_MS = 15 * 60_000;
export const DENIED_IN_DIWAN = 'Denied in Diwan';
export const NO_ANSWER = 'No answer from Diwan';
export const SCHOLAR_STOPPED = 'Stopped in Diwan';
export const DIWAN_SHUTDOWN = 'Diwan is shutting down';

/** DIWAN_APPROVAL_TIMEOUT_MS, read when the bridge is made; anything unusable falls back to 15 min. */
export function approvalTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env['DIWAN_APPROVAL_TIMEOUT_MS']);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : APPROVAL_TIMEOUT_DEFAULT_MS;
}

/**
 * The only tools a launched scholar runs without asking (Yousef's explicit call, 2026-10-17).
 * Matched by EXACT name: "mcp__x__WebSearch" and WebFetch still ask.
 */
export const AUTO_APPROVE_TOOLS: readonly string[] = ['WebSearch'];
const SEARCH_FIELDS = new Set(['query', 'mode', 'allowed_domains', 'blocked_domains']);
/** Claude Code sends `mode` ("standard" / "extended") on every WebSearch (seen in a real run, 2026-10-17). */
const SEARCH_MODE = /^[a-z]{1,16}$/;

/** Is this call auto-approved? Exact tool name, and an input of nothing but the search query
 *  (plus the SDK's optional domain filters). Anything extra asks as usual. */
export function isAutoApproved(tool: string, input: unknown): input is { query: string } {
  if (!AUTO_APPROVE_TOOLS.includes(tool)) return false;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const rec = input as Record<string, unknown>;
  if (typeof rec.query !== 'string' || rec.query.trim() === '') return false;
  return Object.keys(rec).every(
    (k) =>
      SEARCH_FIELDS.has(k) &&
      (k === 'query' ||
        (k === 'mode' && typeof rec[k] === 'string' && SEARCH_MODE.test(rec[k] as string)) ||
        (Array.isArray(rec[k]) && (rec[k] as unknown[]).every((d) => typeof d === 'string'))),
  );
}

export type PermissionVerdict =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type Outcome = 'approved' | 'denied' | 'timeout' | 'stopped' | 'shutdown' | 'budget';

export interface PendingApproval {
  requestId: string;
  /** Which launched session asked (its session id). */
  owner: string;
  tool: string;
  /** Redacted with the feed's redactor: what read-only sockets and the audit log get. */
  detail: string;
  truncated: boolean;
  /** What a control socket gets: masking that never hides shell syntax, invisibles made visible. */
  view: ApprovalDetail;
  /** sha256 of the exact input JSON (audit), and the SDK's tool call id when it gave one. */
  inputSha256: string;
  toolUseId?: string;
}

/** Equal to the redactor's own input bound, so redaction sees every character that is shown. */
export const APPROVAL_DETAIL_MAX = 4000;
const FIELD_MAX = 2000;
const EXTRA_MAX = 300;
const MASK = '•••';

/** A masked value must look like a pure token, so it can never swallow shell syntax. */
const PURE_TOKEN = /^[A-Za-z0-9._~+/=@:-]+$/;
/** A private key is masked only as a whole block: BEGIN, a base64 body and END. */
const PEM_BLOCK =
  /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[A-Za-z0-9+/=\s]*?-----END [A-Z ]{0,30}PRIVATE KEY-----/g;
const APPROVAL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  ...RULES.filter(([re]) => !re.source.includes('PRIVATE KEY')),
  [PEM_BLOCK, MASK],
];

/** Bidi controls, zero-width characters, and C0/C1 controls other than newline and tab. */
const INVISIBLE =
  /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u200B-\u200D\u2060\uFEFF\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

const token = (ch: string): string =>
  `⟦U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟧`;

/** Visible tokens for the invisible; `found` says whether any were there. */
function showInvisibles(text: string): { text: string; found: boolean } {
  let found = false;
  const out = text.replace(INVISIBLE, (ch) => {
    found = true;
    return token(ch);
  });
  return { text: out, found };
}

/**
 * Mask secrets for the approval card only. Unlike redactSecrets, a match is masked only when the
 * secret part is a plain token (optionally quoted): a mask must never swallow `$(…)`, `;`, `|`
 * or the rest of the line. Anything else stays raw, so Yousef reads what would run.
 */
function maskForApproval(text: string): { text: string; masked: number } {
  let masked = 0;
  let out = text;
  for (const [re, replacement] of APPROVAL_RULES) {
    const single = new RegExp(re.source, re.flags.replace('g', ''));
    out = out.replace(re, (match: string) => {
      const r = match.replace(single, replacement);
      const at = r.indexOf(MASK);
      if (at < 0) return match;
      const head = r.slice(0, at);
      const tail = r.slice(at + MASK.length);
      if (!match.startsWith(head) || !match.endsWith(tail)) return match;
      let secret = match.slice(head.length, match.length - tail.length);
      let open = '';
      let close = '';
      const q = secret[0];
      if (secret.length >= 2 && (q === '"' || q === "'") && secret.endsWith(q)) {
        open = q;
        close = q;
        secret = secret.slice(1, -1);
      }
      const pem = re === PEM_BLOCK;
      if (!pem && !PURE_TOKEN.test(secret)) return match;
      masked++;
      return `${head}${open}${MASK}${close}${tail}`;
    });
  }
  return { text: out, masked };
}

/** Runs of blank lines, and of spaces/tabs, become one visible marker. */
function collapseRuns(text: string): string {
  return text
    .replace(/\n(?:[ \t]*\n){4,}/g, (m) => `\n⟦${(m.match(/\n/g) ?? []).length - 1} blank lines⟧\n`)
    .replace(/[ \t]{41,}/g, (m) => `⟦${m.length} spaces/tabs⟧`);
}

export interface ApprovalExtra {
  name: string;
  value: string;
  /** A red-flag setting: shown in a warm danger colour, never the "needs you" cobalt. */
  warn?: boolean;
}

/** What the SDK adds to a permission request (names as in sdk.d.ts CanUseTool options). */
export interface ApprovalMeta {
  decisionReason?: string;
  blockedPath?: string;
  title?: string;
  /** The SDK's id for this call; goes into the audit log. */
  toolUseID?: string;
}

export interface ApprovalDetail {
  /** The whole action text for a control socket: secrets masked only where safe, invisibles made visible. */
  detail: string;
  truncated: boolean;
  masked: number;
  hidden: boolean;
  lines: number;
  chars: number;
  extras: ApprovalExtra[];
}

/** The text that shows above the buttons. Whole; multi-line is kept; nothing dangerous is hidden. */
export function approvalDetail(
  tool: string,
  input: Record<string, unknown>,
  meta: ApprovalMeta = {},
): ApprovalDetail {
  let text: string;
  let truncated = false;
  if (tool === 'Bash' && typeof input['command'] === 'string') {
    text = input['command'];
  } else {
    const shown: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (typeof v === 'string' && v.length > FIELD_MAX) {
        truncated = true;
        shown[k] = `${v.slice(0, FIELD_MAX)}… (+${v.length - FIELD_MAX} more characters)`;
      } else {
        shown[k] = v;
      }
    }
    try {
      text = JSON.stringify(shown, null, 2) ?? '';
    } catch {
      text = '(input could not be shown)';
    }
  }
  const lines = text.split('\n').length;
  const chars = text.length;
  if (text.length > APPROVAL_DETAIL_MAX) {
    text = text.slice(0, APPROVAL_DETAIL_MAX);
    truncated = true;
  }
  const vis = showInvisibles(text);
  const m = maskForApproval(vis.text);
  let hidden = vis.found;

  const extras: ApprovalExtra[] = [];
  if (tool === 'Bash') {
    if (input['dangerouslyDisableSandbox'] === true)
      extras.push({ name: 'dangerouslyDisableSandbox', value: 'true', warn: true });
    if (input['run_in_background'] === true)
      extras.push({ name: 'run_in_background', value: 'true' });
    if (typeof input['timeout'] === 'number' && Number.isFinite(input['timeout']))
      extras.push({ name: 'timeout', value: String(input['timeout']) });
  }
  for (const name of ['title', 'decisionReason', 'blockedPath'] as const) {
    const v = meta[name];
    if (typeof v !== 'string' || !v) continue;
    const e = showInvisibles(v.slice(0, EXTRA_MAX));
    if (e.found) hidden = true;
    extras.push({ name, value: redactSecrets(e.text) });
  }
  return {
    detail: collapseRuns(m.text),
    truncated,
    masked: m.masked,
    hidden,
    lines,
    chars,
    extras,
  };
}

/** sha256 of the exact input JSON, so the audit log proves WHICH call was approved. */
export function inputHash(input: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(input) ?? '';
  } catch {
    json = '';
  }
  return crypto.createHash('sha256').update(json).digest('hex');
}

/** The read-only form: today's redacted text, for sockets without control and for the audit log. */
function feedDetail(tool: string, input: Record<string, unknown>): string {
  let text: string;
  if (tool === 'Bash' && typeof input['command'] === 'string') text = input['command'];
  else {
    try {
      text = JSON.stringify(input, null, 2) ?? '';
    } catch {
      text = '(input could not be shown)';
    }
  }
  return redactSecrets(text.slice(0, APPROVAL_DETAIL_MAX));
}

interface Slot {
  info: PendingApproval;
  resolve: (v: PermissionVerdict) => void;
  timer: ReturnType<typeof setTimeout>;
  input: Record<string, unknown>;
  detach: () => void;
}

export interface ApprovalEvents {
  onPending(p: PendingApproval): void;
  onSettled(p: PendingApproval, outcome: Outcome): void;
}

export class ApprovalBridge {
  private readonly slots = new Map<string, Slot>();

  constructor(
    private readonly events: ApprovalEvents,
    private readonly timeoutMs: number = approvalTimeoutMs(),
  ) {}

  /** Ask. Resolves with the verdict; never rejects. `signal` abort (the SDK cancelling) is a deny. */
  request(
    owner: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    meta: ApprovalMeta = {},
  ): Promise<PermissionVerdict> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve({ behavior: 'deny', message: SCHOLAR_STOPPED });
        return;
      }
      const requestId = crypto.randomUUID();
      const view = approvalDetail(tool, input, meta);
      const info: PendingApproval = {
        requestId,
        owner,
        tool,
        detail: feedDetail(tool, input),
        truncated: view.truncated,
        view,
        inputSha256: inputHash(input),
        ...(meta.toolUseID ? { toolUseId: meta.toolUseID } : {}),
      };
      const onAbort = (): void => this.settle(requestId, 'stopped');
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => this.settle(requestId, 'timeout'), this.timeoutMs);
      timer.unref?.();
      this.slots.set(requestId, {
        info,
        resolve,
        timer,
        input,
        detach: () => signal?.removeEventListener('abort', onAbort),
      });
      this.events.onPending(info);
    });
  }

  /** The user's click. False for a stale or already-answered id: nothing changes then. */
  answer(requestId: string, allow: boolean): boolean {
    if (typeof requestId !== 'string' || !this.slots.has(requestId)) return false;
    this.settle(requestId, allow ? 'approved' : 'denied');
    return true;
  }

  /** Deny everything one session has pending (it was stopped). */
  denyOwner(owner: string, outcome: 'stopped' | 'shutdown' | 'budget' = 'stopped'): void {
    for (const [id, slot] of [...this.slots]) {
      if (slot.info.owner === owner) this.settle(id, outcome);
    }
  }

  denyAll(outcome: 'stopped' | 'shutdown' = 'shutdown'): void {
    for (const id of [...this.slots.keys()]) this.settle(id, outcome);
  }

  pending(): PendingApproval[] {
    return [...this.slots.values()].map((s) => s.info);
  }

  private settle(requestId: string, outcome: Outcome): void {
    const slot = this.slots.get(requestId);
    if (!slot) return; // exactly once
    this.slots.delete(requestId);
    clearTimeout(slot.timer);
    slot.detach();
    switch (outcome) {
      case 'approved':
        slot.resolve({ behavior: 'allow', updatedInput: slot.input });
        break;
      case 'denied':
        slot.resolve({ behavior: 'deny', message: DENIED_IN_DIWAN });
        break;
      case 'timeout':
        slot.resolve({ behavior: 'deny', message: NO_ANSWER });
        break;
      case 'stopped':
        slot.resolve({ behavior: 'deny', message: SCHOLAR_STOPPED });
        break;
      case 'shutdown':
        slot.resolve({ behavior: 'deny', message: DIWAN_SHUTDOWN });
        break;
      case 'budget':
        slot.resolve({ behavior: 'deny', message: 'Token budget reached' });
        break;
    }
    this.events.onSettled(slot.info, outcome);
  }
}
