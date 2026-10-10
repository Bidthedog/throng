/**
 * The shape of `editor.previews` (044, data-model §3). Types only: the defaults, descriptors and
 * parser are generated from a provider registry in `config/preview-settings.ts`, so this module is
 * what a surface imports when it needs the shape without the generator.
 *
 * No OS, no DOM.
 */

/** What Copy puts on the clipboard (FR-035b): selection HTML plus text, or text alone. */
export type PreviewCopyFormat = 'rich' | 'plain';

/** What opening a file of a text provider does by default (FR-050). */
export type DefaultOpenAction = 'editor' | 'preview';

/**
 * 047 (data-model.md "Settings", research R8/R11, FR-015a) — where a STANDALONE preview opens:
 * reuse the last active preview panel in the visible tab, or always open a new one.
 */
export type PreviewOpenTarget = 'lastActive' | 'new';

/** One provider's settings under `editor.previews.providers.<id>`. */
export interface ProviderSettings {
  /** FR-065: Markdown ships `true`. */
  enabled: boolean;
  /** Text providers only; ships `'editor'` (FR-050). Absent for a binary provider (FR-051). */
  defaultOpenAction?: DefaultOpenAction;
  /**
   * 054 FR-051, FR-053 — where a standalone preview of this provider's files opens. Text providers only;
   * ships `'lastActive'`, or the value of the retired top-level `openTarget` it was migrated from.
   */
  openTarget?: PreviewOpenTarget;
  /** The provider's own declared leaves (FR-071). */
  [ownLeaf: string]: boolean | string | number | undefined;
}

export interface PreviewSettings {
  /** Trailing settle delay for a parented preview — 300, range 0–5000 (FR-060). */
  updateDelayMs: number;
  /** Longest a parented preview may go without showing a change — 1000, range 0–10000 (FR-060a). */
  maxWaitMs: number;
  /** 'rich' (FR-035b). */
  copyFormat: PreviewCopyFormat;
  /**
   * Whether a preview beside its editor follows the editor's scroll position — `true` (FR-113,
   * FR-114). Applies to every text provider, so no provider's enabled toggle governs it.
   */
  syncScroll: boolean;
  /*
   * 047 FR-015a's top-level `openTarget` is RETIRED by 054 FR-051: each text provider carries its own
   * (`ProviderSettings.openTarget`). It is absent from this shape on purpose — the parse migrates it and
   * does not carry it, so the section rebuild drops it on the next write (019 FR-023's mechanism).
   */
  /** Keyed by provider id. */
  providers: Record<string, ProviderSettings>;
}
