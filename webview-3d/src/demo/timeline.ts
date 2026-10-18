import type { ServerMessage } from '../../../core/src/messages.js';
import type { DemoStep, DemoTimeline } from './types.js';

const at = (ms: number, msg: ServerMessage): DemoStep => ({ at: ms, msg });
// `detail` is the fuller action text the real server sends beside `status` (all of it fictional).
const start = (
  ms: number,
  id: number,
  toolId: string,
  toolName: string,
  status: string,
  detail: string,
) => at(ms, { type: 'agentToolStart', id, toolId, toolName, status, detail });
const done = (ms: number, id: number, toolId: string) =>
  at(ms, { type: 'agentToolDone', id, toolId });

const usage = (ms: number, id: number, contextTokens: number) =>
  at(ms, { type: 'agentContextUsage', id, contextTokens, maxContextTokens: 200_000 });
const subStart = (
  ms: number,
  id: number,
  parentToolId: string,
  toolId: string,
  status: string,
  detail: string,
) => at(ms, { type: 'subagentToolStart', id, parentToolId, toolId, status, detail });
const subDone = (ms: number, id: number, parentToolId: string, toolId: string) =>
  at(ms, { type: 'subagentToolDone', id, parentToolId, toolId });
const rest = (ms: number, id: number) => [
  at(ms, { type: 'agentToolsClear', id }),
  at(ms, { type: 'agentStatus', id, status: 'waiting' }),
];

// Three sessions over a 150 s loop; every agent is closed before the loop restarts.
// Beats (seconds into the loop; the frames spec shoots at these):
//   0-36    first burst: orchard-site (front end), ledger-api (back end), caravan-bookings joins at 9
//   12-21.5 The orchard-site scholar sends an apprentice: audit page speed
//   14-22   ledger-api needs your approval (a database migration)
//   18-25   caravan-bookings is waiting for your answer
//   36-96   idle interlude: every scholar idle, the idle director's outings, the auto-dusk fade
//   96-130  second burst: tax fix, pricing page, refund tests by a second apprentice (103-115.5)
//   106-114 ledger-api needs your approval (git push); 122-130 caravan-bookings (staging deploy)
//   145     all three leave
export const DEMO_TIMELINE: DemoTimeline = {
  setup: [
    {
      type: 'providerCapabilities',
      readingTools: ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch'],
      subagentToolNames: ['Task', 'Agent'],
    },
    // FilteredTransport swaps in the active world's floor plan.
    { type: 'layoutLoaded', layout: null },
  ],
  durationMs: 150_000,
  steps: [
    // ---- first burst
    at(0, { type: 'agentCreated', id: 1, folderName: 'orchard-site', palette: 0 }),
    at(0, { type: 'agentCreated', id: 2, folderName: 'ledger-api', palette: 1 }),
    start(1_500, 1, 't1', 'Glob', 'Searching src/components/**/*.tsx', 'src/components/**/*.tsx'),
    start(2_500, 2, 't2', 'Grep', 'Searching "invoice_total"', '"invoice_total" in src'),
    done(3_500, 1, 't1'),
    start(3_500, 1, 't3', 'Read', 'Reading Hero.tsx', 'src/components/Hero.tsx'),
    done(5_500, 2, 't2'),
    start(5_500, 2, 't4', 'Read', 'Reading invoices.ts', 'src/billing/invoices.ts'),
    done(6_500, 1, 't3'),
    start(6_500, 1, 't5', 'Edit', 'Editing Hero.tsx', 'src/components/Hero.tsx'),
    usage(8_000, 1, 64_000),
    done(8_500, 2, 't4'),
    start(
      8_500,
      2,
      't6',
      'Bash',
      'Running: npm test -- invoices',
      'npm test -- invoices --reporter=dot --coverage',
    ),
    at(9_000, { type: 'agentCreated', id: 3, folderName: 'caravan-bookings', palette: 2 }),
    start(
      10_000,
      3,
      't7',
      'WebFetch',
      'Fetching docs.example.org/payments',
      'https://docs.example.org/payments/webhooks',
    ),
    done(11_000, 1, 't5'),
    start(
      12_000,
      1,
      't8',
      'Agent',
      'Subtask: audit page speed',
      'audit page speed\nRun lighthouse on the home page and list what slows it down.',
    ),
    done(12_000, 2, 't6'),
    start(
      12_500,
      2,
      't9',
      'Bash',
      'Running: npm run db:migrate',
      'npm run db:migrate -- --to 0042 && npm run db:seed:test',
    ),
    subStart(13_000, 1, 't8', 's1', 'Reading lighthouse.json', 'out/lighthouse.json'),
    at(14_000, { type: 'agentToolPermission', id: 2 }),
    done(15_000, 3, 't7'),
    start(15_000, 3, 't10', 'Read', 'Reading checkout.ts', 'src/checkout/checkout.ts'),
    subDone(16_000, 1, 't8', 's1'),
    subStart(
      16_000,
      1,
      't8',
      's2',
      'Running: npx lighthouse',
      'npx lighthouse https://example.org --only-categories=performance --output=json',
    ),
    done(18_000, 3, 't10'),
    at(18_000, { type: 'agentStatus', id: 3, status: 'waiting', awaitingInput: true }),
    subDone(21_000, 1, 't8', 's2'),
    at(21_000, { type: 'subagentClear', id: 1, parentToolId: 't8' }),
    done(21_500, 1, 't8'),
    done(22_000, 2, 't9'),
    start(
      22_000,
      2,
      't11',
      'Write',
      'Writing 0042_add_currency.sql',
      'db/migrations/0042_add_currency.sql',
    ),
    start(
      22_500,
      1,
      't12',
      'WebSearch',
      'Searching the web: WCAG contrast',
      'WCAG 2.2 contrast requirements for large text',
    ),
    usage(24_000, 2, 150_000),
    start(25_000, 3, 't13', 'Edit', 'Editing checkout.ts', 'src/checkout/checkout.ts'),
    done(26_000, 2, 't11'),
    start(26_000, 2, 't14', 'Bash', 'Running: npm test', 'npm test'),
    done(26_500, 1, 't12'),
    start(26_500, 1, 't15', 'Write', 'Writing tokens.css', 'src/styles/tokens.css'),
    done(30_000, 1, 't15'),
    usage(30_000, 1, 110_000),
    start(
      30_000,
      1,
      't16',
      'Bash',
      'Running: npm run build',
      'npm run build && npm run size-check -- --max 180kb',
    ),
    done(31_000, 2, 't14'),
    ...rest(31_000, 2),
    done(32_000, 3, 't13'),
    start(
      32_000,
      3,
      't17',
      'Bash',
      'Running: pnpm lint --fix',
      'pnpm lint --fix && pnpm format --write src',
    ),
    done(34_000, 1, 't16'),
    ...rest(34_000, 1),
    done(36_000, 3, 't17'),
    ...rest(36_000, 3),
    // ---- idle interlude, 36-96 s: nothing is sent; the hall lives on its own
    // ---- second burst
    start(96_000, 2, 't20', 'Read', 'Reading tax.ts', 'src/billing/tax.ts'),
    start(97_000, 3, 't21', 'Grep', 'Searching "TODO(refunds)"', '"TODO(refunds)" in src'),
    start(98_000, 1, 't22', 'Read', 'Reading Pricing.tsx', 'src/pages/Pricing.tsx'),
    done(99_000, 2, 't20'),
    start(99_000, 2, 't23', 'Edit', 'Editing tax.ts', 'src/billing/tax.ts'),
    done(100_000, 3, 't21'),
    start(100_000, 3, 't24', 'Read', 'Reading refunds.ts', 'src/billing/refunds.ts'),
    done(101_000, 1, 't22'),
    start(101_000, 1, 't25', 'Edit', 'Editing Pricing.tsx', 'src/pages/Pricing.tsx'),
    done(103_000, 3, 't24'),
    start(
      103_000,
      3,
      't26',
      'Agent',
      'Subtask: write refund tests',
      'write refund tests\nCover partial refunds, double refunds and expired orders.',
    ),
    subStart(104_000, 3, 't26', 's3', 'Writing refunds.test.ts', 'src/billing/refunds.test.ts'),
    done(105_000, 2, 't23'),
    start(105_000, 2, 't27', 'Bash', 'Running: git push', 'git push origin fix/tax-rounding'),
    at(106_000, { type: 'agentToolPermission', id: 2 }),
    done(107_000, 1, 't25'),
    start(
      107_000,
      1,
      't28',
      'WebFetch',
      'Fetching docs.example.org/brand',
      'https://docs.example.org/brand/guidelines',
    ),
    subDone(109_000, 3, 't26', 's3'),
    subStart(
      109_000,
      3,
      't26',
      's4',
      'Running: npm test -- refunds',
      'npm test -- refunds --runInBand',
    ),
    usage(110_000, 3, 120_000),
    done(111_000, 1, 't28'),
    start(111_000, 1, 't29', 'Edit', 'Editing Footer.tsx', 'src/components/Footer.tsx'),
    done(114_000, 2, 't27'),
    ...rest(114_000, 2),
    subDone(115_000, 3, 't26', 's4'),
    at(115_000, { type: 'subagentClear', id: 3, parentToolId: 't26' }),
    done(115_500, 3, 't26'),
    start(116_000, 3, 't30', 'Edit', 'Editing refunds.ts', 'src/billing/refunds.ts'),
    done(117_000, 1, 't29'),
    start(
      117_000,
      1,
      't31',
      'Bash',
      'Running: npx playwright test',
      'npx playwright test --project=chromium --reporter=line',
    ),
    usage(118_000, 1, 172_000),
    done(121_000, 3, 't30'),
    start(
      121_000,
      3,
      't32',
      'Bash',
      'Running: npm run deploy:staging',
      'npm run deploy:staging -- --region eu-west-1 --confirm',
    ),
    at(122_000, { type: 'agentToolPermission', id: 3 }),
    done(126_000, 1, 't31'),
    ...rest(126_000, 1),
    done(130_000, 3, 't32'),
    ...rest(130_000, 3),
    at(145_000, { type: 'agentClosed', id: 1 }),
    at(145_000, { type: 'agentClosed', id: 2 }),
    at(145_000, { type: 'agentClosed', id: 3 }),
  ],
};
