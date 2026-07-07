/**
 * ElectronShellIntegration — the UI-main concrete {@link IShellIntegration}
 * (004, T045, research D10). Uses Electron's built-in `shell` to reveal a file
 * (selected in its parent) or open a folder (showing its contents) (FR-035).
 * The shell calls are injected so this stays testable without the Electron
 * runtime; the OS detail stays behind the IShellIntegration abstraction.
 */
import type { IShellIntegration } from '@throng/core';

/** The slice of Electron's `shell` this impl needs. */
export interface ElectronShellLike {
  showItemInFolder(fullPath: string): void;
  openPath(path: string): Promise<string>; // resolves '' on success, else an error message
}

export class ElectronShellIntegration implements IShellIntegration {
  constructor(private readonly shell: ElectronShellLike) {}

  async revealInFileManager(path: string): Promise<void> {
    this.shell.showItemInFolder(path);
  }

  async openFolder(path: string): Promise<void> {
    const error = await this.shell.openPath(path);
    if (error) throw new Error(error);
  }
}
