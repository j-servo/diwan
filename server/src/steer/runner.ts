/**
 * The runner: what launches and steers one Claude Code session. `SteerRunner` is the seam the
 * tests fake; `SdkRunner` is the real one, a thin layer over the Agent SDK's query() in
 * streaming-input mode (so follow-ups reach the SAME session).
 *
 * The permission mode is always 'default': never bypassPermissions, acceptEdits, auto or dontAsk.
 * Settings load from the user's own files so his allow/deny rules and CLAUDE.md apply exactly as
 * in his terminal. The SDK uses the Claude login already on this Mac; no credential is read here.
 */
import type { EffortLevel } from '../../../core/src/steerChoices.js';
import type { ApprovalMeta, PermissionVerdict } from './approvals.js';
import { TokenMeter } from './tokenMeter.js';

/** The session is over: an error, or closed (stop(), or the stream ended). The token budget stop
 *  is the manager's call (it stops the session), not an end the session reports. */
export type EndKind = 'error' | 'closed';

export interface RunnerLaunch {
  /** The session id we choose, so the transcript watcher and hooks attach to the same scholar. */
  sessionId: string;
  cwd: string;
  task: string;
  model: string;
  effort: EffortLevel;
  canUseTool: (
    tool: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    meta?: ApprovalMeta,
  ) => Promise<PermissionVerdict>;
  /** Running total of tokens processed, after each assistant message and each result. */
  onUsage: (totalTokens: number) => void;
  /** The effort level the session reports it is ACTUALLY running at (the SDK may lower it). */
  onEffort?: (effort: EffortLevel) => void;
  /** A top-level assistant text block: the scholar's reply. */
  onText?: (text: string) => void;
  /** A top-level tool call the scholar made (a one-line step in the conversation). */
  onTool?: (name: string, input: unknown) => void;
  /** A turn ended (the SDK result): fine, or an error with its reason. */
  onTurnEnd?: (outcome: { ok: true } | { ok: false; error: string }) => void;
  /** The session is over: the budget stop, an error, or closed by stop(). Called once. */
  onEnd: (kind: EndKind, message?: string) => void;
}

export interface RunnerSession {
  followUp(text: string): void;
  interrupt(): Promise<void>;
  /** Abort. */
  stop(): void;
}

export interface SteerRunner {
  start(launch: RunnerLaunch): RunnerSession;
}

/** Pushes user messages into the SDK's streaming input; ends when closed. */
export class InputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({ value: this.items.shift() as T, done: false });
        }
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

// The SDK is an ES module; this package is CommonJS, so the type import names its mode.
type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk', {
  with: { 'resolution-mode': 'import' },
});

/** Load lazily: plain `diwan` and every test that fakes the runner never touch the SDK. */
async function loadSdk(): Promise<SdkModule> {
  return import('@anthropic-ai/claude-agent-sdk');
}

function userMessage(text: string, sessionId: string) {
  return {
    type: 'user' as const,
    message: { role: 'user' as const, content: text },
    parent_tool_use_id: null,
    session_id: sessionId,
  };
}

export class SdkRunner implements SteerRunner {
  constructor(private readonly load: () => Promise<SdkModule> = loadSdk) {}

  start(launch: RunnerLaunch): RunnerSession {
    const input = new InputQueue<ReturnType<typeof userMessage>>();
    const abort = new AbortController();
    let query: { interrupt(): Promise<unknown> } | null = null;
    let ended = false;
    const end = (kind: EndKind, message?: string): void => {
      if (ended) return;
      ended = true;
      input.close();
      launch.onEnd(kind, message);
    };

    input.push(userMessage(launch.task, launch.sessionId));

    void (async () => {
      try {
        const sdk = await this.load();
        if (abort.signal.aborted) return end('closed');
        const q = sdk.query({
          prompt: input as AsyncIterable<never>,
          options: {
            sessionId: launch.sessionId,
            cwd: launch.cwd,
            model: launch.model,
            effort: launch.effort,
            abortController: abort,
            permissionMode: 'default',
            settingSources: ['user', 'project', 'local'],
            canUseTool: async (tool, toolInput, opts) =>
              launch.canUseTool(tool, toolInput, opts.signal, {
                decisionReason: opts.decisionReason,
                blockedPath: opts.blockedPath,
                title: opts.title,
                toolUseID: opts.toolUseID,
              }),
          },
        });
        query = q;
        const meter = new TokenMeter();
        for await (const msg of q) {
          if (msg.type === 'assistant') {
            launch.onUsage(meter.addAssistant(msg));
            if (msg.parent_tool_use_id === null || msg.parent_tool_use_id === undefined) {
              for (const block of msg.message?.content ?? []) {
                if (block.type === 'text' && block.text.trim()) launch.onText?.(block.text);
                else if (block.type === 'tool_use') launch.onTool?.(block.name, block.input);
              }
            }
          } else if (msg.type === 'result') {
            launch.onUsage(meter.reconcile(msg.modelUsage));
            if (msg.is_error || msg.subtype !== 'success') {
              const why = 'errors' in msg && msg.errors?.[0] ? msg.errors[0] : msg.subtype;
              launch.onTurnEnd?.({ ok: false, error: String(why) });
            } else {
              launch.onTurnEnd?.({ ok: true });
            }
          } else if (msg.type === 'system' && msg.subtype === 'init' && msg.effort) {
            launch.onEffort?.(msg.effort);
          }
        }
        end('closed');
      } catch (err) {
        if (abort.signal.aborted) return end('closed');
        end('error', err instanceof Error ? err.message : String(err));
      }
    })();

    return {
      followUp: (text) => input.push(userMessage(text, launch.sessionId)),
      interrupt: async () => {
        await query?.interrupt();
      },
      stop: () => {
        abort.abort();
        end('closed');
      },
    };
  }
}
