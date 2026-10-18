export type ToolKind = 'read' | 'write' | 'run' | 'search' | 'web' | 'delegate' | 'other';

const KIND_BY_TOOL: Record<string, ToolKind> = {
  Read: 'read',
  NotebookRead: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  Bash: 'run',
  BashOutput: 'run',
  KillShell: 'run',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'delegate',
  Agent: 'delegate',
};

/** Groups a Claude Code tool name into the kind of work a world visualises. */
export function toolKind(toolName: string | null | undefined): ToolKind | null {
  if (!toolName) return null;
  return KIND_BY_TOOL[toolName] ?? 'other';
}
