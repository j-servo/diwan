import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import {
  DIWAN_SILENT_CHECK_INTERVAL_MS,
  DIWAN_SILENT_RETIRE_HOOKS_MS,
  DIWAN_SILENT_RETIRE_MS,
} from '../src/constants.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { silentAgentIds } from '../src/silentRetire.js';
import type { AgentState } from '../src/types.js';

// The hook-supplied transcript_path must sit under ~/.claude/projects: point HOME at a temp dir.
let tmpHome = os.tmpdir();
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpHome };
});

const MIN = 60_000;
const NOW = 10_000_000_000;

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    isExternal: true,
    jsonlFile: '/t/s.jsonl',
    permissionSent: false,
    hookDelivered: false,
    lastDataAt: NOW,
    ...overrides,
  } as AgentState;
}

/** mtime ages in minutes, by file. */
const ages =
  (m: Record<string, number | undefined>) =>
  (file: string): number | undefined =>
    m[file] === undefined ? undefined : NOW - m[file]! * MIN;

const run = (entries: [number, AgentState][], mtimes: Record<string, number | undefined>) =>
  silentAgentIds(entries, NOW, ages(mtimes));

describe('silentAgentIds', () => {
  it('the limits are ten minutes without hooks and thirty with them', () => {
    expect(DIWAN_SILENT_RETIRE_MS).toBe(10 * MIN);
    expect(DIWAN_SILENT_RETIRE_HOOKS_MS).toBe(30 * MIN);
  });

  it('retires a transcript-mode scholar silent past ten minutes, not before', () => {
    const a = agent({ jsonlFile: '/t/a.jsonl' });
    const b = agent({ jsonlFile: '/t/b.jsonl' });
    expect(
      run(
        [
          [1, a],
          [2, b],
        ],
        { '/t/a.jsonl': 11, '/t/b.jsonl': 9 },
      ),
    ).toEqual([1]);
  });

  it('gives a hooked scholar thirty minutes: SessionEnd is its real exit', () => {
    const a = agent({ hookDelivered: true });
    expect(run([[1, a]], { '/t/s.jsonl': 20 })).toEqual([]);
    expect(run([[1, a]], { '/t/s.jsonl': 31 })).toEqual([1]);
  });

  it('waits the long limit on a pending approval too', () => {
    const a = agent({ permissionSent: true });
    expect(run([[1, a]], { '/t/s.jsonl': 20 })).toEqual([]);
    expect(run([[1, a]], { '/t/s.jsonl': 31 })).toEqual([1]);
  });

  it('leaves alone agents it cannot judge or does not own', () => {
    const entries: [number, AgentState][] = [
      [1, agent({ isExternal: false })],
      [2, agent({ leadAgentId: 7 })],
      [3, agent({ spawnToolUseId: 'toolu_1' })],
      [4, agent({ jsonlFile: '' })], // hooks-only: no transcript to be silent
      [5, agent({ jsonlFile: '/t/gone.jsonl' })], // deleted file: the stale check's job
    ];
    expect(run(entries, { '/t/s.jsonl': 99 })).toEqual([]);
  });
});

describe('AgentRuntime.startSilentRetire', () => {
  let runtime: AgentRuntime | undefined;
  let dir: string | undefined;
  afterEach(() => {
    vi.useRealTimers();
    runtime?.dispose();
    if (tmpHome !== os.tmpdir()) fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('removes a hooked scholar silent past the safety net, and keeps a fresh one', () => {
    tmpHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'silent-retire-')));
    dir = path.join(tmpHome, '.claude', 'projects', '-t');
    fs.mkdirSync(dir, { recursive: true });
    const store = new AgentStateStore();
    runtime = new AgentRuntime(store, claudeProvider);
    runtime.watchAllSessions.current = true;
    const adopt = (name: string) => {
      const transcript = path.join(dir!, `${name}.jsonl`);
      fs.writeFileSync(transcript, '');
      for (const hook_event_name of ['SessionStart', 'Stop']) {
        runtime!.handleHookEvent('claude', {
          hook_event_name,
          session_id: name,
          transcript_path: transcript,
          source: 'startup',
          cwd: dir,
        });
      }
      return transcript;
    };
    const stale = adopt('stale');
    adopt('fresh');
    expect(store.size).toBe(2);

    const old = new Date(Date.now() - 31 * 60_000);
    fs.utimesSync(stale, old, old);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    runtime.startSilentRetire();
    vi.advanceTimersByTime(DIWAN_SILENT_CHECK_INTERVAL_MS);

    const files = [...store.values()].map((a) => path.basename(a.jsonlFile));
    expect(files).toEqual(['fresh.jsonl']);
  });
});

describe('L4: a running launched scholar is exempt from silent retire', () => {
  it('is skipped however long it is silent, while an ordinary one is retired', () => {
    const launched = agent({ jsonlFile: '/t/launched.jsonl' });
    const other = agent({ jsonlFile: '/t/other.jsonl' });
    const ids = silentAgentIds(
      [
        [1, launched],
        [2, other],
      ],
      NOW,
      ages({ '/t/launched.jsonl': 500, '/t/other.jsonl': 500 }),
      (a) => a === launched,
    );
    expect(ids).toEqual([2]);
  });
});
