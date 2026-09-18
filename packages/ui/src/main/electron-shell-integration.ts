/**
 * ElectronShellIntegration — the UI-main concrete {@link IShellIntegration}
 * (004, T045, research D10). Uses Electron's built-in `shell` to reveal a file
 * (selected in its parent) or open a folder (showing its contents) (FR-035).
 * The shell calls are injected so this stays testable without the Electron
 * runtime; the OS detail stays behind the IShellIntegration abstraction.
 */
import { stat } from 'node:fs/promises';
import type { IShellIntegration } from '@throng/core';

/** The slice of Electron's `shell` this impl needs. */
export interface ElectronShellLike {
  showItemInFolder(fullPath: string): void;
  openPath(path: string): Promise<string>; // resolves '' on success, else an error message
  /** Opens `url` in the OS default handler (a browser, or the default mail client for `mailto:`). */
  openExternal(url: string): Promise<void>;
}

/** What is at a path, as far as `openWithDefaultProgram` needs to care (045 SI1/SI2). */
export type PathKind = 'file' | 'folder' | null;

async function statKindOnDisk(path: string): Promise<PathKind> {
  try {
    const info = await stat(path);
    return info.isDirectory() ? 'folder' : 'file';
  } catch {
    return null;
  }
}

export class ElectronShellIntegration implements IShellIntegration {
  constructor(
    private readonly shell: ElectronShellLike,
    /**
     * 045 SI1/SI2. Injected so a test can drive the two refusals without staging a real tree; the
     * default is the real disk, so a caller that does not care gets the real check rather than none.
     */
    private readonly statKind: (path: string) => Promise<PathKind> = statKindOnDisk,
  ) {}

  async revealInFileManager(path: string): Promise<void> {
    this.shell.showItemInFolder(path);
  }

  async openFolder(path: string): Promise<void> {
    const error = await this.shell.openPath(path);
    if (error) throw new Error(error);
  }

  async openExternal(url: string): Promise<void> {
    await this.shell.openExternal(url);
  }

  /**
   * 045 FR-036 — open a FILE in the application the OS associates with it.
   *
   * The two refusals are the requirement, not defensive coding. A path that has gone between the
   * hover and the click must produce one notice naming it (SI1/SI3, FR-037), and a folder must be
   * refused rather than quietly opened in the file manager (SI2) — a link menu offers
   * `Open in OS Explorer` for that, and silently doing the neighbouring thing is how a user learns
   * not to trust either item.
   *
   * Both rejections carry the path AND a reason, because the notice that reports them names both.
   */
  async openWithDefaultProgram(path: string): Promise<void> {
    const kind = await this.statKind(path);
    if (kind === null) throw new Error(`${path} no longer exists`);
    if (kind === 'folder') {
      throw new Error(`${path} is a folder, and Open in OS Default Program opens a file`);
    }
    const error = await this.shell.openPath(path);
    if (error) throw new Error(`${path} could not be opened: ${error}`);
  }
}
