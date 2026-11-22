/**
 * The place two views are in step at, while Synchronise Scrolling moves one with the other (073 FR-033d, extending
 * 044 FR-114).
 *
 * When a scroll in one view moves the other, BOTH mark the place with a soft highlight: the record or line at the
 * SCROLLED view's top, and its counterpart in the follower — wherever that sits in the follower's viewport, so a view
 * that has run out of room (an editor at its last line while a wrapped grid carries on) still shows where the other
 * one is. The mark is a source line (0-based, the numbering `data-source-line` and `syncLine` use): the editor draws it
 * as a line, a CSV grid as the row of the record that starts there, a Markdown preview as an indicator in its gutter
 * beside the block holding it. One mapping, then — the one sync already makes — and no second one here.
 *
 * Keyed by the EDITOR panel of the pair, which is what both sides can name: the preview as its parent, the editor as
 * itself. Module state, so one per renderer window like `editor-scroll-store.ts`; the pair lives in one window.
 *
 * While scrolling continues nothing is drawn (FR-033g): {@link settleSyncMark} waits {@link SYNC_MARK_QUIET_MS} after the
 * LAST sync scroll, then publishes once, on the pair in step at that moment; a mark still showing comes down when
 * scrolling starts again.
 *
 * A published mark is `on` until the highlight duration ({@link SYNC_MARK_FADE_MS} by default) later, then `off` — a class flip the views' CSS transitions out — and gone a moment after that. It is a decoration:
 * nothing here touches focus, a caret, a selection or a scroll position, and it has no setting of its own.
 */
import { useSyncExternalStore } from 'react';

/** How long after the last sync scroll the mark starts to fade by default (073 FR-033d): the shipped `editor.previews.syncHighlightMs`. */
export const SYNC_MARK_FADE_MS = 1500;
/** How long the faded mark is kept after that, for the views' CSS transition to finish before it is dropped. */
export const SYNC_MARK_REMOVE_MS = 700;

/** `line` is 0-based; `on` is false while the mark fades out. A new object is made whenever either changes. */
export interface SyncMark {
  line: number;
  on: boolean;
}

const marks = new Map<string, SyncMark>();
const fadeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

function stopTimers(editorId: string): void {
  const fade = fadeTimers.get(editorId);
  if (fade !== undefined) clearTimeout(fade);
  fadeTimers.delete(editorId);
  const remove = removeTimers.get(editorId);
  if (remove !== undefined) clearTimeout(remove);
  removeTimers.delete(editorId);
}

/**
 * A sync scroll happened for the pair whose editor is `editorId`, at source line `line`: show the mark and restart its fade.
 *
 * `fadeMs` is `editor.previews.syncHighlightMs` as the caller holds it NOW (073 FR-033f), so the next
 * scroll after the setting changes uses the new value. 0 — or anything not a positive finite number — draws no mark in any
 * view: nothing is stored, nobody is told, and one already showing comes down.
 */
export function publishSyncMark(editorId: string, line: number, fadeMs: number = SYNC_MARK_FADE_MS): void {
  if (!(fadeMs > 0) || !Number.isFinite(fadeMs)) {
    clearSyncMark(editorId);
    return;
  }
  const at = Math.max(0, Math.trunc(line));
  stopTimers(editorId);
  const held = marks.get(editorId);
  if (held === undefined || held.line !== at || !held.on) {
    marks.set(editorId, { line: at, on: true });
    emit();
  }
  fadeTimers.set(
    editorId,
    setTimeout(() => {
      fadeTimers.delete(editorId);
      const m = marks.get(editorId);
      if (m === undefined) return;
      marks.set(editorId, { line: m.line, on: false });
      emit();
      removeTimers.set(
        editorId,
        setTimeout(() => {
          removeTimers.delete(editorId);
          if (marks.delete(editorId)) emit();
        }, SYNC_MARK_REMOVE_MS),
      );
    }, fadeMs),
  );
}

/** Drop the pair's mark at once — sync stopped, or a view went. */
export function clearSyncMark(editorId: string): void {
  stopTimers(editorId);
  const waiting = quietTimers.get(editorId);
  if (waiting !== undefined) clearTimeout(waiting);
  quietTimers.delete(editorId);
  if (marks.delete(editorId)) emit();
}

/** How long scrolling must have stopped before the mark is drawn (073 FR-033g, Q41). Fixed, not a preference. */
export const SYNC_MARK_QUIET_MS = 300;
const quietTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A sync scroll happened for the pair whose editor is `editorId` (073 FR-033g): while scrolling continues NOTHING is
 * drawn or moved — no publish, no read of either view's centre, no store notification. A mark still showing from before
 * comes down (the one notification this costs, and only when there was one), and the quiet timer restarts. Once
 * {@link SYNC_MARK_QUIET_MS} pass with no further call, `lineAt` is asked for the place the pair is in step at THEN and
 * the mark is published (fading after `fadeMs`, FR-033f). A `fadeMs` of 0 draws nothing, so nothing is scheduled.
 */
export function settleSyncMark(editorId: string, lineAt: () => number | null, fadeMs: number = SYNC_MARK_FADE_MS): void {
  const waiting = quietTimers.get(editorId);
  if (waiting !== undefined) clearTimeout(waiting);
  quietTimers.delete(editorId);
  if (!(fadeMs > 0) || !Number.isFinite(fadeMs)) {
    clearSyncMark(editorId);
    return;
  }
  if (marks.has(editorId)) {
    stopTimers(editorId);
    marks.delete(editorId);
    emit();
  }
  quietTimers.set(
    editorId,
    setTimeout(() => {
      quietTimers.delete(editorId);
      const line = lineAt();
      if (line !== null) publishSyncMark(editorId, line, fadeMs);
    }, SYNC_MARK_QUIET_MS),
  );
}

export function syncMarkOf(editorId: string): SyncMark | null {
  return marks.get(editorId) ?? null;
}

export function subscribeSyncMark(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to ONE pair's mark; a `null` editor id reads `null`. */
export function useSyncMark(editorId: string | null): SyncMark | null {
  return useSyncExternalStore(subscribeSyncMark, () => (editorId === null ? null : syncMarkOf(editorId)));
}

/**
 * A body's way to read ONE pair's mark: a stable `subscribe` / `get` pair. The panel chrome hands this down instead of the
 * mark's value, so a mark that moves every frame re-renders the body that draws it and not the whole chrome above it
 * (073 T075: the chrome already re-renders once a frame for the editor's top line).
 */
export interface SyncMarkSource {
  subscribe(listener: () => void): () => void;
  get(): SyncMark | null;
}

export function syncMarkSource(editorId: string): SyncMarkSource {
  return { subscribe: subscribeSyncMark, get: () => syncMarkOf(editorId) };
}

const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_MARK = (): null => null;

/** The mark a body draws: from its `source` when the chrome gave one, else the plain value (a harness or a test). */
export function useSyncMarkFrom(source: SyncMarkSource | null | undefined, plain: SyncMark | null | undefined): SyncMark | null {
  const fromSource = useSyncExternalStore(source?.subscribe ?? NO_SUBSCRIBE, source?.get ?? NO_MARK);
  return source ? fromSource : (plain ?? null);
}

/** Test seam: forget every mark and timer. */
export function __resetSyncMarks(): void {
  for (const id of [...fadeTimers.keys(), ...removeTimers.keys()]) stopTimers(id);
  for (const t of quietTimers.values()) clearTimeout(t);
  quietTimers.clear();
  marks.clear();
  emit();
}
