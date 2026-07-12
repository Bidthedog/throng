/**
 * The preferences window's failure notice (015, FR-006a).
 *
 * A reset that could not be written MUST NOT fail silently — a row whose value simply
 * doesn't change looks like a bug, and for the global reset the message is the user's only
 * proof of feature 010's all-or-nothing rollback ("nothing was changed" is a promise the
 * atomic write actually keeps).
 *
 * The toolbar lives in the shell while the per-item affordances live inside the tabs, so the
 * reporter is shared through context rather than duplicated: one message, one dismiss, one
 * place that decides the wording.
 *
 * (The window will briefly hold two notice surfaces — this strip and feature 014's modal
 * dialog on the themes surface. Unifying them is deliberately out of scope here and tracked
 * as issue #48.)
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactElement, type ReactNode } from 'react';

/** What every reset operation returns: feature 010's `ResetOne` / `RestoreResult`. */
export interface ResetOutcome {
  ok: boolean;
}

interface ResetNoticeApi {
  notice: string | null;
  /** Announce a FAILED reset. A successful one needs no announcement (FR-004c/FR-007). */
  report: (operation: string, result: ResetOutcome | undefined) => void;
  dismiss: () => void;
}

const ResetNoticeContext = createContext<ResetNoticeApi | null>(null);

export function ResetNoticeProvider({ children }: { children: ReactNode }): ReactElement {
  const [notice, setNotice] = useState<string | null>(null);

  const report = useCallback((operation: string, result: ResetOutcome | undefined): void => {
    // `undefined` means the bridge itself is unavailable — still a failure, still not silent.
    if (!result?.ok) setNotice(`${operation} failed. Nothing was changed.`);
  }, []);

  const dismiss = useCallback(() => setNotice(null), []);
  const api = useMemo(() => ({ notice, report, dismiss }), [notice, report, dismiss]);

  return <ResetNoticeContext.Provider value={api}>{children}</ResetNoticeContext.Provider>;
}

export function useResetNotice(): ResetNoticeApi {
  const api = useContext(ResetNoticeContext);
  if (!api) throw new Error('useResetNotice must be used inside a ResetNoticeProvider');
  return api;
}
