/**
 * Shared name modal (014, FR-006/FR-007/FR-008; generalised by 069). Used by:
 *  - **Clone** — the sole creation path: opens prefilled `"<source> - Clone"` with
 *    the word "Clone" pre-selected so the user can immediately type over it;
 *  - **Rename** — replaces feature 007's in-place rename field;
 *  - **Copy an icon set** (069 FR-024, FR-025) — which passes its own `validate`.
 *
 * By default the name is validated live against feature 010's reserved built-in-name set
 * (including built-ins the user has deleted) plus the existing custom names, via
 * the pure `validateThemeName` in @throng/core. A caller naming something else passes `validate`,
 * which replaces that rule entirely. An invalid name cannot be confirmed.
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
  /** Reserved built-in names (010) — refused even for a deleted built-in. Unused when `validate` is given. */
  reserved?: string[];
  /** Every theme name currently present — a duplicate (case-insensitively) is refused. Unused when `validate` is given. */
  existing?: string[];
  /**
   * Validate the name being typed, instead of the theme rules: `ok` lets it be confirmed, otherwise
   * `message` is shown on the field and nothing can be confirmed (069 FR-025).
   */
  validate?: (name: string) => NameValidation;
  /** When renaming, the theme's own current name is excluded from the duplicate check. */
  renamingFrom?: string;
  confirmLabel: string;
  /**
   * Called with the trimmed name. A caller whose work can still be refused returns a promise of the
   * refusal's message: the prompt stays open and shows it on the field (069 FR-025).
   */
  onConfirm: (name: string) => void | Promise<string | undefined>;
  onCancel: () => void;
  testId?: string;
  /** The prefix of the field, error and button test ids (`<prefix>-input`, …). Themes keep `theme-name`. */
  idPrefix?: string;
}

/** What a caller's own `validate` answers. */
export type NameValidation = { ok: true } | { ok: false; message: string };

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
  reserved = [],
  existing = [],
  validate,
  renamingFrom,
  confirmLabel,
  onConfirm,
  onCancel,
  testId = 'theme-name-dialog',
  idPrefix = 'theme-name',
}: NameDialogProps): ReactElement {
  const [value, setValue] = useState(initialValue);
  /** A refusal returned by `onConfirm` for the name as it was submitted; editing the name clears it. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // Validate what will be SUBMITTED: `submit` sends the trimmed value, so a name that only collides once
  // trimmed (" mine") must be refused here, not after it has been confirmed.
  const trimmed = value.trim();
  const validation = useMemo((): { ok: true } | { ok: false; message: string } => {
    if (validate) return validate(trimmed);
    const v = validateThemeName(trimmed, { reserved, existing, renamingFrom });
    return v.ok ? { ok: true } : { ok: false, message: messageFor(v) ?? 'Invalid name.' };
  }, [trimmed, validate, reserved, existing, renamingFrom]);
  const error = validation.ok ? refusal : validation.message;

  const submit = (): void => {
    if (!validation.ok || busy) return;
    const pending = onConfirm(trimmed);
    if (!pending) return;
    setBusy(true);
    void pending.then(
      (message) => {
        setBusy(false);
        if (message) setRefusal(message);
      },
      () => setBusy(false),
    );
  };

  return (
    <div className="capture-overlay" data-testid={testId} role="dialog" aria-modal="true">
      <div className="capture-modal">
        <h3 className="capture-modal__title">{title}</h3>
        <input
          ref={inputRef}
          className="ctl__input"
          data-testid={`${idPrefix}-input`}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setRefusal(null);
          }}
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
          <p className="capture-modal__error" data-testid={`${idPrefix}-error`}>
            {error}
          </p>
        ) : null}
        <div className="capture-modal__buttons">
          <button
            type="button"
            className="capture-modal__btn capture-modal__btn--primary"
            data-testid={`${idPrefix}-confirm`}
            disabled={!validation.ok || busy || refusal !== null}
            onClick={submit}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="capture-modal__btn"
            data-testid={`${idPrefix}-cancel`}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
