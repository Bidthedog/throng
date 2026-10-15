import { useMemo, useState } from 'react';
import { groupCounts, type DescriptorGroup } from './group-descriptors.js';
import { defaultFolded, readFolds, sectionsOpenByDefault, writeFolds, type FoldTab } from './preferences-folds.js';

/**
 * One tab's fold state (056 FR-008..FR-011b, data-model "Effective fold state", research R6).
 *
 *     folded(key) = filter applied ? searchFolds.has(key) : persisted.get(key) ?? defaultFolded(key)   (gap: below)
 *
 * ══ THE DEFAULT, AND THE USER'S CHOICE (FR-016, FR-017) ══
 *
 * `persisted` holds the user's EXPLICIT choice per heading. A heading with none takes `defaultFolded`: a
 * section folded, a subgroup or subsection unfolded. A toggle records the flipped EFFECTIVE value, so
 * unfolding a defaulted section stores `false` and survives a restart. Expand All records `false` and
 * Collapse All `true` for every current key. The test seam (`foldDefault=open`, research R10) is read once
 * per mount; it only moves the section default.
 *
 * ══ A SEARCH NEVER WRITES, SO THERE IS NOTHING TO RESTORE ══
 *
 * While a search is active every rendered heading reads unfolded (FR-008), apart from toggles made during
 * that search, which live in a transient set. The persisted set is never touched by a search, so "return
 * to the state it had immediately before the search began" (FR-009) needs no snapshot: when the search
 * clears the persisted set simply renders again, and the transient set is discarded. The temporary
 * unfolding a search causes is therefore never stored (FR-011).
 *
 * ══ ONE DEFINITION OF "SEARCHING" ══
 *
 * {@link isSearching}: the box text OR the applied query is non-blank once trimmed. The box text counts
 * because the filter is debounced — between a keystroke and the filter landing there is a window in which
 * a click would otherwise be written as a real fold the search then "discards" by never having stored it
 * in the right place. Trimmed because `filterFields` treats a whitespace-only query as no query at all
 * (`searchTokens`), so it shows everything and nothing is a match. The bulk buttons use the same answer.
 *
 * ══ THE GAP KEEPS THE DISPLAY ══
 *
 * In that window (box text non-blank, applied query still blank) the rows are all still on screen, so
 * the display stays on the persisted folds rather than flashing everything open for the length of a
 * debounce. Clicks are routed to the transient set as flips of what is shown and are never written;
 * the bulk buttons stay disabled. The display switches to search-unfolded only once the filter lands.
 *
 * ══ THE TRANSIENT SET DIES WITH THE SEARCH ══
 *
 * It is tagged with the applied query it was made under and read as empty under any other (resets when
 * the query changes, without an effect that would render one frame of the old search's folds under the
 * new one), and it is dropped outright the render the search ends — tagging alone would let the SAME
 * query, searched again, bring a discarded toggle back (FR-009).
 *
 * `currentKeys` is every heading key in the tab's UNFILTERED registry. It bounds Expand/Collapse All and
 * lets a write prune keys naming vanished headings (FR-011a).
 */
export interface PreferenceFolds {
  isFolded: (key: string) => boolean;
  toggle: (key: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /** Is a search active ({@link isSearching})? The tabs disable Expand/Collapse All on this. */
  searching: boolean;
}

/** The single answer to "is a search active?" — see the docblock above. */
export function isSearching(query: string, applied: string): boolean {
  return query.trim() !== '' || applied.trim() !== '';
}

const NONE: ReadonlySet<string> = new Set();

/** A stable empty list: a fresh `[]` default per render would defeat the memo below (Principle XII). */
const NO_KEYS: readonly string[] = Object.freeze([]);

/** What a heading's count label needs: the unfiltered total, plus the match count while searching. */
export interface FoldCount {
  total: number;
  matches?: number | undefined;
}

/**
 * The fold wiring each of the three tabs repeated, once (056 FR-013: "through the one shared rendering").
 *
 * `all` is the grouping of the tab's UNFILTERED registry — it yields the totals (FR-006) and the set of
 * keys that currently exist (FR-011a). `shown` is the grouping of what survives the search — it yields
 * the match counts. Both are memoised on the grouping the tab already memoises, so nothing here runs per
 * keystroke or per fold (Principle XII). `extraKeys` names headings the registry does not hold (the
 * Themes tab's hand-built Icons section), so Expand/Collapse All and the write-time prune cover them.
 */
export function useTabFolding(
  tab: FoldTab,
  query: string,
  applied: string,
  all: readonly DescriptorGroup[],
  shown: readonly DescriptorGroup[],
  extraKeys: readonly string[] = NO_KEYS,
): { folds: PreferenceFolds; countOf: (key: string) => FoldCount } {
  const totals = useMemo(() => groupCounts(all), [all]);
  const matched = useMemo(() => groupCounts(shown), [shown]);
  const currentKeys = useMemo(() => new Set([...totals.keys(), ...extraKeys]), [totals, extraKeys]);
  const folds = usePreferenceFolds(tab, query, applied, currentKeys);
  // The labels follow what the FILTER shows, so they read "N of M" only once it has been applied.
  const filtered = applied.trim() !== '';
  return {
    folds,
    countOf: (key) => ({ total: totals.get(key) ?? 0, matches: filtered ? (matched.get(key) ?? 0) : undefined }),
  };
}

export function usePreferenceFolds(
  tab: FoldTab,
  query: string,
  applied: string,
  currentKeys: ReadonlySet<string>,
): PreferenceFolds {
  const [persisted, setPersisted] = useState<ReadonlyMap<string, boolean>>(() => readFolds(tab));
  const [sectionsOpen] = useState(sectionsOpenByDefault);
  // Each key's default, computed once per key set so `isFolded` (called per heading per render) is a map
  // lookup rather than a JSON.parse (Principle XII). A key outside the set falls back to the same function.
  const defaults = useMemo(
    () => new Map([...currentKeys].map((k): [string, boolean] => [k, defaultFolded(k, sectionsOpen)])),
    [currentKeys, sectionsOpen],
  );
  const persistedFolded = (key: string): boolean =>
    persisted.get(key) ?? defaults.get(key) ?? defaultFolded(key, sectionsOpen);
  const [search, setSearch] = useState<{ query: string; folded: ReadonlySet<string> }>({
    query: '',
    folded: NONE,
  });
  const searching = isSearching(query, applied);
  const tag = applied.trim();
  // The search is over: discard what it held. Set during render (React's documented derived-state
  // pattern) so no frame renders the old toggles; the guard stops it looping.
  if (!searching && search.folded.size > 0) setSearch({ query: '', folded: NONE });
  const searchFolds = searching && search.query === tag ? search.folded : NONE;

  const flip = (set: ReadonlySet<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (!next.delete(key)) next.add(key);
    return next;
  };

  const commit = (next: ReadonlyMap<string, boolean>): void => {
    setPersisted(next);
    writeFolds(tab, next, currentKeys);
  };

  // The DEBOUNCE GAP: the box has text but the filter has not landed, so every row is still on screen.
  // The display stays on the persisted folds (no unfold flash on the first keystroke); a click is shown
  // as a flip of what is displayed, held in the transient set (tag ''), and still never written.
  const gap = searching && tag === '';
  return {
    searching,
    isFolded: (key) => {
      if (!searching) return persistedFolded(key);
      if (gap) return persistedFolded(key) !== searchFolds.has(key);
      return searchFolds.has(key);
    },
    toggle: (key) => {
      if (searching) {
        setSearch({ query: tag, folded: flip(searchFolds, key) });
        return;
      }
      commit(new Map(persisted).set(key, !persistedFolded(key)));
    },
    // Both bulk actions are disabled during a search (FR-011b); the guard keeps a stray call from
    // writing the persisted set under a search that owns the display.
    expandAll: () => {
      if (!searching) commit(new Map([...currentKeys].map((k): [string, boolean] => [k, false])));
    },
    collapseAll: () => {
      if (!searching) commit(new Map([...currentKeys].map((k): [string, boolean] => [k, true])));
    },
  };
}
