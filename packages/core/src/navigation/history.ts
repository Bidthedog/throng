/**
 * A panel's navigation history (044, FR-100 – FR-112, #136, data-model §4, research R14).
 *
 * A pure reducer. `NavigationHistoryService` in main decides WHEN to call these functions and every
 * window only renders what they return, so "Back then Forward returns exactly to where the user was"
 * (SC-007) is a property of this module or of nothing — which is why the invariants below are unit
 * tested, and SC-007 is a seeded property test over random op sequences.
 *
 * | #   | Invariant                                                                                    |
 * |-----|----------------------------------------------------------------------------------------------|
 * | H1  | `entries.length === 0 ⇔ index === -1`; otherwise `0 ≤ index < entries.length`               |
 * | H2  | `recordOpen` with the current entry's path (however spelled) returns `h` unchanged           |
 * | H2a | After `rewriteCurrent` or `rewritePaths`, entries the rewrite made adjacent and one file merge |
 * | H3  | `recordOpen` otherwise discards the newer entries and appends — even if the path is earlier  |
 * | H4  | `moveTo` changes `index` only; `entries` is identical by reference                            |
 * | H5  | `moveTo(moveTo(h, i), h.index)` equals `h`                                                    |
 * | H6  | `applyCap` drops oldest first, never the current entry                                        |
 * | H7  | `rewritePaths` follows a moved file or folder; order kept, `index` shifts only for H2a merges |
 * | H8  | `rewriteCurrent` on an empty history is `recordOpen`                                          |
 * | H9  | `viewState` survives `moveTo` and `rewritePaths`; it is only ever set on the current entry   |
 * | H10 | Editor entries never carry `viewState` (nothing here adds one unasked)                        |
 * | H11 | `recordJump` on an empty history returns it unchanged                                        |
 * | H12 | No two consecutive entries name one file at an equal place — after ANY op (T219)              |
 * | H13 | `recordJump` otherwise truncates, appends one entry for the CURRENT file, and applies the cap |
 * | H14 | `moveTo` / `targetOf` treat a same-file neighbour like any other                              |
 * | H15 | `parseHistory` keeps consecutive same-file entries whose places differ                       |
 *
 * H2a and H7 are reconciled with FR-115 (iteration 2026-09-15): merging adjacent same-file entries undoes
 * what a rewrite FUSED; a preview's jump chain named one file before the rewrite and is never merged.
 *
 * Every function returns its input BY IDENTITY when it changes nothing, so a caller can skip a
 * broadcast or a layout write with `===`.
 *
 * Pure: no OS, no DOM.
 */
import { remainderUnder, samePath } from '../fs/path-id.js';
import type { PersistedHistory } from '../workspace/model.js';

export interface NavigationEntry {
  /** Absolute path, in storage canon once persisted (FR-068, FR-109). */
  filePath: string;
  /** Preview entries only: provider-owned JSON, at most {@link MAX_VIEW_STATE_BYTES} serialised (FR-101). */
  viewState?: unknown;
}

export interface NavigationHistory {
  entries: readonly NavigationEntry[];
  /** -1 only when `entries` is empty. */
  index: number;
}

/**
 * The largest `viewState` kept, in UTF-8 bytes of its JSON (FR-101). A named constant rather than a
 * setting: it bounds what a provider may store per entry in the layout blob, which no user would tune
 * (recorded as a Principle X deviation in the plan's Complexity Tracking).
 */
export const MAX_VIEW_STATE_BYTES = 1024;

export const EMPTY_HISTORY: NavigationHistory = Object.freeze({
  entries: Object.freeze([]) as readonly NavigationEntry[],
  index: -1,
});

function normaliseCap(cap: number): number {
  return Number.isNaN(cap) ? 1 : Math.max(1, Math.floor(cap));
}

/** UTF-8 byte length, counted by code point — core has no `TextEncoder` in its lib. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Whether `viewState` is JSON that fits the limit. */
function keepableViewState(viewState: unknown): boolean {
  let json: string | undefined;
  try {
    json = JSON.stringify(viewState);
  } catch {
    return false;
  }
  return typeof json === 'string' && utf8Bytes(json) <= MAX_VIEW_STATE_BYTES;
}

export function recordOpen(h: NavigationHistory, filePath: string, cap: number): NavigationHistory {
  const current = h.entries[h.index];
  if (current !== undefined && samePath(current.filePath, filePath)) return h;
  const entries = [...h.entries.slice(0, h.index + 1), { filePath }];
  return applyCap({ entries, index: entries.length - 1 }, cap);
}

export function moveTo(h: NavigationHistory, index: number): NavigationHistory {
  if (!Number.isInteger(index) || index < 0 || index >= h.entries.length || index === h.index) return h;
  return { entries: h.entries, index };
}

export function canGoBack(h: NavigationHistory): boolean {
  return h.index > 0;
}

export function canGoForward(h: NavigationHistory): boolean {
  return h.index >= 0 && h.index < h.entries.length - 1;
}

export function targetOf(
  h: NavigationHistory,
  dir: 'back' | 'forward',
): { index: number; entry: NavigationEntry } | null {
  const possible = dir === 'back' ? canGoBack(h) : canGoForward(h);
  if (!possible) return null;
  const index = dir === 'back' ? h.index - 1 : h.index + 1;
  return { index, entry: h.entries[index] };
}

/**
 * At most `cap` entries (FR-108). Older entries go first; once none older than the current one is
 * left, the newest go — the current entry never does, so a cap of one keeps exactly it.
 */
export function applyCap(h: NavigationHistory, cap: number): NavigationHistory {
  const limit = normaliseCap(cap);
  const excess = h.entries.length - limit;
  if (excess <= 0) return h;
  const fromFront = Math.min(excess, h.index);
  const fromBack = excess - fromFront;
  const entries = h.entries.slice(fromFront, h.entries.length - fromBack);
  return { entries, index: h.index - fromFront };
}

/** Where `path` lands after `move`, or `null` when the move does not touch it. */
function movedPath(path: string, move: { from: string; to: string }): string | null {
  if (samePath(path, move.from)) return move.to;
  // The tail keeps the ORIGINAL spelling's names — their case — and is cut by segments, not by the
  // folder's normalised length, which lower-casing can lengthen (`İ`; `remainderUnder`).
  const remainder = remainderUnder(path, move.from);
  if (remainder === null) return null;
  // Its SEPARATORS are the destination's, though. The tail was spelled by whoever produced the old
  // path, and joining it verbatim onto `to` wrote a mixed path (`D:/q\a.md`). This module already
  // treats `\` and `/` as one separator (`samePath`, `isUnderPath`), so rewriting them in the tail
  // names the same file; a destination that carries a backslash is Windows-spelled.
  const sep = move.to.includes('\\') ? '\\' : '/';
  return move.to.replace(/[\\/]+$/, '') + remainder.replace(/[\\/]+/g, sep);
}

/**
 * Every entry follows a moved file or folder (FR-109, H7).
 *
 * H2a: a move can make two ADJACENT entries name one file — the history still names a file that is gone
 * from disk, and another is renamed onto it: `[a, b]`, delete `a.md`, rename `b.md` to `a.md`. Such a run
 * merges ({@link mergeFused}). Without it Back moved the position and showed the same file. A preview's
 * jump chain (FR-115) named one file before the move and still does after it: it moves whole, never fused.
 */
export function rewritePaths(
  h: NavigationHistory,
  moves: readonly { from: string; to: string }[],
): NavigationHistory {
  let changed = false;
  const entries = h.entries.map((entry) => {
    for (const move of moves) {
      const next = movedPath(entry.filePath, move);
      if (next === null) continue;
      if (next === entry.filePath) return entry;
      changed = true;
      return { ...entry, filePath: next };
    }
    return entry;
  });
  if (!changed) return h;
  return mergeFused(h.entries, entries, h.index);
}

/**
 * H2a, reconciled with FR-115 — collapse what a rewrite FUSED, and nothing it did not.
 *
 * `before` and `after` are the same list either side of a path rewrite. A CHAIN is a stretch of adjacent
 * entries that named one file before it — a preview's jump chain, or a single entry. A RUN is a stretch of
 * adjacent entries that name one file after it: one chain, or several the rewrite put side by side. A run
 * keeps ONE chain whole, each entry with its `viewState` — the chain holding `index` when it has one, else
 * its first — and drops the rest; `index` moves back by the entries dropped before it. So two jump entries
 * at different headings of one file are never merged, because they were never two files.
 */
function mergeFused(
  before: readonly NavigationEntry[],
  after: readonly NavigationEntry[],
  index: number,
): NavigationHistory {
  const kept: NavigationEntry[] = [];
  let nextIndex = index;
  let runStart = 0;
  while (runStart < after.length) {
    let runEnd = runStart;
    while (runEnd + 1 < after.length && samePath(after[runEnd + 1]!.filePath, after[runStart]!.filePath)) runEnd += 1;
    // The chains inside the run: a boundary wherever the two entries named different files BEFORE.
    const chains: Array<[number, number]> = [];
    let chainStart = runStart;
    for (let i = runStart + 1; i <= runEnd + 1; i += 1) {
      if (i > runEnd || !samePath(before[i - 1]!.filePath, before[i]!.filePath)) {
        chains.push([chainStart, i - 1]);
        chainStart = i;
      }
    }
    // The current entry is always in its run's kept chain, so it is never dropped.
    const [keepStart, keepEnd] = chains.find(([s, e]) => index >= s && index <= e) ?? chains[0]!;
    if (index >= keepStart && index <= keepEnd) nextIndex = kept.length + (index - keepStart);
    kept.push(...after.slice(keepStart, keepEnd + 1));
    runStart = runEnd + 1;
  }
  return { entries: kept, index: after.length === 0 ? -1 : nextIndex };
}

/**
 * The current entry now names `filePath` — a Save As, or a preview following its document (R14).
 *
 * The contiguous run of entries around `index` naming the current entry's OLD path is rewritten together,
 * each keeping its `viewState` — in a preview that run is a jump chain, one document's positions, and it is
 * that document that now has another name (FR-115, H2a refined). In an editor it is the current entry alone.
 *
 * H2a: a neighbour OUTSIDE that run naming the new path (however spelled) is MERGED away, and `index` moves
 * back by the older entries dropped. Without it, a Save As onto the file one step back left `[a.md, a.md]`,
 * and Back moved the position while the panel showed the same file — a step that visibly does nothing. Only
 * ADJACENT entries merge: an earlier, separated occurrence is an ordinary part of the list (H3).
 */
export function rewriteCurrent(h: NavigationHistory, filePath: string): NavigationHistory {
  const current = h.entries[h.index];
  if (current === undefined) return recordOpen(h, filePath, 1);
  if (current.filePath === filePath) return h;
  let first = h.index;
  while (first > 0 && samePath(h.entries[first - 1]!.filePath, current.filePath)) first -= 1;
  let last = h.index;
  while (last < h.entries.length - 1 && samePath(h.entries[last + 1]!.filePath, current.filePath)) last += 1;
  const after = h.entries.map((entry, i) => (i >= first && i <= last ? { ...entry, filePath } : entry));
  return mergeFused(h.entries, after, h.index);
}

/** Structural equality over JSON values — what a kept `viewState` is, by construction. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  const aRecord = a as Record<string, unknown>;
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && jsonEqual(aRecord[key], bRecord[key]));
}

/**
 * `viewState` on the current entry (FR-107). Returns `h` itself when the entry would come out equal
 * to what it already is — the same value again, or a value that would be dropped (too large, not
 * JSON) on an entry that has none — so a preview reporting an unchanged scroll position on every
 * leave costs no broadcast and no layout write.
 */
export function setCurrentViewState(h: NavigationHistory, viewState: unknown): NavigationHistory {
  const current = h.entries[h.index];
  if (current === undefined) return h;
  const kept = viewState !== undefined && keepableViewState(viewState) ? viewState : undefined;
  if (kept === undefined ? current.viewState === undefined : jsonEqual(current.viewState, kept)) return h;
  const next: NavigationEntry = kept === undefined ? { filePath: current.filePath } : { filePath: current.filePath, viewState: kept };
  const entries = h.entries.map((entry, i) => (i === h.index ? next : entry));
  return { entries, index: h.index };
}

/**
 * H12 around the CURRENT entry — the invariant `recordJump` holds, for the routes that never reach it
 * (FR-115, T219).
 *
 * A neighbour that is now the same file at the same place is merged away: the NEWER one goes first
 * (the current entry keeps its position), then the current entry merges into an equal OLDER one and
 * `index` steps back with it. That order is `recordJump`'s (steps 2 and 3) and it matters — dropping
 * the older one instead would move the reader's position to an entry they never opened.
 *
 * Deliberately NOT part of {@link setCurrentViewState}: `recordJump` uses that reducer as its own
 * step 1 and then sequences the merges itself, so folding them in would run them twice for a jump.
 */
export function mergeCurrentPlace(h: NavigationHistory): NavigationHistory {
  const current = h.entries[h.index];
  if (current === undefined) return h;
  let entries = h.entries;
  let index = h.index;

  if (index + 1 < entries.length && samePlace(entries[index]!, entries[index + 1]!)) {
    entries = [...entries.slice(0, index + 1), ...entries.slice(index + 2)];
  }
  if (index > 0 && samePlace(entries[index - 1]!, entries[index]!)) {
    entries = [...entries.slice(0, index), ...entries.slice(index + 1)];
    index -= 1;
  }
  return entries === h.entries ? h : { entries, index };
}

/**
 * The reader reported where they are (FR-107), with FR-115's no-duplicate rule applied (T219).
 *
 * ══ WHY THIS EXISTS RATHER THAN A BARE `setCurrentViewState` ══
 *
 * FR-115's fourth sentence — *"Two consecutive entries for the same file and the same position MUST
 * NOT be recorded"* — is unconditional, and {@link recordJump} was the only place holding it. Three
 * routes write a place without it: a preview link's `leavingViewState`, a history step's, and the
 * detaching-view effect that fires when the reader switches tab. Each could leave the current entry
 * equal to its neighbour, and then Back was enabled, accepted, and changed nothing on screen — the
 * failure this module's own H2a note already calls a defect in as many words.
 *
 * It is one function rather than a rule repeated at three call sites because that is what stops a
 * FOURTH route acquiring the defect back: `NavigationHistoryService.setCurrentViewState` is the only
 * caller, and it is the only way into the history from outside.
 */
export function recordCurrentPlace(h: NavigationHistory, viewState: unknown): NavigationHistory {
  return mergeCurrentPlace(setCurrentViewState(h, viewState));
}

/** What `viewState` becomes on an entry: itself when it is JSON within the limit, else nothing. */
function keptViewState(viewState: unknown): unknown {
  return viewState !== undefined && keepableViewState(viewState) ? viewState : undefined;
}

/** One file at one place: the pair H12 forbids side by side. */
function samePlace(a: NavigationEntry, b: NavigationEntry): boolean {
  return (
    samePath(a.filePath, b.filePath) &&
    (a.viewState === undefined ? b.viewState === undefined : b.viewState !== undefined && jsonEqual(a.viewState, b.viewState))
  );
}

/**
 * FR-115 — a followed same-document heading in a PREVIEW (data-model §14.2, H11–H13). In order:
 *
 * 0. An empty history is returned unchanged (H11).
 * 1. `leaving` goes on the current entry, as {@link setCurrentViewState} puts it.
 * 2. If the current entry is now the previous entry's place — the reader scrolled back to where an earlier
 *    jump left them — the current entry merges into it (`index` − 1), or Back would visibly do nothing.
 * 3. If `arriving` is where the reader already is, no entry is added. Newer entries are KEPT, as `recordOpen`
 *    of the current file keeps them (H2) — but a newer neighbour that is now the same place merges too, so
 *    H12 holds either side of the current entry.
 * 4. Otherwise newer entries are discarded and `{ current file, arriving }` appended as the current entry,
 *    under the cap (H13, H6). This is `recordOpen`'s rule (H3) EVEN WHEN the next entry names that very
 *    place: jump entries and file entries are one sequence, and a jump is an open of a place.
 *
 * A `viewState` over {@link MAX_VIEW_STATE_BYTES} is dropped as `setCurrentViewState` drops it — an arriving
 * one leaves an entry with no place — and places are compared after that drop.
 *
 * Returns `h` itself when nothing changed. Callers guarantee a preview history: an editor's never reaches
 * here (H10; `NavigationHistoryService.recordJump`).
 */
export function recordJump(h: NavigationHistory, leaving: unknown, arriving: unknown, cap: number): NavigationHistory {
  if (h.entries[h.index] === undefined) return h;
  const stored = setCurrentViewState(h, leaving);
  const entries = [...stored.entries];
  let index = stored.index;
  let changed = stored !== h;

  if (index > 0 && samePlace(entries[index - 1]!, entries[index]!)) {
    entries.splice(index, 1);
    index -= 1;
    changed = true;
  }

  const current = entries[index]!;
  const place = keptViewState(arriving);
  const target: NavigationEntry =
    place === undefined ? { filePath: current.filePath } : { filePath: current.filePath, viewState: place };

  if (samePlace(current, target)) {
    if (index + 1 < entries.length && samePlace(current, entries[index + 1]!)) {
      entries.splice(index + 1, 1);
      changed = true;
    }
    return changed ? { entries, index } : h;
  }

  const appended = [...entries.slice(0, index + 1), target];
  return applyCap({ entries: appended, index: appended.length - 1 }, cap);
}

/**
 * A persisted history, read tolerantly (FR-109): anything but `{ v: 1, entries: [...] }` is empty; an
 * entry without a non-empty string `filePath` is dropped; a `viewState` that is not JSON within the
 * limit is dropped from its entry; the index is clamped — and when the current entry itself was
 * dropped, it lands on the nearest older survivor. Then the cap is applied.
 */
export function parseHistory(raw: unknown, cap: number): NavigationHistory {
  if (typeof raw !== 'object' || raw === null) return EMPTY_HISTORY;
  const record = raw as { v?: unknown; entries?: unknown; index?: unknown };
  if (record.v !== 1 || !Array.isArray(record.entries)) return EMPTY_HISTORY;

  const rawIndex =
    typeof record.index === 'number' && Number.isFinite(record.index)
      ? Math.floor(record.index)
      : record.entries.length - 1;

  const entries: NavigationEntry[] = [];
  let index = -1;
  record.entries.forEach((candidate: unknown, i) => {
    if (typeof candidate !== 'object' || candidate === null) return;
    const { filePath, viewState } = candidate as { filePath?: unknown; viewState?: unknown };
    if (typeof filePath !== 'string' || filePath.length === 0) return;
    const entry: NavigationEntry = { filePath };
    if (viewState !== undefined && keepableViewState(viewState)) entry.viewState = viewState;
    entries.push(entry);
    if (i <= rawIndex) index = entries.length - 1;
  });

  if (entries.length === 0) return EMPTY_HISTORY;
  return applyCap({ entries, index: Math.max(0, index) }, cap);
}

export function serialiseHistory(h: NavigationHistory): PersistedHistory {
  return {
    v: 1,
    entries: h.entries.map((e) =>
      e.viewState === undefined ? { filePath: e.filePath } : { filePath: e.filePath, viewState: e.viewState },
    ),
    index: h.index,
  };
}
