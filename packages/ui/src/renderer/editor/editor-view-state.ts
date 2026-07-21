/**
 * Per-document editor VIEW state — caret/selection and scroll position — by panel
 * id (issue #144).
 *
 * Switching projects, active panels or active tabs unmounts the CodeMirror view
 * (a background tab is not in the React tree — FR-008), and remounting rebuilds it
 * from the authority's TEXT, which carries no selection, so the caret snaps back to
 * the start. This tiny module carries the view state across that unmount/remount,
 * keyed by panel id — the same identity the document keeps in UI main — so coming
 * back leaves the caret and viewport exactly where the user left them.
 *
 * View state is a per-view concern, NOT part of the shared document authority: two
 * mirrored views of one document each have their own caret, and one must never
 * overwrite the other's (the undo path already encodes this rule). It is a sibling
 * of the live-view registry in `editor-views.ts`, and module-scoped for the same
 * reason: it must outlive a React remount.
 */

/** A CodeMirror `EditorSelection.toJSON()` shape (the parts we persist). */
export interface SelectionJson {
  ranges: Array<{ anchor: number; head: number }>;
  main: number;
}

export interface EditorViewState {
  selection: SelectionJson;
  /**
   * The DOCUMENT position of the first visible line at save time (0 when scrolled to
   * the top). Restored via `EditorView.scrollIntoView(pos, { y: 'start' })`, which
   * scrolls through CodeMirror's own machinery so its virtualised viewport re-renders
   * to match. Writing `scrollDOM.scrollTop` directly does NOT do this — the scroller
   * moves but CodeMirror keeps rendering the old lines, leaving a blank viewport. A
   * document position also survives the fresh view instance and the async
   * language/indent reconfigure, where a raw pixel offset does not.
   */
  scrollAnchor: number;
}

const store = new Map<string, EditorViewState>();

export function saveEditorViewState(panelId: string, state: EditorViewState): void {
  store.set(panelId, state);
}

/** Read the saved view state for a panel and consume it (one save → one restore). */
export function takeEditorViewState(panelId: string): EditorViewState | undefined {
  const state = store.get(panelId);
  store.delete(panelId);
  return state;
}

/** Drop any saved view state for a panel (called on explicit Panel destroy). */
export function clearEditorViewState(panelId: string): void {
  store.delete(panelId);
}

/**
 * Clamp a saved selection so every position lies within `[0, docLength]`, returning
 * `undefined` when there is nothing usable. The document can change (shrink) on disk
 * between save and restore; dispatching a selection that points outside the document
 * throws, so out-of-range positions are pulled back to the nearest valid offset
 * rather than dropped, and any non-finite value degrades to 0.
 */
export function clampSelection(
  selection: SelectionJson | undefined,
  docLength: number,
): SelectionJson | undefined {
  if (!selection || !Array.isArray(selection.ranges) || selection.ranges.length === 0) {
    return undefined;
  }
  const clamp = (n: number): number =>
    Number.isFinite(n) ? Math.max(0, Math.min(docLength, Math.trunc(n))) : 0;
  const ranges = selection.ranges.map((r) => ({ anchor: clamp(r.anchor), head: clamp(r.head) }));
  const main = Number.isFinite(selection.main)
    ? Math.max(0, Math.min(ranges.length - 1, Math.trunc(selection.main)))
    : 0;
  return { ranges, main };
}
