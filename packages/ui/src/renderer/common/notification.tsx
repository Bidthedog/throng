import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { IconButton } from './icon-button.js';

/**
 * THE notification model (018 / US6, FR-048/048b/050).
 *
 * Being told something failed used to happen in six different ways: an inline strip in the
 * preferences window, four copy-pasted dismissable strips in the main window (each with its own
 * markup AND its own CSS block), a fifth on the themes surface, a non-dismissable restore notice,
 * and a modal message box for editor notices. Six idioms, one job.
 *
 * Two of those strips were hard-coded outright (`#3a1d22` on `#ff9aa6`), and the rest leaned on
 * `--danger` — a CSS variable that was READ in thirteen places and DEFINED NOWHERE, so every one of
 * them silently rendered a literal fallback. The preferences notice was always #e5534b whatever the
 * theme, and the themes error strip fell through to `--accent`, rendering a FAILURE in the SUCCESS
 * colour, directly contradicting the comment sitting above it.
 *
 * SEVERITY GOVERNS PERSISTENCE, and that is one model with one property, not two models:
 *
 *   error   — persists until dismissed. An error that silently auto-vanishes would be a worse defect
 *             than the six idioms being replaced.
 *   success — dismisses itself after five seconds.
 *   info    — same.
 *   warning — same: it reports something that HAPPENED, just not as asked.
 */

/**
 * `warning` sits with success and info, not with error, and that is the point: it auto-dismisses.
 *
 * A warning reports something that WENT AHEAD but not exactly as asked — a panel name adjusted
 * because it was already taken. There is nothing for the user to decide and nothing at risk, so
 * making them dismiss it would be nagging. An error, where something did NOT happen, still
 * persists until acknowledged.
 */
export type NoticeSeverity = 'error' | 'success' | 'info' | 'warning';

/** Long enough to read, short enough not to linger — and a STATED number, so a test can assert it. */
export const AUTO_DISMISS_MS = 5000;

export interface Notice {
  id: string;
  severity: NoticeSeverity;
  /**
   * A short heading above the message.
   *
   * The editor notice carries one ("File changed on disk"), and its suites read it — a notice that
   * says only "saving will overwrite those changes" without naming WHAT happened makes the reader do
   * the work of inferring the event from the advice.
   */
  title?: string;
  /**
   * What the user was TRYING TO DO — "delete these items", "rename this file".
   *
   * A raw failure string from a daemon or the filesystem says what went wrong and nothing about
   * what the user was doing when it did: "EPERM: operation not permitted, unlink" is an accurate
   * message and a useless one. An error notice made of one composes into "An error occurred when
   * you tried to delete these items" over the failure itself, so the two halves of the story are
   * both present. An explicit {@link title} wins — a notice that already names its event does not
   * need this one derived over the top of it.
   */
  action?: string;
  message: string;
  /** A list carried by the notice — e.g. the files an editor notice is about. */
  details?: readonly string[];
  /** Preserved verbatim from the surface being folded in (e.g. `project-error`). */
  testId?: string;
  /**
   * The message's and dismiss control's identifiers, where a folded-in surface used its own.
   *
   * The editor notice's suites drive `editor-notice-message` and `editor-notice-ok`; five specs
   * depend on them. Preserving the identifiers is what lets the ninth idiom be absorbed without a
   * five-file test migration (FR-053).
   */
  testIds?: { message?: string; dismiss?: string };
  /** Arbitrary content under the message — e.g. the editor notice's structured file list. */
  body?: ReactNode;
  /**
   * Run when the user dismisses this notice.
   *
   * The migrated error strips each render from a STORE's `error` field, and the store must be told
   * the error has been acknowledged. Without this the notice would vanish while the store still held
   * the error — and the next unrelated render would look, to anyone reading the state, as though the
   * failure were still live.
   */
  onDismiss?: () => void;
}

export type NoticeInput = Omit<Notice, 'id'>;

interface NotifyContextValue {
  notify(notice: NoticeInput): void;
  dismiss(id: string): void;
  /** Clear every notice carrying this test id — how a migrated surface says "the error is over". */
  clear(testId: string): void;
}

const NotifyContext = createContext<NotifyContextValue | null>(null);

/**
 * The heading a notice shows above its message: its own title, else the failure phrased around what
 * the user was doing. Only errors get the derived form — "an error occurred" is a lie over a success.
 */
export function noticeHeading(n: Pick<Notice, 'title' | 'action' | 'severity'>): string | undefined {
  if (n.title) return n.title;
  if (n.severity === 'error' && n.action) return `An error occurred when you tried to ${n.action}`;
  return undefined;
}

/**
 * A notice as PLAIN TEXT, for the clipboard.
 *
 * The whole notice, in the order it is read on screen: the context line ("what you were trying to
 * do"), the failure itself, then any details. A user pasting this into a bug report should not have
 * to retype the half of it that was rendered as separate elements — and the raw failure string is
 * precisely the part they cannot retype accurately.
 */
export function noticeToText(n: Pick<Notice, 'title' | 'action' | 'severity' | 'message' | 'details'>): string {
  const heading = noticeHeading(n);
  return [heading, n.message, ...(n.details ?? [])].filter(Boolean).join('\n');
}

let seq = 0;

export function NotificationProvider({ children }: { children: ReactNode }): ReactElement {
  const [notices, setNotices] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // The committed list, so `dismiss` can find the notice it is removing WITHOUT reading state inside a
  // state updater. Kept stable so `dismiss` — and therefore the context value — never changes identity.
  const live = useRef<Notice[]>([]);
  useEffect(() => {
    live.current = notices;
  }, [notices]);

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    // The updater must be PURE. `onDismiss` reaches into a STORE (it is how a migrated error strip says
    // "the failure has been acknowledged"), and calling it from inside the updater means calling another
    // component's setState during this one's render — which React warns about, and which StrictMode
    // double-invokes, so the store was told twice. Take the effect OUT of the updater and run it after.
    const going = live.current.find((n) => n.id === id);
    setNotices((cur) => cur.filter((n) => n.id !== id));
    going?.onDismiss?.();
  }, []);

  const notify = useCallback(
    (input: NoticeInput) => {
      const id = `n${++seq}`;
      setNotices((cur) => {
        /*
         * NOTICES STACK. Two failures are two things the user needs to know.
         *
         * This used to drop any live notice sharing the incoming one's test id, so a second delete
         * that failed replaced the first rather than joining it — the user was told about one of
         * their two problems, and the surface silently chose which. Test ids identify a SURFACE
         * ("the explorer reported something"), not an EVENT, so they were never the right thing to
         * collapse on.
         *
         * What must still not stack is the SAME notice raised repeatedly — a file watcher firing on
         * every change re-reporting one unchanged failure. So the comparison is on what the notice
         * SAYS. Identical content is one event seen twice; different content is two events.
         */
        const duplicate = cur.some(
          (n) =>
            n.severity === input.severity &&
            n.message === input.message &&
            n.title === input.title &&
            n.action === input.action &&
            n.testId === input.testId,
        );
        return duplicate ? cur : [...cur, { ...input, id }];
      });

      if (input.severity !== 'error') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
        );
      }
    },
    [dismiss],
  );

  const clear = useCallback((testId: string) => {
    setNotices((cur) => {
      // Return the SAME array when there is nothing to remove.
      //
      // A new array — even an identical one — is a new state value, and React re-renders the whole
      // provider subtree for it. `useErrorNotice` calls this on mount and on every render where the
      // store's error is null, which is almost always: the churn re-rendered the entire application
      // continuously and knocked DOM focus out of the file tree, so a keyboard shortcut pressed
      // straight after an action simply went nowhere.
      const next = cur.filter((n) => n.testId !== testId);
      return next.length === cur.length ? cur : next;
    });
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  const value = useMemo<NotifyContextValue>(
    () => ({ notify, dismiss, clear }),
    [notify, dismiss, clear],
  );

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <div className="notices" data-testid="notices" role="status" aria-live="polite">
        {notices.map((n) => (
          <div
            key={n.id}
            className={`notice notice--${n.severity}`}
            data-testid={n.testId ?? `notice-${n.severity}`}
            role={n.severity === 'error' ? 'alert' : undefined}
          >
            <div className="notice__body">
              {noticeHeading(n) ? <h4 className="notice__title">{noticeHeading(n)}</h4> : null}
              <p className="notice__message" data-testid={n.testIds?.message}>
                {n.message}
              </p>
              {n.body}
              {n.details?.length ? (
                <ul className="notice__details" data-testid={`${n.testId ?? 'notice'}-details`}>
                  {n.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {/* COPY. A failure message is the one thing in the application a user is most likely to
                need somewhere else — in an issue, in a message to us — and it is also the one thing
                they cannot accurately retype: a path, an errno, a daemon's own words. Selecting text
                out of a toast that may auto-dismiss is not a serious answer. */}
            <IconButton
              token="copy"
              className="notice__copy"
              testId={n.testId ? `${n.testId}-copy` : `notice-${n.severity}-copy`}
              title="Copy this message"
              onClick={() => {
                // `verbatim` — the text goes on the clipboard exactly as it reads, with no editor
                // line/rectangle semantics attached to it.
                void window.throng?.clipboard?.write({ text: noticeToText(n), mode: 'verbatim' });
              }}
            />
            {/* EVERY notice is dismissable — including the restore notice, which was a stateless
                component with no dismiss path at all, so the only way to be rid of it was to make
                the condition it reported stop being true. */}
            <IconButton
              token="dismiss"
              className="notice__dismiss"
              testId={
                n.testIds?.dismiss ??
                (n.testId ? `${n.testId}-dismiss` : `notice-${n.severity}-dismiss`)
              }
              title="Dismiss"
              onClick={() => dismiss(n.id)}
            />
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  );
}

export function useNotify(): NotifyContextValue {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify must be used within a NotificationProvider');
  return ctx;
}

/**
 * Report a STORE's error field through the notification model.
 *
 * This is the whole of what the four copy-pasted error strips did — projects, explorer,
 * sub-workspaces, terminal-exit — each with its own markup, its own dismiss button and its own CSS
 * block, all saying "this went wrong" in four slightly different ways. Now it is one hook, and the
 * next surface that needs to report a failure will not be tempted to write a fifth.
 *
 * `clearError` keeps the store in step: dismissing the notice acknowledges the failure, rather than
 * merely hiding it while the state still says it is live.
 */
export function useErrorNotice(
  error: string | null | undefined,
  testId: string,
  clearError?: () => void,
  /** What the user was doing when it failed — see {@link Notice.action}. Stores that record the
   *  attempted operation alongside the error pass it here, so the notice says both halves. */
  action?: string | null,
): void {
  const { notify, clear } = useNotify();
  /*
   * Has the USER dismissed one of this surface's notices?
   *
   * Dismissing a notice acknowledges the failure, which tells the store to clear its error field —
   * and clearing it used to run the `clear(testId)` branch below, which removes EVERY notice from
   * this surface. So dismissing the first of two stacked errors took the second one with it: the
   * user acknowledged one problem and was silently relieved of being told about the other.
   *
   * A programmatic clear (the next operation succeeded) should still tidy the surface's notices
   * away. A clear that is merely the echo of the user's own dismissal should not — those notices
   * persist until they are each dismissed, which is what "an error persists until dismissed" means.
   */
  const dismissedByUser = useRef(false);

  useEffect(() => {
    if (error) {
      dismissedByUser.current = false;
      notify({
        severity: 'error',
        message: error,
        action: action ?? undefined,
        testId,
        onDismiss: () => {
          dismissedByUser.current = true;
          clearError?.();
        },
      });
    } else if (!dismissedByUser.current) clear(testId);
    // `clearError` is a store callback and is stable; including it would re-notify on every render
    // of a store that rebuilds its handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, action, testId, notify, clear]);
}
