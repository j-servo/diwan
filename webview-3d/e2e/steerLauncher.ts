// Test harness for e2e/steer.spec.ts: the real Diwan server in steer mode with a FAKE runner, so no
// Claude session (and none of Yousef's account) is ever started. Run by Playwright under a temp HOME.
//
// The fake plays what a launched Claude Code session does: it writes a transcript and fires the
// SessionStart/PreToolUse hooks (so the hall seats the scholar), then asks permission for the task
// text as a Bash command. Everything it is told or asked is echoed on stdout for the test to read.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DIWAN_BRAND, setBrand } from '../../server/src/brand.js';
import { startDiwan } from '../../server/src/diwan/diwan.js';
import { addProject } from '../../server/src/steer/projects.js';
import type { RunnerLaunch, RunnerSession, SteerRunner } from '../../server/src/steer/runner.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const home = os.homedir();
const say = (line: string): void => void process.stdout.write(`${line}\n`);

let hookPost: (event: Record<string, unknown>) => Promise<void> = async () => {};

class FakeRunner implements SteerRunner {
  start(launch: RunnerLaunch): RunnerSession {
    say(
      `LAUNCH ${JSON.stringify({ cwd: launch.cwd, model: launch.model, effort: launch.effort })}`,
    );
    const transcript = path.join(
      home,
      '.claude',
      'projects',
      '-e2e-proj',
      `${launch.sessionId}.jsonl`,
    );
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(
      transcript,
      JSON.stringify({ type: 'ai-title', aiTitle: 'Steer test' }) + '\n',
    );
    const common = { session_id: launch.sessionId, transcript_path: transcript, cwd: launch.cwd };
    void (async () => {
      await hookPost({ ...common, hook_event_name: 'SessionStart', source: 'startup' });
      await hookPost({
        ...common,
        hook_event_name: 'PreToolUse',
        tool_name: 'Read',
        tool_use_id: 't0',
      });
      await new Promise((r) => setTimeout(r, 400));
      // A reply, with markup that must stay inert, then a web search that never asks.
      launch.onText?.(
        '## Plan\n\nI will **look** first. See [the docs](https://example.com/docs) and [bad](javascript:alert(1)).\n\n<script>window.__pwned = 1</script>',
      );
      const search = await launch.canUseTool(
        'WebSearch',
        { query: 'diwan e2e search' },
        new AbortController().signal,
      );
      say(`SEARCH ${search.behavior}`);
      const verdict = await launch.canUseTool(
        'Bash',
        { command: launch.task },
        new AbortController().signal,
      );
      say(`DECISION ${verdict.behavior}`);
      if (verdict.behavior === 'allow') {
        say('TOOL-PROCEEDED');
        launch.onUsage(182_000);
      }
    })();
    return {
      followUp: (text) => {
        say(`FOLLOWUP ${text}`);
        // The answer lands a moment later, so a test can close the card first.
        setTimeout(() => {
          launch.onText?.('Here is the **answer**\n\n- one\n- two');
          launch.onTurnEnd?.({ ok: true });
        }, 1500);
      },
      interrupt: async () => say('INTERRUPT'),
      stop: () => {
        say('STOPPED');
        launch.onEnd('closed');
      },
    };
  }
}

async function main(): Promise<void> {
  const project = path.join(home, 'work', 'scratch');
  fs.mkdirSync(project, { recursive: true });
  setBrand(DIWAN_BRAND); // `diwan projects add` runs under Diwan's brand
  addProject(project);
  const handle = await startDiwan({
    port: 0,
    distRoot: path.join(repoRoot, 'dist'),
    staticDir: path.join(repoRoot, 'dist', 'webview-3d'),
    steer: true,
    runner: new FakeRunner(),
  });
  const serverJson = JSON.parse(
    fs.readFileSync(path.join(home, '.diwan', 'server.json'), 'utf-8'),
  ) as {
    token: string;
  };
  hookPost = async (event) => {
    await fetch(`http://127.0.0.1:${handle.port}/api/hooks/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serverJson.token}` },
      body: JSON.stringify(event),
    });
  };
  say(`READY ${JSON.stringify({ port: handle.port, hookToken: serverJson.token })}`);
  const stop = (): void => void handle.stop().finally(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void main();
