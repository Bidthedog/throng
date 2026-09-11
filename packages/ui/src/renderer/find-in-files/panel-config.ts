/**
 * The Find in Files panel's persisted query (043 T104, FR-027a–FR-027d, research R11).
 *
 * ══ WHY THE QUERY RIDES `Panel.config` AND NOTHING ELSE ══
 *
 * R11's decision, restated where the code is: `PanelConfig` is a `Record<string, unknown>`
 * serialised verbatim inside the layout blob, so a panel type can persist its own state with no
 * schema change at all — feature 006 added the editor panel that way, and
 * `no-editor-migration.integration.test.ts` has pinned that decision ever since.
 *
 * ══ THE HALF THAT IS SATISFIED BY WHAT IS ABSENT ══
 *
 * FR-027b (no results), FR-027c (no pending preview) and FR-027d (results never cross a restart)
 * need no discarding code, and that is the point of writing the mapping as a pair of TOTAL
 * functions over five named fields rather than as a spread of the panel's state. A spread would
 * carry `results`, `staleFiles` and `committed` into the layout blob the moment somebody added a
 * field, and the failure would be silent: the panel would reopen showing matches found before the
 * application was last closed, offering to commit a preview against files nobody has re-read.
 *
 * There is no preview OBJECT to exclude, incidentally, and there deliberately is not one — a
 * preview is `replaceEnabled` plus the rows on screen, derived at render time (`results-list.tsx`).
 * With no rows restored there is nothing to preview, which is FR-027c holding by construction.
 *
 * ══ WHY `''` ON ONE SIDE AND `null` ON THE OTHER ══
 *
 * The panel's `scopeSubPath` is what the CONTROL holds, and a text field that has been cleared
 * holds `''`. The persisted form says `null` for "the whole root", matching the scan channel's own
 * spelling. Mapping between them here, once, is what stops an empty control reaching either end as
 * the sub-directory `""`.
 *
 * `scopeSubPath` is ROOT-RELATIVE and therefore deliberately absent from `CONFIG_PATH_KEYS`
 * (`persisted-paths.ts`), which rewrites ABSOLUTE paths: storing it relative is what makes it
 * survive the project moving on disk.
 */
import type { FindInFilesPanelConfig, MatchModes, PanelConfig } from '@throng/core';

/** The query half of a panel's state — everything FR-027b restores, and nothing else. */
export interface FindInFilesQuery {
  term: string;
  modes: MatchModes;
  scopeSubPath: string;
  replaceEnabled: boolean;
  replacement: string;
}

/** A restored panel's query, read defensively: `config` is `Record<string, unknown>` on disk. */
export function findInFilesQueryFrom(config: PanelConfig | undefined): FindInFilesQuery {
  const c = (config ?? {}) as FindInFilesPanelConfig;
  return {
    term: typeof c.term === 'string' ? c.term : '',
    modes: {
      caseSensitive: c.caseSensitive === true,
      wholeWord: c.wholeWord === true,
    },
    scopeSubPath: typeof c.scopeSubPath === 'string' ? c.scopeSubPath : '',
    replaceEnabled: c.replaceShown === true,
    replacement: typeof c.replacement === 'string' ? c.replacement : '',
  };
}

/**
 * What a panel writes back into the layout blob.
 *
 * Every field is stated, always, because `updatePanelConfig` MERGES: an omitted key would leave
 * whatever the previous write left, so a user clearing their replacement text would reopen with the
 * old one still in the box.
 */
export function findInFilesConfigOf(query: FindInFilesQuery): FindInFilesPanelConfig {
  return {
    term: query.term,
    caseSensitive: query.modes.caseSensitive,
    wholeWord: query.modes.wholeWord,
    scopeSubPath: query.scopeSubPath === '' ? null : query.scopeSubPath,
    replaceShown: query.replaceEnabled,
    replacement: query.replacement,
  };
}

/*
 * ══ THERE IS NO `NO_FIND_IN_FILES_QUERY` (043 T117) ══
 *
 * One existed, and nothing ever referenced it. A panel opened rather than restored has no `config`,
 * and `findInFilesQueryFrom(undefined)` above already answers that case with exactly those five
 * defaults — total by construction, because `config` is `Record<string, unknown>` on disk and every
 * field has to be read defensively anyway. A named constant beside it would be a SECOND statement
 * of the empty query, free to drift from the one the restore path actually uses.
 */
