/**
 * What the project's own watch may leave out (062 FR-051) — the watch behind the explorer tree and Find in Files.
 *
 * The maintainer's ruling (2026-11-21, #274): "Ignored folders should not be indexed (unless they are unignored by
 * the user)". One watch serves two readers with two notions of ignored: the tree draws by the explorer's globs and
 * the project's hidden set (004, 033 FR-069a), and Find in Files scans by its own lists (060 #532 FR-025). A folder is
 * left out only when BOTH ignore it, so neither is ever told less than it reads: `dist` is hidden from search but
 * drawn by the tree, and a hidden folder is still searched.
 *
 * Find in Files is taken at its default — its global list on. A run that turns the global list off scans folders
 * those lists ignore; while it is open it says so through `searchNeeds`, and they stay watched until it closes.
 *
 * Both answers are compiled once per input, by the same `compileExcluder` every other walk uses, so this adds no
 * second rule set (033 FR-069c).
 */
import { compileExcluder, hiddenPathGlobs, searchExcludeGlobs } from '@throng/core';

export interface ProjectWatchInputs {
  /** `explorer.excludeGlobs`. */
  treeGlobs: readonly string[];
  /** The project's own hidden set ("Hide in this project"), root-relative. */
  hiddenPaths: readonly string[];
  /** `search.inFiles.excludeGlobs`, Find in Files' global list. */
  searchGlobs: readonly string[];
  /** The project's own "Exclude from Find in Files" list. */
  projectSearchGlobs: readonly string[];
}

/**
 * The project watch's whole answer: what both ignore, less any folder an OPEN Find in Files run still scans —
 * `searchNeeds`, asked live (a run with its global list off, `FileSearchService.needsWatched`).
 */
export function projectWatchExclusion(
  inputs: ProjectWatchInputs,
  searchNeeds: (relPath: string) => boolean,
): (relPath: string) => boolean {
  return withSearchNeeds(projectWatchLeavesOut(inputs), searchNeeds);
}

/** `leavesOut`, compiled once by the caller, less what an open run needs. */
export function withSearchNeeds(
  leavesOut: (relPath: string) => boolean,
  searchNeeds: (relPath: string) => boolean,
): (relPath: string) => boolean {
  return (relPath) => leavesOut(relPath) && !searchNeeds(relPath);
}

/** The folders the project watch may leave out: those the tree AND Find in Files both ignore, root-relative POSIX. */
export function projectWatchLeavesOut(inputs: ProjectWatchInputs): (relPath: string) => boolean {
  const tree = compileExcluder([...inputs.treeGlobs, ...hiddenPathGlobs(inputs.hiddenPaths)]);
  const search = compileExcluder(
    searchExcludeGlobs({ global: inputs.searchGlobs, useGlobal: true, project: inputs.projectSearchGlobs, extra: [] }),
  );
  return (relPath) => tree(relPath) && search(relPath);
}
