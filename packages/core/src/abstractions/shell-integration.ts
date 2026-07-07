/**
 * IShellIntegration (Principle II) — OS file-manager integration for the
 * "Open in file explorer" action (FR-035). The abstract contract only; the
 * concrete Electron-`shell`-backed implementation lives in the UI main process
 * (research D10). No OS calls here.
 */
export interface IShellIntegration {
  /** Open the OS file manager with `path` SELECTED in its parent folder (files). */
  revealInFileManager(path: string): Promise<void>;
  /** Open `path` (a folder) so the manager shows ITS CONTENTS (folders/root). */
  openFolder(path: string): Promise<void>;
}
