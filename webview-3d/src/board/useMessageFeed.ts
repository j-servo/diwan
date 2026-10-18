// webview-3d/src/board/useMessageFeed.ts
import { useEffect, useState } from 'react';

import type { PersonaStore } from '../agents/personaStore.js';
import { transport } from '../transport/index.js';
import type { FeedEntry } from './feed.js';
import { EMPTY_FEED, feedReducer } from './feed.js';

export function useMessageFeed(personas: PersonaStore): FeedEntry[] {
  const [feed, setFeed] = useState(EMPTY_FEED);
  useEffect(
    () =>
      transport.onMessage((msg) => {
        // The store moves first and hands back the cast as this message should describe it.
        const view = personas.handle(msg);
        const now = Date.now();
        setFeed((state) => feedReducer(state, msg, now, view));
      }),
    [personas],
  );
  return feed.entries;
}
