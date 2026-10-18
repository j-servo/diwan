import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from '../src/constants.js';
import {
  clipSessionLabel,
  promptLabel,
  seedSessionLabel,
  sessionLabelOf,
  updateSessionLabel,
  userPromptText,
} from '../src/sessionLabel.js';
import { processTranscriptLine } from '../src/transcriptParser.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'session',
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
    ...overrides,
  } as AgentState;
}

const userPrompt = (text: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  message: { role: 'user', content: text },
  ...extra,
});

describe('clipSessionLabel / promptLabel', () => {
  it('keeps a short label whole and cuts a long one to 18 with an ellipsis', () => {
    expect(clipSessionLabel('brain setup')).toBe('brain setup');
    expect(clipSessionLabel('Brain setup session notes')).toBe('Brain setup\u2026'); // at a word
    const out = clipSessionLabel('Hermes3d installation for Claude Code');
    expect(out.length).toBeLessThanOrEqual(18);
    expect(out.endsWith('\u2026')).toBe(true);
    expect(clipSessionLabel('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopq\u2026'); // no space
  });

  it('takes the first three or four words of a prompt that fit the cap', () => {
    expect(promptLabel('install hermes3d for Claude Code agentic env')).toBe('install hermes3d');
    expect(promptLabel('fix the login bug please')).toBe('fix the login bug');
    expect(promptLabel('  fix\n\nthe   bug ')).toBe('fix the bug');
  });

  it('clips a single over-long plain word, but drops a key-like one', () => {
    expect(promptLabel('supercalifragilisticexpialidocious')).toBe('supercalifragilis\u2026');
    expect(promptLabel('a8f3kq92mzx81pqv7t')).toBe('');
  });
  it('keeps long plain names such as folder names', () => {
    expect(promptLabel('jservo-agent-office')).toMatch(/^jservo-agent/);
  });
});

describe('userPromptText', () => {
  it('reads a string prompt and a text block', () => {
    expect(userPromptText(userPrompt('hello there'))).toBe('hello there');
    expect(userPromptText(userPrompt([{ type: 'text', text: 'hi again' }]))).toBe('hi again');
  });

  it('ignores tool results, meta records, sidechains, command wrappers and non-users', () => {
    expect(
      userPromptText(userPrompt([{ type: 'tool_result', tool_use_id: 't', content: 'x' }])),
    ).toBeUndefined();
    expect(userPromptText(userPrompt('hello', { isMeta: true }))).toBeUndefined();
    expect(userPromptText(userPrompt('hello', { isSidechain: true }))).toBeUndefined();
    expect(userPromptText(userPrompt('<command-name>/clear</command-name>'))).toBeUndefined();
    expect(userPromptText({ type: 'assistant', message: { content: 'hello' } })).toBeUndefined();
    expect(userPromptText(userPrompt('   '))).toBeUndefined();
  });
});

describe('prompt label redaction', () => {
  it('drops words that look like secrets or assignments', () => {
    expect(promptLabel('deploy TOKEN=abc123 now please')).toBe('deploy now please');
    expect(promptLabel('use sk-ant-api03-AbCdEf_ghIJ-klmn0123 for setup')).not.toMatch(/sk-/);
    expect(promptLabel('login Abcdefghijklmnop1234 then go')).toBe('login then go');
    expect(promptLabel('key ghp_abcdefghijklmnopqrstuvwxyz0123 ok')).not.toContain('ghp_');
  });
  it('still labels ordinary prompts', () => {
    expect(promptLabel('install hermes3d for Claude Code')).toBe('install hermes3d');
  });
  it('a prompt of only secrets yields no secret label', () => {
    const label = promptLabel('API_KEY=hunter2');
    expect(label).not.toContain('hunter2');
  });
  it('the broadcast label and the sessionLabel carry no secret', () => {
    const store = new AgentStateStore();
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    const agent = createTestAgent();
    store.set(agent.id, agent);
    updateSessionLabel(1, agent, store, userPrompt('fix PASSWORD=hunter2 login bug'));
    expect(JSON.stringify(sent)).not.toContain('hunter2');
    expect(agent.sessionLabel).toBe('fix login bug');
  });
});

describe('updateSessionLabel', () => {
  let store: AgentStateStore;
  let sent: Record<string, unknown>[];
  beforeEach(() => {
    store = new AgentStateStore();
    sent = [];
    store.on('broadcast', (m) => sent.push(m));
  });
  const add = () => {
    const agent = createTestAgent();
    store.set(agent.id, agent);
    return agent;
  };

  it('labels from the first prompt and announces it once', () => {
    const agent = add();
    updateSessionLabel(1, agent, store, userPrompt('install hermes3d for Claude Code'));
    updateSessionLabel(1, agent, store, userPrompt('and then do more things'));
    expect(agent.sessionLabel).toBe('install hermes3d');
    expect(sent).toEqual([{ type: 'agentLabel', id: 1, label: 'install hermes3d' }]);
  });

  it('a session title replaces the prompt label, and a later title replaces that', () => {
    const agent = add();
    updateSessionLabel(1, agent, store, userPrompt('install hermes3d for Claude Code'));
    updateSessionLabel(1, agent, store, { type: 'ai-title', aiTitle: 'Hermes3d setup' });
    expect(agent.sessionLabel).toBe('Hermes3d setup');
    // The same title written again changes nothing and says nothing.
    updateSessionLabel(1, agent, store, { type: 'ai-title', aiTitle: 'Hermes3d setup' });
    updateSessionLabel(1, agent, store, { type: 'agent-name', agentName: 'brain setup' });
    expect(agent.sessionLabel).toBe('brain setup');
    // A user-chosen name outranks a later auto title.
    updateSessionLabel(1, agent, store, { type: 'ai-title', aiTitle: 'Something else' });
    expect(agent.sessionLabel).toBe('brain setup');
    expect(sent.map((m) => m.label)).toEqual(['install hermes3d', 'Hermes3d setup', 'brain setup']);
  });

  it('says nothing for records that carry no label', () => {
    const agent = add();
    updateSessionLabel(1, agent, store, { type: 'assistant', message: { content: [] } });
    updateSessionLabel(1, agent, store, { type: 'ai-title', aiTitle: '   ' });
    expect(sent).toEqual([]);
    expect(agent.sessionLabel).toBeUndefined();
  });

  it('sessionLabelOf falls back to the folder, then to a plain word', () => {
    expect(sessionLabelOf(createTestAgent({ sessionLabel: 'brain setup', folderName: 'x' }))).toBe(
      'brain setup',
    );
    expect(sessionLabelOf(createTestAgent({ folderName: 'caravan' }))).toBe('caravan');
    expect(sessionLabelOf(createTestAgent())).toBe('session');
  });
});

describe('seedSessionLabel', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-label-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function seed(records: unknown[]): AgentState {
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const store = new AgentStateStore();
    const agent = createTestAgent({ jsonlFile: file });
    store.set(agent.id, agent);
    seedSessionLabel(agent.id, store);
    return agent;
  }

  it('reads the first prompt from the head and the newest title from the tail', () => {
    const filler = { type: 'attachment', pad: 'x'.repeat(300_000) };
    const agent = seed([
      userPrompt('install hermes3d for Claude Code'),
      filler,
      { type: 'ai-title', aiTitle: 'Old title' },
      filler,
      { type: 'ai-title', aiTitle: 'Newest title' },
    ]);
    expect(agent.sessionLabel).toBe('Newest title');
  });

  it('falls back to the first prompt when no title was written yet', () => {
    const agent = seed([{ type: 'mode', mode: 'normal' }, userPrompt('fix the login bug please')]);
    expect(agent.sessionLabel).toBe('fix the login bug');
  });

  it('leaves the label unset for an unreadable or empty transcript', () => {
    const store = new AgentStateStore();
    const agent = createTestAgent({ jsonlFile: path.join(dir, 'missing.jsonl') });
    store.set(agent.id, agent);
    seedSessionLabel(agent.id, store);
    expect(agent.sessionLabel).toBeUndefined();
  });
});

describe('streamed transcript lines', () => {
  it('processTranscriptLine labels the agent from a prompt line and then a title line', () => {
    const store = new AgentStateStore();
    const sent: Record<string, unknown>[] = [];
    store.on('broadcast', (m) => sent.push(m));
    store.set(1, createTestAgent());
    const feed = (record: unknown) =>
      processTranscriptLine(1, JSON.stringify(record), store, new Map(), new Map());
    feed(userPrompt('fix the login bug please'));
    feed({ type: 'ai-title', aiTitle: 'Login bug' });
    expect(sent.filter((m) => m.type === 'agentLabel').map((m) => m.label)).toEqual([
      'fix the login bug',
      'Login bug',
    ]);
  });
});
