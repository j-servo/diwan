import { describe, expect, test } from 'vitest';

import { assignPersona, formatCounts } from '../src/worlds/personas.js';
import { houseOfWisdomGreybox } from '../src/worlds/houseOfWisdom/greybox.js';

const roster = houseOfWisdomGreybox.personas;

describe('House of Wisdom roster', () => {
  test('twelve scholar titles, twelve apprentice names, world nouns', () => {
    expect(roster.titles).toHaveLength(12);
    expect(roster.titles[0]).toBe('Astronomer');
    expect(roster.apprentices).toHaveLength(12);
    expect(roster.apprentices[0]).toBe('Yahya');
    expect(roster.nouns).toEqual({
      agent: 'scholar',
      agents: 'scholars',
      subagent: 'apprentice',
      subagents: 'apprentices',
    });
    expect(new Set(roster.titles).size).toBe(12);
    // Short and article-free: the tag, the board and the HUD all read "Astronomer", not "The Astronomer".
    for (const t of roster.titles) {
      expect(t.length).toBeLessThanOrEqual(10);
      expect(t).not.toMatch(/^The /);
    }
    expect(new Set(roster.apprentices).size).toBe(12);
  });
});

describe('assignPersona', () => {
  const names = roster.titles;

  test('is deterministic for a key', () => {
    expect(assignPersona('ledger-api', new Set(), names)).toBe(
      assignPersona('ledger-api', new Set(), names),
    );
    expect(names).toContain(assignPersona('ledger-api', new Set(), names));
  });

  test('different keys spread over the roster', () => {
    const picked = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => assignPersona(k, new Set(), names)),
    );
    expect(picked.size).toBeGreaterThan(3);
  });

  test('probes past titles already taken', () => {
    const first = assignPersona('x', new Set(), names);
    const second = assignPersona('x', new Set([first]), names);
    expect(second).not.toBe(first);
    expect(names).toContain(second);
  });

  test('twelve agents with the same key get twelve distinct titles', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 12; i++) taken.add(assignPersona('same', taken, names));
    expect(taken.size).toBe(12);
  });

  test('more agents than titles fall back to numerals', () => {
    const taken = new Set<string>(names);
    const a = assignPersona('same', taken, names);
    expect(a).toMatch(/^\w+ II$/);
    taken.add(a);
    const b = assignPersona('same', taken, names);
    expect(b).toMatch(/^\w+ II$/);
    expect(b).not.toBe(a);
    for (let i = 0; i < 12; i++) taken.add(assignPersona('same', taken, names));
    expect(assignPersona('same', taken, names)).toMatch(/^\w+ III$/);
  });

  test('a released title becomes available again', () => {
    const taken = new Set<string>();
    const a = assignPersona('k', taken, names);
    taken.add(a);
    taken.delete(a);
    expect(assignPersona('k', taken, names)).toBe(a);
  });

  test('apprentices use the same rule', () => {
    expect(roster.apprentices).toContain(assignPersona('1:t1', new Set(), roster.apprentices));
  });
});

describe('formatCounts', () => {
  const n = roster.nouns;
  test('world nouns with correct plurals', () => {
    expect(formatCounts({ agents: 3, subagents: 1, needsYou: 1 }, n)).toBe(
      '3 scholars · 1 apprentice · 1 needs your approval',
    );
    expect(formatCounts({ agents: 1, subagents: 0, needsYou: 0 }, n)).toBe(
      '1 scholar · 0 apprentices',
    );
    expect(formatCounts({ agents: 0, subagents: 2, needsYou: 2 }, n)).toBe(
      '0 scholars · 2 apprentices · 2 need your approval',
    );
  });
});
