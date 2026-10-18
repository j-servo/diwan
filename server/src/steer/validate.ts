/** Schema checks for control messages. Anything not exactly as specified is refused. */
import {
  ALLOWED_EFFORTS,
  ALLOWED_MODELS,
  type EffortLevel,
  formatTokens,
  TOKEN_BUDGET_MAX,
  TOKEN_BUDGET_MIN,
  validTokenBudget,
} from '../../../core/src/steerChoices.js';

export const TASK_MAX = 8000;
export const PROJECT_PATH_MAX = 4096;

export type ControlMessage =
  | {
      type: 'steerLaunch';
      ref?: string;
      project: string;
      task: string;
      model: string;
      effort: EffortLevel;
      tokenBudget: number;
    }
  | { type: 'steerAnswer'; requestId: string; allow: boolean }
  | { type: 'steerFollowUp'; id: number; text: string }
  | { type: 'steerInterrupt'; id: number }
  | { type: 'steerStop'; id: number };

export type Parsed = { ok: true; msg: ControlMessage } | { ok: false; error: string };

/** The control types a connection needs the `control` scope for (steerHello is the handshake). */
export const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'steerLaunch',
  'steerAnswer',
  'steerFollowUp',
  'steerInterrupt',
  'steerStop',
]);

const bad = (error: string): Parsed => ({ ok: false, error });

function onlyKeys(m: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(m).every((k) => k === 'type' || keys.includes(k));
}

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export function parseControl(m: Record<string, unknown>): Parsed {
  switch (m.type) {
    case 'steerLaunch': {
      if (!onlyKeys(m, ['ref', 'project', 'task', 'model', 'effort', 'tokenBudget']))
        return bad('unexpected field');
      if (
        typeof m.project !== 'string' ||
        m.project.length === 0 ||
        m.project.length > PROJECT_PATH_MAX
      )
        return bad('project must be a registered path');
      if (!isText(m.task, TASK_MAX)) return bad(`task must be 1-${TASK_MAX} characters`);
      if (typeof m.model !== 'string' || !ALLOWED_MODELS.includes(m.model))
        return bad('unknown model');
      if (typeof m.effort !== 'string' || !ALLOWED_EFFORTS.includes(m.effort))
        return bad('unknown effort level');
      if (!validTokenBudget(m.tokenBudget))
        return bad(
          `token budget must be between ${formatTokens(TOKEN_BUDGET_MIN)} and ${formatTokens(TOKEN_BUDGET_MAX)}`,
        );
      if (m.ref !== undefined && (typeof m.ref !== 'string' || m.ref.length > 64))
        return bad('bad ref');
      return {
        ok: true,
        msg: {
          type: 'steerLaunch',
          ref: m.ref as string | undefined,
          project: m.project,
          task: m.task,
          model: m.model,
          effort: m.effort as EffortLevel,
          tokenBudget: m.tokenBudget,
        },
      };
    }
    case 'steerAnswer':
      if (!onlyKeys(m, ['requestId', 'allow'])) return bad('unexpected field');
      if (typeof m.requestId !== 'string' || m.requestId.length === 0 || m.requestId.length > 64)
        return bad('bad requestId');
      if (typeof m.allow !== 'boolean') return bad('allow must be true or false');
      return { ok: true, msg: { type: 'steerAnswer', requestId: m.requestId, allow: m.allow } };
    case 'steerFollowUp':
      if (!onlyKeys(m, ['id', 'text'])) return bad('unexpected field');
      if (!isId(m.id)) return bad('bad id');
      if (!isText(m.text, TASK_MAX)) return bad(`text must be 1-${TASK_MAX} characters`);
      return { ok: true, msg: { type: 'steerFollowUp', id: m.id, text: m.text } };
    case 'steerInterrupt':
    case 'steerStop':
      if (!onlyKeys(m, ['id'])) return bad('unexpected field');
      if (!isId(m.id)) return bad('bad id');
      return { ok: true, msg: { type: m.type, id: m.id } };
    default:
      return bad('unknown control message');
  }
}
