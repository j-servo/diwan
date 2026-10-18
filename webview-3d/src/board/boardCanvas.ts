import { activeSignal } from '../grammar/signal.js';
import type { FeedEntry } from './feed.js';

export const BOARD_W = 1024;
export const BOARD_H = 512;
export const BOARD_ENTRIES = 5;

export interface BoardItem {
  text: string;
  tone: FeedEntry['tone'];
}

export interface Line {
  text: string;
  tone: FeedEntry['tone'];
  x: number;
  y: number;
  /** Index of the source entry, so the drawer can mark its first line. */
  entry: number;
}

export interface LayoutOptions {
  maxWidth: number;
  maxLinesPerEntry: number;
  lineHeight: number;
  top: number;
  left: number;
  maxLines: number;
}

const ELLIPSIS = '…';

function fitWithEllipsis(text: string, measure: (s: string) => number, maxWidth: number): string {
  if (measure(text) <= maxWidth && !text.includes('\n')) return text;
  let cut = text;
  while (cut.length > 0 && measure(cut + ELLIPSIS) > maxWidth) cut = cut.slice(0, -1);
  return cut.trimEnd() + ELLIPSIS;
}

/** Word-wrap one entry into at most `maxLines` lines; the last is ellipsised if text remains. */
function wrap(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let i = 0;
  for (; i < words.length && lines.length < maxLines; i++) {
    const trial = current ? `${current} ${words[i]}` : words[i];
    if (measure(trial) <= maxWidth) {
      current = trial;
    } else if (current) {
      lines.push(current);
      current = '';
      i--; // retry this word on a fresh line
    } else {
      lines.push(fitWithEllipsis(words[i], measure, maxWidth)); // one word wider than a line
    }
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    current = '';
  }
  // Anything left unplaced (words not consumed, or an unflushed line) means the entry overflowed.
  const overflow = i < words.length || current !== '';
  if (overflow && lines.length > 0) {
    const tail = lines[lines.length - 1];
    const rest = current || words.slice(i).join(' ');
    lines[lines.length - 1] = fitWithEllipsis(`${tail} ${rest}`.trim() + ' ', measure, maxWidth);
  }
  return lines;
}

/**
 * Pure layout for the notice wall: five newest entries, each wrapped and clamped to two lines,
 * stacked top-down until the line budget is spent. `measure` is the text width in px.
 */
export function layoutBoardLines(
  entries: BoardItem[],
  measure: (s: string) => number,
  opts: LayoutOptions,
): Line[] {
  const out: Line[] = [];
  for (let e = 0; e < Math.min(entries.length, BOARD_ENTRIES); e++) {
    const wrapped = wrap(entries[e].text, measure, opts.maxWidth, opts.maxLinesPerEntry);
    if (out.length + wrapped.length > opts.maxLines) break;
    for (const text of wrapped) {
      out.push({
        text,
        tone: entries[e].tone,
        x: opts.left,
        y: opts.top + out.length * opts.lineHeight,
        entry: e,
      });
    }
  }
  return out;
}

export const BOARD_INK: Record<FeedEntry['tone'], string> = {
  info: '#3b2a1a',
  get approval() {
    return activeSignal().ink; // the world's "needs you" colour
  },
  done: '#2f6b3e',
};
const FONT = '34px Georgia, "Iowan Old Style", "Times New Roman", serif';

/** Paints the notice wall: parchment ground, ink text, a thin ruled border. */
export function drawBoard(ctx: CanvasRenderingContext2D, entries: BoardItem[]): void {
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.fillStyle = '#efe3c8';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, 14, BOARD_W - 28, BOARD_H - 28);
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  if (entries.length === 0) {
    ctx.fillStyle = 'rgba(59, 42, 26, 0.55)';
    ctx.fillText('The hall is quiet.', 56, 40);
    return;
  }
  const lines = layoutBoardLines(entries, (s) => ctx.measureText(s).width, {
    maxWidth: BOARD_W - 112,
    maxLinesPerEntry: 2,
    lineHeight: 44,
    top: 40,
    left: 56,
    maxLines: 10,
  });
  for (const line of lines) {
    ctx.fillStyle = BOARD_INK[line.tone];
    ctx.fillText(line.text, line.x, line.y);
  }
}
