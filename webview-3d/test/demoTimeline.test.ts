import { describe, expect, test } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { extractToolName } from '../../webview-ui/src/office/toolUtils.js';
import { DEMO_TIMELINE } from '../src/demo/timeline.js';
import { toolKind } from '../src/grammar/toolKind.js';

const msgs = DEMO_TIMELINE.steps.map((s) => s.msg);
const ofType = <T extends ServerMessage['type']>(type: T) =>
  msgs.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);

describe('DEMO_TIMELINE', () => {
  test('setup carries capabilities and a layout', () => {
    const types = DEMO_TIMELINE.setup.map((m) => m.type);
    expect(types).toContain('providerCapabilities');
    expect(types).toContain('layoutLoaded');
  });

  test('steps are sorted and fit inside the loop', () => {
    const ats = DEMO_TIMELINE.steps.map((s) => s.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(Math.min(...ats)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ats)).toBeLessThan(DEMO_TIMELINE.durationMs);
  });

  test('every agent created in a loop is closed before it ends (clean restart)', () => {
    const open = new Set<number>();
    for (const m of msgs) {
      if (m.type === 'agentCreated') {
        expect(open.has(m.id)).toBe(false);
        open.add(m.id);
      }
      if (m.type === 'agentClosed') open.delete(m.id);
    }
    expect([...open]).toEqual([]);
  });

  test('every tool that starts also finishes', () => {
    const running = new Map<string, number>();
    for (const m of msgs) {
      if (m.type === 'agentToolStart') running.set(m.toolId, m.id);
      if (m.type === 'agentToolDone') running.delete(m.toolId);
      if (m.type === 'agentToolsClear' || m.type === 'agentClosed') {
        for (const [toolId, id] of running) if (id === m.id) running.delete(toolId);
      }
    }
    expect([...running.keys()]).toEqual([]);
  });

  test('covers every kind of work', () => {
    const kinds = new Set([
      ...ofType('agentToolStart').map((m) => toolKind(m.toolName ?? extractToolName(m.status))),
      ...ofType('subagentToolStart').map((m) => toolKind(extractToolName(m.status))),
    ]);
    for (const kind of ['read', 'write', 'run', 'search', 'web', 'delegate']) {
      expect(kinds).toContain(kind);
    }
  });

  test('every approval request is later cleared the hooks way for the same agent', () => {
    const requests = DEMO_TIMELINE.steps.filter((s) => s.msg.type === 'agentToolPermission');
    expect(requests.length).toBeGreaterThan(0);
    for (const req of requests) {
      const id = (req.msg as { id: number }).id;
      const cleared = DEMO_TIMELINE.steps.some(
        (s) =>
          s.at > req.at &&
          (s.msg.type === 'agentToolPermissionClear' ||
            s.msg.type === 'agentToolDone' ||
            s.msg.type === 'agentToolsClear' ||
            s.msg.type === 'agentStatus' ||
            (s.msg.type === 'agentToolStart' && !s.msg.permissionActive)) &&
          (s.msg as { id: number }).id === id,
      );
      expect(cleared).toBe(true);
    }
  });

  test('covers approval, waiting, context and a subagent round trip', () => {
    expect(ofType('agentToolPermission').length).toBeGreaterThan(0);
    expect(ofType('agentStatus').some((m) => m.status === 'waiting' && m.awaitingInput)).toBe(true);
    expect(ofType('agentContextUsage').length).toBeGreaterThan(0);
    expect(ofType('subagentToolStart').length).toBeGreaterThan(0);
    expect(ofType('subagentClear').length).toBeGreaterThan(0);
  });
});

describe('DEMO_TIMELINE tool detail', () => {
  const starts = [...ofType('agentToolStart'), ...ofType('subagentToolStart')];

  test('every tool start carries a fuller detail, within the wire cap', () => {
    expect(starts.length).toBeGreaterThan(20);
    for (const m of starts) {
      expect(m.detail, m.status).toBeTruthy();
      expect(m.detail!.length).toBeLessThanOrEqual(400);
      expect(m.detail!.split('\n').length).toBeLessThanOrEqual(6);
    }
  });

  test('a delegate tool reads as task plus prompt line, and the detail reaches past the status', () => {
    const agent = ofType('agentToolStart').find((m) => m.toolName === 'Agent')!;
    expect(agent.detail).toContain('\n');
    const bash = ofType('agentToolStart').find((m) => m.toolName === 'Bash')!;
    expect(bash.detail!.length).toBeGreaterThan(bash.status.length);
  });
});

describe('DEMO_TIMELINE public hygiene', () => {
  // The demo is public: no real client or product names anywhere in it.
  const DENYLIST = /diar|manasik|paytabs|qwirva|jservo|aghrba|newedition|troveo|ra3d/i;
  const strings = (v: unknown): string[] =>
    typeof v === 'string'
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(strings)
        : v && typeof v === 'object'
          ? Object.entries(v).flatMap(([k, x]) => [k, ...strings(x)])
          : [];

  test('no string in the timeline matches the private-name denylist', () => {
    const all = strings(DEMO_TIMELINE);
    expect(all.length).toBeGreaterThan(20);
    // the fuller `detail` text is part of what is scanned
    expect(all.some((s) => s.includes('git push origin'))).toBe(true);
    expect(all.filter((s) => DENYLIST.test(s))).toEqual([]);
  });
});
