/**
 * 077 FR-025 — a setting that holds an unbounded list or table is edited in a modal over the Preferences window, not
 * inline.
 *
 * The maintainer (2026-11-21): "The 'Excluded Globs', 'languages', 'indentation by language', 'Allowed link
 * protocols', 'file extensions that end a spaces path' - and all other preferences that have unbounded lists in the
 * UI - should have their own modal editor that sits on top of the preferences window, rather than being inline.
 * Functionality remains the same, but the lists are cumbersome as inline editors."
 *
 * So the row shows what the list holds in one line — how many entries, and the first few — with an Edit button, and
 * the modal hosts the SAME editor the row used to draw inline (`form-controls.tsx` passes it in), so adding, removing,
 * editing and every entry's check behave exactly as they did. Only the commit moves: the editor writes to a draft,
 * Save stores the draft once, and Cancel or Escape drops it. What is wrong with an entry is said where every
 * Preferences box says it, the Preferences toast (FR-024), because the modal is rendered inside the window's tree.
 */
import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
import { formatGrouped, languageName, type FieldDescriptor } from '@throng/core';
import { IconButton } from '../common/icon-button.js';
import { useFocusTrap } from '../common/focus-trap.js';
import './list-editor.css';

/** How many entries the row names before it says "…". */
const SUMMARY_ENTRIES = 3;

/** The editor the modal hosts: the setting's own inline editor, bound to the draft. */
export type ListEditorBody = (draft: unknown, setDraft: (next: unknown) => void) => ReactElement;

export interface ListSettingControlProps {
  descriptor: FieldDescriptor;
  value: unknown;
  disabled?: boolean;
  onCommit: (value: unknown) => void;
  editor: ListEditorBody;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** What one entry is called in the row: a string as itself, a keyed row by its key, a record by its first text. */
function entryNames(descriptor: FieldDescriptor, value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (isRecord(item)) {
        const first = Object.values(item).find((v) => typeof v === 'string' && v.length > 0);
        return typeof first === 'string' ? first : '…';
      }
      return String(item);
    });
  }
  if (isRecord(value)) {
    return Object.keys(value).map((key) => (descriptor.keyKind === 'language' ? languageName(key) : key));
  }
  return [];
}

/** "3 entries: node_modules, dist, .git", "5 entries: a, b, c, …", "No entries". Exported for its tests. */
export function listSummary(descriptor: FieldDescriptor, value: unknown): string {
  const names = entryNames(descriptor, value);
  if (names.length === 0) return 'No entries';
  const shown = names.slice(0, SUMMARY_ENTRIES).join(', ');
  const more = names.length > SUMMARY_ENTRIES ? ', …' : '';
  return `${formatGrouped(names.length)} ${names.length === 1 ? 'entry' : 'entries'}: ${shown}${more}`;
}

/** The row: the summary and the Edit button; the modal while it is open. */
export function ListSettingControl({ descriptor, value, disabled = false, onCommit, editor }: ListSettingControlProps): ReactElement {
  const [open, setOpen] = useState(false);
  const editButton = useRef<HTMLSpanElement | null>(null);
  const close = (): void => {
    setOpen(false);
    // Focus goes back to the button that opened it, as it does from every dialog.
    requestAnimationFrame(() => editButton.current?.querySelector('button')?.focus());
  };
  const summary = listSummary(descriptor, value);
  return (
    <div className="list-setting" data-testid={`list-setting-${descriptor.key}`}>
      <span className="list-setting__summary" data-testid={`list-summary-${descriptor.key}`} title={summary}>
        {summary}
      </span>
      <span ref={editButton}>
        <IconButton
          token="rename"
          title={`Edit ${descriptor.label}…`}
          disabled={disabled}
          onClick={() => setOpen(true)}
          testId={`list-edit-${descriptor.key}`}
        />
      </span>
      {open ? (
        <ListEditorModal
          descriptor={descriptor}
          value={value}
          editor={editor}
          onSave={(next) => {
            if (JSON.stringify(next) !== JSON.stringify(value)) onCommit(next);
            close();
          }}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}

interface ListEditorModalProps {
  descriptor: FieldDescriptor;
  value: unknown;
  editor: ListEditorBody;
  onSave: (next: unknown) => void;
  onCancel: () => void;
}

/** The modal: the setting's editor over a draft, Save and Cancel. Escape cancels; Ctrl+Enter saves. */
export function ListEditorModal({ descriptor, value, editor, onSave, onCancel }: ListEditorModalProps): ReactElement {
  const [draft, setDraft] = useState<unknown>(value);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const trap = useFocusTrap<HTMLDivElement>(true);
  const titleId = `list-editor-title-${descriptor.key}`;

  // Focus starts on the first control: the trap takes the keyboard on open (`focus-trap.ts`).
  // A row that lets go on Enter (021) blurs to nothing; the dialog keeps the caret, so Esc and Ctrl+Enter still reach it.
  const onBlurCapture = (e: ReactFocusEvent<HTMLDivElement>): void => {
    if (e.relatedTarget !== null) return;
    const root = trap.ref.current;
    queueMicrotask(() => {
      if (root?.isConnected && (document.activeElement === null || document.activeElement === document.body)) root.focus();
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    trap.onKeyDown(e);
  };

  /*
   * Escape cancels and Ctrl+Enter saves wherever the caret is while the modal is open — on the document, not the
   * dialog, because removing a row takes its focused button out of the page and leaves the caret on <body>, where
   * the dialog's own handler never hears a key. An Escape the editor used for itself is prevented and left alone.
   */
  const latest = useRef({ onCancel, onSave });
  latest.current = { onCancel, onSave };
  useEffect(() => {
    const onDocumentKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onCancel();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onSave(draftRef.current);
      }
    };
    document.addEventListener('keydown', onDocumentKey);
    return () => document.removeEventListener('keydown', onDocumentKey);
  }, []);

  return (
    <div className="modal-overlay" data-testid={`list-editor-overlay-${descriptor.key}`}>
      <div
        className="modal list-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={`list-editor-${descriptor.key}`}
        ref={trap.ref}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onBlurCapture={onBlurCapture}
      >
        <h3 className="modal__title" id={titleId}>
          {descriptor.label}
        </h3>
        <p className="list-editor__description">{descriptor.description}</p>
        <div className="list-editor__body">{editor(draft, setDraft)}</div>
        <p className="list-editor__hint">Ctrl+Enter saves, Esc cancels.</p>
        <div className="modal__buttons">
          <button type="button" onClick={onCancel} data-testid={`list-editor-cancel-${descriptor.key}`}>
            Cancel
          </button>
          <button
            type="button"
            className="modal__confirm"
            onClick={() => onSave(draftRef.current)}
            data-testid={`list-editor-save-${descriptor.key}`}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
