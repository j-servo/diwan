import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { CharacterState } from '../../../webview-ui/src/office/types.js';
import type { PointOfInterest } from '../worlds/types.js';
import type { AgentView, AmbientActivity } from './idleDirector.js';
import { toVisualState } from '../grammar/visualState.js';
import {
  activityFor,
  createDirector,
  directorBusy,
  failTarget,
  stepDirector,
} from './idleDirector.js';

const director = createDirector();
/** Upstream's wander timer counts down to zero; this keeps it out of reach while we direct. */
const NO_WANDER = 1e9;

/** What the figure should play while this agent is out at a point of interest (null: nothing). */
export function ambientActivityFor(id: number): AmbientActivity | null {
  return activityFor(director, id);
}

/**
 * Drives idle main agents around the world's points of interest, once per engine tick. Returns whether anyone is out (the scene then needs frames). Upstream
 * already sends a character back to its seat the moment it turns active (idle and walking states
 * both repath); a waiting/permission signal does not, so the director calls sendToSeat itself.
 */
export function driveIdleAgents(os: OfficeState, pois: PointOfInterest[], dt: number): boolean {
  const views: AgentView[] = [];
  for (const ch of os.characters.values()) {
    if (ch.isSubagent || ch.isGreeter) continue;
    // Upstream's own random wander would fight the director.
    if (!ch.isActive) ch.wanderTimer = NO_WANDER;
    const v = toVisualState(ch);
    views.push({
      id: ch.id,
      // The same VisualState the bubble and figure read: no tool, no signal, not spawning.
      eligible: !ch.isActive && v.toolKind === null && v.signal === null && v.effect === null,
      walking: ch.state === CharacterState.WALK,
      col: ch.tileCol,
      row: ch.tileRow,
    });
  }
  for (const cmd of stepDirector(director, pois, views, dt)) {
    if (cmd.type === 'seat') os.sendToSeat(cmd.id);
    else if (!os.walkToTile(cmd.id, cmd.col!, cmd.row!)) failTarget(director, cmd.id);
  }
  return directorBusy(director);
}
