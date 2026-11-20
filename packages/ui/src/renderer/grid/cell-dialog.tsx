/**
 * The cell dialog (073 FR-036a): a modal editor for one grid cell, opened for a long value or on request.
 *
 * It holds throng's own buffer-only CodeMirror editor (`StandaloneEditor`, the one the preferences JSON tabs
 * use), so line breaks are typed as in any editor and a JSON value is highlighted as JSON. It owns only the
 * text being edited: what it opened with and what saving writes (`flattenCellText`) are decided by the caller.
 *
 * Keyboard: Esc cancels and Ctrl/Cmd+Enter saves, both caught before CodeMirror sees them (its own keymap binds
 * Mod-Enter to insert a blank line); Tab stays inside the dialog (`useFocusTrap`). A click outside does nothing,
 * so a stray click cannot lose the text. Its buttons keep text labels: they are the decision being made.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { useFocusTrap } from '../common/focus-trap.js';
import { StandaloneEditor } from '../editor/standalone-editor.js';
import './cell-dialog.css';

export interface CellDialogProps {
  /** Names the cell, e.g. `B3`. */
  cellLabel: string;
  /** What the dialog opens with (a JSON value already pretty-printed). */
  initial: string;
  /** Highlight as JSON (the value parsed as a JSON object or array) or as plain text. */
  json: boolean;
  /** Save, with the text as it stands; the caller flattens it and decides whether anything changed. */
  onSave(text: string): void;
  onCancel(): void;
  /** Where the keyboard goes once the dialog has gone, saved or cancelled alike (the grid). */
  returnFocus?(): void;
}

export function CellDialog({ cellLabel, initial, json, onSave, onCancel, returnFocus }: CellDialogProps): ReactElement {
  const [text, setText] = useState(initial);
  const textRef = useRef(text);
  textRef.current = text;
  const trap = useFocusTrap<HTMLDivElement>(true);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /*
   * Focus goes back as an UNMOUNT cleanup, declared after the trap. React runs unmount cleanups in declaration order,
   * so the trap's focusin guard is gone first; focusing the grid while it was still installed pulled focus straight
   * back into the closing dialog, which then left it on the page body — the grid looked focused and no shortcut
   * reached it (reported 2026-11-19; the same order `goto-line.tsx` and `go-to-dialog.tsx` keep).
   */
  const returnTo = useRef(returnFocus);
  returnTo.current = returnFocus;
  useEffect(() => () => returnTo.current?.(), []);

  // Focus goes to the editor, caret in the text, so typing starts at once.
  useEffect(() => {
    const frame = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('.cm-content')?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const onKeyDownCapture = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      onSave(textRef.current);
    }
  };

  return (
    <div className="modal-overlay" data-testid="cell-dialog-overlay">
      <div
        className="modal cell-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cell-dialog-title"
        data-testid="cell-dialog"
        ref={(el) => {
          trap.ref.current = el;
          rootRef.current = el;
        }}
        tabIndex={-1}
        onKeyDownCapture={onKeyDownCapture}
        onKeyDown={trap.onKeyDown}
      >
        <h3 className="modal__title" id="cell-dialog-title">
          Edit cell {cellLabel}
        </h3>
        <div className="cell-dialog__editor">
          {/* FR-036f — inside `.editor-panel`, so `editor.css` themes it exactly as an editor panel: background, text,
              gutter, caret, active line and both selection colours, from the theme's editor tokens. */}
          <div className="editor-panel">
            <StandaloneEditor value={text} onChange={setText} languageId={json ? 'json' : 'plaintext'} testId="cell-dialog-editor" />
          </div>
        </div>
        <p className="cell-dialog__hint">Line breaks are saved as single spaces. Ctrl+Enter saves, Esc cancels.</p>
        <div className="modal__buttons">
          <button type="button" onClick={onCancel} data-testid="cell-dialog-cancel">
            Cancel
          </button>
          <button type="button" className="modal__confirm" onClick={() => onSave(text)} data-testid="cell-dialog-save">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
