/**
 * The editor's half of two-way scroll sync (044 FR-121, FR-121a–c, FR-121f, FR-121g; data-model §15.1,
 * plan.md Iteration 2026-09-16 decisions 5 and 6, research R30–R31).
 *
 * One relay per mounted editor view. It PUBLISHES the view's top source line to `editor-scroll-store.ts`
 * whenever that line may have changed, and it REGISTERS the scroller a preview in this window asks through
 * `requestEditorTopLine`. Framework-free and over a view-shaped interface, so both directions are
 * unit-tested with a fake view; a real `EditorView` satisfies {@link RelayView} unchanged.
 *
 * ══ R-E1 — EVERY CAUSE, AT MOST ONCE A FRAME (FR-121f) ══
 *
 * Caret moves, find, Go to Line, history and #144/US8 restores, a Find in Files reveal and typing that
 * scrolls all end in a `scrollTop` write on `scrollDOM`, which fires `scroll`. The one change of top line
 * with NO scroll event is a height change above the viewport — lines inserted or deleted there, a wrap or
 * zoom reflow at the top — so the owner also feeds {@link EditorScrollRelay.onUpdate} from an update
 * listener. Both paths share one animation frame: `posAtCoords` measures layout, and the store drops a
 * value it already holds.
 *
 * ══ R-E2 — A REQUEST MOVES THE VIEWPORT AND NOTHING ELSE (FR-121b) ══
 *
 * A spec whose only key is a `scrollIntoView` effect at the line's start: no `selection` (the caret and the
 * selection stay), no `changes` (not dirty, no undo step, no history entry), and no `focus()`. A line past
 * the end is clamped to the last. A request for the line already at the top dispatches nothing (FR-121g).
 *
 * ══ R-E3 — THE ECHO MARK, AND WHY IT ALWAYS LAPSES (FR-121c, FR-121g) ══
 *
 * While a request is settling, publishes carry `fromSync: true`, and the preview never relays those. The
 * mark lapses at the first publish after a `scroll` event that followed the dispatch. A request that moves
 * nothing — already there, or already at the end — fires no `scroll` at all, so the mark also lapses one
 * frame after the dispatch if the viewport has not moved; a mark waiting for an event that never comes
 * would swallow the reader's next scroll.
 *
 * Such a request is still ANSWERED (R-E5): the lapse publishes the view's unchanged line with `fromSync`, as
 * does a request clamped onto the line already at the top. Without an answer, a preview waiting for an
 * adopted editor to arrive would wait for good (review round 2, I2).
 *
 * "Has not moved" is read from `scrollTop`, not assumed from the missing event: CodeMirror writes
 * `scrollTop` in its measure pass (a frame the dispatch requested, so it runs before the lapse check), and
 * the browser fires `scroll` at the NEXT frame's rendering step. A viewport that moved with its event still
 * due keeps the mark for one more frame — and only one, unless that event has arrived by then.
 *
 * ══ R-E4 — HELD UNTIL THE VIEW HAS PLACED ITSELF (FR-121h) ══
 *
 * The scroller is registered as soon as the relay is attached, so the store can tell a preview "a view of
 * that editor is here" — but a new view restores its own place (#144 view state, US8 document scroll)
 * after construction, and a request applied before that restore would be overwritten by it. So a request
 * that arrives before {@link EditorScrollRelay.ready} is held, the latest wins, and `ready()` applies it.
 */
import { EditorView } from '@codemirror/view';
import type { StateEffect } from '@codemirror/state';
import {
  editorTopLine,
  forgetEditorTopLine,
  publishEditorDocLines,
  publishEditorTopLine,
  registerEditorScroller,
  type TopLineView,
} from './editor-scroll-store.js';

/** What the relay reads and drives of an editor view. */
export interface RelayView extends TopLineView {
  readonly scrollDOM: TopLineView['scrollDOM'] & {
    readonly scrollTop: number;
    addEventListener(type: 'scroll', listener: () => void, options?: AddEventListenerOptions): void;
    removeEventListener(type: 'scroll', listener: () => void): void;
  };
  readonly state: {
    readonly doc: TopLineView['state']['doc'] & {
      readonly lines: number;
      line(n: number): { from: number };
    };
  };
  dispatch(spec: { effects: StateEffect<unknown> }): void;
}

/** The animation-frame pair — `window`'s in the app, a hand-driven one in tests. */
export interface RelayFrames {
  raf(callback: () => void): number;
  caf(handle: number): void;
}

export interface EditorScrollRelay {
  /** The view's initial placement has run: apply a held request, and apply later ones at once. */
  ready(): void;
  /** An editor update: republish when the document or the geometry changed (R-E1). */
  onUpdate(update: { docChanged: boolean; geometryChanged: boolean }): void;
  /** The view is going: remove the listener, cancel frames, forget the line and unregister. */
  dispose(): void;
}

export function attachEditorScrollRelay(view: RelayView, panelId: string, frames: RelayFrames): EditorScrollRelay {
  let disposed = false;
  let isReady = false;
  let held: number | null = null;

  let publishFrame: number | null = null;
  let lapseFrame: number | null = null;

  /** R-E3 — a request is settling. */
  let armed = false;
  /** A `scroll` event has arrived since the latest dispatch. */
  let scrolledSinceDispatch = false;
  /** `scrollTop` when the latest dispatch was made. */
  let scrollTopAtDispatch = 0;

  const disarm = (): void => {
    armed = false;
    scrolledSinceDispatch = false;
    if (lapseFrame !== null) {
      frames.caf(lapseFrame);
      lapseFrame = null;
    }
  };

  const publish = (): void => {
    publishFrame = null;
    if (disposed) return;
    // U2 — the line count first, so a preview reading the new line also sees which document it numbers.
    publishEditorDocLines(panelId, view.state.doc.lines);
    publishEditorTopLine(panelId, editorTopLine(view), armed);
    if (armed && scrolledSinceDispatch) disarm();
  };

  const schedulePublish = (): void => {
    if (disposed) return;
    publishFrame ??= frames.raf(publish);
  };

  const onScroll = (): void => {
    if (armed) scrolledSinceDispatch = true;
    schedulePublish();
  };

  /**
   * R-E5 — the answer to a request that moved nothing: the view's line, as an echo. It says "this is as far as
   * this view goes", so a preview waiting for this view to arrive (FR-121h adoption) stops waiting, and takes
   * the line as where the editor is without scrolling to it (FR-121c).
   */
  const publishUnmoved = (): void => {
    if (publishFrame !== null) frames.caf(publishFrame);
    publishFrame = null;
    publishEditorDocLines(panelId, view.state.doc.lines);
    publishEditorTopLine(panelId, editorTopLine(view), true);
  };

  /** One frame after a dispatch: lapse unless the viewport moved and its event is still due. */
  const lapseCheck = (secondChance: boolean): void => {
    lapseFrame = null;
    if (disposed || !armed || scrolledSinceDispatch) return;
    if (!secondChance && view.scrollDOM.scrollTop !== scrollTopAtDispatch) {
      lapseFrame = frames.raf(() => lapseCheck(true));
      return;
    }
    if (view.scrollDOM.scrollTop === scrollTopAtDispatch) publishUnmoved();
    disarm();
  };

  const apply = (requested: number): void => {
    const last = Math.max(0, view.state.doc.lines - 1);
    const line = Math.min(Math.max(0, Math.trunc(requested)), last);
    if (editorTopLine(view) === line) {
      // Clamped onto the line already at the top: nothing to dispatch (FR-121g), but the request is answered.
      if (line !== requested) publishUnmoved();
      return;
    }
    if (lapseFrame !== null) frames.caf(lapseFrame);
    armed = true;
    scrolledSinceDispatch = false;
    scrollTopAtDispatch = view.scrollDOM.scrollTop;
    // `yMargin: 0` — CodeMirror's default 5px would leave the line above showing, and `editorTopLine` would
    // then read that line back as the top (T246, measured in preview-scroll.e2e.ts).
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line + 1).from, { y: 'start', yMargin: 0 }) });
    lapseFrame = frames.raf(() => lapseCheck(false));
  };

  const scroller = (line: number): void => {
    if (disposed) return;
    if (!isReady) {
      held = line;
      return;
    }
    apply(line);
  };

  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  const unregister = registerEditorScroller(panelId, scroller);
  // A preview that mounted first finds out this view exists, and where it is (FR-113).
  publishEditorDocLines(panelId, view.state.doc.lines);
  publishEditorTopLine(panelId, editorTopLine(view));

  return {
    ready(): void {
      if (disposed || isReady) return;
      isReady = true;
      if (held !== null) {
        const line = held;
        held = null;
        apply(line);
      }
    },
    onUpdate(update): void {
      if (update.docChanged || update.geometryChanged) schedulePublish();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      view.scrollDOM.removeEventListener('scroll', onScroll);
      if (publishFrame !== null) frames.caf(publishFrame);
      if (lapseFrame !== null) frames.caf(lapseFrame);
      publishFrame = null;
      lapseFrame = null;
      unregister();
      forgetEditorTopLine(panelId);
    },
  };
}
