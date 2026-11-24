/**
 * What an editor says when it cannot open its file.
 *
 * ══ THE PER-TAB BATCH IS GONE (030 US3, FR-035) ══
 *
 * This module used to BUILD the batch: `showMissingFilesNotice(entries)` composed one
 * "Cannot open 3 files" dialog per tab and pushed it into `editor-notice-store`, and the tab-open
 * watcher called it once per tab activation. That was 006's answer to a real problem — three editors
 * each popping their own modal — and it was the right answer until 029 and 030 gave the application
 * a general one.
 *
 * It is removed rather than narrowed, and the difference matters. Batching by TAB is a claim that
 * the tab is the unit a user thinks in, and it is not: the unit is the CAUSE. One absent project
 * root defeats editors in four tabs and terminals in two, and a per-tab batch reports that as four
 * dialogs, none of which mentions the terminals — grouped by the wrong thing, four times. The tab
 * survives as a HEADING inside the consolidated notice's list (FR-031a), which is where it belongs:
 * a way of organising the casualties, not a boundary between notices.
 *
 * So each unopenable file is now reported as one panel casualty through
 * `workspace/panel-failure-notice.ts`, and the notification model merges them by cause or by the
 * action that produced them. What is left here is the WORDING and the classification — the two
 * things that were never about batching.
 *
 * ══ WHAT SURVIVES, AND WHY (T051a) ══
 *
 * `editor-notice-store.ts`, `editor-notice-dialog.tsx` and the `NoticeFile` type all STAY. They are
 * not a per-tab batch and never were: the store is a small reactive channel for editor messages
 * that need a structured file list, and its other two callers — the "file changed on disk" notice
 * (`file-changed-notice.ts`, 011/FR-010) and the refused save (`use-editor.ts`, 006/FR-078) — are
 * outside this feature's scope and unaffected. Removing the store to remove the batch would have
 * been a change to two behaviours in order to change one.
 */
import { SETTINGS_METADATA, formatSetting, previewSettingsDescriptors, refusalMessage, toDisplayPath } from '@throng/core';
import type { EncodingId, FieldDescriptor, OsName, PreviewProviderRegistry, PreviewSettings } from '@throng/core';

/**
 * One file that could not be opened. It carries no panel name: the row naming the panel is built by
 * `useReportPanelFailure` from the panel itself (048 FR-032), and a name field here was only ever
 * filled with the raw stored `panel.title` and read by nothing.
 */
export interface LoadErrorEntry {
  filePath: string | null;
  /** A `LoadResult` reason: 'binary' | 'too-large' | 'out-of-tree' | 'folder' | 'io' | 'utf32' | 'not-decodable'. */
  reason: string;
  /** 059 — the encoding a `not-decodable` file was read as, so the sentence can name it. */
  encoding?: EncodingId;
  /** 077 FR-014 — a `too-large` file's bytes and the `editor.maxOpenFileBytes` it is over. */
  size?: number;
  limit?: number;
}

/** How Preferences shows `editor.maxOpenFileBytes` (MB with its bytes), so the refusal quotes it the same way. */
const MAX_OPEN_FILE_BYTES: FieldDescriptor | undefined = SETTINGS_METADATA.find((d) => d.key === 'editor.maxOpenFileBytes');

/**
 * Reasons a file could not be opened that are NOT "the file isn't there" (018 / US9, FR-061).
 *
 * MOVED TO `@throng/core` by 041 (FR-013c) and re-exported here, so no caller changes. It went
 * because FR-013 makes MAIN decide whether a file is openable before a panel exists, and main cannot
 * import a renderer module — one pure domain decision with consumers in two processes, which is
 * where Constitution II draws the line.
 */
export { NOT_A_MISSING_FILE, isMissingReason } from '@throng/core';

/**
 * The sentence for ONE unopenable file.
 *
 * One file, one sentence — there is no plural form any more, because there is no batch to pluralise.
 * The notice that carries this states the project once and lists the panels (FR-031), so the
 * counting the old wording did ("These 3 files could not be opened") is now done by the list, which
 * can also say WHICH.
 *
 * The path is deliberately absent: FR-034 keeps raw paths out of a notice, and the panel's own
 * banner already shows the one it could not read (FR-040a). What this adds is why.
 */
export function missingFileMessage(
  reason: string,
  encoding?: EncodingId,
  tooLarge?: { size: number; limit: number },
): string {
  // 059 FR-053 — a file that is not text, is UTF-32, or does not decode: core's one wording, which the
  // preview, the replace report and the task toggle say too. A file that does not decode is named in the
  // encoding it was read as, which the refusal carries (review R2).
  if (reason === 'binary' || reason === 'utf32' || reason === 'not-decodable') {
    return refusalMessage(reason, encoding);
  }
  if (reason === 'too-large') {
    // 077 FR-014 — the file's size and the limit it is over, as Preferences shows the setting, quoting its
    // current value (Constitution X, 7.3.0). Main measured both; without them there is nothing true to quote.
    if (!tooLarge || !MAX_OPEN_FILE_BYTES) return 'That file is too large to open in an editor.';
    return `That file is too large to open in an editor: ${formatSetting(tooLarge.size, MAX_OPEN_FILE_BYTES)}, over the ${formatSetting(tooLarge.limit, MAX_OPEN_FILE_BYTES)} limit set in Preferences.`;
  }
  // The file EXISTS. Saying "missing" here would send the user looking for a file that is sitting
  // exactly where they left it.
  if (reason === 'out-of-tree') return 'That file is outside this project, so it cannot be opened here.';
  if (reason === 'folder') return 'That is a folder, not a file.';
  return 'The file could not be opened — it may have been moved, renamed or deleted. An editor with a recovered buffer can be saved to write its contents back.';
}

/** `explorer.openUnsupportedInOs`'s label, as Preferences shows it. */
const OPEN_UNSUPPORTED_IN_OS = SETTINGS_METADATA.find((d) => d.key === 'explorer.openUnsupportedInOs')?.label;

/**
 * #719 — the sentence for a file the editor refuses as BINARY, opened while `explorer.openUnsupportedInOs` is
 * off (with it on, the OS default program opens the file and there is no notice). It says what is wrong, then
 * how to open the file after all, naming each setting by the label Preferences shows: the file type's own
 * preview toggle where a provider claims the type and is turned off, and the OS preference.
 *
 * `previewToggle` is that toggle's label (`"PDF: Enabled"`); absent where no provider claims the type, or the
 * one that does is on (the open then went to the preview, and only a route past it — a drop — gets here).
 */
export function binaryRefusalMessage(previewToggle?: string): string {
  const why = refusalMessage('binary');
  if (OPEN_UNSUPPORTED_IN_OS === undefined) return why;
  return previewToggle === undefined
    ? `${why} To open it in your OS default program, turn on ${OPEN_UNSUPPORTED_IN_OS} in Preferences.`
    : `${why} To open it, turn on ${previewToggle} in Preferences to preview it, or ${OPEN_UNSUPPORTED_IN_OS} to open it in your OS default program.`;
}

/**
 * #719 — the label of the preview toggle that would open `absPath` (`"PDF: Enabled"`), as Preferences shows it:
 * only where a provider claims the file's type and is turned off. `undefined` otherwise.
 */
export function previewToggleToTurnOn(
  registry: PreviewProviderRegistry,
  previews: PreviewSettings,
  absPath: string,
): string | undefined {
  const provider = registry.forPath(absPath);
  if (provider === undefined || previews.providers[provider.id]?.enabled === true) return undefined;
  const key = `editor.previews.providers.${provider.id}.enabled`;
  return previewSettingsDescriptors(registry).find((d) => d.key === key)?.label;
}

/** The file's own path, for the row's `detail` — copied and logged, never rendered (FR-034). */
export function missingFileDetail(entry: LoadErrorEntry, os: OsName): string {
  const path = entry.filePath ? toDisplayPath(entry.filePath, os) : '(unsaved document)';
  return `${path} (${entry.reason})`;
}
