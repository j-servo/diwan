import type { Direction } from '../../../webview-ui/src/office/types.js';
import type { PoiActivity, PoiKind, PointOfInterest, RouteStop } from '../worlds/types.js';
import type { Clip, Prop } from './clipFor.js';

/** Idle this long (not active, no signal, standing still) before wandering off to do something. */
export const IDLE_BEFORE_SEC = 6;
export const ACTIVITY_MIN_SEC = 8;
export const ACTIVITY_MAX_SEC = 20;
/** After this many activities the scholar goes back to the seat for a rest. */
const ACTIVITIES_PER_OUTING = 3;
/** Scholars at one spot (a PointOfInterest group) at once: the armillary is not a crowd. */
export const GROUP_CAPACITY = 2;
/** A walk that never started, or never got there, is given up after this long. */
const WALK_GRACE_SEC = 2;
/** After a failed walk, wait this long before trying again. */
const RETRY_BACKOFF_SEC = 10;
/** A scholar walking a circuit (all round a landmark) pauses this long at each look-up stop. */
export const CIRCUIT_LOOK_SEC = 5;
/** Between two circuits (anyone's) at least this long passes: it stays an occasional sight. */
export const CIRCUIT_COOLDOWN_SEC = 75;
/** The first circuit is held back until the director has run this long. */
export const CIRCUIT_FIRST_AT_SEC = 30;
/** A speaker gestures for this long, then listens while the other does. */
const TURN_SEC = 2.5;

/** One agent as the director sees it; the caller derives this from the engine character. */
export interface AgentView {
  id: number;
  /** Main agent, not active, no permission/waiting signal, not spawning or despawning. */
  eligible: boolean;
  /** Upstream is moving it along a path. */
  walking: boolean;
  col: number;
  row: number;
}

export interface Command {
  /** walk: go to (col,row). seat: back to the assigned seat. */
  type: 'walk' | 'seat';
  id: number;
  col?: number;
  row?: number;
}

interface Target {
  poiId: string;
  kind: PoiKind;
  /** A world's own activity for a kind not in ACTIVITY_BY_KIND. */
  activity?: PoiActivity;
  col: number;
  row: number;
  facing: Direction;
  /** 0 for the one who picked the point, 1 for a conversation partner. */
  slot: 0 | 1;
}

type Plan =
  | { phase: 'wait'; idle: number }
  | { phase: 'going'; target: Target; since: number; armed: boolean }
  | { phase: 'doing'; target: Target; endsAt: number }
  | {
      /** Walking all round a landmark, stop by stop (one scholar at a time). */
      phase: 'circling';
      poiId: string;
      stops: RouteStop[];
      i: number;
      since: number;
      armed: boolean;
      /** Pausing at a look-up stop until `lookUntil`. */
      looking: boolean;
      lookUntil: number;
    }
  | { phase: 'returning'; armed: boolean };

export interface Director {
  time: number;
  /** No circuit starts before this director time. */
  circuitReadyAt: number;
  plans: Map<number, Plan>;
  steps: Map<number, number>;
}

export function createDirector(): Director {
  return { time: 0, circuitReadyAt: CIRCUIT_FIRST_AT_SEC, plans: new Map(), steps: new Map() };
}

/** What the figure plays while it is out and about. */
export interface AmbientActivity {
  clip: Clip;
  prop: Prop | null;
  facing: Direction;
  /** Slow head-turn amplitude in radians (0 = none). */
  sway: number;
}

function hash(...n: number[]): number {
  let h = 2166136261;
  for (const x of n) {
    h = Math.imul(h ^ (x | 0), 16777619);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

/** Seeded per agent and outing step: the same agent always lingers the same time. */
export function activityDuration(id: number, step: number): number {
  const frac = (hash(id, step, 7) % 1000) / 1000;
  return ACTIVITY_MIN_SEC + frac * (ACTIVITY_MAX_SEC - ACTIVITY_MIN_SEC);
}

const waiting = (idle = 0): Plan => ({ phase: 'wait', idle });

function capacityOf(poi: PointOfInterest): number {
  return Math.min(2, Math.max(1, poi.capacity ?? 1));
}

function groupOccupancy(d: Director, group: string, pois: PointOfInterest[]): number {
  const byId = new Map(pois.map((p) => [p.id, p.group]));
  let n = 0;
  for (const p of d.plans.values()) {
    if ((p.phase === 'going' || p.phase === 'doing') && byId.get(p.target.poiId) === group) n++;
  }
  return n;
}

function occupancy(d: Director, poiId: string): number {
  let n = 0;
  for (const p of d.plans.values()) {
    if (
      (p.phase === 'going' || p.phase === 'doing') &&
      p.target.poiId === poiId &&
      p.target.slot === 0
    )
      n++;
  }
  return n;
}

const onTarget = (v: AgentView, t: { col: number; row: number }) =>
  v.col === t.col && v.row === t.row;

/** The other half of a conversation is still on its way to, or at, the same spot. */
function partnerPresent(d: Director, id: number, t: Target): boolean {
  if (t.kind !== 'converse') return true;
  for (const [otherId, p] of d.plans) {
    if (otherId === id) continue;
    if (
      (p.phase === 'going' || p.phase === 'doing') &&
      p.target.poiId === t.poiId &&
      p.target.slot !== t.slot
    ) {
      return true;
    }
  }
  return false;
}

function readyPartner(d: Director, self: AgentView, views: AgentView[]): AgentView | null {
  let best: AgentView | null = null;
  let bestDist = Infinity;
  for (const o of views) {
    if (o.id === self.id || !o.eligible || o.walking) continue;
    const p = d.plans.get(o.id);
    if (!p || p.phase !== 'wait' || p.idle < IDLE_BEFORE_SEC) continue;
    const dist = Math.abs(o.col - self.col) + Math.abs(o.row - self.row);
    if (dist < bestDist || (dist === bestDist && best && o.id < best.id)) {
      best = o;
      bestDist = dist;
    }
  }
  return best;
}

const circuitActive = (d: Director) => [...d.plans.values()].some((p) => p.phase === 'circling');

/** The route's stops in walking order from the one nearest `v`, closed back to where it began. */
function circuitStops(route: RouteStop[], v: AgentView): RouteStop[] {
  let start = 0;
  let best = Infinity;
  route.forEach((s, i) => {
    const dist = Math.abs(s.col - v.col) + Math.abs(s.row - v.row);
    if (dist < best) {
      best = dist;
      start = i;
    }
  });
  const ordered = [...route.slice(start), ...route.slice(0, start)];
  return [...ordered, ordered[0]!];
}

function startCircuit(d: Director, poi: PointOfInterest, v: AgentView, out: Command[]) {
  const stops = circuitStops(poi.route!, v);
  // already standing on the first stop: head for the second
  const i = onTarget(v, stops[0]!) ? 1 : 0;
  d.plans.set(v.id, {
    phase: 'circling',
    poiId: poi.id,
    stops,
    i,
    since: d.time,
    armed: false,
    looking: false,
    lookUntil: -1,
  });
  out.push({ type: 'walk', id: v.id, col: stops[i]!.col, row: stops[i]!.row });
}

function goTo(d: Director, id: number, t: Target, out: Command[]) {
  d.plans.set(id, { phase: 'going', target: t, since: d.time, armed: false });
  out.push({ type: 'walk', id, col: t.col, row: t.row });
}

function sendHome(d: Director, id: number, out: Command[]) {
  d.plans.set(id, { phase: 'returning', armed: false });
  out.push({ type: 'seat', id });
}

/** Pick the next place for `v`, or send it home when nowhere is free. */
function startNext(
  d: Director,
  pois: PointOfInterest[],
  v: AgentView,
  views: AgentView[],
  out: Command[],
  exclude?: string,
) {
  const step = d.steps.get(v.id) ?? 0;
  // The circuit is not one of the places to pick from: whoever sets out next once it is due
  // (and nobody is already on it) walks it.
  const circuit = pois.find((p) => p.kind === 'circuit' && (p.route?.length ?? 0) > 1);
  if (circuit && circuit.id !== exclude && d.time >= d.circuitReadyAt && !circuitActive(d)) {
    startCircuit(d, circuit, v, out);
    return;
  }
  const options: { poi: PointOfInterest; partner: AgentView | null }[] = [];
  for (const poi of pois) {
    if (poi.kind === 'circuit') continue;
    if (poi.id === exclude || occupancy(d, poi.id) >= capacityOf(poi)) continue;
    // A conversation fills its spot with both speakers; anyone else takes one place.
    const need = poi.kind === 'converse' ? 2 : 1;
    if (groupOccupancy(d, poi.group, pois) + need > GROUP_CAPACITY) continue;
    if (poi.kind === 'converse') {
      const partner = poi.partner ? readyPartner(d, v, views) : null;
      if (partner) options.push({ poi, partner });
    } else {
      options.push({ poi, partner: null });
    }
  }
  if (options.length === 0) {
    if (exclude !== undefined) sendHome(d, v.id, out);
    return;
  }
  const { poi, partner } = options[hash(v.id, step) % options.length];
  goTo(
    d,
    v.id,
    {
      poiId: poi.id,
      kind: poi.kind,
      ...(poi.activity ? { activity: poi.activity } : {}),
      col: poi.col,
      row: poi.row,
      facing: poi.facing,
      slot: 0,
    },
    out,
  );
  if (partner && poi.partner) {
    goTo(
      d,
      partner.id,
      {
        poiId: poi.id,
        kind: 'converse',
        col: poi.partner.col,
        row: poi.partner.row,
        facing: poi.partner.facing,
        slot: 1,
      },
      out,
    );
  }
}

function finish(
  d: Director,
  pois: PointOfInterest[],
  v: AgentView,
  views: AgentView[],
  out: Command[],
  poiId: string,
) {
  const steps = (d.steps.get(v.id) ?? 0) + 1;
  d.steps.set(v.id, steps);
  if (steps % ACTIVITIES_PER_OUTING === 0) sendHome(d, v.id, out);
  else startNext(d, pois, v, views, out, poiId);
}

/**
 * Advance the idle director by `dt` seconds. Mutates `d` and returns the movement commands the
 * caller should apply to the engine. Everything is decided from the views, the plans and the
 * clock: no randomness, no engine access.
 */
export function stepDirector(
  d: Director,
  pois: PointOfInterest[],
  views: AgentView[],
  dt: number,
): Command[] {
  d.time += dt;
  const out: Command[] = [];
  const present = new Set(views.map((v) => v.id));
  for (const id of [...d.plans.keys()]) if (!present.has(id)) d.plans.delete(id);

  for (const v of [...views].sort((a, b) => a.id - b.id)) {
    let plan = d.plans.get(v.id);
    if (!plan) d.plans.set(v.id, (plan = waiting()));

    if (!v.eligible) {
      // Active again or signalled: drop whatever it was doing and go back to work.
      if (
        plan.phase === 'going' ||
        plan.phase === 'doing' ||
        plan.phase === 'circling' ||
        plan.phase === 'returning'
      ) {
        out.push({ type: 'seat', id: v.id });
      }
      d.plans.set(v.id, waiting());
      continue;
    }

    switch (plan.phase) {
      case 'wait':
        if (v.walking) break;
        plan.idle += dt;
        if (plan.idle >= IDLE_BEFORE_SEC) startNext(d, pois, v, views, out);
        break;
      case 'going':
        if (!plan.armed) {
          plan.armed = true;
        } else if (!v.walking && onTarget(v, plan.target)) {
          if (partnerPresent(d, v.id, plan.target)) {
            const steps = d.steps.get(v.id) ?? 0;
            d.plans.set(v.id, {
              phase: 'doing',
              target: plan.target,
              endsAt: d.time + activityDuration(v.id, steps),
            });
          } else {
            sendHome(d, v.id, out);
          }
        } else if (!v.walking && d.time - plan.since > WALK_GRACE_SEC) {
          sendHome(d, v.id, out);
        } else if (!partnerPresent(d, v.id, plan.target)) {
          sendHome(d, v.id, out);
        }
        break;
      case 'circling': {
        const stop = plan.stops[plan.i]!;
        const next = () => {
          if (plan.i + 1 < plan.stops.length) {
            plan.i += 1;
            plan.armed = false;
            plan.since = d.time;
            const to = plan.stops[plan.i]!;
            out.push({ type: 'walk', id: v.id, col: to.col, row: to.row });
          } else {
            d.circuitReadyAt = d.time + CIRCUIT_COOLDOWN_SEC;
            finish(d, pois, v, views, out, plan.poiId);
          }
        };
        if (plan.looking) {
          if (d.time >= plan.lookUntil) {
            plan.looking = false;
            next();
          }
        } else if (!plan.armed) {
          plan.armed = true;
        } else if (v.walking) {
          break;
        } else if (onTarget(v, stop)) {
          if (stop.look) {
            plan.looking = true;
            plan.lookUntil = d.time + CIRCUIT_LOOK_SEC;
          } else next();
        } else if (d.time - plan.since > WALK_GRACE_SEC) {
          d.circuitReadyAt = d.time + CIRCUIT_COOLDOWN_SEC;
          sendHome(d, v.id, out);
        }
        break;
      }
      case 'doing':
        if (d.time >= plan.endsAt || !partnerPresent(d, v.id, plan.target)) {
          finish(d, pois, v, views, out, plan.target.poiId);
        }
        break;
      case 'returning':
        if (!plan.armed) plan.armed = true;
        else if (!v.walking) d.plans.set(v.id, waiting());
        break;
    }
  }
  return out;
}

/** Any scholar is out walking or doing something: the scene needs frames. */
export function directorBusy(d: Director): boolean {
  for (const p of d.plans.values()) if (p.phase !== 'wait') return true;
  return false;
}

/** The walk could not be started: free the point and back off before the next try. */
export function failTarget(d: Director, id: number): void {
  if (d.plans.get(id)?.phase === 'circling') d.circuitReadyAt = d.time + CIRCUIT_COOLDOWN_SEC;
  d.plans.set(id, waiting(-RETRY_BACKOFF_SEC));
}

/** The kinds the director knows; a PointOfInterest of any other kind carries its own `activity`. */
export const ACTIVITY_BY_KIND: Record<string, Omit<AmbientActivity, 'facing'>> = {
  shelf: { clip: 'read', prop: 'prop_codex', sway: 0 },
  scrolls: { clip: 'scroll_search', prop: 'prop_scroll', sway: 0 },
  // look up at the turning sphere, the head following it slowly
  armillary: { clip: 'look_up', prop: null, sway: 0.35 },
  board: { clip: 'look_up', prop: null, sway: 0 },
  planter: { clip: 'idle', prop: null, sway: 0 },
};

/** What this agent should be playing right now, or null when it is not out on an activity. */
export function activityFor(d: Director, id: number): AmbientActivity | null {
  const plan = d.plans.get(id);
  if (plan?.phase === 'circling') {
    // walking the circuit it just walks; at a look-up stop it looks up at the landmark
    if (!plan.looking) return null;
    return { clip: 'look_up', prop: null, sway: 0.35, facing: plan.stops[plan.i]!.facing };
  }
  if (!plan || plan.phase !== 'doing') return null;
  const t = plan.target;
  if (t.kind === 'converse') {
    const speaking = Math.floor(d.time / TURN_SEC) % 2 === t.slot;
    return { clip: speaking ? 'gesture_beckon' : 'idle', prop: null, facing: t.facing, sway: 0 };
  }
  const known = t.activity ?? ACTIVITY_BY_KIND[t.kind] ?? ACTIVITY_BY_KIND['planter'];
  return { ...known, facing: t.facing };
}
