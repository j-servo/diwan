/**
 * The registry of folders a launch may run in: `diwan projects add|remove|list`. Running the
 * command is the consent. Stored under `projects` in ~/.diwan/config.json (0600, atomic) as REAL
 * paths. A launch cwd must resolve (realpath) to exactly one of them, and the entry itself must
 * still resolve to what was registered, so a symlink swapped in later cannot widen the hall's reach.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getBrand } from '../brand.js';
import { CONFIG_FILE_NAME } from '../constants.js';

export interface Project {
  path: string;
  name: string;
}

export class ProjectError extends Error {}

function configPath(): string {
  return path.join(os.homedir(), getBrand().dirName, CONFIG_FILE_NAME);
}

/**
 * config.json holds more than the registry. Missing is fine ({}); one that is there but cannot be
 * read as a JSON object is an error, never silently {}: writing the registry back would erase it.
 */
function readRaw(): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(configPath(), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new ProjectError(`Could not read ${configPath()}: ${(err as Error).message}`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // falls through
  }
  throw new ProjectError(
    `${configPath()} is corrupt (not a JSON object). Fix or remove it, then try again; nothing was changed.`,
  );
}

function writeProjects(projects: string[]): void {
  const file = configPath();
  const raw = readRaw();
  raw.projects = projects;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

function stored(): string[] {
  const list = readRaw().projects;
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : [];
}

function real(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export function listProjects(): Project[] {
  return stored().map((p) => ({ path: p, name: path.basename(p) }));
}

/** Top-level system folders no project may be. */
const SYSTEM_DIRS = [
  '/System',
  '/Library',
  '/Applications',
  '/usr',
  '/bin',
  '/etc',
  '/private',
  '/Volumes',
];

/** Is `inner` the same as, or inside, `outer`? */
const within = (outer: string, inner: string): boolean =>
  inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);

/** The real path a folder would be registered as, or a ProjectError saying why not. */
export function checkProject(input: string): string {
  const resolved = real(path.resolve(input));
  if (resolved === null) throw new ProjectError(`No such folder: ${input}`);
  if (!fs.statSync(resolved).isDirectory()) throw new ProjectError(`Not a folder: ${input}`);
  const home = real(os.homedir());
  // The home folder and everything above it (/, /Users) are too broad, and so are the system roots.
  if (resolved === path.parse(resolved).root || (home !== null && within(resolved, home))) {
    throw new ProjectError(
      'Too broad: register a project folder, not / , your home folder or a folder above it.',
    );
  }
  for (const dir of SYSTEM_DIRS) {
    if (resolved === dir || resolved === real(dir)) {
      throw new ProjectError(`Too broad: ${resolved} is a system folder, not a project.`);
    }
  }
  return resolved;
}

/** Register a folder (stored as its real path). Returns the stored path. */
export function addProject(input: string): string {
  const resolved = checkProject(input);
  const list = stored();
  if (!list.includes(resolved)) writeProjects([...list, resolved]);
  return resolved;
}

/** Unregister a folder, matching its real path or the text as registered. */
export function removeProject(input: string): boolean {
  const abs = path.resolve(input);
  const targets = new Set([abs, real(abs)].filter((p): p is string => p !== null));
  const list = stored();
  const next = list.filter((p) => !targets.has(p));
  if (next.length === list.length) return false;
  writeProjects(next);
  return true;
}

/**
 * The real path a launch may use, or null. `requested` must realpath to a registered entry that
 * itself still resolves to the same real path.
 */
export function resolveRegistered(requested: string): string | null {
  if (typeof requested !== 'string' || requested === '' || requested.includes('\0')) return null;
  const target = real(requested);
  if (target === null) return null;
  let entries: string[];
  try {
    entries = stored();
  } catch {
    return null; // an unreadable registry cannot vouch for anything
  }
  for (const entry of entries) {
    if (entry === target && real(entry) === entry) return entry;
  }
  return null;
}
