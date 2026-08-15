import { useEffect, useRef, type ReactElement } from 'react';
import { EditorState, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { throngHighlighting } from './highlight-style.js';
import { applyLanguage, functionHighlightCompartment, languageCompartment } from './editor-language.js';

/**
 * A buffer-only CodeMirror editor (feature 007, US5 — extracted from the 006
 * editor's mount, research D6). Plain text `value`/`onChange`; NO Panel, editor
 * coordinator, dirty-lock, recovery, or file I/O — so the preferences JSON tabs
 * each mount an independent instance (FR-021, no shared buffer). Reuses the 006
 * extension set (line numbers, history, selection, active-line, standard keymap,
 * line wrapping) and the editor font-family token.
 */
export interface StandaloneEditorProps {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  /**
   * The language to highlight as (016). Defaults to JSON, because every one of this editor's
   * current users — settings, key bindings, themes — IS JSON, and throng's own configuration files
   * are among the files a user is most likely to be looking at (FR-001a).
   */
  languageId?: string;
}

export function StandaloneEditor({
  value,
  onChange,
  testId,
  languageId = 'json',
}: StandaloneEditorProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Set while pushing a programmatic value into the view so the update listener
  // doesn't misreport it as a user edit (which would re-apply/loop).
  const suppressRef = useRef(false);

  // Mount once; the buffer content is synced via the value effect below.
  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          // The preferences JSON editors get the SAME highlighting as any other editor (016,
          // FR-001a). They are a second CodeMirror view, and a second view is exactly where a
          // feature like this silently goes missing.
          languageCompartment.of([]),
          throngHighlighting,
          // The legacy-language function-name overlay (021, #84 follow-up) — after throngHighlighting
          // so its decoration nests inside the syntax span and its inline colour wins. Empty until a
          // legacy language is applied; the config editors are JSON, so it stays empty here.
          functionHighlightCompartment.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !suppressRef.current) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': {
              fontFamily: "var(--throng-font-editor-family, Consolas, 'Courier New', monospace)",
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    void applyLanguage(view, languageId, () => viewRef.current === view);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync an external value change (e.g. tab/theme switch, or a clean reload) into
  // the view. A no-op when the buffer already equals `value` (i.e. the user's own
  // edit round-tripped), so it never fights typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      suppressRef.current = true;
      /*
       * KEEP THE CARET WHERE THE USER LEFT IT.
       *
       * A full replace (`from: 0, to: current.length`) drops the selection at offset 0, so any
       * programmatic sync sent the caret to line 1 column 1 — even a legitimate one, like adopting
       * an external document via the conflict banner's Reload.
       *
       * Clamped to the new length: the incoming document can be shorter than the old caret offset,
       * and an out-of-range selection is a hard error in CodeMirror rather than a silent
       * adjustment. Offsets are not stable across a rewrite, so this preserves POSITION, not the
       * exact token — which is the honest thing a reload can offer.
       */
      const previous = view.state.selection.main;
      const anchor = Math.min(previous.anchor, value.length);
      const head = Math.min(previous.head, value.length);

      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor, head },
        /*
         * LOADING A DOCUMENT IS NOT AN EDIT (#264).
         *
         * Without this the history records the load itself. The preferences JSON tab reads its
         * document off disk AFTER mount, so the editor mounts empty and the content arrives through
         * this dispatch — leaving an undo stack of `[empty] -> [document]` before the user has
         * touched anything. Ctrl+Z then faithfully undid the only entry it had, emptying the buffer
         * and raising "Invalid JSON — not applied", neither of which described anything the user did.
         *
         * `suppressRef` above is a different guard for a different problem: it stops the update
         * listener reporting this as a user edit and looping it back out. It never touched the
         * history, which is why the two are separate.
         */
        annotations: Transaction.addToHistory.of(false),
      });
      suppressRef.current = false;
    }
  }, [value]);

  return <div className="standalone-editor" ref={container} data-testid={testId ?? 'json-editor'} />;
}
