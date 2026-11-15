/**
 * A test that asserts one platform's behaviour says so, and says why (062 FR-042). The reason is mandatory, so a skip
 * can always be read back; `describe.skipIf(skipUnlessWindows('…'))` is the form.
 */
function requireReason(reason: string): void {
  if (reason.trim().length === 0) throw new Error('A platform skip must state its reason (062 FR-042).');
}

const nodePlatform = (): string =>
  (globalThis as { process?: { platform?: string } }).process?.platform ?? 'unknown';

/** True (skip) off Windows. `reason` says what Windows behaviour the test covers. */
export function skipUnlessWindows(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() !== 'win32';
}

/** True (skip) off Linux. `reason` says what Linux behaviour the test covers. */
export function skipUnlessLinux(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() !== 'linux';
}

/**
 * True (skip) off macOS. `reason` says what macOS behaviour the test covers. There is no Mac on a developer machine
 * here, so such a test runs on the hosted macOS runners only (070 FR-038).
 */
export function skipUnlessMacos(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() !== 'darwin';
}

/**
 * True (skip) ON macOS: for a test of a failure path a Mac cannot reach, such as signing with no `codesign`. `reason`
 * says why macOS cannot show it (070 FR-038).
 */
export function skipOnMacos(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() === 'darwin';
}

/**
 * True (skip) ON Windows: for a POSIX behaviour (modes, sockets, symlinks) that Linux and macOS share and a Windows
 * host cannot show. `reason` says what Windows lacks (070 FR-038).
 */
export function skipOnWindows(reason: string): boolean {
  requireReason(reason);
  return nodePlatform() === 'win32';
}

export const isLinuxHost = (): boolean => nodePlatform() === 'linux';
export const isWindowsHost = (): boolean => nodePlatform() === 'win32';
export const isMacosHost = (): boolean => nodePlatform() === 'darwin';
