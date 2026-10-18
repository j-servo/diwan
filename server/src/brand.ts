/**
 * Who this process is running as. Pixel Agents (VS Code extension, `npx pixel-agents`)
 * and Diwan (`diwan`) share one runtime but must never share state: each keeps its own
 * home directory, hook script, hook identity and settings.json backup. The entry point
 * picks the brand once, before anything touches disk; every path below reads it lazily.
 *
 * Process-global on purpose: one process is one brand, and threading it through the
 * persistence modules would touch every call site for no gain.
 */
import { SERVER_JSON_DIR } from './constants.js';
import {
  LEGACY_HOOK_SCRIPT_NAME,
  SETTINGS_BACKUP_SUFFIX,
  SETTINGS_TMP_SUFFIX,
} from './providers/hook/claude/constants.js';

export interface Brand {
  /** State directory under the home directory (config, layout, server.json, hooks/). */
  dirName: string;
  /** Subdirectory of the package `dist/` that holds the bundled hook script to copy. */
  hookBundleDir: string;
  /** Suffix of the one-time backup of ~/.claude/settings.json. */
  settingsBackupSuffix: string;
  /** Suffix of the temp file for the atomic settings.json write. */
  settingsTmpSuffix: string;
  /** Script name shipped before the rename to claude-hook.js, still recognised as ours. */
  legacyHookScriptName?: string;
}

export const PIXEL_AGENTS_BRAND: Brand = {
  dirName: SERVER_JSON_DIR,
  hookBundleDir: 'hooks',
  settingsBackupSuffix: SETTINGS_BACKUP_SUFFIX,
  settingsTmpSuffix: SETTINGS_TMP_SUFFIX,
  legacyHookScriptName: LEGACY_HOOK_SCRIPT_NAME,
};

export const DIWAN_BRAND: Brand = {
  dirName: '.diwan',
  hookBundleDir: 'diwan-hooks',
  settingsBackupSuffix: '.diwan.backup',
  settingsTmpSuffix: '.diwan-tmp',
};

let current: Brand = PIXEL_AGENTS_BRAND;

export function getBrand(): Brand {
  return current;
}

export function setBrand(brand: Brand): void {
  current = brand;
}
