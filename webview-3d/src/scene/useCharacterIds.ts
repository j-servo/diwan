import { useRef, useState } from 'react';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';

/** Re-renders only when characters join or leave; positions are read per frame elsewhere. */
export function useCharacterIds(getOfficeState: () => OfficeState): number[] {
  const [ids, setIds] = useState<number[]>([]);
  const keyRef = useRef('');
  useEngineTick(() => {
    const next = getOfficeState()
      .getCharacters()
      .filter((ch) => !ch.isGreeter)
      .map((ch) => ch.id)
      .sort((a, b) => a - b);
    const key = next.join(',');
    if (key !== keyRef.current) {
      keyRef.current = key;
      setIds(next);
    }
  });
  return ids;
}
