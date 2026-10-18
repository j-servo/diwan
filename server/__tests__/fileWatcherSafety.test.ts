import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({ window: { activeTerminal: undefined, terminals: [] } }));

const fsSpies = vi.hoisted(() => ({ readFails: false, closed: 0 }));
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readSync: (...a: Parameters<typeof actual.readSync>) => {
      if (fsSpies.readFails) throw new Error('EIO');
      return actual.readSync(...a);
    },
    closeSync: (fd: number) => {
      fsSpies.closed++;
      return actual.closeSync(fd);
    },
  };
});

let tmpHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { LINE_BUFFER_MAX_CHARS } = await import('../src/constants.js');
const { DismissalTracker } = await import('../src/dismissalTracker.js');
const { adoptExternalSessionFromHook, readNewLines, setDismissalTracker, setHookProvider } =
  await import('../src/fileWatcher.js');
const { PathSet } = await import('../src/pathKey.js');
const { claudeProvider } = await import('../src/providers/hook/claude/claude.js');
import type { AgentState } from '../src/types.js';

describe('adoptExternalSessionFromHook: transcript_path confinement', () => {
  let outside: string;
  let timers: Map<number, ReturnType<typeof setInterval>>;

  beforeEach(() => {
    tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-home-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-out-')));
    setDismissalTracker(new DismissalTracker());
    setHookProvider(claudeProvider);
    timers = new Map();
  });
  afterEach(() => {
    for (const t of timers.values()) clearInterval(t);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const adopt = (transcript: string) => {
    const agents = new AgentStateStore();
    adoptExternalSessionFromHook(
      's1',
      transcript,
      '/work',
      new PathSet(),
      { current: 1 },
      agents,
      new Map(),
      timers,
      new Map(),
      new Map(),
      () => {},
    );
    return agents;
  };
  const projects = () => path.join(tmpHome, '.claude', 'projects', '-work');

  it('adopts a transcript under ~/.claude/projects', () => {
    fs.mkdirSync(projects(), { recursive: true });
    const f = path.join(projects(), 's1.jsonl');
    fs.writeFileSync(f, '');
    expect(adopt(f).size).toBe(1);
  });
  it('adopts a not-yet-created transcript under the root', () => {
    fs.mkdirSync(projects(), { recursive: true });
    expect(adopt(path.join(projects(), 'new.jsonl')).size).toBe(1);
  });
  it('rejects a path outside the root', () => {
    const f = path.join(outside, 's1.jsonl');
    fs.writeFileSync(f, '');
    expect(adopt(f).size).toBe(0);
  });
  it('rejects a ../ escape', () => {
    fs.mkdirSync(projects(), { recursive: true });
    const f = path.join(outside, 's1.jsonl');
    fs.writeFileSync(f, '');
    expect(adopt(path.join(projects(), '..', '..', '..', '..', path.relative('/', f))).size).toBe(
      0,
    );
  });
  it('rejects a symlink inside the root that points outside', () => {
    fs.mkdirSync(projects(), { recursive: true });
    const target = path.join(outside, 's1.jsonl');
    fs.writeFileSync(target, '');
    const link = path.join(projects(), 'link.jsonl');
    fs.symlinkSync(target, link);
    expect(adopt(link).size).toBe(0);
    const dirLink = path.join(projects(), 'dirlink');
    fs.symlinkSync(outside, dirLink);
    expect(adopt(path.join(dirLink, 's1.jsonl')).size).toBe(0);
  });
});

describe('readNewLines: bounded lineBuffer', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-lb-'));
    file = path.join(dir, 's.jsonl');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const setup = () => {
    const agents = new AgentStateStore();
    const agent = {
      id: 1,
      jsonlFile: file,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      backgroundAgentToolIds: new Set(),
      seenUnknownRecordTypes: new Set(),
      linesProcessed: 0,
    } as unknown as AgentState;
    agents.set(1, agent);
    return { agents, agent };
  };
  const pump = (agents: InstanceType<typeof AgentStateStore>) => {
    for (let i = 0; i < 100; i++) readNewLines(1, agents, new Map(), new Map());
  };

  it('drops an endless line past the cap, warns once, and resyncs at the next newline', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { agents, agent } = setup();
    fs.writeFileSync(file, 'x'.repeat(LINE_BUFFER_MAX_CHARS + 200_000));
    pump(agents);
    expect(agent.lineBuffer.length).toBeLessThanOrEqual(65_536);
    // more of the same line: still dropped, still one warning
    fs.appendFileSync(file, 'y'.repeat(300_000));
    pump(agents);
    expect(agent.lineBuffer.length).toBeLessThanOrEqual(65_536);
    expect(warn).toHaveBeenCalledTimes(1);
    // the line ends; the next record is read whole
    fs.appendFileSync(file, '\n{"type":"summary"}\n');
    pump(agents);
    expect(agent.lineBuffer).toBe('');
    expect(agent.linesProcessed).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('closes the fd when readSync throws', () => {
    const { agents } = setup();
    fs.writeFileSync(file, 'abc\n');
    fsSpies.readFails = true;
    fsSpies.closed = 0;
    try {
      readNewLines(1, agents, new Map(), new Map());
    } finally {
      fsSpies.readFails = false;
    }
    expect(fsSpies.closed).toBe(1);
  });
});
