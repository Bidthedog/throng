import type { FileAccess, IFileAccessInfo } from '@throng/core';

/** Windows reports its read-only, hidden and system flags through `IFileAttributes`; there is nothing further here (067 FR-121). */
export class WindowsFileAccessInfo implements IFileAccessInfo {
  async read(): Promise<FileAccess | undefined> {
    return undefined;
  }
}
