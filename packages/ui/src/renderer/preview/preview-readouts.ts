/**
 * #637 (044 FR-118a – FR-118c) — what a text preview's status bar SAYS: the document's line, character and word
 * counts, and while text is selected its character count and, where the rendered selection maps back to the source,
 * the source lines it spans.
 *
 * The forms, labels, grouping, plural agreement and announced names are the editor strip's — `readoutText` and
 * `READOUT_LABELS` — so `Lns. 3` / `1,204 Chars.` / `208 Words.` read identically on both bars, and the counts
 * come from the same `countCharacters` / `countWords` / `countLines` scan (`document-metrics-store.ts`).
 *
 * ══ WHY NO COLUMN ══
 *
 * A rendered document keeps where each block starts in the source (`data-source-line`, markdown-it's `token.map`)
 * and, within a block, its soft line breaks as `\n` — so a source LINE is recoverable. A source COLUMN is not:
 * `**bold**`, `[a link](…)`, an escape or an entity each draw fewer characters than they are written with. A column
 * computed from the rendered text would be confidently wrong, so the line is drawn alone, ending in a full stop as
 * the editor's line does when its column is not drawn (067 FR-134).
 */
import { formatGrouped, logExpected } from '@throng/core';
import { readoutText, type Readout } from '../editor/status-strip.js';
import type { DocumentMetrics } from '../editor/document-metrics-store.js';
import type { LabelForm, ReadoutId } from '../editor/status-strip-fit.js';

/** What the preview's selection contributes: a count always, its source lines only where they map. */
export interface PreviewSelectionReadout {
  /** Characters selected, counted as the editor counts them (a line break is one). */
  readonly selected: number;
  /** 1-based source lines the selection spans, or `null` when either end does not map to the source. */
  readonly lines: { readonly first: number; readonly last: number } | null;
}

/** `1 word` / `2 words` — the announced name is English, so it agrees in number (as the editor's does). */
function plural(count: number, singular: string, figure: string, suffix = ''): string {
  return `${figure} ${singular}${count === 1 ? '' : 's'}${suffix}`;
}

/**
 * The bar's readouts, in display order: the selection's line(s) and count while there is a selection, then the
 * document's lines, characters and words once they have settled. Absent is not zero: no selection draws no
 * selection readout, and counts not yet scanned draw none (040 FR-005, FR-008b).
 */
export function previewReadouts(
  selection: PreviewSelectionReadout | null,
  metrics: DocumentMetrics | null,
  forms?: Partial<Record<ReadoutId, LabelForm>>,
  locale?: string,
): Readout[] {
  const n = (value: number): string => formatGrouped(value, locale);
  const form = (id: ReadoutId): LabelForm => forms?.[id] ?? 'full';
  const out: Readout[] = [];
  if (selection !== null) {
    const lines = selection.lines;
    if (lines !== null) {
      const range = lines.first !== lines.last;
      const figure = range ? `${n(lines.first)}-${n(lines.last)}` : n(lines.first);
      out.push({
        id: 'line',
        figure,
        text: readoutText('line', figure, form('line'), { comma: false }),
        accessibleName: range ? `lines ${n(lines.first)} to ${n(lines.last)}` : `line ${figure}`,
      });
    }
    out.push({
      id: 'selected',
      figure: n(selection.selected),
      text: readoutText('selected', n(selection.selected), form('selected')),
      accessibleName: plural(selection.selected, 'character', n(selection.selected), ' selected'),
    });
  }
  if (metrics !== null) {
    out.push(
      {
        id: 'lines',
        figure: n(metrics.totalLines),
        text: readoutText('lines', n(metrics.totalLines), form('lines')),
        accessibleName: plural(metrics.totalLines, 'line', n(metrics.totalLines)),
      },
      {
        id: 'chars',
        figure: n(metrics.totalCharacters),
        text: readoutText('chars', n(metrics.totalCharacters), form('chars')),
        accessibleName: plural(metrics.totalCharacters, 'character', n(metrics.totalCharacters)),
      },
      {
        id: 'words',
        figure: n(metrics.totalWords),
        text: readoutText('words', n(metrics.totalWords), form('words')),
        accessibleName: plural(metrics.totalWords, 'word', n(metrics.totalWords)),
      },
    );
  }
  return out;
}

/** Breaks in `text`, each of `\r\n`, `\n` and a lone `\r` counting once — as the line count counts them. */
function breaksIn(text: string): number {
  let breaks = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10) breaks += 1;
    else if (c === 13) {
      breaks += 1;
      if (text.charCodeAt(i + 1) === 10) i += 1;
    }
  }
  return breaks;
}

/** A fence or front-matter delimiter: the block's first source line, whose content starts on the next one. */
const OPENER = /^\s*(```|~~~|---\s*$)/;

/**
 * The 1-based source line of a point in a rendered body, or `null` when the point is in nothing that names one.
 *
 * The innermost `data-source-line` block is the anchor (0-based, front matter included); the soft breaks the
 * block draws before the point are the lines below it. A code block anchored on its fence (or front matter on its
 * `---`) starts its content one line further down.
 */
export function sourceLineAt(host: HTMLElement, node: Node, offset: number, sourceLines: readonly string[]): number | null {
  const start = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const block = start?.closest('[data-source-line]') ?? null;
  if (block === null || !host.contains(block)) return null;
  const base = Number(block.getAttribute('data-source-line'));
  if (!Number.isInteger(base) || base < 0) return null;
  const before = host.ownerDocument.createRange();
  before.setStart(block, 0);
  try {
    before.setEnd(node, offset);
  } catch (error) {
    logExpected(
      'preview-readouts: map a selection end to its source line',
      'a selection end that sits before its block (a node the body has since replaced) cannot be measured; the readout shows the count alone',
      error,
    );
    return null;
  }
  const opener = block.tagName === 'PRE' && OPENER.test(sourceLines[base] ?? '') ? 1 : 0;
  const line = base + opener + breaksIn(before.toString()) + 1;
  return line <= sourceLines.length ? line : null;
}

/** The source lines a rendered range spans, or `null` unless BOTH ends map (an unmappable end shows the count alone). */
export function sourceLinesOf(
  host: HTMLElement,
  range: Range,
  sourceText: string,
): { first: number; last: number } | null {
  const sourceLines = sourceText.split(/\r\n|\n|\r/);
  const first = sourceLineAt(host, range.startContainer, range.startOffset, sourceLines);
  const last = sourceLineAt(host, range.endContainer, range.endOffset, sourceLines);
  if (first === null || last === null) return null;
  return { first: Math.min(first, last), last: Math.max(first, last) };
}
