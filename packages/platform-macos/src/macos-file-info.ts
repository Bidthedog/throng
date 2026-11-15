import { execFile } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename } from 'node:path/posix';
import { formatFileMode, logExpected, type FileAccess, type FileAttributes, type IFileAccessInfo, type IFileAttributes } from '@throng/core';

/** `<sys/stat.h>`: `#define UF_HIDDEN 0x00008000`, the flag Finder's "hidden" sets (`chflags hidden`). */
export const UF_HIDDEN = 0x8000;
const NO_WRITE = 0o222;

/** Run a small system tool off the event loop, answering its trimmed output, or null on any failure (logged). */
export type RunTool = (file: string, args: readonly string[]) => Promise<string | null>;

const runTool: RunTool = (file, args) =>
  new Promise((resolve) => {
    // child-exempt: the callback records every failure through logExpected (an unreadable flag or owner is shown as unknown) and answers null.
    execFile(file, [...args], { timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        logExpected(`macos-file-info: ${file}`, 'the dialog shows what it could read rather than failing', error);
        resolve(null);
        return;
      }
      resolve(String(stdout).trim());
    });
  });

/**
 * macOS's equivalents (067 FR-046, 070 FR-023, R11): read-only is the write bit, as on Linux; hidden is a leading dot
 * or the `UF_HIDDEN` flag, read with `stat -f %Xf` off the loop because Node's `stat` has no `st_flags`. No system,
 * archive or junction flag exists here.
 */
export class MacosFileAttributes implements IFileAttributes {
  constructor(private readonly run: RunTool = runTool) {}

  async read(path: string): Promise<FileAttributes> {
    let readOnly = false;
    let flagged = false;
    try {
      readOnly = ((await lstat(path)).mode & NO_WRITE) === 0;
      const flags = await this.run('/usr/bin/stat', ['-f', '%Xf', path]);
      flagged = flags !== null && (parseInt(flags, 16) & UF_HIDDEN) !== 0;
    } catch (error) {
      logExpected('macos-file-attributes: read', 'the dialog shows no attributes rather than failing', error);
    }
    return { readOnly, hidden: basename(path).startsWith('.') || flagged, system: false, archive: false, junction: false };
  }
}

/** `name: staff` from `dscacheutil -q group -a gid <gid>`'s answer. */
export function groupNameOf(output: string): string | undefined {
  return /^name:\s*(\S.*)$/m.exec(output)?.[1]?.trim();
}

/**
 * Owner, group and permissions (067 FR-121, 070 R11). Names come from Directory Services through `id -nu` and
 * `dscacheutil`, each asked once per id for the process; an id with no name shows as its number.
 */
export class MacosFileAccessInfo implements IFileAccessInfo {
  private readonly users = new Map<number, Promise<string>>();
  private readonly groups = new Map<number, Promise<string>>();

  constructor(private readonly run: RunTool = runTool) {}

  async read(stats: { readonly uid: number; readonly gid: number; readonly mode: number }): Promise<FileAccess> {
    const [owner, group] = await Promise.all([this.userName(stats.uid), this.groupName(stats.gid)]);
    return { owner, group, ...formatFileMode(stats.mode) };
  }

  private userName(uid: number): Promise<string> {
    let known = this.users.get(uid);
    if (!known) {
      known = this.run('/usr/bin/id', ['-nu', String(uid)]).then((name) => (name ? name : String(uid)));
      this.users.set(uid, known);
    }
    return known;
  }

  private groupName(gid: number): Promise<string> {
    let known = this.groups.get(gid);
    if (!known) {
      known = this.run('/usr/bin/dscacheutil', ['-q', 'group', '-a', 'gid', String(gid)]).then(
        (out) => (out ? groupNameOf(out) : undefined) ?? String(gid),
      );
      this.groups.set(gid, known);
    }
    return known;
  }
}
