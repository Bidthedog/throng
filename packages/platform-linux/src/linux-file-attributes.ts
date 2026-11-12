import { lstat } from 'node:fs/promises';
import { basename } from 'node:path';
import { logExpected, type FileAttributes, type IFileAttributes } from '@throng/core';

const NO_WRITE = 0o222;

/** Linux's equivalents (067 FR-046): no write bit is read-only, a leading dot is hidden. It has no system or archive flag. */
export class LinuxFileAttributes implements IFileAttributes {
  async read(path: string): Promise<FileAttributes> {
    const hidden = basename(path).startsWith('.');
    let readOnly = false;
    try {
      readOnly = ((await lstat(path)).mode & NO_WRITE) === 0;
    } catch (error) {
      logExpected('linux-file-attributes: read', 'the dialog shows no attributes rather than failing', error);
    }
    return { readOnly, hidden, system: false, archive: false, junction: false };
  }
}
