import { useEffect, useRef, type ReactElement } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

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
}

export function StandaloneEditor({ value, onChange, testId }: StandaloneEditorProps): ReactElement {
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
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
      suppressRef.current = false;
    }
  }, [value]);

  return <div className="standalone-editor" ref={container} data-testid={testId ?? 'json-editor'} />;
}
