import { installedVersionNotice, type IInstalledVersion, type InstalledVersionNotice } from '@throng/core';

/**
 * Tells the user when the package on disk has moved past this running copy (063 FR-010).
 *
 * One condition, one notice: an installed version is reported once, whether or not it was dismissed, however often
 * the window is focused. A further upgrade is a new condition, and reports again.
 */
export function createInstalledVersionMonitor(deps: {
  readonly runningVersion: string;
  readonly probe: IInstalledVersion;
  readonly show: (notice: InstalledVersionNotice) => void;
}): { check(): void } {
  let reported: string | null = null;
  return {
    check(): void {
      const notice = installedVersionNotice(deps.runningVersion, deps.probe.installed());
      if (!notice || notice.installedVersion === reported) return;
      reported = notice.installedVersion;
      deps.show(notice);
    },
  };
}
