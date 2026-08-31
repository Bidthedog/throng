/**
 * "Open in OS Explorer", for a Panel acting on its OWN file (#273).
 *
 * Extracted from `panel-placeholder.tsx` so the behaviour has a seam a component test can reach.
 * It was six lines inside a JSX literal, and the two defects it carried were consequently provable
 * at no layer below E2E:
 *
 *   - It derived a ROOT-RELATIVE path from the panel's `ownerRoot` and passed it to `files.reveal`,
 *     which resolves against whichever root the MAIN window's explorer last set. A Panel torn out
 *     of project B into a sub-workspace therefore revealed B's relative path under project A — a
 *     different file, silently, whenever one existed there.
 *   - A Panel created INSIDE a sub-workspace is rootless: `ownerRoot` is null, so no relative path
 *     could be derived and the call was skipped entirely. The menu item is shown and enabled
 *     whenever the panel has a file path (`panel-header-menu.ts:198`), so it sat there doing
 *     nothing.
 *
 * Both go away by not throwing the absolute path away. Confinement moves to the open-document
 * registry in the main process, which is the only bound that can describe a panel belonging to no
 * project — see `FilesService.revealDocument`.
 */

/** The bridge surface this needs, named so a test can supply it without a whole `window.throng`. */
export interface RevealBridge {
  revealDocument?: (absPath: string) => Promise<unknown>;
}

/**
 * Ask the OS file manager to show a Panel's file.
 *
 * A Panel with no file path has nothing to show — the caller's menu item is hidden in that state,
 * and this is the guard for every other route to it.
 */
export function revealPanelFile(filePath: string | null | undefined, files: RevealBridge | undefined): void {
  if (!filePath) return;
  void files?.revealDocument?.(filePath);
}
