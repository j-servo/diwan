import { useThree } from '@react-three/fiber';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef } from 'react';

import { MAX_DELTA_TIME_SEC } from '../../../webview-ui/src/constants.js';
import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import type { EngineClock, EngineStats } from './engineClock.js';
import { promoCut } from '../promo/promoMode.js';
import { attachEngine, browserSchedule, createEngineClock } from './engineClock.js';

interface EngineContextValue {
  clock: EngineClock;
  stats: EngineStats;
}

const EngineContext = createContext<EngineContextValue | null>(null);

function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside <EngineProvider>');
  return ctx;
}

/** Owns the engine clock: ticks OfficeState and wakes the demand-driven canvas on change. */
export function EngineProvider(props: { getOfficeState: () => OfficeState; children: ReactNode }) {
  const { getOfficeState } = props;
  const invalidate = useThree((s) => s.invalidate);
  // Created during render (no subscriptions to leak) so the engine's own tick listener is
  // registered before any child effect can subscribe: children then see the post-update state.
  const value = useMemo<EngineContextValue>(() => {
    const now = () => performance.now();
    // The promo render steps the clock by hand (PromoRig), so it must never tick on its own.
    const schedule = promoCut ? () => () => {} : browserSchedule;
    const clock = createEngineClock({ now, schedule, maxDt: MAX_DELTA_TIME_SEC });
    const stats = attachEngine(
      clock,
      {
        update: (dt) => getOfficeState().update(dt),
        getCharacters: () => getOfficeState().getCharacters(),
      },
      invalidate,
      now,
    );
    return { clock, stats };
  }, [getOfficeState, invalidate]);

  useEffect(() => {
    value.clock.start();
    return () => value.clock.stop();
  }, [value]);

  return <EngineContext.Provider value={value}>{props.children}</EngineContext.Provider>;
}

/** Runs cb after every engine tick (about 60 Hz visible, 4 Hz hidden). */
export function useEngineTick(cb: (dt: number) => void): void {
  const { clock } = useEngine();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => clock.onTick((dt) => ref.current(dt)), [clock]);
}

/** The engine clock itself (the promo rig steps it by hand). */
export function useEngineClock(): EngineClock {
  return useEngine().clock;
}

export function useEngineStats(): EngineStats {
  return useEngine().stats;
}
