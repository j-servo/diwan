/** A world's cast: titles for agents, given names for subagents, and what to call each group. */
export interface PersonaRoster {
  /** Agent titles, e.g. "Astronomer". */
  titles: readonly string[];
  /** Subagent given names, e.g. "Yahya". */
  apprentices: readonly string[];
  nouns: { agent: string; agents: string; subagent: string; subagents: string };
}

/** FNV-1a: tiny, stable across loads and platforms. */
function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function roman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [value, symbol] of table) {
    while (n >= value) {
      out += symbol;
      n -= value;
    }
  }
  return out;
}

/**
 * Pick a name for `key`: hash to an index, then probe forward past names in `taken`. When every
 * plain name is taken, the same walk repeats with a numeral ("Astronomer II"). Pure.
 */
export function assignPersona(
  key: string,
  taken: ReadonlySet<string>,
  names: readonly string[],
): string {
  const start = hash(key) % names.length;
  for (let round = 1; ; round++) {
    for (let i = 0; i < names.length; i++) {
      const base = names[(start + i) % names.length];
      const candidate = round === 1 ? base : `${base} ${roman(round)}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const approvalText = (n: number) => `${n} ${n === 1 ? 'needs' : 'need'} your approval`;

/** HUD line: "3 scholars · 1 apprentice · 1 needs your approval", in the world's nouns. */
export function formatCounts(
  counts: { agents: number; subagents: number; needsYou: number },
  nouns: PersonaRoster['nouns'],
): string {
  const parts = [
    plural(counts.agents, nouns.agent, nouns.agents),
    plural(counts.subagents, nouns.subagent, nouns.subagents),
  ];
  if (counts.needsYou > 0) {
    parts.push(approvalText(counts.needsYou));
  }
  return parts.join(' · ');
}

type Nouns = PersonaRoster['nouns'];
const HOUSE_OF_WISDOM_NOUNS: Nouns = {
  agent: 'scholar',
  agents: 'scholars',
  subagent: 'apprentice',
  subagents: 'apprentices',
};
let activeNounsValue: Nouns = HOUSE_OF_WISDOM_NOUNS;

/** What this page's world calls its agents and subagents, for UI strings outside React props. */
export function activeNouns(): Nouns {
  return activeNounsValue;
}

export function setActiveNouns(nouns: Nouns): void {
  activeNounsValue = nouns;
}

/** "scholar" -> "Scholar". */
export const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
