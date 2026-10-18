#!/usr/bin/env node

/**
 * `diwan`: start the House of Wisdom hall on this machine and open it in the browser.
 *
 *   diwan [--port N] [--no-open] [--verbose] [--steer]
 *   diwan hooks install | uninstall | status
 *   diwan projects add <path> | remove <path> | list
 *
 * Hooks are installed ONLY by `diwan hooks install` (running it is the consent) and removed
 * by `diwan hooks uninstall`. The server never touches ~/.claude/settings.json on its own.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DIWAN_BRAND, setBrand } from '../brand.js';
import { MAX_PORT, MIN_PORT } from '../constants.js';
import {
  copyHookScript,
  hooksStatus,
  installHooks,
  uninstallHooks,
} from '../providers/hook/claude/claudeHookInstaller.js';
import {
  addProject,
  checkProject,
  listProjects,
  ProjectError,
  removeProject,
} from '../steer/projects.js';
import { inspectProject, needsConfirmation, trustLines } from '../steer/trustReport.js';
import { brandConsole, findRunningDiwan, runningDiwanIsSteer, startDiwan } from './diwan.js';

export const DEFAULT_PORT = 3200;
const HOST = '127.0.0.1';

export const HOOK_ACTIONS = ['install', 'uninstall', 'status'] as const;
export type HookAction = (typeof HOOK_ACTIONS)[number];

export const PROJECT_ACTIONS = ['add', 'remove', 'list'] as const;
export type ProjectAction = (typeof PROJECT_ACTIONS)[number];

export type DiwanCommand =
  | { kind: 'help' }
  | {
      kind: 'serve';
      port: number;
      open: boolean;
      verbose: boolean;
      steer: boolean;
    }
  | { kind: 'hooks'; action: HookAction }
  | { kind: 'projects'; action: ProjectAction; path?: string; yes?: true };

/** Thrown by parseArgs; main() turns it into an exit code so parsing stays pure. */
export class DiwanArgsError extends Error {}

export const HELP = `Diwan · House of Wisdom

Usage:
  diwan [--port N] [--no-open] [--verbose]
                                   Start the hall and open it in your browser (watch only)
  diwan --steer [--port N] [--no-open]
                                   Steer mode: launch Claude Code sessions from the hall, approve
                                   or deny their tool calls, send follow-ups, interrupt, stop
  diwan projects add <path> [--yes]
                                   Register a folder the hall may launch sessions in. It lists the
                                   folder's own hooks, allow rules, env and MCP servers first; if it
                                   carries hooks, allow rules or env, --yes is required
  diwan projects remove <path>     Unregister it
  diwan projects list              Show the registered folders
  diwan hooks install              Add Diwan's hooks to ~/.claude/settings.json
  diwan hooks uninstall            Remove them again (other hooks are left alone)
  diwan hooks status               Show what is installed
  diwan --help                     Show this help

Options:
  --port, -p <number>   Port to listen on (default ${DEFAULT_PORT}); always bound to ${HOST}
  --no-open             Do not open the browser
  --verbose             Also print the runtime's per-tool, timer and watcher log lines
  --steer               Enable steering (see above). Plain 'diwan' never launches or controls anything

The terminal stays quiet: startup, sessions joining, leaving or needing your approval,
and warnings. Add --verbose for everything the runtime logs.

The hall shows every Claude Code session on this machine. Without hooks it still works
from the session transcripts, but permission requests arrive about 7 seconds late.
With hooks (one command, undone by 'diwan hooks uninstall') they arrive instantly.
Hooks are never installed by starting the server: only 'diwan hooks install' does it.

Steer mode only controls sessions the hall launched itself, in folders you registered, with
Claude Code's default permission mode. Launched sessions load Claude settings from your user
account AND from the project folder itself (its .claude/settings*.json hooks, allow rules and env,
and .mcp.json), as if you trusted that folder: registering a cloned repo trusts what it carries,
which is why 'projects add' lists it first. Every tool call that the rules do not already allow
waits for your click here (Approve is never automatic; no answer in
15 minutes, Stop, or Ctrl-C is a deny). Every control action is logged to ~/.diwan/audit.jsonl.
Sessions started in a terminal stay watch-only.

Build the hall once with: npm run build:diwan`;

export function parseArgs(argv: string[]): DiwanCommand {
  if (argv[0] === 'hooks') {
    const action = argv[1] as HookAction | undefined;
    if (!action || !HOOK_ACTIONS.includes(action) || argv.length > 2) {
      throw new DiwanArgsError('Usage: diwan hooks install | uninstall | status');
    }
    return { kind: 'hooks', action };
  }
  if (argv[0] === 'projects') {
    const action = argv[1] as ProjectAction | undefined;
    const usage = 'Usage: diwan projects add <path> [--yes] | remove <path> | list';
    if (!action || !PROJECT_ACTIONS.includes(action)) throw new DiwanArgsError(usage);
    if (action === 'list') {
      if (argv.length > 2) throw new DiwanArgsError(usage);
      return { kind: 'projects', action };
    }
    const yes = action === 'add' && (argv.includes('--yes') || argv.includes('-y'));
    const rest = argv.slice(2).filter((a) => !(action === 'add' && (a === '--yes' || a === '-y')));
    if (rest.length !== 1 || !rest[0] || rest[0].startsWith('-')) throw new DiwanArgsError(usage);
    return { kind: 'projects', action, path: rest[0], ...(yes ? { yes: true as const } : {}) };
  }
  let port = DEFAULT_PORT;
  let open = true;
  let verbose = false;
  let steer = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { kind: 'help' };
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '--steer') {
      steer = true;
    } else if (arg === '--port' || arg === '-p') {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (
        raw === undefined ||
        !Number.isInteger(parsed) ||
        parsed < MIN_PORT ||
        parsed > MAX_PORT
      ) {
        throw new DiwanArgsError(
          `${arg} needs an integer between ${MIN_PORT} and ${MAX_PORT}${raw === undefined ? '' : `, got "${raw}"`}.`,
        );
      }
      port = parsed;
      i++;
    } else {
      throw new DiwanArgsError(`Unknown argument "${arg}". Try: diwan --help`);
    }
  }
  return { kind: 'serve', port, open, verbose, steer };
}

/** Run a `diwan projects ...` command. Returns the process exit code. */
export function runProjectsCommand(
  action: ProjectAction,
  target: string | undefined,
  print: (line: string) => void = console.log,
  options: { yes?: boolean } = {},
): number {
  setBrand(DIWAN_BRAND);
  try {
    if (action === 'add') {
      // Registering is a grant of trust: say what the folder carries before it takes effect.
      const dir = checkProject(target ?? '');
      const report = inspectProject(dir);
      for (const line of trustLines(dir, report)) print(line);
      if (needsConfirmation(report) && !options.yes) {
        print(
          'Not registered. Review the list above; if you trust this folder, run the same command with --yes.',
        );
        return 1;
      }
      print(`Registered: ${addProject(dir)}`);
    } else if (action === 'remove') {
      print(removeProject(target ?? '') ? `Removed: ${target}` : `Not registered: ${target}`);
    } else {
      const projects = listProjects();
      if (projects.length === 0)
        print('No projects registered. Add one: diwan projects add <path>');
      for (const p of projects) print(p.path);
    }
    return 0;
  } catch (err) {
    print(err instanceof ProjectError ? err.message : String(err));
    return 1;
  }
}

/** Run a `diwan hooks ...` command. Returns the process exit code. */
export async function runHooksCommand(
  action: HookAction,
  packageRoot: string,
  print: (line: string) => void = console.log,
): Promise<number> {
  setBrand(DIWAN_BRAND);
  try {
    if (action === 'install') {
      // The script first: an entry pointing at a missing script spawns a dead node per event.
      if (!copyHookScript(packageRoot)) {
        print('Hooks NOT installed: the hook script is missing. Run: npm run build:diwan');
        return 1;
      }
      await installHooks();
    } else if (action === 'uninstall') {
      await uninstallHooks();
    }
  } catch (err) {
    print(err instanceof Error ? err.message : String(err));
    return 1;
  }
  const status = hooksStatus();
  const home = os.homedir();
  const show = (p: string): string => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  if (status.events.length === 0) {
    print('Diwan hooks: not installed (the hall reads transcripts only).');
  } else {
    print(`Diwan hooks: installed on ${status.events.length} events in ~/.claude/settings.json`);
    print(`  ${status.events.join(', ')}`);
  }
  print(`  script: ${show(status.scriptPath)} (${status.scriptPresent ? 'present' : 'missing'})`);
  return 0;
}

function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(opener, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed; opening it is a convenience.
  }
}

async function main(): Promise<void> {
  setBrand(DIWAN_BRAND);

  let command: DiwanCommand;
  try {
    command = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // dist/diwan.js sits next to dist/assets/ and dist/diwan-hooks/; the hall is dist/webview-3d/.
  // Only serving is quiet by default; `diwan hooks ...` reports its backup and install steps.
  brandConsole(console, { verbose: command.kind !== 'serve' || command.verbose });

  const distRoot = __dirname;
  const packageRoot = path.dirname(distRoot);

  if (command.kind === 'help') {
    console.log(HELP);
    return;
  }
  if (command.kind === 'hooks') {
    process.exit(await runHooksCommand(command.action, packageRoot));
  }
  if (command.kind === 'projects') {
    process.exit(
      runProjectsCommand(command.action, command.path, console.log, { yes: command.yes }),
    );
  }

  const { port, open, steer } = command;
  const title = steer ? 'Diwan · House of Wisdom (steer mode)' : 'Diwan · House of Wisdom';
  const urlFor = (p: number): string => `http://${HOST}:${p}/`;

  const running = await findRunningDiwan();
  if (running !== null) {
    if (steer && !(await runningDiwanIsSteer(running))) {
      console.error(
        `A Diwan without steering is already running at ${urlFor(running)}. Stop it (Ctrl-C) and run: diwan --steer`,
      );
      process.exit(1);
    }
    console.log(`${title} → ${urlFor(running)} (already running)`);
    if (open) openInBrowser(urlFor(running));
    return;
  }

  const staticDir = path.join(distRoot, 'webview-3d');
  if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
    console.error('The hall is not built yet. Run once: npm run build:diwan');
    process.exit(1);
  }

  let handle: Awaited<ReturnType<typeof startDiwan>>;
  try {
    handle = await startDiwan({ port, distRoot, staticDir, steer });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(
      code === 'EADDRINUSE'
        ? `Port ${port} is in use. Pick another: diwan --port ${port + 1}`
        : `Diwan failed to start: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  console.log(`${title} → ${urlFor(handle.port)}`);
  console.log('Press Ctrl-C to stop.');
  if (open) openInBrowser(urlFor(handle.port));

  const shutdown = (): void => {
    setTimeout(() => process.exit(0), 2000).unref(); // an open socket must not hold Ctrl-C hostage
    void handle.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only when executed directly (`node dist/diwan.js`), so tests can import parseArgs.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
