import { DIWAN_SILENT_RETIRE_HOOKS_MS, DIWAN_SILENT_RETIRE_MS } from './constants.js';
import type { AgentState } from './types.js';

/**
 * Which scholars have gone silent and should leave the hall.
 *
 * Silence is the transcript file's age, not `lastDataAt`: the file's mtime is what a scanner
 * would use to adopt the session again, so a retired scholar can only come back through real
 * new activity. Without hooks, ten minutes of silence retires a scholar (nothing else would
 * ever remove one). With hooks SessionEnd already does, so the same rule runs only as a
 * thirty-minute safety net. A pending approval is treated like a hooked agent: the session
 * may just be waiting on a person who stepped away, and the lamp should outlast that.
 *
 * Only top-level sessions are judged. Teammates and background spawns leave through their
 * own paths, hooks-only agents have no transcript to measure, and a transcript that is gone
 * is the stale check's case.
 */
export function silentAgentIds(
  agents: Iterable<[number, AgentState]>,
  now: number,
  mtimeOf: (file: string) => number | undefined,
  /** A running launched scholar is never retired for silence. */
  exempt?: (agent: AgentState) => boolean,
): number[] {
  const silent: number[] = [];
  for (const [id, agent] of agents) {
    if (!agent.isExternal || agent.leadAgentId !== undefined || agent.spawnToolUseId) continue;
    if (!agent.jsonlFile) continue;
    if (exempt?.(agent)) continue;
    const mtime = mtimeOf(agent.jsonlFile);
    if (mtime === undefined) continue;
    const limit =
      agent.hookDelivered || agent.permissionSent
        ? DIWAN_SILENT_RETIRE_HOOKS_MS
        : DIWAN_SILENT_RETIRE_MS;
    if (now - mtime > limit) silent.push(id);
  }
  return silent;
}
