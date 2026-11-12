import { readFile } from 'node:fs/promises';
import { formatFileMode, logExpected, type FileAccess, type IFileAccessInfo } from '@throng/core';

type ReadText = (path: string) => Promise<string>;

/** The field-separated name files: the id's name, or undefined when the file does not list it. */
function nameFor(text: string, id: number, idField: number): string | undefined {
  for (const line of text.split('\n')) {
    const fields = line.split(':');
    if (fields[idField] === String(id)) return fields[0];
  }
  return undefined;
}

/** Owner, group and permissions (067 FR-121). An id with no name shows as its number. */
export class LinuxFileAccessInfo implements IFileAccessInfo {
  constructor(private readonly readText: ReadText = (path) => readFile(path, 'utf8')) {}

  async read(stats: { readonly uid: number; readonly gid: number; readonly mode: number }): Promise<FileAccess> {
    const [passwd, group] = await Promise.all([this.names('/etc/passwd'), this.names('/etc/group')]);
    return {
      owner: nameFor(passwd, stats.uid, 2) ?? String(stats.uid),
      group: nameFor(group, stats.gid, 2) ?? String(stats.gid),
      ...formatFileMode(stats.mode),
    };
  }

  private async names(path: string): Promise<string> {
    try {
      return await this.readText(path);
    } catch (error) {
      logExpected('linux-file-access-info: read names', 'with no name file, an id shows as its number', error);
      return '';
    }
  }
}
