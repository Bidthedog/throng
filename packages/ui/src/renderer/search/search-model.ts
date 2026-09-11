/**
 * Pure search model (013) — MOVED TO `@throng/core` by 043 (R1), and re-exported from here so
 * no existing caller or test changed with it.
 *
 * The move was forced: 043 scans a project's files from the MAIN process, main never imports
 * from the renderer, and the match semantics now have a consumer in both. That is the same
 * situation, and the same resolution, as `packages/core/src/editor/refusal.ts` — a pure domain
 * decision with cross-process consumers belongs in the platform-abstracted core.
 *
 * This file is deliberately nothing but the re-export. Anything ADDED to the model goes in
 * `packages/core/src/search/match-model.ts`; a second definition here would be exactly the
 * drift between the two find surfaces that FR-040 exists to prevent.
 */
export {
  NO_MODES,
  NO_MATCHES,
  editorMatches,
  indexFrom,
  stepIndex,
  countOf,
  seedFrom,
} from '@throng/core';
export type { MatchModes, Match, SearchCount } from '@throng/core';
