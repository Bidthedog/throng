/**
 * IShellIntegration (Principle II) — OS file-manager integration for the
 * "Open in file explorer" action (FR-035), plus opening a URL in the OS default
 * handler (044 FR-091 — R10). The abstract contract only; the concrete
 * Electron-`shell`-backed implementation lives in the UI main process
 * (research D10). No OS calls here.
 */
export interface IShellIntegration {
  /** Open the OS file manager with `path` SELECTED in its parent folder (files). */
  revealInFileManager(path: string): Promise<void>;
  /** Open `path` (a folder) so the manager shows ITS CONTENTS (folders/root). */
  openFolder(path: string): Promise<void>;
  /**
   * Open `url` in the OS default handler — a browser for `http:`/`https:`, the default mail client
   * for `mailto:` (044 FR-091). The caller has already validated the scheme; this seam trusts it.
   */
  openExternal(url: string): Promise<void>;
  /**
   * 045 FR-036. Open a FILE in the application the OS associates with it.
   *
   * A **file**, deliberately: FR-030 makes this a file-only link target, and a folder is served by
   * `openFolder`. An implementation rejects for a folder and for a path that has gone, and its
   * rejection names the path and a reason so one notice can carry both (SI1–SI3, the *one
   * condition, one notice* rule). This is the ONLY route by which a link can run an executable, and
   * only when the user chooses it by name — FR-039 keeps every gesture away from it.
   */
  openWithDefaultProgram(path: string): Promise<void>;
}
