import type { AgentInfo } from '../grammar/label.js';
import { useHover } from './hoverStore.js';
import { peekText } from './inspectModel.js';

const OFFSET_X = 14;
const OFFSET_Y = 18;

/** One line near the pointer: the hovered figure's title and what it is doing. Never moves the camera. */
export function Peek({ infoFor }: { infoFor: (id: number) => AgentInfo }) {
  const hover = useHover();
  if (!hover) return null;
  const info = infoFor(hover.id);
  return (
    <div
      className="peek"
      role="tooltip"
      style={{ left: hover.x + OFFSET_X, top: hover.y + OFFSET_Y }}
    >
      {peekText(info.name, info.status)}
    </div>
  );
}
