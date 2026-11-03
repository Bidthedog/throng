/**
 * What a package manager has put on this machine, for a running copy to compare itself with (063 FR-010).
 *
 * A system package can be upgraded under a running copy, which keeps working from its own files (FR-009). Only
 * Linux has this: a Windows installer refuses while the copy is in use (058 FR-016a), and an archive or a source run
 * has nothing a package manager replaces. Those answer null.
 */
export interface InstalledCopy {
  /** The installed package's product version. */
  readonly version: string;
  /** What to start to run it. */
  readonly launcher: string;
}

export interface IInstalledVersion {
  /** The copy now installed, or null when this copy is not a package manager's, or it cannot be read. */
  installed(): InstalledCopy | null;
}

export class NoInstalledVersion implements IInstalledVersion {
  installed(): InstalledCopy | null {
    return null;
  }
}

/** The one notice's facts: this copy is older than, or otherwise differs from, what is installed. */
export interface InstalledVersionNotice {
  readonly runningVersion: string;
  readonly installedVersion: string;
}

/** The notice this state calls for, or null when the running copy is the installed one. */
export function installedVersionNotice(
  runningVersion: string,
  installed: InstalledCopy | null,
): InstalledVersionNotice | null {
  if (!installed || installed.version === runningVersion) return null;
  return { runningVersion, installedVersion: installed.version };
}

/**
 * What the notice says, including what restarting can cost (FR-010). A daemon of a different build is retired, which
 * ends its terminals (058 FR-021a); one whose code did not change between the versions is kept, so "may".
 */
export function installedVersionNoticeText(notice: InstalledVersionNotice): string {
  return (
    `throng ${notice.installedVersion} is installed, and this window is still running ${notice.runningVersion}. ` +
    'Restarting opens the new version, and may end the terminals running now.'
  );
}
