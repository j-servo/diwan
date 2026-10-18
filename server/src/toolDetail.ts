/**
 * The fuller action text that rides beside a tool's `status` (the `detail` of agentToolStart /
 * subagentToolStart): secrets masked first, then cut to the wire cap. Provider-agnostic; the
 * provider decides WHICH input fields make up the detail.
 */
import { TOOL_DETAIL_MAX_CHARS, TOOL_DETAIL_MAX_LINES } from './constants.js';

const MASK = '•••';
const ELLIPSIS = '…';
/** Input is trimmed before redaction so a pathological blob costs nothing; far above the wire cap. */
const REDACT_INPUT_MAX = 4_000;

// No leading run: the prefix before the keyword is kept as-is anyway, and an unbounded
// `[\w.-]*` there made 'x-token-' x500 backtrack for about a second. The tail is bounded.
const KEY_NAME = String.raw`(?:(?:api[_-]?key|token|secret|password|passwd)[\w.-]{0,40}|\bauth(?:orization)?)`;

export const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // scheme://user:PASS@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, `$1${MASK}$2`],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/g, `$1${MASK}`],
  // -----BEGIN … PRIVATE KEY----- … -----END … (or to the end when the block is cut)
  [
    /-----BEGIN [A-Z ]{0,30}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,30}PRIVATE KEY-----|$)/g,
    MASK,
  ],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, MASK],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, MASK],
  [/\bnpm_[A-Za-z0-9]{16,}/g, MASK],
  [/(_authToken\s*=\s*)[^\s]+/gi, `$1${MASK}`],
  // curl -u user:PASS / --user user:PASS
  [/(\bcurl\b[^\n|;&]{0,300}?\s(?:-u|--user)[\s=]*['"]?[^\s:'"]{1,100}:)[^\s'"]+/g, `$1${MASK}`],
  // mysql -pPASS, docker login -p PASS / -pPASS
  [
    /(\b(?:mysql|mysqldump|mariadb|docker\s+login)\b[^\n|;&]{0,300}?\s-p)(?=[^\s-])[^\s]+/g,
    `$1${MASK}`,
  ],
  [/(\bdocker\s+login\b[^\n|;&]{0,300}?\s-p\s+)(?!-)[^\s]+/g, `$1${MASK}`],
  [/\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}/g, MASK],
  [/\b(?:gh[po]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,})/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  // --password hunter2
  [/(--[\w-]*(?:token|secret|password|passwd|api-?key)\s+)(?!-)[^\s]+/gi, `$1${MASK}`],
  // KEY=value, key: value, "key": "value"
  [
    new RegExp(
      String.raw`(${KEY_NAME}["']?\s*[=:]\s*)(?:(?:Bearer|Basic|Token|Digest)\s+)?(?:"[^"]*"|'[^']*'|[^\s"';&|}]+)`,
      'gi',
    ),
    `$1${MASK}`,
  ],
];

export function redactSecrets(text: string): string {
  let out = text.length > REDACT_INPUT_MAX ? text.slice(0, REDACT_INPUT_MAX) : text;
  for (const [re, replacement] of RULES) out = out.replace(re, replacement);
  return out;
}

/** At most TOOL_DETAIL_MAX_LINES lines and TOOL_DETAIL_MAX_CHARS characters, ellipsis when cut. */
export function capDetail(text: string): string {
  const lines = text.split('\n');
  let cut = false;
  let out = text;
  if (lines.length > TOOL_DETAIL_MAX_LINES) {
    out = lines.slice(0, TOOL_DETAIL_MAX_LINES).join('\n');
    cut = true;
  }
  if (out.length > TOOL_DETAIL_MAX_CHARS) {
    out = out.slice(0, TOOL_DETAIL_MAX_CHARS);
    cut = true;
  }
  if (!cut) return out;
  // Keep the total within the cap: room for the ellipsis, and no dangling line break before it.
  const room = TOOL_DETAIL_MAX_CHARS - 1;
  return (out.length > room ? out.slice(0, room) : out).trimEnd() + ELLIPSIS;
}

/** Redact, then cap. Undefined for empty text. */
export function finishDetail(text: string): string | undefined {
  const t = text.trim();
  return t ? capDetail(redactSecrets(t)) : undefined;
}
