import type { Character } from '../../../webview-ui/src/office/types.js';
import { contextRatio } from '../grammar/visualState.js';

/**
 * The engine clock: ticks the upstream OfficeState independently of rendering, so the canvas can
 * use frameloop="demand" and only draw when something visible changed (M0 design note D1).
 */
export interface EngineClock {
  start(): void;
  stop(): void;
  onTick(cb: (dt: number) => void): () => void;
  /** Runs one tick by hand with this dt (capped at maxDt): the promo render steps frame by frame. */
  step(dt: number): void;
  readonly running: boolean;
}

export function createEngineClock(opts: {
  now: () => number;
  schedule: (cb: () => void) => () => void;
  maxDt: number;
}): EngineClock {
  const listeners = new Set<(dt: number) => void>();
  let running = false;
  let cancel: (() => void) | null = null;
  let last = 0;

  const tick = () => {
    const t = opts.now();
    const dt = Math.min(Math.max((t - last) / 1000, 0), opts.maxDt);
    last = t;
    for (const cb of [...listeners]) cb(dt);
    if (running) cancel = opts.schedule(tick);
  };

  return {
    start() {
      if (running) return;
      running = true;
      last = opts.now();
      cancel = opts.schedule(tick);
    },
    stop() {
      running = false;
      cancel?.();
      cancel = null;
    },
    onTick(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    step(dt) {
      const capped = Math.min(Math.max(dt, 0), opts.maxDt);
      for (const cb of [...listeners]) cb(capped);
    },
    get running() {
      return running;
    },
  };
}

/** Visible tick rate: ~60 Hz. Hidden tabs tick slowly instead of stopping, so the demo keeps going. */
const VISIBLE_MS = 16;
const HIDDEN_MS = 250;

export function browserSchedule(cb: () => void): () => void {
  const id = setTimeout(cb, document.hidden ? HIDDEN_MS : VISIBLE_MS);
  return () => clearTimeout(id);
}

const CM_PER_TILE = 150; // 1 tile = 1.5 m
const TILE_PX = 16;

/** Everything a frame can show for these characters; equal signatures need no redraw. */
export function engineSignature(chars: Character[]): string {
  return chars
    .map((ch) => {
      const ratio = contextRatio(ch);
      return [
        ch.id,
        Math.round((ch.x / TILE_PX) * CM_PER_TILE),
        Math.round((ch.y / TILE_PX) * CM_PER_TILE),
        ch.dir,
        ch.state,
        ch.frame,
        ch.isActive ? 1 : 0,
        ch.currentTool ?? '-',
        ch.bubbleType ?? '-',
        ch.isSubagent ? 1 : 0,
        ch.matrixEffect ? `${ch.matrixEffect}${Math.round(ch.matrixEffectTimer * 30)}` : '-',
        ratio === null ? '-' : Math.round(ratio * 20),
      ].join(',');
    })
    .join(';');
}

export interface EngineStats {
  /** Last time a tick left the signature unchanged (the scene was idle). */
  lastQuietAt: number;
}

/** Ticks the engine, then asks for a redraw only if what is visible changed. */
export function attachEngine(
  clock: EngineClock,
  engine: { update(dt: number): void; getCharacters(): Character[] },
  invalidate: () => void,
  now: () => number,
): EngineStats {
  const stats: EngineStats = { lastQuietAt: 0 };
  let signature: string | null = null;
  clock.onTick((dt) => {
    engine.update(dt);
    const next = engineSignature(engine.getCharacters());
    if (next !== signature) {
      signature = next;
      invalidate();
    } else {
      stats.lastQuietAt = now();
    }
  });
  return stats;
}
