import { describe, expect, it } from 'vitest';

import { demoHref, emptyHint } from '../src/hud/emptyState.js';

describe('emptyHint', () => {
  it('never shows in demo mode', () => {
    expect(emptyHint('demo', false, 0, 60_000)).toBeNull();
    expect(emptyHint('demo', true, 0, 60_000)).toBeNull();
  });
  it('waits about 3 s before speaking', () => {
    expect(emptyHint('live', false, 0, 0)).toBeNull();
    expect(emptyHint('live', true, 0, 3000)).toBeNull();
    expect(emptyHint('live', false, 0, 3001)).toBe('disconnected');
  });
  it('tells disconnected from connected-but-empty', () => {
    expect(emptyHint('live', false, 0, 5000)).toBe('disconnected');
    expect(emptyHint('live', true, 0, 5000)).toBe('connected');
  });
  it('hides as soon as an agent exists', () => {
    expect(emptyHint('live', true, 1, 60_000)).toBeNull();
    expect(emptyHint('live', false, 2, 60_000)).toBeNull();
  });
});

describe('demoHref', () => {
  it('sets demo=1 and keeps the rest of the URL', () => {
    expect(demoHref('http://localhost:5180/?mood=dusk')).toBe(
      'http://localhost:5180/?mood=dusk&demo=1',
    );
  });
  it('replaces demo=0 instead of duplicating it', () => {
    expect(demoHref('http://localhost:5180/?demo=0#x')).toBe('http://localhost:5180/?demo=1#x');
  });
});
