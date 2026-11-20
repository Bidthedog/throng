/**
 * A number typed as free text (075 FR-066, 2026-11-20; 077 FR-020).
 *
 * The field takes any text while it is being typed, and checks it once typing has stopped for
 * {@link VALIDATE_IDLE_MS} or the field is left. A valid number is committed. Anything else is outlined red
 * (`aria-invalid`), with what is wrong said beside it in Preferences' words (077 FR-008): "Up to 99 copies",
 * "Not a whole number". Leaving the field or pressing Enter confirms it (077 FR-009): a value past a bound stores
 * that bound, and text that is no number stays as typed, with its message, for the reader to put right. ArrowUp and
 * ArrowDown move by the field's declared step, within its bounds. Until a field has been checked it is `pending`;
 * the form waits on every field that is pending or invalid.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { checkPrintField, type PrintFieldBounds } from '@throng/core';

/** How long typing must stop before a field is checked. */
export const VALIDATE_IDLE_MS = 500;

export type FieldState = 'valid' | 'pending' | 'invalid';

export interface NumberFieldProps {
  readonly value: number;
  /** Its bounds, step and unit (077 FR-020, `PRINT_FIELDS`). */
  readonly field: PrintFieldBounds;
  /** The field's accessible name. */
  readonly label: string;
  readonly testId: string;
  readonly onCommit: (value: number) => void;
  readonly onState: (state: FieldState) => void;
  readonly className?: string;
}

export function NumberField({ value, field, label, testId, onCommit, onState, className }: NumberFieldProps): ReactElement {
  const [draft, setDraft] = useState(String(value));
  const [message, setMessage] = useState<string | null>(null);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ onCommit, onState });
  latest.current = { onCommit, onState };

  // A value changed from outside (a preset, a stored setting) shows, unless the reader is typing over it.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  // A field taken away (Custom margins closed) holds nothing up any more.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      latest.current.onState('valid');
    },
    [],
  );

  const store = (n: number): void => {
    setDraft(String(n));
    setMessage(null);
    latest.current.onState('valid');
    if (n !== value) latest.current.onCommit(n);
  };

  /** Typing stopped (`confirm` false) or the field was left or Enter pressed (`confirm` true). */
  const check = (text: string, confirm: boolean): void => {
    clearTimeout(timer.current);
    editing.current = false;
    const result = checkPrintField(text, field);
    if (result.ok) {
      store(result.value);
      return;
    }
    if (confirm && result.clampTo !== undefined) {
      store(result.clampTo);
      return;
    }
    setMessage(result.message);
    latest.current.onState('invalid');
  };

  return (
    <>
      <input
        type="text"
        inputMode={field.integer ? 'numeric' : 'decimal'}
        className={className}
        aria-label={label}
        aria-invalid={message !== null || undefined}
        value={draft}
        onChange={(e) => {
          const text = e.target.value;
          editing.current = true;
          setDraft(text);
          setMessage(null);
          latest.current.onState('pending');
          clearTimeout(timer.current);
          timer.current = setTimeout(() => check(text, false), VALIDATE_IDLE_MS);
        }}
        onBlur={(e) => {
          if (editing.current || message !== null) check(e.target.value, true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            check(e.currentTarget.value, true);
            return;
          }
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const current = checkPrintField(e.currentTarget.value, field);
          const from = current.ok ? current.value : (current.clampTo ?? value);
          const next = from + (e.key === 'ArrowUp' ? field.step : -field.step);
          clearTimeout(timer.current);
          editing.current = false;
          store(Math.min(field.max, Math.max(field.min, next)));
        }}
        data-testid={testId}
      />
      {message !== null && (
        <span className="print-preview__field-message" role="alert" data-testid={`${testId}-message`}>
          {message}
        </span>
      )}
    </>
  );
}
