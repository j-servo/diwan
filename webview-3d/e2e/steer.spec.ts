import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Steering end to end: the real Diwan server in steer mode, a FAKE runner (no Claude session, no
// network, no account), a temp HOME. The hall (dist/webview-3d) comes from the playwright webServer step.
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

let home: string;
let child: ChildProcess | undefined;
let out = '';

test.afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child!.once('close', () => resolve());
      setTimeout(resolve, 3_000);
    });
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

async function startServer(): Promise<{ port: number; hookToken: string }> {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'diwan-steer-e2e-')));
  out = '';
  child = spawn(process.execPath, ['--import', 'tsx', path.join(here, 'steerLauncher.ts')], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  await expect.poll(() => /^READY /m.test(out), { timeout: 30_000 }).toBe(true);
  return JSON.parse(/^READY (.*)$/m.exec(out)![1]) as { port: number; hookToken: string };
}

const saw = (re: RegExp) => () => re.test(out);

/** Use the HUD's "needs you" until the card shows the request whose full text is `detail`. */
async function openAsk(page: Page, detail: string) {
  const card = page.locator('.inspect-card .ic-ask-detail');
  await expect
    .poll(
      async () => {
        if ((await card.count()) > 0 && (await card.innerText()) === detail) return true;
        const needs = page.getByRole('button', { name: /next scholar who needs you/i });
        if ((await needs.count()) > 0) await needs.click();
        return false;
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);
}

/** L5: every CSP violation, from the console and from the securitypolicyviolation event. */
function watchCsp(page: Page): () => Promise<string[]> {
  const seen: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to (load|execute|connect|create|apply)/i.test(m.text()))
      seen.push(m.text());
  });
  void page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  return async () => [
    ...seen,
    ...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])),
  ];
}

async function openHall(page: Page, port: number) {
  await page.goto(`http://127.0.0.1:${port}/`);
  await expect(page.locator('canvas')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.world().loaded), { timeout: 30_000 })
    .toBe(true);
}

test('steer: launch, approve and deny with deliberate clicks, follow up, stop; a terminal scholar has no controls', async ({
  page,
}) => {
  const { port, hookToken } = await startServer();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const csp = watchCsp(page);
  await openHall(page, port);

  // The token never rests in the DOM, the URL or localStorage.
  expect(await page.locator('meta[name="diwan-steer"]').count()).toBe(0);
  expect(page.url()).not.toMatch(/token|[0-9a-f]{64}/);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toMatch(
    /[0-9a-f]{64}/,
  );

  // New scholar: project dropdown, task, model, effort, token budget.
  await page.getByRole('button', { name: 'New scholar' }).click();
  const dialog = page.getByRole('dialog', { name: 'New scholar' });
  await expect(dialog.getByLabel('Project')).toContainText('scratch');
  await expect(dialog.getByLabel('Token budget')).toHaveValue('500K');
  await expect(dialog.getByLabel('Model')).toHaveValue('claude-sonnet-5-5'); // preselected
  await expect(dialog.getByLabel('Model').locator('option')).toHaveText([
    'Opus 5.5 (claude-opus-5-5)',
    'Sonnet 5.5 (claude-sonnet-5-5)',
    'Haiku 5.5 (claude-haiku-5-5)',
  ]);
  await expect(dialog.getByLabel('Effort')).toHaveValue('high'); // preselected
  await expect(dialog.getByLabel('Effort').locator('option')).toHaveText([
    'Low',
    'Medium',
    'High',
    'Extra high (xhigh)',
    'Max',
  ]);
  await expect(dialog).toContainText("The model may lower this if it doesn't support it");
  await expect(dialog).toContainText('500K tokens');
  expect(await dialog.innerText()).not.toContain('$');
  const command =
    'echo one\necho two\necho three\necho four\necho five\necho six\necho seven\necho eight';
  await dialog.getByLabel('Task').fill(command);
  await dialog.getByLabel('Model').selectOption('claude-haiku-5-5');
  await dialog.getByLabel('Effort').selectOption('xhigh');
  await dialog.screenshot({ path: 'test-results/steer-dialog.png' });
  await dialog.getByRole('button', { name: 'Launch' }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(saw(/^LAUNCH .*"model":"claude-haiku-5-5","effort":"xhigh"/m), { timeout: 10_000 })
    .toBe(true);

  // The scholar walks in and asks. The HUD's needs-you opens its card.
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.snapshot().length ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
  await openAsk(page, command); // the full multi-line command, nothing hidden
  const card = page.locator('.inspect-card');
  await expect(card.getByRole('button', { name: 'Deny' })).toBeFocused(); // Deny has default focus
  await expect(card.getByRole('button', { name: 'Approve' })).toBeDisabled(); // not for the first moments
  await expect(card.getByRole('button', { name: 'Approve' })).toBeEnabled({ timeout: 3_000 });
  await card.screenshot({ path: 'test-results/steer-ask.png' });

  // The reply is rendered markdown and inert; the web search never asked, and says so.
  const convo = card.locator('.ic-convo');
  await expect(convo.locator('h4', { hasText: 'Plan' })).toBeVisible();
  await expect(convo.locator('strong', { hasText: 'look' })).toBeVisible();
  const docs = convo.locator('a', { hasText: 'the docs' });
  await expect(docs).toHaveAttribute('href', 'https://example.com/docs');
  await expect(docs).toHaveAttribute('target', '_blank');
  await expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(convo.locator('a', { hasText: 'bad' })).toHaveCount(0); // javascript: is not a link
  await expect(convo.locator('script')).toHaveCount(0);
  await expect(convo).toContainText('<script>window.__pwned = 1</script>'); // shown as text
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  await expect(convo).toContainText('Searched the web: diwan e2e search (auto-approved)');
  await expect.poll(saw(/^SEARCH allow/m)).toBe(true);

  // Enter on the focused button denies: no keystroke approves.
  await page.keyboard.press('Enter');
  await expect.poll(saw(/^DECISION deny/m), { timeout: 10_000 }).toBe(true);
  await expect(card.locator('.ic-ask')).toHaveCount(0);

  // Second scholar: this time a deliberate click on Approve; the tool proceeds.
  await page.getByRole('button', { name: 'New scholar' }).click();
  await page.getByLabel('Task').fill('npm test');
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect.poll(() => (out.match(/^LAUNCH /gm) ?? []).length, { timeout: 10_000 }).toBe(2);
  await openAsk(page, 'npm test');
  await expect(card.getByRole('button', { name: 'Approve' })).toBeEnabled({ timeout: 3_000 });
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(saw(/^DECISION allow/m), { timeout: 10_000 }).toBe(true);
  await expect.poll(saw(/^TOOL-PROCEEDED/m)).toBe(true);
  await expect(card.locator('.ic-spend')).toHaveText('182K of 500K tokens');
  await expect(card.locator('.ic-model')).toHaveText('Sonnet 5.5 · high');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '36');

  // Follow-up, then Stop (confirmed). The scholar leaves.
  await card.getByLabel('Follow-up').fill('also add a README');
  await card.getByRole('button', { name: 'Send' }).click();
  await expect.poll(saw(/^FOLLOWUP also add a README/m)).toBe(true);
  await expect(convo).toContainText('also add a README'); // the follow-up is in the conversation
  // Close the card before the answer lands: the hall shows a scroll marker and the HUD counts it.
  await page.keyboard.press('Escape');
  await expect(page.locator('.inspect-card')).toHaveCount(0);
  await expect(page.locator('.answer-scroll')).toHaveCount(1, { timeout: 8_000 });
  await expect(
    page.getByRole('button', { name: /next scholar whose answer is ready/i }),
  ).toHaveText('1 answer ready');
  // Opening the card clears the marker and the count; the card's state line says it.
  await page.getByRole('button', { name: /next scholar whose answer is ready/i }).click();
  await expect(card.locator('.ic-turn')).toHaveText('Answer ready');
  await expect(card.locator('.ic-convo')).toContainText('Here is the answer');
  await expect(page.locator('.answer-scroll')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /next scholar whose answer is ready/i }),
  ).toHaveCount(0);
  await card.getByRole('button', { name: 'Interrupt' }).click();
  await expect.poll(saw(/^INTERRUPT/m)).toBe(true);
  const before = await page.evaluate(() => window.__diwan?.snapshot().length ?? 0);
  await card.getByRole('button', { name: 'Stop' }).click();
  await expect(card.getByRole('alertdialog')).toBeVisible(); // Stop asks first
  expect(out).not.toMatch(/^STOPPED/m);
  await card.getByRole('alertdialog').getByRole('button', { name: 'Stop' }).click();
  await expect.poll(saw(/^STOPPED/m)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => window.__diwan?.snapshot().length ?? 0), { timeout: 10_000 })
    .toBeLessThan(before);

  // A terminal session is watch-only: no controls, it still says to answer in the terminal.
  const transcript = path.join(home, '.claude', 'projects', '-tmp-term', 'term-session-0001.jsonl');
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  fs.writeFileSync(
    transcript,
    JSON.stringify({ type: 'ai-title', aiTitle: 'Terminal work' }) + '\n',
  );
  const common = { session_id: 'term-session-0001', transcript_path: transcript, cwd: '/tmp/term' };
  for (const event of [
    { hook_event_name: 'SessionStart', source: 'startup' },
    {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'tt1',
      tool_input: { command: 'make' },
    },
    { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make' } },
  ]) {
    const res = await fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hookToken}` },
      body: JSON.stringify({ ...common, ...event }),
    });
    expect(res.status).toBe(200);
  }
  await page
    .getByRole('button', { name: /next scholar who needs you/i })
    .click({ timeout: 20_000 });
  await expect(card.locator('.ic-needs')).toContainText('Answer it in your terminal');
  await expect(card.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Deny' })).toHaveCount(0);
  await expect(card.getByLabel('Follow-up')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Stop' })).toHaveCount(0);

  expect(errors).toEqual([]);
  expect(await csp()).toEqual([]); // L5: the full policy, and the hall still renders and steers
});

test('plain diwan has no steer controls at all', async ({ page }) => {
  // The read-only hall (demo mode here has no server) never shows the New scholar button.
  await page.goto('/?demo=1&director=0&mood=golden');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New scholar' })).toHaveCount(0);
});

test('steer: warnings first; Approve stays off until the end of a long command was in view', async ({
  page,
}) => {
  const { port } = await startServer();
  const csp = watchCsp(page);
  await openHall(page, port);
  const lines = Array.from({ length: 80 }, (_, i) => `echo line ${i + 1}`);
  lines[2] = 'echo a\u202Eb'; // a bidi override inside the command
  const command = `${lines.join('\n')}\nrm -rf build`;
  await page.getByRole('button', { name: 'New scholar' }).click();
  await page.getByLabel('Task').fill(command);
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect.poll(saw(/^LAUNCH /m), { timeout: 10_000 }).toBe(true);
  const card = page.locator('.inspect-card');
  const detail = card.locator('.ic-ask-detail');
  await expect
    .poll(
      async () => {
        if ((await detail.count()) > 0) return true;
        const needs = page.getByRole('button', { name: /next scholar who needs you/i });
        if ((await needs.count()) > 0) await needs.click();
        return false;
      },
      { timeout: 20_000, intervals: [250] },
    )
    .toBe(true);

  // Warnings sit above the command: hidden characters, then the size.
  const warnings = card.getByRole('list', { name: 'Check before approving' });
  await expect(warnings).toContainText('Hidden characters');
  await expect(card.locator('.ic-size')).toContainText('81 lines');
  await expect(detail).toContainText('⟦U+202E⟧');
  const order = await card.locator('.ic-ask').evaluate((el) => {
    const kids = [...el.children].map((c) => c.className || c.tagName);
    return (
      kids.findIndex((k) => String(k).includes('ic-warnings')) <
      kids.findIndex((k) => String(k).includes('ic-ask-detail'))
    );
  });
  expect(order).toBe(true);

  // Past the 700 ms guard, Approve is still off: the end of the command has not been seen.
  const approve = card.getByRole('button', { name: 'Approve' });
  await page.waitForTimeout(1_200);
  await expect(approve).toBeDisabled();
  await detail.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(approve).toBeEnabled({ timeout: 3_000 });
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect.poll(saw(/^DECISION deny/m), { timeout: 10_000 }).toBe(true);
  expect(await csp()).toEqual([]);
});
