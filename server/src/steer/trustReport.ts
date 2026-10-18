/**
 * What a folder brings with it when a launched scholar runs there. Registering a project means
 * the Agent SDK loads the folder's own Claude settings as if trusted, so `diwan projects add`
 * lists them first: hooks (events and commands), permission allow rules, env keys (names only)
 * and the .mcp.json servers.
 */
import * as fs from 'fs';
import * as path from 'path';

import { terminalSafe } from '../terminalText.js';

const SHOW_MAX = 200;

export interface TrustReport {
  /** "Event: command" per hook command. */
  hooks: string[];
  allow: string[];
  /** Variable NAMES only; values are never read out. */
  envKeys: string[];
  mcpServers: string[];
  /** Files that exist but could not be read as JSON objects. */
  unreadable: string[];
}

/** Hooks, allow rules, env or an unreadable settings file: registering needs --yes. */
export function needsConfirmation(r: TrustReport): boolean {
  return (
    r.hooks.length > 0 || r.allow.length > 0 || r.envKeys.length > 0 || r.unreadable.length > 0
  );
}

const clip = (s: string): string => {
  const t = terminalSafe(s);
  return t.length > SHOW_MAX ? `${t.slice(0, SHOW_MAX - 1)}…` : t;
};

function readJson(file: string): { value?: Record<string, unknown>; exists: boolean; ok: boolean } {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    return { exists: (err as NodeJS.ErrnoException).code !== 'ENOENT', ok: false };
  }
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return { value: v as Record<string, unknown>, exists: true, ok: true };
    }
  } catch {
    // falls through
  }
  return { exists: true, ok: false };
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function inspectProject(dir: string): TrustReport {
  const report: TrustReport = { hooks: [], allow: [], envKeys: [], mcpServers: [], unreadable: [] };
  for (const name of ['settings.json', 'settings.local.json']) {
    const rel = path.join('.claude', name);
    const r = readJson(path.join(dir, rel));
    if (!r.exists) continue;
    if (!r.ok || !r.value) {
      report.unreadable.push(rel);
      continue;
    }
    const hooks = asObject(r.value['hooks']);
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of Array.isArray(groups) ? groups : []) {
        const inner = asObject(group)['hooks'];
        for (const h of Array.isArray(inner) ? inner : []) {
          const cmd = asObject(h)['command'];
          report.hooks.push(
            `${clip(event)}: ${typeof cmd === 'string' ? clip(cmd) : '(not a command)'}`,
          );
        }
      }
    }
    const allow = asObject(r.value['permissions'])['allow'];
    for (const rule of Array.isArray(allow) ? allow : []) {
      if (typeof rule === 'string') report.allow.push(clip(rule));
    }
    for (const key of Object.keys(asObject(r.value['env']))) report.envKeys.push(clip(key));
  }
  const mcp = readJson(path.join(dir, '.mcp.json'));
  if (mcp.exists && !mcp.ok) report.unreadable.push('.mcp.json');
  if (mcp.value) {
    for (const name of Object.keys(asObject(mcp.value['mcpServers']))) {
      report.mcpServers.push(clip(name));
    }
  }
  return report;
}

/** The lines `diwan projects add` prints before it registers. */
export function trustLines(dir: string, r: TrustReport): string[] {
  const out = [
    `Registering ${dir} lets launched scholars run with this folder's own Claude settings,`,
    'as if you trusted it: its hooks, permission rules, env and MCP servers all apply.',
  ];
  const section = (title: string, items: string[]): void => {
    if (items.length === 0) return;
    out.push(`  ${title}:`);
    for (const i of items) out.push(`    ${i}`);
  };
  section('Hooks (.claude/settings*.json)', r.hooks);
  section('Allow rules (permissions.allow, run without asking)', r.allow);
  section('Env variables set (names only)', r.envKeys);
  section('MCP servers (.mcp.json)', r.mcpServers);
  section('Files that could not be read', r.unreadable);
  if (!needsConfirmation(r) && r.mcpServers.length === 0) {
    out.push('  This folder carries no hooks, allow rules, env or MCP servers.');
  }
  return out;
}
