import type { ToolKind } from './toolKind.js';

export const KIND_COLORS: Record<ToolKind, string> = {
  read: '#36dfe6',
  write: '#f2e24a',
  run: '#ef476f',
  search: '#11d452',
  web: '#6FD62A',
  delegate: '#f8861e',
  other: '#adb5bd',
};

export const KIND_LABELS: Record<ToolKind, string> = {
  read: 'Reading',
  write: 'Writing',
  run: 'Running',
  search: 'Searching',
  web: 'Web',
  delegate: 'Delegating',
  other: 'Other',
};
