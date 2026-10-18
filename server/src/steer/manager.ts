/**
 * SteerManager: the launched sessions, their approvals, and the control messages that steer them.
 * Only the connection layer decides WHO may send control messages (scope.ts); this layer decides
 * WHAT is allowed: a registered project, an existing steerable scholar, a pending request id.
 */
import * as crypto from 'crypto';
import * as path from 'path';

import type { EffortLevel } from '../../../core/src/steerChoices.js';
import { formatTokens } from '../../../core/src/steerChoices.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { sessionLabelOf } from '../sessionLabel.js';
import { terminalSafe } from '../terminalText.js';
import type { AgentState } from '../types.js';
import {
  ApprovalBridge,
  isAutoApproved,
  type Outcome,
  type PendingApproval,
  type PermissionVerdict,
} from './approvals.js';
import { type AuditAction, AuditLog } from './audit.js';
import {
  Conversation,
  type ReplyEntry,
  type ReplyRole,
  safeLine,
  toolStepLine,
} from './conversation.js';
import { listProjects, ProjectError, resolveRegistered } from './projects.js';
import { type EndKind, type RunnerSession, type SteerRunner } from './runner.js';
import { type ControlMessage, parseControl } from './validate.js';

export const MAX_RUNNING_SCHOLARS = 8;

type Msg = Record<string, unknown>;
export type Reply = (message: Msg) => void;

interface Launch {
  sessionId: string;
  project: string;
  fallbackLabel: string;
  model: string;
  /** The effort level: the one requested, until the session reports the one it is actually on. */
  effort: string;
  tokenCap: number;
  tokensUsed: number;
  convo: Conversation;
  /** working: a turn is running; idle: it ended with no text; answered: ended with a final answer;
   *  error: it ended in an error. */
  turn: 'working' | 'idle' | 'answered' | 'error';
  answerSeq: number;
  turnError?: string;
  /** The newest assistant text of the running turn: the final answer if the turn ends now. */
  lastText: string;
  agentId: number | null;
  running: boolean;
  stopped?: string;
  session: RunnerSession | null;
}

export interface SteerDeps {
  store: AgentStateStore;
  runtime?: Pick<AgentRuntime, 'removeAgent' | 'dismissalTracker'>;
  runner: SteerRunner;
  audit: AuditLog;
  /** Fresh approval timeout; default DIWAN_APPROVAL_TIMEOUT_MS (15 min). */
  approvalTimeoutMs?: number;
  log?: (line: string) => void;
}

/** Messages after which a pending approval's lamp is re-asserted (the transcript lags the SDK). */
const REASSERT_AFTER = new Set([
  'agentToolStart',
  'agentStatus',
  'agentToolsClear',
  'agentToolDone',
]);

export class SteerManager {
  private readonly launches = new Map<string, Launch>();
  private readonly bridge: ApprovalBridge;
  private readonly log: (line: string) => void;
  private readonly onAdded = (_id: number, agent: AgentState): void => this.bindAgent(agent);
  private readonly onBroadcast = (m: Msg): void => this.reassert(m);

  constructor(private readonly deps: SteerDeps) {
    const out = deps.log ?? ((line: string) => console.log(line));
    // Labels and SDK error text come from outside: nothing in them may drive the terminal.
    this.log = (line) => out(terminalSafe(line));
    this.bridge = new ApprovalBridge(
      {
        onPending: (p) => this.announce(p),
        onSettled: (p, o) => this.settled(p, o),
      },
      deps.approvalTimeoutMs,
    );
    deps.store.on('agentAdded', this.onAdded);
    deps.store.on('broadcast', this.onBroadcast);
  }

  // ── what the connection layer asks ──────────────────────────────

  isSteerable(agent: Pick<AgentState, 'sessionId' | 'jsonlFile'>): boolean {
    return this.launchOf(agent) !== undefined;
  }

  projects(): { path: string; name: string }[] {
    try {
      return listProjects();
    } catch (err) {
      if (!(err instanceof ProjectError)) throw err;
      this.log(`[Diwan] ${err.message}`);
      return [];
    }
  }

  /** Is this agent a launched scholar whose session is still running? (Exempt from silent retire.) */
  isRunning(agent: Pick<AgentState, 'sessionId' | 'jsonlFile'>): boolean {
    return this.launchOf(agent)?.running === true;
  }

  /** A refused handshake or control message from the connection layer, for the audit trail. */
  auditRefusal(action: 'hello-refused' | 'launch-refused', detail: string, project = ''): void {
    this.deps.audit.write({ action, label: '-', project, detail });
  }

  /** State for a client that just connected. `control` picks the full approval card or the feed's redacted one. */
  snapshot(control = false): Msg[] {
    const out: Msg[] = [];
    for (const l of this.launches.values()) {
      if (l.agentId === null) continue;
      out.push(this.agentMessage(l));
      if (control) for (const e of l.convo.history()) out.push(this.replyMessage(l, e));
    }
    for (const p of this.bridge.pending()) {
      const m = this.approvalMessage(p, control);
      if (m) out.push(m);
    }
    return out;
  }

  /** One validated control message from a socket that holds the control scope. */
  handle(raw: Msg, reply: Reply): void {
    const parsed = parseControl(raw);
    if (!parsed.ok) {
      if (raw.type === 'steerLaunch') {
        this.auditRefusal(
          'launch-refused',
          parsed.error,
          typeof raw.project === 'string' ? raw.project : '',
        );
      }
      return this.fail(reply, parsed.error);
    }
    this.dispatch(parsed.msg, reply);
  }

  /** Server shutdown or Ctrl-C: deny everything pending, abort every launched session. */
  shutdown(): void {
    this.deps.store.off('agentAdded', this.onAdded);
    this.deps.store.off('broadcast', this.onBroadcast);
    const live = [...this.launches.values()].filter((l) => l.running);
    if (live.length > 0) {
      this.log(`[Diwan] stopping ${live.length} launched scholar${live.length === 1 ? '' : 's'}`);
    }
    this.bridge.denyAll('shutdown');
    for (const l of live) {
      l.running = false;
      l.stopped = 'Diwan shut down';
      this.record('stop', l, undefined, 'Diwan shut down');
      l.session?.stop();
    }
  }

  // ── dispatch ────────────────────────────────────────────────────

  private dispatch(msg: ControlMessage, reply: Reply): void {
    switch (msg.type) {
      case 'steerLaunch':
        return this.launch(msg, reply);
      case 'steerAnswer': {
        const p = this.bridge.pending().find((o) => o.requestId === msg.requestId);
        if (!p) return this.fail(reply, 'That request is no longer waiting');
        // An approve is recorded BEFORE it takes effect; if the record cannot be written it
        // becomes a deny (fail closed) and the card says why.
        if (msg.allow && !this.recordApprove(p)) {
          this.bridge.answer(msg.requestId, false);
          return this.fail(reply, 'The audit log could not be written, so this was denied');
        }
        this.bridge.answer(msg.requestId, msg.allow);
        return;
      }
      default: {
        const launch = this.byAgentId(msg.id);
        if (!launch) return this.fail(reply, 'Not a scholar launched from Diwan');
        if (msg.type === 'steerStop') return this.stop(launch);
        if (!launch.running || !launch.session) return this.fail(reply, 'That scholar has stopped');
        if (msg.type === 'steerFollowUp') {
          launch.session.followUp(msg.text);
          launch.turn = 'working';
          launch.lastText = '';
          launch.turnError = undefined;
          this.reply(launch, 'user', msg.text);
          if (launch.agentId !== null) this.broadcast(this.agentMessage(launch));
          this.record('follow-up', launch, undefined, msg.text);
          this.log(`[Diwan] ${this.labelOf(launch)} follow-up sent`);
        } else {
          void launch.session.interrupt().catch(() => {});
          this.record('interrupt', launch);
          this.log(`[Diwan] ${this.labelOf(launch)} interrupted`);
        }
      }
    }
  }

  private launch(msg: Extract<ControlMessage, { type: 'steerLaunch' }>, reply: Reply): void {
    const done = (ok: boolean, error?: string): void =>
      reply({ type: 'steerResult', ok, ref: msg.ref, ...(error ? { error } : {}) });
    const refuse = (why: string): void => {
      this.auditRefusal('launch-refused', why, msg.project);
      done(false, why);
    };
    const cwd = resolveRegistered(msg.project);
    if (cwd === null)
      return refuse('That folder is not a registered project (diwan projects add <path>)');
    const running = [...this.launches.values()].filter((l) => l.running).length;
    if (running >= MAX_RUNNING_SCHOLARS)
      return refuse(`At most ${MAX_RUNNING_SCHOLARS} launched scholars at once`);

    const sessionId = crypto.randomUUID();
    const launch: Launch = {
      sessionId,
      project: cwd,
      fallbackLabel: path.basename(cwd),
      model: msg.model,
      effort: msg.effort,
      tokenCap: msg.tokenBudget,
      tokensUsed: 0,
      convo: new Conversation(),
      turn: 'working',
      answerSeq: 0,
      lastText: '',
      agentId: null,
      running: true,
      session: null,
    };
    // Claimed BEFORE the session starts, so whichever of the transcript watcher or the hook path
    // sees it first attaches to this entry instead of creating a second scholar.
    this.launches.set(sessionId, launch);
    try {
      launch.session = this.deps.runner.start({
        sessionId,
        cwd,
        task: msg.task,
        model: msg.model,
        effort: msg.effort as EffortLevel,
        canUseTool: (tool, input, signal, meta) => this.canUse(launch, tool, input, signal, meta),
        onText: (text) => this.said(launch, text),
        onTool: (name, input) => this.step(launch, name, input),
        onTurnEnd: (outcome) => this.turnEnded(launch, outcome),
        onUsage: (total) => this.usage(launch, total),
        onEffort: (effort) => this.reportedEffort(launch, effort),
        onEnd: (kind, message) => this.ended(launch, kind, message),
      });
    } catch (err) {
      this.launches.delete(sessionId);
      return done(false, err instanceof Error ? err.message : String(err));
    }
    this.record('launch', launch, undefined, msg.task);
    launch.convo.add('user', msg.task);
    this.log(`[Diwan] launched a scholar in ${launch.fallbackLabel}`);
    // The agent may already exist (a hook beat us); bind it now.
    for (const a of this.deps.store.values()) this.bindAgent(a);
    done(true);
  }

  private stop(launch: Launch): void {
    this.record('stop', launch);
    this.log(`[Diwan] ${this.labelOf(launch)} stopped by you`);
    launch.running = false;
    launch.stopped = 'stopped';
    this.bridge.denyOwner(launch.sessionId, 'stopped');
    launch.session?.stop();
    this.broadcast(this.agentMessage(launch));
    const id = launch.agentId;
    const agent = id !== null ? this.deps.store.get(id) : undefined;
    if (id !== null && agent && this.deps.runtime) {
      this.deps.runtime.dismissalTracker.dismiss(agent.jsonlFile);
      this.deps.runtime.removeAgent(id);
    }
  }

  // ── runner callbacks ────────────────────────────────────────────

  // ── conversation ────────────────────────────────────────────────

  private replyMessage(l: Launch, e: ReplyEntry): Msg {
    return {
      type: 'steerReply',
      id: l.agentId,
      seq: e.seq,
      role: e.role,
      text: e.text,
      at: e.at,
      ...(e.truncated ? { truncated: true } : {}),
    };
  }

  /** Keep an entry; send it live to control sockets (the connection layer drops it for the rest). */
  private reply(l: Launch, role: ReplyRole, text: string): void {
    const e = l.convo.add(role, text);
    if (l.agentId !== null) this.broadcast(this.replyMessage(l, e));
  }

  private said(l: Launch, text: string): void {
    l.lastText = text;
    this.reply(l, 'assistant', text);
  }

  private step(l: Launch, name: string, input: unknown): void {
    // An auto-approved search is entered by canUse ("Searched the web ... (auto-approved)").
    if (isAutoApproved(name, input)) return;
    this.reply(l, 'tool', toolStepLine(name, input));
  }

  private turnEnded(l: Launch, outcome: { ok: true } | { ok: false; error: string }): void {
    if (!l.running) return;
    if (!outcome.ok) {
      l.turn = 'error';
      l.turnError = outcome.error;
      this.log(`[Diwan] ${this.labelOf(l)} turn ended with an error`);
    } else if (l.lastText.trim() !== '') {
      l.turn = 'answered';
      l.turnError = undefined;
      l.answerSeq++;
      this.log(`[Diwan] ${this.labelOf(l)} answered`);
    } else {
      l.turn = 'idle';
      l.turnError = undefined;
    }
    l.lastText = '';
    if (l.agentId !== null) this.broadcast(this.agentMessage(l));
  }

  /**
   * The canUseTool gate. A WebSearch with nothing but a query is allowed at once (and audited
   * first: if that cannot be written it is denied, like an approve); everything else asks.
   */
  private canUse(
    launch: Launch,
    tool: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    meta?: Parameters<ApprovalBridge['request']>[4],
  ): Promise<PermissionVerdict> {
    if (launch.running && isAutoApproved(tool, input)) {
      const ok = this.record('auto-approve', launch, tool, input.query);
      if (!ok) {
        return Promise.resolve({
          behavior: 'deny',
          message: 'The audit log could not be written, so this was denied',
        });
      }
      const q = safeLine(input.query.split('\n')[0]).slice(0, 120);
      this.reply(launch, 'tool', `Searched the web: ${q} (auto-approved)`);
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    return this.bridge.request(launch.sessionId, tool, input, signal, meta);
  }

  private usage(launch: Launch, total: number): void {
    if (!Number.isFinite(total) || !launch.running) return;
    launch.tokensUsed = total;
    if (total >= launch.tokenCap) return this.budgetStop(launch);
    if (launch.agentId !== null) this.broadcast(this.agentMessage(launch));
  }

  private reportedEffort(launch: Launch, effort: string): void {
    if (launch.effort === effort) return;
    launch.effort = effort;
    if (launch.agentId !== null) this.broadcast(this.agentMessage(launch));
  }

  /** The cap is reached: deny what is pending, interrupt, abort. One message of overshoot is fine. */
  private budgetStop(launch: Launch): void {
    launch.running = false;
    launch.stopped = `token budget reached (${formatTokens(launch.tokensUsed)} of ${formatTokens(launch.tokenCap)})`;
    this.bridge.denyOwner(launch.sessionId, 'budget');
    this.deps.audit.write({
      action: 'budget-stop',
      label: this.labelOf(launch),
      project: launch.project,
      tokensUsed: launch.tokensUsed,
      tokenCap: launch.tokenCap,
    });
    this.log(`[Diwan] ${this.labelOf(launch)} stopped: ${launch.stopped}`);
    this.broadcast(this.agentMessage(launch));
    const session = launch.session;
    if (!session) return;
    let timer: NodeJS.Timeout | undefined;
    const patience = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 1000);
      timer.unref();
    });
    void Promise.race([session.interrupt().catch(() => {}), patience]).finally(() => {
      clearTimeout(timer);
      session.stop();
    });
  }

  private ended(launch: Launch, kind: EndKind, message?: string): void {
    this.bridge.denyOwner(launch.sessionId, 'stopped');
    if (!launch.running && launch.stopped) return; // we ended it ourselves (stop / shutdown)
    launch.running = false;
    launch.stopped = kind === 'error' ? `error: ${message ?? 'unknown'}` : 'ended';
    this.record('session-end', launch, undefined, launch.stopped);
    this.log(`[Diwan] ${this.labelOf(launch)} stopped: ${launch.stopped}`);
    if (launch.agentId !== null) this.broadcast(this.agentMessage(launch));
  }

  // ── approvals ───────────────────────────────────────────────────

  private announce(p: PendingApproval): void {
    const m = this.approvalMessage(p);
    if (m) {
      this.broadcast(m);
      this.broadcast({ type: 'agentToolPermission', id: m.id });
    }
    // else: the scholar has not walked in yet; bindAgent announces it when it does.
  }

  private settled(p: PendingApproval, outcome: Outcome): void {
    const launch = this.launches.get(p.owner);
    if (launch) {
      // An approve was already recorded (before it took effect) by recordApprove.
      if (outcome !== 'approved') {
        const action: AuditAction =
          outcome === 'denied'
            ? 'deny'
            : outcome === 'timeout'
              ? 'timeout-deny'
              : outcome === 'shutdown'
                ? 'shutdown-deny'
                : 'stop-deny';
        this.record(action, launch, p.tool, p.detail, p);
      }
      if (launch.agentId !== null) {
        this.broadcast({
          type: 'steerApprovalClear',
          id: launch.agentId,
          requestId: p.requestId,
          outcome,
        });
        if (!this.bridge.pending().some((o) => o.owner === p.owner)) {
          this.broadcast({ type: 'agentToolPermissionClear', id: launch.agentId });
        }
      }
    }
  }

  /**
   * The approval as the wire carries it. The broadcast feed (every socket) gets the redacted
   * `detail`; a control socket is sent the full card by the connection layer via `controlForm`.
   */
  private approvalMessage(p: PendingApproval, control = false): Msg | null {
    const launch = this.launches.get(p.owner);
    if (!launch || launch.agentId === null) return null;
    const base = {
      type: 'steerApproval',
      id: launch.agentId,
      requestId: p.requestId,
      tool: p.tool,
    };
    if (!control) {
      return { ...base, detail: p.detail, ...(p.truncated ? { truncated: true } : {}) };
    }
    const v = p.view;
    return {
      ...base,
      detail: v.detail,
      ...(v.truncated ? { truncated: true } : {}),
      ...(v.masked > 0 ? { masked: v.masked } : {}),
      ...(v.hidden ? { hidden: true } : {}),
      lines: v.lines,
      chars: v.chars,
      ...(v.extras.length > 0 ? { extras: v.extras } : {}),
    };
  }

  /** A control socket's version of a broadcast steerApproval; anything else passes through. */
  controlForm(m: Msg): Msg {
    if (m.type !== 'steerApproval' || typeof m.requestId !== 'string') return m;
    const p = this.bridge.pending().find((o) => o.requestId === m.requestId);
    return (p && this.approvalMessage(p, true)) || m;
  }

  private reassert(m: Msg): void {
    if (typeof m.type !== 'string' || !REASSERT_AFTER.has(m.type)) return;
    const launch = this.byAgentId(m.id);
    if (!launch || !this.bridge.pending().some((p) => p.owner === launch.sessionId)) return;
    queueMicrotask(() => {
      if (
        this.bridge.pending().some((p) => p.owner === launch.sessionId) &&
        launch.agentId !== null
      ) {
        this.deps.store.broadcast({ type: 'agentToolPermission', id: launch.agentId });
      }
    });
  }

  // ── binding the scholar the watcher or hooks created ────────────

  private launchOf(agent: Pick<AgentState, 'sessionId' | 'jsonlFile'>): Launch | undefined {
    return (
      this.launches.get(agent.sessionId) ??
      (agent.jsonlFile ? this.launches.get(path.basename(agent.jsonlFile, '.jsonl')) : undefined)
    );
  }

  private bindAgent(agent: AgentState): void {
    const launch = this.launchOf(agent);
    if (!launch || launch.agentId !== null) return;
    launch.agentId = agent.id;
    this.broadcast(this.agentMessage(launch));
    for (const e of launch.convo.history()) this.broadcast(this.replyMessage(launch, e));
    for (const p of this.bridge.pending()) {
      if (p.owner === launch.sessionId) this.announce(p);
    }
  }

  private byAgentId(id: unknown): Launch | undefined {
    for (const l of this.launches.values()) if (l.agentId === id && id !== null) return l;
    return undefined;
  }

  private agentMessage(l: Launch): Msg {
    return {
      type: 'steerAgent',
      id: l.agentId,
      steerable: true,
      running: l.running,
      model: l.model,
      effort: l.effort,
      tokensUsed: l.tokensUsed,
      tokenCap: l.tokenCap,
      turn: l.turn,
      answerSeq: l.answerSeq,
      ...(l.turnError ? { turnError: l.turnError } : {}),
      ...(l.stopped ? { stopped: l.stopped } : {}),
    };
  }

  private labelOf(l: Launch): string {
    const agent = l.agentId !== null ? this.deps.store.get(l.agentId) : undefined;
    return agent ? sessionLabelOf(agent) : l.fallbackLabel;
  }

  // ── plumbing ────────────────────────────────────────────────────

  private record(
    action: AuditAction,
    l: Launch,
    tool?: string,
    detail?: string,
    call?: PendingApproval,
  ): boolean {
    return this.deps.audit.write({
      action,
      label: this.labelOf(l),
      project: l.project,
      tool,
      detail,
      ...(action === 'launch' ? { model: l.model, effort: l.effort } : {}),
      ...(call ? { inputSha256: call.inputSha256, toolUseId: call.toolUseId } : {}),
    });
  }

  private recordApprove(p: PendingApproval): boolean {
    const launch = this.launches.get(p.owner);
    return launch ? this.record('approve', launch, p.tool, p.detail, p) : false;
  }

  private broadcast(m: Msg): void {
    this.deps.store.broadcast(m);
  }

  private fail(reply: Reply, error: string): void {
    reply({ type: 'steerResult', ok: false, error });
  }
}
