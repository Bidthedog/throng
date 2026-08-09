import type { Holder } from '@throng/core';

/**
 * 029 FR-013 — is one of throng's OWN terminals holding this folder?
 *
 * ══ THE INVERSION #196 DID NOT EXPECT ══
 *
 * The issue treats naming throng as the hard case and a third party as the achievable one. It is the
 * other way round. Naming a third-party process needs the Windows Restart Manager or handle
 * enumeration — a native addon or FFI, which `windows-directory-lock.ts:18` names as a design
 * property to avoid. Naming throng costs nothing: the daemon already knows every terminal it
 * launched and already tracks each one's working directory for FR-027.
 *
 * So the expensive case is the rare one, and the free case is the one a user actually hits — their
 * own terminal is usually what is holding the folder they are trying to rename.
 *
 * Pure and synchronous: it is handed a snapshot of the sessions, so it needs no daemon round trip on
 * the failure path and is unit-testable without one.
 */

export interface KnownTerminal {
  panelId: string;
  /** Where the shell is working. Absent for a session that has not reported yet. */
  cwd?: string;
}

/** Panel id → what the user calls it, published by the renderer (contract §2b). */
export interface PanelIdentity {
  panelTitle: string;
  /** The sub-workspace window, when the panel is not in the window reporting the failure. */
  windowTitle?: string;
}

/**
 * One spelling of a path, so two of them can be compared.
 *
 * Case, because this is Windows-first and `C:\Work` and `c:\work` are one folder. SEPARATORS,
 * because the two sides of this comparison come from different worlds: a shell's cwd is read out of
 * the process's PEB and arrives with backslashes, while a project root can carry whichever slash the
 * thing that recorded it used. Normalising only the case matched neither, silently — the holder
 * lookup simply found nothing and the user was told "another program" about their own terminal.
 */
function key(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Does `cwd` sit AT or UNDER `absPath`?
 *
 * At-or-under, not equal: a shell sitting in `Inner\src` holds `Inner` just as firmly, because
 * Windows refuses to rename any ancestor of a running process's working directory.
 *
 * The separator on the prefix test is not decoration — without it `C:/proj/Inner2` starts with
 * `C:/proj/Inner` and a sibling folder is reported as the holder. That is worse than the errno it
 * replaces, because it is specific enough to be believed.
 */
function isAtOrUnder(cwd: string, absPath: string): boolean {
  const a = key(cwd);
  const b = key(absPath);
  return a === b || a.startsWith(`${b}/`);
}

/**
 * Resolve a throng holder for `absPath`, or `undefined` when none of throng's terminals is there.
 *
 * `undefined` does NOT mean nothing is holding it — only that throng is not. The caller then reports
 * the third-party wording, and (until the Restart Manager spike lands) says it could not identify
 * which program.
 */
export function resolveThrongHolder(
  absPath: string,
  terminals: readonly KnownTerminal[],
  identities: ReadonlyMap<string, PanelIdentity>,
): Holder | undefined {
  const holder = terminals.find((t) => t.cwd && isAtOrUnder(t.cwd, absPath));
  if (!holder) return undefined;
  const identity = identities.get(holder.panelId);
  /*
   * FR-013b — an unresolved panel is still reported, and says so.
   *
   * "throng is holding this, and throng could not say which panel" is much less useful than naming
   * it, and far more useful than `EBUSY`: it tells the user to look at their own terminals rather
   * than hunt for a foreign process. Deliberately the SAME degrade path an unresolvable third party
   * takes, so neither can rot without the other noticing.
   */
  if (!identity) return { isThrong: true };
  return {
    isThrong: true,
    panelTitle: identity.panelTitle,
    ...(identity.windowTitle ? { windowTitle: identity.windowTitle } : {}),
  };
}
