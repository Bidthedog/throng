/**
 * What is wrong with a Print Preview field, said briefly over the window (maintainer, 2026-11-22: "Change these
 * validation messages to a print preview window toast error that shows briefly (2s should be fine). This does not need
 * to be a fully-fledged toast i.e. no 'copy' or low level details - just the validation error message").
 *
 * Replaces the message 077 FR-020 drew beside the field, which the settings pane had no room for. The field itself stays
 * outlined red (`aria-invalid`) until it is put right; the toast only says why, once, as the field is checked.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

/** How long a message stays up. */
export const PRINT_TOAST_MS = 2000;

const ToastContext = createContext<(message: string) => void>(() => {});

/** Say `message` over the window for {@link PRINT_TOAST_MS}; a newer message replaces the one showing. */
export function usePrintToast(): (message: string) => void {
  return useContext(ToastContext);
}

export function PrintToastHost({ children }: { children: ReactNode }): ReactElement {
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const count = useRef(0);
  const show = useCallback((text: string) => {
    clearTimeout(timer.current);
    count.current += 1;
    setShown({ text, key: count.current });
    timer.current = setTimeout(() => setShown(null), PRINT_TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {shown !== null && (
        <div key={shown.key} className="print-preview__toast" role="alert" data-testid="print-toast">
          {shown.text}
        </div>
      )}
    </ToastContext.Provider>
  );
}
