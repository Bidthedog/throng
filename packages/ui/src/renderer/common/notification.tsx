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
  affectedDetails,
  causeMessage,
  causeKey,
  formatSubject,
  groupAffected,
  isTransportFailure,
  joinedPanels,
  mergeAffected,
  noticeLogRecord,
  DEFAULT_NOTIFICATION_SETTINGS,
  type AffectedPanel,
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
   * The panels this cause has defeated so far (030 FR-029/FR-030).
   *
   * The list is the whole of what consolidation BUYS. Collapsing a storm of toasts into one is only
   * an improvement if the one that survives says what the storm did — otherwise the user has traded
   * twelve notices they could count for one that hides eleven of them.
   *
   * It GROWS: a panel in a tab that has never been rendered has not failed yet, because nothing has
   * tried. Visiting that tab discovers more casualties of the same cause, and they join this list
   * rather than starting a second notice about the same absent folder (FR-037).
   *
   * Ordering, de-duplication and the rendering of every name live in `@throng/core`'s
   * `notice/affected.ts` — pure, and therefore provable without a browser.
   */
  affected?: readonly AffectedPanel[];
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

/**
 * The affected-panel row, re-exported so a raise site has one import for the notice model.
 *
 * It is DECLARED in `@throng/core` rather than here, which `data-model.md` did not anticipate: the
 * ordering, de-duplication and per-row formatting rules are pure decisions, and this repository has
 * no jsdom harness — a type declared in the renderer could not have had the unit test T036 asks for.
 */
export type { AffectedPanel };

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
 * A raise naming no panels reports nothing new by definition, so the ordinary duplicate rule applies
 * to it unchanged — which is every notice in the application except the consolidated one.
 */
function panelIdsOf(input: NoticeInput): readonly string[] {
  return input.affected?.map((p) => p.panelId) ?? [];
}

/** Shared empty list, so `mergeAffected`'s "nothing joined" identity check has something to match. */
const NO_PANELS: readonly AffectedPanel[] = [];

/**
 * The project a subject names, for the list's context (FR-031b).
 *
 * The heading already states it, so the rows must not — and rather than carry a second field saying
 * what the subject already says, the context is READ OFF the subject. A notice about anything but a
 * project or something inside one has no project to elide, which is the correct answer and not a
 * missing case.
 */
function projectOf(subject: NoticeSubject | undefined): string | undefined {
  if (!subject) return undefined;
  switch (subject.kind) {
    case 'project':
      return subject.name;
    case 'tab':
    case 'panel':
    case 'terminal':
      return subject.project;
    default:
      return undefined;
  }
}

/**
 * What a GROWTH record says (FR-006a).
 *
 * The count alone would not do: "now 4" leaves a reader unable to say which panel the fourth was,
 * and for a silenced severity the log is the only place that question can be answered at all. The
 * panels are named in the workspace's own terms, tab included, because a log line has no group
 * heading above it to lean on.
 */
function growthMessage(
  message: string,
  joined: readonly AffectedPanel[],
  project: string | undefined,
): string {
  const names = affectedNames(joined, project);
  return names.length === 0 ? message : `${message} Also affecting: ${names.join(', ')}.`;
}

/** The panels, named `Tab — Panel`, through the one formatter. Used by the log and by the reader. */
function affectedNames(
  affected: readonly AffectedPanel[],
  project: string | undefined,
): readonly string[] {
  return groupAffected(affected, { project }).flatMap((group) =>
    group.rows.map((row) => [group.label, row.label].filter(Boolean).join(' — ')),
  );
}

/**
 * How long a notice stays inside the polite live region before it opts out (FR-032a).
 *
 * A notice that GROWS would otherwise be re-read in full on every growth — a forty-row list read
 * again because one row joined, every time the user changes tab. So the body announces once and then
 * goes quiet, and the delta region takes over. The delay only has to outlast the announcement being
 * queued, not spoken: a screen reader that has taken the text keeps reading it after `aria-live`
 * changes.
 */
const ANNOUNCE_MS = 1000;

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

  /**
   * WHAT JUST JOINED — the only thing a growing notice announces (030 FR-032a).
   *
   * A consolidated notice sits inside the polite region below, so it is read when it arrives. It
   * then opts OUT (`announced`), because a live region re-reads its changed subtree: a forty-row
   * list gaining one row would be read again in full, every time the user changes tab, for as long
   * as the notice stands. That is worse than silence. This region carries the delta instead.
   */
  const [growth, setGrowth] = useState('');
  /** Notice ids that have had their one announcement and are now `aria-live="off"`. */
  const [announced, setAnnounced] = useState<readonly string[]>([]);

  /** Mirror the authoritative list into state. The ref moves first; rendering follows it. */
  const publish = useCallback((next: Notice[]) => {
    live.current = next;
    setNotices(next);
  }, []);

  const announceGrowth = useCallback(
    (joined: readonly AffectedPanel[], project: string | undefined) => {
      const names = affectedNames(joined, project);
      if (names.length === 0) return;
      // Led by the COUNT, because that is the fact a listener needs first and the names are the
      // detail. A region that read the names alone would sound like a fresh failure.
      setGrowth(
        `${names.length === 1 ? '1 more panel' : `${names.length} more panels`}: ${names.join(', ')}`,
      );
    },
    [],
  );

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
      const project = projectOf(input.subject);

      /**
       * File one record for this raise (FR-006/FR-034/FR-048a).
       *
       * `affected` is passed rather than read from `input` because a GROWTH record names only the
       * panels that joined, while its count is the whole list — the two questions a reader asks of a
       * growing notice are "what is new?" and "how big is it now?", and one field cannot answer both.
       */
      const fileRecord = (of: {
        message: string;
        details: readonly AffectedPanel[];
        count?: number;
      }): void => {
        window.throng?.notices?.log?.(
          noticeLogRecord({
            severity: input.severity,
            message: of.message,
            // FR-007 — the record names the subject too. `noticeLogRecord` formats it with NO
            // context: a log line has no heading to lean on, so it carries every part the notice had.
            subject: input.subject,
            causeKey: input.causeKey,
            // FR-034: the raw system error. `Notice.copyDetail` is the source, `NoticeLogRecord.detail`
            // is what crosses the bridge — the same string, re-derived by nobody. For a silenced
            // severity there is no toast to copy from, so this is its only route to the user.
            detail: input.copyDetail,
            ...(of.count === undefined ? {} : { affectedCount: of.count }),
            ...(of.details.length > 0
              ? { affectedDetails: affectedDetails(of.details, { project }) }
              : {}),
          }),
        );
      };

      /*
       * ══ ONE CAUSE, ONE NOTICE — AND IT GROWS (030 FR-029/FR-037) ══
       *
       * Checked FIRST, ahead of every suppression rule, because a consolidated notice's message is
       * about the CAUSE and not about any one panel: two casualties of one absent folder produce
       * character-identical text and differ only in their `affected` list. The duplicate rule would
       * therefore drop the second before this had a chance to merge it, and the panel would be lost
       * from the very list that exists to name it.
       *
       * A merge that adds nothing is a repeat, and writes no record — the same rule the duplicate
       * check applies, asked of the list instead of the text.
       */
      if (input.groupKey) {
        const target = live.current.find((n) => n.groupKey === input.groupKey);
        if (target) {
          const existing = target.affected ?? NO_PANELS;
          const incoming = input.affected ?? NO_PANELS;
          const merged = mergeAffected(existing, incoming);
          if (merged === existing) return; // nothing new: the same event, seen again
          const joined = joinedPanels(existing, incoming);
          // A MERGE IS AN EVENT TOO (FR-006a). Without this, a user who silenced the severity would
          // have the first batch of casualties in the log and every later one nowhere.
          fileRecord({
            message: growthMessage(input.message, joined, project),
            details: joined,
            count: merged.length,
          });
          publish(
            live.current.map((n) =>
              n.id === target.id
                ? {
                    ...n,
                    affected: merged,
                    // A cause discovered by a later casualty is still this notice's cause, and it is
                    // what suppresses the surfaces that would otherwise report the same thing again.
                    causeKey: n.causeKey ?? input.causeKey,
                  }
                : n,
            ),
          );
          announceGrowth(joined, project);
          return;
        }
      }

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
      /*
       * …EXCEPT that a notice carrying an `affected` list is never the one suppressed (030 FR-029).
       *
       * 029's rule assumes the two notices sharing a cause are interchangeable — one absent folder,
       * so either sentence will do. A consolidated notice is not interchangeable: it says which
       * PANELS the folder took with it, which the surface-level notice cannot know. Suppressing it
       * because a file tree got there first would throw away the only part the user cannot work out
       * for themselves, and which of the two arrives first is a race.
       *
       * The other direction still holds, below and unchanged: once the consolidated notice is up,
       * the surface-level ones are suppressed by it.
       */
      if (!input.affected?.length && shouldSuppressForCause(causeKeys, input.causeKey)) return;

      /*
       * ACCEPTED — so it is logged, whatever the user chose to see (FR-006).
       *
       * Before the rendering decision, and unconditionally: *Never display* is only offerable
       * because the event still reaches `logs/main.log`, and that promise cannot be made by a branch
       * that a mode could skip. Fire-and-forget by design — a diagnostics write that failed must
       * never become a notice about failing to log a notice.
       */
      fileRecord({
        message: input.message,
        details: input.affected ?? NO_PANELS,
        ...(input.affected?.length ? { count: input.affected.length } : {}),
      });

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
      /*
       * A CONSOLIDATED NOTICE SUPERSEDES THE SURFACE-LEVEL ONE it shares a cause with.
       *
       * The exemption above lets it through past 029's rule; this is the other half, and without it
       * the pair would be two notices whenever the file tree happened to report first — the exact
       * storm FR-029 exists to end, reduced from twelve to two rather than to one.
       *
       * `onDismiss` is deliberately NOT run. It is how a migrated error strip learns the user has
       * ACKNOWLEDGED a failure, and nobody has: the failure is still on screen, in a notice that says
       * more about it. Clearing the store here would tell the explorer its error was over.
       */
      const superseded = input.affected?.length
        ? live.current.filter((n) => !(n.causeKey && n.causeKey === input.causeKey && !n.affected))
        : live.current;
      publish([...superseded, { ...input, id }]);
      // `dismiss` leaves the notice standing; only `timed` arms a clock, and it is the user's number.
      if (behaviour.mode === 'timed') {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), behaviour.timeoutMs),
        );
      }
    },
    [announceGrowth, dismiss, publish],
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

  /**
   * Let each notice have its one announcement, then take it out of the live region (FR-032a).
   *
   * Scheduled rather than immediate: flipping `aria-live` in the same commit that mounts the notice
   * would mean it was never in a live region at all, and the notice would arrive silently. The
   * delay only has to outlast the announcement being QUEUED — a screen reader that has taken the
   * text finishes reading it whatever the attribute says afterwards.
   */
  useEffect(() => {
    const fresh = notices.filter((n) => !announced.includes(n.id)).map((n) => n.id);
    if (fresh.length === 0) return;
    const timer = setTimeout(() => {
      // Filtered against the notices still live: a notice dismissed inside the window would
      // otherwise leave its id in this list for the lifetime of the session.
      setAnnounced((prev) => [...prev, ...fresh].filter((id) => live.current.some((n) => n.id === id)));
    }, ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [notices, announced]);

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
            <div
              className="notice__body"
              data-testid="notice-body"
              /* Its one announcement, then out of the region — see the effect above and the delta
                 region at the foot of this tree (FR-032a). `undefined` inherits the container's
                 `polite`; `off` overrides it for this subtree, which is what stops a growing list
                 from being re-read in full. */
              aria-live={announced.includes(n.id) ? 'off' : undefined}
            >
              {noticeHeading(n) ? <h4 className="notice__title">{noticeHeading(n)}</h4> : null}
              <p className="notice__message" data-testid={n.testIds?.message}>
                {n.message}
              </p>
              {n.body}
              {n.affected?.length ? (
                <AffectedList affected={n.affected} project={projectOf(n.subject)} />
              ) : null}
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
      {/* THE DELTA, and nothing else (FR-032a). Visually hidden rather than `display: none`, which
          would take it out of the accessibility tree along with the pixels. */}
      <div
        className="notice-growth-live"
        data-testid="notice-growth-live"
        role="status"
        aria-live="polite"
      >
        {growth}
      </div>
    </NotifyContext.Provider>
  );
}

/**
 * The panels one cause defeated, grouped by tab (030 FR-030/FR-031/FR-032).
 *
 * Everything about WHAT this shows was decided in `@throng/core` — order, de-duplication, and every
 * rendered name through `formatSubject`. What is left here is elements and a height bound, and that
 * division is deliberate: a row that assembled its own label would bypass the 48-character
 * truncation and let one long panel name break the bound this component exists to keep.
 *
 * Rows are READ, not operated (FR-032b). None is a link, a button or a tab stop — clicking a row to
 * "go to that panel" is a plausible feature and not this one, and offering the affordance without
 * the behaviour is worse than not offering it. The LIST is focusable, because a bounded scroll
 * region whose lower rows can only be reached with a wheel is unreadable by keyboard.
 */
function AffectedList({
  affected,
  project,
}: {
  affected: readonly AffectedPanel[];
  project?: string;
}): ReactElement {
  const groups = useMemo(() => groupAffected(affected, { project }), [affected, project]);
  return (
    <div
      className="notice__affected"
      data-testid="notice-affected"
      /* Focusable so it can be scrolled from the KEYBOARD — which is the only way, because the card
         takes no pointer events (see `.notice__affected` in theme.css: a notice must never cover the
         controls that would fix what it reports). NOT a focus trap: Tab leaves, because nothing
         inside it takes focus of its own. */
      tabIndex={0}
    >
      {groups.map((group) => (
        <div className="notice__affected-group" key={group.tabId}>
          {group.label ? (
            <p className="notice__affected-tab" data-testid="notice-affected-tab">
              {group.label}
            </p>
          ) : null}
          <ul className="notice__affected-rows">
            {group.rows.map((row) => (
              <li
                className="notice__affected-row"
                data-testid="notice-affected-row"
                /* The panel this row speaks for. Not rendered, and not an affordance — it is how a
                   test can ask "does every listed panel still show its own failure?" (FR-038)
                   without reconstructing the layout from the outside. */
                data-panel-id={row.panelId}
                key={row.panelId}
              >
                {row.label}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
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
