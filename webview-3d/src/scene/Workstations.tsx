import { useRef, useState } from 'react';

import type { OfficeState } from '../../../webview-ui/src/office/engine/officeState.js';
import { useEngineTick } from '../engine/EngineProvider.tsx';
import { lampPosition, litSeatIds } from '../grammar/workstation.js';

/** One small lamp per seat; warm and glowing while that seat's agent is working. */
export function Workstations({ getOfficeState }: { getOfficeState: () => OfficeState }) {
  const [lit, setLit] = useState<ReadonlySet<string>>(new Set());
  const keyRef = useRef('');
  useEngineTick(() => {
    const next = litSeatIds(getOfficeState().getCharacters());
    const key = `${getOfficeState().seats.size}|${[...next].sort().join(',')}`;
    if (key !== keyRef.current) {
      keyRef.current = key;
      setLit(next);
    }
  });
  const seats = [...getOfficeState().seats.entries()];
  return (
    <>
      {seats.map(([seatId, seat]) => {
        const on = lit.has(seatId);
        return (
          <mesh key={seatId} position={lampPosition(seat)}>
            <boxGeometry args={[0.22, 0.12, 0.22]} />
            <meshStandardMaterial
              color={on ? '#ffcf7a' : '#5a4a36'}
              emissive={on ? '#ffcf7a' : '#000000'}
              emissiveIntensity={on ? 1.5 : 0}
            />
          </mesh>
        );
      })}
    </>
  );
}
