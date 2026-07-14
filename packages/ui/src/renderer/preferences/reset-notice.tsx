/**
 * The preferences window's failure reporter (015, FR-006a).
 *
 * A reset that could not be written MUST NOT fail silently — a row whose value simply doesn't change
 * looks like a bug, and for the global reset the message is the user's only proof of feature 010's
 * all-or-nothing rollback ("nothing was changed" is a promise the atomic write actually keeps).
 *
 * 018 / FR-051 — THIS IS NOW A THIN ADAPTER OVER THE SHARED NOTIFICATION MODEL.
 *
 * It used to own an inline strip of its own, and its own docblock said why that was temporary:
 *
 *     "The window will briefly hold two notice surfaces — this strip and feature 014's modal dialog
 *      on the themes surface. Unifying them is deliberately out of scope here and tracked as #48."
 *
 * This is #48. The strip is gone; the message goes through the one notification model, which this
 * window can finally reach because the provider is mounted here (FR-054). The `prefs-notice`
 * identifiers are preserved, so the reset suite did not have to be rewritten.
 *
 * The strip's colour, incidentally, came from `--danger` — a CSS variable READ in thirteen places
 * and DEFINED NOWHERE — so it rendered a hard-coded #e5534b whatever the theme was. It is themed now.
 */
import { createContext, useCallback, useContext, useMemo, type ReactElement, type ReactNode } from 'react';

import { useNotify } from '../common/notification.js';

/** What every reset operation returns: feature 010's `ResetOne` / `RestoreResult`. */
export interface ResetOutcome {
  ok: boolean;
}

interface ResetNoticeApi {
  /** Announce a FAILED reset. A successful one needs no announcement (FR-004c/FR-007). */
  report: (operation: string, result: ResetOutcome | undefined) => void;
}

const ResetNoticeContext = createContext<ResetNoticeApi | null>(null);

export function ResetNoticeProvider({ children }: { children: ReactNode }): ReactElement {
  const { notify } = useNotify();

  const report = useCallback(
    (operation: string, result: ResetOutcome | undefined): void => {
      // `undefined` means the bridge itself is unavailable — still a failure, still not silent.
      if (!result?.ok) {
        notify({
          severity: 'error', // an error PERSISTS until dismissed — it must not auto-vanish
          message: `${operation} failed. Nothing was changed.`,
          testId: 'prefs-notice',
        });
      }
    },
    [notify],
  );

  const api = useMemo(() => ({ report }), [report]);
  return <ResetNoticeContext.Provider value={api}>{children}</ResetNoticeContext.Provider>;
}

export function useResetNotice(): ResetNoticeApi {
  const api = useContext(ResetNoticeContext);
  if (!api) throw new Error('useResetNotice must be used inside a ResetNoticeProvider');
  return api;
}
