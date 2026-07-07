import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  /** An extra, visually highlighted warning shown below the message (FR-026a) —
   *  e.g. that a destroy also removes the panel from other windows/sub-workspaces. */
  warningMessage?: string;
}

interface ConfirmContextValue {
  confirm(options: ConfirmOptions): Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * App-level confirmation dialogs (FR-042/043/044). Exposes a promise-based
 * `confirm()` so callers can `await confirm({...})` before a destructive action.
 */
export function ConfirmProvider({ children }: { children: ReactNode }): ReactElement {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = (ok: boolean): void => {
    if (pending) pending.resolve(ok);
    setPending(null);
  };

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending ? (
        <div
          className="modal-overlay"
          data-testid="confirm-overlay"
          onClick={() => settle(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            data-testid="confirm-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title ? <h3 className="modal__title">{pending.title}</h3> : null}
            <p className="modal__message" data-testid="confirm-message">
              {pending.message}
            </p>
            {pending.warningMessage ? (
              <p className="modal__warning" data-testid="confirm-warning" role="alert">
                {pending.warningMessage}
              </p>
            ) : null}
            <div className="modal__buttons">
              <button type="button" data-testid="confirm-cancel" onClick={() => settle(false)}>
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={pending.danger ? 'modal__confirm modal__confirm--danger' : 'modal__confirm'}
                data-testid="confirm-accept"
                autoFocus
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx.confirm;
}
