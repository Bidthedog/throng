/**
 * The editor's half of the sync mark (073 FR-033d): the source line the pair is in step at, softly highlighted while
 * Synchronise Scrolling moves one view with the other, whether that line is at the editor's top or part way down it.
 *
 * The line comes from `preview/sync-mark-store.ts`, keyed by this editor's panel id; this extension only DRAWS it, as a
 * class on the line's own DOM element (`throng-sync-mark`, plus `throng-sync-mark--on` while it is bright, so a CSS
 * transition fades it).
 *
 * ══ NO TRANSACTION PER MARK (073 T075) ══
 *
 * The mark moves once a frame while either view scrolls. Drawing it as a line decoration meant a CodeMirror transaction
 * (a full view update: every plugin, the link scan, the gutters, a measure) per frame on top of the scroll's own, which
 * made scrolling a large file in step slow. This plugin instead puts the class on the rendered line directly: one
 * \`domAtPos\` and two class toggles per move, no state change, no update. CodeMirror owns the line elements, so the class
 * is applied again after every update (in the measure write phase, which runs after the DOM is synced) — a line CodeMirror
 * redrew while scrolling gets it back, and a line outside the rendered viewport simply has no element to mark until it is
 * scrolled to. The caret, the selection, the focus and the scroll are never touched.
 */
import type { Extension } from '@codemirror/state';
import { logExpected } from '@throng/core';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { subscribeSyncMark, syncMarkOf } from '../preview/sync-mark-store.js';

const CLASS = 'throng-sync-mark';
const ON = 'throng-sync-mark--on';

/** The rendered `.cm-line` for 0-based `line`, or `null` while it is outside the rendered viewport. */
function lineElement(view: EditorView, line: number): HTMLElement | null {
  const { doc } = view.state;
  const at = doc.line(Math.min(doc.lines, line + 1)).from;
  if (at < view.viewport.from || at > view.viewport.to) return null;
  try {
    const { node } = view.domAtPos(at);
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    return el?.closest<HTMLElement>('.cm-line') ?? null;
  } catch (error) {
    logExpected('sync-mark: find the marked line', 'a line CodeMirror has not rendered has no element to mark; the mark is drawn when it is scrolled to', error);
    return null;
  }
}

/** The extension an editor view of `panelId` carries. */
export function syncMarkExtension(panelId: string): Extension {
  return ViewPlugin.fromClass(
    class {
      private current: HTMLElement | null = null;
      private seen = syncMarkOf(panelId);
      private readonly unsubscribe: () => void;

      constructor(private readonly view: EditorView) {
        this.unsubscribe = subscribeSyncMark(() => {
          // Only this pair's mark matters.
          const now = syncMarkOf(panelId);
          if (now === this.seen) return;
          this.seen = now;
          this.draw();
        });
        this.schedule();
      }

      update(update: ViewUpdate): void {
        // CodeMirror may have redrawn the line (a viewport move, an edit): put the class back once the DOM is synced.
        if (this.seen !== null && (update.docChanged || update.viewportChanged || update.geometryChanged)) this.schedule();
      }

      destroy(): void {
        this.unsubscribe();
      }

      private schedule(): void {
        if (this.seen === null && this.current === null) return;
        this.view.requestMeasure({ key: this, read: () => null, write: () => this.draw() });
      }

      /** Take the class off the line it was on and put it on the marked one — two elements at most. */
      private draw(): void {
        const mark = this.seen;
        const target = mark === null ? null : lineElement(this.view, mark.line);
        if (this.current !== null && this.current !== target) this.current.classList.remove(CLASS, ON);
        this.current = target;
        if (target === null || mark === null) return;
        if (!target.classList.contains(CLASS)) target.classList.add(CLASS);
        target.classList.toggle(ON, mark.on);
      }
    },
  );
}
