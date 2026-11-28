/**
 * The grid's number prompt: Column Width… (073 FR-006) and the counted inserts (T8, Insert Rows Above… and the rest).
 *
 * A modal over its own panel (T10, the maintainer's v1 review, 2026-11-27): a scrim covers the grid body and takes
 * every pointer press, the form sits in its middle, and Tab cycles inside the form, so the panel cannot be worked in
 * until the prompt is answered or closed. Other panels stay usable — the modality is the panel's, not the window's,
 * which is why the trap's window-wide focus guard is not armed. The number opens selected, so typing replaces it.
 * Enter or the submit button applies; Esc, from anywhere in the form, or Cancel closes.
 *
 * `problem` names why the typed text cannot be used, as Preferences' number fields name it; while it is set the field
 * is marked invalid and the submit button is disabled.
 */
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { useFocusTrap } from '../common/focus-trap.js';

export interface GridNumberPromptProps {
  testId: string;
  label: string;
  value: string;
  submitLabel: string;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
  /** `number` (Column Width…) uses the browser's own spinner and bounds; `text` lets any typed text be named. */
  type?: 'number' | 'text';
  min?: number;
  max?: number;
  problem?: string | null;
}

export function GridNumberPrompt(props: GridNumberPromptProps): ReactElement {
  const { testId, label, value, submitLabel, onChange, onSubmit, onCancel, type = 'number', min, max, problem = null } = props;
  const problemId = useId();
  const titleId = useId();
  // Not armed: its focusin guard holds the whole window, and this prompt holds only its panel. Its Tab wrap is used.
  const trap = useFocusTrap<HTMLFormElement>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (problem === null) onSubmit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    trap.onKeyDown(e);
  };
  const swallow = (e: { preventDefault(): void; stopPropagation(): void }): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className="preview-grid-prompt"
      data-testid={`${testId}-scrim`}
      onMouseDown={(e) => {
        // A press on the scrim keeps the keyboard in the form; one on the form's own controls is theirs.
        if (e.target === e.currentTarget) swallow(e);
      }}
      onContextMenu={swallow}
      onWheel={(e) => e.stopPropagation()}
    >
      <form
        ref={trap.ref}
        className="preview-grid-width"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <label id={titleId}>
          {label}
          <input
            ref={inputRef}
            type={type}
            {...(type === 'text' ? { inputMode: 'numeric' as const } : {})}
            {...(min !== undefined && type === 'number' ? { min } : {})}
            {...(max !== undefined && type === 'number' ? { max } : {})}
            value={value}
            {...(problem !== null ? { 'aria-invalid': true, 'aria-describedby': problemId } : {})}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        {problem !== null ? (
          <span id={problemId} className="preview-grid-width__problem" role="status">
            {problem}
          </span>
        ) : null}
        <div className="preview-grid-width__buttons">
          <button type="submit" disabled={problem !== null}>
            {submitLabel}
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
