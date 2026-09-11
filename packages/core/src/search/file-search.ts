/**
 * 043 — the pure file-search model: the shapes a Find in Files panel renders, and every transform
 * over them. No I/O, no filesystem, no process. The scan that FILLS these shapes lives in UI main
 * (`file-search-service.ts`, research R2); everything about what the results MEAN lives here, so it
 * is settled by a unit test rather than only observable through a running scan.
 *
 * The split matters more than it looks. Ordering, grouping, snippets and staleness are the four
 * things a user reads a results list for, and all four are decisions about data. Putting them in
 * the service would have made each of them cost a temp tree and a real walk to assert.
 */

/** Where a search looks. */
export interface SearchScope {
  /** Absolute, canonical project root. */
  readonly projectRoot: string;
  /** Root-relative POSIX sub-directory, or `null` for the whole root. */
  readonly subPath: string | null;
}

/** FR-036: the matched text, highlighted inside surrounding context. */
export interface SnippetView {
  readonly before: string;
  readonly matched: string;
  readonly after: string;
  /** Render a leading ellipsis: the line continued to the left of `before`. */
  readonly truncatedStart: boolean;
  /** Render a trailing ellipsis: the line continued to the right of `after`. */
  readonly truncatedEnd: boolean;
}

/**
 * One occurrence: one file, one position (FR-032 — a row per match, never a row per file).
 *
 * `line`/`column` are 1-based and exist for DISPLAY; `from`/`to` are absolute document offsets and
 * are what the commit re-verifies and rewrites. Both are carried because neither substitutes for
 * the other: an offset is meaningless to a reader, and a line/column pair cannot be applied to a
 * document without re-deriving the offset from content that may since have changed.
 */
export interface ResultRow {
  /** Root-relative POSIX path — the identity of the file. */
  readonly relPath: string;
  readonly line: number;
  readonly column: number;
  readonly from: number;
  readonly to: number;
  readonly snippet: SnippetView;
}

/**
 * How results are grouped (FR-033). Switching between these never re-runs the search.
 *
 * FR-073 withdrew a third value, `'folder'`, which hung rows straight off a folder heading. The row
 * showed a position and a snippet and nothing else, so the file a line came from was unreadable.
 * `'fileAndFolder'` keeps the folder heading and puts a file heading under it, which is the shape
 * that answers the same question.
 */
export type Grouping = 'file' | 'fileAndFolder';

/**
 * A heading rows sit under. Nests one level deep, and only under `fileAndFolder`.
 *
 * There is deliberately NO collapsed/expanded field. Results open expanded (FR-034a), and if that
 * state lived here it would have a default to get wrong and a regrouping to reset it against the
 * user's choice. It is the panel's, and the panel keeps it across a regrouping.
 */
export interface ResultGroup {
  /** `relPath` for a file group, root-relative directory (`''` at the root) for a folder group. */
  readonly key: string;
  readonly kind: 'file' | 'folder';
  /** Matches held here and below — rendered digit-grouped by the view (FR-014). */
  readonly matchCount: number;
  /** FR-045a. Only ever true for `kind: 'file'`; a folder is not a file. */
  readonly stale: boolean;
  readonly rows: readonly ResultRow[];
  readonly children: readonly ResultGroup[];
}

/**
 * The five states FR-042 and FR-030a between them require. `notRun`, `running`, and `complete` with
 * zero rows are three genuinely different things the panel says differently — collapsing them is
 * how "no results" comes to mean "we never looked".
 */
export type ScanStatus = 'notRun' | 'running' | 'complete' | 'cancelled' | 'scopeMissing';

/**
 * The streaming bound. Constants, not settings: nothing asks the user to tune streaming
 * granularity, and Principle X governs values a deployment or a user needs to change — not the
 * internal shape of a stream. Named here rather than inlined so SC-004's scan half has a number to
 * assert against.
 */
export const MAX_ROWS_PER_BATCH = 250;
export const BATCH_FLUSH_MS = 50;

/**
 * The other bound on a payload crossing the process boundary: how much re-derived snippet text one
 * COMMIT may answer with (FR-083b).
 *
 * Here rather than beside `postCommitSnippets` itself so it sits with the reasoning above, which is
 * the same reasoning: a scan streams its rows in batches because one message carrying every match
 * of a broad term is a message that arrives late and all at once, and a commit answering with a
 * re-derived snippet per write has exactly that shape. A Replace All over a 5,000-file project
 * (SC-004) writes as many matches as the scan found.
 *
 * CHARACTERS rather than a count of snippets, because a count does not bound this. Each snippet's
 * context is already capped at {@link SNIPPET_CONTEXT_CHARS} a side, but its MATCHED half is the
 * replacement the user typed — which may be a pasted block of any size, and would then be echoed
 * back once per row on top of the copy the panel already holds.
 *
 * ══ WHAT HAPPENS WHEN IT IS EXCEEDED, SAID OUT LOUD ══
 *
 * The writes all happen: this bounds the REPORT, never the commit. Past the budget each further
 * write comes back with no snippet, and the panel falls back to the replacement it recorded for
 * that match (`find-in-files-store.ts`), rendered plainly in place of the matched text. That row is
 * then correct about ITSELF and may still show a same-line neighbour's pre-commit text — which is
 * exactly the defect FR-083b removes, surviving past the bound rather than being hidden. It is
 * stated here, in the contract, and asserted by a test, rather than being discovered from a screen.
 */
export const MAX_COMMIT_SNIPPET_CHARS = 200_000;

/**
 * Characters of context a snippet shows on each side of the match, before snapping to a word
 * boundary (FR-036).
 */
export const SNIPPET_CONTEXT_CHARS = 40;

/**
 * How far the snippet may pull its edge in to reach a word boundary. Past this it cuts where the
 * budget landed and accepts a part-word: a minified line or a long base64 blob has no boundary
 * within reach, and giving up the whole context to look for one leaves the row showing "…" and
 * nothing else — which is worse than a clipped token.
 */
const SNIPPET_SNAP_LIMIT = 20;

// ────────────────────────────────────────────────────────────────────────────
// Paths
// ────────────────────────────────────────────────────────────────────────────

/** The root-relative directory a file sits in; `''` for a file at the root. */
function dirOf(relPath: string): string {
  const i = relPath.lastIndexOf('/');
  return i === -1 ? '' : relPath.slice(0, i);
}

/** Alphanumeric, digits before letters — the collation the explorer tree already uses. */
function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' });
}

/**
 * FR-035's ordering, as a comparator over root-relative paths: at each level, a directory's own
 * entries before anything inside its sub-directories, each set alphanumerically.
 *
 * ══ WHY NOT JUST COMPARE THE STRINGS ══
 *
 * `'src/z.ts' < 'src/a/b.ts'` is false as a string comparison, so a plain sort files `src/z.ts`
 * BELOW a file nested inside `src/a` — a directory's own file appearing under its sub-directory's
 * contents, which is precisely what FR-035 rules out. The rule is per level, so the comparison has
 * to be per segment, and the tie it has to break is "this path ends here, that one keeps going".
 *
 * ══ WHY `leafFirst` IS A PARAMETER AND NOT ALWAYS ON ══
 *
 * That tiebreak is "a FILE before a sub-directory", and it only means anything when a path ending
 * here is a file. A list of folder headings is all directories, so the same rule would read
 * `z` before `src/a` — pulling a sub-directory of `src` clear of its parent and out to the end of
 * the list. Directory keys therefore compare by segment and put the shorter first, which is the
 * parent before its children.
 */
function comparePaths(a: string, b: string, leafFirst: boolean): number {
  const as = a.split('/');
  const bs = b.split('/');
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i++) {
    if (leafFirst) {
      const aLeaf = i === as.length - 1;
      const bLeaf = i === bs.length - 1;
      if (aLeaf !== bLeaf) return aLeaf ? -1 : 1;
    }
    const c = compareName(as[i], bs[i]);
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

// ────────────────────────────────────────────────────────────────────────────
// Snippets (FR-036)
// ────────────────────────────────────────────────────────────────────────────

const WORD = /[\p{L}\p{N}_]/u;

/** True where a cut between `i - 1` and `i` falls between two word characters. */
function insideWord(text: string, i: number): boolean {
  return i > 0 && i < text.length && WORD.test(text[i - 1]) && WORD.test(text[i]);
}

/**
 * The snippet for one match, where `from`/`to` are offsets **within `lineText`**.
 *
 * The ellipsis marks TRUNCATION, not the presence of context: a match near the start of a short
 * line has text before it and no ellipsis, because nothing was cut. That distinction is the whole
 * information content of the flag, and "show one whenever `before` is non-empty" throws it away.
 */
export function snippetFor(lineText: string, from: number, to: number): SnippetView {
  const lo = Math.max(0, Math.min(from, lineText.length));
  const hi = Math.max(lo, Math.min(to, lineText.length));

  let start = Math.max(0, lo - SNIPPET_CONTEXT_CHARS);
  if (start > 0) {
    // Pull the edge IN to the next boundary rather than out to the previous one: the budget then
    // stays a hard bound, which is what keeps a 10,000-character minified line from arriving in
    // the renderer one row at a time.
    const limit = Math.min(lo, start + SNIPPET_SNAP_LIMIT);
    while (start < limit && insideWord(lineText, start)) start++;
    if (insideWord(lineText, start)) start = Math.max(0, lo - SNIPPET_CONTEXT_CHARS);
  }

  let end = Math.min(lineText.length, hi + SNIPPET_CONTEXT_CHARS);
  if (end < lineText.length) {
    const limit = Math.max(hi, end - SNIPPET_SNAP_LIMIT);
    while (end > limit && insideWord(lineText, end)) end--;
    if (insideWord(lineText, end)) end = Math.min(lineText.length, hi + SNIPPET_CONTEXT_CHARS);
  }

  return {
    before: lineText.slice(start, lo),
    matched: lineText.slice(lo, hi),
    after: lineText.slice(hi, end),
    truncatedStart: start > 0,
    truncatedEnd: end < lineText.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Grouping (FR-033) and ordering (FR-035)
// ────────────────────────────────────────────────────────────────────────────

function fileGroup(key: string, rows: readonly ResultRow[]): ResultGroup {
  return { key, kind: 'file', matchCount: rows.length, stale: false, rows, children: [] };
}

/** Rows bucketed by a key, in first-seen order — `orderGroups` is what settles the order. */
function bucket(rows: readonly ResultRow[], keyOf: (r: ResultRow) => string): Map<string, ResultRow[]> {
  const out = new Map<string, ResultRow[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const held = out.get(key);
    if (held) held.push(row);
    else out.set(key, [row]);
  }
  return out;
}

/**
 * Shape one result set under one grouping (FR-033).
 *
 * A pure function of the rows, which is the substance of "without re-running the search": both
 * shapes are derivable from what a single scan already produced, so the panel has nothing
 * to ask the service for when the user switches.
 *
 * FR-073 removed a third branch, which bucketed by directory and hung the rows straight off the
 * folder heading. Both shapes that remain therefore share one invariant, and it is the one the
 * withdrawal was about: EVERY GROUP THAT HOLDS ROWS IS A FILE GROUP, and its key is those rows'
 * path. A row has no file name of its own, so a heading that is not the row's file is a row whose
 * origin the reader cannot recover.
 */
export function groupRows(rows: readonly ResultRow[], grouping: Grouping): ResultGroup[] {
  if (grouping === 'file') {
    return [...bucket(rows, (r) => r.relPath)].map(([key, held]) => fileGroup(key, held));
  }

  return [...bucket(rows, (r) => dirOf(r.relPath))].map(([key, held]) => {
    const children = [...bucket(held, (r) => r.relPath)].map(([path, own]) => fileGroup(path, own));
    return {
      key,
      kind: 'folder' as const,
      matchCount: held.length,
      stale: false,
      // A folder heading holds no rows of its own once its files are headings too — otherwise
      // every match would be reachable twice and any count over the tree would double.
      rows: [],
      children,
    };
  });
}

/** Rows within a group: by file, then by position — FR-035's rule applied inside a heading. */
function orderRows(rows: readonly ResultRow[]): readonly ResultRow[] {
  return [...rows].sort((a, b) => comparePaths(a.relPath, b.relPath, true) || a.from - b.from);
}

/**
 * FR-035, at every level. Files before sub-directories, each set alphanumerically with digits
 * before letters, and the same rule applied again to whatever nests below.
 */
export function orderGroups(groups: readonly ResultGroup[]): ResultGroup[] {
  return [...groups]
    .sort((a, b) =>
      a.kind === b.kind ? comparePaths(a.key, b.key, a.kind === 'file') : a.kind === 'file' ? -1 : 1,
    )
    .map((g) => ({ ...g, rows: orderRows(g.rows), children: orderGroups(g.children) }));
}

// ────────────────────────────────────────────────────────────────────────────
// Staleness (FR-045a, FR-045b — and FR-045c, which needs no function here; see `markStale`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Re-flag the file groups named by `changedRelPaths` (FR-045a).
 *
 * Every other property survives by identity, ROWS INCLUDED. FR-045b says the marking changes no
 * row's presence, order or actionability, and the quiet way to breach that is not to filter rows
 * but to rebuild them: the panel is holding these objects, and handing back copies turns an
 * informational flag into a re-render of the whole list.
 */
function reflag(groups: readonly ResultGroup[], keys: ReadonlySet<string>): ResultGroup[] {
  return groups.map((g) => {
    const children = reflag(g.children, keys);
    const hit = g.kind === 'file' && keys.has(g.key);
    if (!hit && children.every((c, i) => c === g.children[i])) return g;
    return { ...g, stale: hit ? true : g.stale, children };
  });
}

/**
 * FR-045a — mark the files that changed since the scan, and nothing else.
 *
 * ══ THERE IS DELIBERATELY NO `clearStale` ══
 *
 * FR-045c ("re-running the search MUST clear staleness for every file it re-scans") has no
 * function here, because a re-run leaves nothing marked to clear. The scan service drops the run's
 * `staleFiles` when it supersedes, the renderer's fold falls back to an empty set on a new
 * generation, and the panel derives these groups afresh from `groupRows` — whose `stale` is
 * `false` — on every render. One existed, exported and called only by its own unit test, and 043
 * T117 removed it: a symbol with no reachable caller is a claim that the model needs an operation
 * it does not have.
 */
export function markStale(groups: readonly ResultGroup[], changedRelPaths: readonly string[]): ResultGroup[] {
  return reflag(groups, new Set(changedRelPaths));
}
