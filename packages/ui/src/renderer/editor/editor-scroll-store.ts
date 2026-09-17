/**
 * Per-PANEL top visible source line of each mounted editor view, for the previews beside it (044 FR-113;
 * data-model §14.4, research R23).
 *
 * A parented preview follows its editor's scroll. Main already tells the preview WHICH editor is its parent
 * (`PreviewUpdate.parent.panelId`), but scroll is view state main does not own — the same line
 * `caret-store.ts` draws — so no channel carries it, and the editor view registry (`editor-views.ts`) has no
 * change notification a preview that mounted first could wait on. This store is that notification: the
 * editor writes, the preview reads, and nothing in a preview ever writes a line.
 *
 * 044 FR-121 (round 2) made sync two-way, and the store carries that direction too — as a REQUEST, not a
 * write: a preview asks the editor's registered scroller to move (`requestEditorTopLine`), the editor
 * scrolls, and the line it then publishes is marked `fromSync` so the preview does not relay it back
 * (FR-121g). Each side still owns its own scroll (research R30).
 *
 * ══ PER WINDOW, AND ONLY WHILE A VIEW IS MOUNTED ══
 *
 * Module state, so one per renderer window. An editor publishes when its view registers and on scroll, and
 * forgets itself when the view unmounts. A preview whose parent is shown only in another window, or in a tab
 * not in front, therefore finds nothing and does not follow — the same-window reading recorded under FR-113.
 *
 * ══ 0-BASED, LIKE `data-source-line` ══
 *
 * The Markdown pipeline numbers blocks by 0-based file line; CodeMirror's `doc.lineAt(pos).number` is
 * 1-based. The conversion happens once, in {@link editorTopLine}, so the value stored is the one a preview
 * body compares against its blocks without translation.
 */
import { useSyncExternalStore } from 'react';

/**
 * An editor panel's top visible source line (0-based), and whether it is where the editor went to FOLLOW
 * a preview (044 FR-121g; data-model §15.1). A preview never relays a `fromSync` value back: it is the
 * echo of its own request.
 */
export interface EditorTopLine {
  line: number;
  fromSync: boolean;
}

/** Scrolls one editor view so `line` (0-based) is at its top — registered by `editor-scroll-relay.ts`. */
export type EditorScroller = (line: number) => void;

const lines = new Map<string, EditorTopLine>();
const scrollers = new Map<string, EditorScroller>();
/** How many lines each editor view's document has — what renumbers a preview's `data-source-line`s. */
const docLines = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Publish an editor panel's top visible source line (0-based).
 *
 * The same value twice emits nothing, and keeps the snapshot object: the editor publishes once per
 * animation frame while it scrolls, and most of those frames move less than a line. The object is
 * replaced exactly when a field changes, which is what lets `useSyncExternalStore` compare by identity.
 */
export function publishEditorTopLine(panelId: string, line: number, fromSync = false): void {
  const held = lines.get(panelId);
  if (held !== undefined && held.line === line && held.fromSync === fromSync) return;
  lines.set(panelId, { line, fromSync });
  emit();
}

/** The editor panel's top line, or `null` when no mounted view of it has published one in this window. */
export function editorTopLineOf(panelId: string): EditorTopLine | null {
  return lines.get(panelId) ?? null;
}

/**
 * 044 T242 (analysis U2) — publish how many lines the editor panel's document has. The editor publishes its
 * new top line one frame after an edit, but a parented preview draws the edited text only after its update
 * delay; while the two line counts differ, the preview's `data-source-line`s number the OLD text, and the
 * preview holds its side rather than compare numbers from two different documents.
 */
export function publishEditorDocLines(panelId: string, count: number): void {
  if (docLines.get(panelId) === count) return;
  docLines.set(panelId, count);
  emit();
}

/** The editor panel's document line count, or `null` when no mounted view of it has published one here. */
export function editorDocLinesOf(panelId: string): number | null {
  return docLines.get(panelId) ?? null;
}

/** Subscribe a component to ONE editor panel's document line count; `null` panel id reads `null`. */
export function useEditorDocLines(panelId: string | null): number | null {
  return useSyncExternalStore(subscribeEditorTopLine, () => (panelId === null ? null : editorDocLinesOf(panelId)));
}

/** Drop an editor panel's line, its line count and its scroller — its view unmounted. */
export function forgetEditorTopLine(panelId: string): void {
  scrollers.delete(panelId);
  const hadCount = docLines.delete(panelId);
  if (lines.delete(panelId) || hadCount) emit();
}

/**
 * 044 FR-121 — the request direction. An editor view in this window registers how to scroll itself; the
 * returned function unregisters it, and only it (a view that replaced it keeps its own).
 */
export function registerEditorScroller(panelId: string, scroller: EditorScroller): () => void {
  scrollers.set(panelId, scroller);
  return () => {
    if (scrollers.get(panelId) === scroller) scrollers.delete(panelId);
  };
}

/**
 * Ask the editor panel's view in THIS window to put `line` (0-based) at its top. `false` when this window
 * has no view of that editor — FR-121a's "drives nothing": nothing is queued, and no other window is asked.
 * A view that exists but has not finished placing itself holds the request (the relay's R-E4).
 */
export function requestEditorTopLine(panelId: string, line: number): boolean {
  const scroller = scrollers.get(panelId);
  if (scroller === undefined) return false;
  scroller(line);
  return true;
}

/** Subscribe to any editor panel's top line changing. */
export function subscribeEditorTopLine(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Subscribe a component to ONE editor panel's top line; `null` panel id reads `null`.
 *
 * The snapshot is the stored object or `null`; the store replaces the object only when a field changes,
 * so a re-render happens only when this panel's line or its `fromSync` really moved.
 */
export function useEditorTopLine(panelId: string | null): EditorTopLine | null {
  return useSyncExternalStore(subscribeEditorTopLine, () => (panelId === null ? null : editorTopLineOf(panelId)));
}

/** What {@link editorTopLine} reads of an editor view — a real `EditorView` satisfies it unchanged. */
export interface TopLineView {
  scrollDOM: { getBoundingClientRect(): { top: number; left: number } };
  contentDOM: { getBoundingClientRect(): { top: number; left: number } };
  posAtCoords(coords: { x: number; y: number }, precise: false): number | null;
  state: { doc: { lineAt(pos: number): { number: number } } };
}

/**
 * The 0-based source line at the top of `view`'s viewport.
 *
 * `posAtCoords` at the viewport's top-left, not `lineBlockAtHeight`, which answers for a whole logical line
 * and so is wrong inside a wrapped one (`use-editor.ts`'s gutter-toggle note has the measurement). Inset by
 * a pixel on both axes, as that anchor is, and at the CONTENT's left edge rather than the gutter's.
 *
 * The imprecise lookup (`false`), as that anchor uses: the precise one answers `null` for a row outside the
 * rendered viewport, which is exactly where a fast scroll's first frame can land, and publishing "no line"
 * there would throw the preview to the top mid-scroll. CodeMirror types the imprecise call as total; a
 * `null` from it anyway reads as the top of the document rather than a crash on the scroll path.
 */
export function editorTopLine(view: TopLineView): number {
  const top = view.scrollDOM.getBoundingClientRect().top;
  const left = view.contentDOM.getBoundingClientRect().left;
  const pos = view.posAtCoords({ x: left + 1, y: top + 1 }, false);
  return pos === null ? 0 : view.state.doc.lineAt(pos).number - 1;
}

/** Test-only: clear all state. */
export function __resetEditorScrollStore(): void {
  lines.clear();
  scrollers.clear();
  docLines.clear();
  emit();
}
