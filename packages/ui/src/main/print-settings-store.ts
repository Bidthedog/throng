/**
 * The print settings on disk (075 FR-070, research R10): `print-settings.json` in the user-data folder, beside
 * `window-state.json`.
 *
 * Application state, not configuration: like window geometry it is remembered for the user, not edited by them,
 * so it has no descriptor and is not in `settings.json`. It belongs to no project. It is written atomically —
 * a temporary file renamed over the real one — so a crash mid-write leaves the last good file. A missing,
 * unreadable or malformed file starts from the defaults, and core's parse validates every field on its own.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import {
  logCaught,
  logExpected,
  parsePrintSettings,
  serialisePrintSettings,
  type PrinterInfoLike,
  type PrintSettings,
} from '@throng/core';

export class PrintSettingsStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** The stored settings against today's printers; the defaults when there is nothing usable. */
  async read(printers: readonly PrinterInfoLike[]): Promise<PrintSettings> {
    // `tail` never rejects: each write's failure is logged where it is chained on.
    await this.tail;
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      logExpected('print-settings: read the file', 'there is no file until Print Preview first closes, and a damaged one starts from the defaults', error);
      raw = undefined;
    }
    const settings = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { settings?: unknown }).settings : undefined;
    return parsePrintSettings(settings, printers);
  }

  /** Remember `settings`, page range excepted. Writes run one at a time, in order. */
  write(settings: PrintSettings): Promise<void> {
    const run = this.tail.then(() => this.save(settings), () => this.save(settings));
    this.tail = run.catch((error: unknown) => logCaught('print-settings: write the file', error));
    return run;
  }

  private async save(settings: PrintSettings): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(serialisePrintSettings(settings), null, 2), 'utf8');
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
