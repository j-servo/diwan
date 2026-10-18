import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every test runs against a temp HOME: the real ~/.claude/settings.json and ~/.diwan
// are never read or written.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { DIWAN_BRAND, PIXEL_AGENTS_BRAND, setBrand } = await import('../src/brand.js');
const { DEFAULT_PORT, DiwanArgsError, HELP, parseArgs, runHooksCommand } =
  await import('../src/diwan/cli.js');
const { CLAUDE_HOOK_EVENTS } = await import('../src/providers/hook/claude/constants.js');

let packageRoot: string;
let settingsPath: string;
let scriptPath: string;
let printed: string[];
const print = (line: string): void => void printed.push(line);

const SUNDIAL_STOP = {
  matcher: '',
  hooks: [{ type: 'command', command: 'bash /Users/x/sundial/hook.sh stop', timeout: 10 }],
};

function writeSettings(settings: unknown): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(
    settingsPath,
    typeof settings === 'string' ? settings : JSON.stringify(settings),
  );
}

function readSettings(): { hooks: Record<string, unknown[]>; [k: string]: unknown } {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
}

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-cli-'));
  settingsPath = path.join(tmpBase, '.claude', 'settings.json');
  scriptPath = path.join(tmpBase, '.diwan', 'hooks', 'claude-hook.js');
  // A package root holding the bundled hook script, as `npm run build:diwan` leaves it.
  packageRoot = path.join(tmpBase, 'pkg');
  fs.mkdirSync(path.join(packageRoot, 'dist', 'diwan-hooks'), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'dist', 'diwan-hooks', 'claude-hook.js'), '// hook\n');
  printed = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  setBrand(PIXEL_AGENTS_BRAND);
  vi.restoreAllMocks();
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('parseArgs', () => {
  it('defaults to serving on 3200 and opening the browser', () => {
    expect(parseArgs([])).toEqual({
      kind: 'serve',
      port: DEFAULT_PORT,
      open: true,
      verbose: false,
      steer: false,
    });
    expect(DEFAULT_PORT).toBe(3200);
  });

  it('takes --port / -p and --no-open', () => {
    expect(parseArgs(['--port', '4000', '--no-open'])).toEqual({
      kind: 'serve',
      port: 4000,
      open: false,
      verbose: false,
      steer: false,
    });
    expect(parseArgs(['-p', '4001'])).toMatchObject({ port: 4001 });
  });

  it('takes --verbose, which brings back the runtime log', () => {
    expect(parseArgs(['--verbose'])).toMatchObject({ kind: 'serve', verbose: true });
    expect(parseArgs(['--no-open', '--verbose', '-p', '4002'])).toEqual({
      kind: 'serve',
      port: 4002,
      open: false,
      verbose: true,
      steer: false,
    });
  });

  it('steering is opt-in: only --steer turns it on; --dev is gone (L10)', () => {
    expect(parseArgs(['--steer'])).toMatchObject({ kind: 'serve', steer: true });
    expect(() => parseArgs(['--steer', '--dev'])).toThrow(DiwanArgsError);
    expect(() => parseArgs(['--dev'])).toThrow(DiwanArgsError);
  });

  it('parses diwan projects add | remove | list', () => {
    expect(parseArgs(['projects', 'add', '/work/a'])).toEqual({
      kind: 'projects',
      action: 'add',
      path: '/work/a',
    });
    expect(parseArgs(['projects', 'remove', '/work/a'])).toMatchObject({ action: 'remove' });
    expect(parseArgs(['projects', 'list'])).toEqual({ kind: 'projects', action: 'list' });
    for (const bad of [
      ['projects'],
      ['projects', 'add'],
      ['projects', 'wipe'],
      ['projects', 'list', 'x'],
      ['projects', 'add', '--steer'],
    ]) {
      expect(() => parseArgs(bad)).toThrow(DiwanArgsError);
    }
  });

  it('the help explains steer mode and the projects commands', () => {
    expect(HELP).toContain('--steer');
    expect(HELP).toContain('diwan projects add <path>');
    expect(HELP).toContain('audit.jsonl');
  });

  it.each([['--port'], ['--port', 'abc'], ['--port', '0'], ['--port', '70000'], ['--port', '1.5']])(
    'rejects a bad port: %s',
    (...argv) => {
      expect(() => parseArgs(argv)).toThrow(DiwanArgsError);
    },
  );

  it('rejects unknown arguments, including --host (the hall is loopback only)', () => {
    expect(() => parseArgs(['--host', '0.0.0.0'])).toThrow(DiwanArgsError);
    expect(() => parseArgs(['serve'])).toThrow(DiwanArgsError);
  });

  it('parses the hooks subcommands and nothing else', () => {
    for (const action of ['install', 'uninstall', 'status'] as const) {
      expect(parseArgs(['hooks', action])).toEqual({ kind: 'hooks', action });
    }
    expect(() => parseArgs(['hooks'])).toThrow(DiwanArgsError);
    expect(() => parseArgs(['hooks', 'enable'])).toThrow(DiwanArgsError);
    expect(() => parseArgs(['hooks', 'install', 'extra'])).toThrow(DiwanArgsError);
  });

  it('--help and -h win', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--port', '4000', '-h'])).toEqual({ kind: 'help' });
  });

  it('help says what happens without hooks and never names Pixel Agents', () => {
    expect(HELP).toMatch(/transcripts/);
    expect(HELP).toMatch(/7 seconds/);
    expect(HELP).toMatch(/hooks install/);
    expect(HELP).toMatch(/--verbose/);
    expect(HELP).not.toMatch(/pixel/i);
  });
});

describe('diwan hooks', () => {
  it('status on a fresh machine reports nothing installed and writes nothing', async () => {
    expect(await runHooksCommand('status', packageRoot, print)).toBe(0);
    expect(printed.join('\n')).toMatch(/not installed/);
    expect(fs.existsSync(settingsPath)).toBe(false);
    expect(fs.existsSync(path.join(tmpBase, '.diwan'))).toBe(false);
  });

  it('install copies the script first, then writes exactly the consumed events', async () => {
    expect(await runHooksCommand('install', packageRoot, print)).toBe(0);

    expect(fs.readFileSync(scriptPath, 'utf-8')).toBe('// hook\n');
    expect(fs.statSync(scriptPath).mode & 0o111).not.toBe(0);

    const hooks = readSettings().hooks;
    expect(Object.keys(hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS].sort());
    expect(hooks).not.toHaveProperty('UserPromptSubmit');
    for (const event of CLAUDE_HOOK_EVENTS) {
      expect(hooks[event]).toEqual([
        { matcher: '', hooks: [{ type: 'command', command: `node "${scriptPath}"`, timeout: 5 }] },
      ]);
    }
    expect(printed.join('\n')).toMatch(/installed on 12 events/);
  });

  it('install keeps a Sundial-like foreign hook and every other setting', async () => {
    const original = {
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: {
        Stop: [SUNDIAL_STOP],
        UserPromptSubmit: [
          { matcher: '', hooks: [{ type: 'command', command: 'sundial prompt' }] },
        ],
      },
    };
    writeSettings(original);

    await runHooksCommand('install', packageRoot, print);

    const after = readSettings();
    expect(after.permissions).toEqual(original.permissions);
    expect(after.hooks.UserPromptSubmit).toEqual(original.hooks.UserPromptSubmit);
    expect(after.hooks.Stop).toHaveLength(2);
    expect(after.hooks.Stop[0]).toEqual(SUNDIAL_STOP);

    // One backup of the ORIGINAL file, named for Diwan.
    expect(JSON.parse(fs.readFileSync(`${settingsPath}.diwan.backup`, 'utf-8'))).toEqual(original);
    expect(fs.existsSync(`${settingsPath}.pixel-agents.backup`)).toBe(false);
  });

  it('install is idempotent and does not touch the backup again', async () => {
    writeSettings({ hooks: { Stop: [SUNDIAL_STOP] } });
    await runHooksCommand('install', packageRoot, print);
    const first = fs.readFileSync(settingsPath, 'utf-8');
    const backup = fs.readFileSync(`${settingsPath}.diwan.backup`, 'utf-8');

    await runHooksCommand('install', packageRoot, print);

    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(first);
    expect(fs.readFileSync(`${settingsPath}.diwan.backup`, 'utf-8')).toBe(backup);
  });

  it('uninstall removes only Diwan entries and leaves the foreign hook byte-for-byte', async () => {
    writeSettings({ hooks: { Stop: [SUNDIAL_STOP], Notification: [SUNDIAL_STOP] } });
    await runHooksCommand('install', packageRoot, print);

    expect(await runHooksCommand('uninstall', packageRoot, print)).toBe(0);

    expect(readSettings()).toEqual({
      hooks: { Stop: [SUNDIAL_STOP], Notification: [SUNDIAL_STOP] },
    });
    expect(printed.join('\n')).toMatch(/not installed/);
  });

  it('status lists the installed events and the script', async () => {
    await runHooksCommand('install', packageRoot, print);
    printed = [];

    await runHooksCommand('status', packageRoot, print);

    const out = printed.join('\n');
    for (const event of CLAUDE_HOOK_EVENTS) expect(out).toContain(event);
    expect(out).toMatch(/present/);
  });

  it('aborts on an unparseable settings.json and leaves it untouched', async () => {
    writeSettings('{ not json');
    expect(await runHooksCommand('install', packageRoot, print)).toBe(1);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe('{ not json');
    expect(printed.join('\n')).toMatch(/parse/i);
  });

  it('aborts on a non-array hooks.<Event> and leaves it untouched', async () => {
    const weird = JSON.stringify({ hooks: { Stop: { not: 'an array' } } });
    writeSettings(weird);
    expect(await runHooksCommand('install', packageRoot, print)).toBe(1);
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(weird);
  });

  it('refuses to install when the hook script is missing (no entries without a script)', async () => {
    fs.rmSync(path.join(packageRoot, 'dist'), { recursive: true });
    writeSettings({ hooks: { Stop: [SUNDIAL_STOP] } });
    const before = fs.readFileSync(settingsPath, 'utf-8');

    expect(await runHooksCommand('install', packageRoot, print)).toBe(1);

    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(before);
    expect(printed.join('\n')).toMatch(/build:diwan/);
  });
});

describe('hook identity', () => {
  const command = (p: string): unknown => ({
    matcher: '',
    hooks: [{ type: 'command', command: `node "${p}"` }],
  });

  it("does not claim Pixel Agents' own hook, and uninstall leaves it alone", async () => {
    const pixel = command(path.join(tmpBase, '.pixel-agents', 'hooks', 'claude-hook.js'));
    writeSettings({ hooks: { Stop: [pixel] } });

    await runHooksCommand('install', packageRoot, print);
    expect(readSettings().hooks.Stop).toContainEqual(pixel);
    await runHooksCommand('uninstall', packageRoot, print);

    expect(readSettings().hooks.Stop).toEqual([pixel]);
  });

  it('does not claim look-alikes: backup copies, other dirs, wrappers', async () => {
    const lookalikes = [
      command(path.join(tmpBase, '.diwan', 'hooks', 'claude-hook.js.backup')),
      command('/opt/evil.diwan/hooks/claude-hook.js'),
      command(path.join(tmpBase, 'my-diwan-hook.js')),
      { matcher: '', hooks: [{ type: 'command', command: `bash wrap.sh "${scriptPath}"` }] },
    ];
    writeSettings({ hooks: { Stop: lookalikes } });

    await runHooksCommand('install', packageRoot, print);
    await runHooksCommand('uninstall', packageRoot, print);

    expect(readSettings().hooks.Stop).toEqual(lookalikes);
  });

  it('claims its own script case-insensitively (same inode on macOS)', async () => {
    const cased = command(path.join(tmpBase, '.Diwan', 'Hooks', 'Claude-Hook.js'));
    writeSettings({ hooks: { Stop: [cased] } });

    await runHooksCommand('install', packageRoot, print);

    // The cased entry was recognised as ours and replaced, not duplicated.
    expect(readSettings().hooks.Stop).toHaveLength(1);
    expect(DIWAN_BRAND.dirName).toBe('.diwan');
  });
});
