import koffi from 'koffi';
import { logExpected, type FileAttributes, type IFileAttributes } from '@throng/core';

const READ_ONLY = 0x1;
const HIDDEN = 0x2;
const SYSTEM = 0x4;
const ARCHIVE = 0x20;
const REPARSE_POINT = 0x400;
const IO_REPARSE_TAG_MOUNT_POINT = 0xa0000003;
const NONE: FileAttributes = { readOnly: false, hidden: false, system: false, archive: false, junction: false };

export type FindFile = (path: string) => Promise<{ readonly attributes: number; readonly reparseTag: number } | null>;

let cached: FindFile | null = null;

/** `FindFirstFileW` rather than `GetFileAttributesW`: it alone also answers the reparse tag, off the UI thread. */
function nativeFindFile(): FindFile {
  if (cached) return cached;
  const kernel32 = koffi.load('kernel32.dll');
  const FILETIME = koffi.struct('THRONG_FILETIME', { low: 'uint32', high: 'uint32' });
  koffi.struct('THRONG_WIN32_FIND_DATAW', {
    dwFileAttributes: 'uint32',
    ftCreationTime: FILETIME,
    ftLastAccessTime: FILETIME,
    ftLastWriteTime: FILETIME,
    nFileSizeHigh: 'uint32',
    nFileSizeLow: 'uint32',
    dwReserved0: 'uint32',
    dwReserved1: 'uint32',
    cFileName: koffi.array('uint16', 260),
    cAlternateFileName: koffi.array('uint16', 14),
  });
  const find = kernel32.func('intptr __stdcall FindFirstFileW(str16 name, _Out_ THRONG_WIN32_FIND_DATAW *data)');
  const close = kernel32.func('bool __stdcall FindClose(intptr handle)');
  cached = (path) =>
    new Promise((resolve, reject) => {
      const data: { dwFileAttributes?: number; dwReserved0?: number } = {};
      find.async(path, data, (error: unknown, handle: number | bigint) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (Number(handle) === -1) {
          resolve(null);
          return;
        }
        close(handle);
        resolve({ attributes: data.dwFileAttributes ?? 0, reparseTag: data.dwReserved0 ?? 0 });
      });
    });
  return cached;
}

export class WindowsFileAttributes implements IFileAttributes {
  constructor(private readonly findFile?: FindFile) {}

  async read(path: string): Promise<FileAttributes> {
    try {
      const found = await (this.findFile ?? nativeFindFile())(path);
      if (!found) return NONE;
      const { attributes, reparseTag } = found;
      return {
        readOnly: (attributes & READ_ONLY) !== 0,
        hidden: (attributes & HIDDEN) !== 0,
        system: (attributes & SYSTEM) !== 0,
        archive: (attributes & ARCHIVE) !== 0,
        junction: (attributes & REPARSE_POINT) !== 0 && reparseTag === IO_REPARSE_TAG_MOUNT_POINT,
      };
    } catch (error) {
      logExpected('windows-file-attributes: read', 'the dialog shows no attributes rather than failing', error);
      return NONE;
    }
  }
}
