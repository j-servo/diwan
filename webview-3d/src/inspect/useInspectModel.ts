import { useEffect, useState } from 'react';

import { transport } from '../transport/index.js';
import type { InspectState } from './inspectModel.js';
import { inspectReducer } from './inspectModel.js';

/** The live card data: every server message folded in at its receive time. */
export function useInspectModel(): InspectState {
  const [state, setState] = useState<InspectState>({});
  useEffect(
    () => transport.onMessage((msg) => setState((prev) => inspectReducer(prev, msg, Date.now()))),
    [],
  );
  return state;
}
