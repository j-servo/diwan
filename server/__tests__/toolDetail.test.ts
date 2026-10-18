import { describe, expect, it } from 'vitest';

import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import { capDetail, redactSecrets } from '../src/toolDetail.js';

const MASK = '•••';

describe('redactSecrets', () => {
  it('masks a Bearer token', () => {
    expect(
      redactSecrets('curl -H "Authorization: Bearer abc.DEF-123_xyz==" https://x.io'),
    ).not.toContain('abc.DEF');
    expect(redactSecrets('Authorization: Bearer abc123def456')).toBe(`Authorization: ${MASK}`);
    expect(redactSecrets('curl -H "x-token: Bearer abc123def456" u')).not.toContain('abc123');
    expect(redactSecrets('echo Bearer abc123def456')).toBe(`echo Bearer ${MASK}`);
  });
  it('masks sk- and sk-ant- keys', () => {
    expect(redactSecrets('export K=sk-abcdefghijklmnop1234')).toBe(`export K=${MASK}`);
    expect(redactSecrets('use sk-ant-api03-AbCdEf_ghIJ-klmn0123 now')).toBe(`use ${MASK} now`);
  });
  it('masks GitHub tokens', () => {
    expect(
      redactSecrets('git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/a/b'),
    ).not.toContain('ghp_abc');
    expect(redactSecrets('gho_abcdefghijklmnopqrstuvwxyz0123')).toBe(MASK);
    expect(redactSecrets('github_pat_11ABCDEFG0123456789_abcdefghijklmnop')).toBe(MASK);
  });
  it('masks Slack tokens', () => {
    expect(redactSecrets('xoxb-1234567890-abcdefghij')).toBe(MASK);
    expect(redactSecrets('t=xoxp-1234567890-abcdefghij')).toBe(`t=${MASK}`);
  });
  it('masks AWS access key ids', () => {
    expect(redactSecrets('id AKIAIOSFODNN7EXAMPLE end')).toBe(`id ${MASK} end`);
  });
  it('masks key=value and key: value pairs by key name', () => {
    expect(redactSecrets('API_KEY=hunter2 npm run x')).toBe(`API_KEY=${MASK} npm run x`);
    expect(redactSecrets('api-key: hunter2')).toBe(`api-key: ${MASK}`);
    expect(redactSecrets('GITHUB_TOKEN="abc def" run')).toBe(`GITHUB_TOKEN=${MASK} run`);
    expect(redactSecrets('{"password": "s3cret!"}')).toBe(`{"password": ${MASK}}`);
    expect(redactSecrets('DB_PASSWD=x; echo ok')).toBe(`DB_PASSWD=${MASK}; echo ok`);
    expect(redactSecrets('client_secret: abc')).toBe(`client_secret: ${MASK}`);
    expect(redactSecrets('auth=zzz')).toBe(`auth=${MASK}`);
  });
  it('masks a --flag value for secret flags', () => {
    expect(redactSecrets('tool --password hunter2 --verbose')).toBe(
      `tool --password ${MASK} --verbose`,
    );
  });
  it('masks the password in a URL', () => {
    expect(redactSecrets('psql postgres://admin:p4ss@db.local:5432/app')).toBe(
      `psql postgres://admin:${MASK}@db.local:5432/app`,
    );
  });
  it('leaves ordinary commands untouched', () => {
    for (const cmd of [
      'npm test -- invoices',
      'git push origin main',
      'git log --author=bob --oneline',
      'ls -la src/components',
      'grep -rn "tokenize" src/',
      'node scripts/build.mjs --production',
      'curl https://example.org/a?b=c',
      'git commit -m "fix author field"',
      'task-sk-notakey',
      'ls -p',
      'grep -p foo file',
      'ps -u yousef',
      'docker run -u 1000:1000 img',
      'mysql -p -e "select 1"',
      'cat package.json | head',
    ]) {
      expect(redactSecrets(cmd)).toBe(cmd);
    }
  });
});

describe('redactSecrets: more credential shapes', () => {
  it('masks the credential after Basic / token schemes, not only the scheme', () => {
    expect(redactSecrets('curl -H "Authorization: Basic dXNlcjpwYXNz" u')).toBe(
      `curl -H "Authorization: ${MASK}" u`,
    );
    expect(redactSecrets('Authorization: token abc123def')).toBe(`Authorization: ${MASK}`);
  });
  it('masks curl -u user:pass', () => {
    expect(redactSecrets('curl -u admin:hunter2 https://x.io')).toBe(
      `curl -u admin:${MASK} https://x.io`,
    );
    expect(redactSecrets('curl -s --user bob:pw1 https://x.io')).toBe(
      `curl -s --user bob:${MASK} https://x.io`,
    );
  });
  it('masks -p<pw> and -p <pw> after mysql / mariadb / docker login', () => {
    expect(redactSecrets('mysql -u root -phunter2 db')).toBe(`mysql -u root -p${MASK} db`);
    expect(redactSecrets('mariadb -pfoo')).toBe(`mariadb -p${MASK}`);
    expect(redactSecrets('docker login -u me -p hunter2 reg.io')).toBe(
      `docker login -u me -p ${MASK} reg.io`,
    );
    expect(redactSecrets('docker login -u me -phunter2')).toBe(`docker login -u me -p${MASK}`);
    expect(redactSecrets('x --password hunter2')).toBe(`x --password ${MASK}`);
  });
  it('masks Stripe, npm, _authToken, JWT and PEM', () => {
    expect(redactSecrets('k=sk_live_abcdefgh12345678')).toBe(`k=${MASK}`);
    expect(redactSecrets('use sk_test_abcdefgh12345678 x')).toBe(`use ${MASK} x`);
    expect(redactSecrets('rk_live_abcdefgh12345678')).toBe(MASK);
    expect(redactSecrets('npm_abcdefghijklmnopqrstuvwxyz0123')).toBe(MASK);
    expect(redactSecrets('//registry.npmjs.org/:_authToken=abc123xyz')).toBe(
      `//registry.npmjs.org/:_authToken=${MASK}`,
    );
    expect(redactSecrets('t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMiJ9.c2lnbmF0dXJl end')).toBe(
      `t ${MASK} end`,
    );
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEabc\ndef\n-----END RSA PRIVATE KEY-----';
    expect(redactSecrets(`echo "${pem}" > k`)).toBe(`echo "${MASK}" > k`);
    expect(redactSecrets('-----BEGIN PRIVATE KEY-----\nMIIEabc')).toBe(MASK);
  });
});

describe('redactSecrets: linear time on hostile input', () => {
  const time = (s: string) => {
    const t = performance.now();
    redactSecrets(s);
    return performance.now() - t;
  };
  const mixed = Array.from(
    { length: 8000 },
    (_, i) => ['x-token-', 'token-', '.token.', 'api_key', 'a.b-', ' '][i % 6],
  ).join('');
  it.each([
    ['x-token- x1500', 'x-token-'.repeat(1500)],
    ['token- x2000', 'token-'.repeat(2000)],
    ['.token. x2000', '.token.'.repeat(2000)],
    ['64KB mixed', mixed.repeat(Math.ceil(65536 / mixed.length)).slice(0, 65536)],
  ])('%s redacts in under 50 ms', (_n, input) => {
    expect(time(input)).toBeLessThan(50);
  });
});

describe('capDetail', () => {
  it('keeps short text whole', () => {
    expect(capDetail('a\nb')).toBe('a\nb');
  });
  it('cuts at 400 characters with an ellipsis', () => {
    const out = capDetail('x'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out.endsWith('…')).toBe(true);
  });
  it('cuts at 6 lines with an ellipsis', () => {
    const out = capDetail(['1', '2', '3', '4', '5', '6', '7', '8'].join('\n'));
    expect(out.split('\n')).toHaveLength(6);
    expect(out.endsWith('…')).toBe(true);
  });
  it('does not mark exactly 6 lines as cut', () => {
    const six = ['1', '2', '3', '4', '5', '6'].join('\n');
    expect(capDetail(six)).toBe(six);
  });
});

describe('claudeProvider.formatToolDetail', () => {
  const f = (tool: string, input: Record<string, unknown>, cwd?: string) =>
    claudeProvider.formatToolDetail?.(tool, input, cwd);

  it('Bash gives the whole command, redacted, past the 30-char status cut', () => {
    const cmd = 'npm run build -- --token=abcdef && echo a-very-long-command-tail';
    const d = f('Bash', { command: cmd });
    expect(d).toContain('echo a-very-long-command-tail');
    expect(d).toContain(`--token=${MASK}`);
    expect(d).not.toContain('abcdef');
  });
  it('Read/Edit/Write give the path, relative inside the project folder', () => {
    expect(f('Read', { file_path: '/p/app/src/a.ts' }, '/p/app')).toBe('src/a.ts');
    expect(f('Edit', { file_path: '/p/app/src/a.ts' }, '/p/app')).toBe('src/a.ts');
    expect(f('Write', { file_path: '/elsewhere/a.ts' }, '/p/app')).toBe('/elsewhere/a.ts');
    expect(f('Write', { file_path: '/p/app-other/a.ts' }, '/p/app')).toBe('/p/app-other/a.ts');
    expect(f('Read', { file_path: '/p/app/a.ts' })).toBe('/p/app/a.ts');
  });
  it('Grep and Glob give the pattern and path', () => {
    expect(f('Grep', { pattern: 'invoice_total', path: '/p/app/src' }, '/p/app')).toBe(
      'invoice_total in src',
    );
    expect(f('Glob', { pattern: 'src/**/*.tsx' })).toBe('src/**/*.tsx');
  });
  it('WebFetch and WebSearch give the URL or query', () => {
    expect(f('WebFetch', { url: 'https://docs.example.org/p', prompt: 'x' })).toBe(
      'https://docs.example.org/p',
    );
    expect(f('WebSearch', { query: 'WCAG contrast' })).toBe('WCAG contrast');
  });
  it('Task and Agent give the description and the first prompt line', () => {
    expect(
      f('Agent', { description: 'audit page speed', prompt: 'Run lighthouse.\nThen report.' }),
    ).toBe('audit page speed\nRun lighthouse.');
    expect(f('Task', { description: 'only desc' })).toBe('only desc');
  });
  it('other tools get a compact key: value summary', () => {
    expect(f('Fancy', { a: 'x', n: 3, ok: true, o: { k: 1 } })).toBe(
      'a: x\nn: 3\nok: true\no: {"k":1}',
    );
  });
  it('is undefined when there is nothing to show, and redacts the summary', () => {
    expect(f('Bash', {})).toBeUndefined();
    expect(f('Fancy', {})).toBeUndefined();
    expect(f('Fancy', { password: 'abc' })).toBe(`password: ${MASK}`);
  });
});
