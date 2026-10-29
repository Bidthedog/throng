/**
 * Memory estimates for panels that share a process (055 FR-024, FR-024b, research R9). Each is a
 * calibrated model, not a heap measurement: the constants are fixed by the calibration E2E
 * (`resource-estimates-calibration.e2e.ts`), whose assertion is SC-009's 10% bound, measured against the
 * live heap after a forced collection: V8 plus external in main and in the daemon, V8 plus Blink plus the
 * array-buffer backing store in the renderer.
 *
 * An editor's cost is NOT a function of its length alone. Calibrated over three shapes of the same sizes —
 * Markdown paragraphs, plain single-newline lines that Markdown reads as one paragraph, and a README-like
 * mix — the renderer spends ~300 B per syntax-tree node that is a Lezer `Tree` object of its own (each
 * Markdown block element) and ~70 B per node packed in a buffer, so 1 MB of paragraphs costs ~9 MB of
 * renderer heap, the same 1 MB of lines ~2 MB, and 1 MB of the mix ~20 MB.
 */
export const ESTIMATE_CONSTANTS = Object.freeze({
  /**
   * UI main, per character: the file's string (one byte per character for Latin-1 text, held outside
   * the V8 heap) plus the per-line slices of it that make up the document's `Text`.
   */
  kDoc: 1.31,
  /** UI main, per line: the `Text` tree's own bookkeeping, beyond the slices. */
  kLine: 8.1,
  /** UI main: per open document. */
  docConstant: 16 * 1024,
  /** Renderer, per character: the editor state's text, one string per line. */
  kView: 1.42,
  /** Renderer, per syntax-tree node that is a Lezer `Tree` object of its own (see the module comment). */
  kNode: 309,
  /**
   * Renderer, per syntax-tree node packed in a `TreeBuffer` (four 16-bit words): inline marks, list marks,
   * code tokens. Fitted with `kNode` over paragraphs, plain lines and a README-like mix (whose tree is half
   * `Tree` objects, half buffered nodes): 69 B, a buffer's 8 B per node plus its share of the buffer.
   */
  kBufferNode: 69,
  /**
   * Renderer, per line the view has rendered (its viewport, a screenful plus margin): a document that
   * fills the view costs ~0.45 MB more than one of a line or two, whatever its length. Fitted, not
   * derived: the term stands in for that fixed cost, and its cause (viewport DOM, line tiles, gutters) is
   * not itemised.
   */
  kRenderedLine: 9_450,
  /**
   * Renderer: per editor view. Measured as an empty panel made an editor on a one-line file (median of
   * three: 0.33 MB with its rendered line and main's document).
   */
  viewConstant: 290 * 1024,
  /**
   * Renderer, per element a preview has rendered: the element and everything Blink keeps for it — its
   * style, layout objects and fragments — which is most of a preview's memory (~90% of it is Blink's
   * heap), plus the detached copy of every top-level block the body keeps to reconcile the next render
   * against (`markdown-body.tsx`, `pristine`). Fitted, with `kSpan` and `kPreviewChar`, over paragraphs,
   * plain lines, one large code block and a README-like mix from 0.5 to 10 MB. Recentred from 3,620 on the
   * gate's paragraphs previews, which read 0.90–0.94 of live heap on both a workstation and a hosted
   * runner — at the bound's edge on the runner.
   */
  kDom: 3_800,
  /**
   * Renderer, per `<span>` a preview has rendered, in place of `kDom`: mostly the highlighter's tokens in
   * fenced code, inline runs inside a block that already carries the layout. Fitted.
   */
  kSpan: 2_600,
  /** Renderer, per character of the previewed source: its text nodes, their shaping and line boxes. Fitted. */
  kPreviewChar: 21.9,
  /**
   * UI main, per character of the text a preview last sent: main keeps it to compare the next with, a
   * copy of its own beside any editor's document (measured: main's heap grew 1.0–1.05 B a character).
   */
  kPreviewMain: 1.0,
  /**
   * Renderer, per retained terminal line, beside its cells: the `BufferLine` object, its typed-array and
   * buffer wrappers, and the row's share of what the view keeps beside them. Fitted (see `terminalRendererBytes`).
   */
  kTermLine: 280,
  /**
   * Renderer, per retained line carrying an attribute (a colour, bold, an underline), beyond `kTermLine`:
   * the same thousand lines cost ~0.61 MB more coloured or underlined than plain, all of it outside the
   * cells. Centred on four runs' medians (3.17–3.85 MB live for one estimate): the cost moves ±10% between
   * runs, so a styled terminal is logged rather than asserted (R21); which structure holds it was not itemised.
   */
  kStyledLine: 610,
  /**
   * Renderer, per terminal view: the xterm instance (parser, services, DOM renderer, addons) and the panel
   * around it, with its shell started and nothing printed. The monitor shows it under the terminal's
   * "Terminal buffers" row, which is the only renderer memory a terminal panel's row carries. Fitted.
   */
  termViewConstant: 1_420_000,
});

/** xterm stores each cell as three 32-bit words. */
const BYTES_PER_CELL = 12;
const utf16 = (chars: number): number => Math.max(0, chars) * 2;
const nonNegative = (n: number): number => Math.max(0, n);

/** UI main's share of an editor panel: counted once per document, so a linked panel shows 0. */
export function editorMainBytes(chars: number, lines: number, opts: { readonly linked: boolean }): number {
  if (opts.linked) return 0;
  const K = ESTIMATE_CONSTANTS;
  return Math.round(nonNegative(chars) * K.kDoc + nonNegative(lines) * K.kLine + K.docConstant);
}

/**
 * The renderer's share of an editor panel: its text, its syntax tree — `trees` `Tree` objects and
 * `bufferNodes` nodes packed in buffers — its rendered lines and the view.
 */
export function editorRendererBytes(chars: number, trees: number, bufferNodes: number, renderedLines: number): number {
  const K = ESTIMATE_CONSTANTS;
  return Math.round(
    nonNegative(chars) * K.kView +
      nonNegative(trees) * K.kNode +
      nonNegative(bufferNodes) * K.kBufferNode +
      nonNegative(renderedLines) * K.kRenderedLine +
      K.viewConstant,
  );
}

/**
 * A syntax tree's node count scaled to the whole document when the count covers only `parsedChars` of
 * its `chars`: a tree CodeMirror has not finished parsing, or a count that stopped at its budget. The
 * covered part's density is the best cheap guess at the rest.
 */
export function extrapolatedNodes(nodes: number, parsedChars: number, chars: number): number {
  if (parsedChars <= 0 || parsedChars >= chars) return nodes;
  return Math.round((nodes * chars) / parsedChars);
}

/**
 * A preview panel in the renderer: its rendered elements, how many of them are `<span>`s, and the
 * characters of the source it rendered. Calibrated against the live heap of a rendered preview, where 1 MB
 * of Markdown paragraphs costs ~87 MB and the same 1 MB as a single paragraph ~25 MB — the per-element
 * term is the difference between them.
 */
export function previewRendererBytes(elements: number, spans: number, sourceChars: number): number {
  const K = ESTIMATE_CONSTANTS;
  const all = nonNegative(elements);
  const s = Math.min(all, nonNegative(spans));
  return Math.round((all - s) * K.kDom + s * K.kSpan + nonNegative(sourceChars) * K.kPreviewChar);
}

/** UI main's share of a preview panel: the text it last sent the renderer. */
export function previewMainBytes(chars: number): number {
  return Math.round(nonNegative(chars) * ESTIMATE_CONSTANTS.kPreviewMain);
}

/**
 * A terminal's view in the renderer: every retained buffer line — `term.buffer.normal.length`, the
 * scrollback plus the screen — at its `cols` cells, and the view itself.
 *
 * The cells are not a model. xterm keeps each line's cells in a `Uint32Array` of three words per column,
 * stored off the V8 heap, and the renderer's backing store grew by exactly `lines × cols × 12` in every
 * calibration case (1,045 B a line at 87 columns, 3,040 at 253). The per-line cost beside them and the
 * view's constant are fitted, and so is the extra a line with any attribute on it costs: `styledLines`
 * is how many of the `lines` have one (`styled-lines.ts` samples them).
 */
export function terminalRendererBytes(lines: number, cols: number, styledLines: number): number {
  const K = ESTIMATE_CONSTANTS;
  return (
    nonNegative(lines) * (nonNegative(cols) * BYTES_PER_CELL + K.kTermLine) + nonNegative(styledLines) * K.kStyledLine + K.termViewConstant
  );
}

/**
 * A terminal's retained scrollback in the daemon: one string of at most 64 K characters, two bytes each.
 * An all-ASCII tail is stored at one byte a character, and one character outside Latin-1 makes it two;
 * the daemon's live heap moves by ±0.2 MB between samples whatever a terminal does, so the calibration
 * cannot tell the two apart, and the upper one is kept. At most 128 KB a terminal either way.
 */
export function terminalDaemonBytes(scrollbackChars: number): number {
  return utf16(scrollbackChars);
}
