import { useEffect, useRef, useState } from 'react';

import { AskActions, AskPanel, SteerControls, type SteerView } from '../steer/SteerCard.js';
import type { AgentRecord, InspectState, SubRecord, ToolRow } from './inspectModel.js';
import { agoText, approvalTool, stateLine, subRecord, subStateLine } from './inspectModel.js';
import { activeNouns, capitalized } from '../worlds/personas.js';

/** Who the card is about. Names are fixed when the card opens, so a departed figure still reads right. */
export interface CardTarget {
  /** The figure's character id (negative for apprentices). */
  id: number;
  /** "Astronomer", or "Yahya · apprentice". */
  title: string;
  /** Present for an apprentice: the scholar who sent it, and the tool that did. */
  parent?: { id: number; toolId: string; title: string };
}

/** How long "Left the hall" stays before the card closes itself. */
export const LEFT_CARD_MS = 3000;
/** The card redraws its clocks this often. */
const TICK_MS = 500;

function Tool({ row }: { row: Pick<ToolRow, 'status' | 'detail'> }) {
  return (
    <li className="ic-tool">
      <b>{row.status}</b>
      {row.detail && <pre className="ic-detail">{row.detail}</pre>}
    </li>
  );
}

function NeedsYou({ tool }: { tool: Pick<ToolRow, 'status' | 'detail'> | undefined }) {
  return (
    <section className="ic-needs" aria-label="Needs you">
      <h3>Needs you</h3>
      <p>Wants to run:</p>
      <pre className="ic-detail">
        {tool ? (tool.detail ?? tool.status) : 'an action that needs approval'}
      </pre>
      <p className="ic-terminal">Answer it in your terminal</p>
    </section>
  );
}

function Recent({ rows, now }: { rows: AgentRecord['recent']; now: number }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label="Recent">
      <h3>Recent</h3>
      <ol className="ic-recent">
        {rows.map((r) => (
          <li key={`${r.toolId}:${r.doneAt}`}>
            <span>{r.status}</span>
            <time>{agoText(now - r.doneAt)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The tools for "Now", minus the one already shown in the "Needs you" block. */
function withoutAsking(
  tools: readonly ToolRow[],
  approvalSince: number | null,
): readonly ToolRow[] {
  if (approvalSince === null) return tools;
  const asking = approvalTool(tools);
  return tools.filter((t) => t !== asking);
}

function Now({ tools }: { tools: readonly ToolRow[] }) {
  if (tools.length === 0) return null;
  return (
    <section aria-label="Now">
      <h3>Now</h3>
      <ul className="ic-now">
        {tools.map((t) => (
          <Tool key={t.toolId} row={t} />
        ))}
      </ul>
    </section>
  );
}

function Body(props: {
  target: CardTarget;
  rec: AgentRecord | undefined;
  sub: SubRecord | undefined;
  now: number;
  apprenticeName: (parentId: number, parentToolId: string) => string;
  onOpen: (id: number) => void;
  subFigureId: (parentId: number, parentToolId: string) => number | null;
  steer?: SteerView;
  onEndSeen(requestId: string): void;
}) {
  const { target, rec, sub, now, steer } = props;
  if (target.parent) {
    const parentTitle = target.parent.title;
    return (
      <>
        <p className="ic-state">{sub ? subStateLine(sub, now) : 'Left the hall'}</p>
        <p className="ic-parent">
          Sent by{' '}
          <button type="button" className="ic-link" onClick={() => props.onOpen(target.parent!.id)}>
            {parentTitle}
          </button>
        </p>
        {sub?.task && (
          <section aria-label="Task">
            <h3>Task</h3>
            <ul className="ic-now">
              <Tool row={sub.task} />
            </ul>
          </section>
        )}
        {sub && sub.approvalSince !== null && <NeedsYou tool={approvalTool(sub.tools)} />}
        {sub && <Now tools={withoutAsking(sub.tools, sub.approvalSince)} />}
        {sub && <Recent rows={sub.recent} now={now} />}
      </>
    );
  }
  if (!rec) return <p className="ic-state">Left the hall</p>;
  const apprentices = Object.values(rec.subs);
  return (
    <>
      <p className="ic-state">{stateLine(rec, now)}</p>
      {steer && steer.asks.length > 0 ? (
        <AskPanel
          key={steer.asks[0].requestId}
          ask={steer.asks[0]}
          waiting={steer.asks.length - 1}
          onEndSeen={() => props.onEndSeen(steer.asks[0].requestId)}
        />
      ) : (
        rec.approvalSince !== null && <NeedsYou tool={approvalTool(rec.tools)} />
      )}
      <Now tools={withoutAsking(rec.tools, rec.approvalSince)} />
      <Recent rows={rec.recent} now={now} />
      {apprentices.length > 0 && (
        <section aria-label={capitalized(activeNouns().subagents)}>
          <h3>{capitalized(activeNouns().subagents)}</h3>
          <ul className="ic-apprentices">
            {apprentices.map((s) => {
              const figure = props.subFigureId(rec.id, s.parentToolId);
              const status =
                s.tools[s.tools.length - 1]?.status ?? s.task?.status ?? 'Between tasks';
              return (
                <li key={s.parentToolId}>
                  <button
                    type="button"
                    className="ic-link"
                    disabled={figure === null}
                    onClick={() => figure !== null && props.onOpen(figure)}
                  >
                    {props.apprenticeName(rec.id, s.parentToolId)}
                  </button>
                  <span>{status}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {steer && <SteerControls view={steer} />}
    </>
  );
}

/**
 * The inspect card: what a figure is doing and what it wants from you. A side panel (bottom sheet
 * on narrow screens), read-only unless the scholar was launched here (`steer`); cobalt appears
 * only in its approval block.
 */
export function InspectCard(props: {
  target: CardTarget;
  state: InspectState;
  onClose: () => void;
  onOpen: (id: number) => void;
  apprenticeName: (parentId: number, parentToolId: string) => string;
  subFigureId: (parentId: number, parentToolId: string) => number | null;
  /** Present only for a scholar this hall launched (steer mode): spend, follow-up, approvals. */
  steer?: SteerView;
}) {
  const { target, state, onClose } = props;
  const [now, setNow] = useState(() => Date.now());
  const closeRef = useRef<HTMLButtonElement>(null);
  // Which request's command has been seen to its end. Approve stays off until it is.
  const [endSeenFor, setEndSeenFor] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  // Focus lands on Close, except when a request is waiting: then Deny already holds it.
  const asking = (props.steer?.asks.length ?? 0) > 0;
  useEffect(() => {
    if (!asking) closeRef.current?.focus({ preventScroll: true });
  }, [target.id]);

  const rec = state[target.parent ? target.parent.id : target.id];
  const sub = target.parent ? subRecord(state, target.parent.id, target.parent.toolId) : undefined;
  const label = !target.parent && rec ? (rec.label ?? rec.folder) : undefined;
  const gone = target.parent ? !sub : !rec || rec.phase === 'left';

  useEffect(() => {
    if (!gone) return;
    const timer = setTimeout(onClose, LEFT_CARD_MS);
    return () => clearTimeout(timer);
  }, [gone, onClose, target.id]);

  return (
    <aside
      className={`inspect-card${props.steer && props.steer.asks.length > 0 ? ' inspect-card--asking' : ''}`}
      role="region"
      aria-label={`${target.title} details`}
    >
      <header className="ic-head">
        <div>
          <h2>
            {target.title}
            {label && <span>{` · ${label}`}</span>}
          </h2>
          {!target.parent && rec?.label && rec.folder && <p className="ic-folder">{rec.folder}</p>}
        </div>
        <button
          ref={closeRef}
          type="button"
          className="ic-close"
          aria-label="Close details"
          onClick={onClose}
        >
          {'✕'}
        </button>
      </header>
      <Body
        target={target}
        rec={rec}
        sub={sub}
        now={now}
        apprenticeName={props.apprenticeName}
        onOpen={props.onOpen}
        subFigureId={props.subFigureId}
        steer={target.parent ? undefined : props.steer}
        onEndSeen={(requestId) => setEndSeenFor(requestId)}
      />
      {!target.parent && props.steer && props.steer.asks.length > 0 && (
        <AskActions
          key={props.steer.asks[0].requestId}
          ask={props.steer.asks[0]}
          endSeen={endSeenFor === props.steer.asks[0].requestId}
          answer={props.steer.answer}
        />
      )}
    </aside>
  );
}
