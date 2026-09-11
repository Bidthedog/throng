/**
 * The Find in Files panel (043 US3 — T060, T064d, T064f).
 *
 * Its own search input and match-mode controls, distinct from any find bar (FR-031): the find bar
 * searches ONE buffer and lives over it, this searches a project's tree and lives in a Panel. They
 * share the MATCH MODEL (`@throng/core`'s `MatchModes` — case sensitivity and whole word, and no
 * regex on either surface, FR-039/FR-040) and nothing else.
 *
 * ══ WHAT STARTS A SCAN, AND THE TRAP UNDER IT ══
 *
 * By default — FR-074, which made as-you-type the shipped default — a scan starts when typing
 * SETTLES. The alternative, `search.inFiles.trigger: 'run'`, is FR-043a's explicit run: the run
 * control or `Enter` in the input, where editing the term, the modes or the scope starts NOTHING
 * and what stays on screen is the last run's results rather than an empty list implying this term
 * found nothing. (This read "by default: an explicit run" until round five; FR-074 moved it.)
 *
 * Under as-you-type the settle is
 * a quiet period PLUS A FORCED CEILING, never a plain debounce. A pure quiet-period debounce
 * re-arms on every keystroke and therefore never fires at all under sustained churn; that is #186,
 * measured, and `ProjectFileIndexService.scheduleReconcile` pairs `quietMs` with
 * `reconcileMaxWaitMs` for exactly this reason. This is the same shape, and the ceiling is a
 * multiple of the user's own settle interval so there is still only one number to tune (FR-059).
 *
 * ══ EVERY ACTION CONTROL IS A THEMEABLE ICON ══
 *
 * Constitution: an icon from the active theme's set with a hover title naming the action, colours
 * from theme tokens, nothing hardcoded and no inline vector. The two text INPUTS are not action
 * controls — they are where the user types — and carry their own `aria-label`.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  formatGrouped,
  groupRows,
  isWithinRoot,
  markStale,
  orderGroups,
  panelZoomLevel,
  readScopeInput,
  relPathUnderRoot,
  zoomFactor,
  type FindInFilesPanelConfig,
  type Grouping,
  type Panel,
  type ResultGroup,
  type ResultRow,
} from '@throng/core';
import { useAppSettings, useKeybindings } from '../config/config-store.js';
import { useContextMenu } from '../context-menu-provider.js';
import { useConfirm } from '../confirm-dialog.js';
import { useNotify } from '../common/notification.js';
import { Icon } from '../common/icon.js';
import { IconButton } from '../common/icon-button.js';
import { RESULT_ROW_CLASS, ResultsList, resultRowHeightPx } from './results-list.js';
import { commitReplace } from './commit-replace.js';
import { findInFilesContentMenu } from './content-menu.js';
import { queryResultOpenTargets, requestFromRow, requestOpenResult } from './result-open.js';
import {
  attachFindInFilesPanel,
  ensureFindInFilesPanel,
  initialFindInFilesGrouping,
  isCommitted,
  runFindInFiles,
  cancelFindInFiles,
  setAllFindInFilesGroupsCollapsed,
  markFindInFilesScopeOutsideProject,
  setFindInFilesGrouping,
  setFindInFilesScope,
  setFindInFilesReplacement,
  setFindInFilesTerm,
  toggleFindInFilesGroup,
  toggleFindInFilesMode,
  toggleFindInFilesReplace,
  useFindInFilesPanel,
  type FindInFilesPanelState,
} from './find-in-files-store.js';
import { findInFilesConfigOf, findInFilesQueryFrom } from './panel-config.js';
import './find-in-files.css';

/**
 * The Clear an input carries while — and only while — it has something to clear (FR-080).
 *
 * ══ ONE COMPONENT FOR THREE FIELDS, ON PURPOSE ══
 *
 * FR-080 reaches the term, the replacement and the scope, and says a second vocabulary MUST NOT be
 * introduced for the same gesture. Three inline `IconButton`s would satisfy that on the day they
 * were written and stop satisfying it the first time one of them was adjusted; one component is what
 * makes "the same control" a property of the code rather than of a reviewer's memory.
 *
 * ══ ABSENT, NOT DISABLED ══
 *
 * `null` on an empty field. Constitution VI asks that a control whose action is *temporarily*
 * unavailable be drawn and disabled — and clearing an empty box is not temporarily unavailable, it
 * is never meaningful. A control that can never do anything teaches the user to distrust the ones
 * that can (016, F6). The application's three existing clear controls all resolve it the same way.
 *
 * ══ THE BOX IS `.fif-btn`'s, AND THAT IS THE POINT ══
 *
 * The three controls this copies its markup from — `settings-tab.tsx`, `keybindings-tab.tsx`,
 * `themes-tab.tsx` — all wear ONE class, `.settings-search__clear`, which hardcodes
 * `width: 20px; height: 20px`: the frozen
 * box FR-079/FR-079c removed from this very panel one round ago. So the markup is reused and the CSS
 * is NOT: `.fif-btn` is this panel's derived box, and `.fif-btn--clear` adds position and nothing
 * else. `className` is passed deliberately rather than left to `IconButton`'s `'icon-button'`
 * default — and it names classes this sheet actually styles, which `icon-section.tsx`'s
 * `.icon-colour__clear` does not, and renders as a bare unstyled button for it.
 *
 * ══ FOCUS STAYS IN THE FIELD ══
 *
 * FR-080 requires it, and it is what makes this a clear rather than a delete: the next keystroke
 * types the new term without a second click. The focus call runs before React re-renders and takes
 * this button away, so the caret is already in the input by the time the control unmounts.
 *
 * No menu item is owed for any of the three (FR-080d): emptying a focused text field is text editing
 * on that field, not a discrete command the panel offers.
 */
function ClearInput({
  testId,
  title,
  value,
  inputRef,
  onClear,
}: {
  testId: string;
  /** Names the FIELD, not just the action: three controls titled "Clear" cannot be told apart. */
  title: string;
  value: string;
  inputRef: MutableRefObject<HTMLInputElement | null>;
  onClear: () => void;
}): ReactElement | null {
  if (value === '') return null;
  return (
    <IconButton
      token="dismiss"
      className="fif-btn fif-btn--clear"
      testId={testId}
      title={title}
      onClick={() => {
        onClear();
        inputRef.current?.focus();
      }}
    />
  );
}

/**
 * How far past the first keystroke a burst may run before a scan is FORCED (FR-043b, #186).
 *
 * A multiple of the user's settle interval rather than a second preference: the thing being tuned
 * is "how long after I stop typing", and the ceiling is a property of the same intent — four
 * settles of uninterrupted typing is long enough that the user is plainly mid-word and short
 * enough that they are not left watching a list that never updates.
 */
const SETTLE_CEILING_FACTOR = 4;

/**
 * The two groupings, in the order their controls are drawn (FR-033, narrowed by FR-073).
 *
 * The icon token is NOT carried here. Each control below writes its own `<Icon token="…" />`
 * inline, as a literal, because that is the exact form `icon-tokens-exist` matches — it can only
 * check a literal, and a mistyped token renders nothing at all: an invisible control, with no
 * error anywhere. A token held in this table would read as tidier and would take that check with
 * it.
 */
const GROUPINGS: readonly { id: Grouping; title: string }[] = [
  { id: 'file', title: 'Group by file' },
  { id: 'fileAndFolder', title: 'Group by folder and file' },
];

/**
 * Every heading key in a grouped result set, headings nested under headings included.
 *
 * Collapse-all is stated as the SET of collapsed keys rather than as a flag, because the per-group
 * toggle already is, and two representations of "is this group collapsed" is one more than the
 * question has answers.
 */
function allGroupKeys(groups: readonly ResultGroup[]): string[] {
  return groups.flatMap((g) => [g.key, ...allGroupKeys(g.children)]);
}

export interface FindInFilesPanelProps {
  panel: Panel;
  /** The panel's owning project root — the only tree it may search (FR-018). */
  projectRoot: string | null;
  projectId: string | null;
  /**
   * Persist this panel's QUERY into the layout blob (FR-027a, T104).
   *
   * A callback rather than `useWorkspace()` inside this component, and that is not squeamishness
   * about a hook: `PanelBody` already holds the store, and a Find in Files panel is rendered in
   * this suite's component tests without a `WorkspaceProvider` — which `useWorkspace` throws
   * outside of. Taking the writer as a prop keeps the panel testable at the layer that can see
   * what it writes, and leaves the store where the store already is.
   *
   * Optional because a panel with nowhere to persist to is a legitimate state, not a failure.
   */
  onConfigChange?: (config: FindInFilesPanelConfig) => void;
}

export function FindInFilesPanel({
  panel,
  projectRoot,
  projectId,
  onConfigChange,
}: FindInFilesPanelProps): ReactElement {
  const prefs = useAppSettings().search.inFiles;
  const panelId = panel.id;

  /*
   * ══ PER-PANEL ZOOM (FR-062, research R26) — ONE factor, read once, spent two ways ══
   *
   * `Panel.zoom` is a persisted integer step, clamped to [−5, 5], and the three chords already
   * resolve to whichever panel is active. Only the rendering was missing, and it is missing in two
   * places that must not disagree:
   *
   *   - the TEXT, which scales through a custom property `find-in-files.css` multiplies with — the
   *     precedent `editor-panel.tsx` + `editor.css` set;
   *   - the row METRICS, because the results list is windowed on a fixed row height. Scaling the
   *     text and leaving the height alone overflows a 22 px row at level +1; scaling the height in
   *     CSS gives the browser a fractional pixel to round independently of the arithmetic, and the
   *     sizer multiplies that disagreement by the row index (see `resultRowHeightPx`).
   *
   * So the height is rounded here, once, and handed to the list as an integer — which the list then
   * publishes to the stylesheet. CSS is told the answer; only the FONT SIZE is a `calc()`, because
   * nothing measures a font size against an index.
   */
  const zoomLevel = panelZoomLevel(panel);
  const rowHeightPx = resultRowHeightPx(zoomLevel);
  const zoomStyle = {
    ['--throng-zoom-fif']: String(zoomFactor(zoomLevel)),
  } as CSSProperties;

  /*
   * The two grouping preferences, read by NAME here rather than by handing the whole section down
   * (043 T064, FR-033a/FR-033b).
   *
   * That is deliberate and it is what `settings-inertness-043.test.ts` can see: a reader must both
   * read the leaf and name `inFiles` in the same file, because `defaultGrouping` passed along
   * inside an opaque object is indistinguishable from a setting nothing reads — which is #95's
   * `explorer.openMode` exactly.
   */
  const groupingPrefs = {
    defaultGrouping: prefs.defaultGrouping,
    rememberGrouping: prefs.rememberGrouping,
  };

  /*
   * Created before the first read rather than in an effect.
   *
   * A `useEffect` would render once with no state — an empty panel with no controls — and then
   * again with it. The initialiser runs before `useSyncExternalStore` reads its snapshot in this
   * same render, so the panel's first frame is already the panel. `ensureFindInFilesPanel` is
   * idempotent, which is what makes that safe under StrictMode's double invocation.
   */
  /*
   * FR-027a/FR-027b — the QUERY this panel opens holding, read from the layout blob it was
   * restored with (T104, research R11). An opened panel simply has none of these keys, so the same
   * read answers "restored" and "brand new" without a branch.
   *
   * Read ONCE, at creation, and deliberately not tracked afterwards: the panel is the authority on
   * its own query from the moment it exists, and re-reading `panel.config` on every render would
   * let a debounced layout save race the user's next keystroke back out of the box.
   */
  const [restored] = useState(() => findInFilesQueryFrom(panel.config));

  useState(() => {
    ensureFindInFilesPanel(panelId, {
      projectId,
      projectRoot,
      grouping: initialFindInFilesGrouping(projectId, groupingPrefs),
      ...restored,
    });
    return null;
  });

  // Ownership can resolve after the panel exists (a project list still loading, a panel remounted
  // in another window). Re-stating it is not a new search.
  useEffect(() => {
    ensureFindInFilesPanel(panelId, {
      projectId,
      projectRoot,
      grouping: initialFindInFilesGrouping(projectId, groupingPrefs),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, projectId, projectRoot]);

  /*
   * FR-078 — say that THIS window is displaying the panel, and be sent whatever its run holds.
   *
   * The effect above already anticipated "a panel remounted in another window"; this is what that
   * window now does about it. A synced sub-workspace view is the same panel under the same id, and
   * until it could say so it could only subscribe to a scan by STARTING one — so it showed an empty
   * list, indistinguishable from a search that found nothing (#380, US5 scenario 6).
   *
   * Keyed on the panel id ALONE, deliberately, and not on the ownership above: main answers an
   * attach by re-sending the whole result set, and a scan has no match ceiling (Assumptions), so
   * re-attaching whenever the project re-resolves would be unbounded work for no new information.
   * Detaching is `destroyFindInFilesPanel`'s, not this effect's cleanup — see the store.
   */
  useEffect(() => {
    attachFindInFilesPanel(panelId);
  }, [panelId]);

  const state = useFindInFilesPanel(panelId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const replacementRef = useRef<HTMLInputElement | null>(null);
  /** FR-030 — the menu's Change scope row is this field's route; it has no command of its own. */
  const scopeRef = useRef<HTMLInputElement | null>(null);

  /*
   * FR-025a — the panel's own menu. Read LIVE, both of them: `openMenu` because the app hosts one
   * menu at a time, and the bindings because a rebound chord must show on the NEXT right-click
   * rather than the next restart.
   */
  const { openMenu } = useContextMenu();
  const keybindings = useKeybindings();
  /*
   * FR-057b and FR-058 — the question a commit may have to ask, and the ONE report it makes.
   *
   * Both are hooks here and arguments to `commitReplace`, so the panel owns WHERE the dialog and
   * the notice appear and the commit module owns what they say. The confirmation is main's
   * decision, not this component's: the panel never reads the warning preference and never counts
   * unopened files (research R7 — it cannot see a background tab's open documents at all).
   */
  const confirm = useConfirm();
  const { notify } = useNotify();
  /** The row the reading position is on — what "this match" and "this file" mean (FR-049). */
  const currentRow = useRef<ResultRow | null>(null);

  /*
   * The settle scheduler (FR-043b). A quiet timer AND the moment the current burst began — the
   * pair is the whole point; see SETTLE_CEILING_FACTOR.
   */
  const burst = useRef<{ timer: ReturnType<typeof setTimeout> | null; startedAt: number | null }>({
    timer: null,
    startedAt: null,
  });
  /** The query as it was last seen, so an effect can tell an edit from a re-render. */
  const seen = useRef<string | null>(null);

  const settleMs = prefs.settleMs;
  const asYouType = prefs.trigger === 'asYouType';
  const queryKey =
    state === null
      ? null
      : JSON.stringify([
          state.term,
          state.modes.caseSensitive,
          state.modes.wholeWord,
          state.scopeSubPath,
        ]);

  const scheduleScan = useCallback((): void => {
    const now = Date.now();
    const held = burst.current;
    if (held.startedAt === null) held.startedAt = now;
    if (held.timer) clearTimeout(held.timer);
    held.timer = null;
    // The ceiling. Without it a user who never pauses for `settleMs` never gets a scan at all.
    if (now - held.startedAt >= settleMs * SETTLE_CEILING_FACTOR) {
      held.startedAt = null;
      runFindInFiles(panelId);
      return;
    }
    held.timer = setTimeout(() => {
      held.timer = null;
      held.startedAt = null;
      runFindInFiles(panelId);
    }, settleMs);
  }, [panelId, settleMs]);

  /*
   * 043 T260 — the invocation counter as this effect last saw it.
   *
   * Every route into the panel — the chord, the toolbar, the tree — bumps `seedSeq` (it is how the
   * panel knows to move the caret). That makes it exactly the signal this effect was missing: a
   * query change that arrives WITH a new `seedSeq` was made by an invocation, and an invocation is an
   * explicit run that has already started its scan (FR-043a).
   */
  const seenSeed = useRef<number | null>(null);
  const invocationSeq = state?.seedSeq ?? null;
  /*
   * 043 T235 — the same distinction for a query ADOPTED from another window (FR-078b). That write
   * changes the term exactly as typing does, and read as typing it made a following window start its
   * own scan, take the query over in main, and send the parent its own older term back.
   */
  const seenAdopt = useRef<number | null>(null);
  const adoptSeq = state?.adoptSeq ?? null;

  useEffect(() => {
    if (queryKey === null) return;
    // The first pass records what the panel opened holding; opening is not an edit, and a restored
    // query must not walk the tree on its own.
    if (seen.current === null) {
      seen.current = queryKey;
      seenSeed.current = invocationSeq;
      seenAdopt.current = adoptSeq;
      return;
    }
    const adopted = seenAdopt.current !== adoptSeq;
    seenAdopt.current = adoptSeq;
    // An adopted query is handled exactly as an invocation is: the change is recorded, nothing is
    // scheduled, and a settle this window had armed is dropped — the query it would have sent is no
    // longer the one on screen, and sending it would take the query back from the window typing.
    const invoked = seenSeed.current !== invocationSeq || adopted;
    seenSeed.current = invocationSeq;
    const changed = seen.current !== queryKey;
    seen.current = queryKey;
    /*
     * ══ AN INVOCATION HAS ALREADY RUN THIS QUERY — SCHEDULING ANOTHER WOULD RE-STREAM THE LIST ══
     *
     * The toolbar resets a reused panel's scope to the whole project, and the chord seeds a term from
     * a selection. Both CHANGE the query and both start a scan at once. Read as an ordinary edit, the
     * change scheduled a second, identical scan once typing "settled" — and the list reset and
     * streamed again half a second after it had filled. The chord has done that since round two; the
     * toolbar started doing it when round five made it name a scope.
     *
     * A settle already PENDING from typing is cancelled too, not left to fire: the user typed and then
     * pressed the chord before it settled, the chord ran the query, and the timer would run it again.
     * The tree's route lands here as well, where it is harmless either way — it empties the term, and
     * an empty term starts nothing.
     */
    if (invoked) {
      if (burst.current.timer) clearTimeout(burst.current.timer);
      burst.current.timer = null;
      burst.current.startedAt = null;
      return;
    }
    if (!changed) return;
    if (asYouType) scheduleScan();
  }, [queryKey, invocationSeq, adoptSeq, asYouType, scheduleScan]);

  useEffect(
    () => () => {
      if (burst.current.timer) clearTimeout(burst.current.timer);
    },
    [],
  );

  /*
   * FR-027a — the query back into the layout blob, whenever it changes (T104).
   *
   * The baseline is what the panel was RESTORED with, so a panel that reopens and is not touched
   * writes nothing at all: `updatePanelConfig` schedules a debounced layout save, and a restore
   * that immediately re-saved would put a write on the startup path of every project holding one
   * of these panels, for no change.
   *
   * `state` changes identity on every accepted results batch, so this runs often and settles on
   * the string comparison. That is deliberate rather than tolerated — a dependency list naming the
   * five query fields would be one field out of date the moment a sixth was added, and the failure
   * would be a query that silently stopped persisting.
   */
  const persisted = useRef<string>(JSON.stringify(findInFilesConfigOf(restored)));
  useEffect(() => {
    if (state === null || onConfigChange === undefined) return;
    const config = findInFilesConfigOf(state);
    const key = JSON.stringify(config);
    if (key === persisted.current) return;
    persisted.current = key;
    onConfigChange(config);
  }, [state, onConfigChange]);

  /*
   * An invocation focuses an input with its contents selected, so a term can be typed without a
   * further click (FR-031c). Never on the first render: nobody invoked anything then.
   *
   * WHICH input is the command's decision, carried on the invocation (`focusTarget`) rather than
   * read off `replaceEnabled` here — a panel can have replace disclosed and still be invoked as a
   * find, and focusing the replacement box then would put the next keystroke in the wrong field.
   *
   * The replacement row is disclosed by the same update that sets `focusTarget`, so by the time
   * this effect runs the input it names is mounted.
   */
  const seedSeq = state?.seedSeq ?? 0;
  const focusTarget = state?.focusTarget ?? 'search';
  useEffect(() => {
    if (seedSeq === 0) return;
    const el = focusTarget === 'replacement' ? replacementRef.current : inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // `focusTarget` is deliberately NOT a dependency: it changes only as part of an invocation, and
    // listing it would re-steal the caret on any later render that happened to change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedSeq]);

  const results = state?.results ?? null;
  const version = results?.version ?? 0;
  const generation = results?.generation ?? 0;
  const grouping = state?.grouping ?? 'file';

  /*
   * A re-run ABANDONS the reading position (FR-049's three granularities all read it).
   *
   * `currentRow` holds a row object, and a row is an offset into a file's text as one scan found it.
   * The next scan re-lists the same file with the matches wherever they now are, so a position kept
   * across a generation is an offset from a search that no longer exists — and `Replace Match` would
   * send it. The list starts its own position over for the same reason; this is the panel's half.
   */
  useEffect(() => {
    currentRow.current = null;
  }, [generation]);
  const groups = useMemo<ResultGroup[]>(() => {
    if (!results) return [];
    /*
     * FR-045a — the marking is applied to the GROUPS, from the set of stale files the scan service
     * pushed, rather than being carried on the rows.
     *
     * That ordering is what makes staleness survive a regrouping: the shapes are re-derived from
     * `rows` on every switch, so a flag stored on a group object would be thrown away the moment
     * the user switched grouping. The set is the file's, and the file is what changed.
     */
    return markStale(orderGroups(groupRows(results.rows, grouping)), results.staleFiles);
    /*
     * `version`, not `rows`. The store appends a batch IN PLACE — `rows` is the same array across
     * every batch of one run, deliberately, because the immutable fold is quadratic in a match
     * count nothing bounds. `version` is what changes, and it is what a memo compares.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, grouping]);

  if (state === null || results === null) {
    // Unreachable: the initialiser above created this panel before the snapshot was read. Handled
    // rather than asserted so a future change fails visibly instead of throwing mid-render.
    return <div className="fif-panel" data-testid={`fif-panel-${panelId}`} style={zoomStyle} />;
  }

  const running = results.status === 'running';
  const projectRootHere = state.projectRoot;

  /*
   * FR-049's three granularities, as three row SELECTIONS over one operation.
   *
   * The three differ only in which matches they hand over, which is what makes them three distinct
   * deliberate actions rather than one action with a scope argument the user has to remember. The
   * write, the partition and the confirmation are identical for all three and live in main.
   */
  const commitRows = (rows: readonly ResultRow[]): void => {
    if (projectRootHere === null) return;
    void commitReplace(
      {
        panelId,
        projectRoot: projectRootHere,
        term: state.term,
        modes: state.modes,
        replacement: state.replacement,
        rows,
      },
      {
        confirm,
        notify,
        // FR-082 — the summary notice answers to ITS OWN pair of preferences, not to
        // `notifications.<severity>`. Read here because this is where the settings already are;
        // `commitReplace` is a function rather than a hook, so it is handed the values.
        display: { mode: prefs.summaryNoticeMode, timeoutMs: prefs.summaryNoticeTimeoutMs },
        invoke: window.throng?.fileSearch?.commit,
      },
    );
  };

  /**
   * The rows still awaiting a decision — every listed match that has not already been committed.
   *
   * Excluding the committed ones is not a narrowing of FR-049's "all listed matches": their text is
   * already the replacement, so re-sending them would make FR-054's re-check refuse each one and
   * report a `matchGone` the user would read as a failure. FR-050's stepping model is what makes
   * this the ordinary case rather than an edge.
   */
  const pendingRows = (within?: string): ResultRow[] =>
    results.rows.filter(
      (row) => !isCommitted(state.committed, row) && (within === undefined || row.relPath === within),
    );

  /**
   * Replace All — ONE entry point, reached from the menu row and from the toolbar control (FR-068).
   *
   * Named and shared rather than written twice, and that is the whole of FR-068's second sentence:
   * `commitReplace` is where FR-057b's confirmation is obeyed and FR-058's single notice is raised,
   * so a second `commitRows(pendingRows())` written inline on the button would be a second route
   * that could drift out of step with the first — silently, because both would look right.
   */
  const replaceAllPending = (): void => commitRows(pendingRows());

  /**
   * Whether Replace All has anything to do (FR-084, FR-084a, Constitution VI).
   *
   * ══ THE DEFECT THIS CLOSES ══
   *
   * `pendingRows()` returns an empty list once every listed match has been committed, and
   * `commitReplace` returns having asked nothing when it is handed no targets. So the control was
   * drawn live, clicked, and did nothing — a control whose action is unavailable drawn inert
   * instead of disabled, which is the Constitution VI violation FR-062a is about, on this panel.
   *
   * ══ WHY THERE IS NO SECOND CLAUSE (FR-084c) ══
   *
   * FR-084a required a term TYPED BUT NOT RUN to re-enable this too, and that clause is withdrawn
   * because it re-creates the defect above rather than adding anything. Work it through under
   * FR-043a's explicit run, the only setting where it differs from a new scan: search `foo`,
   * Replace All, every row commits, the control correctly goes dark. Type `bar` without running it.
   * The listed rows are still the `foo` rows and all of them are committed — so there is nothing to
   * send, and pressing the re-enabled control commits nothing. Had it sent anything, FR-054's
   * re-check would refuse every row against the new term and report matches gone that are on screen.
   *
   * The intent behind that clause is met anyway, and under the shipped default so is its letter:
   * FR-074 re-runs 500 ms after the last keystroke, which is a new generation, which clears
   * `committed`. Typing leaves this dark only under the non-default explicit run — and there it is
   * dark because there is genuinely nothing to replace until the search is run.
   *
   * FR-084b: this is a panel CONTROL. FR-045b's four negatives govern rows, and no row is touched.
   */
  const canReplaceAll = state.replaceEnabled && pendingRows().length > 0;

  const onTermKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    // `Enter` is an explicit run (FR-043a) and the near-universal find idiom, not a rebindable
    // chord — the run COMMAND is the rebindable route to the same thing.
    if (event.key !== 'Enter' || event.altKey || event.ctrlKey) return;
    event.preventDefault();
    runFindInFiles(panelId);
  };

  /*
   * Right-click → the panel's own menu (FR-025a, Constitution VI).
   *
   * Every item below calls the SAME store mutator the icon beside it calls — two routes to one
   * action, never two implementations. The items and their sections live in `content-menu.ts`, and
   * `ContextMenu` derives the dividers from those, so nothing here decides where a divider goes.
   *
   * `stopPropagation` because the pane and the tab strip have menus of their own: without it a
   * right-click inside the panel would open two, and the second would replace the first.
   */
  const onContextMenu = async (event: ReactMouseEvent): Promise<void> => {
    event.preventDefault();
    event.stopPropagation();
    /*
     * ══ EVERYTHING READ FROM THE EVENT IS READ BEFORE THE AWAIT ══
     *
     * This handler became asynchronous for FR-087: the Open In targets need the one-buffer answer,
     * which only main can give. The coordinates and the originating element are therefore captured
     * HERE, on the synchronous side, and nothing below touches `event` again.
     *
     * Not defensiveness about React's event pooling, which has been gone since 17. The menu must
     * open where the user clicked and be about what they clicked, and both of those are facts as of
     * the click — re-reading them after an IPC round trip would ask the question again at a moment
     * the user is no longer in.
     */
    const { clientX, clientY } = event;
    /*
     * ══ THE POSITION IS THE ROW THIS MENU WAS OPENED FROM, OR NOTHING ══
     *
     * A match row moves the reading position before this handler runs (`results-list.tsx` sets it
     * from the row's own `onContextMenu`, which then bubbles here). NOTHING ELSE does — a group
     * heading, the toolbar, the scope field, the status line and the empty space below the last row
     * all arrive here with the position exactly as some earlier click left it.
     *
     * Read unchanged, that is a write aimed at a file the user never named: right-click a match in
     * `a.ts`, dismiss, right-click `b.ts`'s heading, choose Replace in File — and `a.ts` is the file
     * that gets rewritten, with nothing on screen having said so.
     *
     * So the ORIGIN of the click decides, here, in the one place that builds the menu. Testing the
     * event's target rather than relying on which handler ran first is deliberate: handler order is
     * a property of the DOM tree, and this has to stay true when the tree changes.
     */
    const fromRow = (event.target as Element | null)?.closest?.(`.${RESULT_ROW_CLASS}`) ?? null;
    if (fromRow === null) currentRow.current = null;

    /*
     * FR-087 — the targets for the row this menu is about, or none.
     *
     * `currentRow` is re-read here rather than captured above because the clearing on the line above
     * is what makes it correct: with no originating row it is already `null`, so the query is
     * skipped and `content-menu.ts` draws the parent disabled (FR-087d). Asking for targets on a
     * heading would name a file the user did not point at, which is the same defect the clearing
     * exists to prevent for the commit rows.
     */
    const openInRow = currentRow.current;
    const openInTargets = openInRow
      ? await queryResultOpenTargets(openInRow.relPath, state.projectRoot)
      : [];

    // T233 — what the two narrow commit rows would actually send, read after the await so a commit
    // that landed while main was answering is already reflected.
    const pointedAt = currentRow.current;
    const filePending = pointedAt ? pendingRows(pointedAt.relPath) : [];
    const matchPending = pointedAt !== null && !isCommitted(state.committed, pointedAt);

    openMenu(
      clientX,
      clientY,
      findInFilesContentMenu({
        running,
        replaceEnabled: state.replaceEnabled,
        grouping: state.grouping,
        keybindings,
        actions: {
          run: () => runFindInFiles(panelId),
          cancel: () => cancelFindInFiles(panelId),
          toggleReplace: () => toggleFindInFilesReplace(panelId),
          setGrouping: (next) => setFindInFilesGrouping(panelId, next, prefs.rememberGrouping),
          focusScope: () => {
            scopeRef.current?.focus();
            scopeRef.current?.select();
          },
          setAllCollapsed: (collapsed) =>
            setAllFindInFilesGroupsCollapsed(panelId, collapsed ? allGroupKeys(groups) : []),
        },
        /*
         * FR-049 — the three granularities, wired to the same operation with three row selections.
         *
         * `Replace in File` and `Replace Match` are relative to the row the reading position is on,
         * which is the row this menu was opened from and no other (see the clearing above). With no
         * row — the menu opened over the toolbar, a heading or an empty list — the two narrower
         * granularities are absent rather than silently acting on everything, and `content-menu.ts`
         * draws an absent handler disabled.
         *
         * `target` is that same row, handed over so the LABELS can name it. A write action whose
         * target is invisible is what made the staleness above unrecoverable rather than merely
         * wrong: "Replace in File" names no file, so nothing on screen contradicted a menu aimed at
         * the wrong one.
         */
        commit: {
          /*
           * FR-084 — the menu row disables WITH the toolbar control, or the accelerator and the
           * canonical route disagree about whether the command is available. Handed over as an
           * absent handler, which `content-menu.ts` already draws disabled: there is nothing for it
           * to do, which is the same fact its other absences state.
           */
          replaceAll: canReplaceAll ? replaceAllPending : undefined,
          /*
           * 043 T233 — the two narrow granularities take FR-084's rule too: live only when they have
           * something to do, and handed over absent — drawn disabled — when they do not.
           *
           * They were wired whenever a row was pointed at. Replace in File on a fully committed file
           * sent an empty list and did nothing visible, which is the inert live control FR-084 was
           * written to remove. Replace Match was worse: it was never filtered to PENDING rows, so on
           * a committed row it re-sent the committed offset, and a replacement containing the term
           * (`foo` → `fooBar`) passed main's re-check and was written a second time — `fooBarBar`,
           * with the panel's own record of its writes no longer matching the file.
           *
           * The rows are computed ONCE here, from the same list the handlers then send, so what the
           * menu says is available and what a click commits cannot disagree.
           */
          replaceInFile: filePending.length > 0 ? () => commitRows(filePending) : undefined,
          replaceMatch: matchPending && pointedAt ? () => commitRows([pointedAt]) : undefined,
          target: pointedAt ? { relPath: pointedAt.relPath } : undefined,
        },
        /*
         * FR-087 / FR-087c — the same route the double-click takes, with a target named.
         *
         * `requestOpenResult` rather than a direct call, because the panel holds no workspace store
         * and this is already how it opens a row. The range goes with it so the match is revealed
         * wherever the file lands, including in a panel the target created a moment ago.
         */
        openIn: {
          targets: openInTargets,
          pick: (target) => {
            if (openInRow) {
              requestOpenResult({ ...requestFromRow(openInRow), projectRoot: state.projectRoot, target });
            }
          },
        },
      }),
    );
  };

  return (
    <div
      className="fif-panel"
      data-testid={`fif-panel-${panelId}`}
      role="search"
      /* Discarded deliberately: the handler is async only to ask main the one-buffer question, and
         a context-menu listener has nothing to do with the promise. */
      onContextMenu={(event) => void onContextMenu(event)}
      /* FR-062 — this panel's own zoom factor, which `find-in-files.css` multiplies the Pane Text
         size by. Only the TEXT goes through CSS: the row height is already a whole number of pixels
         by the time it reaches the list (see `rowHeightPx` above and research R26). */
      style={zoomStyle}
    >
      <div className="fif-toolbar">
        <div className="fif-controls fif-controls--field">
          <span className="fif-field__icon" aria-hidden="true">
            <Icon token="findInFiles" />
          </span>
          <div className="fif-input-wrap">
            <input
              ref={inputRef}
              className="fif-input"
              data-testid={`fif-term-${panelId}`}
              type="text"
              value={state.term}
              placeholder="Find in files"
              aria-label="Find in files"
              onChange={(e) => setFindInFilesTerm(panelId, e.target.value)}
              onKeyDown={onTermKeyDown}
            />
            {/* FR-080b — an empty term matches nothing, so `runFindInFiles` refuses it under either
                trigger and the rows from the last run simply stand over the empty box. */}
            <ClearInput
              testId={`fif-term-clear-${panelId}`}
              title="Clear search term"
              value={state.term}
              inputRef={inputRef}
              onClear={() => setFindInFilesTerm(panelId, '')}
            />
          </div>
        </div>

        {/*
          FR-046 / FR-025a — the replace DISCLOSURE, and the panel-level action FR-029d points at.
          Replace in files adds no toolbar control and no context-menu item of its own; this toggle
          is how replace is discovered, and it is what carries the every-panel-action menu item.
        */}
        <div className="fif-controls">
          <button
            type="button"
            className={`fif-btn${state.replaceEnabled ? ' fif-btn--on' : ''}`}
            data-testid={`fif-toggle-replace-${panelId}`}
            aria-pressed={state.replaceEnabled}
            aria-expanded={state.replaceEnabled}
            title={state.replaceEnabled ? 'Hide replace' : 'Show replace'}
            onClick={() => toggleFindInFilesReplace(panelId)}
          >
            <Icon token="replace" />
          </button>
        </div>

        {/* Match modes — exactly the find bar's two, from the same model (FR-039). */}
        <div className="fif-controls">
          <button
            type="button"
            className={`fif-btn${state.modes.caseSensitive ? ' fif-btn--on' : ''}`}
            data-testid={`fif-match-case-${panelId}`}
            aria-pressed={state.modes.caseSensitive}
            title="Match case"
            onClick={() => toggleFindInFilesMode(panelId, 'caseSensitive')}
          >
            <Icon token="matchCase" />
          </button>
          <button
            type="button"
            className={`fif-btn${state.modes.wholeWord ? ' fif-btn--on' : ''}`}
            data-testid={`fif-whole-word-${panelId}`}
            aria-pressed={state.modes.wholeWord}
            title="Whole word"
            onClick={() => toggleFindInFilesMode(panelId, 'wholeWord')}
          >
            <Icon token="wholeWord" />
          </button>
        </div>

        {/* Grouping — a shape over results already found; switching never re-runs (FR-033). */}
        <div className="fif-controls">
          {GROUPINGS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`fif-btn${state.grouping === option.id ? ' fif-btn--on' : ''}`}
              data-testid={`fif-grouping-${option.id}-${panelId}`}
              aria-pressed={state.grouping === option.id}
              title={option.title}
              onClick={() => setFindInFilesGrouping(panelId, option.id, prefs.rememberGrouping)}
            >
              {/* A literal token per control: a computed one renders nothing when it is wrong. */}
              {option.id === 'file' ? <Icon token="file" /> : null}
              {option.id === 'fileAndFolder' ? <Icon token="folderOpen" /> : null}
            </button>
          ))}
        </div>
      </div>

      {/*
        The replacement row (FR-046): the input the disclosure discloses, and the field FR-031c hands
        the caret to when replace in files is invoked. The preview (FR-047) and the commit (FR-049)
        that act on it live in the list and the menu, which is where they have been since US4.
      */}
      {state.replaceEnabled ? (
        <div className="fif-replace" data-testid={`fif-replace-row-${panelId}`}>
          <span className="fif-field__icon" aria-hidden="true">
            <Icon token="replaceAll" />
          </span>
          <div className="fif-input-wrap">
            <input
              ref={replacementRef}
              className="fif-input"
              data-testid={`fif-replacement-${panelId}`}
              type="text"
              value={state.replacement}
              placeholder="Replace with"
              aria-label="Replace with"
              onChange={(e) => setFindInFilesReplacement(panelId, e.target.value)}
            />
            {/* FR-046a — an empty replacement is a DELETION being previewed, not an unfinished
                edit, so clearing this field changes what the rows show and nothing else. */}
            <ClearInput
              testId={`fif-replacement-clear-${panelId}`}
              title="Clear replacement"
              value={state.replacement}
              inputRef={replacementRef}
              onClear={() => setFindInFilesReplacement(panelId, '')}
            />
          </div>
        </div>
      ) : null}

      {/*
        The scope row (FR-069, FR-068). The scope the search will use, then the control that starts
        it, then the one that rewrites everything it found.

        The run control was inside the search FIELD until this round, where it read as part of the
        input rather than as the action. It belongs beside the scope because that is what the click
        commits to: a run searches the directory named two controls to its left, and the pair being
        adjacent is what lets the user check one before pressing the other.
      */}
      <div className="fif-scope-row">
        <ScopeControl panelId={panelId} state={state} inputRef={scopeRef} />
        {running ? (
          <button
            type="button"
            className="fif-btn"
            data-testid={`fif-cancel-${panelId}`}
            title="Cancel search"
            onClick={() => cancelFindInFiles(panelId)}
          >
            <Icon token="dismiss" />
          </button>
        ) : (
          <button
            type="button"
            className="fif-btn"
            data-testid={`fif-run-${panelId}`}
            title="Run search"
            onClick={() => runFindInFiles(panelId)}
          >
            <Icon token="search" />
          </button>
        )}
        {/*
          FR-068 — an accelerator over the FR-025a menu row, never a second implementation of it.
          Disabled rather than hidden while replace is put away: it is a thing the panel can do, and
          the toggle two rows up is how the user makes it available (Constitution VI).
        */}
        <button
          type="button"
          className="fif-btn"
          data-testid={`fif-replace-all-${panelId}`}
          title="Replace All"
          // FR-084 — and the toggle two rows up is still how the user makes it available when what
          // is missing is the disclosure rather than the work.
          disabled={!canReplaceAll}
          onClick={replaceAllPending}
        >
          <Icon token="replaceAll" />
        </button>
      </div>
      <StatusLine panelId={panelId} state={state} />

      <ResultsList
        panelId={panelId}
        groups={groups}
        /* FR-062 — the panel's own zoom, as ONE rounded integer for both the maths and the sheet. */
        rowHeightPx={rowHeightPx}
        /* A new run is a new list: the list's reading position and scroll offset start over. */
        generation={results.generation}
        collapsed={state.collapsed}
        /*
         * FR-045a / SC-012 needs no `staleFiles` here. `markStale` above puts the flag on the
         * file-shaped GROUP, and every grouping that survives FR-073 gives each row such a heading —
         * so the list is handed the marked groups and no second copy of the set (043 T147).
         */
        onToggleGroup={(key) => toggleFindInFilesGroup(panelId, key)}
        /*
         * FR-037 — through the registered opener, which is where the "Open files in" preference and
         * the workspace store live. The panel deliberately holds neither: it is rendered for a
         * project it is told about, and `useWorkspace()` here would make every one of this panel's
         * component tests need a provider to assert a search term.
         */
        /* T236 — with THIS panel's root: in a sub-workspace window the window has none of its own. */
        onOpenRow={(row) =>
          requestOpenResult({ ...requestFromRow(row), projectRoot: state.projectRoot })
        }
        /* FR-047 / FR-046a — `null` is replace put away; `''` is a deletion being previewed. */
        replacement={state.replaceEnabled ? state.replacement : null}
        committed={state.committed}
        onCurrentChange={(row) => {
          currentRow.current = row;
        }}
      />
    </div>
  );
}

/**
 * Where the search will look (FR-030, FR-030a, FR-070).
 *
 * ══ IT NO LONGER SAYS WHERE THE LISTED RESULTS CAME FROM (FR-072) ══
 *
 * It used to, beside the field, because FR-030 asked for both readings and they can legitimately
 * disagree — retargeting starts nothing, so until the user runs again the rows on screen came from
 * somewhere else. FR-072 withdraws that clause by name, and the consequence is recorded rather than
 * discovered: a panel whose control reads `lib/deep` while listing results from `src` can no longer
 * say so, and that state is two clicks away. FR-030a's missing-scope marking is untouched — that is
 * a property of the CONTROL, not a report about the results.
 */
function ScopeControl({
  panelId,
  state,
  inputRef,
}: {
  panelId: string;
  state: FindInFilesPanelState;
  /** The menu's Change scope row hands the caret here — the field IS the scope command (FR-030). */
  inputRef: MutableRefObject<HTMLInputElement | null>;
}): ReactElement {
  const projectRoot = state.projectRoot;

  /**
   * FR-070 — open the OS folder dialog, and decide about what comes back HERE (research R27).
   *
   * ══ WHY THE RENDERER DECIDES, AND NOT `throng:pickFolder` ══
   *
   * The dialog cannot be fenced: `defaultPath` is where it OPENS, not a subtree it is confined to,
   * and Electron offers nothing that is. So "restricted to the project" is a validation after the
   * fact — and it belongs on this side because the channel is shared with the new-project form and
   * the preferences start-folder control, neither of which has a root to be inside. Teaching the
   * primitive about project confinement would put one feature's rule inside two other callers.
   *
   * ══ THE ROOT ITSELF IS A LEGITIMATE ANSWER, AND `relPathUnderRoot` SAYS `null` TO IT ══
   *
   * That helper's other callers are revealing a FILE, for which the root row is not a thing they
   * can mean — so it answers `null` for the root exactly as it does for a directory outside the
   * project. Here the root IS the choice FR-030 defaults to, spelled `''`. The two cases are told
   * apart by `isWithinRoot`, which is reached ONLY once the relative answer came back `null`:
   * anything inside the root that is not the root has already returned above, so a `true` here
   * means the root and nothing else. No third containment primitive is added, and neither
   * comparison is run twice.
   */
  const browse = async (): Promise<void> => {
    if (projectRoot === null) return;
    /*
     * 043 T262 — the dialog opens at the READ scope, not at the box's raw text joined onto the root.
     * FR-092b lets the box hold a full path, which the raw join turned into `D:/proj/D:/proj/src`;
     * where the platform opens a dialog at a nonsense path is not this app's decision to leave to it.
     * A box that reads as outside the project opens at the root, which is where a correct answer to
     * this dialog has to come from anyway.
     */
    const read = readScopeInput(projectRoot, state.scopeSubPath);
    const start =
      read.kind === 'scope' && read.subPath.length > 0 ? `${projectRoot}/${read.subPath}` : projectRoot;
    const chosen = await window.throng?.pickFolder?.({ defaultPath: start });
    if (!chosen) return;

    const rel = relPathUnderRoot(projectRoot, chosen);
    if (rel !== null) {
      setFindInFilesScope(panelId, rel);
      return;
    }
    if (isWithinRoot(projectRoot, chosen)) {
      setFindInFilesScope(panelId, '');
      return;
    }
    // Refused, and NOTHING is written: the box keeps whatever the user had, so a mis-click in the
    // dialog costs them a message rather than the scope they had already typed.
    markFindInFilesScopeOutsideProject(panelId);
  };

  return (
    <div
      className="fif-scope"
      data-testid={`fif-scope-control-${panelId}`}
      /* One attribute for one slot: the two conditions are alternatives, never a pair. */
      data-scope-notice={state.scopeNotice ?? undefined}
    >
      <span className="fif-field__icon" aria-hidden="true">
        <Icon token="searchScope" />
      </span>
      {/*
        FR-080c — the clear goes INSIDE the box and the chooser stays beside it.

        A clear acts on the TEXT in the box; a browse acts on the SCOPE. Putting both inside would
        claim they are the same kind of thing, and would additionally crowd the right-hand edge this
        row already shares with FR-030a's notice.
      */}
      <div className="fif-input-wrap">
        <input
          ref={inputRef}
          className="fif-input fif-input--scope"
          data-testid={`fif-scope-${panelId}`}
          type="text"
          value={state.scopeSubPath}
          placeholder="Whole project"
          aria-label="Search scope"
          aria-invalid={state.scopeNotice === null ? undefined : true}
          onChange={(e) => setFindInFilesScope(panelId, e.target.value)}
        />
        {/* FR-080b — an empty scope control IS the whole project (FR-030); there is no second
            spelling of it, so clearing returns the scope to the root and starts nothing. */}
        <ClearInput
          testId={`fif-scope-clear-${panelId}`}
          title="Clear search scope"
          value={state.scopeSubPath}
          inputRef={inputRef}
          onClear={() => setFindInFilesScope(panelId, '')}
        />
      </div>
      <button
        type="button"
        className="fif-btn"
        data-testid={`fif-scope-browse-${panelId}`}
        title="Browse for a folder in this project"
        disabled={projectRoot === null}
        onClick={() => void browse()}
      >
        <Icon token="folderOpen" />
      </button>
      {/*
        ONE span, whichever condition holds.

        The wording says what is WRONG rather than what the user may not do — a message claiming
        they cannot leave is false the moment an escape exists, and here both escapes are a few
        pixels away: type a scope, or browse for another folder.
      */}
      {state.scopeNotice === null ? null : (
        <span className="fif-scope__missing" data-testid={`fif-scope-notice-${panelId}`}>
          {state.scopeNotice === 'missing' ? 'Scope missing' : 'Folder is outside the project'}
        </span>
      )}
    </div>
  );
}

/**
 * The scan's state, said in words (FR-042, FR-024, FR-030a).
 *
 * Five states and five readings. "Not run", "searching", "found nothing", "cancelled" and "the
 * place you named is gone" are five different facts, and collapsing any two of them is how a panel
 * comes to report that a search found nothing when it never ran.
 *
 * ══ `scopeMissing` HERE MEANS THE SEARCH NEVER RAN — NOT "THE DIRECTORY HAS SINCE GONE" (T118) ══
 *
 * The fold is what keeps those apart: a `scopeMissing` arriving at a finished run's own generation
 * leaves that run's status alone, so this line goes on saying "N matches in M files" over the N
 * rows still listed, and the scope control carries the condition FR-030a names it as the surface
 * for. Only a search refused before it started reaches this branch — and it was superseded into a
 * fresh generation with every counter zeroed, which is why a skip count alongside "Scope not found"
 * would be a figure from a scan this same line says did not happen. Gated rather than merely
 * unreachable, because the gate is the assertion.
 */
function StatusLine({
  panelId,
  state,
}: {
  panelId: string;
  state: FindInFilesPanelState;
}): ReactElement {
  const { status, totalMatches, filesScanned, skipped } = state.results;
  const showCounts = status === 'running' || (status === 'complete' && totalMatches > 0);
  const label =
    status === 'notRun'
      ? 'Not run'
      : status === 'running'
        ? 'Searching…'
        : status === 'cancelled'
          ? 'Cancelled'
          : status === 'scopeMissing'
            ? 'Scope not found'
            : totalMatches === 0
              ? 'No matches'
              : '';

  return (
    <div className="fif-status" data-testid={`fif-status-${panelId}`} data-state={status} role="status">
      {label === '' ? null : <span className="fif-status__label">{label}</span>}
      {showCounts ? (
        <span className="fif-status__counts">
          {/* FR-014 — every displayed quantity, at every magnitude. */}
          <span data-testid={`fif-total-${panelId}`}>{formatGrouped(totalMatches)}</span>
          {' matches in '}
          <span data-testid={`fif-files-${panelId}`}>{formatGrouped(filesScanned)}</span>
          {' files'}
        </span>
      ) : null}
      {skipped > 0 && status !== 'scopeMissing' ? (
        <span className="fif-status__skipped">
          {/* FR-045f — one count for the whole scan, never a notice per file. */}
          <span data-testid={`fif-skipped-${panelId}`}>{formatGrouped(skipped)}</span>
          {' skipped'}
        </span>
      ) : null}
    </div>
  );
}
