/**
 * The Find in Files results list (043 T059) — one row per match, grouped, and WINDOWED.
 *
 * ══ WHY THIS IS WINDOWED WHEN NOTHING ELSE IN THE RENDERER IS ══
 *
 * Verified in research R18: there is no general-purpose virtualised list here. `react-arborist`
 * drives the explorer TREE and nothing else, CodeMirror's viewport virtualisation is internal to
 * the editor, and the preferences lists render every row. The nearest pattern is Quick Open's hard
 * cap — `QUICK_OPEN_MAX_ROWS = 200` with a "showing N of M" line — and this feature declines it:
 * the spec's Assumptions refuse a match ceiling, so a search for a common word in a real project
 * produces tens of thousands of rows and every one of them must be reachable.
 *
 * Rendering all of them is the thing FR-041 and SC-004 forbid. So the list keeps the whole result
 * set in the model, gives the scroller the FULL extent (the scrollbar tells the truth about how
 * much there is), and mounts only the slice on screen plus a margin.
 *
 * ══ WHY IT IS HAND-ROLLED AND NOT A DEPENDENCY ══
 *
 * A windowed list over FIXED-HEIGHT rows is a division and a slice. `react-window` would add a
 * dependency, a bundle, and an API to the packaged app for `Math.floor(scrollTop / rowHeight)` —
 * and its own measurement model, which is the part that would then have to be understood at every
 * layer that tests this list. What is genuinely hard about virtualisation is variable heights, and
 * these rows do not have them: every row and every heading is exactly one line.
 *
 * ══ WHY THE ROW HEIGHT IS COMPUTED IN TypeScript ══
 *
 * Because the arithmetic needs it and CSS cannot hand it back reliably. It is published to the
 * stylesheet as `--fif-row-height` on the list element, so the sheet and the maths cannot disagree:
 * there is one number, and the CSS reads it rather than restating it.
 *
 * FR-062 made that number a FUNCTION of the panel's zoom level rather than a constant, and did not
 * change where it is decided — see {@link resultRowHeightPx} for why the multiplication and its
 * rounding stay on this side of the boundary.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type UIEvent,
} from 'react';
import { formatGrouped, zoomFactor, type ResultGroup, type ResultRow } from '@throng/core';
import { committedWrite, type CommittedEdits, type CommittedWrite } from './find-in-files-store.js';
import { Icon } from '../common/icon.js';

/**
 * One line, headings and rows alike, at zoom level 0 — the BASE the live row height is derived from.
 *
 * It stopped being *the* row height when FR-062 gave the panel per-panel zoom: what every consumer
 * actually uses is {@link resultRowHeightPx}, and this is what that returns at level 0.
 */
export const RESULT_ROW_HEIGHT_PX = 22;

/**
 * The row height at a given zoom level — rounded ONCE, here, in JavaScript (FR-062, research R26).
 *
 * ══ WHY CSS IS TOLD THE ANSWER AND NEVER ASKED TO COMPUTE IT ══
 *
 * The stylesheet reads this number through `--fif-row-height`, and the windowing arithmetic below
 * divides and multiplies by it in five places. The two must agree EXACTLY, which rules out the
 * obvious implementation: `height: calc(var(--fif-row-height) * var(--throng-zoom-fif))` hands the
 * browser a fractional pixel — 22 × 1.2 = 26.4 — to round by its own rules, while this file would be
 * rounding the same product by ours.
 *
 * A disagreement there is not cosmetic, because the sizer's height is `items.length ×` the number.
 * Half a pixel per row is 250 px of drift by the 500th row of a long result set: the mounted window
 * sits a quarter of a screen from where the scroll offset says it does, which is rows overlapping at
 * one end of the range and gaps at the other.
 *
 * `terminal-panel.tsx` rounds its font size to a whole pixel for the same structural reason — xterm
 * measures its own cells and cannot be allowed to disagree with the grid it is drawn on.
 */
export function resultRowHeightPx(zoomLevel: number): number {
  return Math.round(RESULT_ROW_HEIGHT_PX * zoomFactor(zoomLevel));
}

/**
 * The class a match ROW carries — the one thing that distinguishes "the pointer was on a match"
 * from "the pointer was anywhere else in this panel".
 *
 * Exported because the panel's own context-menu handler is what has to make that distinction: the
 * commit granularities that act on ONE row must not fire when the menu was opened over a heading,
 * the toolbar or the empty space under the last row. A literal string there would go stale silently
 * the day this class is renamed, and the failure would be a write aimed at the wrong file.
 */
export const RESULT_ROW_CLASS = 'fif-row';

/**
 * Rows mounted beyond each edge of the viewport.
 *
 * Not a performance dial: it is what keeps a fast scroll from showing a band of empty list before
 * React commits the next window. Small, because every one of them is a row that is rendered and
 * not looked at.
 */
export const RESULT_LIST_OVERSCAN = 6;

/**
 * The viewport height assumed until the element reports one.
 *
 * A measured `clientHeight` of 0 is not a viewport of zero rows — it is an element that has not
 * been laid out yet (or a jsdom, which has no layout at all). Treating it as zero would render an
 * empty list and never recover, so a measurement is adopted only when it is a real one.
 */
export const DEFAULT_VIEWPORT_PX = 480;

/** A heading or a match, flattened into the single sequence the window slices. */
export type ResultListItem =
  | { kind: 'group'; key: string; depth: number; group: ResultGroup; collapsed: boolean }
  | { kind: 'row'; key: string; depth: number; row: ResultRow };

/**
 * Flatten the group tree into the list as it is READ, honouring collapse (FR-034).
 *
 * A collapsed group keeps its heading and drops its contents — it stays present, showing how many
 * matches it holds, which is the whole of what collapsing means here.
 *
 * ══ WHY A ROW CARRIES NO STALENESS OF ITS OWN (043 T147, FR-073) ══
 *
 * SC-012 is per FILE, under every grouping, and `ResultGroup.stale` is only ever true for a
 * `kind: 'file'` group — a folder is not a file, and marking one would report every sibling that
 * did not change. T116 added a per-ROW marking because one grouping, `'folder'`, hung rows straight
 * off a folder heading and so left no file heading to carry the flag.
 *
 * FR-073 withdrew that grouping. Both groupings that remain put every row under a heading naming
 * its file, so the row marking became unreachable — and an unreachable branch here is worse than
 * dead weight: it is a second place one condition could be said, which is the failure the marking
 * was carefully placed to avoid in the first place. The heading is the only place it is said.
 */
export function flattenGroups(
  groups: readonly ResultGroup[],
  collapsed: ReadonlySet<string>,
  depth = 0,
): ResultListItem[] {
  const out: ResultListItem[] = [];
  for (const group of groups) {
    const isCollapsed = collapsed.has(group.key);
    out.push({ kind: 'group', key: group.key, depth, group, collapsed: isCollapsed });
    if (isCollapsed) continue;
    for (const row of group.rows) {
      out.push({ kind: 'row', key: `${row.relPath}:${row.from}`, depth: depth + 1, row });
    }
    out.push(...flattenGroups(group.children, collapsed, depth + 1));
  }
  return out;
}

/**
 * The slice of `count` items that a viewport at `scrollTop` can see, plus the overscan margin.
 *
 * `rowHeightPx` is a REQUIRED argument rather than a defaulted one, and that is the point of the
 * change: it closed over `RESULT_ROW_HEIGHT_PX`, so at any zoom level above 0 it divided the scroll
 * offset by 22 while the rows on screen were 26 or 32 tall — mounting a slice tens of rows from what
 * the user was looking at. A default here would let a caller forget the argument and reintroduce
 * exactly that, silently.
 */
export function visibleRange(
  count: number,
  scrollTop: number,
  viewportPx: number,
  rowHeightPx: number,
  overscan: number = RESULT_LIST_OVERSCAN,
): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };
  const firstVisible = Math.floor(Math.max(0, scrollTop) / rowHeightPx);
  const start = Math.max(0, Math.min(firstVisible - overscan, count - 1));
  const rows = Math.ceil(Math.max(0, viewportPx) / rowHeightPx) + overscan * 2 + 1;
  return { start, end: Math.min(count, start + rows) };
}

export interface ResultsListProps {
  panelId: string;
  groups: readonly ResultGroup[];
  /**
   * The run these rows came from.
   *
   * A change is a NEW LIST, not a longer one: the reading position and the scroll offset are both
   * statements about rows this list no longer holds, so both start over. Passed in rather than
   * expressed as a `key` at the call site, because a remount is invisible from inside this file and
   * this is behaviour the component owes.
   */
  generation: number;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  /**
   * FR-047 — the proposed replacement, or `null` when replace is put away.
   *
   * `null` rather than `''`, because the two mean different things and the difference is exactly
   * FR-046a's: replace OFF renders an ordinary match; replace ON with an empty replacement renders
   * a struck-through match with nothing after it, which is how a deletion reads as a deletion
   * rather than as an unfinished edit.
   */
  replacement: string | null;
  /** FR-051 — the matches a commit has written, by file and scanned offset. */
  committed: CommittedEdits;
  /**
   * The row the reading position is on, published so the panel can commit "this match" and "this
   * file" (FR-049). The list owns WHERE the position is; what may be done to the row under it is
   * not the list's business.
   */
  onCurrentChange?: (row: ResultRow | null) => void;
  /**
   * 043 FR-037 — open the row's file, at the match.
   *
   * The list decides WHICH row (a double-click, or Enter on the current one) and nothing else. Where
   * the file lands is the "Open files in" preference's business, and this component has no route to
   * it — see `find-in-files-panel.tsx`.
   */
  onOpenRow: (row: ResultRow) => void;
  /**
   * The height of one row at the PANEL's zoom level (FR-062), already rounded to a whole pixel.
   *
   * Computed by the panel from `resultRowHeightPx(panelZoomLevel(panel))` and passed in rather than
   * derived here, because the panel is what holds the `Panel` — and because there must be exactly
   * one rounding: this number is threaded through every calculation below AND published to the
   * stylesheet, and R26's whole finding is that those two cannot be allowed to round separately.
   */
  rowHeightPx: number;
}

export function ResultsList({
  panelId,
  groups,
  generation,
  collapsed,
  onToggleGroup,
  onOpenRow,
  replacement,
  committed,
  onCurrentChange,
  rowHeightPx,
}: ResultsListProps): ReactElement {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT_PX);
  /**
   * The row the match-CURRENT highlight belongs to (FR-044's second token).
   *
   * Navigational input, so it is exempt from the every-action-has-a-menu-item rule and carries no
   * command: it moves the reading position and does nothing else. What OPENS the row it lands on is
   * `onOpenRow` (FR-037, Enter and double-click) — which arrived as a handler for exactly the reason
   * the position is kept here: so there is not a second model of where the user is.
   */
  const [current, setCurrent] = useState(0);

  /*
   * A NEW RUN starts the reading position and the scroll offset over.
   *
   * Adjusted during the render that first sees the new generation rather than in an effect: an
   * effect would commit one frame holding the old position — long enough for a keystroke to act on
   * a row from a search the user has already replaced.
   */
  const [seenGeneration, setSeenGeneration] = useState(generation);
  if (seenGeneration !== generation) {
    setSeenGeneration(generation);
    setCurrent(0);
    setScrollTop(0);
  }

  const items = useMemo(
    () => flattenGroups(groups, collapsed),
    [groups, collapsed],
  );

  /*
   * ══ THE TWO NUMBERS ARE CLAMPED AGAINST THE LIST THAT IS ACTUALLY THERE ══
   *
   * Both are state, and the list under them shrinks without touching either: collapsing a group is
   * the ordinary way, and it removes rows the user may have stepped past.
   *
   * An out-of-range POSITION is not a cosmetic problem. `items[current]` is `undefined`, so Enter
   * returns before it does anything and no row carries `aria-current` to explain the silence; the
   * next ArrowUp then writes a `scrollTop` far past the now-short content, `visibleRange` clamps
   * `start` to the last item, and the list mounts exactly ONE row. That state is unrecoverable by
   * scrolling, because content shorter than its viewport produces no scrollbar and therefore no
   * scroll event.
   *
   * So both are derived per render rather than corrected by an effect — there is no frame in which
   * the window is computed from a number that describes a different list.
   */
  const position = items.length === 0 ? 0 : Math.min(current, items.length - 1);
  const maxScrollTop = Math.max(0, items.length * rowHeightPx - viewport);
  const offset = Math.min(scrollTop, maxScrollTop);

  const { start, end } = visibleRange(items.length, offset, viewport, rowHeightPx);

  /**
   * Move the reading position and tell the panel which row it landed on.
   *
   * One helper rather than a `useEffect` on `current`, deliberately: an effect would also fire when
   * the LIST changed under a stationary cursor, republishing a row the user never moved to — and a
   * commit granularity computed from that is a write aimed at a row nobody pointed at.
   */
  const moveTo = useCallback(
    (index: number): void => {
      setCurrent(index);
      const item = items[index];
      onCurrentChange?.(item?.kind === 'row' ? item.row : null);
    },
    [items, onCurrentChange],
  );

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    setScrollTop(el.scrollTop);
    if (el.clientHeight > 0) setViewport(el.clientHeight);
  }, []);

  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /*
   * ══ WHY THE VIEWPORT IS OBSERVED AND NOT JUST MEASURED ══
   *
   * `.fif-results` is `flex: 1 1 auto`, so it grows and shrinks with the Panel it is tiled in — a
   * split drag, a maximise, the sidebar being hidden, the replace row being put away. A height read
   * once on mount is therefore a height that stops being true almost immediately, and the mounted
   * slice would stay sized for a panel that is no longer that size.
   *
   * The failure is not "a bit of blank space". Once the panel is taller than the content the window
   * decided to mount, there is nothing to scroll — no scrollbar, no scroll event, and no way to
   * reach the rest of the matches with a mouse at all.
   *
   * `file-tree.tsx`, `editor/status-strip.tsx`, `vertical-panel-stack.tsx`, `tab-group.tsx` and
   * `use-terminal.ts` all answer this the same way, and the guard is not defensiveness: jsdom
   * implements no `ResizeObserver`, so without it every component test rendering this list would
   * throw on mount.
   */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // A measured 0 is an element with no layout yet (or a jsdom), never a viewport of no rows.
    if (el.clientHeight > 0) setViewport(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (typeof height === 'number' && height > 0) setViewport(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const last = items.length - 1;
    /*
     * Enter opens the row the arrow keys landed on (FR-037, Assumptions).
     *
     * The keyboard reaches the same opener the double-click does, rather than a second path that
     * has to be kept in step — FR-037 names double-click because that is what the issue specified,
     * and the spec's own Assumptions say it is not meant to be the only way in.
     *
     * On a GROUP heading, Enter collapses or expands it: that is what "open" means for a heading,
     * and there is no file under the cursor to open.
     */
    if (event.key === 'Enter') {
      const item = items[position];
      if (!item) return;
      event.preventDefault();
      if (item.kind === 'row') onOpenRow(item.row);
      else onToggleGroup(item.group.key);
      return;
    }
    const next =
      event.key === 'ArrowDown'
        ? Math.min(last, position + 1)
        : event.key === 'ArrowUp'
          ? Math.max(0, position - 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : position;
    if (next === position) return;
    event.preventDefault();
    moveTo(next);
    // Keep the position inside the window. jsdom has no layout so this is a no-op there, which is
    // exactly why "the row is scrolled into view" stays an E2E-tier claim.
    const top = next * rowHeightPx;
    if (top < offset) setScrollTop(top);
    else if (top + rowHeightPx > offset + viewport) {
      setScrollTop(top + rowHeightPx - viewport);
    }
  };

  return (
    <div
      className="fif-results"
      data-testid={`fif-results-${panelId}`}
      ref={scrollerRef}
      role="list"
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      // The one number the maths and the stylesheet share — already rounded, never a `calc()` for
      // the browser to round again (R26).
      style={{ ['--fif-row-height']: `${rowHeightPx}px` } as CSSProperties}
    >
      <div
        className="fif-results__sizer"
        data-testid={`fif-sizer-${panelId}`}
        style={{ height: `${items.length * rowHeightPx}px` }}
      >
        <div
          className="fif-results__window"
          style={{ transform: `translateY(${start * rowHeightPx}px)` }}
        >
          {items.slice(start, end).map((item, i) =>
            item.kind === 'group'
              ? renderGroup(item, onToggleGroup)
              : renderRow(
                  item,
                  start + i === position,
                  () => {
                    moveTo(start + i);
                    onOpenRow(item.row);
                  },
                  // A right-click NAMES the row the commit granularities act on, so it moves the
                  // position before the menu is built. It does not stop the event: the panel's own
                  // handler, one level up, is what opens the menu (FR-025a).
                  () => moveTo(start + i),
                  replacement,
                  committedWrite(committed, item.row),
                ),
          )}
        </div>
      </div>
    </div>
  );
}

function renderGroup(
  item: Extract<ResultListItem, { kind: 'group' }>,
  onToggle: (key: string) => void,
): ReactElement {
  const { group, collapsed, depth } = item;
  return (
    <div
      key={`g:${group.key}`}
      className="fif-group"
      role="listitem"
      data-testid={`fif-group-header-${group.key}`}
      data-group-key={group.key}
      data-group-kind={group.kind}
      data-depth={depth}
      data-stale={group.stale ? 'true' : undefined}
      style={{ paddingLeft: `${4 + depth * 14}px` }}
      /*
       * FR-071 — a DOUBLE-click toggles the group, following `tree-node.tsx`'s shipped resolution
       * of exactly this pairing rather than inventing a second one.
       *
       * A single click deliberately does nothing: the heading is not a selectable row here, and
       * collapsing a group on every stray click through the list is the behaviour #121 removed from
       * the tree. The MODIFIER guard is `tree-node.tsx`'s, widened to `alt`: its three are the
       * multi-select set, and this list has no selection model, so "a modifier key" has no narrower
       * reading to inherit — a modified double-click is somebody reaching for a gesture this surface
       * does not offer, and doing something else instead is worse than doing nothing.
       *
       * No menu item is owed: per-group toggling and collapse-all are already in the panel's menu,
       * and this is an accelerator over them.
       */
      onDoubleClick={(event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        onToggle(group.key);
      }}
    >
      {/*
        Two static <Icon> elements rather than one with a computed token: `icon-tokens-exist` can
        only check a literal, and a mistyped token renders NOTHING — an invisible control with no
        error anywhere. The title names what the CLICK will do, so it changes with the state.
      */}
      <button
        type="button"
        className="fif-btn fif-group__toggle"
        data-testid={`fif-group-toggle-${group.key}`}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand group' : 'Collapse group'}
        onClick={() => onToggle(group.key)}
        /*
         * FR-071's second trap, and the reason it needs saying: this control sits INSIDE the heading
         * that now toggles on double-click, so a double-click landing on it runs two clicks — two
         * toggles, which correctly cancel — and would then bubble a `dblclick` to the heading for a
         * THIRD, leaving the group in the opposite state from the one the user's clicks produced.
         * `tree-node.tsx` stops it the same way on the tree's twisty.
         */
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {collapsed ? <Icon token="chevronRight" /> : <Icon token="chevronDown" />}
      </button>
      <span className="fif-group__icon" aria-hidden="true">
        {group.kind === 'file' ? <Icon token="file" /> : <Icon token="folder" />}
      </span>
      <span className="fif-group__key">{group.key === '' ? '/' : group.key}</span>
      {/* FR-014 — a collapsed group's count is the only place its size is readable. */}
      <span className="fif-group__count" data-testid={`fif-group-count-${group.key}`}>
        {formatGrouped(group.matchCount)}
      </span>
      {group.stale ? (
        <span className="fif-group__stale" data-testid={`fif-group-stale-${group.key}`}>
          changed since the search
        </span>
      ) : null}
    </div>
  );
}

function renderRow(
  item: Extract<ResultListItem, { kind: 'row' }>,
  current: boolean,
  onOpen: () => void,
  onPoint: () => void,
  replacement: string | null,
  /** What this panel wrote here, or `undefined` while the match is still pending (FR-083). */
  write: CommittedWrite | undefined,
): ReactElement {
  const { row, depth } = item;
  const committed = write !== undefined;
  /*
   * ══ WHAT A COMMITTED ROW IS RENDERED FROM, AND WHY IT IS NOT THE SCAN'S SNIPPET (FR-083) ══
   *
   * `row.snippet` describes the file as it was when the scan read it, and this panel has since
   * written to it. So a committed row takes main's re-derivation — one snippet per write, computed
   * from the whole NEW text, which is what makes two matches on ONE line agree with each other
   * (FR-083b) rather than each showing the other's old word.
   *
   * The fallback matters and is not a shortcut: past `MAX_COMMIT_SNIPPET_CHARS` there is no
   * re-derived snippet, and the row is still committed. It then shows the scan's own context with
   * the text that was WRITTEN in place of the match — right about itself, possibly still carrying a
   * same-line neighbour's old word. `write.replacement`, never `replacement`: the box may have been
   * edited since, and this row's text is what landed in the file.
   */
  const snippet = write
    ? (write.snippet ?? { ...row.snippet, matched: write.replacement })
    : row.snippet;
  // FR-083a supersedes FR-047's "every row": a committed row is no longer a proposal, so it is not
  // struck through and nothing follows it.
  const previewing = replacement !== null && !committed;
  return (
    <div
      key={`r:${item.key}`}
      className={`${RESULT_ROW_CLASS}${committed ? ' fif-row--committed' : ''}`}
      role="listitem"
      data-testid={`fif-row-${row.relPath}-${row.from}`}
      data-rel-path={row.relPath}
      // FR-045a is said on the FILE HEADING and nowhere else — see `flattenGroups` for why the row
      // no longer carries it. FR-045b's four negatives ("nothing is disabled, hidden, greyed or
      // reordered") are true here by construction: a row has no staleness to render.
      data-current={current ? 'true' : undefined}
      // FR-051 — a committed match is visibly distinguishable from one still pending. An attribute
      // as well as a class, because it is state a reader (and a test) asks about, not decoration.
      data-committed={committed ? 'true' : undefined}
      aria-current={current ? 'true' : undefined}
      title={`${row.relPath}:${row.line}:${row.column}`}
      style={{ paddingLeft: `${4 + depth * 14}px` }}
      // FR-037 — a DOUBLE-click opens. A single click would open a file on every step through the
      // list, which is navigation, not a decision the user made.
      onDoubleClick={onOpen}
      onContextMenu={onPoint}
    >
      {/* Grouped like every other displayed quantity, and like the editor's own status readouts. */}
      <span className="fif-row__pos">
        {formatGrouped(row.line)}:{formatGrouped(row.column)}
      </span>
      <span className="fif-row__snippet">
        {/*
          FR-036 — the ellipsis marks TRUNCATION, not the presence of context. A match near the
          start of a short line has text before it and no ellipsis, because nothing was cut.
        */}
        {snippet.truncatedStart ? (
          <span className="fif-ellipsis" data-testid="fif-ellipsis-start" aria-hidden="true">
            …
          </span>
        ) : null}
        {snippet.before}
        {/*
          FR-047 — while replace is on the match is STRUCK THROUGH and the proposed replacement
          follows it, so before-and-after reads on one row.
        */}
        <mark
          className={`fif-match${previewing ? ' fif-match--struck' : ''}`}
          data-testid="fif-match"
        >
          {snippet.matched}
        </mark>
        {/*
          FR-046a — an EMPTY replacement renders nothing after the struck match. Not an empty
          element: a deletion must read as a deletion, and a zero-width box after the strike reads
          as an edit the user has not finished typing.
        */}
        {previewing && replacement !== '' ? (
          <ins className="fif-replacement" data-testid="fif-replacement">
            {replacement}
          </ins>
        ) : null}
        {snippet.after}
        {snippet.truncatedEnd ? (
          <span className="fif-ellipsis" data-testid="fif-ellipsis-end" aria-hidden="true">
            …
          </span>
        ) : null}
      </span>
    </div>
  );
}
