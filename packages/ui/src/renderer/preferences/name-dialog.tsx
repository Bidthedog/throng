/**
 * Shared theme name modal (014, FR-006/FR-007/FR-008). Used by BOTH:
 *  - **Clone** — the sole creation path: opens prefilled `"<source> - Clone"` with
 *    the word "Clone" pre-selected so the user can immediately type over it;
 *  - **Rename** — replaces feature 007's in-place rename field.
 *
 * The name is validated live against feature 010's reserved built-in-name set
 * (including built-ins the user has deleted) plus the existing custom names, via
 * the pure `validateThemeName` in @throng/core. An invalid name cannot be confirmed.
 *
 * Its confirm/cancel buttons and the name field keep TEXT labels — the constitution
 * v3.12.0 dialog exception (their label is the consequence being consented to);
 * colours still derive from theme tokens.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { validateThemeName, type ThemeNameValidation } from '@throng/core';

export interface NameDialogProps {
  title: string;
  /** Prefilled value (Clone: `"<source> - Clone"`; Rename: the current name). */
  initialValue: string;
  /** Character range to pre-select on open (Clone pre-selects the trailing "Clone"). */
  preselect?: { start: number; end: number };
  /** Reserved built-in names (010) — refused even for a deleted built-in. */
  reserved: string[];
  /** Every theme name currently present — a duplicate (case-insensitively) is refused. */
  existing: string[];
  /** When renaming, the theme's own current name is excluded from the duplicate check. */
  renamingFrom?: string;
  confirmLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  testId?: string;
}

function messageFor(v: ThemeNameValidation): string | null {
  if (v.ok) return null;
  switch (v.reason) {
    case 'empty':
      return 'Enter a name.';
    case 'reserved':
      return 'That name is reserved for a built-in theme.';
    case 'duplicate':
      return 'A theme with that name already exists.';
    default:
      return 'Invalid name.';
  }
}

export function NameDialog({
  title,
  initialValue,
  preselect,
  reserved,
  existing,
  renamingFrom,
  confirmLabel,
  onConfirm,
  onCancel,
  testId = 'theme-name-dialog',
}: NameDialogProps): ReactElement {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and pre-select on open so the user can type straight over the "Clone" word.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (preselect) el.setSelectionRange(preselect.start, preselect.end);
    else el.select();
    // Intentionally run once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validation = useMemo(
    () => validateThemeName(value, { reserved, existing, renamingFrom }),
    [value, reserved, existing, renamingFrom],
  );
  const error = messageFor(validation);

  const submit = (): void => {
    if (validation.ok) onConfirm(value.trim());
  };

  return (
    <div className="capture-overlay" data-testid={testId} role="dialog" aria-modal="true">
      <div className="capture-modal">
        <h3 className="capture-modal__title">{title}</h3>
        <input
          ref={inputRef}
          className="ctl__input"
          data-testid="theme-name-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
        />
        {error ? (
          <p className="capture-modal__error" data-testid="theme-name-error">
            {error}
          </p>
        ) : null}
        <div className="capture-modal__buttons">
          <button
            type="button"
            className="capture-modal__btn capture-modal__btn--primary"
            data-testid="theme-name-confirm"
            disabled={!validation.ok}
            onClick={submit}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="capture-modal__btn"
            data-testid="theme-name-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
