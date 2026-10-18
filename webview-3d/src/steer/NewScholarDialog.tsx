// webview-3d/src/steer/NewScholarDialog.tsx
import { useEffect, useRef, useState } from 'react';

import {
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  EFFORT_CHOICES,
  type EffortLevel,
  formatTokens,
  MODEL_CHOICES,
  parseTokenBudget,
  TOKEN_BUDGET_DEFAULT,
  TOKEN_BUDGET_MAX,
  TOKEN_BUDGET_MIN,
  validTokenBudget,
} from '../../../core/src/steerChoices.js';
import type { SteerState } from './steerStore.js';
import { activeNouns } from '../worlds/personas.js';

export const TASK_MAX = 8000;

export interface LaunchRequest {
  ref: string;
  project: string;
  task: string;
  model: string;
  effort: EffortLevel;
  tokenBudget: number;
}

/** What the budget field currently means: a valid whole number of tokens, or null. */
export function budgetOf(text: string): number | null {
  const n = parseTokenBudget(text);
  return validTokenBudget(n) ? n : null;
}

let counter = 0;
const newRef = (): string => `launch-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function NewScholarDialog(props: {
  steer: SteerState;
  onLaunch(req: LaunchRequest): void;
  onClose(): void;
}) {
  const { steer } = props;
  const [project, setProject] = useState(steer.projects[0]?.path ?? '');
  const [task, setTask] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState<EffortLevel>(DEFAULT_EFFORT);
  const [budget, setBudget] = useState(formatTokens(TOKEN_BUDGET_DEFAULT));
  const [ref, setRef] = useState<string | null>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => taskRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    if (!project && steer.projects[0]) setProject(steer.projects[0].path);
  }, [project, steer.projects]);
  // Accepted: the agent will walk in on its own.
  useEffect(() => {
    if (ref && steer.launchedRef === ref) props.onClose();
  }, [ref, steer.launchedRef, props]);

  const budgetNum = budgetOf(budget);
  const failure = ref && steer.notice?.ref === ref ? steer.notice.text : null;
  const noProjects = steer.projects.length === 0;
  const ready =
    !noProjects &&
    project !== '' &&
    task.trim().length > 0 &&
    budgetNum !== null &&
    !(ref && !failure);

  const launch = (): void => {
    if (!ready || budgetNum === null) return;
    const r = newRef();
    setRef(r);
    props.onLaunch({
      ref: r,
      project,
      task: task.trim(),
      model,
      effort,
      tokenBudget: budgetNum as number,
    });
  };

  return (
    <div className="dlg-backdrop">
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={`New ${activeNouns().agent}`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            props.onClose();
          }
        }}
      >
        <h2>New {activeNouns().agent}</h2>
        <label>
          <span>Project</span>
          <select
            value={project}
            disabled={noProjects}
            onChange={(e) => setProject(e.target.value)}
            aria-label="Project"
          >
            {steer.projects.map((p) => (
              <option key={p.path} value={p.path}>
                {`${p.name} — ${p.path}`}
              </option>
            ))}
          </select>
        </label>
        {noProjects && (
          <p className="dlg-hint">
            No projects registered. In a terminal, run <code>diwan projects add &lt;path&gt;</code>,
            then reopen this.
          </p>
        )}
        <label>
          <span>Task</span>
          <textarea
            ref={taskRef}
            value={task}
            maxLength={TASK_MAX}
            rows={5}
            onChange={(e) => setTask(e.target.value)}
            aria-label="Task"
          />
          <small>{`${task.length.toLocaleString('en-US')} / ${TASK_MAX.toLocaleString('en-US')}`}</small>
        </label>
        <div className="dlg-pair">
          <label>
            <span>Model</span>
            <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model">
              {MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {`${m.label} (${m.id})`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Effort</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as EffortLevel)}
              aria-label="Effort"
            >
              {EFFORT_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === 'xhigh' ? `${c.label} (xhigh)` : c.label}
                </option>
              ))}
            </select>
            <small>The model may lower this if it doesn&apos;t support it</small>
          </label>
        </div>
        <label>
          <span>Token budget</span>
          <input
            type="text"
            inputMode="text"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            aria-label="Token budget"
            aria-invalid={budgetNum === null}
          />
          <small>
            {budgetNum !== null
              ? `${formatTokens(budgetNum)} tokens`
              : `${formatTokens(TOKEN_BUDGET_MIN)} to ${formatTokens(TOKEN_BUDGET_MAX)}, like 500K or 1.5M`}
            {`; the ${activeNouns().agent} stops at the cap`}
          </small>
        </label>
        {failure && (
          <p className="dlg-error" role="alert">
            {failure}
          </p>
        )}
        <div className="dlg-actions">
          <button type="button" className="ic-btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="button" className="ic-btn ic-go" disabled={!ready} onClick={launch}>
            Launch
          </button>
        </div>
      </div>
    </div>
  );
}
