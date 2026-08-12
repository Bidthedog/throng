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

import {
  causeMessage,
  causeKey,
  formatSubject,
  isTransportFailure,
  noticeLogRecord,
  DEFAULT_NOTIFICATION_SETTINGS,
  type FailureCause,
  type NoticeSeverity,
  type NoticeSubject,
  type NotificationSettings,
  type SeverityNotificationSettings,
} from '@throng/core';
import { useAppSettings } from '../config/config-store.js';
import { IconButton } from './icon-button.js';
import {
  pruneSilenced,
  rememberSilenced,
  shouldSuppressForCause,
  shouldSuppressSilenced,
  silencedCauseKeys,
  silencedNoticeKey,
  type SilencedNotices,
} from './notice-suppression.js';

/**
 * THE notification model (018 / US6, FR-048/048b/050; 030 / US1, FR-005/FR-012/FR-016).
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
 * ══ THE USER GOVERNS PERSISTENCE, NOT THE SEVERITY (030, #224) ══
 *
 * This model used to decide persistence from the severity alone: `severity !== 'error'` armed a
 * timer for a hardcoded five seconds, so an error waited forever and everything else vanished
 * whether or not it had been read. Both halves were wrong for the same reason — the raiser was
 * deciding how long the reader needs, and a notice that disappeared before it was read is
 * indistinguishable from one that never happened.
 *
 * So each severity now carries a MODE the user sets (`notifications.<severity>` in settings):
 *
 *   never    — nothing is rendered at all. The notice is still ACCEPTED and still written to the
 *              diagnostic log, which is the whole basis on which turning a severity off can be
 *              offered (FR-005/FR-006); silence on screen is never silence in the record.
 *   timed    — rendered, then dismissed after that severity's `timeoutMs`.
 *   dismiss  — rendered until the user says otherwise. No severity is exempt from any of the three.
 *
 * The settings are read at RAISE time (FR-016): a change applies to the next notice, and never
 * retroactively to one already on screen, whose dwell the user has already begun.
 *
 * ══ WHAT IS LOGGED, AND WHAT IS NOT ══
 *
 * Every ACCEPTED notice writes exactly one record, whatever its mode. A notice SUPPRESSED — as a
 * duplicate, or by its cause — writes none, because nothing happened: it is the same event the log
 * already carries. That symmetry is the point of the shadow map below.
 */
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
  /**
   * WHAT THIS NOTICE IS ABOUT (030 / US2, FR-019).
   *
   * "An error occurred when you tried to rename this item" is #195: the one fact the notice exists
   * to carry — which thing — is the one it withholds. So the subject is a STRUCTURED field with a
   * single formatter rather than prose at the call site, which means a call site cannot invent its
   * own spelling of `Project — Tab — Panel`, and truncation happens in one place.
   *
   * Optional HERE and required on {@link NoticeInput}. `Notice` is the stored shape — a notice read
   * back from anywhere that predates the field still renders — while a RAISE must state one or say
   * `{ kind: 'none' }`, which is what makes omission inexpressible rather than merely discouraged.
   */
  subject?: NoticeSubject;
  message: string;
  /** A list carried by the notice — e.g. the files an editor notice is about. */
  details?: readonly string[];
  /**
   * The raw error, for COPY and the log only — never rendered (029 FR-018/FR-018a).
   *
   * FR-018 demotes the raw text; FR-016 forbids it from the visible notice. `details` cannot serve
   * both, because `details` IS rendered — putting the errno there satisfied "still reachable" by
   * breaking "not the headline". This is the demotion with nowhere to leak.
   */
  copyDetail?: string;
  /** Preserved verbatim from the surface being folded in (e.g. `project-error`). */
  testId?: string;
  /**
   * The cause this notice reports, as a stable key (029 FR-019).
   *
   * Present only when the failure was CLASSIFIED. While a notice carrying this key is live, further
   * failures sharing it raise nothing — one absent folder is one problem, however many parts of the
   * workspace it breaks. Absent (an unclassified failure, or anything that is not a failure at all)
   * means the ordinary stacking rules apply and nothing is suppressed.
   */
  causeKey?: string;
  /**
   * What decides whether two failures are ONE notice (030 FR-029) — `causeKey` plus the project.
   *
   * Populated by the consolidated raise in US3; declared here because the silenced shadow already
   * has to key on it. `causeKey` alone cannot serve: it drops the project and operation dimensions,
   * so one absent folder would collapse across every project open at once.
   */
  groupKey?: string;
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

/**
 * What a call site must say to raise a notice (030 FR-019/FR-057, `contracts/notice-api.md`).
 *
 * `subject` is REQUIRED — deliberately a breaking change. Every existing call site fails to compile
 * until it states a subject or `{ kind: 'none' }`, and that compile error IS the enforcement: a
 * convention can be forgotten by the next person in a hurry, and a lint rule bolted on afterwards
 * only sees the shapes it was taught. `packages/ui/tests/unit/notice-subject-required.test.ts` runs
 * the compiler over a fixture to prove this requirement is live, because nothing in this repository
 * typechecks a test file.
 */
export type NoticeInput = Omit<Notice, 'id'> & { subject: NoticeSubject };

/**
 * The severity set is `@throng/core`'s, not this module's (030 T031).
 *
 * It was declared here, and the same four words were then needed by the settings shape, by the
 * severity→level mapping and by the log record — three consumers in two processes, and a second copy
 * drifts in exactly one direction: a severity that silently has no configured display mode.
 * Re-exported so the surfaces that already import it from here are unaffected.
 */
export type { NoticeSeverity };

interface NotifyContextValue {
  notify(notice: NoticeInput): void;
  dismiss(id: string): void;
  /** Clear every notice carrying this test id — how a migrated surface says "the error is over". */
  clear(testId: string): void;
}

const NotifyContext = createContext<NotifyContextValue | null>(null);

/**
 * The heading a notice shows above its message (030 FR-020, `contracts/notice-api.md`).
 *
 * WHAT WAS ATTEMPTED, ON WHAT. The two together are the heading; the message below states only what
 * went wrong. That split is the whole of #195's fix on screen — "An error occurred when you tried to
 * rename this item" told the user everything except the part they needed.
 *
 *   title                          → the title, unchanged: it already names its own event
 *   subject ≠ none, action         → `Couldn't {action} {subject}`
 *   subject ≠ none, no action      → the subject alone
 *   subject = none, action, error  → today's derived sentence
 *   otherwise                      → no heading, exactly as today
 *
 * `formatSubject` renders the subject and NOTHING here does: quoting, ordering, elision and the
 * 48-character bound are decided in one place (FR-021), so a heading can never disagree with a
 * banner or a log record about what a panel is called.
 *
 * The derived sentence stays behind `severity === 'error'`: "an error occurred" is a lie over a
 * warning. A subject, by contrast, is a fact at any severity — the panel-rename warning presents one
 * with no action at all.
 */
export function noticeHeading(
  n: Pick<Notice, 'title' | 'action' | 'severity' | 'subject'>,
): string | undefined {
  if (n.title) return n.title;
  const subject = n.subject ? formatSubject(n.subject) : '';
  if (subject) return n.action ? `Couldn't ${n.action} ${subject}` : subject;
  if (n.severity === 'error' && n.action) return `An error occurred when you tried to ${n.action}`;
  return undefined;
}

/**
 * The subject's OWN name — the part a cause's sentence would be restating (FR-023).
 *
 * Not `formatSubject`: that renders the qualifiers too, and a cause never speaks in
 * `Project — Tab — Panel`. What is being compared here is "is the thing this sentence is about the
 * thing the heading has already named?", and that is a leaf-name question.
 */
function subjectName(subject: NoticeSubject | undefined): string | undefined {
  if (!subject) return undefined;
  switch (subject.kind) {
    case 'none':
      return undefined;
    case 'terminal':
      return subject.flavour;
    default:
      return subject.name;
  }
}

/**
 * A notice as PLAIN TEXT, for the clipboard.
 *
 * The whole notice, in the order it is read on screen: the context line ("what you were trying to
 * do"), the failure itself, then any details. A user pasting this into a bug report should not have
 * to retype the half of it that was rendered as separate elements — and the raw failure string is
 * precisely the part they cannot retype accurately.
 */
export function noticeToText(
  n: Pick<Notice, 'title' | 'action' | 'severity' | 'subject' | 'message' | 'details' | 'copyDetail'>,
): string {
  const heading = noticeHeading(n);
  // `copyDetail` last: a bug report wants the human sentence first and the machine text under it.
  return [heading, n.message, ...(n.details ?? []), n.copyDetail].filter(Boolean).join('\n');
}

let seq = 0;

/**
 * The panels a raise names, for the shadow's `reported` set (FR-005c).
 *
 * US3 (T044) gives `NoticeInput` its `affected` list; until then every notice names none, and a
 * raise naming no panels reports nothing new by definition — so the ordinary duplicate rule applies
 * to it unchanged. Reading it through one function means the shadow needs no edit when the list
 * arrives.
 */
function panelIdsOf(_input: NoticeInput): readonly string[] {
  return [];
}

export function NotificationProvider({ children }: { children: ReactNode }): ReactElement {
  const [notices, setNotices] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /**
   * The list, held in a ref as well as in state — and the ref is the AUTHORITY.
   *
   * The duplicate and cause rules have to see every notice already accepted, including ones accepted
   * earlier in the same tick whose render has not happened yet. They used to run inside the state
   * updater for exactly that reason, reading `cur`. That is no longer possible: an accepted notice
   * now has a side effect (its log record), a state updater must be pure, and StrictMode
   * double-invokes updaters — which would file every record twice.
   *
   * So the decision is made here, synchronously, against a list this module maintains itself, and
   * `setNotices` merely mirrors it for rendering.
   */
  const live = useRef<Notice[]>([]);
  /** 030 FR-005b — silenced events, which never join the list above. See `notice-suppression.ts`. */
  const silenced = useRef<SilencedNotices>(new Map());

  /**
   * The display settings, read at RAISE time (FR-016).
   *
   * Assigned during render rather than in an effect, and kept out of `notify`'s dependencies, for
   * two reasons that pull the same way. A parent renders before its children commit, so a ref
   * written here is already current for any notice a child effect raises in that same commit — which
   * an effect on this component could not promise, since child effects run first. And `notify` stays
   * identity-stable, so a settings change does not invalidate `useErrorNotice`'s dependency list and
   * re-raise every live store error as a fresh event in the log.
   */
  const settings = useAppSettings().notifications;
  const displaySettings = useRef<NotificationSettings>(settings);
  displaySettings.current = settings;

  /** Mirror the authoritative list into state. The ref moves first; rendering follows it. */
  const publish = useCallback((next: Notice[]) => {
    live.current = next;
    setNotices(next);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const t = timers.current.get(id);
      if (t) {
        clearTimeout(t);
        timers.current.delete(id);
      }
      // `onDismiss` reaches into a STORE (it is how a migrated error strip says "the failure has been
      // acknowledged"), so it must not run inside a state updater: that is calling another component's
      // setState during this one's render, which React warns about and StrictMode double-invokes — the
      // store was told twice. It runs after the list has moved on instead.
      const going = live.current.find((n) => n.id === id);
      if (!going) return;
      publish(live.current.filter((n) => n.id !== id));
      going.onDismiss?.();
    },
    [publish],
  );

  const notify = useCallback(
    (input: NoticeInput) => {
      const behaviour: SeverityNotificationSettings =
        displaySettings.current?.[input.severity] ?? DEFAULT_NOTIFICATION_SETTINGS[input.severity];
      const now = Date.now();
      // Lazily, on the way in: the shadow's only clock is the next raise, so it owns no timer and is
      // bounded by the distinct silenced events inside one window.
      pruneSilenced(silenced.current, now);

      // The subject, rendered ONCE per raise: it takes part in the duplicate rule, in the shadow's
      // key and in the log record, and three separate `formatSubject` calls would be three chances
      // for those three to disagree about one notice.
      const subject = formatSubject(input.subject);
      const shadowKey = silencedNoticeKey({ ...input, subject });
      const panelIds = panelIdsOf(input);

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
       *
       * 030 US2 — AND WHAT IT IS ABOUT. Two files refused for the same reason produce the same
       * sentence ("A file or folder with this name already exists.") and differ only in their
       * subject, so without this clause naming subjects would have made the model SILENTLY DROP the
       * second of two real problems — reintroducing #178 through a door it did not have before.
       */
      const duplicate = live.current.some(
        (n) =>
          n.severity === input.severity &&
          n.message === input.message &&
          n.title === input.title &&
          n.action === input.action &&
          n.testId === input.testId &&
          formatSubject(n.subject ?? { kind: 'none' }) === subject,
      );
      if (duplicate) return;
      // …and the same question asked of the notices the user chose not to see (FR-005b). Without
      // this half a silenced repeat is compared against an empty list and files a record every time,
      // so a severity turned off is LOUDER in the log than the same events displayed (SC-003).
      if (shouldSuppressSilenced(silenced.current, shadowKey, panelIds, now)) return;
      /*
       * ONE CAUSE, ONE NOTICE (029 FR-019).
       *
       * The rule above collapses IDENTICAL notices — one event seen twice. This one collapses
       * DIFFERENT notices that share an underlying cause: a missing project root breaks the file
       * tree AND every terminal, and measured on master that was two notices, in two vocabularies,
       * for one absent folder.
       *
       * Bounded by the live list — which is what makes dismissal re-arm the cause (FR-019c) with no
       * timer to tune — plus the silenced shadow, so the rule means the same thing whether or not
       * the user can see it. Deliberately NOT keyed on the surface or the message text: the two
       * measured messages differ, and `notice-stacking.e2e.ts` proves two genuinely different
       * failures must still stack.
       */
      const causeKeys = [
        ...live.current.map((n) => n.causeKey ?? ''),
        ...silencedCauseKeys(silenced.current, now),
      ];
      if (shouldSuppressForCause(causeKeys, input.causeKey)) return;

      /*
       * ACCEPTED — so it is logged, whatever the user chose to see (FR-006).
       *
       * Before the rendering decision, and unconditionally: *Never display* is only offerable
       * because the event still reaches `logs/main.log`, and that promise cannot be made by a branch
       * that a mode could skip. Fire-and-forget by design — a diagnostics write that failed must
       * never become a notice about failing to log a notice.
       */
      window.throng?.notices?.log?.(
        noticeLogRecord({
          severity: input.severity,
          message: input.message,
          // FR-007 — the record names the subject too. `noticeLogRecord` formats it with NO context:
          // a log line has no heading to lean on, so it carries every part the notice had.
          subject: input.subject,
          causeKey: input.causeKey,
          // FR-034: the raw system error. `Notice.copyDetail` is the source, `NoticeLogRecord.detail`
          // is what crosses the bridge — the same string, re-derived by nobody. For a silenced
          // severity there is no toast to copy from, so this is its only route to the user.
          detail: input.copyDetail,
        }),
      );

      if (behaviour.mode === 'never') {
        // The only state a silenced notice creates: no id, never rendered, never dismissible.
        rememberSilenced(silenced.current, shadowKey, {
          expiresAt: now + behaviour.timeoutMs,
          causeKey: input.causeKey,
          panelIds,
        });
        return;
      }

      const id = `n${++seq}`;
      publish([...live.current, { ...input, id }]);
      // `dismiss` leaves the notice standing; only `timed` arms a clock, and it is the user's number.
      if (behaviour.mode === 'timed') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), behaviour.timeoutMs),
        );
      }
    },
    [dismiss, publish],
  );

  const clear = useCallback(
    (testId: string) => {
      // Do NOTHING when there is nothing to remove.
      //
      // A new array — even an identical one — is a new state value, and React re-renders the whole
      // provider subtree for it. `useErrorNotice` calls this on mount and on every render where the
      // store's error is null, which is almost always: the churn re-rendered the entire application
      // continuously and knocked DOM focus out of the file tree, so a keyboard shortcut pressed
      // straight after an action simply went nowhere.
      const next = live.current.filter((n) => n.testId !== testId);
      if (next.length === live.current.length) return;
      publish(next);
    },
    [publish],
  );

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
 * Turn a raw failure string into what the user should actually read (029).
 *
 * Exported for unit testing: every vitest project here runs `environment: 'node'`, so a rule buried
 * inside a hook cannot be exercised without a DOM.
 *
 * `raw` is a message, not an Error — by the time a store has recorded it, the errno is long gone.
 * So classification works on the text, which is exactly why the CLOSED set matters: a pattern that
 * matches nothing leaves the string untouched, and nothing that works today can break.
 */
export function speakFailure(
  raw: string,
  /**
   * The subject the NOTICE will present, when it has one (030 FR-023/FR-025).
   *
   * Two jobs, both of them about the same fact — that the reporter knows what it was acting on and
   * this string does not. It is the fallback when the raw message quotes no path at all (the case
   * that used to produce the literal "this item"), and it is what decides whether the cause's
   * sentence should stop restating a name the heading has already given.
   */
  presented?: string,
): { message: string; causeKey?: string; copyDetail?: string } {
  /*
   * The daemon is decided by the MESSAGE ALONE, never by its state.
   *
   * Consulting the state looks strictly better and is strictly worse. `daemonStopped ||` short-
   * circuits before any classification, for ANY string a surface reports — so while the daemon
   * happened to be down, a user renaming a file onto an existing name was told "throng's daemon has
   * stopped" instead of "a file with this name already exists". `FilesService` runs in main and
   * needs no daemon at all; relabelling its refusals is the wrong-words-for-the-actual-failure
   * defect this whole feature exists to remove, re-created inside the fix. FR-011b requires anything
   * matching none of the five kinds to keep today's behaviour EXACTLY.
   *
   * It also made the daemon's state a dependency of this effect, so a daemon dying while a stale
   * error sat in a store re-ran it — undoing the user's dismissal and raising a SECOND notice under
   * a different causeKey, which is precisely what FR-019 forbids.
   *
   * `isTransportFailure` is shared with UI main (`terminal-ipc.ts`), so what the renderer SAYS about
   * a dead daemon and what main DECIDES about a failed attach can never disagree.
   */
  if (isTransportFailure(raw)) {
    const cause: FailureCause = { kind: 'daemon-stopped', subject: 'throng', raw };
    return { message: causeMessage(cause), causeKey: causeKey(cause), copyDetail: raw };
  }
  const kind = kindFromMessage(raw);
  if (!kind) return { message: raw }; // FR-011b — unmatched failures are untouched
  const cause: FailureCause = { kind, subject: subjectFromMessage(raw, presented), raw };
  /*
   * FR-018 — the raw text is DEMOTED, not discarded.
   *
   * `noticeToText` composes heading + message + details + `copyDetail`, and that is what Copy
   * yields, so the raw error stays in a bug report without appearing in the notice. Dropping it
   * entirely was the first version of this, and it traded one failure of communication for another:
   * the user could read the notice but no longer report it. `details` was the second, and it put
   * the errno straight back on screen — which is why `copyDetail` exists as its own field.
   */
  return {
    // FR-023 — the heading presents the subject, so the sentence below states only what went wrong.
    // Only when the two are the SAME thing: a rename can fail because the containing folder is held,
    // and blanking a name the reader was never given would replace an ambiguity with a nothing.
    message: causeMessage(cause, { subjectPresented: cause.subject === presented }),
    causeKey: causeKey(cause),
    copyDetail: raw,
  };
}

function kindFromMessage(raw: string): FailureCause['kind'] | null {
  if (/^EBUSY\b/.test(raw)) return 'held';
  if (/^EPERM\b/.test(raw)) return 'held'; // reached only from lock-class ops; see classifyFailure
  if (/^ENOENT\b/.test(raw)) return 'path-missing';
  if (/^EACCES\b/.test(raw)) return 'permission-denied';
  if (/^ENOTEMPTY\b/.test(raw)) return 'not-empty';
  // The directory lock's own throw, which carries an errno at the source but arrives here as text.
  if (/^Cannot lock ".*": the path does not exist/.test(raw)) return 'path-missing';
  return null;
}

/**
 * The subject a raw message is about — the last path segment inside its quotes or after its comma.
 *
 * FR-017 wants prose naming the folder, and the only place that name survives in a raw errno is the
 * path. Pulling it out here is what turns "a path is in the string somewhere" into "the sentence
 * names the folder".
 */
function subjectFromMessage(raw: string, presented?: string): string {
  const quoted = /'([^']+)'|"([^"]+)"/.exec(raw);
  const path = quoted?.[1] ?? quoted?.[2];
  // 030 FR-025 — the RAISER'S subject beats the generic stand-in. The reporter knows what it was
  // acting on; this string is all that survived of it, and when no path survived at all "this item"
  // was #195 spelled out. It stays as the last resort, for a message that names nothing and a
  // caller that has nothing to name (FR-027).
  if (!path) return presented ?? 'this item';
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
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
  /**
   * WHAT THE FAILURE WAS ABOUT (030 US2 / T033a, FR-019/FR-025).
   *
   * Positioned BEFORE the optional parameters so it is genuinely required — TypeScript will not
   * accept a required parameter after an optional one, and a `subject?` here would have made this
   * hook the single place in the application where omitting a subject stayed expressible. That
   * matters more here than anywhere else: this one hook is the raiser for EVERY explorer file and
   * folder failure and every project and sub-workspace failure, which is precisely the "this item"
   * path #195 was filed about. Satisfying the compiler with `{ kind: 'none' }` here would leave the
   * feature's most important surface anonymous while every test went green.
   *
   * The stores supply it the same way they already supply {@link action} and the cause: recorded
   * with the failure at the call site that knew what it was operating on.
   */
  subject: NoticeSubject,
  clearError?: () => void,
  /** What the user was doing when it failed — see {@link Notice.action}. Stores that record the
   *  attempted operation alongside the error pass it here, so the notice says both halves. */
  action?: string | null,
  /**
   * The classification the PRODUCER already made, where one was made (029, FR-018).
   *
   * `speakFailure` below classifies from the message text, which is all a surface has when the
   * message is all it was given. But a producer that caught the actual error knows more than the
   * sentence preserves — the errno, and who is holding the file — and a sentence it has already
   * spoken can no longer be classified from its own words. So a supplied cause WINS: it is the
   * upstream fact, not a guess reconstructed from prose.
   */
  cause?: FailureCause | null,
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
  /** The subject as the notice will render it — a stable value to depend on. See the effect's deps. */
  const subjectKey = formatSubject(subject);

  useEffect(() => {
    if (error) {
      dismissedByUser.current = false;
      /*
       * 029 FR-010 / FR-011 — say what actually went wrong.
       *
       * Two substitutions, in priority order, both applied HERE because this is the one raiser the
       * explorer, the projects panel and sub-workspaces all share. Doing it in each store would be
       * three places to keep in step, and the third would be forgotten.
       *
       *   1. The daemon has stopped. EVERY dependent action fails, each with its own unrelated-
       *      looking message — on Windows a bare `ENOENT`, because a named pipe that no longer
       *      exists is a missing path. That code sends the user hunting for a file that was never
       *      involved, so the stopped daemon is named as the cause instead (FR-010).
       *   2. Otherwise, classify the raw error. Anything matching none of the five kinds keeps
       *      today's text exactly (FR-011b), which is what makes this incapable of regressing.
       */
      /*
       * 030 FR-023 — the heading names the subject, so the sentence must not name it again.
       *
       * A producer-supplied cause arrives with its sentence already spoken by main, and it is the
       * SAME sentence `causeMessage` writes here (`files-service.ts:failure` composes it from the
       * cause it returns). Re-deriving it in the subject-free form is therefore not a second
       * wording — it is the cause's own, asked a different question. The equality check keeps that
       * true: a producer that supplied a cause alongside some other message keeps its message
       * untouched, and so does one whose cause is about something the heading has not named.
       */
      const presented = subjectName(subject);
      const spoken = cause
        ? {
            message:
              presented !== undefined && cause.subject === presented && causeMessage(cause) === error
                ? causeMessage(cause, { subjectPresented: true })
                : error,
            causeKey: causeKey(cause),
            copyDetail: cause.raw,
          }
        : speakFailure(error, presented);
      notify({
        severity: 'error',
        message: spoken.message,
        action: action ?? undefined,
        subject,
        testId,
        causeKey: spoken.causeKey,
        // FR-018: the raw error rides along where Copy can reach it, below the human sentence.
        copyDetail: spoken.copyDetail,
        onDismiss: () => {
          dismissedByUser.current = true;
          clearError?.();
        },
      });
    } else if (!dismissedByUser.current) clear(testId);
    // `clearError` is a store callback and is stable; including it would re-notify on every render
    // of a store that rebuilds its handlers. `subject` is depended on THROUGH `subjectKey` for the
    // same reason: every caller builds it inline, so the object is new on every render and the
    // effect would re-run continuously — the identity churn that #144 traced to lost keyboard focus.
    // Its RENDERED form is what the notice is made of, so that is what changing it means.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, action, testId, notify, clear, cause, subjectKey]);
}
