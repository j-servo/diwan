import { useEffect, useState } from 'react';

import { transport } from '../transport/index.js';
import type { AgentLabels } from './agentLabels.js';
import { labelsReducer } from './agentLabels.js';

/** The live labels; re-renders only when one actually changes. */
export function useAgentLabels(): AgentLabels {
  const [labels, setLabels] = useState<AgentLabels>({});
  useEffect(() => transport.onMessage((msg) => setLabels((prev) => labelsReducer(prev, msg))), []);
  return labels;
}
