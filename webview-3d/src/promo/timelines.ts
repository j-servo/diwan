import type { ServerMessage } from '../../../core/src/messages.js';
import type { DemoStep, DemoTimeline } from '../demo/types.js';

/**
 * The promo's own demo timelines (the existing DEMO_TIMELINE keeps its timing, its tests rely on
 * it). Times here are script seconds: 0 is the first frame of the video. The scholars arrive
 * PREROLL_SEC earlier, so frame 0 already shows a working hall. Fictional names only.
 */
export const PREROLL_SEC = 8;

interface Tool {
  name: string;
  status: string;
  detail: string;
}

const TOOLS: Record<number, Tool[]> = {
  1: [
    {
      name: 'Glob',
      status: 'Searching src/components/**/*.tsx',
      detail: 'src/components/**/*.tsx',
    },
    { name: 'Read', status: 'Reading Hero.tsx', detail: 'src/components/Hero.tsx' },
    { name: 'Edit', status: 'Editing Hero.tsx', detail: 'src/components/Hero.tsx' },
    { name: 'Write', status: 'Writing tokens.css', detail: 'src/styles/tokens.css' },
    {
      name: 'Bash',
      status: 'Running: npm run build',
      detail: 'npm run build && npm run size-check',
    },
    { name: 'Grep', status: 'Searching "TODO(copy)"', detail: '"TODO(copy)" in src' },
  ],
  2: [
    { name: 'Grep', status: 'Searching "invoice_total"', detail: '"invoice_total" in src' },
    { name: 'Read', status: 'Reading invoices.ts', detail: 'src/billing/invoices.ts' },
    { name: 'Bash', status: 'Running: npm test -- invoices', detail: 'npm test -- invoices' },
    { name: 'Edit', status: 'Editing invoices.ts', detail: 'src/billing/invoices.ts' },
    { name: 'Read', status: 'Reading tax.ts', detail: 'src/billing/tax.ts' },
    { name: 'Edit', status: 'Editing tax.ts', detail: 'src/billing/tax.ts' },
  ],
  3: [
    {
      name: 'WebFetch',
      status: 'Fetching docs.example.org/payments',
      detail: 'https://docs.example.org/payments/webhooks',
    },
    { name: 'Read', status: 'Reading checkout.ts', detail: 'src/checkout/checkout.ts' },
    { name: 'Edit', status: 'Editing checkout.ts', detail: 'src/checkout/checkout.ts' },
    { name: 'Bash', status: 'Running: pnpm lint --fix', detail: 'pnpm lint --fix && pnpm format' },
    { name: 'Read', status: 'Reading refunds.ts', detail: 'src/billing/refunds.ts' },
    { name: 'Write', status: 'Writing refunds.test.ts', detail: 'src/billing/refunds.test.ts' },
  ],
};
const SLOT_SEC = [2.6, 3.1, 2.2, 3.4, 2.8, 3.0];

export interface PromoTimelineSpec {
  /** Script second the video ends; churn runs to here. */
  endSec: number;
  /** The scholar (id 2) who asks for approval from `from` to `to`. */
  approval: { from: number; to: number };
  /** An apprentice (agent 1's) works from `from` to `to`. */
  apprentice: { from: number; to: number };
}

/** Builds one world's promo timeline: three scholars at work, one apprentice, one approval. */
export function buildPromoTimeline(spec: PromoTimelineSpec): DemoTimeline {
  const steps: DemoStep[] = [];
  const at = (sec: number, msg: ServerMessage) => {
    steps.push({ at: Math.round((sec + PREROLL_SEC) * 1000), msg });
  };
  at(-7.5, { type: 'agentCreated', id: 1, folderName: 'orchard-site', palette: 0 });
  at(-7.5, { type: 'agentCreated', id: 2, folderName: 'ledger-api', palette: 1 });
  at(-6.5, { type: 'agentCreated', id: 3, folderName: 'caravan-bookings', palette: 2 });

  const busy: Record<number, Array<[number, number]>> = {
    1: [[spec.apprentice.from - 0.3, spec.apprentice.to + 0.6]],
    2: [[spec.approval.from - 0.3, spec.approval.to + 0.6]],
    3: [],
  };
  let n = 0;
  for (const id of [1, 2, 3]) {
    const tools = TOOLS[id]!;
    let t = id === 3 ? -5 : -6;
    let slot = id;
    let k = 0;
    while (t < spec.endSec) {
      const d = SLOT_SEC[slot++ % SLOT_SEC.length]!;
      const clash = busy[id]!.some(([a, b]) => t < b && t + d > a);
      if (!clash) {
        const tool = tools[k++ % tools.length]!;
        const toolId = `p${n++}`;
        at(t, {
          type: 'agentToolStart',
          id,
          toolId,
          toolName: tool.name,
          status: tool.status,
          detail: tool.detail,
        });
        at(t + d - 0.2, { type: 'agentToolDone', id, toolId });
      }
      t += d;
    }
  }

  // The approval: a database migration waits for the scholar's go-ahead.
  const a = spec.approval;
  at(a.from, {
    type: 'agentToolStart',
    id: 2,
    toolId: 'pa',
    toolName: 'Bash',
    status: 'Running: npm run db:migrate',
    detail: 'npm run db:migrate -- --to 0042 && npm run db:seed:test',
  });
  at(a.from + 0.8, { type: 'agentToolPermission', id: 2 });
  at(a.to, { type: 'agentToolDone', id: 2, toolId: 'pa' });

  // An apprentice sent to audit page speed.
  const s = spec.apprentice;
  at(s.from, {
    type: 'agentToolStart',
    id: 1,
    toolId: 'pt',
    toolName: 'Agent',
    status: 'Subtask: audit page speed',
    detail: 'audit page speed\nRun lighthouse on the home page and list what slows it down.',
  });
  at(s.from + 0.5, {
    type: 'subagentToolStart',
    id: 1,
    parentToolId: 'pt',
    toolId: 'ps1',
    status: 'Reading lighthouse.json',
    detail: 'out/lighthouse.json',
  });
  const mid = (s.from + s.to) / 2;
  at(mid, { type: 'subagentToolDone', id: 1, parentToolId: 'pt', toolId: 'ps1' });
  at(mid, {
    type: 'subagentToolStart',
    id: 1,
    parentToolId: 'pt',
    toolId: 'ps2',
    status: 'Running: npx lighthouse',
    detail: 'npx lighthouse https://example.org --only-categories=performance --output=json',
  });
  at(s.to - 0.3, { type: 'subagentToolDone', id: 1, parentToolId: 'pt', toolId: 'ps2' });
  at(s.to - 0.3, { type: 'subagentClear', id: 1, parentToolId: 'pt' });
  at(s.to, { type: 'agentToolDone', id: 1, toolId: 'pt' });

  steps.sort((x, y) => x.at - y.at);
  return {
    setup: [
      {
        type: 'providerCapabilities',
        readingTools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
        subagentToolNames: ['Task', 'Agent'],
      },
      // FilteredTransport swaps in the active world's floor plan.
      { type: 'layoutLoaded', layout: null },
    ],
    steps,
    durationMs: Math.round((spec.endSec + PREROLL_SEC) * 1000),
  };
}
