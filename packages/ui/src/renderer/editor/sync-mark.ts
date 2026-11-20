/**
 * The editor's half of the sync mark (073 FR-033d): the source line the pair is in step at, softly highlighted while
 * Synchronise Scrolling moves one view with the other, whether that line is at the editor's top or part way down it.
 *
 * The line comes from `preview/sync-mark-store.ts`, keyed by this editor's panel id; this extension only DRAWS it, as a
 * whole-line decoration (`throng-sync-mark`, plus `throng-sync-mark--on` while it is bright, so a CSS transition fades
 * it). A store change reaches the view as an effect-only transaction, which carries no selection, no scroll and no
 * focus change — the caret, the selection and the viewport are never touched.
 */
import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import { subscribeSyncMark, syncMarkOf } from '../preview/sync-mark-store.js';

/** Dispatched when the pair's mark changed; the plugin rebuilds from the store. */
const refresh = StateEffect.define<null>();

const OFF = Decoration.line({ class: 'throng-sync-mark' });
const ON = Decoration.line({ class: 'throng-sync-mark throng-sync-mark--on' });

function build(view: EditorView, panelId: string): DecorationSet {
  const mark = syncMarkOf(panelId);
  if (mark === null) return Decoration.none;
  const { doc } = view.state;
  const line = doc.line(Math.min(doc.lines, mark.line + 1));
  const b = new RangeSetBuilder<Decoration>();
  b.add(line.from, line.from, mark.on ? ON : OFF);
  return b.finish();
}

/** The extension an editor view of `panelId` carries. */
export function syncMarkExtension(panelId: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private readonly unsubscribe: () => void;
      private seen = syncMarkOf(panelId);
      constructor(view: EditorView) {
        this.decorations = build(view, panelId);
        this.unsubscribe = subscribeSyncMark(() => {
          // Only this pair's mark matters; and a store change comes from a timer or a React effect, never from inside a view update.
          const now = syncMarkOf(panelId);
          if (now === this.seen) return;
          this.seen = now;
          view.dispatch({ effects: refresh.of(null) });
        });
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.transactions.some((t) => t.effects.some((e) => e.is(refresh)))) {
          this.decorations = build(update.view, panelId);
        }
      }
      destroy(): void {
        this.unsubscribe();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
