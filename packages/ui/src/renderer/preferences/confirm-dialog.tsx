/**
 * Shared confirmation modal (014, FR-004/FR-005). Guards the two destructive
 * restore actions — "Restore All Themes to Default" (destroys the user's edits to
 * every built-in) and per-theme restore-to-shipped (destroys that one built-in's
 * edits). Recreating a deleted built-in is purely additive and does NOT use this.
 *
 * Its decision buttons keep TEXT labels: the constitution v3.12.0 themeable-icon
 * rule states an explicit exception for dialog decision buttons, because the label
 * *is* the consequence the user is consenting to. Their colours still derive from
 * theme tokens (via the shared modal CSS).
 */
import { type ReactElement } from 'react';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  /** Text of the affirmative button (states the consequence, e.g. "Restore All"). */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  testId = 'theme-confirm-dialog',
}: ConfirmDialogProps): ReactElement {
  return (
    <div className="capture-overlay" data-testid={testId} role="dialog" aria-modal="true">
      <div className="capture-modal">
        <h3 className="capture-modal__title">{title}</h3>
        <p className="capture-modal__hint">{message}</p>
        <div className="capture-modal__buttons">
          <button
            type="button"
            className="capture-modal__btn capture-modal__btn--primary"
            data-testid="theme-confirm-yes"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="capture-modal__btn"
            data-testid="theme-confirm-no"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
