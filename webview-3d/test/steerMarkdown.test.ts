import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Markdown, safeHref } from '../src/steer/Markdown.js';

const html = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown (untrusted replies)', () => {
  it('renders headings, bold, italic, code, lists and links', () => {
    const out = html(
      '# Title\n\nSome **bold** and *soft* and `code`.\n\n- one\n- two\n\n1. first\n2. second\n\n[docs](https://example.com/a?b=1)',
    );
    expect(out).toContain('<h3>Title</h3>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>soft</em>');
    expect(out).toContain('<code>code</code>');
    expect(out).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(out).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(out).toContain(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it('a link always opens in a new tab with noopener noreferrer', () => {
    const anchors = html('[a](http://x.test/) and [b](https://y.test/)').match(/<a [^>]*>/g)!;
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  it('raw HTML is inert text', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b>hi</b>');
    expect(out).not.toMatch(/<script|<img|<b>/i);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:x',
    'file:///etc/passwd',
    '//evil.example/x',
    'https://x.test/"onmouseover="alert(1)',
    'java\tscript:alert(1)',
  ])('does not link %s', (url) => {
    const out = html(`[click me](${url})`);
    expect(out).not.toContain('<a ');
    expect(out).not.toMatch(/href=/i);
    expect(out).toContain('click me');
    expect(safeHref(url)).toBeNull();
  });

  it('code fences show their content as text', () => {
    const out = html('```js\n<script>x</script>\n**not bold**\n```');
    expect(out).toContain('<pre>');
    expect(out).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(out).not.toContain('<strong>');
  });

  it('does not run away on odd input', () => {
    expect(() => html('*'.repeat(5000) + '[' + '('.repeat(3000))).not.toThrow();
    expect(html('')).toBe('<div class="md"></div>');
  });
});
