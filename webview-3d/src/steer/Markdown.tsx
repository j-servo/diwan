// webview-3d/src/steer/Markdown.tsx
import type { ReactNode } from 'react';

/**
 * A scholar's reply is untrusted text. This renders a small, safe subset of markdown (headings,
 * bold, italic, code, lists, quotes, links) straight into React elements: no innerHTML, no raw
 * HTML (a `<script>` is just visible text), and only http(s) links, which open in a new tab with
 * rel="noopener noreferrer".
 */

/** The url if it is a plain http(s) link; otherwise null (javascript:, data:, vbscript:, ...). */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!/^https?:\/\//i.test(url) || /[\s\u0000-\u001f\u007f-\u009f"<>]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

const INLINE = /\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*\s][^*]*?)\*|\[([^\]]+?)\]\(([^)\s]+)\)/;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const k = `${key}-${n++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{inline(m[1], k)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined) out.push(<em key={k}>{inline(m[3], k)}</em>);
    else {
      const href = safeHref(m[5]);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer">
            {m[4]}
          </a>
        ) : (
          // Not a safe link: the words stay, the address does not become clickable.
          <span key={k}>{m[4]}</span>
        ),
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

export function Markdown(props: { text: string }) {
  const lines = props.text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const para: string[] = [];
  const flush = (): void => {
    if (para.length > 0) {
      const key = `p${k++}`;
      blocks.push(<p key={key}>{inline(para.join(' '), key)}</p>);
      para.length = 0;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```/.exec(line);
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++; // the closing fence (or the end)
      blocks.push(<pre key={`c${k++}`}>{code.join('\n')}</pre>);
    } else if (heading) {
      flush();
      const key = `h${k++}`;
      const Tag = `h${Math.min(6, heading[1].length + 2)}` as 'h3';
      blocks.push(<Tag key={key}>{inline(heading[2], key)}</Tag>);
      i++;
    } else if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const items: ReactNode[] = [];
      const key = `l${k++}`;
      while (i < lines.length) {
        const m = (ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/).exec(lines[i]);
        if (!m) break;
        items.push(<li key={`${key}-${i}`}>{inline(m[1], `${key}-${i}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
    } else if (quote) {
      flush();
      const key = `q${k++}`;
      const q: string[] = [];
      while (i < lines.length) {
        const m = /^\s*>\s?(.*)$/.exec(lines[i]);
        if (!m) break;
        q.push(m[1]);
        i++;
      }
      blocks.push(<blockquote key={key}>{inline(q.join(' '), key)}</blockquote>);
    } else if (line.trim() === '') {
      flush();
      i++;
    } else {
      para.push(line.trim());
      i++;
    }
  }
  flush();
  return <div className="md">{blocks}</div>;
}
