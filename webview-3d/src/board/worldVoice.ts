import type { FeedEntry } from './feed.js';

type Rule = [pattern: RegExp, render: (...groups: string[]) => string];

// Order matters: delegation first (its task text is free-form), then the apprentice forms, then
// the generic "title + suffix". Names are already the world's personas, so no "scholar of" wrapper.
const HOUSE_OF_WISDOM: Rule[] = [
  [/^(.+?) delegated: (.*)$/, (n, task) => `${n} sends an apprentice: ${task}`],
  [
    /^(.+?) \(apprentice to (.+)\) needs your approval$/,
    (a, n) => `${a}, apprentice to ${n}, requests your seal`,
  ],
  [/^(.+?) \(apprentice to (.+)\) returned$/, (a, n) => `${a}, apprentice to ${n}, returns`],
  [/^(.+) needs your approval$/, (n) => `${n} requests your seal`],
  [/^(.+) joined$/, (n) => `${n} takes a seat in the hall`],
  [/^(.+) can continue$/, (n) => `${n} may proceed`],
  [/^(.+) is waiting for you$/, (n) => `${n} awaits your word`],
  [/^(.+) finished$/, (n) => `${n} completes the work`],
  [/^(.+) left$/, (n) => `${n} departs the hall`],
];

const VOICES: Record<string, Rule[]> = { 'house-of-wisdom': HOUSE_OF_WISDOM };

/** Feed text in a world's voice (spec §4). The on-screen panel keeps the plain text. */
export function worldVoice(entry: FeedEntry, worldId: string): string {
  for (const [pattern, render] of VOICES[worldId] ?? []) {
    const m = pattern.exec(entry.text);
    if (m) return render(...m.slice(1));
  }
  return entry.text;
}
