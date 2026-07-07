import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import type { IElevationState } from '@throng/core';

/**
 * Windows {@link IElevationState} (005 Phase G, FR-025a). Reports whether THIS
 * process runs at high integrity ("as administrator") by reading the process
 * token's mandatory-integrity SID via `whoami /groups`: the High Mandatory Level
 * SID `S-1-16-12288` is present iff the process is elevated. The result is cached
 * for the process lifetime — elevation cannot change while a process runs — so the
 * probe runs at most once (and never on a hot path).
 *
 * Consumed by the daemon (authoritative — it spawns the PTYs and reports
 * `terminal.capabilities.elevated`) and by UI main (to compare against the daemon).
 */
const HIGH_INTEGRITY_SID = 'S-1-16-12288';

export class WindowsElevation implements IElevationState {
  private cached: boolean | undefined;

  isElevated(): boolean {
    if (this.cached === undefined) this.cached = probeElevated();
    return this.cached;
  }
}

function probeElevated(): boolean {
  try {
    // Use the absolute path to the Windows whoami.exe so a Unix `whoami` on PATH
    // (e.g. Git Bash's, which doesn't understand /groups) can never shadow it.
    const whoami = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
    const out = execFileSync(whoami, ['/groups'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    return out.includes(HIGH_INTEGRITY_SID);
  } catch {
    // If the probe fails we cannot prove elevation — default to NOT elevated so
    // the "run as admin" control stays disabled rather than falsely enabled.
    return false;
  }
}
