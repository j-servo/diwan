import { describe, expect, it } from 'vitest';

import {
  Conversation,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_ENTRIES,
  REPLY_TEXT_MAX,
  toolStepLine,
} from '../../src/steer/conversation.js';

describe('Conversation', () => {
  it('numbers entries in order', () => {
    const c = new Conversation();
    c.add('user', 'task');
    c.add('assistant', 'hello');
    expect(c.history().map((e) => [e.seq, e.role])).toEqual([
      [1, 'user'],
      [2, 'assistant'],
    ]);
  });
  it('keeps only the last 200 entries', () => {
    const c = new Conversation();
    for (let i = 0; i < 250; i++) c.add('tool', `step ${i}`);
    expect(c.history()).toHaveLength(HISTORY_MAX_ENTRIES);
    expect(c.history()[0].text).toBe('step 50');
    expect(c.history().at(-1)!.seq).toBe(250);
  });
  it('keeps at most 200 KB', () => {
    const c = new Conversation();
    for (let i = 0; i < 30; i++) c.add('assistant', 'x'.repeat(15_000));
    const total = c.history().reduce((n, e) => n + e.text.length, 0);
    expect(total).toBeLessThanOrEqual(HISTORY_MAX_BYTES);
    expect(c.history().at(-1)!.seq).toBe(30);
  });
  it('cuts a text over 20 KB and says so', () => {
    const c = new Conversation();
    const e = c.add('assistant', 'y'.repeat(REPLY_TEXT_MAX + 5000));
    expect(e.truncated).toBe(true);
    expect(e.text.length).toBeLessThan(REPLY_TEXT_MAX + 100);
    expect(e.text).toContain('[cut');
    expect(c.add('assistant', 'short').truncated).toBeUndefined();
  });
});

describe('toolStepLine', () => {
  it('is one line with the main argument', () => {
    expect(toolStepLine('Bash', { command: 'npm test\nrm x' })).toBe('Bash: npm test');
    expect(toolStepLine('Read', { file_path: '/a/b.ts' })).toBe('Read: /a/b.ts');
    expect(toolStepLine('Weird', { n: 1 })).toBe('Weird');
  });
  it('masks secrets, drops control characters and caps the length', () => {
    expect(toolStepLine('Bash', { command: 'echo sk-ant-abcdefghijklmnopqrstuv' })).not.toContain(
      'sk-ant-abcdefghijklmnopqrstuv',
    );
    expect(toolStepLine('Bash', { command: 'a\u001b[31mb' })).not.toMatch(/\u001b/);
    expect(toolStepLine('Bash', { command: 'z'.repeat(500) }).length).toBeLessThanOrEqual(160);
  });
});
