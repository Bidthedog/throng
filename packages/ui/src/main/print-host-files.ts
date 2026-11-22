/**
 * 075 FR-066 — the print hosts' documents on disk. Print Preview hands its print host the whole printable document — the
 * reader's text — as a file under `<userData>/print-jobs/hosts`, because a host loads its page from a file. No copy may
 * outlive its window:
 *
 * - a copy is removed when its host is disposed, and {@link PrintHostFiles.remove} settles only once it is gone;
 * - a quit with Print Preview open removes the whole folder before the app exits ({@link PrintHostFiles.removeAllNow});
 * - a crash, a kill or a power cut runs neither, so whatever a previous session left is removed before this session
 *   writes its first copy.
 *
 * Electron-free, so the integration test drives it against a real folder.
 */
import { rmSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { logExpected } from '@throng/core';

export class PrintHostFiles {
  /** The sweep of what an earlier session left, started at construction: every write waits for it. */
  private readonly swept: Promise<void>;

  /** `dir` holds the copies; its parent (`print-jobs`) is what a quit removes. */
  constructor(private readonly dir: string) {
    this.swept = rm(dir, { recursive: true, force: true }).catch((error: unknown) =>
      logExpected('print: sweep earlier host documents', 'a copy that cannot be removed now is removed at the next start', error),
    );
  }

  /** Write a host document, `<dir>/<id>.<ext>`, and say where. */
  async write(id: string, ext: 'html' | 'pdf', content: string | Uint8Array): Promise<string> {
    await this.swept;
    await mkdir(this.dir, { recursive: true });
    const file = join(this.dir, `${id}.${ext}`);
    await writeFile(file, content);
    return file;
  }

  /** Remove one host document; settles once it is gone, or once its removal has failed and been logged. */
  remove(file: string): Promise<void> {
    return rm(file, { force: true }).catch((error: unknown) =>
      logExpected('print: remove a host document', 'a copy that cannot be removed now is removed when the app quits or next starts', error),
    );
  }

  /** The app is quitting: remove every host document, and the job folder, before it exits. */
  removeAllNow(): void {
    try {
      rmSync(dirname(this.dir), { recursive: true, force: true });
    } catch (error) {
      logExpected('print: remove the host documents at quit', 'what cannot be removed now is removed at the next start', error);
    }
  }
}
