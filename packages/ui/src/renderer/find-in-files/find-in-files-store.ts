/**
 * The Find in Files panel's state: the fold a streamed batch is applied through (043 T053c), and
 * the per-panel query the panel itself drives (043 T058 — the term, the match modes, the scope,
 * the grouping and which groups the user has collapsed).
 *
 * A reactive module store in the style of `search/search-store.ts`, and per PANEL for the same
 * reason that one is: a Find in Files panel's results, term and grouping belong to it and to
 * nothing else, so three panels hold three independent searches and returning to one shows exactly
 * what was left there (FR-019, FR-023).
 *
 * ══ TWO RULES, AND BOTH ARE ABOUT COST PER TURN ══
 *
 * 1. **A superseded generation is dropped before a row is looked at.** The renderer discards any
 *    update from a run it has already replaced (research R4). This is why supersession needs no
 *    cancel handshake: an in-flight batch from the abandoned walk is not raced against, it is
 *    ignored. A NEWER generation replaces the list outright rather than appending to it, so the
 *    abandoned run leaves nothing behind.
 *
 * 2. **A batch is APPENDED IN PLACE, not folded into a fresh array.** `rows` is the same array
 *    across every batch of one run, and `version` is what changes so a consumer still re-renders.
 *
 * The second rule looks like a React smell and is a deliberate answer to one. The obvious immutable
 * fold, `[...state.rows, ...batch]`, costs the ACCUMULATED total on every batch, which is quadratic
 * in the number of matches — and the spec's Assumptions decline a match ceiling, so nothing bounds
 * that number. At SC-004's 5,000 files the twentieth batch would cost twenty times the first for no
 * information gained, which is exactly the renderer stall FR-041 and SC-004 forbid. Appending in
 * place makes the n-th batch cost what the first did.
 *
 * The trade is that an earlier state object's `rows` grows too. That is safe HERE and would not be
 * in general: the array is append-only within a generation, a new generation allocates a fresh one,
 * and `version` — never array identity — is what a memo or an effect compares.
 */
import { useSyncExternalStore } from 'react';
import {
  NO_MODES,
  readScopeInput,
  type Grouping,
  type MatchModes,
  type ResultRow,
  type ScanStatus,
  type SnippetView,
} from '@throng/core';
import { forgetFindInFilesPanel } from './last-active-find-in-files.js';

/**
 * The `throng:fileSearch:update` payload, as the renderer sees it.
 *
 * Declared structurally rather than imported: this is a renderer module and the producer is
 * `src/main/file-search-service.ts`, which the renderer may not import. Same arrangement as the
 * file index's `onUpdate` shape, and `packages/ui/tests/contract/file-search-ipc.contract.test.ts`
 * is what keeps the two ends from drifting.
 */
export interface FileSearchUpdateEvent {
  panelId: string;
  generation: number;
  status: ScanStatus;
  /**
   * FR-078a — this is the run's WHOLE state, not a batch: `rows` REPLACES what is held.
   *
   * Sent to one window, once, when it attaches to a run that already exists (FR-078). It is the one
   * message the batch bound does not apply to, and the only reason the flag is needed is that a
   * window can attach TWICE — a remount, a sub-workspace closed and synced again — at which point an
   * appended re-statement would show every row a second time under a total that disagreed with it.
   */
  snapshot?: true;
  rows?: readonly ResultRow[];
  totalMatches?: number;
  filesScanned?: number;
  skipped?: number;
  /**
   * FR-045a — the result files that have changed since the scan, root-relative POSIX.
   *
   * CUMULATIVE for the run and may arrive at any time, including after `complete`: a file can
   * change long after the walk finished, which is the whole point. So this is the WHOLE set each
   * time, not a delta — a service that pushed only the newly-changed file would leave the renderer
   * accumulating a set neither end could re-state.
   */
  staleFiles?: readonly string[];
  /**
   * FR-078b — the query these rows came from, present ONLY when this window is not driving.
   *
   * Main sends it to every viewer except the one that last started or retargeted the run, so its
   * mere PRESENCE is the instruction: a window that receives it is following, and must show the
   * query it is being given rather than one of its own. The window being typed into never receives
   * it, which is what keeps a debounced re-run from overwriting a half-typed word.
   */
  adoptQuery?: { term: string; modes: MatchModes };
}

export interface FileSearchResults {
  /** The run these rows came from. Anything older is dropped. */
  readonly generation: number;
  readonly status: ScanStatus;
  /** Append-only within a generation — see the header before replacing this with a copy. */
  readonly rows: readonly ResultRow[];
  readonly totalMatches: number;
  readonly filesScanned: number;
  /** FR-045f — one count for the whole scan. */
  readonly skipped: number;
  /**
   * FR-045a — which of THESE files have changed since the scan produced them.
   *
   * Held beside the rows rather than on them, so the marking survives a regrouping (both shapes
   * FR-073 left are re-derived from `rows`) and so FR-045b is true by construction: a flag the view
   * reads when it draws a HEADING cannot hide, disable or reorder a row.
   */
  readonly staleFiles: readonly string[];
  /** Bumped on every accepted update. What a consumer compares; never array identity. */
  readonly version: number;
}

/**
 * FR-042 — `notRun` is not `complete` with nothing found.
 *
 * Three genuinely different things the panel says differently, and collapsing them is how "no
 * results" comes to mean "we never looked".
 */
export const NO_FILE_SEARCH_RESULTS: FileSearchResults = {
  generation: 0,
  status: 'notRun',
  // FROZEN, because this object is SHARED by every panel that has not searched yet and the fold
  // below appends IN PLACE. A push into these would not be one panel's mistake — it would be every
  // panel created afterwards opening with another panel's rows in it.
  rows: Object.freeze([]),
  totalMatches: 0,
  filesScanned: 0,
  skipped: 0,
  staleFiles: Object.freeze([]),
  version: 0,
};

export function applyFileSearchUpdate(
  state: FileSearchResults,
  update: FileSearchUpdateEvent,
): FileSearchResults {
  // Rule 1. Returning the SAME object rather than an equal one matters: a consumer comparing
  // identity must be able to see that nothing happened, or a superseded run still costs a render.
  if (update.generation < state.generation) return state;

  /*
   * `version === 0` is the SHARED sentinel above, and it counts as fresh.
   *
   * Without that clause a `generation: 0` update — no newer than the sentinel's own generation, so
   * not caught by the comparison — would append into the constant's array and contaminate every
   * panel created afterwards. Nothing emits generation 0 today; the clause is what makes the freeze
   * a guard rather than a crash the first time something does.
   */
  const fresh = update.generation > state.generation || state.version === 0;
  /*
   * FR-078a — a snapshot is a full re-statement of one run, so it REPLACES at any generation it is
   * allowed to land at, including the one already on screen.
   *
   * Kept distinct from `fresh` rather than folded into it, because the two say different things: a
   * new generation is a new SEARCH (which is why `committed` and `staleFiles` are cleared with it),
   * while a snapshot at the current generation is the same search, re-told to a window that has just
   * begun watching it. Treating the second as a new run would clear a marking the run still holds.
   */
  const replace = fresh || update.snapshot === true;
  const rows = replace ? [] : (state.rows as ResultRow[]);
  // Rule 2. One turn's work is the arriving batch and nothing else.
  if (update.rows && update.rows.length > 0) rows.push(...update.rows);

  /*
   * 043 T118 — `scopeMissing` at THIS generation is a fact about the directory, not about the run.
   *
   * The service raises it two ways, and only one of them is a scan state. A search REFUSED at the
   * start supersedes into a new generation with every counter reset, and there `scopeMissing` is
   * the honest reading of the run: nothing was walked. But the watcher noticing the directory has
   * gone from under a run that already FINISHED re-emits at that run's own generation, precisely
   * so the listed rows survive (T115) — and taking its status would then have the readout describe
   * a scan that did not happen while the scan's own N rows are still on screen, which is the exact
   * opposite of FR-030a's "results already listed MUST stay listed and fully usable".
   *
   * So the condition goes where FR-030a puts it — the scope control, via `receive`, which reads
   * `update.status` and not this — and the run keeps saying what the run did.
   */
  const status = update.status === 'scopeMissing' && !fresh ? state.status : update.status;

  return {
    generation: update.generation,
    status,
    rows,
    /*
     * `replace`, not `fresh`: a snapshot's totals are AUTHORITATIVE for the run it re-states, and
     * they arrive with it. Carrying the previous ones forward would leave a re-attached window
     * counting rows it no longer holds.
     */
    totalMatches: update.totalMatches ?? (replace ? 0 : state.totalMatches),
    filesScanned: update.filesScanned ?? (replace ? 0 : state.filesScanned),
    skipped: update.skipped ?? (replace ? 0 : state.skipped),
    /*
     * FR-045c — a NEW generation is a re-run, and a re-run clears staleness for everything it
     * re-scanned. Falling back to `[]` rather than to the previous set is that clause: the rows
     * were just replaced, so a marking about the ones they replaced is a claim about files this
     * list no longer shows.
     */
    staleFiles: update.staleFiles ?? (replace ? [] : state.staleFiles),
    version: state.version + 1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// One panel's search (043 T058)
// ────────────────────────────────────────────────────────────────────────────

/** What a scan asks a panel about the FR-033 preferences, resolved by the panel that reads them. */
export interface GroupingPreference {
  readonly defaultGrouping: Grouping;
  readonly rememberGrouping: boolean;
}

/** The alternatives the scope control's single notice slot can hold (FR-030a, FR-070, R27). */
export type ScopeNotice = 'missing' | 'outsideProject' | null;

/** Everything one Find in Files panel holds. Its lifetime is that panel's (FR-023). */
export interface FindInFilesPanelState {
  readonly panelId: string;
  /** The project this panel searches. A panel never crosses into another one (FR-018). */
  readonly projectId: string | null;
  readonly projectRoot: string | null;
  readonly term: string;
  readonly modes: MatchModes;
  /**
   * Root-relative POSIX sub-directory, `''` for the whole root.
   *
   * A string rather than `string | null` because this is what the CONTROL holds, and a text field
   * that has been cleared holds `''`. The `null` the scan channel wants is derived at the one place
   * that starts a scan, so an empty control cannot reach the service as the sub-directory `""`.
   */
  readonly scopeSubPath: string;
  /*
   * There is no `ranScope` here, and its absence is a decision (FR-072).
   *
   * It held the scope the LISTED results came from, and it existed for one reason: FR-030's clause
   * requiring the panel to SHOW that. FR-072 withdraws the clause by name, so the state that
   * served it goes with it rather than lingering as a field nothing reads — which is #95's
   * `explorer.openMode` exactly, and what `settings-inertness-043.test.ts` exists to catch.
   */
  /**
   * The ONE thing the scope control has to say about itself, or nothing (FR-030a, FR-070).
   *
   * `'missing'` is FR-030a's standing condition — the directory or file the scope names has gone
   * (FR-092a) — and is informational: no row is hidden, disabled or reordered by it.
   * `'outsideProject'` is FR-070's refusal, raised when the folder chooser came back with somewhere
   * outside this project — or, since FR-092b, when a path TYPED into the box reads as outside it.
   *
   * ONE field rather than two booleans, and that is a decision rather than tidiness. They are
   * ALTERNATIVE things to say about one control, so two flags means a state where both hold, which
   * means two markings crowding one field and no answer to which the user should act on — the
   * shape spec 032 produced and CLAUDE.md's *one condition, one notice* exists to prevent. The
   * precedence is stated: the MOST RECENT condition holds the slot.
   */
  readonly scopeNotice: ScopeNotice;
  readonly grouping: Grouping;
  /** Group keys the user collapsed (FR-034). Kept across a regrouping and across a re-run. */
  readonly collapsed: ReadonlySet<string>;
  /**
   * The rows this panel is showing, and the scan that produced them.
   *
   * Held as one object rather than as loose fields because `applyFileSearchUpdate` returns the
   * SAME object when an update changed nothing — a batch from a superseded generation, say — and
   * identity is what lets `receive` skip the render entirely.
   */
  readonly results: FileSearchResults;
  /**
   * FR-046 — whether the replacement row is disclosed.
   *
   * Panel state rather than a component's `useState`, because two things outside the panel change
   * it: replace in files turns it ON in a panel it reuses (FR-029d), and the panel's own menu
   * toggles it (FR-025a). A local boolean would leave the command with nothing to write to.
   */
  readonly replaceEnabled: boolean;
  readonly replacement: string;
  /**
   * FR-051 and #378 — the matches this panel has already replaced, and how far each moved the text
   * after it.
   *
   * Beside the rows rather than a flag on them, for the reason staleness is: the grouped shapes are
   * re-derived from `rows` on every regrouping, so a flag stored on a row object would vanish the
   * moment the user switched grouping. The key is the match's identity — its file and the
   * offset the SCAN gave it — and the match is what was committed.
   *
   * The `shift` is what makes it more than a marking. A row is an offset into the text as one scan
   * found it, and every commit this panel makes moves the rows after it by `|replacement| - |match|`.
   * Nothing else can know that: main sees one commit at a time and the file's bytes cannot say
   * whether an adjacent match is the user's next one or the middle of the replacement just written
   * (#378). So the panel carries the arithmetic, and `rebase` below is where it is spent.
   *
   * Recorded per commit rather than derived from the current replacement, because the user may edit
   * the replacement box between two commits — the shift a write caused is a fact about that write.
   *
   * Cleared by a new generation and by nothing else: a re-run is a fresh question, and rows from it
   * have not been committed however much they resemble the ones that were (FR-050 keeps a SKIPPED
   * row pending, which is the opposite case and the one this must not confuse it with).
   */
  readonly committed: CommittedEdits;
  /** Bumped by every invocation, so the panel can focus and select its input (FR-031c). */
  readonly seedSeq: number;
  /**
   * 043 T235 — bumped whenever this window ADOPTS another window's query (FR-078b).
   *
   * The as-you-type effect in the panel cannot otherwise tell that write from typing: both change
   * the term. Read as typing, a follower scheduled its own scan once the settle passed, became the
   * query's originator in main, and sent the parent its OWN older term back — overwriting whatever
   * the user had typed since. A counter the effect can see is the whole of the distinction.
   */
  readonly adoptSeq: number;
  /**
   * WHICH input that invocation wants focused (FR-031c).
   *
   * The search input for find in files, the replacement input for replace in files. Carried beside
   * `seedSeq` rather than derived from `replaceEnabled`, because a panel can have replace disclosed
   * and still be invoked as a FIND — at which point focusing the replacement box would put the
   * user's next keystroke in the wrong field.
   */
  readonly focusTarget: 'search' | 'replacement';
}

const panels = new Map<string, FindInFilesPanelState>();
const listeners = new Set<() => void>();

/**
 * Per file, the SCANNED offset of each match this panel has replaced and the shift that write caused.
 *
 * A map of maps rather than a list of pairs so the marking stays an O(1) question — the results list
 * asks it once per row on every render, and there is no match ceiling (Assumptions).
 */
export type CommittedEdits = ReadonlyMap<string, ReadonlyMap<number, CommittedWrite>>;

/**
 * What ONE write did, kept per scanned offset — the whole of what a committed row is rendered from.
 *
 * ══ WHY THIS IS NOT JUST THE SHIFT ANY MORE (FR-083) ══
 *
 * Until FR-083 a committed row still rendered its scan-time snippet and the CURRENT replacement box,
 * because a committed row was only marked, never re-read. Now it must show the file as it is after
 * that commit — and `state.replacement` is the wrong source for it the moment the user edits the box
 * afterwards, which FR-050's stepping model makes the ordinary case rather than an edge: commit one
 * match, change the wording, commit the next, and the first row would start claiming text that was
 * never written to it.
 *
 * So what was written is recorded where the shift already is, for the same reason the shift is
 * recorded there: it is a fact about that write, and nothing outside this map remembers it.
 */
export interface CommittedWrite {
  /** `|replacement| - |match|`, at the moment it was written. What moved the rows after it. */
  readonly shift: number;
  /** The text this write PUT THERE — never re-read from the replacement box (FR-083). */
  readonly replacement: string;
  /**
   * FR-083b — the line as it reads after the whole commit, derived by main from the new text.
   *
   * Absent past `MAX_COMMIT_SNIPPET_CHARS`, and the renderer says so by falling back to
   * `replacement` inside the row's scan-time snippet: correct about the row itself, possibly still
   * showing a same-line neighbour's old text. That is the bound's stated cost, not a defect here.
   */
  readonly snippet?: SnippetView;
}

/** One match a commit wrote, as the panel knows it: where the scan put it, and what it did. */
export interface CommittedEdit extends CommittedWrite {
  readonly relPath: string;
  /** The offset the SCAN gave this match — the row's identity, never a rebased one. */
  readonly from: number;
}

/** Shared, so a panel that has committed nothing costs no allocation and compares by identity. */
const EMPTY_COMMITTED: CommittedEdits = new Map();

/** Has this match already been replaced by this panel? (FR-051.) */
export function isCommitted(
  committed: CommittedEdits,
  row: { relPath: string; from: number },
): boolean {
  return committed.get(row.relPath)?.has(row.from) ?? false;
}

/**
 * What this panel wrote at this row, or `undefined` if it has not written there (FR-083).
 *
 * The same question `isCommitted` asks, answered with the write rather than with a boolean — because
 * a committed row is now RENDERED from it. Both are kept: the marking is asked of every row on every
 * render and wants no allocation, and the two callers read the same map either way.
 */
export function committedWrite(
  committed: CommittedEdits,
  row: { relPath: string; from: number },
): CommittedWrite | undefined {
  return committed.get(row.relPath)?.get(row.from);
}

/**
 * Where a scanned match is NOW, given what this panel has already replaced in its file (#378).
 *
 * Every commit before it moved it by that commit's own shift, and nothing else in this operation
 * could have: the sum is exact rather than inferred, which is the whole difference between this and
 * re-deriving the position from the file's bytes at the point of the write.
 *
 * A match at or after a committed one is what shifts. A committed match's own offset is never asked
 * — the panel excludes it from the rows it sends (FR-050).
 */
export function rebase(
  committed: CommittedEdits,
  row: { relPath: string; from: number; to: number },
): { from: number; to: number } {
  const inFile = committed.get(row.relPath);
  if (!inFile) return { from: row.from, to: row.to };
  let shift = 0;
  for (const [from, write] of inFile) if (from < row.from) shift += write.shift;
  return { from: row.from + shift, to: row.to + shift };
}

/**
 * The grouping each project was last searched in (FR-033b).
 *
 * A module-level Map, and that IS the requirement rather than a shortcut: what is remembered lives
 * in memory for the running application only and must not survive a restart. The preference that
 * decides whether to remember is the only part of this that reaches disk. 033 FR-062 settles the
 * same question the same way for Quick Open's remembered query.
 */
const rememberedGrouping = new Map<string, Grouping>();

/** The live subscription to the update channel — one for the window, not one per panel. */
let channel: (() => void) | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Route one update to its panel, dropping anything from a superseded run (research R4).
 *
 * The drop is `applyFileSearchUpdate`'s, and it returns the SAME object when nothing happened —
 * which is what this checks, so a batch from an abandoned walk costs no render either.
 */
function receive(update: FileSearchUpdateEvent): void {
  const panel = panels.get(update.panelId);
  if (!panel) return;
  const results = applyFileSearchUpdate(panel.results, update);
  /*
   * A NEW generation is a NEW RUN — the one fact both clauses below turn on.
   *
   * For `committed` it means the marking describes matches this list no longer shows (FR-051), the
   * same clause and the same reasoning as `staleFiles` in the fold above.
   *
   * For `scopeNotice` it is what makes clearing the marking honest (043 T115). Only a run that
   * REACHED the directory can say the scope is not missing, and a batch or a completion from the
   * run already on screen is not that: it started before the directory went, so its `complete`
   * would otherwise wipe a marking raised — correctly — while it was still walking.
   *
   * ══ WHY A RUN CLEARS A REFUSAL TOO (FR-070, R27's stated precedence) ══
   *
   * The slot holds the MOST RECENT condition, and a run is more recent than the refusal that
   * preceded it. That is safe rather than lossy precisely because a refusal writes NOTHING: the
   * scope text is exactly what it was, so a run that reached it has just answered the only
   * question the refusal left open.
   */
  const fromANewRun = results.generation > panel.results.generation;
  const scopeNotice: ScopeNotice =
    update.status === 'scopeMissing'
      ? 'missing'
      : fromANewRun && (update.status === 'running' || update.status === 'complete')
        ? null // this walk reached the directory, so whatever was missing is not missing now
        : panel.scopeNotice;
  /*
   * FR-078b — adopt the query these rows came from, because this window is not the one typing.
   *
   * Main decides that, not the renderer: the field is absent for the window driving the search, so
   * presence alone is the instruction and there is no local test that could get it wrong. What
   * arrives is the run's term and modes, which is by construction the query that produced the rows
   * in this same message — so the box and the list can never disagree, which is the whole
   * requirement.
   *
   * `replacement` is deliberately NOT adopted. It is not part of the query, nothing about it can
   * disagree with the rows, and a user composing a replacement in one window would lose it every
   * time somebody re-ran the search in the other.
   */
  const adopt = update.adoptQuery;
  const term = adopt ? adopt.term : panel.term;
  const modes = adopt ? adopt.modes : panel.modes;
  const queryMoved = term !== panel.term || modes !== panel.modes;
  /*
   * The `queryMoved` clause is not belt-and-braces. A supersession delivers an update whose rows
   * and totals can be identical to what this window already held — a re-run of the same search over
   * an unchanged tree — and without it that update would return here having changed the term
   * nowhere, leaving the box stale for exactly the case the requirement is about.
   */
  if (results === panel.results && scopeNotice === panel.scopeNotice && !queryMoved) return;
  const committed = fromANewRun ? EMPTY_COMMITTED : panel.committed;
  // T235 — an adopted query that MOVED the box is counted, so the panel can tell it from typing.
  const adoptSeq = adopt && queryMoved ? panel.adoptSeq + 1 : panel.adoptSeq;
  panels.set(update.panelId, { ...panel, results, scopeNotice, committed, term, modes, adoptSeq });
  emit();
}

function openChannel(): void {
  if (channel) return;
  const onUpdate = window.throng?.fileSearch?.onUpdate;
  if (!onUpdate) return;
  channel = onUpdate(receive);
}

/** Write a panel back, but only if it still exists — an action racing a close resurrects none. */
function update(
  panelId: string,
  next: (panel: FindInFilesPanelState) => FindInFilesPanelState,
): void {
  const current = panels.get(panelId);
  if (!current) return;
  const updated = next(current);
  if (updated === current) return;
  panels.set(panelId, updated);
  emit();
}

/**
 * Which grouping a panel opens in (FR-033c).
 *
 * Pure over the two preferences and the per-project memory, so the panel can call it while it is
 * being created rather than opening in one grouping and correcting itself in an effect.
 */
export function initialFindInFilesGrouping(
  projectId: string | null,
  prefs: GroupingPreference,
): Grouping {
  if (!prefs.rememberGrouping || projectId === null) return prefs.defaultGrouping;
  return rememberedGrouping.get(projectId) ?? prefs.defaultGrouping;
}

export interface FindInFilesPanelInit {
  projectId: string | null;
  projectRoot: string | null;
  grouping: Grouping;
  term?: string;
  modes?: MatchModes;
  scopeSubPath?: string;
  /** FR-027a — a restored panel reopens with its replacement row as the user left it. */
  replaceEnabled?: boolean;
  replacement?: string;
}

/** Create this panel's state if it has none. Idempotent — a remount is not a new search. */
export function ensureFindInFilesPanel(panelId: string, init: FindInFilesPanelInit): void {
  openChannel();
  const existing = panels.get(panelId);
  if (existing) {
    // A panel can be told where it lives after it exists: ownership resolves asynchronously, and a
    // detached panel is remounted in another window. Neither is a new search.
    if (existing.projectId === init.projectId && existing.projectRoot === init.projectRoot) return;
    panels.set(panelId, { ...existing, projectId: init.projectId, projectRoot: init.projectRoot });
    emit();
    return;
  }
  panels.set(panelId, {
    panelId,
    projectId: init.projectId,
    projectRoot: init.projectRoot,
    term: init.term ?? '',
    modes: init.modes ?? NO_MODES,
    scopeSubPath: init.scopeSubPath ?? '',
    scopeNotice: null,
    grouping: init.grouping,
    collapsed: new Set(),
    results: NO_FILE_SEARCH_RESULTS,
    replaceEnabled: init.replaceEnabled ?? false,
    replacement: init.replacement ?? '',
    committed: EMPTY_COMMITTED,
    seedSeq: 0,
    adoptSeq: 0,
    focusTarget: 'search',
  });
  emit();
}

/**
 * Tell main this window is displaying the panel (FR-078, R23) — and be sent what its run holds.
 *
 * ══ WHY THE RENDERER HAS TO SAY SO ══
 *
 * Main cannot see which windows have a panel mounted: the workspace layout lives here. So the viewer
 * set is REGISTERED rather than inferred, and this is the registration — called from the panel
 * component's mount effect, in every window, beside the `ensureFindInFilesPanel` call whose own
 * comment already anticipated *"a panel remounted in another window"*.
 *
 * Idempotent and fire-and-forget. With a run for this panel, main answers with one snapshot of
 * everything it holds; with no run, nothing is sent and the panel keeps rendering `notRun` — but the
 * interest is remembered, so the next scan started in EITHER window reaches this one (#380, US5
 * scenario 6).
 *
 * `destroyFindInFilesPanel` is the other half: it detaches, and the run is released on the last
 * detach. There is deliberately no detach on unmount — a tab switched away from is still a panel
 * this window is displaying, and dropping there would release a run the other window is watching.
 */
export function attachFindInFilesPanel(panelId: string): void {
  openChannel();
  window.throng?.fileSearch?.attach?.(panelId);
}

/** This panel's state, or `null` before it is created. */
export function useFindInFilesPanel(panelId: string): FindInFilesPanelState | null {
  const read = (): FindInFilesPanelState | null => panels.get(panelId) ?? null;
  return useSyncExternalStore(subscribe, read, read);
}

/** Read-only observation seam for the non-React callers (commands, the future menu). */
export function getFindInFilesPanel(panelId: string): FindInFilesPanelState | undefined {
  return panels.get(panelId);
}

export function setFindInFilesTerm(panelId: string, term: string): void {
  update(panelId, (p) => (p.term === term ? p : { ...p, term }));
}

/**
 * Disclose or put away the replacement row (FR-046).
 *
 * Separate from the toggle below because the two have different callers and different meanings:
 * replace in files SETS it on, in a panel that may already have it on, and must not flip it off
 * (FR-029d). The user's own toggle flips.
 */
export function setFindInFilesReplaceEnabled(panelId: string, on: boolean): void {
  update(panelId, (p) => (p.replaceEnabled === on ? p : { ...p, replaceEnabled: on }));
}

/** The panel's own replace toggle — the panel-level action FR-029d points at (FR-025a, FR-046). */
export function toggleFindInFilesReplace(panelId: string): void {
  update(panelId, (p) => ({ ...p, replaceEnabled: !p.replaceEnabled }));
}

/**
 * Mark the rows a commit actually wrote (FR-051).
 *
 * Additive rather than a replacement, because FR-049's granularities are meant to be STEPPED
 * through: committing one file and then another must leave both marked, and a set that were
 * replaced would erase the earlier step's answer.
 */
export function markFindInFilesCommitted(
  panelId: string,
  edits: readonly CommittedEdit[],
): void {
  if (edits.length === 0) return;
  update(panelId, (p) => {
    const next = new Map<string, Map<number, CommittedWrite>>();
    for (const [relPath, inFile] of p.committed) next.set(relPath, new Map(inFile));
    let added = 0;
    for (const edit of edits) {
      let inFile = next.get(edit.relPath);
      if (!inFile) next.set(edit.relPath, (inFile = new Map()));
      if (!inFile.has(edit.from)) added += 1;
      // A re-commit of the same scanned offset must not shift its file twice; the first write is
      // the one that moved the text, and a second is a duplicate report rather than a second edit.
      // The same reasoning keeps the first write's TEXT: what the row shows is what landed there.
      inFile.set(
        edit.from,
        inFile.get(edit.from) ?? {
          shift: edit.shift,
          replacement: edit.replacement,
          ...(edit.snippet === undefined ? {} : { snippet: edit.snippet }),
        },
      );
    }
    return added === 0 ? p : { ...p, committed: next };
  });
}

export function setFindInFilesReplacement(panelId: string, replacement: string): void {
  update(panelId, (p) => (p.replacement === replacement ? p : { ...p, replacement }));
}

export function toggleFindInFilesMode(panelId: string, mode: keyof MatchModes): void {
  update(panelId, (p) => ({ ...p, modes: { ...p.modes, [mode]: !p.modes[mode] } }));
}

/**
 * Retarget the scope (FR-030) — which also CLEARS a missing-scope marking (FR-030a).
 *
 * It starts nothing. Retargeting is a statement about where the next search will look, and the
 * results already listed keep standing until the user runs again (FR-043a).
 */
export function setFindInFilesScope(panelId: string, scopeSubPath: string): void {
  update(panelId, (p) =>
    p.scopeSubPath === scopeSubPath && p.scopeNotice === null
      ? p
      : { ...p, scopeSubPath, scopeNotice: null },
  );
}

/** FR-030a — the scope directory is gone. Informational: no row is touched. */
export function markFindInFilesScopeMissing(panelId: string): void {
  update(panelId, (p) => (p.scopeNotice === 'missing' ? p : { ...p, scopeNotice: 'missing' }));
}

/**
 * FR-070 — the folder the user chose is not inside this project, so nothing was written.
 *
 * It TAKES the slot from whatever was in it: this is a report about the gesture just made, and the
 * most recent condition is the one the control says (R27).
 */
export function markFindInFilesScopeOutsideProject(panelId: string): void {
  update(panelId, (p) =>
    p.scopeNotice === 'outsideProject' ? p : { ...p, scopeNotice: 'outsideProject' },
  );
}

/**
 * Switch the grouping (FR-033) — and remember it for this project when the preference says so.
 *
 * Nothing is re-run: both shapes FR-073 left are derivable from the rows one scan already produced, which
 * is what `groupRows` being a pure function of them buys.
 */
export function setFindInFilesGrouping(panelId: string, grouping: Grouping, remember: boolean): void {
  update(panelId, (p) => {
    if (remember && p.projectId !== null) rememberedGrouping.set(p.projectId, grouping);
    return p.grouping === grouping ? p : { ...p, grouping };
  });
}

/** Collapse or expand one group (FR-034). The set survives a regrouping and a re-run. */
export function toggleFindInFilesGroup(panelId: string, key: string): void {
  update(panelId, (p) => {
    const collapsed = new Set(p.collapsed);
    if (!collapsed.delete(key)) collapsed.add(key);
    return { ...p, collapsed };
  });
}

/** Collapse or expand every group at once (FR-025a's collapse/expand all). */
export function setAllFindInFilesGroupsCollapsed(panelId: string, keys: readonly string[]): void {
  update(panelId, (p) => ({ ...p, collapsed: new Set(keys) }));
}

/**
 * Start a scan for this panel (FR-043a) — and note where it looked.
 *
 * Starting IS subscribing on this channel, and a start for a panel that already has a scan running
 * SUPERSEDES it rather than compounding (FR-043c), so there is no cancel handshake here: the
 * abandoned run's remaining batches carry an older `generation` and are dropped on arrival.
 */
export function runFindInFiles(panelId: string): void {
  const panel = panels.get(panelId);
  if (!panel || panel.term.length === 0 || panel.projectRoot === null) return;
  /*
   * 043 FR-092b — the box is READ here, where the scope is used, and never rewritten.
   *
   * It used to go to main verbatim. A trailing slash became the row prefix `src//`, a backslash was
   * carried into every row's path, and an absolute path was joined onto the root and reported as a
   * scope that had gone. `readScopeInput` accepts root-relative and absolute-inside as one scope, and
   * answers `outside` for anything past the project — FR-070's refusal, which until now only the
   * folder chooser raised. Nothing starts behind a refusal, so nothing is superseded and the rows
   * listed stand, exactly as for the chooser.
   *
   * The box keeps what the user typed. Writing the canonical form back would rewrite a field under
   * its typist — under as-you-type, mid-word — and the text they typed is a perfectly good answer to
   * "where is this looking?".
   */
  const read = readScopeInput(panel.projectRoot, panel.scopeSubPath);
  if (read.kind === 'outside') {
    markFindInFilesScopeOutsideProject(panelId);
    return;
  }
  const scopeSubPath = read.subPath.length > 0 ? read.subPath : null;

  panels.set(panelId, {
    ...panel,
    results: { ...panel.results, status: 'running' },
  });
  emit();

  const start = window.throng?.fileSearch?.start;
  if (!start) return;
  const wasStatus = panel.results.status;
  const wasGeneration = panel.results.generation;
  void start({
    panelId,
    projectRoot: panel.projectRoot,
    scopeSubPath,
    term: panel.term,
    modes: panel.modes,
  })
    .then((result) => {
      /*
       * A scope that does not EXIST inside this project is refused rather than walked, and the
       * refusal is what the control has to say (FR-030a). It said "not a directory" until round
       * five, which main never checked; a file is a legitimate scope now (FR-092).
       *
       * There is nothing to undo alongside it any more. This branch used to put `ranScope` back,
       * because the optimistic write above had already claimed the listed rows came from a
       * directory nothing ever searched — "Results from gone" over four results from `src`. FR-072
       * deleted the readout and the state behind it, so the refusal is now the whole of the
       * response.
       */
      if (result.started === false && result.reason === 'scopeMissing') {
        markFindInFilesScopeMissing(panelId);
      }
    })
    .catch(() => {
      /*
       * The channel never answered — a window mid-teardown, a main-side throw. Nothing started, so
       * the panel must stop saying it is searching: a status line reading "Searching…" for the life
       * of the window is a claim about a scan that does not exist.
       *
       * Put back what it was showing before, and only if nothing has arrived since — a generation
       * that has moved on means a scan IS running and this rejection is stale. There is no failure
       * status to move to instead: `ScanStatus` is `@throng/core`'s, and adding one is that
       * package's decision rather than this store's.
       */
      update(panelId, (p) =>
        p.results.status === 'running' && p.results.generation === wasGeneration
          ? { ...p, results: { ...p.results, status: wasStatus } }
          : p,
      );
    });
}

/** Cancel a running scan (FR-043). Idempotent: cancelling a finished scan is a no-op. */
export function cancelFindInFiles(panelId: string): void {
  window.throng?.fileSearch?.cancel?.(panelId);
}

/**
 * Invoking find in files IS an explicit run (FR-043a's final clause).
 *
 * With a seed — a single-line selection under the chord (FR-031a) — the seed becomes the term and
 * is searched. WITHOUT one, a reused panel re-runs the term already in its box rather than sitting
 * on results from a previous question: the user asked for a search, so they get one.
 */
export function invokeFindInFiles(
  panelId: string,
  opts: { seedTerm?: string; focus?: 'search' | 'replacement' },
): void {
  const seed = opts.seedTerm ?? '';
  update(panelId, (p) => ({
    ...p,
    term: seed.length > 0 ? seed : p.term,
    seedSeq: p.seedSeq + 1,
    // FR-031c — WHICH input gets the caret, decided by the command rather than by the panel's
    // current disclosure state. Every route bumps `seedSeq`, including the two that seed nothing.
    focusTarget: opts.focus ?? 'search',
  }));
  runFindInFiles(panelId);
}

/**
 * 043 FR-091 — the tree's *Open In → Search* route: one state, whether the panel was reused or new.
 *
 * The term and the replacement are EMPTIED; the results go back to FR-042's `notRun`, never to
 * `complete` with nothing found; the committed and stale markings go with the rows they described;
 * the scope is the path that was right-clicked, with any notice about the old one cleared; the
 * disclosure follows the item; and the caret goes to the SEARCH input. Nothing is run: the term is
 * empty, and `runFindInFiles` refuses an empty term under both triggers (FR-080b).
 *
 * ══ WHY THE CARET GOES TO THE SEARCH INPUT FOR FIND & REPLACE TOO ══
 *
 * FR-031c sends replace in files' caret to the replacement, because that chord arrives with a term
 * already in the box. This route has just emptied it, and a replacement typed before there is
 * anything to find previews nothing.
 *
 * ══ WHY MAIN IS ASKED AS WELL ══
 *
 * FR-091a. Main keeps the run so a synced sub-workspace view can be shown it (FR-078a), so a clear
 * made only here would leave that view listing the old rows under an empty box. `clear` empties the
 * run for every window watching it, and moves it on a generation — which is also what stops a scan
 * still walking and drops its late batches on arrival.
 *
 * The local reset KEEPS this panel's generation rather than inventing one. Main owns the numbering;
 * its `notRun` arrives one generation on and is read as a new run, and a panel main has never run
 * has nothing to receive and is already empty.
 *
 * ══ THE TERM IS WRITTEN IN THE SAME UPDATE AS THE SCOPE, ON PURPOSE ══
 *
 * Under FR-074's as-you-type default a change to the SCOPE schedules a scan once typing settles
 * (FR-080e). This route changes the scope, and it starts nothing only because the term is empty at
 * the same moment. One update means there is no render in which the new scope sits beside the old
 * term.
 */
export function resetFindInFilesPanel(
  panelId: string,
  opts: { scopeSubPath: string; replace: boolean },
): void {
  update(panelId, (p) => ({
    ...p,
    term: '',
    replacement: '',
    scopeSubPath: opts.scopeSubPath,
    scopeNotice: null,
    replaceEnabled: opts.replace,
    committed: new Map(),
    results: {
      ...NO_FILE_SEARCH_RESULTS,
      /*
       * FRESH arrays, not the shared frozen ones `NO_FILE_SEARCH_RESULTS` carries. The fold appends
       * IN PLACE within a generation, and this reset keeps the generation — so a batch from the old
       * scan still in flight at this generation would push into a frozen array and throw. Main's
       * `notRun` a generation on replaces whatever lands here a moment later.
       */
      rows: [],
      staleFiles: [],
      generation: p.results.generation,
      version: p.results.version + 1,
    },
    seedSeq: p.seedSeq + 1,
    focusTarget: 'search',
  }));
  window.throng?.fileSearch?.clear?.(panelId);
}

/**
 * The panel is GONE — discard its results (FR-023) and stop its scan.
 *
 * Symmetric with `destroyPanelSearch` in the find store: results live only as long as the panel
 * that owns them, and a Find in Files panel opened afterwards starts with none.
 */
export function destroyFindInFilesPanel(panelId: string): void {
  if (!panels.delete(panelId)) return;
  /*
   * `drop`, not `cancel`. Cancel abandons a RUNNING scan and is a no-op for one that has finished —
   * which is the ordinary way a panel is closed — so it released nothing, and main kept the run's
   * per-file stamps and kept re-stating them on every watcher tick for the life of the window.
   * Drop releases the run whatever state it is in.
   *
   * Since FR-078 it is a DETACH: this window stops watching, and main releases the run when the last
   * window has. FR-023 is unchanged by that — destroying a panel destroys it in every window, so
   * every window arrives here and the set empties.
   */
  window.throng?.fileSearch?.drop?.(panelId);
  // The tab's "last active" memory must not outlive the panel: a destroyed id handed a search
  // would open nothing and report nothing (043 FR-021).
  forgetFindInFilesPanel(panelId);
  emit();
}

/** Test seam: drop every panel, every remembered grouping, and the channel subscription. */
export function __resetFindInFilesState(): void {
  panels.clear();
  rememberedGrouping.clear();
  channel?.();
  channel = null;
  emit();
}
