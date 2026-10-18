// webview-3d/src/board/MessageBoard.tsx
import type { FeedEntry } from './feed.js';

const timeOf = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** On-screen message board: the latest notable events, newest first. */
export function MessageBoard({ entries }: { entries: FeedEntry[] }) {
  return (
    <aside className="board-panel" aria-label="Message board">
      <h2>Message board</h2>
      {entries.length === 0 ? (
        <p className="board-empty">Quiet for now.</p>
      ) : (
        <ol>
          {entries.slice(0, 8).map((entry) => (
            <li key={entry.id} className={`board-entry board-entry--${entry.tone}`}>
              <time>{timeOf(entry.at)}</time>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
