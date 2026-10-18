import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let home: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => home };
});

const { DIWAN_BRAND, setBrand } = await import('../../src/brand.js');
const projects = await import('../../src/steer/projects.js');
const { AuditLog, auditPath } = await import('../../src/steer/audit.js');
const { readConfig } = await import('../../src/configPersistence.js');

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-steer-reg-')));
  setBrand(DIWAN_BRAND);
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const mkdir = (name: string): string => {
  const p = path.join(home, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const mode = (p: string): number => fs.statSync(p).mode & 0o777;

describe('project registry', () => {
  it('adds, lists and removes, writing config.json as 0600', () => {
    const a = mkdir('work/a');
    expect(projects.listProjects()).toEqual([]);
    expect(projects.addProject(a)).toBe(a);
    projects.addProject(a); // idempotent
    expect(projects.listProjects()).toEqual([{ path: a, name: 'a' }]);
    expect(mode(path.join(home, '.diwan', 'config.json'))).toBe(0o600);
    expect(projects.removeProject(a)).toBe(true);
    expect(projects.removeProject(a)).toBe(false);
    expect(projects.listProjects()).toEqual([]);
  });

  it('keeps every other key of config.json', () => {
    const file = path.join(home, '.diwan', 'config.json');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ hooksConsent: { claude: 'granted' }, extra: 1 }));
    projects.addProject(mkdir('p'));
    const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(saved.hooksConsent).toEqual({ claude: 'granted' });
    expect(saved.extra).toBe(1);
    expect(saved.projects).toHaveLength(1);
  });

  it('survives the runtime rewriting the config (readConfig keeps projects)', () => {
    projects.addProject(mkdir('p'));
    expect(readConfig().projects).toHaveLength(1);
  });

  it('refuses a missing path, a file, / and the home folder', () => {
    expect(() => projects.addProject(path.join(home, 'nope'))).toThrow(/No such folder/);
    const f = path.join(home, 'file.txt');
    fs.writeFileSync(f, 'x');
    expect(() => projects.addProject(f)).toThrow(/Not a folder/);
    expect(() => projects.addProject('/')).toThrow(/Too broad/);
    expect(() => projects.addProject(home)).toThrow(/Too broad/);
  });

  it('registers a symlink as its real target', () => {
    const real = mkdir('real');
    const link = path.join(home, 'link');
    fs.symlinkSync(real, link);
    expect(projects.addProject(link)).toBe(real);
  });

  it('lets a launch use exactly a registered folder', () => {
    const a = mkdir('a');
    projects.addProject(a);
    expect(projects.resolveRegistered(a)).toBe(a);
  });

  it('rejects a launch outside the registry, a subfolder, and junk', () => {
    const a = mkdir('a');
    const sub = mkdir('a/sub');
    const other = mkdir('other');
    projects.addProject(a);
    expect(projects.resolveRegistered(other)).toBeNull();
    expect(projects.resolveRegistered(sub)).toBeNull();
    expect(projects.resolveRegistered('')).toBeNull();
    expect(projects.resolveRegistered(path.join(home, 'missing'))).toBeNull();
    expect(projects.resolveRegistered(`${a}\0/x`)).toBeNull();
    expect(projects.resolveRegistered(undefined as unknown as string)).toBeNull();
  });

  it('rejects a symlink inside a project that escapes it', () => {
    const a = mkdir('a');
    const secret = mkdir('secret');
    projects.addProject(a);
    const escape = path.join(a, 'escape');
    fs.symlinkSync(secret, escape);
    expect(projects.resolveRegistered(escape)).toBeNull();
  });

  it('rejects a registered folder that was swapped for a symlink afterwards', () => {
    const a = mkdir('a');
    const secret = mkdir('secret');
    projects.addProject(a);
    fs.rmSync(a, { recursive: true });
    fs.symlinkSync(secret, a);
    expect(projects.resolveRegistered(a)).toBeNull();
    expect(projects.resolveRegistered(secret)).toBeNull();
  });
});

describe('audit log', () => {
  it('appends one 0600 line per entry, redacted and capped, with no token', () => {
    const token = 'f'.repeat(64);
    const audit = new AuditLog([token]);
    audit.write({
      action: 'launch',
      label: 'brain setup',
      project: '/work/a',
      detail: `fix it ${'y'.repeat(900)} token=${token} sk-ant-abcdefghijklmnop`,
    });
    audit.write({
      action: 'approve',
      label: 'brain setup',
      project: '/work/a',
      tool: 'Bash',
      detail: 'npm test',
    });
    const file = auditPath();
    expect(mode(file)).toBe(0o600);
    const raw = fs.readFileSync(file, 'utf-8');
    const lines = raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines.map((l) => l.action)).toEqual(['launch', 'approve']);
    expect(lines[0].detail.length).toBeLessThanOrEqual(500);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain('sk-ant-abcdefghijklmnop');
    expect(lines[0].ts).toMatch(/^\d{4}-/);
    expect(lines[1]).toMatchObject({ tool: 'Bash', project: '/work/a', label: 'brain setup' });
  });

  it('scrubs the token even when redaction would not know it', () => {
    const token = 'Zq9-plain-looking-secret-value';
    new AuditLog([token]).write({
      action: 'deny',
      label: 'x',
      project: 'p',
      detail: `echo ${token}`,
    });
    expect(fs.readFileSync(auditPath(), 'utf-8')).not.toContain(token);
  });

  it('repairs a loose mode on an existing file', () => {
    fs.mkdirSync(path.dirname(auditPath()), { recursive: true });
    fs.writeFileSync(auditPath(), '', { mode: 0o644 });
    new AuditLog().write({ action: 'stop', label: 'x', project: 'p' });
    expect(mode(auditPath())).toBe(0o600);
  });
});

describe('diwan projects (the command)', () => {
  it('adds, lists and removes, printing what happened, and fails cleanly on a bad path', async () => {
    const { runProjectsCommand } = await import('../../src/diwan/cli.js');
    const out: string[] = [];
    const print = (l: string): void => void out.push(l);
    const a = mkdir('cmd/a');
    expect(runProjectsCommand('list', undefined, print)).toBe(0);
    expect(out.at(-1)).toMatch(/No projects registered/);
    expect(runProjectsCommand('add', a, print)).toBe(0);
    expect(runProjectsCommand('list', undefined, print)).toBe(0);
    expect(out.at(-1)).toBe(a);
    expect(runProjectsCommand('add', path.join(home, 'missing'), print)).toBe(1);
    expect(runProjectsCommand('remove', a, print)).toBe(0);
    expect(runProjectsCommand('remove', a, print)).toBe(0);
    expect(out.at(-1)).toMatch(/Not registered/);
  });
});
