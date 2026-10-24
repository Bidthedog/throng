/**
 * Memory estimates for panels that share a process (055 FR-024, FR-024b, research R9). Each is a
 * calibrated model, not a heap measurement: the constants are fixed by the calibration E2E
 * (`resource-estimates-calibration.e2e.ts`), whose assertion is SC-009's 10% bound.
 */
export const ESTIMATE_CONSTANTS = Object.freeze({
  /** UI main: the document string plus its line index, per UTF-16 byte. */
  kDoc: 1.25,
  /** UI main: per open document. */
  docConstant: 16 * 1024,
  /** Renderer: editor state, syntax tree and rendered viewport, per UTF-16 byte. */
  kView: 2.5,
  /** Renderer: per editor view. */
  viewConstant: 256 * 1024,
  /** Renderer: per rendered preview DOM node. */
  kDom: 320,
  /** Renderer: per retained terminal line object, beside its cells. */
  lineOverhead: 64,
});

/** xterm stores each cell as three 32-bit words. */
const BYTES_PER_CELL = 12;
const utf16 = (chars: number): number => Math.max(0, chars) * 2;

/** UI main's share of an editor panel: counted once per document, so a linked panel shows 0. */
export function editorMainBytes(chars: number, opts: { readonly linked: boolean }): number {
  if (opts.linked) return 0;
  return Math.round(utf16(chars) * ESTIMATE_CONSTANTS.kDoc + ESTIMATE_CONSTANTS.docConstant);
}

/** The renderer's share of an editor panel. */
export function editorRendererBytes(chars: number): number {
  return Math.round(utf16(chars) * ESTIMATE_CONSTANTS.kView + ESTIMATE_CONSTANTS.viewConstant);
}

/** A preview panel: its rendered DOM plus the content it rendered. */
export function previewRendererBytes(domNodes: number, contentChars: number): number {
  return Math.round(Math.max(0, domNodes) * ESTIMATE_CONSTANTS.kDom + utf16(contentChars));
}

/** A terminal's xterm buffer in the renderer. */
export function terminalRendererBytes(lines: number, cols: number): number {
  const l = Math.max(0, lines);
  return l * Math.max(0, cols) * BYTES_PER_CELL + l * ESTIMATE_CONSTANTS.lineOverhead;
}

/** A terminal's retained scrollback in the daemon. */
export function terminalDaemonBytes(scrollbackChars: number): number {
  return utf16(scrollbackChars);
}
