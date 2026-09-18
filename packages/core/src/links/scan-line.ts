import { detectPathCandidates } from './detect.js';
import type { LinkCandidate } from './types.js';
import { detectWebLinks, type WebLinkSpan } from './web-url.js';

/**
 * 045 FR-009, FR-104 — one line's links, web and path together (`data-model.md` §13.2, D9 – D11).
 *
 * Both panel types take a line's links from here and from nothing else, which is FR-104's parity by
 * construction. The web spans are found first and CLAIMED, so no path candidate ever overlaps one
 * (FR-009): `https://host/src/foo.ts:42` is a web link and not also a path.
 *
 * Pure and total, like `detectPathCandidates` (D8). The per-line candidate cap
 * (`MAX_LINK_CANDIDATES_PER_LINE`) stays with the caller that asks about each candidate.
 */
export interface ScannedLine {
  readonly web: readonly WebLinkSpan[];
  /** Never overlapping a web span (FR-009). */
  readonly paths: readonly LinkCandidate[];
}

export function scanLinkLine(line: string): ScannedLine {
  const web = detectWebLinks(line);
  return { web, paths: detectPathCandidates(line, web) };
}
