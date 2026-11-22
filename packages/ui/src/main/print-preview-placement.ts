/**
 * What the next Print Preview opens at (maintainer, 2026-11-22; 075 FR-064): the size the last one closed with, and
 * whether it was maximised. A maximised window remembers the size it had BEFORE maximising — Restore returns there —
 * so the next one opens maximised and still restores to that size. Kept across sessions in its own file beside
 * `print-settings.json` ({@link PrintPreviewPlacementFile}); the first ever opens at the default size.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { logCaught, logExpected } from '@throng/core';

export interface Size {
  readonly width: number;
  readonly height: number;
}

export const PRINT_PREVIEW_DEFAULT_SIZE: Size = { width: 1000, height: 760 };
/**
 * FR-069 — every setting fits without the settings pane scrolling; never opened smaller. 740 px tall since
 * 2026-11-22: the file name option's row and the larger margins drawing joined the pane (at 720 px the drawing spilled
 * 4 px on macOS, pipeline 45011164348).
 */
export const PRINT_PREVIEW_MIN_SIZE: Size = { width: 640, height: 740 };

export interface ClosingWindow {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  getBounds(): Size;
  getNormalBounds(): Size;
}

interface Remembered {
  readonly size: Size;
  readonly maximised: boolean;
}

const dimension = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 100_000;

export class PrintPreviewPlacement {
  private remembered: Remembered | null = null;

  /** Call as the window closes, while it still answers. */
  remember(win: ClosingWindow): void {
    if (win.isDestroyed()) return;
    const maximised = win.isMaximized();
    const { width, height } = maximised ? win.getNormalBounds() : win.getBounds();
    this.remembered = { size: { width, height }, maximised };
  }

  next(): Remembered {
    const size = this.remembered?.size ?? PRINT_PREVIEW_DEFAULT_SIZE;
    return {
      size: {
        width: Math.max(PRINT_PREVIEW_MIN_SIZE.width, Math.round(size.width)),
        height: Math.max(PRINT_PREVIEW_MIN_SIZE.height, Math.round(size.height)),
      },
      maximised: this.remembered?.maximised ?? false,
    };
  }

  /** What is kept on disk; `null` before any window has closed. */
  snapshot(): { version: 1; width: number; height: number; maximised: boolean } | null {
    const r = this.remembered;
    return r === null ? null : { version: 1, width: Math.round(r.size.width), height: Math.round(r.size.height), maximised: r.maximised };
  }

  /** Take a stored {@link snapshot}; anything unreadable leaves the default. A window closed since wins. */
  restore(raw: unknown): void {
    if (this.remembered !== null || typeof raw !== 'object' || raw === null) return;
    const o = raw as Record<string, unknown>;
    if (!dimension(o.width) || !dimension(o.height)) return;
    this.remembered = { size: { width: o.width, height: o.height }, maximised: o.maximised === true };
  }
}

/** The placement's file: read once at start, written as each Print Preview closes. Writes run in order. */
export class PrintPreviewPlacementFile {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as unknown;
    } catch (error) {
      logExpected('print-preview placement: read the file', 'there is no file until Print Preview first closes, and a damaged one opens at the default size', error);
      return undefined;
    }
  }

  write(snapshot: object | null): Promise<void> {
    if (snapshot === null) return Promise.resolve();
    const run = this.tail.then(() => this.save(snapshot), () => this.save(snapshot));
    this.tail = run.catch((error: unknown) => logCaught('print-preview placement: write the file', error));
    return run;
  }

  private async save(snapshot: object): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
