// webview-3d/src/steer/SteerCard.tsx
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { effortWord, formatTokens, modelLabel } from '../../../core/src/steerChoices.js';
import { Markdown } from './Markdown.js';
import type { SteerAgentInfo, SteerAsk, SteerReply } from './steerStore.js';
import { activeNouns, capitalized } from '../worlds/personas.js';

/** Approve stays disabled this long after a request is shown: a double-click aimed at the previous
 *  request can never land on a new one. Deny is always live. */
export const APPROVE_ARM_MS = 700;
export const FOLLOW_UP_MAX = 8000;

export interface SteerView {
  agent: SteerAgentInfo;
  /** Pending requests for this scholar, oldest first. */
  asks: readonly SteerAsk[];
  /** The conversation so far, oldest first. */
  replies: readonly SteerReply[];
  /** The newest refusal of an answer or control message (no launch ref), if recent. */
  notice?: string;
  answer(requestId: string, allow: boolean): void;
  followUp(text: string): void;
  interrupt(): void;
  stop(): void;
}

/** The state line: "Answer ready" when the last turn ended with a final answer; errors say so. */
export function turnLine(a: Pick<SteerAgentInfo, 'turn' | 'turnError' | 'stopped'>): string | null {
  if (a.stopped) return null;
  if (a.turn === 'answered') return 'Answer ready';
  if (a.turn === 'error')
    return `The last turn ended with an error${a.turnError ? `: ${a.turnError}` : ''}`;
  return null;
}

/** Follow the newest entry unless the reader has scrolled up to read. */
export function stickToBottom(m: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= 24;
}

const ROLE_LABEL: Record<SteerReply['role'], string> = {
  user: 'You',
  get assistant() {
    return capitalized(activeNouns().agent);
  },
  tool: '',
};

/** The task, the replies, the follow-ups and each tool step as a one-line entry; newest at the bottom. */
export function Conversation(props: { replies: readonly SteerReply[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [props.replies]);
  if (props.replies.length === 0) return null;
  return (
    <div
      ref={box}
      className="ic-convo"
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      onScroll={(e) => {
        stick.current = stickToBottom(e.currentTarget);
      }}
    >
      {props.replies.map((r) =>
        r.role === 'tool' ? (
          <p key={r.seq} className="ic-step">
            {r.text}
          </p>
        ) : (
          <div key={r.seq} className={`ic-msg ic-msg--${r.role}`}>
            <span className="ic-who">{ROLE_LABEL[r.role]}</span>
            {r.role === 'assistant' ? (
              <Markdown text={r.text} />
            ) : (
              <p className="ic-plain">{r.text}</p>
            )}
            {r.truncated && <small>This reply was cut at 20 KB.</small>}
          </div>
        ),
      )}
    </div>
  );
}

/** "Sonnet 5.5 · high" */
export const modelLine = (a: Pick<SteerAgentInfo, 'model' | 'effort'>): string =>
  `${modelLabel(a.model)} · ${effortWord(a.effort)}`;

/** "182K of 500K tokens" */
export const tokenLine = (a: Pick<SteerAgentInfo, 'tokensUsed' | 'tokenCap'>): string =>
  `${formatTokens(a.tokensUsed)} of ${formatTokens(a.tokenCap)} tokens`;

/** The progress bar: a warm neutral, a warm amber past 80%. Never cobalt (that is "needs you"). */
export function tokenBar(a: Pick<SteerAgentInfo, 'tokensUsed' | 'tokenCap'>): {
  pct: number;
  warn: boolean;
} {
  const ratio = a.tokenCap > 0 ? a.tokensUsed / a.tokenCap : 0;
  return { pct: Math.round(Math.min(1, Math.max(0, ratio)) * 100), warn: ratio > 0.8 };
}

/** Does something editable hold the keyboard? A new request must not steal a half-typed message. */
function typing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
}

/** Approve needs both: the double-click guard has passed AND the end of the command was in view. */
export function approveArmed(guardDone: boolean, endSeen: boolean): boolean {
  return guardDone && endSeen;
}

/** The warnings above the command, most important first. Empty when there is nothing to warn of. */
export function askWarnings(ask: SteerAsk): string[] {
  const out: string[] = [];
  if (ask.hidden)
    out.push('Hidden characters were found. They are shown as ⟦U+XXXX⟧ in the command below.');
  if (ask.masked > 0) out.push(`${ask.masked} value${ask.masked === 1 ? '' : 's'} masked`);
  if (ask.truncated) out.push('Only the start is shown. Deny it unless you trust the rest.');
  return out;
}

export function askSize(ask: SteerAsk): string | null {
  if (ask.lines === undefined || ask.chars === undefined) return null;
  return `${ask.lines} line${ask.lines === 1 ? '' : 's'} · ${ask.chars} characters`;
}

/**
 * The oldest pending request: warnings first, then the whole command (never collapsed), then its
 * extra settings. An end sentinel reports when the last of the command has been in view, which is
 * what arms Approve. Remount it per request (key) so a replaced request starts unseen.
 */
export function AskPanel(props: { ask: SteerAsk; waiting: number; onEndSeen?(): void }) {
  const { ask, waiting } = props;
  const sentinel = useRef<HTMLSpanElement>(null);
  const seen = useRef(props.onEndSeen);
  seen.current = props.onEndSeen;

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      seen.current?.(); // no observer to ask: the command is in the DOM whole
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        seen.current?.();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ask.requestId]);

  const warnings = askWarnings(ask);
  const size = askSize(ask);
  return (
    <section className="ic-needs ic-ask" aria-label="Needs you">
      <h3>Needs you</h3>
      <p>
        Wants to run: <b>{ask.tool}</b>
      </p>
      {warnings.length > 0 && (
        <ul className="ic-warnings" aria-label="Check before approving">
          {warnings.map((w) => (
            <li key={w} className="ic-warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      {size && <p className="ic-size">{size}</p>}
      <pre className="ic-detail ic-ask-detail" tabIndex={0}>
        {ask.detail}
        <span ref={sentinel} className="ic-end" data-testid="ask-end" aria-hidden="true" />
      </pre>
      {ask.extras.length > 0 && (
        <ul className="ic-extras" aria-label="Settings">
          {ask.extras.map((x) => (
            <li key={x.name} className={x.warn ? 'ic-danger' : undefined}>
              <b>{x.name}</b>
              {`: ${x.value}`}
            </li>
          ))}
        </ul>
      )}
      {waiting > 0 && <p className="ic-more">{`+${waiting} more waiting`}</p>}
    </section>
  );
}

/**
 * Deny and Approve, pinned to the foot of the card, which has a fixed height while a request is
 * open: the text above can grow or change and the buttons stay put. Nothing approves from the
 * keyboard on its own: Deny takes the focus, and Approve stays disabled for a moment after each
 * request appears, so a double-click aimed at the previous one cannot land on it.
 */
export function AskActions(props: {
  ask: SteerAsk;
  /** The end of the command has been in view (it fit, or the user scrolled to it). */
  endSeen: boolean;
  answer(requestId: string, allow: boolean): void;
}) {
  const { ask } = props;
  const [armed, setArmed] = useState(false);
  const deny = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setArmed(false);
    const timer = setTimeout(() => setArmed(true), APPROVE_ARM_MS);
    if (!typing()) deny.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, [ask.requestId]);

  return (
    <div className="ic-actions" role="group" aria-label="Answer this request">
      <button
        ref={deny}
        type="button"
        className="ic-btn ic-deny"
        onClick={() => props.answer(ask.requestId, false)}
      >
        Deny
      </button>
      <button
        type="button"
        className="ic-btn ic-approve"
        disabled={!approveArmed(armed, props.endSeen)}
        onClick={() => props.answer(ask.requestId, true)}
      >
        Approve
      </button>
    </div>
  );
}

/** Spend, follow-up, interrupt and stop for a scholar this hall launched. */
export function SteerControls(props: { view: SteerView }) {
  const { agent } = props.view;
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keep.current?.focus({ preventScroll: true });
  }, [confirming]);

  const send = (): void => {
    const t = text.trim();
    if (!t) return;
    props.view.followUp(t);
    setText('');
  };

  return (
    <section aria-label="Steer" className="ic-steer">
      <h3>Steer</h3>
      {props.view.notice && (
        <p className="ic-danger" role="alert">
          {props.view.notice}
        </p>
      )}
      <p className="ic-model">{modelLine(agent)}</p>
      {turnLine(agent) && (
        <p className={`ic-turn ic-turn--${agent.turn}`} role="status">
          {turnLine(agent)}
        </p>
      )}
      <Conversation replies={props.view.replies} />
      <p className="ic-spend">{tokenLine(agent)}</p>
      <div
        className={`ic-bar${tokenBar(agent).warn ? ' ic-bar-warn' : ''}`}
        role="progressbar"
        aria-label="Token budget used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={tokenBar(agent).pct}
      >
        <div className="ic-bar-fill" style={{ width: `${tokenBar(agent).pct}%` }} />
      </div>
      {agent.stopped ? (
        <p className="ic-stopped" role="status">
          {`Stopped: ${agent.stopped}`}
        </p>
      ) : (
        <>
          <label className="ic-follow">
            <span>Follow-up</span>
            <textarea
              value={text}
              maxLength={FOLLOW_UP_MAX}
              rows={2}
              placeholder={`Tell this ${activeNouns().agent} what to do next`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </label>
          <div className="ic-row">
            <button
              type="button"
              className="ic-btn"
              disabled={text.trim().length === 0}
              onClick={send}
            >
              Send
            </button>
            <button type="button" className="ic-btn" onClick={props.view.interrupt}>
              Interrupt
            </button>
          </div>
        </>
      )}
      {confirming ? (
        <div
          className="ic-confirm"
          role="alertdialog"
          aria-label={`Stop this ${activeNouns().agent}?`}
        >
          <p>Stop this {activeNouns().agent}? It leaves the hall and anything pending is denied.</p>
          <div className="ic-row">
            <button
              type="button"
              className="ic-btn ic-stop"
              onClick={() => {
                setConfirming(false);
                props.view.stop();
              }}
            >
              Stop
            </button>
            <button
              ref={keep}
              type="button"
              className="ic-btn"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </div>
        </div>
      ) : (
        <div className="ic-row">
          <button type="button" className="ic-btn ic-stop" onClick={() => setConfirming(true)}>
            Stop
          </button>
        </div>
      )}
    </section>
  );
}
